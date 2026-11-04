/**
 * Task 1279 R2/R3 — exact process identity.
 *
 * Failure list this pins:
 *   - a reused PID passes for the same process        → `sameProcess` compares birth time
 *   - an executable with spaces is parsed as a prefix → `comm` is read from the right
 *   - a shell between CLI and agent hides the agent   → the ancestor walk keeps climbing
 *   - the walk runs to init/launchd                   → it stops at pid <= 1
 *   - a missing process throws instead of returning   → `read` yields null
 */
import { describe, expect, test } from 'bun:test';
import {
    AGENT_ANCESTOR_MAX_HOPS,
    findAgentAncestor,
    type ProcessIdentity,
    type ProcessIdentityReader,
    parseProcessIdentity,
    sameProcess,
} from '../../src/index';

/** Build a reader over a fixed process table; unknown pids read as gone. */
function tableReader(table: Record<number, Omit<ProcessIdentity, 'pid'>>): ProcessIdentityReader {
    return {
        read: async (pid) => (table[pid] === undefined ? null : { pid, ...table[pid] }),
    };
}

describe('parseProcessIdentity (1279 R2)', () => {
    test('reads ppid, the five-token lstart and a comm that may contain spaces', () => {
        const row = '    1 Wed Oct 22 09:39:27 2026 /Applications/My Agent.app/claude\n';
        expect(parseProcessIdentity(row, 4242)).toEqual({
            pid: 4242,
            startedAt: 'Wed Oct 22 09:39:27 2026',
            executable: '/Applications/My Agent.app/claude',
            parentPid: 1,
        });
    });

    test('an absent row, a header-only row and a truncated row are all null, never a throw', () => {
        expect(parseProcessIdentity('', 1)).toBeNull();
        expect(parseProcessIdentity('\n  \n', 1)).toBeNull();
        expect(parseProcessIdentity('  1 Wed Oct 22 09:39:27 2026\n', 1)).toBeNull();
    });
});

describe('sameProcess (1279 R3 — PID reuse cannot transfer identity)', () => {
    const recorded = { pid: 99, startedAt: 'Wed Oct 22 09:39:27 2026' };

    test('a live process with the same birth time is the same process', () => {
        expect(sameProcess(recorded, { ...recorded, executable: '/usr/bin/claude', parentPid: 1 })).toBe(true);
    });

    test('a reused pid carries a different birth time and is not the same process', () => {
        expect(
            sameProcess(recorded, { ...recorded, startedAt: 'Wed Oct 22 10:02:00 2026', executable: '', parentPid: 1 }),
        ).toBe(false);
    });

    test('a dead process (no row) is never the same process', () => {
        expect(sameProcess(recorded, null)).toBe(false);
    });
});

describe('findAgentAncestor (1279 R2)', () => {
    test('climbs past an intermediate shell to the agent that launched it', async () => {
        const reader = tableReader({
            700: { startedAt: 'Wed Oct 22 09:00:00 2026', executable: '/bin/zsh', parentPid: 800 },
            800: { startedAt: 'Wed Oct 22 08:59:00 2026', executable: '/usr/local/bin/claude', parentPid: 1 },
        });
        const found = await findAgentAncestor(700, reader);
        expect(found?.pid).toBe(800);
        expect(found?.executable).toBe('/usr/local/bin/claude');
    });

    test('honours an explicit executor filter — another agent further up is not the match', async () => {
        const reader = tableReader({
            700: { startedAt: 'a', executable: '/bin/zsh', parentPid: 800 },
            800: { startedAt: 'b', executable: '/usr/local/bin/claude', parentPid: 900 },
            900: { startedAt: 'c', executable: '/usr/local/bin/codex', parentPid: 1 },
        });
        expect((await findAgentAncestor(700, reader, { executors: ['codex'] }))?.pid).toBe(900);
        expect(await findAgentAncestor(700, reader, { executors: ['pi'] })).toBeNull();
    });

    test('stops at launchd instead of walking the whole table', async () => {
        const reader = tableReader({
            700: { startedAt: 'a', executable: '/bin/zsh', parentPid: 1 },
            1: { startedAt: 'b', executable: '/sbin/launchd', parentPid: 0 },
        });
        expect(await findAgentAncestor(700, reader)).toBeNull();
    });

    test('the hop budget bounds a pathological chain', async () => {
        const table: Record<number, Omit<ProcessIdentity, 'pid'>> = {};
        for (let pid = 100; pid < 200; pid++) {
            table[pid] = { startedAt: String(pid), executable: '/bin/zsh', parentPid: pid + 1 };
        }
        let reads = 0;
        const counting: ProcessIdentityReader = {
            read: async (pid) => {
                reads += 1;
                return table[pid] === undefined ? null : { pid, ...table[pid] };
            },
        };
        expect(await findAgentAncestor(100, counting)).toBeNull();
        expect(reads).toBe(AGENT_ANCESTOR_MAX_HOPS);
    });
});
