import { describe, expect, test } from 'bun:test';
import { readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageSourceError } from '@gobing-ai/spur-app';
import { CodexbarUsageSource, defaultAgentUsageSnapshotPath } from '../../src/services/agent-usage-source';

// 0892 R5 + boundary remediation: CLI-layer capture source. Pins identity,
// default location, buffered capture over the ProcessExecutor seam, and the
// structured launch error.
describe('CodexbarUsageSource', () => {
    test('labels snapshots as codexbar with the default argv', () => {
        const source = new CodexbarUsageSource();
        expect(source.name).toBe('codexbar');
    });

    test('custom argv is accepted for test injection', () => {
        const source = new CodexbarUsageSource(['echo', 'hi']);
        expect(source.name).toBe('codexbar');
    });
});

describe('defaultAgentUsageSnapshotPath', () => {
    test('sits beside the global config layer under the user HOME', () => {
        expect(defaultAgentUsageSnapshotPath()).toBe(`${homedir()}/.config/spur/agent-usage.json`);
    });

    // 0893 R2: injected-env override — bun's homedir() ignores HOME at runtime,
    // so tests/sandboxes pin the snapshot location through the env seam.
    test('honors the SPUR_AGENT_USAGE_SNAPSHOT override from the injected env', () => {
        expect(defaultAgentUsageSnapshotPath({ SPUR_AGENT_USAGE_SNAPSHOT: '/tmp/pinned.json' })).toBe(
            '/tmp/pinned.json',
        );
    });

    test('ignores an empty override and falls back to the HOME sibling', () => {
        expect(defaultAgentUsageSnapshotPath({ SPUR_AGENT_USAGE_SNAPSHOT: '' })).toBe(
            `${homedir()}/.config/spur/agent-usage.json`,
        );
    });
});

describe('CodexbarUsageSource.capture', () => {
    test('returns buffered stdout/exit for a successful capture', async () => {
        const source = new CodexbarUsageSource(['echo', '{}']);
        const capture = await source.capture();
        expect(capture.exitCode).toBe(0);
        expect(capture.stdout.trim()).toBe('{}');
    });

    test('passes through non-zero exits (codexbar exits 1 when any provider fails)', async () => {
        const source = new CodexbarUsageSource(['sh', '-c', 'echo "[]"; exit 1']);
        const capture = await source.capture();
        expect(capture.exitCode).toBe(1);
        expect(capture.stdout.trim()).toBe('[]');
    });

    test('fail-closed: unusable launch (missing binary) raises UsageSourceError', async () => {
        const source = new CodexbarUsageSource(['spur-codexbar-not-a-real-binary-0892']);
        try {
            await source.capture();
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(UsageSourceError);
            expect((error as UsageSourceError).message).toContain('capture is unusable (fail-closed)');
        }
    });

    // 0908 R4/AC1-AC2: bounded termination — the child writes valid JSON and
    // then hangs; the injected deadline terminates it via runtime-owned group
    // containment and the outcome surfaces as a fail-closed timeout error.
    test('fail-closed: hanging capture hits the deadline and the child is reaped', async () => {
        const pidFile = join(tmpdir(), `spur-0908-hang-${process.pid}-${Date.now()}`);
        // The child records its own pid, prints valid JSON, then hangs forever.
        const script =
            `const{writeFileSync}=require('node:fs');writeFileSync(${JSON.stringify(pidFile)},String(process.pid));` +
            "console.log('[]');setInterval(()=>{},1e3);";
        const source = new CodexbarUsageSource(['bun', '-e', script], 2_000);
        let childPid = 0;
        try {
            await source.capture();
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(UsageSourceError);
            const message = (error as UsageSourceError).message;
            expect(message).toContain('deadline');
            expect(message).not.toContain('install codexbar');
            childPid = Number(readFileSync(pidFile, 'utf8'));
            expect(Number.isInteger(childPid)).toBe(true);
        } finally {
            rmSync(pidFile, { force: true });
        }
        // Runtime-owned cleanup: the run settles only after termination, but
        // leave CI a grace window before the liveness probe.
        await Bun.sleep(100);
        let alive = true;
        try {
            process.kill(childPid, 0);
        } catch {
            alive = false;
        }
        expect(alive).toBe(false);
    });
});
