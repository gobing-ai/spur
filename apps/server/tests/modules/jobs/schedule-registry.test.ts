import { beforeEach, describe, expect, test } from 'bun:test';
import {
    getRegisteredSchedules,
    resetRegisteredSchedulesForTesting,
    type SchedulerScheduleRegistration,
    setRegisteredSchedules,
} from '../../../src/modules/jobs/schedule-registry';

describe('schedule-registry', () => {
    beforeEach(() => {
        resetRegisteredSchedulesForTesting();
    });

    test('returns empty array by default', () => {
        expect(getRegisteredSchedules()).toEqual([]);
    });

    test('sets and gets registered schedules', () => {
        const entries: SchedulerScheduleRegistration[] = [
            {
                name: 'cleanup-stale-jobs',
                schedule: '60000',
                source: 'builtin',
                registeredAt: 1700000000000,
            },
            {
                name: 'nightly-backup',
                schedule: '0 0 * * *',
                source: 'config',
                registeredAt: 1700000001000,
            },
        ];

        setRegisteredSchedules(entries);
        const result = getRegisteredSchedules();

        expect(result).toHaveLength(2);
        expect(result).toEqual(entries);
    });

    test('returns a shallow copy of registrations to prevent direct mutation', () => {
        const entries: SchedulerScheduleRegistration[] = [
            {
                name: 'sync-metrics',
                schedule: '30000',
                source: 'builtin',
                registeredAt: 1700000000000,
            },
        ];

        setRegisteredSchedules(entries);
        const copy = getRegisteredSchedules();
        copy.push({
            name: 'injected',
            schedule: '1000',
            source: 'config',
            registeredAt: 1700000002000,
        });

        expect(getRegisteredSchedules()).toHaveLength(1);
    });

    test('resets registered schedules for testing', () => {
        setRegisteredSchedules([
            {
                name: 'temp',
                schedule: '1000',
                source: 'builtin',
                registeredAt: Date.now(),
            },
        ]);

        expect(getRegisteredSchedules()).toHaveLength(1);
        resetRegisteredSchedulesForTesting();
        expect(getRegisteredSchedules()).toHaveLength(0);
    });
});
