import { createHash } from 'node:crypto';
import type { ActionRunRow } from '@gobing-ai/spur-domain';
import { canonicalJsonStringify } from './composition-baseline';

/** D4 transport bounds — same per-row/per-window ceilings as the 0910 responder. */
const MAX_EVIDENCE_ROWS = 20;
const MAX_ROW_TEXT_CHARS = 2000;
const MAX_SERIALIZED_BYTES = 32 * 1024;
const MAX_SUMMARY_BYTES = 8 * 1024;

/** Closed evidence-rejection reason vocabulary (subset of the D5 reason list). */
export type EvidenceRejectionReason = 'missing-evidence' | 'stale-evidence' | 'invalid-evidence' | 'oversized-evidence';

/** One projected, redacted, bounded evidence row ready for transport. */
export type SelectedEvidenceRow = {
    /** Persisted action-row id — the stable evidence identifier. */
    actionId: string;
    node: string;
    kind: string;
    ok: boolean;
    /** Allow-listed outcome text (error/stdout/stderr/summary), redacted and bounded. */
    result: string;
};

/** Successful selection: the evidence rows that will be sent to the decision maker. */
export interface EvidenceSelection {
    ok: true;
    rows: SelectedEvidenceRow[];
    /** Stable action ids in deterministic producer-order (provenance input). */
    actionIds: string[];
}

/** Failed selection with a machine-checkable rejection reason. */
export interface EvidenceRejection {
    ok: false;
    reason: EvidenceRejectionReason;
}

/** Clean-text helper shared with the evaluator: redact secrets and credential patterns, then bound. */
export type TextCleaner = (text: string, limit?: number) => string;

/** Raw registered-artifact read produced by the composition root (fs + ArtifactDao). */
export type ArtifactResolution =
    | { ok: true; artifactId: string; raw: string }
    | { ok: false; reason: EvidenceRejectionReason };

/**
 * Resolves a declared summary artifact to its registered id + raw bytes. Built by the application
 * composition root so filesystem/DAO policy stays out of the pure evaluator.
 */
export interface SummaryResolver {
    resolve(runId: string, path: string): Promise<ArtifactResolution>;
}

/** Select allow-listed evidence rows for the named producer nodes; deterministic order. */
export function selectEvidence(
    allRows: readonly ActionRunRow[],
    producerNodes: readonly string[],
    cleaner: TextCleaner,
): EvidenceSelection | EvidenceRejection {
    if (producerNodes.length > MAX_EVIDENCE_ROWS) {
        // Never silently truncate a declared producer: an incomplete window defers.
        return { ok: false, reason: 'oversized-evidence' };
    }

    const selected: SelectedEvidenceRow[] = [];
    for (const node of producerNodes) {
        const nodeRows = allRows.filter((row) => row.node === node);
        if (nodeRows.length === 0) return { ok: false, reason: 'missing-evidence' };

        // An in-flight replacement for this producer makes any completed attempt stale — defer
        // rather than deciding on an outcome that is about to be superseded.
        const inFlight = nodeRows.find((row) => row.status !== 'done' && row.status !== 'failed');
        if (inFlight !== undefined) return { ok: false, reason: 'stale-evidence' };

        const completed = nodeRows.filter(
            (row) => (row.status === 'done' || row.status === 'failed') && row.ok !== null,
        );
        if (completed.length === 0) return { ok: false, reason: 'missing-evidence' };

        // Latest completed attempt by persisted timestamp, id tiebreak. Ambiguous latest
        // attempts sharing a timestamp defer (random id order is not chronology).
        const byRecency = [...completed].sort((a, b) => {
            const ca = a.completed_at ?? '';
            const cb = b.completed_at ?? '';
            if (ca !== cb) return ca < cb ? 1 : -1;
            return a.id < b.id ? 1 : -1;
        });
        const latest = byRecency[0];
        if (latest === undefined) return { ok: false, reason: 'missing-evidence' };
        const runnerUp = byRecency[1];
        if (runnerUp !== undefined) {
            const latestTs = latest.completed_at ?? '';
            if (latestTs !== '' && runnerUp.completed_at === latestTs) {
                return { ok: false, reason: 'invalid-evidence' };
            }
        }

        const result = outcomeText(latest.result_json, cleaner);
        if (result === null) return { ok: false, reason: 'invalid-evidence' };

        selected.push({
            actionId: latest.id,
            node: latest.node,
            kind: cleaner(latest.kind, 256),
            ok: latest.ok === 1,
            result,
        });
    }

    if (selected.length === 0) return { ok: false, reason: 'missing-evidence' };
    return { ok: true, rows: selected, actionIds: selected.map((row) => row.actionId) };
}

/**
 * Parse and validate a registered summary-artifact envelope (D4). The envelope's own summary must
 * equal the producing action's recorded (redacted, bounded) outcome so a different or stale file
 * cannot supply unrelated evidence.
 */
export function parseSummaryEnvelope(
    raw: string,
    runId: string,
    evidenceNodes: readonly string[],
    selected: readonly SelectedEvidenceRow[],
    cleaner: TextCleaner,
): { ok: true; summary: string } | { ok: false; reason: EvidenceRejectionReason } {
    if (Buffer.byteLength(raw, 'utf8') > MAX_SUMMARY_BYTES) return { ok: false, reason: 'oversized-evidence' };
    let envelope: unknown;
    try {
        envelope = JSON.parse(raw);
    } catch {
        return { ok: false, reason: 'invalid-evidence' };
    }
    if (typeof envelope !== 'object' || envelope === null) return { ok: false, reason: 'invalid-evidence' };
    const env = envelope as Record<string, unknown>;
    if (env.schemaVersion !== 1) return { ok: false, reason: 'invalid-evidence' };
    if (env.runId !== runId) return { ok: false, reason: 'stale-evidence' };
    if (typeof env.producerNode !== 'string' || !evidenceNodes.includes(env.producerNode)) {
        return { ok: false, reason: 'invalid-evidence' };
    }
    const producerRow = selected.find((row) => row.node === env.producerNode);
    if (producerRow === undefined || env.producerActionId !== producerRow.actionId) {
        return { ok: false, reason: 'stale-evidence' };
    }
    if (typeof env.summary !== 'string') return { ok: false, reason: 'invalid-evidence' };
    const summary = cleaner(env.summary, MAX_ROW_TEXT_CHARS);
    if (summary !== producerRow.result) return { ok: false, reason: 'stale-evidence' };
    return { ok: true, summary };
}

/**
 * Reproducible digest over the canonical evidence payload actually sent (sorted keys). Same
 * unchanged evidence yields the same digest; a new producer attempt or different summary changes it.
 */
export function evidencePayloadDigest(payload: unknown): string {
    return `sha256:${createHash('sha256').update(canonicalJsonStringify(payload), 'utf8').digest('hex')}`;
}

/** Project only the allow-listed outcome fields (error/stdout/stderr/summary), redacted and bounded. */
function outcomeText(raw: string | null, clean: TextCleaner): string | null {
    if (!raw) return '';
    let result: unknown;
    try {
        result = JSON.parse(raw);
    } catch {
        return null;
    }
    if (typeof result !== 'object' || result === null) return null;
    const fields = result as Record<string, unknown>;
    const data =
        typeof fields.data === 'object' && fields.data !== null ? (fields.data as Record<string, unknown>) : {};
    return clean(
        [fields.error, data.stdout, data.stderr, data.summary]
            .filter((value): value is string => typeof value === 'string')
            .join('\n'),
        MAX_ROW_TEXT_CHARS,
    );
}

export { MAX_EVIDENCE_ROWS, MAX_ROW_TEXT_CHARS, MAX_SERIALIZED_BYTES, MAX_SUMMARY_BYTES };
