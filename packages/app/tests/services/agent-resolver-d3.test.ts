import { describe, expect, mock, test } from 'bun:test';
import type { DoctorRunner } from '@gobing-ai/ts-ai-runner';
import type { AgentRunDeps } from '../../src/index';
import { AgentResolver } from '../../src/services/agent-resolver';
import type { AgentServiceContext } from '../../src/services/agent-service';

// D3 (task 1323) R3: after a timeout/unavailability failure the remaining
// ladder candidates are ordered by measured latency x success rate from the
// history stats, not declaration order alone. Empty history degrades to the
// static declaration order.

function usableDeps(): AgentRunDeps {
    return {
        doctorRunner: {
            runOne: mock((agent: string) =>
                Promise.resolve({
                    agent,
                    installed: true,
                    version: '1.0.0',
                    authenticated: 'authenticated',
                    usable: true,
                    tier: 1,
                    channels: [],
                    error: null,
                }),
            ),
        } as unknown as AgentRunDeps['doctorRunner'],
    };
}

function resolverWith(
    executors: { name: string; agent: string }[],
    latency: Record<string, { meanMs: number; samples: number; successRate?: number }>,
): AgentResolver {
    const ctx: AgentServiceContext = {
        cwd: '/tmp',
        env: {},
        output: { write: () => {}, error: () => {} },
        agentConfig: { executors: executors.map((e) => ({ ...e, tier: 'standard', disabled: false })) },
        historyLatency: async (keys: string[]) => {
            const out: Record<string, { meanMs: number; p95Ms?: number; samples: number; successRate: number }> = {};
            for (const key of keys) {
                const hit = latency[key];
                if (hit !== undefined)
                    out[key] = { meanMs: hit.meanMs, samples: hit.samples, successRate: hit.successRate ?? 1 };
            }
            return out;
        },
    };
    return new AgentResolver(ctx);
}

const threeExecutors = [
    { name: 'slow-a', agent: 'pi' },
    { name: 'fresh-b', agent: 'codex' },
    { name: 'fast-c', agent: 'claude' },
];

describe('1323 R3 — measured ladder ordering', () => {
    test('post-failure candidates are ordered by latency x success, not declaration order', async () => {
        const resolver = resolverWith(threeExecutors, {
            'slow-a': { meanMs: 9000, samples: 5, successRate: 0.5 },
            'fast-c': { meanMs: 1000, samples: 9, successRate: 0.99 },
        });
        const resolved = await resolver.resolveAgent(
            { agent: 'slow-a', stage: 'review', signal: 'resource-exhaustion', 'from-executor': 'slow-a' },
            usableDeps().doctorRunner as unknown as DoctorRunner,
            new Set(['slow-a']),
        );
        expect(resolved.ok).toBe(true);
        if (resolved.ok) {
            // fast-c (fast + reliable) outranks fresh-b (no history) and slow-a is excluded.
            expect(resolved.executor).toBe('fast-c');
            expect(resolved.ordering?.map((entry) => entry.executor)).toEqual(['fast-c', 'fresh-b']);
        }
    });

    test('empty history degrades to the static declaration order', async () => {
        const resolver = resolverWith(threeExecutors, {});
        const resolved = await resolver.resolveAgent(
            { agent: 'slow-a', stage: 'review', signal: 'resource-exhaustion', 'from-executor': 'slow-a' },
            usableDeps().doctorRunner as unknown as DoctorRunner,
            new Set(['slow-a']),
        );
        expect(resolved.ok).toBe(true);
        if (resolved.ok) {
            expect(resolved.executor).toBe('fresh-b');
            expect(resolved.ordering).toBeUndefined();
        }
    });
});
