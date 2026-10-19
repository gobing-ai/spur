import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { DoctorRunner } from '@gobing-ai/ts-ai-runner';
import { _resetAgentServiceShimsForTest, AgentResolver } from '../../src/services/agent-resolver';
import type { AgentRoleDefinition, AgentServiceContext } from '../../src/services/agent-service';
import type { AgentExecutorConfig } from '../../src/services/executor-tier';

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

/** A resolver over an explicit executor roster (1255 capability-walk cases). */
function resolverWithExecutors(executors: AgentExecutorConfig[]): AgentResolver {
    return new AgentResolver({
        cwd: process.cwd(),
        env: {},
        output: { write: () => {}, error: () => {} },
        roles: ROLES,
        agentConfig: { executors },
    });
}

/** An executor entry attesting the execution axes a write-capable stage requires. */
function attested(name: string, agent: string): AgentExecutorConfig {
    return {
        name,
        agent,
        tier: 'standard',
        disabled: false,
        executionCapabilities: {
            version: 1,
            axes: {
                fsWrite: { state: 'available', provenance: 'operator-configured' },
                processSpawn: { state: 'available', provenance: 'operator-configured' },
            },
        },
    };
}

describe('AgentResolver capability-aware role walk (1255 R3-R5)', () => {
    const WRITE_STAGE = JSON.stringify({ fsWrite: 'available', processSpawn: 'available' });

    test('an incapable first candidate is skipped for the attested next one', async () => {
        const resolver = resolverWithExecutors([
            { name: 'unattested', agent: 'omp', tier: 'standard', disabled: false },
            attested('attested', 'pi'),
        ]);
        const withRequirements = await resolver.resolveAgent(
            { agent: 'auto', role: 'coder', requiresCapabilities: WRITE_STAGE },
            usableDoctor(),
        );
        expect(withRequirements.ok && withRequirements.executor).toBe('attested');
        // No requirement means unchanged resolution: config order still wins (AC3).
        const without = await resolver.resolveAgent({ agent: 'auto', role: 'coder' }, usableDoctor());
        expect(without.ok && without.executor).toBe('unattested');
    });

    test('an all-incapable roster fails naming each rejected executor and its unmet axes', async () => {
        const resolver = resolverWithExecutors([
            { name: 'unattested', agent: 'omp', tier: 'standard', disabled: false },
        ]);
        const result = await resolver.resolveAgent(
            { agent: 'auto', role: 'coder', requiresCapabilities: WRITE_STAGE },
            usableDoctor(),
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.message).toContain('unattested');
            expect(result.message).toContain('unmet execution capability');
            expect(result.message).toContain('fsWrite: unknown');
            // Bounded diagnostics: no config blob or env value rides the message.
            expect(result.message).not.toContain('operator-configured');
        }
    });

    test('a mixed rejection names the usability leg separately from the capability leg', async () => {
        const doctor = {
            runOne: mock(async (agent: string) => ({
                agent,
                installed: agent !== 'omp',
                version: agent === 'omp' ? null : '1.0.0',
                authenticated: 'authenticated',
                usable: agent !== 'omp',
                tier: 1,
                channels: [],
                error: agent === 'omp' ? 'not installed' : null,
            })),
        } as unknown as DoctorRunner;
        const resolver = resolverWithExecutors([
            { name: 'cap-skip', agent: 'pi', tier: 'standard', disabled: false },
            attested('doc-reject', 'omp'),
        ]);
        const result = await resolver.resolveAgent(
            { agent: 'auto', role: 'coder', requiresCapabilities: WRITE_STAGE },
            doctor,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.message).toContain('unusable: doc-reject');
            expect(result.message).toContain('skipped for unmet stage requiresCapabilities: cap-skip');
            // The capability clause must not absorb the usability-rejected executor.
            expect(result.message.split('requiresCapabilities:')[1]).not.toContain('doc-reject');
        }
    });

    test('a malformed requirement flag leaves the walk unchanged', async () => {
        const resolver = resolverWithExecutors([
            { name: 'unattested', agent: 'omp', tier: 'standard', disabled: false },
            attested('attested', 'pi'),
        ]);
        const result = await resolver.resolveAgent(
            { agent: 'auto', role: 'coder', requiresCapabilities: '{not json' },
            usableDoctor(),
        );
        expect(result.ok && result.executor).toBe('unattested');
    });
});

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
