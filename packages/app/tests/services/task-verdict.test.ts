import { describe, expect, test } from 'bun:test';
import { aggregateBatchVerdicts, classifyTaskOutcome, deriveVerdict } from '../../src/services/task-verdict';

const MET_ANSWER = [
    '| Req | Status | Evidence |',
    '|-----|--------|----------|',
    '| R1 | MET | `src/foo.ts:10` — implementation |',
    '| R2 | MET | `src/bar.ts:20` — implementation |',
    '',
    '| Check | Status | Evidence |',
    '|-------|--------|----------|',
    '| lint | pass | biome clean |',
].join('\n');

const PARTIAL_ANSWER = [
    '| Req | Status | Evidence |',
    '|-----|--------|----------|',
    '| R1 | MET | `src/foo.ts:10` |',
    '| R2 | PARTIAL | only half done |',
].join('\n');

const FAIL_ANSWER = [
    '| Req | Status | Evidence |',
    '|-----|--------|----------|',
    '| R1 | MET | `src/foo.ts:10` |',
    '| R2 | UNMET | nothing found |',
].join('\n');

const NO_TABLE_ANSWER = 'Just some prose, no requirements table here.\nVerdict: PASS maybe?';

const AC_STATIC_ONLY_ANSWER = [
    '| Req | Status | Evidence |',
    '|-----|--------|----------|',
    '| R1 | MET | `src/foo.ts:10` |',
    '',
    '| AC | Status | Evidence Type | Evidence |',
    '|----|--------|---------------|----------|',
    '| Scenario: CLI emits JSON | MET | static-ref | `apps/cli/src/commands/foo.ts:42` |',
].join('\n');

const AC_TEST_EVIDENCE_ANSWER = [
    '| Req | Status | Evidence |',
    '|-----|--------|----------|',
    '| R1 | MET | `src/foo.ts:10` |',
    '',
    '| AC | Status | Evidence Type | Evidence |',
    '|----|--------|---------------|----------|',
    '| Scenario: CLI emits JSON | MET | test | `apps/cli/tests/foo.test.ts:42` |',
].join('\n');

const AC_NON_BEHAVIOR_STATIC_ANSWER = [
    '| Req | Status | Evidence |',
    '|-----|--------|----------|',
    '| R1 | MET | `docs/foo.md:10` |',
    '',
    '| AC | Status | Evidence Type | Evidence |',
    '|----|--------|---------------|----------|',
    '| [non-behavior] Documentation mentions the command | MET | static-ref | `docs/foo.md:10` |',
].join('\n');

const REQUIREMENT_THEN_AC_ANSWER = [
    '| Req | Status | Evidence |',
    '|-----|--------|----------|',
    '| R1 | MET | `src/foo.ts:10` |',
    '',
    '| AC | Status | Evidence Type | Evidence |',
    '|----|--------|---------------|----------|',
    '| Scenario: CLI emits JSON | MET | test | `apps/cli/tests/foo.test.ts:42` |',
].join('\n');

describe('deriveVerdict', () => {
    test('PASS: all MET + task check passes', () => {
        const result = deriveVerdict(MET_ANSWER, true);
        expect(result.verdict).toBe('PASS');
        expect(result.requirements.length).toBe(2);
        expect(result.requirements[0]?.status).toBe('MET');
        expect(result.requirements[1]?.status).toBe('MET');
    });

    test('PARTIAL: mixed MET + PARTIAL, no UNMET', () => {
        const result = deriveVerdict(PARTIAL_ANSWER, true);
        expect(result.verdict).toBe('PARTIAL');
        expect(result.requirements.length).toBe(2);
    });

    test('FAIL: any UNMET requirement', () => {
        const result = deriveVerdict(FAIL_ANSWER, true);
        expect(result.verdict).toBe('FAIL');
    });

    test('UNKNOWN: no parseable requirements table', () => {
        const result = deriveVerdict(NO_TABLE_ANSWER, true);
        expect(result.verdict).toBe('UNKNOWN');
        expect(result.requirements.length).toBe(0);
    });

    test('PARTIAL: all MET but task check fails', () => {
        const result = deriveVerdict(MET_ANSWER, false);
        expect(result.verdict).toBe('PARTIAL');
    });

    test('checks always include task-check entry', () => {
        const result = deriveVerdict(MET_ANSWER, true);
        const taskCheck = result.checks.find((c) => c.name === 'spur task check');
        expect(taskCheck).toBeDefined();
        expect(taskCheck?.status).toBe('pass');
    });

    test('FAIL with task check failed still FAIL (FAIL takes priority)', () => {
        const result = deriveVerdict(FAIL_ANSWER, false);
        expect(result.verdict).toBe('FAIL');
    });

    test('PARTIAL: behavior-bearing AC marked MET with static-only evidence is downgraded', () => {
        const result = deriveVerdict(AC_STATIC_ONLY_ANSWER, true);
        expect(result.verdict).toBe('PARTIAL');
        expect(result.acceptanceCriteria?.[0]?.status).toBe('PARTIAL');
        const evidenceCheck = result.checks.find((c) => c.name === 'evidence-rule-failed');
        expect(evidenceCheck?.status).toBe('fail');
        expect(evidenceCheck?.evidence).toContain('Scenario: CLI emits JSON');
    });

    test('PASS: behavior-bearing AC with test evidence satisfies executable-evidence rule', () => {
        const result = deriveVerdict(AC_TEST_EVIDENCE_ANSWER, true);
        expect(result.verdict).toBe('PASS');
        expect(result.acceptanceCriteria?.[0]?.status).toBe('MET');
        expect(result.requirements).toHaveLength(1);
        const evidenceCheck = result.checks.find((c) => c.name === 'evidence-rule-pass');
        expect(evidenceCheck?.status).toBe('pass');
    });

    test('PASS: non-behavior AC may use static evidence', () => {
        const result = deriveVerdict(AC_NON_BEHAVIOR_STATIC_ANSWER, true);
        expect(result.verdict).toBe('PASS');
        expect(result.acceptanceCriteria?.[0]?.status).toBe('MET');
        const evidenceCheck = result.checks.find((c) => c.name === 'evidence-rule-pass');
        expect(evidenceCheck?.status).toBe('pass');
    });

    test('requirement parser stops before a following AC table', () => {
        const result = deriveVerdict(REQUIREMENT_THEN_AC_ANSWER, true);
        expect(result.verdict).toBe('PASS');
        expect(result.requirements).toEqual([{ id: 'R1', status: 'MET', evidence: '`src/foo.ts:10`' }]);
        expect(result.acceptanceCriteria).toHaveLength(1);
    });
});

describe('classifyTaskOutcome', () => {
    test('backlog/todo tasks are NOT-STARTED regardless of verdict', () => {
        expect(classifyTaskOutcome('backlog', 'FAIL')).toBe('NOT-STARTED');
        expect(classifyTaskOutcome('todo', 'FAIL')).toBe('NOT-STARTED');
        expect(classifyTaskOutcome('todo', undefined)).toBe('NOT-STARTED');
        expect(classifyTaskOutcome('backlog', 'PASS')).toBe('NOT-STARTED');
    });

    test('blocked is NOT-STARTED — distinct from FAIL (task has no verifiable work)', () => {
        expect(classifyTaskOutcome('blocked', 'FAIL')).toBe('NOT-STARTED');
        expect(classifyTaskOutcome('blocked', undefined)).toBe('NOT-STARTED');
    });

    test('wip/testing/done tasks use their own verdict', () => {
        expect(classifyTaskOutcome('wip', 'PASS')).toBe('PASS');
        expect(classifyTaskOutcome('testing', 'PARTIAL')).toBe('PARTIAL');
        expect(classifyTaskOutcome('done', 'FAIL')).toBe('FAIL');
    });

    test('wip/testing/done with missing or unrecognized verdict → UNKNOWN', () => {
        expect(classifyTaskOutcome('wip', undefined)).toBe('UNKNOWN');
        expect(classifyTaskOutcome('done', 'GARBAGE')).toBe('UNKNOWN');
    });

    test('case-insensitive status and verdict input', () => {
        expect(classifyTaskOutcome('TODO', 'pass')).toBe('NOT-STARTED');
        expect(classifyTaskOutcome('Done', 'Pass')).toBe('PASS');
    });
});

describe('aggregateBatchVerdicts', () => {
    test('all PASS rolled up → PASS', () => {
        const result = aggregateBatchVerdicts([
            { wbs: '0301', outcome: 'PASS' },
            { wbs: '0302', outcome: 'PASS' },
        ]);
        expect(result.verdict).toBe('PASS');
        expect(result.rolledUp).toHaveLength(2);
        expect(result.notStarted).toHaveLength(0);
        expect(result.summary).toBe('2 PASS, 0 PARTIAL, 0 FAIL, 0 NOT-STARTED (excluded)');
    });

    test('any FAIL rolls up to FAIL — but NOT-STARTED is excluded and surfaced', () => {
        const result = aggregateBatchVerdicts([
            { wbs: '0301', outcome: 'PASS' },
            { wbs: '0302', outcome: 'PASS' },
            { wbs: '0303', outcome: 'PASS' },
            { wbs: '0304', outcome: 'FAIL' },
            { wbs: '0305', outcome: 'NOT-STARTED' },
            { wbs: '0306', outcome: 'NOT-STARTED' },
        ]);
        expect(result.verdict).toBe('FAIL');
        expect(result.rolledUp).toHaveLength(4);
        expect(result.notStarted).toHaveLength(2);
        expect(result.notStarted.map((r) => r.wbs)).toEqual(['0305', '0306']);
        expect(result.summary).toBe('3 PASS, 0 PARTIAL, 1 FAIL, 2 NOT-STARTED (excluded)');
    });

    test('the R2 dogfood scenario: 5 PASS + 2 NOT-STARTED → PASS (not FAIL)', () => {
        // Regression for the 2026-07-26 dogfood finding: --force reached two
        // todo tasks (0337, 0338), both scored FAIL, and the any-FAIL rollup
        // reported a misleading batch FAIL for an otherwise-clean feature.
        const result = aggregateBatchVerdicts([
            { wbs: '0332', outcome: 'PASS' },
            { wbs: '0333', outcome: 'PASS' },
            { wbs: '0334', outcome: 'PASS' },
            { wbs: '0335', outcome: 'PASS' },
            { wbs: '0336', outcome: 'PASS' },
            { wbs: '0337', outcome: 'NOT-STARTED' },
            { wbs: '0338', outcome: 'NOT-STARTED' },
        ]);
        expect(result.verdict).toBe('PASS');
        expect(result.rolledUp).toHaveLength(5);
        expect(result.notStarted.map((r) => r.wbs)).toEqual(['0337', '0338']);
        expect(result.summary).toBe('5 PASS, 0 PARTIAL, 0 FAIL, 2 NOT-STARTED (excluded)');
    });

    test('all NOT-STARTED → UNKNOWN ("nothing implemented yet", neither pass nor fail)', () => {
        const result = aggregateBatchVerdicts([
            { wbs: '0401', outcome: 'NOT-STARTED' },
            { wbs: '0402', outcome: 'NOT-STARTED' },
            { wbs: '0403', outcome: 'NOT-STARTED' },
            { wbs: '0404', outcome: 'NOT-STARTED' },
        ]);
        expect(result.verdict).toBe('UNKNOWN');
        expect(result.rolledUp).toHaveLength(0);
        expect(result.notStarted).toHaveLength(4);
        expect(result.summary).toBe('0 PASS, 0 PARTIAL, 0 FAIL, 4 NOT-STARTED (excluded)');
    });

    test('mixed PASS + PARTIAL (no FAIL) → PARTIAL', () => {
        const result = aggregateBatchVerdicts([
            { wbs: '0301', outcome: 'PASS' },
            { wbs: '0302', outcome: 'PARTIAL' },
        ]);
        expect(result.verdict).toBe('PARTIAL');
    });

    test('UNKNOWN per-task rows downgrade the batch to PARTIAL (cannot certify)', () => {
        const result = aggregateBatchVerdicts([
            { wbs: '0301', outcome: 'PASS' },
            { wbs: '0302', outcome: 'UNKNOWN' },
        ]);
        expect(result.verdict).toBe('PARTIAL');
    });

    test('FAIL takes priority over PARTIAL and UNKNOWN', () => {
        const result = aggregateBatchVerdicts([
            { wbs: '0301', outcome: 'PASS' },
            { wbs: '0302', outcome: 'PARTIAL' },
            { wbs: '0303', outcome: 'UNKNOWN' },
            { wbs: '0304', outcome: 'FAIL' },
        ]);
        expect(result.verdict).toBe('FAIL');
    });

    test('empty batch → UNKNOWN with zero counts', () => {
        const result = aggregateBatchVerdicts([]);
        expect(result.verdict).toBe('UNKNOWN');
        expect(result.rolledUp).toHaveLength(0);
        expect(result.notStarted).toHaveLength(0);
        expect(result.summary).toBe('0 PASS, 0 PARTIAL, 0 FAIL, 0 NOT-STARTED (excluded)');
    });
});
