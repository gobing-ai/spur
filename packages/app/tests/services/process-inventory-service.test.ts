import { describe, expect, test } from 'bun:test';
import type { OsProcessRow, ProcessInspector } from '../../src/services/process-inspector';
import { UnsupportedProcessPlatformError } from '../../src/services/process-inspector';
import { ProcessInventoryService } from '../../src/services/process-inventory-service';

function fixtureInspector(rows: OsProcessRow[]): ProcessInspector {
    return { listAll: async () => rows };
}

const TREE: OsProcessRow[] = [
    {
        pid: 1000,
        ppid: 1,
        rssBytes: 50_000_000,
        elapsedSeconds: 3600,
        command: '/opt/homebrew/bin/bun apps/cli/src/index.ts serve',
    },
    {
        pid: 1001,
        ppid: 1000,
        rssBytes: 20_000_000,
        elapsedSeconds: 120,
        command: 'bun run worker --agent planner',
    },
    {
        pid: 1002,
        ppid: 1000,
        rssBytes: 10_000_000,
        elapsedSeconds: 60,
        command: 'sleep 30',
    },
    {
        pid: 2000,
        ppid: 1,
        rssBytes: 1_000_000,
        elapsedSeconds: 10,
        command: 'unrelated',
    },
];

describe('ProcessInventoryService', () => {
    test('includes serve root and only its descendants (not host siblings)', async () => {
        const svc = new ProcessInventoryService({
            inspector: fixtureInspector(TREE),
            rootPid: 1000,
        });
        const snap = await svc.snapshot();
        expect(snap.rootPid).toBe(1000);
        expect(snap.processes.map((p) => p.pid)).toEqual([1000, 1001, 1002]);
        expect(snap.processes[0]).toMatchObject({
            source: 'serve',
            depth: 0,
            label: 'spur serve',
            status: 'running',
        });
        expect(snap.processes[1]?.depth).toBe(1);
        expect(snap.processes[2]?.source).toBe('descendant');
        expect(snap.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('overlays supervisor agent labels by pid', async () => {
        const svc = new ProcessInventoryService({
            inspector: fixtureInspector(TREE),
            rootPid: 1000,
            listSupervised: () => [
                {
                    agentId: 'planner',
                    pid: 1001,
                    status: 'running',
                    startedAt: '2026-07-12T00:00:00.000Z',
                },
            ],
        });
        const snap = await svc.snapshot();
        const planner = snap.processes.find((p) => p.pid === 1001);
        expect(planner).toMatchObject({
            source: 'supervisor',
            agentId: 'planner',
            label: 'planner',
            status: 'running',
            startedAt: '2026-07-12T00:00:00.000Z',
        });
    });

    test('synthesizes root when missing from OS table', async () => {
        const svc = new ProcessInventoryService({
            inspector: fixtureInspector([
                {
                    pid: 1001,
                    ppid: 1000,
                    rssBytes: 1000,
                    elapsedSeconds: 1,
                    command: 'child',
                },
            ]),
            rootPid: 1000,
        });
        const snap = await svc.snapshot();
        expect(snap.processes[0]?.pid).toBe(1000);
        expect(snap.processes[0]?.source).toBe('serve');
        expect(snap.processes.map((p) => p.pid)).toContain(1001);
    });

    test('truncates long commands', async () => {
        const long = `cmd ${'x'.repeat(300)}`;
        const svc = new ProcessInventoryService({
            inspector: fixtureInspector([
                {
                    pid: 5,
                    ppid: 0,
                    rssBytes: 1,
                    elapsedSeconds: null,
                    command: long,
                },
            ]),
            rootPid: 5,
            maxCommandLength: 40,
        });
        const snap = await svc.snapshot();
        expect(snap.processes[0]?.command.length).toBeLessThanOrEqual(40);
        expect(snap.processes[0]?.command.endsWith('…')).toBe(true);
    });

    test('does not throw on a non-finite or out-of-range elapsed (bad `ps` etime) — startedAt null', async () => {
        // Regression: a NaN/huge elapsedSeconds slips past the `!= null` guard and previously reached
        // `new Date(...).toISOString()`, throwing `RangeError: Invalid Date` and crashing the whole
        // snapshot on CI Linux (where `ps` runs; the sandbox masks it locally via `ps` EPERM).
        for (const elapsedSeconds of [Number.NaN, Number.POSITIVE_INFINITY, 1e18]) {
            const svc = new ProcessInventoryService({
                inspector: fixtureInspector([{ pid: 7, ppid: 0, rssBytes: 1, elapsedSeconds, command: 'x' }]),
                rootPid: 7,
            });
            const snap = await svc.snapshot();
            expect(snap.processes[0]?.startedAt).toBeNull();
        }
    });

    test('propagates unsupported platform errors', async () => {
        const svc = new ProcessInventoryService({
            inspector: {
                listAll: async () => {
                    throw new UnsupportedProcessPlatformError('win32');
                },
            },
            rootPid: 1,
        });
        await expect(svc.snapshot()).rejects.toBeInstanceOf(UnsupportedProcessPlatformError);
    });
});
