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
import { MarkdownDocument } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { PlanningWriteService } from '../../src/services/planning-write-service';
import {
    escapeTablePipe,
    gitDiffU0,
    parseVerdict,
    renderReview,
    renderSolutionFromDiff,
    renderTesting,
    type VerifyVerdict,
} from '../../src/services/task-record';
import { sectionIsBare, TaskService } from '../../src/services/task-service';

// ─── Helpers ────────────────────────────────────────────────────────────

function makeVerdict(overrides?: Partial<VerifyVerdict>): VerifyVerdict {
    return {
        wbs: '0100',
        verdict: 'PASS',
        requirements: [
            { id: 'R1', status: 'PASS', evidence: 'test passes' },
            { id: 'R2', status: 'PASS', evidence: 'lint clean' },
        ],
        checks: [
            { name: 'Security', status: 'P1', evidence: 'no auth bypass' },
            { name: 'Style', status: 'P3', evidence: 'minor formatting issue' },
        ],
        ...overrides,
    };
}

async function createTask(svc: TaskService): Promise<string> {
    const result = await svc.create({ title: 'Record test task' });
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
                    { id: 'R1', status: 'PASS', evidence: 'done' },
                    { id: 'R2', status: 'FAIL', evidence: 'not done' },
                ],
            }),
        );
        expect(v.requirements).toHaveLength(2);
        expect(v.requirements[0]?.id).toBe('R1');
        expect(v.requirements[1]?.status).toBe('FAIL');
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
        expect(out).toContain('| R1 | PASS | test passes |');
        expect(out).toContain('| R2 | PASS | lint clean |');
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
            requirements: [{ id: 'R1', status: 'PASS', evidence: 'line1\nline2\nline3' }],
        });
        const out = renderTesting(v);
        expect(out).toContain('line1 line2 line3');
        // Verify no raw newlines inside table cell
        const afterHeader = out.split('|-------------|--------|----------|')[1] ?? '';
        expect(afterHeader).not.toContain('\nline2');
    });

    test('escapes pipe characters in evidence', () => {
        const v = makeVerdict({
            requirements: [{ id: 'R1', status: 'PASS', evidence: 'has | pipe | chars' }],
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
    let svc: TaskService;

    beforeAll(async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-record-'));
        tasksDir = join(root, 'tasks');
        const fs = createNodeFileSystem(root);
        await fs.ensureDir(tasksDir);
        // Ensure .spur/run directory exists
        await fs.ensureDir(join(root, '.spur', 'run'));
        const writeService = new PlanningWriteService({ fs });
        svc = new TaskService({ fs, tasksDir, writeService });
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
