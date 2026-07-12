/**
 * Token ledger reader (tasks 0245 / 0246 / 0247).
 *
 * Tails `.spur/context/token-ledger.jsonl` and returns a newest-first window.
 * 0247: optional `before` cursor for pagination; exposes ledger path for watchers.
 */

import { closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';

/** Known ledger event types written by indexed-context hooks. */
export type ToolUseEventType = 'session_start' | 'read' | 'write' | 'session_end' | string;

/** One JSONL event from token-ledger.jsonl (plus presentation `seq`). */
export interface ToolUseEvent {
    /** Stable row id within a snapshot page (0 = newest in page). */
    seq: number;
    ts: string;
    session: string;
    type: ToolUseEventType;
    file?: string;
    /** Short redacted command/pattern/glob (Bash/Grep/Glob — task 0248). */
    summary?: string;
    tokens?: number;
    action?: string;
    totals?: { reads: number; writes: number; tokens: number };
    sessionId?: string;
    agent?: string;
    model?: string;
}

/** Event types that count as real tool activity (not session markers only). */
const TOOL_ACTIVITY_TYPES = new Set(['read', 'write', 'bash', 'grep', 'glob']);

/** True when the page has no read/write/bash/grep/glob rows (session markers only). */
export function isSparseToolActivity(events: ReadonlyArray<{ type: string }>): boolean {
    return events.length === 0 || !events.some((e) => TOOL_ACTIVITY_TYPES.has(e.type));
}

/** Envelope for GET /api/observability/tool-use. */
export interface ToolUseSnapshot {
    events: ToolUseEvent[];
    count: number;
    limit: number;
    truncated: boolean;
    path: string;
    capturedAt: string;
    sparseToolActivity: boolean;
    /**
     * Cursor for the next older page: exclusive upper bound on `ts` (ISO).
     * Null when no older events remain.
     */
    nextBefore: string | null;
}

/** Options for {@link TokenLedgerService.snapshot}. */
export interface ToolUseSnapshotOptions {
    limit?: number;
    /** Exclusive: only events with ts strictly older than this ISO timestamp. */
    before?: string;
}

/** Construction options for {@link TokenLedgerService}. */
export interface TokenLedgerServiceOptions {
    cwd: string;
    ledgerPath?: string;
    chunkSize?: number;
}

/** Default `?limit=` when omitted or invalid. */
export const TOKEN_LEDGER_DEFAULT_LIMIT = 200;
/** Hard ceiling for `?limit=`. */
export const TOKEN_LEDGER_MAX_LIMIT = 1000;
/** Relative path from project root to the ledger JSONL. */
export const TOKEN_LEDGER_RELATIVE_PATH = join('.spur', 'context', 'token-ledger.jsonl');

const DEFAULT_CHUNK = 64 * 1024;

/**
 * Clamp a query `limit` to the service contract: default 200, max 1000, min 1.
 */
export function clampToolUseLimit(raw: number | undefined): number {
    if (raw === undefined || !Number.isFinite(raw) || raw <= 0) {
        return TOKEN_LEDGER_DEFAULT_LIMIT;
    }
    return Math.min(Math.floor(raw), TOKEN_LEDGER_MAX_LIMIT);
}

/**
 * Parse one JSONL line into a ToolUseEvent (seq filled later), or null if malformed.
 */
export function parseLedgerLine(line: string): Omit<ToolUseEvent, 'seq'> | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        if (typeof obj.ts !== 'string' || typeof obj.session !== 'string' || typeof obj.type !== 'string') {
            return null;
        }
        const event: Omit<ToolUseEvent, 'seq'> = {
            ts: obj.ts,
            session: obj.session,
            type: obj.type,
        };
        if (typeof obj.file === 'string') event.file = obj.file;
        if (typeof obj.summary === 'string') event.summary = obj.summary;
        if (typeof obj.tokens === 'number' && Number.isFinite(obj.tokens) && obj.tokens >= 0) {
            event.tokens = obj.tokens;
        }
        if (typeof obj.action === 'string') event.action = obj.action;
        if (typeof obj.sessionId === 'string') event.sessionId = obj.sessionId;
        if (typeof obj.agent === 'string') event.agent = obj.agent;
        if (typeof obj.model === 'string') event.model = obj.model;
        if (obj.totals !== null && typeof obj.totals === 'object') {
            const t = obj.totals as Record<string, unknown>;
            if (typeof t.reads === 'number' && typeof t.writes === 'number' && typeof t.tokens === 'number') {
                event.totals = { reads: t.reads, writes: t.writes, tokens: t.tokens };
            }
        }
        return event;
    } catch {
        return null;
    }
}

/**
 * Reverse-tail a JSONL file newest-first, optionally skipping events with ts >= before.
 */
export function tailTokenLedgerFile(
    filePath: string,
    limit: number,
    chunkSize: number = DEFAULT_CHUNK,
    before?: string,
): { events: Omit<ToolUseEvent, 'seq'>[]; truncated: boolean } {
    if (!existsSync(filePath)) {
        return { events: [], truncated: false };
    }

    const target = limit + 1;
    const fd = openSync(filePath, 'r');
    try {
        const { size } = fstatSync(fd);
        if (size === 0) return { events: [], truncated: false };

        let pos = size;
        let carry = '';
        const events: Omit<ToolUseEvent, 'seq'>[] = [];

        while (pos > 0 && events.length < target) {
            const n = Math.min(chunkSize, pos);
            pos -= n;
            const buf = Buffer.alloc(n);
            readSync(fd, buf, 0, n, pos);
            const text = buf.toString('utf8') + carry;
            const parts = text.split('\n');

            if (pos > 0) {
                carry = parts.shift() ?? '';
            } else {
                carry = '';
            }

            for (let i = parts.length - 1; i >= 0; i--) {
                const evt = parseLedgerLine(parts[i] ?? '');
                if (!evt) continue;
                // Exclusive cursor: only older than `before` (ISO strings compare lexicographically).
                if (before !== undefined && evt.ts >= before) continue;
                events.push(evt);
                if (events.length >= target) break;
            }
        }

        const truncated = events.length > limit;
        return {
            events: events.slice(0, limit),
            truncated,
        };
    } finally {
        closeSync(fd);
    }
}

/**
 * Serve-facing service: project-local token-ledger tail for Observability Tool Using.
 */
export class TokenLedgerService {
    private readonly ledgerPath: string;
    private readonly chunkSize: number;

    constructor(options: TokenLedgerServiceOptions) {
        this.ledgerPath = options.ledgerPath ?? join(options.cwd, TOKEN_LEDGER_RELATIVE_PATH);
        this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK;
    }

    /** Absolute path to the JSONL ledger (for fs.watch / SSE). */
    get path(): string {
        return this.ledgerPath;
    }

    /**
     * Snapshot the newest ledger events (optionally older than `before`) with stable page `seq`.
     * @throws on unexpected I/O errors (missing file is empty success, not throw)
     */
    snapshot(limitRawOrOpts?: number | ToolUseSnapshotOptions, maybeBefore?: string): ToolUseSnapshot {
        let limitRaw: number | undefined;
        let before: string | undefined;
        if (typeof limitRawOrOpts === 'object' && limitRawOrOpts !== null) {
            limitRaw = limitRawOrOpts.limit;
            before = limitRawOrOpts.before;
        } else {
            limitRaw = limitRawOrOpts;
            before = maybeBefore;
        }
        if (before !== undefined && (typeof before !== 'string' || before.length === 0)) {
            before = undefined;
        }

        const limit = clampToolUseLimit(limitRaw);
        const capturedAt = new Date().toISOString();
        const { events: raw, truncated } = tailTokenLedgerFile(this.ledgerPath, limit, this.chunkSize, before);
        const events: ToolUseEvent[] = raw.map((e, seq) => ({ ...e, seq }));
        const sparseToolActivity = isSparseToolActivity(events);
        // Oldest event in page is the exclusive cursor for the next older page when more exist.
        const oldest = events.length > 0 ? events[events.length - 1] : undefined;
        const nextBefore = truncated && oldest ? oldest.ts : null;

        return {
            events,
            count: events.length,
            limit,
            truncated,
            path: this.ledgerPath,
            capturedAt,
            sparseToolActivity,
            nextBefore,
        };
    }
}
