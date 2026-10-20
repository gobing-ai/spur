import { BaseDao, type DbAdapter } from '@gobing-ai/ts-db';
import { type CreateSystemEventInput, systemEventInsertSql } from './system-event-dao';

/** `chat` is conversational; only `request` rows enter receipt reconciliation (ADR-143). */
export type InboxMessageKind = 'chat' | 'request';

/** The guarded transition ladder: `queued` → `claimed` → `delivered` | `failed`, with requeue. */
export type InboxMessageStatus = 'queued' | 'claimed' | 'delivered' | 'failed';

/**
 * One inbox message (G11, ADR-143 §13). A fleet member is addressed by
 * `<project-slug>-<member-id>`; `operator` is the human and `spur` is the system.
 * `to_id`/`from_id` never hold a process, run or generation id, so a respawned
 * process drains the same inbox.
 */
export interface InboxMessage {
    id: string;
    fromId: string;
    toId: string;
    body: string;
    kind: InboxMessageKind;
    status: InboxMessageStatus;
    claimedAt: number | null;
    attempts: number;
    error: string | null;
    deliveredAt: number | null;
    readAt: number | null;
    inReplyTo: string | null;
    /** Root message id; a root row names itself so a thread read needs no second query. */
    threadId: string;
    requestKey: string | null;
    taskId: string | null;
    parentRunId: string | null;
    createdAt: number;
    updatedAt: number;
}

/** A request row plus its newest run receipt — the single join request reconciliation reads. */
export interface InboxRequestRow extends InboxMessage {
    runId: string | null;
    runStatus: string | null;
    runOutcome: string | null;
    runTaskId: string | null;
    runArtifactRefsJson: string | null;
}

/** Input for {@link InboxDao.insert}; the service mints the id and thread root. */
export interface NewInboxMessage {
    id: string;
    fromId: string;
    toId: string;
    body: string;
    kind: InboxMessageKind;
    status: InboxMessageStatus;
    requestKey: string | null;
    taskId: string | null;
    parentRunId: string | null;
    inReplyTo: string | null;
    threadId: string;
    createdAt: number;
    updatedAt: number;
}

/** Per-address inbox counts backing the member list (`members()`). */
export interface InboxMemberCounts {
    id: string;
    queued: number;
    unread: number;
}

/** Outcome of a guarded `markRead`: `transitioned` is false on a repeat mark. */
export interface InboxReadReceipt {
    message: InboxMessage;
    transitioned: boolean;
}

/** Derived attempt history for one dispatched task. */
export interface InboxTaskAttempts {
    count: number;
    latest: InboxMessage | null;
}

/**
 * The arrow of a transition that must write one `system_events` row per changed message.
 * The DAO owns the statement; the service owns the event payload.
 */
export type InboxEventFactory = (row: InboxMessage) => CreateSystemEventInput;

interface InboxRow {
    id: string;
    from_id: string;
    to_id: string;
    body: string;
    kind: string;
    status: string;
    claimed_at: number | null;
    attempts: number;
    error: string | null;
    delivered_at: number | null;
    read_at: number | null;
    in_reply_to: string | null;
    thread_id: string;
    request_key: string | null;
    task_id: string | null;
    parent_run_id: string | null;
    created_at: number;
    updated_at: number;
}

interface InboxRequestDbRow extends InboxRow {
    run_id: string | null;
    run_status: string | null;
    run_outcome: string | null;
    run_task_id: string | null;
    run_artifact_refs_json: string | null;
}

const COLUMNS = `id, from_id, to_id, body, kind, status, claimed_at, attempts, error, delivered_at,
                 read_at, in_reply_to, thread_id, request_key, task_id, parent_run_id, created_at, updated_at`;

function toMessage(row: InboxRow): InboxMessage {
    return {
        id: row.id,
        fromId: row.from_id,
        toId: row.to_id,
        body: row.body,
        kind: row.kind === 'request' ? 'request' : 'chat',
        status: row.status as InboxMessageStatus,
        claimedAt: row.claimed_at,
        attempts: row.attempts,
        error: row.error,
        deliveredAt: row.delivered_at,
        readAt: row.read_at,
        inReplyTo: row.in_reply_to,
        threadId: row.thread_id,
        requestKey: row.request_key,
        taskId: row.task_id,
        parentRunId: row.parent_run_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

/**
 * Per-adapter transaction lock.
 *
 * The inbox runs on a single-connection Bun SQLite adapter, and two service instances over the
 * SAME connection (two consumers in one process) can interleave `BEGIN IMMEDIATE` — the second
 * call then fails with "cannot start a transaction within a transaction". Chaining on the adapter
 * serializes the transactions without changing their semantics: each still commits or rolls back
 * as a unit, and the guarded `RETURNING` statements keep their own atomicity.
 */
const transactionLocks = new WeakMap<DbAdapter, Promise<unknown>>();

/**
 * The only module that names `inbox_messages` (G11 R2, ADR-143). Every read and write of
 * the inbox plane lives here; `InboxService` is the only caller.
 *
 * Each mutation writes its row change and one `system_events` row per changed message in
 * ONE transaction, so a failed event insert rolls the row change back. `RETURNING` is what
 * makes the event set exactly the changed set: a guarded transition that matches no row
 * emits nothing.
 */
export class InboxDao extends BaseDao {
    constructor(adapter: DbAdapter) {
        super(adapter);
    }

    /**
     * Run `fn` inside one interactive transaction.
     *
     * `shortcut:` an interactive transaction needs a single-connection adapter, which is the
     * Bun SQLite path the inbox runs on (ADR-143). A D1 target would have to compose
     * `DbAdapter.batch` instead; upgrade when the inbox plane leaves Bun.
     */
    private async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
        const previous = transactionLocks.get(this.adapter) ?? Promise.resolve();
        const run = previous.then(async () => {
            await this.adapter.exec('BEGIN IMMEDIATE');
            try {
                const result = await fn();
                await this.adapter.exec('COMMIT');
                return result;
            } catch (error) {
                await this.adapter.exec('ROLLBACK');
                throw error;
            }
        });
        // The chain must not stay rejected for the NEXT waiter; the caller still sees the error.
        transactionLocks.set(
            this.adapter,
            run.then(
                () => undefined,
                () => undefined,
            ),
        );
        return run;
    }

    /** Write the event rows for `changed` inside the open transaction. */
    private async writeEvents(toEvent: InboxEventFactory, changed: readonly InboxMessage[]): Promise<void> {
        for (const row of changed) {
            const statement = systemEventInsertSql(toEvent(row));
            await this.adapter.run(statement.sql, ...statement.params);
        }
    }

    /**
     * Insert one message and its event atomically.
     *
     * A repeated `request_key` violates the partial unique index and throws — the service
     * turns that into a replay, so the constraint stays the arbiter of concurrent sends.
     */
    async insert(input: NewInboxMessage, toEvent: InboxEventFactory): Promise<InboxMessage> {
        return this.withTransaction(async () => {
            const [row] = await this.adapter.queryAll<InboxRow>(
                `INSERT INTO inbox_messages (${COLUMNS})
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 0, NULL, NULL, NULL, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                 RETURNING ${COLUMNS}`,
                input.id,
                input.fromId,
                input.toId,
                input.body,
                input.kind,
                input.status,
                input.inReplyTo,
                input.threadId,
                input.requestKey,
                input.taskId,
                input.parentRunId,
                input.createdAt,
                input.updatedAt,
            );
            if (row === undefined) throw new Error(`inbox insert returned no row for ${input.id}`);
            const message = toMessage(row);
            await this.writeEvents(toEvent, [message]);
            return message;
        });
    }

    /** The stored row for an idempotency key, or null. */
    async findByRequestKey(requestKey: string): Promise<InboxMessage | null> {
        const [row] = await this.adapter.queryAll<InboxRow>(
            `SELECT ${COLUMNS} FROM inbox_messages WHERE request_key = ?1`,
            requestKey,
        );
        return row === undefined ? null : toMessage(row);
    }

    /** One message by id, or null. */
    async get(id: string): Promise<InboxMessage | null> {
        const [row] = await this.adapter.queryAll<InboxRow>(`SELECT ${COLUMNS} FROM inbox_messages WHERE id = ?1`, id);
        return row === undefined ? null : toMessage(row);
    }

    /**
     * Claim up to `limit` queued messages for one address: oldest first, `attempts`
     * incremented and the lease stamped on the claimed rows. Guarded on `status = 'queued'`,
     * so a second claim returns only what is still unclaimed.
     */
    async claim(member: string, limit: number, now: number, toEvent: InboxEventFactory): Promise<InboxMessage[]> {
        return this.withTransaction(async () => {
            const rows = await this.adapter.queryAll<InboxRow>(
                `UPDATE inbox_messages
                 SET status = 'claimed', claimed_at = ?2, attempts = attempts + 1, updated_at = ?2
                 WHERE id IN (
                     SELECT id FROM inbox_messages
                     WHERE to_id = ?1 AND status = 'queued'
                     ORDER BY created_at ASC, rowid ASC
                     LIMIT ?3
                 )
                 RETURNING ${COLUMNS}`,
                member,
                now,
                Math.max(0, limit),
            );
            const changed = rows.map(toMessage);
            await this.writeEvents(toEvent, changed);
            return changed;
        });
    }

    /**
     * Settle claimed messages as `delivered` or `failed`. Guarded on `status = 'claimed'`:
     * a late settle after a requeue or delivery changes nothing and emits nothing.
     * `delivered_at` is stamped only for a delivered row — a failure has no delivery time.
     */
    async settle(
        ids: readonly string[],
        to: 'delivered' | 'failed',
        now: number,
        toEvent: InboxEventFactory,
        error: string | null = null,
    ): Promise<InboxMessage[]> {
        if (ids.length === 0) return [];
        return this.withTransaction(async () => {
            const rows = await this.adapter.queryAll<InboxRow>(
                `UPDATE inbox_messages
                 SET status = ?1, error = ?2,
                     delivered_at = CASE WHEN ?1 = 'delivered' THEN ?3 ELSE NULL END,
                     updated_at = ?3
                 WHERE id IN (${placeholders(ids, 4)}) AND status = 'claimed'
                 RETURNING ${COLUMNS}`,
                to,
                error,
                now,
                ...ids,
            );
            const changed = rows.map(toMessage);
            await this.writeEvents(toEvent, changed);
            return changed;
        });
    }

    /** Release claimed messages back to `queued`. Guarded on `status = 'claimed'`. */
    async release(ids: readonly string[], now: number, toEvent: InboxEventFactory): Promise<InboxMessage[]> {
        if (ids.length === 0) return [];
        return this.withTransaction(async () => {
            const rows = await this.adapter.queryAll<InboxRow>(
                `UPDATE inbox_messages
                 SET status = 'queued', claimed_at = NULL, updated_at = ?1
                 WHERE id IN (${placeholders(ids, 2)}) AND status = 'claimed'
                 RETURNING ${COLUMNS}`,
                now,
                ...ids,
            );
            const changed = rows.map(toMessage);
            await this.writeEvents(toEvent, changed);
            return changed;
        });
    }

    /**
     * Stamp `read_at` for the recipient. Only the first mark transitions (`read_at IS NULL`)
     * and writes an event; a repeat returns the stored stamp untouched.
     */
    async markRead(
        id: string,
        reader: string,
        now: number,
        toEvent: InboxEventFactory,
    ): Promise<InboxReadReceipt | null> {
        return this.withTransaction(async () => {
            const [stamped] = await this.adapter.queryAll<InboxRow>(
                `UPDATE inbox_messages SET read_at = ?3, updated_at = ?3
                 WHERE id = ?1 AND to_id = ?2 AND read_at IS NULL
                 RETURNING ${COLUMNS}`,
                id,
                reader,
                now,
            );
            if (stamped !== undefined) {
                const message = toMessage(stamped);
                await this.writeEvents(toEvent, [message]);
                return { message, transitioned: true };
            }
            const [existing] = await this.adapter.queryAll<InboxRow>(
                `SELECT ${COLUMNS} FROM inbox_messages WHERE id = ?1 AND to_id = ?2`,
                id,
                reader,
            );
            return existing === undefined ? null : { message: toMessage(existing), transitioned: false };
        });
    }

    /**
     * Claimed rows whose lease expired, oldest claim first. The sweeper decides each row's
     * fate from its run receipt — this read never requeues anything by itself (0834 R2).
     */
    async listExpiredClaims(cutoff: number): Promise<InboxMessage[]> {
        const rows = await this.adapter.queryAll<InboxRow>(
            `SELECT ${COLUMNS} FROM inbox_messages
             WHERE status = 'claimed' AND claimed_at IS NOT NULL AND claimed_at < ?1
             ORDER BY claimed_at ASC, rowid ASC`,
            cutoff,
        );
        return rows.map(toMessage);
    }

    /** One address's messages by direction, newest first. */
    async list(
        member: string,
        direction: 'in' | 'out' | 'both',
        limit: number,
        offset: number,
    ): Promise<InboxMessage[]> {
        const scope =
            direction === 'in' ? 'to_id = ?1' : direction === 'out' ? 'from_id = ?1' : '(to_id = ?1 OR from_id = ?1)';
        const rows = await this.adapter.queryAll<InboxRow>(
            `SELECT ${COLUMNS} FROM inbox_messages
             WHERE ${scope}
             ORDER BY created_at DESC, rowid DESC
             LIMIT ?2 OFFSET ?3`,
            member,
            Math.max(0, limit),
            Math.max(0, offset),
        );
        return rows.map(toMessage);
    }

    /** Every message in one thread, oldest first — the root plus its replies. */
    async thread(threadId: string): Promise<InboxMessage[]> {
        const rows = await this.adapter.queryAll<InboxRow>(
            `SELECT ${COLUMNS} FROM inbox_messages
             WHERE thread_id = ?1 OR id = ?1
             ORDER BY created_at ASC, rowid ASC`,
            threadId,
        );
        return rows.map(toMessage);
    }

    /**
     * Request rows, each with its newest run receipt in one LEFT JOIN.
     * `toIds` scopes to the given addresses; `undefined` scans every address (the CLI
     * reconciler pass). Only `kind = 'request'` rows are considered: a chat message is
     * never unresolved work.
     */
    async requests(toIds?: readonly string[]): Promise<InboxRequestRow[]> {
        if (toIds !== undefined && toIds.length === 0) return [];
        const scope =
            toIds === undefined
                ? `m.kind = 'request'`
                : `m.kind = 'request' AND m.to_id IN (${placeholders(toIds, 1)})`;
        const rows = await this.adapter.queryAll<InboxRequestDbRow>(
            `SELECT ${COLUMNS.split(',')
                .map((column) => `m.${column.trim()}`)
                .join(', ')},
                    r.run_id AS run_id, r.status AS run_status, r.outcome AS run_outcome,
                    r.task_id AS run_task_id, r.artifact_refs_json AS run_artifact_refs_json
             FROM inbox_messages m
             LEFT JOIN coordination_runs r ON r.run_id = (
                 SELECT c.run_id FROM coordination_runs c, json_each(c.message_ids_json) j
                 WHERE j.value = m.id
                 ORDER BY c.started_at DESC
                 LIMIT 1
             )
             WHERE ${scope}
             ORDER BY m.created_at DESC, m.rowid DESC`,
            ...(toIds ?? []),
        );
        return rows.map((row) => ({
            ...toMessage(row),
            runId: row.run_id ?? null,
            runStatus: row.run_status ?? null,
            runOutcome: row.run_outcome ?? null,
            runTaskId: row.run_task_id ?? null,
            runArtifactRefsJson: row.run_artifact_refs_json ?? null,
        }));
    }

    /** Queued (undelivered) message count for one address. */
    async countQueued(member: string): Promise<number> {
        const [row] = await this.adapter.queryAll<{ n: number }>(
            `SELECT COUNT(*) AS n FROM inbox_messages WHERE to_id = ?1 AND status = 'queued'`,
            member,
        );
        return row?.n ?? 0;
    }

    /** Every address that owns inbox rows, with its queued and unread counts (one grouped query). */
    async distinctRecipients(): Promise<InboxMemberCounts[]> {
        return this.adapter.queryAll<InboxMemberCounts>(
            `SELECT to_id AS id,
                    SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
                    SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread
             FROM inbox_messages
             GROUP BY to_id
             ORDER BY to_id ASC`,
        );
    }

    /** Dispatch attempts for one task id, newest first — `task_id` is a column, never parsed. */
    async attemptsForTask(taskId: string): Promise<InboxTaskAttempts> {
        const rows = await this.adapter.queryAll<InboxRow>(
            `SELECT ${COLUMNS} FROM inbox_messages
             WHERE task_id = ?1
             ORDER BY created_at DESC, rowid DESC`,
            taskId,
        );
        return { count: rows.length, latest: rows[0] === undefined ? null : toMessage(rows[0]) };
    }

    /** Every dispatch attempt row for one task id, newest first. */
    async listByTask(taskId: string): Promise<InboxMessage[]> {
        const rows = await this.adapter.queryAll<InboxRow>(
            `SELECT ${COLUMNS} FROM inbox_messages
             WHERE task_id = ?1
             ORDER BY created_at DESC, rowid DESC`,
            taskId,
        );
        return rows.map(toMessage);
    }

    /**
     * The newest messages across every address, newest first.
     *
     * `shortcut:` this cross-address feed backs the pre-contract Board message list; task 1269
     * replaces it with the member-scoped oRPC read plus SSE. Delete it there rather than
     * growing it.
     */
    async listRecent(limit: number): Promise<InboxMessage[]> {
        const rows = await this.adapter.queryAll<InboxRow>(
            `SELECT ${COLUMNS} FROM inbox_messages
             ORDER BY created_at DESC, rowid DESC
             LIMIT ?1`,
            Math.max(1, Math.min(limit, 500)),
        );
        return rows.map(toMessage);
    }

    /** Reply counts for the given parent ids; ids with no replies are absent from the map. */
    async countReplies(ids: readonly string[]): Promise<Map<string, number>> {
        const counts = new Map<string, number>();
        if (ids.length === 0) return counts;
        const rows = await this.adapter.queryAll<{ in_reply_to: string; n: number }>(
            `SELECT in_reply_to, COUNT(*) AS n FROM inbox_messages
             WHERE in_reply_to IN (${placeholders(ids, 1)})
             GROUP BY in_reply_to`,
            ...ids,
        );
        for (const row of rows) counts.set(row.in_reply_to, row.n);
        return counts;
    }
}

/** `?start, ?start+1, …` for `values.length` bind positions. */
function placeholders(values: readonly unknown[], start: number): string {
    return values.map((_, index) => `?${start + index}`).join(', ');
}
