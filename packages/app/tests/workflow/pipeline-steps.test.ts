/**
 * `@gobing-ai/spur-app/pipeline-steps` (packages/app/src/workflow/pipeline-steps.ts): the narrow
 * entry the PR-5 CLI verbs import. Pins that the subpath export resolves and re-exports the same
 * operations the source modules define (behavior is tested beside each module).
 */
import { describe, expect, test } from 'bun:test';
import * as entry from '@gobing-ai/spur-app/pipeline-steps';
import { runPreflight } from '../../src/services/planning-preflight';
import { runBatchPlan } from '../../src/workflow/batch-plan';
import { runDriftProbe } from '../../src/workflow/wrapup/drift-probe';
import { spurCommand } from '../../src/workflow/wrapup/spur-command';
import { isWrapupStepOp, runWrapupStep, WRAPUP_STEP_OPS } from '../../src/workflow/wrapup/steps';

describe('pipeline-steps entry', () => {
    test('the package subpath re-exports the source operations by identity', () => {
        expect(entry.runPreflight).toBe(runPreflight);
        expect(entry.runBatchPlan).toBe(runBatchPlan);
        expect(entry.runDriftProbe).toBe(runDriftProbe);
        expect(entry.runWrapupStep).toBe(runWrapupStep);
        expect(entry.spurCommand).toBe(spurCommand);
        expect(entry.isWrapupStepOp).toBe(isWrapupStepOp);
    });

    test('every wrapup op the CLI documents is a recognised step', () => {
        expect([...entry.WRAPUP_STEP_OPS]).toEqual([...WRAPUP_STEP_OPS]);
        for (const op of entry.WRAPUP_STEP_OPS) expect(entry.isWrapupStepOp(op)).toBe(true);
        expect(entry.isWrapupStepOp('nope')).toBe(false);
        expect(entry.BATCH_PLAN_MODES).toEqual(['waves', 'order', 'task-children']);
    });
});
