import type { DbAdapter } from '@gobing-ai/spur-domain';
import { ActionRunDao, PhaseRunDao, RunDao, TaskRunLinkDao, TransitionRunDao } from '@gobing-ai/spur-domain';
import { redactAndBound } from '../observability/agent-execution';

/** Default page size for GET /api/runs `limit` (task 0373). */
export const RUN_STORE_LIST_DEFAULT_LIMIT = 50;
/** Ceiling for GET /api/runs `limit` — caps unbounded client requests. */
export const RUN_STORE_LIST_MAX_LIMIT = 200;
/** Default page size for WBS-linked run lookups (task 0373). */
export const RUN_STORE_WBS_DEFAULT_LIMIT = 50;
/** Ceiling for WBS-linked run lookups — caps unbounded client requests. */
export const RUN_STORE_WBS_MAX_LIMIT = 200;

/** Bound on each string field after redaction so truncation never exposes secrets. */
const MAX_FIELD_LENGTH = 256;

/** Sensitive object keys blanked like `normalizeSystemEventPayload` (non-raw-safe policy). */
const SENSITIVE_KEYS = new Set(['body', 'content', 'message', 'prompt', 'query', 'response', 'value']);

/** Runtime deps for the run-store read service — DB only (ADR-021 thin transport). */
export interface RunStoreServiceContext {
    getDb(): Promise<DbAdapter>;
    secretValues?: readonly string[];
}

/** One row in the run list / WBS-linked run list. */
export interface RunStoreListEntry {
    id: string;
    workflowName: string | null;
    status: string;
    mode: string | null;
    agent: string | null;
    startedAt: string;
    completedAt: string | null;
}

/** Phase row in run detail. */
export interface RunStorePhase {
    phase: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
}

/** Transition row in run detail. */
export interface RunStoreTransition {
    from: string;
    to: string;
    trigger: string | null;
}

/**
 * Action row in run detail. `resultSummary` is a redacted, bounded projection of
 * `result_json` — never the raw blob (R2/R6).
 */
export interface RunStoreAction {
    id: string;
    node: string;
    kind: string;
    status: string;
    durationMs: number | null;
    ok: boolean | null;
    resultSummary: unknown;
    startedAt: string | null;
    completedAt: string | null;
}

/** Full run detail envelope (R2). */
export interface RunStoreDetail {
    run: RunStoreListEntry;
    phases: RunStorePhase[];
    transitions: RunStoreTransition[];
    actions: RunStoreAction[];
}

/** WBS → run link with the linked run's digest fields (R3). */
export interface RunStoreWbsLink {
    runId: string;
    kind: string;
    linkedAt: string;
    run: RunStoreListEntry | null;
}

/** List query filters + paging. */
export interface RunStoreListQuery {
    status?: string;
    /** Page size after clamping; callers may pass raw query values. */
    limit?: number;
    /**
     * Opaque keyset cursor from a prior `nextCursor`. Exclusive — the page
     * starts strictly after the cursor under `started_at DESC, id DESC`.
     */
    cursor?: string;
}

/** Successful list envelope with keyset paging metadata. */
export interface RunStoreListResult {
    runs: RunStoreListEntry[];
    count: number;
    nextCursor: string | null;
    hasMore: boolean;
}

/** Discriminated not-found for an unknown run id (R4). */
export class RunStoreNotFoundError extends Error {
    readonly code = 'RUN_NOT_FOUND' as const;
    constructor(readonly runId: string) {
        super(`run not found: ${runId}`);
        this.name = 'RunStoreNotFoundError';
    }
}

/** Discriminated client error for a malformed list cursor. */
export class RunStoreBadCursorError extends Error {
    readonly code = 'MALFORMED_CURSOR' as const;
    constructor(reason: string) {
        super(reason);
        this.name = 'RunStoreBadCursorError';
    }
}

interface CursorPayload {
    id: string;
    startedAt: string;
}

/** Encode a keyset cursor from the last returned list row. */
export function encodeRunListCursor(id: string, startedAt: string): string {
    const payload: CursorPayload = { id, startedAt };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * Decode and validate a run-list cursor. Throws {@link RunStoreBadCursorError}
 * on any malformation — callers must 400, never fall back to page 1 unfiltered.
 */
export function decodeRunListCursor(encoded: string): CursorPayload {
    if (encoded.length === 0 || encoded.length > 1024) {
        throw new RunStoreBadCursorError('malformed cursor: empty or exceeds maximum length');
    }
    let json: string;
    try {
        const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/');
        const binary = atob(base64);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        json = new TextDecoder().decode(bytes);
    } catch {
        throw new RunStoreBadCursorError('malformed cursor: not valid base64url');
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        throw new RunStoreBadCursorError('malformed cursor: payload is not JSON');
    }
    if (!parsed || typeof parsed !== 'object') {
        throw new RunStoreBadCursorError('malformed cursor: payload must be an object');
    }
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.id !== 'string' || obj.id.length === 0) {
        throw new RunStoreBadCursorError('malformed cursor: missing or invalid id');
    }
    if (typeof obj.startedAt !== 'string' || obj.startedAt.length === 0) {
        throw new RunStoreBadCursorError('malformed cursor: missing or invalid startedAt');
    }
    return { id: obj.id, startedAt: obj.startedAt };
}

/** Clamp a raw limit query value into the documented window. */
export function clampRunStoreLimit(
    raw: number | undefined,
    defaults: { defaultLimit: number; maxLimit: number } = {
        defaultLimit: RUN_STORE_LIST_DEFAULT_LIMIT,
        maxLimit: RUN_STORE_LIST_MAX_LIMIT,
    },
): number {
    if (raw === undefined || Number.isNaN(raw) || raw <= 0) return defaults.defaultLimit;
    return Math.min(raw, defaults.maxLimit);
}

/**
 * Trace-safe projection of an action's `result_json` for the wire (R2/R6).
 *
 * - Parses JSON when possible; unparseable strings become a redacted snippet.
 * - Blanks sensitive keys (prompt/body/…) the same way the event normalizer does.
 * - Applies SECRET_PATTERN to every string and bounds field length.
 */
export function summarizeActionResult(resultJson: string | null, secretValues: readonly string[] = []): unknown {
    if (resultJson === null || resultJson === '') return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(resultJson);
    } catch {
        return { summary: redactString(resultJson, secretValues) };
    }
    return redactValue(parsed, secretValues);
}

function redactString(value: string, secretValues: readonly string[]): string {
    return redactAndBound(value, secretValues, MAX_FIELD_LENGTH);
}

function redactValue(value: unknown, secretValues: readonly string[]): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return redactString(value, secretValues);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.map((item) => redactValue(item, secretValues));
    if (typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            if (SENSITIVE_KEYS.has(key)) {
                out[key] = '[redacted]';
            } else {
                out[key] = redactValue(child, secretValues);
            }
        }
        return out;
    }
    return redactString(String(value), secretValues);
}

function toListEntry(row: {
    id: string;
    workflow_name: string | null;
    mode: string | null;
    status: string;
    agent: string | null;
    started_at: string;
    completed_at: string | null;
}): RunStoreListEntry {
    return {
        id: row.id,
        workflowName: row.workflow_name,
        status: row.status,
        mode: row.mode,
        agent: row.agent,
        startedAt: row.started_at,
        completedAt: row.completed_at,
    };
}

/**
 * Application-layer read API over the workflow run store (task 0373).
 *
 * Composes domain DAOs (`RunDao`, `PhaseRunDao`, `TransitionRunDao`,
 * `ActionRunDao`, `TaskRunLinkDao`) and applies result redaction before any
 * payload crosses the HTTP boundary. The server module stays thin — no SQL,
 * no `ts-db` imports (ADR-021 / R5).
 */
export class RunStoreService {
    constructor(private readonly ctx: RunStoreServiceContext) {}

    /** List runs newest-first with optional status filter and keyset paging (R1). */
    async list(query: RunStoreListQuery = {}): Promise<RunStoreListResult> {
        const limit = clampRunStoreLimit(query.limit);
        let before: { started_at: string; id: string } | undefined;
        if (query.cursor !== undefined && query.cursor.length > 0) {
            const decoded = decodeRunListCursor(query.cursor);
            before = { started_at: decoded.startedAt, id: decoded.id };
        }

        const db = await this.ctx.getDb();
        // Fetch one extra row so hasMore needs no COUNT(*) (same pattern as events history).
        const rows = await new RunDao(db).traceRows({
            status: query.status,
            before,
            limit: limit + 1,
        });
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const last = page.at(-1);
        const nextCursor = hasMore && last ? encodeRunListCursor(last.id, last.started_at) : null;

        return {
            runs: page.map(toListEntry),
            count: page.length,
            nextCursor,
            hasMore,
        };
    }

    /**
     * Load one run with ordered phases, transitions, and redacted actions (R2).
     * Throws {@link RunStoreNotFoundError} for an unknown id (R4) — never a partial object.
     */
    async getDetail(runId: string): Promise<RunStoreDetail> {
        const db = await this.ctx.getDb();
        const row = await new RunDao(db).traceRowById(runId);
        if (!row) {
            throw new RunStoreNotFoundError(runId);
        }

        const [phaseRows, transitionRows, actionRows] = await Promise.all([
            new PhaseRunDao(db).phaseRowsByRunId(runId),
            new TransitionRunDao(db).transitionRowsByRunId(runId),
            new ActionRunDao(db).actionRowsByRunId(runId),
        ]);

        return {
            run: toListEntry(row),
            phases: phaseRows.map((p) => ({
                phase: p.phase,
                status: p.status,
                startedAt: p.started_at,
                completedAt: p.completed_at,
            })),
            transitions: transitionRows.map((t) => ({
                from: t.from_state,
                to: t.to_state,
                trigger: t.trigger,
            })),
            actions: actionRows.map((a) => ({
                id: a.id,
                node: a.node,
                kind: a.kind,
                status: a.status,
                durationMs: a.duration_ms,
                ok: a.ok === null ? null : a.ok === 1,
                resultSummary: summarizeActionResult(a.result_json, this.ctx.secretValues),
                startedAt: a.started_at,
                completedAt: a.completed_at,
            })),
        };
    }

    /**
     * Every `task_run_links` row for a WBS, with the linked run digest when present (R3).
     * Unknown WBS → empty list (not an error).
     */
    async listByWbs(wbs: string, limitRaw?: number): Promise<{ wbs: string; links: RunStoreWbsLink[]; count: number }> {
        const limit = clampRunStoreLimit(limitRaw, {
            defaultLimit: RUN_STORE_WBS_DEFAULT_LIMIT,
            maxLimit: RUN_STORE_WBS_MAX_LIMIT,
        });
        const db = await this.ctx.getDb();
        const linkRows = await new TaskRunLinkDao(db).listByWbs(wbs, limit);
        const runDao = new RunDao(db);

        const links: RunStoreWbsLink[] = [];
        for (const link of linkRows) {
            const runRow = await runDao.traceRowById(link.run_id);
            links.push({
                runId: link.run_id,
                kind: link.kind,
                linkedAt: link.created_at,
                run: runRow ? toListEntry(runRow) : null,
            });
        }

        return { wbs, links, count: links.length };
    }
}
