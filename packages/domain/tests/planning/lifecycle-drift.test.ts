import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { FEATURE_STATUSES, TASK_STATUSES } from '../../src/planning/schema';

/**
 * Type mirror of the engine's state-machine definition shape — just enough
 * to extract states for drift comparison.
 */
interface StateMachineDef {
    kind?: string;
    name: string;
    initialState: string;
    terminalStates?: string[];
    states: { id: string }[];
    transitions: { from: string; to: string }[];
}

/** Repository root (packages/domain/tests/planning → ../../../..). */
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

/** Load and parse a state-machine workflow YAML. */
function loadLifecycleYaml(relPath: string): StateMachineDef {
    const fullPath = join(REPO_ROOT, relPath);
    const text = readFileSync(fullPath, 'utf-8');
    return parseYaml(text) as StateMachineDef;
}

describe('lifecycle workflow drift prevention (task 0046 R3)', () => {
    describe('task-lifecycle.yaml', () => {
        const yaml = loadLifecycleYaml('config/workflows/task-lifecycle.yaml');

        test('is a state-machine', () => {
            expect(yaml.kind).toBe('state-machine');
        });

        test('state set matches TASK_STATUSES union exactly', () => {
            const yamlStates = yaml.states.map((s) => s.id).sort();
            const schemaStates = [...TASK_STATUSES].sort();
            expect(yamlStates).toEqual(schemaStates);
        });

        test('initialState is backlog', () => {
            expect(yaml.initialState).toBe('backlog');
        });

        test('terminalStates is [cancelled]', () => {
            expect(yaml.terminalStates).toEqual(['cancelled']);
        });

        test('cancelled has no outgoing transitions (truly terminal)', () => {
            const outbound = yaml.transitions.filter((t) => t.from === 'cancelled');
            expect(outbound).toEqual([]);
        });

        test('done is re-enterable (has outgoing transition to wip)', () => {
            const reopen = yaml.transitions.filter((t) => t.from === 'done' && t.to === 'wip');
            expect(reopen.length).toBe(1);
        });

        test('every transition endpoint is a declared state', () => {
            const stateIds = new Set(yaml.states.map((s) => s.id));
            for (const t of yaml.transitions) {
                expect(stateIds.has(t.from)).toBe(true);
                expect(stateIds.has(t.to)).toBe(true);
            }
        });
    });

    describe('feature-lifecycle.yaml', () => {
        const yaml = loadLifecycleYaml('config/workflows/feature-lifecycle.yaml');

        test('is a state-machine', () => {
            expect(yaml.kind).toBe('state-machine');
        });

        test('state set matches FEATURE_STATUSES union exactly', () => {
            const yamlStates = yaml.states.map((s) => s.id).sort();
            const schemaStates = [...FEATURE_STATUSES].sort();
            expect(yamlStates).toEqual(schemaStates);
        });

        test('initialState is backlog', () => {
            expect(yaml.initialState).toBe('backlog');
        });

        test('terminalStates is [cancelled]', () => {
            expect(yaml.terminalStates).toEqual(['cancelled']);
        });

        test('cancelled has no outgoing transitions (truly terminal)', () => {
            const outbound = yaml.transitions.filter((t) => t.from === 'cancelled');
            expect(outbound).toEqual([]);
        });

        test('includes the verifying status (DD-13)', () => {
            expect(yaml.states.some((s) => s.id === 'verifying')).toBe(true);
        });

        test('has active→verifying and verifying→done transitions', () => {
            const toVerifying = yaml.transitions.filter((t) => t.from === 'active' && t.to === 'verifying');
            const toDone = yaml.transitions.filter((t) => t.from === 'verifying' && t.to === 'done');
            expect(toVerifying.length).toBe(1);
            expect(toDone.length).toBe(1);
        });

        test('has verifying→active rework transition (DD-13)', () => {
            const rework = yaml.transitions.filter((t) => t.from === 'verifying' && t.to === 'active');
            expect(rework.length).toBe(1);
        });

        test('every transition endpoint is a declared state', () => {
            const stateIds = new Set(yaml.states.map((s) => s.id));
            for (const t of yaml.transitions) {
                expect(stateIds.has(t.from)).toBe(true);
                expect(stateIds.has(t.to)).toBe(true);
            }
        });
    });
});
