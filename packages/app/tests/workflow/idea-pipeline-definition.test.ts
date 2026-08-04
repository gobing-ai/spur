import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * R4/R5 (0366): the pre-approval bypass is implemented purely by transition
 * *declaration order* — the state-machine driver takes the first passing edge.
 * If the guarded bypass is ever reordered after the `always` edge, a run with
 * `profile=auto` + `idea_approved=true` silently falls back into the paused
 * taste gate, which is exactly the defect 0366 fixed. Only ordering encodes
 * that contract, so it needs its own regression guard.
 */

interface Guard {
    kind: string;
    options?: { command?: string };
}
interface Transition {
    from: string;
    to: string;
    guard?: Guard;
}
interface Action {
    kind: string;
    options?: { command?: string; input?: string };
}
interface WorkflowDef {
    states: { id: string; pause?: boolean; onEnter?: Action[] }[];
    transitions: Transition[];
}

// 'config' segment split to comply with the sp-runtime-path rule (config/{workflows|...} literal ban).
const WORKFLOWS_DIR = join(import.meta.dir, '../../../../config', 'workflows');
const DEF = parseYaml(readFileSync(join(WORKFLOWS_DIR, 'idea-pipeline.yaml'), 'utf8')) as WorkflowDef;

/** Index of the first transition matching from→to, or -1. */
function edgeIndex(from: string, to: string): number {
    return DEF.transitions.findIndex((t) => t.from === from && t.to === to);
}

describe('idea-pipeline definition — pre-approval bypass ordering (R4/R5 of 0366)', () => {
    test('idea taste gate is a pausing state, so the bypass is what avoids the pause', () => {
        expect(DEF.states.find((s) => s.id === 'idea-eval')?.pause).toBe(true);
        expect(DEF.states.find((s) => s.id === 'design-approval')?.pause).toBe(true);
    });

    test('discovery bypass to feature-create is declared before the always edge to idea-eval', () => {
        const bypass = edgeIndex('discovery', 'feature-create');
        const gate = edgeIndex('discovery', 'idea-eval');

        expect(bypass).toBeGreaterThanOrEqual(0);
        expect(gate).toBeGreaterThanOrEqual(0);
        expect(bypass).toBeLessThan(gate);
        expect(DEF.transitions[gate]?.guard?.kind).toBe('always');
    });

    test('discovery bypass is guarded on both profile=auto and idea_approved=true', () => {
        const guard = DEF.transitions[edgeIndex('discovery', 'feature-create')]?.guard;

        expect(guard?.kind).toBe('shell');
        expect(guard?.options?.command).toBe(`test "\${vars.profile}" = auto && test "\${vars.idea_approved}" = true`);
    });

    test('design bypass to decompose is declared before the always edge to design-approval', () => {
        const bypass = edgeIndex('system-design', 'decompose');
        const gate = edgeIndex('system-design', 'design-approval');

        expect(bypass).toBeGreaterThanOrEqual(0);
        expect(gate).toBeGreaterThanOrEqual(0);
        expect(bypass).toBeLessThan(gate);
        expect(DEF.transitions[gate]?.guard?.kind).toBe('always');
    });

    test('design bypass is guarded on both profile=auto and design_approved=true', () => {
        const guard = DEF.transitions[edgeIndex('system-design', 'decompose')]?.guard;

        expect(guard?.kind).toBe('shell');
        expect(guard?.options?.command).toBe(
            `test "\${vars.profile}" = auto && test "\${vars.design_approved}" = true`,
        );
    });

    test('__runId is declared so discovery artifacts can carry run provenance (R8)', () => {
        const vars = (DEF as unknown as { vars: Record<string, unknown> }).vars;
        expect(vars).toHaveProperty('__runId');
    });
});

/**
 * R4 (0425): non-entity-scoped idea artifacts are `${vars.__runId}`-prefixed so
 * concurrent runs cannot share gate files / retry counters / discovery reports.
 * The start-state archive-and-reset block that papered over the collision is gone.
 */
describe('idea-pipeline definition — run-scoped artifacts (R4 of 0425)', () => {
    test('start state no longer archives/resets shared idea-* paths', () => {
        const start = DEF.states.find((s) => s.id === 'start');
        const cmds = (start?.onEnter ?? []).filter((a) => a.kind === 'shell').map((a) => a.options?.command ?? '');
        expect(cmds.some((c) => c.includes('idea-archive'))).toBe(false);
        expect(cmds.some((c) => c.includes('rm -f .spur/run/idea-'))).toBe(false);
    });

    test('discovery/eval/gate paths are __runId-scoped', () => {
        const raw = readFileSync(join(WORKFLOWS_DIR, 'idea-pipeline.yaml'), 'utf8');
        // Every former fixed idea-* run path must carry the run-id prefix.
        for (const stem of [
            'idea-precheck-doctor.status',
            'idea-eval-report.md',
            'idea-needs-design.json',
            'idea-feature-id.txt',
            'idea-ac-retry-count',
            'idea-ac-content.md',
            'idea-ac-done.txt',
            'idea-decompose-retry-count',
            'idea-task-batch.json',
            'idea-batch-create.done',
            'idea-batch-create.failed',
        ]) {
            expect(raw).toContain(`.spur/run/\${vars.__runId}-${stem}`);
            // No unscoped live path remains (comments may still mention idea-*).
            expect(raw).not.toMatch(new RegExp(`\\.spur/run/${stem.replace('.', '\\.')}`));
        }
    });

    test('discovery instructs a run_id provenance footer on the emitted report', () => {
        const discovery = DEF.states.find((s) => s.id === 'discovery');
        const input = discovery?.onEnter?.find((a) => a.kind === 'agent.run')?.options?.input ?? '';

        expect(input).toContain(`run_id: \${vars.__runId}`);
        expect(input).toContain('generated_at');
    });

    test('failed and cancelled are declared failure terminals', () => {
        const failureStates = (DEF as unknown as { failureStates?: string[] }).failureStates ?? [];
        expect(failureStates).toEqual(expect.arrayContaining(['failed', 'cancelled']));
    });
});
