import { expect, test } from 'bun:test';
import {
    appendHostPause,
    HOST_PAUSES_KEY,
    hostDurationMs,
    hostPauseMsByNode,
    isDegenerateReceiptInterval,
    openPauseMs,
    readHostPauses,
    resolveStallThresholdMs,
    STALL_THRESHOLD_MS_DEFAULT,
    STALL_THRESHOLD_MS_ENV,
    stalledLabel,
} from '../../src/workflow/host-pause';

// 1319 R7/R8: a host-executor pause was previously invisible — the action row says 2 ms while the
// operator waited hours. These cover the pure record/measure/label helpers.

const pause = {
    node: 'implement',
    action: 'agent.run',
    pausedAt: '2026-11-07T05:57:37.000Z',
    resumedAt: '2026-11-07T16:08:52.000Z',
    hostDurationMs: 36_675_000,
};

test('appendHostPause appends without mutating and readHostPauses tolerates junk', () => {
    const metadata = { [HOST_PAUSES_KEY]: [pause] };
    const next = appendHostPause(metadata, { ...pause, node: 'review', hostDurationMs: 1_000 });

    expect(readHostPauses(metadata)).toHaveLength(1);
    expect(next.map((p) => p.node)).toEqual(['implement', 'review']);
    // Malformed entries and non-object metadata never throw.
    expect(readHostPauses(null)).toEqual([]);
    expect(readHostPauses({ [HOST_PAUSES_KEY]: 'nope' })).toEqual([]);
    expect(readHostPauses({ [HOST_PAUSES_KEY]: [{ node: 'x' }, 7, null] })).toEqual([]);
});

test('hostPauseMsByNode totals per node', () => {
    const totals = hostPauseMsByNode([pause, { ...pause, hostDurationMs: 1_000 }, { ...pause, node: 'gate' }]);

    expect(totals.get('implement')).toBe(36_676_000);
    expect(totals.get('gate')).toBe(36_675_000);
});

test('hostDurationMs rejects an inverted or unparsable interval', () => {
    expect(hostDurationMs('2026-11-07T00:00:00.000Z', '2026-11-07T00:00:30.000Z')).toBe(30_000);
    expect(hostDurationMs('2026-11-07T00:00:30.000Z', '2026-11-07T00:00:00.000Z')).toBeNull();
    expect(hostDurationMs('not-a-date', '2026-11-07T00:00:00.000Z')).toBeNull();
});

test('a degenerate receipt interval is detected, a valid one is kept', () => {
    // The observed host shape: startedAt and finishedAt are the same instant.
    expect(isDegenerateReceiptInterval('2026-11-07T06:00:00.000Z', '2026-11-07T06:00:00.000Z')).toBe(true);
    expect(isDegenerateReceiptInterval('2026-11-07T06:00:00.000Z', undefined)).toBe(true);
    expect(isDegenerateReceiptInterval(undefined, '2026-11-07T06:00:00.000Z')).toBe(true);
    expect(isDegenerateReceiptInterval('2026-11-07T06:00:10.000Z', '2026-11-07T06:00:00.000Z')).toBe(true);
    expect(isDegenerateReceiptInterval('2026-11-07T06:00:00.000Z', '2026-11-07T06:00:10.000Z')).toBe(false);
});

test('the stall budget prefers the node budget, then env, then the default', () => {
    const readEnv = (vars: Record<string, string>) => (name: string) => vars[name];

    expect(resolveStallThresholdMs(60_000, readEnv({}))).toBe(60_000);
    expect(resolveStallThresholdMs(undefined, readEnv({ [STALL_THRESHOLD_MS_ENV]: '42000' }))).toBe(42_000);
    expect(resolveStallThresholdMs(undefined, readEnv({ [STALL_THRESHOLD_MS_ENV]: 'nope' }))).toBe(
        STALL_THRESHOLD_MS_DEFAULT,
    );
    expect(resolveStallThresholdMs(undefined, readEnv({}))).toBe(STALL_THRESHOLD_MS_DEFAULT);
});

test('an open pause ages from its start and a stalled run carries the resume hint', () => {
    const nowMs = Date.parse('2026-11-07T18:08:52.000Z');

    expect(openPauseMs('2026-11-07T16:08:52.000Z', nowMs)).toBe(7_200_000);
    expect(openPauseMs(null, nowMs)).toBeNull();
    expect(stalledLabel('run-1', 7_200_000)).toBe('stalled — paused 7200s; resume: spur workflow continue run-1');
});
