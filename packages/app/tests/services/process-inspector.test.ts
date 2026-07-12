import { describe, expect, test } from 'bun:test';
import {
    createPsProcessInspector,
    parseEtimeToSeconds,
    parsePsOutput,
    UnsupportedProcessPlatformError,
} from '../../src/services/process-inspector';

const MACOS_FIXTURE = `
  100   1  4321    01:02:03 /usr/local/bin/spur serve
  101 100  1200       05:30 bun run apps/cli/src/index.ts agent run
  102 100   800    1-02:03:04 sleep 999
`;

const LINUX_FIXTURE = `
    1       0    500  10:00:00 /sbin/init
  200       1   2048     12:34 /home/u/.local/bin/spur serve --port 8787
  201     200   1024      00:45 node worker.js --label agent:planner
`;

describe('parseEtimeToSeconds', () => {
    test('parses MM:SS, HH:MM:SS, and DD-HH:MM:SS', () => {
        expect(parseEtimeToSeconds('05:30')).toBe(5 * 60 + 30);
        expect(parseEtimeToSeconds('01:02:03')).toBe(3600 + 120 + 3);
        expect(parseEtimeToSeconds('1-02:03:04')).toBe(86_400 + 2 * 3600 + 3 * 60 + 4);
        expect(parseEtimeToSeconds('-')).toBeNull();
        expect(parseEtimeToSeconds('')).toBeNull();
    });
});

describe('parsePsOutput', () => {
    test('parses macOS-style rows and normalizes RSS to bytes', () => {
        const rows = parsePsOutput(MACOS_FIXTURE);
        expect(rows).toHaveLength(3);
        expect(rows[0]).toMatchObject({
            pid: 100,
            ppid: 1,
            rssBytes: 4321 * 1024,
            elapsedSeconds: 3600 + 120 + 3,
            command: '/usr/local/bin/spur serve',
        });
        expect(rows[1]?.command).toContain('agent run');
        expect(rows[2]?.elapsedSeconds).toBe(86_400 + 2 * 3600 + 3 * 60 + 4);
    });

    test('parses Linux-style indented rows and skips header', () => {
        const withHeader = `  PID  PPID    RSS     ELAPSED COMMAND\n${LINUX_FIXTURE}`;
        const rows = parsePsOutput(withHeader);
        expect(rows.map((r) => r.pid)).toEqual([1, 200, 201]);
        expect(rows[1]?.command).toContain('spur serve');
        expect(rows[2]?.ppid).toBe(200);
    });
});

describe('createPsProcessInspector', () => {
    test('unsupported platform throws UnsupportedProcessPlatformError', async () => {
        const inspector = createPsProcessInspector('win32', async () => '');
        await expect(inspector.listAll()).rejects.toBeInstanceOf(UnsupportedProcessPlatformError);
    });

    test('darwin inspector uses injected runner output', async () => {
        const inspector = createPsProcessInspector('darwin', async () => MACOS_FIXTURE);
        const rows = await inspector.listAll();
        expect(rows).toHaveLength(3);
        expect(rows[0]?.pid).toBe(100);
    });
});
