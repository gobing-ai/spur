/**
 * Thin-wrapper integration tests for `spur workflow list` (apps/cli/src/commands/workflow/list.ts).
 * Behavioral tests for WorkflowAppService live in packages/app/tests/services/workflow-service.test.ts.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

const MINIMAL_WORKFLOW_YAML = `name: cli-test-flow
kind: state-machine
initialState: start
states:
  - id: start
  - id: done
transitions:
  - from: start
    to: done
terminalStates:
  - done
`;

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('workflow command (main)', () => {
    test('list subcommand (json) returns 0', async () => {
        const exitCode = await main(['workflow', 'list', '--json'], { output: nullOutput(), dbUrl: ':memory:' });
        expect(exitCode).toBe(0);
    });
    test('list subcommand (plain) always lists the project layer header, even when empty (0819 R2)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-wf-list-empty-'));
        const lines: string[] = [];
        const exitCode = await main(['workflow', 'list'], {
            output: { write: (m) => lines.push(m), error: () => {} },
            cwd: dir,
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(0);
        const text = lines.join('\n');
        // 0819 R2: the project layer header + its empty marker print even with no
        // workflows; the shared layer (shipped catalog) is still listed.
        expect(text).toContain('project/');
        expect(text).toContain('(no workflows)');
        expect(text).toContain('shared/');
        await rm(dir, { recursive: true, force: true });
    });
    test('list subcommand (plain) labels entries per layer, including registered extras (0819 R1/R3)', async () => {
        const dir = await createTempProject();
        const wfDir = join(dir, '.spur', 'workflows');
        const regDir = join(dir, 'ops-workflows');
        await mkdir(wfDir, { recursive: true });
        await mkdir(regDir, { recursive: true });
        await writeFile(join(wfDir, 'test.yaml'), MINIMAL_WORKFLOW_YAML);
        await writeFile(
            join(regDir, 'ops.yaml'),
            MINIMAL_WORKFLOW_YAML.replace('name: cli-test-flow', 'name: cli-ops-flow'),
        );
        await writeFile(join(dir, '.spur', 'config.yaml'), `workflows:\n  paths:\n    - ops-workflows\n`);
        const output = createCapturedOutput();

        const exitCode = await main(['workflow', 'list'], { output, cwd: dir, dbUrl: ':memory:' });

        expect(exitCode).toBe(0);
        const text = output.messages.join('\n');
        expect(text).toContain('project/');
        expect(text).toContain('registered/');
        expect(text).toContain('shared/');
        expect(text).toContain('cli-test-flow');
        expect(text).toContain('cli-ops-flow');
        expect(text).toContain('[registered layer]');
        expect(text).toContain('[shared layer]');
        expect(text).not.toContain('global');
        await rm(dir, { recursive: true, force: true });
    });
    test('list subcommand (plain) discovers workflow YAML files', async () => {
        const dir = await createTempProject();
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });
        await writeFile(join(wfDir, 'test.yaml'), MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();

        const exitCode = await main(['workflow', 'list'], { output, cwd: dir, dbUrl: ':memory:' });

        expect(exitCode).toBe(0);
        expect(output.messages.some((m) => m.includes('cli-test-flow'))).toBe(true);
        expect(output.messages.some((m) => m.includes('state-machine'))).toBe(true);
        await rm(dir, { recursive: true, force: true });
    });
    test('list subcommand falls back to default paths when config parse fails', async () => {
        const dir = await createTempProject();
        // Create a config file with a non-object `workflows` value — this will
        // survive YAML parse but fail Zod's spurConfigSchema validation,
        // hitting the catch branch in resolveWorkflowPaths.
        await writeFile(join(dir, 'spur.yaml'), 'workflows: "not-an-object"\n');
        const output = createCapturedOutput();

        const exitCode = await main(['workflow', 'list', '--json'], { output, cwd: dir, dbUrl: ':memory:' });

        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output.messages[0] ?? '{}');
        expect(parsed).toHaveProperty('entries');
        expect(parsed).toHaveProperty('totalFiles');
        await rm(dir, { recursive: true, force: true });
    });
    test('list subcommand expands bundled: paths against the installed package config root', async () => {
        const dir = await createTempProject();
        await mkdir(join(dir, '.spur'), { recursive: true });
        await writeFile(join(dir, '.spur', 'config.yaml'), 'workflows:\n  paths:\n    - bundled:workflows\n');
        const output = createCapturedOutput();

        const exitCode = await main(['workflow', 'list', '--json'], { output, cwd: dir, dbUrl: ':memory:' });

        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output.messages[0] ?? '{}');
        const names = ((parsed.entries ?? []) as Array<{ name: string }>).map((entry) => entry.name);
        // The repository's bundled workflow catalog ships task-pipeline.yaml.
        expect(names).toContain('task-pipeline');
        await rm(dir, { recursive: true, force: true });
    });
    test('list subcommand shows invalid workflow entry in human output', async () => {
        const dir = await createTempProject();
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });
        // A YAML file missing the 'name' field — extractWorkflowMeta marks it invalid.
        await writeFile(join(wfDir, 'broken.yaml'), 'kind: state-machine\n');
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'list'], { output, cwd: dir, dbUrl: ':memory:' });

        // Exit 0 even with invalid entries (list is informational).
        expect(exitCode).toBe(0);
        // The ❌ marker + '<unnamed>' name identify the invalid entry.
        const hasBrokenEntry = output.messages.some((m) => m.includes('❌') && m.includes('<unnamed>'));
        expect(hasBrokenEntry).toBe(true);
    });
});
