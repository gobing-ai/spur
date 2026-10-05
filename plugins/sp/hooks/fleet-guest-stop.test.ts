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
} from './fleet-guest-stop';

function makeProject(records: Array<{ id: string; sessionId?: string }>): string {
    const cwd = mkdtempSync(join(tmpdir(), 'spur-guest-stop-'));
    mkdirSync(join(cwd, '.spur', 'run', 'guests'), { recursive: true });
    for (const record of records) {
        writeFileSync(join(cwd, '.spur', 'run', 'guests', `${record.id}.json`), JSON.stringify(record));
    }
    return cwd;
}

/** A `spur` stub: `wait --inbox` succeeds when `pending`, `message inbox` returns the given rows. */
function stubCli(pending: boolean, rows: unknown[] = []): GuestStopCli {
    return (args) => {
        if (args[0] === 'agent' && args[1] === 'wait') return { status: pending ? 0 : 1, stdout: '' };
        if (args[0] === 'message') return { status: 0, stdout: JSON.stringify(rows) };
        return { status: 1, stdout: '' };
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
                        { from_id: 'proj-lead', body: 'review 1081', status: 'queued' },
                        { from_id: 'proj-lead', body: 'already handled', status: 'delivered' },
                    ]),
                },
            );
            expect(line).not.toBeNull();
            const parsed = JSON.parse(line ?? '{}') as { decision: string; reason: string };
            expect(parsed.decision).toBe('block');
            expect(parsed.reason).toContain('proj-lead: review 1081');
            expect(parsed.reason).not.toContain('already handled');
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
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
