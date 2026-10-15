/**
 * Tests for `spur agent` (apps/cli/src/commands/agent/).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetAgentServiceShimsForTest, AgentCoordinationService } from '@gobing-ai/spur-app';
import { createMigratedDb, type DbAdapter } from '@gobing-ai/spur-domain';
import { resetAgentServerFetchForTesting, setAgentServerFetchForTesting } from '../../../src/commands/agent';
import { createCliContext } from '../../../src/context';
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

describe('agent list --specs', () => {
    let tempDir: string;
    let db: DbAdapter;

    beforeEach(async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-test-'));
        db = await createMigratedDb({ url: ':memory:' });
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    test('list --specs when no specs exist writes message', async () => {
        const output = captureOutput();
        const exitCode = await main(['agent', 'list', '--specs'], {
            cwd: tempDir,
            output,
            db,
        });
        expect(exitCode).toBe(0);
        expect(output.stdout.join('\n')).toContain('No agent specs found');
    });

    test('list --specs --json when specs exist outputs JSON array', async () => {
        const output = captureOutput();
        const ctx = createCliContext({
            cwd: tempDir,
            output,
            db,
        });

        const team = new AgentCoordinationService(ctx);
        await team.createAgentSpec({ id: 'test-agent-1', type: 'coder', executor: 'coder', purpose: 'test purpose' });

        const exitCode = await main(['agent', 'list', '--specs', '--json'], {
            cwd: tempDir,
            output,
            db,
        });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output.stdout.join('\n'));
        expect(parsed.specs).toHaveLength(1);
        expect(parsed.specs[0].id).toBe('test-agent-1');
        expect(parsed.specs[0].type).toBe('coder');
    });

    test('list --specs formatted text list when specs exist', async () => {
        const output = captureOutput();
        const ctx = createCliContext({
            cwd: tempDir,
            output,
            db,
        });

        const team = new AgentCoordinationService(ctx);
        await team.createAgentSpec({ id: 'agent-a', type: 'coder', purpose: 'coding purpose' });

        const exitCode = await main(['agent', 'list', '--specs'], {
            cwd: tempDir,
            output,
            db,
        });
        expect(exitCode).toBe(0);
        // 0544 R2/R4: id \t type \t role \t executor \t purpose — unset when undeclared.
        expect(output.stdout.join('\n')).toContain('agent-a\tcoder\tunset\tunset\tcoding purpose');
    });
});

describe('member session rendering (0897)', () => {
    let tempDir: string;
    let db: DbAdapter;

    beforeEach(async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-session-render-'));
        db = await createMigratedDb({ url: ':memory:' });
    });

    afterEach(() => {
        resetAgentServerFetchForTesting();
        rmSync(tempDir, { recursive: true, force: true });
    });

    /** Supervisor feed stub: planner is running with a resume session, worker stopped. */
    function stubProcessesFeed(): void {
        setAgentServerFetchForTesting(
            (async (_input: string | URL | Request) =>
                new Response(
                    JSON.stringify({
                        processes: [
                            {
                                agentId: 'planner',
                                pid: 4132,
                                status: 'running',
                                startedAt: new Date().toISOString(),
                                exitCode: null,
                                teamId: null,
                                session: { mode: 'resume', id: 'sess-3f9c2a1d-beef' },
                            },
                            {
                                agentId: 'worker',
                                pid: null,
                                status: 'stopped',
                                startedAt: new Date().toISOString(),
                                exitCode: null,
                                teamId: null,
                            },
                        ],
                    }),
                    { status: 200 },
                )) as typeof fetch,
        );
    }

    async function seedSpecs(): Promise<void> {
        const output = captureOutput();
        const ctx = createCliContext({ cwd: tempDir, output, db });
        const team = new AgentCoordinationService(ctx);
        await team.createAgentSpec({ id: 'planner', type: 'claude-code', executor: 'claude', purpose: 'plans' });
        await team.createAgentSpec({ id: 'worker', type: 'coder', executor: 'coder', purpose: 'codes' });
    }

    test('list --specs renders the session column: mode + shortened id, - when absent', async () => {
        await seedSpecs();
        stubProcessesFeed();
        const output = captureOutput();
        const exitCode = await main(['agent', 'list', '--specs'], { cwd: tempDir, output, db });
        expect(exitCode).toBe(0);
        const lines = output.stdout.join('\n').split('\n');
        expect(lines.find((l) => l.startsWith('planner\t'))).toContain('resume id=sess-3f9');
        expect(lines.find((l) => l.startsWith('worker\t'))).toMatch(/\t-$/);
    });

    test('list --specs --json carries the full session object', async () => {
        await seedSpecs();
        stubProcessesFeed();
        const output = captureOutput();
        const exitCode = await main(['agent', 'list', '--specs', '--json'], { cwd: tempDir, output, db });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output.stdout.join('\n')) as {
            specs: Array<{ id: string; session?: { mode: string; id?: string } }>;
        };
        expect(parsed.specs.find((sp) => sp.id === 'planner')?.session).toEqual({
            mode: 'resume',
            id: 'sess-3f9c2a1d-beef',
        });
        expect(parsed.specs.find((sp) => sp.id === 'worker')?.session).toBeUndefined();
    });

    slowTest('status renders live status and session per spec; unreachable server reports stopped', async () => {
        await seedSpecs();
        stubProcessesFeed();
        const output = captureOutput();
        const exitCode = await main(['agent', 'status'], { cwd: tempDir, output, db });
        expect(exitCode).toBe(0);
        const lines = output.stdout.join('\n').split('\n');
        expect(lines.find((l) => l.startsWith('planner\t'))).toContain('running pid=4132\tresume id=sess-3f9');
        expect(lines.find((l) => l.startsWith('worker\t'))).toContain('stopped\t-');

        // Unreachable server: every spec stopped, no session, warning on stderr.
        resetAgentServerFetchForTesting();
        const offline = captureOutput();
        const code2 = await main(['agent', 'status', '--server', 'http://127.0.0.1:59999/api'], {
            cwd: tempDir,
            output: offline,
            db,
        });
        expect(code2).toBe(0);
        expect(offline.stderr.join('\n')).toContain('Cannot reach server');
        expect(offline.stdout.join('\n')).toContain('worker\tcoder\tstopped\t-');
    });

    test('status --json carries the full session object per agent', async () => {
        await seedSpecs();
        stubProcessesFeed();
        const output = captureOutput();
        const exitCode = await main(['agent', 'status', '--json'], { cwd: tempDir, output, db });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output.stdout.join('\n')) as {
            agents: Array<{ id: string; status: string; session?: { mode: string; id?: string } }>;
        };
        const planner = parsed.agents.find((a) => a.id === 'planner');
        expect(planner?.status).toBe('running');
        expect(planner?.session).toEqual({ mode: 'resume', id: 'sess-3f9c2a1d-beef' });
    });

    test('status without specs writes the empty message', async () => {
        const output = captureOutput();
        const exitCode = await main(['agent', 'status'], { cwd: tempDir, output, db });
        expect(exitCode).toBe(0);
        expect(output.stdout.join('\n')).toContain('No agent specs found');
    });
});
