import { HISTORY_ARTIFACT_SCHEMA_VERSION, type HistoryArtifact } from './artifact';
import { formatSummary } from './costs';
import type { AnalyticsSummary } from './types';

/**
 * An artifact whose `schemaVersion` the renderer does not understand. Carries the
 * path (so the operator knows which file) and the expected version (so they know
 * what the renderer wanted). Thrown **before** any rendering — a partial report
 * for an unknown shape would mislead the reader (R4).
 */
export class ArtifactVersionError extends Error {
    readonly artifactPath: string;
    readonly expectedVersion: number;
    readonly actualVersion: number;

    constructor(artifactPath: string, expectedVersion: number, actualVersion: number) {
        super(
            `Artifact ${artifactPath} has schemaVersion ${actualVersion}; this renderer understands version ${expectedVersion} only. ` +
                'Re-run `spur history analyze` to regenerate, or install a newer Spur.',
        );
        this.name = 'ArtifactVersionError';
        this.artifactPath = artifactPath;
        this.expectedVersion = expectedVersion;
        this.actualVersion = actualVersion;
    }
}

/**
 * Refuse an artifact whose schema version is not the one this renderer understands.
 * There is no migration path (0464 R2): old artifacts stay readable by old
 * renderers, and a future v2 is the ADR-worthy event. The check is therefore
 * equality, not `>=`. Call this **after** parse and **before** any rendering.
 */
export function assertArtifactVersion(
    actualVersion: number,
    artifactPath: string,
    expectedVersion: number = HISTORY_ARTIFACT_SCHEMA_VERSION,
): void {
    if (actualVersion !== expectedVersion) {
        throw new ArtifactVersionError(artifactPath, expectedVersion, actualVersion);
    }
}

/** How old an artifact may be before the staleness banner fires (R7). */
export const STALENESS_THRESHOLD_HOURS = 36;

/** Format milliseconds for humans: `1.2s` or `86ms`. */
function fmtDur(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/**
 * Format a duration that may be entirely unmeasured. When the bucket has tool
 * calls but every one of them lacked `duration_ms`, the value is *unknown* — not
 * zero — and renders `n/a` through the same spelling {@link formatRatio} uses.
 * One `n/a` convention across the report (R5).
 */
function fmtDurOrNa(ms: number, bucket: { durationUnmeasured: number; toolCalls: number }): string {
    const allUnmeasured = bucket.toolCalls > 0 && bucket.durationUnmeasured === bucket.toolCalls;
    return allUnmeasured ? 'n/a' : fmtDur(ms);
}

function fmtBytes(bytes: number): string {
    if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
    if (bytes >= 1000) return `${(bytes / 1000).toFixed(1)} KB`;
    return `${bytes} B`;
}

/**
 * Adapt the artifact's `totals` / `bySource` / `byModel` / `daily` into the
 * {@link AnalyticsSummary} shape {@link formatSummary} expects. This is R2's reuse
 * mechanism — the padded spend layout is never re-implemented; it is fed from
 * artifact fields through this adapter.
 */
export function artifactToSummary(artifact: HistoryArtifact): AnalyticsSummary {
    return {
        totals: artifact.totals,
        bySource: artifact.bySource,
        byModel: artifact.byModel,
        daily: artifact.daily,
    };
}

/** Render the per-tool forensic section: time cost, call/error counts, result bytes (R3). */
function renderByTool(artifact: HistoryArtifact): string[] {
    const lines: string[] = ['Per-tool time · calls · result bytes:'];
    if (artifact.byTool.length === 0) {
        lines.push('  (no tool calls in selection)');
        return lines;
    }
    for (const t of artifact.byTool) {
        const bucket = { durationUnmeasured: t.durationUnmeasured, toolCalls: t.calls };
        lines.push(
            `  ${t.toolName.slice(0, 26).padEnd(26)} ` +
                `${String(t.calls).padStart(6)} calls  ${String(t.errors).padStart(5)} err  ` +
                `${fmtDurOrNa(t.durationMsTotal, bucket).padStart(8)} total  ` +
                `${fmtDurOrNa(t.durationMsMean, bucket).padStart(7)} mean  ` +
                `${fmtDurOrNa(t.durationMsMax, bucket).padStart(7)} max  ` +
                `${fmtBytes(t.resultBytes).padStart(9)}`,
        );
    }
    return lines;
}

/** Render detected repeated-call loops (R3, Q4). */
function renderLoops(artifact: HistoryArtifact): string[] {
    const lines: string[] = [`Detected loops (${artifact.loops.length}):`];
    if (artifact.loops.length === 0) {
        lines.push('  (none detected)');
        return lines;
    }
    for (const l of artifact.loops) {
        lines.push(
            `  ${l.toolName.slice(0, 22).padEnd(22)} x${String(l.repeats).padStart(3)}  ` +
                `${l.sessionId.slice(0, 16)}  args ${l.argsDigest}  seq ${l.firstSeq}-${l.lastSeq}`,
        );
    }
    return lines;
}

/** Render the session leaderboard (R3, Q5). */
function renderBySession(artifact: HistoryArtifact): string[] {
    const lines: string[] = [`Session leaderboard (${artifact.bySession.length}):`];
    if (artifact.bySession.length === 0) {
        lines.push('  (no sessions in selection)');
        return lines;
    }
    for (const s of artifact.bySession) {
        const tokens = (s.tokens / 1_000_000).toFixed(1);
        lines.push(
            `  ${s.sessionId.slice(0, 18).padEnd(18)} ` +
                `${s.source.slice(0, 8).padEnd(8)} ` +
                `${String(s.messages).padStart(5)} msg  ${String(s.toolCalls).padStart(5)} calls  ` +
                `${tokens.padStart(6)}M tok  $${s.costUsd.toFixed(2).padStart(7)}` +
                (s.topTool ? `  top: ${s.topTool}` : ''),
        );
    }
    return lines;
}

/** Render per-source coverage with ok/failed/empty status (status values from 0470). */
function renderCoverage(artifact: HistoryArtifact): string[] {
    const lines: string[] = ['Coverage:'];
    if (artifact.coverage.length === 0) {
        lines.push('  (no sources)');
        return lines;
    }
    for (const c of artifact.coverage) {
        lines.push(
            `  ${c.source.slice(0, 12).padEnd(12)} ${c.status.padEnd(7)} ` +
                `${String(c.files).padStart(5)} files  ${String(c.messages).padStart(6)} msg  ` +
                `${String(c.toolCalls).padStart(6)} calls  ${String(c.unknownRecords).padStart(5)} unknown`,
        );
    }
    return lines;
}

/**
 * Render the artifact into a human-readable stdout report (R1–R5). Pure: no I/O,
 * no `DbAdapter`. The spend rollup is produced by {@link formatSummary} via
 * {@link artifactToSummary} — never re-implemented (R2). Forensic sections the
 * spend summary cannot express follow (R3). Unmeasured values render `n/a`,
 * never `0` (R5).
 */
export function renderReport(artifact: HistoryArtifact): string {
    const lines: string[] = [];

    lines.push(`History report — generated ${artifact.generatedAt}`);
    lines.push(`spur ${artifact.spurVersion} · schema v${artifact.schemaVersion}`);
    lines.push('');

    // Spend rollup — reuse, never re-implement (R2).
    lines.push(formatSummary(artifactToSummary(artifact)));
    lines.push('');

    // Forensic sections the spend summary cannot express (R3).
    lines.push(...renderByTool(artifact));
    lines.push('');
    lines.push(...renderLoops(artifact));
    lines.push('');
    lines.push(...renderBySession(artifact));
    lines.push('');
    lines.push(...renderCoverage(artifact));

    return lines.join('\n');
}

/**
 * Render the markdown sidecar body (R8). Same content as {@link renderReport}
 * wrapped in a fenced block with a one-line header, so the morning read needs no
 * CLI invocation. Written beside the JSON artifact, same basename, `.md`.
 */
export function renderMarkdown(artifact: HistoryArtifact): string {
    const header = `<!-- Generated by spur history report · schema v${artifact.schemaVersion} · ${artifact.generatedAt} -->`;
    const body = renderReport(artifact);
    return `${header}\n\n\`\`\`\n${body}\n\`\`\`\n`;
}

/**
 * True when the artifact is older than {@link STALENESS_THRESHOLD_HOURS}. Pure —
 * the clock is a parameter so tests never depend on wall time.
 */
export function isStale(generatedAt: string, now: Date, thresholdHours = STALENESS_THRESHOLD_HOURS): boolean {
    const ageMs = now.getTime() - new Date(generatedAt).getTime();
    return ageMs > thresholdHours * 60 * 60 * 1000;
}

/**
 * Format the staleness banner, or return `null` when the artifact is fresh.
 * Printed **before** the report body (R7), and only when no explicit path was
 * given — an operator who named a file already knows its age.
 */
export function stalenessBanner(
    generatedAt: string,
    now: Date,
    thresholdHours = STALENESS_THRESHOLD_HOURS,
): string | null {
    if (!isStale(generatedAt, now, thresholdHours)) return null;
    const ageHours = (now.getTime() - new Date(generatedAt).getTime()) / (60 * 60 * 1000);
    const readable = ageHours >= 24 ? `${(ageHours / 24).toFixed(1)} days` : `${Math.round(ageHours)} hours`;
    return (
        `⚠ STALE ARTIFACT — generated ${readable} ago (threshold ${thresholdHours}h).\n` +
        'Re-run `spur history analyze` to refresh. This banner means the daily loop may have stopped.\n'
    );
}
