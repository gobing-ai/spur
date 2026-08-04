import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ActionRunContext } from '@gobing-ai/ts-dual-workflow-engine';
import { EventBus } from '@gobing-ai/ts-infra';
import type {
    AgentExecutionEvent,
    AgentExecutionObserver,
    AgentExecutionOptions,
} from '../../../src/observability/agent-execution';
import type { AgentRunInvocation, AgentRunTracedResult, AgentService } from '../../../src/services/agent-service';
import { AgentRunActionRunner } from '../../../src/workflow/actions/agent-run';
import type { WorkflowObservabilityBus, WorkflowObservabilityEventMap } from '../../../src/workflow/observability';
import { type SteeringCommand, WorkflowSteeringController } from '../../../src/workflow/steering';

function makeCtx(overrides: Partial<ActionRunContext> = {}): ActionRunContext {
    return { runId: 'test-1', stateOrNodeId: 's1', workdir: '/tmp', vars: {}, env: {}, ...overrides };
}

/**
 * Minimal non-interactive invocation fixture — mirrors what
 * `AgentService.runTraced` returns under the R3 contract (buffered output,
 * stdin ignored, prompt-bearing argv redacted before tracing).
 */
function invocation(overrides: Partial<AgentRunInvocation> = {}): AgentRunInvocation {
    return {
        agent: 'claude',
        source: 'default',
        command: 'claude',
        argv: ['-p', 'hello'],
        cwd: '/tmp',
        mode: 'text',
        outputMode: 'buffered',
        continue: false,
        stdinInteractive: false,
        ...overrides,
    };
}

/** Build a fake AgentService that resolves `runTraced` to a fixed result. */
function svcWithRunTraced(result: Partial<AgentRunTracedResult>): AgentService {
    const full: AgentRunTracedResult = {
        exitCode: 0,
        stdout: '',
        ...result,
    };
    return { runTraced: async () => full } as unknown as AgentService;
}

/** Build a fake AgentService whose `runTraced` observes the flags it receives. */
function svcCapturingFlags(
    onFlags: (flags: Record<string, string | boolean>) => void,
    result: Partial<AgentRunTracedResult> = {},
): AgentService {
    const full: AgentRunTracedResult = { exitCode: 0, stdout: '', ...result };
    return {
        runTraced: async (_input: string | undefined, flags: Record<string, string | boolean>) => {
            onFlags(flags);
            return full;
        },
    } as unknown as AgentService;
}

describe('AgentRunActionRunner', () => {
    test('returns ok:true and exitCode:0 on success', async () => {
        const svc = svcWithRunTraced({ exitCode: 0, stdout: '', invocation: invocation() });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'hello' }, makeCtx());
        expect(result.ok).toBe(true);
        expect(result.data).toMatchObject({ exitCode: 0, agent: '<default>' });
    });

    test('returns ok:false with error on non-zero exit', async () => {
        const svc = svcWithRunTraced({ exitCode: 2, stdout: 'boom', invocation: invocation() });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'hello' }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('exited with code 2');
    });

    test('requires input when continue is not set', async () => {
        const svc = svcWithRunTraced({});
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({}, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('input is required');
    });

    test('allows missing input when continue:true', async () => {
        const svc = svcWithRunTraced({});
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ continue: true }, makeCtx());
        expect(result.ok).toBe(true);
    });

    test('passes flags through to AgentService.runTraced', async () => {
        let capturedFlags: Record<string, string | boolean> = {};
        const svc = svcCapturingFlags((f) => {
            capturedFlags = f;
        });
        const runner = new AgentRunActionRunner(svc);
        await runner.execute({ input: 'test', agent: 'claude', model: 'sonnet', mode: 'json', cwd: '/app' }, makeCtx());
        expect(capturedFlags.agent).toBe('claude');
        expect(capturedFlags.model).toBe('sonnet');
        expect(capturedFlags.mode).toBe('json');
        expect(capturedFlags.cwd).toBe('/app');
    });

    test('session latch: no latch, no explicit continue → continue not set', async () => {
        let capturedFlags: Record<string, string | boolean> = {};
        const svc = svcCapturingFlags((f) => {
            capturedFlags = f;
        });
        const runner = new AgentRunActionRunner(svc);
        await runner.execute({ input: 'hi' }, makeCtx({ vars: {} }));
        expect(capturedFlags.continue).toBeUndefined();
    });

    test('session latch: latch=open, no explicit → continue:true', async () => {
        let capturedFlags: Record<string, string | boolean> = {};
        const svc = svcCapturingFlags((f) => {
            capturedFlags = f;
        });
        const runner = new AgentRunActionRunner(svc);
        await runner.execute({ input: 'hi' }, makeCtx({ vars: { __agentSession: 'open' } }));
        expect(capturedFlags.continue).toBe(true);
    });

    test('session latch: explicit continue:false overrides latch', async () => {
        let capturedFlags: Record<string, string | boolean> = {};
        const svc = svcCapturingFlags((f) => {
            capturedFlags = f;
        });
        const runner = new AgentRunActionRunner(svc);
        await runner.execute({ input: 'hi', continue: false }, makeCtx({ vars: { __agentSession: 'open' } }));
        expect(capturedFlags.continue).toBe(false);
    });

    test('cwd falls back to context.workdir', async () => {
        let capturedFlags: Record<string, string | boolean> = {};
        const svc = svcCapturingFlags((f) => {
            capturedFlags = f;
        });
        const runner = new AgentRunActionRunner(svc);
        await runner.execute({ input: 'hi' }, makeCtx({ workdir: '/fallback' }));
        expect(capturedFlags.cwd).toBe('/fallback');
    });
});

describe('AgentRunActionRunner resume-mode fallback (task 0406)', () => {
    /**
     * Fake service whose first call returns exitCode 2 (shim dispatch error)
     * and whose second call returns exitCode 0. Captures every call's flags
     * so the test can assert the retry dropped `continue`.
     */
    function svcFailingThenSucceeding(calls: { flags: Record<string, string | boolean> }[]): AgentService {
        let attempt = 0;
        const results: AgentRunTracedResult[] = [
            { exitCode: 2, stdout: '', message: 'Codex resume mode does not accept a new prompt' },
            { exitCode: 0, stdout: 'ok', invocation: invocation() },
        ];
        return {
            runTraced: async (_input: string | undefined, flags: Record<string, string | boolean>) => {
                calls.push({ flags: { ...flags } });
                return results[attempt++] ?? results[results.length - 1];
            },
        } as unknown as AgentService;
    }

    test('latch=open, exitCode 2 on first call → retries without continue, succeeds', async () => {
        const calls: { flags: Record<string, string | boolean> }[] = [];
        const svc = svcFailingThenSucceeding(calls);
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'verify' }, makeCtx({ vars: { __agentSession: 'open' } }));
        expect(result.ok).toBe(true);
        expect(calls).toHaveLength(2);
        // First call: latch auto-set continue:true
        expect(calls[0]?.flags.continue).toBe(true);
        // Retry: continue dropped
        expect(calls[1]?.flags.continue).toBeUndefined();
    });

    test('after successful fallback, setVars writes no-resume sentinel', async () => {
        const calls: { flags: Record<string, string | boolean> }[] = [];
        const svc = svcFailingThenSucceeding(calls);
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'verify' }, makeCtx({ vars: { __agentSession: 'open' } }));
        expect(result.ok).toBe(true);
        expect(result.setVars).toMatchObject({ __agentSession: 'no-resume' });
    });

    test('no-resume sentinel on latch inhibits continue on next step', async () => {
        let capturedFlags: Record<string, string | boolean> = {};
        const svc = svcCapturingFlags((f) => {
            capturedFlags = f;
        });
        const runner = new AgentRunActionRunner(svc);
        await runner.execute({ input: 'verify' }, makeCtx({ vars: { __agentSession: 'no-resume' } }));
        expect(capturedFlags.continue).toBeUndefined();
    });

    test('exitCode 2 with explicit continue → no retry (author intent)', async () => {
        const calls: { flags: Record<string, string | boolean> }[] = [];
        const svc = svcFailingThenSucceeding(calls);
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute(
            { input: 'verify', continue: true },
            makeCtx({ vars: { __agentSession: 'open' } }),
        );
        expect(result.ok).toBe(false);
        expect(calls).toHaveLength(1);
    });

    test('exitCode 2 without latch → no retry (fresh dispatch already failed)', async () => {
        const svc = svcWithRunTraced({ exitCode: 2, stdout: '', message: 'binary not found' });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'verify' }, makeCtx());
        expect(result.ok).toBe(false);
    });
});

describe('AgentRunActionRunner steering', () => {
    function activeCommand(
        controller: WorkflowSteeringController,
        operation: SteeringCommand['operation'],
        note?: string,
    ): SteeringCommand {
        const snapshot = controller.snapshot;
        if (snapshot === undefined) throw new Error('missing steering snapshot');
        return {
            commandId: crypto.randomUUID(),
            runId: snapshot.runId,
            actionId: snapshot.actionId,
            expectedState: snapshot.state,
            expectedVersion: snapshot.version,
            operation,
            ...(note !== undefined ? { note } : {}),
            actor: 'operator',
            deadlineAt: new Date(Date.now() + 1000).toISOString(),
        };
    }

    async function waitForBoundary(controller: WorkflowSteeringController, afterVersion = 0): Promise<void> {
        for (let index = 0; index < 50; index += 1) {
            const snapshot = controller.snapshot;
            if (snapshot?.state === 'boundary' && snapshot.version > afterVersion) return;
            await Bun.sleep(1);
        }
        throw new Error('steering boundary was not reached');
    }

    test('retries only under an explicit idempotent policy and preserves the outer action identity', async () => {
        const controller = new WorkflowSteeringController();
        const actionIds: Array<string | undefined> = [];
        let calls = 0;
        const service = {
            runTraced: async (
                _input: string | undefined,
                _flags: Record<string, string | boolean>,
                _deps: unknown,
                execution: { correlation?: { actionId?: string } },
            ) => {
                calls += 1;
                actionIds.push(execution.correlation?.actionId);
                return {
                    exitCode: calls === 1 ? 3 : 0,
                    stdout: calls === 1 ? 'failed' : 'recovered',
                    invocation: invocation(),
                };
            },
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(service, undefined, controller);
        const pending = runner.execute(
            {
                input: 'retry me',
                steeringBoundary: true,
                retryPolicy: { idempotent: true, maxAttempts: 2 },
            },
            makeCtx({ actionId: 'persisted-action-1' }),
        );

        await waitForBoundary(controller);
        const firstBoundaryVersion = controller.snapshot?.version ?? 0;
        expect(controller.submit(activeCommand(controller, 'retry')).accepted).toBe(true);
        await waitForBoundary(controller, firstBoundaryVersion);
        expect(controller.submit(activeCommand(controller, 'continue')).accepted).toBe(true);

        await expect(pending).resolves.toMatchObject({ ok: true });
        expect(calls).toBe(2);
        expect(actionIds).toEqual(['persisted-action-1', 'persisted-action-1']);
    });

    test('redacts steering notes before carrying them to the next safe boundary', async () => {
        const controller = new WorkflowSteeringController(undefined, ['note-secret']);
        const runner = new AgentRunActionRunner(svcWithRunTraced({ exitCode: 0 }), undefined, controller);
        const pending = runner.execute(
            { input: 'note me', steeringBoundary: true },
            makeCtx({ actionId: 'persisted-action-2' }),
        );

        await waitForBoundary(controller);
        expect(controller.submit(activeCommand(controller, 'note', 'remember note-secret')).accepted).toBe(true);

        const result = await pending;
        expect(result.setVars?.__steeringNote).toBe('remember [REDACTED]');
    });

    test('abort propagates to the active AgentService signal and returns a cancelled action', async () => {
        const controller = new WorkflowSteeringController();
        const service = {
            runTraced: async (
                _input: string | undefined,
                _flags: Record<string, string | boolean>,
                _deps: unknown,
                execution: { signal?: AbortSignal },
            ): Promise<AgentRunTracedResult> =>
                await new Promise((resolve) => {
                    execution.signal?.addEventListener(
                        'abort',
                        () => resolve({ exitCode: 3, stdout: 'partial', signal: 'SIGTERM', durationMs: 5 }),
                        { once: true },
                    );
                }),
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(service, undefined, controller);
        const pending = runner.execute(
            { input: 'abort me', steeringBoundary: true },
            makeCtx({ actionId: 'persisted-action-3' }),
        );
        await Bun.sleep(1);

        expect(controller.submit(activeCommand(controller, 'abort')).accepted).toBe(true);
        const result = await pending;
        expect(result).toMatchObject({ ok: false });
        expect(result.error).toContain('SIGTERM');
    });
});

describe('AgentRunActionRunner capture mode', () => {
    test('capture:true surfaces answer in data', async () => {
        const svc = svcWithRunTraced({
            exitCode: 0,
            stdout: 'the agent answer',
            invocation: invocation(),
        });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'hello', capture: true }, makeCtx());
        expect(result.ok).toBe(true);
        expect(result.data).toMatchObject({
            exitCode: 0,
            agent: '<default>',
            answer: 'the agent answer',
        });
    });

    test('capture:true with non-zero exit → ok:false with error', async () => {
        const svc = svcWithRunTraced({
            exitCode: 3,
            stdout: 'partial',
            invocation: invocation(),
        });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'hello', capture: true }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('exited with code 3');
        expect(result.data).toMatchObject({
            exitCode: 3,
            agent: '<default>',
            answer: 'partial',
        });
    });

    test('capture:false (default) does not surface answer in data', async () => {
        const svc = svcWithRunTraced({ exitCode: 0, stdout: 'ran', invocation: invocation() });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'hello' }, makeCtx());
        expect(result.data).not.toHaveProperty('answer');
    });

    test('capture:true sets session latch on success', async () => {
        const svc = svcWithRunTraced({ exitCode: 0, stdout: 'ok', invocation: invocation() });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'hello', capture: true }, makeCtx());
        expect(result.setVars).toEqual({ __agentSession: 'open' });
    });

    test('capture:true does not set session latch on failure', async () => {
        const svc = svcWithRunTraced({ exitCode: 3, stdout: '', invocation: invocation() });
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
        const svc = svcWithRunTraced({ exitCode: 0, stdout: 'Verdict: PASS', invocation: invocation() });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'verify', answerFile: file }, makeCtx());
        expect(result.ok).toBe(true);
        expect(readFileSync(file, 'utf8')).toBe('Verdict: PASS');
    });

    test('resolves a relative answerFile against cwd and creates parent dirs', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const svc = svcWithRunTraced({ exitCode: 0, stdout: 'FAIL', invocation: invocation() });
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
        const svc = svcWithRunTraced({ exitCode: 0, stdout: '', invocation: invocation() });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'build', expectFile: file }, makeCtx());
        expect(result.ok).toBe(true);
    });

    test('non-capture: exit-0 + expectFile absent → ok:false with clear error', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const svc = svcWithRunTraced({ exitCode: 0, stdout: '', invocation: invocation() });
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
        const svc = svcWithRunTraced({
            exitCode: 0,
            stdout: 'verified',
            invocation: invocation(),
        });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'verify', capture: true, expectFile: file }, makeCtx());
        expect(result.ok).toBe(true);
        expect(result.data).toMatchObject({
            exitCode: 0,
            agent: '<default>',
            answer: 'verified',
        });
    });

    test('capture: exit-0 + expectFile absent → ok:false with clear error', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const svc = svcWithRunTraced({
            exitCode: 0,
            stdout: 'all good',
            invocation: invocation(),
        });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute(
            { input: 'verify', capture: true, expectFile: 'nope.json', cwd: dir },
            makeCtx(),
        );
        expect(result.ok).toBe(false);
        expect(result.error).toContain('exited 0 but expected file is absent');
        expect(result.error).toContain('nope.json');
        expect(result.data).toMatchObject({
            exitCode: 0,
            agent: '<default>',
            answer: 'all good',
        });
    });

    test('expectFile resolves relative to cwd', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const svc = svcWithRunTraced({ exitCode: 0, stdout: '', invocation: invocation() });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'build', expectFile: 'artifact.txt', cwd: dir }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('artifact.txt');
    });

    test('non-capture: non-zero exit skips expectFile check', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const svc = svcWithRunTraced({ exitCode: 2, stdout: '', invocation: invocation() });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'build', expectFile: 'missing.txt', cwd: dir }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('exited with code 2');
        expect(result.error).not.toContain('expected file is absent');
    });

    test('capture: non-zero exit skips expectFile check', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const svc = svcWithRunTraced({
            exitCode: 1,
            stdout: 'partial',
            invocation: invocation(),
        });
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
        const svc = svcWithRunTraced({
            exitCode: 0,
            stdout: 'build complete',
            invocation: invocation(),
        });
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
// Tests: AgentRunActionRunner empty-implement guard (requireDiff, task 0424)
// ---------------------------------------------------------------------------

/** Initialise a throwaway git repo (local identity only — no global config). */
function gitInit(dir: string): void {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
}

function gitCommitAll(dir: string, message: string): void {
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-qm', message], { cwd: dir });
}

describe('AgentRunActionRunner empty-implement guard (requireDiff, task 0424)', () => {
    let dir: string;
    afterEach(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    test('exit-0 + requireDiff with zero changes → ok:false with empty-implement error', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-nodiff-'));
        // Not a git repo — `git status --porcelain` reports nothing → gate fires.
        const svc = svcWithRunTraced({ exitCode: 0, stdout: '', invocation: invocation() });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'implement', requireDiff: true, cwd: dir }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('empty implement');
        expect(result.error).toContain('zero non-corpus file changes');
    });

    test('exit-0 + requireDiff with only corpus changes → rejected (docs/tasks3 excluded)', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-corpus-'));
        gitInit(dir);
        const taskFile = join(dir, 'docs/tasks3/0000_probe.md');
        mkdirSync(dirname(taskFile), { recursive: true });
        writeFileSync(taskFile, 'base');
        gitCommitAll(dir, 'base');
        writeFileSync(taskFile, 'changed');
        const svc = svcWithRunTraced({ exitCode: 0, stdout: '', invocation: invocation() });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'implement', requireDiff: true, cwd: dir }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('empty implement');
    });

    test('exit-0 + requireDiff with a non-corpus change → ok:true', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-diff-'));
        gitInit(dir);
        const srcFile = join(dir, 'src/probe.ts');
        mkdirSync(dirname(srcFile), { recursive: true });
        writeFileSync(srcFile, 'base');
        gitCommitAll(dir, 'base');
        writeFileSync(srcFile, 'changed');
        const svc = svcWithRunTraced({ exitCode: 0, stdout: '', invocation: invocation() });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'implement', requireDiff: true, cwd: dir }, makeCtx());
        expect(result.ok).toBe(true);
    });

    test('untracked new non-corpus files count as changes (git diff would miss them)', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-untracked-'));
        gitInit(dir);
        writeFileSync(join(dir, 'base.txt'), 'base');
        gitCommitAll(dir, 'base');
        const newModule = join(dir, 'new-module/index.ts');
        mkdirSync(dirname(newModule), { recursive: true });
        writeFileSync(newModule, 'new');
        const svc = svcWithRunTraced({ exitCode: 0, stdout: '', invocation: invocation() });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'implement', requireDiff: true, cwd: dir }, makeCtx());
        expect(result.ok).toBe(true);
    });

    test('exit-0 without requireDiff → ok:true even with zero changes', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-optout-'));
        const svc = svcWithRunTraced({ exitCode: 0, stdout: '', invocation: invocation() });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'implement', cwd: dir }, makeCtx());
        expect(result.ok).toBe(true);
    });

    test('subprocess failure error names the partial-work artifact path and the resume runbook (R2)', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-r2-'));
        gitInit(dir);
        writeFileSync(join(dir, 'base.txt'), 'base');
        gitCommitAll(dir, 'base');
        const svc = svcWithRunTraced({ exitCode: 3, stdout: '', invocation: invocation() });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'implement', cwd: dir }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('exited with code 3');
        expect(result.error).toContain('.spur/run/test-1-s1-partial.md');
        expect(result.error).toContain('execution-workflow.md');
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentRunActionRunner timeoutMs
// ---------------------------------------------------------------------------

describe('AgentRunActionRunner timeoutMs', () => {
    test('timeoutMs option sets flags.timeout on run', async () => {
        let capturedFlags: Record<string, string | boolean> = {};
        const svc = svcCapturingFlags((f) => {
            capturedFlags = f;
        });
        const runner = new AgentRunActionRunner(svc);
        await runner.execute({ input: 'test', timeoutMs: 30000 }, makeCtx());
        expect(capturedFlags.timeout).toBe('30000');
    });

    test('timeoutMs absent when option not set', async () => {
        let capturedFlags: Record<string, string | boolean> = {};
        const svc = svcCapturingFlags((f) => {
            capturedFlags = f;
        });
        const runner = new AgentRunActionRunner(svc);
        await runner.execute({ input: 'test' }, makeCtx());
        expect(capturedFlags.timeout).toBeUndefined();
    });

    test('timeoutMs + non-zero capture exit → ok:false with timeout error', async () => {
        const svc = svcWithRunTraced({
            exitCode: 137,
            stdout: '',
            signal: 'SIGKILL',
            invocation: invocation(),
        });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'test', capture: true, timeoutMs: 30000 }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('terminated by signal SIGKILL');
        expect(result.error).toContain('configured timeout: 30000ms');
    });

    test('timeoutMs + non-zero plain run exit → ok:false with timeout error', async () => {
        const svc = svcWithRunTraced({ exitCode: 1, stdout: '', invocation: invocation() });
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
        const svc = svcCapturingFlags((f) => {
            capturedFlags = f;
        });
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
    test('captured timeout (signal) writes a partial-work artifact under .spur/run', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const svc = svcWithRunTraced({
            exitCode: 137,
            stdout: 'partial stdout output before the kill',
            stderr: 'some stderr noise',
            durationMs: 1_800_123,
            signal: 'SIGKILL',
            invocation: invocation({ agent: 'claude', argv: ['-p', 'test'] }),
        });
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
        const svc = svcWithRunTraced({
            exitCode: 3,
            stdout: 'agent crashed',
            durationMs: 500,
            invocation: invocation(),
        });
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
        const svc = svcWithRunTraced({
            exitCode: 0,
            stdout: 'all good',
            durationMs: 100,
            invocation: invocation(),
        });
        const runner = new AgentRunActionRunner(svc);
        await runner.execute(
            { input: 'test', capture: true },
            makeCtx({ runId: 'run-ok', stateOrNodeId: 'implement', workdir: dir }),
        );

        const artifactPath = join(dir, '.spur', 'run', 'run-ok-implement-partial.md');
        expect(existsSync(artifactPath)).toBe(false);
    });

    // After task 0295: non-capture failures also write the artifact because all
    // dispatch now goes through runTraced (which captures stdout/stderr in all
    // cases). Pre-0295, non-capture failures used plain `run` with no captured
    // data; that branch is gone.
    test('non-capture failure now also writes a partial-work artifact (post-0295)', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const svc = svcWithRunTraced({
            exitCode: 1,
            stdout: 'captured via buffered mode',
            invocation: invocation(),
        });
        const runner = new AgentRunActionRunner(svc);
        await runner.execute(
            { input: 'test' },
            makeCtx({ runId: 'run-plain', stateOrNodeId: 'implement', workdir: dir }),
        );

        const artifactPath = join(dir, '.spur', 'run', 'run-plain-implement-partial.md');
        expect(existsSync(artifactPath)).toBe(true);
        const artifact = readFileSync(artifactPath, 'utf8');
        expect(artifact).toContain('exited with code 1');
        expect(artifact).toContain('captured via buffered mode');
    });

    // Task 0239 (case 17): partial-work artifact includes executor and model
    // info in the header when a model was specified.
    test('captured failure with model includes agent and model in artifact header', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const svc = svcWithRunTraced({
            exitCode: 1,
            stdout: 'crashed',
            durationMs: 500,
            invocation: invocation({ agent: 'omp' }),
        });
        const runner = new AgentRunActionRunner(svc);
        await runner.execute(
            { input: 'test', capture: true, agent: 'omp', model: 'zai/glm-5.2' },
            makeCtx({ runId: 'run-model', stateOrNodeId: 'implement', workdir: dir }),
        );

        const artifactPath = join(dir, '.spur', 'run', 'run-model-implement-partial.md');
        const artifact = readFileSync(artifactPath, 'utf8');
        expect(artifact).toContain('zai/glm-5.2');
        expect(artifact).toContain('agent: omp');
        expect(artifact).toContain('model: zai/glm-5.2');
    });

    test('captured failure without model shows (default) in artifact', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const svc = svcWithRunTraced({
            exitCode: 1,
            stdout: 'crashed',
            durationMs: 500,
            invocation: invocation({ agent: 'omp' }),
        });
        const runner = new AgentRunActionRunner(svc);
        await runner.execute(
            { input: 'test', capture: true, agent: 'omp' },
            makeCtx({ runId: 'run-nomodel', stateOrNodeId: 'implement', workdir: dir }),
        );

        const artifactPath = join(dir, '.spur', 'run', 'run-nomodel-implement-partial.md');
        const artifact = readFileSync(artifactPath, 'utf8');
        expect(artifact).toContain('agent: omp');
        expect(artifact).toContain('model: (default)');
    });
});

// ---------------------------------------------------------------------------
// Tests: R1 / task 0295 — resolved invocation surfaced in ActionResult.data
// ---------------------------------------------------------------------------

describe('AgentRunActionRunner invocation capture (R1 / task 0295)', () => {
    test('surfaces resolved invocation in data.invocation on success', async () => {
        const inv = invocation({
            agent: 'codex',
            source: 'phase',
            command: 'codex',
            argv: ['exec', '--json', 'prompt'],
            cwd: '/repo',
            mode: 'json',
            timeoutMs: 60_000,
            continue: false,
            outputMode: 'buffered',
            stdinInteractive: false,
            translatedFrom: '/sp:dev-run 0042 --auto',
        });
        const svc = svcWithRunTraced({ exitCode: 0, stdout: 'done', invocation: inv });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: '/sp:dev-run 0042 --auto' }, makeCtx());
        expect(result.ok).toBe(true);
        expect(result.data).toMatchObject({ invocation: inv });
    });

    test('surfaces resolved invocation in data.invocation on failure too', async () => {
        const inv = invocation({ agent: 'omp' });
        const svc = svcWithRunTraced({ exitCode: 2, stdout: 'err', invocation: inv });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'go' }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.data).toMatchObject({ invocation: inv });
    });

    test('omits data.invocation when AgentService returns no invocation (pre-validation failure)', async () => {
        const svc = svcWithRunTraced({ exitCode: 2, stdout: '', message: 'bad mode' });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'x' }, makeCtx());
        expect(result.data).not.toHaveProperty('invocation');
    });

    test('partial-work artifact includes resolved invocation section (R1 post-mortem)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        try {
            const inv = invocation({
                agent: 'omp',
                command: 'omp',
                argv: ['--auto', '--mode', 'implement'],
                cwd: dir,
                mode: 'text',
                timeoutMs: 120_000,
                continue: true,
                outputMode: 'buffered',
                stdinInteractive: false,
                translatedFrom: '/sp:dev-run',
            });
            const svc = svcWithRunTraced({
                exitCode: 1,
                stdout: 'partial',
                durationMs: 500,
                invocation: inv,
            });
            const runner = new AgentRunActionRunner(svc);
            await runner.execute({ input: 'test' }, makeCtx({ runId: 'r1', stateOrNodeId: 'implement', workdir: dir }));

            const artifact = readFileSync(join(dir, '.spur', 'run', 'r1-implement-partial.md'), 'utf8');
            expect(artifact).toContain('## resolved invocation');
            expect(artifact).toContain('omp --auto --mode implement');
            expect(artifact).toContain(`cwd: ${dir}`);
            expect(artifact).toContain('timeoutMs: 120000');
            expect(artifact).toContain('continue: true');
            expect(artifact).toContain('output: buffered');
            expect(artifact).toContain('stdinInteractive: false');
            expect(artifact).toContain('translatedFrom: /sp:dev-run');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

// ---------------------------------------------------------------------------
// Tests: R3 / task 0295 — non-interactive contract (always buffered)
// ---------------------------------------------------------------------------

describe('AgentRunActionRunner non-interactive contract (R3 / task 0295)', () => {
    // R3: regardless of the `capture` flag, the action MUST dispatch via
    // `runTraced` (never `run` or `runCapture`) so AgentService forces
    // buffered output and the subprocess cannot stall on an interactive stdin.
    test('capture:false still dispatches through runTraced (not run)', async () => {
        let runCalled = false;
        let runCaptureCalled = false;
        let runTracedCalled = false;
        const svc = {
            run: async () => {
                runCalled = true;
                return 0;
            },
            runCapture: async () => {
                runCaptureCalled = true;
                return { exitCode: 0, answer: '' };
            },
            runTraced: async () => {
                runTracedCalled = true;
                return { exitCode: 0, stdout: '', invocation: invocation() };
            },
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        await runner.execute({ input: 'hello' }, makeCtx());
        expect(runTracedCalled).toBe(true);
        expect(runCalled).toBe(false);
        expect(runCaptureCalled).toBe(false);
    });

    test('capture:true dispatches through runTraced (not runCapture)', async () => {
        let runCaptureCalled = false;
        let runTracedCalled = false;
        const svc = {
            runCapture: async () => {
                runCaptureCalled = true;
                return { exitCode: 0, answer: '' };
            },
            runTraced: async () => {
                runTracedCalled = true;
                return { exitCode: 0, stdout: 'captured', invocation: invocation() };
            },
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc);
        await runner.execute({ input: 'hello', capture: true }, makeCtx());
        expect(runTracedCalled).toBe(true);
        expect(runCaptureCalled).toBe(false);
    });

    test('capture:false but AgentService buffered the output → data still has no answer', async () => {
        // The R3 contract: output is ALWAYS buffered at the service layer; the
        // `capture` flag only controls whether the action surfaces it in data.
        const svc = svcWithRunTraced({
            exitCode: 0,
            stdout: 'should-not-leak-as-answer',
            invocation: invocation(),
        });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'hello' }, makeCtx());
        expect(result.ok).toBe(true);
        expect(result.data).not.toHaveProperty('answer');
    });

    test('translated slash command records buffered output and ignored stdin', async () => {
        // Even when the workflow passes a slash command like `/sp:dev-run ... --auto`,
        // the captured invocation must show ignored stdin and buffered output —
        // proving the dispatch path never exposes the parent TTY to the subprocess.
        const svc = svcWithRunTraced({
            exitCode: 0,
            stdout: 'done',
            invocation: invocation({
                outputMode: 'buffered',
                stdinInteractive: false,
                translatedFrom: '/sp:dev-run 0042 --auto',
            }),
        });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: '/sp:dev-run 0042 --auto' }, makeCtx());
        expect(result.ok).toBe(true);
        // Narrow result.data.invocation with `in` guards; no casts (data is
        // Record<string, unknown> → invocation is unknown).
        const data = result.data;
        const inv = data !== undefined && 'invocation' in data ? data.invocation : undefined;
        const stdinInteractive =
            inv !== undefined && inv !== null && typeof inv === 'object' && 'stdinInteractive' in inv
                ? inv.stdinInteractive
                : 'no-invocation';
        const outputMode =
            inv !== undefined && inv !== null && typeof inv === 'object' && 'outputMode' in inv
                ? inv.outputMode
                : 'no-invocation';
        expect(stdinInteractive).toBe(false);
        expect(outputMode).toBe('buffered');
    });
});

// ---------------------------------------------------------------------------
// Tests: R4 / task 0295 — timeout / cancellation cleanup + actionable errors
// ---------------------------------------------------------------------------

describe('AgentRunActionRunner timeout & cancellation (R4 / task 0295)', () => {
    let dir: string;
    afterEach(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    test('signal-terminated run produces a signal-specific error message', async () => {
        const svc = svcWithRunTraced({
            exitCode: 137,
            stdout: '',
            signal: 'SIGTERM',
            invocation: invocation(),
        });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'go', timeoutMs: 30_000 }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain("agent.run 's1'");
        expect(result.error).toContain('terminated by signal SIGTERM');
        expect(result.error).toContain('configured timeout: 30000ms');
    });

    test('dispatch error (validation message) produces a dispatch-specific error message', async () => {
        const svc = svcWithRunTraced({ exitCode: 2, stdout: '', message: 'agent spec missing' });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'go' }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('dispatch failed');
        expect(result.error).toContain('agent spec missing');
    });

    test('plain non-zero exit (no signal, no message) produces exit-code error message', async () => {
        const svc = svcWithRunTraced({ exitCode: 5, stdout: '', invocation: invocation() });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute({ input: 'go' }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain("agent.run 's1' (<default>) exited with code 5");
        // R2 (task 0424): subprocess failures name the partial-work artifact
        // path and the resume runbook — a timed-out implement must not dead-end.
        expect(result.error).toContain('.spur/run/test-1-s1-partial.md');
        expect(result.error).toContain('execution-workflow.md');
        expect(result.error).not.toContain('signal');
        expect(result.error).not.toContain('dispatch');
    });

    test('signal failure writes partial-work artifact with signal reason + duration', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const svc = svcWithRunTraced({
            exitCode: 137,
            stdout: 'partial stdout',
            stderr: 'killed',
            durationMs: 29_999,
            signal: 'SIGKILL',
            invocation: invocation({ timeoutMs: 30_000 }),
        });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute(
            { input: 'go', timeoutMs: 30_000 },
            makeCtx({ runId: 'sig-run', stateOrNodeId: 'implement', workdir: dir }),
        );
        expect(result.ok).toBe(false);

        const artifact = readFileSync(join(dir, '.spur', 'run', 'sig-run-implement-partial.md'), 'utf8');
        expect(artifact).toContain('killed by signal SIGKILL');
        expect(artifact).toContain('29999ms');
        expect(artifact).toContain('timeoutMs: 30000');
        expect(artifact).toContain('partial stdout');
        expect(artifact).toContain('killed');
    });

    test('dispatch failure (no invocation) writes artifact with dispatch-error reason', async () => {
        dir = mkdtempSync(join(tmpdir(), 'agent-run-'));
        const svc = svcWithRunTraced({ exitCode: 2, stdout: '', message: 'invalid mode' });
        const runner = new AgentRunActionRunner(svc);
        const result = await runner.execute(
            { input: 'go' },
            makeCtx({ runId: 'disp-run', stateOrNodeId: 'implement', workdir: dir }),
        );
        expect(result.ok).toBe(false);

        const artifact = readFileSync(join(dir, '.spur', 'run', 'disp-run-implement-partial.md'), 'utf8');
        expect(artifact).toContain('dispatch error: invalid mode');
        expect(artifact).toContain('(invocation not captured)');
    });
});

// ---------------------------------------------------------------------------
// Tests: feature D2 / task 0426 — child-agent lifecycle fans out to the
// observability bus; the consolidated run-log sink subscribes there.
// ---------------------------------------------------------------------------

/** Build a fake AgentService whose `runTraced` invokes the execution observer with lifecycle events. */
function svcInvokingObserver(
    emit: (observer: AgentExecutionObserver) => void,
    result: Partial<AgentRunTracedResult> = {},
): AgentService {
    const full: AgentRunTracedResult = { exitCode: 0, stdout: '', invocation: invocation(), ...result };
    return {
        runTraced: async (
            _input: string | undefined,
            _flags: Record<string, string | boolean>,
            _deps?: unknown,
            execution?: AgentExecutionOptions,
        ) => {
            if (execution?.observer !== undefined) emit(execution.observer);
            return full;
        },
    } as unknown as AgentService;
}

function outputEvent(overrides: Partial<Extract<AgentExecutionEvent, { kind: 'output' }>> = {}): AgentExecutionEvent {
    return {
        kind: 'output',
        schemaVersion: 1,
        eventId: 'e-out',
        sequence: 2,
        runId: 'test-1',
        executionId: 'execution-1',
        actionId: 'test-1:s1',
        at: '2026-08-02T00:00:02.000Z',
        stream: 'stdout',
        chunk: 'working on phase A',
        ...overrides,
    };
}

function startedEvent(): AgentExecutionEvent {
    return {
        kind: 'started',
        schemaVersion: 1,
        eventId: 'e-st',
        sequence: 1,
        runId: 'test-1',
        executionId: 'execution-1',
        actionId: 'test-1:s1',
        at: '2026-08-02T00:00:01.000Z',
        agent: 'claude',
        invocation: 'claude -p hi',
    };
}

function finishedEvent(): AgentExecutionEvent {
    return {
        kind: 'finished',
        schemaVersion: 1,
        eventId: 'e-fin',
        sequence: 3,
        runId: 'test-1',
        executionId: 'execution-1',
        actionId: 'test-1:s1',
        at: '2026-08-02T00:00:10.000Z',
        outcome: 'done',
        exitCode: 0,
        durationMs: 9_000,
        usage: 'unavailable',
    };
}

function recordingBus(): { bus: WorkflowObservabilityBus; events: AgentExecutionEvent[] } {
    const bus = new EventBus<WorkflowObservabilityEventMap>();
    const events: AgentExecutionEvent[] = [];
    bus.on('workflow.agent', (event) => events.push(event));
    return { bus, events };
}

describe('AgentRunActionRunner child-agent lifecycle fan-out (task 0426)', () => {
    test('emits started/output/finished lifecycle events to the observability bus', async () => {
        const svc = svcInvokingObserver((observer) => {
            observer(startedEvent());
            observer(outputEvent());
            observer(finishedEvent());
        });
        const { bus, events } = recordingBus();
        const runner = new AgentRunActionRunner(svc, bus);
        const result = await runner.execute({ input: 'hello' }, makeCtx({ runId: 'test-1' }));
        expect(result.ok).toBe(true);
        expect(events.map((e) => e.kind)).toEqual(['started', 'output', 'finished']);
        expect(events[0]).toMatchObject({ agent: 'claude', invocation: 'claude -p hi' });
        expect(events[1]).toMatchObject({ stream: 'stdout', chunk: 'working on phase A' });
        expect(events[2]).toMatchObject({ outcome: 'done', exitCode: 0 });
    });

    test('emits output chunks to the bus during a buffered run', async () => {
        const svc = svcInvokingObserver((observer) => {
            observer(outputEvent({ chunk: 'mid-run progress' }));
        });
        const { bus, events } = recordingBus();
        const runner = new AgentRunActionRunner(svc, bus);
        const result = await runner.execute({ input: 'hello' }, makeCtx({ runId: 'test-1' }));
        expect(result.ok).toBe(true);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ kind: 'output', chunk: 'mid-run progress' });
    });

    test('runs without a bus — the observer is omitted and no-op', async () => {
        const runner = new AgentRunActionRunner(svcWithRunTraced({ exitCode: 0, stdout: '' }));
        const result = await runner.execute({ input: 'hello' }, makeCtx({ runId: 'test-1' }));
        expect(result.ok).toBe(true);
    });

    test('writes no per-step artifact file (subsumed by the consolidated run log)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'agent-run-0426-'));
        const { bus } = recordingBus();
        const runner = new AgentRunActionRunner(svcWithRunTraced({ exitCode: 0, stdout: '' }), bus);
        await runner.execute({ input: 'hello' }, makeCtx({ runId: 'test-1', workdir: dir }));
        expect(existsSync(join(dir, '.spur', 'run', 'test-1-output.log'))).toBe(false);
        expect(existsSync(join(dir, '.spur', 'run', 'test-1.log'))).toBe(false);
        rmSync(dir, { recursive: true, force: true });
    });
});
