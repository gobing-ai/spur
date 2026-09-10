/**
 * Task 0818 R3 — the review coordinator's examples must satisfy the checkers that consume them.
 *
 * The producer (`plugins/sp/agents/super-reviewer.md`) used to emit word-only `blocker`/`major`/
 * `minor` severity cells while `hasPopulatedPriorityTable` requires a `P1`–`P4` cell, so a
 * faithfully-followed example produced a Review body the done gate rejected. These tests read the
 * shipped examples out of the source agent file and run them through the real checkers.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractReviewSectionBody, hasPopulatedPriorityTable } from '../../src/services/task-check';

const AGENT = readFileSync(
    join(import.meta.dir, '..', '..', '..', '..', 'plugins', 'sp', 'agents', 'super-reviewer.md'),
    'utf8',
);

/** The ```markdown fences in the Output Format section — i.e. what a coordinator copies. */
function markdownExamples(source: string): string[] {
    return [...source.matchAll(/```markdown\n([\s\S]*?)```/g)].map((m) => m[1] ?? '');
}

const EXAMPLES = markdownExamples(AGENT.slice(AGENT.indexOf('## Output Format')));

describe('0818 R3 — coordinator examples clear the existing Review checkers', () => {
    test('the Output Format section ships both a findings example and a no-findings example', () => {
        expect(EXAMPLES.length).toBeGreaterThanOrEqual(2);
    });

    test('every emitted example carries a populated P1–P4 table', () => {
        for (const example of EXAMPLES) {
            expect(hasPopulatedPriorityTable(example)).toBe(true);
        }
    });

    test('all four priorities appear with their severity words intact', () => {
        const findings = EXAMPLES.join('\n');
        for (const [priority, severity] of [
            ['P1', 'blocker'],
            ['P2', 'major'],
            ['P3', 'minor'],
            ['P4', 'advisory'],
        ] as const) {
            expect(findings).toContain(`${priority} (${severity})`);
        }
    });

    test('no example introduces a phantom task section when written into ### Review', () => {
        for (const example of EXAMPLES) {
            const task = `## 0001. Fixture\n\n### Review\n\n${example}\n`;
            const body = extractReviewSectionBody(task);
            expect(body).not.toBeNull();
            // A `##`/`###` heading inside the body would have ended the section early.
            expect(hasPopulatedPriorityTable(body ?? '')).toBe(true);
            for (const line of example.split('\n')) {
                expect(line).not.toMatch(/^#{1,3}\s/);
            }
        }
    });

    test('the substantive no-findings row is accepted; placeholder scaffolds are not', () => {
        const substantive = [
            '| # | Priority | Dimension | Finding | Location |',
            '|---|----------|-----------|---------|----------|',
            '| 1 | P4 (advisory) | — | No P1–P3 findings: 6 files reviewed | `src/a.ts:1-20` |',
        ].join('\n');
        expect(hasPopulatedPriorityTable(substantive)).toBe(true);

        const scaffold = ['| Priority | Finding | Location |', '| --- | --- | --- |', '| P1 | | |'].join('\n');
        expect(hasPopulatedPriorityTable(scaffold)).toBe(false);

        const dashed = ['| Priority | Finding | Location |', '| --- | --- | --- |', '| P1 | — | n/a |'].join('\n');
        expect(hasPopulatedPriorityTable(dashed)).toBe(false);
    });

    test('word-only severity rows still fail, so the checker was not loosened', () => {
        const wordOnly = [
            '| # | Severity | Dimension | Finding | Location |',
            '|---|----------|-----------|---------|----------|',
            '| 1 | blocker | security | SQL injection in query builder | `src/api/users.ts:42` |',
        ].join('\n');
        expect(hasPopulatedPriorityTable(wordOnly)).toBe(false);
        // …and the producer no longer ships one.
        expect(AGENT).not.toContain('| 1 | blocker | security |');
    });
});
