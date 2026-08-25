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
import { join } from 'node:path';
import { applyCliMigrations, MarkdownDocument, TaskRunLinkDao } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { GuardDeniedError } from '../../src/errors';
import type { SectionMatrix } from '../../src/services/planning-check-base';
import { PlanningWriteService } from '../../src/services/planning-write-service';
import {
    escapeTablePipe,
    gitDiffU0,
    parseTesting,
    parseVerdict,
    renderReview,
    renderSolutionFromDiff,
    renderTesting,
} from '../../src/services/task-record';
import { sectionIsBare, TaskService } from '../../src/services/task-service';
import type { VerifyVerdict } from '../../src/services/verify-verdict';

// ─── Helpers ────────────────────────────────────────────────────────────

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

    test('does not escape already-escaped pipes', () => {
        // Only unescaped `|` should get a backslash prefix.
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
                checks: [{ name: 'Security', status: 'P1', evidence: 'xss' }],
            }),
        );
        expect(v.checks).toHaveLength(1);
        expect(v.checks[0]?.name).toBe('Security');
    });

    test('filters non-object requirements', () => {
        const v = parseVerdict(
            JSON.stringify({
                requirements: [{ id: 'R1', status: 'ok', evidence: 'y' }, 'bad', null, 42],
            }),
        );
        expect(v.requirements).toHaveLength(1);
        expect(v.requirements[0]?.id).toBe('R1');
    });

    test('parses acceptanceCriteria array', () => {
        const v = parseVerdict(
            JSON.stringify({
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
        const corpus = [
            '| Requirement | Status | Evidence |',
            '|-------------|--------|----------|',
            '| R1 |',
            '',
        ].join('\n');
        expect(parseTesting(corpus, '0100').kind).toBe('malformed');
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
        expect(out).toContain('| P4 | — | — | No P1–P3 findings');
        expect(out).not.toContain('| P1 |');
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

    test('maps pass/fail status to P4/P1 when status is not already P1-P4', () => {
        const v = makeVerdict({
            checks: [
                { name: 'spur task check', status: 'pass', evidence: 'task check passed' },
                { name: 'coverage gate', status: 'fail', evidence: 'coverage below threshold' },
            ],
        });
        const out = renderReview(v);
        expect(out).toContain('| P4 | spur task check | — | task check passed |');
        expect(out).toContain('| P1 | coverage gate | — | coverage below threshold |');
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
    const RECORD_SECTION_MATRIX: SectionMatrix = {
        variants: {
            standard: {
                backlog: {
                    required: ['Background'],
                    optional: [
                        'Requirements',
                        'Acceptance Criteria',
                        'Design',
                        'Plan',
                        'Solution',
                        'Testing',
                        'Review',
                    ],
                },
                todo: { required: ['Background', 'Acceptance Criteria', 'Design', 'Plan'] },
                wip: { required: ['Background', 'Acceptance Criteria', 'Design', 'Plan'] },
                testing: { required: ['Solution', 'Testing'] },
                done: { required: ['Solution', 'Testing', 'Review'], gate: true },
            },
        },
    };

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
                requirements: [{ id: 'R1', status: 'PASS', evidence: 'all good' }],
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
        expect(raw).toContain('| R1 | PASS | all good |');
        expect(raw).toContain('### Review');
        expect(raw).toContain('| Priority | Dimension | Location | Finding |');
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
        expect(raw).toContain('No P1–P3 findings');
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
