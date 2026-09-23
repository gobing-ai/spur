/**
 * Feature verification receipt (feature D63, task 0915 — R1/R2/R4).
 *
 * The v0 evidence for the feature-scoped verification pass (the
 * `feature-verification` workflow, task 0872) was a bare
 * `.spur/run/<fid>-feature-verification.status` string. It was identity-blind,
 * input-blind and writer-blind: any `echo PASS` satisfied completion, for any
 * feature, regardless of what changed after the pass ran. The v1 receipt binds
 * the verification pass to:
 *
 *   - **feature identity** — `featureId` is stored and compared; a receipt
 *     recorded for another feature never validates (cross-feature rejection),
 *   - **the verifier contract** — the verification command is recorded verbatim
 *     and compared at validation (contract-mismatch rejection),
 *   - **the checked inputs** — one digest from the shared proof-input
 *     fingerprint engine (R4: no second digest implementation). The engine
 *     hashes the feature markdown plus the git tree of tracked sources, so
 *     tree, spec and check-contract changes all invalidate the receipt (stale
 *     rejection),
 *   - **the verdict** — only PASS can satisfy completion (failed rejection).
 *
 * Validation is fail-closed: missing, malformed, cross-feature, failed, stale
 * or contract-mismatched evidence rejects completion with an unsuppressible
 * `L4.feature-receipt-*` error finding (see `FeatureCheckService`).
 *
 * Ordering and replay (R3): recording is idempotent — re-verification
 * overwrites the receipt and the coarse status file. Any wrapup mutation that
 * lands after the pass changes the tree digest and forces re-verification, so
 * record/learning mutations must complete **before** the final verification
 * pass; the digest chain enforces this rather than trusting call order.
 */

import { join } from 'node:path';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { ProofCaptureError, ProofInputFingerprint } from '../workflow/proof-input-fingerprint';

/** Schema marker persisted inside every receipt artifact. */
export const FEATURE_RECEIPT_SCHEMA = 'feature-verification-receipt/v1';

/**
 * Default verification command (ADR-119): the repo-wide, once-per-feature pass.
 * Trusted operator/config surface — same class as task-pipeline's
 * `qualityGateCmd`, never interpolated from untrusted input.
 */
export const DEFAULT_FEATURE_VERIFICATION_CMD = 'bun run spur-check-feature';

/** Durable receipt for one feature-scoped verification pass. */
export interface FeatureVerificationReceipt {
    schema: typeof FEATURE_RECEIPT_SCHEMA;
    /** Feature the evidence belongs to (validated at the completion boundary). */
    featureId: string;
    /** Proof-input fingerprint over feature markdown + checked tree at pass time. */
    inputDigest: string;
    /** Verifier contract — the command that produced the evidence. */
    verificationCmd: string;
    /** Outcome of the verification command. Only PASS satisfies completion. */
    verdict: 'PASS' | 'FAIL';
    /** Engine run identity when recorded inside a workflow run; null for direct CLI. */
    runId: string | null;
    /** ISO-8601 UTC record time (diagnostic only — freshness is the digest chain). */
    recordedAt: string;
}

/** Artifact paths for one feature's verification evidence. */
export interface FeatureReceiptPaths {
    /** Bound receipt (JSON). The v1 completion gate reads this. */
    receipt: string;
    /** Coarse PASS/FAIL status — kept for the feature-verification workflow's internal routing. */
    status: string;
    /** Verification command output log. */
    log: string;
}

/** Why a receipt failed validation (each maps to an unsuppressible finding code). */
export type FeatureReceiptRejection =
    | 'missing'
    | 'malformed'
    | 'cross-feature'
    | 'failed'
    | 'stale'
    | 'contract-mismatch';

/** Result of receipt validation: the bound receipt, or a fail-closed rejection with detail. */
export type FeatureReceiptValidation =
    | { ok: true; receipt: FeatureVerificationReceipt }
    | { ok: false; reason: FeatureReceiptRejection; detail: string };

/** Resolve the receipt/status/log artifact paths under `runDir`. */
export function featureReceiptPaths(runDir: string, featureId: string): FeatureReceiptPaths {
    const stem = join(runDir, `${featureId}-feature-verification`);
    return { receipt: `${stem}.receipt.json`, status: `${stem}.status`, log: `${stem}.log` };
}

/**
 * Capture the current checked-input digest for a feature: shared proof-input
 * fingerprint engine over the feature markdown plus the git tree (R4).
 * Throws `ProofCaptureError` on git failure — callers must fail closed.
 */
export async function captureFeatureReceiptDigest(repoRoot: string, featureContent: string): Promise<string> {
    return ProofInputFingerprint.compute({ cwd: repoRoot, featureContent });
}

/** Inputs for recording a feature verification receipt (0915). */
export interface RecordFeatureReceiptOptions {
    featureId: string;
    inputDigest: string;
    verificationCmd: string;
    verdict: 'PASS' | 'FAIL';
    /** Engine run identity, or null for direct CLI invocation. */
    runId?: string | null;
    recordedAt?: string;
}

/**
 * Record (or overwrite — idempotent replay, R3) the receipt plus the coarse
 * status file for a feature's verification pass. Single writer: the CLI
 * `feature verify` verb; the workflow shells it.
 */
export async function recordFeatureVerificationReceipt(
    fs: FileSystem,
    runDir: string,
    options: RecordFeatureReceiptOptions,
): Promise<FeatureVerificationReceipt> {
    const receipt: FeatureVerificationReceipt = {
        schema: FEATURE_RECEIPT_SCHEMA,
        featureId: options.featureId,
        inputDigest: options.inputDigest,
        verificationCmd: options.verificationCmd,
        verdict: options.verdict,
        runId: options.runId ?? null,
        recordedAt: options.recordedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    const paths = featureReceiptPaths(runDir, options.featureId);
    await fs.ensureDir(runDir);
    await fs.writeFile(paths.receipt, `${JSON.stringify(receipt, null, 4)}\n`);
    await fs.writeFile(paths.status, `${receipt.verdict}\n`);
    return receipt;
}

/**
 * Validate a feature's receipt against the current checked-input digest.
 * Rejections are ordered cheapest-first; every rejection is fail-closed.
 */
export async function validateFeatureVerificationReceipt(
    fs: FileSystem,
    runDir: string,
    featureId: string,
    currentDigest: string,
    currentVerificationCmd: string = DEFAULT_FEATURE_VERIFICATION_CMD,
): Promise<FeatureReceiptValidation> {
    const paths = featureReceiptPaths(runDir, featureId);
    let raw: string;
    try {
        raw = await fs.readFile(paths.receipt);
    } catch {
        return {
            ok: false,
            reason: 'missing',
            detail: `no receipt at ${paths.receipt}; run the feature-scoped verification pass`,
        };
    }

    let receipt: FeatureVerificationReceipt;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (
            parsed === null ||
            typeof parsed !== 'object' ||
            (parsed as { schema?: unknown }).schema !== FEATURE_RECEIPT_SCHEMA
        ) {
            throw new Error('schema marker mismatch');
        }
        const r = parsed as Partial<FeatureVerificationReceipt>;
        if (
            typeof r.featureId !== 'string' ||
            typeof r.inputDigest !== 'string' ||
            typeof r.verificationCmd !== 'string' ||
            (r.verdict !== 'PASS' && r.verdict !== 'FAIL')
        ) {
            throw new Error('required fields missing or mistyped');
        }
        receipt = parsed as FeatureVerificationReceipt;
    } catch (err) {
        return {
            ok: false,
            reason: 'malformed',
            detail: `receipt at ${paths.receipt} is not a valid ${FEATURE_RECEIPT_SCHEMA} artifact (${String(err)})`,
        };
    }

    if (receipt.featureId !== featureId) {
        return {
            ok: false,
            reason: 'cross-feature',
            detail: `receipt belongs to feature "${receipt.featureId}", not "${featureId}"`,
        };
    }
    if (receipt.verdict !== 'PASS') {
        return {
            ok: false,
            reason: 'failed',
            detail: `verification pass recorded ${receipt.verdict} at ${receipt.recordedAt}`,
        };
    }
    if (receipt.verificationCmd !== currentVerificationCmd) {
        return {
            ok: false,
            reason: 'contract-mismatch',
            detail: `receipt recorded with verifier "${receipt.verificationCmd}", completion evaluates "${currentVerificationCmd}"`,
        };
    }
    if (receipt.inputDigest !== currentDigest) {
        return {
            ok: false,
            reason: 'stale',
            detail: `receipt digest ${receipt.inputDigest} ≠ current inputs ${currentDigest} — tree, spec or check contract changed after the pass`,
        };
    }
    return { ok: true, receipt };
}

/** True when the capture failure should surface as the stale/deny path (fail-closed). */
export function isProofCaptureError(err: unknown): err is ProofCaptureError {
    return err instanceof ProofCaptureError;
}
