import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { classifyFallback, printSweepResult, runCorpusSweep, type SweepBucket } from '../../src/services/corpus-sweep';
import type { ParseVerdictOutcome, VerdictRowStatus } from '../../src/services/verify-verdict';

function valid(rows: Array<{ id: string; status: VerdictRowStatus }>, verdict: string): ParseVerdictOutcome {
    return {
        kind: 'valid',
        wbs: '0001',
        verdict: {
            wbs: '0001',
            verdict: verdict as 'PASS' | 'PARTIAL' | 'FAIL' | 'UNKNOWN',
            requirements: rows.map((r) => ({ id: r.id, status: r.status, evidenceType: '', evidence: '' })),
            acceptanceCriteria: [],
            checks: [],
        },
    };
}

function expectBucket(parsed: ParseVerdictOutcome, bucket: SweepBucket, verdict?: string, hasMet?: boolean): void {
    const out = classifyFallback(parsed);
    expect(out.bucket).toBe(bucket);
    if (verdict !== undefined) expect(out.verdict).toBe(verdict);
    if (hasMet !== undefined) expect(out.hasMet).toBe(hasMet);
}

describe('classifyFallback — task-level durable-evidence buckets (0673 R1)', () => {
    test('valid PASS with a MET row → verified', () => {
        expectBucket(
            valid(
                [
                    { id: 'R1', status: 'MET' },
                    { id: 'R2', status: 'MET' },
                ],
                'PASS',
            ),
            'verified',
            'PASS',
            true,
        );
    });

    test('valid PASS with no MET row → recovered-not-pass (cannot verify a scenario)', () => {
        expectBucket(valid([{ id: 'R1', status: 'PARTIAL' }], 'PASS'), 'recovered-not-pass', 'PASS', false);
    });

    test('stored PASS but computed aggregate is not PASS → recovered-not-pass (aggregate gate)', () => {
        // Verdict: line says PASS but a row is UNMET — the computed aggregate is FAIL.
        expectBucket(valid([{ id: 'R1', status: 'UNMET' }], 'PASS'), 'recovered-not-pass', 'PASS', false);
    });

    test('valid FAIL rows → recovered-not-pass', () => {
        expectBucket(valid([{ id: 'R1', status: 'UNMET' }], 'FAIL'), 'recovered-not-pass', 'FAIL', false);
    });

    test('missing section → evidence-not-recoverable', () => {
        expectBucket({ kind: 'missing', wbs: '0001' }, 'evidence-not-recoverable');
    });

    test('malformed table → evidence-not-recoverable', () => {
        expectBucket(
            { kind: 'malformed', wbs: '0001', message: 'requirement table is truncated or malformed' },
            'evidence-not-recoverable',
        );
    });

    test('invalid (no recognisable rows) → evidence-not-recoverable', () => {
        expectBucket(
            { kind: 'invalid', wbs: '0001', reason: 'no recognisable coverage rows' },
            'evidence-not-recoverable',
        );
    });
});

function taskFile(wbs: string, status: string, testingBody: string): string {
    return [
        '---',
        'schema_version: 1',
        `id: "${wbs}"`,
        `name: "task ${wbs}"`,
        `status: ${status}`,
        '---',
        '',
        '## Background',
        '',
        'x',
        '',
        '### Testing',
        testingBody,
        '',
    ].join('\n');
}

const PASS_TESTING = `
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | evidence |

- Coverage: N/A
`;

const FAIL_TESTING = `
**Pipeline verify results**

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | UNMET | x |
`;

describe('runCorpusSweep — measured durable-evidence sweep (0673 R1/R2)', () => {
    let dir: string;
    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'corpus-sweep-'));
        mkdirSync(join(dir, 'docs/tasks'), { recursive: true });
        mkdirSync(join(dir, '.spur/run'), { recursive: true });
        // 0001: done, no artifact, PASS+MET Testing → verified
        writeFileSync(join(dir, 'docs/tasks/0001_done-verified.md'), taskFile('0001', 'done', PASS_TESTING));
        // 0002: done, no artifact, no recoverable Testing → evidence-not-recoverable
        writeFileSync(join(dir, 'docs/tasks/0002_done-noev.md'), taskFile('0002', 'done', '\nunstructured prose\n'));
        // 0003: done, HAS artifact → withArtifact (excluded from outcomes)
        writeFileSync(join(dir, 'docs/tasks/0003_done-artifact.md'), taskFile('0003', 'done', PASS_TESTING));
        writeFileSync(join(dir, '.spur/run/0003-verdict.json'), JSON.stringify({ wbs: '0003', verdict: 'PASS' }));
        // 0004: todo → not part of the done sweep
        writeFileSync(join(dir, 'docs/tasks/0004_todo.md'), taskFile('0004', 'todo', PASS_TESTING));
        // 0005: done, no artifact, UNMET rows → recovered-not-pass
        writeFileSync(join(dir, 'docs/tasks/0005_done-fail.md'), taskFile('0005', 'done', FAIL_TESTING));
        // non-task file must be ignored
        writeFileSync(join(dir, 'docs/tasks/README.md'), '# not a task');
    });
    afterAll(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    test('classifies the corpus into the three buckets and counts artifact presence', async () => {
        const r = await runCorpusSweep(createNodeFileSystem(dir));
        expect(r.doneTasks).toBe(4); // 0001, 0002, 0003, 0005
        expect(r.withArtifact).toBe(1); // 0003
        expect(r.withoutArtifact).toBe(3); // 0001, 0002, 0005
        expect(r.verified).toBe(1); // 0001
        expect(r.recoveredNotPass).toBe(1); // 0005
        expect(r.evidenceNotRecoverable).toBe(1); // 0002
        const byWbs = new Map(r.outcomes.map((o) => [o.wbs, o.bucket]));
        expect(byWbs.get('0001')).toBe('verified');
        expect(byWbs.get('0002')).toBe('evidence-not-recoverable');
        expect(byWbs.get('0005')).toBe('recovered-not-pass');
        expect(r.outcomes.map((o) => o.wbs)).toEqual(['0001', '0002', '0005']); // sorted
    });

    test('re-running on the unchanged tree yields identical results (R2 reproducibility)', async () => {
        const a = await runCorpusSweep(createNodeFileSystem(dir));
        const b = await runCorpusSweep(createNodeFileSystem(dir));
        expect(a).toEqual(b);
    });

    test('fails instead of reporting incomplete counts when a configured task folder is unreadable', async () => {
        const missingCorpus = mkdtempSync(join(tmpdir(), 'corpus-sweep-missing-'));
        try {
            await expect(runCorpusSweep(createNodeFileSystem(missingCorpus))).rejects.toThrow();
        } finally {
            rmSync(missingCorpus, { recursive: true, force: true });
        }
    });
});

describe('printSweepResult — output seam renders both forms (0673 R1/R6)', () => {
    test('renders json and human forms without throwing', () => {
        const minimal = {
            doneTasks: 0,
            withArtifact: 0,
            withoutArtifact: 0,
            verified: 0,
            recoveredNotPass: 0,
            evidenceNotRecoverable: 0,
            outcomes: [],
        };
        expect(() => printSweepResult(minimal, true)).not.toThrow();
        expect(() => printSweepResult(minimal, false)).not.toThrow();
    });
});
