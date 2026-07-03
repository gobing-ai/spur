import { describe, expect, test } from 'bun:test';
import { deriveVerdict } from '../../src/services/task-verdict';

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
