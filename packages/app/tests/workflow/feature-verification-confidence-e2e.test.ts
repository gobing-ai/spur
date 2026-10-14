/**
 * E2E: the confidence grade (HIGH/MEDIUM/LOW) on a feature-verification PASS, and whether the
 * completion boundary the lifecycle actually uses accepts it.
 *
 * What is REAL here (no canned substitutes):
 *   - the pass — `runFeatureVerification`: the shipped definition resolution, the before/after
 *     proof-input digest over a real git worktree, the durable RUNNING→PASS/FAIL receipt pair, and
 *     the configured `bun run spur-check-feature` command launched through the safe argv splitter
 *     (default `spawnSync`, default receipts, default digest);
 *   - the boundary — `transitionFeatureGuarded` driving `FeatureCheckService.check --as done`, the
 *     same shell-guard path the CLI and the server use for the verifying → done edge.
 *
 * The one seam is the fingerprint's git anchor. `FeatureCheckService` pins its project root at
 * construction to `process.cwd()` (1198: a foreign cwd mid-flight must not stale a receipt), while
 * the pass anchors on its own `workdir` — and a fixture temp repo is neither. The spy re-anchors
 * `ProofInputFingerprint.compute` to the fixture worktree (the seam `feature-service.test.ts` uses)
 * so both sides hash one real repo instead of the developer's checkout, whose git tree any parallel
 * writer can move mid-test. Everything else about the digest — tree, feature spec, learnings — is
 * the production computation.
 *
 * Fixture invariants that make a green pass possible at all (each one observed as a failure first):
 *   - `.spur/` is gitignored: `createGitAlternateTree` runs `git add -A`, so the pass's own receipts
 *     and logs would otherwise move the after-digest and record FAIL;
 *   - HEAD exists: the capture starts with `git read-tree HEAD`;
 *   - no project `.spur/workflows` override: the fixture must resolve the SAME shared definition
 *     (layer `shared`, same digest) the boundary resolves from the repo, because `layer` is part of
 *     the verifier identity — an identical-content project copy still drifts on `layer`;
 *   - the fixture's `package.json` defines the configured script, so the real command exits 0 in the
 *     fixture instead of launching the repo-wide gate.
 *
 * Not covered (owned elsewhere): the run-store port (terminal run row + artifact registration) is
 * omitted, so those two sub-checks skip — `feature-verification-run.test.ts` covers them; the
 * learnings fold is real but mirrored from the repo, and its staleness contract is covered by the
 * digest-chain tests.
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { GuardDeniedError } from '../../src/errors';
import { FeatureCheckService } from '../../src/services/feature-check';
import { FeatureService } from '../../src/services/feature-service';
import { transitionFeatureGuarded } from '../../src/services/feature-transition';
import { PlanningWriteService } from '../../src/services/planning-write-service';
import { featureReceiptPaths } from '../../src/workflow/feature-verification-receipt';
import { runFeatureVerification } from '../../src/workflow/feature-verification-run';
import { ProofInputFingerprint } from '../../src/workflow/proof-input-fingerprint';
import { resolveWorkflowDefinition } from '../../src/workflow/workflow-resolver';

// `FEATURE_FILE_RE` is /^([A-Z][1-9]*)_(.+)\.md$/ — the id may not contain a `0`.
const FEATURE_ID = 'F99';

/**
 * Strict-clean feature at `verifying`: every static lifecycle layer passes, so the D63 completion
 * receipt is the only thing that can deny the verifying → done edge (shape proven in
 * `feature-transition.test.ts`).
 */
const featureDoc = (status: string): string =>
    [
        '---',
        'schema_version: 1',
        `id: ${FEATURE_ID}`,
        `name: Feature ${FEATURE_ID}`,
        `status: ${status}`,
        'created_at: 2026-10-01T00:00:00Z',
        'updated_at: 2026-10-01T00:00:00Z',
        '---',
        `# ${FEATURE_ID} Feature ${FEATURE_ID}`,
        '## Goal',
        'goal body',
        '## Scope',
        'In: the confidence grade on completion evidence',
        'Out: everything else',
        '## Acceptance Criteria',
        '- [ ] a strict-clean checklist item',
        '## Tasks',
        '',
    ].join('\n');

type TransitionDeps = Parameters<typeof transitionFeatureGuarded>[0];

interface Fixture {
    root: string;
    featFile: string;
    runDir: string;
    deps: TransitionDeps;
}

/** The configured command of the resolved `feature-verification` definition, and its script name. */
let configuredCmd = '';
let configuredScript = '';

const roots: string[] = [];

/** Restores the digest-anchor spy so it cannot leak into a sibling test file in this process. */
let restoreFingerprint: (() => void) | undefined;

/** The worktree the fingerprint seam re-anchors on for the case under execution. */
let currentRoot = '';

beforeAll(async () => {
    // The fixture only stays hermetic if the shipped definition runs a `bun run <script>` command the
    // fixture's package.json can satisfy; fail loudly here rather than mysteriously inside a case.
    const selected = await resolveWorkflowDefinition(process.cwd(), 'feature-verification');
    const vars = selected.workflow.vars as { verificationCmd?: unknown } | undefined;
    configuredCmd = typeof vars?.verificationCmd === 'string' ? vars.verificationCmd : '';
    expect(configuredCmd.startsWith('bun run ')).toBe(true);
    configuredScript = configuredCmd.slice('bun run '.length);

    // Re-anchor the digest capture to the case's worktree (see the file header). Identity of the
    // engine, not its inputs: the real git-tree/spec/learnings computation still runs.
    const compute = ProofInputFingerprint.compute;
    const fingerprint = spyOn(ProofInputFingerprint, 'compute').mockImplementation((options = {}) =>
        compute({ ...options, cwd: currentRoot }),
    );
    restoreFingerprint = () => fingerprint.mockRestore();
});

afterAll(() => {
    restoreFingerprint?.();
    for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Build one case's fixture: a committed git repo with the corpus, learnings mirror, and package. */
function buildFixture(scriptBody = 'exit 0'): Fixture {
    const root = mkdtempSync(join(tmpdir(), 'spur-confidence-e2e-'));
    roots.push(root);
    currentRoot = root;

    const featuresDir = join(root, 'docs', 'features');
    const tasksDir = join(root, 'docs', 'tasks');
    const runDir = join(root, '.spur', 'run');
    mkdirSync(featuresDir, { recursive: true });
    mkdirSync(tasksDir, { recursive: true });
    mkdirSync(runDir, { recursive: true });

    writeFileSync(join(root, '.gitignore'), '.spur/\n');
    writeFileSync(
        join(root, 'package.json'),
        `${JSON.stringify({ name: 'spur-confidence-e2e', private: true, scripts: { [configuredScript]: scriptBody } }, null, 2)}\n`,
    );
    const featFile = join(featuresDir, `${FEATURE_ID}_confidence_e2e.md`);
    writeFileSync(featFile, featureDoc('verifying'));

    // The boundary reads learnings from its pinned root (the real repo) while the pass reads them
    // from the worktree; mirroring the content makes both sides fold the same real learnings.
    try {
        const learnings = readFileSync(join(process.cwd(), '.spur', 'context', 'learnings.md'), 'utf8');
        mkdirSync(join(root, '.spur', 'context'), { recursive: true });
        writeFileSync(join(root, '.spur', 'context', 'learnings.md'), learnings);
    } catch {
        // No repo learnings to mirror: both sides read undefined, which still agrees.
    }

    for (const args of [
        ['init', '-q'],
        ['add', '-A'],
        ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', 'fixture'],
    ]) {
        const result = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
        if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.toString()}`);
    }

    const fs = createNodeFileSystem(root);
    return {
        root,
        featFile,
        runDir,
        deps: {
            features: new FeatureService({
                fs,
                featuresDir,
                tasksDir,
                writeService: new PlanningWriteService({ fs }),
            }),
            check: new FeatureCheckService(fs),
            cwd: root,
            featuresDir,
            tasksDirs: [tasksDir],
            runDir,
        },
    };
}

/** Drive the real pass; only the artifact registration is stubbed (no project DB in a fixture). */
async function runPass(
    fixture: Fixture,
    options: { runId: string; cmdOverride?: string; confidenceOverride?: string; ackLowConfidence?: boolean },
) {
    return runFeatureVerification({
        workdir: fixture.root,
        featureId: FEATURE_ID,
        runId: options.runId,
        ...(options.cmdOverride !== undefined ? { cmdOverride: options.cmdOverride } : {}),
        ...(options.confidenceOverride !== undefined ? { confidenceOverride: options.confidenceOverride } : {}),
        ...(options.ackLowConfidence === true ? { ackLowConfidence: true } : {}),
        registerArtifact: async () => {},
    });
}

function readReceipt(fixture: Fixture, runId: string): Record<string, unknown> {
    return JSON.parse(readFileSync(featureReceiptPaths(fixture.runDir, FEATURE_ID, runId).runScoped, 'utf8'));
}

/** One row of the artifact: what the pass recorded vs what the boundary decided. */
interface MatrixRow {
    level: string;
    origin: 'derived' | 'declared' | 'absent';
    acknowledged: boolean;
    receiptStatus: string;
    receiptConfidence: string | null;
    boundary: 'certified' | 'refused';
    detail: string;
}

const matrix: MatrixRow[] = [];

/**
 * Suite-load budget for the cases below. Each one drives a real pass — a `bun run` spawn plus three
 * git-tree digest captures — so it inherits the spawn-stall sensitivity of every subprocess-heavy
 * test in this suite: measured 0.2-0.4s alone, but the first case hit the 20s suite default once
 * while 662 files ran in parallel and a sibling spawn-heavy test stalled in the same run
 * (2026-10-14). Same treatment and reasoning as `loadFlakeTest` in `command-gate.test.ts`; if this
 * one recurs, make the pass cheaper before raising the budget.
 */
const CASE_TIMEOUT_MS = 60_000;
const caseTest = (name: string, fn: () => Promise<void>): void => void test(name, fn, CASE_TIMEOUT_MS);

/** Run the boundary and record its decision; returns the denial message when it refused. */
async function crossBoundary(fixture: Fixture): Promise<{ certified: boolean; message: string }> {
    try {
        const result = await transitionFeatureGuarded(fixture.deps, { id: FEATURE_ID, to: 'done' });
        return { certified: result.toStatus === 'done', message: result.toStatus ?? '(no status)' };
    } catch (error) {
        if (error instanceof GuardDeniedError) return { certified: false, message: error.message };
        throw error;
    }
}

describe('feature-verification confidence grade — real pass through the real completion boundary', () => {
    caseTest('a derived HIGH certifies the verifying → done edge', async () => {
        const fixture = buildFixture();
        const run = await runPass(fixture, { runId: 'run-high' });
        expect(run.status).toBe('PASS');
        expect(run.confidence).toBe('HIGH');

        const receipt = readReceipt(fixture, 'run-high');
        expect(receipt.confidence).toBe('HIGH');
        expect(receipt.verificationCmd).toBe(configuredCmd);
        expect(receipt.confidenceBasis).toContain('verification command exited 0');
        expect(receipt.confidenceBasis).toContain('proof-input digest unchanged across the pass');

        const boundary = await crossBoundary(fixture);
        expect(boundary.message).toBe('done');
        matrix.push({
            level: 'HIGH',
            origin: 'derived',
            acknowledged: false,
            receiptStatus: String(receipt.status),
            receiptConfidence: String(receipt.confidence),
            boundary: 'certified',
            detail: 'selected definition command exited 0, digest unchanged',
        });
    });

    caseTest('a declared MEDIUM certifies the verifying → done edge', async () => {
        const fixture = buildFixture();
        const run = await runPass(fixture, { runId: 'run-medium', confidenceOverride: 'MEDIUM' });
        expect(run.status).toBe('PASS');
        expect(run.confidence).toBe('MEDIUM');

        const receipt = readReceipt(fixture, 'run-medium');
        // Declared first, so a reader sees the human decision ahead of the measurements.
        expect((receipt.confidenceBasis as string[])[0]).toBe('operator-declared MEDIUM');
        // The configured command is still the one that ran — that is what lets MEDIUM complete.
        expect(receipt.verificationCmd).toBe(configuredCmd);

        const boundary = await crossBoundary(fixture);
        expect(boundary.message).toBe('done');
        matrix.push({
            level: 'MEDIUM',
            origin: 'declared',
            acknowledged: false,
            receiptStatus: String(receipt.status),
            receiptConfidence: String(receipt.confidence),
            boundary: 'certified',
            detail: 'operator-declared level over the configured command',
        });
    });

    caseTest('a declared LOW without acknowledgement is refused as unacknowledged-low-confidence', async () => {
        const fixture = buildFixture();
        const run = await runPass(fixture, { runId: 'run-low', confidenceOverride: 'LOW' });
        expect(run.status).toBe('PASS');
        expect(run.confidence).toBe('LOW');

        const boundary = await crossBoundary(fixture);
        expect(boundary.certified).toBe(false);
        expect(boundary.message).toContain('L4.feature-receipt-confidence');
        expect(boundary.message).toContain('completion evidence rejected (unacknowledged-low-confidence)');
        // The refusal is actionable, not a bare denial.
        expect(boundary.message).toContain('Re-run the feature-scoped verification pass');

        const receipt = readReceipt(fixture, 'run-low');
        matrix.push({
            level: 'LOW',
            origin: 'declared',
            acknowledged: false,
            receiptStatus: String(receipt.status),
            receiptConfidence: String(receipt.confidence),
            boundary: 'refused',
            detail: 'unacknowledged-low-confidence',
        });
    });

    caseTest('the same LOW with the operator acknowledgement certifies', async () => {
        const fixture = buildFixture();
        const run = await runPass(fixture, { runId: 'run-low-ack', confidenceOverride: 'LOW', ackLowConfidence: true });
        expect(run.status).toBe('PASS');

        const receipt = readReceipt(fixture, 'run-low-ack');
        expect(receipt.confidence).toBe('LOW');
        // The acknowledgement is durable evidence on the receipt, not a transition-time flag.
        expect(receipt.confidenceAcknowledged).toBe(true);

        const boundary = await crossBoundary(fixture);
        expect(boundary.message).toBe('done');
        matrix.push({
            level: 'LOW',
            origin: 'declared',
            acknowledged: true,
            receiptStatus: String(receipt.status),
            receiptConfidence: String(receipt.confidence),
            boundary: 'certified',
            detail: 'acknowledgement recorded on the receipt',
        });
    });

    caseTest('a PASS recording no level at all (pre-field receipt) is refused with the re-run repair', async () => {
        const fixture = buildFixture();
        const run = await runPass(fixture, { runId: 'run-absent' });
        expect(run.status).toBe('PASS');

        // Strip the field from BOTH copies: they must stay byte-identical or `divergent` fires first.
        const paths = featureReceiptPaths(fixture.runDir, FEATURE_ID, 'run-absent');
        for (const path of [paths.runScoped, paths.featureScoped]) {
            const receipt = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
            delete receipt.confidence;
            delete receipt.confidenceBasis;
            writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
        }

        const boundary = await crossBoundary(fixture);
        expect(boundary.certified).toBe(false);
        expect(boundary.message).toContain('completion evidence rejected (unacknowledged-low-confidence)');
        expect(boundary.message).toContain('written before the field existed');
        matrix.push({
            level: 'absent',
            origin: 'absent',
            acknowledged: false,
            receiptStatus: 'PASS',
            receiptConfidence: null,
            boundary: 'refused',
            detail: 'unacknowledged-low-confidence (no level recorded)',
        });
    });

    caseTest('a FAILing pass derives LOW and is refused as failed evidence, not as a level problem', async () => {
        const fixture = buildFixture('exit 3');
        const run = await runPass(fixture, { runId: 'run-fail' });
        expect(run.status).toBe('FAIL');
        expect(run.confidence).toBe('LOW');

        const receipt = readReceipt(fixture, 'run-fail');
        expect(receipt.status).toBe('FAIL');
        expect(receipt.confidenceBasis).toContain('verification command did not exit 0');

        const boundary = await crossBoundary(fixture);
        expect(boundary.certified).toBe(false);
        // Failed evidence is rejected before the level is judged: "re-run the pass", not "acknowledge".
        expect(boundary.message).toContain('completion evidence rejected (failed)');
        matrix.push({
            level: 'LOW',
            origin: 'derived',
            acknowledged: false,
            receiptStatus: String(receipt.status),
            receiptConfidence: String(receipt.confidence),
            boundary: 'refused',
            detail: 'failed evidence precedes the level check',
        });
    });

    caseTest('a MEDIUM derived from a caller command override cannot complete alone', async () => {
        const fixture = buildFixture();
        const run = await runPass(fixture, { runId: 'run-medium-override', cmdOverride: 'true' });
        expect(run.status).toBe('PASS');
        expect(run.confidence).toBe('MEDIUM');
        expect(run.effectiveCmd).not.toBe(configuredCmd);

        const boundary = await crossBoundary(fixture);
        expect(boundary.certified).toBe(false);
        // The receipt records the override as `verificationCmd`, so the contract check fires first.
        expect(boundary.message).toContain('completion evidence rejected (contract-mismatch)');
        matrix.push({
            level: 'MEDIUM',
            origin: 'derived',
            acknowledged: false,
            receiptStatus: 'PASS',
            receiptConfidence: 'MEDIUM',
            boundary: 'refused',
            detail: 'contract-mismatch — the override cannot satisfy completion',
        });
    });
});

/** The checkout this suite runs in, so the published matrix lands beside the other evidence. */
function repoRoot(): string | undefined {
    const result = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], {
        cwd: import.meta.dirname,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return result.exitCode === 0 ? result.stdout.toString().trim() : undefined;
}

describe('confidence matrix artifact', () => {
    test('publishes the verified matrix for the feature-verification record', () => {
        expect(matrix).toHaveLength(7);
        expect(matrix.filter((row) => row.boundary === 'certified').map((row) => row.level)).toEqual([
            'HIGH',
            'MEDIUM',
            'LOW',
        ]);
        const root = repoRoot();
        if (root === undefined) return; // not a checkout: the in-memory assertions above still hold
        const artifactDir = join(root, '.spur', 'memory', 'evidence');
        mkdirSync(artifactDir, { recursive: true });
        const artifactPath = join(artifactDir, 'feature-verification-confidence-e2e.matrix.json');
        writeFileSync(
            artifactPath,
            `${JSON.stringify({ kind: 'feature-verification-confidence-e2e', featureId: FEATURE_ID, rows: matrix }, null, 2)}\n`,
        );
        const reread = JSON.parse(readFileSync(artifactPath, 'utf8')) as { rows: MatrixRow[] };
        expect(reread.rows).toEqual(matrix);
    });
});
