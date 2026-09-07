/**
 * Ready-by-default creation orchestration (F21 task 0788, ADR-109).
 *
 * Stays OUT of TaskService/PlanningWriteService by design (R2/R8): the low-level
 * writers remain deterministic and lock-free of model work. This module is the
 * only place that drives an agent for preparation, and the CLI is the only
 * caller — `spur task create` (single flow) and `spur task batch-create`
 * (batch flow).
 *
 * Single flow (SINGLE FLOW contract): the task is already saved as a backlog
 * capture by TaskService.create; preparation dispatches the canonical ready
 * competency (`/sp:dev-refine <wbs> --auto --depth ready`) through
 * AgentService.runTraced, then runs the deterministic post-check (the same
 * `task check` policy as `todo`), and only then promotes backlog → todo. Exit 0
 * alone is never ready evidence. Failure preserves the task and returns the
 * exact recovery command — no blind retry, no deletion.
 *
 * Batch flow (BATCH FLOW contract): the planner is called ONCE for the whole
 * batch before any allocation boundary; the captured array is extracted
 * fence-tolerantly, validated with the strict public batch schema, and only a
 * fully valid batch is handed back for `batchCreate` (which re-validates
 * all-then-commit). Rejected model output never allocates a WBS.
 */

import { createHash } from 'node:crypto';
import { MarkdownDocument, TASK_CANONICAL_SECTIONS, type TaskBatchItem, taskBatchSchema } from '@gobing-ai/spur-domain';
import type { AgentRunCaptureResult, AgentRunTracedResult } from './agent-service';
import type { CheckFindings } from './planning-check-base';

/** The canonical ready checklist (docs/design/task-creation-readiness.md, ADR-109). */
export const READY_CHECKLIST_IDS = [
    'requirements',
    'design',
    'plan',
    'ac',
    'decisions',
    'dependencies',
    'premises',
] as const;

/** Union of the ready-checklist row ids (`READY_CHECKLIST_IDS`), as emitted by the planning owner. */
export type ReadyChecklistId = (typeof READY_CHECKLIST_IDS)[number];

/** One ready-checklist evidence row as emitted by the planning owner. */
export interface ReadyCheckRow {
    id: string;
    pass: boolean;
    evidence: string;
}

/** Agent budget for creation preparation (15 minutes). Callers may override via `timeoutMs`; no CLI flag exposes it yet. */
export const DEFAULT_READY_PREPARE_TIMEOUT_MS = 900_000;

/** Recovery command for one unready task — the canonical ready competency. */
export function readyRefineCommand(wbs: string): string {
    return `/sp:dev-refine ${wbs} --auto --depth ready`;
}

/** Recovery command for an unready batch under a feature. */
export function readyRefineAllCommand(featureId: string): string {
    return `/sp:dev-refineall --feature ${featureId} --auto --depth ready`;
}

/** Stage where preparation stopped — surfaced verbatim in CLI error details. */
export type TaskPreparationStage =
    | 'agent-dispatch'
    | 'agent-run'
    | 'post-check'
    | 'promotion'
    | 'invalid-output'
    | 'validation';

/**
 * Preparation failure (R5): the task/batch identity is preserved, authored work
 * is never rolled back, and `recoveryCommand` is the exact next action.
 */
export class TaskPreparationError extends Error {
    readonly stage: TaskPreparationStage;
    readonly wbs?: string;
    readonly filePath?: string;
    readonly findings?: CheckFindings[];
    readonly recoveryCommand?: string;

    constructor(init: {
        stage: TaskPreparationStage;
        message: string;
        wbs?: string;
        filePath?: string;
        findings?: CheckFindings[];
        recoveryCommand?: string;
    }) {
        super(init.message);
        this.name = 'TaskPreparationError';
        this.stage = init.stage;
        this.wbs = init.wbs;
        this.filePath = init.filePath;
        this.findings = init.findings;
        this.recoveryCommand = init.recoveryCommand;
    }
}

/** Minimal structural view of TaskService used by preparation (keeps this module decoupled). */
export interface ReadyTaskPort {
    show(wbs: string): Promise<{ wbs: string; status: string; filePath: string }>;
    updateStatus(wbs: string, toStatus: string, actor?: string): Promise<unknown>;
}

/** Minimal structural view of AgentService (runTraced/runCapture signatures). */
export interface ReadyAgentPort {
    runTraced(prompt: string | undefined, flags: Record<string, string | boolean>): Promise<AgentRunTracedResult>;
    runCapture(prompt: string | undefined, flags: Record<string, string | boolean>): Promise<AgentRunCaptureResult>;
}

/** Deterministic post-check seam — the shared `task check` policy evaluated as `todo`. */
export type ReadyPostCheck = (filePath: string, wbs: string) => Promise<{ pass: boolean; findings: CheckFindings[] }>;

/**
 * Readiness payload merged into create/batch-create JSON output (FROZEN CLI).
 * `depth` is always 'ready': this flow never advertises execution eligibility.
 */
export type ReadinessOutcome = { readiness: { status: 'ready' | 'skipped' | 'failed'; depth: 'ready' } };

/** The `--skip-ready` payload — synthesis bypassed by explicit request. */
export const READY_SKIPPED: ReadinessOutcome = { readiness: { status: 'skipped', depth: 'ready' } };

/** The successful default-path payload. */
export const READY_DONE: ReadinessOutcome = { readiness: { status: 'ready', depth: 'ready' } };

/**
 * Prepare one already-saved task to ready (R1/R2). The task keeps its WBS and
 * file throughout; partial authored sections are preserved on failure.
 *
 * Stages: agent-dispatch (resolution/validation failure) → agent-run (nonzero
 * exit/signal/timeout) → post-check (deterministic `task check` as todo) →
 * promotion (backlog → todo lifecycle transition; skipped when a previous
 * `--next` already promoted, so re-running recovery is idempotent).
 */
export async function prepareCreatedTaskReady(opts: {
    wbs: string;
    tasks: ReadyTaskPort;
    agents: ReadyAgentPort;
    checkTask: ReadyPostCheck;
    /** `--agent <selector>` pass-through; omission resolves the configured default. */
    agentSelector?: string;
    /** Project root the executor runs in (refine resolves the task corpus relative to it). */
    cwd?: string;
    timeoutMs?: number;
    actor?: string;
}): Promise<ReadinessOutcome> {
    const { wbs, tasks, agents, checkTask } = opts;
    const recoveryCommand = readyRefineCommand(wbs);

    // Inspect the actual saved task BEFORE dispatch (R5: identity + path are the
    // contract; a vanished task is a post-check-stage failure, not a silent skip).
    const before = await tasks.show(wbs).catch((err: unknown) => {
        throw new TaskPreparationError({
            stage: 'post-check',
            message: `saved task ${wbs} is unreadable before preparation: ${err instanceof Error ? err.message : String(err)}`,
            wbs,
            recoveryCommand,
        });
    });

    const flags: Record<string, string | boolean> = {
        mode: 'text',
        timeout: String(opts.timeoutMs ?? DEFAULT_READY_PREPARE_TIMEOUT_MS),
    };
    if (opts.agentSelector !== undefined && opts.agentSelector !== '') flags.agent = opts.agentSelector;
    if (opts.cwd !== undefined && opts.cwd !== '') flags.cwd = opts.cwd;

    const traced = await agents.runTraced(readyRefineCommand(wbs), flags);
    if (traced.exitCode === 2) {
        throw new TaskPreparationError({
            stage: 'agent-dispatch',
            message: `ready preparation could not dispatch an executor for ${wbs}: ${traced.message ?? 'agent resolution failed'}`,
            wbs,
            filePath: before.filePath,
            recoveryCommand,
        });
    }
    if (traced.exitCode !== 0) {
        const why =
            traced.signal !== undefined
                ? `terminated by signal ${traced.signal}`
                : `executor exited ${traced.exitCode}`;
        throw new TaskPreparationError({
            stage: 'agent-run',
            message: `ready preparation failed for ${wbs}: ${why}. Partial section edits are preserved on the task.`,
            wbs,
            filePath: before.filePath,
            recoveryCommand,
        });
    }

    // Do not accept exit 0 alone as ready evidence (SINGLE FLOW): inspect the
    // actual task and run the deterministic post-check evaluated as `todo`.
    const after = await tasks.show(wbs).catch((err: unknown) => {
        throw new TaskPreparationError({
            stage: 'post-check',
            message: `saved task ${wbs} is unreadable after preparation: ${err instanceof Error ? err.message : String(err)}`,
            wbs,
            filePath: before.filePath,
            recoveryCommand,
        });
    });
    const check = await checkTask(after.filePath, wbs).catch((err: unknown) => {
        throw new TaskPreparationError({
            stage: 'post-check',
            message: `post-check for ${wbs} could not run: ${err instanceof Error ? err.message : String(err)}`,
            wbs,
            filePath: after.filePath,
            recoveryCommand,
        });
    });
    if (!check.pass) {
        const summary = check.findings
            .filter((f) => f.severity === 'error')
            .map((f) => `${f.layer}:${f.code} ${f.section !== undefined ? `(${f.section}) ` : ''}${f.message}`)
            .slice(0, 5)
            .join('; ');
        throw new TaskPreparationError({
            stage: 'post-check',
            message: `ready post-check failed for ${wbs}: ${summary || 'check did not pass'}`,
            wbs,
            filePath: after.filePath,
            findings: check.findings,
            recoveryCommand,
        });
    }

    // Promotion (idempotent): dev-refine --next may already have flipped the
    // status to todo; only transition when it is still behind.
    if (after.status !== 'todo') {
        try {
            await tasks.updateStatus(wbs, 'todo', opts.actor ?? 'ready-preparation');
        } catch (err: unknown) {
            throw new TaskPreparationError({
                stage: 'promotion',
                message: `ready preparation could not promote ${wbs} to todo: ${err instanceof Error ? err.message : String(err)}`,
                wbs,
                filePath: after.filePath,
                recoveryCommand,
            });
        }
    }
    return READY_DONE;
}

/**
 * Fence-tolerant extraction of the prepared JSON array from captured model
 * output: whole-text parse first, then the first `[` … last `]` span (a single
 * trailing prose/fence line must not orphan an otherwise valid array).
 */
export function extractBatchArray(answer: string): unknown {
    const attempt = (text: string): unknown | undefined => {
        try {
            return JSON.parse(text) as unknown;
        } catch {
            return undefined;
        }
    };
    const direct = attempt(answer);
    if (direct !== undefined) return direct;
    const start = answer.indexOf('[');
    const end = answer.lastIndexOf(']');
    if (start === -1 || end <= start) {
        throw new TaskPreparationError({
            stage: 'invalid-output',
            message: 'prepared batch output carried no JSON array',
        });
    }
    const sliced = attempt(answer.slice(start, end + 1));
    if (sliced === undefined) {
        throw new TaskPreparationError({
            stage: 'invalid-output',
            message: 'prepared batch output is not valid JSON',
        });
    }
    return sliced;
}

/**
 * Batch preparation (R3): dispatch the planner ONCE for the whole supplied
 * batch, capture the prepared array, and validate it with the strict public
 * batch schema before returning. No task file, WBS allocation, or parent write
 * happens here — `batchCreate` remains the only commit boundary and re-validates.
 *
 * Returns the validated items in input order; the caller serializes them to a
 * temp file for `batchCreate`. On any failure the batch is untouched.
 */
export async function prepareBatchTaskReady(opts: {
    /** Path of the supplied batch file (read for the synthesis prompt). */
    batchPath: string;
    /** Raw contents of the supplied batch file. */
    batchSource: string;
    agents: ReadyAgentPort;
    agentSelector?: string;
    /** Project root the executor runs in (batch file paths resolve relative to it). */
    cwd?: string;
    timeoutMs?: number;
}): Promise<TaskBatchPrepared> {
    const { agents } = opts;
    const flags: Record<string, string | boolean> = {
        mode: 'text',
        timeout: String(opts.timeoutMs ?? DEFAULT_READY_PREPARE_TIMEOUT_MS),
    };
    if (opts.agentSelector !== undefined && opts.agentSelector !== '') flags.agent = opts.agentSelector;
    if (opts.cwd !== undefined && opts.cwd !== '') flags.cwd = opts.cwd;

    // Recovery hint: refineall when the supplied batch names a feature (first
    // item wins); absent a feature the per-task refine command is derivable only
    // with a wbs, so no hint is offered.
    let recoveryCommand: string | undefined;
    try {
        const supplied: unknown = JSON.parse(opts.batchSource);
        if (Array.isArray(supplied)) {
            for (const item of supplied) {
                if (typeof item === 'object' && item !== null && 'feature_id' in item) {
                    const featureId: unknown = item.feature_id;
                    if (typeof featureId === 'string' && featureId !== '') {
                        recoveryCommand = readyRefineAllCommand(featureId);
                        break;
                    }
                }
            }
        }
    } catch {
        // supplied batch was not readable JSON — leave the hint absent
    }

    const prompt =
        'Prepare this task batch to the ready checklist (requirements, design, plan, ac, decisions, dependencies, ' +
        'premises). Read the batch file, assess and synthesize every candidate item in input order, preserving ' +
        'names, feature_id, parent_wbs and authored constraints, and fill Requirements, Design, Plan and Acceptance ' +
        'Criteria substantively (never placeholders). Never author Solution, Testing or Review sections. ' +
        'Print ONLY the prepared JSON array — no prose, no code fence.\n' +
        `Batch file: ${opts.batchPath}\n` +
        `Batch contents:\n${opts.batchSource}`;

    const captured = await agents.runCapture(prompt, flags);
    if (captured.exitCode === 2) {
        throw new TaskPreparationError({
            stage: 'agent-dispatch',
            message: `batch preparation could not dispatch an executor: ${captured.stderr || 'agent resolution failed'}`,
            recoveryCommand,
        });
    }
    if (captured.exitCode !== 0) {
        const why =
            captured.signal !== undefined
                ? `terminated by signal ${captured.signal}`
                : `executor exited ${captured.exitCode}`;
        throw new TaskPreparationError({
            stage: 'agent-run',
            message: `batch preparation failed: ${why}`,
            recoveryCommand,
        });
    }

    const parsed: unknown = extractBatchArray(captured.answer);
    const validated = taskBatchSchema.safeParse(parsed);
    if (!validated.success) {
        const issues = validated.error.issues.map((i) => `  [${i.path.join('.')}] ${i.message}`).join('\n');
        throw new TaskPreparationError({
            stage: 'validation',
            message: `prepared batch failed schema validation:\n${issues}`,
            recoveryCommand,
        });
    }
    return { items: validated.data };
}

/** Result of preparing a batch file's items for ready-by-default creation. */
export interface TaskBatchPrepared {
    /** Strict-schema-valid prepared batch items, input order preserved. */
    items: TaskBatchItem[];
}

// ─── Ready evidence (EVIDENCE/HANDOFF contract) ────────────────────────────

/** Sections bound into the planning digest: everything except execution-owned regions. */
const EXECUTION_OWNED_SECTIONS: Record<string, true> = { Solution: true, Testing: true, Review: true, History: true };

/** Sections whose content is bound by computePlanningDigest, in canonical order. */
export const PLANNING_DIGEST_SECTIONS: readonly string[] = TASK_CANONICAL_SECTIONS.filter(
    (s) => !(s in EXECUTION_OWNED_SECTIONS),
);

/**
 * SHA-256 digest binding the actual allowed planning-section content plus
 * feature/template/dependencies of one task document (EVIDENCE/HANDOFF).
 * Excludes created_at/updated_at and execution-owned sections, so preparation
 * evidence stays valid while execution records accumulate.
 */
export function computePlanningDigest(raw: string): string {
    const doc = MarkdownDocument.parse(raw, 'task');
    const fm = doc.frontmatterData ?? {};
    const payload = {
        sections: PLANNING_DIGEST_SECTIONS.map((name) => {
            const body = doc.getSection(name);
            return { name, body: body === null ? null : body.trim() };
        }),
        featureId: typeof fm.feature_id === 'string' ? fm.feature_id : null,
        template: typeof fm.template === 'string' ? fm.template : null,
        dependencies: Array.isArray(fm.dependencies) ? [...fm.dependencies].map(String).sort() : null,
    };
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** Per-task row of the run-scoped ready-evidence artifact. */
export interface ReadyEvidenceTask {
    wbs: string;
    status: 'ready' | 'failed' | 'skipped';
    planningDigest: string;
    checks: ReadyCheckRow[];
    /** Why the task is not ready — handoff report input; absent when ready. */
    reason?: string;
}

/** Shape of `<runId>-idea-ready.json`. */
export interface ReadyEvidenceArtifact {
    runId: string;
    depth: 'ready';
    tasks: ReadyEvidenceTask[];
}

/**
 * Verify one task's ready evidence against its current content (R7): every
 * checklist row present, passing, with nonempty evidence. Structural PASS rows
 * alone are not semantic readiness, and nothing here fabricates a verdict —
 * callers combine this with the deterministic task check.
 */
export function verifyReadyChecks(checks: ReadyCheckRow[] | undefined): { ok: boolean; reason?: string } {
    if (checks === undefined || checks.length === 0) {
        return { ok: false, reason: 'no ready-checklist evidence' };
    }
    for (const id of READY_CHECKLIST_IDS) {
        const row = checks.find((c) => c.id === id);
        if (row === undefined) return { ok: false, reason: `checklist row "${id}" missing` };
        if (row.pass !== true) return { ok: false, reason: `checklist row "${id}" not passing` };
        if (typeof row.evidence !== 'string' || row.evidence.trim() === '') {
            return { ok: false, reason: `checklist row "${id}" has empty evidence` };
        }
    }
    return { ok: true };
}
