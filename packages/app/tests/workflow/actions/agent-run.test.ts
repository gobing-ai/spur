import { describe, expect, test } from 'bun:test';
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
