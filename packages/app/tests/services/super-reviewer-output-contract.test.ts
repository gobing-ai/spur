import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractReviewSectionBody, hasPopulatedPriorityTable } from '../../src/services/task-check';

/**
 * Task 0818 R3 — super-reviewer.md's Findings examples must satisfy the existing
 * priority and section contracts: canonical `P1 (blocker)`-style Severity cells
 * accepted by `hasPopulatedPriorityTable`, a substantive no-findings row accepted,
 * word-only severity rows rejected, and section-relative headings that do not
 * spawn new task sections inside `### Review`.
 */

const ROOT = join(import.meta.dir, '..', '..', '..', '..');
const AGENT_DOC = readFileSync(join(ROOT, 'plugins', 'sp', 'agents', 'super-reviewer.md'), 'utf8');

// Example rows lifted from the agent doc's Findings table (including the no-findings row).
const FINDINGS_TABLE = [
    '| 1 | P1 (blocker) | security | SQL injection in query builder | `src/api/users.ts:42` |',
    '| 2 | P2 (major) | architecture | Shallow pass-through UserService | `src/services/users.ts:15` |',
    '| 3 | P3 (minor) | correctness | Missing error branch in createUser | `src/api/users.ts:48` |',
    '| 1 | P4 (advisory) | scope | No findings — auth flow reviewed clean | `src/auth/` (full diff) |',
].join('\n');

describe('0818 R3 — super-reviewer output contract vs the existing checkers', () => {
    test('agent doc carries the canonical P-mapping and no word-only severity example rows', () => {
        expect(AGENT_DOC).toContain('`P1 (blocker)` >');
        expect(AGENT_DOC).toContain('section-relative headings');
        // The old word-only example rows must be gone.
        expect(AGENT_DOC).not.toMatch(/\|\s*\d+\s*\|\s*(blocker|major|minor|advisory)\s*\|/);
        expect(AGENT_DOC).toContain(FINDINGS_TABLE);
    });

    test('every example finding row (and the no-findings row) passes hasPopulatedPriorityTable', () => {
        expect(hasPopulatedPriorityTable(FINDINGS_TABLE)).toBe(true);
        expect(
            hasPopulatedPriorityTable(
                '| 1 | P4 (advisory) | scope | No findings — auth flow reviewed clean | `src/auth/` (full diff) |',
            ),
        ).toBe(true);
    });

    test('word-only severity rows stay rejected — hasPopulatedPriorityTable remains strict', () => {
        expect(hasPopulatedPriorityTable('| 1 | blocker | security | SQL injection | `src/api/users.ts:42` |')).toBe(
            false,
        );
        expect(
            hasPopulatedPriorityTable('| 1 | major | architecture | shallow module | `src/services/users.ts:15` |'),
        ).toBe(false);
    });

    test('section-relative headings inside `### Review` do not become new task sections', () => {
        const body = [
            '## 0818. Fixture',
            '',
            '### Review',
            '',
            '#### Findings (ranked)',
            '',
            FINDINGS_TABLE,
            '',
            '#### Functional Traceability',
            '',
            '| Req | Status | Evidence |',
            '| --- | --- | --- |',
            '| R1 | MET | `src/api/users.ts:42` |',
            '',
            '### History',
            '',
            '- entry',
            '',
        ].join('\n');
        const review = extractReviewSectionBody(body);
        expect(review).not.toBeNull();
        expect(review).toContain('#### Findings (ranked)');
        expect(review).toContain('#### Functional Traceability');
        // The task still has exactly its original two `###` sections.
        const h3s = body.split('\n').filter((l) => l.startsWith('### '));
        expect(h3s).toEqual(['### Review', '### History']);
    });
});
