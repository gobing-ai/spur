import type { DbAdapter } from '@gobing-ai/ts-db';
import type { TaskSessionEvidenceKind, TaskSessionMechanism } from '../dao/task-session-dao';

// ---------------------------------------------------------------------------
// Pure operational-evidence classifier (task 0722 R3)
// ---------------------------------------------------------------------------

/** One normalized evidence record a session offers to the classifier. */
export interface AttributionEvidence {
    /** `'user-message'` → `content_text` of a user row; `'tool-call'` → `args_raw`. */
    kind: 'user-message' | 'tool-call';
    text: string;
    recordHash: string;
    sourceFile: string;
    sourceLine: number;
}

/** One validated-shape candidate before task-locator validation (app layer owns that). */
export interface AttributionCandidate {
    wbs: string;
    mechanism: TaskSessionMechanism;
    evidenceKind: TaskSessionEvidenceKind;
    /** Bounded audit locator: `<file basename>#<line>`, capped at 200 chars. */
    evidenceRef: string;
}

/** Classifier outcome: candidates plus the honest skip/ambiguity counters (R6/R9). */
export interface AttributionDecision {
    candidates: AttributionCandidate[];
    /**
     * Evidence records that referenced task-like tokens without allowlisted
     * syntax (plain four-digit prose, pasted specifications). Counted for
     * user-message records only — a tool call's args legitimately contain bare
     * numbers (paths, ids) that mean nothing task-shaped.
     */
    skipped: number;
    /** Records whose allowlisted extractors disagreed — conflicting evidence never links (R9). */
    ambiguous: number;
}

/**
 * A task-scoped `/sp:dev-*` / `/sp-dev-*` invocation typed at line start
 * (deterministic task-operating syntax, R3). Anchored to line start so quoted or
 * mid-prose mentions of the same token do not match.
 */
const SLASH_COMMAND_RE = /^[\s>]*\/sp[:_-]dev\S*/;

/**
 * A structured `spur task <verb> <wbs>` operation (R3). Matched anywhere in the
 * record: a tool call whose arguments run the CLI is an operation regardless of
 * wrapper spelling (`bun run spur task …`, `npx spur task …`).
 */
const SPUR_TASK_RE = /(?:^|[\s;&|(])spur\s+task\s+\S+\s+(\d{4})(?![\w.\-/:%])/g;

/**
 * A WBS operand: exactly four digits, not glued to path/version/punctuation
 * context. Keeps dates (`2026-08-30`), times, and semvers (`0.4.38`) out of the
 * candidate set while matching the plain `0722` operand shape.
 */
const WBS_RE = /(?<![\w.\-/:%])\d{4}(?![\w.\-/:%])/g;

/** Loose four-digit probe for plain-mention counting (user-message records only). */
const PLAIN_MENTION_RE = /\b\d{4}\b/;

const EVIDENCE_REF_MAX = 200;

function evidenceRefOf(record: AttributionEvidence): string {
    const base = record.sourceFile.replaceAll('\\', '/').split('/').pop() ?? record.sourceFile;
    return `${base}#${record.sourceLine}`.slice(0, EVIDENCE_REF_MAX);
}

function slashWbsSet(line: string): Set<string> {
    return new Set(line.match(WBS_RE) ?? []);
}

function spurTaskWbsSet(text: string): Set<string> {
    const hits = new Set<string>();
    for (const match of text.matchAll(SPUR_TASK_RE)) hits.add(match[1] as string);
    return hits;
}

/**
 * Classify one session's normalized evidence into task-attribution candidates.
 *
 * Pure and deterministic (R3): the same records always yield the same decision, so
 * dry-run preview and write mode share identical decisions. Allowlisted syntaxes
 * only — a record with no allowlisted match is a skipped plain mention (never a
 * link), and a record where the two extractors disagree is ambiguous (never a
 * link). Candidate WBS values are shapes, not truths: the application layer
 * validates every candidate through the task locator before persisting (R3).
 */
export function classifyTaskAttribution(records: readonly AttributionEvidence[]): AttributionDecision {
    const decision: AttributionDecision = { candidates: [], skipped: 0, ambiguous: 0 };
    for (const record of records) {
        const isUser = record.kind === 'user-message';
        // Slash invocations: per-line anchor; a command line may carry one WBS operand.
        let slash: Set<string> | null = null;
        if (isUser) {
            for (const line of record.text.split('\n')) {
                if (!SLASH_COMMAND_RE.test(line)) continue;
                const set = slashWbsSet(line);
                if (slash === null) slash = set;
                else for (const wbs of set) slash.add(wbs);
            }
        }
        const spur = spurTaskWbsSet(record.text);
        if (slash === null && spur.size === 0) {
            // No allowlisted syntax. Plain four-digit prose in a user message is a
            // skipped mention (R9); a tool call without the syntax is just not evidence.
            if (isUser && PLAIN_MENTION_RE.test(record.text)) decision.skipped += 1;
            continue;
        }
        if (slash !== null && spur.size > 0) {
            const conflicting = [...slash].some((w) => !spur.has(w)) || [...spur].some((w) => !slash.has(w));
            if (conflicting) {
                decision.ambiguous += 1;
                continue;
            }
        }
        const merged = new Set([...(slash ?? []), ...spur]);
        for (const wbs of merged) {
            decision.candidates.push({
                wbs,
                mechanism: slash?.has(wbs) ? 'slash-command' : 'spur-cli',
                evidenceKind: isUser ? 'user-command' : 'cli-tool',
                evidenceRef: evidenceRefOf(record),
            });
        }
    }
    return decision;
}

// ---------------------------------------------------------------------------
// Bounded attribution reads (raw SQL stays in the domain layer, ADR-011)
// ---------------------------------------------------------------------------

/** Upper bound on sessions evaluated per import source (R2 spirit: never unbounded). */
export const ATTRIBUTION_SESSION_LIMIT = 5000;

/** Upper bound on evidence rows fetched per session. */
export const ATTRIBUTION_EVIDENCE_LIMIT = 500;

/** Scope of the session set an attribution pass evaluates (task 0722 R4). */
export type AttributionScope =
    /** Full mode / dry-run preview: every discovered session of the source. */
    | 'all'
    /** Incremental/force-file write: only sessions this import touched. */
    | 'changed';

/**
 * Distinct session ids of one source, for attribution. `changed` scope restricts
 * to rows this import wrote (`imported_at >= changedSince`). Bounded by
 * {@link ATTRIBUTION_SESSION_LIMIT}; placeholder session ids are never evaluated.
 */
export async function listAttributionSessions(
    db: DbAdapter,
    source: string,
    opts: { scope: AttributionScope; changedSince?: string },
): Promise<string[]> {
    const params: unknown[] = [source];
    let whereExtra = '';
    if (opts.scope === 'changed') {
        whereExtra = ' AND imported_at >= ?';
        params.push(opts.changedSince ?? '');
    }
    params.push(ATTRIBUTION_SESSION_LIMIT);
    try {
        const rows = await db.queryAll<{ sessionId: string }>(
            `SELECT DISTINCT session_id AS sessionId FROM history_message
             WHERE source = ? AND session_id NOT IN ('', 'unknown', 'session')${whereExtra}
             ORDER BY session_id
             LIMIT ?`,
            ...params,
        );
        return rows.map((r) => r.sessionId);
    } catch (error) {
        if (error instanceof Error && error.message.includes('no such table: history_message')) return [];
        throw error;
    }
}

/**
 * Allowlist-prefiltered evidence records for one session. The LIKE prefilters only
 * fetch rows that can possibly match an extractor syntax; the classifier owns the
 * precise decision. Bounded per session by {@link ATTRIBUTION_EVIDENCE_LIMIT}.
 */
export async function loadAttributionEvidence(
    db: DbAdapter,
    source: string,
    sessionId: string,
): Promise<AttributionEvidence[]> {
    try {
        const userRows = await db.queryAll<{
            recordHash: string;
            sourceFile: string;
            sourceLine: number;
            text: string | null;
        }>(
            `SELECT record_hash AS recordHash, source_file AS sourceFile, source_line AS sourceLine,
                    content_text AS text
             FROM history_message
             WHERE source = ? AND session_id = ? AND role = 'user'
               AND (content_text LIKE '%/sp%' OR content_text LIKE '%spur task%')
             LIMIT ?`,
            source,
            sessionId,
            ATTRIBUTION_EVIDENCE_LIMIT,
        );
        const toolRows = await db.queryAll<{
            recordHash: string;
            sourceFile: string;
            sourceLine: number;
            text: string | null;
        }>(
            `SELECT record_hash AS recordHash, source_file AS sourceFile, source_line AS sourceLine,
                    args_raw AS text
             FROM history_tool_call
             WHERE source = ? AND session_id = ? AND args_raw LIKE '%spur task%'
             LIMIT ?`,
            source,
            sessionId,
            ATTRIBUTION_EVIDENCE_LIMIT,
        );
        const evidence: AttributionEvidence[] = [];
        for (const row of userRows) {
            if (row.text != null && row.text.length > 0) {
                evidence.push({
                    kind: 'user-message',
                    text: row.text,
                    recordHash: row.recordHash,
                    sourceFile: row.sourceFile,
                    sourceLine: row.sourceLine,
                });
            }
        }
        for (const row of toolRows) {
            if (row.text != null && row.text.length > 0) {
                evidence.push({
                    kind: 'tool-call',
                    text: row.text,
                    recordHash: row.recordHash,
                    sourceFile: row.sourceFile,
                    sourceLine: row.sourceLine,
                });
            }
        }
        return evidence;
    } catch (error) {
        if (error instanceof Error && error.message.includes('no such table: history_message')) return [];
        if (error instanceof Error && error.message.includes('no such table: history_tool_call')) return [];
        throw error;
    }
}

/** Zeroed {@link TaskAttributionSummary} accumulator. */
export interface TaskAttributionSummary {
    sessionsEvaluated: number;
    linksCreated: number;
    linksAlreadyPresent: number;
    skippedEvidence: number;
    ambiguousEvidence: number;
}

/** Zero-count {@link TaskAttributionSummary} used to initialize per-source accumulation. */
export function emptyAttributionSummary(): TaskAttributionSummary {
    return { sessionsEvaluated: 0, linksCreated: 0, linksAlreadyPresent: 0, skippedEvidence: 0, ambiguousEvidence: 0 };
}
