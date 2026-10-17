import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { RequiresCapabilitiesSchema } from '@gobing-ai/spur-config';
import { loadWorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';

// Task 0706 R6: unattended high-risk built-in stages must declare their
// capability requirements. The selected stages are task-pipeline's `implement`
// and `remediate` (the former `test-fix`) — the two unattended, tree-mutating
// agent.run hops under the auto profile. `review` is the observe-only role and
// stays undeclared (D65 1239 merged the former `verify` into it); this test pins
// the selection so future stages must opt in explicitly.

const PROJECT_ROOT = resolve(__dirname, '../../../..');
const PIPELINE = resolve(PROJECT_ROOT, 'config', 'workflows', 'task-pipeline.yaml');

async function agentRunOptions(stateId: string): Promise<Record<string, unknown>> {
    const def = await loadWorkflowDef(PIPELINE, { validateSchema: false });
    const state = (
        def as unknown as {
            states: Array<{ id: string; onEnter?: Array<{ kind: string; options?: Record<string, unknown> }> }>;
        }
    ).states.find((state) => state.id === stateId);
    expect(state).toBeDefined();
    const action = state?.onEnter?.find((action) => action.kind === 'agent.run');
    expect(action).toBeDefined();
    return action?.options ?? {};
}

describe('task-pipeline capability requirement declarations (0706 R6)', () => {
    test('implement and remediate declare fsWrite+processSpawn availability', async () => {
        for (const stateId of ['implement', 'remediate']) {
            const options = await agentRunOptions(stateId);
            const parsed = RequiresCapabilitiesSchema.safeParse(options.requiresCapabilities);
            expect(parsed.success).toBe(true);
            expect(options.requiresCapabilities).toEqual({ fsWrite: 'available', processSpawn: 'available' });
        }
    });

    test('the observe-only stage (review) declares no requirements', async () => {
        for (const stateId of ['review']) {
            const options = await agentRunOptions(stateId);
            expect(options.requiresCapabilities).toBeUndefined();
        }
    });

    test('declared requirement shapes stay inside the closed vocabulary (0706 R8)', async () => {
        const options = await agentRunOptions('implement');
        const parsed = RequiresCapabilitiesSchema.safeParse(options.requiresCapabilities);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(
                Object.keys(parsed.data).every((axis) =>
                    ['fsRead', 'fsWrite', 'networkEgress', 'processSpawn', 'externalMutationApproval'].includes(axis),
                ),
            ).toBe(true);
        }
    });
});
