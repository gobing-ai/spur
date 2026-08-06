#!/usr/bin/env bun
/**
 * task-size-precheck — pipeline size precheck guard (R2, task 0454).
 *
 * Shells `spur task show <wbs> --json`, evaluates R-item count and Plan
 * checklist count against limits, writes PASS/FAIL to status file.
 *
 * Always exits 0 (soft check, like doctor). The precheck→implement guard in
 * task-pipeline.yaml reads the status file.
 *
 * Usage:
 *   bun plugins/sp/scripts/task-size-precheck.ts <wbs> [--spur-bin <path>]
 *     [--max-reqs <n>] [--max-plan-items <n>]
 *
 * Env: SPUR_BIN, MAX_IMPLEMENT_REQS, MAX_IMPLEMENT_PLAN_ITEMS
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Regex (sync with packages/app/src/services/task-size-precheck.ts) ───────

/** Matches `- [ ] **R1.**` or `- [x] R1.` etc. Requires period after digits. */
const R_ITEM_RE = /^\s*-\s*\[[ xX]\]\s*(\*\*)?R\d+\./m;

/** Matches checklist items under the Plan section. */
const CHECKLIST_ITEM_RE = /^\s*-\s*\[[ xX]\]/m;

// ─── CLI ─────────────────────────────────────────────────────────────────────

function usage(): never {
    console.error(
        'Usage: bun plugins/sp/scripts/task-size-precheck.ts <wbs> [--spur-bin <path>] [--max-reqs <n>] [--max-plan-items <n>]',
    );
    process.exit(1);
}

function parseArgs(argv: string[]): {
    wbs: string;
    spurBin: string;
    maxReqs: number;
    maxPlanItems: number;
} {
    let spurBin = process.env.SPUR_BIN ?? 'spur';
    let wbs = '';
    let maxReqs = Number(process.env.MAX_IMPLEMENT_REQS) || 5;
    let maxPlanItems = Number(process.env.MAX_IMPLEMENT_PLAN_ITEMS) || 8;

    let i = 0;
    while (i < argv.length) {
        const arg = argv[i];
        if (arg === '--spur-bin') {
            spurBin = argv[i + 1] ?? 'spur';
            i += 2;
        } else if (arg === '--max-reqs') {
            maxReqs = Number(argv[i + 1]) || 5;
            i += 2;
        } else if (arg === '--max-plan-items') {
            maxPlanItems = Number(argv[i + 1]) || 8;
            i += 2;
        } else if (!arg.startsWith('--')) {
            wbs = arg;
            i++;
        } else {
            i++;
        }
    }

    if (!wbs) usage();
    return { wbs, spurBin, maxReqs, maxPlanItems };
}

function main(): void {
    const { wbs, spurBin, maxReqs, maxPlanItems } = parseArgs(process.argv.slice(2));

    // Fetch task content via spur
    let taskContent: string;
    try {
        const result = execSync(`${spurBin} task show ${wbs} --json`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
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
