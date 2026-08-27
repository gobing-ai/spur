import { describe, expect, test } from 'bun:test';
import type { AgentSpec } from '@gobing-ai/ts-ai-runner';
import { createFileAgentInstanceStore, resolveRoleTarget } from '../../src/services/agent-instance-store';

/** Minimal spec stubs — the store is structural over what listAgentSpecs returns. */
function spec(overrides: Partial<AgentSpec> & { id: string }): AgentSpec {
    return { type: 'claude', ...overrides } as unknown as AgentSpec;
}

const SPECS: AgentSpec[] = [
    spec({
        id: 'demo-coder',
        executor: 'omp',
        workspace: '/tmp',
        tags: ['team:demo', 'spur:generated'],
        config: { role: 'coder' },
    }),
    spec({
        id: 'demo-reviewer',
        executor: 'claude',
        workspace: '/tmp',
        tags: ['team:demo'],
        config: { role: 'reviewer' },
    }),
    spec({ id: 'demo-scribe-a', executor: 'omp', workspace: '/w2', tags: ['team:demo'], config: { role: 'scribe' } }),
    spec({ id: 'demo-scribe-b', executor: 'codex', workspace: '/w2', tags: ['team:demo'], config: { role: 'scribe' } }),
    spec({ id: 'solo', workspace: '/x', config: {} }),
];

const ROLES = ['scribe', 'coder', 'reviewer', 'planner'] as const;
const EXECUTORS = ['omp', 'claude', 'codex'] as const;

function store() {
    return createFileAgentInstanceStore(async () => SPECS);
}

describe('createFileAgentInstanceStore (0685 R2)', () => {
    test('projects specs onto the frozen AgentInstance shape', async () => {
        const coder = await store().bySpecId('demo-coder');
        expect(coder).toMatchObject({
            specId: 'demo-coder',
            teamId: 'demo',
            memberKey: 'coder',
            role: 'coder',
            executor: 'omp',
            workspace: '/tmp',
            status: 'stopped',
            pid: null,
            runId: null,
            generation: null,
            createdAt: 0,
            updatedAt: 0,
        });
    });

    test('untethered spec has teamId null; unassigned role is null', async () => {
        const solo = await store().bySpecId('solo');
        expect(solo?.teamId).toBeNull();
        expect(solo?.memberKey).toBe('solo');
        expect(solo?.role).toBeNull();
        expect(await store().bySpecId('missing')).toBeNull();
    });

    test('byRole matches only the configured Layer-1 role', async () => {
        const scribes = await store().byRole('scribe');
        expect(scribes.map((i) => i.specId).sort()).toEqual(['demo-scribe-a', 'demo-scribe-b']);
        expect(await store().byRole('planner')).toEqual([]);
    });

    test('byExecutor matches the resolved binding regardless of role', async () => {
        const omp = await store().byExecutor('omp');
        expect(omp.map((i) => i.specId).sort()).toEqual(['demo-coder', 'demo-scribe-a']);
    });
});

describe('resolveRoleTarget (0685 R6)', () => {
    test('unknown selector names the accepted vocabulary (usage)', async () => {
        const res = await resolveRoleTarget(store(), 'nobody', ROLES, EXECUTORS);
        expect(res.ok).toBe(false);
        if (!res.ok) {
            expect(res.code).toBe('unknown_selector');
            expect(res.message).toContain('planner');
            expect(res.message).toContain('codex');
        }
    });

    test('zero matches are a hard error naming the lookup kind', async () => {
        const res = await resolveRoleTarget(store(), 'planner', ROLES, EXECUTORS);
        expect(res.ok).toBe(false);
        if (!res.ok) {
            expect(res.code).toBe('selector_unmatched');
            expect(res.message).toContain('role');
            expect(res.message).toContain('count=0');
            expect(res.message).toContain('candidates: none');
        }
        const resExec = await resolveRoleTarget(store(), 'gemini', [], [...EXECUTORS, 'gemini']);
        expect(resExec.ok).toBe(false);
        if (!resExec.ok) {
            expect(resExec.code).toBe('selector_unmatched');
            expect(resExec.message).toContain('executor');
        }
    });

    test('multi matches are a hard error naming count and candidates', async () => {
        const res = await resolveRoleTarget(store(), 'scribe', ROLES, EXECUTORS);
        expect(res.ok).toBe(false);
        if (!res.ok) {
            expect(res.code).toBe('selector_ambiguous');
            expect(res.message).toContain('count=2');
            expect(res.message).toContain('demo-scribe-a');
            expect(res.message).toContain('demo-scribe-b');
        }
    });

    test('exact one match resolves to the full spec id', async () => {
        const res = await resolveRoleTarget(store(), 'reviewer', ROLES, EXECUTORS);
        expect(res).toMatchObject({ ok: true, specId: 'demo-reviewer' });
        const resExec = await resolveRoleTarget(store(), 'codex', ROLES, EXECUTORS);
        expect(resExec).toMatchObject({ ok: true, specId: 'demo-scribe-b' });
    });

    test('role wins when a name exists in both vocabularies', async () => {
        // A spec configured with role "omp" (a role sharing an executor name)
        // resolves byRole; only its own instance matches.
        const extra = createFileAgentInstanceStore(async () => [
            spec({ id: 'weird-role-holder', config: { role: 'omp' } }),
            spec({ id: 'real-executor', executor: 'omp', config: {} }),
        ]);
        const res = await resolveRoleTarget(extra, 'omp', [...ROLES, 'omp'], EXECUTORS);
        expect(res).toMatchObject({ ok: true, specId: 'weird-role-holder' });
    });
});
