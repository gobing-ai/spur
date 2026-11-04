/**
 * Task 1081 R4 — the guest Stop hook.
 *
 * The Plan's failure list: "the Stop hook blocks a non-joined session" — and, just as important,
 * that it never blocks twice in one continued turn and never throws.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    type GuestStopCli,
    guestForSession,
    readGuestRecords,
    runFleetGuestStop,
    runStopFromStdin,
    stopDecisionFor,
} from '../../scripts/hooks/fleet-guest-stop';

function makeProject(records: Array<{ id: string; sessionId?: string }>): string {
    const cwd = mkdtempSync(join(tmpdir(), 'spur-guest-stop-'));
    mkdirSync(join(cwd, '.spur', 'run', 'guests'), { recursive: true });
    for (const record of records) {
        writeFileSync(join(cwd, '.spur', 'run', 'guests', `${record.id}.json`), JSON.stringify(record));
    }
    return cwd;
}

/** The pull returns its accepted messages; a second inbox read would lose their ownership. */
function stubCli(pending: boolean, rows: unknown[] = []): GuestStopCli {
    return (args) => {
        if (args[0] === 'agent' && args[1] === 'wait') {
            expect(args).toContain('--json');
            return {
                status: pending ? 0 : 1,
                stdout: JSON.stringify({ id: 'reviewer-g1', pending: rows.length, messages: rows }),
            };
        }
        throw new Error('the hook must use the pulled messages without a second inbox read');
    };
}

describe('fleet-guest-stop hook (1081 R4)', () => {
    test('reads guest records and matches by session id', () => {
        const cwd = makeProject([
            { id: 'reviewer-g1', sessionId: 'sess-a' },
            { id: 'coder-g1', sessionId: 'sess-b' },
        ]);
        try {
            const records = readGuestRecords(cwd);
            expect(records.map((r) => r.id).sort()).toEqual(['coder-g1', 'reviewer-g1']);
            expect(guestForSession(records, 'sess-b')?.id).toBe('coder-g1');
            expect(guestForSession(records, 'sess-z')).toBeNull();
            expect(guestForSession(records, undefined)).toBeNull();
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test('a non-joined session never blocks, and makes no CLI call', () => {
        const cwd = makeProject([{ id: 'reviewer-g1', sessionId: 'sess-a' }]);
        try {
            const calls: string[][] = [];
            const cli: GuestStopCli = (args) => {
                calls.push([...args]);
                return { status: 0, stdout: '[]' };
            };
            expect(runFleetGuestStop({ session_id: 'someone-else' }, { cwd, cli })).toBeNull();
            expect(calls).toEqual([]);
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test('a joined session with pending work blocks with the messages in the reason', () => {
        const cwd = makeProject([{ id: 'reviewer-g1', sessionId: 'sess-a' }]);
        try {
            const line = runFleetGuestStop(
                { session_id: 'sess-a' },
                {
                    cwd,
                    cli: stubCli(true, [
                        { id: 'msg_1081', fromId: 'proj-lead', body: 'review 1081', status: 'delivered' },
                        { fromId: 'proj-lead', body: 'failed work', status: 'failed' },
                    ]),
                },
            );
            expect(line).not.toBeNull();
            const parsed = JSON.parse(line ?? '{}') as { decision: string; reason: string };
            expect(parsed.decision).toBe('block');
            expect(parsed.reason).toContain('proj-lead [msg_1081]: review 1081');
            expect(parsed.reason).not.toContain('failed work');
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test('current message objects, envelopes and legacy arrays share bounded delivery parsing', () => {
        const messages = [null, { body: 42 }, { id: 'm1', fromId: 'lead', body: 'review', status: 'queued' }];
        const current = stopDecisionFor('g', JSON.stringify({ messages, count: messages.length }));
        expect(current).not.toBeNull();
        expect(stopDecisionFor('g', JSON.stringify({ ok: true, data: { messages } }))).toBe(current);
        expect(stopDecisionFor('g', JSON.stringify(messages))).toBe(current);
        expect(stopDecisionFor('g', JSON.stringify({ messages }), 0)).toBeNull();
        expect(stopDecisionFor('g', JSON.stringify({ messages: [{ body: 'x', status: 'invalid' }] }))).toBeNull();
        expect(
            stopDecisionFor('g', JSON.stringify({ messages: [{ body: 'handled', status: 'delivered' }] })),
        ).toBeNull();
        const pulled = {
            pending: 2,
            messages: [
                { body: 'one', status: 'claimed' },
                { body: 'two', status: 'delivered' },
            ],
        };
        const reason = JSON.parse(stopDecisionFor('g', JSON.stringify(pulled), 1) ?? '{}').reason;
        expect(reason).toContain('one');
        expect(reason).toContain('two');
    });

    test('handed-off messages preserve trailing instructions and multiline bodies', () => {
        const body = `${'context '.repeat(30)}\nDo the final instruction too.\n  preserve indentation`;
        const line = stopDecisionFor(
            'g',
            JSON.stringify({ pending: 1, messages: [{ id: 'msg_long', body, status: 'claimed' }] }),
        );
        expect(JSON.parse(line ?? '{}').reason).toContain(body);
        const legacy = stopDecisionFor('g', JSON.stringify([{ id: 'msg_long', body, status: 'queued' }]));
        expect(JSON.parse(legacy ?? '{}').reason).toContain('spur message show msg_long --json');
    });

    test('a joined session with nothing queued stays silent', () => {
        const cwd = makeProject([{ id: 'reviewer-g1', sessionId: 'sess-a' }]);
        try {
            expect(runFleetGuestStop({ session_id: 'sess-a' }, { cwd, cli: stubCli(false) })).toBeNull();
            expect(runFleetGuestStop({ session_id: 'sess-a' }, { cwd, cli: stubCli(true, []) })).toBeNull();
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test('a turn the host already continued is never continued again (stop_hook_active)', () => {
        const cwd = makeProject([{ id: 'reviewer-g1', sessionId: 'sess-a' }]);
        try {
            const calls: string[][] = [];
            const cli: GuestStopCli = (args) => {
                calls.push([...args]);
                return { status: 0, stdout: '[{"from_id":"lead","body":"x","status":"queued"}]' };
            };
            expect(runFleetGuestStop({ session_id: 'sess-a', stop_hook_active: true }, { cwd, cli })).toBeNull();
            expect(calls).toEqual([]);
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test('malformed payloads, unreadable records and CLI failures all fail open', () => {
        expect(runStopFromStdin('not json')).toBeNull();
        expect(runStopFromStdin('')).toBeNull();
        expect(runFleetGuestStop({ session_id: 'sess-a' }, { cwd: '/nope/does/not/exist' })).toBeNull();
        const cwd = makeProject([{ id: 'reviewer-g1', sessionId: 'sess-a' }]);
        try {
            const failing: GuestStopCli = () => ({ status: null, stdout: '' });
            expect(runFleetGuestStop({ session_id: 'sess-a' }, { cwd, cli: failing })).toBeNull();
            // A body-less/garbage inbox payload yields no decision rather than a broken JSON line.
            expect(stopDecisionFor('g', 'not json')).toBeNull();
            expect(stopDecisionFor('g', '{}')).toBeNull();
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });
});
