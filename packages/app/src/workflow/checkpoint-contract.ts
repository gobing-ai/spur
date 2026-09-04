import { createNodeFileSystem } from '@gobing-ai/ts-runtime';

/**
 * Canonical session-checkpoint metadata contract (task 0711 R1, ADR-071 lane).
 *
 * A checkpoint is an advisory resume projection written to
 * `.spur/memory/sessions/` — task/feature files and persisted workflow state
 * stay authoritative (0711 Q&A). The metadata shape mirrors the Session
 * Checkpoint Convention (`plugins/sp/skills/spur-dev/references/cross-cutting.md`)
 * and adds the freshness fields the convention documented but writers never
 * emitted: `schema_version`, `status`, `source_commit`, `digest`, `artifacts`.
 *
 * Consumers:
 * - resume / next-router gating (`plugins/sp/scripts/stage-registry-adapter.ts`
 *   keeps a self-contained lean copy of this semantics — the plugin installs
 *   into foreign repos and cannot import workspace packages; the parity test
 *   pins the two together).
 * - bounded cleanup (`WorkflowService.cleanCheckpoints`).
 */

export const CHECKPOINT_SCHEMA_VERSION = 1;

/** Statuses after which a checkpoint is terminal and only cleanup may touch it. */
export const TERMINAL_CHECKPOINT_STATUSES = ['done', 'failed', 'cancelled', 'skipped'] as const;
/** Terminal checkpoint status values (0711 R1). */
export type TerminalCheckpointStatus = (typeof TERMINAL_CHECKPOINT_STATUSES)[number];

/** Parsed frontmatter of a checkpoint document (0711 R2). */
export interface CheckpointMetadata {
    schemaVersion: number;
    sessionId: string;
    workflow: string;
    runId: string;
    taskWbs: string;
    featureId: string;
    phase: string;
    status: string;
    lastGate: string;
    sourceCommit: string;
    digest: string;
    generatedAt: string;
    updatedAt: string;
    nextAction: string;
    artifacts: string[];
}

/**
 * Parse a checkpoint file body into its metadata. Returns null for any
 * structurally invalid file (missing/short frontmatter, missing required
 * fields, wrong schema version) — callers must treat null as "reported and
 * ignored, never silently trusted" (0711 R3) and cleanup must never delete a
 * file it cannot prove is a terminal checkpoint (0711 R5).
 */
export function parseCheckpointMetadata(raw: string): CheckpointMetadata | null {
    if (!raw.startsWith('---')) return null;
    const end = raw.indexOf('\n---', 3);
    if (end < 0) return null;
    const block = raw.slice(4, end);

    const scalars = new Map<string, string>();
    const artifacts: string[] = [];
    let inArtifacts = false;
    for (const rawLine of block.split('\n')) {
        const line = rawLine.trim();
        if (line.startsWith('- ')) {
            if (inArtifacts) artifacts.push(line.slice(2).trim().replace(/^"|"$/g, ''));
            continue;
        }
        inArtifacts = false;
        const sep = line.indexOf(':');
        if (sep <= 0) continue;
        const key = line.slice(0, sep).trim();
        const value = line
            .slice(sep + 1)
            .trim()
            .replace(/^"|"$/g, '');
        if (key === 'artifacts') {
            inArtifacts = true;
            if (value !== '' && value !== '[]') {
                const unwrapped = value.replace(/^\[|\]$/g, '');
                if (unwrapped.trim() !== '') {
                    artifacts.push(
                        ...unwrapped
                            .split(',')
                            .map((p) => p.trim().replace(/^"|"$/g, ''))
                            .filter((p) => p !== ''),
                    );
                }
            }
            continue;
        }
        scalars.set(key, value);
    }

    const schemaVersion = Number.parseInt(scalars.get('schema_version') ?? '', 10);
    if (schemaVersion !== CHECKPOINT_SCHEMA_VERSION) return null;
    const required = ['session_id', 'workflow', 'task_wbs', 'phase', 'generated_at', 'next_action'] as const;
    for (const field of required) {
        if (!scalars.get(field)) return null;
    }

    return {
        schemaVersion,
        sessionId: scalars.get('session_id') ?? '',
        workflow: scalars.get('workflow') ?? '',
        runId: scalars.get('run_id') ?? '',
        taskWbs: scalars.get('task_wbs') ?? '',
        featureId: scalars.get('feature_id') ?? '',
        phase: scalars.get('phase') ?? '',
        status: scalars.get('status') ?? '',
        lastGate: scalars.get('last_gate') ?? '',
        sourceCommit: scalars.get('source_commit') ?? '',
        digest: scalars.get('digest') ?? '',
        generatedAt: scalars.get('generated_at') ?? '',
        updatedAt: scalars.get('updated_at') ?? scalars.get('generated_at') ?? '',
        nextAction: scalars.get('next_action') ?? '',
        artifacts,
    };
}

/** Optional inputs to checkpointStaleness; every axis is independently skippable. */
export interface CheckpointFreshnessInput {
    /** WBS the consumer intends to resume — must match `task_wbs` (owner identity). */
    taskWbs?: string;
    /** Current repository HEAD; a mismatch means the checkpoint predates drift. */
    sourceCommit?: string;
    /** Existence probe for referenced artifacts; defaults to the ts-runtime FileSystem seam. */
    artifactExists?: (path: string) => boolean;
}

/**
 * Freshness/identity validation for resume and next-router use (0711 R3).
 * Returns the first failing reason; `stale: false` means the checkpoint may be
 * trusted as an advisory resume projection. Every mismatch is a REPORTED
 * rejection — callers fall through to the non-checkpoint route.
 */
export function checkpointStaleness(
    meta: CheckpointMetadata,
    input: CheckpointFreshnessInput = {},
): { stale: boolean; reason?: string } {
    if (input.taskWbs !== undefined && meta.taskWbs !== input.taskWbs) {
        return { stale: true, reason: `owner-mismatch: task_wbs=${meta.taskWbs} != ${input.taskWbs}` };
    }
    if (isTerminalCheckpointStatus(meta.status)) {
        return { stale: true, reason: `terminal: status=${meta.status}` };
    }
    if (input.sourceCommit !== undefined && meta.sourceCommit !== '' && meta.sourceCommit !== input.sourceCommit) {
        return { stale: true, reason: `commit-drift: checkpoint@${meta.sourceCommit.slice(0, 12)} != HEAD` };
    }
    if (input.sourceCommit !== undefined && meta.sourceCommit === '') {
        return { stale: true, reason: 'commit-drift: checkpoint has no source_commit' };
    }
    const fs = createNodeFileSystem();
    // node impl's `exists` is synchronous; the union type is for async seams.
    const probe = input.artifactExists ?? ((p: string) => fs.exists(p) as boolean);
    for (const artifact of meta.artifacts) {
        if (!probe(artifact)) return { stale: true, reason: `missing-artifact: ${artifact}` };
    }
    return { stale: false };
}

/** Terminal checkpoint statuses that must never be resumed (0711 R1). */
export function isTerminalCheckpointStatus(status: string): status is TerminalCheckpointStatus {
    return (TERMINAL_CHECKPOINT_STATUSES as readonly string[]).includes(status);
}
