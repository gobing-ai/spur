/**
 * feature-sync-suppression — bounded BLOCKED-retry suppression for `FeatureService.syncFeature`
 * (task 1004 R3, moved from the deleted bounded-sync wrapper script).
 *
 * During a batch (`/sp:dev-runall`) or wrap-up (`/sp:dev-wrapall`), the per-task `record` step
 * and the wrap-up `feature-transition` step each invoke `spur feature sync <id> --json`. If the
 * feature is L4-gate-blocked, the identical blocked result repeats on every call with no
 * intervening input change. `syncFeature` now classifies its own outcome: a BLOCKED outcome is
 * persisted (with its input fingerprint) at `.spur/run/feature-sync-blocked-<id>.json`, and a
 * later call with the same fingerprint replays the prior result (`suppressed: true`) without
 * re-deriving hops. A changed fingerprint or `FeatureSyncOptions.force` runs normally; a
 * non-BLOCKED outcome clears the state. The state path and JSON shape match the old wrapper so
 * a mid-upgrade run keeps its state.
 */

import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import type { FeatureSyncProposal, FeatureSyncResult } from './feature-service';

/** Classification of a structured feature-sync result (0411 parity). */
export type SyncClassification = 'applied' | 'no-op' | 'blocked';

// ── Input fingerprint ────────────────────────────────────────────────────────────────────

export interface SyncFingerprintInput {
    /** Hash of the feature file content (e.g. sha256 of the raw markdown from `feature show`). */
    featureContentHash: string;
    /** Stable vector of `<wbs>:<status>` for all linked tasks. */
    taskStatusVector: string[];
    /** Stable vector of `<wbs>:<mtime>` for verdict artifacts that exist. */
    verdictMtimeVector: string[];
}

/**
 * Deterministic SHA-256 fingerprint over the three input signals that can invalidate a blocked
 * suppression: the feature file itself, the linked task statuses, and the verdict artifact
 * mtimes. Sliced to 32 hex chars for a compact, collision-safe key. Vectors are sorted so the
 * fingerprint is order-insensitive — only the *set* of statuses/mtimes matters.
 */
export function computeSyncFingerprint(input: SyncFingerprintInput): string {
    const material = [
        input.featureContentHash,
        ...[...input.taskStatusVector].sort(),
        ...[...input.verdictMtimeVector].sort(),
    ].join('\n');
    return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

// ── Blocked-state record (persisted) ─────────────────────────────────────────────────────

/** Persisted BLOCKED outcome + the fingerprint that produced it (0411 JSON shape). */
export interface BlockedSyncState {
    featureId: string;
    inputFingerprint: string;
    proposal: FeatureSyncProposal;
    classification: SyncClassification;
    result: FeatureSyncResult;
    persistedAt: string;
}

/** Filesystem path of the blocked-sync state file for one feature inside the run dir (0411 shape). */
export const blockedStateFile = (featureId: string, runDir: string): string =>
    `${runDir.replace(/\/$/, '')}/feature-sync-blocked-${featureId}.json`;

/** JSON-serialize a blocked-sync state (single trailing newline, 0411 shape-compatible). */
export function serializeBlockedState(state: BlockedSyncState): string {
    return `${JSON.stringify(state)}\n`;
}

/** Parse a serialized blocked-sync state; any malformed/empty input degrades to `null` (fail-open read). */
export function parseBlockedState(raw: string): BlockedSyncState | null {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    try {
        const parsed = JSON.parse(trimmed) as BlockedSyncState;
        if (
            typeof parsed.featureId !== 'string' ||
            typeof parsed.inputFingerprint !== 'string' ||
            typeof parsed.proposal !== 'object' ||
            parsed.proposal === null
        ) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

/**
 * `<wbs>:<mtimeMs>` vector for verdict artifacts, preferring durable evidence to legacy scratch.
 * Removing scratch cannot change an input whose authoritative copy is durable. Missing files contribute
 * nothing (a task with no verdict yet is a stable "absent" signal captured by its absence);
 * a missing run dir yields an empty vector. Read via the runtime FileSystem rather than
 * `ls` + `stat` subprocesses: BSD/GNU `stat` disagree on mtime flags, and statSync-style
 * reads avoid a spawn per file (0411 R3).
 */
export async function readVerdictMtimeVector(fs: FileSystem, runDir: string): Promise<string[]> {
    const dir = runDir.replace(/\/$/, '');
    const vector: string[] = [];
    const seen = new Set<string>();
    for (const plane of [join(dirname(dir), 'memory', 'evidence'), dir]) {
        let entries: string[];
        try {
            entries = await fs.readDir(plane);
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (!entry.endsWith('-verdict.json') || seen.has(entry)) continue;
            seen.add(entry);
            try {
                const stat = await fs.stat(join(plane, entry));
                if (stat) vector.push(`${entry.replace('-verdict.json', '')}:${stat.mtimeMs}`);
            } catch {
                // Removed between readDir and stat — treat as absent.
            }
        }
    }
    return vector.sort();
}
