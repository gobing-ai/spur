/**
 * Noun-level integration tests for `spur workflow` (apps/cli/src/commands/workflow/index.ts); per-verb tests live beside this file.
 * Behavioral tests for WorkflowAppService live in packages/app/tests/services/workflow-service.test.ts.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _resetAgentServiceShimsForTest } from '@gobing-ai/spur-app';
import { main } from '../../../src/index';
import type { CommandOutput } from '../../../src/output';
import { createCapturedOutput, createTempProject } from '../../helpers';

// Warn-once shim markers (bare-binary, legacy executor) are process-global; bun
// batches test files per worker process — never inherit another file's state.
beforeEach(() => {
    _resetAgentServiceShimsForTest();
});

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

/** The `workflow validate --json` envelope subset the bundled gate reads. */
interface ValidateJson {
    valid?: boolean;
    composition?: {
        findings?: Array<{
            level?: string;
            workflow?: string;
            state?: string;
            actionKey?: string;
            measure: { kind: string; measured: number };
        }>;
    };
}

/**
 * Validate one workflow file exactly as the bundled-definition loop does: an isolated
 * no-config cwd, `:memory:` DB, and FULL JSON-Schema resolution. `errorFindings` flattens
 * the error-level composition findings to `workflow state actionKey kind=measured` lines,
 * so a gate failure names its finding (0826 R1; ADR-115).
 */
async function validateWorkflowFile(
    file: string,
): Promise<{ exitCode: number; parsed: ValidateJson; errorFindings: string[] }> {
    // Isolate cwd to a temp dir with no .spur/config.yaml so main() takes the
    // lightweight no-config branch. Without this, cwd falls back to process.cwd()
    // (the repo root, which HAS a config), triggering full app bootstrap on every
    // validate call — environment-fragile on CI.
    const cwd = await createTempProject();
    const output = createCapturedOutput();
    const exitCode = await main(['workflow', 'validate', file, '--json'], { output, cwd, dbUrl: ':memory:' });
    const parsed = JSON.parse(output.messages.at(-1) ?? '{}') as ValidateJson;
    const errorFindings = (parsed.composition?.findings ?? [])
        .filter((f) => f.level === 'error')
        .map((f) => `${f.workflow} ${f.state} ${f.actionKey} ${f.measure.kind}=${f.measure.measured}`);
    return { exitCode, parsed, errorFindings };
}

describe('workflow command (main)', () => {
    test('unknown subcommand returns 1', async () => {
        const exitCode = await main(['workflow', 'unknown-cmd'], { output: nullOutput() });
        expect(exitCode).toBe(1);
    });

    // Bundled definitions validate with full schema resolution and carry no error-level
    // composition finding (ADR-115 gate over the bundled shared-workflow layer, 0826).
    const REPO_ROOT = join(join(import.meta.dir, '..'), '..', '..', '..', '..');
    const bundledWorkflows = readdirSync(join(REPO_ROOT, 'config', 'workflows'))
        .filter((f) => /\.ya?ml$/.test(f))
        .sort();
    for (const wf of bundledWorkflows) {
        test(`bundled workflows/${wf} validates (schema resolves)`, async () => {
            const { exitCode, parsed, errorFindings } = await validateWorkflowFile(
                join(REPO_ROOT, 'config', 'workflows', wf),
            );
            // Findings before the exit code, so a failure names the workflow, state and action.
            expect(parsed.valid).toBe(true);
            expect(errorFindings).toEqual([]);
            expect(exitCode).toBe(0);
        });
    }

    test('no subcommand prints usage and returns 1', async () => {
        const exitCode = await main(['workflow'], { output: nullOutput() });
        expect(exitCode).toBe(1);
    });

    // 0822 (ADR-115): a shell program of N `echo` lines measures N logical commands.
    // 6 commands → warn band; 11 → error band.
    const compositionFixture = (commands: number): string => `name: cli-composition-flow
kind: state-machine
initialState: start
states:
  - id: start
    onEnter:
      - kind: shell
        options:
          command: |
${Array.from({ length: commands }, (_, i) => `            echo step-${i}`).join('\n')}
  - id: done
transitions:
  - from: start
    to: done
terminalStates: [done]
`;

    test('the bundled composition gate fails on error-level findings and ignores warn-level ones (0826 R1)', async () => {
        const dir = await createTempProject();
        const errorFile = join(dir, 'error.yaml');
        await writeFile(errorFile, compositionFixture(11));
        const errorRun = await validateWorkflowFile(errorFile);
        // `workflow` is the fixture file's basename without extension (collectCompositionAdvisory).
        expect(errorRun.errorFindings).toEqual(['error start start:onEnter:0 shell-lines=11']);
        expect(errorRun.exitCode).toBe(1);

        const warnFile = join(dir, 'warn.yaml');
        await writeFile(warnFile, compositionFixture(6));
        const warnRun = await validateWorkflowFile(warnFile);
        expect(warnRun.errorFindings).toEqual([]);
        expect(warnRun.exitCode).toBe(0);
        await rm(dir, { recursive: true, force: true });
    });
});
