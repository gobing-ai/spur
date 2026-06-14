import { describe, expect, test } from 'bun:test';

import type { ChecklistItem } from '../../src/bdd/checklist';
import { parseChecklist } from '../../src/bdd/checklist';

/** Get checklist item at index, failing the test if missing. */
function getItem(items: ChecklistItem[], index: number): ChecklistItem {
    const item = items[index];
    expect(item).toBeDefined();
    return item as ChecklistItem;
}

describe('parseChecklist', () => {
    test('parses unchecked items', () => {
        const items = parseChecklist(`- [ ] first item
- [ ] second item`);
        expect(items).toHaveLength(2);
        expect(getItem(items, 0).text).toBe('first item');
        expect(getItem(items, 0).checked).toBe(false);
        expect(getItem(items, 0).line).toBe(1);
    });

    test('parses checked items', () => {
        const items = parseChecklist(`- [x] done item
- [X] also done`);
        expect(items).toHaveLength(2);
        expect(getItem(items, 0).checked).toBe(true);
        expect(getItem(items, 1).checked).toBe(true);
    });

    test('parses mixed checked and unchecked', () => {
        const items = parseChecklist(`- [ ] todo
- [x] done
- [ ] another todo`);
        expect(items).toHaveLength(3);
        expect(getItem(items, 0).checked).toBe(false);
        expect(getItem(items, 1).checked).toBe(true);
        expect(getItem(items, 2).checked).toBe(false);
    });

    test('supports asterisk bullets', () => {
        const items = parseChecklist(`* [ ] star item
* [x] star done`);
        expect(items).toHaveLength(2);
        expect(getItem(items, 0).text).toBe('star item');
    });

    test('extracts R-id requirement prefixes', () => {
        const items = parseChecklist(`- [ ] R1: user can log in
- [ ] R2 - password reset works
- [ ] R3\u2014data export`);
        expect(getItem(items, 0).requirementId).toBe('R1');
        expect(getItem(items, 0).text).toBe('user can log in');
        expect(getItem(items, 1).requirementId).toBe('R2');
        expect(getItem(items, 1).text).toBe('password reset works');
        expect(getItem(items, 2).requirementId).toBe('R3');
        expect(getItem(items, 2).text).toBe('data export');
    });

    test('items without R-id have no requirementId', () => {
        const items = parseChecklist(`- [ ] plain item without R-id`);
        expect(getItem(items, 0).requirementId).toBeUndefined();
    });

    test('line numbers are correct in multi-line content', () => {
        const items = parseChecklist(`Some intro text
More prose

- [ ] item on line 4
- [x] item on line 5`);
        expect(getItem(items, 0).line).toBe(4);
        expect(getItem(items, 1).line).toBe(5);
    });

    test('returns empty for non-checklist content', () => {
        expect(parseChecklist('Just plain text\nNo checkboxes')).toEqual([]);
    });

    test('handles indented checklist items', () => {
        const items = parseChecklist(`  - [ ] indented item
    - [x] deeper indent`);
        expect(items).toHaveLength(2);
        expect(getItem(items, 0).text).toBe('indented item');
        expect(getItem(items, 1).text).toBe('deeper indent');
    });

    test('ignores non-checklist bullet items', () => {
        const items = parseChecklist(`- regular bullet
- [ ] checkbox item
- another regular`);
        expect(items).toHaveLength(1);
        expect(getItem(items, 0).text).toBe('checkbox item');
    });
});
