/**
 * Conversation entry model for the Projects board (0841, feature G63).
 *
 * A Board request is an `inbox_messages` row addressed to the orchestrator
 * instance; an orchestrator response is a row addressed back to the operator
 * mailbox. Both arrive through `GET /api/messages/inbox` (non-consuming
 * `TeamService.getInbox`) — no new endpoint, no client-side message store (R6).
 * References travel INSIDE the body as a `SPUR-REQUEST/1` envelope line so
 * they survive wherever the body travels (R3); they are never parsed out of
 * prose. Submission itself is 0844's.
 */

/**
 * The operator's own mailbox identity. An address, not a fleet member — it
 * satisfies `validateAgentId`'s `/^[a-z][a-z0-9_-]{1,63}$/` with no engine
 * change and must never appear in a ResolvedFleet or the Agents roster.
 */
export const OPERATOR_AGENT_ID = 'board-operator';

/** An explicitly captured reference — a task by WBS id, or a feature by id. */
export type ConversationRef = { kind: 'task'; wbs: string } | { kind: 'feature'; id: string };

/** Which side of the thread the entry sits on. */
export type ConversationEntryKind = 'request' | 'response';

/** One rendered thread entry: an inbox row with its envelope decoded. */
export interface ConversationEntry {
    id: string; // inbox message id
    kind: ConversationEntryKind;
    fromId: string | null;
    toId: string;
    text: string; // human-readable body, envelope stripped
    refs: readonly ConversationRef[];
    createdAt: string; // ISO-8601
    inReplyTo: string | null;
    deliveryStatus: string; // the inbox row's own status, rendered verbatim
    requestKey?: string; // populated by 0844; absent here
    receipt?: unknown; // populated by 0844; opaque to this task
}

/** Envelope line prefix; refs travel as JSON on this line (docs/design/project-switcher.md §7). */
export const REQUEST_ENVELOPE_PREFIX = 'SPUR-REQUEST/1 ';

/** Structural equality for refs — kind plus its identity field (addRef dedupe). */
export function sameRef(a: ConversationRef, b: ConversationRef): boolean {
    if (a.kind === 'task' && b.kind === 'task') return a.wbs === b.wbs;
    if (a.kind === 'feature' && b.kind === 'feature') return a.id === b.id;
    return false;
}

/**
 * Emit the deterministic envelope for a request with refs. A plain request
 * (no refs) stays a plain message — no prefix line — so `spur message` output
 * and the member detail's message pane see exactly the operator's text.
 */
export function encodeRequestEnvelope(text: string, refs: readonly ConversationRef[]): string {
    if (refs.length === 0) return text;
    return `${REQUEST_ENVELOPE_PREFIX}${JSON.stringify({ refs: refs.map(canonicalRef) })}\n\n${text}`;
}

/** Refs are serialized with their fields in a fixed order so the envelope is deterministic. */
function canonicalRef(ref: ConversationRef): ConversationRef {
    return ref.kind === 'task' ? { kind: 'task', wbs: ref.wbs } : { kind: 'feature', id: ref.id };
}

function isConversationRef(value: unknown): value is ConversationRef {
    if (value === null || typeof value !== 'object') return false;
    const r = value as Record<string, unknown>;
    if (r.kind === 'task') return typeof r.wbs === 'string' && r.wbs.length > 0;
    if (r.kind === 'feature') return typeof r.id === 'string' && r.id.length > 0;
    return false;
}

/**
 * Split a message body into its human text and structured refs. The envelope
 * is the prefix line, a blank line, then the text verbatim. Any parse failure —
 * truncated JSON, non-JSON payload, wrong shape — degrades to the WHOLE body
 * as `text` with `refs: []` (a malformed envelope is prose, never a dropped
 * message).
 */
export function decodeRequestEnvelope(body: string): { text: string; refs: ConversationRef[] } {
    if (!body.startsWith(REQUEST_ENVELOPE_PREFIX)) return { text: body, refs: [] };
    const rest = body.slice(REQUEST_ENVELOPE_PREFIX.length);
    const m = /\r?\n\r?\n/.exec(rest);
    const headerLine = m === null ? rest : rest.slice(0, m.index);
    const text = m === null ? '' : rest.slice(m.index + m[0].length);
    let parsed: unknown;
    try {
        parsed = JSON.parse(headerLine);
    } catch {
        return { text: body, refs: [] };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { text: body, refs: [] };
    const refs = (parsed as { refs?: unknown }).refs;
    if (!Array.isArray(refs)) return { text: body, refs: [] };
    return { text, refs: refs.filter(isConversationRef) };
}

/** One `inbox_messages` row as `GET /api/messages/inbox` projects it (ADR-021 inline mirror). */
export interface InboxMessage {
    id: string;
    fromId: string | null;
    toId: string;
    body: string;
    status: string;
    createdAt: string;
    inReplyTo: string | null;
}

/** Runtime-narrow an inbox response; malformed rows are skipped, never thrown. */
export function parseInboxMessages(body: unknown): InboxMessage[] {
    if (body === null || typeof body !== 'object' || !('messages' in body)) return [];
    const raw = (body as { messages: unknown }).messages;
    if (!Array.isArray(raw)) return [];
    const out: InboxMessage[] = [];
    for (const entry of raw) {
        if (entry === null || typeof entry !== 'object') continue;
        const r = entry as Record<string, unknown>;
        if (typeof r.id !== 'string' || typeof r.toId !== 'string' || typeof r.body !== 'string') continue;
        if (typeof r.status !== 'string' || typeof r.createdAt !== 'string') continue;
        out.push({
            id: r.id,
            fromId: typeof r.fromId === 'string' ? r.fromId : null,
            toId: r.toId,
            body: r.body,
            status: r.status,
            createdAt: r.createdAt,
            inReplyTo: typeof r.inReplyTo === 'string' ? r.inReplyTo : null,
        });
    }
    return out;
}

/**
 * Rebuild the request/response thread from the two non-consuming inbox reads.
 *
 * 1. requests — rows the operator sent TO the orchestrator (`fromId` is the
 *    operator mailbox; anything else in that inbox is orchestrator-internal
 *    traffic and is not part of the human thread).
 * 2. responses — every row in the operator's own inbox.
 * 3. Sorted ascending by `createdAt`, tie-broken by id, so refresh order is
 *    stable. An unlinked response renders at its timestamp, never hidden.
 */
export function buildThread(toOrchestrator: InboxMessage[], toOperator: InboxMessage[]): ConversationEntry[] {
    const requests = toOrchestrator.filter((m) => m.fromId === OPERATOR_AGENT_ID).map((m) => toEntry(m, 'request'));
    const responses = toOperator.map((m) => toEntry(m, 'response'));
    return [...requests, ...responses].sort((a, b) =>
        a.createdAt === b.createdAt ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.createdAt < b.createdAt ? -1 : 1,
    );
}

function toEntry(m: InboxMessage, kind: ConversationEntryKind): ConversationEntry {
    const decoded = decodeRequestEnvelope(m.body);
    return {
        id: m.id,
        kind,
        fromId: m.fromId,
        toId: m.toId,
        text: decoded.text,
        refs: decoded.refs,
        createdAt: m.createdAt,
        inReplyTo: m.inReplyTo,
        deliveryStatus: m.status,
    };
}
