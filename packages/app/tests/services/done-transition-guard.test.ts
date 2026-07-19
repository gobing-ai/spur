import { describe, expect, test } from 'bun:test';
import {
    computeAggregate,
    evaluateDoneTransition,
    formatDenialMessage,
    formatNoopMessage,
    type GuardInput,
    type VerdictArtifact,
    type VerdictRowStatus,
} from '../../src/services/done-transition-guard';
import { deriveVerdict } from '../../src/services/task-verdict';

// ─── Fixtures ──────────────────────────────────────────────────────────

const passArtifact: VerdictArtifact = {
    wbs: '0299',
    verdict: 'PASS',
    requirements: [
        { id: 'R1', status: 'MET', evidence: 'a' },
        { id: 'R2', status: 'MET', evidence: 'b' },
    ],
    acceptanceCriteria: [],
    source: 'spur task verdict',
};

const partialArtifact: VerdictArtifact = {
    wbs: '0299',
    verdict: 'PARTIAL',
    requirements: [
        { id: 'R1', status: 'MET', evidence: 'a' },
        { id: 'R2', status: 'PARTIAL', evidence: 'b' },
    ],
    acceptanceCriteria: [],
    source: 'spur task verdict',
};

const failArtifact: VerdictArtifact = {
    wbs: '0299',
    verdict: 'FAIL',
    requirements: [
        { id: 'R1', status: 'MET', evidence: 'a' },
        { id: 'R2', status: 'UNMET', evidence: 'b' },
    ],
    acceptanceCriteria: [],
    source: 'spur task verdict',
};

/** Aggregate claims PASS but a row is UNMET — the softening bug R10 guards. */
const inconsistentArtifact: VerdictArtifact = {
    wbs: '0299',
    verdict: 'PASS',
    requirements: [
        { id: 'R1', status: 'MET', evidence: 'a' },
        { id: 'R2', status: 'UNMET', evidence: 'b' },
    ],
    acceptanceCriteria: [],
    source: 'spur task verdict',
};

const TASK_PATH = 'docs/tasks2/0299_some-task.md';

function baseInput(overrides: Partial<GuardInput> = {}): GuardInput {
    return {
        wbs: '0299',
        taskFilePath: TASK_PATH,
        currentStatus: 'testing',
        targetStatus: 'done',
        forced: false,
        ...overrides,
    };
}

// ─── evaluateDoneTransition ────────────────────────────────────────────

describe('evaluateDoneTransition', () => {
    test('R4a: PASS verdict → allow', () => {
        const out = evaluateDoneTransition(baseInput({ artifact: passArtifact }));
        expect(out.kind).toBe('allow');
        if (out.kind === 'allow') {
            expect(out.reason).toBe('pass');
        }
    });

    test('R4b: PARTIAL verdict → deny', () => {
        const out = evaluateDoneTransition(baseInput({ artifact: partialArtifact }));
        expect(out.kind).toBe('deny');
        if (out.kind === 'deny') {
            expect(out.verdict).toBe('PARTIAL');
            expect(out.message).toContain('0299');
            expect(out.message).toContain('PARTIAL');
            expect(out.message).toContain('.spur/run/0299-verdict.json');
            expect(out.message).toContain('--force-done');
        }
    });

    test('R4c: FAIL verdict → deny', () => {
        const out = evaluateDoneTransition(baseInput({ artifact: failArtifact }));
        expect(out.kind).toBe('deny');
        if (out.kind === 'deny') {
            expect(out.verdict).toBe('FAIL');
        }
    });

    test('R4d: no verdict file → allow (back-compat)', () => {
        const out = evaluateDoneTransition(baseInput({ artifact: undefined }));
        expect(out.kind).toBe('allow');
        if (out.kind === 'allow') {
            expect(out.reason).toBe('no-artifact');
        }
    });

    test('R4e: --force-done with PARTIAL → allow (forced)', () => {
        const out = evaluateDoneTransition(
            baseInput({ artifact: partialArtifact, forced: true, reason: 'telemetry absent is acceptable' }),
        );
        expect(out.kind).toBe('allow');
        if (out.kind === 'allow') {
            expect(out.reason).toBe('forced');
        }
    });

    test('R4e variant: --force-done also overrides FAIL', () => {
        const out = evaluateDoneTransition(baseInput({ artifact: failArtifact, forced: true }));
        expect(out.kind).toBe('allow');
        if (out.kind === 'allow') {
            expect(out.reason).toBe('forced');
        }
    });

    test('R4g: inconsistent artifact (rows imply FAIL, aggregate claims PASS) → deny with inconsistency named', () => {
        const out = evaluateDoneTransition(baseInput({ artifact: inconsistentArtifact }));
        expect(out.kind).toBe('deny');
        if (out.kind === 'deny') {
            // Harsher of stored PASS / computed FAIL is FAIL.
            expect(out.verdict).toBe('FAIL');
            expect(out.message).toContain('self-inconsistent');
            expect(out.message).toContain('PASS');
            expect(out.message).toContain('FAIL');
        }
    });

    test('R9: same-status no-op short-circuits before verdict read', () => {
        // Same status with a FAIL artifact on disk — without the no-op short-circuit this
        // would deny. R9 mandates the no-op win regardless of verdict state.
        const out = evaluateDoneTransition(
            baseInput({ currentStatus: 'done', targetStatus: 'done', artifact: failArtifact }),
        );
        expect(out.kind).toBe('noop');
        if (out.kind === 'noop') {
            expect(out.fromStatus).toBe('done');
            expect(out.message).toContain('already done');
        }
    });

    test('R3: --force-done without a reason is still allowed (reason is advisory)', () => {
        const out = evaluateDoneTransition(baseInput({ artifact: partialArtifact, forced: true }));
        expect(out.kind).toBe('allow');
        if (out.kind === 'allow') {
            expect(out.reason).toBe('forced');
        }
    });

    test('R10 variant: rows imply PARTIAL, aggregate claims PASS → deny PARTIAL with inconsistency named', () => {
        const softening: VerdictArtifact = {
            wbs: '0299',
            verdict: 'PASS',
            requirements: [
                { id: 'R1', status: 'MET', evidence: 'a' },
                { id: 'R2', status: 'PARTIAL', evidence: 'b' },
            ],
            acceptanceCriteria: [],
            source: 'spur task verdict',
        };
        const out = evaluateDoneTransition(baseInput({ artifact: softening }));
        expect(out.kind).toBe('deny');
        if (out.kind === 'deny') {
            expect(out.verdict).toBe('PARTIAL');
            expect(out.message).toContain('self-inconsistent');
        }
    });

    test('R10 invariant: consistency check does not soften a stored non-PASS verdict', () => {
        // Stored FAIL, rows all MET — the harsher rule keeps it FAIL (never silently upgrade).
        const artifact: VerdictArtifact = {
            wbs: '0299',
            verdict: 'FAIL',
            requirements: [
                { id: 'R1', status: 'MET', evidence: 'a' },
                { id: 'R2', status: 'MET', evidence: 'b' },
            ],
            acceptanceCriteria: [],
            source: 'spur task verdict',
        };
        const out = evaluateDoneTransition(baseInput({ artifact }));
        expect(out.kind).toBe('deny');
        if (out.kind === 'deny') {
            expect(out.verdict).toBe('FAIL');
        }
    });

    test('AC UNMET triggers FAIL via computeAggregate path', () => {
        const artifact: VerdictArtifact = {
            wbs: '0299',
            verdict: 'PASS',
            requirements: [{ id: 'R1', status: 'MET', evidence: 'a' }],
            acceptanceCriteria: [{ id: 'Scenario: behavior', status: 'UNMET', evidenceType: 'test', evidence: 'none' }],
            source: 'spur task verdict',
        };
        const out = evaluateDoneTransition(baseInput({ artifact }));
        expect(out.kind).toBe('deny');
        if (out.kind === 'deny') {
            expect(out.verdict).toBe('FAIL');
        }
    });
});

// ─── computeAggregate ──────────────────────────────────────────────────

describe('computeAggregate', () => {
    test('PASS when every row is MET', () => {
        expect(computeAggregate(passArtifact)).toBe('PASS');
    });

    test('FAIL when any requirement is UNMET', () => {
        expect(computeAggregate(failArtifact)).toBe('FAIL');
    });

    test('PARTIAL when no UNMET but a PARTIAL exists', () => {
        expect(computeAggregate(partialArtifact)).toBe('PARTIAL');
    });

    test('PARTIAL when an AC is PARTIAL (no UNMET anywhere)', () => {
        const artifact: VerdictArtifact = {
            wbs: '0299',
            verdict: 'PASS',
            requirements: [{ id: 'R1', status: 'MET', evidence: 'a' }],
            acceptanceCriteria: [{ id: 'Scenario: x', status: 'PARTIAL', evidenceType: 'test', evidence: 'partial' }],
            source: 'spur task verdict',
        };
        expect(computeAggregate(artifact)).toBe('PARTIAL');
    });

    test('no requirements and no ACs → PASS (vacuously)', () => {
        const artifact: VerdictArtifact = {
            wbs: '0299',
            verdict: 'PASS',
            requirements: [],
            acceptanceCriteria: [],
            source: 'spur task verdict',
        };
        expect(computeAggregate(artifact)).toBe('PASS');
    });
});

// ─── formatDenialMessage ───────────────────────────────────────────────

describe('formatDenialMessage', () => {
    test('includes task, verdict path, and remediation', () => {
        const msg = formatDenialMessage({
            wbs: '0299',
            taskFilePath: TASK_PATH,
            verdictPath: '.spur/run/0299-verdict.json',
            verdict: 'PARTIAL',
        });
        expect(msg).toContain('0299');
        expect(msg).toContain(TASK_PATH);
        expect(msg).toContain('PARTIAL');
        expect(msg).toContain('.spur/run/0299-verdict.json');
        expect(msg).toContain('/sp:dev-verify 0299');
        expect(msg).toContain('--force-done');
    });

    test('names the inconsistency when supplied', () => {
        const msg = formatDenialMessage({
            wbs: '0299',
            taskFilePath: TASK_PATH,
            verdictPath: '.spur/run/0299-verdict.json',
            verdict: 'FAIL',
            inconsistency: { stored: 'PASS', computed: 'FAIL' },
        });
        expect(msg).toContain('self-inconsistent');
        expect(msg).toContain('PASS');
        expect(msg).toContain('FAIL');
    });

    // ─── R3b: UNKNOWN enrichment (task 0294) ──────────────────────────────
    // When the effective verdict is UNKNOWN and the artifact was produced by
    // `spur task verdict` (source: 'spur-task-verdict'), the denial MUST name
    // the row count and point at the documented answer-file shape rather than
    // leaving the operator to guess why a non-PASS verdict appeared.
    test('R3b: UNKNOWN + spur-task-verdict source appends row-count diagnostic', () => {
        const msg = formatDenialMessage({
            wbs: '0299',
            taskFilePath: TASK_PATH,
            verdictPath: '.spur/run/0299-verdict.json',
            verdict: 'UNKNOWN',
            artifact: {
                verdict: 'UNKNOWN',
                requirements: [],
                acceptanceCriteria: [],
                source: 'spur-task-verdict',
            },
        });
        expect(msg).toContain('UNKNOWN');
        expect(msg).toContain('source:');
        // Zero rows is the common failure mode — free-form prose answer file.
        expect(msg).toContain('0 structured rows');
        expect(msg).toContain('0 requirements, 0 AC');
        expect(msg).toContain('answer file carried no parseable markdown tables');
        expect(msg).toContain('sp:spur-cli');
        expect(msg).toContain('do not loosen the parser');
        // Remediation line still present.
        expect(msg).toContain('/sp:dev-verify 0299');
    });

    test('R3b: UNKNOWN with non-zero rows still names the count (pluralized)', () => {
        const msg = formatDenialMessage({
            wbs: '0299',
            taskFilePath: TASK_PATH,
            verdictPath: '.spur/run/0299-verdict.json',
            verdict: 'UNKNOWN',
            artifact: {
                verdict: 'UNKNOWN',
                requirements: [{ status: 'MET' }],
                acceptanceCriteria: [{ status: 'UNMET' }, { status: 'MET' }],
                source: 'spur-task-verdict',
            },
        });
        // 1 requirement + 2 AC = 3 rows. Pluralization kicks in.
        expect(msg).toContain('3 structured rows');
        expect(msg).toContain('1 requirement, 2 AC');
    });

    test('R3b: UNKNOWN without artifact (e.g. read error) skips the enrichment', () => {
        // When `artifact` is absent (read error path, malformed JSON), the
        // guard cannot know the source. The base denial still fires.
        const msg = formatDenialMessage({
            wbs: '0299',
            taskFilePath: TASK_PATH,
            verdictPath: '.spur/run/0299-verdict.json',
            verdict: 'UNKNOWN',
        });
        expect(msg).toContain('UNKNOWN');
        expect(msg).not.toContain('source:');
        expect(msg).not.toContain('structured rows');
    });

    test('R3b: UNKNOWN zero-row artifact from another source still gets actionable enrichment', () => {
        const msg = formatDenialMessage({
            wbs: '0299',
            taskFilePath: TASK_PATH,
            verdictPath: '.spur/run/0299-verdict.json',
            verdict: 'UNKNOWN',
            artifact: { verdict: 'UNKNOWN', source: 'manual' },
        });
        expect(msg).toContain('UNKNOWN');
        expect(msg).toContain('source:  manual');
        expect(msg).toContain('0 structured rows');
        expect(msg).toContain('sp:spur-cli');
    });

    test('R3b: non-UNKNOWN verdict with spur-task-verdict source skips the enrichment', () => {
        // PARTIAL/FAIL have actionable row evidence; the enrichment targets
        // only the UNKNOWN case where the operator has no row signal at all.
        const msg = formatDenialMessage({
            wbs: '0299',
            taskFilePath: TASK_PATH,
            verdictPath: '.spur/run/0299-verdict.json',
            verdict: 'PARTIAL',
            artifact: {
                verdict: 'PARTIAL',
                requirements: [{ status: 'PARTIAL' }],
                source: 'spur-task-verdict',
            },
        });
        expect(msg).toContain('PARTIAL');
        expect(msg).not.toContain('source:');
    });
});

// ─── formatNoopMessage ─────────────────────────────────────────────────

describe('formatNoopMessage', () => {
    test('names the status and avoids the undefined shape', () => {
        const msg = formatNoopMessage('0299', 'done');
        expect(msg).toBe('0299: already done — no transition');
        expect(msg).not.toContain('undefined');
    });
});

// ─── R10 cross-check: agreement with deriveVerdict ─────────────────────
// The guard intentionally duplicates the two-fold aggregation rule instead of
// importing the `task-verdict` answer parser (see the module header). This
// block is the anti-drift pin that duplication depends on: for every row-status
// shape expressible in the guard's vocabulary, `computeAggregate` must agree
// with `deriveVerdict` on the aggregate. Empty-row shapes are excluded by
// design — `deriveVerdict` treats a row-less answer as unparseable (UNKNOWN),
// while the guard resolves a row-less artifact against the stored verdict via
// `harshnessMax`.

describe('R10 — agrees with deriveVerdict on every shape', () => {
    const STATUSES: readonly VerdictRowStatus[] = ['MET', 'PARTIAL', 'UNMET'];

    function artifactFor(reqs: readonly VerdictRowStatus[], acs: readonly VerdictRowStatus[]): VerdictArtifact {
        return {
            wbs: '0299',
            verdict: 'UNKNOWN',
            requirements: reqs.map((status, i) => ({ id: `R${i + 1}`, status, evidence: 'tests/x.test.ts:1' })),
            acceptanceCriteria: acs.map((status, i) => ({
                id: `Scenario: AC${i + 1}`,
                status,
                evidenceType: 'test',
                evidence: 'tests/x.test.ts:1',
            })),
            source: 'spur task verdict',
        };
    }

    /** Equivalent verify answer text for the same rows, in the tables `deriveVerdict` parses. */
    function answerFor(reqs: readonly VerdictRowStatus[], acs: readonly VerdictRowStatus[]): string {
        const lines = ['| Req | Status | Evidence |', '|-----|--------|----------|'];
        reqs.forEach((status, i) => {
            lines.push(`| R${i + 1} | ${status} | \`tests/x.test.ts:1\` |`);
        });
        if (acs.length > 0) {
            lines.push('', '| AC | Status | Evidence Type | Evidence |', '|----|--------|---------------|----------|');
            acs.forEach((status, i) => {
                lines.push(`| Scenario: AC${i + 1} | ${status} | test | \`tests/x.test.ts:1\` |`);
            });
        }
        return lines.join('\n');
    }

    test('every requirement-status pair yields the same aggregate', () => {
        for (const a of STATUSES) {
            for (const b of STATUSES) {
                const computed = computeAggregate(artifactFor([a, b], []));
                const derived = deriveVerdict(answerFor([a, b], []), true).verdict;
                expect(`${a}+${b} → ${computed}`).toBe(`${a}+${b} → ${derived}`);
            }
        }
    });

    test('every AC-status pair (executable evidence) yields the same aggregate', () => {
        for (const a of STATUSES) {
            for (const b of STATUSES) {
                const computed = computeAggregate(artifactFor(['MET'], [a, b]));
                const derived = deriveVerdict(answerFor(['MET'], [a, b]), true).verdict;
                expect(`AC ${a}+${b} → ${computed}`).toBe(`AC ${a}+${b} → ${derived}`);
            }
        }
    });

    test('single-row shapes agree', () => {
        for (const s of STATUSES) {
            const computed = computeAggregate(artifactFor([s], []));
            const derived = deriveVerdict(answerFor([s], []), true).verdict;
            expect(`${s} → ${computed}`).toBe(`${s} → ${derived}`);
        }
    });
});
