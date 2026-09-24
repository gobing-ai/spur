#!/usr/bin/env bun
/**
 * task-size-precheck — pipeline size precheck guard (R2, task 0454; count-only
 * since task 0723).
 *
 * Shells `spur task show <wbs> --json`, evaluates R-item count and Plan
 * checklist count against limits, writes PASS/FAIL to status file. No executor
 * or doctor involvement: executor liveness/routing/capabilities are attested
 * fail-closed at the `agent.run` dispatch boundary, not predicted here.
 *
 * Always exits 0 (soft action). The precheck→implement guard in
 * task-pipeline.yaml reads the status file; a missing or failing checker writes
 * FAIL, so readiness fails closed.
 *
 * Ships with the plugin to arbitrary projects, so it stays node-builtin-only —
 * no workspace imports.
 *
 * Usage:
 *   bun plugins/sp/scripts/task-size-precheck.ts <wbs> [--spur-bin <path>]
 *     [--max-reqs <n>] [--max-plan-items <n>]
 *
 * Env: SPUR_BIN (flags own the size ceilings — env overrides removed, task 0902)
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEnvVar } from '../lib/env';

// ─── Counting (sync with packages/app/src/services/task-size-precheck.ts) ────

/**
 * Requirement item: list marker required, then an optional checkbox, then the R-number in the
 * house `- **R1** — <text>` or legacy `- [ ] R1. <text>` form. A bare `R1 <text>` line is prose.
 */
const R_ITEM_RE_SOURCE = '^\\s*[-*]\\s+(?:\\[[ xX]\\]\\s*)?[*_]{0,2}R(\\d+)\\.?[*_]{0,2}(?:\\s|$)';

/** Top-level numbered Plan step (`1. <text>`). */
const NUMBERED_PLAN_ITEM_RE_SOURCE = '^\\d+\\.\\s';

/** Checklist Plan item (`- [ ] <text>`, `- [x] <text>`). */
const CHECKLIST_ITEM_RE_SOURCE = '^\\s*[-*]\\s+\\[[ xX]\\]';

/**
 * Body of a `##`/`###` section (heading line excluded), up to the next `##`/`###` heading.
 * `null` when the heading is absent — callers decide the fallback.
 */
function sectionBody(content: string, headingPattern: string): string | null {
    const heading = content.match(new RegExp(headingPattern, 'm'));
    if (!heading) return null;
    const rest = content.slice((heading.index ?? 0) + heading[0].length);
    const nextHeading = rest.match(/^#{2,3}\s+/m);
    return nextHeading ? rest.slice(0, nextHeading.index ?? 0) : rest;
}

/** Distinct R-items in `## Requirements` (whole content when the heading is absent). */
function countRItems(taskContent: string): number {
    const body = sectionBody(taskContent, '^#{2,3}\\s+Requirements\\s*$') ?? taskContent;
    const numbers = new Set<string>();
    for (const match of body.matchAll(new RegExp(R_ITEM_RE_SOURCE, 'gm'))) {
        numbers.add(match[1] ?? '');
    }
    return numbers.size;
}

/** Plan items: top-level numbered steps plus checklist items under `## Plan`. */
function countPlanItems(taskContent: string): number {
    const body = sectionBody(taskContent, '^#{2,3}\\s+Plan\\s*$');
    if (body === null) return 0;
    const numbered = body.match(new RegExp(NUMBERED_PLAN_ITEM_RE_SOURCE, 'gm'))?.length ?? 0;
    const checklist = body.match(new RegExp(CHECKLIST_ITEM_RE_SOURCE, 'gm'))?.length ?? 0;
    return numbered + checklist;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function usage(): never {
    console.error(
        'Usage: bun plugins/sp/scripts/task-size-precheck.ts <wbs> [--spur-bin <path>] [--max-reqs <n>] [--max-plan-items <n>]',
    );
    process.exit(1);
}

/**
 * Resolve the spur CLI command in a monorepo-safe way:
 * --spur-bin > SPUR_BIN > monorepo-local CLI entry > PATH `spur`.
 * The plugin's own CI always passes an explicit --spur-bin; this fallback chain
 * keeps ad-hoc invocations from silently hitting a stale PATH install.
 */
function defaultSpurBin(): string {
    if (getEnvVar('SPUR_BIN')) return getEnvVar('SPUR_BIN');
    // scripts/ -> plugins/sp/ -> <repo>/apps/cli/src/index.ts (fileURLToPath — raw pathname breaks
    // on %-encoded paths, e.g. spaces in the checkout directory)
    const local = fileURLToPath(new URL('../../../apps/cli/src/index.ts', import.meta.url));
    if (existsSync(local)) return `bun ${local}`;
    return 'spur';
}

function parseArgs(argv: string[]): {
    wbs: string;
    spurBin: string;
    maxReqs: number;
    maxPlanItems: number;
} {
    let spurBin = defaultSpurBin();
    let wbs = '';
    // Doubled deterministic ceiling (0723 operator decision): 10 R-items / 16
    // Plan items — keep in sync with DEFAULT_TASK_SIZE_LIMITS in
    // packages/app/src/services/task-size-precheck.ts (asserted by test).
    // Overridable per invocation via --max-reqs / --max-plan-items (no env fallback).
    let maxReqs = 10;
    let maxPlanItems = 16;

    let i = 0;
    while (i < argv.length) {
        const arg = argv[i];
        if (arg === '--spur-bin') {
            spurBin = argv[i + 1] ?? defaultSpurBin();
            i += 2;
        } else if (arg === '--max-reqs') {
            maxReqs = Number(argv[i + 1]) || 10;
            i += 2;
        } else if (arg === '--max-plan-items') {
            maxPlanItems = Number(argv[i + 1]) || 16;
            i += 2;
        } else if (arg.startsWith('-')) {
            // 0948 R4: an unknown flag is a mis-invocation, not something to swallow.
            // The old `else { i++; }` let `script 0926 --task-file x.md` run against x.md.
            console.error(`task-size-precheck: unknown flag: ${arg}`);
            usage();
        } else {
            // 0948 R4: first positional wins — a later positional must never overwrite
            // `wbs` (it used to write a garbage-named status file and mask the exit code).
            if (wbs === '') wbs = arg;
            i++;
        }
    }

    if (!wbs) usage();
    return { wbs, spurBin, maxReqs, maxPlanItems };
}

/**
 * Split a multi-token `spurBin` (`<runtime> <mainModule>`) the same way
 * `runSpurJson` does in feature-sync-bounded.ts — execFileSync's first arg is
 * one executable path, not a shell command line.
 */
function runSpur(spurBin: string, args: string[]): string {
    const [file = 'spur', ...lead] = spurBin.split(/\s+/).filter(Boolean);
    return execFileSync(file, [...lead, ...args], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
    });
}

function main(): void {
    const { wbs, spurBin, maxReqs, maxPlanItems } = parseArgs(process.argv.slice(2));

    // Fetch task content via spur
    let taskContent: string;
    try {
        const result = runSpur(spurBin, ['task', 'show', wbs, '--json']);
        const task = JSON.parse(result);
        taskContent = task.content ?? task.body ?? '';
    } catch {
        // If spur fails, write FAIL and exit 0 — the status file carries the verdict
        const statusDir = join(process.cwd(), '.spur', 'run');
        if (!existsSync(statusDir)) mkdirSync(statusDir, { recursive: true });
        writeFileSync(join(statusDir, `${wbs}-precheck-size.status`), 'FAIL\n');
        console.error(`task-size-precheck: FAIL — could not fetch task ${wbs} via ${spurBin}`);
        process.exit(0);
    }

    const reqCount = countRItems(taskContent);
    const planItemCount = countPlanItems(taskContent);

    const reasons: string[] = [];
    if (reqCount > maxReqs) {
        reasons.push(
            `Task has ${reqCount} R-items (max ${maxReqs}). ` +
                `Consider decomposing or raise maxImplementReqs via --vars.`,
        );
    }
    if (planItemCount > maxPlanItems) {
        reasons.push(
            `Task has ${planItemCount} Plan items (max ${maxPlanItems}). ` +
                `Consider simplifying the plan or raise maxImplementPlanItems via --vars.`,
        );
    }

    const ok = reasons.length === 0;
    const status = ok ? 'PASS' : 'FAIL';

    const statusDir = join(process.cwd(), '.spur', 'run');
    if (!existsSync(statusDir)) mkdirSync(statusDir, { recursive: true });
    writeFileSync(join(statusDir, `${wbs}-precheck-size.status`), `${status}\n`);

    const msg = `task-size-precheck: ${status} — ${reqCount} R-items, ${planItemCount} Plan items`;
    console.error(msg);
    if (!ok) {
        for (const r of reasons) {
            console.error(`  ${r}`);
        }
    }

    process.exit(0);
}

main();
