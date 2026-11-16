/**
 * The kit's frozen facade description (A81 1349 R1/R2).
 *
 * The Board runtime facade cannot `require` a TSX barrel, so it re-exports `MODULE_KIT_EXPORTS`.
 * Drift between that list and the barrel would ship a facade that silently drops a component.
 */
import { describe, expect, test } from 'bun:test';
import * as barrel from '../../../src/components/module-kit';
import { BOARD_UI_KIT_VERSION, MODULE_KIT_EXPORTS } from '../../../src/components/module-kit/exports';

describe('module-kit exports', () => {
    test('MODULE_KIT_EXPORTS equals the barrel runtime exports', () => {
        expect(Object.keys(barrel).sort()).toEqual([...MODULE_KIT_EXPORTS].sort());
    });

    test('the kit contract version is a semver the manifest can advertise', () => {
        expect(BOARD_UI_KIT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
});
