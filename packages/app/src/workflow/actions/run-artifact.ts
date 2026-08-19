import { normalize, resolve } from 'node:path';
import type { DbAdapter } from '@gobing-ai/spur-domain';
import { ArtifactDao } from '@gobing-ai/spur-domain';
import type { ActionResult, ActionRunContext, ActionRunner } from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';

const KIND = 'run.artifact';

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
    /** Binding semantics indicating whether the artifact is tied to the current proof state. */
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

        if (!normalized.startsWith(allowedDir)) {
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
