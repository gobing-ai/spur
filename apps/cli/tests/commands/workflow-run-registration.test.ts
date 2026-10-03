/**
 * 1064 — sync `spur workflow run` must not leak run-id side effects before the run row commits.
 *
 * The pre-1064 defect: the CLI printed `Run: <id>` and constructed `WorkflowRunLogSink`
 * (whose constructor eagerly `openSync`-ed `.spur/memory/runs/<id>.md`) before the
 * engine's `createRun` inserted the row, so any pre-row throw or kill (e.g. the 0948 R2
 * blanked-var refusal) left an unqueryable run-record orphan (`workflow trace <id>` →
 * "Run not found"). After 1064 both side effects are downstream of `workflow.run.started`,
 * which `ObservableWorkflowAdapter` emits only after the row insert commits.
 *
 * AC1 pins the failing pre-row path (no id printed, no record artifact); AC2 pins the
 * success path (header before any progress line, and the id resolves in the same project
 * DB — hence the file-backed `dbUrl`, because each `main()` call opens its own adapter).
 */

import { expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runStoragePaths } from '@gobing-ai/spur-app';
import { main } from '../../src/index';
import { createCapturedOutput, createTempProject } from '../helpers';

/** Declares var `alpha`; blanking it via `--vars` throws pre-row (0948 R2). */
const FAILING_PROBE_YAML = `name: registration-fail-probe
kind: state-machine
initialState: start
terminalStates: [done]
vars:
  alpha: "DEFAULT_ALPHA"
states:
  - id: start
  - id: done
transitions:
  - from: start
    to: done
    guard:
      kind: always
`;

/** A succeeding trivial probe with one shell action, so progress lines exist. */
const OK_PROBE_YAML = `name: registration-ok-probe
kind: state-machine
initialState: start
terminalStates: [done]
states:
  - id: start
    onEnter:
      - kind: shell
        options:
          command: 'printf ok > ok.txt'
  - id: done
transitions:
  - from: start
    to: done
    guard:
      kind: always
`;

test('1064 AC1: a pre-row failure prints no run id and leaves no run-record artifact', async () => {
    const dir = await createTempProject();
    try {
        const workflowFile = join(dir, 'registration-fail-probe.yaml');
        await writeFile(workflowFile, FAILING_PROBE_YAML);
        const output = createCapturedOutput();
        const exitCode = await main(
            ['workflow', 'run', '--run-id', 'reg-orphan-probe', workflowFile, '--vars', '{"alpha":""}'],
            { output, cwd: dir, dbUrl: join(dir, 'spur.db') },
        );
        expect(exitCode).not.toBe(0);
        expect(output.messages.join('\n')).not.toContain('Run: ');
        const recordsDir = runStoragePaths(dir).recordsDir;
        const leftovers = existsSync(recordsDir)
            ? readdirSync(recordsDir).filter((name) => name.startsWith('reg-orphan-probe'))
            : [];
        expect(leftovers).toEqual([]);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('1064 AC2: a successful sync run prints the header first and the id resolves in the project DB', async () => {
    const dir = await createTempProject();
    try {
        const workflowFile = join(dir, 'registration-ok-probe.yaml');
        await writeFile(workflowFile, OK_PROBE_YAML);
        const output = createCapturedOutput();
        const dbUrl = join(dir, 'spur.db');
        const exitCode = await main(['workflow', 'run', '--run-id', 'reg-ok-probe', workflowFile], {
            output,
            cwd: dir,
            dbUrl,
        });
        expect(exitCode).toBe(0);
        const headerIdx = output.messages.findIndex((message) => message === 'Run: reg-ok-probe');
        expect(headerIdx).toBeGreaterThanOrEqual(0);
        // The header must precede every progress line (no action/phase render before it).
        const firstProgressIdx = output.messages.findIndex(
            (message, index) => index > headerIdx && message.trim().length > 0,
        );
        expect(firstProgressIdx).toBeGreaterThan(headerIdx);
        const trace = createCapturedOutput();
        const traceExit = await main(['workflow', 'trace', 'reg-ok-probe'], { output: trace, cwd: dir, dbUrl });
        expect(traceExit).toBe(0);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
