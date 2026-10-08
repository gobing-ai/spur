/**
 * Workflow run-record inspection, retention resolvers and reclamation types.
 *
 * Extracted from the workflow application service (task 0962, review candidate C2). This module
 * owns the confined sync reads under `.spur/memory/runs` and legacy `.spur/run` (realpath + fstat byte-window) plus the run-log
 * retention/output-config resolvers and the reclamation result shapes; it imports nothing from
 * the service — the dependency edge is service → run-record, never back.
 */

import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { SpurConfig } from '@gobing-ai/spur-config';
import { redactAndBound } from '../observability/agent-execution';
import type { WorkflowRunLogConfig } from '../observability/workflow-run-log-sink';

/** Thrown when a run id cannot be used as a single path segment under the selected run-record root (0948 R5). */
export class InvalidWorkflowRunIdError extends Error {
    readonly code = 'invalid-run-id' as const;

    constructor(runId: string) {
        super(`Invalid workflow run id: ${JSON.stringify(runId)}`);
        this.name = 'InvalidWorkflowRunIdError';
    }
}

/** A retained run log reclaimed by `spur workflow clean` (feature D2 / task 0429). */
export interface ReclaimedRunLog {
    /** Run id derived from the log file name (`<runId>.log`). */
    runId: string;
    /** Path of the removed (or would-be-removed) log file. */
    path: string;
    /** File mtime at scan time (ISO 8601). */
    mtime: string;
}

/** Result of retained run-log reclamation (`.spur/memory/runs/<RUNID>.log`, task 0429). */
export interface RunLogReclamationResult {
    /** Retention threshold applied, in days. */
    retentionDays: number;
    /** Whether this was a dry run (no writes). */
    dryRun: boolean;
    /** The logs that were (or would be) removed. */
    reclaimed: ReclaimedRunLog[];
    /** Removal failures — best-effort: one file failing never aborts the rest. */
    failures: Array<{ path: string; error: string }>;
}

/** An expired terminal checkpoint removed (or reportable) by checkpoint reclamation (task 0711 R5). */
export interface ReclaimedCheckpoint {
    /** File name under `.spur/memory/sessions/`. */
    name: string;
    /** Confined absolute path of the removed (or would-be-removed) checkpoint. */
    path: string;
    /** `updated_at` (fallback mtime) at scan time, ISO 8601. */
    age: string;
}

/** A checkpoint that was scanned but deliberately kept, with the reason (task 0711 R5/R6). */
export interface SkippedCheckpoint {
    name: string;
    reason: string;
}

/** Result of session-checkpoint reclamation (`.spur/memory/sessions/`, task 0711 R5–R8). */
export interface CheckpointReclamationResult {
    retentionDays: number;
    dryRun: boolean;
    reclaimed: ReclaimedCheckpoint[];
    skipped: SkippedCheckpoint[];
    failures: Array<{ path: string; error: string }>;
}

/**
 * Resolve the run-log retention threshold (days) from the threaded config
 * `workflows.logRetentionDays` (feature D2 / task 0429). Sync & pure: a load
 * failure is already surfaced once at the root; `config === null` degrades to
 * the 30-day default.
 */
export function resolveWorkflowLogRetentionDays(config: SpurConfig | null): number {
    return config?.workflows?.logRetentionDays ?? 30;
}

/**
 * Resolve run-log size limits (`maxBytes`, `maxLines`) from `agent.output` in
 * the threaded config. Returns an empty object when the section is absent or
 * the config is null — observability config must never break a run.
 */
export function resolveOutputLogConfig(config: SpurConfig | null): WorkflowRunLogConfig {
    const output = config?.agent?.output;
    if (output === undefined) return {};
    return {
        ...(output['max-bytes'] !== undefined ? { maxBytes: output['max-bytes'] } : {}),
        ...(output['max-lines'] !== undefined ? { maxLines: output['max-lines'] } : {}),
    };
}

/** Explicit outcome of reading a run's persisted record from disk (E7 / task 0926 R3). */
export type WorkflowRunRecordRead =
    | { kind: 'pair'; markdownPath: string; statePath: string; state: Record<string, unknown> }
    | {
          kind: 'incomplete';
          markdownPath: string;
          statePath: string;
          reason: 'state-missing' | 'state-invalid';
      }
    | { kind: 'legacy-log'; logPath: string }
    | { kind: 'missing' };

/**
 * Detect a run's record format and read its machine state (E7 / task 0926 — the
 * shared reader seam behind the workflow service for the follow tail and the
 * 0927/0929 surfaces). Precedence: a valid pair wins; a `.md` whose state file
 * is missing or unparseable is an explicit INCOMPLETE record — never success,
 * never synthesized from the markdown; a historical `.log`-only run stays
 * readable in place with no bulk migration; the DB trace remains the lifecycle
 * authority regardless of what is on disk.
 */
export function readWorkflowRunRecord(runDir: string, runId: string): WorkflowRunRecordRead {
    // Run ids key file names under the run dir — reject traversal before any path is built.
    if (runId.includes('/') || runId.includes('\\') || runId.includes('..')) {
        throw new InvalidWorkflowRunIdError(runId);
    }
    const markdownPath = join(runDir, `${runId}.md`);
    const statePath = join(runDir, `${runId}.state.json`);
    if (existsSync(markdownPath)) {
        // 0948 R6: read the state file directly instead of `existsSync` → `readFileSync`.
        // That two-call sequence raced a concurrent writer, so a pair that vanished between
        // the calls was classified `state-invalid` (a corruption signal) when the honest
        // outcome is `state-missing`. ENOENT is the missing signal; anything else — bad JSON,
        // wrong shape — stays invalid.
        let raw: string;
        try {
            raw = readFileSync(statePath, 'utf8');
        } catch (err) {
            // Vanished between the exists check and the read is missing, not invalid (0948 R6).
            const reason = stateReadFailureReason(err);
            return { kind: 'incomplete', markdownPath, statePath, reason };
        }
        try {
            const state: unknown = JSON.parse(raw);
            if (state !== null && typeof state === 'object' && !Array.isArray(state)) {
                return { kind: 'pair', markdownPath, statePath, state: state as Record<string, unknown> };
            }
        } catch {
            // Unparseable state → explicit invalid outcome below.
        }
        return { kind: 'incomplete', markdownPath, statePath, reason: 'state-invalid' };
    }
    const legacyLogPath = join(runDir, `${runId}.log`);
    if (existsSync(legacyLogPath)) return { kind: 'legacy-log', logPath: legacyLogPath };
    return { kind: 'missing' };
}

/** Byte cap on one served run-record FILE (0929 R2) — one bounded JSON response. */
export const RUN_RECORD_INSPECT_MAX_BYTES = 256 * 1024;

/**
 * Character cap for the redacted TEXT bound (0948 R5). Bytes and characters are different
 * units: the file gate measures the file size in bytes while `redactAndBound` measures
 * `string.length` in characters, so a single constant could not honestly name both.
 */
export const RUN_RECORD_INSPECT_MAX_CHARS = 256 * 1024;

/** ENOENT between exists and read is a vanished file; every other read failure is invalid. */
export function stateReadFailureReason(err: unknown): 'state-missing' | 'state-invalid' {
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === 'ENOENT') {
        return 'state-missing';
    }
    return 'state-invalid';
}

/** Explicit bounded outcome of a Board run-record inspection (0929 R2). */
export type WorkflowRunRecordInspection =
    | { status: 'record'; markdown: string; state: Record<string, unknown> }
    | { status: 'incomplete'; markdown: string; reason: 'state-missing' | 'state-invalid' }
    | { status: 'legacy'; content: string }
    | { status: 'oversized'; sizeBytes: number }
    | { status: 'missing' };

/**
 * Outcome of reading one run-record file under confinement: the text, an
 * explicit oversized signal, or nothing (escaped/vanished → missing).
 */
type ConfinedRunFile = { text: string } | { oversized: number } | undefined;

/**
 * Read one run-record file only if it is a regular file at the confined path.
 *
 * 0948 R5 collapses the realpath → stat → read TOCTOU window: one `open` (with
 * `O_NOFOLLOW`, so a symlinked final component is refused atomically rather than
 * followed) pins the inode, and every subsequent check and the read itself use THAT
 * descriptor. The old sequence re-resolved the path three times, so the bytes served
 * need not have been the bytes whose size and location were checked.
 *
 * Confinement rests on the caller: `realRunDir` is already fully resolved and the
 * final component is a validated single run-id segment.
 */
function readConfinedRunFile(realRunDir: string, path: string, maxBytes: number): ConfinedRunFile {
    // 0948 R5: `open` FIRST, so the descriptor pins the inode the moment the path is
    // resolved. `O_NOFOLLOW` refuses a symlinked final component outright (the escape
    // vector, since the run-id component itself is already validated). The confined
    // realpath is then checked AND its identity compared to the descriptor we hold —
    // a swap between open and check is caught by dev/ino instead of being read.
    let fd: number | undefined;
    try {
        fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const real = realpathSync(path);
        if (real !== realRunDir && !real.startsWith(realRunDir + sep)) return undefined;
        const opened = fstatSync(fd);
        const confined = statSync(real);
        if (opened.dev !== confined.dev || opened.ino !== confined.ino) return undefined;
        if (!opened.isFile()) return undefined;
        if (opened.size > maxBytes) return { oversized: opened.size };
        return { text: readFileSync(fd, 'utf8') };
    } catch {
        return undefined; // escaped (symlink), vanished, or unreadable → missing
    } finally {
        if (fd !== undefined) closeSync(fd);
    }
}

/**
 * Re-redact a parsed JSON value (0948 R5): the run-record state is served from disk, so
 * it must pass the same read-side scrub as the markdown. Strings are redacted and
 * bounded; object keys are scrubbed too (a secret can be a key).
 */
function redactJsonValue(value: unknown, secrets: readonly string[], maxChars: number): unknown {
    if (typeof value === 'string') return redactAndBound(value, secrets, maxChars);
    if (Array.isArray(value)) return value.map((item) => redactJsonValue(item, secrets, maxChars));
    if (value !== null && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
            out[redactAndBound(key, secrets, maxChars)] = redactJsonValue(item, secrets, maxChars);
        }
        return out;
    }
    return value;
}

/**
 * Confined, redacted, bounded run-record inspection behind the Board read
 * route (E7 / task 0929 R1/R2). Builds on the shared {@link readWorkflowRunRecord}
 * seam — no second format parser — and adds the remote-read guarantees: every
 * served file must resolve beneath the run directory, text is re-redacted
 * against the caller's secrets and capped before it leaves the process, and
 * the outcome is an explicit union — a present pair, a legacy-only log, an
 * incomplete record, oversized content, or missing. `expired` is reserved for
 * persisted cleanup evidence; the current log cleaner leaves no tombstone, so
 * absence alone is `missing`. Completion stays a DB-trace fact; nothing here
 * infers status from the record text.
 */
export function inspectWorkflowRunRecord(
    runDir: string,
    runId: string,
    opts: { secretValues?: readonly string[]; maxBytes?: number; maxChars?: number } = {},
): WorkflowRunRecordInspection {
    const maxBytes = opts.maxBytes ?? RUN_RECORD_INSPECT_MAX_BYTES;
    const maxChars = opts.maxChars ?? RUN_RECORD_INSPECT_MAX_CHARS;
    const secrets = opts.secretValues ?? [];
    const record = readWorkflowRunRecord(runDir, runId); // rejects traversal-shaped ids
    if (record.kind === 'missing') return { status: 'missing' };
    let realRunDir: string;
    try {
        realRunDir = realpathSync(runDir);
    } catch {
        return { status: 'missing' }; // run dir vanished between detection and read
    }
    if (record.kind === 'legacy-log') {
        const file = readConfinedRunFile(realRunDir, record.logPath, maxBytes);
        if (file === undefined) return { status: 'missing' };
        if ('oversized' in file) return { status: 'oversized', sizeBytes: file.oversized };
        // The legacy `.log` predates write-time redaction — scrub it again on read.
        return { status: 'legacy', content: redactAndBound(file.text, secrets, maxChars) };
    }
    const mdFile = readConfinedRunFile(realRunDir, record.markdownPath, maxBytes);
    if (mdFile === undefined) return { status: 'missing' };
    if ('oversized' in mdFile) return { status: 'oversized', sizeBytes: mdFile.oversized };
    const markdown = redactAndBound(mdFile.text, secrets, maxChars);
    if (record.kind === 'incomplete') {
        return { status: 'incomplete', markdown, reason: record.reason };
    }
    const stateFile = readConfinedRunFile(realRunDir, record.statePath, maxBytes);
    if (stateFile === undefined) {
        // The state file cannot be served (escaped or vanished) — the record
        // degrades to incomplete, never to a synthesized state (0929 R2).
        return { status: 'incomplete', markdown, reason: 'state-invalid' };
    }
    if ('oversized' in stateFile) return { status: 'oversized', sizeBytes: stateFile.oversized };
    // 0948 R5: the state JSON is served from disk and must not bypass read-side redaction —
    // `markdown` was scrubbed while `state` was served parse-trusted.
    return {
        status: 'record',
        markdown,
        state: redactJsonValue(record.state, secrets, maxChars) as Record<string, unknown>,
    };
}
