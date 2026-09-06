import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadWorkflowDef, type WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import {
    canonicalJsonStringify,
    computeDefinitionDigest,
    extractResolvedWorkflowFacts,
} from '../../src/workflow/composition-baseline';

const WORKFLOWS_DIR = resolve(__dirname, '../../../..', 'config', 'workflows');

async function loadDef(name: string): Promise<WorkflowDef> {
    return await loadWorkflowDef(join(WORKFLOWS_DIR, name), { validateSchema: false });
}

describe('Workflow composition digest', () => {
    test('canonicalJsonStringify sorts object keys while preserving array order', () => {
        const a = { x: 1, y: { b: 2, a: [3, { z: 1, c: 2 }] } };
        const b = { y: { a: [3, { c: 2, z: 1 }], b: 2 }, x: 1 };
        expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b));
        expect(canonicalJsonStringify({ arr: [2, 1] })).toBe(canonicalJsonStringify({ arr: [2, 1] }));
        expect(canonicalJsonStringify({ arr: [2, 1] })).not.toBe(canonicalJsonStringify({ arr: [1, 2] }));
    });

    test('computeDefinitionDigest is key-order invariant (byte-compat with prior baselines)', async () => {
        // The retired baseline files (0775 R1) were written with this exact
        // canonical serialization; the digest algorithm must not drift.
        const def = await loadDef('task-pipeline.yaml');
        const reordered = JSON.parse(canonicalJsonStringify(def)) as WorkflowDef;
        expect(computeDefinitionDigest(def)).toBe(computeDefinitionDigest(reordered));
        expect(computeDefinitionDigest(def)).toMatch(/^sha256:[0-9a-f]{64}$/);
        const changed = structuredClone(reordered) as WorkflowDef;
        const sm = changed as { states?: Array<{ id: string }> };
        const first = sm.states?.[0];
        if (first) first.id = `${first.id}-renamed`;
        expect(computeDefinitionDigest(changed)).not.toBe(computeDefinitionDigest(def));
    });

    test('extractResolvedWorkflowFacts extracts terminal states, model-bearing states, and actions', async () => {
        const facts = extractResolvedWorkflowFacts(await loadDef('task-pipeline.yaml'));
        expect(facts.terminalStates).toEqual(['done', 'failed', 'cancelled']);
        expect(facts.modelQueries).toEqual(['implement', 'test-fix', 'review', 'verify']);
        expect(facts.actions['implement:onEnter:0']?.kind).toBe('agent.run');
    });

    test('extractResolvedWorkflowFacts walks onExit actions (0775: no live onExit fixture remains)', () => {
        // The retired workflow-composition-baseline.json fixtures covered this branch;
        // the synthetic def keeps the onExit walker under the per-file coverage gate.
        const def = {
            name: 'synthetic',
            initialState: 'a',
            terminalStates: ['b'],
            states: [
                {
                    id: 'a',
                    onEnter: [{ kind: 'command.run', options: { command: 'echo enter' } }],
                    onExit: [
                        { kind: 'command.run', options: { command: 'echo exit' } },
                        { kind: 'agent.run', options: { prompt: 'review' } },
                    ],
                },
                { id: 'b' },
            ],
        } as unknown as WorkflowDef;
        const facts = extractResolvedWorkflowFacts(def);
        expect(facts.actions['a:onEnter:0']).toEqual({ kind: 'command.run', invocation: 'echo enter' });
        expect(facts.actions['a:onExit:0']).toEqual({ kind: 'command.run', invocation: 'echo exit' });
        expect(facts.actions['a:onExit:1']).toEqual({ kind: 'agent.run' });
        expect(facts.modelQueries).toEqual(['a']);
        expect(facts.terminalStates).toEqual(['b']);
    });

    test('live composition reader handles every repository workflow definition', async () => {
        const files = readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith('.yaml') && !f.endsWith('.test.yaml'));
        expect(files.length).toBeGreaterThan(5);
        for (const file of files) {
            const def = await loadDef(file);
            const facts = extractResolvedWorkflowFacts(def);
            expect(Array.isArray(facts.terminalStates)).toBe(true);
            expect(Array.isArray(facts.modelQueries)).toBe(true);
            expect(computeDefinitionDigest(def)).toMatch(/^sha256:[0-9a-f]{64}$/);
        }
    });
});
