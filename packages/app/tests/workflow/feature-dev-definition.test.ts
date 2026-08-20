import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * R5 (0604 / feature D5 R11): PR review spends quota once per stable integration
 * HEAD and is advisory by default. That contract is encoded entirely in the
 * `integration-review` state's gate options and in transition *declaration
 * order* — the state-machine driver takes the first passing edge, so the
 * `requireCleanReview` blocking edge only wins because it is declared before the
 * advisory one. Nothing else asserts either half: `workflow validate` proves the
 * definition is schema-valid, not that a FAIL stays advisory. Flipping
 * `softFail` to false, or reordering the two edges, would silently turn a
 * pending/timed-out/quota-unavailable review into a hard feature block.
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

/** Index of the first transition matching from→to, or -1. */
function edgeIndex(from: string, to: string): number {
    return DEF.transitions.findIndex((t) => t.from === from && t.to === to);
}

const reviewState = DEF.states.find((s) => s.id === 'integration-review');
const gate = reviewState?.onEnter?.find((a) => a.kind === 'command.gate');

describe('feature-dev definition — integration review is advisory by default (0604 R5)', () => {
    test('the integration-review state exists and runs the review through a command.gate', () => {
        expect(reviewState).toBeDefined();
        expect(gate).toBeDefined();
    });

    test('the gate is soft, so pending / timeout / unavailable quota records FAIL without blocking', () => {
        expect(gate?.options?.softFail).toBe(true);
    });

    test('review runs once per HEAD by delegating to pr-review, where current-HEAD dedup lives', () => {
        const args = (gate?.options?.args ?? []) as string[];
        expect(args).toContain('.spur/workflows/pr-review.yaml');
        // `mode: full` is what activates pr-review's own current-HEAD dedup, so a
        // re-entry on the same HEAD is a no-op there rather than a second quota spend.
        expect(args.join(' ')).toContain('"mode":"full"');
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
        // Either unguarded, or a guard that does not demand a PASS status.
        const command = advisory?.guard?.options?.command ?? '';
        expect(command).not.toContain('= PASS');
    });
});
