import { describe, expect, test } from 'bun:test';
import type { AgentConfig } from '@gobing-ai/spur-config';
import { createCliContext } from '../src/context';
import type { CommandOutput } from '../src/output';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('context', () => {
    test('createCliContext returns CliContext with required fields', () => {
        const ctx = createCliContext({ output: nullOutput() });
        expect(ctx.cwd).toBeString();
        expect(ctx.env).toBeObject();
        expect(ctx.fs).toBeDefined();
        expect(ctx.output).toBeDefined();
        expect(typeof ctx.getDb).toBe('function');
        // Default setExitCode is the exported no-op — exercise it so V8 func coverage counts.
        expect(() => ctx.setExitCode(0)).not.toThrow();
    });

    test('hitlResponder under --json never prompts interactively (returns the configured default)', async () => {
        // With json=true the selection must yield the non-interactive default regardless of TTY,
        // so a confirm resolves to the default without reading stdin (no hang, no JSON corruption).
        const ctx = createCliContext({ output: nullOutput() });
        const responder = ctx.hitlResponder(true);
        const answer = await responder.respond({ kind: 'confirm', prompt: 'x', runId: 'r', node: 'n' });
        expect(answer.value).toBe('no'); // DefaultHitlResponder deny-by-default
    });

    test('agentService forwards optional events bus for the 0370 ledger bridge', () => {
        // Direct `spur agent run` path: context.agentService({ events }) must thread the
        // bus into AgentService without dropping agentConfig (R4 dual of workflow path).
        const sentinel = { kind: 'cli-events-bus' };
        const agentConfig = { default: 'pi' } as never;
        const ctx = createCliContext({
            output: nullOutput(),
            agentConfig,
        });
        const svc = ctx.agentService({ events: sentinel as never });
        // AgentService keeps context private; runtime field is `ctx`.
        const internal = svc as unknown as { ctx: { events?: unknown; agentConfig?: unknown } };
        expect(internal.ctx.events).toBe(sentinel);
        expect(internal.ctx.agentConfig).toBe(agentConfig);
    });

    test('merged Spur config exposes executors to direct agent command validation (0718 R3)', () => {
        const agentConfig = {
            executors: [{ name: 'configured', agent: 'pi', tier: 'standard' }],
        } as AgentConfig;
        const ctx = createCliContext({
            output: nullOutput(),
            spurConfig: { agent: agentConfig } as never,
        });

        expect(ctx.agentConfig).toBe(agentConfig);
    });

    test('createCliContext threads the merged role map so --agent <role> resolves without the plugin tree (0572 R1)', () => {
        const ctx = createCliContext({ output: nullOutput() });
        expect(ctx.agentRoles?.get('planner')?.tier).toBe('capable-2');
        const overridden = createCliContext({
            output: nullOutput(),
            agentConfig: { roles: { reviewer: { tier: 'capable-2' } } },
        });
        expect(overridden.agentRoles?.get('reviewer')?.tier).toBe('capable-2');
    });
});
