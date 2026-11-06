/**
 * Same-path sibling for `require-corresponding-test`.
 * The task 1308 journeys live in `project-outcome-service.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import { summarizeProjectOutcome } from '../../src/services/project-outcome';

describe('project-outcome module', () => {
    test('rejects a non-ISO window before any database read', async () => {
        await expect(
            summarizeProjectOutcome({ db: {} as never }, { since: 'not-a-date', until: 'also-not' }),
        ).rejects.toThrow('project outcome window is not a valid ISO range');
    });
});
