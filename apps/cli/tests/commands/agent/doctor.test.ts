/**
 * Comprehensive tests for apps/cli/src/commands/agent.ts.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetAgentServiceShimsForTest } from '@gobing-ai/spur-app';
import { main } from '../../../src/index';
import type { CommandOutput } from '../../../src/output';

/**
 * CLI-spawning / fingerprint tests: `agent doctor` measures ~1.5s on a quiet host and 7-8s while
 * the agent fleet runs, against bun's 5000ms default — the calibration is recorded here once.
 */
const slowTest = (name: string, fn: () => Promise<void> | void): void => void test(name, fn, 30_000);

function captureOutput(): CommandOutput & { stdout: string[]; stderr: string[] } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return {
        stdout,
        stderr,
        write: (msg: string) => {
            stdout.push(msg);
        },
        error: (msg: string) => {
            stderr.push(msg);
        },
    };
}

// Warn-once shim markers are process-global; bun batches test files per worker
// process, so never inherit another file's marker state.
beforeEach(() => {
    _resetAgentServiceShimsForTest();
});

// ---------------------------------------------------------------------------
// 0893 R4: doctor availability provenance + usage snapshot, end-to-end through
// main() — the real AgentService renders whatever the project config and the
// producer snapshot contain (no service shims in this describe).
// ---------------------------------------------------------------------------

describe('agent doctor', () => {
    slowTest('doctor command invokes doctor on AgentService with args', async () => {
        const output = captureOutput();
        const exitCode = await main(['agent', 'doctor', 'claude-code', '--json'], {
            output,
        });
        expect(typeof exitCode).toBe('number');
    });

    // B4/0683: the probe/cache flags parse and dispatch without changing the exit contract.
    test.each([['--probe-health'], ['--force-refresh'], ['--probe-health', '--force-refresh']])(
        'doctor accepts %j',
        async (...args: unknown[]) => {
            const flags = args.filter((a): a is string => typeof a === 'string');
            const output = captureOutput();
            const exitCode = await main(['agent', 'doctor', ...flags, '--json'], { output });
            expect(typeof exitCode).toBe('number');
        },
    );
});

describe('agent doctor — availability provenance (0893)', () => {
    let tempDir: string;
    let snapshotPath: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-doctor-0893-'));
        // bun's homedir() ignores HOME at runtime — pin the snapshot via the
        // injected-env seam (SPUR_AGENT_USAGE_SNAPSHOT) instead.
        snapshotPath = join(tempDir, 'agent-usage.json');
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    /** Project-layer config with one bare-boolean and one object-form disabled executor. */
    function writeProjectConfig(): void {
        mkdirSync(join(tempDir, '.spur'), { recursive: true });
        writeFileSync(
            join(tempDir, '.spur', 'config.yaml'),
            [
                'agent:',
                '  executors:',
                '    - name: dis-bare',
                '      agent: omp',
                '      disabled: true',
                '    - name: dis-obj',
                '      agent: omp',
                '      disabled:',
                '        owner: quota',
                '        since: "2026-09-17T22:10:00.000Z"',
                '        reason: agent.quota.exhausted dis-obj',
            ].join('\n'),
        );
    }

    function writeUsageSnapshot(capturedAt: string): void {
        writeFileSync(snapshotPath, JSON.stringify({ captured_at: capturedAt }));
    }

    async function runDoctor(json: boolean): Promise<{ code: number; stdout: string[]; stderr: string[] }> {
        const output = captureOutput();
        const code = await main(['agent', 'doctor', ...(json ? ['--json'] : [])], {
            output,
            cwd: tempDir,
            env: { SPUR_SKIP_GLOBAL_CONFIG: 'true', SPUR_AGENT_USAGE_SNAPSHOT: snapshotPath },
        });
        return { code, stdout: output.stdout, stderr: output.stderr };
    }

    test('bare-boolean and object-form disables render normalized availability in --json', async () => {
        writeProjectConfig();
        const { code, stdout } = await runDoctor(true);
        expect(code).toBe(0); // all-disabled config probes nothing; tier-2 disabled rows never fail the exit
        const parsed = JSON.parse(stdout.find((l) => l.includes('"agents"')) ?? '');
        const bare = parsed.agents.find((a: { agent: string }) => a.agent === 'dis-bare');
        expect(bare.availability).toEqual({ disabled: true, owner: 'operator', since: null, reason: null });
        const obj = parsed.agents.find((a: { agent: string }) => a.agent === 'dis-obj');
        expect(obj.availability).toEqual({
            disabled: true,
            owner: 'quota',
            since: '2026-09-17T22:10:00.000Z',
            reason: 'agent.quota.exhausted dis-obj',
        });
    });

    test('fresh usage snapshot is reported; stale one is flagged; missing one is none (no warning)', async () => {
        writeProjectConfig();
        writeUsageSnapshot(new Date(Date.now() - 60_000).toISOString());
        const fresh = await runDoctor(true);
        const freshParsed = JSON.parse(fresh.stdout.find((l) => l.includes('"agents"')) ?? '');
        expect(freshParsed.usage.stale).toBe(false);
        expect(freshParsed.usage.age).toBeLessThan(120_000);

        writeUsageSnapshot(new Date(Date.now() - 7 * 3_600_000).toISOString());
        const stale = await runDoctor(true);
        expect(JSON.parse(stale.stdout.find((l) => l.includes('"agents"')) ?? '').usage.stale).toBe(true);

        rmSync(snapshotPath);
        const missing = await runDoctor(false);
        expect(missing.stdout.join('\n')).toContain('usage: none');
        // R3 scope: the missing producer snapshot itself is silent. Unrelated text-mode
        // warnings (e.g. B8 capability-declaration-stale) may legitimately appear.
        // 0899 R4: narrowed form kept deliberately — post-normalization a host with REAL
        // version drift still warns, so a broad no-warning assertion would be host-dependent.
        expect(missing.stderr.join('\n')).not.toMatch(/usage|snapshot|codexbar/i);
    });

    test('text table renders OWNER/SINCE/REASON with provenance from the project config', async () => {
        writeProjectConfig();
        const { code, stdout } = await runDoctor(false);
        expect(code).toBe(0);
        const table = stdout.join('\n');
        expect(table).toContain('OWNER');
        expect(table).toContain('SINCE');
        expect(table).toContain('REASON');
        expect(table).toContain('operator');
        expect(table).toContain('agent.quota.exhausted dis-obj');
    });
});
