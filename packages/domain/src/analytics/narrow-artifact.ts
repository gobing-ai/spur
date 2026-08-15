import type { HistoryArtifact } from './artifact';

/**
 * Render-time artifact narrowing (task 0564 R3). The `report` renderer is pure —
 * it never opens the database — so `--task` / `--top` narrow the already-loaded
 * artifact JSON client-side, exactly mirroring `analyze`'s flags so the two
 * surfaces cannot drift.
 *
 * Task dimension semantics: an analyze artifact covers one task only when it was
 * analyzed with `--task <wbs>` (the SQL selector filtered every bucket to that
 * task's rows). `report --task <wbs>` therefore:
 *   - matches the artifact's selector task  → renders its rows (the artifact IS
 *     that task), with a banner naming the filter and the artifact;
 *   - meets an artifact whose selector carried NO task dimension → the artifact
 *     cannot answer the narrowing → {@link ArtifactNarrowError} (never a silent
 *     unfiltered render);
 *   - meets an artifact analyzed for a DIFFERENT task → cannot answer → error.
 *
 * `--top <n>` re-slices the two leaderboards (`byTool`, `bySession`) to depth n.
 */

/** Thrown when a narrowing the artifact cannot answer is requested. */
export class ArtifactNarrowError extends Error {
    /** Absolute path of the artifact that cannot answer the narrowing. */
    readonly artifactPath: string;
    /** The dimension the artifact lacks or cannot satisfy (`task`, `top`). */
    readonly dimension: string;

    constructor(artifactPath: string, dimension: string, message: string) {
        super(message);
        this.name = 'ArtifactNarrowError';
        this.artifactPath = artifactPath;
        this.dimension = dimension;
    }
}

/** Narrowing options mirroring the `analyze` flags (`--task`, `--top`). */
export interface ArtifactNarrowOptions {
    /** Single task WBS the artifact must have been analyzed with. */
    task?: string;
    /** Leaderboard depth; positive integers only. */
    top?: number;
}

/** Result of {@link narrowArtifact}: the narrowed artifact plus a human banner label. */
export interface ArtifactNarrowResult {
    artifact: HistoryArtifact;
    /** Non-null exactly when a narrowing was applied (R3 banner requirement). */
    banner: string | null;
}

/**
 * Apply render-time narrowing to an artifact, or throw {@link ArtifactNarrowError}
 * when the artifact cannot answer the requested narrowing. Pure — no I/O, no
 * `DbAdapter`. The returned artifact is a shallow copy with re-sliced leaderboards
 * when narrowed; the input is never mutated.
 */
export function narrowArtifact(
    artifact: HistoryArtifact,
    opts: ArtifactNarrowOptions,
    artifactPath: string,
): ArtifactNarrowResult {
    const parts: string[] = [];

    if (opts.task !== undefined && opts.task !== '') {
        if (artifact.selector.taskWbs === null) {
            throw new ArtifactNarrowError(
                artifactPath,
                'task',
                `artifact ${artifactPath} carries no task dimension — re-run ` +
                    `\`spur history analyze --task ${opts.task}\` first (requested task: ${opts.task}).`,
            );
        }
        if (artifact.selector.taskWbs !== opts.task) {
            throw new ArtifactNarrowError(
                artifactPath,
                'task',
                `artifact ${artifactPath} was analyzed for task ${artifact.selector.taskWbs}, ` +
                    `not ${opts.task} — re-run \`spur history analyze --task ${opts.task}\`.`,
            );
        }
        parts.push(`task ${opts.task}`);
    }

    const top = opts.top !== undefined && Number.isInteger(opts.top) && opts.top > 0 ? opts.top : undefined;
    let narrowed = artifact;
    if (top !== undefined) {
        // The banner names the requested depth even when no leaderboard exceeds it —
        // otherwise a `--top 5` on a 3-row board looks silently ignored (0564 P4-2).
        if (artifact.byTool.length > top || artifact.bySession.length > top) {
            narrowed = {
                ...artifact,
                byTool: artifact.byTool.slice(0, top),
                bySession: artifact.bySession.slice(0, top),
            };
        }
        parts.push(`top ${top}`);
    }

    return { artifact: narrowed, banner: parts.length > 0 ? parts.join(' · ') : null };
}
