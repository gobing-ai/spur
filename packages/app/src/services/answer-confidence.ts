/**
 * Answer confidence — the derived `Confidence: HIGH|MEDIUM|LOW` contract for answer artifacts.
 *
 * ADR-141 supersedes the ADR-138 amendment's "no level anywhere" invariant for exactly one surface:
 * the review and verify answers. The level is **derived from what the answer actually shows** and the
 * answer's own `Confidence:` line is **cross-checked** against that derivation — a mismatch is a
 * rejection, so the label cannot be asserted past the gate. That is the difference the ADR-138
 * amendment demanded: the grade measures evidence composition (executable vs non-executable AC
 * evidence, requirement/AC statuses, finding dispositions), which no existing artifact recorded.
 *
 * Not revived: verdict-artifact `confidence` fields, feature-receipt levels, `ackLowConfidence`-style
 * operator vars, per-finding history-anatomy confidence, and any decision-engine grading. Those stay
 * retired (ADR-138 §Invariant), and `confidence` in an artifact remains absent by design.
 */

/** The three levels, strongest first — the only accepted vocabulary. */
export const CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const;

/** One derived-or-stated confidence level. */
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/** A parsed `Confidence:` line: the level plus its 1-based line number. */
export interface ConfidenceLine {
    level: ConfidenceLevel;
    line: number;
}

/** Evidence types a reader can re-run. Everything else is a citation, a review note, or absent. */
const EXECUTABLE_EVIDENCE_TYPES = new Set(['test', 'command']);

/** Normalize a raw level token; `null` when it is not one of the three. */
export function normalizeConfidenceLevel(raw: string): ConfidenceLevel | null {
    const token = raw.trim().toUpperCase();
    return (CONFIDENCE_LEVELS as readonly string[]).includes(token) ? (token as ConfidenceLevel) : null;
}

/**
 * Every top-level `Confidence:` line in the answer, in file order. A line counts when it starts with
 * `Confidence:` (markdown emphasis and a leading bullet are tolerated); indented table cells do not.
 */
export function parseConfidenceLines(text: string): ConfidenceLine[] {
    const out: ConfidenceLine[] = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        // Emphasis is stripped first so `**Confidence:** LOW` reads the same as `Confidence: LOW`.
        const raw = (lines[i] ?? '').trim().replace(/\*\*/g, '');
        const match = /^[-*]?\s*Confidence\s*:\s*(.*)$/i.exec(raw);
        if (match === null) continue;
        const level = normalizeConfidenceLevel((match[1] ?? '').replace(/[^A-Za-z].*$/, ''));
        if (level !== null) out.push({ level, line: i + 1 });
    }
    return out;
}

/** One verify-answer row, reduced to what the derivation reads. */
export interface VerifyConfidenceRow {
    status: string;
    evidenceType?: string;
}

/** One review-answer finding row, reduced to what the derivation reads. */
export interface ReviewConfidenceRow {
    priority: string;
    disposition: string;
}

/**
 * Derive the verify-answer level.
 *
 * - **LOW** — the verdict is not PASS, or any requirement/AC row is PARTIAL/UNMET.
 * - **HIGH** — PASS with every AC row MET on executable evidence (`test`/`command`, compounds allowed).
 * - **MEDIUM** — everything else: all ACs MET, but at least one rests on a citation (`static-ref`),
 *   a manual review, an LLM judge, or is declared `N/A`.
 */
export function deriveVerifyConfidence(input: {
    verdict: string | null | undefined;
    requirements: readonly VerifyConfidenceRow[];
    acceptanceCriteria: readonly VerifyConfidenceRow[];
}): ConfidenceLevel {
    const verdict = (input.verdict ?? '').trim().toUpperCase();
    if (verdict !== 'PASS') return 'LOW';
    const statuses = [...input.requirements, ...input.acceptanceCriteria].map((row) => row.status.trim().toUpperCase());
    if (statuses.some((status) => status === 'PARTIAL' || status === 'UNMET')) return 'LOW';

    const acs = input.acceptanceCriteria;
    const allExecutable = acs.every((row) => {
        const status = row.status.trim().toUpperCase();
        if (status !== 'MET') return false;
        const types = (row.evidenceType ?? '')
            .split('+')
            .map((t) => t.trim().toLowerCase())
            .filter((t) => t.length > 0);
        return types.some((t) => EXECUTABLE_EVIDENCE_TYPES.has(t));
    });
    return allExecutable ? 'HIGH' : 'MEDIUM';
}

/** Dispositions that leave the finding live. */
const OPEN_DISPOSITIONS = new Set(['', 'OPEN']);
/** Dispositions a reviewer deliberately carried into the wrap. */
const CARRIED_DISPOSITIONS = new Set(['ACCEPTED']);

/**
 * Derive the review-answer level.
 *
 * - **LOW** — the verdict is not PASS, or an open (undispositioned/`OPEN`) P1–P3 row survives.
 * - **HIGH** — PASS, every finding closed (`RESOLVED`/`FIXED`/`DONE`) and no carried residual.
 * - **MEDIUM** — PASS with carried residuals only: `DEFER(...)` or `ACCEPTED`, or an `OPEN` P4.
 */
export function deriveReviewConfidence(input: {
    verdict: string | null | undefined;
    findings: readonly ReviewConfidenceRow[];
}): ConfidenceLevel {
    const verdict = (input.verdict ?? '').trim().toUpperCase();
    if (verdict !== 'PASS') return 'LOW';

    let carried = false;
    for (const row of input.findings) {
        const priority = row.priority.trim().toUpperCase();
        const disposition = row.disposition.trim().toUpperCase();
        const open = OPEN_DISPOSITIONS.has(disposition);
        const blockingPriority = priority.startsWith('P1') || priority.startsWith('P2') || priority.startsWith('P3');
        if (open && blockingPriority) return 'LOW';
        if (open && priority.startsWith('P4')) carried = true;
        if (disposition.startsWith('DEFER') || CARRIED_DISPOSITIONS.has(disposition)) carried = true;
    }
    return carried ? 'MEDIUM' : 'HIGH';
}

/** The rejection message a linter emits when the stated level is not the derived one. */
export function confidenceMismatchMessage(stated: ConfidenceLevel, derived: ConfidenceLevel, basis: string): string {
    return (
        `states \`Confidence: ${stated}\` but the answer's own rows derive ${derived} (${basis}) — ` +
        `state \`Confidence: ${derived}\` or produce the evidence that lifts it`
    );
}
