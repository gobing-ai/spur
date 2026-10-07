#!/usr/bin/env bun
/**
 * batch-plan — letters-first batch plan surface (task 1104, feature I13).
 *
 * The projection logic lives in packages/app/src/workflow/plan-projection.ts (unit-tested
 * there); this script is ADR-130 glue — argv/IO only — over the bundled core in
 * ../lib/plan-projection.generated.* (regenerate: `bun run build:plugin-lib && bun run build:scripts`).
 *
 * Modes:
 *   waves --tasks <file>  file: JSON array of {wbs, name}; prints `{ waves: [...] }` — waves
 *                         of 24 tasks as A Prepare batch + A1..A4 + B..Y task rows + Z Batch report.
 *   task-children --letter <A-Z> --plan <file>
 *                         file: a `workflow show --format todo --json` payload (or a bare plan
 *                         array); prints the task's phase digits as a JSON array.
 * Exit 0 on success, 1 on unreadable/invalid input, 2 on usage error. Runs under bare
 * `node batch-plan.mjs` (committed twin) — keep the twin in lockstep.
 */
import { readFileSync } from 'node:fs';
import type { BatchTask, PhasedPlanItem } from '../lib/plan-projection.generated.mjs';
import { buildBatchPlan, taskPhaseChildren } from '../lib/plan-projection.generated.mjs';

export * from '../lib/plan-projection.generated.mjs';

export const BATCH_PLAN_USAGE =
    'usage: batch-plan.ts waves --tasks <tasks.json> | task-children --letter <A-Z> --plan <plan.json>';

function readJsonFile(path: string): unknown {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function isBatchTask(value: unknown): value is BatchTask {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as BatchTask).wbs === 'string' &&
        typeof (value as BatchTask).name === 'string'
    );
}

export function main(argv: string[]): number {
    const mode = argv[0];
    if (mode === 'waves') {
        if (argv[1] !== '--tasks' || argv[2] === undefined) {
            process.stderr.write(`${BATCH_PLAN_USAGE}\n`);
            return 2;
        }
        let tasks: unknown;
        try {
            tasks = readJsonFile(argv[2]);
        } catch (error) {
            process.stderr.write(
                `batch-plan: cannot read ${argv[2]} — ${error instanceof Error ? error.message : String(error)}\n`,
            );
            return 1;
        }
        if (!Array.isArray(tasks) || !tasks.every(isBatchTask)) {
            process.stderr.write('batch-plan: --tasks file must be a JSON array of {wbs, name}\n');
            return 1;
        }
        process.stdout.write(`${JSON.stringify({ waves: buildBatchPlan(tasks) })}\n`);
        return 0;
    }
    if (mode === 'task-children') {
        let letter = '';
        let planPath = '';
        for (let i = 1; i + 1 < argv.length; i += 2) {
            if (argv[i] === '--letter') letter = argv[i + 1] ?? '';
            else if (argv[i] === '--plan') planPath = argv[i + 1] ?? '';
        }
        if (!/^[A-Z]$/.test(letter) || planPath === '') {
            process.stderr.write(`${BATCH_PLAN_USAGE}\n`);
            return 2;
        }
        let payload: unknown;
        try {
            payload = readJsonFile(planPath);
        } catch (error) {
            process.stderr.write(
                `batch-plan: cannot read ${planPath} — ${error instanceof Error ? error.message : String(error)}\n`,
            );
            return 1;
        }
        // Accept a bare plan array or a full `workflow show --format todo --json` payload.
        const plan = Array.isArray(payload) ? payload : (payload as { plan?: PhasedPlanItem[] }).plan;
        if (!Array.isArray(plan)) {
            process.stderr.write(
                'batch-plan: --plan file must be a plan array or a todo --json payload with a `plan` field\n',
            );
            return 1;
        }
        process.stdout.write(`${JSON.stringify(taskPhaseChildren(letter, plan as PhasedPlanItem[]))}\n`);
        return 0;
    }
    process.stderr.write(`${BATCH_PLAN_USAGE}\n`);
    return 2;
}

if (import.meta.main) {
    process.exit(main(process.argv.slice(2)));
}
