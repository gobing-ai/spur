import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActionRunContext } from '@gobing-ai/ts-dual-workflow-engine';
import type { AgentService } from '../../../src/services/agent-service';
import { AgentRunActionRunner } from '../../../src/workflow/actions/agent-run';

function makeCtx(overrides: Partial<ActionRunContext> = {}): ActionRunContext {
    return { runId: 'test-1', stateOrNodeId: 's1', workdir: '/tmp', vars: {}, env: {}, ...overrides };
}

describe('AgentRunActionRunner', () => {
    test('returns ok:true and exitCode:0 on success', async () => {
        const svc = { run: async () => 0 } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'hello' }, makeCtx());
        expect(result.ok).toBe(true);
        expect(result.data).toEqual({ exitCode: 0, agent: '<default>' });
    });

    test('returns ok:false with error on non-zero exit', async () => {
        const svc = { run: async () => 2 } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'hello' }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('exited with code 2');
    });

    test('requires input when continue is not set', async () => {
        const svc = { run: async () => 0 } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({}, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('input is required');
    });

    test('allows missing input when continue:true', async () => {
        const svc = { run: async () => 0 } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ continue: true }, makeCtx());
        expect(result.ok).toBe(true);
    });

    test('passes flags through to AgentService.run', async () => {
        let capturedInput: string | undefined;
        let capturedFlags: Record<string, string | boolean> = {};
        const svc = {
            run: async (_input: string | undefined, flags: Record<string, string | boolean>) => {
                capturedInput = _input;
                capturedFlags = flags;
                return 0;
            },
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        await runner.execute({ input: 'test', agent: 'claude', model: 'sonnet', mode: 'json', cwd: '/app' }, makeCtx());
        expect(capturedInput).toBe('test');
        expect(capturedFlags.agent).toBe('claude');
        expect(capturedFlags.model).toBe('sonnet');
        expect(capturedFlags.mode).toBe('json');
        expect(capturedFlags.cwd).toBe('/app');
    });

    test('session latch: no latch, no explicit continue → continue not set', async () => {
        let capturedFlags: Record<string, string | boolean> = {};
        const svc = {
            run: async (_input: string | undefined, flags: Record<string, string | boolean>) => {
                capturedFlags = flags;
                return 0;
            },
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        await runner.execute({ input: 'hi' }, makeCtx({ vars: {} }));
        expect(capturedFlags.continue).toBeUndefined();
    });

    test('session latch: latch=open, no explicit → continue:true', async () => {
        let capturedFlags: Record<string, string | boolean> = {};
        const svc = {
            run: async (_input: string | undefined, flags: Record<string, string | boolean>) => {
                capturedFlags = flags;
                return 0;
            },
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        await runner.execute({ input: 'hi' }, makeCtx({ vars: { __agentSession: 'open' } }));
        expect(capturedFlags.continue).toBe(true);
    });

    test('session latch: explicit continue:false overrides latch', async () => {
        let capturedFlags: Record<string, string | boolean> = {};
        const svc = {
            run: async (_input: string | undefined, flags: Record<string, string | boolean>) => {
                capturedFlags = flags;
                return 0;
            },
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        await runner.execute({ input: 'hi', continue: false }, makeCtx({ vars: { __agentSession: 'open' } }));
        expect(capturedFlags.continue).toBe(false);
    });

    test('cwd falls back to context.workdir', async () => {
        let capturedFlags: Record<string, string | boolean> = {};
        const svc = {
            run: async (_input: string | undefined, flags: Record<string, string | boolean>) => {
                capturedFlags = flags;
                return 0;
            },
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        await runner.execute({ input: 'hi' }, makeCtx({ workdir: '/fallback' }));
        expect(capturedFlags.cwd).toBe('/fallback');
    });
});

describe('AgentRunActionRunner capture mode', () => {
    test('capture:true calls runCapture and returns answer in data', async () => {
        const svc = {
            runCapture: async () => ({ exitCode: 0, answer: 'the agent answer' }),
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'hello', capture: true }, makeCtx());
        expect(result.ok).toBe(true);
        expect(result.data).toEqual({ exitCode: 0, agent: '<default>', answer: 'the agent answer' });
    });

    test('capture:true with non-zero exit → ok:false with error', async () => {
        const svc = {
            runCapture: async () => ({ exitCode: 3, answer: 'partial' }),
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'hello', capture: true }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('exited with code 3');
        expect(result.data).toEqual({ exitCode: 3, agent: '<default>', answer: 'partial' });
    });

    test('capture:false (default) calls run, not runCapture', async () => {
        let runCalled = false;
        let runCaptureCalled = false;
        const svc = {
            run: async () => {
                runCalled = true;
                return 0;
            },
            runCapture: async () => {
                runCaptureCalled = true;
                return { exitCode: 0, answer: '' };
            },
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        await runner.execute({ input: 'hello' }, makeCtx());
        expect(runCalled).toBe(true);
        expect(runCaptureCalled).toBe(false);
    });

    test('capture:true sets session latch on success', async () => {
        const svc = {
            runCapture: async () => ({ exitCode: 0, answer: 'ok' }),
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'hello', capture: true }, makeCtx());
        expect(result.setVars).toEqual({ __agentSession: 'open' });
    });

    test('capture:true does not set session latch on failure', async () => {
        const svc = {
            runCapture: async () => ({ exitCode: 3, answer: '' }),
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'hello', capture: true }, makeCtx());
        expect(result.setVars).toBeUndefined();
    });
});

describe('AgentRunActionRunner answerFile', () => {
    let dir: string;
    afterEach(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    // answerFile is the deterministic transport for the agent's answer to a downstream
    // shell step (the engine propagates setVars, not result.data) — e.g. the verify
    // step's verdict artifact. Setting it must imply capture and persist the answer.
    test('persists the captured answer to an absolute answerFile and implies capture', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const file = join(dir, 'answer.txt');
        let runCalled = false;
        const svc = {
            run: async () => {
                runCalled = true;
                return 0;
            },
            runCapture: async () => ({ exitCode: 0, answer: 'Verdict: PASS' }),
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'verify', answerFile: file }, makeCtx());
        expect(result.ok).toBe(true);
        expect(runCalled).toBe(false); // answerFile forced capture path, not plain run
        expect(readFileSync(file, 'utf8')).toBe('Verdict: PASS');
    });

    test('resolves a relative answerFile against cwd and creates parent dirs', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const svc = {
            runCapture: async () => ({ exitCode: 0, answer: 'FAIL' }),
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        await runner.execute({ input: 'verify', answerFile: 'nested/out.txt', cwd: dir }, makeCtx());
        expect(readFileSync(join(dir, 'nested', 'out.txt'), 'utf8')).toBe('FAIL');
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentRunActionRunner expectFile
// ---------------------------------------------------------------------------

describe('AgentRunActionRunner expectFile', () => {
    let dir: string;
    afterEach(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    // R6-S2a: expectFile catches "agent exited 0 but didn't produce the expected
    // artifact" — the silent-success defect where the agent claims success but the
    // side-effect file (verdict, report, etc.) is missing.
    test('non-capture: exit-0 + expectFile exists → ok:true', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const file = join(dir, 'output.txt');
        writeFileSync(file, 'done');
        const svc = {
            run: async () => 0,
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'build', expectFile: file }, makeCtx());
        expect(result.ok).toBe(true);
    });

    test('non-capture: exit-0 + expectFile absent → ok:false with clear error', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const svc = {
            run: async () => 0,
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'build', expectFile: 'missing.txt', cwd: dir }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('exited 0 but expected file is absent');
        expect(result.error).toContain('missing.txt');
    });

    test('capture: exit-0 + expectFile exists → ok:true', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const file = join(dir, 'verdict.json');
        writeFileSync(file, '{"verdict":"PASS"}');
        const svc = {
            runCapture: async () => ({ exitCode: 0, answer: 'verified' }),
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'verify', capture: true, expectFile: file }, makeCtx());
        expect(result.ok).toBe(true);
        expect(result.data).toEqual({ exitCode: 0, agent: '<default>', answer: 'verified' });
    });

    test('capture: exit-0 + expectFile absent → ok:false with clear error', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const svc = {
            runCapture: async () => ({ exitCode: 0, answer: 'all good' }),
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute(
            { input: 'verify', capture: true, expectFile: 'nope.json', cwd: dir },
            makeCtx(),
        );
        expect(result.ok).toBe(false);
        expect(result.error).toContain('exited 0 but expected file is absent');
        expect(result.error).toContain('nope.json');
        expect(result.data).toEqual({ exitCode: 0, agent: '<default>', answer: 'all good' });
    });

    test('expectFile resolves relative to cwd', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const svc = {
            run: async () => 0,
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'build', expectFile: 'artifact.txt', cwd: dir }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('artifact.txt');
    });

    test('non-capture: non-zero exit skips expectFile check', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const svc = {
            run: async () => 2,
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'build', expectFile: 'missing.txt', cwd: dir }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('exited with code 2');
        expect(result.error).not.toContain('expected file is absent');
    });

    test('capture: non-zero exit skips expectFile check', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const svc = {
            runCapture: async () => ({ exitCode: 1, answer: 'partial' }),
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute(
            { input: 'build', capture: true, expectFile: 'missing.txt', cwd: dir },
            makeCtx(),
        );
        expect(result.ok).toBe(false);
        expect(result.error).toContain('exited with code 1');
        expect(result.error).not.toContain('expected file is absent');
    });

    test('answerFile + expectFile together: both written and verified', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const answerPath = join(dir, 'answer.txt');
        const artifactPath = join(dir, 'artifact.txt');
        writeFileSync(artifactPath, 'built');
        const svc = {
            runCapture: async () => ({ exitCode: 0, answer: 'build complete' }),
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute(
            { input: 'build', answerFile: answerPath, expectFile: artifactPath },
            makeCtx(),
        );
        expect(result.ok).toBe(true);
        expect(readFileSync(answerPath, 'utf8')).toBe('build complete');
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentRunActionRunner timeoutMs
// ---------------------------------------------------------------------------

describe('AgentRunActionRunner timeoutMs', () => {
    test('timeoutMs option sets flags.timeout on run', async () => {
        let capturedFlags: Record<string, string | boolean> = {};
        const svc = {
            run: async (_input: string | undefined, flags: Record<string, string | boolean>) => {
                capturedFlags = flags;
                return 0;
            },
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        await runner.execute({ input: 'test', timeoutMs: 30000 }, makeCtx());
        expect(capturedFlags.timeout).toBe('30000');
    });

    test('timeoutMs absent when option not set', async () => {
        let capturedFlags: Record<string, string | boolean> = {};
        const svc = {
            run: async (_input: string | undefined, flags: Record<string, string | boolean>) => {
                capturedFlags = flags;
                return 0;
            },
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        await runner.execute({ input: 'test' }, makeCtx());
        expect(capturedFlags.timeout).toBeUndefined();
    });

    test('timeoutMs + non-zero capture exit → ok:false with timeout error', async () => {
        const svc = {
            runCapture: async () => ({ exitCode: 137, answer: '' }),
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'test', capture: true, timeoutMs: 30000 }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('exited with code 137');
    });

    test('timeoutMs + non-zero plain run exit → ok:false with timeout error', async () => {
        const svc = {
            run: async () => 1,
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'test', timeoutMs: 30000 }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('exited with code 1');
    });

    test('timeoutMs: 0 returns ok:false with validation error', async () => {
        const runner = new AgentRunActionRunner({} as unknown as AgentService);
        const result = await runner.execute({ input: 'test', timeoutMs: 0 }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('timeoutMs must be > 0');
    });

    test('timeoutMs: negative returns ok:false with validation error', async () => {
        const runner = new AgentRunActionRunner({} as unknown as AgentService);
        const result = await runner.execute({ input: 'test', timeoutMs: -100 }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('timeoutMs must be > 0');
    });

    test('timeoutMs: non-numeric string → flags.timeout absent (silent no-op)', async () => {
        let capturedFlags: Record<string, string | boolean> = {};
        const svc = {
            run: async (_input: string | undefined, flags: Record<string, string | boolean>) => {
                capturedFlags = flags;
                return 0;
            },
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'test', timeoutMs: 'abc' } as Record<string, unknown>, makeCtx());
        expect(result.ok).toBe(true);
        expect(capturedFlags.timeout).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentRunActionRunner partial-work handoff artifact (R2b / G2)
// ---------------------------------------------------------------------------

describe('AgentRunActionRunner partial-work handoff artifact', () => {
    let dir: string;
    afterEach(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    // R2b: a failed captured run (e.g. implement-step timeout, bugs 742/744/746/748)
    // must leave a machine-readable handoff artifact — exit reason, elapsed time,
    // diff stat, and stdout/stderr tails — instead of discarding everything but a
    // one-line "exited with code N" message.
    test('captured timeout (null exit + signal) writes a partial-work artifact under .spur/run', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const svc = {
            runCapture: async () => ({
                exitCode: 137,
                answer: 'partial stdout output before the kill',
                durationMs: 1_800_123,
                signal: 'SIGKILL',
                stderr: 'some stderr noise',
            }),
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute(
            { input: 'test', capture: true, timeoutMs: 1_800_000 },
            makeCtx({ runId: 'run-abc', stateOrNodeId: 'implement', workdir: dir }),
        );
        expect(result.ok).toBe(false);

        const artifactPath = join(dir, '.spur', 'run', 'run-abc-implement-partial.md');
        const artifact = readFileSync(artifactPath, 'utf8');
        expect(artifact).toContain('killed by signal SIGKILL');
        expect(artifact).toContain('1800123ms');
        expect(artifact).toContain('partial stdout output before the kill');
        expect(artifact).toContain('some stderr noise');
        expect(artifact).toContain('git diff --stat');
    });

    test('captured non-timeout failure (plain non-zero exit) also writes the artifact', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const svc = {
            runCapture: async () => ({ exitCode: 3, answer: 'agent crashed', durationMs: 500 }),
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        await runner.execute(
            { input: 'test', capture: true },
            makeCtx({ runId: 'run-xyz', stateOrNodeId: 'test', workdir: dir }),
        );

        const artifactPath = join(dir, '.spur', 'run', 'run-xyz-test-partial.md');
        const artifact = readFileSync(artifactPath, 'utf8');
        expect(artifact).toContain('exited with code 3');
        expect(artifact).toContain('agent crashed');
    });

    test('successful captured run does not write a partial-work artifact', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const svc = {
            runCapture: async () => ({ exitCode: 0, answer: 'all good', durationMs: 100 }),
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        await runner.execute(
            { input: 'test', capture: true },
            makeCtx({ runId: 'run-ok', stateOrNodeId: 'implement', workdir: dir }),
        );

        const artifactPath = join(dir, '.spur', 'run', 'run-ok-implement-partial.md');
        expect(existsSync(artifactPath)).toBe(false);
    });

    test('non-capture (plain run) failure does not write a partial-work artifact (no captured data to hand off)', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const svc = { run: async () => 1 } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        await runner.execute(
            { input: 'test' },
            makeCtx({ runId: 'run-plain', stateOrNodeId: 'implement', workdir: dir }),
        );

        const artifactPath = join(dir, '.spur', 'run', 'run-plain-implement-partial.md');
        expect(existsSync(artifactPath)).toBe(false);
    });
});
