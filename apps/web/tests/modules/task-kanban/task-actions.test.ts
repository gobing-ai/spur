import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TASK_STATUSES } from '@gobing-ai/spur-domain/schema';
import { parse as parseYaml } from 'yaml';
import {
    TASK_ACTION_LABELS,
    TASK_FSM_TRANSITIONS,
    TASK_STATUS_ACTIONS,
} from '../../../src/modules/task-kanban/task-actions';

describe('task-actions constants', () => {
    test('keys the action table by every canonical TaskStatus (no parallel status list)', () => {
        for (const status of TASK_STATUSES) {
            expect(TASK_STATUS_ACTIONS[status]).toBeArray();
        }
    });

    test('offers deprecate from every legal source state and undeprecate/cancel from deprecated (1191 R3)', () => {
        // ADR-137 §4.1: `deprecated` is reachable from every state but cancelled.
        for (const status of ['backlog', 'todo', 'wip', 'testing', 'blocked', 'done']) {
            expect(TASK_STATUS_ACTIONS[status]).toContain('deprecate');
        }
        expect(TASK_STATUS_ACTIONS.deprecated).toEqual(['undeprecate', 'cancel']);
        expect(TASK_STATUS_ACTIONS.cancelled).toEqual([]);
    });

    test('labels the deprecate pair (1191 R3)', () => {
        expect(TASK_ACTION_LABELS.deprecate).toBe('Deprecate');
        expect(TASK_ACTION_LABELS.undeprecate).toBe('Un-deprecate');
    });

    test('maps the deprecate pair onto their lifecycle targets (1191 R3)', () => {
        expect(TASK_FSM_TRANSITIONS.deprecate).toBe('deprecated');
        // ADR-137 §4.1: `todo` is the only un-freeze exit (plus `cancelled` for removal).
        expect(TASK_FSM_TRANSITIONS.undeprecate).toBe('todo');
    });

    test('every action surfaced in any status list has a label', () => {
        for (const actions of Object.values(TASK_STATUS_ACTIONS)) {
            for (const action of actions) {
                expect(TASK_ACTION_LABELS[action]).toBeDefined();
            }
        }
    });
});

/**
 * Legality floor — every FSM button the action group surfaces must be a legal transition
 * under the task lifecycle state machine (the canonical task-lifecycle workflow definition). The
 * `deprecated` state has no forward edge, so the invariant is what keeps the Board from
 * offering a transition the graph would refuse (1191 R3). Mirrors the F42 feature-side
 * floor in `apps/web/tests/modules/features/feature-actions.test.ts`.
 */
interface StateMachineDef {
    kind?: string;
    name: string;
    states: { id: string }[];
    transitions: { from: string; to: string }[];
    terminalStates?: string[];
}

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const FSM_YAML = parseYaml(
    readFileSync(join(REPO_ROOT, 'config', 'workflows', 'task-lifecycle.yaml'), 'utf-8'),
) as StateMachineDef;

/** Legal outbound targets per status, derived from the FSM authority. */
const LEGAL_TARGETS: Record<string, Set<string>> = {};
for (const state of FSM_YAML.states) LEGAL_TARGETS[state.id] = new Set();
for (const t of FSM_YAML.transitions) {
    if (!LEGAL_TARGETS[t.from]) LEGAL_TARGETS[t.from] = new Set();
    LEGAL_TARGETS[t.from]?.add(t.to);
}

const TERMINAL_STATUSES = FSM_YAML.terminalStates ?? [];

describe('task action group — task-lifecycle legality floor (1191 R3)', () => {
    test('the graph declares every canonical TaskStatus as a state', () => {
        for (const status of TASK_STATUSES) {
            expect(FSM_YAML.states.map((s) => s.id)).toContain(status);
        }
    });

    test('every surfaced FSM action is a legal transition from that status', () => {
        const violations: string[] = [];
        for (const [status, actions] of Object.entries(TASK_STATUS_ACTIONS)) {
            for (const action of actions) {
                const target = TASK_FSM_TRANSITIONS[action];
                if (target === undefined) continue; // workflow actions are not FSM transitions
                const legal = LEGAL_TARGETS[status];
                if (!legal?.has(target)) {
                    violations.push(`${status}.${action} → ${target} is illegal under task-lifecycle FSM`);
                }
            }
        }
        expect(violations).toEqual([]);
    });

    test('terminal statuses surface no FSM action buttons (no egress from terminal)', () => {
        // `cancelled` is the sole declared terminal status and has no outbound transition,
        // so it must surface zero FSM buttons. `deprecated` is deliberately absent from
        // `terminalStates` (ADR-137): it surfaces only its two legal exits.
        for (const status of TERMINAL_STATUSES) {
            const surfaced = (TASK_STATUS_ACTIONS[status] ?? []).filter((a) => TASK_FSM_TRANSITIONS[a] !== undefined);
            expect(surfaced).toEqual([]);
        }
    });
});
