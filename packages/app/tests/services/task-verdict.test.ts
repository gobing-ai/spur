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
});
