import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * 1007 R1 — pipeline action-count ratchet (AC2). Counts every onEnter+onExit action across
 * each pipeline's states and ratchets the totals at the named cuts of 1007 R2/R3 (idea ≤30,
 * task ≤48; baseline before the diet was idea 33, task 53). Further cuts need behavior
 * changes and are new work — lowering a budget here is the change record. Raised to 31 at
 * the A9×main merge: dev-idea decision-brief gates (0769 pattern) deliberately add one
 * recommendation-derivation shell action to idea-pipeline on main.
 * 33 at 1097: the two rescue-only shell actions (recommendation `unknown`, corrupt needs-design
 * JSON) after the derivation — each calls a catalog decision only on output the deterministic
 * parse could not classify (design §4 / §5 S5).
 */
const IDEA_ACTION_BUDGET = 33;
// 50 at the session finding after 1088: the completion gate needs its own confidence action
// (the proof-binding stamp must stay the state's last action and under the 800-char shell cap),
// and `review-fail-triage` adds one decide action — the review-side twin of 0943's failure-class
// router. Raising a budget here IS the change record; both additions are named in the commit.
// 51 at v5 (1077): test-fix gains one review-lane evidence projection action so the repair
// hop is not fed an empty findings set.
const TASK_ACTION_BUDGET = 51;

const WORKFLOWS_DIR = join(import.meta.dir, '../../../../config', 'workflows');

interface ActionDef {
    kind: string;
}
interface PipelineDef {
    states: { id: string; onEnter?: ActionDef[]; onExit?: ActionDef[] }[];
}

function countActions(file: string): number {
    const def = parseYaml(readFileSync(join(WORKFLOWS_DIR, file), 'utf8')) as PipelineDef;
    return def.states.reduce((n, s) => n + (s.onEnter?.length ?? 0) + (s.onExit?.length ?? 0), 0);
}

describe('pipeline-action-budget (1007 R1)', () => {
    test('idea-pipeline onEnter+onExit actions stay at or under the ratchet', () => {
        expect(countActions('idea-pipeline.yaml')).toBeLessThanOrEqual(IDEA_ACTION_BUDGET);
    });

    test('task-pipeline onEnter+onExit actions stay at or under the ratchet', () => {
        expect(countActions('task-pipeline.yaml')).toBeLessThanOrEqual(TASK_ACTION_BUDGET);
    });
});
