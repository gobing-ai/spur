import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { DoctorRunner } from '@gobing-ai/ts-ai-runner';
import { _resetAgentServiceShimsForTest, AgentResolver } from '../../src/services/agent-resolver';
import type { AgentRoleDefinition, AgentServiceContext } from '../../src/services/agent-service';

// AgentResolver is the `--agent` / role / stage resolution funnel AgentService owns. These tests
// pin its own state: the scoped fresh-roster override and the process-global bare-binary
// warn-once marker (with its test reset).

const ROLES = new Map<string, AgentRoleDefinition>([['coder', { tier: 'standard', stages: ['implement'] }]]);

function usableDoctor(): DoctorRunner {
    return {
        runOne: mock(async (agent: string) => ({
            agent,
            installed: true,
            version: '1.0.0',
            authenticated: 'authenticated',
            usable: true,
            tier: 1,
            channels: [],
            error: null,
        })),
    } as unknown as DoctorRunner;
}

function resolverWith(errors: string[] = []): AgentResolver {
    const ctx: AgentServiceContext = {
        cwd: process.cwd(),
        env: {},
        output: { write: () => {}, error: (m: string) => errors.push(m) },
        roles: ROLES,
        agentConfig: {
            executors: [
                { name: 'old-coder', agent: 'omp', tier: 'standard', disabled: false },
                { name: 'off-coder', agent: 'pi', tier: 'standard', disabled: true },
            ],
        },
    };
    return new AgentResolver(ctx);
}

beforeEach(() => {
    _resetAgentServiceShimsForTest();
});

describe('AgentResolver.withRosterOverride', () => {
    const fresh = [{ name: 'new-coder', agent: 'pi', tier: 'standard' as const, disabled: false }];

    test('role resolution inside the override walks the fresh roster', async () => {
        const resolver = resolverWith();
        const inside = await resolver.withRosterOverride(fresh, () =>
            resolver.resolveAgent({ agent: 'auto', role: 'coder' }, usableDoctor()),
        );
        expect(inside.ok && inside.executor).toBe('new-coder');
        const outside = await resolver.resolveAgent({ agent: 'auto', role: 'coder' }, usableDoctor());
        expect(outside.ok && outside.executor).toBe('old-coder');
    });

    test('the construction-time roster is restored even when the scoped call throws', async () => {
        const resolver = resolverWith();
        await expect(
            resolver.withRosterOverride(fresh, async () => {
                throw new Error('probe exploded');
            }),
        ).rejects.toThrow('probe exploded');
        const after = await resolver.resolveAgent({ agent: 'auto', role: 'coder' }, usableDoctor());
        expect(after.ok && after.executor).toBe('old-coder');
    });
});

describe('AgentResolver explicit selectors', () => {
    test('a bare coding-agent binary warns once per process until the test reset', async () => {
        const errors: string[] = [];
        const resolver = resolverWith(errors);
        const bareWarnings = () => errors.filter((e) => e.includes('bare coding-agent binary name')).length;
        expect((await resolver.resolveAgent({ agent: 'claude' }, usableDoctor())).ok).toBe(true);
        await resolver.resolveAgent({ agent: 'claude' }, usableDoctor());
        expect(bareWarnings()).toBe(1);
        _resetAgentServiceShimsForTest();
        await resolver.resolveAgent({ agent: 'claude' }, usableDoctor());
        expect(bareWarnings()).toBe(2);
    });

    test('a configured but disabled executor is refused with exit 2', async () => {
        const result = await resolverWith().resolveAgent({ agent: 'off-coder' }, usableDoctor());
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.exitCode).toBe(2);
            expect(result.message).toContain("Executor 'off-coder'");
            expect(result.message).toContain('disabled');
        }
    });
});
