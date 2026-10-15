/**
 * `spur task batch-plan <waves|order|task-children>` — letters-first batch plan surface (task 1104,
 * feature I13).
 *
 * Absorbed from the retired sp plugin script `plugins/sp/scripts/batch-plan.ts` (script-absorption
 * plan PR-5). The projection logic stays in `./plan-projection.ts`; this module owns input
 * validation and the output/exit-code contract the script carried, pinned by
 * `apps/cli/tests/script-absorption-pr5-parity.test.ts`:
 *   waves --tasks <file>  JSON array of {wbs, name} → `{ waves: [...] }` (24-task waves: A Prepare
 *                         batch + A1..A4 + B..Y task rows + Z Batch report).
 *   order --tasks <file> [--concurrency <n>]
 *                         JSON array of {wbs, dependencies?, files?} → the scheduleBatch result
 *                         `{ order, waves, cycle, overlaps, mode, reason }`. A cycle is data, not an error.
 *   task-children --letter <A-Z> --plan <file>
 *                         a `workflow show --format todo --json` payload (or a bare plan array) →
 *                         the task's phase digits as a JSON array.
 * Exit 0 on success, 1 on unreadable/invalid input, 2 on usage error.
 */

import {
    type BatchTask,
    buildBatchPlan,
    type PhasedPlanItem,
    type ScheduleTask,
    scheduleBatch,
    taskPhaseChildren,
} from './plan-projection';

/** The batch-plan modes, in help order. */
export const BATCH_PLAN_MODES = ['waves', 'order', 'task-children'] as const;

/** Usage line printed on a usage error (exit 2). */
export const BATCH_PLAN_USAGE =
    'usage: spur task batch-plan waves --tasks <tasks.json> | order --tasks <tasks.json> [--concurrency <n>] | task-children --letter <A-Z> --plan <plan.json>';

/** Parsed `spur task batch-plan` request. */
export interface BatchPlanRequest {
    mode: string;
    tasks?: string;
    /** Raw `--concurrency` value (default 2); validated as a positive integer. */
    concurrency?: string;
    letter?: string;
    plan?: string;
}

/** Outcome of one request: exit code plus the exact stdout/stderr text (newline-terminated). */
export interface BatchPlanOutcome {
    exitCode: number;
    stdout: string;
    stderr: string;
}

/** Reads one input file's text (relative paths resolve against the caller's project directory). */
export type ReadInputFile = (path: string) => string | Promise<string>;

function isBatchTask(value: unknown): value is BatchTask {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as BatchTask).wbs === 'string' &&
        typeof (value as BatchTask).name === 'string'
    );
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isScheduleTask(value: unknown): value is ScheduleTask {
    if (typeof value !== 'object' || value === null) return false;
    const t = value as ScheduleTask;
    return (
        typeof t.wbs === 'string' &&
        (t.dependencies === undefined || isStringArray(t.dependencies)) &&
        (t.files === undefined || isStringArray(t.files))
    );
}

const usage = (): BatchPlanOutcome => ({ exitCode: 2, stdout: '', stderr: `${BATCH_PLAN_USAGE}\n` });
const invalid = (message: string): BatchPlanOutcome => ({
    exitCode: 1,
    stdout: '',
    stderr: `batch-plan: ${message}\n`,
});

async function readInput(
    path: string,
    read: ReadInputFile,
): Promise<{ ok: true; value: unknown } | { ok: false; out: BatchPlanOutcome }> {
    try {
        return { ok: true, value: JSON.parse(await read(path)) };
    } catch (error) {
        return {
            ok: false,
            out: invalid(`cannot read ${path} — ${error instanceof Error ? error.message : String(error)}`),
        };
    }
}

/** Evaluate one batch-plan request exactly as the retired `batch-plan` script did. */
export async function runBatchPlan(req: BatchPlanRequest, read: ReadInputFile): Promise<BatchPlanOutcome> {
    if (req.mode === 'waves') {
        if (req.tasks === undefined || req.tasks === '') return usage();
        const input = await readInput(req.tasks, read);
        if (!input.ok) return input.out;
        if (!Array.isArray(input.value) || !input.value.every(isBatchTask)) {
            return invalid('--tasks file must be a JSON array of {wbs, name}');
        }
        return { exitCode: 0, stdout: `${JSON.stringify({ waves: buildBatchPlan(input.value) })}\n`, stderr: '' };
    }
    if (req.mode === 'order') {
        const concurrency = Number(req.concurrency ?? 2);
        if (req.tasks === undefined || req.tasks === '' || !Number.isInteger(concurrency) || concurrency < 1) {
            return usage();
        }
        const input = await readInput(req.tasks, read);
        if (!input.ok) return input.out;
        if (!Array.isArray(input.value) || !input.value.every(isScheduleTask)) {
            return invalid('--tasks file must be a JSON array of {wbs, dependencies?, files?}');
        }
        return { exitCode: 0, stdout: `${JSON.stringify(scheduleBatch(input.value, { concurrency }))}\n`, stderr: '' };
    }
    if (req.mode === 'task-children') {
        const letter = req.letter ?? '';
        if (!/^[A-Z]$/.test(letter) || req.plan === undefined || req.plan === '') return usage();
        const input = await readInput(req.plan, read);
        if (!input.ok) return input.out;
        // Accept a bare plan array or a full `workflow show --format todo --json` payload.
        const payload = input.value;
        const plan = Array.isArray(payload) ? payload : (payload as { plan?: PhasedPlanItem[] }).plan;
        if (!Array.isArray(plan)) {
            return invalid('--plan file must be a plan array or a todo --json payload with a `plan` field');
        }
        return {
            exitCode: 0,
            stdout: `${JSON.stringify(taskPhaseChildren(letter, plan as PhasedPlanItem[]))}\n`,
            stderr: '',
        };
    }
    return usage();
}
