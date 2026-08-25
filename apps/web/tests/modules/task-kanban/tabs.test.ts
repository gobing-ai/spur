import { describe, expect, test } from 'bun:test';
import { TASKS_TABS, type TasksTab } from '../../../src/modules/task-kanban/tabs';

describe('TASKS_TABS append-only contract (F72 R11)', () => {
    test('declares exactly one kanban tab with a resolvable component', () => {
        expect(TASKS_TABS).toHaveLength(1);
        const kanban: TasksTab | undefined = TASKS_TABS[0] as TasksTab | undefined;
        expect(kanban?.id).toBe('kanban');
        expect(kanban?.label).toBe('Kanban');
        expect(typeof kanban?.component).toBe('function');
    });
});
