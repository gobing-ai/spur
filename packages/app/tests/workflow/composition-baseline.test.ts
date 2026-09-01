import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadWorkflowDef, type WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    canonicalJsonStringify,
    checkWorkflowComposition,
    computeDefinitionDigest,
    extractResolvedWorkflowFacts,
    type WorkflowCompositionBaseline,
} from '../../src/workflow/composition-baseline';

const PROJECT_ROOT = resolve(__dirname, '../../../..');
const WORKFLOWS_DIR = resolve(PROJECT_ROOT, 'config', 'workflows');

describe('Workflow Composition Baseline', () => {
    test('canonicalJsonStringify recursively sorts object keys while preserving array order', () => {
        const obj1 = { z: 1, a: { y: 2, b: 3 }, arr: [3, 1, 2] };
        const obj2 = { a: { b: 3, y: 2 }, z: 1, arr: [3, 1, 2] };
        expect(canonicalJsonStringify(obj1)).toBe(canonicalJsonStringify(obj2));
        expect(canonicalJsonStringify(obj1)).toBe('{"a":{"b":3,"y":2},"arr":[3,1,2],"z":1}');
    });

    test('computeDefinitionDigest produces stable sha256 hex digest', async () => {
        const def = await loadWorkflowDef(resolve(WORKFLOWS_DIR, 'task-pipeline.yaml'), {
            validateSchema: false,
        });
        const digest1 = computeDefinitionDigest(def);
        const digest2 = computeDefinitionDigest(def);
        expect(digest1).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(digest1).toBe(digest2);
    });

    test('extractResolvedWorkflowFacts extracts terminal states, model queries, and actions', async () => {
        const def = await loadWorkflowDef(resolve(WORKFLOWS_DIR, 'task-pipeline.yaml'), {
            validateSchema: false,
        });
        const facts = extractResolvedWorkflowFacts(def);
        expect(facts.terminalStates).toEqual(['done', 'failed', 'cancelled']);
        expect(facts.modelQueries).toEqual(['implement', 'test-fix', 'review', 'verify']);
        expect(facts.actions['implement:onEnter:0']?.kind).toBe('agent.run');
    });

    test('checkWorkflowComposition passes on live repository definitions against checked baseline', async () => {
        const result = await checkWorkflowComposition({
            projectRoot: PROJECT_ROOT,
        });
        if (!result.pass) {
            console.error('Composition check errors:', result.errors);
        }
        expect(result.pass).toBe(true);
        expect(result.errors).toEqual([]);
        expect(result.diffs).toEqual([]);
    });

    test('feature-transition runs the corpus gate when sync fails after a possible partial transition (0625 R1)', async () => {
        const def = await loadWorkflowDef(resolve(WORKFLOWS_DIR, 'wrapup-pipeline.yaml'), {
            validateSchema: false,
        });
        const command = extractResolvedWorkflowFacts(def).actions['feature-transition:onEnter:0']?.invocation;
        expect(command).toBeTruthy();

        const dir = mkdtempSync(join(tmpdir(), 'spur-wrapup-partial-'));
        const fakeSpur = join(dir, 'spur');
        const transitionMarker = join(dir, 'transitioned');
        const gateMarker = join(dir, 'gate-ran');
        writeFileSync(fakeSpur, `#!/bin/sh\n: > '${transitionMarker}'\nexit 1\n`);
        chmodSync(fakeSpur, 0o755);

        try {
            const result = Bun.spawnSync({
                cmd: ['/bin/sh', '-c', command ?? 'exit 1'],
                cwd: dir,
                env: {
                    ...process.env,
                    feature: 'F91',
                    spurBin: fakeSpur,
                    featureGateCmd: `: > '${gateMarker}'`,
                },
            });
            expect(result.exitCode).toBe(0);
            expect(existsSync(transitionMarker)).toBe(true);
            expect(existsSync(gateMarker)).toBe(true);
            expect(new TextDecoder().decode(result.stdout)).toContain('corpus-aware gate PASS for feature F91');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('checkWorkflowComposition fails when live definition has a modified action kind (two-sided)', async () => {
        const baselineContent = await Bun.file(
            resolve(PROJECT_ROOT, 'config/workflow-composition-baseline.json'),
        ).json();
        const mutatedBaseline = JSON.parse(JSON.stringify(baselineContent)) as WorkflowCompositionBaseline;
        const docsWf = mutatedBaseline.workflows['docs-pipeline'];
        if (docsWf?.actions['draft:onEnter:0']) {
            docsWf.actions['draft:onEnter:0'].kind = 'shell';
        }

        const result = await checkWorkflowComposition({
            projectRoot: PROJECT_ROOT,
            baseline: mutatedBaseline,
        });
        expect(result.pass).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.diffs.some((d) => d.field === 'actions.draft:onEnter:0.kind')).toBe(true);
    });

    test('checkWorkflowComposition fails when baseline lists an unlisted action that does not exist', async () => {
        const baselineContent = await Bun.file(
            resolve(PROJECT_ROOT, 'config/workflow-composition-baseline.json'),
        ).json();
        const mutatedBaseline = JSON.parse(JSON.stringify(baselineContent)) as WorkflowCompositionBaseline;
        const docsWf = mutatedBaseline.workflows['docs-pipeline'];
        if (docsWf) {
            docsWf.actions['nonexistent:onEnter:0'] = { kind: 'shell' };
        }

        const result = await checkWorkflowComposition({
            projectRoot: PROJECT_ROOT,
            baseline: mutatedBaseline,
        });
        expect(result.pass).toBe(false);
        expect(result.errors.some((e) => e.includes('nonexistent:onEnter:0'))).toBe(true);
    });

    test('checkWorkflowComposition fails when baseline is missing an action present in live definition', async () => {
        const baselineContent = await Bun.file(
            resolve(PROJECT_ROOT, 'config/workflow-composition-baseline.json'),
        ).json();
        const mutatedBaseline = JSON.parse(JSON.stringify(baselineContent)) as WorkflowCompositionBaseline;
        const docsWf = mutatedBaseline.workflows['docs-pipeline'];
        if (docsWf) {
            delete docsWf.actions['draft:onEnter:0'];
        }

        const result = await checkWorkflowComposition({
            projectRoot: PROJECT_ROOT,
            baseline: mutatedBaseline,
        });
        expect(result.pass).toBe(false);
        expect(result.errors.some((e) => e.includes('draft:onEnter:0'))).toBe(true);
    });

    test('checkWorkflowComposition fails when baseline file does not exist', async () => {
        const result = await checkWorkflowComposition({
            projectRoot: PROJECT_ROOT,
            baselinePath: resolve(PROJECT_ROOT, 'config/non-existent-baseline.json'),
        });
        expect(result.pass).toBe(false);
        expect(result.errors.some((e) => e.includes('Baseline file not found'))).toBe(true);
    });

    test('checkWorkflowComposition fails when baseline JSON is invalid', async () => {
        const fs = {
            exists: async () => true,
            readFile: async () => 'invalid-json-content',
        };
        const result = await checkWorkflowComposition({
            projectRoot: PROJECT_ROOT,
            fileSystem: fs as unknown as import('@gobing-ai/ts-runtime').FileSystem,
        });
        expect(result.pass).toBe(false);
        expect(result.errors.some((e) => e.includes('Failed to parse baseline JSON'))).toBe(true);
    });

    test('checkWorkflowComposition fails when definition file is missing', async () => {
        const baselineContent = await Bun.file(
            resolve(PROJECT_ROOT, 'config/workflow-composition-baseline.json'),
        ).json();
        const mutatedBaseline = JSON.parse(JSON.stringify(baselineContent)) as WorkflowCompositionBaseline;
        const docsWf = mutatedBaseline.workflows['docs-pipeline'];
        if (docsWf) {
            docsWf.definition = '.spur/workflows/non-existent.yaml';
        }

        const result = await checkWorkflowComposition({
            projectRoot: PROJECT_ROOT,
            baseline: mutatedBaseline,
        });
        expect(result.pass).toBe(false);
        expect(result.errors.some((e) => e.includes('missing at .spur/workflows/non-existent.yaml'))).toBe(true);
    });

    test('checkWorkflowComposition fails when model queries differ', async () => {
        const baselineContent = await Bun.file(
            resolve(PROJECT_ROOT, 'config/workflow-composition-baseline.json'),
        ).json();
        const mutatedBaseline = JSON.parse(JSON.stringify(baselineContent)) as WorkflowCompositionBaseline;
        const docsWf = mutatedBaseline.workflows['docs-pipeline'];
        if (docsWf) {
            docsWf.modelQueries = ['non-existent-query'];
        }

        const result = await checkWorkflowComposition({
            projectRoot: PROJECT_ROOT,
            baseline: mutatedBaseline,
        });
        expect(result.pass).toBe(false);
        expect(result.diffs.some((d) => d.field === 'modelQueries')).toBe(true);
    });

    test('checkWorkflowComposition fails when action invocation differs', async () => {
        const baselineContent = await Bun.file(
            resolve(PROJECT_ROOT, 'config/workflow-composition-baseline.json'),
        ).json();
        const mutatedBaseline = JSON.parse(JSON.stringify(baselineContent)) as WorkflowCompositionBaseline;
        const docsWf = mutatedBaseline.workflows['docs-pipeline'];
        if (docsWf?.actions['draft:onEnter:0']) {
            docsWf.actions['draft:onEnter:0'].invocation = 'different-invocation';
        }

        const result = await checkWorkflowComposition({
            projectRoot: PROJECT_ROOT,
            baseline: mutatedBaseline,
        });
        expect(result.pass).toBe(false);
        expect(result.diffs.some((d) => d.field.includes('invocation'))).toBe(true);
    });

    test('checkWorkflowComposition fails when a live-present invocation is unrecorded in the baseline (R5 blind spot)', async () => {
        const baselineContent = await Bun.file(
            resolve(PROJECT_ROOT, 'config/workflow-composition-baseline.json'),
        ).json();
        const mutatedBaseline = JSON.parse(JSON.stringify(baselineContent)) as WorkflowCompositionBaseline;
        const docsWf = mutatedBaseline.workflows['docs-pipeline'];
        // draft:onEnter:1 is a shell action whose invocation IS recorded in the checked
        // baseline; dropping the record simulates a baseline that never captured it —
        // exactly the unrecorded-but-present invocation case R5 closes.
        if (docsWf?.actions['draft:onEnter:1']) {
            delete docsWf.actions['draft:onEnter:1'].invocation;
        }

        const result = await checkWorkflowComposition({
            projectRoot: PROJECT_ROOT,
            baseline: mutatedBaseline,
        });
        expect(result.pass).toBe(false);
        expect(result.diffs.some((d) => d.field === 'actions.draft:onEnter:1.invocation')).toBe(true);
    });

    test('checkWorkflowComposition fails when an action shell body changes without a baseline update', async () => {
        const baselineContent = await Bun.file(
            resolve(PROJECT_ROOT, 'config/workflow-composition-baseline.json'),
        ).json();
        const mutatedBaseline = JSON.parse(JSON.stringify(baselineContent)) as WorkflowCompositionBaseline;
        const docsWf = mutatedBaseline.workflows['docs-pipeline'];
        // The baseline records the live invocation string; simulating a silent shell-body
        // edit means the baseline invocation no longer matches the live definition.
        if (docsWf?.actions['draft:onEnter:1']) {
            docsWf.actions['draft:onEnter:1'].invocation = 'echo "rewritten shell body without baseline update"';
        }

        const result = await checkWorkflowComposition({
            projectRoot: PROJECT_ROOT,
            baseline: mutatedBaseline,
        });
        expect(result.pass).toBe(false);
        expect(result.diffs.some((d) => d.field === 'actions.draft:onEnter:1.invocation')).toBe(true);
    });

    test('checkWorkflowComposition fails when terminal states differ', async () => {
        const baselineContent = await Bun.file(
            resolve(PROJECT_ROOT, 'config/workflow-composition-baseline.json'),
        ).json();
        const mutatedBaseline = JSON.parse(JSON.stringify(baselineContent)) as WorkflowCompositionBaseline;
        const docsWf = mutatedBaseline.workflows['docs-pipeline'];
        if (docsWf) {
            docsWf.terminalStates = ['unexpected-state'];
        }

        const result = await checkWorkflowComposition({
            projectRoot: PROJECT_ROOT,
            baseline: mutatedBaseline,
        });
        expect(result.pass).toBe(false);
        expect(result.diffs.some((d) => d.field === 'terminalStates')).toBe(true);
    });

    test('checkWorkflowComposition fails when workflow definition file fails to parse', async () => {
        const tempDir = resolve(PROJECT_ROOT, '.spur', 'run', 'temp-test-baseline-dir');
        const fs = createNodeFileSystem();
        await fs.ensureDir(tempDir);
        await fs.writeFile(resolve(tempDir, 'invalid.yaml'), ': : : invalid yaml content');

        const baselineContent = await Bun.file(
            resolve(PROJECT_ROOT, 'config/workflow-composition-baseline.json'),
        ).json();
        const mutatedBaseline = JSON.parse(JSON.stringify(baselineContent)) as WorkflowCompositionBaseline;
        mutatedBaseline.workflows['invalid-wf'] = {
            definition: '.spur/run/temp-test-baseline-dir/invalid.yaml',
            terminalStates: [],
            modelQueries: [],
            actions: {},
        };

        const result = await checkWorkflowComposition({
            projectRoot: PROJECT_ROOT,
            baseline: mutatedBaseline,
        });
        expect(result.pass).toBe(false);
        expect(result.errors.some((e) => e.includes('Failed to load workflow definition'))).toBe(true);

        await fs.deleteFile(resolve(tempDir, 'invalid.yaml'));
    });

    test('extractResolvedWorkflowFacts handles onExit actions and state transitions', () => {
        const def = {
            kind: 'state-machine',
            name: 'test-wf',
            initialState: 's1',
            terminalStates: ['s2'],
            states: [
                {
                    id: 's1',
                    onExit: [
                        { kind: 'agent.run', options: { input: 'exit-cmd' } },
                        { kind: 'shell', options: { command: 'echo bye' } },
                    ],
                },
            ],
        };
        const facts = extractResolvedWorkflowFacts(def as unknown as WorkflowDef);
        expect(facts.actions['s1:onExit:0']?.kind).toBe('agent.run');
        expect(facts.actions['s1:onExit:0']?.invocation).toBe('exit-cmd');
        expect(facts.actions['s1:onExit:1']?.kind).toBe('shell');
        expect(facts.actions['s1:onExit:1']?.invocation).toBe('echo bye');
        expect(facts.modelQueries).toEqual(['s1']);
    });

    // A YAML folded scalar (`>-`) only joins lines at the block's base indentation;
    // a MORE-indented line keeps its newline. Indenting a command's flags to line them
    // up under the command therefore splits one invocation into several, and the flag
    // lines run as their own commands ("--executor: command not found"). This shipped
    // undetected in task-pipeline's precheck-size action, where it silently dropped
    // --spur-bin/--max-reqs/--max-plan-items/--executor and killed the 0487
    // size-vs-capability gate. A continuation line starting with `-` is always this bug.
    test('no live workflow shell command splits an argument list across lines', async () => {
        const dir = WORKFLOWS_DIR;
        const offenders: string[] = [];
        for (const file of Array.from(new Bun.Glob('*.yaml').scanSync(dir)).sort()) {
            const def = await loadWorkflowDef(resolve(dir, file), { validateSchema: false });
            for (const [key, action] of Object.entries(extractResolvedWorkflowFacts(def).actions)) {
                for (const line of (action.invocation ?? '').split('\n').slice(1)) {
                    if (/^\s*-/.test(line)) offenders.push(`${file} ${key}: ${line.trim()}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});
