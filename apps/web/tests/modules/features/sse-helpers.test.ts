import { describe, expect, test } from 'bun:test';
import {
    extractJobId,
    type FeatureActionProgressState,
    INITIAL_PROGRESS_STATE,
    isFeaturesSseEvent,
    matchJobId,
    reduceFeatureActionProgress,
} from '../../../src/modules/features/sse-helpers';

describe('features SSE helpers', () => {
    describe('isFeaturesSseEvent', () => {
        test('admits feature.* and queue.job.* events', () => {
            expect(isFeaturesSseEvent('feature.created')).toBe(true);
            expect(isFeaturesSseEvent('feature.updated')).toBe(true);
            expect(isFeaturesSseEvent('feature.transitioned')).toBe(true);
            expect(isFeaturesSseEvent('queue.job.enqueued')).toBe(true);
            expect(isFeaturesSseEvent('queue.job.started')).toBe(true);
            expect(isFeaturesSseEvent('queue.job.completed')).toBe(true);
            expect(isFeaturesSseEvent('queue.job.failed')).toBe(true);
            expect(isFeaturesSseEvent('queue.job.retrying')).toBe(true);
        });

        test('rejects non-feature and non-queue events', () => {
            expect(isFeaturesSseEvent('task.created')).toBe(false);
            expect(isFeaturesSseEvent('agent.invoke.start')).toBe(false);
            expect(isFeaturesSseEvent('process.spawned')).toBe(false);
            expect(isFeaturesSseEvent(null)).toBe(false);
            expect(isFeaturesSseEvent(undefined)).toBe(false);
            expect(isFeaturesSseEvent('')).toBe(false);
        });
    });

    describe('extractJobId & matchJobId', () => {
        test('extracts jobId or runId from payload variants', () => {
            expect(extractJobId({ jobId: 'job-1' })).toBe('job-1');
            expect(extractJobId({ runId: 'run-2' })).toBe('run-2');
            expect(extractJobId({ job: { id: 'job-3' } })).toBe('job-3');
            expect(extractJobId({ job: { jobId: 'job-4' } })).toBe('job-4');
            expect(extractJobId(null)).toBeNull();
            expect(extractJobId({})).toBeNull();
        });

        test('matchJobId returns true only when extracted jobId matches tracked runId', () => {
            expect(matchJobId({ jobId: 'job-123' }, 'job-123')).toBe(true);
            expect(matchJobId({ jobId: 'job-123' }, 'job-999')).toBe(false);
            expect(matchJobId({ jobId: 'job-123' }, null)).toBe(false);
        });
    });

    describe('reduceFeatureActionProgress', () => {
        test('does not mutate state when status is idle', () => {
            const state: FeatureActionProgressState = INITIAL_PROGRESS_STATE;
            const next = reduceFeatureActionProgress(state, 'queue.job.completed', { jobId: 'job-1' });
            expect(next).toEqual(INITIAL_PROGRESS_STATE);
        });

        test('unmatched queue events do not mutate progress state (R7)', () => {
            const state: FeatureActionProgressState = {
                status: 'queued',
                runId: 'job-feat-A',
                action: 'brainstorm',
            };
            const next = reduceFeatureActionProgress(state, 'queue.job.completed', { jobId: 'job-feat-B' });
            expect(next).toEqual(state);
        });

        test('progress state machine transitions from queued to running to succeeded (R2)', () => {
            let state: FeatureActionProgressState = {
                status: 'queued',
                runId: 'job-100',
                action: 'plan',
            };

            // queue.job.started -> running
            state = reduceFeatureActionProgress(state, 'queue.job.started', { jobId: 'job-100' });
            expect(state.status).toBe('running');

            // queue.job.completed -> succeeded
            state = reduceFeatureActionProgress(state, 'queue.job.completed', { jobId: 'job-100' });
            expect(state.status).toBe('succeeded');
        });

        test('progress state machine handles created, running, and default fallback branches', () => {
            let state: FeatureActionProgressState = {
                status: 'idle',
                runId: 'job-100',
                action: 'plan',
            };

            // idle state returns same state
            expect(reduceFeatureActionProgress(state, 'queue.job.created', { jobId: 'job-100' })).toEqual(state);

            state.status = 'queued';

            // queue.job.created -> queued
            state = reduceFeatureActionProgress(state, 'queue.job.created', { jobId: 'job-100' });
            expect(state.status).toBe('queued');

            // queue.job.running -> running
            state = reduceFeatureActionProgress(state, 'queue.job.running', { jobId: 'job-100' });
            expect(state.status).toBe('running');

            // unhandled event name -> state unchanged
            const unchanged = reduceFeatureActionProgress(state, 'unknown.event', { jobId: 'job-100' });
            expect(unchanged).toEqual(state);

            // failed without error string falls back to 'Job failed'
            const failedDefault = reduceFeatureActionProgress(state, 'queue.job.failed', { jobId: 'job-100' });
            expect(failedDefault.status).toBe('failed');
            expect(failedDefault.error).toBe('Job failed');
        });

        test('transitions to failed state with error message on queue.job.failed', () => {
            const state: FeatureActionProgressState = {
                status: 'running',
                runId: 'job-200',
                action: 'brainstorm',
            };
            const next = reduceFeatureActionProgress(state, 'queue.job.failed', {
                jobId: 'job-200',
                error: 'Brainstorm agent process crashed',
            });
            expect(next.status).toBe('failed');
            expect(next.error).toBe('Brainstorm agent process crashed');
        });
    });
});
