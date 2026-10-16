import { describe, expect, test } from 'bun:test';
import { readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageSourceError } from '@gobing-ai/spur-app';
import type { ProcessOptions, ProcessResult } from '@gobing-ai/ts-runtime';
import {
    CAPTURE_TIMEOUT_ENV,
    CodexbarUsageSource,
    DEFAULT_CAPTURE_TIMEOUT_MS,
    defaultAgentUsageSnapshotPath,
    resolveCaptureTimeoutMs,
} from '../../src/services/agent-usage-source';

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

// 2026-10-15 regression: the default argv asked for `--provider all` (106
// providers, 89 uncredentialed) and its wall time failed the job closed on 4 of
// 140 scheduled runs. The default capture now scopes to the operator-enabled
// set, and the deadline is env-overridable above the observed p99.
describe('CodexbarUsageSource capture scope + deadline', () => {
    const recordingExecutor = (
        seen: ProcessOptions[],
    ): { run: (options: ProcessOptions) => Promise<ProcessResult> } => ({
        run: async (options: ProcessOptions): Promise<ProcessResult> => {
            seen.push(options);
            return {
                command: options.command,
                args: options.args ?? [],
                stdout: '[]\n',
                stderr: '',
                exitCode: 0,
                durationMs: 1,
                outcome: 'exit',
            };
        },
    });

    test('default capture never requests an all-provider sweep', async () => {
        const seen: ProcessOptions[] = [];
        const source = new CodexbarUsageSource(undefined, 5_000, recordingExecutor(seen));
        await source.capture();
        expect(seen).toHaveLength(1);
        expect(seen[0]?.command).toBe('codexbar');
        expect(seen[0]?.args).toEqual(['usage', '--format', 'json']);
        expect(seen[0]?.args).not.toContain('all');
    });

    test('the deadline defaults above the observed p99 and honors the env override', () => {
        expect(DEFAULT_CAPTURE_TIMEOUT_MS).toBe(300_000);
        expect(resolveCaptureTimeoutMs({})).toBe(300_000);
        expect(resolveCaptureTimeoutMs({ [CAPTURE_TIMEOUT_ENV]: '600000' })).toBe(600_000);
    });

    test('an unusable override falls back to the default rather than disabling the deadline', () => {
        for (const value of ['', '   ', 'nope', '0', '-1', '1.5', 'Infinity', '99999999999']) {
            expect(resolveCaptureTimeoutMs({ [CAPTURE_TIMEOUT_ENV]: value })).toBe(DEFAULT_CAPTURE_TIMEOUT_MS);
        }
    });

    test('the capture passes the resolved deadline to the runtime', async () => {
        const seen: ProcessOptions[] = [];
        const source = new CodexbarUsageSource(undefined, undefined, recordingExecutor(seen));
        await source.capture();
        expect(seen[0]?.timeout).toBe(resolveCaptureTimeoutMs());
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
    // Hermetic per the load-flake protocol (cross-cutting.md § Isolation rerun, step 4):
    // the real-spawn variant timed out at the 20s suite budget twice and at 60s once on a
    // contended host (2026-10-14), and bigger budgets were measured not to help. The buffered
    // mapping is the CLI-layer behavior under test; real-spawn round-trips stay covered by the
    // non-zero-exit and deadline tests below.
    test('returns buffered stdout/exit for a successful capture', async () => {
        const executor = {
            run: async () => ({
                command: 'echo',
                args: ['{}'],
                stdout: '{}\n',
                stderr: '',
                exitCode: 0,
                durationMs: 1,
                outcome: 'exit' as const,
            }),
        };
        const source = new CodexbarUsageSource(['echo', '{}'], 5_000, executor);
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
