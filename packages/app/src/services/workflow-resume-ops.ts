import { isAbsolute, join } from 'node:path';
import { normalizePersistedWorkflowLayer, RunDao, type RunDefinitionSource } from '@gobing-ai/spur-domain';
import { DbWorkflowPersistenceAdapter } from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem, NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import { ValidationError } from '@gobing-ai/ts-utils';
import {
    checkpointStaleness,
    isTerminalCheckpointStatus,
    parseCheckpointMetadata,
} from '../workflow/checkpoint-contract';
import { gateSitesForState, hitlAnswerVar } from '../workflow/composition-lint';
import { attachHostPause, hostExecutorPersisted, withHostExecutorPause } from '../workflow/host-executor';
import { projectWorkflowProgress } from '../workflow/progress-projection';
import {
    readReceipt,
    readWorkItem,
    validateWorkItemReceipt,
    type WorkItemReceipt,
    writeReceipt,
} from '../workflow/receipt';
import {
    type ResolvedWorkflowDefinition,
    registeredWorkflowPaths,
    resolveWorkflowDefinition,
} from '../workflow/workflow-resolver';
import { bridgeEventBus, dropRetiredActionBoundaryAliases, withWorkflowIdentity } from './event-bridge';
import type { WorkflowEngineFactory } from './workflow-engine-factory';
import type { WorkflowRunOps } from './workflow-run-ops';
import { workflowVersionLiteral } from './workflow-run-recording';
import type {
    ContinuePausedOptions,
    GateActionKind,
    PendingGate,
    WorkflowAppService,
    WorkflowAppServiceContext,
    WorkflowRunResult,
} from './workflow-service';

/**
 * 0932 R2: the rejection message for an answer flag that does not match the
 * gate the run is actually paused on — it names the pending gate kind and state.
 */
function pendingGateMismatchMessage(
    runId: string,
    gate: PendingGate | null,
    flag: '--answer' | '--answer-text',
): string {
    const pending =
        gate === null
            ? 'the run has no pending gate action'
            : `the run is paused at state "${gate.stateId}" on a ${gate.kind} gate`;
    const requires =
        flag === '--answer-text'
            ? '--answer-text requires a pending hitl.input gate'
            : '--answer requires a pending hitl.confirm or hitl.select gate';
    return `Cannot resume run "${runId}": ${pending} — ${requires} (0932 R2). Resume refused; nothing was mutated.`;
}

/**
 * `workflow continue` for {@link WorkflowAppService}: resumable-definition resolution, checkpoint
 * freshness validation, pending-gate lookup and answer-var resolution (0901/0932).
 */
export class WorkflowResumeOps {
    constructor(
        private readonly host: WorkflowAppService,
        private readonly ctx: WorkflowAppServiceContext,
        private readonly engine: WorkflowEngineFactory,
        private readonly runOps: WorkflowRunOps,
    ) {}

    /** Implementation of {@link WorkflowAppService.continuePaused} (see its doc comment for the contract). */
    async continuePaused(runId: string, opts?: ContinuePausedOptions): Promise<WorkflowRunResult> {
        // Same dual-bus wiring as run() (task 0370): adapter verb-form events via
        // observabilityBus inside createEngineService, engine-native names via the
        // resume options `events` field. CLI attaches a SystemEventDao tap to both.
        const eventsBus = this.ctx.events?.();
        // Locate the paused run via RunDao (no engine service needed yet) so the
        // workflow def is available for extension loading (0533 R1/R4).
        // 0901 R2: interrupted runs are resumable too (engine 0.5.0 reclaims
        // ownership via CAS; paused defaults to skip-enter, interrupted to
        // rerun-enter) — the engine is the authority on resumability.
        const row = await new RunDao(await this.ctx.getDb()).traceRowById(runId);
        if (row?.status !== 'paused' && row?.status !== 'interrupted') {
            throw new Error(
                `Run "${runId}" is not resumable (status: ${row?.status ?? 'missing'}) - only paused or interrupted runs can be continued.`,
            );
        }

        // Parse persisted metadata FIRST (0784 R1): the recorded launch source
        // decides how the definition is resolved, before any name-based lookup.
        let rawMeta: Record<string, unknown> = {};
        try {
            rawMeta = JSON.parse(row.metadata_json || '{}');
        } catch {
            rawMeta = {};
        }
        const warnings: string[] = [];
        const emitWarning = (message: string): void => {
            warnings.push(message);
            // Best-effort human visibility; a sink failure must not block resume.
            try {
                this.ctx.warn?.(message);
            } catch {
                // Warning delivery cannot change resume semantics.
            }
        };

        // 0784 R1/R2: honor the recorded launch source (shared with pendingGate,
        // 0932, so gate inspection and resume agree on the launch identity).
        const pinned = this.pinnedLaunchSource(runId, rawMeta);

        // Launch workdir grounds checkpoint artifacts, git freshness, and the
        // engine resume snapshot (0784 R3) — never the ambient process cwd.
        const launchWorkdir = pinned?.workdir ?? this.ctx.cwd;

        // R5: Resume validates checkpoint freshness on the resume side (ADR-099).
        await this.validateResumeCheckpointFreshness(runId, row, launchWorkdir);

        // R1/R4 + 0784 R1/R2: resolve the launched definition. Shared with
        // pendingGate (0932) so the inspected gate is the gate a resume executes.
        const resolved = await this.resolveResumableDefinition(runId, row, pinned, emitWarning);

        // R3: Compare persisted definitionDigest against re-resolved definition.
        const persistedDigest = typeof rawMeta.definitionDigest === 'string' ? rawMeta.definitionDigest : null;
        // 0768 R1: a row's identity era is read from the PRESENCE of the
        // metadata.workflowVersion key — never by re-resolving today's definition.
        // Pre-0768 rows (no key) keep the null-digest skip; a post-0768 row with an
        // absent digest cannot be compared against any baseline, so resume is
        // refused outright — allowing it would silently resume unguarded forever.
        const identityStamped = 'workflowVersion' in rawMeta;
        const persistedVersion =
            identityStamped && (typeof rawMeta.workflowVersion === 'string' || rawMeta.workflowVersion === null)
                ? (rawMeta.workflowVersion as string | null)
                : undefined;
        if (identityStamped && persistedDigest === null) {
            throw new Error(
                `Cannot resume run "${runId}": workflow definition drift detected (identity-stamped run has no recorded definition digest, currently ${resolved.digest}). Resume refused.`,
            );
        }
        // R1 of 0433: inject the operator's HITL answer into resume vars so guard
        // re-evaluation sees the override, not the stale headless default. The
        // engine's resumeRun merges options.vars over the persisted snapshot
        // (caller overrides win - ts-dual-workflow-engine service.ts:127).
        // 0932 R2: the answer is validated against the pending gate HERE — before
        // the drift-consent and stale-consent metadata writes below — so a rejected
        // answer never mutates the run record (R2: no status, var or metadata
        // change). The engine re-checks defensively inside resumeRun's ownership
        // claim window, closing the inspect-vs-resume race.
        const resumeVars: Record<string, string> = await this.resolveResumeAnswerVars(runId, opts);
        // D65 1232: a host-executor pause resumes on a work-item receipt, validated HERE —
        // before the drift-consent and stale-consent metadata writes below — so a refused
        // receipt mutates nothing. `hostExecutor` also keeps the pause transform on for the
        // rest of the host chain.
        const hostPause = await this.resolveHostPauseReceipt(runId, launchWorkdir, opts?.answerText);
        if (persistedDigest !== null && persistedDigest !== resolved.digest) {
            if (opts?.allowDigestMismatch !== true && opts?.force !== true) {
                const prompt = `Workflow definition drift detected for run "${runId}": launched with ${persistedDigest}, currently ${resolved.digest}. Continue with modified definition?`;
                const answer = await this.ctx.hitlResponder().respond({
                    kind: 'confirm',
                    prompt,
                    runId,
                    node: 'continue',
                });
                if (answer.value !== 'yes') {
                    throw new Error(
                        `Cannot resume run "${runId}": workflow definition drift detected (launched with ${persistedDigest}, currently ${resolved.digest}). Resume refused.`,
                    );
                }
            }
            // 0784 R2: consented drift is recorded and made visible — the launch
            // identity stays immutable, the executed identity is stamped alongside
            // it and carried into proof vars so mixed-definition execution cannot
            // masquerade as single-definition evidence.
            const db = await this.ctx.getDb();
            await new RunDao(db).mergeMetadata(runId, {
                resumeDefinitionDigest: resolved.digest,
                resumeWorkflowVersion: workflowVersionLiteral(resolved.workflow),
            });
            emitWarning(
                `Consented definition drift on resume of run "${runId}": launched ${persistedDigest}, executing ${resolved.digest}; launch identity preserved, proof vars carry the executed digest.`,
            );
        } else if (
            ('resumeDefinitionDigest' in rawMeta || 'resumeWorkflowVersion' in rawMeta) &&
            (persistedDigest === null || persistedDigest === resolved.digest)
        ) {
            // 0784 R2: an earlier consented drift no longer applies — clear the
            // stale resume identity so diagnostics stay truthful.
            const db = await this.ctx.getDb();
            await new RunDao(db).mergeMetadata(runId, {
                resumeDefinitionDigest: null,
                resumeWorkflowVersion: null,
            });
        }

        const svc = await this.engine.createEngineService({
            events: eventsBus,
            extensions: { workflow: resolved.workflow, file: resolved.path },
            ...(opts?.recordSelfPid === true ? { recordSelfPid: true } : {}),
        });
        const workflow = hostPause.hostExecutor ? withHostExecutorPause(resolved.workflow) : resolved.workflow;
        // 0784 R2: on consented drift the executed digest overrides the proof
        // binding var (__definitionDigest) for this resume only. (Answer vars were
        // resolved and validated above, before any metadata mutation.)
        if (persistedDigest !== null && persistedDigest !== resolved.digest && 'resumeDefinitionDigest' in rawMeta) {
            resumeVars.__definitionDigest = resolved.digest;
        }
        // D65 1232: the run's durable evidence is the canonical receipt, not the path the
        // operator passed — persisted once the resume is known to proceed.
        if (hostPause.receipt !== undefined) {
            await writeReceipt(createNodeFileSystem(launchWorkdir), launchWorkdir, hostPause.receipt);
        }
        const result = await svc.resumeRun(workflow, runId, {
            // 0784 R1/R3: resume inside the recorded launch workdir (legacy: the
            // ambient service cwd), never the ambient process cwd.
            workdir: launchWorkdir,
            ...(Object.keys(resumeVars).length > 0 ? { vars: resumeVars } : {}),
            ...(opts?.redactor !== undefined ? { redactor: opts.redactor } : {}),
            ...(opts?.resumeOwner !== undefined ? { resumeOwner: opts.resumeOwner } : {}),
            ...(eventsBus !== undefined
                ? {
                      // R3 (0601): engine-native resume events carry workflow identity;
                      // the retired action-boundary aliases are filtered out first (0869 R2).
                      events: withWorkflowIdentity(
                          dropRetiredActionBoundaryAliases(bridgeEventBus(eventsBus)),
                          workflow,
                      ),
                  }
                : {}),
        });
        await this.runOps.stampFailureReason(runId, result);
        const runResult = result as WorkflowRunResult;
        // 0768 R1: echo the run's PERSISTED identity (not the re-resolved one) so
        // callers see what the run was launched with; version stays absent for
        // pre-0768 rows (unknown legacy identity).
        runResult.definitionDigest = persistedDigest;
        if (persistedVersion !== undefined) runResult.version = persistedVersion;
        // D65 1232: the next host stage's work item is the resume's pause payload (§4.3).
        await attachHostPause(createNodeFileSystem(launchWorkdir), launchWorkdir, runResult);
        // 0784 R2: surface degraded/consented-drift resume diagnostics.
        if (warnings.length > 0) (runResult as Record<string, unknown>).warnings = warnings;
        return runResult;
    }

    /**
     * D65 1232: validate the receipt a host-executor pause resumes on, and report whether
     * this run is on the host chain (so the definition keeps its pause transform).
     *
     * A run launched with `executor: host` may pause on a definition-declared gate
     * (no work item) — that resume is untouched. A pause on an `agent.run` stage wrote
     * the run's work item; its `--answer-text` is then the executor's receipt path, and
     * the receipt must be a definite `done` for THIS run and THIS state whose expected
     * files and owned sections are written (design §4.3, ADR-126 A4). Refusals throw
     * before any resume claim, so a refused continue changes nothing.
     */
    private async resolveHostPauseReceipt(
        runId: string,
        workdir: string,
        answerText: string | undefined,
    ): Promise<{ hostExecutor: boolean; receipt?: WorkItemReceipt }> {
        const db = await this.ctx.getDb();
        if (!(await hostExecutorPersisted(db, runId))) return { hostExecutor: false };
        const fs = createNodeFileSystem(workdir);
        const workItem = await readWorkItem(fs, workdir, runId);
        if (workItem === null) return { hostExecutor: true };
        const currentState = await new DbWorkflowPersistenceAdapter(db).loadCurrentState(runId);
        if (currentState !== workItem.state) return { hostExecutor: true };
        if (answerText === undefined) {
            throw new ValidationError(
                `Cannot resume run "${runId}": state '${workItem.state}' paused on a host work item, so --answer-text must name its receipt path.`,
            );
        }
        const receipt = await readReceipt(fs, workdir, answerText);
        const check = await validateWorkItemReceipt(fs, workdir, workItem, receipt);
        if (receipt === null || !check.ok) {
            const reason = check.ok ? 'work-item receipt could not be read' : check.error;
            throw new ValidationError(`Cannot resume run "${runId}": ${reason}. Resume refused.`);
        }
        return { hostExecutor: true, receipt };
    }

    /** Implementation of {@link WorkflowAppService.pendingGate} (see its doc comment for the contract). */
    async pendingGate(runId: string): Promise<PendingGate | null> {
        const db = await this.ctx.getDb();
        const row = await new RunDao(db).traceRowById(runId);
        if (row?.status !== 'paused' && row?.status !== 'interrupted') return null;
        let rawMeta: Record<string, unknown> = {};
        try {
            rawMeta = JSON.parse(row.metadata_json || '{}');
        } catch {
            rawMeta = {};
        }
        const pinned = this.pinnedLaunchSource(runId, rawMeta);
        // Inspection is silent: the legacy name-only warning stays owned by the
        // resume path, which surfaces it when the resume actually proceeds.
        const resolved = await this.resolveResumableDefinition(runId, row, pinned, () => {});
        const projection = await projectWorkflowProgress(runId, {
            db,
            projectRoot: this.ctx.cwd,
            workflowDef: resolved.workflow,
        });
        const stateId = projection.currentState;
        if (stateId === null) return null;
        const site = gateSitesForState(resolved.workflow, stateId)[0];
        if (site === undefined) return null;
        return {
            stateId,
            kind: site.kind as GateActionKind,
            answerVar: hitlAnswerVar(site.kind, site.options),
        };
    }

    /**
     * Parse a run's persisted `definitionSource` metadata into a pinned launch
     * source (0784 R1). A present-but-malformed record throws — resuming (or
     * inspecting, 0932) a run must never silently degrade to legacy name lookup.
     */
    private pinnedLaunchSource(runId: string, rawMeta: Record<string, unknown>): RunDefinitionSource | null {
        const rawSource: unknown = rawMeta.definitionSource;
        if (rawSource === undefined) return null;
        if (rawSource === null || typeof rawSource !== 'object' || Array.isArray(rawSource)) {
            throw new Error(
                `Cannot resume run "${runId}": recorded definitionSource metadata is malformed (expected {path, layer, workdir}). Resume refused.`,
            );
        }
        const candidate = rawSource as Record<string, unknown>;
        const sourcePath = candidate.path;
        const sourceWorkdir = candidate.workdir;
        // 0819 R4: the layer vocabulary is project|registered|shared; a pre-rename row
        // carrying the legacy `bundled` alias still resumes and reads as `shared`.
        const sourceLayer = normalizePersistedWorkflowLayer(candidate.layer);
        if (
            typeof sourcePath !== 'string' ||
            sourcePath === '' ||
            sourceLayer === null ||
            typeof sourceWorkdir !== 'string' ||
            sourceWorkdir === ''
        ) {
            throw new Error(
                `Cannot resume run "${runId}": recorded definitionSource metadata is malformed (expected an absolute path, a project|registered|shared layer — legacy "bundled" accepted — and a workdir). Resume refused.`,
            );
        }
        return { path: sourcePath, layer: sourceLayer, workdir: sourceWorkdir };
    }

    /**
     * Resolve the definition a resume of this run would execute (0784 R1/R2).
     * With a recorded source, verify the file still exists BEFORE invoking the
     * resolver so a deleted source can never silently resolve a same-named
     * replacement; require resolution to land exactly on the recorded path.
     * Without one, retain legacy name-only lookup with an explicit
     * degraded-identity warning. Shared by `continuePaused` (resume) and
     * `pendingGate` (read-only gate inspection, 0932) so both walk the same
     * definition.
     */
    private async resolveResumableDefinition(
        runId: string,
        row: { workflow_name: string },
        pinned: RunDefinitionSource | null,
        emitWarning: (message: string) => void,
    ): Promise<ResolvedWorkflowDefinition> {
        if (pinned !== null) {
            const fs = createNodeFileSystem();
            if (!fs.exists(pinned.path)) {
                throw new Error(
                    `Cannot resume run "${runId}": recorded launch source "${pinned.path}" no longer exists. Repair the source or start a new run; name-based fallback is refused.`,
                );
            }
            const resolved = await resolveWorkflowDefinition(pinned.workdir, pinned.path, {
                validateSchema: true,
                embeddedSchemas: this.ctx.embeddedSchemas?.(),
            });
            if (resolved.path !== pinned.path) {
                throw new Error(
                    `Cannot resume run "${runId}": definition resolved to "${resolved.path}" instead of the recorded launch source "${pinned.path}". Resume refused.`,
                );
            }
            return resolved;
        }
        let resolved: ResolvedWorkflowDefinition;
        try {
            resolved = await resolveWorkflowDefinition(this.ctx.cwd, row.workflow_name, {
                validateSchema: true,
                embeddedSchemas: this.ctx.embeddedSchemas?.(),
                registered: registeredWorkflowPaths(this.ctx.spurConfig ?? null),
            });
        } catch {
            throw new Error(
                `Cannot resume run "${runId}": workflow definition "${row.workflow_name}" not found in the workflow search paths.`,
            );
        }
        emitWarning(
            `Run "${runId}" resumed by workflow name "${row.workflow_name}" (no recorded launch source — pre-source-pin run); identity checks run against the name-resolved definition.`,
        );
        return resolved;
    }

    /**
     * 0932 R1/R2: validate the operator's answer flags against the gate the run
     * is actually paused on, then build the resume vars that inject the answer.
     * Called BEFORE `svc.resumeRun`, so a rejected call never reaches the
     * resume-ownership claim and mutates nothing.
     *
     * - `--answer-text` (free text, R1) requires a pending `hitl.input` gate;
     *   the text is stored verbatim under the gate's answer var (`options.var`,
     *   else `__hitlInput`) and an empty string is rejected.
     * - `--answer` (yes|no|cancel) requires a pending `hitl.confirm` or
     *   `hitl.select` gate and lands in the gate's answer var — no longer the
     *   hard-coded `__hitlAnswer` (R2).
     * - Both flags together are rejected; a kind mismatch throws the typed
     *   `ValidationError` every transport maps to `VALIDATION_FAILED`.
     * - A resumable run with no pending gate action (for example `interrupted`)
     *   has no gate contract to match and resumes exactly as before, with the
     *   legacy var defaults.
     * - `hitlVar` stays an explicit override for tests: it names the var
     *   directly and skips the gate-kind check.
     */
    private async resolveResumeAnswerVars(
        runId: string,
        opts?: ContinuePausedOptions,
    ): Promise<Record<string, string>> {
        const resumeVars: Record<string, string> = {};
        const answerText = opts?.answerText;
        const hitlAnswer = opts?.hitlAnswer;
        if (answerText !== undefined && hitlAnswer !== undefined) {
            throw new ValidationError(
                'Pass either --answer <yes|no|cancel> or --answer-text <text>, not both (0932 R2).',
            );
        }
        if (answerText !== undefined) {
            if (answerText === '') {
                throw new ValidationError('--answer-text must be a non-empty string (0932 R1).');
            }
            const gate = await this.host.pendingGate(runId);
            if (gate !== null && gate.kind !== 'hitl.input') {
                throw new ValidationError(pendingGateMismatchMessage(runId, gate, '--answer-text'));
            }
            resumeVars[opts?.hitlVar ?? gate?.answerVar ?? hitlAnswerVar('hitl.input', undefined)] = answerText;
            return resumeVars;
        }
        if (hitlAnswer !== undefined) {
            const gate = await this.host.pendingGate(runId);
            if (gate !== null && gate.kind !== 'hitl.confirm' && gate.kind !== 'hitl.select') {
                throw new ValidationError(pendingGateMismatchMessage(runId, gate, '--answer'));
            }
            resumeVars[opts?.hitlVar ?? gate?.answerVar ?? hitlAnswerVar('hitl.confirm', undefined)] = hitlAnswer;
        }
        return resumeVars;
    }

    /**
     * Validate checkpoint freshness on resume (task 0752 / R5 / ADR-099; reworked
     * by 0784 R3). For every checkpoint associated with the resumed run: accept
     * pending/running/approved as the nonterminal advisory projections of a paused
     * engine run (consumer-local mapping — no new persisted enum), then validate
     * workflow/WBS ownership, current HEAD (probed in the launch workdir only when
     * the checkpoint participates in commit tracking) and workdir-resolved artifact
     * existence. Missing/unreadable git freshness is a named refusal, never an
     * empty-string fallback. A missing checkpoint is a supported engine-only resume.
     */
    private async validateResumeCheckpointFreshness(
        runId: string,
        row: { id: string; workflow_name: string; status: string; metadata_json?: string },
        workdir: string,
    ): Promise<void> {
        const sessionsDir = join(workdir, '.spur', 'memory', 'sessions');
        const fs = createNodeFileSystem();
        let entries: string[];
        try {
            entries = (await fs.readDir(sessionsDir)).filter((name) => name.endsWith('.md'));
        } catch {
            return;
        }

        let rawMeta: Record<string, unknown> = {};
        try {
            rawMeta = JSON.parse(row.metadata_json || '{}');
        } catch {
            rawMeta = {};
        }
        const wbs = typeof rawMeta.wbs === 'string' ? rawMeta.wbs : undefined;

        // HEAD is probed lazily (first commit-tracking checkpoint) and cached; a
        // probe failure is a refusal, never an empty-string fallback (0784 R3).
        const executor = this.ctx.processExecutor?.() ?? new NodeProcessExecutor();
        let head: string | null = null;
        const resolveHead = async (): Promise<string> => {
            if (head !== null) return head;
            const probe = await executor.run({
                command: 'git',
                args: ['rev-parse', 'HEAD'],
                cwd: workdir,
                forceBuffered: true,
                rejectOnError: false,
            });
            if (probe.exitCode !== 0 || probe.stdout.trim() === '') {
                throw new Error(
                    `Cannot resume run "${runId}": checkpoint freshness requires the launch workdir's git HEAD, but "git rev-parse HEAD" failed in "${workdir}". Refusing rather than skipping the commit-drift check.`,
                );
            }
            head = probe.stdout.trim();
            return head;
        };

        for (const name of entries) {
            const filePath = join(sessionsDir, name);
            let raw: string;
            try {
                raw = await fs.readFile(filePath);
            } catch {
                continue;
            }
            const meta = parseCheckpointMetadata(raw);
            if (meta === null) {
                if (raw.includes(`run_id: "${runId}"`) || raw.includes(`run_id: ${runId}`)) {
                    throw new Error(
                        `Cannot resume run "${runId}": checkpoint is stale (malformed: not canonical checkpoint metadata).`,
                    );
                }
                continue;
            }

            const isForThisRun =
                meta.runId === runId ||
                (wbs !== undefined && meta.taskWbs === wbs && (meta.runId === '' || meta.runId === runId));

            if (isForThisRun) {
                if (meta.workflow !== '' && meta.workflow !== row.workflow_name) {
                    throw new Error(
                        `Cannot resume run "${runId}": checkpoint is stale (workflow-mismatch: checkpoint workflow "${meta.workflow}" != "${row.workflow_name}").`,
                    );
                }
                // 0784 R3: consumer-local status mapping. The persisted run row is
                // authoritative; a checkpoint's status is advisory and must project
                // a nonterminal engine state for the resume to proceed.
                if (meta.status === '') {
                    throw new Error(
                        `Cannot resume run "${runId}": checkpoint is stale (status-missing: checkpoint carries no status).`,
                    );
                }
                if (isTerminalCheckpointStatus(meta.status)) {
                    throw new Error(
                        `Cannot resume run "${runId}": checkpoint is stale (terminal: status=${meta.status}).`,
                    );
                }
                if (meta.status !== 'pending' && meta.status !== 'running' && meta.status !== 'approved') {
                    throw new Error(
                        `Cannot resume run "${runId}": checkpoint is stale (unknown checkpoint status "${meta.status}" — expected pending/running/approved).`,
                    );
                }
                const staleness = checkpointStaleness(meta, {
                    ...(wbs !== undefined ? { taskWbs: wbs } : {}),
                    ...(meta.sourceCommit === '' ? {} : { sourceCommit: await resolveHead() }),
                    artifactExists: (p: string) => fs.exists(isAbsolute(p) ? p : join(workdir, p)) as boolean,
                });
                if (staleness.stale) {
                    throw new Error(`Cannot resume run "${runId}": checkpoint is stale (${staleness.reason}).`);
                }
            }
        }
    }
}
