import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REVIEWER = readFileSync(join(import.meta.dir, '../agents/super-reviewer.md'), 'utf8');

// Task 1122 R4/AC4: the reviewer Output Format states the pipeline cost of an open finding at the
// same moment the Disposition cell is chosen — open P1-P3 findings block done, a fix invalidates
// the certified digest and re-runs gate → review, and only P4 rows plus DEFER-ed P3
// rows are wrap residuals.
describe('super-reviewer Output Format contract (task 1122 R4)', () => {
    test('the disposition guidance states the re-certification cost of an open finding', () => {
        expect(REVIEWER).toContain('1122');
        expect(REVIEWER).toContain('open P1-P3');
        expect(REVIEWER).toContain('gate → review');
        expect(REVIEWER).toContain('wrap');
    });
});

// The citation contract (2026-10-12): a review finding that asserts an external API/library claim
// carries its citation in the same cell — the verify answer's `evidence-citation` rule, which blocks
// derivation there, owned by verdict-schema.md and enforced here in SECUA review (the same split the
// docs-corpus rule documents). Pinned so the review path cannot silently lose the claim contract.
describe('super-reviewer citation contract', () => {
    test('the Output Format requires a same-cell citation for external claims', () => {
        expect(REVIEWER).toContain('Source citations for external claims');
        expect(REVIEWER).toContain('SAME cell');
        expect(REVIEWER).toContain('does not stand in for it');
        expect(REVIEWER).toContain('name it\nas an explicit gap');
    });
});
