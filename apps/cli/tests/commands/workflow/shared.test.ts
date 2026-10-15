/**
 * Unit tests for the helpers `spur workflow` verbs share
 * (apps/cli/src/commands/workflow/shared.ts). Verb behaviour is covered end-to-end by the
 * sibling `<verb>.test.ts` files.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowAppService, type WorkflowObservabilityBus } from '@gobing-ai/spur-app';
import { getEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { EventBus } from '@gobing-ai/ts-infra';
import {
    asyncRegisterTimeoutMs,
    makeEscalationPacketSink,
    makeWorkflowService,
    resolveWorkflowPaths,
    shQuote,
    takeAsyncWorkerEnv,
    workflowPlanArtifactPath,
} from '../../../src/commands/workflow/shared';
import { type CliContext, createCliContext } from '../../../src/context';
import { createCapturedOutput } from '../../helpers';

const roots: string[] = [];
afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('shQuote', () => {
    test('single-quotes a value and escapes embedded single quotes', () => {
        expect(shQuote('plain')).toBe(`'plain'`);
        expect(shQuote(`it's`)).toBe(`'it'\\''s'`);
    });
});

describe('takeAsyncWorkerEnv', () => {
    test('reads the launcher handshake once and removes it from the environment', () => {
        setEnvVar('SPUR_EXPECTED_DEFINITION_DIGEST', 'sha256:abc');
        setEnvVar('SPUR_ASYNC_WORKER', '1');
        expect(takeAsyncWorkerEnv()).toEqual({ expectedDigest: 'sha256:abc', isAsyncWorker: true });
        expect(getEnvVar('SPUR_EXPECTED_DEFINITION_DIGEST')).toBeUndefined();
        expect(getEnvVar('SPUR_ASYNC_WORKER')).toBeUndefined();
        expect(takeAsyncWorkerEnv()).toEqual({ expectedDigest: undefined, isAsyncWorker: false });
    });
});

describe('asyncRegisterTimeoutMs', () => {
    test('defaults to 5000 ms and honours a positive integer override', () => {
        expect(asyncRegisterTimeoutMs(null)).toBe(5000);
        expect(asyncRegisterTimeoutMs({ bootstrap: { options: { asyncRegisterTimeoutMs: 250 } } } as never)).toBe(250);
    });

    test('a malformed override throws instead of disabling the check', () => {
        expect(() =>
            asyncRegisterTimeoutMs({ bootstrap: { options: { asyncRegisterTimeoutMs: '5s' } } } as never),
        ).toThrow(/positive integer/);
    });
});

describe('paths', () => {
    test('workflowPlanArtifactPath is run-scoped under .spur/run', () => {
        expect(workflowPlanArtifactPath('run-1')).toBe(join('.spur', 'run', 'run-1-workflow-plan.json'));
    });

    test('resolveWorkflowPaths defaults to the project layer and keeps configured entries', () => {
        expect(resolveWorkflowPaths(null)).toEqual(['.spur/workflows/']);
        expect(resolveWorkflowPaths({ workflows: { paths: ['extra/flows/'] } } as never)).toEqual(['extra/flows/']);
    });
});

describe('service and sink factories', () => {
    async function context(): Promise<CliContext> {
        const root = await mkdtemp(join(tmpdir(), 'spur-workflow-shared-'));
        roots.push(root);
        return createCliContext({ cwd: root, output: createCapturedOutput(), dbUrl: ':memory:' });
    }

    test('makeWorkflowService builds the app service with and without a bus', async () => {
        const ctx = await context();
        const bus = new EventBus() as unknown as WorkflowObservabilityBus;
        expect(makeWorkflowService(ctx)).toBeInstanceOf(WorkflowAppService);
        expect(makeWorkflowService(ctx, true, bus)).toBeInstanceOf(WorkflowAppService);
    });

    test('makeEscalationPacketSink returns a sink, and undefined when construction fails', async () => {
        const ctx = await context();
        const bus = new EventBus() as unknown as WorkflowObservabilityBus;
        expect(await makeEscalationPacketSink(bus, ctx)).toBeDefined();
        const broken = {
            ...ctx,
            getDb: () => Promise.reject(new Error('db down')),
        } as CliContext;
        expect(await makeEscalationPacketSink(bus, broken)).toBeUndefined();
    });
});
