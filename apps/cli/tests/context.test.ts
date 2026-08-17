import { describe, expect, test } from 'bun:test';
import { createCliContext, resolveAgentRoles } from '../src/context';
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

    // ---- Layer-1 role resolution (task 0572): code defaults + agent.roles merge ----

    test('resolveAgentRoles without config returns DEFAULT_AGENT_ROLES wholesale (0572 R1)', () => {
        const roles = resolveAgentRoles();
        expect([...roles.keys()].sort()).toEqual(['coder', 'planner', 'reviewer', 'scribe']);
        expect(roles.get('scribe')).toEqual({ tier: 'cheap', stages: ['changelog'] });
        expect(roles.get('reviewer')).toEqual({ tier: 'capable-1', stages: ['verify', 'review', 'dogfood'] });
    });

    test('resolveAgentRoles merges agent.roles per-field: override wins, omitted fields keep defaults (0572 R2)', () => {
        const roles = resolveAgentRoles({
            roles: { reviewer: { tier: 'capable-2' }, coder: { stages: ['implement'] } },
        });
        // Re-tier without restating stages → stages stay default, tier overridden.
        expect(roles.get('reviewer')).toEqual({ tier: 'capable-2', stages: ['verify', 'review', 'dogfood'] });
        // Re-stage without restating tier → tier stays default, stages overridden.
        expect(roles.get('coder')).toEqual({ tier: 'standard', stages: ['implement'] });
        // A role absent from the override map uses the default wholesale.
        expect(roles.get('scribe')).toEqual({ tier: 'cheap', stages: ['changelog'] });
        expect(roles.get('planner')).toEqual({ tier: 'capable-2', stages: ['plan', 'refine', 'brainstorm'] });
    });

    test('resolveAgentRoles rejects an unknown override stage id, naming role and id (0572 R10)', () => {
        expect(() => resolveAgentRoles({ roles: { coder: { stages: ['implment'] } } })).toThrow(
            /agent\.roles\.coder\.stages.*implment/,
        );
    });

    test('resolveAgentRoles rejects an empty override stages array from a non-schema caller (0572 R10)', () => {
        expect(() => resolveAgentRoles({ roles: { reviewer: { stages: [] } } })).toThrow(
            /agent\.roles\.reviewer\.stages.*empty stages array/,
        );
    });

    test('resolveAgentRoles rejects a re-tier below the folded-stage floor (roles R4 / 0572 R10)', () => {
        // coder folds implement (min_tier standard) — cheap would start the run below the floor.
        expect(() => resolveAgentRoles({ roles: { coder: { tier: 'cheap' } } })).toThrow(
            /agent\.roles\.coder.*'cheap'.*implement/,
        );
    });

    test('resolveAgentRoles rejects a re-stage that raises the floor above the kept default tier (0572 R10)', () => {
        // scribe keeps tier cheap; folding verify/review (min_tier capable-1) breaks the floor.
        expect(() => resolveAgentRoles({ roles: { scribe: { stages: ['verify', 'review'] } } })).toThrow(
            /agent\.roles\.scribe.*'cheap'/,
        );
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
