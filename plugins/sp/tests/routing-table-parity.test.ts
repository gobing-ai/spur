/**
 * routing-table-parity — pins `next-router/references/routing-table.md` against
 * the adapter's TABLE A/B rows (review finding C2).
 *
 * Both surfaces are live. An inline `/sp:dev-next` run follows the markdown; a
 * subprocess run follows `stage-registry-adapter.ts`. The pre-existing gate in
 * `skill-structure.test.ts` only asserted the markdown *contains* the strings
 * "TABLE A"/"TABLE B"/"TABLE C", so row content could drift freely — and had:
 * adapter row A3 had lost the `--mode implement` the markdown documents as
 * load-bearing (bug-742), which additionally made A3 resolve to a null stage.
 *
 * This gate compares the row set and the dispatched command of every row, so the
 * two representations of one routing contract cannot diverge silently again.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TABLE_A, TABLE_B } from '../scripts/stage-registry-adapter';

const ROUTING_TABLE = join(import.meta.dir, '..', 'skills', 'next-router', 'references', 'routing-table.md');
const md = readFileSync(ROUTING_TABLE, 'utf8');

/** One parsed markdown routing row: its id and the command in its Dispatch cell. */
export interface MdRow {
    id: string;
    dispatch: string | null;
}

/**
 * Parse `| A3 | precondition | signal | dispatch | ... |` rows out of the routing
 * table. The Dispatch cell is column 4. `*(none)*` and prose-only STOP cells
 * yield a null dispatch — those rows intentionally route nowhere.
 */
export function parseMdRows(source: string): MdRow[] {
    const out: MdRow[] = [];
    for (const line of source.split('\n')) {
        const m = line.match(/^\|\s*([AB]\d)\s*\|/);
        if (!m?.[1]) continue;
        const cells = line.split('|').map((c) => c.trim());
        // cells[0] is the empty string before the leading pipe; the id is cells[1].
        const dispatchCell = cells[4] ?? '';
        const cmd = dispatchCell.match(/\/sp:dev-[a-z-]+/);
        out.push({ id: m[1], dispatch: cmd ? cmd[0] : null });
    }
    return out;
}

/** Normalize an adapter dispatch (string or builder) to a comparable command string. */
function adapterDispatch(dispatch: unknown): string | null {
    if (typeof dispatch === 'string') return dispatch;
    if (typeof dispatch === 'function') {
        try {
            const rendered = (dispatch as (i: unknown) => string)({ feature: { id: 'X' }, wbs: '0000' });
            return typeof rendered === 'string' ? rendered : null;
        } catch {
            return null;
        }
    }
    return null;
}

const mdRows = parseMdRows(md);
const adapterRows = [...TABLE_A, ...TABLE_B];

describe('sp plugin — routing-table.md ↔ adapter row parity (C2)', () => {
    test('the markdown parses into rows at all (loud failure on reformat)', () => {
        expect(mdRows.length, `no |A#|/|B#| rows parsed from ${ROUTING_TABLE}`).toBeGreaterThan(10);
    });

    test('row id sets match exactly', () => {
        const mdIds = [...new Set(mdRows.map((r) => r.id))].sort();
        const adapterIds = [...new Set(adapterRows.map((r) => r.rowId))].sort();
        expect(
            adapterIds,
            'routing-table.md and stage-registry-adapter.ts disagree on which routing rows exist. ' +
                'Both surfaces are live (inline runs read the markdown, subprocess runs read the adapter) — update them together.',
        ).toEqual(mdIds);
    });

    test('every row that dispatches a /sp:dev-* command dispatches the SAME one', () => {
        const mdById = new Map(mdRows.map((r) => [r.id, r]));
        for (const row of adapterRows) {
            const mdRow = mdById.get(row.rowId);
            if (!mdRow) continue; // covered by the id-set test above
            const adapterCmd = adapterDispatch(row.dispatch);
            if (adapterCmd === null || mdRow.dispatch === null) continue; // stop/recurse rows
            const adapterVerb = adapterCmd.match(/\/sp:dev-[a-z-]+/)?.[0] ?? null;
            expect(
                adapterVerb,
                `row ${row.rowId}: adapter dispatches "${adapterCmd}" but routing-table.md documents "${mdRow.dispatch}"`,
            ).toBe(mdRow.dispatch);
        }
    });

    test('rows the markdown marks --mode implement carry it in the adapter (bug-742)', () => {
        // The explicit mode stops the pipeline step recursively launching full mode
        // AND is what makes the dispatch resolve to the `implement` stage record.
        const mdModeRows = md
            .split('\n')
            .filter((l) => /^\|\s*[AB]\d\s*\|/.test(l) && l.includes('--mode implement'))
            .map((l) => (l.match(/^\|\s*([AB]\d)\s*\|/) as RegExpMatchArray)[1]);
        expect(
            mdModeRows.length,
            'expected routing-table.md to document at least one --mode implement row',
        ).toBeGreaterThan(0);

        for (const id of mdModeRows) {
            const row = adapterRows.find((r) => r.rowId === id);
            expect(row, `routing-table.md row ${id} has no adapter counterpart`).toBeDefined();
            const cmd = adapterDispatch(row?.dispatch);
            expect(
                cmd,
                `row ${id}: routing-table.md documents "--mode implement" but the adapter dispatch omits it (bug-742 regression)`,
            ).toContain('--mode implement');
        }
    });
});
