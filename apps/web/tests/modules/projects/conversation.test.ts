import { describe, expect, test } from 'bun:test';
import {
    buildRecentMessagesThread,
    buildThread,
    decodeRequestEnvelope,
    encodeRequestEnvelope,
    type InboxMessage,
    OPERATOR_AGENT_ID,
    parseInboxMessages,
    REQUEST_ENVELOPE_PREFIX,
    sameRef,
} from '../../../src/modules/projects/conversation';

function msg(over: Partial<InboxMessage> & { id: string }): InboxMessage {
    return {
        fromId: null,
        toId: 'orchestrator-1',
        body: 'body',
        status: 'queued',
        createdAt: '2026-10-04T00:00:00Z',
        inReplyTo: null,
        ...over,
    };
}

describe('conversation entry model (G63)', () => {
    test('the operator mailbox id satisfies the engine agent-id shape and is not a fleet member', () => {
        expect(OPERATOR_AGENT_ID).toMatch(/^[a-z][a-z0-9_-]{1,63}$/);
    });

    test('sameRef compares identity within a kind and never across kinds', () => {
        expect(sameRef({ kind: 'task', wbs: '0042' }, { kind: 'task', wbs: '0042' })).toBe(true);
        expect(sameRef({ kind: 'task', wbs: '0042' }, { kind: 'task', wbs: '0043' })).toBe(false);
        expect(sameRef({ kind: 'feature', id: 'E72' }, { kind: 'feature', id: 'E72' })).toBe(true);
        expect(sameRef({ kind: 'feature', id: 'E72' }, { kind: 'feature', id: 'E71' })).toBe(false);
        expect(sameRef({ kind: 'task', wbs: '0042' }, { kind: 'feature', id: '0042' })).toBe(false);
    });

    test('a plain request stays plain text, so spur message sees exactly the operator text', () => {
        expect(encodeRequestEnvelope('fix the gate', [])).toBe('fix the gate');
    });

    test('encoding is deterministic: a fixed ref field order, prefix line, blank line, verbatim text', () => {
        const encoded = encodeRequestEnvelope('please review', [
            { kind: 'feature', id: 'E72' },
            { kind: 'task', wbs: '1069' },
        ]);
        expect(encoded).toBe(
            `${REQUEST_ENVELOPE_PREFIX}{"refs":[{"kind":"feature","id":"E72"},{"kind":"task","wbs":"1069"}]}\n\nplease review`,
        );
        expect(decodeRequestEnvelope(encoded)).toEqual({
            text: 'please review',
            refs: [
                { kind: 'feature', id: 'E72' },
                { kind: 'task', wbs: '1069' },
            ],
        });
    });

    test('round trip preserves multi-line text after the envelope', () => {
        const encoded = encodeRequestEnvelope('line one\nline two', [{ kind: 'task', wbs: '1069' }]);
        expect(decodeRequestEnvelope(encoded)).toEqual({
            text: 'line one\nline two',
            refs: [{ kind: 'task', wbs: '1069' }],
        });
    });

    test('a body without the prefix is whole prose with no refs', () => {
        expect(decodeRequestEnvelope('unrelated traffic')).toEqual({ text: 'unrelated traffic', refs: [] });
    });

    test('an envelope with no blank line yields empty text instead of dropping the message', () => {
        expect(decodeRequestEnvelope(`${REQUEST_ENVELOPE_PREFIX}{"refs":[]}`)).toEqual({ text: '', refs: [] });
    });

    test('every malformed envelope degrades to the whole body as prose', () => {
        const truncated = `${REQUEST_ENVELOPE_PREFIX}{"refs":[`;
        expect(decodeRequestEnvelope(truncated)).toEqual({ text: truncated, refs: [] });
        const scalar = `${REQUEST_ENVELOPE_PREFIX}null\n\nhi`;
        expect(decodeRequestEnvelope(scalar)).toEqual({ text: scalar, refs: [] });
        const array = `${REQUEST_ENVELOPE_PREFIX}[]\n\nhi`;
        expect(decodeRequestEnvelope(array)).toEqual({ text: array, refs: [] });
        const notArray = `${REQUEST_ENVELOPE_PREFIX}{"refs":"nope"}\n\nhi`;
        expect(decodeRequestEnvelope(notArray)).toEqual({ text: notArray, refs: [] });
    });

    test('unusable ref entries are filtered, the usable ones survive', () => {
        const body = `${REQUEST_ENVELOPE_PREFIX}${JSON.stringify({
            refs: [
                { kind: 'task', wbs: '1069' },
                { kind: 'task' },
                { kind: 'other', id: 'x' },
                { kind: 'feature', id: '' },
                null,
                { kind: 'feature', id: 'E72' },
            ],
        })}\n\nhi`;
        expect(decodeRequestEnvelope(body)).toEqual({
            text: 'hi',
            refs: [
                { kind: 'task', wbs: '1069' },
                { kind: 'feature', id: 'E72' },
            ],
        });
    });

    test('parseInboxMessages tolerates every malformed response shape and normalizes optional keys', () => {
        expect(parseInboxMessages(null)).toEqual([]);
        expect(parseInboxMessages('nope')).toEqual([]);
        expect(parseInboxMessages({})).toEqual([]);
        expect(parseInboxMessages({ messages: 'nope' })).toEqual([]);

        const parsed = parseInboxMessages({
            messages: [
                { id: 'm1', toId: 'r1', body: 'b1', status: 'queued', createdAt: 't1' },
                {
                    id: 'm2',
                    fromId: 'agent-1',
                    toId: 'r1',
                    body: 'b2',
                    status: 'delivered',
                    createdAt: 't2',
                    inReplyTo: 'm1',
                },
                { id: 7, toId: 'r1', body: 'b', status: 'queued', createdAt: 't' },
                { id: 'm3', toId: 'r1', body: 'b', status: 'queued', createdAt: 12 },
                'garbage',
                null,
            ],
        });
        expect(parsed).toEqual([
            { id: 'm1', fromId: null, toId: 'r1', body: 'b1', status: 'queued', createdAt: 't1', inReplyTo: null },
            {
                id: 'm2',
                fromId: 'agent-1',
                toId: 'r1',
                body: 'b2',
                status: 'delivered',
                createdAt: 't2',
                inReplyTo: 'm1',
            },
        ]);
    });

    test('buildThread keeps only operator-authored requests, then sorts both sides ascending by time and id', () => {
        const thread = buildThread(
            [
                msg({ id: 'r2', fromId: OPERATOR_AGENT_ID, body: 'second request', createdAt: '2026-10-04T02:00:00Z' }),
                msg({ id: 'r1', fromId: OPERATOR_AGENT_ID, body: 'first request', createdAt: '2026-10-04T01:00:00Z' }),
                msg({
                    id: 'internal',
                    fromId: 'agent-9',
                    body: 'orchestrator-internal',
                    createdAt: '2026-10-04T00:30:00Z',
                }),
            ],
            [
                msg({
                    id: 'a2',
                    status: 'delivered',
                    body: 'reply',
                    createdAt: '2026-10-04T03:00:00Z',
                    inReplyTo: 'r2',
                }),
                msg({ id: 'a1', body: 'earlier reply', createdAt: '2026-10-04T01:30:00Z' }),
            ],
        );

        expect(thread.map((e) => e.id)).toEqual(['r1', 'a1', 'r2', 'a2']);
        expect(thread.every((e) => e.text !== 'orchestrator-internal')).toBe(true);
        expect(thread.map((e) => e.kind)).toEqual(['request', 'response', 'request', 'response']);
        expect(thread[3]).toMatchObject({
            deliveryStatus: 'delivered',
            inReplyTo: 'r2',
            toId: 'orchestrator-1',
        });
    });

    test('an unlinked response renders at its timestamp instead of being hidden', () => {
        const thread = buildThread([], [msg({ id: 'a1', body: 'orphan', createdAt: '2026-10-04T03:00:00Z' })]);
        expect(thread).toHaveLength(1);
        expect(thread[0]).toMatchObject({ id: 'a1', kind: 'response', inReplyTo: null });
    });

    test('equal timestamps tie-break by id so refresh order is stable', () => {
        const at = '2026-10-04T01:00:00Z';
        const thread = buildThread([], [msg({ id: 'b', createdAt: at }), msg({ id: 'a', createdAt: at })]);
        expect(thread.map((e) => e.id)).toEqual(['a', 'b']);
    });

    test('buildRecentMessagesThread classifies operator, terminal and user senders as requests', () => {
        const thread = buildRecentMessagesThread([
            msg({ id: 'm1', fromId: 'terminal', createdAt: '2026-10-04T01:00:00Z' }),
            msg({ id: 'm2', fromId: 'user', createdAt: '2026-10-04T02:00:00Z' }),
            msg({ id: 'm3', fromId: 'operator', createdAt: '2026-10-04T03:00:00Z' }),
            msg({ id: 'm4', fromId: OPERATOR_AGENT_ID, createdAt: '2026-10-04T04:00:00Z' }),
            msg({ id: 'm5', fromId: 'agent-1', createdAt: '2026-10-04T05:00:00Z' }),
            msg({ id: 'm6', fromId: null, createdAt: '2026-10-04T06:00:00Z' }),
        ]);
        expect(thread.map((e) => `${e.id}:${e.kind}`)).toEqual([
            'm1:request',
            'm2:request',
            'm3:request',
            'm4:request',
            'm5:response',
            'm6:response',
        ]);
    });

    test('the thread decodes each row envelope into text plus refs, keeping the raw status verbatim', () => {
        const body = encodeRequestEnvelope('linked ask', [{ kind: 'task', wbs: '1069' }]);
        const thread = buildRecentMessagesThread([msg({ id: 'm1', fromId: 'operator', body, status: 'held' })]);
        expect(thread[0]).toMatchObject({
            text: 'linked ask',
            refs: [{ kind: 'task', wbs: '1069' }],
            deliveryStatus: 'held',
        });
    });
});

describe('buildRecentMessagesThread (0844)', () => {
    test('operator, terminal, user and board-operator senders are requests; everyone else is a response', () => {
        const thread = buildRecentMessagesThread([
            msg({ id: 'a', fromId: OPERATOR_AGENT_ID, createdAt: '2026-09-12T10:00:00.000Z' }),
            msg({ id: 'b', fromId: 'terminal', createdAt: '2026-09-12T10:01:00.000Z' }),
            msg({ id: 'c', fromId: 'user', createdAt: '2026-09-12T10:02:00.000Z' }),
            msg({ id: 'd', fromId: 'operator', createdAt: '2026-09-12T10:03:00.000Z' }),
            msg({ id: 'e', fromId: 'lead', createdAt: '2026-09-12T10:04:00.000Z' }),
            msg({ id: 'f', fromId: null, createdAt: '2026-09-12T10:05:00.000Z' }),
        ]);
        expect(thread.map((e) => [e.id, e.kind])).toEqual([
            ['a', 'request'],
            ['b', 'request'],
            ['c', 'request'],
            ['d', 'request'],
            ['e', 'response'],
            ['f', 'response'],
        ]);
    });

    test('sorts ascending by createdAt with an id tie-break, and decodes envelopes like buildThread', () => {
        const same = '2026-09-12T10:00:00.000Z';
        const thread = buildRecentMessagesThread([
            msg({ id: 'z', createdAt: same }),
            msg({ id: 'y', createdAt: same, body: encodeRequestEnvelope('run it', [{ kind: 'feature', id: 'G63' }]) }),
            msg({ id: 'older', createdAt: '2026-09-12T09:00:00.000Z' }),
        ]);
        expect(thread.map((e) => e.id)).toEqual(['older', 'y', 'z']);
        expect(thread.find((e) => e.id === 'y')?.text).toBe('run it');
        expect(thread.find((e) => e.id === 'y')?.refs).toEqual([{ kind: 'feature', id: 'G63' }]);
    });
});

describe('decodeRequestEnvelope line-ending and normalization edges (0841)', () => {
    test('CRLF separators decode like LF', () => {
        const body = `${REQUEST_ENVELOPE_PREFIX}{"refs":[{"kind":"task","wbs":"0841"}]}\r\n\r\nmulti\r\nline`;
        expect(decodeRequestEnvelope(body)).toEqual({
            text: 'multi\r\nline',
            refs: [{ kind: 'task', wbs: '0841' }],
        });
    });

    test('non-string fromId/inReplyTo normalize to null in parseInboxMessages', () => {
        const rows = parseInboxMessages({
            messages: [{ id: 'a', toId: 'b', body: 'c', status: 'queued', createdAt: 't', fromId: 7, inReplyTo: 9 }],
        });
        expect(rows).toEqual([
            { id: 'a', fromId: null, toId: 'b', body: 'c', status: 'queued', createdAt: 't', inReplyTo: null },
        ]);
    });
});
