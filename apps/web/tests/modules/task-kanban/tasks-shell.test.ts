import { describe, expect, test } from 'bun:test';
import { parseCombinedInput } from '../../../src/modules/task-kanban/TasksShell';

describe('parseCombinedInput (F72 §4 combined-input parse rule)', () => {
    test('bare four-digit WBS navigates to the task', () => {
        expect(parseCombinedInput('1234')).toEqual({ kind: 'navigate', wbs: '1234' });
        expect(parseCombinedInput(' 0663 ')).toEqual({ kind: 'navigate', wbs: '0663' });
    });

    test('dotted WBS applies the parent filter', () => {
        expect(parseCombinedInput('0663.1')).toEqual({ kind: 'filter', key: 'parent', value: '0663.1' });
    });

    test('any other text applies the feature substring filter', () => {
        expect(parseCombinedInput('F72')).toEqual({ kind: 'filter', key: 'feature', value: 'F72' });
        expect(parseCombinedInput('shell parity')).toEqual({ kind: 'filter', key: 'feature', value: 'shell parity' });
    });
});
