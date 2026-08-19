import { describe, expect, test } from 'bun:test';
import type { FinalizeIdeaHandoffResult } from '../../src/workflow/idea-handoff';
import { runIdeaHandoffCli } from '../../src/workflow/idea-handoff-cli';

const ok: FinalizeIdeaHandoffResult = {
    ok: true,
    wbsList: ['0701', '0702'],
    nextCommand: '/sp:dev-runall --feature D6 --auto',
    reportPath: '.spur/run/run-1-idea-handoff.md',
};

describe('runIdeaHandoffCli', () => {
    test('fails closed when __runId is missing rather than finalizing a run it cannot identify', async () => {
        let called = false;
        const outcome = await runIdeaHandoffCli({ featureId: 'D6' }, async () => {
            called = true;
            return ok;
        });

        expect(outcome.exitCode).toBe(1);
        // A missing run id would scope artifacts to the wrong path, so finalization
        // must not run at all — not run-and-then-report.
        expect(called).toBe(false);
    });

    test('fails closed when featureId is missing', async () => {
        let called = false;
        const outcome = await runIdeaHandoffCli({ __runId: 'run-1' }, async () => {
            called = true;
            return ok;
        });

        expect(outcome.exitCode).toBe(1);
        expect(called).toBe(false);
    });

    test('passes the resolved spurBin through so the child CLI is PATH-independent', async () => {
        let seen: { runId: string; featureId: string; spurBin?: string } | undefined;
        const outcome = await runIdeaHandoffCli(
            { __runId: 'run-1', featureId: 'D6', spurBin: '/usr/bin/bun /repo/apps/cli/src/index.ts' },
            async (options) => {
                seen = options;
                return ok;
            },
        );

        expect(outcome.exitCode).toBe(0);
        expect(seen?.runId).toBe('run-1');
        expect(seen?.featureId).toBe('D6');
        expect(seen?.spurBin).toBe('/usr/bin/bun /repo/apps/cli/src/index.ts');
    });

    test('defaults spurBin to the bare binary when the workflow var is unset', async () => {
        let seen: { spurBin?: string } | undefined;
        await runIdeaHandoffCli({ __runId: 'run-1', featureId: 'D6' }, async (options) => {
            seen = options;
            return ok;
        });

        expect(seen?.spurBin).toBe('spur');
    });

    test('reports a non-zero exit when finalization fails so the pipeline routes to failed', async () => {
        const outcome = await runIdeaHandoffCli({ __runId: 'run-1', featureId: 'D6' }, async () => ({
            ok: false,
            wbsList: [],
            nextCommand: '',
            reportPath: '',
            error: 'batch/result length mismatch',
        }));

        expect(outcome.exitCode).toBe(1);
        expect(outcome.result?.error).toBe('batch/result length mismatch');
    });

    test('returns the finalization result on success', async () => {
        const outcome = await runIdeaHandoffCli({ __runId: 'run-1', featureId: 'D6' }, async () => ok);

        expect(outcome.exitCode).toBe(0);
        expect(outcome.result?.wbsList).toEqual(['0701', '0702']);
        expect(outcome.result?.nextCommand).toBe('/sp:dev-runall --feature D6 --auto');
    });
});
