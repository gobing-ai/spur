import { oc } from '@orpc/contract';
import { z } from 'zod';

/**
 * Inbox message plane DTOs (G11 R9, ADR-143 §13).
 *
 * Transport shapes only — the domain `InboxMessage` never crosses this boundary. `kind`
 * separates conversational traffic from dispatch requests, and `status` is the guarded
 * ladder a member walks: queued → claimed → delivered | failed, with requeue.
 */
/** Conversational vs dispatch traffic. Only `request` rows enter receipt reconciliation. */
export const INBOX_MESSAGE_KINDS = ['chat', 'request'] as const;
/** The guarded delivery ladder: queued → claimed → delivered | failed, with requeue. */
export const INBOX_MESSAGE_STATUSES = ['queued', 'claimed', 'delivered', 'failed'] as const;

/** One inbox message as the API returns it. */
export const inboxMessageSchema = z.object({
    id: z.string(),
    /** Sender address: a member id, `operator` (the human) or `spur` (the system). */
    fromId: z.string(),
    /** Recipient address — one inbox per fleet member; never a process, run or generation id. */
    toId: z.string(),
    body: z.string(),
    kind: z.enum(INBOX_MESSAGE_KINDS),
    status: z.enum(INBOX_MESSAGE_STATUSES),
    attempts: z.number().int().nonnegative(),
    error: z.string().nullable(),
    claimedAt: z.number().int().nullable(),
    deliveredAt: z.number().int().nullable(),
    readAt: z.number().int().nullable(),
    inReplyTo: z.string().nullable(),
    /** Root message id; a reply carries the root's id. */
    threadId: z.string(),
    requestKey: z.string().nullable(),
    taskId: z.string().nullable(),
    parentRunId: z.string().nullable(),
    createdAt: z.number().int(),
});

/** One address that owns inbox rows, with its queue and unread counts (the member list). */
export const inboxMemberSchema = z.object({
    id: z.string(),
    queued: z.number().int().nonnegative(),
    unread: z.number().int().nonnegative(),
});

/**
 * One request row with its delivery classification — the durable result feed behind the
 * operator's global input. `reason` and `hold` are named states from the reconciler and the
 * strategy, never free text invented here.
 */
export const inboxRequestSchema = z.object({
    messageId: z.string(),
    requestKey: z.string().nullable(),
    status: z.enum(INBOX_MESSAGE_STATUSES),
    attempts: z.number().int().nonnegative(),
    error: z.string().nullable(),
    runId: z.string().nullable(),
    runStatus: z.string().nullable().optional(),
    taskId: z.string().nullable(),
    outcome: z.string().nullable(),
    reason: z.string().nullable(),
    hold: z.string().nullable(),
});

const inboxListInputSchema = z.object({
    member: z.string().min(1),
    direction: z.enum(['in', 'out', 'both']).optional(),
    limit: z.number().int().positive().max(500).optional(),
    /**
     * Keyset cursor: the `nextCursor` of the previous page. Absent = the newest page. A cursor is
     * stable under concurrent inserts, which an offset is not — a row written between two pages
     * would otherwise shift the window and duplicate an entry.
     */
    cursor: z.string().optional(),
});

/** One page of an inbox list plus the cursor for the next (absent on the last page). */
export const inboxListResponseSchema = z.object({
    messages: z.array(inboxMessageSchema),
    nextCursor: z.string().nullable(),
});

const inboxThreadInputSchema = z.object({
    /** Message id whose thread root is read. */
    id: z.string().min(1),
});

const inboxSendInputSchema = z.object({
    /**
     * Recipient. Omitted = the project's orchestrator member. `operator` and `spur` are valid
     * addresses (they own an inbox each) but are refused as agent ids elsewhere.
     */
    to: z.string().min(1).optional(),
    /** Sender. Omitted = `operator`: the human driving the CLI or the Board's global input. */
    from: z.string().min(1).optional(),
    body: z.string().min(1),
    kind: z.enum(INBOX_MESSAGE_KINDS).optional(),
    requestKey: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    parentRunId: z.string().min(1).optional(),
    /**
     * 0844 R4 project guard: a value that differs from the server's project is a CONFLICT
     * before any row is written.
     */
    projectPath: z.string().optional(),
});

const inboxSendResponseSchema = z.object({
    message: inboxMessageSchema,
    /** True when the request key already named this message — no second row was written. */
    replayed: z.boolean(),
});

const inboxReplyInputSchema = z.object({
    id: z.string().min(1),
    from: z.string().min(1),
    body: z.string().min(1),
});

const inboxReadInputSchema = z.object({
    id: z.string().min(1),
    reader: z.string().min(1),
});

const inboxReadResponseSchema = z.object({
    /** Epoch ms of the read stamp (the first mark's stamp on a repeat). */
    readAt: z.number().int(),
    /** False when the message was already read — no second event was written. */
    transitioned: z.boolean(),
});

const inboxRequestsInputSchema = z.object({
    limit: z.number().int().positive().max(200).optional(),
    /** Exact receipt for a sent message, including chat and non-orchestrator recipients. */
    messageId: z.string().min(1).optional(),
});

/** The `inbox` procedure set: reads are side-effect free, mutations name their actor. */
export const inboxContract = {
    list: oc
        .route({
            method: 'GET',
            path: '/inbox/messages',
            summary: 'List one inbox address messages',
            tags: ['inbox'],
        })
        .input(inboxListInputSchema)
        .output(inboxListResponseSchema),

    thread: oc
        .route({
            method: 'GET',
            path: '/inbox/messages/{id}/thread',
            summary: 'Read one message thread (root plus replies, oldest first)',
            tags: ['inbox'],
        })
        .input(inboxThreadInputSchema)
        .output(z.array(inboxMessageSchema)),

    send: oc
        .route({
            method: 'POST',
            path: '/inbox/messages',
            summary: 'Send a message to a member inbox',
            tags: ['inbox'],
        })
        .input(inboxSendInputSchema)
        .output(inboxSendResponseSchema),

    reply: oc
        .route({
            method: 'POST',
            path: '/inbox/messages/{id}/reply',
            summary: 'Reply in a thread, addressed to the original sender',
            tags: ['inbox'],
        })
        .input(inboxReplyInputSchema)
        .output(inboxMessageSchema),

    read: oc
        .route({
            method: 'POST',
            path: '/inbox/messages/{id}/read',
            summary: 'Mark a message read by its recipient',
            tags: ['inbox'],
        })
        .input(inboxReadInputSchema)
        .output(inboxReadResponseSchema),

    requests: oc
        .route({
            method: 'GET',
            path: '/inbox/requests',
            summary: 'List request results with delivery classification',
            tags: ['inbox'],
        })
        .input(inboxRequestsInputSchema)
        .output(z.array(inboxRequestSchema)),

    members: oc
        .route({
            method: 'GET',
            path: '/inbox/members',
            summary: 'List inbox addresses with queued and unread counts',
            tags: ['inbox'],
        })
        // Declared explicitly even though it takes no parameters: every procedure in this
        // namespace states its input, so a client cannot tell two of them apart by shape alone.
        .input(z.object({}))
        .output(z.array(inboxMemberSchema)),
};
