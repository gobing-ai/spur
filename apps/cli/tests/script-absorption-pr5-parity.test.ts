/**
 * Script-absorption PR-5 parity: the absorbing verbs (`spur task wrapup|preflight|batch-plan`,
 * `spur feature verify|handoff`) reproduce the retired plugin scripts' observable behavior — exit
 * codes, stdout, stderr, every `.spur/run` + `.spur/memory` artifact and the nested spur argv —
 * for the representative inputs in `fixtures/script-absorption-pr5/cases.ts`.
 *
 * The expectation is the old-side capture (`fixtures/script-absorption-pr5-golden.json`, taken
 * from the scripts before deletion) with ONLY the intentional, documented divergences below
 * applied. Anything else that differs fails the suite.
 */
import { describe, expect, test } from 'bun:test';
import { getEnvVars } from '@gobing-ai/spur-config';
import { ALL_CASES } from './fixtures/script-absorption-pr5/cases';
import { type CaseOutcome, runCase } from './fixtures/script-absorption-pr5/harness';
import golden from './fixtures/script-absorption-pr5-golden.json';

const ENV: Record<string, string | undefined> = {
    PATH: getEnvVars().PATH,
    HOME: getEnvVars().HOME,
    TMPDIR: getEnvVars().TMPDIR,
    SPUR_SKIP_GLOBAL_CONFIG: 'true',
    SPUR_SKIP_PROJECT_CONFIG: 'true',
    NO_COLOR: '1',
};

/** Intentional text divergences: usage lines and diagnostic prefixes now name the spur verb. */
const TEXT_DIVERGENCES: ReadonlyArray<readonly [from: string, to: string]> = [
    [
        'usage: wrapup-steps.ts <resolve|route-reason|metrics|feature-transition|doc-sync-snapshot|doc-sync-scope|doc-supersession>',
        'usage: spur task wrapup <resolve|route-reason|metrics|feature-transition|doc-sync-snapshot|doc-sync-scope|doc-supersession|drift-probe>',
    ],
    ['usage: batch-plan.ts ', 'usage: spur task batch-plan '],
    // Input files now resolve through the CLI fs seam against the project dir (absolute in the message).
    ["open 'missing.json'", "open '<CWD>/missing.json'"],
    ['feature-verification-steps: ', 'feature verify: '],
];

/**
 * Whole-step divergences. `preflight` without `--status` was a usage error in the script; the verb
 * reads status/deps from the task corpus instead, so in an empty project it fails reading the task
 * (same exit code 1, different diagnostic).
 */
const STEP_DIVERGENCES: Record<string, Record<number, { stderr: string }>> = {
    'preflight/preflight-missing-status': {
        0: {
            stderr: 'task preflight: cannot read task 0101 — Error: Task 0101 not found in any registered task folder\n',
        },
    },
};

function expected(group: string, id: string): CaseOutcome {
    let text = JSON.stringify((golden as unknown as Record<string, Record<string, CaseOutcome>>)[group]?.[id]);
    for (const [from, to] of TEXT_DIVERGENCES)
        text = text.split(JSON.stringify(from).slice(1, -1)).join(JSON.stringify(to).slice(1, -1));
    const out = JSON.parse(text) as CaseOutcome;
    for (const [index, patch] of Object.entries(STEP_DIVERGENCES[`${group}/${id}`] ?? {})) {
        const step = out.steps[Number(index)];
        if (step) Object.assign(step, patch);
    }
    if (group === 'featureVerify') retireReceiptConfidence(out);
    return out;
}

/**
 * The feature-receipt confidence level was retired after the capture (task 1221, ADR-138): the
 * pass message no longer names a level and receipts no longer carry the `confidence*` keys.
 */
function retireReceiptConfidence(out: CaseOutcome): void {
    for (const step of out.steps) step.stdout = step.stdout.replace(/, confidence [A-Z]+/g, '');
    for (const [path, content] of Object.entries(out.files)) {
        if (!path.endsWith('-feature-verification.json')) continue;
        const receipt = JSON.parse(content) as Record<string, unknown>;
        delete receipt.confidence;
        delete receipt.confidenceBasis;
        delete receipt.confidenceAcknowledged;
        out.files[path] = `${JSON.stringify(receipt, null, 4)}\n`;
    }
}

describe('script-absorption PR-5 golden parity', () => {
    test('golden capture covers every case', () => {
        for (const [group, cases] of Object.entries(ALL_CASES)) {
            for (const c of cases) {
                expect((golden as unknown as Record<string, Record<string, unknown>>)[group]?.[c.id]).toBeDefined();
            }
        }
    });

    for (const [group, cases] of Object.entries(ALL_CASES)) {
        describe(group, () => {
            for (const c of cases) {
                test(c.id, () => {
                    expect(runCase(c, 'new', ENV)).toEqual(expected(group, c.id));
                }, 120_000);
            }
        });
    }
});
