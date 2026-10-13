/**
 * Feature verification run — the single feature-receipt writer (task 1176 R2, ADR-130).
 *
 * The `feature-verification` workflow's one pass lives here: resolve the selected definition, capture
 * the before proof digest, record the RUNNING receipt (both copies) and register the run-scoped
 * receipt as a run artifact, run the effective command through the safe argv splitter (never `sh -c`),
 * capture the after digest, then complete the receipt PASS/FAIL plus the coarse status file.
 *
 * Ownership: the plugin entry (`plugins/sp/scripts/feature-verification-steps.ts`) keeps argv, usage
 * and exit codes only. It no longer opens the project DB, constructs an `ArtifactDao`, or scans a
 * feature directory — those are application concerns and this module owns them. Every seam below is
 * injectable for tests (in-memory filesystem, canned launcher, canned receipts, in-memory artifact
 * registration), with the application defaults used in production.
 */

import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { ArtifactDao } from '@gobing-ai/spur-domain';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { resolvePlanningFolders } from '../config/planning-folders';
import { openInlineRunProjectDb } from '../services/inline-run-setup';
import {
    captureFeatureReceiptDigest,
    completeFeatureVerificationReceipt,
    FEATURE_RECEIPT_CONFIDENCE_LEVELS,
    type FeatureReceiptConfidence,
    type FeatureVerificationReceipt,
    featureReceiptPaths,
    startFeatureVerificationReceipt,
} from './feature-verification-receipt';
import { splitLaunchCommand } from './split-launch-command';
import { resolveWorkflowDefinition } from './workflow-resolver';

/** Single safe filename component — the same class as the inline-run run-id guard. */
export const SAFE_RECEIPT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The pass ceiling for the effective command (unchanged from the plugin entry: 4 h). */
export const FEATURE_VERIFICATION_TIMEOUT_MS = 4 * 60 * 60 * 1000;

/** Refuse ids that could escape the run directory through receipt filenames. */
export function assertSafeReceiptId(kind: string, id: string): void {
    if (!SAFE_RECEIPT_ID_RE.test(id) || id.includes('..')) {
        throw new Error(`refusing unsafe ${kind}: ${id}`);
    }
}

/** A resolved feature spec: its file path and content. */
export interface FeatureSpec {
    path: string;
    content: string;
}

/** Look up a feature's spec file by id through the configured planning folders. */
export type FeatureSpecLookup = (featureId: string) => Promise<FeatureSpec | null>;

/**
 * The app-owned feature lookup (task 1176 R2). Resolution goes through the resolved planning folders
 * (`resolvePlanningFolders`), so a project that keeps its corpus elsewhere is honoured — the plugin
 * used to hardcode `docs/features` and scan it by filename prefix.
 *
 * Deliberately not `FeatureService.show`: that context requires a `PlanningWriteService`, and every
 * current call site composes one from a CLI context. A read-only verification pass has no business
 * constructing a write service, so this mirrors `show`'s read path over the same FileSystem port.
 */
export async function createFeatureLookup(
    workdir: string,
    fileSystem: FileSystem = createNodeFileSystem(),
): Promise<FeatureSpecLookup> {
    const folders = await resolvePlanningFolders(fileSystem);
    // The configured directory is project-relative; resolve it against the caller's workdir rather
    // than the process cwd, so a pass started from another directory still finds the corpus.
    const featuresDir = isAbsolute(folders.featuresDir) ? folders.featuresDir : join(workdir, folders.featuresDir);
    return async (featureId: string): Promise<FeatureSpec | null> => {
        if (!(await fileSystem.exists(featuresDir))) return null;
        const names = (await fileSystem.readDir(featuresDir)).filter(
            (name) => name.startsWith(`${featureId}_`) && name.endsWith('.md'),
        );
        const name = names.find(() => true);
        if (name === undefined) return null;
        const path = join(featuresDir, name);
        return { path, content: await fileSystem.readFile(path) };
    };
}

/** Minimal launcher shape (injectable; defaults to `spawnSync`). */
export interface LaunchResultLike {
    status?: number | null;
}

/** The process launcher seam (defaults to `spawnSync`; injected by tests). */
export type LaunchLike = (
    command: string,
    args: string[],
    options: { cwd: string; stdio: ['ignore', number, number]; timeout: number },
) => LaunchResultLike;

/** The receipt writer seams the operation consumes (never a second implementation of them). */
export interface FeatureReceiptSeams {
    start: typeof startFeatureVerificationReceipt;
    complete: typeof completeFeatureVerificationReceipt;
    captureDigest: typeof captureFeatureReceiptDigest;
}

/** One verification pass: identity, workdir, and the injectable seams around it. */
export interface FeatureVerificationRunInput {
    workdir: string;
    featureId: string;
    runId: string;
    /** Explicit command override (`--cmd`); empty/absent uses the selected definition's command. */
    cmdOverride?: string;
    fileSystem?: FileSystem;
    launch?: LaunchLike;
    openLog?: (path: string) => number;
    closeLog?: (fd: number) => void;
    resolveDefinition?: typeof resolveWorkflowDefinition;
    splitCommand?: typeof splitLaunchCommand;
    receipts?: FeatureReceiptSeams;
    resolveFeatureSpec?: FeatureSpecLookup;
    readLearnings?: (workdir: string) => Promise<string | undefined>;
    registerArtifact?: (input: { runId: string; path: string; kind: string }) => Promise<void>;
    /**
     * Operator-declared level, overriding the derivation. Useful when the honest level is not the
     * derived one (e.g. the check set ran green but the operator knows the evidence is thin).
     * An unknown value is refused, like every other contract violation in this module.
     */
    confidenceOverride?: string;
    /**
     * Operator acknowledgement of a LOW level. Recorded on the receipt — the completion boundary
     * accepts LOW exactly when the receipt carries it.
     */
    ackLowConfidence?: boolean;
}

/** The pass outcome: its status plus the paths and message the caller reports. */
export interface FeatureVerificationRunResult {
    status: 'PASS' | 'FAIL';
    featureId: string;
    runId: string;
    effectiveCmd: string;
    logPath: string;
    receiptPath: string;
    message: string;
    /** Derived (or operator-declared) level recorded on the receipt. */
    confidence: FeatureReceiptConfidence;
    /** Evidence the level rests on, recorded on the receipt. */
    confidenceBasis: string[];
}

/**
 * Derive the completion level from what the pass actually measured.
 *
 * The level is never a model's opinion: it is a function of the pass's own evidence — whether the
 * command the selected definition declares is the one that ran, whether it exited 0, and whether
 * the proof-input digest was unchanged across the pass (a change already records FAIL).
 *
 * - `HIGH` — the declared command exited 0 and the checked inputs did not move.
 * - `MEDIUM` — the same clean pass, but under a caller command override: evidence is real, yet it
 *   certifies a different check set than the definition declares (the override is recorded on the
 *   receipt as `verificationCmd` and cannot complete alone).
 * - `LOW` — any non-PASS, or an explicit operator declaration below the derived level.
 */
export function deriveFeatureConfidence(input: {
    status: 'PASS' | 'FAIL';
    configuredCmd: string;
    effectiveCmd: string;
    inputDigest: string;
    afterDigest?: string;
    override?: string;
}): { confidence: FeatureReceiptConfidence; basis: string[] } {
    const override = input.override === undefined || input.override === '' ? undefined : input.override;
    const measured: string[] = [];
    if (input.status === 'PASS') measured.push('verification command exited 0');
    else measured.push('verification command did not exit 0');
    if (input.afterDigest !== undefined) {
        measured.push(
            input.afterDigest === input.inputDigest
                ? 'proof-input digest unchanged across the pass'
                : 'proof-input digest changed across the pass',
        );
    }
    if (input.status !== 'PASS') return { confidence: 'LOW', basis: measured };
    const derived: FeatureReceiptConfidence = input.effectiveCmd === input.configuredCmd ? 'HIGH' : 'MEDIUM';
    if (input.effectiveCmd !== input.configuredCmd) {
        measured.push(`caller command override: ${input.effectiveCmd}`);
        measured.push(`the selected definition declares: ${input.configuredCmd}`);
    }
    if (override === undefined) return { confidence: derived, basis: measured };
    // The declaration is recorded first so a reader sees a human decision before the measurements
    // that would otherwise have decided it — and never mistakes a declared level for a derived one.
    return { confidence: override as FeatureReceiptConfidence, basis: [`operator-declared ${override}`, ...measured] };
}

/** Refuse an operator-declared level outside the enum (mirrors the other contract refusals here). */
function assertConfidenceOverride(raw: string | undefined): FeatureReceiptConfidence | undefined {
    if (raw === undefined || raw === '') return undefined;
    const upper = raw.toUpperCase();
    if (!(FEATURE_RECEIPT_CONFIDENCE_LEVELS as readonly string[]).includes(upper)) {
        throw new Error(`confidence must be HIGH, MEDIUM or LOW (got ${JSON.stringify(raw)})`);
    }
    return upper as FeatureReceiptConfidence;
}

/** Record the run-scoped receipt as a run artifact through the application's own DB facade. */
async function defaultRegisterArtifact(
    workdir: string,
    artifact: { runId: string; path: string; kind: string },
): Promise<void> {
    const db = await openInlineRunProjectDb(workdir);
    try {
        await new ArtifactDao(db.adapter as never).record(artifact);
    } finally {
        db.close();
    }
}

async function defaultReadLearnings(fileSystem: FileSystem, workdir: string): Promise<string | undefined> {
    const path = join(workdir, '.spur', 'context', 'learnings.md');
    return (await fileSystem.exists(path)) ? fileSystem.readFile(path) : undefined;
}

/**
 * One full verification pass for one feature. Returns the status; it never decides the workflow's
 * transition — the status file and the completion-side receipt validation do (fail-closed).
 */
export async function runFeatureVerification(
    input: FeatureVerificationRunInput,
): Promise<FeatureVerificationRunResult> {
    assertSafeReceiptId('feature id', input.featureId);
    assertSafeReceiptId('run id', input.runId);

    const fileSystem = input.fileSystem ?? createNodeFileSystem();
    const launch: LaunchLike = input.launch ?? ((command, args, options) => spawnSync(command, args, options));
    const openLog = input.openLog ?? ((path: string): number => openSync(path, 'a'));
    const closeLog = input.closeLog ?? ((fd: number): void => closeSync(fd));
    const resolveDefinition = input.resolveDefinition ?? resolveWorkflowDefinition;
    const split = input.splitCommand ?? splitLaunchCommand;
    const receipts: FeatureReceiptSeams = input.receipts ?? {
        start: startFeatureVerificationReceipt,
        complete: completeFeatureVerificationReceipt,
        captureDigest: captureFeatureReceiptDigest,
    };
    const registerArtifact = input.registerArtifact ?? ((artifact) => defaultRegisterArtifact(input.workdir, artifact));
    const lookup = input.resolveFeatureSpec ?? (await createFeatureLookup(input.workdir, fileSystem));
    const readLearnings = input.readLearnings ?? ((workdir: string) => defaultReadLearnings(fileSystem, workdir));

    const runDir = join(input.workdir, '.spur', 'run');
    mkdirSync(runDir, { recursive: true });

    // 1. Selected verifier definition (project override wins); its configured command is the
    // completion contract — an override records but cannot complete.
    const selected = await resolveDefinition(input.workdir, 'feature-verification');
    const vars = selected.workflow.vars as { verificationCmd?: unknown } | undefined;
    const configuredCmd =
        typeof vars?.verificationCmd === 'string' && vars.verificationCmd.length > 0
            ? vars.verificationCmd
            : 'bun run spur-check-feature';
    const effectiveCmd =
        input.cmdOverride !== undefined && input.cmdOverride !== '' ? input.cmdOverride : configuredCmd;
    const confidenceOverride = assertConfidenceOverride(input.confidenceOverride);

    const spec = await lookup(input.featureId);
    if (spec === null) {
        throw new Error(`feature ${input.featureId} not found in the configured features directory`);
    }
    const learningsContent = await readLearnings(input.workdir);

    // 2. Before digest + RUNNING receipt (both copies) + artifact registration.
    const beforeDigest = await receipts.captureDigest(input.workdir, spec.content, learningsContent);
    const receipt: FeatureVerificationReceipt = await receipts.start(fileSystem, runDir, {
        featureId: input.featureId,
        runId: input.runId,
        workdir: input.workdir,
        verifier: {
            name: 'feature-verification',
            sourcePath: selected.path,
            layer: selected.layer,
            definitionDigest: selected.digest,
        },
        verificationCmd: effectiveCmd,
        inputDigest: beforeDigest,
    });
    const { runScoped } = featureReceiptPaths(runDir, input.featureId, input.runId);
    await registerArtifact({ runId: input.runId, path: runScoped, kind: 'feature-verification' });

    const logPath = join(runDir, `${input.runId}-feature-verification.log`);
    const base = { featureId: input.featureId, runId: input.runId, effectiveCmd, logPath, receiptPath: runScoped };

    // 3. Run the effective command via the safe splitter (no `sh -c` interpolation).
    const launchSplit = split(effectiveCmd, 'feature-verification verificationCmd');
    if ('error' in launchSplit) {
        const { confidence, basis } = deriveFeatureConfidence({
            status: 'FAIL',
            configuredCmd,
            effectiveCmd,
            inputDigest: beforeDigest,
            override: confidenceOverride,
        });
        await receipts.complete(fileSystem, runDir, receipt, {
            status: 'FAIL',
            inputDigest: beforeDigest,
            confidence,
            confidenceBasis: basis,
            confidenceAcknowledged: input.ackLowConfidence === true,
        });
        return {
            ...base,
            status: 'FAIL',
            confidence,
            confidenceBasis: basis,
            message: `verification FAIL (${launchSplit.error})`,
        };
    }

    const logFd = openLog(logPath);
    try {
        const result = launch(launchSplit.command, launchSplit.leadingArgs, {
            cwd: input.workdir,
            stdio: ['ignore', logFd, logFd],
            timeout: FEATURE_VERIFICATION_TIMEOUT_MS,
        });
        const exit = result.status ?? 1;

        // 4/5. After digest — a mismatch records FAIL (the pass did not verify the tree it left
        // behind); otherwise the exit code decides.
        const afterDigest = await receipts.captureDigest(input.workdir, spec.content, learningsContent);
        const status: 'PASS' | 'FAIL' = exit === 0 && afterDigest === beforeDigest ? 'PASS' : 'FAIL';
        const { confidence, basis } = deriveFeatureConfidence({
            status,
            configuredCmd,
            effectiveCmd,
            inputDigest: beforeDigest,
            afterDigest,
            override: confidenceOverride,
        });
        await receipts.complete(fileSystem, runDir, receipt, {
            status,
            inputDigest: afterDigest,
            confidence,
            confidenceBasis: basis,
            confidenceAcknowledged: input.ackLowConfidence === true,
        });
        return {
            ...base,
            status,
            confidence,
            confidenceBasis: basis,
            message: `verification ${status} (run ${input.runId}, confidence ${confidence}, log ${logPath})`,
        };
    } finally {
        closeLog(logFd);
    }
}
