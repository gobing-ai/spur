import { describe, expect, test } from 'bun:test';
import { loadRunCorrelation, wbsFromVar } from '../../src/workflow/run-correlation';

function persistence(overrides: {
    run?: Record<string, unknown> | undefined;
    snapshot?: { state: string; data: { effectiveVars: Record<string, string> } } | undefined;
    throwOnLoad?: boolean;
}) {
    return {
        loadRun: async () => {
            if (overrides.throwOnLoad) throw new Error('db unavailable');
            return overrides.run;
        },
        loadLatestStateSnapshot: async () => {
            if (overrides.throwOnLoad) throw new Error('db unavailable');
            return overrides.snapshot;
        },
    } as never;
}

describe('run correlation (task 1113 R3)', () => {
    test('wbsFromVar accepts 4-digit wbs and rejects placeholder, empty and malformed values', () => {
        expect(wbsFromVar('1113')).toBe('1113');
        expect(wbsFromVar('0000')).toBeUndefined();
        expect(wbsFromVar('')).toBeUndefined();
        expect(wbsFromVar('abc')).toBeUndefined();
        expect(wbsFromVar('12345')).toBeUndefined();
        expect(wbsFromVar(undefined)).toBeUndefined();
    });

    test('loadRunCorrelation reads workflow_name from the run row and wbs from the snapshot effective vars', async () => {
        const correlation = await loadRunCorrelation(
            persistence({
                run: { runId: 'r-1', workflow_name: 'task-pipeline' },
                snapshot: { state: 'decide', data: { effectiveVars: { wbs: '1113' } } },
            }),
            'r-1',
        );
        expect(correlation).toEqual({ workflowName: 'task-pipeline', wbs: '1113' });
    });

    test('absent run or snapshot leaves the fields out instead of leaking placeholders', async () => {
        expect(await loadRunCorrelation(persistence({ run: undefined, snapshot: undefined }), 'r-1')).toEqual({});
        expect(
            await loadRunCorrelation(
                persistence({
                    run: { runId: 'r-1', workflow_name: 'task-pipeline' },
                    snapshot: { state: 'x', data: { effectiveVars: { wbs: '0000' } } },
                }),
                'r-1',
            ),
        ).toEqual({ workflowName: 'task-pipeline' });
    });

    test('lookup failures never throw — the caller proceeds without correlation', async () => {
        expect(await loadRunCorrelation(persistence({ throwOnLoad: true }), 'r-1')).toEqual({});
    });
});
