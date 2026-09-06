import { join, resolve } from 'node:path';
import type { DbAdapter } from '@gobing-ai/spur-domain';
import { ArtifactDao, RunDao } from '@gobing-ai/spur-domain';
import type { ActionResult, ActionRunContext, ActionRunner } from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem, type FileSystem, type ProcessExecutor } from '@gobing-ai/ts-runtime';
import { parseVerifyVerdict } from '../../services/verify-verdict';
import { computeProofInputFingerprint, readProofInputContents } from '../proof-input-fingerprint';
import { resolveRunArtifactPath } from './run-path';

const KIND = 'run.artifact';
/** Canonical proof-input digest shape produced by `proof.fingerprint` (ADR-071). */
const PROOF_DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

/**
 * Options configuring a deterministic `run.artifact` recording action.
 */
export interface RunArtifactOptions {
    /** Optional identifier for the artifact action. */
    id?: string;
    /** Path to the artifact relative to repository root beneath `.spur/run/`. */
    path: string;
    /** Classification kind recorded in ArtifactDao (e.g. `verify-verdict`). */
    artifactKind: string;
    /**
     * Binding semantics declaring the artifact is tied to the current proof state (ADR-071
     * proof-chain symmetry). Only `'current'` is defined; since task 0785 R3 it is enforced by
     * FRESH input capture and raw-verdict-proof validation against the authoritative run row —
     * a digest-shaped workflow var alone is insufficient.
     */
    proofBinding?: 'current' | string;
    /** When true, validates that the artifact file exists before recording. */
    requireExisting?: boolean;
    /**
     * Canonical task spec folded into the freshly captured proof digest. Required (non-empty) for
     * bound `verify-verdict` registration; same name/semantics as `proof.fingerprint` (0785 R3).
     */
    taskFile?: string;
    /**
     * Optional linked feature spec folded into the fresh digest. `undefined`/`''` stays omitted
     * (empty-string compatibility); a nonempty path must be a readable regular file (0785 R1).
     */
    featureFile?: string;
}

/**
 * Workflow action runner for `run.artifact` execution.
 *
 * Unbound registration is path-only (path + kind + run id; no bodies — ADR-069). Bound
 * (`proofBinding: 'current'`) registration independently re-captures the current proof inputs,
 * validates the canonical verdict plus its raw proof block against the authoritative RunDao
 * identity, and requires the run-scoped review-completion marker to name the same digest BEFORE
 * any ledger record exists (task 0785 R3/R4).
 */
export class RunArtifactActionRunner implements ActionRunner {
    readonly kind = KIND;

    constructor(
        private readonly getDb?: () => Promise<DbAdapter>,
        private readonly fileSystem: FileSystem = createNodeFileSystem(),
        private readonly artifactDao?: ArtifactDao,
        // 0785 R3: fresh proof capture needs the isolated git-tree half, which runs through the
        // ProcessExecutor. Injected as an optional trailing dependency via builtins.ts so the
        // bound comparison hashes the actual inputs with the caller's executor seam.
        private readonly processExecutor?: ProcessExecutor,
    ) {}

    async execute(options: Record<string, unknown>, context: ActionRunContext): Promise<ActionResult> {
        const pathRaw = options.path;
        if (typeof pathRaw !== 'string' || pathRaw.trim() === '') {
            return {
                ok: false,
                error: 'Action option "path" must be a non-empty string',
            };
        }

        const artifactKind = options.artifactKind;
        if (typeof artifactKind !== 'string' || artifactKind.trim() === '') {
            return {
                ok: false,
                error: 'Action option "artifactKind" must be a non-empty string',
            };
        }

        // R4 (task 0751, ADR-071 proof-chain symmetry): a declared proofBinding is enforced BEFORE
        // the ledger row exists. An unknown binding value refuses rather than echoing the option
        // into result data unvalidated.
        const proofBinding = options.proofBinding;
        if (proofBinding !== undefined && proofBinding !== 'current') {
            return {
                ok: false,
                error: `${KIND}: unsupported proofBinding "${String(proofBinding)}" - only "current" is defined (ADR-071)`,
            };
        }

        const workdir = context.workdir ?? process.cwd();

        if (proofBinding === 'current') {
            return await this.executeBound(pathRaw, artifactKind, options, context, workdir);
        }

        // Unbound, path-only registration (0785 R5: behavior preserved except required-file
        // regularity and physical confinement).
        let normalized: string;
        try {
            normalized = await resolveRunArtifactPath(this.fileSystem, workdir, pathRaw);
        } catch (error) {
            return { ok: false, error: `path ${(error as Error).message}` };
        }

        const requireExisting = options.requireExisting !== false;
        if (requireExisting) {
            const stat = await this.fileSystem.stat(normalized);
            if (stat === null) {
                return {
                    ok: false,
                    error: `run.artifact required file does not exist: ${pathRaw} (${normalized})`,
                };
            }
            if (!stat.isFile()) {
                return {
                    ok: false,
                    error: `run.artifact required file is not a regular file: ${pathRaw} (${normalized})`,
                };
            }
        }

        let dao = this.artifactDao;
        if (!dao && this.getDb) {
            const db = await this.getDb();
            dao = new ArtifactDao(db);
        }

        let recordId: string | undefined;
        if (dao) {
            const record = await dao.record({
                path: normalized,
                kind: artifactKind,
                runId: context.runId,
            });
            recordId = record.id;
        }

        return {
            ok: true,
            data: {
                id: recordId,
                path: normalized,
                kind: artifactKind,
                runId: context.runId,
            },
        };
    }

    /**
     * Bound registration (0785 R3): fresh capture + verdict/proof validation + authoritative run
     * identity + review-completion marker, all before the ledger write. Every refusal below
     * leaves ArtifactDao untouched and the task lifecycle unmutated.
     */
    private async executeBound(
        pathRaw: string,
        artifactKind: string,
        options: Record<string, unknown>,
        context: ActionRunContext,
        workdir: string,
    ): Promise<ActionResult> {
        // R5: only the shipped verify-verdict kind binds; other kinds fail explicitly as
        // unsupported instead of inventing another proof envelope.
        if (artifactKind !== 'verify-verdict') {
            return {
                ok: false,
                error: `${KIND}: proofBinding "current" is only supported for the verify-verdict artifact kind (got "${artifactKind}")`,
            };
        }
        if (!this.getDb) {
            return {
                ok: false,
                error: `${KIND}: proofBinding "current" requires the composed database context (RunDao run identity) — refusing an unverifiable binding`,
            };
        }
        if (typeof options.taskFile !== 'string' || options.taskFile.trim() === '') {
            return {
                ok: false,
                error: `${KIND}: proofBinding "current" requires a non-empty "taskFile" option — the fresh digest must cover the canonical task spec`,
            };
        }

        // R1: validated spec reads (regular file, readable, under the workdir) BEFORE any digest.
        const inputs = await readProofInputContents(this.fileSystem, workdir, options);
        if (!inputs.ok) {
            return { ok: false, error: `${KIND}: ${inputs.error}` };
        }

        // Independently capture the current inputs — the actual proof authority — instead of
        // trusting caller-supplied digest vars.
        let digest: string;
        try {
            digest = await computeProofInputFingerprint({
                cwd: workdir,
                ...(inputs.taskContent !== undefined ? { taskContent: inputs.taskContent } : {}),
                ...(inputs.featureContent !== undefined ? { featureContent: inputs.featureContent } : {}),
                ...(this.processExecutor !== undefined ? { processExecutor: this.processExecutor } : {}),
                fileSystem: this.fileSystem,
            });
        } catch (error) {
            return { ok: false, error: `${KIND}: fresh proof capture failed: ${(error as Error).message}` };
        }

        // The run's declared digest must be well-formed AND agree with the fresh capture: a
        // forged matching var cannot bless stale artifact content (0785 R3).
        const varDigest = context.vars.proofDigestNow ?? context.vars.proofDigest;
        if (typeof varDigest !== 'string' || !PROOF_DIGEST_RE.test(varDigest)) {
            return {
                ok: false,
                error:
                    `${KIND}: proofBinding "current" does not hold - the run has no current proof input ` +
                    `digest (vars.proofDigestNow/proofDigest missing or malformed), so the artifact cannot be ` +
                    `bound to a proof that was never captured; capture one with proof.fingerprint first`,
            };
        }
        if (varDigest !== digest) {
            return {
                ok: false,
                error:
                    `${KIND}: the run's declared proof digest (${varDigest}) does not match the freshly ` +
                    `captured digest (${digest}) — a stale or forged var cannot bless artifact content (0785 R3)`,
            };
        }

        // Physical confinement BEFORE read/ledger effects (0785 R2).
        let normalized: string;
        try {
            normalized = await resolveRunArtifactPath(this.fileSystem, workdir, pathRaw);
        } catch (error) {
            return { ok: false, error: `path ${(error as Error).message}` };
        }

        const requireExisting = options.requireExisting !== false;
        if (requireExisting) {
            const stat = await this.fileSystem.stat(normalized);
            if (stat === null) {
                return {
                    ok: false,
                    error: `run.artifact required file does not exist: ${pathRaw} (${normalized})`,
                };
            }
            if (!stat.isFile()) {
                return {
                    ok: false,
                    error: `run.artifact required file is not a regular file: ${pathRaw} (${normalized})`,
                };
            }
        }

        let raw: string;
        try {
            raw = await this.fileSystem.readFile(normalized);
        } catch (error) {
            return { ok: false, error: `${KIND}: verdict artifact unreadable: ${(error as Error).message}` };
        }

        // Canonical verdict validation (never throws; missing/malformed/invalid can never be PASS).
        const taskWbs = String(context.vars.wbs ?? '');
        const outcome = parseVerifyVerdict(raw, taskWbs);
        if (outcome.kind !== 'valid') {
            const detail = outcome.kind === 'invalid' && outcome.reason !== undefined ? `: ${outcome.reason}` : '';
            return {
                ok: false,
                error: `${KIND}: verdict artifact is ${outcome.kind}${detail} — refusing to bind (0785 R3)`,
            };
        }
        const verdict = outcome.verdict;
        if (verdict.wbs !== taskWbs) {
            return {
                ok: false,
                error: `${KIND}: verdict artifact names wbs "${verdict.wbs}" but the run carries task "${taskWbs}"`,
            };
        }
        if (verdict.verdict !== 'PASS') {
            return {
                ok: false,
                error: `${KIND}: verdict aggregate is ${verdict.verdict}, not PASS — refusing to bind`,
            };
        }

        // The canonical parser strips unknown fields, so the raw proof block is validated
        // separately from the parsed document.
        let root: unknown;
        try {
            root = JSON.parse(raw);
        } catch {
            return { ok: false, error: `${KIND}: verdict artifact is malformed JSON` };
        }
        const proof = (root as { proof?: unknown }).proof;
        if (proof === null || typeof proof !== 'object' || Array.isArray(proof)) {
            return {
                ok: false,
                error: `${KIND}: verdict artifact carries no raw proof block — binding refused (0785 R3)`,
            };
        }
        const p = proof as Record<string, unknown>;
        const stageOf = (name: string): Record<string, unknown> | null => {
            const stages = p.stages;
            if (stages === null || typeof stages !== 'object' || Array.isArray(stages)) return null;
            const s = (stages as Record<string, unknown>)[name];
            return s !== null && typeof s === 'object' && !Array.isArray(s) ? (s as Record<string, unknown>) : null;
        };

        if (p.digest !== digest) {
            return {
                ok: false,
                error: `${KIND}: proof.digest ${String(p.digest)} does not equal the freshly captured digest (${digest})`,
            };
        }
        if (p.runId !== context.runId) {
            return {
                ok: false,
                error: `${KIND}: proof.runId ${String(p.runId)} does not match the certifying run ${context.runId}`,
            };
        }

        // Authoritative run identity from the DB row — never from caller vars.
        const db = await this.getDb();
        const runRow = await new RunDao(db).traceRowById(context.runId);
        if (runRow === undefined) {
            return {
                ok: false,
                error: `${KIND}: run ${context.runId} has no authoritative row — refusing binding (0785 R3)`,
            };
        }
        let metadata: Record<string, unknown> = {};
        try {
            metadata = JSON.parse(runRow.metadata_json || '{}') as Record<string, unknown>;
        } catch {
            return { ok: false, error: `${KIND}: run ${context.runId} metadata_json is malformed — refusing binding` };
        }
        const resumeDigest = metadata.resumeDefinitionDigest;
        const expectedDefinition =
            typeof resumeDigest === 'string' && resumeDigest !== '' ? resumeDigest : metadata.definitionDigest;
        if (typeof expectedDefinition !== 'string' || p.definitionDigest !== expectedDefinition) {
            return {
                ok: false,
                error:
                    `${KIND}: proof.definitionDigest ${String(p.definitionDigest)} does not match the run's ` +
                    `${typeof resumeDigest === 'string' && resumeDigest !== '' ? 'resume ' : ''}definition digest — ` +
                    `a stale-definition artifact cannot certify this run (0785 R3)`,
            };
        }

        // Stage evidence: qualityGate/verification PASS and review completed, each naming the
        // freshly captured digest.
        const qualityGate = stageOf('qualityGate');
        const review = stageOf('review');
        const verification = stageOf('verification');
        if (qualityGate === null || review === null || verification === null) {
            return {
                ok: false,
                error: `${KIND}: proof.stages is missing qualityGate/review/verification evidence — binding refused`,
            };
        }
        for (const [name, stage] of [
            ['qualityGate', qualityGate],
            ['review', review],
            ['verification', verification],
        ] as const) {
            if (stage.digest !== digest) {
                return {
                    ok: false,
                    error: `${KIND}: proof.stages.${name}.digest does not equal the freshly captured digest`,
                };
            }
        }
        if (qualityGate.status !== 'PASS') {
            return {
                ok: false,
                error: `${KIND}: proof.stages.qualityGate.status is ${String(qualityGate.status)}, not PASS`,
            };
        }
        if (verification.status !== 'PASS') {
            return {
                ok: false,
                error: `${KIND}: proof.stages.verification.status is ${String(verification.status)}, not PASS`,
            };
        }
        if (review.status !== 'completed') {
            return {
                ok: false,
                error: `${KIND}: proof.stages.review.status is "${String(review.status)}" — a skipped or stale review is not completed evidence (0785 R4)`,
            };
        }

        // R4: the verdict's review row is caller-stamped, so the run-scoped marker written by the
        // review stage itself must independently name the same digest. A marker from an earlier
        // digest, a corrupted marker, or no marker at all is never completed evidence.
        const markerPath = join(resolve(workdir), '.spur', 'run', `${context.runId}-review-proof.digest`);
        let marker: string | null = null;
        try {
            marker = await this.fileSystem.readFile(markerPath);
        } catch {
            marker = null;
        }
        if (marker === null || marker.trim() !== digest) {
            return {
                ok: false,
                error:
                    `${KIND}: review-proof marker ${context.runId}-review-proof.digest is missing or does not name ` +
                    `the current digest — review completion is not evidenced for this run (0785 R4)`,
            };
        }

        const dao = this.artifactDao ?? new ArtifactDao(db);
        const record = await dao.record({
            path: normalized,
            kind: artifactKind,
            runId: context.runId,
        });

        return {
            ok: true,
            data: {
                id: record.id,
                path: normalized,
                kind: artifactKind,
                runId: context.runId,
                proofBinding: 'current',
                proofDigest: digest,
            },
            setVars: { proofDigestNow: digest },
        };
    }
}
