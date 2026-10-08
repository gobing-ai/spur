import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REVIEWER = readFileSync(join(import.meta.dir, '../agents/super-reviewer.md'), 'utf8');

// Task 1122 R4/AC4: the reviewer Output Format states the pipeline cost of an open finding at the
// same moment the Disposition cell is chosen — open P1-P3 findings block done, a fix invalidates
// the certified digest and re-runs quality → review → verify, and only P4 rows plus DEFER-ed P3
// rows are wrap residuals. Same contract the review/review-fail-triage state descriptions state.
describe('super-reviewer Output Format contract (task 1122 R4)', () => {
    test('the disposition guidance states the re-certification cost of an open finding', () => {
        expect(REVIEWER).toContain('1122');
        expect(REVIEWER).toContain('open P1-P3');
        expect(REVIEWER).toContain('review-fail-triage');
        expect(REVIEWER).toContain('quality → review → verify');
        expect(REVIEWER).toContain('wrap');
    });
});
