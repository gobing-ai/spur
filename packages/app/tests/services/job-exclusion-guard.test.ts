import { describe, expect, test } from 'bun:test';
import { CHILD_KILL_GRACE_MS, resolveKillGraceMs } from '../../src/services/bounded-child-run';
import { resolveHistoryRefreshTimeoutMs } from '../../src/services/history-refresh-service';
import {
    acquireExclusiveJob,
    HISTORY_PRODUCER_EXCLUSIVE_KEY,
    historyProducerExclusiveKeyFor,
    isExclusiveJobActive,
    releaseExclusiveJob,
} from '../../src/services/job-exclusion-guard';
import {
    resolveSchedulerCustomTimeoutMs,
    resolveSchedulerJobTimeoutMs,
    schedulerJobTimeoutEnvName,
} from '../../src/services/scheduler-custom-job-service';

describe('exclusive history-producer guard (task 0806 R6)', () => {
    test('acquire then release owns the key; release by another owner is a no-op', () => {
        const key = `test-guard-${Date.now()}`;
        expect(isExclusiveJobActive(key)).toBe(false);
        acquireExclusiveJob(key, 'owner-a');
        expect(isExclusiveJobActive(key)).toBe(true);
        releaseExclusiveJob(key, 'owner-b'); // not the owner — still held
        expect(isExclusiveJobActive(key)).toBe(true);
        releaseExclusiveJob(key, 'owner-a');
        expect(isExclusiveJobActive(key)).toBe(false);
    });

    test('a second acquire while held fails its own run with the owner named', () => {
        const key = `test-guard-2-${Date.now()}`;
        acquireExclusiveJob(key, 'history.refresh job-1');
        try {
            expect(() => acquireExclusiveJob(key, 'scheduler job history-daily-report')).toThrow(
                /already running \(history\.refresh job-1\)/,
            );
        } finally {
            releaseExclusiveJob(key, 'history.refresh job-1');
        }
    });

    test('history producer commands stamp the shared key; unrelated commands do not', () => {
        expect(historyProducerExclusiveKeyFor('history daily && sp maintenance prune --yes')).toBe(
            HISTORY_PRODUCER_EXCLUSIVE_KEY,
        );
        expect(historyProducerExclusiveKeyFor('bun run sp.ts history import --source github')).toBe(
            HISTORY_PRODUCER_EXCLUSIVE_KEY,
        );
        expect(historyProducerExclusiveKeyFor('sp maintenance prune --yes && smoke')).toBeUndefined();
        expect(historyProducerExclusiveKeyFor('historydaily')).toBeUndefined(); // not a word boundary match
    });
});

describe('per-job budget resolution (task 0806 R3)', () => {
    test('env name derivation is upper-snake with non-alphanumerics collapsed', () => {
        expect(schedulerJobTimeoutEnvName('history-daily-report')).toBe(
            'SPUR_SCHEDULER_TIMEOUT_HISTORY_DAILY_REPORT_MS',
        );
    });

    test('per-job override wins; invalid values fall back to the global budget', () => {
        const env = { SPUR_SCHEDULER_TIMEOUT_ALPHA_MS: '1234', SPUR_SCHEDULER_TIMEOUT_BETA_MS: 'nope' };
        const fallback = resolveSchedulerCustomTimeoutMs({});
        expect(resolveSchedulerJobTimeoutMs('alpha', env, fallback)).toBe(1234);
        expect(resolveSchedulerJobTimeoutMs('beta', env, fallback)).toBe(fallback);
        expect(resolveSchedulerJobTimeoutMs('gamma', env, fallback)).toBe(fallback);
    });

    test('kill grace resolves from env with safe fallback', () => {
        expect(resolveKillGraceMs({})).toBe(CHILD_KILL_GRACE_MS);
        expect(resolveKillGraceMs({ SPUR_SCHEDULER_KILL_GRACE_MS: '250' })).toBe(250);
        expect(resolveKillGraceMs({ SPUR_SCHEDULER_KILL_GRACE_MS: '-1' })).toBe(CHILD_KILL_GRACE_MS);
        expect(resolveKillGraceMs({ SPUR_SCHEDULER_KILL_GRACE_MS: 'abc' })).toBe(CHILD_KILL_GRACE_MS);
    });

    test('history refresh watchdog is decoupled from the scheduler.custom default', () => {
        const env = { SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS: '600000', SPUR_HISTORY_REFRESH_TIMEOUT_MS: '90000' };
        expect(resolveHistoryRefreshTimeoutMs(env)).toBe(90000);
        expect(resolveHistoryRefreshTimeoutMs({ SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS: '600000' })).toBe(
            resolveSchedulerCustomTimeoutMs({}),
        );
        expect(resolveHistoryRefreshTimeoutMs({ SPUR_HISTORY_REFRESH_TIMEOUT_MS: 'x' })).toBe(
            resolveSchedulerCustomTimeoutMs({}),
        );
    });
});
