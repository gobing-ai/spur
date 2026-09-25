import { describe, expect, test } from 'bun:test';
import { DbWorkflowPersistenceAdapter, type WorkflowPersistenceAdapter } from '@gobing-ai/ts-dual-workflow-engine';
import {
    BOOKKEEPING_WORKFLOWS,
    classifyTerminalReason,
    isBookkeepingWorkflow,
    isTerminalReason,
    TERMINAL_REASONS,
    WorkflowActionTraceWriter,
} from '../../src';

describe('terminal-reason (0937)', () => {
    test('R1: the closed enum and its guard', () => {
        expect(TERMINAL_REASONS).toEqual([
            'done',
            'paused-operator',
            'failed-check',
            'failed-agent',
            'failed-timeout',
            'failed-guard',
            'cancelled',
            'interrupted',
            'retry-exhausted',
        ]);
        expect(isTerminalReason('failed-guard')).toBe(true);
        expect(isTerminalReason('terminal:failed')).toBe(false);
        expect(isTerminalReason('')).toBe(false);
    });

    test('R4: engine built-ins map deterministically; declared enum values pass through', () => {
        expect(classifyTerminalReason({ status: 'failed', engineReason: 'terminal:failed' })).toBe('failed-check');
        expect(classifyTerminalReason({ status: 'failed', engineReason: 'no-passing-transition' })).toBe(
            'failed-guard',
        );
        expect(classifyTerminalReason({ status: 'failed', engineReason: 'no-passing-edge' })).toBe('failed-guard');
        expect(classifyTerminalReason({ status: 'failed', engineReason: 'iteration-bound-exceeded' })).toBe(
            'retry-exhausted',
        );
        expect(
            classifyTerminalReason({
                status: 'failed',
                engineReason: 'failed',
                errorText: 'request timeout after 30s',
            }),
        ).toBe('failed-timeout');
        expect(classifyTerminalReason({ status: 'failed', engineReason: 'failed', actionKind: 'agent.run' })).toBe(
            'failed-agent',
        );
        // Declared reasons (YAML terminalReason, lifecycle cancel) are enum values — passthrough.
        expect(classifyTerminalReason({ status: 'failed', engineReason: 'failed-agent' })).toBe('failed-agent');
        expect(classifyTerminalReason({ status: 'failed', engineReason: 'cancelled' })).toBe('cancelled');
    });

    test('R4: status-only closes classify (interrupt/pause/done) without guessing failed runs', () => {
        expect(classifyTerminalReason({ status: 'interrupted' })).toBe('interrupted');
        expect(classifyTerminalReason({ status: 'paused' })).toBe('paused-operator');
        expect(classifyTerminalReason({ status: 'done' })).toBe('done');
    });

    test('R5: bookkeeping workflows are the shared constant list', () => {
        expect(BOOKKEEPING_WORKFLOWS).toEqual(['task-lifecycle', 'feature-lifecycle']);
        expect(isBookkeepingWorkflow('task-lifecycle')).toBe(true);
        expect(isBookkeepingWorkflow('task-pipeline')).toBe(false);
    });

    test('R2/R4: the trace writer classifies and forwards the reason through finalizeRun and closeRun', async () => {
        const seen: Array<{ reason: string | undefined; status: string }> = [];
        const inner = {
            loadRun: async () => ({ id: 'run-1' }),
            finalizeRun: async (
                _runId: string,
                status: string,
                _completedAt: string,
                _fence?: { readonly ownerAttempt: string },
                reason?: string,
            ) => {
                seen.push({ status, reason });
                return false;
            },
        } as unknown as WorkflowPersistenceAdapter;
        const writer = new WorkflowActionTraceWriter(inner);

        // Engine built-in is opaque — the decorator classifies it at the seam.
        await writer.finalizeRun('run-1', 'failed', '2026-09-25T00:00:00Z', { ownerAttempt: 'a1' }, 'terminal:failed');
        // A declared enum value survives untouched.
        await writer.finalizeRun('run-1', 'failed', '2026-09-25T00:00:01Z', undefined, 'failed-agent');
        // closeRun forwards the declared reason the same way.
        await writer.closeRun('run-1', 'failed', '2026-09-25T00:00:02Z', 'retry-exhausted');
        // No reason → none written (legacy-shaped rows stay null; R6).
        await writer.closeRun('run-1', 'done');

        expect(seen).toEqual([
            { status: 'failed', reason: 'failed-check' },
            { status: 'failed', reason: 'failed-agent' },
            { status: 'failed', reason: 'retry-exhausted' },
            { status: 'done', reason: undefined },
        ]);
    });

    test('the 0.5.6 DB adapter persists the classified reason into runs.terminal_reason', async () => {
        // The enum-level contract this whole chain relies on: the engine's finalizeRun
        // writes the 5th argument into the column the migration adds.
        const { mkdtempSync, rmSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const { openInlineRunProjectDb } = await import('../../src');
        const base = mkdtempSync(join(tmpdir(), 'spur-0937-reason-'));
        const projectDb = await openInlineRunProjectDb(base);
        try {
            const adapter = new DbWorkflowPersistenceAdapter(projectDb.adapter);
            await adapter.createRun({
                id: 'run-0937-reason',
                workflow_name: 'task-pipeline',
                mode: 'state-machine',
                status: 'running' as const,
                started_at: '2026-09-25T00:00:00.000Z',
                completed_at: null,
                metadata_json: '{}',
            });
            await adapter.finalizeRun(
                'run-0937-reason',
                'failed',
                '2026-09-25T00:01:00.000Z',
                undefined,
                'failed-guard',
            );
            const row = await projectDb.adapter.queryFirst<{ terminal_reason: string | null }>(
                'SELECT terminal_reason FROM runs WHERE id = ?',
                'run-0937-reason',
            );
            expect(row?.terminal_reason).toBe('failed-guard');
        } finally {
            projectDb.close();
            rmSync(base, { recursive: true, force: true });
        }
    });
});
