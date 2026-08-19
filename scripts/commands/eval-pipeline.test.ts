import { describe, expect, test } from 'bun:test';
import { diffRecords, diffSnapshot, type EvalRecord, extractTokenCost, parseVerdict } from './eval-pipeline';

describe('diffSnapshot', () => {
    test('reports created and modified files, ignores unchanged', () => {
        const before = { 'a.log': 1, 'b.log': 2, 'sub/c.log': 3 };
        const after = { 'a.log': 1, 'b.log': 9, 'new.log': 5, 'sub/c.log': 3 };
        expect(diffSnapshot(before, after)).toEqual(['b.log', 'new.log']);
    });
});

describe('parseVerdict', () => {
    test('reads top-level verdict', () => {
        expect(parseVerdict('{"verdict":"PASS"}')).toBe('PASS');
    });
    test('reads nested data.verdict', () => {
        expect(parseVerdict('{"data":{"verdict":"FAIL"}}')).toBe('FAIL');
    });
    test('returns null on malformed or missing verdict — never a guess', () => {
        expect(parseVerdict('not json')).toBeNull();
        expect(parseVerdict('{"ok":true}')).toBeNull();
        expect(parseVerdict('{"verdict":""}')).toBeNull();
    });
});

describe('extractTokenCost', () => {
    test('returns null when no agent.run rows carry token data (never zero)', () => {
        // No agent.run rows exist at unix epoch — guaranteed empty window.
        expect(extractTokenCost('.spur/spur.db', '1970-01-01T00:00:00Z', '1970-01-01T00:00:01Z')).toBeNull();
    });
});

describe('record shape + diffRecords', () => {
    const base: EvalRecord = {
        wbs: '9500',
        pipeline: 'task-pipeline.yaml',
        verdict: 'PASS',
        gateOutcomes: ['precheck-size=PASS', 'test-gate=PASS'],
        artifactsWritten: ['9500-verdict.json'],
        tokenCost: null,
        wallClockMs: 1000,
        exitCode: 0,
    };
    test('record carries the frozen fields', () => {
        expect(Object.keys(base).sort()).toEqual(
            [
                'wbs',
                'pipeline',
                'verdict',
                'gateOutcomes',
                'artifactsWritten',
                'tokenCost',
                'wallClockMs',
                'exitCode',
            ].sort(),
        );
    });
    test('diff flags verdict, exit, token, wall, gate changes; not equal-cost pairs', () => {
        const same = { ...base, wallClockMs: base.wallClockMs };
        expect(diffRecords([base], [same])).toEqual([]);
        const changed: EvalRecord = { ...base, verdict: 'FAIL', exitCode: 1, tokenCost: 42, wallClockMs: 2000 };
        const diff = diffRecords([base], [changed]);
        expect(diff.some((d) => d.includes('verdict: PASS -> FAIL'))).toBeTrue();
        expect(diff.some((d) => d.includes('exitCode: 0 -> 1'))).toBeTrue();
        expect(diff.some((d) => d.includes('tokenCost: null -> 42'))).toBeTrue();
        expect(diff.some((d) => d.includes('wallClockMs'))).toBeTrue();
    });
    test('diff flags gate outcome drift', () => {
        const changed: EvalRecord = { ...base, gateOutcomes: ['precheck-size=FAIL'] };
        expect(diffRecords([base], [changed])[0]).toContain('gateOutcomes');
    });
});
