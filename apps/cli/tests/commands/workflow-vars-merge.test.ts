/**
 * 0948 R2 / AC2 — `spur workflow run --vars` must MERGE with the definition's declared
 * vars, never replace them.
 *
 * The E7-era defect: a partial `--vars` override silently dropped every other declared
 * var, so `feature-lifecycle`'s `--vars '{"featureId":...}'` caller blanked the inner
 * workflow's `spurBin` and the feature-scoped pass could not launch. The engine's
 * `mergeVars(workflow.vars, options.vars)` now supplies declared defaults under the
 * override; this test pins that contract at the CLI boundary so a future change back to
 * replace semantics fails here instead of inside a feature transition.
 *
 * Kept in its own file (not `workflow.test.ts`) so the CLI-level merge contract has one
 * obvious owner and the larger command suite keeps its existing size.
 */

import { expect, test } from 'bun:test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { main } from '../../src/index';
import { createCapturedOutput, createTempProject } from '../helpers';

/** Declares two vars and writes their resolved values to a file in the run cwd. */
const VARS_PROBE_YAML = `name: vars-merge-probe
kind: state-machine
initialState: start
terminalStates: [done]
vars:
  alpha: "DEFAULT_ALPHA"
  beta: "DEFAULT_BETA"
states:
  - id: start
    onEnter:
      - kind: shell
        options:
          command: 'printf "alpha=%s beta=%s\\n" "$alpha" "$beta" > vars-observed.txt'
  - id: done
transitions:
  - from: start
    to: done
    guard:
      kind: always
`;

async function runProbe(vars: string | undefined, runId: string): Promise<{ exitCode: number; observed: string }> {
    const dir = await createTempProject();
    try {
        const workflowFile = join(dir, 'vars-probe.yaml');
        await writeFile(workflowFile, VARS_PROBE_YAML);
        const output = createCapturedOutput();
        const args = ['workflow', 'run', '--run-id', runId, workflowFile];
        if (vars !== undefined) args.push('--vars', vars);
        const exitCode = await main(args, { output, cwd: dir, dbUrl: ':memory:' });
        const observed = await readFile(join(dir, 'vars-observed.txt'), 'utf8');
        return { exitCode, observed };
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

test('0948 AC2: a partial --vars override leaves every other declared var at its default', async () => {
    const { exitCode, observed } = await runProbe('{"alpha":"OVERRIDE"}', 'vars-merge-partial');
    expect(exitCode).toBe(0);
    // `beta` proves the definition default survived; `alpha` proves the override landed.
    expect(observed).toBe('alpha=OVERRIDE beta=DEFAULT_BETA\n');
});

test('0948 AC2: an omitted --vars leaves every declared var at its default', async () => {
    const { exitCode, observed } = await runProbe(undefined, 'vars-merge-none');
    expect(exitCode).toBe(0);
    expect(observed).toBe('alpha=DEFAULT_ALPHA beta=DEFAULT_BETA\n');
});

test('0948 AC2: a full --vars override replaces both declared values', async () => {
    const { exitCode, observed } = await runProbe('{"alpha":"A2","beta":"B2"}', 'vars-merge-full');
    expect(exitCode).toBe(0);
    expect(observed).toBe('alpha=A2 beta=B2\n');
});
