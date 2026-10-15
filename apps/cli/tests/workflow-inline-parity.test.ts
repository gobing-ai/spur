import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMIT_GUARD_USAGE } from '@gobing-ai/spur-app/commit-guard';
import { PERSIST_CHECK_USAGE } from '@gobing-ai/spur-app/persist-check';
import { GOLDEN_CASES } from './workflow-inline/golden-cases';
import { type CaseObservation, runCase } from './workflow-inline/golden-runner';

/**
 * Script-absorption PR-4 parity: every case frozen from the retired plugin scripts
 * (`fixtures/workflow-inline-golden.json`) is replayed through `spur workflow inline|commit-guard`
 * and must produce the same exit codes, stdout, side effects and — after the documented rewrites
 * below, which only rename the retired script invocations to the commands that replace them —
 * the same stderr.
 */
const GOLDEN = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', 'workflow-inline-golden.json'), 'utf8')) as {
    cases: Record<string, CaseObservation>;
};

/** Old-script stderr → the CLI's wording. Each pair renames a retired invocation; nothing else differs. */
const STDERR_REWRITES: ReadonlyArray<readonly [string, string]> = [
    [
        'usage: commit-guard start --run <id> | stage --run <id> [--base <sha>] -- <paths…> | check --run <id>',
        COMMIT_GUARD_USAGE,
    ],
    ['run `commit-guard start --run', 'run `spur workflow commit-guard start --run'],
    [
        'usage: persist-out-check --from <worktree> [--task-file <path>]… [--run-id <id>]… [--root <invoke-tree>] [--success-json <path>]',
        PERSIST_CHECK_USAGE,
    ],
    [
        'run inline-run-setup --persist-out --from <worktree> (--task-file <wbs>_<slug>.md) before worktree removal',
        'run `spur workflow inline persist-out --from <worktree>` (--task-file <wbs>_<slug>.md) before worktree removal',
    ],
];

function rewrite(stderr: string): string {
    return STDERR_REWRITES.reduce((text, [from, to]) => text.replaceAll(from, to), stderr);
}

describe('spur workflow inline|commit-guard golden parity (script-absorption PR-4)', () => {
    test('the fixture covers every case exactly', () => {
        expect(Object.keys(GOLDEN.cases).sort()).toEqual(GOLDEN_CASES.map((c) => c.name).sort());
    });

    for (const c of GOLDEN_CASES) {
        test(c.name, async () => {
            const want = GOLDEN.cases[c.name] as CaseObservation;
            const got = await runCase(c, 'cli');
            expect(got.steps).toHaveLength(want.steps.length);
            c.steps.forEach((step, i) => {
                const g = got.steps[i] as CaseObservation['steps'][number];
                const w = want.steps[i] as CaseObservation['steps'][number];
                const where = `${c.name} step ${i}: spur workflow ${step.cli.join(' ')}`;
                expect({ where, exitCode: g.exitCode }).toEqual({ where, exitCode: w.exitCode });
                const mode = step.compare ?? 'full';
                if (mode !== 'exit') expect({ where, stdout: g.stdout }).toEqual({ where, stdout: w.stdout });
                if (mode === 'full') expect({ where, stderr: g.stderr }).toEqual({ where, stderr: rewrite(w.stderr) });
            });
            expect(got.artifacts).toEqual(want.artifacts);
            expect(got.db).toEqual(want.db);
        }, 60_000);
    }
});
