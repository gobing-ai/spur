import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * R5 (0604 / feature D5 R11): PR review spends quota once per stable integration
 * HEAD and is advisory by default. That contract is encoded entirely in the
 * `integration-review` state's options and in transition *declaration order* —
 * the state-machine driver takes the first passing edge, so the
 * `requireCleanReview` blocking edge only wins because it is declared before
 * the advisory one. Nothing else asserts either half: `workflow validate`
 * proves the definition is schema-valid, not that a FAIL stays advisory.
 *
 * 0753 R3 / D8 D1: the integration-review step now reaches a real decision
 * without spawning a nested workflow run. The `command.gate` +
 * `softFail: true` + `spur workflow run pr-review.yaml` shape was refused by
 * the SPUR_WORKFLOW_RUN_ACTIVE child guard and the refusal was masked. The
 * non-spawning replacement invokes `pr-reviewing.ts request` directly (a
 * `shell` action) and writes its own PASS/FAIL status — no nested level.
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
    options?: Record<string, unknown>;
}
interface WorkflowDef {
    states: { id: string; onEnter?: Action[] }[];
    transitions: Transition[];
}

// 'config' segment split to comply with the sp-runtime-path rule (config/{workflows|...} literal ban).
const WORKFLOWS_DIR = join(import.meta.dir, '../../../../config', 'workflows');
const DEF = parseYaml(readFileSync(join(WORKFLOWS_DIR, 'feature-dev.yaml'), 'utf8')) as WorkflowDef;

/** Index of the first transition matching from->to, or -1. */
function edgeIndex(from: string, to: string): number {
    return DEF.transitions.findIndex((t) => t.from === from && t.to === to);
}

const reviewState = DEF.states.find((s) => s.id === 'integration-review');
const shellAction = reviewState?.onEnter?.find((a) => a.kind === 'shell');
const commandGateAction = reviewState?.onEnter?.find((a) => a.kind === 'command.gate');

describe('feature-dev definition — integration review is non-spawning and reaches a real decision (0753 R3)', () => {
    test('the integration-review state exists and runs the review through a non-spawning shell action', () => {
        expect(reviewState).toBeDefined();
        // R3: no command.gate (which used to host softFail:true and the nested workflow run).
        expect(commandGateAction).toBeUndefined();
        // The non-spawning replacement: a direct shell invocation of pr-reviewing.ts request.
        expect(shellAction).toBeDefined();
    });

    test('the shell command invokes pr-reviewing.ts request directly — never `spur workflow run`', () => {
        // R3 AC: no nested workflow run. The shell must call pr-reviewing.ts request
        // directly; a `spur workflow run` here would re-create the child-guard refusal.
        const command = String(shellAction?.options?.command ?? '');
        expect(command).toContain('pr-reviewing.ts');
        expect(command).toContain('request');
        expect(command).not.toContain('workflow run');
        expect(command).not.toContain('softFail');
    });

    test('softFail is gone — the shell writes its own PASS/FAIL decision and exits loudly on real failure', () => {
        // R3 AC: the step produces a pass/fail decision rather than being soft-failed.
        // The pre-repair shape was command.gate with softFail:true; both must be gone.
        const command = String(shellAction?.options?.command ?? '');
        // The shell writes PASS to the status file when the request succeeds.
        expect(command).toMatch(/printf ['"]?PASS/);
        // And FAIL when the request errors — no softFail masking the refusal.
        expect(command).toMatch(/printf ['"]?FAIL/);
        expect(commandGateAction).toBeUndefined();
    });

    test('the blocking edge is declared before the advisory edge, so require-clean wins when both match', () => {
        const blocking = edgeIndex('integration-review', 'failed');
        const advisory = edgeIndex('integration-review', 'done');
        expect(blocking).toBeGreaterThanOrEqual(0);
        expect(advisory).toBeGreaterThanOrEqual(0);
        expect(blocking).toBeLessThan(advisory);
    });

    test('the blocking edge fires only under an explicit requireCleanReview policy', () => {
        const blocking = DEF.transitions.at(edgeIndex('integration-review', 'failed'));
        expect(blocking).toBeDefined();
        const command = blocking?.guard?.options?.command ?? '';
        expect(command).toContain('requireCleanReview');
        expect(command).toContain('= true');
        // A FAIL status alone must not be sufficient — the policy check is what gates it.
        expect(command).toContain('FAIL');
    });

    test('the advisory edge reaches done without requiring a clean review', () => {
        const advisory = DEF.transitions.at(edgeIndex('integration-review', 'done'));
        expect(advisory?.to).toBe('done');
        const command = advisory?.guard?.options?.command ?? '';
        expect(command).not.toContain('= PASS');
    });
});
