import { describe, expect, test } from 'bun:test';
import type { ProcessStatus } from '../../../src/modules/projects/MemberTerminal';
import { buildRoster, isOrchestratorEntry } from '../../../src/modules/projects/roster';
import type { ProjectFleetSnapshot, ResolvedFleetMember } from '../../../src/modules/projects/useProjectContext';

function member(overrides: Partial<ResolvedFleetMember> = {}): ResolvedFleetMember {
    return {
        instanceId: 'a1',
        executor: 'claude',
        enabled: true,
        writeCapable: true,
        capabilityState: 'active',
        ...overrides,
    };
}

function proc(agentId: string, status = 'running', overrides: Partial<ProcessStatus> = {}): ProcessStatus {
    return { agentId, pid: 42, status, startedAt: '2026-09-12T10:00:00.000Z', exitCode: null, ...overrides };
}

function snapshot(overrides: Partial<ProjectFleetSnapshot> = {}): ProjectFleetSnapshot {
    return {
        path: '/repo/wt',
        strategy: { name: 'gtd', version: 1 },
        orchestrator: { state: 'bound-online', instanceId: 'orch' },
        members: [],
        capacity: { total: 0, enabled: 0, writeCapable: 0, missing: [] },
        ...overrides,
    };
}

function first(entries: ReturnType<typeof buildRoster>) {
    if (entries[0] === undefined) throw new Error('expected at least one roster entry');
    return entries[0];
}

// ── join steps 1-3: declared ⇄ observed ──

describe('buildRoster declared⇄observed join (0842 R1/R2)', () => {
    test('declared and running joins into one entry with observed facts', () => {
        const entries = buildRoster(snapshot({ members: [member({ instanceId: 'a1' })] }), [proc('a1')]);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
            instanceId: 'a1',
            observed: { status: 'running', pid: 42, startedAt: '2026-09-12T10:00:00.000Z', exitCode: null },
            issues: [],
        });
        expect(first(entries).declared?.instanceId).toBe('a1');
    });

    test('declared but no matching process → not-started with null pid (declared-but-not-running)', () => {
        const entries = buildRoster(snapshot({ members: [member({ instanceId: 'a1' })] }), []);
        expect(first(entries).observed).toEqual({ status: 'not-started', pid: null, startedAt: null, exitCode: null });
    });

    test('a matching process reporting an exit → observed exited with its exitCode', () => {
        const entries = buildRoster(snapshot({ members: [member({ instanceId: 'a1' })] }), [
            proc('a1', 'exited', { pid: 7, exitCode: 3 }),
        ]);
        expect(first(entries).observed.status).toBe('exited');
        expect(first(entries).observed.pid).toBe(7);
        expect(first(entries).observed.exitCode).toBe(3);
    });

    test('a live process with no declared member is appended as undeclared, never hidden', () => {
        const entries = buildRoster(snapshot(), [proc('hand-started')]);
        expect(entries).toHaveLength(1);
        expect(first(entries).declared).toBeNull();
        expect(first(entries).issues).toEqual(['undeclared']);
        expect(first(entries).observed.status).toBe('running');
    });

    test('board-operator is a mailbox, not a member — excluded from the roster (step 5)', () => {
        const entries = buildRoster(snapshot(), [proc('board-operator'), proc('a1')]);
        expect(entries.map((e) => e.instanceId)).toEqual(['a1']);
    });
});

// ── join step 3: orchestrator marking ──

describe('orchestrator marking (0842 step 3)', () => {
    test('bound-online with matching instanceId marks exactly that entry, placed first', () => {
        const entries = buildRoster(
            snapshot({ members: [member({ instanceId: 'a1' }), member({ instanceId: 'orch' })] }),
            [],
        );
        expect(entries.map((e) => [e.instanceId, e.isOrchestrator])).toEqual([
            ['orch', true],
            ['a1', false],
        ]);
    });

    test('missing / unresolvable bindings mark NOTHING — the roster never guesses', () => {
        for (const state of ['missing', 'unresolvable'] as const) {
            const entries = buildRoster(snapshot({ orchestrator: { state } }), [proc('orch')]);
            expect(entries.every((e) => !e.isOrchestrator)).toBe(true);
        }
    });

    test('bound-offline still marks the matching member (the offline fact renders on it)', () => {
        const entries = buildRoster(
            snapshot({
                orchestrator: { state: 'bound-offline', instanceId: 'orch' },
                members: [member({ instanceId: 'orch' })],
            }),
            [],
        );
        expect(first(entries).isOrchestrator).toBe(true);
    });

    test('isOrchestratorEntry requires the binding state to carry an instance', () => {
        expect(isOrchestratorEntry({ instanceId: 'orch' }, snapshot())).toBe(true);
        expect(isOrchestratorEntry({ instanceId: 'orch' }, snapshot({ orchestrator: { state: 'missing' } }))).toBe(
            false,
        );
    });
});

// ── join step 4: the issue resolver, in the frozen order ──

describe('issue resolver (0842 R5)', () => {
    test('capabilityState unavailable → executor-unavailable (a named state, distinct from offline)', () => {
        const entries = buildRoster(snapshot({ members: [member({ capabilityState: 'unavailable' })] }), []);
        expect(first(entries).issues).toEqual(['executor-unavailable']);
    });

    test('capabilityState unknown → capability-unknown (its own state, never a failure)', () => {
        const entries = buildRoster(snapshot({ members: [member({ capabilityState: 'unknown' })] }), []);
        expect(first(entries).issues).toEqual(['capability-unknown']);
    });

    test('enabled: false → disabled', () => {
        const entries = buildRoster(snapshot({ members: [member({ enabled: false })] }), []);
        expect(first(entries).issues).toEqual(['disabled']);
    });

    test('instanceId in capacity.missing → unresolved', () => {
        const entries = buildRoster(
            snapshot({ members: [member()], capacity: { total: 1, enabled: 1, writeCapable: 1, missing: ['a1'] } }),
            [],
        );
        expect(first(entries).issues).toEqual(['unresolved']);
    });

    test('multiple issues accumulate in the frozen order (disabled, executor-unavailable, capability-unknown, unresolved)', () => {
        const entries = buildRoster(
            snapshot({
                members: [member({ enabled: false, capabilityState: 'unavailable' })],
                capacity: { total: 1, enabled: 0, writeCapable: 1, missing: ['a1'] },
            }),
            [],
        );
        expect(first(entries).issues).toEqual(['disabled', 'executor-unavailable', 'unresolved']);
    });

    test('ordering: orchestrator first, then instanceId ascending — stable across polls', () => {
        const snap = snapshot({
            members: [member({ instanceId: 'c3' }), member({ instanceId: 'a1' }), member({ instanceId: 'b2' })],
        });
        const first = buildRoster(snap, []);
        const second = buildRoster(snap, []);
        expect(first.map((e) => e.instanceId)).toEqual(['a1', 'b2', 'c3']);
        expect(second).toEqual(first);
    });
});
