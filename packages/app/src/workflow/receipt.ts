import { isAbsolute, join } from 'node:path';
import type { FileSystem } from '@gobing-ai/ts-runtime';

/**
 * Work item and receipt — the one dispatch value and the one completion evidence
 * every `agent.run` executor shares (D65 1232, design `workflow-execution-foundation` §4.1/§4.2).
 *
 * The work item is what a stage hands its executor (the host pause payload, the
 * subprocess brief, the fleet inbox body); the receipt is what completes it. Both
 * are durable files under `.spur/run/<runId>/`, so the three executors differ only
 * in WHO writes the receipt — never in its shape.
 */

/** Where a work item's input came from (design §4.1). */
export type WorkItemInputKind = 'task' | 'feature' | 'artifact' | 'var';

/** One declared input the stage may read. */
export interface WorkItemInput {
    path: string;
    kind: WorkItemInputKind;
}

/** The self-contained briefing one `agent.run` stage hands to its executor (design §4.1). */
export interface WorkItem {
    runId: string;
    state: string;
    skill: string | null;
    prompt: string;
    inputs: WorkItemInput[];
    expectFiles: string[];
    ownedSections: string[];
}

/** Which executor completed the work item. */
export type ReceiptExecutor = 'host' | 'subprocess' | 'fleet';

/**
 * How the executor finished. ADR-126 A4 binds all three executors: a wait timeout
 * is `outcome-unknown` (never `failed`), re-dispatch happens only on a definite
 * `failed` or `not-started`, and `contract-violation` is terminal for the action.
 */
export type ReceiptOutcome = 'done' | 'failed' | 'not-started' | 'outcome-unknown' | 'contract-violation';

/** One executor's terminal word on a work item (design §4.2). */
export interface WorkItemReceipt {
    runId: string;
    state: string;
    executor: ReceiptExecutor;
    outcome: ReceiptOutcome;
    startedAt: string;
    finishedAt: string | null;
    files: string[];
    reason: string | null;
    contract?: string;
}

/** Normalize a declared string-list option (expectFiles, ownedSections); invalid entries drop out. */
export function declaredStrings(raw: unknown): string[] {
    return stringList(raw);
}

/** Normalize declared work-item inputs; an unknown kind reads as `artifact`. */
export function declaredInputs(raw: unknown): WorkItemInput[] {
    if (!Array.isArray(raw)) return [];
    return raw.map(parseInput).filter((input): input is WorkItemInput => input !== null);
}

/** Result of validating a host receipt against its work item. */
export type ReceiptCheck = { ok: true } | { ok: false; error: string };

const INPUT_KINDS: readonly WorkItemInputKind[] = ['task', 'feature', 'artifact', 'var'];
const RECEIPT_OUTCOMES: readonly ReceiptOutcome[] = [
    'done',
    'failed',
    'not-started',
    'outcome-unknown',
    'contract-violation',
];
const RECEIPT_EXECUTORS: readonly ReceiptExecutor[] = ['host', 'subprocess', 'fleet'];

/** Run ids and state ids name one directory/file level — never a traversable path. */
function segment(value: string, label: string): string {
    if (value === '' || value.includes('/') || value.includes('\\') || value.includes('..')) {
        throw new Error(`refusing a ${label} path for '${value}': expected a single path segment`);
    }
    return value;
}

/** The run's current work item — one per run, overwritten at each host pause. */
export function workItemPath(workdir: string, runId: string): string {
    return join(workdir, '.spur', 'run', segment(runId, 'work item'), 'work-item.json');
}

/** The canonical receipt for one run stage. */
export function receiptPath(workdir: string, runId: string, state: string): string {
    return join(workdir, '.spur', 'run', segment(runId, 'receipt'), 'receipts', `${segment(state, 'receipt')}.json`);
}

/** Persist the work item a host pause is about to surface. */
export async function writeWorkItem(fs: FileSystem, workdir: string, workItem: WorkItem): Promise<string> {
    const target = workItemPath(workdir, workItem.runId);
    await fs.writeFile(target, `${JSON.stringify(workItem, null, 2)}\n`);
    return target;
}

/** Read the run's work item; absent or malformed reads as `null` (no host pause to resume). */
export async function readWorkItem(fs: FileSystem, workdir: string, runId: string): Promise<WorkItem | null> {
    const target = workItemPath(workdir, runId);
    if (!(await fs.exists(target))) return null;
    try {
        return parseWorkItem(JSON.parse(await fs.readFile(target)));
    } catch {
        return null;
    }
}

/** Persist a receipt as the run's durable completion evidence for one stage. */
export async function writeReceipt(fs: FileSystem, workdir: string, receipt: WorkItemReceipt): Promise<string> {
    const target = receiptPath(workdir, receipt.runId, receipt.state);
    await fs.writeFile(target, `${JSON.stringify(receipt, null, 2)}\n`);
    return target;
}

/** Read a receipt from any path the executor wrote (the host owns its own file). */
export async function readReceipt(fs: FileSystem, workdir: string, path: string): Promise<WorkItemReceipt | null> {
    const target = isAbsolute(path) ? path : join(workdir, path);
    if (!(await fs.exists(target))) return null;
    try {
        return parseReceipt(JSON.parse(await fs.readFile(target)));
    } catch {
        return null;
    }
}

/** Shape-check a persisted work item. */
export function parseWorkItem(raw: unknown): WorkItem | null {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    if (typeof value.runId !== 'string' || value.runId === '') return null;
    if (typeof value.state !== 'string' || value.state === '') return null;
    if (typeof value.prompt !== 'string') return null;
    return {
        runId: value.runId,
        state: value.state,
        skill: typeof value.skill === 'string' ? value.skill : null,
        prompt: value.prompt,
        inputs: declaredInputs(value.inputs),
        expectFiles: stringList(value.expectFiles),
        ownedSections: stringList(value.ownedSections),
    };
}

/** Shape-check a receipt. */
export function parseReceipt(raw: unknown): WorkItemReceipt | null {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    if (typeof value.runId !== 'string' || value.runId === '') return null;
    if (typeof value.state !== 'string' || value.state === '') return null;
    if (!RECEIPT_EXECUTORS.includes(value.executor as ReceiptExecutor)) return null;
    if (!RECEIPT_OUTCOMES.includes(value.outcome as ReceiptOutcome)) return null;
    return {
        runId: value.runId,
        state: value.state,
        executor: value.executor as ReceiptExecutor,
        outcome: value.outcome as ReceiptOutcome,
        startedAt: typeof value.startedAt === 'string' ? value.startedAt : '',
        finishedAt: typeof value.finishedAt === 'string' ? value.finishedAt : null,
        files: stringList(value.files),
        reason: typeof value.reason === 'string' ? value.reason : null,
        ...(typeof value.contract === 'string' ? { contract: value.contract } : {}),
    };
}

/**
 * Accept a host executor's receipt for a paused work item (D65 1232 R2).
 *
 * Only a definite `done` resumes the run: every other outcome — a `failed`, a
 * `not-started`, an `outcome-unknown` wait and a `contract-violation` — refuses,
 * naming the outcome (ADR-126 A4). The receipt must name THIS run and THIS state,
 * every declared `expectFiles` entry must now exist, and every declared owned
 * section of a declared `task` input must carry a body — a heading left empty is
 * not a completed stage. Refusals happen before the resume claim, so a refused
 * continue mutates nothing.
 */
export async function validateWorkItemReceipt(
    fs: FileSystem,
    workdir: string,
    workItem: WorkItem,
    receipt: WorkItemReceipt | null,
): Promise<ReceiptCheck> {
    if (receipt === null) return { ok: false, error: 'work-item receipt could not be read (missing or malformed)' };
    if (receipt.runId !== workItem.runId) {
        return { ok: false, error: `receipt runId '${receipt.runId}' does not match run '${workItem.runId}'` };
    }
    if (receipt.state !== workItem.state) {
        return {
            ok: false,
            error: `receipt state '${receipt.state}' does not match paused state '${workItem.state}'`,
        };
    }
    if (receipt.outcome !== 'done') {
        return {
            ok: false,
            error: `receipt outcome '${receipt.outcome}' does not complete this work item (only 'done' resumes the run; ADR-126 A4)`,
        };
    }

    const missing: string[] = [];
    for (const path of workItem.expectFiles) {
        if (!(await fs.exists(isAbsolute(path) ? path : join(workdir, path)))) missing.push(path);
    }
    if (missing.length > 0) {
        return { ok: false, error: `expected file(s) missing after the host run: ${missing.join(', ')}` };
    }

    if (workItem.ownedSections.length === 0) return { ok: true };
    const taskInputs = workItem.inputs.filter((input) => input.kind === 'task');
    if (taskInputs.length === 0) {
        return {
            ok: false,
            error: `no 'task' input is declared for owned section(s): ${workItem.ownedSections.join(', ')}`,
        };
    }
    const empty: string[] = [];
    for (const input of taskInputs) {
        const target = isAbsolute(input.path) ? input.path : join(workdir, input.path);
        let body: string;
        try {
            body = await fs.readFile(target);
        } catch {
            return { ok: false, error: `owned section(s) cannot be verified: task input ${input.path} is unreadable` };
        }
        for (const section of workItem.ownedSections) {
            if (isEmptySection(body, section)) empty.push(`${input.path}: ${section}`);
        }
    }
    if (empty.length > 0) {
        return { ok: false, error: `owned section(s) empty in ${empty.join(', ')}` };
    }
    return { ok: true };
}

/**
 * Absent body for one markdown section: no heading, or a body that is only
 * whitespace/comments — an unfilled template placeholder is not written work.
 */
function isEmptySection(markdown: string, section: string): boolean {
    const lines = markdown.split(/\r?\n/);
    const wanted = section.trim().toLowerCase();
    let start = -1;
    let level = 0;
    for (let index = 0; index < lines.length; index += 1) {
        const heading = /^(#{2,4})\s+(.*?)\s*$/.exec(lines[index] ?? '');
        if (heading === null) continue;
        if (start < 0) {
            if ((heading[2] ?? '').toLowerCase() === wanted) {
                start = index;
                level = (heading[1] ?? '').length;
            }
            continue;
        }
        if ((heading[1] ?? '').length <= level) {
            return bodyIsEmpty(lines.slice(start + 1, index).join('\n'));
        }
    }
    return start < 0 || bodyIsEmpty(lines.slice(start + 1).join('\n'));
}

function bodyIsEmpty(body: string): boolean {
    return body.replace(/<!--[\s\S]*?-->/g, '').trim() === '';
}

function parseInput(raw: unknown): WorkItemInput | null {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    if (typeof value.path !== 'string' || value.path === '') return null;
    const kind = INPUT_KINDS.includes(value.kind as WorkItemInputKind) ? (value.kind as WorkItemInputKind) : 'artifact';
    return { path: value.path, kind };
}

function stringList(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter((entry): entry is string => typeof entry === 'string' && entry !== '');
}
