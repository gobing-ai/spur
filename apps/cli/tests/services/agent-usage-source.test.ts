import { describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
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
});
