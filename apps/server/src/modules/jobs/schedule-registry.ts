/**
 * Single registered schedule entry recorded at server startup.
 */
export interface SchedulerScheduleRegistration {
    name: string;
    schedule: string;
    source: 'builtin' | 'config';
    registeredAt: number;
}

let registeredSchedules: SchedulerScheduleRegistration[] = [];

/**
 * Publish the active scheduler registrations.
 */
export function setRegisteredSchedules(entries: SchedulerScheduleRegistration[]): void {
    registeredSchedules = [...entries];
}

/**
 * Retrieve the active scheduler registrations.
 */
export function getRegisteredSchedules(): SchedulerScheduleRegistration[] {
    return [...registeredSchedules];
}

/**
 * Reset scheduler registrations for testing.
 */
export function resetRegisteredSchedulesForTesting(): void {
    registeredSchedules = [];
}
