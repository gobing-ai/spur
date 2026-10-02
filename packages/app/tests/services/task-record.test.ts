/**
 * Tests for the task record service — verdict reader, pure generators,
 * and the TaskService.record orchestration method.
 *
 * Design: docs/tasks/0108 — this replaces ZERO-coverage YAML shell with
 * unit-tested code. Per-file ≥90% coverage.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { applyCliMigrations, MarkdownDocument, TaskRunLinkDao } from '@gobing-ai/spur-domain';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { GuardDeniedError } from '../../src/errors';
import type { SectionMatrix } from '../../src/services/planning-check-base';
import { type EntityRef, type LifecyclePort, PlanningWriteService } from '../../src/services/planning-write-service';
import type { TaskCheckService } from '../../src/services/task-check';
import {
    escapeTablePipe,
    flipVerifiedCheckboxes,
    gitDiffU0,
    parseTesting,
    parseVerdict,
    renderReview,
    renderSolutionFromDiff,
    renderTesting,
} from '../../src/services/task-record';
import { sectionIsBare, TaskService } from '../../src/services/task-service';
import type { TransitionCheckGate } from '../../src/services/task-transition';
import { aggregateVerifyVerdict, type VerifyVerdict } from '../../src/services/verify-verdict';

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Minimal matrix shared by the record describes — the `testing`/`done` required
 * sets drive both the record section writes and the 0980 check-gate probes.
 */
const RECORD_SECTION_MATRIX: SectionMatrix = {
    variants: {
        standard: {
            backlog: {
                required: ['Background'],
                optional: ['Requirements', 'Acceptance Criteria', 'Design', 'Plan', 'Solution', 'Testing', 'Review'],
            },
            todo: { required: ['Background', 'Acceptance Criteria', 'Design', 'Plan'] },
            wip: { required: ['Background', 'Acceptance Criteria', 'Design', 'Plan'] },
            testing: { required: ['Solution', 'Testing'] },
            done: { required: ['Solution', 'Testing', 'Review'], gate: true },
        },
    },
};

function makeVerdict(overrides?: Partial<VerifyVerdict>): VerifyVerdict {
    return {
        wbs: '0100',
        verdict: 'PASS',
        requirements: [
            { id: 'R1', status: 'MET', evidenceType: '', evidence: 'test passes' },
            { id: 'R2', status: 'MET', evidenceType: '', evidence: 'lint clean' },
        ],
        acceptanceCriteria: [],
        checks: [
            { name: 'Security', status: 'P1', evidence: 'no auth bypass' },
            { name: 'Style', status: 'P3', evidence: 'minor formatting issue' },
        ],
        ...overrides,
    };
}

async function createTask(svc: TaskService): Promise<string> {
    // Fixture creates several same-titled tasks on one shared dir; the dedup guard
    // (task 0510) is an operator-facing create guard — fixtures opt out explicitly.
    const result = await svc.create({ title: 'Record test task', dedupeWithinSec: null });
    // Transition to wip so Solution can be written
    await svc.updateStatus(result.ref.id, 'wip');
    return result.ref.id;
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('escapeTablePipe', () => {
    test('escapes pipe characters with backslash', () => {
        expect(escapeTablePipe('a|b')).toBe('a\\|b');
        expect(escapeTablePipe('no pipes here')).toBe('no pipes here');
        expect(escapeTablePipe('')).toBe('');
        expect(escapeTablePipe('a|b|c')).toBe('a\\|b\\|c');
    });

    test('adds an escape layer to already-escaped pipes', () => {
        // Rendering always adds one layer so parsing can remove exactly one.
        expect(escapeTablePipe('a\\|b')).toBe('a\\\\|b');
    });
});

describe('parseVerdict', () => {
    test('parses a valid PASS verdict', () => {
        const v = parseVerdict(JSON.stringify({ wbs: '0042', verdict: 'PASS', requirements: [], checks: [] }));
        expect(v.wbs).toBe('0042');
        expect(v.verdict).toBe('PASS');
    });

    test('parses a FAIL verdict', () => {
        const v = parseVerdict(JSON.stringify({ wbs: '0042', verdict: 'FAIL' }));
        expect(v.verdict).toBe('FAIL');
    });

    test('parses a PARTIAL verdict', () => {
        const v = parseVerdict(JSON.stringify({ wbs: '0042', verdict: 'PARTIAL' }));
        expect(v.verdict).toBe('PARTIAL');
    });

    test('treats empty string as UNKNOWN', () => {
        const v = parseVerdict('');
        expect(v.verdict).toBe('UNKNOWN');
        expect(v.requirements).toEqual([]);
        expect(v.checks).toEqual([]);
    });

    test('treats whitespace-only string as UNKNOWN', () => {
        const v = parseVerdict('   \n  ');
        expect(v.verdict).toBe('UNKNOWN');
    });

    test('treats malformed JSON as UNKNOWN', () => {
        const v = parseVerdict('{not json');
        expect(v.verdict).toBe('UNKNOWN');
        expect(v.requirements).toEqual([]);
    });

    test('treats non-object JSON as UNKNOWN', () => {
        const v = parseVerdict('"just a string"');
        expect(v.verdict).toBe('UNKNOWN');
    });

    test('treats null JSON as UNKNOWN', () => {
        const v = parseVerdict('null');
        expect(v.verdict).toBe('UNKNOWN');
    });

    test('treats unknown verdict string as UNKNOWN', () => {
        const v = parseVerdict(JSON.stringify({ verdict: 'BANANA' }));
        expect(v.verdict).toBe('UNKNOWN');
    });

    test('normalizes case-insensitive verdict', () => {
        const v = parseVerdict(JSON.stringify({ verdict: 'pass' }));
        expect(v.verdict).toBe('PASS');
    });

    test('uses fallbackWbs when wbs is missing', () => {
        const v = parseVerdict(JSON.stringify({ verdict: 'PASS' }), '0099');
        expect(v.wbs).toBe('0099');
    });

    test('parses requirements array', () => {
        const v = parseVerdict(
            JSON.stringify({
                verdict: 'FAIL',
                requirements: [
                    { id: 'R1', status: 'MET', evidence: 'done' },
                    { id: 'R2', status: 'UNMET', evidence: 'not done' },
                ],
            }),
        );
        expect(v.requirements).toHaveLength(2);
        expect(v.requirements[0]?.id).toBe('R1');
        expect(v.requirements[1]?.status).toBe('UNMET');
    });

    test('treats non-array requirements as empty', () => {
        const v = parseVerdict(JSON.stringify({ requirements: 'nope' }));
        expect(v.requirements).toEqual([]);
    });

    test('treats null requirements as empty', () => {
        const v = parseVerdict(JSON.stringify({ requirements: null }));
        expect(v.requirements).toEqual([]);
    });

    test('parses checks array', () => {
        const v = parseVerdict(
            JSON.stringify({
                verdict: 'UNKNOWN',
                checks: [{ name: 'Security', status: 'P1', evidence: 'xss' }],
            }),
        );
        expect(v.checks).toHaveLength(1);
        expect(v.checks[0]?.name).toBe('Security');
    });

    test('degrades an artifact with invalid coverage rows to UNKNOWN', () => {
        const v = parseVerdict(
            JSON.stringify({
                requirements: [{ id: 'R1', status: 'ok', evidence: 'y' }, 'bad', null, 42],
            }),
        );
        expect(v.verdict).toBe('UNKNOWN');
        expect(v.requirements).toEqual([]);
    });

    test('never admits an unknown row status into the canonical verdict type', () => {
        const v = parseVerdict(JSON.stringify({ verdict: 'PASS', requirements: [{ id: 'R1', status: 'BANANA' }] }));
        expect(v.verdict).toBe('UNKNOWN');
        expect(v.requirements).toEqual([]);
    });

    test('parses acceptanceCriteria array', () => {
        const v = parseVerdict(
            JSON.stringify({
                verdict: 'PASS',
                acceptanceCriteria: [
                    {
                        id: 'Scenario: CLI emits JSON',
                        status: 'MET',
                        evidenceType: 'command',
                        evidence: 'spur task show 0001 --json',
                    },
                ],
            }),
        );
        expect(v.acceptanceCriteria).toHaveLength(1);
        expect(v.acceptanceCriteria?.[0]?.evidenceType).toBe('command');
    });
});

describe('renderTesting', () => {
    test('renders per-requirement table with header', () => {
        const v = makeVerdict();
        const out = renderTesting(v);
        expect(out).toContain('**Pipeline verify results**');
        expect(out).toContain('- Verdict: PASS');
        expect(out).toContain('| Requirement | Status | Evidence |');
        expect(out).toContain('| R1 | MET | test passes |');
        expect(out).toContain('| R2 | MET | lint clean |');
        // P3 fix (task 0159): verdict-generated Testing must carry a coverage claim
        // so `spur task check` does not warn about a missing coverage phrase.
        expect(out).toContain('Coverage: N/A');
    });

    test('renders no-requirements row when empty', () => {
        const v = makeVerdict({ requirements: [] });
        const out = renderTesting(v);
        expect(out).toContain('No requirements recorded');
    });

    test('collapses newlines in evidence', () => {
        const v = makeVerdict({
            requirements: [{ id: 'R1', status: 'MET', evidenceType: '', evidence: 'line1\nline2\nline3' }],
        });
        const out = renderTesting(v);
        expect(out).toContain('line1 line2 line3');
        // Verify no raw newlines inside table cell
        const afterHeader = out.split('|-------------|--------|----------|')[1] ?? '';
        expect(afterHeader).not.toContain('\nline2');
    });

    test('escapes pipe characters in evidence', () => {
        const v = makeVerdict({
            requirements: [{ id: 'R1', status: 'MET', evidenceType: '', evidence: 'has | pipe | chars' }],
        });
        const out = renderTesting(v);
        expect(out).toContain('has \\| pipe \\| chars');
        // Unescaped pipe would break the table
        expect(out).not.toMatch(/\| has \| pipe \| chars \|/);
    });

    test('renders acceptance criteria evidence table when present', () => {
        const v = makeVerdict({
            acceptanceCriteria: [
                {
                    id: 'Scenario: CLI emits JSON',
                    status: 'MET',
                    evidenceType: 'command',
                    evidence: 'spur task show 0001 --json',
                },
            ],
        });
        const out = renderTesting(v);
        expect(out).toContain('| Acceptance Criteria | Status | Evidence Type | Evidence |');
        expect(out).toContain('| Scenario: CLI emits JSON | MET | command | spur task show 0001 --json |');
    });

    test('escapes pipe characters in acceptance criteria evidence', () => {
        const v = makeVerdict({
            acceptanceCriteria: [
                {
                    id: 'Scenario: pipe in output',
                    status: 'MET',
                    evidenceType: 'command',
                    evidence: 'echo "a|b"',
                },
            ],
        });
        const out = renderTesting(v);
        expect(out).toContain('echo "a\\|b"');
        // Unescaped pipe would break the table
        expect(out).not.toMatch(/\| echo "a\|b" \|/);
    });
});

describe('parseTesting', () => {
    // Round-trip equivalence (R5): parseTesting(renderTesting(v)) returns the same
    // verdict and rows for any canonical verdict, in canonical status space.
    test('round-trips a canonical PASS verdict with requirement and AC rows', () => {
        const v = makeVerdict({
            requirements: [
                { id: 'R1', status: 'MET', evidenceType: '', evidence: 'test passes' },
                { id: 'R2', status: 'UNMET', evidenceType: '', evidence: 'test fails' },
            ],
            acceptanceCriteria: [
                { id: 'Scenario: fallback works', status: 'MET', evidenceType: 'test', evidence: 'a | b' },
            ],
        });
        const out = parseTesting(renderTesting(v), '0100');
        expect(out.kind).toBe('valid');
        if (out.kind === 'valid') {
            expect(out.verdict.verdict).toBe(v.verdict);
            expect(out.verdict.requirements).toEqual(v.requirements);
            expect(out.verdict.acceptanceCriteria).toEqual(v.acceptanceCriteria);
        }
    });

    test('round-trips PARTIAL and FAIL verdicts and unescapes pipes', () => {
        for (const verdict of ['PARTIAL', 'FAIL'] as const) {
            const v = makeVerdict({
                verdict,
                requirements: [{ id: 'R1', status: 'MET', evidenceType: '', evidence: 'evidence | with pipe' }],
            });
            const out = parseTesting(renderTesting(v), '0100');
            expect(out.kind).toBe('valid');
            if (out.kind === 'valid') {
                expect(out.verdict.verdict).toBe(verdict);
                expect(out.verdict.requirements[0]?.evidence).toBe('evidence | with pipe');
            }
        }
    });

    test('round-trips evidence with a backslash immediately before a pipe', () => {
        const v = makeVerdict({
            requirements: [{ id: 'R1', status: 'MET', evidenceType: '', evidence: 'escaped \\| pipe' }],
        });
        const out = parseTesting(renderTesting(v), '0100');
        expect(out.kind).toBe('valid');
        if (out.kind === 'valid') {
            expect(out.verdict.requirements).toEqual(v.requirements);
        }
    });

    test('round-trips requirement and acceptance-criteria ids containing pipes', () => {
        const v = makeVerdict({
            requirements: [{ id: 'R1|pipe', status: 'MET', evidenceType: '', evidence: 'covered' }],
            acceptanceCriteria: [
                { id: 'Scenario: alpha | beta', status: 'MET', evidenceType: 'test', evidence: 'covered' },
            ],
        });
        const out = parseTesting(renderTesting(v), '0100');
        expect(out.kind).toBe('valid');
        if (out.kind === 'valid') {
            expect(out.verdict.requirements[0]?.id).toBe('R1|pipe');
            expect(out.verdict.acceptanceCriteria[0]?.id).toBe('Scenario: alpha | beta');
        }
    });

    // Tolerance over real corpus shapes (R3/R6): Requirement/Req header variants,
    // scenario-title-keyed rows, and a table without a Verdict: line. The sections
    // below are real shapes harvested from docs/tasks* (0417, 0360), lightly trimmed.
    test('parses a Requirement-header corpus section without a Verdict line', () => {
        const corpus = [
            '**Verification run 2026-08-02.**',
            '',
            '| Requirement | Status | Evidence |',
            '|-------------|--------|----------|',
            '| R1 | MET | All four scenarios cited to passing tests |',
            '| R2 | MET | Scenarios recorded verbatim |',
            '| R3 | MET | Every citation is a pre-existing test |',
            '',
            '**Acceptance Criteria Verification**',
            '',
            '| AC | Status | Evidence Type | Evidence |',
            '|----|--------|---------------|----------|',
            '| Section editing is the hot path | MET | test | task-service.test.ts |',
            '',
        ].join('\n');
        const out = parseTesting(corpus, '0417');
        expect(out.kind).toBe('valid');
        if (out.kind === 'valid') {
            // No Verdict line → aggregate derived by the canonical rule (all MET → PASS).
            expect(out.verdict.verdict).toBe('PASS');
            expect(out.verdict.requirements).toEqual([
                { id: 'R1', status: 'MET', evidenceType: '', evidence: 'All four scenarios cited to passing tests' },
                { id: 'R2', status: 'MET', evidenceType: '', evidence: 'Scenarios recorded verbatim' },
                { id: 'R3', status: 'MET', evidenceType: '', evidence: 'Every citation is a pre-existing test' },
            ]);
            expect(out.verdict.acceptanceCriteria[0]?.id).toBe('Section editing is the hot path');
            expect(out.verdict.acceptanceCriteria[0]?.evidenceType).toBe('test');
        }
    });

    test('parses a Req-header corpus section keyed by scenario title', () => {
        const corpus = [
            '**Per-Requirement Traceability**',
            '',
            '| Req | Status | Evidence |',
            '|-----|--------|----------|',
            '| R1 List idea-path touchpoints | MET | Solution table rows 1-17 |',
            '| R2 Must-change vs leave-alone split | MET | Solution Must-change rows |',
            '',
            '**Acceptance Criteria Verification**',
            '',
            '| AC | Status | Evidence Type | Evidence |',
            '|----|--------|---------------|----------|',
            '| Scenario: Idea-path touchpoints listed | MET | static | Solution inventory table |',
            '',
        ].join('\n');
        const out = parseTesting(corpus, '0360');
        expect(out.kind).toBe('valid');
        if (out.kind === 'valid') {
            expect(out.verdict.requirements[0]?.id).toBe('R1 List idea-path touchpoints');
            expect(out.verdict.acceptanceCriteria[0]?.id).toBe('Scenario: Idea-path touchpoints listed');
        }
    });

    test('recognises N/A and case-insensitive statuses', () => {
        const corpus = [
            '| Requirement | Status | Evidence |',
            '|-------------|--------|----------|',
            '| R1 | met | lowercase status |',
            '| R2 | N/A | not applicable |',
            '',
        ].join('\n');
        const out = parseTesting(corpus, '9999');
        expect(out.kind).toBe('valid');
        if (out.kind === 'valid') {
            expect(out.verdict.requirements.map((r) => r.status)).toEqual(['MET', 'N/A']);
        }
    });

    // Honest-outcome tests (R4): no rows → not valid; prose never reads as MET.
    test('empty or whitespace-only section is missing', () => {
        expect(parseTesting('', '0100').kind).toBe('missing');
        expect(parseTesting('  \n\n  ', '0100').kind).toBe('missing');
    });

    test('prose claiming tests pass is invalid, never MET', () => {
        const out = parseTesting('Tests all pass. Full suite green. Verified 2026-08-01.', '0100');
        expect(out.kind).toBe('invalid');
    });

    test('a table with no recognisable rows is invalid, not a fabricated verdict', () => {
        const corpus = [
            '| Requirement | Status | Evidence |',
            '|-------------|--------|----------|',
            '| — | — | No requirements recorded; verify verdict PASS |',
            '',
        ].join('\n');
        const out = parseTesting(corpus, '0100');
        expect(out.kind).toBe('invalid');
        if (out.kind === 'invalid') {
            expect(out.reason).toContain('no recognisable coverage rows');
        }
    });

    test('does not mistake a mid-line Verdict token for the section verdict', () => {
        const corpus = [
            '- Verdict: PASS (from verdict artifact)',
            '',
            '| Requirement | Status | Evidence |',
            '|-------------|--------|----------|',
            '| R1 | MET | saw a "Verdict: FAIL" string inside evidence text |',
            '',
        ].join('\n');
        const out = parseTesting(corpus, '0100');
        expect(out.kind).toBe('valid');
        if (out.kind === 'valid') {
            expect(out.verdict.verdict).toBe('PASS');
        }
    });

    test('truncated table is malformed without throwing', () => {
        const missingStatus = [
            '| Requirement | Status | Evidence |',
            '|-------------|--------|----------|',
            '| R1 |',
            '',
        ].join('\n');
        const missingEvidence = [
            '| Requirement | Status | Evidence |',
            '|-------------|--------|----------|',
            '| R1 | MET |',
            '',
        ].join('\n');
        const truncatedSeparator = [
            '| Requirement | Status | Evidence |',
            '|-------------|--------|',
            '| R1 | MET | evidence |',
            '',
        ].join('\n');
        expect(parseTesting(missingStatus, '0100').kind).toBe('malformed');
        expect(parseTesting(missingEvidence, '0100').kind).toBe('malformed');
        expect(parseTesting(truncatedSeparator, '0100').kind).toBe('malformed');
    });

    test('a malformed row cannot be dropped behind a surviving MET row', () => {
        for (const brokenRow of [
            '|  | UNMET | missing id |',
            '| R2 |  | missing status |',
            '| R2 | UNME | typo |',
            '| R2 | NA | alias |',
        ]) {
            const corpus = [
                '| Requirement | Status | Evidence |',
                '|-------------|--------|----------|',
                '| R1 | MET | valid row |',
                brokenRow,
                '',
            ].join('\n');
            expect(parseTesting(corpus, '0100').kind).toBe('malformed');
        }
    });

    test('locates the Testing section inside a full task document', () => {
        const doc = [
            '## Background',
            'Something.',
            '',
            '### Testing',
            '| Requirement | Status | Evidence |',
            '|-------------|--------|----------|',
            '| R1 | MET | done |',
            '',
            '### Review',
            'Nothing.',
        ].join('\n');
        const out = parseTesting(doc, '0100');
        expect(out.kind).toBe('valid');
        if (out.kind === 'valid') {
            expect(out.verdict.requirements[0]?.id).toBe('R1');
        }
    });

    test('a full task document without a Testing section is missing', () => {
        const doc = [
            '## 0100. No testing section',
            '',
            '### Requirements',
            '| Requirement | Status | Evidence |',
            '|-------------|--------|----------|',
            '| R1 | MET | this table is outside Testing |',
        ].join('\n');
        expect(parseTesting(doc, '0100').kind).toBe('missing');
    });
});

describe('renderReview', () => {
    test('renders P1–P4 table with checks', () => {
        const v = makeVerdict();
        const out = renderReview(v);
        expect(out).toContain('**SECU findings**');
        expect(out).toContain('| Priority | Dimension | Location | Finding |');
        expect(out).toContain('| P1 | Security | — | no auth bypass |');
        expect(out).toContain('| P3 | Style | — | minor formatting issue |');
    });

    test('renders no-findings P4 row when checks empty', () => {
        const v = makeVerdict({ checks: [] });
        const out = renderReview(v);
        expect(out).toContain('| P4 | — | — | No findings (verify verdict PASS) |');
        expect(out).not.toContain('| P1 |');
    });

    test('passing checks are gate outcomes, not findings: an all-pass verdict renders only the no-findings row', () => {
        // A P4 row per passing gate made the residual sweep report advisory residuals on every clean task.
        const v = makeVerdict({
            checks: [
                { name: 'spur task check', status: 'pass', evidence: 'task check passed' },
                { name: 'residual-sweep', status: 'pass', evidence: 'blocking=0' },
            ],
        });
        const out = renderReview(v);
        expect(out).toContain('| P4 | — | — | No findings (verify verdict PASS) |');
        expect(out).not.toContain('task check passed');
    });

    test('collapses newlines in findings', () => {
        const v = makeVerdict({
            checks: [{ name: 'S', status: 'P1', evidence: 'a\nb\nc' }],
        });
        const out = renderReview(v);
        expect(out).toContain('a b c');
    });

    test('escapes pipe characters in findings evidence', () => {
        const v = makeVerdict({
            checks: [{ name: 'S', status: 'P1', evidence: 'config|secret|key' }],
        });
        const out = renderReview(v);
        expect(out).toContain('config\\|secret\\|key');
        // Unescaped pipe would break the table
        expect(out).not.toMatch(/\| config\|secret\|key \|/);
    });

    test('maps fail status to P1 and drops pass rows when status is not already P1-P4', () => {
        const v = makeVerdict({
            checks: [
                { name: 'spur task check', status: 'pass', evidence: 'task check passed' },
                { name: 'coverage gate', status: 'fail', evidence: 'coverage below threshold' },
            ],
        });
        const out = renderReview(v);
        expect(out).not.toContain('task check passed');
        expect(out).not.toContain('No findings');
        expect(out).toContain('| P1 | coverage gate | — | coverage below threshold |');
    });

    test('an explicit severity wins over the status mapping (0721)', () => {
        // Without this, `hollow-met-evidence` (major, status fail) rendered as P1 —
        // indistinguishable from a blocker in the table an operator actually reads.
        const v = makeVerdict({
            checks: [
                { name: 'hollow-met-evidence', status: 'fail', severity: 'major', evidence: 'R1 has no evidence' },
                { name: 'SECU', status: 'fail', severity: 'blocker', evidence: 'auth bypass' },
                { name: 'nit', status: 'fail', severity: 'advisory', evidence: 'naming' },
            ],
        });
        const out = renderReview(v);
        expect(out).toContain('| P2 | hollow-met-evidence | — | R1 has no evidence |');
        expect(out).toContain('| P1 | SECU | — | auth bypass |');
        expect(out).toContain('| P4 | nit | — | naming |');
    });
});

describe('renderSolutionFromDiff', () => {
    test('parses file:line citations from git diff -U0', () => {
        const diff = [
            'diff --git a/src/foo.ts b/src/foo.ts',
            '--- a/src/foo.ts',
            '+++ b/src/foo.ts',
            '@@ -10,3 +15,5 @@',
            'diff --git a/src/bar.ts b/src/bar.ts',
            '--- a/src/bar.ts',
            '+++ b/src/bar.ts',
            '@@ -1 +1,3 @@',
        ].join('\n');
        const out = renderSolutionFromDiff(diff);
        expect(out).toContain('| `src/foo.ts:15` |');
        expect(out).toContain('| `src/bar.ts:1` |');
    });

    test('deduplicates and sorts citations', () => {
        const diff = [
            '+++ b/src/z.ts',
            '@@ -1 +1 @@',
            '+++ b/src/a.ts',
            '@@ -5 +5 @@',
            '+++ b/src/z.ts',
            '@@ -10 +12 @@',
        ].join('\n');
        const out = renderSolutionFromDiff(diff);
        // Should have 3 unique: a.ts:5, z.ts:1, z.ts:12
        expect(out).toContain('| `src/a.ts:5` |');
        expect(out).toContain('| `src/z.ts:1` |');
        expect(out).toContain('| `src/z.ts:12` |');
    });

    test('falls back to file:1 when no hunks', () => {
        const diff = [
            '+++ b/src/only-deletions.ts',
            // No @@ lines — only file renames or pure deletions
        ].join('\n');
        const out = renderSolutionFromDiff(diff);
        expect(out).toContain('| `src/only-deletions.ts:1` |');
    });

    test('shows no-changes when diff is empty', () => {
        const out = renderSolutionFromDiff('');
        expect(out).toContain('(no changes detected)');
    });

    test('includes header text', () => {
        const out = renderSolutionFromDiff('');
        expect(out).toContain('Change-map (auto-generated');
        expect(out).toContain('| Change (`file:line`) |');
    });
});

describe('TaskService.record', () => {
    let tasksDir: string;

    let svc: TaskService;

    beforeAll(async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-record-'));
        tasksDir = join(root, 'tasks');
        const fs = createNodeFileSystem(root);
        await fs.ensureDir(tasksDir);
        // Ensure .spur/run directory exists
        await fs.ensureDir(join(root, '.spur', 'run'));
        const writeService = new PlanningWriteService({ fs });
        svc = new TaskService({ fs, tasksDir, writeService, sectionMatrix: RECORD_SECTION_MATRIX });
    });

    afterAll(() => {
        rmSync(tasksDir.replace('/tasks', ''), { recursive: true, force: true });
    });

    test('writes Testing and Review sections from a verdict', async () => {
        const wbs = await createTask(svc);

        // Write a verdict file
        const root = tasksDir.replace('/tasks', '');
        const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
        const fs = createNodeFileSystem(root);
        await fs.writeFile(
            verdictPath,
            JSON.stringify({
                wbs,
                verdict: 'PASS',
                requirements: [{ id: 'R1', status: 'MET', evidence: 'all good' }],
                checks: [{ name: 'Security', status: 'P4', evidence: 'clean' }],
            }),
        );

        const result = await svc.record(wbs, { verdictFile: verdictPath });

        expect(result.testingWritten).toBe(true);
        expect(result.reviewWritten).toBe(true);
        expect(result.solutionBackfilled).toBe(false);
        expect(result.transitionedTo).toBeUndefined();

        // Verify sections in the file
        const raw = await fs.readFile(`${tasksDir}/${wbs}_record-test-task.md`);
        expect(raw).toContain('### Testing');
        expect(raw).toContain('**Pipeline verify results**');
        expect(raw).toContain('| R1 | MET | all good |');
        expect(raw).toContain('### Review');
        expect(raw).toContain('| Priority | Dimension | Location | Finding |');
    });

    test('R2 (0692): record flips the Requirements box a PASS verdict proves', async () => {
        const wbs = await createTask(svc);

        // Seed unchecked Requirements boxes on the task via a local write service.
        const root = tasksDir.replace('/tasks', '');
        const fs = createNodeFileSystem(root);
        const ws = new PlanningWriteService({ fs });
        const ref: EntityRef = {
            kind: 'task',
            id: wbs,
            filePath: `${tasksDir}/${wbs}_record-test-task.md`,
            folder: tasksDir,
        };
        await ws.updateSection(
            ref,
            'Requirements',
            '- [ ] R1. first requirement\n- [ ] R2. second requirement\n- [ ] R3. third requirement\n',
        );

        // PASS verdict proves R1 only.
        const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
        await fs.writeFile(
            verdictPath,
            JSON.stringify({
                wbs,
                verdict: 'PASS',
                requirements: [{ id: 'R1', status: 'MET', evidence: 'covered' }],
                checks: [],
            }),
        );

        await svc.record(wbs, { verdictFile: verdictPath });

        const raw = await fs.readFile(`${tasksDir}/${wbs}_record-test-task.md`);
        expect(raw).toContain('- [x] R1. first requirement');
        expect(raw).toContain('- [ ] R2. second requirement');
        expect(raw).toContain('- [ ] R3. third requirement');
    });

    test('0996 AC1: record ticks the AC box a scenario-keyed row aliases, not the same-numbered R box', async () => {
        const wbs = await createTask(svc);
        const root = tasksDir.replace('/tasks', '');
        const fs = createNodeFileSystem(root);
        const ws = new PlanningWriteService({ fs });
        const filePath = `${tasksDir}/${wbs}_record-test-task.md`;
        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: tasksDir };
        await ws.updateSection(ref, 'Requirements', '- [ ] R1. first\n- [ ] R3. third\n');
        await ws.updateSection(ref, 'Acceptance Criteria', '- [ ] AC1 — R3 — The loop is a service (req: R1)\n');

        const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
        await fs.writeFile(
            verdictPath,
            JSON.stringify({
                wbs,
                verdict: 'PASS',
                requirements: [{ id: 'R1', status: 'MET', evidence: 'covered' }],
                acceptanceCriteria: [
                    { id: 'R3 — The loop is a service', status: 'MET', evidenceType: 'test', evidence: 'covered' },
                ],
                checks: [],
            }),
        );

        await svc.record(wbs, { verdictFile: verdictPath });

        const raw = await fs.readFile(filePath);
        expect(raw).toContain('- [x] AC1 — R3 — The loop is a service (req: R1)');
        expect(raw).toContain('- [x] R1. first');
        expect(raw).toContain('- [ ] R3. third');
    });

    test('AC3 (0800 R1): a PASS verdict never flips a Plan box — Plan stays byte-identical', async () => {
        // 0788 is the counter-example that fixed this rule: verdict PASS with a plan
        // step deliberately left open. A verdict certifies requirements; flipping a
        // Plan box from it would fabricate evidence no check produced.
        const wbs = await createTask(svc);
        const root = tasksDir.replace('/tasks', '');
        const fs = createNodeFileSystem(root);
        const ws = new PlanningWriteService({ fs });
        const ref: EntityRef = {
            kind: 'task',
            id: wbs,
            filePath: `${tasksDir}/${wbs}_record-test-task.md`,
            folder: tasksDir,
        };
        await ws.updateSection(ref, 'Requirements', '- [ ] R1. first requirement\n');
        const planBody = '- [x] 1. finished step\n- [ ] 2. deliberately open step\n';
        await ws.updateSection(ref, 'Plan', planBody);
        const planBefore = MarkdownDocument.parse(
            await fs.readFile(`${tasksDir}/${wbs}_record-test-task.md`),
            'task',
        ).getSection('Plan');

        const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
        await fs.writeFile(
            verdictPath,
            JSON.stringify({
                wbs,
                verdict: 'PASS',
                requirements: [{ id: 'R1', status: 'MET', evidence: 'covered' }],
                checks: [],
            }),
        );

        await svc.record(wbs, { verdictFile: verdictPath });

        const raw = await fs.readFile(`${tasksDir}/${wbs}_record-test-task.md`);
        const planAfter = MarkdownDocument.parse(raw, 'task').getSection('Plan');
        expect(planAfter).toBe(planBefore);
        expect(raw).toContain('- [x] R1. first requirement');
        expect(raw).toContain('- [ ] 2. deliberately open step');
    });

    test('handles missing verdict file gracefully', async () => {
        const wbs = await createTask(svc);

        const result = await svc.record(wbs);

        expect(result.testingWritten).toBe(true);
        expect(result.reviewWritten).toBe(true);

        // Should still write sections with UNKNOWN verdict
        const root = tasksDir.replace('/tasks', '');
        const fs = createNodeFileSystem(root);
        const raw = await fs.readFile(`${tasksDir}/${wbs}_record-test-task.md`);
        expect(raw).toContain('- Verdict: UNKNOWN');
        expect(raw).toContain('No requirements recorded');
        expect(raw).toContain('No findings (verify verdict UNKNOWN)');
    });

    test('backfills Solution when --solution-from-diff and bare', async () => {
        const wbs = await createTask(svc);

        // Write a verdict file
        const root = tasksDir.replace('/tasks', '');
        const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
        const fs = createNodeFileSystem(root);
        await fs.writeFile(verdictPath, JSON.stringify({ wbs, verdict: 'PASS' }));

        const result = await svc.record(wbs, { solutionFromDiff: true });

        expect(result.solutionBackfilled).toBe(true);

        const raw = await fs.readFile(`${tasksDir}/${wbs}_record-test-task.md`);
        expect(raw).toContain('### Solution');
        expect(raw).toContain('Change-map');
    });

    test('applies transition when requested', async () => {
        const wbs = await createTask(svc);

        const result = await svc.record(wbs, { transition: 'testing' });

        expect(result.transitionedTo).toBe('testing');

        // Verify status updated in file
        const root = tasksDir.replace('/tasks', '');
        const fs = createNodeFileSystem(root);
        const raw = await fs.readFile(`${tasksDir}/${wbs}_record-test-task.md`);
        const doc = MarkdownDocument.parse(raw, 'task');
        expect(doc.frontmatterData?.status).toBe('testing');
    });

    test('no transition when option omitted', async () => {
        const wbs = await createTask(svc);

        const result = await svc.record(wbs);

        expect(result.transitionedTo).toBeUndefined();
    });

    test('preserves existing Review when not bare (does not overwrite agent review)', async () => {
        const wbs = await createTask(svc);

        // Pre-populate Review with detailed SECU findings (as the review agent would)
        const root = tasksDir.replace('/tasks', '');
        const fs = createNodeFileSystem(root);
        const filePath = `${tasksDir}/${wbs}_record-test-task.md`;
        const ref = { kind: 'task' as const, id: wbs, filePath, folder: tasksDir };
        const reviewBody = [
            '**SECU findings** (review agent)',
            '',
            '| Priority | Dim | file:line | Description | Remediation |',
            '|----------|-----|-----------|-------------|-------------|',
            '| P4 | U | `Modal.tsx:43` | Escape handler tabIndex | Add tabIndex={-1} |',
            '',
        ].join('\n');
        const writeService = new PlanningWriteService({ fs });
        await writeService.updateSection(ref, 'Review', reviewBody);

        // Write a verdict file
        const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
        await fs.writeFile(
            verdictPath,
            JSON.stringify({
                wbs,
                verdict: 'PASS',
                checks: [{ name: 'spur task check', status: 'pass', evidence: 'task check passed' }],
            }),
        );

        const result = await svc.record(wbs, { verdictFile: verdictPath });

        // Testing is always written; Review is preserved (not bare)
        expect(result.testingWritten).toBe(true);
        expect(result.reviewWritten).toBe(false);

        // The agent's detailed review should be preserved
        const raw = await fs.readFile(filePath);
        expect(raw).toContain('SECU findings** (review agent)');
        expect(raw).toContain('| P4 | U | `Modal.tsx:43`');
        expect(raw).not.toContain('pipeline verify step');
    });

    test('preserves authored Testing when the verdict is UNKNOWN (no artifact)', async () => {
        const wbs = await createTask(svc);

        // Pre-populate Testing as the pipeline's verify step would have (hand-authored).
        const root = tasksDir.replace('/tasks', '');
        const fs = createNodeFileSystem(root);
        const filePath = `${tasksDir}/${wbs}_record-test-task.md`;
        const ref = { kind: 'task' as const, id: wbs, filePath, folder: tasksDir };
        const testingBody = [
            '**Pipeline verify results**',
            '',
            '- Verdict: PASS (from verdict artifact)',
            '',
            '| Requirement | Status | Evidence |',
            '|-------------|--------|----------|',
            '| Scenario: R1 — … | MET | hand-authored evidence |',
            '',
        ].join('\n');
        const writeService = new PlanningWriteService({ fs });
        await writeService.updateSection(ref, 'Testing', testingBody);

        // NO verdict artifact — record must not clobber the authored Testing.
        const result = await svc.record(wbs);

        expect(result.testingWritten).toBe(false);
        const raw = await fs.readFile(filePath);
        expect(raw).toContain('hand-authored evidence');
        expect(raw).not.toContain('No requirements recorded');
    });

    test('R4: auto-walks wip→testing→done and creates a pipeline run-link on PASS to done', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-record-r4-'));
        const dir = join(root, 'tasks');
        const fs = createNodeFileSystem(root);
        await fs.ensureDir(dir);
        await fs.ensureDir(join(root, '.spur', 'run'));
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(db);
        const writeService = new PlanningWriteService({ fs });
        const svcWithDb = new TaskService({
            fs,
            tasksDir: dir,
            writeService,
            getDb: async () => db,
            sectionMatrix: RECORD_SECTION_MATRIX,
        });
        try {
            // Create + move to wip (as the pipeline's implement step does).
            const created = await svcWithDb.create({ title: 'Record R4 auto-walk' });
            const wbs = created.ref.id;
            await svcWithDb.updateStatus(wbs, 'wip');

            // PASS verdict file.
            const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
            await fs.writeFile(verdictPath, JSON.stringify({ wbs, verdict: 'PASS', requirements: [], checks: [] }));

            const result = await svcWithDb.record(wbs, { verdictFile: verdictPath, transition: 'done' });

            expect(result.transitionedTo).toBe('done');

            // File status walked forward to done.
            const raw = await fs.readFile(`${dir}/${wbs}_record-r4-auto-walk.md`);
            const doc = MarkdownDocument.parse(raw, 'task');
            expect(doc.frontmatterData?.status).toBe('done');

            // A `pipeline` run-link was auto-created (provenance gate satisfied).
            const links = await new TaskRunLinkDao(db).listByWbs(wbs, 20);
            expect(links.some((l) => l.kind === 'pipeline')).toBe(true);
        } finally {
            db.close();
            rmSync(root, { recursive: true, force: true });
        }
    });

    test("0713 R2: re-recording a changed verdict replaces record's own stale Review header", async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-record-0713r2-'));
        const dir = join(root, 'tasks');
        const fs = createNodeFileSystem(root);
        await fs.ensureDir(dir);
        await fs.ensureDir(join(root, '.spur', 'run'));
        const writeService = new PlanningWriteService({ fs });
        const svc = new TaskService({ fs, tasksDir: dir, writeService, sectionMatrix: RECORD_SECTION_MATRIX });
        try {
            const created = await svc.create({ title: 'Record 0713 R2 stale header' });
            const wbs = created.ref.id;
            const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
            const reviewOf = async (): Promise<string> =>
                MarkdownDocument.parse(await fs.readFile(created.ref.filePath), 'task').getSection('Review') ?? '';

            // First record: bare Review takes the fallback backfill, verdict FAIL.
            await fs.writeFile(verdictPath, JSON.stringify({ wbs, verdict: 'FAIL', requirements: [], checks: [] }));
            expect((await svc.record(wbs, { verdictFile: verdictPath })).reviewWritten).toBe(true);
            expect(await reviewOf()).toContain('verdict: FAIL');

            // Re-record after the verdict changed. Before 0713 R2 the section was no longer
            // bare, so this was skipped and `verdict: FAIL` outlived the verdict itself.
            await fs.writeFile(verdictPath, JSON.stringify({ wbs, verdict: 'PASS', requirements: [], checks: [] }));
            expect((await svc.record(wbs, { verdictFile: verdictPath })).reviewWritten).toBe(true);

            const review = await reviewOf();
            expect(review).toContain('verdict: PASS');
            expect(review).not.toContain('verdict: FAIL');
            // Exactly one header — the replacement must not append beside the old one.
            expect(review.match(/verdict: /g) ?? []).toHaveLength(1);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('0713 R2: an authored Review is never replaced by a re-record', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-record-0713r2b-'));
        const dir = join(root, 'tasks');
        const fs = createNodeFileSystem(root);
        await fs.ensureDir(dir);
        await fs.ensureDir(join(root, '.spur', 'run'));
        const writeService = new PlanningWriteService({ fs });
        const svc = new TaskService({ fs, tasksDir: dir, writeService, sectionMatrix: RECORD_SECTION_MATRIX });
        try {
            const created = await svc.create({ title: 'Record 0713 R2 authored review' });
            const wbs = created.ref.id;
            // The review coordinator's three-dimensional findings — record must not touch these.
            await writeService.updateSection(
                created.ref,
                'Review',
                '| Priority | Dimension | Location | Finding |\n| --- | --- | --- | --- |\n| P2 | correctness | `src/a.ts:1` | authored by the review coordinator |\n',
            );
            const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
            await fs.writeFile(verdictPath, JSON.stringify({ wbs, verdict: 'PASS', requirements: [], checks: [] }));

            const result = await svc.record(wbs, { verdictFile: verdictPath });

            expect(result.reviewWritten).toBe(false);
            const review =
                MarkdownDocument.parse(await fs.readFile(created.ref.filePath), 'task').getSection('Review') ?? '';
            expect(review).toContain('authored by the review coordinator');
            expect(review).not.toContain('SECU findings');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('R4: idempotent — re-recording PASS to done does not duplicate the run-link', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-record-r4b-'));
        const dir = join(root, 'tasks');
        const fs = createNodeFileSystem(root);
        await fs.ensureDir(dir);
        await fs.ensureDir(join(root, '.spur', 'run'));
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(db);
        const writeService = new PlanningWriteService({ fs });
        const svcWithDb = new TaskService({
            fs,
            tasksDir: dir,
            writeService,
            getDb: async () => db,
            sectionMatrix: RECORD_SECTION_MATRIX,
        });
        try {
            const created = await svcWithDb.create({ title: 'Record R4 idempotent' });
            const wbs = created.ref.id;
            await svcWithDb.updateStatus(wbs, 'wip');
            const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
            await fs.writeFile(verdictPath, JSON.stringify({ wbs, verdict: 'PASS', requirements: [], checks: [] }));

            await svcWithDb.record(wbs, { verdictFile: verdictPath, transition: 'done' });
            await svcWithDb.record(wbs, { verdictFile: verdictPath, transition: 'done' });

            const links = await new TaskRunLinkDao(db).listByWbs(wbs, 20);
            expect(links.filter((l) => l.kind === 'pipeline')).toHaveLength(1);
        } finally {
            db.close();
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('R4: surfaces a single clear GuardDeniedError when verdict is not PASS and target is done', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-record-r4c-'));
        const dir = join(root, 'tasks');
        const fs = createNodeFileSystem(root);
        await fs.ensureDir(dir);
        await fs.ensureDir(join(root, '.spur', 'run'));
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(db);
        const writeService = new PlanningWriteService({ fs });
        const svcWithDb = new TaskService({
            fs,
            tasksDir: dir,
            writeService,
            getDb: async () => db,
            sectionMatrix: RECORD_SECTION_MATRIX,
        });
        try {
            const created = await svcWithDb.create({ title: 'Record R4 non-pass' });
            const wbs = created.ref.id;
            await svcWithDb.updateStatus(wbs, 'wip');
            const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
            await fs.writeFile(verdictPath, JSON.stringify({ wbs, verdict: 'FAIL', requirements: [], checks: [] }));

            await expect(
                svcWithDb.record(wbs, { verdictFile: verdictPath, transition: 'done' }),
            ).rejects.toBeInstanceOf(GuardDeniedError);

            // No run-link created for a non-PASS verdict, and status did not advance.
            const links = await new TaskRunLinkDao(db).listByWbs(wbs, 20);
            expect(links.some((l) => l.kind === 'pipeline')).toBe(false);
            const raw = await fs.readFile(`${dir}/${wbs}_record-r4-non-pass.md`);
            const doc = MarkdownDocument.parse(raw, 'task');
            expect(doc.frontmatterData?.status).toBe('wip');
        } finally {
            db.close();
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('R4 residual: run-link is not created until the hop to done (failed earlier hop leaves zero links)', async () => {
        // Lifecycle adapter that denies wip→testing so the walk never reaches done.
        // Ensures ensurePipelineRunLink is deferred past intermediate hops.
        const root = mkdtempSync(join(tmpdir(), 'spur-record-r4d-'));
        const dir = join(root, 'tasks');
        const fs = createNodeFileSystem(root);
        await fs.ensureDir(dir);
        await fs.ensureDir(join(root, '.spur', 'run'));
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(db);

        const writeService = new PlanningWriteService({
            fs,
            lifecycle: {
                requestTransition(_ref, from, to) {
                    if (to === 'testing') {
                        return {
                            allowed: false,
                            from,
                            to,
                            report: 'simulated wip→testing guard denial',
                        };
                    }
                    return { allowed: true, from, to };
                },
            },
        });
        const svcWithDb = new TaskService({
            fs,
            tasksDir: dir,
            writeService,
            getDb: async () => db,
            sectionMatrix: RECORD_SECTION_MATRIX,
        });
        try {
            const created = await svcWithDb.create({ title: 'Record R4 deferred link' });
            const wbs = created.ref.id;
            // Bypass lifecycle for the setup hop to wip.
            await fs.writeFile(
                created.ref.filePath,
                (await fs.readFile(created.ref.filePath)).replace('status: backlog', 'status: wip'),
            );
            const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
            await fs.writeFile(verdictPath, JSON.stringify({ wbs, verdict: 'PASS', requirements: [], checks: [] }));

            await expect(
                svcWithDb.record(wbs, { verdictFile: verdictPath, transition: 'done' }),
            ).rejects.toBeInstanceOf(GuardDeniedError);

            // Critical residual fix: no pipeline link when the walk never reached done.
            const links = await new TaskRunLinkDao(db).listByWbs(wbs, 20);
            expect(links.some((l) => l.kind === 'pipeline')).toBe(false);

            const raw = await fs.readFile(created.ref.filePath);
            const doc = MarkdownDocument.parse(raw, 'task');
            expect(doc.frontmatterData?.status).toBe('wip');
        } finally {
            db.close();
            rmSync(root, { recursive: true, force: true });
        }
    });

    describe('scenario-key carry-forward guard (0936 R1)', () => {
        const root = () => tasksDir.replace('/tasks', '');

        async function seedRecordFeature(id: string, scenarios: string[]): Promise<void> {
            const fs = createNodeFileSystem(root());
            const featuresDir = join(root(), 'features');
            await fs.ensureDir(featuresDir);
            const body = scenarios.map((s) => `  Scenario: ${s}\n    Given x\n    Then y`).join('\n\n');
            await fs.writeFile(
                join(featuresDir, `${id}_record-guard.md`),
                `---\nid: ${id}\nname: "record-guard"\n---\n\n# ${id}\n\n## Acceptance Criteria\n\n\`\`\`gherkin\nFeature: record-guard\n${body}\n\`\`\`\n`,
            );
        }

        async function writeVerdictRows(
            wbs: string,
            requirements: Array<{ id: string; status: string }>,
            verdict = 'PASS',
        ): Promise<string> {
            const fs = createNodeFileSystem(root());
            const verdictPath = join(root(), '.spur', 'run', `${wbs}-verdict.json`);
            await fs.writeFile(
                verdictPath,
                JSON.stringify({
                    wbs,
                    verdict,
                    requirements: requirements.map((r) => ({ ...r, evidence: 'ev' })),
                    checks: [],
                }),
            );
            return verdictPath;
        }

        test('dropped MET-matched scenario key warns and names the scenario; Review backfill unchanged', async () => {
            await seedRecordFeature('Z1', ['Record preserves scenario keys', 'Second scenario stays verified']);
            const wbs = await createTask(svc);
            await svc.updateField(wbs, 'feature_id', 'Z1');
            // First record: Testing carries MET rows for both feature scenarios.
            const first = await writeVerdictRows(wbs, [
                { id: 'Scenario: Record preserves scenario keys', status: 'MET' },
                { id: 'AC-2', status: 'MET' },
            ]);
            await svc.record(wbs, { verdictFile: first });

            // Re-record from a fresh artifact that re-keys scenario 1 to a bare R-id
            // (the 0921 regression shape) while scenario 2 stays keyed — no parity warning.
            const second = await writeVerdictRows(wbs, [
                { id: 'R1', status: 'MET' },
                { id: 'AC-2', status: 'MET' },
            ]);
            const result = await svc.record(wbs, { verdictFile: second });

            expect(result.testingWritten).toBe(true);
            expect(result.scenarioWarnings).toHaveLength(1);
            expect(result.scenarioWarnings?.[0]).toContain('Record preserves scenario keys');
            expect(result.scenarioWarnings?.[0]).toContain('Z1');
            // The bare-placeholder Review backfill (F92 0593 R1) is unchanged by the guard.
            // 1040 R1: the re-render is byte-identical here (same verdict, no checks),
            // so the identical section is NOT rewritten — flag stays false.
            expect(result.reviewWritten).toBe(false);
            const fs = createNodeFileSystem(root());
            const raw = await fs.readFile(`${tasksDir}/${wbs}_record-test-task.md`);
            expect(raw).toContain('### Review');
        });

        test('preserved scenario key stays silent', async () => {
            await seedRecordFeature('Z2', ['Only scenario']);
            const wbs = await createTask(svc);
            await svc.updateField(wbs, 'feature_id', 'Z2');
            const first = await writeVerdictRows(wbs, [{ id: 'AC-1', status: 'MET' }]);
            await svc.record(wbs, { verdictFile: first });

            const second = await writeVerdictRows(wbs, [{ id: 'Scenario: Only scenario', status: 'MET' }]);
            const result = await svc.record(wbs, { verdictFile: second });

            expect(result.scenarioWarnings).toBeUndefined();
        });

        test('MET-only comparison: a previously non-MET match lost is silent', async () => {
            await seedRecordFeature('Z3', ['Scenario one', 'Scenario two']);
            const wbs = await createTask(svc);
            await svc.updateField(wbs, 'feature_id', 'Z3');
            // Scenario 1 matched only by an UNMET row — never verified, nothing to lose.
            const first = await writeVerdictRows(
                wbs,
                [
                    { id: 'AC-1', status: 'UNMET' },
                    { id: 'AC-2', status: 'MET' },
                ],
                'PARTIAL',
            );
            await svc.record(wbs, { verdictFile: first });

            const second = await writeVerdictRows(wbs, [{ id: 'AC-2', status: 'MET' }]);
            const result = await svc.record(wbs, { verdictFile: second });

            expect(result.scenarioWarnings).toBeUndefined();
        });

        test('no feature_id stays silent', async () => {
            const wbs = await createTask(svc);
            const verdictPath = await writeVerdictRows(wbs, [{ id: 'R1', status: 'MET' }]);
            const result = await svc.record(wbs, { verdictFile: verdictPath });
            expect(result.scenarioWarnings).toBeUndefined();
        });

        async function writeTaskAc(wbs: string, ac: string): Promise<void> {
            const acFile = join(root(), `${wbs}-ac.md`);
            await createNodeFileSystem(root()).writeFile(acFile, ac);
            await svc.updateSection(wbs, 'Acceptance Criteria', acFile);
        }

        test('a covering task whose rows match no feature scenario warns in parity with task verdict', async () => {
            await seedRecordFeature('Z5', ['Only scenario']);
            const wbs = await createTask(svc);
            await svc.updateField(wbs, 'feature_id', 'Z5');
            await writeTaskAc(wbs, '```gherkin\n  Scenario: Only scenario\n    Given x\n    Then y\n```\n');
            const verdictPath = await writeVerdictRows(wbs, [
                { id: 'R1', status: 'MET' },
                { id: 'R2', status: 'MET' },
            ]);
            const result = await svc.record(wbs, { verdictFile: verdictPath });

            expect(result.scenarioWarnings).toHaveLength(1);
            expect(result.scenarioWarnings?.[0]).toContain('matching no scenario of this feature');
        });

        // 0984: the done gate and `task verdict` scope the no-match check to covering tasks;
        // record warned for task-local tasks too, so a PASS task-local record always nagged.
        test('a task-local task whose rows match no feature scenario stays silent', async () => {
            await seedRecordFeature('Z6', ['Only scenario']);
            const wbs = await createTask(svc);
            await svc.updateField(wbs, 'feature_id', 'Z6');
            await writeTaskAc(wbs, '- [ ] AC1 — a task-local outcome the feature does not name\n');
            const verdictPath = await writeVerdictRows(wbs, [{ id: 'AC1', status: 'MET' }]);
            const result = await svc.record(wbs, { verdictFile: verdictPath });

            expect(result.scenarioWarnings).toBeUndefined();
        });

        // 0993 residual: `AC-<n>` is the feature's scenario ordinal, so one row credits the scenario
        // AND ticks the AC box aliasing that scenario — even when the task numbers its ACs differently.
        test('graduating record: AC-<n> rows tick the aliasing boxes and keep every scenario key', async () => {
            await seedRecordFeature('Z7', ['R1 — First outcome', 'R2 — Second outcome']);
            const wbs = await createTask(svc);
            await svc.updateField(wbs, 'feature_id', 'Z7');
            await writeTaskAc(wbs, '- [ ] AC1 — R2 — Second outcome\n- [ ] AC2 — R1 — First outcome\n');
            const verdictPath = await writeVerdictRows(wbs, [
                { id: 'AC-1', status: 'MET' },
                { id: 'AC-2', status: 'MET' },
            ]);
            const first = await svc.record(wbs, { verdictFile: verdictPath });
            const again = await svc.record(wbs, { verdictFile: verdictPath });

            const raw = await createNodeFileSystem(root()).readFile(`${tasksDir}/${wbs}_record-test-task.md`);
            expect(raw).toContain('- [x] AC1 — R2 — Second outcome');
            expect(raw).toContain('- [x] AC2 — R1 — First outcome');
            expect(first.scenarioWarnings).toBeUndefined();
            expect(again.scenarioWarnings).toBeUndefined();
        });
    });
});

describe('sectionIsBare (existing integration)', () => {
    test('returns true for missing section', () => {
        const doc = MarkdownDocument.parse('', 'task');
        expect(sectionIsBare(doc, 'Solution')).toBe(true);
    });

    test('returns true for empty section', () => {
        const doc = MarkdownDocument.parse('### Solution\n\n', 'task');
        expect(sectionIsBare(doc, 'Solution')).toBe(true);
    });

    test('returns true for pipeline placeholder', () => {
        const doc = MarkdownDocument.parse('### Solution\n\nPipeline run 0042 — placeholder\n', 'task');
        expect(sectionIsBare(doc, 'Solution')).toBe(true);
    });

    test('returns false for populated section', () => {
        const doc = MarkdownDocument.parse('### Solution\n\n| `src/foo.ts:15` |\n', 'task');
        expect(sectionIsBare(doc, 'Solution')).toBe(false);
    });
});

describe('gitDiffU0', () => {
    test('returns empty string when git diff fails (no repo)', () => {
        const result = gitDiffU0('/tmp/nonexistent-git-repo-xyz');
        expect(result).toBe('');
    });
});

describe('flipVerifiedCheckboxes', () => {
    const mkVerdict = (verdict: string, rows: Array<[string, string]>): VerifyVerdict =>
        ({
            wbs: '0001',
            verdict,
            requirements: rows.map(([id, status]) => ({ id, status, evidenceType: '', evidence: 'e' })),
            acceptanceCriteria: [],
            checks: [],
        }) as VerifyVerdict;

    const boxed = (body: string): string =>
        body
            .split('\n')
            .filter((l) => l.trim().startsWith('- [x]'))
            .join('\n');

    test('full PASS flips exactly the boxes the verdict names MET', () => {
        const body = '- [ ] R1. one\n- [ ] R2. two\n- [ ] R3. three\n';
        const out = flipVerifiedCheckboxes(
            body,
            mkVerdict('PASS', [
                ['R1', 'MET'],
                ['R3', 'MET'],
            ]),
        );
        expect(boxed(out)).toBe('- [x] R1. one\n- [x] R3. three');
        expect(out).not.toContain('- [x] R2.');
    });

    test('an AC row keyed by scenario title flips its task AC box', () => {
        // Feature-linked verdicts key AC rows `AC1 — <scenario title>` so feature check credits
        // the scenario; the task box is parsed as bare `AC1` and must still flip.
        const body = '- [ ] AC1 — R4 — one table (req: R1)\n- [ ] AC2 — other\n';
        const verdict = mkVerdict('PASS', []);
        verdict.acceptanceCriteria = [
            { id: 'AC1 — R4 — one table', status: 'MET', evidenceType: 'test', evidence: 'e' },
            { id: 'AC-2', status: 'MET', evidenceType: 'test', evidence: 'e' },
        ] as VerifyVerdict['acceptanceCriteria'];
        expect(boxed(flipVerifiedCheckboxes(body, verdict))).toBe('- [x] AC1 — R4 — one table (req: R1)');
    });

    test('0996: a feature-scenario key proves the AC box that aliases it, not the same-numbered R box', () => {
        // `task verdict` requires feature-linked AC rows keyed by scenario (`R3 — <title>`); the
        // leading R3 is the feature's id, so it must resolve to the aliasing AC1, not task R3.
        const body =
            '- [ ] R3. task requirement three\n- [ ] AC1 — R3 — The loop is a service (req: R1)\n- [ ] AC2 — R4 — Behavior\n';
        const verdict = mkVerdict('PASS', []);
        verdict.acceptanceCriteria = [
            { id: 'R3 — The loop is a service', status: 'MET', evidenceType: 'test', evidence: 'e' },
        ] as VerifyVerdict['acceptanceCriteria'];
        expect(boxed(flipVerifiedCheckboxes(body, verdict))).toBe('- [x] AC1 — R3 — The loop is a service (req: R1)');
    });

    test('0993: AC-<n> resolves through the feature scenario order, never the same-numbered box', () => {
        const body = '- [ ] AC1 — R2 — Second outcome\n- [ ] AC2 — R1 — First outcome\n- [ ] AC3 — task-local\n';
        const verdict = mkVerdict('PASS', []);
        verdict.acceptanceCriteria = [
            { id: 'AC-1', status: 'MET', evidenceType: 'test', evidence: 'e' },
            { id: 'AC-3', status: 'MET', evidenceType: 'test', evidence: 'e' },
        ] as VerifyVerdict['acceptanceCriteria'];
        const titles = ['R1 — First outcome', 'R2 — Second outcome'];
        // AC-1 = "First outcome" → the AC2 box; AC-3 is out of range → proves nothing (not AC3).
        expect(boxed(flipVerifiedCheckboxes(body, verdict, titles))).toBe('- [x] AC2 — R1 — First outcome');
        // Unlinked (no titles): the ordinal alias proves nothing.
        expect(flipVerifiedCheckboxes(body, verdict)).toBe(body);
    });

    test('0996: a title-only scenario key proves its aliasing AC box', () => {
        const body = '- [ ] AC1 — R3 — The loop is a service (req: R1)\n';
        const verdict = mkVerdict('PASS', []);
        verdict.acceptanceCriteria = [
            { id: 'The loop is a service', status: 'MET', evidenceType: 'test', evidence: 'e' },
        ] as VerifyVerdict['acceptanceCriteria'];
        expect(boxed(flipVerifiedCheckboxes(body, verdict))).toBe('- [x] AC1 — R3 — The loop is a service (req: R1)');
    });

    test('0996: a hyphen or en-dash alias separator resolves like an em dash', () => {
        const body = '- [ ] AC1 - R3 – The loop is a service (req: R1)\n';
        const verdict = mkVerdict('PASS', []);
        verdict.acceptanceCriteria = [
            { id: 'R3 — The loop is a service', status: 'MET', evidenceType: 'test', evidence: 'e' },
        ] as VerifyVerdict['acceptanceCriteria'];
        expect(boxed(flipVerifiedCheckboxes(body, verdict))).toBe('- [x] AC1 - R3 – The loop is a service (req: R1)');
    });

    test('0996: a scenario key the task does not alias flips nothing', () => {
        const body = '- [ ] R9. task requirement nine\n- [ ] AC1 — R3 — The loop is a service\n';
        const verdict = mkVerdict('PASS', []);
        verdict.acceptanceCriteria = [
            { id: 'R9 — Some other scenario', status: 'MET', evidenceType: 'test', evidence: 'e' },
        ] as VerifyVerdict['acceptanceCriteria'];
        expect(flipVerifiedCheckboxes(body, verdict)).toBe(body);
    });

    test('0996: bare AC and R keys in the AC table keep their existing flips', () => {
        const body = '- [ ] R1. one\n- [ ] AC1 — first\n- [ ] AC2 — second\n';
        const verdict = mkVerdict('PASS', []);
        verdict.acceptanceCriteria = [
            { id: 'AC1', status: 'MET', evidenceType: 'test', evidence: 'e' },
            { id: 'R1 (context)', status: 'MET', evidenceType: 'test', evidence: 'e' },
        ] as VerifyVerdict['acceptanceCriteria'];
        expect(boxed(flipVerifiedCheckboxes(body, verdict))).toBe('- [x] R1. one\n- [x] AC1 — first');
    });

    test('PARTIAL flips only the proven ids and leaves the rest', () => {
        const body = '- [ ] R1. one\n- [ ] R2. two\n- [ ] R3. three\n';
        const out = flipVerifiedCheckboxes(
            body,
            mkVerdict('PARTIAL', [
                ['R1', 'MET'],
                ['R2', 'UNMET'],
            ]),
        );
        expect(boxed(out)).toBe('- [x] R1. one');
        expect(out).not.toContain('- [x] R2.');
        expect(out).not.toContain('- [x] R3.');
    });

    test('FAIL and UNKNOWN verdicts flip nothing', () => {
        const body = '- [ ] R1. one\n- [ ] R2. two\n';
        expect(flipVerifiedCheckboxes(body, mkVerdict('FAIL', [['R1', 'MET']]))).toBe(body);
        expect(flipVerifiedCheckboxes(body, mkVerdict('UNKNOWN', []))).toBe(body);
    });

    test('unmentioned boxes stay untouched even on PASS', () => {
        const body = '- [ ] R1. one\n- [ ] R2. two\n';
        const out = flipVerifiedCheckboxes(body, mkVerdict('PASS', [['R1', 'MET']]));
        expect(boxed(out)).toBe('- [x] R1. one');
        expect(out).toContain('- [ ] R2. two');
    });

    test('already-checked boxes are not rewritten', () => {
        const body = '- [x] R1. one\n- [ ] R2. two\n';
        const out = flipVerifiedCheckboxes(body, mkVerdict('PASS', [['R1', 'MET']]));
        expect(out).toBe(body);
    });

    test('verdict ids with trailing context still flip the R-prefix box', () => {
        const body = '- [ ] R1. one\n- [ ] R2. two\n';
        const out = flipVerifiedCheckboxes(body, mkVerdict('PASS', [['R1 (anchor-drift detection)', 'MET']]));
        expect(boxed(out)).toBe('- [x] R1. one');
        expect(out).toContain('- [ ] R2. two');
    });
});

describe('flipVerifiedCheckboxes — AC ids and bold emphasis (0700 R1)', () => {
    test('a verdict row keyed AC1 flips the AC1 box', () => {
        const body = '- [ ] AC1. envelope decision recorded\n- [ ] AC2. inventory lands\n';
        const out = flipVerifiedCheckboxes(
            body,
            makeVerdict({
                verdict: 'PASS',
                requirements: [
                    { id: 'AC1', status: 'MET', evidenceType: '', evidence: 'e' },
                    { id: 'AC2', status: 'UNMET', evidenceType: '', evidence: 'e' },
                ],
            }),
        );
        expect(out).toContain('- [x] AC1.');
        expect(out).toContain('- [ ] AC2.');
    });

    test('a bold R row flips when the verdict proves it MET', () => {
        const body = '- [ ] **R1.** first\n- [ ] **R2.** second\n';
        const out = flipVerifiedCheckboxes(
            body,
            makeVerdict({
                verdict: 'PASS',
                requirements: [{ id: 'R2', status: 'MET', evidenceType: '', evidence: 'e' }],
            }),
        );
        expect(out).toContain('- [x] **R2.**');
        expect(out).toContain('- [ ] **R1.**');
    });
});

// ─── 0721 R3: hollow tracked-Testing evidence recomputes to PARTIAL ────

describe('parseTesting — hollow MET rows (0721)', () => {
    const hollowSection = [
        '| Requirement | Status | Evidence |',
        '|-------------|--------|----------|',
        '| R1 | MET |  |',
        '',
        '| Acceptance Criteria | Status | Evidence Type | Evidence |',
        '|---------------------|--------|---------------|----------|',
        '| Scenario: fallback works | MET | test |  |',
    ].join('\n');

    test('rows with empty evidence cells parse, and the recomputed aggregate is PARTIAL', () => {
        const out = parseTesting(hollowSection, '0100');
        expect(out.kind).toBe('valid');
        if (out.kind === 'valid') {
            expect(out.verdict.verdict).toBe('PARTIAL');
            expect(out.verdict.requirements[0]).toEqual({ id: 'R1', status: 'MET', evidenceType: '', evidence: '' });
            expect(out.verdict.acceptanceCriteria?.[0]?.evidence).toBe('');
        }
    });

    test('a stale tracked `Verdict: PASS` line still recomputes to PARTIAL for consumers', () => {
        // parseTesting keeps a present Verdict: line as stored truth, but the
        // feature-completion fallback (feature-check) and the corpus sweep
        // recompute the canonical aggregate over the parsed rows — that recompute
        // must be PARTIAL, never PASS, for hollow MET rows.
        const out = parseTesting(`- Verdict: PASS (from verdict artifact)\n\n${hollowSection}`, '0100');
        expect(out.kind).toBe('valid');
        if (out.kind === 'valid') {
            expect(aggregateVerifyVerdict(out.verdict)).toBe('PARTIAL');
        }
    });
});

// ─── 0980: --no-lifecycle record keeps the gate, creates no lifecycle run ──

describe('record with a suppressed lifecycle FSM (0980)', () => {
    /**
     * Stub gate — the subject here is that record CONSULTS the injected gate at
     * the adapter guard's timing and propagates its denial, not the check rules
     * themselves (covered by task-check tests and the real-gate backstop in
     * apps/cli/tests/commands/task.test.ts).
     */
    function makeCheckGate(pass: boolean, calls: string[] = []): TransitionCheckGate {
        return {
            service: {
                check: async (_filePath: string, wbs: string, options: { asStatus?: string }) => {
                    calls.push(`${wbs}:${options.asStatus ?? ''}`);
                    return {
                        wbs,
                        pass,
                        findings:
                            pass === true
                                ? []
                                : [
                                      {
                                          layer: 'L3',
                                          code: 'L3.test',
                                          severity: 'error',
                                          section: '',
                                          message: 'stub gate denial',
                                      },
                                  ],
                    };
                },
            } as unknown as TaskCheckService,
        };
    }

    function makeRecordingPort(calls: Array<{ from: string; to: string }>): LifecyclePort {
        return {
            requestTransition: (_ref, from, to) => {
                calls.push({ from, to });
                return { allowed: true, from, to };
            },
        };
    }

    /** Pipeline-shaped seam: plain writeService (no adapter) + DB for run-row probes. */
    async function makeDbService(): Promise<{
        svc: TaskService;
        fs: FileSystem;
        root: string;
        db: DbAdapter;
        dir: string;
    }> {
        const root = mkdtempSync(join(tmpdir(), 'spur-record-0980-'));
        const dir = join(root, 'tasks');
        const fs = createNodeFileSystem(root);
        await fs.ensureDir(dir);
        await fs.ensureDir(join(root, '.spur', 'run'));
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(db);
        const svc = new TaskService({
            fs,
            tasksDir: dir,
            writeService: new PlanningWriteService({ fs }),
            getDb: async () => db,
            sectionMatrix: RECORD_SECTION_MATRIX,
        });
        return { svc, fs, root, db, dir };
    }

    async function lifecycleRowCounts(db: DbAdapter): Promise<{ runs: number; links: number }> {
        const runRows = await db.queryAll<{ id: string }>("SELECT id FROM runs WHERE workflow_name = 'task-lifecycle'");
        const linkRows = await db.queryAll<{ run_id: string }>(
            "SELECT run_id FROM task_run_links WHERE kind = 'lifecycle'",
        );
        return { runs: runRows.length, links: linkRows.length };
    }

    test('AC1: pipeline-shaped record reaches testing with zero task-lifecycle rows', async () => {
        const { svc, fs, root, db, dir } = await makeDbService();
        try {
            const created = await svc.create({ title: 'Record 0980 no row', dedupeWithinSec: null });
            const wbs = created.ref.id;
            // Pipeline precheck hop: todo → wip already ran with --no-lifecycle.
            await svc.updateStatus(wbs, 'wip');
            const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
            await fs.writeFile(verdictPath, JSON.stringify(makeVerdict({ wbs })));

            const gateCalls: string[] = [];
            const result = await svc.record(wbs, {
                verdictFile: verdictPath,
                solutionFromDiff: true,
                transition: 'testing',
                checkGate: makeCheckGate(true, gateCalls),
            });

            expect(result.transitionedTo).toBe('testing');
            // The target-aware gate ran once, for the transition target.
            expect(gateCalls).toEqual([`${wbs}:testing`]);
            const raw = await fs.readFile(`${dir}/${basename(created.ref.filePath)}`);
            expect(MarkdownDocument.parse(raw, 'task').frontmatterData?.status).toBe('testing');
            // The defect 0980 fixes: no task-lifecycle run and no lifecycle link.
            expect(await lifecycleRowCounts(db)).toEqual({ runs: 0, links: 0 });
        } finally {
            db.close();
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('AC3: the pipeline done hop leaves no new running lifecycle orphan', async () => {
        const { svc, fs, root, db, dir } = await makeDbService();
        try {
            const created = await svc.create({ title: 'Record 0980 done orphan', dedupeWithinSec: null });
            const wbs = created.ref.id;
            await svc.updateStatus(wbs, 'wip');
            const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
            await fs.writeFile(verdictPath, JSON.stringify(makeVerdict({ wbs })));
            await svc.record(wbs, {
                verdictFile: verdictPath,
                transition: 'testing',
                checkGate: makeCheckGate(true),
            });

            // `task update done --no-lifecycle` seam: updateStatus through the
            // adapter-less port. PASS-verdict gating lives in the CLI layer
            // (transitionTaskGuarded), already covered by its own suite.
            await svc.updateStatus(wbs, 'done');

            const raw = await fs.readFile(`${dir}/${basename(created.ref.filePath)}`);
            expect(MarkdownDocument.parse(raw, 'task').frontmatterData?.status).toBe('done');
            const counts = await lifecycleRowCounts(db);
            expect(counts).toEqual({ runs: 0, links: 0 });
        } finally {
            db.close();
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('a denied gate blocks the record transition and preserves the status', async () => {
        const { svc, fs, root, db, dir } = await makeDbService();
        try {
            const created = await svc.create({ title: 'Record 0980 denied', dedupeWithinSec: null });
            const wbs = created.ref.id;
            await svc.updateStatus(wbs, 'wip');
            const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
            await fs.writeFile(verdictPath, JSON.stringify(makeVerdict({ wbs })));

            await expect(
                svc.record(wbs, {
                    verdictFile: verdictPath,
                    transition: 'testing',
                    checkGate: makeCheckGate(false),
                }),
            ).rejects.toThrow(/Lifecycle transition blocked: `spur task check .* --as testing` failed/);

            // Status write never happened — the gate aborts the transition.
            const raw = await fs.readFile(`${dir}/${basename(created.ref.filePath)}`);
            expect(MarkdownDocument.parse(raw, 'task').frontmatterData?.status).toBe('wip');
            expect(await lifecycleRowCounts(db)).toEqual({ runs: 0, links: 0 });
        } finally {
            db.close();
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('a same-status re-record skips the gate (no status change, no lifecycle request)', async () => {
        // The pipeline's post-downgrade re-record hits an already-testing task;
        // with the adapter attached no requestTransition fires, so the injected
        // gate must not fire either.
        const { svc, fs, root, db } = await makeDbService();
        try {
            const created = await svc.create({ title: 'Record 0980 same-status', dedupeWithinSec: null });
            const wbs = created.ref.id;
            await svc.updateStatus(wbs, 'wip');
            const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
            await fs.writeFile(verdictPath, JSON.stringify(makeVerdict({ wbs })));
            await svc.record(wbs, {
                verdictFile: verdictPath,
                transition: 'testing',
                checkGate: makeCheckGate(true),
            });

            const gateCalls: string[] = [];
            const result = await svc.record(wbs, {
                verdictFile: verdictPath,
                transition: 'testing',
                checkGate: makeCheckGate(false, gateCalls),
            });
            expect(result.transitionedTo).toBe('testing');
            expect(gateCalls).toEqual([]);
        } finally {
            db.close();
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('AC2: standalone record (no checkGate) still routes the transition through the lifecycle port', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-record-0980-standalone-'));
        const dir = join(root, 'tasks');
        const fs = createNodeFileSystem(root);
        await fs.ensureDir(dir);
        await fs.ensureDir(join(root, '.spur', 'run'));
        const portCalls: Array<{ from: string; to: string }> = [];
        const svc = new TaskService({
            fs,
            tasksDir: dir,
            // Standalone default: the adapter-backed port (real adapter covered by
            // lifecycle-adapter.test.ts create-or-attach) — here recorded via a stub.
            writeService: new PlanningWriteService({ fs, lifecycle: makeRecordingPort(portCalls) }),
            sectionMatrix: RECORD_SECTION_MATRIX,
        });
        try {
            const created = await svc.create({ title: 'Record 0980 standalone', dedupeWithinSec: null });
            const wbs = created.ref.id;
            await svc.updateStatus(wbs, 'wip');
            const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
            await fs.writeFile(verdictPath, JSON.stringify(makeVerdict({ wbs })));

            const result = await svc.record(wbs, { verdictFile: verdictPath, transition: 'testing' });

            expect(result.transitionedTo).toBe('testing');
            expect(portCalls).toContainEqual({ from: 'wip', to: 'testing' });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('1040 — record re-pulls verdict state and reconciles close metadata', () => {
    /** SQLite-backed service for transition/reconciliation probes (0980 pattern). */
    async function makeSvc(): Promise<{
        svc: TaskService;
        fs: FileSystem;
        root: string;
        db: DbAdapter;
        dir: string;
    }> {
        const root = mkdtempSync(join(tmpdir(), 'spur-record-1040-'));
        const dir = join(root, 'tasks');
        const fs = createNodeFileSystem(root);
        await fs.ensureDir(dir);
        await fs.ensureDir(join(root, '.spur', 'run'));
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(db);
        const svc = new TaskService({
            fs,
            tasksDir: dir,
            writeService: new PlanningWriteService({ fs }),
            getDb: async () => db,
            sectionMatrix: RECORD_SECTION_MATRIX,
        });
        return { svc, fs, root, db, dir };
    }

    /** Author a section directly through the write service (simulates a human edit). */
    async function writeServiceUpdate(fs: FileSystem, filePath: string, section: string, body: string): Promise<void> {
        const writeService = new PlanningWriteService({ fs });
        await writeService.updateSection({ kind: 'task', id: 'author', filePath, folder: '.' }, section, body);
    }

    /** Parse the current task file and return one section body. */
    async function bodyOf(fs: FileSystem, path: string, section: string): Promise<string | null> {
        return MarkdownDocument.parse(await fs.readFile(path), 'task').getSection(section);
    }

    test('(a) missing artifact + bare Testing → missing state with remedy, Testing stub written', async () => {
        const { svc, root, db } = await makeSvc();
        try {
            const created = await svc.create({ title: 'Record 1040a', dedupeWithinSec: null });
            const wbs = created.ref.id;
            await svc.updateStatus(wbs, 'wip');
            const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);

            const result = await svc.record(wbs, { verdictFile: verdictPath });

            expect(result.verdictState).toBe('missing');
            expect(result.verdictMessage).toContain(verdictPath);
            expect(result.verdictMessage).toContain('spur task verify');
            expect(result.testingWritten).toBe(true);
        } finally {
            db.close();
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('(b) malformed artifact + authored Testing → malformed state, Testing preserved', async () => {
        const { svc, fs, root, db } = await makeSvc();
        try {
            const created = await svc.create({ title: 'Record 1040b', dedupeWithinSec: null });
            const wbs = created.ref.id;
            await svc.updateStatus(wbs, 'wip');
            const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
            await svc.record(wbs, { verdictFile: verdictPath }); // stub authored
            await writeServiceUpdate(
                fs,
                created.ref.filePath,
                'Testing',
                '| Requirement | Status |\n| --- | --- |\n| R1 | hand-authored |\n',
            );
            await fs.writeFile(verdictPath, '{not json');

            const result = await svc.record(wbs, { verdictFile: verdictPath });

            expect(result.verdictState).toBe('malformed');
            expect(result.verdictMessage).toContain(verdictPath);
            expect(result.testingWritten).toBe(false);
            const testing = await bodyOf(fs, created.ref.filePath, 'Testing');
            expect(testing).toContain('hand-authored');
        } finally {
            db.close();
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('(c) foreign explicit WBS → missing state, mismatch message, zero checkbox flips, Testing preserved', async () => {
        const { svc, fs, root, db } = await makeSvc();
        try {
            const created = await svc.create({ title: 'Record 1040c', dedupeWithinSec: null });
            const wbs = created.ref.id;
            await svc.updateStatus(wbs, 'wip');
            const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
            // Authored Requirements with unchecked R1 + authored Testing.
            await writeServiceUpdate(
                fs,
                created.ref.filePath,
                'Requirements',
                '- [ ] R1 — First requirement (demonstrates foreign-WBS guard)\n',
            );
            await svc.record(wbs, { verdictFile: verdictPath }); // authored Testing stub
            await writeServiceUpdate(
                fs,
                created.ref.filePath,
                'Testing',
                '| Requirement | Status |\n| --- | --- |\n| R1 | authored |\n',
            );
            await fs.writeFile(
                verdictPath,
                JSON.stringify({
                    wbs: '9999',
                    verdict: 'PASS',
                    requirements: [{ id: 'R1', status: 'MET', evidence: 'foreign proof' }],
                    checks: [],
                }),
            );

            const result = await svc.record(wbs, { verdictFile: verdictPath });

            // Frozen mapping: unusable foreign evidence reports as missing + mismatch message.
            expect(result.verdictState).toBe('missing');
            expect(result.verdictMessage).toContain(`expected wbs '${wbs}'`);
            expect(result.verdictMessage).toContain('actual "9999"');
            expect(result.verdictMessage).toContain(verdictPath);
            expect(result.testingWritten).toBe(false);
            const raw = await fs.readFile(created.ref.filePath);
            const doc = MarkdownDocument.parse(raw, 'task');
            const testing = doc.getSection('Testing') ?? '';
            expect(testing).toContain('authored');
            const reqs = doc.getSection('Requirements') ?? '';
            expect(reqs).toContain('- [ ] R1');
            expect(reqs).not.toContain('[x]');
        } finally {
            db.close();
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('(d) matching readable PASS → readable state, no message, boxes flip', async () => {
        const { svc, fs, root, db } = await makeSvc();
        try {
            const created = await svc.create({ title: 'Record 1040d', dedupeWithinSec: null });
            const wbs = created.ref.id;
            await svc.updateStatus(wbs, 'wip');
            const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
            await writeServiceUpdate(
                fs,
                created.ref.filePath,
                'Requirements',
                '- [ ] R1 — First requirement (proves readable PASS flips)\n',
            );
            await fs.writeFile(
                verdictPath,
                JSON.stringify({
                    wbs,
                    verdict: 'PASS',
                    requirements: [{ id: 'R1', status: 'MET', evidence: 'test passes' }],
                    checks: [],
                }),
            );

            const result = await svc.record(wbs, { verdictFile: verdictPath });

            expect(result.verdictState).toBe('readable');
            expect(result.verdictMessage).toBeUndefined();
            const reqs = await bodyOf(fs, created.ref.filePath, 'Requirements');
            expect(reqs).toContain('- [x] R1');
        } finally {
            db.close();
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('(e) omitted-WBS PASS artifact keeps fallback compatibility → readable', async () => {
        const { svc, fs, root, db } = await makeSvc();
        try {
            const created = await svc.create({ title: 'Record 1040e', dedupeWithinSec: null });
            const wbs = created.ref.id;
            await svc.updateStatus(wbs, 'wip');
            const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
            await fs.writeFile(verdictPath, JSON.stringify({ verdict: 'PASS', requirements: [], checks: [] }));

            const result = await svc.record(wbs, { verdictFile: verdictPath });

            expect(result.verdictState).toBe('readable');
            expect(result.verdictMessage).toBeUndefined();
            expect(result.testingWritten).toBe(true);
        } finally {
            db.close();
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('(f) identical re-record skips Testing and Review rewrites', async () => {
        const { svc, fs, root, db } = await makeSvc();
        try {
            const created = await svc.create({ title: 'Record 1040f', dedupeWithinSec: null });
            const wbs = created.ref.id;
            await svc.updateStatus(wbs, 'wip');
            const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
            await fs.writeFile(
                verdictPath,
                JSON.stringify({
                    wbs,
                    verdict: 'PASS',
                    requirements: [{ id: 'R1', status: 'MET', evidence: 'e' }],
                    checks: [],
                }),
            );

            const first = await svc.record(wbs, { verdictFile: verdictPath });
            expect(first.testingWritten).toBe(true);
            const second = await svc.record(wbs, { verdictFile: verdictPath });
            expect(second.testingWritten).toBe(false);
            expect(second.reviewWritten).toBe(false);
            expect(second.verdictState).toBe('readable');
        } finally {
            db.close();
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('(g) unforced done re-close clears stale forced metadata and names the PASS artifact', async () => {
        const { svc, fs, root, db } = await makeSvc();
        try {
            const created = await svc.create({ title: 'Record 1040g', dedupeWithinSec: null });
            const wbs = created.ref.id;
            await svc.updateStatus(wbs, 'wip');
            const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
            await fs.writeFile(
                verdictPath,
                JSON.stringify({
                    wbs,
                    verdict: 'PASS',
                    requirements: [{ id: 'R1', status: 'MET', evidence: 'e' }],
                    checks: [],
                }),
            );
            // Stale forced-close metadata from an earlier operator override.
            await svc.updateField(wbs, 'done_forced', 'true');
            await svc.updateField(wbs, 'done_reason', 'old forced PARTIAL close');

            const result = await svc.record(wbs, { verdictFile: verdictPath, transition: 'done' });

            expect(result.transitionedTo).toBe('done');
            const raw = await fs.readFile(created.ref.filePath);
            const doc = MarkdownDocument.parse(raw, 'task');
            expect(String(doc.frontmatterData?.done_forced)).toBe('false');
            expect(String(doc.frontmatterData?.done_reason)).toContain('unforced close');
            expect(String(doc.frontmatterData?.done_reason)).toContain(`${wbs}-verdict.json`);
        } finally {
            db.close();
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('(h) failed done hop throws and writes no new close metadata', async () => {
        const { svc, fs, root, db } = await makeSvc();
        try {
            const created = await svc.create({ title: 'Record 1040h', dedupeWithinSec: null });
            const wbs = created.ref.id;
            await svc.updateStatus(wbs, 'wip');
            const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
            await fs.writeFile(
                verdictPath,
                JSON.stringify({
                    wbs,
                    verdict: 'PASS',
                    requirements: [{ id: 'R1', status: 'MET', evidence: 'e' }],
                    checks: [],
                }),
            );
            await svc.updateField(wbs, 'done_forced', 'true');
            await svc.updateField(wbs, 'done_reason', 'old forced close');
            const denied = new PlanningWriteService({
                fs,
                lifecycle: {
                    requestTransition(_ref, from, to) {
                        return to === 'done'
                            ? { allowed: false, from, to, report: 'simulated done denial' }
                            : { allowed: true, from, to };
                    },
                },
            });
            const svcDenied = new TaskService({
                fs,
                tasksDir: join(root, 'tasks'),
                writeService: denied,
                getDb: async () => db,
                sectionMatrix: RECORD_SECTION_MATRIX,
            });

            await expect(
                svcDenied.record(wbs, { verdictFile: verdictPath, transition: 'done' }),
            ).rejects.toBeInstanceOf(GuardDeniedError);

            const doc = MarkdownDocument.parse(await fs.readFile(created.ref.filePath), 'task');
            expect(String(doc.frontmatterData?.done_forced)).toBe('true');
            expect(String(doc.frontmatterData?.done_reason)).toBe('old forced close');
        } finally {
            db.close();
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('(i) no-op re-record at done leaves close metadata byte-unchanged', async () => {
        const { svc, fs, root, db } = await makeSvc();
        try {
            const created = await svc.create({ title: 'Record 1040i', dedupeWithinSec: null });
            const wbs = created.ref.id;
            await svc.updateStatus(wbs, 'wip');
            const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
            await fs.writeFile(verdictPath, JSON.stringify({ wbs, verdict: 'PASS', requirements: [], checks: [] }));
            await svc.record(wbs, { verdictFile: verdictPath, transition: 'done' });
            const before = MarkdownDocument.parse(await fs.readFile(created.ref.filePath), 'task');
            const reasonBefore = String(before.frontmatterData?.done_reason);

            await svc.record(wbs, { verdictFile: verdictPath, transition: 'done' });

            const after = MarkdownDocument.parse(await fs.readFile(created.ref.filePath), 'task');
            expect(String(after.frontmatterData?.done_reason)).toBe(reasonBefore);
        } finally {
            db.close();
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('(j) done close-audit write failure surfaces via result.closeAuditError, not thrown', async () => {
        const { svc, fs, root, db } = await makeSvc();
        try {
            const created = await svc.create({ title: 'Record 1040j', dedupeWithinSec: null });
            const wbs = created.ref.id;
            await svc.updateStatus(wbs, 'wip');
            const verdictPath = join(root, '.spur', 'run', `${wbs}-verdict.json`);
            await fs.writeFile(verdictPath, JSON.stringify({ wbs, verdict: 'PASS', requirements: [], checks: [] }));

            // Make the audit field writes fail after the status write commits.
            const realUpdateField = svc.updateField.bind(svc);
            svc.updateField = async (target: string, field: string, value: string) => {
                if (field === 'done_forced' || field === 'done_reason') {
                    throw new Error('audit write failed');
                }
                return realUpdateField(target, field, value);
            };

            const result = await svc.record(wbs, { verdictFile: verdictPath, transition: 'done' });

            expect(result.transitionedTo).toBe('done');
            expect(result.closeAuditError).toContain('audit write failed');
        } finally {
            db.close();
            rmSync(root, { recursive: true, force: true });
        }
    });
});
