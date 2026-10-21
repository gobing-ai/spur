/**
 * G11 1268 — the `message` noun's shared helpers.
 *
 * These three carry behaviour the verbs depend on but cannot show end-to-end cheaply: argument
 * parsing, the plain-text row shape, and the widening that folds a reconciler hold onto a row.
 */
import { describe, expect, test } from 'bun:test';
import { formatInboxLine, parseInterval, parseTimeout, widenInboxRow } from '../../../src/commands/message/shared';

describe('message shared helpers', () => {
    test('parseInterval accepts a positive integer and rejects everything else', () => {
        expect(parseInterval('250')).toBe(250);
        for (const bad of ['0', '-1', 'abc', '']) expect(parseInterval(bad)).toBeNull();
    });

    test('parseTimeout defaults to undefined and rejects non-positive values', () => {
        expect(parseTimeout(undefined)).toBeUndefined();
        expect(parseTimeout('1000')).toBe(1000);
        for (const bad of ['0', '-5', 'soon']) expect(() => parseTimeout(bad)).toThrow();
    });

    test('formatInboxLine is tab-separated with an ISO timestamp and a truncated body', () => {
        const long = 'x'.repeat(80);
        const line = formatInboxLine({
            id: 'msg_1',
            fromId: 'operator',
            toId: 'proj-coder',
            body: long,
            kind: 'chat',
            status: 'queued',
            attempts: 0,
            error: null,
            claimedAt: null,
            deliveredAt: null,
            readAt: null,
            inReplyTo: null,
            threadId: 'msg_1',
            requestKey: null,
            taskId: null,
            parentRunId: null,
            createdAt: 0,
            updatedAt: 0,
        });
        const cells = line.split('\t');
        expect(cells[0]).toBe('msg_1');
        expect(cells[1]).toBe('queued');
        expect(cells[3]).toHaveLength(60);
        expect(cells[4]).toBe('1970-01-01T00:00:00.000Z');
    });

    test('widenInboxRow folds the hold reason, run facts and artifacts onto the row', () => {
        const widened = widenInboxRow(
            {
                id: 'msg_2',
                fromId: 'spur',
                toId: 'proj-coder',
                body: 'work',
                kind: 'request',
                status: 'claimed',
                attempts: 2,
                error: 'boom',
                claimedAt: 1,
                deliveredAt: null,
                readAt: null,
                inReplyTo: null,
                threadId: 'msg_2',
                requestKey: 'fleet:task:1268:1',
                taskId: '1268',
                parentRunId: null,
                createdAt: 1,
                updatedAt: 1,
            },
            {
                messageId: 'msg_2',
                toId: 'proj-coder',
                reason: 'outcome-unknown',
                injectAttempts: 2,
                requestKey: null,
                runId: 'run-1',
                taskId: '1268',
                artifacts: [],
            },
        );
        expect(widened.injectAttempts).toBe(2);
        expect(widened.injectError).toBe('boom');
        expect(widened.reason).toBe('outcome-unknown');
        expect(widened.runId).toBe('run-1');
        expect(widened.taskId).toBe('1268');
    });
});
