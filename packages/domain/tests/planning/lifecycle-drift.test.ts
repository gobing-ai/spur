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
function loadLifecycleYaml(...segments: string[]): StateMachineDef {
    const fullPath = join(REPO_ROOT, ...segments);
    const text = readFileSync(fullPath, 'utf-8');
    return parseYaml(text) as StateMachineDef;
}

describe('lifecycle workflow drift prevention (task 0046 R3)', () => {
    describe('task-lifecycle.yaml', () => {
        const yaml = loadLifecycleYaml('config', 'workflows', 'task-lifecycle.yaml');

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
        const yaml = loadLifecycleYaml('config', 'workflows', 'feature-lifecycle.yaml');

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

/** Extended shape for the task-pipeline assertions (onEnter actions + guards). */
interface PipelineDef {
    kind?: string;
    name: string;
    initialState: string;
    terminalStates?: string[];
    vars?: Record<string, unknown>;
    states: { id: string; onEnter?: { kind: string; options?: Record<string, unknown> }[] }[];
    transitions: { from: string; to: string; guard?: { kind: string; options?: Record<string, unknown> } }[];
}

describe('task-pipeline.yaml structure (task 0062)', () => {
    const yaml = loadLifecycleYaml('config', 'workflows', 'task-pipeline.yaml') as unknown as PipelineDef;
    const stateIds = yaml.states.map((s) => s.id);

    test('R1: the design §6 pipeline states are present, vars.wbs declared', () => {
        for (const s of ['precheck', 'implement', 'test', 'review', 'approve', 'verify', 'record', 'done']) {
            expect(stateIds).toContain(s);
        }
        expect(yaml.vars).toHaveProperty('wbs');
        expect(yaml.initialState).toBe('precheck');
    });

    test('R1: precheck→implement is guarded by doctor status + `task check`, with fail-closed fall-through', () => {
        const toImpl = yaml.transitions.find((t) => t.from === 'precheck' && t.to === 'implement');
        expect(toImpl?.guard?.kind).toBe('shell');
        // Soft doctor status file + task check (fleet reliability: soft probe → status → branch).
        // Guard command must reference a task check — whether literal `spur` or
        // `${vars.spurBin}` (ADR-026 PATH-independent spur invocation).
        const passCmd = String(toImpl?.guard?.options?.command ?? '');
        expect(passCmd).toMatch(/task check/);
        expect(passCmd).toMatch(/precheck-doctor\.status/);
        // Declaration order: PASS first, then fail-closed `always` fall-through (soft probe
        // pattern — doctor FAIL and/or task check red both land on `failed` without inverted
        // shell guards that race set -e). `always` is safe only AFTER the PASS guard.
        const idxPass = yaml.transitions.findIndex((t) => t.from === 'precheck' && t.to === 'implement');
        const idxFail = yaml.transitions.findIndex((t) => t.from === 'precheck' && t.to === 'failed');
        expect(idxFail).toBeGreaterThan(idxPass);
        expect(yaml.transitions[idxFail]?.guard?.kind).toBe('always');
    });

    test('R2: record writes via `spur task record` + post-record feature sync (task 0328)', () => {
        const record = yaml.states.find((s) => s.id === 'record');
        const cmds = (record?.onEnter ?? []).map((a) => String(a.options?.command ?? ''));
        // The record state has record step + post-record feature sync step (task 0328 / ADR-0322)
        expect(record?.onEnter ?? []).toHaveLength(2);
        expect(
            cmds.some(
                (c) =>
                    c.includes('task record') &&
                    c.includes('--solution-from-diff') &&
                    c.includes('--transition testing'),
            ),
        ).toBe(true);
        // The post-record hop must still sync feature status, but the mechanism is free: task 0411
        // routes it through `feature-sync-bounded.ts`, which wraps `spur feature sync --json` with
        // retry suppression. Assert the intent (a feature-sync hop exists), not one spelling.
        expect(cmds.some((c) => c.includes('feature sync') || c.includes('feature-sync-bounded'))).toBe(true);
    });

    test('R3: status transitions go through the normal verb (`spur task update <wbs> <status>`)', () => {
        const allCmds = yaml.states
            .flatMap((s) => s.onEnter ?? [])
            .filter((a) => a.kind === 'shell')
            .map((a) => String(a.options?.command ?? ''));
        expect(allCmds.some((c) => /task update \$\{vars\.wbs\} wip/.test(c))).toBe(true);
        // The testing transition is now inside `task record --transition testing` (a single verb),
        // not a separate shell step. Record owns the transition; the gate guard still verifies.
        expect(allCmds.some((c) => /task record \$\{vars\.wbs\}/.test(c) && c.includes('--transition testing'))).toBe(
            true,
        );
        expect(allCmds.some((c) => /task update \$\{vars\.wbs\} done/.test(c))).toBe(true);
    });

    test('R4: approve is a HITL gate (hitl.confirm)', () => {
        const approve = yaml.states.find((s) => s.id === 'approve');
        expect((approve?.onEnter ?? []).some((a) => a.kind === 'hitl.confirm')).toBe(true);
    });

    test('uses the resolvable @gobing-ai/spur schema ref (not the dead engine ref)', () => {
        const text = require('node:fs').readFileSync(
            require('node:path').join(REPO_ROOT, 'config', 'workflows', 'task-pipeline.yaml'),
            'utf-8',
        ) as string;
        expect(text).toContain('@gobing-ai/spur/schemas/state-machine-workflow.schema.json');
        expect(text).not.toContain('@gobing-ai/ts-dual-workflow-engine/schemas');
    });

    test('every transition endpoint is a declared state', () => {
        const ids = new Set(stateIds);
        for (const t of yaml.transitions) {
            expect(ids.has(t.from)).toBe(true);
            expect(ids.has(t.to)).toBe(true);
        }
    });
});
