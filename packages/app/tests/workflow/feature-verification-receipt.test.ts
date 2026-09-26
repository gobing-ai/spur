import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    captureFeatureReceiptDigest,
    completeFeatureVerificationReceipt,
    DEFAULT_FEATURE_VERIFICATION_CMD,
    type FeatureReceiptRunPort,
    type FeatureVerificationReceipt,
    featureReceiptPaths,
    isProofCaptureError,
    startFeatureVerificationReceipt,
    validateFeatureVerificationReceipt,
} from '../../src/workflow/feature-verification-receipt';

const FEATURE_MD = `---
id: "T1"
name: "Receipt test feature"
status: verifying
---

# T1. Receipt test feature

## Sections

### Acceptance Criteria
`;

const VERIFIER = {
    name: 'feature-verification',
    // sp-runtime-path rule forbids literal config paths here — build the source path.
    sourcePath: ['config', 'workflows', 'feature-verification.yaml'].join('/'),
    layer: 'project',
    definitionDigest: 'sha256:cafe',
};

/** Minimal throwaway git repo with one tracked file so the tree hash is stable. */
function makeTempGitRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'spur-receipt-test-'));
    const run = (args: string) => {
        Bun.spawnSync(['sh', '-c', args], { cwd: dir });
    };
    run('git init -q && git config user.email t@t && git config user.name t');
    // Real repos ignore `.spur/` — keeps the receipt out of the digest tree.
    writeFileSync(join(dir, '.gitignore'), '.spur/\n');
    writeFileSync(join(dir, 'checked-source.txt'), 'v1\n');
    run('git add -A && git commit -qm init');
    return dir;
}

/** Record a terminal PASS receipt the way the standard script does. */
async function recordPass(
    repo: string,
    digest: string,
    overrides: Partial<Parameters<typeof startFeatureVerificationReceipt>[2]> = {},
): Promise<FeatureVerificationReceipt> {
    const runDir = join(repo, '.spur', 'run');
    const running = await startFeatureVerificationReceipt(fs, runDir, {
        featureId: 'T1',
        runId: 'run-1',
        workdir: repo,
        verifier: VERIFIER,
        verificationCmd: DEFAULT_FEATURE_VERIFICATION_CMD,
        inputDigest: digest,
        ...overrides,
    });
    return completeFeatureVerificationReceipt(fs, runDir, running, {
        status: 'PASS',
        inputDigest: digest,
    });
}

async function validate(repo: string, runPort?: FeatureReceiptRunPort, currentVerifier = VERIFIER) {
    const digest = await captureFeatureReceiptDigest(repo, FEATURE_MD);
    return validateFeatureVerificationReceipt(fs, {
        featureId: 'T1',
        runDir: join(repo, '.spur', 'run'),
        currentDigest: digest,
        currentVerifier,
        currentVerificationCmd: DEFAULT_FEATURE_VERIFICATION_CMD,
        runPort,
    });
}

const fs = createNodeFileSystem();

/** A run port backed by in-memory rows, with a knob to corrupt each fact. */
function makeRunPort(
    rows: Record<string, { status: string; digest?: string; varsJson?: string | null }>,
    artifacts: string[] = [],
): FeatureReceiptRunPort {
    return {
        readRunRow: async (runId) => {
            const row = rows[runId];
            if (!row) return undefined;
            return {
                status: row.status,
                definitionDigest: row.digest ?? null,
                varsJson: row.varsJson ?? null,
            };
        },
        hasArtifact: async (runId, path) => artifacts.includes(path) || artifacts.includes(`${runId}:${path}`),
    };
}

describe('feature verification receipt (0915, v1 contract)', () => {
    test('valid PASS receipt validates and both copies agree', async () => {
        const repo = makeTempGitRepo();
        try {
            const digest = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            const receipt = await recordPass(repo, digest);
            expect(receipt.schemaVersion).toBe(1);
            expect(receipt.completedAt).not.toBeNull();
            const paths = featureReceiptPaths(join(repo, '.spur', 'run'), 'T1', 'run-1');
            expect(await fs.readFile(paths.runScoped)).toBe(await fs.readFile(paths.featureScoped));
            const result = await validate(repo);
            expect(result.ok).toBe(true);
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('missing receipt is rejected fail-closed', async () => {
        const repo = makeTempGitRepo();
        try {
            const result = await validate(repo);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.reason).toBe('missing');
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('malformed receipt is rejected, not treated as missing', async () => {
        const repo = makeTempGitRepo();
        try {
            const runDir = join(repo, '.spur', 'run');
            await fs.ensureDir(runDir);
            await fs.writeFile(join(runDir, 'T1-feature-verification.json'), '{nope');
            const result = await validate(repo);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.reason).toBe('malformed');
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('receipt whose run-scoped copy carries another feature id is rejected (cross-feature)', async () => {
        const repo = makeTempGitRepo();
        try {
            const digest = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            await recordPass(repo, digest);
            // Tamper: both copies agree byte-for-byte but carry another
            // feature's identity (evidence written for a different feature).
            const runDir = join(repo, '.spur', 'run');
            const hijack = await startFeatureVerificationReceipt(fs, runDir, {
                featureId: 'T2',
                runId: 'run-1',
                workdir: repo,
                verifier: VERIFIER,
                verificationCmd: DEFAULT_FEATURE_VERIFICATION_CMD,
                inputDigest: digest,
            });
            const forged = await completeFeatureVerificationReceipt(fs, runDir, hijack, { status: 'PASS' });
            const body = `${JSON.stringify(forged, null, 4)}\n`;
            await fs.writeFile(join(runDir, 'T1-feature-verification.json'), body);
            const result = await validate(repo);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.reason).toBe('cross-feature');
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('divergent copies are rejected (newer attempt started)', async () => {
        const repo = makeTempGitRepo();
        try {
            const digest = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            await recordPass(repo, digest);
            // Tamper with only the feature-latest copy.
            const runDir = join(repo, '.spur', 'run');
            const latest = join(runDir, 'T1-feature-verification.json');
            const parsed = JSON.parse(await fs.readFile(latest)) as FeatureVerificationReceipt;
            parsed.status = 'FAIL';
            await fs.writeFile(latest, `${JSON.stringify(parsed, null, 4)}\n`);
            const result = await validate(repo);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.reason).toBe('divergent');
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('FAIL receipt is rejected', async () => {
        const repo = makeTempGitRepo();
        try {
            const digest = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            const runDir = join(repo, '.spur', 'run');
            const running = await startFeatureVerificationReceipt(fs, runDir, {
                featureId: 'T1',
                runId: 'run-1',
                workdir: repo,
                verifier: VERIFIER,
                verificationCmd: DEFAULT_FEATURE_VERIFICATION_CMD,
                inputDigest: digest,
            });
            await completeFeatureVerificationReceipt(fs, runDir, running, { status: 'FAIL' });
            const result = await validate(repo);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.reason).toBe('failed');
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('changed checked inputs make the receipt stale', async () => {
        const repo = makeTempGitRepo();
        try {
            const digest = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            await recordPass(repo, digest);
            writeFileSync(join(repo, 'checked-source.txt'), 'v2\n');
            const result = await validate(repo);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.reason).toBe('stale');
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('verifier identity or configured command drift is a contract mismatch', async () => {
        const repo = makeTempGitRepo();
        try {
            const digest = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            await recordPass(repo, digest);
            const drift = await validateFeatureVerificationReceipt(fs, {
                featureId: 'T1',
                runDir: join(repo, '.spur', 'run'),
                currentDigest: digest,
                currentVerifier: VERIFIER,
                currentVerificationCmd: 'bun run some-other-check',
            });
            expect(drift.ok).toBe(false);
            if (!drift.ok) expect(drift.reason).toBe('contract-mismatch');
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('RUNNING receipt with a recording run is rejected until the run is done', async () => {
        const repo = makeTempGitRepo();
        try {
            const digest = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            const runDir = join(repo, '.spur', 'run');
            await startFeatureVerificationReceipt(fs, runDir, {
                featureId: 'T1',
                runId: 'run-1',
                workdir: repo,
                verifier: VERIFIER,
                verificationCmd: DEFAULT_FEATURE_VERIFICATION_CMD,
                inputDigest: digest,
            });
            const result = await validate(
                repo,
                makeRunPort({ 'run-1': { status: 'running' } }, [`${join(runDir, 'run-1-feature-verification.json')}`]),
            );
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.reason).toBe('run');
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('done run with missing artifact registration or wrong digest is rejected', async () => {
        const repo = makeTempGitRepo();
        try {
            const digest = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            await recordPass(repo, digest);
            const runDir = join(repo, '.spur', 'run');
            const receiptPath = join(runDir, 'run-1-feature-verification.json');
            const done = makeRunPort({ 'run-1': { status: 'done', digest: 'sha256:cafe' } });
            // No artifacts registered → run rejection.
            const noArtifact = await validate(repo, done);
            expect(noArtifact.ok).toBe(false);
            if (!noArtifact.ok) expect(noArtifact.reason).toBe('run');
            // Registered but the row's definition digest disagrees → run rejection.
            const wrongDigest = await validate(
                repo,
                makeRunPort({ 'run-1': { status: 'done', digest: 'sha256:dead' } }, [receiptPath]),
            );
            expect(wrongDigest.ok).toBe(false);
            if (!wrongDigest.ok) expect(wrongDigest.reason).toBe('run');
            // Fully consistent run store → the receipt validates.
            const ok = await validate(
                repo,
                makeRunPort({ 'run-1': { status: 'done', digest: 'sha256:cafe' } }, [receiptPath]),
            );
            expect(ok.ok).toBe(true);
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('run checks are skipped when the run port is omitted (graceful caller)', async () => {
        const repo = makeTempGitRepo();
        try {
            const digest = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            await recordPass(repo, digest);
            const result = await validate(repo);
            expect(result.ok).toBe(true);
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('completion stores the after digest — PASS claims exactly what validation re-checks', async () => {
        const repo = makeTempGitRepo();
        try {
            const before = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            const runDir = join(repo, '.spur', 'run');
            const running = await startFeatureVerificationReceipt(fs, runDir, {
                featureId: 'T1',
                runId: 'run-1',
                workdir: repo,
                verifier: VERIFIER,
                verificationCmd: DEFAULT_FEATURE_VERIFICATION_CMD,
                inputDigest: before,
            });
            writeFileSync(join(repo, 'checked-source.txt'), 'v2\n');
            const after = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            expect(after).not.toBe(before);
            // The script decides PASS/FAIL from before vs after; completion
            // records the observed outcome and stores the AFTER digest, so a
            // PASS receipt is exactly the claim the boundary re-validates.
            const receipt = await completeFeatureVerificationReceipt(fs, runDir, running, {
                status: 'PASS',
                inputDigest: after,
            });
            expect(receipt.inputDigest).toBe(after);
            const result = await validate(repo);
            expect(result.ok).toBe(true);
            // Had the script (wrongly) completed with the BEFORE digest, the
            // boundary rejects: a changed tree cannot ride an old claim.
            const staleBody = `${JSON.stringify({ ...receipt, inputDigest: before }, null, 4)}\n`;
            await fs.writeFile(join(runDir, 'T1-feature-verification.json'), staleBody);
            await fs.writeFile(join(runDir, 'run-1-feature-verification.json'), staleBody);
            const stale = await validate(repo);
            expect(stale.ok).toBe(false);
            if (!stale.ok) expect(stale.reason).toBe('stale');
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('starting a new attempt supersedes the feature-latest copy first', async () => {
        const repo = makeTempGitRepo();
        try {
            const digest = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            await recordPass(repo, digest);
            const runDir = join(repo, '.spur', 'run');
            await startFeatureVerificationReceipt(fs, runDir, {
                featureId: 'T1',
                runId: 'run-2',
                workdir: repo,
                verifier: VERIFIER,
                verificationCmd: DEFAULT_FEATURE_VERIFICATION_CMD,
                inputDigest: digest,
            });
            // Crash simulation: run-scoped run-1 copy still PASS, but the
            // feature-latest copy is RUNNING — validation must fail closed.
            const result = await validateFeatureVerificationReceipt(fs, {
                featureId: 'T1',
                runDir,
                currentDigest: digest,
                currentVerifier: VERIFIER,
                currentVerificationCmd: DEFAULT_FEATURE_VERIFICATION_CMD,
                runPort: makeRunPort({}),
            });
            expect(result.ok).toBe(false);
            if (!result.ok) expect(['run', 'divergent']).toContain(result.reason);
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('receipt ids that could escape the run directory are refused (path confinement)', async () => {
        const repo = makeTempGitRepo();
        try {
            const digest = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            const attempt = startFeatureVerificationReceipt(fs, join(repo, '.spur', 'run'), {
                featureId: 'T1',
                runId: '../evil',
                workdir: repo,
                verifier: VERIFIER,
                verificationCmd: DEFAULT_FEATURE_VERIFICATION_CMD,
                inputDigest: digest,
            });
            expect(attempt).rejects.toThrow('invalid runId for receipt path');
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('completing a receipt twice is refused (single terminal write)', async () => {
        const repo = makeTempGitRepo();
        try {
            const digest = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            await recordPass(repo, digest);
            const runDir = join(repo, '.spur', 'run');
            const paths = featureReceiptPaths(runDir, 'T1', 'run-1');
            const terminal = JSON.parse(await fs.readFile(paths.runScoped)) as FeatureVerificationReceipt;
            expect(
                completeFeatureVerificationReceipt(fs, runDir, terminal, { status: 'PASS', inputDigest: digest }),
            ).rejects.toThrow('already');
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('non-object receipts, wrong schema versions and mistyped fields are malformed', async () => {
        const repo = makeTempGitRepo();
        try {
            const digest = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            await recordPass(repo, digest);
            const runDir = join(repo, '.spur', 'run');
            const paths = featureReceiptPaths(runDir, 'T1', 'run-1');
            const original = await fs.readFile(paths.runScoped);
            const mutate = async (body: string) => {
                await fs.writeFile(paths.runScoped, body);
                await fs.writeFile(paths.featureScoped, body);
            };
            await mutate('[]');
            expect((await validate(repo)).ok).toBe(false);
            const parsed: FeatureVerificationReceipt = JSON.parse(original);
            await mutate(JSON.stringify({ ...parsed, schemaVersion: 'v0' }));
            const wrongVersion = await validate(repo);
            expect(wrongVersion.ok).toBe(false);
            if (!wrongVersion.ok) expect(wrongVersion.reason).toBe('malformed');
            await mutate(JSON.stringify({ ...parsed, featureId: 42 }));
            const mistyped = await validate(repo);
            expect(mistyped.ok).toBe(false);
            if (!mistyped.ok) expect(mistyped.reason).toBe('malformed');
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('an unreadable run-scoped copy classifies as missing, not a crash', async () => {
        const repo = makeTempGitRepo();
        try {
            const digest = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            await recordPass(repo, digest);
            const paths = featureReceiptPaths(join(repo, '.spur', 'run'), 'T1', 'run-1');
            await fs.writeFile(paths.runScoped, '\n'); // empty body → JSON.parse throws
            const result = await validate(repo);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(['missing', 'malformed']).toContain(result.reason);
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('run-row facts that disagree with the receipt are each rejected', async () => {
        const repo = makeTempGitRepo();
        try {
            const digest = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            await recordPass(repo, digest);
            const runDir = join(repo, '.spur', 'run');
            const receiptPath = join(runDir, 'run-1-feature-verification.json');
            // Missing row.
            const noRow = await validate(repo, makeRunPort({}, [receiptPath]));
            expect(noRow.ok).toBe(false);
            if (!noRow.ok) expect(noRow.reason).toBe('run');
            // Row not terminal.
            const notDone = await validate(
                repo,
                makeRunPort({ 'run-1': { status: 'running', digest: 'sha256:cafe' } }, [receiptPath]),
            );
            expect(notDone.ok).toBe(false);
            if (!notDone.ok) expect(notDone.reason).toBe('run');
            // Row records a different effective verification command.
            const wrongCmd = await validate(
                repo,
                makeRunPort(
                    {
                        'run-1': {
                            status: 'done',
                            digest: 'sha256:cafe',
                            varsJson: JSON.stringify({ verificationCmd: 'bun run other-check' }),
                        },
                    },
                    [receiptPath],
                ),
            );
            expect(wrongCmd.ok).toBe(false);
            if (!wrongCmd.ok) expect(wrongCmd.reason).toBe('run');
            // Corrupt varsJson is tolerated (effective command unknown → no comparison).
            const corruptVars = await validate(
                repo,
                makeRunPort({ 'run-1': { status: 'done', digest: 'sha256:cafe', varsJson: '{nope' } }, [receiptPath]),
            );
            expect(corruptVars.ok).toBe(true);
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('verifier identity drift is a contract mismatch (definition changed after the pass)', async () => {
        const repo = makeTempGitRepo();
        try {
            const digest = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            await recordPass(repo, digest);
            const result = await validate(repo, undefined, {
                ...VERIFIER,
                definitionDigest: 'sha256:different',
            });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.reason).toBe('contract-mismatch');
                expect(result.detail).toEndWith('(definitionDigest)');
            }
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    // 0957: bundled and source-local CLIs resolve the same shared definition from
    // different install paths; identical bytes must not read as a changed verifier.
    test('same definition resolved from a different install path still validates', async () => {
        const repo = makeTempGitRepo();
        try {
            const digest = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            await recordPass(repo, digest);
            const result = await validate(repo, undefined, {
                ...VERIFIER,
                sourcePath: ['apps', 'cli', 'config', 'workflows', 'feature-verification.yaml'].join('/'),
            });
            expect(result.ok).toBe(true);
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('proof capture failure surfaces as a detectable capture error (fail-closed)', async () => {
        const nonRepo = mkdtempSync(join(tmpdir(), 'spur-nonrepo-'));
        try {
            let captured: unknown;
            try {
                await captureFeatureReceiptDigest(nonRepo, FEATURE_MD);
            } catch (err) {
                captured = err;
            }
            expect(isProofCaptureError(captured)).toBe(true);
        } finally {
            rmSync(nonRepo, { recursive: true, force: true });
        }
    });
});
