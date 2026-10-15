import { describe, expect, mock, test } from 'bun:test';
import type { DoctorRunner } from '@gobing-ai/ts-ai-runner';
import { AgentDoctorOps } from '../../src/services/agent-doctor-ops';
import { AgentResolver } from '../../src/services/agent-resolver';
import type { AgentRoleDefinition, AgentRunDeps, AgentServiceContext } from '../../src/services/agent-service';

// AgentDoctorOps holds `spur agent doctor`. agent-service.test.ts covers the report rendering in
// depth; these tests pin the collaborator's own routing: disabled-only rosters never probe, a
// role selector is elected through the shared AgentResolver, and the roles-fallback notice.

const ROLES = new Map<string, AgentRoleDefinition>([['coder', { tier: 'standard', stages: ['implement'] }]]);

function row(agent: string) {
    return {
        agent,
        installed: true,
        version: '1.0.0',
        authenticated: 'authenticated',
        usable: true,
        tier: 1,
        channels: [],
        error: null,
    };
}

function harness(ctxOverrides: Partial<AgentServiceContext> = {}) {
    const lines: string[] = [];
    const errors: string[] = [];
    const ctx: AgentServiceContext = {
        cwd: process.cwd(),
        env: {},
        output: { write: (m: string) => lines.push(m), error: (m: string) => errors.push(m) },
        ...ctxOverrides,
    };
    const resolver = new AgentResolver(ctx);
    return { ops: new AgentDoctorOps(ctx, resolver), resolver, lines, errors };
}

function doctorDeps(names: string[]): { deps: AgentRunDeps; runAll: ReturnType<typeof mock> } {
    const runAll = mock(async () => names.map(row));
    const doctorRunner = { runAll, runOne: mock(async (a: string) => row(a)) } as unknown as DoctorRunner;
    return { deps: { doctorRunner }, runAll };
}

describe('AgentDoctorOps.doctor', () => {
    test('a roster whose executors are all disabled probes nothing and still reports them', async () => {
        const { ops, lines } = harness({
            agentConfig: { executors: [{ name: 'off', agent: 'omp', disabled: true }] },
        });
        const { deps, runAll } = doctorDeps([]);
        expect(await ops.doctor({ json: true }, deps)).toBe(0);
        expect(runAll).not.toHaveBeenCalled();
        expect(lines.join('\n')).toContain('off');
    });

    test('a role selector elects its executor through AgentResolver.resolveRole', async () => {
        const { ops, resolver, lines } = harness({
            roles: ROLES,
            agentConfig: { executors: [{ name: 'c1', agent: 'omp', tier: 'standard', disabled: false }] },
        });
        const resolveRole = mock(resolver.resolveRole.bind(resolver));
        (resolver as unknown as { resolveRole: typeof resolveRole }).resolveRole = resolveRole;
        const { deps } = doctorDeps(['c1']);
        expect(await ops.doctor({ json: true, agent: 'coder' }, deps)).toBe(0);
        expect(resolveRole.mock.calls[0]?.[0]).toBe('coder');
        const parsed = JSON.parse(lines.join('')) as { agents?: Array<{ agent: string; elected?: string[] }> };
        const agents = parsed.agents ?? (parsed as unknown as { data: { agents: typeof parsed.agents } }).data.agents;
        expect(agents?.[0]?.agent).toBe('c1');
        expect(agents?.[0]?.elected).toEqual(['coder']);
    });

    test('the built-in roles fallback is announced on the text surface only', async () => {
        const text = harness({ rolesSource: 'fallback' });
        await text.ops.doctor({ json: false }, doctorDeps(['claude']).deps);
        expect(text.errors.some((e) => e.includes('DEFAULT_AGENT_ROLES fallback'))).toBe(true);
        const json = harness({ rolesSource: 'fallback' });
        await json.ops.doctor({ json: true }, doctorDeps(['claude']).deps);
        expect(json.errors.some((e) => e.includes('DEFAULT_AGENT_ROLES fallback'))).toBe(false);
    });
});
