/**
 * Canonical verify-verdict contract (task 0592, feature F92).
 *
 * One runtime-validated schema, parser, and aggregation policy for the persisted
 * verdict artifact — replacing the loose interfaces and per-consumer decoders that
 * previously lived across task-record, task-verdict, done-transition-guard,
 * task-check, and feature-check. The done-transition choke point (done-transition-guard)
 * is the final authority: it re-parses with this canonical parser and re-evaluates
 * the aggregate with this one shared function before any `done` transition allows.
 *
 * R1 — the schema distinguishes missing file (`missing`), malformed JSON
 * (`malformed`), structurally invalid (`invalid`), and valid non-PASS / valid PASS
 * (`valid` with the normalized `verdict`). The `scenario` compatibility alias is
 * normalized to `id` in exactly one place (here).
 *
 * R2 — `aggregateVerifyVerdict` is the one aggregation policy every verdict
 * consumer uses. Requirements/AC use MET/PARTIAL/UNMET/N/A; checks carry an optional
 * blocker/major/minor/advisory severity. Non-pass blocker → FAIL, non-pass major →
 * PARTIAL, minor/advisory do not block; legacy rows without severity map `fail` →
 * FAIL and `warn` → PARTIAL. An independent task-check failure can never yield PASS.
 */

import type { FileSystem } from '@gobing-ai/ts-runtime';
import { z } from 'zod';

// ─── Enums / canonical types ───────────────────────────────────────────

/** Canonical set of verdict aggregate values. */
export const VERDICT_AGGREGATES = ['PASS', 'PARTIAL', 'FAIL', 'UNKNOWN'] as const;
/** Canonical verdict aggregate type derived from {@link VERDICT_AGGREGATES}. */
export type VerdictAggregate = (typeof VERDICT_AGGREGATES)[number];

/** Canonical requirement/AC row statuses. */
export const ROW_STATUSES = ['MET', 'PARTIAL', 'UNMET', 'N/A'] as const;
/** Canonical requirement/AC row status type derived from {@link ROW_STATUSES}. */
export type VerdictRowStatus = (typeof ROW_STATUSES)[number];

/** Canonical check severities used by the aggregation policy. */
export const CHECK_SEVERITIES = ['blocker', 'major', 'minor', 'advisory'] as const;
/** Canonical check severity type derived from {@link CHECK_SEVERITIES}. */
export type CheckSeverity = (typeof CHECK_SEVERITIES)[number];

/** A requirement or Acceptance Criteria coverage row after canonical normalization. */
export interface VerdictCoverageRow {
    id: string;
    status: VerdictRowStatus;
    evidenceType: string;
    evidence: string;
}

/** A single check (review finding / gate outcome) recorded in the artifact. */
export interface VerdictCheck {
    name: string;
    status: string;
    evidence: string;
    severity?: CheckSeverity;
}

/** The canonical, runtime-validated verdict artifact. */
export interface VerifyVerdict {
    wbs: string;
    verdict: VerdictAggregate;
    requirements: VerdictCoverageRow[];
    acceptanceCriteria: VerdictCoverageRow[];
    checks: VerdictCheck[];
    /** Producer of the artifact (e.g. `spur-task-verdict`). */
    source?: string;
    /** Provenance — the recorded pipeline run id that produced this verdict. */
    pipelineRunId?: string;
    recordedAt?: string;
}

/** Discriminated result of parsing an artifact (R1: missing/malformed/invalid/valid). */
export type ParseVerdictOutcome =
    | { kind: 'missing'; wbs: string }
    | { kind: 'malformed'; wbs: string; message: string }
    | { kind: 'invalid'; wbs: string; reason: string; issues?: string[] }
    | { kind: 'valid'; wbs: string; verdict: VerifyVerdict };

// ─── Zod schema (the executable contract) ──────────────────────────────

const verdictSchema = z.string().transform((v, ctx): VerdictAggregate => {
    const up = v.toUpperCase();
    if (!(VERDICT_AGGREGATES as readonly string[]).includes(up)) {
        ctx.addIssue({ code: 'custom', message: `invalid verdict "${v}" (expected PASS|PARTIAL|FAIL|UNKNOWN)` });
        return 'UNKNOWN';
    }
    return up as VerdictAggregate;
});

/**
 * Coverage row input → canonical row. Accepts the `scenario` compatibility alias
 * and normalizes it to `id` (single normalization point, R1). A row carrying both
 * a different `id` and `scenario` is structurally invalid (conflict).
 */
const coverageRowSchema = z
    .object({
        id: z.string().optional(),
        scenario: z.string().optional(),
        status: z.string(),
        evidenceType: z.string().optional(),
        evidence: z.string().optional(),
    })
    .superRefine((r, ctx) => {
        if (r.id !== undefined && r.scenario !== undefined && r.id !== r.scenario) {
            ctx.addIssue({
                code: 'custom',
                message: `id/scenario conflict ("${r.id}" vs "${r.scenario}")`,
                path: ['scenario'],
            });
        }
        if (!(ROW_STATUSES as readonly string[]).includes(r.status.toUpperCase())) {
            ctx.addIssue({ code: 'custom', message: `invalid row status "${r.status}"`, path: ['status'] });
        }
    })
    .transform(
        (r): VerdictCoverageRow => ({
            id: r.id ?? r.scenario ?? '',
            status: r.status.toUpperCase() as VerdictRowStatus,
            evidenceType: r.evidenceType ?? '',
            evidence: r.evidence ?? '',
        }),
    );

/**
 * Check row input → canonical row. The corpus records the check's label under
 * `name`, `check`, or `id` depending on which pipeline generation wrote it, so
 * all three are accepted and normalized to `name` here — the single
 * normalization point (R1), mirroring the `scenario`→`id` coverage alias. A row
 * carrying none of them is structurally invalid: an unnamed check cannot be
 * matched by the aggregation policy's task-check detection.
 */
const checkSchema = z
    .object({
        name: z.string().optional(),
        check: z.string().optional(),
        id: z.string().optional(),
        status: z.string(),
        evidence: z.string().optional().default(''),
        severity: z.enum(CHECK_SEVERITIES).optional(),
    })
    .superRefine((c, ctx) => {
        if (c.name === undefined && c.check === undefined && c.id === undefined) {
            ctx.addIssue({ code: 'custom', message: 'check row needs one of name/check/id', path: ['name'] });
        }
    })
    .transform(
        (c): VerdictCheck => ({
            name: c.name ?? c.check ?? c.id ?? '',
            status: c.status,
            evidence: c.evidence,
            severity: c.severity,
        }),
    );

/** Canonical Zod schema for a verdict artifact (the single executable contract). */
export const verifyVerdictSchema = z.object({
    wbs: z.string().optional().default(''),
    verdict: verdictSchema,
    requirements: z.array(coverageRowSchema).optional().default([]),
    acceptanceCriteria: z.array(coverageRowSchema).optional().default([]),
    checks: z.array(checkSchema).optional().default([]),
    source: z.string().optional(),
    pipelineRunId: z.string().optional(),
    recordedAt: z.string().optional(),
});

// ─── Parser (R1) ───────────────────────────────────────────────────────

/**
 * Parse raw verdict JSON into the canonical {@link VerifyVerdict}, distinguishing
 * missing (empty content), malformed (bad JSON), invalid (structurally wrong), and
 * valid. Never throws. A missing/malformed/invalid artifact can never be read as PASS.
 */
export function parseVerifyVerdict(raw: string, fallbackWbs?: string): ParseVerdictOutcome {
    const wbs = fallbackWbs ?? '';
    if (raw.trim() === '') return { kind: 'missing', wbs };

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        return { kind: 'malformed', wbs, message: (err as Error).message };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { kind: 'invalid', wbs, reason: 'root must be a JSON object' };
    }

    const result = verifyVerdictSchema.safeParse(parsed);
    if (!result.success) {
        const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
        return { kind: 'invalid', wbs, reason: issues.join('; '), issues };
    }

    const verdict: VerifyVerdict = { ...result.data, wbs: result.data.wbs !== '' ? result.data.wbs : wbs };
    return { kind: 'valid', wbs, verdict };
}

/**
 * Read + parse a verdict artifact via a {@link FileSystem}. Returns `missing` when
 * the file does not exist. Never throws.
 */
export async function readVerifyVerdict(
    fs: FileSystem,
    path: string,
    fallbackWbs?: string,
): Promise<ParseVerdictOutcome> {
    let raw: string;
    try {
        raw = await fs.readFile(path);
    } catch {
        return { kind: 'missing', wbs: fallbackWbs ?? '' };
    }
    return parseVerifyVerdict(raw, fallbackWbs);
}

// ─── Aggregation (R2 — one shared policy) ──────────────────────────────

export interface AggregateVerdictInput {
    requirements?: Array<{ id?: unknown; status?: unknown; evidence?: unknown }>;
    acceptanceCriteria?: Array<{ id?: unknown; status?: unknown; evidence?: unknown }>;
    checks?: Array<{ name?: unknown; check?: unknown; id?: unknown; status?: unknown; severity?: unknown }>;
    /** Independent `spur task check` outcome. When false, the aggregate cannot be PASS. */
    taskCheckPassed?: boolean;
}

/**
 * The check row's label, whichever alias it was written under (`name` / `check` /
 * `id`). Aggregation runs on raw rows as well as parsed ones, so the alias must be
 * resolved here too — a row named only under `check` must still be recognizable.
 */
export function checkRowName(row: { name?: unknown; check?: unknown; id?: unknown }): string {
    for (const v of [row.name, row.check, row.id]) {
        if (typeof v === 'string' && v.trim() !== '') return v.trim();
    }
    return '';
}

/** True when a check row is the independent task-check outcome (not a review finding). */
function isTaskCheckRow(row: { name?: unknown; check?: unknown; id?: unknown }): boolean {
    return /task[ _-]?check/i.test(checkRowName(row));
}

const NORM = (s: unknown): string => String(s ?? '').toUpperCase();

/**
 * A MET coverage row whose evidence is absent, empty, whitespace-only, or not a
 * string cannot support PASS (0721 R1): the status claims success, but nothing
 * records it. Hollow MET aggregates as PARTIAL — after FAIL/blocker precedence,
 * before the final PASS. Populated MET rows are unaffected, and empty evidence
 * stays legal for UNMET/PARTIAL/N/A rows.
 */
function isHollowMet(row: { status?: unknown; evidence?: unknown }): boolean {
    return NORM(row.status) === 'MET' && !(typeof row.evidence === 'string' && row.evidence.trim() !== '');
}

/**
 * Aggregate the verdict from its rows + checks. This is the ONE aggregation function
 * every consumer uses: answer derivation, persisted-artifact consistency (done guard),
 * task/feature validation, record rendering, and done enforcement.
 *
 * Ordering:
 *   1. no rows at all                          → UNKNOWN
 *   2. any UNMET req/AC                        → FAIL
 *   3. non-pass blocker (or legacy no-severity `fail`) check → FAIL
 *   4. non-pass major (or legacy no-severity `warn`) check  → PARTIAL
 *   5. any PARTIAL req/AC, or MET row with hollow evidence → PARTIAL (0721)
 *   6. task-check failed                        → PARTIAL
 *   7. otherwise                                → PASS
 */
export function aggregateVerifyVerdict(input: AggregateVerdictInput): VerdictAggregate {
    // Trust boundary: only arrays are rows/checks — a structurally-invalid artifact
    // (e.g. `requirements` is a string) must degrade to UNKNOWN, never throw and
    // never read as PASS.
    const reqs = Array.isArray(input.requirements) ? (input.requirements as Array<{ status?: unknown }>) : [];
    const acs = Array.isArray(input.acceptanceCriteria)
        ? (input.acceptanceCriteria as Array<{ status?: unknown }>)
        : [];
    const checks = Array.isArray(input.checks)
        ? (input.checks as Array<{
              name?: unknown;
              check?: unknown;
              id?: unknown;
              status?: unknown;
              severity?: unknown;
          }>)
        : [];

    if (reqs.length === 0 && acs.length === 0) return 'UNKNOWN';

    if (reqs.some((r) => NORM(r.status) === 'UNMET') || acs.some((a) => NORM(a.status) === 'UNMET')) return 'FAIL';

    let majorBlocked = false;
    for (const c of checks) {
        if (isTaskCheckRow(c)) continue; // handled via taskCheckPassed below
        const status = NORM(c.status);
        if (status === 'PASS' || status === '') continue;
        const severity = NORM(c.severity);
        // Legacy rows (no severity): `fail` → FAIL, `warn` → PARTIAL. Rows with an
        // explicit severity: blocker → FAIL, major → PARTIAL; minor/advisory do not block.
        // A blocker anywhere dominates — return FAIL immediately rather than deferring to a
        // later PARTIAL, so major-then-blocker ordering cannot yield PARTIAL (0592 review).
        if (severity === 'BLOCKER' || (severity === '' && status === 'FAIL')) return 'FAIL';
        if (severity === 'MAJOR' || (severity === '' && status === 'WARN')) majorBlocked = true;
        // minor/advisory, or a fail/warn explicitly tagged non-blocking — continue.
    }
    if (majorBlocked) return 'PARTIAL';

    if (
        reqs.some((r) => NORM(r.status) === 'PARTIAL' || isHollowMet(r)) ||
        acs.some((a) => NORM(a.status) === 'PARTIAL' || isHollowMet(a))
    )
        return 'PARTIAL';

    if (input.taskCheckPassed === false) return 'PARTIAL';

    return 'PASS';
}
