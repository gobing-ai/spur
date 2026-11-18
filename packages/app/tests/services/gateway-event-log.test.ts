import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { createJsonlEventSink, GATEWAY_EVENT_LOG_MAX_BYTES } from '../../src/services/gateway-event-log';

const fs = createNodeFileSystem();

/** Drain the sink's fire-and-forget async IO: one macrotask clears every pending microtask. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function tempDir(): string {
    return mkdtempSync(join(tmpdir(), 'gateway-events-'));
}

function lines(path: string): string[] {
    return readFileSync(path, 'utf-8')
        .trimEnd()
        .split('\n')
        .filter((line) => line !== '');
}

describe('createJsonlEventSink (1384 R2)', () => {
    it('appends one valid JSON line per event', async () => {
        const dir = tempDir();
        try {
            const path = join(dir, 'gateway.events.jsonl');
            const sink = createJsonlEventSink({ path, fs });
            sink({ ts: 'T1', kind: 'guard.host', path: '/x' });
            sink({ ts: 'T2', kind: 'guard.csrf', path: '/y' });
            await flush();
            const written = lines(path);
            expect(written).toHaveLength(2);
            expect(JSON.parse(written[0] ?? '{}')).toMatchObject({ kind: 'guard.host' });
            expect(JSON.parse(written[1] ?? '{}')).toMatchObject({ kind: 'guard.csrf' });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('creates missing parent directories', async () => {
        // serve composes ~/.config/spur/logs or ~/Library/Logs/spur, neither guaranteed to exist.
        const dir = tempDir();
        try {
            const path = join(dir, 'nested/logs/gateway.events.jsonl');
            createJsonlEventSink({ path, fs })({ ts: 'T', kind: 'upstream.restart' });
            await flush();
            expect(JSON.parse(readFileSync(path, 'utf-8'))).toMatchObject({ kind: 'upstream.restart' });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('rotates to <path>.1 when the next line would cross maxBytes, overwriting any earlier .1', async () => {
        const dir = tempDir();
        try {
            const path = join(dir, 'gateway.events.jsonl');
            const sink = createJsonlEventSink({ path, maxBytes: 80, fs });
            for (let n = 0; n < 12; n++) {
                sink({ ts: 'T', kind: 'upstream.ensure', outcome: 'ok', ms: 1000 + n });
            }
            await flush();
            expect(existsSync(`${path}.1`)).toBe(true);
            // The active file stays under the cap and holds only whole JSON lines.
            expect(statSync(path).size).toBeLessThanOrEqual(80);
            for (const line of lines(path)) expect(() => JSON.parse(line)).not.toThrow();
            // The rolled file holds the earlier lines, also whole.
            expect(lines(`${path}.1`).length).toBeGreaterThan(0);
            for (const line of lines(`${path}.1`)) expect(() => JSON.parse(line)).not.toThrow();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('defaults the cap to 5 MiB', () => {
        expect(GATEWAY_EVENT_LOG_MAX_BYTES).toBe(5 * 1024 * 1024);
    });

    it('a failing fs never throws: report once on stderr, then drop', async () => {
        const stderr = createBufferTarget();
        const restore = setDefaultOutputTargets({ stderr });
        try {
            const failing = {
                stat: () => null,
                rename: () => {},
                ensureDir: () => {},
                appendFile: () => {
                    throw new Error('disk gone');
                },
            } as unknown as FileSystem;
            const sink = createJsonlEventSink({ path: '/tmp/unused.jsonl', fs: failing });
            sink({ ts: 'T', kind: 'guard.host' });
            sink({ ts: 'T', kind: 'guard.csrf' });
            await flush();
            expect(stderr.text().match(/event log write failed/g)).toHaveLength(1);
            expect(stderr.text()).toContain('disk gone');
        } finally {
            restore();
        }
    });
});
