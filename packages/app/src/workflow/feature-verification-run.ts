/**
 * Feature verification run — the single feature-receipt writer (task 1176 R2, ADR-130).
 *
 * The feature-scoped verification pass lives here (its `feature-verification` wrapper workflow was
 * retired by task 1246; `feature-lifecycle`'s `verifying` entry calls the verb directly):
 * resolve the selected definition, capture
 * the before proof digest, record the RUNNING receipt (both copies) and register the run-scoped
 * receipt as a run artifact, run the effective command through the safe argv splitter (never `sh -c`),
 * capture the after digest, then complete the receipt PASS/FAIL plus the coarse status file.
 *
 * Ownership: the CLI verb (`spur feature verify`, apps/cli/src/commands/feature/verify.ts; it replaced
 * the plugin script `feature-verification-steps` in script-absorption PR-5) keeps argv, usage and
 * exit codes only. It no longer opens the project DB, constructs an `ArtifactDao`, or scans a
 * feature directory — those are application concerns and this module owns them. Every seam below is
 * injectable for tests (in-memory filesystem, canned launcher, canned receipts, in-memory artifact
 * registration), with the application defaults used in production.
 */

import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { ArtifactDao, createId } from '@gobing-ai/spur-domain';
import { DbWorkflowPersistenceAdapter } from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { resolvePlanningFolders } from '../config/planning-folders';
import { openInlineRunProjectDb } from '../services/inline-run-attribution';
import { withRunIdentityRecording, workflowVersionLiteral } from '../services/workflow-run-recording';
import {
    captureFeatureReceiptDigest,
    completeFeatureVerificationReceipt,
    DEFAULT_FEATURE_VERIFICATION_CMD,
    FEATURE_VERIFIER_DEFINITION,
    type FeatureVerificationReceipt,
    featureReceiptPaths,
    startFeatureVerificationReceipt,
} from './feature-verification-receipt';
import { splitLaunchCommand } from './split-launch-command';
import { type ResolvedWorkflowDefinition, resolveWorkflowDefinition } from './workflow-resolver';

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

/**
 * The run row a pass opens for itself when the caller supplies no `--run-id` (task 1246 R2).
 *
 * Two calls rather than one scope-holding helper: the pass's command may run for hours, and the
 * project DB handle must not be held across it.
 */
export interface FeatureVerificationPassRun {
    /** Open a `running` row bound to the resolved definition; returns its run id. */
    open: (selected: ResolvedWorkflowDefinition) => Promise<string>;
    /** Close the row with a terminal status once the pass has completed (or failed to run). */
    finalize: (runId: string, status: 'done' | 'failed') => Promise<void>;
}

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
    /** Caller-owned run id; empty means the pass opens and finalizes its own row (1246 R2). */
    runId: string;
    /** Explicit command override (`--cmd`); empty/absent uses the configured command. */
    cmdOverride?: string;
    passRun?: FeatureVerificationPassRun;
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

/**
 * The production run-row seam (1246 R2): the pass's own row goes through the same engine
 * persistence adapter and identity stamp every other run uses, so `workflow trace`/`list` and the
 * receipt's run-row integrity check see an ordinary `feature-lifecycle` row. No external key — the
 * lifecycle's own `feature:<id>` run is a different row and must never be adopted here.
 */
function defaultPassRun(workdir: string): FeatureVerificationPassRun {
    return {
        open: async (selected) => {
            const runId = createId('run');
            const db = await openInlineRunProjectDb(workdir);
            try {
                const persistence = withRunIdentityRecording(
                    new DbWorkflowPersistenceAdapter(db.adapter as never),
                    db.adapter as never,
                    {
                        definitionDigest: selected.digest,
                        workflowVersion: workflowVersionLiteral(selected.workflow),
                        source: { path: selected.path, layer: selected.layer, workdir: resolve(workdir) },
                    },
                );
                await persistence.createRun({
                    id: runId,
                    workflow_name: FEATURE_VERIFIER_DEFINITION,
                    mode: 'state-machine',
                    status: 'running',
                    started_at: new Date().toISOString(),
                    completed_at: null,
                    metadata_json: '{}',
                });
            } finally {
                db.close();
            }
            return runId;
        },
        finalize: async (runId, status) => {
            const db = await openInlineRunProjectDb(workdir);
            try {
                await new DbWorkflowPersistenceAdapter(db.adapter as never).finalizeRun(
                    runId,
                    status,
                    new Date().toISOString(),
                    undefined,
                    status,
                );
            } finally {
                db.close();
            }
        },
    };
}

async function defaultReadLearnings(fileSystem: FileSystem, workdir: string): Promise<string | undefined> {
    const path = join(workdir, '.spur', 'context', 'learnings.md');
    return (await fileSystem.exists(path)) ? fileSystem.readFile(path) : undefined;
}

/**
 * One full verification pass for one feature. Returns the status; it never decides the workflow's
 * transition — the status file and the completion-side receipt validation do (fail-closed).
 *
 * A pass that cannot RUN still leaves the coarse FAIL (task 1238 R1): the workflow's verify step is
 * now a `command.gate` over this operation instead of the shell that used to append
 * `|| printf 'FAIL …' > …status`, so this operation owns that write. Without it a cannot-run pass
 * left NO status file, which the transition guards cannot tell from a pass still in flight.
 */
export async function runFeatureVerification(
    input: FeatureVerificationRunInput,
): Promise<FeatureVerificationRunResult> {
    // The verifier definition is resolved once here: it is both the receipt's recorded identity
    // and — when this pass owns its run id — the definition the run row is bound to.
    const resolveDefinition = input.resolveDefinition ?? resolveWorkflowDefinition;
    const selected = await resolveDefinition(input.workdir, FEATURE_VERIFIER_DEFINITION);

    // 1246 R2: without an explicit `--run-id` the verb owns its run identity. An explicit id keeps
    // today's behaviour — the caller's run owns the row and finalizes it.
    if (input.runId !== '') {
        try {
            return await runFeatureVerificationPass(input, selected);
        } catch (error) {
            await writeFailedStatus(input);
            throw error;
        }
    }

    const passRun = input.passRun ?? defaultPassRun(input.workdir);
    const runId = await passRun.open(selected);
    const owned = { ...input, runId };
    try {
        const result = await runFeatureVerificationPass(owned, selected);
        // A completed pass closes its row `done` whether it recorded PASS or FAIL: the verdict is
        // the receipt's, not the run's. Only a pass that could not run leaves a `failed` row.
        await passRun.finalize(runId, 'done');
        return result;
    } catch (error) {
        await writeFailedStatus(owned);
        await passRun.finalize(runId, 'failed');
        throw error;
    }
}

/**
 * Best-effort coarse FAIL for a pass that threw before it could complete. Never masks the original
 * error: an unwritable status file (unsafe ids, a missing workdir) is swallowed here and the
 * caller still sees the pass's own failure.
 */
async function writeFailedStatus(input: FeatureVerificationRunInput): Promise<void> {
    try {
        const paths = featureReceiptPaths(join(input.workdir, '.spur', 'run'), input.featureId, input.runId);
        const fileSystem = input.fileSystem ?? createNodeFileSystem();
        await fileSystem.ensureDir(join(input.workdir, '.spur', 'run'));
        await fileSystem.writeFile(paths.status, 'FAIL\n');
    } catch {
        // The pass's own error is the report; a status file nobody asked to write cannot replace it.
    }
}

/** The pass itself — {@link runFeatureVerification} owns the run row and cannot-run status. */
async function runFeatureVerificationPass(
    input: FeatureVerificationRunInput,
    selected: ResolvedWorkflowDefinition,
): Promise<FeatureVerificationRunResult> {
    assertSafeReceiptId('feature id', input.featureId);
    assertSafeReceiptId('run id', input.runId);

    const fileSystem = input.fileSystem ?? createNodeFileSystem();
    const launch: LaunchLike = input.launch ?? ((command, args, options) => spawnSync(command, args, options));
    const openLog = input.openLog ?? ((path: string): number => openSync(path, 'a'));
    const closeLog = input.closeLog ?? ((fd: number): void => closeSync(fd));
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

    // 1. The configured command is the completion contract — an override records but cannot
    // complete. 1246 R5: the retired wrapper's `verificationCmd` var is gone, so record-time and
    // completion-time both read the one default constant and cannot drift.
    const effectiveCmd =
        input.cmdOverride !== undefined && input.cmdOverride !== ''
            ? input.cmdOverride
            : DEFAULT_FEATURE_VERIFICATION_CMD;

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
            name: FEATURE_VERIFIER_DEFINITION,
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
    const launchSplit = split(effectiveCmd, 'feature verification command');
    if ('error' in launchSplit) {
        await receipts.complete(fileSystem, runDir, receipt, {
            status: 'FAIL',
            inputDigest: beforeDigest,
        });
        return {
            ...base,
            status: 'FAIL',
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
        await receipts.complete(fileSystem, runDir, receipt, {
            status,
            inputDigest: afterDigest,
        });
        return {
            ...base,
            status,
            message: `verification ${status} (run ${input.runId}, log ${logPath})`,
        };
    } finally {
        closeLog(logFd);
    }
}
