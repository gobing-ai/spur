/**
 * Thin-wrapper integration tests for `spur workflow show` (apps/cli/src/commands/workflow/show.ts).
 * Behavioral tests for WorkflowAppService live in packages/app/tests/services/workflow-service.test.ts.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _resetAgentServiceShimsForTest, buildWorkflowSteps } from '@gobing-ai/spur-app';
import { loadWorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import { main } from '../../../src/index';
import { renderWorkflowMermaid } from '../../../src/workflow/mermaid-render';
import { createCapturedOutput, createTempProject, runCli } from '../../helpers';

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

describe('spur workflow show', () => {
    test('R4: show resolves registered-only names in both formats', async () => {
        const dir = await createTempProject();
        await mkdir(join(dir, '.spur'), { recursive: true });
        await mkdir(join(dir, 'ops'), { recursive: true });
        await writeFile(join(dir, '.spur', 'config.yaml'), 'workflows:\n  paths:\n    - ops\n');
        const wf = join(dir, 'ops', 'custom.yaml');
        await writeFile(wf, MINIMAL_WORKFLOW_YAML);
        try {
            for (const format of ['mermaid', 'todo']) {
                const result = await runCli(['workflow', 'show', 'cli-test-flow', '--format', format, '--json'], dir);
                expect(result.code).toBe(0);
                expect(result.json).toMatchObject({ source: { layer: 'registered', path: await realpath(wf) } });
            }
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('renders a fenced mermaid diagram for a valid definition', async () => {
        const dir = await createTempProject();
        const wf = join(dir, 'wf.yaml');
        await writeFile(wf, MINIMAL_WORKFLOW_YAML);
        const res = await runCli(['workflow', 'show', wf], dir);
        expect(res.code).toBe(0);
        expect(res.stdout).toContain('```mermaid');
        expect(res.stdout).toContain('flowchart TD');
        expect(res.stdout).toContain('start["start"]');
        expect(res.stdout).toContain('done(["done"])');
        expect(res.stdout).toContain('class done terminal;');
        expect(res.stdout).toContain('start --> done');
        await rm(dir, { recursive: true, force: true });
    });

    test('exits non-zero naming the file on a missing definition with no partial diagram', async () => {
        const dir = await createTempProject();
        const res = await runCli(['workflow', 'show', join(dir, 'missing.yaml')], dir);
        expect(res.code).not.toBe(0);
        expect(res.stderr + res.stdout).toContain('missing.yaml');
        expect(res.stdout).not.toContain('```mermaid');
        await rm(dir, { recursive: true, force: true });
    });

    const TODO_WORKFLOW_YAML = `name: cli-todo-flow
kind: state-machine
initialState: start
terminalStates:
  - done
  - failed
failureStates:
  - failed
states:
  - id: start
  - id: work
    pause: true
  - id: done
  - id: failed
transitions:
  - from: start
    to: work
  - from: work
    to: done
    guard:
      kind: approved
  - from: work
    to: failed
    guard:
      kind: always
  - from: work
    to: work
`;

    test('bare invocation is byte-identical to --format mermaid and the renderer output (0695 R1)', async () => {
        const dir = await createTempProject();
        const wf = join(dir, 'wf.yaml');
        await writeFile(wf, MINIMAL_WORKFLOW_YAML);
        const bare = createCapturedOutput();
        const explicit = createCapturedOutput();
        expect(await main(['workflow', 'show', wf], { output: bare, cwd: dir, dbUrl: ':memory:' })).toBe(0);
        expect(
            await main(['workflow', 'show', wf, '--format', 'mermaid'], {
                output: explicit,
                cwd: dir,
                dbUrl: ':memory:',
            }),
        ).toBe(0);
        expect(bare.messages).toEqual(explicit.messages);
        const def = await loadWorkflowDef(wf, { validateSchema: true });
        expect(bare.messages).toEqual([renderWorkflowMermaid(def)]);
        await rm(dir, { recursive: true, force: true });
    });

    test('--format todo renders the declared-step checklist with markers (0695 R3)', async () => {
        const dir = await createTempProject();
        const wf = join(dir, 'wf.yaml');
        await writeFile(wf, TODO_WORKFLOW_YAML);
        const output = createCapturedOutput();
        expect(await main(['workflow', 'show', wf, '--format', 'todo'], { output, cwd: dir, dbUrl: ':memory:' })).toBe(
            0,
        );
        // The renderer returns one multi-line string — the whole checklist as a single message.
        expect(output.messages).toEqual([
            [
                '# cli-todo-flow (state-machine) — declared steps',
                '',
                'Declared step inventory in declaration order, not a predicted execution path.',
                '',
                '- [ ] A. start — initial',
                '- [ ] B. work — pause · loop-back',
                '- [ ] C. done — terminal · conditional',
                '- [ ] D. failed — terminal · failure · conditional',
            ].join('\n'),
        ]);
        await rm(dir, { recursive: true, force: true });
    });

    test('--format todo --json emits { name, kind, format, steps } with markers (0695 R4)', async () => {
        const dir = await createTempProject();
        const wf = join(dir, 'wf.yaml');
        await writeFile(wf, TODO_WORKFLOW_YAML);
        const output = createCapturedOutput();
        expect(
            await main(['workflow', 'show', wf, '--format', 'todo', '--json'], { output, cwd: dir, dbUrl: ':memory:' }),
        ).toBe(0);
        expect(JSON.parse(output.messages.join('\n'))).toEqual({
            name: 'cli-todo-flow',
            kind: 'state-machine',
            format: 'todo',
            definitionDigest: 'sha256:671f9be44a311087ce05057074e7b8b5ca0ccdd4bc2ecc5b79f8d5ccfa1620ac',
            version: null,
            // 0819 R4: explicit paths always resolve from the project layer.
            source: { layer: 'project', path: wf },
            steps: [
                {
                    id: 'start',
                    initial: true,
                    terminal: false,
                    failure: false,
                    pause: false,
                    loopBack: false,
                    conditional: false,
                },
                {
                    id: 'work',
                    initial: false,
                    terminal: false,
                    failure: false,
                    pause: true,
                    loopBack: true,
                    conditional: false,
                },
                {
                    id: 'done',
                    initial: false,
                    terminal: true,
                    failure: false,
                    pause: false,
                    loopBack: false,
                    conditional: true,
                },
                {
                    id: 'failed',
                    initial: false,
                    terminal: true,
                    failure: true,
                    pause: false,
                    loopBack: false,
                    conditional: true,
                },
            ],
            // 1104 R4: additive — null unless a state declares display.
            plan: null,
        });
        await rm(dir, { recursive: true, force: true });
    });

    test('bare --json emits the mermaid envelope with the exact diagram (0695 R4)', async () => {
        const dir = await createTempProject();
        const wf = join(dir, 'wf.yaml');
        await writeFile(wf, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();
        expect(await main(['workflow', 'show', wf, '--json'], { output, cwd: dir, dbUrl: ':memory:' })).toBe(0);
        expect(JSON.parse(output.messages.join('\n'))).toEqual({
            name: 'cli-test-flow',
            kind: 'state-machine',
            format: 'mermaid',
            definitionDigest: 'sha256:2cd0a58183d3f75b3fc783e28e1adbe566da06af53938ecb067b738196e3774b',
            version: null,
            // 0819 R4: explicit paths always resolve from the project layer.
            source: { layer: 'project', path: wf },
            diagram: renderWorkflowMermaid(await loadWorkflowDef(wf, { validateSchema: true })),
        });
        await rm(dir, { recursive: true, force: true });
    });

    test('unknown --format exits non-zero naming both accepted values (0695 R7)', async () => {
        const dir = await createTempProject();
        const wf = join(dir, 'wf.yaml');
        await writeFile(wf, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();
        expect(
            await main(['workflow', 'show', wf, '--format', 'outline'], { output, cwd: dir, dbUrl: ':memory:' }),
        ).toBe(1);
        expect(output.errors).toEqual(["workflow show: unknown --format 'outline' — expected mermaid or todo"]);
        await rm(dir, { recursive: true, force: true });
    });

    test('unresolvable path exits 1 with the same message under every format (0695 R8)', async () => {
        const dir = await createTempProject();
        const missing = join(dir, 'missing.yaml');
        const mermaid = createCapturedOutput();
        const todo = createCapturedOutput();
        expect(await main(['workflow', 'show', missing], { output: mermaid, cwd: dir, dbUrl: ':memory:' })).toBe(1);
        expect(
            await main(['workflow', 'show', missing, '--format', 'todo'], {
                output: todo,
                cwd: dir,
                dbUrl: ':memory:',
            }),
        ).toBe(1);
        expect(todo.errors).toEqual(mermaid.errors);
        expect(todo.messages).toEqual([]);
        await rm(dir, { recursive: true, force: true });
    });

    test('a definition failing schema validation exits 1 identically under every format (0695 R8)', async () => {
        const dir = await createTempProject();
        const bad = join(dir, 'bad.yaml');
        await writeFile(bad, 'name: broken\nkind: state-machine\ninitialState: start\nstates: []\ntransitions: []\n');
        const mermaid = createCapturedOutput();
        const todo = createCapturedOutput();
        expect(await main(['workflow', 'show', bad], { output: mermaid, cwd: dir, dbUrl: ':memory:' })).toBe(1);
        expect(
            await main(['workflow', 'show', bad, '--format', 'todo'], { output: todo, cwd: dir, dbUrl: ':memory:' }),
        ).toBe(1);
        expect(todo.errors).toEqual(mermaid.errors);
        expect(todo.errors[0]).toContain('cannot read or parse');
        await rm(dir, { recursive: true, force: true });
    });

    test('--format todo renders the same sequence buildWorkflowSteps derives (0695 R5)', async () => {
        const dir = await createTempProject();
        const wf = join(dir, 'wf.yaml');
        await writeFile(wf, TODO_WORKFLOW_YAML);
        const output = createCapturedOutput();
        expect(
            await main(['workflow', 'show', wf, '--format', 'todo', '--json'], { output, cwd: dir, dbUrl: ':memory:' }),
        ).toBe(0);
        const def = await loadWorkflowDef(wf, { validateSchema: true });
        expect(JSON.parse(output.messages.join('\n'))).toMatchObject({ steps: buildWorkflowSteps(def) });
        await rm(dir, { recursive: true, force: true });
    });

    test('R2: CLI workflow run passes spurConfig through makeSvc resolving default agent (task 0752)', async () => {
        const dir = await createTempProject();
        const wf = join(dir, 'wf.yaml');
        await writeFile(wf, MINIMAL_WORKFLOW_YAML);
        await mkdir(join(dir, '.spur'), { recursive: true });
        await writeFile(join(dir, '.spur', 'config.yaml'), 'agent:\n  default: coder\n');
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'run', wf, '--dry-run'], {
            output,
            cwd: dir,
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(0);
        await rm(dir, { recursive: true, force: true });
    });
});
