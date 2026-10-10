/**
 * DB-backed {@link FeatureReceiptRunPort} factory (D63 task 0915).
 *
 * Receipt validation needs two run-store facts the completion boundary cannot
 * observe from the filesystem: the recording run's terminal status plus its
 * persisted definition digest, and whether the receipt path is a registered
 * artifact of that run. Both the CLI commands (`feature check`/`advance`/`sync`)
 * and the server's guarded `feature.transition` (task 1137 P2 remediation, which
 * routes the graph's `kind: shell` guards through the in-process check) must
 * consult the same port, so the construction lives here once instead of as a
 * per-surface copy that can drift.
 */
import { ArtifactDao, type DbAdapter, RunDao } from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import type { FeatureReceiptRunPort } from '../workflow/feature-verification-receipt';

/**
 * Build the read-only run-store port. `fs` is used only for the symlink-aware
 * artifact-path comparison (e.g. `/tmp` vs `/private/tmp`); callers without a
 * filesystem fall back to lexical path equality.
 */
export function createFeatureReceiptRunPort(db: DbAdapter, fs?: FileSystem): FeatureReceiptRunPort {
    const runs = new RunDao(db);
    const artifacts = new ArtifactDao(db);
    return {
        readRunRow: async (runId) => {
            const row = await runs.traceRowById(runId);
            if (!row) return undefined;
            let meta: Record<string, unknown> = {};
            try {
                meta = JSON.parse(row.metadata_json) as Record<string, unknown>;
            } catch {
                meta = {};
            }
            const digest =
                typeof meta.resumeDefinitionDigest === 'string'
                    ? meta.resumeDefinitionDigest
                    : typeof meta.definitionDigest === 'string'
                      ? meta.definitionDigest
                      : null;
            return { status: row.status, definitionDigest: digest, varsJson: null };
        },
        hasArtifact: async (runId, path) => {
            const rows = await artifacts.artifactsByRunId(runId);
            // Paths may differ by symlink resolution (e.g. /tmp vs /private/tmp), so
            // fall back to realpath comparison before rejecting a registered artifact.
            const real = (p: string): string => {
                try {
                    return fs?.realPath?.(p) ?? p;
                } catch {
                    return p;
                }
            };
            return rows.some((row) => row.path === path || real(row.path) === real(path));
        },
    };
}
