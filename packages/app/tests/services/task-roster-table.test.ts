import { describe, expect, test } from 'bun:test';
import { ROSTER_END, ROSTER_REGION_RE, ROSTER_START, renderRosterTable } from '../../src/services/task-roster-table';

describe('task roster table', () => {
    test('renders a header and one escaped row per child', () => {
        expect(renderRosterTable([{ wbs: '0002', name: 'a | b', status: 'wip' }])).toBe(
            '| WBS | Sub-task | Status |\n| --- | -------- | ------ |\n| 0002 | a \\| b | wip |',
        );
    });

    test('the region regex matches the region the markers delimit', () => {
        const region = `${ROSTER_START}\n| x |\n${ROSTER_END}`;
        expect(`before\n${region}\nafter`.match(ROSTER_REGION_RE)).toEqual([region]);
    });
});
