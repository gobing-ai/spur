#!/usr/bin/env bun
/**
 * task-size-precheck — pipeline size precheck guard (R2, task 0454) plus the
 * size-vs-executor-capability gate (R3, task 0487).
 *
 * Shells `spur task show <wbs> --json`, evaluates R-item count and Plan
 * checklist count against limits, writes PASS/FAIL to status file. With
 * `--executor`, also shells `spur agent doctor <exec> --json` and blocks a large
 * task routed to a sub-`capable-1` executor.
 *
 * Always exits 0 (soft check, like doctor). The precheck→implement guard in
 * task-pipeline.yaml reads the status file.
 *
 * Ships with the plugin to arbitrary projects, so it stays node-builtin-only —
 * no workspace imports. The capability tier therefore comes from the CLI rather
 * than from `getExecutorTier` directly; `spur agent doctor --json` exposes it as
 * `capabilityTier` precisely so the inference regex is not duplicated here.
 *
 * Usage:
 *   bun plugins/sp/scripts/task-size-precheck.ts <wbs> [--spur-bin <path>]
 *     [--max-reqs <n>] [--max-plan-items <n>] [--executor <name>]
 *
 * Env: SPUR_BIN, MAX_IMPLEMENT_REQS, MAX_IMPLEMENT_PLAN_ITEMS
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STAGE_FLOOR_TIER, TIER_ORDER } from './stage-registry-adapter';

// ─── Regex (sync with packages/app/src/services/task-size-precheck.ts) ───────

/** Matches `- [ ] **R1.**` or `- [x] R1.` etc. Requires period after digits. */
const R_ITEM_RE = /^\s*-\s*\[[ xX]\]\s*(\*\*)?R\d+\./m;

/** Matches checklist items under the Plan section. */
const CHECKLIST_ITEM_RE = /^\s*-\s*\[[ xX]\]/m;

/**
 * Large-task thresholds for the capability gate (R3, task 0487) — the DEFAULT
 * caps, not the overridable `--max-*` limits. Raising the caps says "I accept a
 * big task"; it does not make a flash-tier model able to finish one inside
 * `implementTimeoutMs`.
 */
const LARGE_TASK_REQS = 5;
const LARGE_TASK_PLAN_ITEMS = 8;

/**
 * Capability tiers strong enough for a large task (R3, task 0487). The floor is
 * the `review` stage's Layer-1 tier — `reviewer` per `references/roles.md`,
 * read via the stage-registry adapter (0538 R4: no tier literal here; roles.md
 * is the pointer). Tiers at or above the floor pass. An unreachable roles.md
 * degrades to the pre-reconcile band — fail-closed for a safety gate.
 */
const CAPABLE_TIERS: ReadonlySet<string> = (() => {
    const floor = STAGE_FLOOR_TIER.get('review') ?? 'capable-1';
    return new Set(TIER_ORDER.slice(Math.max(0, TIER_ORDER.indexOf(floor))));
})();

// ─── CLI ─────────────────────────────────────────────────────────────────────

function usage(): never {
    console.error(
        'Usage: bun plugins/sp/scripts/task-size-precheck.ts <wbs> [--spur-bin <path>] [--max-reqs <n>] [--max-plan-items <n>] [--executor <name>]',
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
    if (process.env.SPUR_BIN) return process.env.SPUR_BIN;
    // scripts/ -> plugins/sp/ -> <repo>/apps/cli/src/index.ts
    const local = new URL('../../../apps/cli/src/index.ts', import.meta.url).pathname;
    if (existsSync(local)) return `bun ${local}`;
    return 'spur';
}

function parseArgs(argv: string[]): {
    wbs: string;
    spurBin: string;
    maxReqs: number;
    maxPlanItems: number;
    executor: string;
} {
    let spurBin = defaultSpurBin();
    let wbs = '';
    let maxReqs = Number(process.env.MAX_IMPLEMENT_REQS) || 5;
    let maxPlanItems = Number(process.env.MAX_IMPLEMENT_PLAN_ITEMS) || 8;
    let executor = '';

    let i = 0;
    while (i < argv.length) {
        const arg = argv[i];
        if (arg === '--spur-bin') {
            spurBin = argv[i + 1] ?? defaultSpurBin();
            i += 2;
        } else if (arg === '--max-reqs') {
            maxReqs = Number(argv[i + 1]) || 5;
            i += 2;
        } else if (arg === '--max-plan-items') {
            maxPlanItems = Number(argv[i + 1]) || 8;
            i += 2;
        } else if (arg === '--executor') {
            executor = argv[i + 1] ?? '';
            i += 2;
        } else if (!arg.startsWith('--')) {
            wbs = arg;
            i++;
        } else {
            i++;
        }
    }

    if (!wbs) usage();
    return { wbs, spurBin, maxReqs, maxPlanItems, executor };
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

/**
 * Capability tier of `executor` per `spur agent doctor <exec> --json`.
 * Unknown executor, unreadable doctor output, or an undeclared-and-uninferrable
 * tier all read as `standard` — conservative: a false block is one flag away,
 * a false pass costs a 30-minute timed-out implement.
 */
function resolveCapabilityTier(spurBin: string, executor: string): string {
    try {
        const out = runSpur(spurBin, ['agent', 'doctor', executor, '--json']);
        const tier = JSON.parse(out)?.agents?.[0]?.capabilityTier;
        return typeof tier === 'string' && tier ? tier : 'standard';
    } catch {
        return 'standard';
    }
}

function main(): void {
    const { wbs, spurBin, maxReqs, maxPlanItems, executor } = parseArgs(process.argv.slice(2));

    // Fetch task content via spur
    let taskContent: string;
    try {
        const result = runSpur(spurBin, ['task', 'show', wbs, '--json']);
        const task = JSON.parse(result);
        taskContent = task.content ?? task.body ?? '';
    } catch {
        // If spur fails, write FAIL and exit 0 (soft, like doctor)
        const statusDir = join(process.cwd(), '.spur', 'run');
        if (!existsSync(statusDir)) mkdirSync(statusDir, { recursive: true });
        writeFileSync(join(statusDir, `${wbs}-precheck-size.status`), 'FAIL\n');
        console.error(`task-size-precheck: FAIL — could not fetch task ${wbs} via ${spurBin}`);
        process.exit(0);
    }

    const reqCount = taskContent.match(new RegExp(R_ITEM_RE.source, 'gm'))?.length ?? 0;

    const planMatch = taskContent.match(/^#{2,3}\s+Plan\s*$/m);
    const planBody = planMatch
        ? (() => {
              const rest = taskContent.slice((planMatch.index ?? 0) + planMatch[0].length);
              const nextSection = rest.match(/^#{2,3}\s+/m);
              return nextSection ? rest.slice(0, nextSection.index ?? 0) : rest;
          })()
        : '';
    const planItemCount = planBody.match(new RegExp(CHECKLIST_ITEM_RE.source, 'gm'))?.length ?? 0;

    const reasons: string[] = [];
    // R3 (0487): a large task on a sub-capable executor blocks even when the caller
    // raised the caps — the caps are an acceptance of size, not a capability grant.
    if (executor && (reqCount > LARGE_TASK_REQS || planItemCount > LARGE_TASK_PLAN_ITEMS)) {
        const tier = resolveCapabilityTier(spurBin, executor);
        if (!CAPABLE_TIERS.has(tier)) {
            reasons.push(
                `Task size (${reqCount} R-items / ${planItemCount} Plan items) requires a capable executor, ` +
                    `but ${executor} is tier ${tier}. ` +
                    `Pass \`--agent <capable>\` or \`--vars '{"implementAgent":"<capable>"}'\`, or split the task.`,
            );
        }
    }
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
