import { describe, expect, test } from 'bun:test';
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
});
