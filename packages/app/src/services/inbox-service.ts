import {
    CoordinationRunDao,
    type DbAdapter,
    InboxDao,
    type InboxEventFactory,
    type InboxMemberCounts,
    type InboxMessage,
    type InboxMessageKind,
    type InboxTaskAttempts,
    SystemEventDao,
} from '@gobing-ai/spur-domain';
import { MessageNotFoundError } from './agent-coordination-service';
import { ensureRetentionQuotaForPrefix } from './system-event-catch-all';
import { DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA, resolveRetentionQuotas } from './system-event-retention';

export type {
    InboxMemberCounts,
    InboxMessage,
    InboxMessageKind,
    InboxMessageStatus,
    InboxRequestRow,
    InboxTaskAttempts,
} from '@gobing-ai/spur-domain';

/**
 * The two identities no agent may claim (G11 R5, ADR-143): `operator` is the human
 * (CLI and Board global input), `spur` is the system (fleet dispatcher, workflows).
 * Both own an inbox of their own, so they are valid *addresses* — they are refused
 * only as agent spec / guest ids.
 */
export const OPERATOR_INBOX_ID = 'operator';
/** The system address: fleet dispatcher and workflow-originated requests (ADR-143). */
export const SPUR_INBOX_ID = 'spur';
/** Both reserved identities — valid *addresses*, refused as agent spec / guest ids. */
export const RESERVED_INBOX_IDS = [OPERATOR_INBOX_ID, SPUR_INBOX_ID] as const;

/** True when `id` is a reserved identity that no agent spec or guest may claim. */
export function isReservedInboxId(id: string): boolean {
    return (RESERVED_INBOX_IDS as readonly string[]).includes(id);
}

/**
 * Delivery budget for one message (replaces `MAX_INJECT_ATTEMPTS`, 0831/0834): a claim
 * increments `attempts`, and the sweeper fails a message once the budget is spent.
 */
export const MAX_DELIVERY_ATTEMPTS = 3;

/**
 * A reused `request_key` whose payload differs from the stored message. Idempotency means the
 * same request, not just the same key: silently dropping the new work (or overwriting the old
 * message) would lose a dispatch.
 */
export class RequestKeyConflictError extends Error {
    constructor(readonly requestKey: string) {
        super(`request key "${requestKey}" already names a different message`);
        this.name = 'RequestKeyConflictError';
    }
}

/**
 * How long a claim may stay unsettled before the sweeper reclaims it. Q&A (2026-10-20):
 * a constant with a constructor override for tests; promote to config when a slow agent
 * needs one.
 */
export const CLAIM_LEASE_MS = 600_000;

/** `list()` direction relative to the member. */
export type InboxDirection = 'in' | 'out' | 'both';

/** Settlement of a claimed message: the invocation was accepted, or never started. */
export type InboxSettleOutcome = 'accepted' | 'not-started';

/** Send input. `kind` defaults to `chat`; `request` rows are the ones reconciliation reads. */
export interface InboxSendInput {
    from: string;
    to: string;
    body: string;
    kind?: InboxMessageKind;
    requestKey?: string;
    taskId?: string;
    parentRunId?: string;
}

/** A send's result. `replayed` is true when the request key already named a message. */
export interface InboxSendResult {
    message: InboxMessage;
    replayed: boolean;
}

/** What one sweep pass changed, by message id. */
export interface InboxSweepResult {
    requeued: string[];
    failed: string[];
    /** Claims settled from a completed run receipt. */
    settled: string[];
}

/** A read receipt: `transitioned` is false when the message was already read. */
export interface InboxMarkReadResult {
    readAt: number;
    transitioned: boolean;
}

/**
 * Idempotency means the same request, not just the same key: a reused key whose payload differs
 * would silently drop the new work. Returns the stored row so callers can replay it.
 */
function assertSameRequest(existing: InboxMessage, input: InboxSendInput): InboxMessage {
    const sameRequest =
        existing.fromId === input.from &&
        existing.toId === input.to &&
        existing.body === input.body &&
        existing.kind === (input.kind ?? 'chat');
    if (!sameRequest) throw new RequestKeyConflictError(input.requestKey ?? '');
    return existing;
}

/** True when an insert lost the race on the inbox `request_key` partial unique index. */
function isRequestKeyCollision(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    // The typed code is authoritative; the text check keeps older bun:sqlite builds working.
    const code = (error as { code?: unknown }).code;
    if (code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return error.message.includes('inbox_messages.request_key') || !error.message.includes('constraint failed');
    }
    return error.message.includes('UNIQUE constraint failed') && error.message.includes('inbox_messages.request_key');
}

/** Injected seams. `leaseMs`/`now` exist for tests only (ADR-143 Q&A). */
export interface InboxServiceDeps {
    getDb(): Promise<DbAdapter>;
    leaseMs?: number;
    now?: () => number;
}

/** Opaque keyset cursor: base64url of `{createdAt, id}` — the client never parses it. */
function encodeCursor(row: { createdAt: number; id: string }): string {
    return Buffer.from(JSON.stringify({ c: row.createdAt, i: row.id })).toString('base64url');
}

/** Decode a cursor; a malformed one is a caller error, so it throws rather than paging wrong. */
function decodeCursor(cursor: string): { createdAt: number; id: string } {
    try {
        const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { c: number; i: string };
        if (typeof parsed.c !== 'number' || typeof parsed.i !== 'string') throw new Error('shape');
        return { createdAt: parsed.c, id: parsed.i };
    } catch {
        throw new Error('malformed list cursor');
    }
}

/** Metadata-only event payload: message bodies stay in inbox storage. */
interface MessageEventData {
    msgId: string;
    fromId: string;
    toId: string;
    threadId: string | null;
    createdAt: string;
}

/**
 * The single inbox reader and writer (G11 R3, ADR-143). Every mutation writes its row and
 * exactly one `system_events` row per changed message in one transaction (the transaction
 * lives in {@link InboxDao}), and every transition is guarded by its prior status, so a
 * guard miss changes nothing and emits nothing.
 *
 * It has no bus: consumers follow the ledger (the agent-loop wake, and the 1267 SSE relay),
 * which is why the server tap skips the `message` prefix instead of double-persisting.
 */
export class InboxService {
    private readonly leaseMs: number;
    private readonly clock: () => number;

    constructor(private readonly deps: InboxServiceDeps) {
        this.leaseMs = deps.leaseMs ?? CLAIM_LEASE_MS;
        this.clock = deps.now ?? (() => Date.now());
    }

    /** Store a message and its `message.sent`/`message.replied` event; replay on a repeated key. */
    async send(input: InboxSendInput): Promise<InboxSendResult> {
        if (input.from.trim() === '') throw new Error('inbox message requires a non-empty sender');
        if (input.to.trim() === '') throw new Error('inbox message requires a non-empty recipient');
        const db = await this.deps.getDb();
        const dao = new InboxDao(db);

        if (input.requestKey !== undefined) {
            const existing = await dao.findByRequestKey(input.requestKey);
            if (existing !== null) return { message: assertSameRequest(existing, input), replayed: true };
        }

        const now = this.clock();
        const id = `msg_${crypto.randomUUID()}`;
        let message: InboxMessage;
        try {
            message = await dao.insert(
                {
                    id,
                    fromId: input.from,
                    toId: input.to,
                    body: input.body,
                    kind: input.kind ?? 'chat',
                    status: 'queued',
                    requestKey: input.requestKey ?? null,
                    taskId: input.taskId ?? null,
                    parentRunId: input.parentRunId ?? null,
                    inReplyTo: null,
                    // A root message is its own thread root, so a thread read needs no extra query.
                    threadId: id,
                    createdAt: now,
                    updatedAt: now,
                },
                this.eventFactory('message.sent'),
            );
        } catch (error) {
            // A concurrent sender won the race on the partial unique index between the read above
            // and this insert. The stored row IS the idempotent answer (G11 R5) — surfacing a raw
            // constraint error would read as a failed dispatch and, in the strategy, release a
            // write-slot claim for work that did go out.
            if (input.requestKey !== undefined && isRequestKeyCollision(error)) {
                const winner = await dao.findByRequestKey(input.requestKey);
                if (winner !== null) return { message: assertSameRequest(winner, input), replayed: true };
            }
            throw error;
        }
        await this.pruneEvents(db);
        return { message, replayed: false };
    }

    /**
     * Reply to a message: addressed to the original sender and inheriting the thread root
     * (G11 R5). Any address can be replied to, including `operator` and `spur`.
     */
    async reply(id: string, from: string, body: string): Promise<InboxMessage> {
        const db = await this.deps.getDb();
        const dao = new InboxDao(db);
        const original = await dao.get(id);
        if (original === null) throw new MessageNotFoundError(`No message found with id "${id}"`);

        const now = this.clock();
        const replyId = `msg_${crypto.randomUUID()}`;
        const message = await dao.insert(
            {
                id: replyId,
                fromId: from,
                toId: original.fromId,
                body,
                kind: original.kind,
                status: 'queued',
                requestKey: null,
                taskId: original.taskId,
                parentRunId: original.parentRunId,
                inReplyTo: original.id,
                threadId: original.threadId,
                createdAt: now,
                updatedAt: now,
            },
            this.eventFactory('message.replied'),
        );
        await this.pruneEvents(db);
        return message;
    }

    /** One message by id, or null. */
    async get(id: string): Promise<InboxMessage | null> {
        return new InboxDao(await this.deps.getDb()).get(id);
    }

    /** Claim up to `limit` queued messages for one member address (oldest first). */
    async claim(member: string, limit: number): Promise<InboxMessage[]> {
        const db = await this.deps.getDb();
        const claimed = await new InboxDao(db).claim(member, limit, this.clock(), this.eventFactory('message.claimed'));
        await this.pruneEvents(db);
        return claimed;
    }

    /** Settle claimed messages: `accepted` → delivered, `not-started` → failed. */
    async settle(ids: readonly string[], outcome: InboxSettleOutcome, error?: string): Promise<InboxMessage[]> {
        if (ids.length === 0) return [];
        const db = await this.deps.getDb();
        const settled = await new InboxDao(db).settle(
            ids,
            outcome === 'accepted' ? 'delivered' : 'failed',
            this.clock(),
            this.eventFactory(outcome === 'accepted' ? 'message.delivered' : 'message.failed'),
            outcome === 'accepted' ? null : (error ?? 'delivery did not start'),
        );
        await this.pruneEvents(db);
        return settled;
    }

    /** Return claimed messages to `queued` (guest retire, drain release). */
    async release(ids: readonly string[]): Promise<InboxMessage[]> {
        if (ids.length === 0) return [];
        const db = await this.deps.getDb();
        const released = await new InboxDao(db).release(ids, this.clock(), this.eventFactory('message.requeued'));
        await this.pruneEvents(db);
        return released;
    }

    /**
     * Reclaim expired claims (G11 R4). Each claimed row past its lease is resolved from its
     * newest run receipt: a completed run settles it (`delivered` for a verified or
     * run-exit-only outcome, `failed` for an errored one), a still-running run leaves it
     * claimed, and no receipt at all requeues it — or fails it once the attempt budget is
     * spent. A claimed row that already has a receipt is never requeued (0834 R2: ambiguous
     * work is never re-dispatched).
     */
    async sweep(now = this.clock()): Promise<InboxSweepResult> {
        const db = await this.deps.getDb();
        const dao = new InboxDao(db);
        const runs = new CoordinationRunDao(db);
        const cutoff = now - this.leaseMs;
        const result: InboxSweepResult = { requeued: [], failed: [], settled: [] };

        for (const message of await dao.listExpiredClaims(cutoff)) {
            const receipt = (await runs.listByMessageId(message.id))[0];
            if (receipt !== undefined) {
                if (receipt.status === 'running') continue;
                const delivered = receipt.outcome === 'verified' || receipt.outcome === 'run-exit-only';
                const settled = await dao.settle(
                    [message.id],
                    delivered ? 'delivered' : 'failed',
                    now,
                    this.eventFactory(delivered ? 'message.delivered' : 'message.failed'),
                    delivered ? null : `run ${receipt.run_id} ${receipt.status}`,
                );
                for (const row of settled) result.settled.push(row.id);
                continue;
            }
            if (message.attempts >= MAX_DELIVERY_ATTEMPTS) {
                const failed = await dao.settle(
                    [message.id],
                    'failed',
                    now,
                    this.eventFactory('message.failed'),
                    `attempts exhausted after ${MAX_DELIVERY_ATTEMPTS} deliveries`,
                );
                for (const row of failed) result.failed.push(row.id);
                continue;
            }
            const requeued = await dao.release([message.id], now, this.eventFactory('message.requeued'));
            for (const row of requeued) result.requeued.push(row.id);
        }

        await this.pruneEvents(db);
        return result;
    }

    /** Mark a message read by its recipient; only the first mark transitions (G11 R4). */
    async markRead(id: string, reader: string): Promise<InboxMarkReadResult> {
        const db = await this.deps.getDb();
        const receipt = await new InboxDao(db).markRead(id, reader, this.clock(), this.eventFactory('message.read'));
        if (receipt === null) throw new MessageNotFoundError(`message ${id} not found for ${reader}`);
        await this.pruneEvents(db);
        return { readAt: receipt.message.readAt ?? this.clock(), transitioned: receipt.transitioned };
    }

    /**
     * One address's messages by direction, newest first, keyset-paged (G11 R1's cursor).
     * `cursor` is a previous page's `nextCursor`; `nextCursor` is null on the last page.
     */
    async list(
        member: string,
        direction: InboxDirection = 'in',
        page?: { limit?: number; cursor?: string },
    ): Promise<{ messages: InboxMessage[]; nextCursor: string | null }> {
        const dao = new InboxDao(await this.deps.getDb());
        const limit = page?.limit ?? 100;
        const before = page?.cursor === undefined ? undefined : decodeCursor(page.cursor);
        const rows = await dao.list(member, direction, limit, before);
        const messages = rows.slice(0, limit);
        const last = messages.at(-1);
        return {
            messages,
            nextCursor: rows.length > limit && last !== undefined ? encodeCursor(last) : null,
        };
    }

    /** Every message in one thread, oldest first (root plus replies). */
    async thread(id: string): Promise<InboxMessage[]> {
        const dao = new InboxDao(await this.deps.getDb());
        const root = await dao.get(id);
        return dao.thread(root?.threadId ?? id);
    }

    /** Request rows for one member (or every address when omitted), each with its newest run receipt. */
    async requests(member?: string) {
        return new InboxDao(await this.deps.getDb()).requests(member === undefined ? undefined : [member]);
    }

    /** Queued (undelivered) message count for one address. */
    async countQueued(member: string): Promise<number> {
        return new InboxDao(await this.deps.getDb()).countQueued(member);
    }

    /** Every address that owns inbox rows, with queued and unread counts (Board member list). */
    async members(): Promise<InboxMemberCounts[]> {
        return new InboxDao(await this.deps.getDb()).distinctRecipients();
    }

    /** Dispatch attempts for one task id, read from its column (never a request-key parse). */
    async attempts(taskId: string): Promise<InboxTaskAttempts> {
        return new InboxDao(await this.deps.getDb()).attemptsForTask(taskId);
    }

    /** Every dispatch attempt row for one task id, newest first (E2E evidence reads). */
    async taskAttempts(taskId: string): Promise<InboxMessage[]> {
        return new InboxDao(await this.deps.getDb()).listByTask(taskId);
    }

    /**
     * The newest messages across every address with their reply counts.
     *
     * `shortcut:` backs the pre-contract Board message list; task 1269 replaces it with the
     * member-scoped contract read plus SSE. Delete it there instead of extending it.
     */
    async recent(limit = 50): Promise<{ messages: InboxMessage[]; replyCounts: Map<string, number> }> {
        const dao = new InboxDao(await this.deps.getDb());
        const messages = await dao.listRecent(limit);
        const replyCounts = await dao.countReplies(messages.map((row) => row.id));
        return { messages, replyCounts };
    }

    /** Event factory for one catalog name: the DAO supplies the changed row, this supplies the payload. */
    private eventFactory(name: MessageEventName): InboxEventFactory {
        return (row) => ({
            id: `sev_${crypto.randomUUID()}`,
            event_name: name,
            occurred_at: new Date(row.updatedAt).toISOString(),
            // The member owns its inbox: a claim/settle/requeue is ITS action, not the sender's.
            // A send or reply is the sender's action; a read is the reader's.
            actor:
                name === 'message.read' ||
                name === 'message.claimed' ||
                name === 'message.delivered' ||
                name === 'message.failed' ||
                name === 'message.requeued'
                    ? row.toId
                    : row.fromId,
            payload_json: JSON.stringify({
                msgId: row.id,
                fromId: row.fromId,
                toId: row.toId,
                threadId: row.threadId,
                status: row.status,
                createdAt: new Date(row.createdAt).toISOString(),
            } satisfies MessageEventData & { status: string }),
        });
    }

    /**
     * Bound the `message` prefix after a committed mutation. Retention is best-effort:
     * a prune failure must never surface as a failed send/claim/settle.
     */
    private async pruneEvents(db: DbAdapter): Promise<void> {
        try {
            const quotas = ensureRetentionQuotaForPrefix(
                resolveRetentionQuotas(),
                'message',
                DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA,
            );
            await new SystemEventDao(db).pruneQuotas(quotas, 'message');
        } catch {
            // Ledger retention is housekeeping; the committed mutation stands.
        }
    }
}

/** The catalog names this service is the only producer of (G11 R7). */
export type MessageEventName =
    | 'message.sent'
    | 'message.replied'
    | 'message.claimed'
    | 'message.delivered'
    | 'message.failed'
    | 'message.requeued'
    | 'message.read';
