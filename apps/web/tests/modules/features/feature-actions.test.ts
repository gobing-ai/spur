import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
    AGENT_ACTIONS,
    CREATE_ACTIONS,
    FEATURE_ACTION_LABELS,
    FEATURE_STATUS_ACTIONS,
    FSM_ACTIONS,
    FSM_TRANSITION_TARGET,
    LINK_ACTIONS,
} from '../../../src/modules/features/feature-actions';

describe('feature-actions constants', () => {
    test('defines expected status actions', () => {
        expect(FEATURE_STATUS_ACTIONS.backlog).toContain('brainstorm');
        expect(FEATURE_STATUS_ACTIONS.active).toContain('add-task');
        expect(FEATURE_STATUS_ACTIONS.done).toEqual([]);
    });

    test('defines labels for each action', () => {
        expect(FEATURE_ACTION_LABELS.brainstorm).toBe('Brainstorm');
        expect(FEATURE_ACTION_LABELS.plan).toBe('Plan');
    });

    test('correctly maps FSM transition targets', () => {
        expect(FSM_ACTIONS.start).toBe(true);
        expect(FSM_TRANSITION_TARGET.start).toBe('active');
        expect(FSM_TRANSITION_TARGET.complete).toBe('done');
    });

    test('categorizes agent, create, and link actions', () => {
        expect(AGENT_ACTIONS.brainstorm).toBe(true);
        expect(CREATE_ACTIONS['add-task']).toBe(true);
        expect(LINK_ACTIONS['link-task']).toBe(true);
    });
});

/**
 * Legality floor — every FSM button surfaced by the action group must be a legal
 * transition under the feature-lifecycle state machine (runtime path:
 * `.spur/workflows/feature-lifecycle.yaml`). This is the invariant the 0351 decision
 * matrix's `never (illegal)` rows rest on: the action group is the user-facing
 * guardrail against illegal transitions (SchemaLifecyclePort is same-status only —
 * packages/app/src/services/planning-write-service.ts). If this test fails, either the
 * button map or the FSM drifted; the matrix in docs/tasks3/0351 must be re-evaluated.
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
    readFileSync(join(REPO_ROOT, '.spur', 'workflows', 'feature-lifecycle.yaml'), 'utf-8'),
) as StateMachineDef;

/** Legal outbound targets per status, derived from the FSM authority. */
const LEGAL_TARGETS: Record<string, Set<string>> = {};
for (const state of FSM_YAML.states) LEGAL_TARGETS[state.id] = new Set();
for (const t of FSM_YAML.transitions) {
    const from = t.from;
    if (!LEGAL_TARGETS[from]) LEGAL_TARGETS[from] = new Set();
    LEGAL_TARGETS[from]?.add(t.to);
}

const TERMINAL_STATUSES = FSM_YAML.terminalStates ?? [];

describe('feature action group — FSM legality floor (0351 matrix invariant)', () => {
    test('every surfaced FSM action is a legal transition from that status', () => {
        const violations: string[] = [];
        for (const [status, actions] of Object.entries(FEATURE_STATUS_ACTIONS)) {
            for (const action of actions) {
                if (!FSM_ACTIONS[action]) continue; // non-FSM buttons are not FSM-guarded
                const target = FSM_TRANSITION_TARGET[action];
                const legal = LEGAL_TARGETS[status];
                if (!target || !legal?.has(target)) {
                    violations.push(
                        `${status}.${action} → ${target ?? '(none)'} is illegal under feature-lifecycle FSM`,
                    );
                }
            }
        }
        expect(violations).toEqual([]);
    });

    test('terminal statuses surface no FSM action buttons (no egress from terminal)', () => {
        // `done` has no outbound transitions in the YAML; `cancelled` is declared terminal.
        // Both must surface zero FSM buttons — the matrix's "terminal gets no FSM buttons" rule.
        const terminalOrDone = [...TERMINAL_STATUSES];
        if (!terminalOrDone.includes('done')) terminalOrDone.push('done');
        for (const status of terminalOrDone) {
            const surfaced = (FEATURE_STATUS_ACTIONS[status] ?? []).filter((a) => FSM_ACTIONS[a]);
            expect(surfaced).toEqual([]);
        }
    });
});
