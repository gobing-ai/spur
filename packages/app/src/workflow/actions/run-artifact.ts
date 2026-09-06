import { normalize, resolve, sep } from 'node:path';
import type { DbAdapter } from '@gobing-ai/spur-domain';
import { ArtifactDao } from '@gobing-ai/spur-domain';
import type { ActionResult, ActionRunContext, ActionRunner } from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';

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
     * proof-chain symmetry). Enforced at write (task 0751 R4): only `'current'` is defined, and it
     * holds only when the run carries a well-formed current proof digest
     * (`vars.proofDigestNow`, else `vars.proofDigest`). A declared binding that does not hold
     * rejects the artifact before any ledger record exists.
     */
    proofBinding?: 'current' | string;
    /** When true, validates that the artifact file exists before recording. */
    requireExisting?: boolean;
}

/**
 * Workflow action runner for `run.artifact` execution.
 * Records referenced execution artifacts in ArtifactDao without copying bodies or stdout into memory.
 */
export class RunArtifactActionRunner implements ActionRunner {
    readonly kind = KIND;

    constructor(
        private readonly getDb?: () => Promise<DbAdapter>,
        private readonly fileSystem: FileSystem = createNodeFileSystem(),
        private readonly artifactDao?: ArtifactDao,
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

        const workdir = context.workdir ?? process.cwd();
        const allowedDir = resolve(workdir, '.spur', 'run');
        const resolvedPath = resolve(workdir, pathRaw);
        const normalized = normalize(resolvedPath);

        if (!normalized.startsWith(`${allowedDir}${sep}`)) {
            return {
                ok: false,
                error: `path must resolve beneath .spur/run/ (got ${pathRaw})`,
            };
        }

        const requireExisting = options.requireExisting !== false;
        if (requireExisting) {
            const exists = await this.fileSystem.exists(normalized);
            if (!exists) {
                return {
                    ok: false,
                    error: `run.artifact required file does not exist: ${pathRaw} (${normalized})`,
                };
            }
        }

        // R4 (task 0751, ADR-071 proof-chain symmetry): a declared proofBinding is enforced at
        // artifact write, BEFORE the ledger row exists. An unknown binding value or a run without
        // a current, well-formed proof digest means the declared binding does not hold - refuse
        // rather than echo the option into result data unvalidated.
        const proofBinding = options.proofBinding;
        if (proofBinding !== undefined) {
            if (proofBinding !== 'current') {
                return {
                    ok: false,
                    error: `${KIND}: unsupported proofBinding "${String(proofBinding)}" - only "current" is defined (ADR-071)`,
                };
            }
            const digest = context.vars.proofDigestNow ?? context.vars.proofDigest;
            if (typeof digest !== 'string' || !PROOF_DIGEST_RE.test(digest)) {
                return {
                    ok: false,
                    error:
                        `${KIND}: proofBinding "current" does not hold - the run has no current proof input ` +
                        `digest (vars.proofDigestNow/proofDigest missing or malformed), so the artifact cannot be ` +
                        `bound to a proof that was never captured; capture one with proof.fingerprint first`,
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
                ...(options.proofBinding !== undefined ? { proofBinding: options.proofBinding } : {}),
            },
        };
    }
}
