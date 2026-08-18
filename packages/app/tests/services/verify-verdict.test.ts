import { describe, expect, test } from 'bun:test';
import { aggregateVerifyVerdict, parseVerifyVerdict } from '../../src/services/verify-verdict';

// ─── R1: canonical parser ──────────────────────────────────────────────

describe('parseVerifyVerdict (R1 — one canonical parser)', () => {
    const rowsVerdict = {
        wbs: '0299',
        verdict: 'PASS',
        requirements: [{ id: 'R1', status: 'MET', evidence: 'a' }],
        acceptanceCriteria: [],
    };

    test('missing (empty content) → kind missing', () => {
        expect(parseVerifyVerdict('', '0299').kind).toBe('missing');
        expect(parseVerifyVerdict('   \n ', '0299').kind).toBe('missing');
    });

    test('malformed JSON → kind malformed', () => {
        const o = parseVerifyVerdict('{ not json', '0299');
        expect(o.kind).toBe('malformed');
    });

    test('non-object root → kind invalid', () => {
        expect(parseVerifyVerdict('[]', '0299').kind).toBe('invalid');
        expect(parseVerifyVerdict('"hello"', '0299').kind).toBe('invalid');
    });

    test('structurally invalid → kind invalid with reason', () => {
        const o = parseVerifyVerdict(JSON.stringify({ verdict: 'PASS', requirements: 'not-an-array' }), '0299');
        expect(o.kind).toBe('invalid');
        if (o.kind === 'invalid') expect(o.reason.length).toBeGreaterThan(0);
    });

    test('invalid verdict value → kind invalid', () => {
        const o = parseVerifyVerdict(JSON.stringify({ verdict: 'MAYBE', requirements: [] }), '0299');
        expect(o.kind).toBe('invalid');
    });

    test('valid artifact → kind valid with normalized verdict/rows', () => {
        const o = parseVerifyVerdict(JSON.stringify(rowsVerdict), '0299');
        expect(o.kind).toBe('valid');
        if (o.kind === 'valid') {
            expect(o.verdict.verdict).toBe('PASS');
            expect(o.verdict.wbs).toBe('0299');
            expect(o.verdict.requirements).toHaveLength(1);
            expect(o.verdict.requirements[0]).toMatchObject({
                id: 'R1',
                status: 'MET',
                evidenceType: '',
                evidence: 'a',
            });
        }
    });

    test('verdict case is normalized (valid non-PASS)', () => {
        const o = parseVerifyVerdict(
            JSON.stringify({ verdict: 'partial', requirements: [{ id: 'R1', status: 'partial' }] }),
            '0299',
        );
        expect(o.kind).toBe('valid');
        if (o.kind === 'valid') {
            expect(o.verdict.verdict).toBe('PARTIAL');
            expect(o.verdict.requirements[0]?.status).toBe('PARTIAL');
        }
    });

    test('`scenario` compatibility alias normalizes to id in one place', () => {
        const o = parseVerifyVerdict(
            JSON.stringify({
                verdict: 'PASS',
                acceptanceCriteria: [{ scenario: 'Scenario: alpha', status: 'MET', evidenceType: 'test' }],
            }),
            '0299',
        );
        expect(o.kind).toBe('valid');
        if (o.kind === 'valid') {
            expect(o.verdict.acceptanceCriteria[0]?.id).toBe('Scenario: alpha');
        }
    });

    test('id/scenario conflict is structurally invalid', () => {
        const o = parseVerifyVerdict(
            JSON.stringify({ verdict: 'PASS', requirements: [{ id: 'R1', scenario: 'R2', status: 'MET' }] }),
            '0299',
        );
        expect(o.kind).toBe('invalid');
        if (o.kind === 'invalid') expect(o.reason).toContain('id/scenario conflict');
    });

    test('checks carry optional severity', () => {
        const o = parseVerifyVerdict(
            JSON.stringify(
                {
                    verdict: 'PARTIAL',
                    requirements: [{ id: 'R1', status: 'MET' }],
                    checks: [{ name: 'SECU review', status: 'fail', severity: 'blocker', evidence: 'leak' }],
                },
                null,
                2,
            ),
            '0299',
        );
        expect(o.kind).toBe('valid');
        if (o.kind === 'valid') {
            expect(o.verdict.checks[0]?.severity).toBe('blocker');
        }
    });
});

// ─── R2: one aggregation policy ────────────────────────────────────────

describe('aggregateVerifyVerdict (R2 — one shared policy)', () => {
    const req = (...statuses: string[]) => statuses.map((s, i) => ({ id: `R${i + 1}`, status: s }));
    const ac = (...statuses: string[]) => statuses.map((s, i) => ({ id: `AC-${i + 1}`, status: s }));

    test('no rows → UNKNOWN', () => {
        expect(aggregateVerifyVerdict({ requirements: [], acceptanceCriteria: [] })).toBe('UNKNOWN');
    });

    test('all MET (task check passes) → PASS', () => {
        expect(aggregateVerifyVerdict({ requirements: req('MET', 'MET'), taskCheckPassed: true })).toBe('PASS');
    });

    test('UNMET requirement → FAIL', () => {
        expect(aggregateVerifyVerdict({ requirements: req('MET', 'UNMET') })).toBe('FAIL');
    });

    test('UNMET AC → FAIL', () => {
        expect(aggregateVerifyVerdict({ acceptanceCriteria: ac('UNMET') })).toBe('FAIL');
    });

    test('PARTIAL row (no UNMET) → PARTIAL', () => {
        expect(aggregateVerifyVerdict({ requirements: req('MET', 'PARTIAL') })).toBe('PARTIAL');
    });

    test('N/A rows are non-blocking', () => {
        expect(aggregateVerifyVerdict({ requirements: req('MET', 'N/A'), taskCheckPassed: true })).toBe('PASS');
    });

    // ── check severity policy ──
    test.each([
        ['blocker', 'fail', 'FAIL'],
        ['major', 'fail', 'PARTIAL'],
        ['minor', 'fail', 'PASS'],
        ['advisory', 'warn', 'PASS'],
    ] as const)('severity %s + status %s → %s', (severity, status, expected) => {
        expect(aggregateVerifyVerdict({ requirements: req('MET'), checks: [{ name: 'SECU', status, severity }] })).toBe(
            expected,
        );
    });

    // WHY: the corpus writes the check label under `name`, `check`, or `id`
    // depending on which pipeline generation produced the artifact. Requiring
    // `name` alone invalidated 38 shipped artifacts and, worse, hid `task-check`
    // rows from the aggregation policy so a failed task-check read as PASS.
    test.each(['name', 'check', 'id'] as const)('check label alias `%s` parses and aggregates', (key) => {
        const raw = JSON.stringify({
            verdict: 'PASS',
            requirements: [{ id: 'R1', status: 'MET' }],
            checks: [{ [key]: 'design-conformance', status: 'pass' }],
        });
        const parsed = parseVerifyVerdict(raw, '0001');
        expect(parsed.kind).toBe('valid');
        if (parsed.kind === 'valid') expect(parsed.verdict.checks[0]?.name).toBe('design-conformance');
    });

    test.each(['name', 'check', 'id'] as const)('a failing task-check under alias `%s` still denies PASS', (key) => {
        expect(
            aggregateVerifyVerdict({
                requirements: req('MET'),
                checks: [{ [key]: 'task-check', status: 'fail' }],
                taskCheckPassed: false,
            }),
        ).toBe('PARTIAL');
    });

    test('a check row with no label at all is structurally invalid', () => {
        const parsed = parseVerifyVerdict(
            JSON.stringify({
                verdict: 'PASS',
                requirements: [{ id: 'R1', status: 'MET' }],
                checks: [{ status: 'pass' }],
            }),
            '0001',
        );
        expect(parsed.kind).toBe('invalid');
    });

    test('legacy check without severity: fail → FAIL, warn → PARTIAL', () => {
        expect(aggregateVerifyVerdict({ requirements: req('MET'), checks: [{ name: 'SECU', status: 'fail' }] })).toBe(
            'FAIL',
        );
        expect(aggregateVerifyVerdict({ requirements: req('MET'), checks: [{ name: 'SECU', status: 'warn' }] })).toBe(
            'PARTIAL',
        );
    });

    test('pass checks do not block', () => {
        expect(
            aggregateVerifyVerdict({
                requirements: req('MET'),
                checks: [
                    { name: 'SECU', status: 'pass' },
                    { name: 'coverage', status: 'pass' },
                ],
            }),
        ).toBe('PASS');
    });

    test('blocker dominates a PARTIAL row', () => {
        expect(
            aggregateVerifyVerdict({
                requirements: req('PARTIAL'),
                checks: [{ name: 'SECU', status: 'fail', severity: 'blocker' }],
            }),
        ).toBe('FAIL');
    });

    test('blocker anywhere dominates an earlier major (ordering, 0592 review)', () => {
        // A major appearing before a blocker in the checks list must not cap the
        // aggregate at PARTIAL — the worst severity always wins.
        expect(
            aggregateVerifyVerdict({
                requirements: req('MET'),
                checks: [
                    { name: 'SECU', status: 'fail', severity: 'major' },
                    { name: 'SECU', status: 'fail', severity: 'blocker' },
                ],
            }),
        ).toBe('FAIL');
    });

    test('independent task-check failure cannot produce PASS', () => {
        expect(aggregateVerifyVerdict({ requirements: req('MET'), taskCheckPassed: false })).toBe('PARTIAL');
    });

    test('task-check row (non-pass) is not double-counted as a finding', () => {
        // The 'spur task check' row is the independent task-check outcome, surfaced
        // via taskCheckPassed; it must not be treated as a blocker finding on top.
        expect(
            aggregateVerifyVerdict({
                requirements: req('MET'),
                checks: [{ name: 'spur task check', status: 'fail' }],
                taskCheckPassed: false,
            }),
        ).toBe('PARTIAL');
    });

    // ── stored/computed disagreement (the softening R10 guard) ──
    test('stored PASS with an UNMET row recomputes FAIL (softening denied)', () => {
        expect(aggregateVerifyVerdict({ requirements: req('MET', 'UNMET') })).toBe('FAIL');
    });
});
