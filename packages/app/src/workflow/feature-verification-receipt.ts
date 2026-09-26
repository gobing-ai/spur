/**
 * Feature verification receipt, schema v1 (feature D63, task 0915 — R1/R2/R4,
 * remediated to the frozen refine-Q&A contract).
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
 *   - **the writer** — the recording workflow run (`runId`) and its working
 *     directory (`workdir`); receipts are always workflow-written, never
 *     hand-authored, and the run row must be terminal `done` with its persisted
 *     definition identity and effective vars agreeing with the receipt (run
 *     rejection),
 *   - **the verifier contract** — the selected `feature-verification`
 *     definition (name, source path, layer, definition digest) and the
 *     effective check command are recorded; all but the install-dependent
 *     source path are compared at validation against the currently selected
 *     definition (contract-mismatch rejection),
 *   - **the checked inputs** — one digest from the shared proof-input
 *     fingerprint engine (R4: no second digest implementation), captured
 *     before **and** after the pass; a mismatch records FAIL. Tree, spec,
 *     learning and check-contract changes all invalidate the receipt (stale
 *     rejection),
 *   - **the verdict** — only PASS can satisfy completion (failed rejection).
 *
 * Every receipt is written **twice**: a run-scoped copy
 * (`.spur/run/<runId>-feature-verification.json`) and a feature-latest copy
 * (`.spur/run/<featureId>-feature-verification.json`). A PASS is valid only
 * when both copies agree (divergent rejection); a newer attempt overwrites the
 * feature-latest copy first and thereby supersedes an older PASS. Writes are
 * atomic (temp file + rename inside `.spur/run`).
 *
 * Validation is fail-closed: missing, malformed, cross-feature, divergent,
 * failed, run-integrity, contract-mismatch or stale evidence rejects
 * completion with an unsuppressible `L4.feature-receipt-*` error finding (see
 * `FeatureCheckService`).
 */

import { basename, join } from 'node:path';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { ProofCaptureError, ProofInputFingerprint } from './proof-input-fingerprint';

/** Receipt schema version persisted in every receipt artifact. */
export const FEATURE_RECEIPT_SCHEMA_VERSION = 1;

/**
 * Default verification command (ADR-119): the repo-wide, once-per-feature pass.
 * Trusted operator/config surface — same class as task-pipeline's
 * `qualityGateCmd`, never interpolated from untrusted input.
 */
export const DEFAULT_FEATURE_VERIFICATION_CMD = 'bun run spur-check-feature';

/** Identity of the selected verifier definition, recorded inside the receipt. */
export interface FeatureVerifierIdentity {
    /** Definition name as resolved (the workflow key, e.g. `feature-verification`). */
    name: string;
    /** Absolute path of the resolved workflow definition file (diagnostic; not part of the identity check). */
    sourcePath: string;
    /** Resolution layer of the definition (`project`, `registered` or `shared`). */
    layer: string;
    /** Content digest of the resolved definition file. */
    definitionDigest: string;
}

/** Receipt lifecycle status. Only PASS satisfies the completion boundary. */
export type FeatureReceiptStatus = 'RUNNING' | 'PASS' | 'FAIL';

/** Durable receipt for one feature-scoped verification pass (schema v1). */
export interface FeatureVerificationReceipt {
    /** Receipt schema version; validation rejects other versions as malformed. */
    schemaVersion: typeof FEATURE_RECEIPT_SCHEMA_VERSION;
    /** Feature the evidence belongs to (validated at the completion boundary). */
    featureId: string;
    /** Workflow run that recorded the receipt (authoritative writer). */
    runId: string;
    /** Working directory the pass ran in (diagnostic; digest is path-relative). */
    workdir: string;
    /** Selected verifier definition identity at pass time. */
    verifier: FeatureVerifierIdentity;
    /** Verifier contract — the effective check command that produced the evidence. */
    verificationCmd: string;
    /** Proof-input fingerprint over feature markdown + checked tree after the pass. */
    inputDigest: string;
    /** Outcome of the verification pass. Only PASS satisfies completion. */
    status: FeatureReceiptStatus;
    /** ISO-8601 UTC start time of the pass. */
    startedAt: string;
    /** ISO-8601 UTC completion time; null while RUNNING. */
    completedAt: string | null;
}

/** Artifact paths for one feature's verification evidence. */
export interface FeatureReceiptPaths {
    /** Run-scoped bound receipt: `.spur/run/<runId>-feature-verification.json`. */
    runScoped: string;
    /** Feature-latest bound receipt: `.spur/run/<featureId>-feature-verification.json`. */
    featureScoped: string;
    /** Verification command output log (run-scoped). */
    log: string;
    /** Coarse PASS/FAIL status — workflow-internal routing only, never completion authority. */
    status: string;
}

/**
 * Feature ids and run ids become literal filename segments under `.spur/run`;
 * only unambiguous single-segment ids are accepted (no separators, no `..`),
 * which confines every receipt path to the run directory by construction.
 */
const RECEIPT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Assert an id is safe to embed in a receipt filename (path confinement). */
function assertReceiptId(kind: string, id: string): void {
    if (!RECEIPT_ID_PATTERN.test(id) || id.includes('..')) {
        throw new Error(`invalid ${kind} for receipt path: ${JSON.stringify(id)}`);
    }
}

/** Resolve the receipt artifact paths under `runDir`. Throws on unsafe ids. */
export function featureReceiptPaths(runDir: string, featureId: string, runId: string): FeatureReceiptPaths {
    assertReceiptId('featureId', featureId);
    assertReceiptId('runId', runId);
    return {
        runScoped: join(runDir, `${runId}-feature-verification.json`),
        featureScoped: join(runDir, `${featureId}-feature-verification.json`),
        log: join(runDir, `${runId}-feature-verification.log`),
        status: join(runDir, `${runId}-feature-verification.status`),
    };
}

/**
 * Atomically replace a receipt copy: write the temp sibling, then rename over
 * the target, both inside `.spur/run` so a concurrent reader never observes a
 * torn JSON document.
 */
async function atomicWriteReceipt(fs: FileSystem, path: string, receipt: FeatureVerificationReceipt): Promise<void> {
    const body = `${JSON.stringify(receipt, null, 4)}\n`;
    const tmp = `${path}.tmp`;
    await fs.writeFile(tmp, body);
    await fs.rename(tmp, path);
}

/** Inputs for starting a verification pass: who runs what, against which inputs. */
export interface StartFeatureReceiptOptions {
    featureId: string;
    runId: string;
    workdir: string;
    verifier: FeatureVerifierIdentity;
    verificationCmd: string;
    /** Before-pass proof-input digest (compared with the after digest at completion). */
    inputDigest: string;
    startedAt?: string;
}

/**
 * Record the RUNNING receipt (both copies) for a verification pass. The
 * feature-latest copy is overwritten first, superseding any older PASS before
 * the pass result exists — a crash mid-pass can never leave stale PASS
 * evidence behind.
 */
export async function startFeatureVerificationReceipt(
    fs: FileSystem,
    runDir: string,
    options: StartFeatureReceiptOptions,
): Promise<FeatureVerificationReceipt> {
    const receipt: FeatureVerificationReceipt = {
        schemaVersion: FEATURE_RECEIPT_SCHEMA_VERSION,
        featureId: options.featureId,
        runId: options.runId,
        workdir: options.workdir,
        verifier: options.verifier,
        verificationCmd: options.verificationCmd,
        inputDigest: options.inputDigest,
        status: 'RUNNING',
        startedAt: options.startedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        completedAt: null,
    };
    const paths = featureReceiptPaths(runDir, options.featureId, options.runId);
    await fs.ensureDir(runDir);
    await atomicWriteReceipt(fs, paths.runScoped, receipt);
    await atomicWriteReceipt(fs, paths.featureScoped, receipt);
    return receipt;
}

/** Inputs for completing a pass: the RUNNING receipt plus the observed outcome. */
export interface CompleteFeatureReceiptOptions {
    status: Exclude<FeatureReceiptStatus, 'RUNNING'>;
    /** After-pass proof-input digest; defaults to the before digest (PASS when equal). */
    inputDigest?: string;
    completedAt?: string;
}

/**
 * Record the terminal PASS/FAIL receipt (both copies). The digest stored is
 * the after-pass digest, so a PASS receipt is exactly the claim the completion
 * boundary re-validates.
 */
export async function completeFeatureVerificationReceipt(
    fs: FileSystem,
    runDir: string,
    running: FeatureVerificationReceipt,
    options: CompleteFeatureReceiptOptions,
): Promise<FeatureVerificationReceipt> {
    if (running.status !== 'RUNNING') {
        throw new Error(`receipt for run ${running.runId} is already ${running.status}`);
    }
    const receipt: FeatureVerificationReceipt = {
        ...running,
        status: options.status,
        inputDigest: options.inputDigest ?? running.inputDigest,
        completedAt: options.completedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    const paths = featureReceiptPaths(runDir, receipt.featureId, receipt.runId);
    await fs.ensureDir(runDir);
    await atomicWriteReceipt(fs, paths.runScoped, receipt);
    await atomicWriteReceipt(fs, paths.featureScoped, receipt);
    await fs.writeFile(paths.status, `${receipt.status}\n`);
    return receipt;
}

/**
 * Read-only ports over the engine run store, injected so this module stays
 * filesystem-pure. The CLI command wires them to `RunDao`/`ArtifactDao`.
 */
export interface FeatureReceiptRunPort {
    /**
     * Read the run row for `runId`: terminal status plus the persisted
     * definition digest and effective vars (JSON) captured when the run
     * attached. `undefined` when the row does not exist.
     */
    readRunRow?: (runId: string) => Promise<
        | {
              status: string;
              definitionDigest?: string | null;
              varsJson?: string | null;
          }
        | undefined
    >;
    /** True when the run registered an artifact at `path` (run.artifact action). */
    hasArtifact?: (runId: string, path: string) => Promise<boolean>;
}

/** Why a receipt failed validation (each maps to an unsuppressible finding code). */
export type FeatureReceiptRejection =
    | 'missing'
    | 'malformed'
    | 'cross-feature'
    | 'divergent'
    | 'failed'
    | 'run'
    | 'contract-mismatch'
    | 'stale';

/** Currently selected verifier contract the receipt is validated against. */
export interface ValidateFeatureReceiptOptions {
    featureId: string;
    runDir: string;
    /** Current proof-input digest over the checked inputs. */
    currentDigest: string;
    /** Currently selected verifier definition identity (from the workflow resolver). */
    currentVerifier: FeatureVerifierIdentity;
    /** Configured check command of the currently selected definition. */
    currentVerificationCmd: string;
    /** Run-store ports; omitted when the caller cannot observe the run store. */
    runPort?: FeatureReceiptRunPort;
}

/** Result of receipt validation: the bound receipt, or a fail-closed rejection with detail. */
export type FeatureReceiptValidation =
    | { ok: true; receipt: FeatureVerificationReceipt }
    | { ok: false; reason: FeatureReceiptRejection; detail: string };

/** Structural validation of one parsed receipt copy. Returns the typed receipt. */
function parseReceipt(raw: string): FeatureVerificationReceipt {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new Error(`not JSON (${String(err)})`);
    }
    if (parsed === null || typeof parsed !== 'object') {
        throw new Error('not an object');
    }
    const r = parsed as Partial<FeatureVerificationReceipt>;
    if (r.schemaVersion !== FEATURE_RECEIPT_SCHEMA_VERSION) {
        throw new Error(`schemaVersion must be ${FEATURE_RECEIPT_SCHEMA_VERSION}`);
    }
    const v = r.verifier as Partial<FeatureVerifierIdentity> | undefined;
    if (
        typeof r.featureId !== 'string' ||
        typeof r.runId !== 'string' ||
        typeof r.workdir !== 'string' ||
        typeof v?.name !== 'string' ||
        typeof v?.sourcePath !== 'string' ||
        typeof v?.layer !== 'string' ||
        typeof v?.definitionDigest !== 'string' ||
        typeof r.verificationCmd !== 'string' ||
        typeof r.inputDigest !== 'string' ||
        (r.status !== 'RUNNING' && r.status !== 'PASS' && r.status !== 'FAIL') ||
        typeof r.startedAt !== 'string' ||
        (r.completedAt !== null && typeof r.completedAt !== 'string')
    ) {
        throw new Error('required fields missing or mistyped');
    }
    return parsed as FeatureVerificationReceipt;
}

/** Read one receipt copy; throws the fail-closed missing/malformed detail. */
async function readReceiptCopy(fs: FileSystem, path: string, label: string): Promise<FeatureVerificationReceipt> {
    let raw: string;
    try {
        raw = await fs.readFile(path);
    } catch {
        throw new Error(`no ${label} receipt at ${path}; run the feature-scoped verification pass`);
    }
    try {
        return parseReceipt(raw);
    } catch (err) {
        throw new Error(`${label} receipt at ${basename(path)} is not a valid schema-v1 artifact (${String(err)})`);
    }
}

/**
 * Validate a feature's receipt against the currently selected verifier
 * contract and the current checked-input digest. Rejections are ordered
 * cheapest-first; every rejection is fail-closed.
 */
export async function validateFeatureVerificationReceipt(
    fs: FileSystem,
    options: ValidateFeatureReceiptOptions,
): Promise<FeatureReceiptValidation> {
    // The feature-latest copy carries the authoritative runId for the newest
    // attempt; both copies must then agree byte-for-byte.
    let latest: FeatureVerificationReceipt;
    try {
        latest = await readReceiptCopy(
            fs,
            join(options.runDir, `${options.featureId}-feature-verification.json`),
            'feature-latest',
        );
    } catch (err) {
        const message = String(err);
        return {
            ok: false,
            reason: message.includes('not a valid') ? 'malformed' : 'missing',
            detail: message,
        };
    }

    const paths = featureReceiptPaths(options.runDir, options.featureId, latest.runId);
    try {
        const runScoped = await readReceiptCopy(fs, paths.runScoped, 'run-scoped');
        if (JSON.stringify(runScoped) !== JSON.stringify(latest)) {
            return {
                ok: false,
                reason: 'divergent',
                detail: `run-scoped ${paths.runScoped} and feature-latest receipts disagree — a newer attempt started or the evidence was tampered with`,
            };
        }
    } catch (err) {
        const message = String(err);
        return {
            ok: false,
            reason: message.includes('not a valid') ? 'malformed' : 'missing',
            detail: message,
        };
    }

    if (latest.featureId !== options.featureId) {
        return {
            ok: false,
            reason: 'cross-feature',
            detail: `receipt belongs to feature "${latest.featureId}", not "${options.featureId}"`,
        };
    }
    if (latest.status === 'FAIL') {
        return {
            ok: false,
            reason: 'failed',
            detail: `verification pass recorded FAIL (started ${latest.startedAt}, ended ${latest.completedAt})`,
        };
    }
    if (latest.status === 'RUNNING') {
        return {
            ok: false,
            reason: 'run',
            detail: `verification pass is still RUNNING (started ${latest.startedAt}); no completion evidence exists`,
        };
    }

    // Run-row integrity: the recording run must be terminal done with its
    // persisted definition identity and effective vars agreeing with the
    // receipt, and the receipt path must be a registered run artifact.
    if (options.runPort?.readRunRow) {
        const row = await options.runPort.readRunRow(latest.runId);
        if (!row) {
            return {
                ok: false,
                reason: 'run',
                detail: `run ${latest.runId} that recorded the receipt does not exist in the run store`,
            };
        }
        if (row.status !== 'done') {
            return {
                ok: false,
                reason: 'run',
                detail: `run ${latest.runId} is "${row.status}", not terminal done — the recording run never finished`,
            };
        }
        if (row.definitionDigest && row.definitionDigest !== latest.verifier.definitionDigest) {
            return {
                ok: false,
                reason: 'run',
                detail: `run ${latest.runId} attached with definition digest ${row.definitionDigest}, receipt records ${latest.verifier.definitionDigest}`,
            };
        }
        let recordedCmd: string | undefined;
        try {
            const vars: unknown = row.varsJson ? JSON.parse(row.varsJson) : undefined;
            if (
                vars &&
                typeof vars === 'object' &&
                typeof (vars as { verificationCmd?: unknown }).verificationCmd === 'string'
            ) {
                recordedCmd = (vars as { verificationCmd: string }).verificationCmd;
            }
        } catch {
            recordedCmd = undefined;
        }
        if (recordedCmd !== undefined && recordedCmd !== latest.verificationCmd) {
            return {
                ok: false,
                reason: 'run',
                detail: `run ${latest.runId} recorded effective command "${recordedCmd}", receipt records "${latest.verificationCmd}"`,
            };
        }
        if (options.runPort.hasArtifact && !(await options.runPort.hasArtifact(latest.runId, paths.runScoped))) {
            return {
                ok: false,
                reason: 'run',
                detail: `receipt ${basename(paths.runScoped)} is not registered as an artifact of run ${latest.runId}`,
            };
        }
    }

    // Verifier contract: the receipt must match the currently selected
    // definition identity and its configured command — a `--cmd` override that
    // differs from the configured command records a receipt but can never
    // satisfy completion. Identity is name + layer + content digest; the
    // absolute `sourcePath` is diagnostic only — bundled and source-local CLIs
    // resolve the same shared definition from different install paths (0957).
    const verifier = latest.verifier;
    const current = options.currentVerifier;
    const drifted = (['name', 'layer', 'definitionDigest'] as const).filter((k) => verifier[k] !== current[k]);
    if (drifted.length > 0) {
        return {
            ok: false,
            reason: 'contract-mismatch',
            detail: `receipt recorded verifier ${verifier.name}@${verifier.layer} (${verifier.definitionDigest}), completion evaluates ${current.name}@${current.layer} (${current.definitionDigest}) — the selected definition changed after the pass (${drifted.join(', ')})`,
        };
    }
    if (latest.verificationCmd !== options.currentVerificationCmd) {
        return {
            ok: false,
            reason: 'contract-mismatch',
            detail: `receipt recorded with verifier "${latest.verificationCmd}", completion evaluates the configured command "${options.currentVerificationCmd}"`,
        };
    }
    if (latest.inputDigest !== options.currentDigest) {
        return {
            ok: false,
            reason: 'stale',
            detail: `receipt digest ${latest.inputDigest} ≠ current inputs ${options.currentDigest} — tree, spec, learnings or check contract changed after the pass`,
        };
    }
    return { ok: true, receipt: latest };
}

/**
 * Capture the current checked-input digest for a feature: shared proof-input
 * fingerprint engine over the feature markdown plus the git tree and optional
 * learnings content (R4). Throws `ProofCaptureError` on git failure — callers
 * must fail closed.
 */
export async function captureFeatureReceiptDigest(
    repoRoot: string,
    featureContent: string,
    learningsContent?: string,
): Promise<string> {
    return ProofInputFingerprint.compute({ cwd: repoRoot, featureContent, learningsContent });
}

/** True when the capture failure should surface as the stale/deny path (fail-closed). */
export function isProofCaptureError(err: unknown): err is ProofCaptureError {
    return err instanceof ProofCaptureError;
}
