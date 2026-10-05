import { describe, expect, test } from 'bun:test';
import { type ResolvedFleetMember, resolveAgentSelector, resolveRoleTarget } from '../../src/index';

/**
 * G72 R1: role/executor addressing resolves over the DECLARED fleet members
 * (`FleetService.resolve`), never over spec files — the derived roster replaced the
 * instance store, so a stale `.spur/agents/` file is not addressable.
 */
function member(instanceId: string, over: Partial<ResolvedFleetMember> = {}): ResolvedFleetMember {
    return {
        instanceId,
        executor: 'omp',
        enabled: true,
        writeCapable: false,
        capabilityState: 'unknown',
        ...over,
    };
}

const ROLES = ['scribe', 'coder', 'reviewer', 'planner'] as const;
const EXECUTORS = ['omp', 'claude', 'codex'] as const;

describe('resolveRoleTarget (G72 R1)', () => {
    test('a selector outside the vocabulary is unknown_selector, naming accepted names', async () => {
        const res = await resolveRoleTarget([member('demo-coder', { role: 'coder' })], 'nobody', ROLES, EXECUTORS);
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.code).toBe('unknown_selector');
        expect(res.message).toContain('reviewer');
        expect(res.message).toContain('claude');
    });

    test('a role with no declared member is selector_unmatched with count=0', async () => {
        const res = await resolveRoleTarget([member('demo-coder', { role: 'coder' })], 'planner', ROLES, EXECUTORS);
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.code).toBe('selector_unmatched');
        expect(res.message).toContain('count=0');
        expect(res.message).toContain('candidates: none');
    });

    test('two members of one role are selector_ambiguous, listing every candidate', async () => {
        const res = await resolveRoleTarget(
            [member('demo-scribe-a', { role: 'scribe' }), member('demo-scribe-b', { role: 'scribe' })],
            'scribe',
            ROLES,
            EXECUTORS,
        );
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.code).toBe('selector_ambiguous');
        expect(res.message).toContain('count=2');
        expect(res.message).toMatch(/demo-scribe-a.*demo-scribe-b/s);
    });

    test('exactly one match resolves to the member instance id', async () => {
        const res = await resolveRoleTarget(
            [member('demo-coder', { role: 'coder' }), member('demo-reviewer', { role: 'reviewer' })],
            'reviewer',
            ROLES,
            EXECUTORS,
        );
        expect(res).toEqual({ ok: true, specId: 'demo-reviewer', count: 1, candidates: ['demo-reviewer'] });
    });

    test('an executor name resolves by executor binding, not by role', async () => {
        const res = await resolveRoleTarget(
            [member('demo-a', { executor: 'claude' }), member('demo-b', { executor: 'omp' })],
            'claude',
            ROLES,
            EXECUTORS,
        );
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.specId).toBe('demo-a');
    });

    test('a name in both vocabularies is looked up as a role (the narrower intent)', async () => {
        const res = await resolveRoleTarget(
            [member('demo-role-coder', { role: 'coder' }), member('demo-exec-coder', { executor: 'coder' })],
            'coder',
            ROLES,
            [...EXECUTORS, 'coder'],
        );
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.specId).toBe('demo-role-coder');
        expect(res.count).toBe(1);
    });

    test('a disabled member is not addressable — it is not a running member', async () => {
        const res = await resolveRoleTarget(
            [member('demo-reviewer', { role: 'reviewer', enabled: false, executor: '' })],
            'reviewer',
            ROLES,
            EXECUTORS,
        );
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.code).toBe('selector_unmatched');
    });
});

describe('resolveAgentSelector (G72 R1)', () => {
    test('resolves over the listed fleet members with the configured executor vocabulary', async () => {
        const res = await resolveAgentSelector(
            async () => [member('alpha-reviewer-1', { role: 'reviewer' })],
            { executors: [{ name: 'capable-exec' }] },
            'reviewer',
        );
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.specId).toBe('alpha-reviewer-1');

        const byExecutor = await resolveAgentSelector(
            async () => [member('alpha-reviewer-1', { role: 'reviewer', executor: 'capable-exec' })],
            { executors: [{ name: 'capable-exec' }] },
            'capable-exec',
        );
        expect(byExecutor.ok).toBe(true);
    });
});
