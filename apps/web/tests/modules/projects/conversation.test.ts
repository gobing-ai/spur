import { describe, expect, test } from 'bun:test';

import {
    buildThread,
    decodeRequestEnvelope,
    encodeRequestEnvelope,
    type InboxMessage,
    OPERATOR_AGENT_ID,
    parseInboxMessages,
    REQUEST_ENVELOPE_PREFIX,
    sameRef,
} from '../../../src/modules/projects/conversation';

function msg(overrides: Partial<InboxMessage> = {}): InboxMessage {
    return {
        id: 'm1',
        fromId: OPERATOR_AGENT_ID,
        toId: 'lead',
        body: 'plain body',
        status: 'queued',
        createdAt: '2026-09-12T10:00:00.000Z',
        inReplyTo: null,
        ...overrides,
    };
}

describe('request envelope (0841 R3)', () => {
    test('no refs → plain text, no prefix emitted', () => {
        expect(encodeRequestEnvelope('hello', [])).toBe('hello');
    });

    test('refs travel as a deterministic prefix line + blank line + verbatim text', () => {
        const out = encodeRequestEnvelope('please run this', [
            { kind: 'task', wbs: '0844' },
            { kind: 'feature', id: 'G63' },
        ]);
        expect(out).toBe(
            `${REQUEST_ENVELOPE_PREFIX}{"refs":[{"kind":"task","wbs":"0844"},{"kind":"feature","id":"G63"}]}\n\nplease run this`,
        );
    });

    test('round-trip preserves refs and multiline text verbatim', () => {
        const text = 'line one\nline two\n\nwith a blank line inside';
        const refs = [{ kind: 'task', wbs: '0841' }] as const;
        const decoded = decodeRequestEnvelope(encodeRequestEnvelope(text, refs));
        expect(decoded).toEqual({ text, refs: [{ kind: 'task', wbs: '0841' }] });
    });

    test('body without the prefix decodes as prose', () => {
        expect(decodeRequestEnvelope('just words')).toEqual({ text: 'just words', refs: [] });
    });

    test('truncated or non-JSON prefix line degrades to the WHOLE body as text', () => {
        const truncated = `${REQUEST_ENVELOPE_PREFIX}{"refs":[{"kind":"task"`;
        expect(decodeRequestEnvelope(truncated)).toEqual({ text: truncated, refs: [] });
        const nonJson = `${REQUEST_ENVELOPE_PREFIX}not json at all\n\nbody`;
        expect(decodeRequestEnvelope(nonJson)).toEqual({ text: nonJson, refs: [] });
    });

    test('wrong-shape JSON (array, missing refs, non-array refs) degrades to prose', () => {
        for (const payload of ['[]', '{}', '{"refs":5}', 'null', '"str"']) {
            const body = `${REQUEST_ENVELOPE_PREFIX}${payload}\n\ntext`;
            expect(decodeRequestEnvelope(body)).toEqual({ text: body, refs: [] });
        }
    });

    test('junk items inside a valid refs array are dropped, valid ones kept', () => {
        const body = `${REQUEST_ENVELOPE_PREFIX}{"refs":[{"kind":"task","wbs":"0841"},{"kind":"nope"},{"wbs":"x"}]}\n\ntext`;
        expect(decodeRequestEnvelope(body)).toEqual({ text: 'text', refs: [{ kind: 'task', wbs: '0841' }] });
    });

    test('prefix line with valid JSON and no blank line yields empty text', () => {
        const body = `${REQUEST_ENVELOPE_PREFIX}{"refs":[]}`;
        expect(decodeRequestEnvelope(body)).toEqual({ text: '', refs: [] });
    });
});

describe('sameRef / parseInboxMessages (0841)', () => {
    test('sameRef matches on kind + identity field only', () => {
        expect(sameRef({ kind: 'task', wbs: '0841' }, { kind: 'task', wbs: '0841' })).toBe(true);
        expect(sameRef({ kind: 'task', wbs: '0841' }, { kind: 'task', wbs: '0844' })).toBe(false);
        expect(sameRef({ kind: 'task', wbs: '0841' }, { kind: 'feature', id: '0841' })).toBe(false);
        expect(sameRef({ kind: 'feature', id: 'G63' }, { kind: 'feature', id: 'G63' })).toBe(true);
    });

    test('parseInboxMessages keeps well-formed rows and skips malformed ones', () => {
        const raw = {
            messages: [
                msg(),
                { id: 'bad' },
                null,
                { ...msg(), id: 'm2', fromId: 'lead', inReplyTo: 'm1', status: 'injected' },
            ],
        };
        const rows = parseInboxMessages(raw);
        expect(rows).toHaveLength(2);
        expect(rows[1]).toEqual({
            id: 'm2',
            fromId: 'lead',
            toId: 'lead',
            body: 'plain body',
            status: 'injected',
            createdAt: '2026-09-12T10:00:00.000Z',
            inReplyTo: 'm1',
        });
        expect(parseInboxMessages({})).toEqual([]);
        expect(parseInboxMessages({ messages: 'nope' })).toEqual([]);
        expect(parseInboxMessages(null)).toEqual([]);
    });
});

describe('buildThread (0841 R1/R6)', () => {
    test('keeps only operator-sent rows as requests, all operator-inbox rows as responses', () => {
        const toOrchestrator = [
            msg({ id: 'r1', body: 'operator request' }),
            msg({ id: 'x1', fromId: 'other-agent', body: 'orchestrator-internal traffic' }),
        ];
        const toOperator = [
            msg({
                id: 'p1',
                fromId: 'lead',
                toId: OPERATOR_AGENT_ID,
                body: 'response',
                inReplyTo: 'r1',
                createdAt: '2026-09-12T10:00:01.000Z',
            }),
        ];
        const thread = buildThread(toOrchestrator, toOperator);
        expect(thread.map((e) => e.id)).toEqual(['r1', 'p1']);
        expect(thread[0]?.kind).toBe('request');
        expect(thread[1]?.kind).toBe('response');
    });

    test('sorts ascending by createdAt with id tie-break, so refresh order is stable', () => {
        const toOrchestrator = [
            msg({ id: 'b', createdAt: '2026-09-12T10:00:00.000Z' }),
            msg({ id: 'a', createdAt: '2026-09-12T10:00:00.000Z' }),
            msg({ id: 'z', createdAt: '2026-09-12T09:00:00.000Z' }),
        ];
        const thread = buildThread(toOrchestrator, []);
        expect(thread.map((e) => e.id)).toEqual(['z', 'a', 'b']);
    });

    test('decodes envelopes and renders deliveryStatus verbatim; unlinked response is kept', () => {
        const toOrchestrator = [
            msg({ id: 'r1', body: encodeRequestEnvelope('do the thing', [{ kind: 'task', wbs: '0844' }]) }),
        ];
        const toOperator = [
            msg({
                id: 'p1',
                fromId: 'lead',
                toId: OPERATOR_AGENT_ID,
                body: 'done',
                inReplyTo: 'r1',
                status: 'injected',
            }),
            msg({ id: 'p2', fromId: 'lead', toId: OPERATOR_AGENT_ID, body: 'notice', inReplyTo: 'missing-id' }),
        ];
        const thread = buildThread(toOrchestrator, toOperator);
        expect(thread.find((e) => e.id === 'r1')?.text).toBe('do the thing');
        expect(thread.find((e) => e.id === 'r1')?.refs).toEqual([{ kind: 'task', wbs: '0844' }]);
        expect(thread.find((e) => e.id === 'p1')?.deliveryStatus).toBe('injected');
        expect(thread.find((e) => e.id === 'p2')?.inReplyTo).toBe('missing-id');
        expect(thread).toHaveLength(3);
    });
});
