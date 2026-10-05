/**
 * Task 1076 R1 — the per-run durable stream, beside the module's rule-required test
 * (`require-corresponding-test`).
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentRunLog, DEFAULT_AGENT_RUN_LOG_MAX_BYTES } from '../../src/observability/agent-run-log';

const tempDirs: string[] = [];
function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'agent-run-log-'));
    tempDirs.push(dir);
    return dir;
}
function cleanup(): void {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

describe('AgentRunLog (1076 R1)', () => {
    test('appends ISO-stamped, stream-tagged frames to <runId>.md', () => {
        const dir = tempDir();
        try {
            const log = new AgentRunLog({ dir, runId: 'run-1' });
            log.writeHeader('spur agent run run-1 — pi');
            log.append('stdout', 'working', '2026-10-04T00:00:00.000Z');
            log.append('stderr', 'boom', '2026-10-04T00:00:01.000Z');
            log.close();
            const text = readFileSync(join(dir, 'run-1.md'), 'utf8');
            expect(text).toContain('spur agent run run-1');
            expect(text).toContain('[2026-10-04T00:00:00.000Z] stdout| working');
            expect(text).toContain('[2026-10-04T00:00:01.000Z] stderr| boom');
        } finally {
            cleanup();
        }
    });

    test('a configured secret never reaches disk', () => {
        const dir = tempDir();
        try {
            const log = new AgentRunLog({ dir, runId: 'run-2', secrets: ['super-secret-value'] });
            log.append('stdout', 'token=super-secret-value done');
            log.close();
            const text = readFileSync(join(dir, 'run-2.md'), 'utf8');
            expect(text).not.toContain('super-secret-value');
            expect(text).toContain('done');
        } finally {
            cleanup();
        }
    });

    test('the byte bound writes ONE visible truncation marker and then stops', () => {
        const dir = tempDir();
        try {
            const log = new AgentRunLog({ dir, runId: 'run-3', maxBytes: 200 });
            log.append('stdout', 'x'.repeat(150));
            log.append('stdout', 'y'.repeat(150)); // exceeds → marker, not the line
            log.append('stdout', 'z'.repeat(150));
            log.close();
            const text = readFileSync(join(dir, 'run-3.md'), 'utf8');
            expect(text).toContain('[truncated]');
            expect(text.match(/\[truncated\]/g)).toHaveLength(1);
            expect(text).not.toContain('zzz');
            expect(log.isTruncated).toBe(true);
        } finally {
            cleanup();
        }
    });

    test('an unwritable directory leaves the record inert — it never throws', () => {
        const log = new AgentRunLog({
            dir: '/proc/definitely/not/writable',
            runId: 'run-4',
        });
        expect(() => log.append('stdout', 'ignored')).not.toThrow();
        expect(() => log.close()).not.toThrow();
    });

    test('the default bound matches the workflow sink, and the record exposes its path', () => {
        expect(DEFAULT_AGENT_RUN_LOG_MAX_BYTES).toBe(1024 * 1024);
        // `path` is what a trace node reports as the run's stream.
        expect(new AgentRunLog({ dir: '/tmp/x', runId: 'run-9' }).path).toBe('/tmp/x/run-9.md');
    });
});
