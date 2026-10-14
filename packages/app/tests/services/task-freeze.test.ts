import { describe, expect, test } from 'bun:test';
import { isTaskFrozen, undeprecateTaskCommand } from '../../src/services/task-freeze';

describe('isTaskFrozen', () => {
    test('true for deprecated in any casing', () => {
        expect(isTaskFrozen('deprecated')).toBe(true);
        expect(isTaskFrozen('DEPRECATED')).toBe(true);
        expect(isTaskFrozen('Deprecated')).toBe(true);
    });

    test('false for missing or other statuses', () => {
        expect(isTaskFrozen(undefined)).toBe(false);
        expect(isTaskFrozen(null)).toBe(false);
        expect(isTaskFrozen('')).toBe(false);
        expect(isTaskFrozen('todo')).toBe(false);
        expect(isTaskFrozen('done')).toBe(false);
        expect(isTaskFrozen('wip')).toBe(false);
    });
});

describe('undeprecateTaskCommand', () => {
    test('names the FSM exit command for the WBS', () => {
        expect(undeprecateTaskCommand('1190')).toBe('spur task update 1190 todo');
    });
});
