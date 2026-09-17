import { describe, expect, test } from 'bun:test';
import type { ActionResult, GuardContext } from '@gobing-ai/ts-dual-workflow-engine';
import { ContractViolationGuardRunner } from '../../../src/workflow/guards/contract-violation';

function makeCtx(lastActionResult?: ActionResult): GuardContext {
    return {
        runId: 'run-1',
        current: 'doc-sync',
        vars: {},
        ...(lastActionResult !== undefined ? { lastActionResult } : {}),
    } as GuardContext;
}

const runner = new ContractViolationGuardRunner();

describe('ContractViolationGuardRunner (task 0871 / ADR-118)', () => {
    test('kind is contract-violation', () => {
        expect(runner.kind).toBe('contract-violation');
    });

    test('passes when the prior action result is a named contract violation', async () => {
        const result = await runner.evaluate(
            {},
            makeCtx({
                ok: false,
                data: { outcome: 'contract-violation', contract: 'expectFile', observed: 'empty' },
                error: 'exited 0 but expected file is empty',
            }),
        );

        expect(result.passed).toBe(true);
        expect(result.report).toEqual({ contract: 'expectFile', observed: 'empty' });
    });

    test('fails on a successful prior action (no outcome discriminator)', async () => {
        const result = await runner.evaluate({}, makeCtx({ ok: true, data: { answer: 'captured' } }));

        expect(result.passed).toBe(false);
        expect(result.report).toBeUndefined();
    });

    test('fails on an executor failure (ok:false with no contract discriminator)', async () => {
        const result = await runner.evaluate(
            {},
            makeCtx({
                ok: false,
                data: { exitCode: 3, stdout: '', stderr: '' },
                error: 'exited with code 3',
            }),
        );

        expect(result.passed).toBe(false);
        expect(result.report).toBeUndefined();
    });

    test('fails when there is no prior action result', async () => {
        const result = await runner.evaluate({}, makeCtx());

        expect(result.passed).toBe(false);
        expect(result.report).toBeUndefined();
    });

    test('ignores any options (the guard is discriminator-only)', async () => {
        const result = await runner.evaluate(
            { anything: 'ignored' },
            makeCtx({ ok: false, data: { outcome: 'contract-violation', contract: 'requireDiff', observed: 'empty' } }),
        );

        expect(result.passed).toBe(true);
        expect(result.report).toEqual({ contract: 'requireDiff', observed: 'empty' });
    });
});
