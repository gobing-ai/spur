import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    captureFeatureReceiptDigest,
    DEFAULT_FEATURE_VERIFICATION_CMD,
    featureReceiptPaths,
    isProofCaptureError,
    recordFeatureVerificationReceipt,
    validateFeatureVerificationReceipt,
} from '../../src/services/feature-verification-receipt';
import { ProofCaptureError, ProofInputFingerprint } from '../../src/workflow/proof-input-fingerprint';

const FEATURE_MD = `---
id: "T1"
name: "Receipt test feature"
status: verifying
---

# T1. Receipt test feature

## Sections

### Acceptance Criteria
`;

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

describe('feature verification receipt (0915)', () => {
    const fs = createNodeFileSystem();

    test('AC1: valid PASS receipt bound to feature identity and inputs validates', async () => {
        const repo = makeTempGitRepo();
        try {
            const digest = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            await recordFeatureVerificationReceipt(fs, join(repo, '.spur/run'), {
                featureId: 'T1',
                inputDigest: digest,
                verificationCmd: DEFAULT_FEATURE_VERIFICATION_CMD,
                verdict: 'PASS',
                runId: 'run-1',
            });
            const outcome = await validateFeatureVerificationReceipt(fs, join(repo, '.spur/run'), 'T1', digest);
            expect(outcome.ok).toBe(true);
            if (outcome.ok) {
                expect(outcome.receipt.featureId).toBe('T1');
                expect(outcome.receipt.verdict).toBe('PASS');
                expect(outcome.receipt.runId).toBe('run-1');
            }
            // Coarse status still written for the workflow's internal routing.
            const paths = featureReceiptPaths(join(repo, '.spur/run'), 'T1');
            expect(await fs.readFile(paths.status)).toBe('PASS\n');
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('AC2: wrong feature, missing, malformed, FAIL and stale evidence all reject', async () => {
        const repo = makeTempGitRepo();
        try {
            const runDir = join(repo, '.spur/run');
            const digest = await captureFeatureReceiptDigest(repo, FEATURE_MD);

            const missing = await validateFeatureVerificationReceipt(fs, runDir, 'T1', digest);
            expect(missing).toMatchObject({ ok: false, reason: 'missing' });

            await fs.ensureDir(runDir);
            const paths = featureReceiptPaths(runDir, 'T1');
            await fs.writeFile(paths.receipt, 'not json at all');
            const malformed = await validateFeatureVerificationReceipt(fs, runDir, 'T1', digest);
            expect(malformed).toMatchObject({ ok: false, reason: 'malformed' });

            // Structurally-invalid JSON: wrong schema marker, then mistyped required fields.
            await fs.writeFile(paths.receipt, JSON.stringify({ schema: 'other/v1', featureId: 'T1' }));
            const badSchema = await validateFeatureVerificationReceipt(fs, runDir, 'T1', digest);
            expect(badSchema).toMatchObject({ ok: false, reason: 'malformed' });
            await fs.writeFile(
                paths.receipt,
                JSON.stringify({ schema: 'feature-verification-receipt/v1', featureId: 7, verdict: 'MAYBE' }),
            );
            const badFields = await validateFeatureVerificationReceipt(fs, runDir, 'T1', digest);
            expect(badFields).toMatchObject({ ok: false, reason: 'malformed' });

            // Cross-feature: receipt recorded for another feature id.
            await recordFeatureVerificationReceipt(fs, runDir, {
                featureId: 'T2',
                inputDigest: digest,
                verificationCmd: DEFAULT_FEATURE_VERIFICATION_CMD,
                verdict: 'PASS',
            });
            await fs.rename(featureReceiptPaths(runDir, 'T2').receipt, paths.receipt);
            const crossFeature = await validateFeatureVerificationReceipt(fs, runDir, 'T1', digest);
            expect(crossFeature).toMatchObject({ ok: false, reason: 'cross-feature' });

            await recordFeatureVerificationReceipt(fs, runDir, {
                featureId: 'T1',
                inputDigest: digest,
                verificationCmd: DEFAULT_FEATURE_VERIFICATION_CMD,
                verdict: 'FAIL',
            });
            const failed = await validateFeatureVerificationReceipt(fs, runDir, 'T1', digest);
            expect(failed).toMatchObject({ ok: false, reason: 'failed' });

            await recordFeatureVerificationReceipt(fs, runDir, {
                featureId: 'T1',
                inputDigest: 'sha256:stale',
                verificationCmd: DEFAULT_FEATURE_VERIFICATION_CMD,
                verdict: 'PASS',
            });
            const stale = await validateFeatureVerificationReceipt(fs, runDir, 'T1', digest);
            expect(stale).toMatchObject({ ok: false, reason: 'stale' });

            // Contract change: verifier command differs from the one at record time.
            await recordFeatureVerificationReceipt(fs, runDir, {
                featureId: 'T1',
                inputDigest: digest,
                verificationCmd: 'bun run some-old-command',
                verdict: 'PASS',
            });
            const contract = await validateFeatureVerificationReceipt(fs, runDir, 'T1', digest);
            expect(contract).toMatchObject({ ok: false, reason: 'contract-mismatch' });
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('AC2: changed tree invalidates the receipt; unchanged evidence is reused', async () => {
        const repo = makeTempGitRepo();
        try {
            const runDir = join(repo, '.spur/run');
            const digest = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            await recordFeatureVerificationReceipt(fs, runDir, {
                featureId: 'T1',
                inputDigest: digest,
                verificationCmd: DEFAULT_FEATURE_VERIFICATION_CMD,
                verdict: 'PASS',
            });
            const reused = await validateFeatureVerificationReceipt(fs, runDir, 'T1', digest);
            expect(reused.ok).toBe(true);

            // Wrapup-style edit after the pass → digest changes → must re-verify.
            writeFileSync(join(repo, 'checked-source.txt'), 'v2\n');
            const afterEdit = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            expect(afterEdit).not.toBe(digest);
            const stale = await validateFeatureVerificationReceipt(fs, runDir, 'T1', afterEdit);
            expect(stale).toMatchObject({ ok: false, reason: 'stale' });
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('AC3: recording is idempotent — replay overwrites cleanly', async () => {
        const repo = makeTempGitRepo();
        try {
            const runDir = join(repo, '.spur/run');
            const digest = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            const first = await recordFeatureVerificationReceipt(fs, runDir, {
                featureId: 'T1',
                inputDigest: digest,
                verificationCmd: DEFAULT_FEATURE_VERIFICATION_CMD,
                verdict: 'PASS',
            });
            const second = await recordFeatureVerificationReceipt(fs, runDir, {
                featureId: 'T1',
                inputDigest: digest,
                verificationCmd: DEFAULT_FEATURE_VERIFICATION_CMD,
                verdict: 'PASS',
            });
            expect(second.inputDigest).toBe(first.inputDigest);
            const paths = featureReceiptPaths(runDir, 'T1');
            const raw = await fs.readFile(paths.receipt);
            expect(JSON.parse(raw)).toMatchObject({ schema: first.schema, verdict: 'PASS' });
            // Exactly one receipt — overwrite, no append.
            expect(raw.match(/"schema"/g)).toHaveLength(1);
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('AC4: digest is the shared proof-input engine — same inputs, same digest; git failure is fail-closed', async () => {
        const repo = makeTempGitRepo();
        try {
            const digest = await captureFeatureReceiptDigest(repo, FEATURE_MD);
            const engineDigest = await ProofInputFingerprint.compute({
                cwd: repo,
                featureContent: FEATURE_MD,
            });
            expect(digest).toBe(engineDigest);

            // 0751 R1: capture failure must throw, never yield a sentinel digest.
            const broken = mkdtempSync(join(tmpdir(), 'spur-receipt-broken-'));
            try {
                await rm(broken, { recursive: true });
                let threw: unknown;
                try {
                    await captureFeatureReceiptDigest(broken, FEATURE_MD);
                } catch (err) {
                    threw = err;
                }
                expect(threw).toBeInstanceOf(ProofCaptureError);
                expect(isProofCaptureError(threw)).toBe(true);
                expect(isProofCaptureError(new Error('plain'))).toBe(false);
            } finally {
                rmSync(broken, { recursive: true, force: true });
            }
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });
});
