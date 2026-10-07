/**
 * Workflow decision-placement scan (task 1098 R4, design §4 "keep-deterministic").
 *
 * The five workflows that own deterministic status checks must not carry an AI
 * decision maker: `kind: decide` is forbidden outright, and a shell
 * `decision run` invocation may appear only in the single allowlisted
 * rescue-only step — the verdict rescue that follows the normalization step in
 * history-anatomy's validate state (shared-workflow layer), which the design
 * gates behind the FAIL short-circuit and the model-only PASS rule.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Repo root: apps/cli/tests → apps/cli → repo. */
const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

/** Workflows whose status checks are deterministic by design (R4 list). */
const DETERMINISTIC_STATUS_WORKFLOWS = [
    'pr-review.yaml',
    'wayfinder-resolution.yaml',
    'wrapup-pipeline.yaml',
    'feature-verification.yaml',
    'history-anatomy.yaml',
] as const;

/** The one workflow allowed to carry the rescue, by basename. */
const RESCUE_WORKFLOW = 'history-anatomy.yaml';

function readWorkflow(name: string): string {
    const path = join(REPO_ROOT, 'config', 'workflows', name);
    expect(existsSync(path), `missing workflow ${name} at ${path}`).toBe(true);
    return readFileSync(path, 'utf-8');
}

/**
 * The enclosing step block for a match: from the last step boundary before
 * `at` (a `- kind:` item or a `- id:` state) to the next one after it.
 */
function enclosingStep(text: string, at: number): string {
    const boundary = /(^|\n)(\s*- (?:kind|id):)/g;
    let start = 0;
    let end = text.length;
    for (const match of text.matchAll(boundary)) {
        const lead = match[1] ?? '';
        const index = (match.index ?? 0) + lead.length;
        if (index >= at) {
            end = index;
            break;
        }
        start = index;
    }
    return text.slice(start, end);
}

describe('workflow decision placement scan (1098 R4)', () => {
    const workflows = new Map(DETERMINISTIC_STATUS_WORKFLOWS.map((name) => [name, readWorkflow(name)]));

    test('no inline `kind: decide` in any deterministic-status workflow', () => {
        for (const text of workflows.values()) {
            expect(text).not.toMatch(/kind:\s*decide\b/);
        }
    });

    test('`decision run` appears exactly once — in the history-anatomy rescue step', () => {
        const hits: Array<{ workflow: string; index: number }> = [];
        for (const [name, text] of workflows) {
            for (const match of text.matchAll(/decision\s+run\b/g)) {
                hits.push({ workflow: name, index: match.index ?? 0 });
            }
        }
        expect(hits).toHaveLength(1);
        expect(hits[0]?.workflow).toBe(RESCUE_WORKFLOW);

        // The allowlisted step must carry the whole rescue contract: the
        // catalog id, the FAIL short-circuit before the maker call, the
        // model-only PASS rule, and the hard FAIL default.
        const step = enclosingStep(workflows.get(RESCUE_WORKFLOW) ?? '', hits[0]?.index ?? 0);
        expect(step).toContain('anatomy-validation-verdict');
        const shortCircuit = step.indexOf("grep -cx 'Verdict: FAIL'");
        const makerCall = step.indexOf('decision run anatomy-validation-verdict');
        expect(shortCircuit).toBeGreaterThanOrEqual(0);
        expect(makerCall).toBeGreaterThanOrEqual(0);
        expect(shortCircuit).toBeLessThan(makerCall);
        expect(step).toContain('(.source // .data.source) == "model"');
        expect(step).toContain('(.value // .data.value) == "PASS"');
        expect(step).toMatch(/\[ "\$v" = "PASS" \] \|\| v="FAIL";/);
    });
});
