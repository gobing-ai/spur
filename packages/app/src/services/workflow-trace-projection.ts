import { basename, join, relative, resolve } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { redactAndBound } from '../observability/agent-execution';
import { resolveRunRecordDir, runArtifactsDir } from './run-storage';
import { type SystemEventAction, systemEventProjectContext } from './system-event-envelope';
import type { TimelineActionDecision, WorkflowTraceEntry } from './workflow-service';

async function fileExists(path: string): Promise<boolean> {
    const fs = createNodeFileSystem();
    return await fs.exists(path);
}

/**
 * Relative path to a run's human run record — `.spur/memory/runs/<runId>.md` for new
 * runs (E7 / task 0925), with the legacy `.spur/memory/runs/<runId>.log` (feature D2 /
 * task 0426) as a read-only fallback — for `run.artifact` metadata. The pair's
 * `.state.json` is intentionally not linked here; the DB trace stays the
 * completion authority (0925 R2/R3).
 */
export async function outputArtifactForRun(cwd: string, runId: string): Promise<string | undefined> {
    const dir = resolveRunRecordDir(cwd, runId);
    for (const name of [`${runId}.md`, `${runId}.log`]) {
        const path = join(dir, name);
        if (await fileExists(path)) return relative(cwd, path);
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Trace helpers
// ---------------------------------------------------------------------------

export function rowToTraceEntry(
    row: {
        id: string;
        workflow_name: string;
        mode: string;
        status: string;
        started_at: string;
        completed_at: string | null;
        metadata_json: string;
        terminal_reason?: string | null;
    },
    cwd: string,
): WorkflowTraceEntry {
    let isDryRun = false;
    let failureReason: string | undefined;
    let version: string | null | undefined;
    let definitionDigest: string | undefined;
    let startState: string | undefined;
    let continuedFrom: string | undefined;
    try {
        const meta = JSON.parse(row.metadata_json);
        isDryRun = meta.dryRun === true;
        if (typeof meta.failureReason === 'string' && meta.failureReason !== '') {
            failureReason = meta.failureReason;
        }
        // 0768 R1: identity is surfaced only when actually recorded — the key's
        // presence separates post-0768 rows (version: literal|null) from legacy rows.
        if ('workflowVersion' in meta && (typeof meta.workflowVersion === 'string' || meta.workflowVersion === null)) {
            version = meta.workflowVersion as string | null;
        }
        if (typeof meta.definitionDigest === 'string' && meta.definitionDigest !== '') {
            definitionDigest = meta.definitionDigest;
        }
        // 1072 R7: start-state lineage, surfaced only when recorded.
        if (typeof meta.startState === 'string' && meta.startState !== '') {
            startState = meta.startState;
        }
        if (typeof meta.continuedFrom === 'string' && meta.continuedFrom !== '') {
            continuedFrom = meta.continuedFrom;
        }
    } catch {
        // metadata_json unparseable — treat as not dry-run
    }
    const entry: WorkflowTraceEntry = {
        runId: row.id,
        workflowName: row.workflow_name,
        mode: row.mode,
        status: row.status,
        startedAt: traceTimestamp(row.started_at),
        completedAt: row.completed_at === null ? null : traceTimestamp(row.completed_at),
        isDryRun,
        project: systemEventProjectContext(cwd),
        durationMs: durationBetween(row.started_at, row.completed_at),
        outcome: traceOutcome(row.status),
        ...(failureReason !== undefined ? { failureReason } : {}),
        ...(typeof row.terminal_reason === 'string' && row.terminal_reason !== ''
            ? { terminalReason: row.terminal_reason }
            : {}),
        ...(version !== undefined ? { version } : {}),
        ...(definitionDigest !== undefined ? { definitionDigest } : {}),
        ...(startState !== undefined ? { startState } : {}),
        ...(continuedFrom !== undefined ? { continuedFrom } : {}),
    };
    const nextAction = traceNextAction(entry);
    if (nextAction !== undefined) entry.nextAction = nextAction;
    return entry;
}

const TRACE_IDENTIFIER = /^[A-Za-z0-9._:-]+$/;

// B7 R6/R7 (task 0895): trace gains the dispatched executor, the stage's session
// id, the reuse/fresh outcome, and the pin re-resolution columns.
const TRACE_RESULT_FIELDS = [
    'agent',
    'exitCode',
    'executor',
    'sessionId',
    'session',
    'pinReresolved',
    'pinReresolvedFrom',
    'pinReresolvedOwner',
    'pinReresolvedReason',
] as const;

const TRACE_INVOCATION_FIELDS = [
    'agent',
    'source',
    'command',
    'cwd',
    'mode',
    'outputMode',
    'timeoutMs',
    'continue',
    'stdinInteractive',
    'model',
    'translatedFrom',
    'sessionId',
] as const;

function durationBetween(startedAt: string, completedAt: string | null): number | null {
    if (completedAt === null) return null;
    const start = Date.parse(startedAt);
    const end = Date.parse(completedAt);
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

/** A persisted ISO timestamp as-is, or `unavailable` when it does not parse. */
export function traceTimestamp(value: string): string {
    return Number.isFinite(Date.parse(value)) ? value : 'unavailable';
}

/** Epoch-ms timestamp as ISO 8601, or `unavailable` for an invalid date. */
export function persistedTimestamp(value: number): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'unavailable' : date.toISOString();
}

function traceOutcome(status: string): string {
    if (status === 'done') return 'success';
    if (status === 'failed') return 'failure';
    if (status === 'running' || status === 'pending' || status === 'paused') return status;
    return 'unavailable';
}

/** Trace outcome vocabulary for one action row: running/pending pass through, then success/failure/unavailable by `ok`. */
export function actionOutcome(status: string, ok: boolean | null): string {
    if (status === 'running' || status === 'pending') return status;
    if (ok === true) return 'success';
    if (ok === false) return 'failure';
    return 'unavailable';
}

/** Suggested follow-up for a run (follow, continue, or inspect the run log); undefined when none applies or the id is unsafe to echo. */
export function traceNextAction(run: WorkflowTraceEntry, outputArtifact?: string): SystemEventAction | undefined {
    if (!TRACE_IDENTIFIER.test(run.runId)) return undefined;
    if (run.status === 'running' || run.status === 'pending') {
        return { label: 'Follow run', kind: 'command', value: `spur workflow trace ${run.runId} --follow` };
    }
    if (run.status === 'paused' || run.status === 'interrupted') {
        return { label: 'Continue run', kind: 'command', value: `spur workflow continue ${run.runId}` };
    }
    if (run.status === 'failed' && outputArtifact !== undefined) {
        return { label: 'Inspect run log', kind: 'path', value: outputArtifact };
    }
    return undefined;
}

/** Project a persisted action result into bounded, redacted trace fields (result, invocation, decision, error). */
export function projectActionTraceResult(
    resultJson: string | null,
    secretValues: readonly string[] = [],
    /** The action row's `kind` — the persisted payload does not carry it (dogfood 2026-10-08 P4). */
    actionKind?: string,
): {
    result: Record<string, string | number | boolean> | null;
    invocation: Record<string, string | number | boolean> | null;
    decision: TimelineActionDecision | null;
    error: string | null;
} {
    if (!resultJson) return { result: null, invocation: null, decision: null, error: null };
    let parsed: unknown;
    try {
        parsed = JSON.parse(resultJson);
    } catch {
        return {
            result: null,
            invocation: null,
            decision: null,
            error: null,
        };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
            result: null,
            invocation: null,
            decision: null,
            error: null,
        };
    }
    const result = parsed as Record<string, unknown>;
    const data =
        result.data && typeof result.data === 'object' && !Array.isArray(result.data)
            ? (result.data as Record<string, unknown>)
            : {};
    const invocationSource =
        data.invocation && typeof data.invocation === 'object' && !Array.isArray(data.invocation)
            ? (data.invocation as Record<string, unknown>)
            : undefined;
    const resultFields: Record<string, string | number | boolean> = {};
    for (const field of TRACE_RESULT_FIELDS) {
        const value = data[field];
        if (typeof value === 'string') resultFields[field] = redactAndBound(value, secretValues, 256);
        else if (typeof value === 'number' || typeof value === 'boolean') resultFields[field] = value;
    }
    // 0901 R5: shell results carry persisted byte-tails (≤ 65,536 bytes, already
    // secret-redacted at persist time by the Spur ActionRedactor). Project them
    // verbatim — NOT through the 256-char bound — plus the truncation flags, so
    // trace surfaces the tail without re-reading the run log. Kind comes from the
    // action row, not the payload: engine-persisted rows carry no top-level `kind`.
    if ((actionKind ?? result.kind) === 'shell') {
        for (const [field, source] of [
            ['stdoutTail', 'stdout'],
            ['stderrTail', 'stderr'],
        ] as const) {
            const value = data[source];
            if (typeof value === 'string') resultFields[field] = value;
        }
        for (const flag of ['stdoutTruncated', 'stderrTruncated'] as const) {
            const value = data[flag];
            if (typeof value === 'boolean') resultFields[flag] = value;
        }
    }
    const invocation: Record<string, string | number | boolean> = {};
    if (invocationSource !== undefined) {
        for (const field of TRACE_INVOCATION_FIELDS) {
            const value = invocationSource[field];
            if (typeof value === 'string') invocation[field] = redactAndBound(value, secretValues, 256);
            else if (typeof value === 'number' || typeof value === 'boolean') invocation[field] = value;
        }
    }
    const error = typeof result.error === 'string' ? redactAndBound(result.error, secretValues, 512) : null;
    return {
        result: Object.keys(resultFields).length === 0 ? null : resultFields,
        invocation: Object.keys(invocation).length === 0 ? null : invocation,
        decision: projectDecisionProvenance(data.decision, secretValues),
        error,
    };
}

/**
 * Project persisted decision provenance (0911 R6) into a bounded, redacted trace object. The
 * source shape is application-owned, so the projection re-checks every field type and drops
 * anything that is not part of the closed vocabulary — raw evidence and provider exception text
 * never live in this object to begin with.
 */
function projectDecisionProvenance(value: unknown, secretValues: readonly string[]): TimelineActionDecision | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    if (source.schemaVersion !== 1) return null;
    const mode = typeof source.mode === 'string' ? source.mode : null;
    const outcome = typeof source.outcome === 'string' ? source.outcome : null;
    const reason = typeof source.reason === 'string' ? source.reason : null;
    if (mode === null || outcome === null || reason === null) return null;
    const evidenceActionIds = Array.isArray(source.evidenceActionIds)
        ? source.evidenceActionIds
              .filter((id): id is string => typeof id === 'string')
              .slice(0, 20)
              .map((id) => redactAndBound(id, secretValues, 64))
        : [];
    return {
        mode: redactAndBound(mode, secretValues, 32),
        outcome: redactAndBound(outcome, secretValues, 32),
        reason: redactAndBound(reason, secretValues, 64),
        provider: typeof source.provider === 'string' ? redactAndBound(source.provider, secretValues, 64) : null,
        confidence: typeof source.confidence === 'number' ? source.confidence : null,
        selectedProbability: typeof source.selectedProbability === 'number' ? source.selectedProbability : null,
        evidenceActionIds,
        evidenceDigest:
            typeof source.evidenceDigest === 'string' ? redactAndBound(source.evidenceDigest, secretValues, 128) : null,
        artifactId: typeof source.artifactId === 'string' ? redactAndBound(source.artifactId, secretValues, 64) : null,
        durationMs: typeof source.durationMs === 'number' ? source.durationMs : 0,
    };
}

/** Relative path of a failed action's partial-output artifact — the retained copy first, then the scratch file; undefined when neither exists. */
export async function partialArtifactForAction(
    cwd: string,
    runId: string,
    node: string,
    ok: boolean | null,
): Promise<string | undefined> {
    if (ok !== false || !TRACE_IDENTIFIER.test(runId) || !TRACE_IDENTIFIER.test(node)) return undefined;
    const relativePath = join('.spur', 'run', `${runId}-${node}-partial.md`);
    const retained = join(runArtifactsDir(cwd, runId), basename(relativePath));
    if (await fileExists(retained)) return relative(cwd, retained);
    return (await fileExists(resolve(cwd, relativePath))) ? relativePath : undefined;
}
