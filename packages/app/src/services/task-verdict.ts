/**
 * Task verdict — deterministic verdict derivation from verify step output.
 *
 * Pure functions: same input → same output. Extracted from the pipeline YAML's
 * grep/shell block (task 0111; same pattern as task 0108's spur task record).
 */

import type { TaskStatus } from '@gobing-ai/spur-domain/schema';
import type { VerdictCheck, VerdictRequirement, VerifyVerdict } from './task-record';

// ─── Types ──────────────────────────────────────────────────────────────

/** Raw answer text from the verify step's agent.run output. */
export type AnswerText = string;

/** Outcome of verdict derivation. */
export interface VerdictResult {
    verdict: 'PASS' | 'PARTIAL' | 'FAIL' | 'UNKNOWN';
    requirements: VerdictRequirement[];
    acceptanceCriteria?: VerdictAcceptanceCriteria[];
    checks: VerdictCheck[];
}

/** A single Acceptance Criteria row evaluated during verification. */
export interface VerdictAcceptanceCriteria {
    id: string;
    status: 'MET' | 'PARTIAL' | 'UNMET' | 'N/A';
    evidenceType: 'test' | 'command' | 'static-ref' | 'manual-review' | 'llm-judge' | 'n/a';
    evidence: string;
}

// ─── Derivation ─────────────────────────────────────────────────────────

/**
 * Derive a verdict from verify answer text and `spur task check` exit status.
 *
 * Priority order:
 *   UNMET any requirement          → FAIL
 *   PARTIAL any (no UNMET)         → PARTIAL
 *   all MET + task check passes    → PASS
 *   unparseable input              → UNKNOWN
 */
export function deriveVerdict(answerText: AnswerText, taskCheckPassed: boolean): VerdictResult {
    const requirements = extractRequirements(answerText);
    const acceptanceCriteria = applyAcceptanceCriteriaEvidenceRule(extractAcceptanceCriteria(answerText));
    const checks = extractChecks(answerText, taskCheckPassed, acceptanceCriteria);

    // If we couldn't parse any requirements, the answer is unparseable.
    if (requirements.length === 0) {
        return { verdict: 'UNKNOWN', requirements, acceptanceCriteria, checks };
    }

    const hasUnmet = requirements.some((r) => r.status === 'UNMET');
    const hasUnmetAc = acceptanceCriteria.some((ac) => ac.status === 'UNMET');
    if (hasUnmet || hasUnmetAc) {
        return { verdict: 'FAIL', requirements, acceptanceCriteria, checks };
    }

    const hasPartial = requirements.some((r) => r.status === 'PARTIAL');
    const hasPartialAc = acceptanceCriteria.some((ac) => ac.status === 'PARTIAL');
    if (hasPartial || hasPartialAc) {
        return { verdict: 'PARTIAL', requirements, acceptanceCriteria, checks };
    }

    // All MET: gate on task check.
    if (!taskCheckPassed) {
        return { verdict: 'PARTIAL', requirements, acceptanceCriteria, checks };
    }

    return { verdict: 'PASS', requirements, acceptanceCriteria, checks };
}

// ─── Parsers ────────────────────────────────────────────────────────────

/**
 * Extract per-requirement rows from a verify answer body.
 *
 * Looks for a markdown table with `| Req | Status | Evidence |` or
 * `| Req | Status |` columns. Each data row becomes a VerdictRequirement.
 */
function extractRequirements(text: string): VerdictRequirement[] {
    const reqs: VerdictRequirement[] = [];
    const lines = text.split('\n');
    let inTable = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('|')) continue;

        const cells = trimmed
            .split('|')
            .map((c) => c.trim())
            .filter(Boolean);

        // Detect header row
        if (!inTable && cells.length >= 2) {
            const h0 = (cells[0] ?? '').toLowerCase();
            const h1 = (cells[1] ?? '').toLowerCase();
            if ((h0.includes('req') || h0 === 'requirement') && (h1.includes('status') || h1 === 'verdict')) {
                inTable = true;
                continue;
            }
        }

        // Skip separator rows
        if (/^[-:]+$/.test(cells[0] ?? '')) continue;

        if (inTable && cells.length >= 2) {
            const first = (cells[0] ?? '').toLowerCase();
            const second = (cells[1] ?? '').toLowerCase();
            if (
                (first === 'ac' || first.includes('acceptance') || first === 'check' || first === 'name') &&
                (second.includes('status') || second === 'verdict')
            ) {
                inTable = false;
                continue;
            }
            const id = cells[0] ?? '';
            const statusRaw = (cells[1] ?? '').toUpperCase();
            const evidence = cells.length >= 3 ? (cells[2] ?? '') : '';
            const status = normalizeStatus(statusRaw);
            if (status !== null && id.length > 0) {
                reqs.push({ id, status, evidence });
            }
        }
    }

    return reqs;
}

function normalizeStatus(raw: string): 'MET' | 'PARTIAL' | 'UNMET' | null {
    if (/\bMET\b/.test(raw)) return 'MET';
    if (/\bPARTIAL\b/.test(raw)) return 'PARTIAL';
    if (/\bUNMET\b/.test(raw)) return 'UNMET';
    return null;
}

function extractAcceptanceCriteria(text: string): VerdictAcceptanceCriteria[] {
    const rows: VerdictAcceptanceCriteria[] = [];
    const lines = text.split('\n');
    let inTable = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('|')) continue;

        const cells = trimmed
            .split('|')
            .map((c) => c.trim())
            .filter(Boolean);

        if (!inTable && cells.length >= 4) {
            const h0 = (cells[0] ?? '').toLowerCase();
            const h1 = (cells[1] ?? '').toLowerCase();
            const h2 = (cells[2] ?? '').toLowerCase();
            if ((h0 === 'ac' || h0.includes('acceptance')) && h1.includes('status') && h2.includes('evidence')) {
                inTable = true;
                continue;
            }
        }

        if (/^[-:]+$/.test(cells[0] ?? '')) continue;

        if (inTable && cells.length >= 4) {
            const id = cells[0] ?? '';
            const status = normalizeAcceptanceCriteriaStatus(cells[1] ?? '');
            const evidenceType = normalizeEvidenceType(cells[2] ?? '');
            const evidence = cells[3] ?? '';
            if (status !== null && evidenceType !== null && id.length > 0) {
                rows.push({ id, status, evidenceType, evidence });
            }
        }
    }

    return rows;
}

function normalizeAcceptanceCriteriaStatus(raw: string): VerdictAcceptanceCriteria['status'] | null {
    const upper = raw.toUpperCase();
    if (/\bMET\b/.test(upper)) return 'MET';
    if (/\bPARTIAL\b/.test(upper)) return 'PARTIAL';
    if (/\bUNMET\b/.test(upper)) return 'UNMET';
    if (/\bN\/A\b/.test(upper) || /\bNA\b/.test(upper)) return 'N/A';
    return null;
}

function normalizeEvidenceType(raw: string): VerdictAcceptanceCriteria['evidenceType'] | null {
    const normalized = raw.toLowerCase().trim();
    if (normalized === 'test') return 'test';
    if (normalized === 'command') return 'command';
    if (normalized === 'static-ref' || normalized === 'static') return 'static-ref';
    if (normalized === 'manual-review' || normalized === 'manual') return 'manual-review';
    if (normalized === 'llm-judge' || normalized === 'judge') return 'llm-judge';
    if (normalized === 'n/a' || normalized === 'na') return 'n/a';
    return null;
}

function applyAcceptanceCriteriaEvidenceRule(rows: VerdictAcceptanceCriteria[]): VerdictAcceptanceCriteria[] {
    return rows.map((row) => {
        if (
            row.status === 'MET' &&
            requiresExecutableEvidence(row.id) &&
            row.evidenceType !== 'test' &&
            row.evidenceType !== 'command'
        ) {
            return { ...row, status: 'PARTIAL' };
        }
        return row;
    });
}

function requiresExecutableEvidence(id: string): boolean {
    const normalized = id.toLowerCase();
    const nonCore = normalized.includes('[advisory]') || normalized.includes('[non-core]');
    const nonBehavior =
        normalized.includes('[non-behavior]') ||
        normalized.includes('[docs-only]') ||
        normalized.includes('[doc-only]');
    return !nonCore && !nonBehavior;
}

/** Extract checks from the answer text. Always includes a task-check entry. */
function extractChecks(
    _text: string,
    taskCheckPassed: boolean,
    acceptanceCriteria: VerdictAcceptanceCriteria[],
): VerdictCheck[] {
    const checks: VerdictCheck[] = [
        {
            name: 'spur task check',
            status: taskCheckPassed ? 'pass' : 'fail',
            evidence: taskCheckPassed ? 'task check passed' : 'task check failed',
        },
    ];

    // Look for a checks table or named check lines
    const lines = _text.split('\n');
    let inChecks = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('|')) continue;
        const cells = trimmed
            .split('|')
            .map((c) => c.trim())
            .filter(Boolean);
        if (cells.length >= 2) {
            const h0 = (cells[0] ?? '').toLowerCase();
            const h1 = (cells[1] ?? '').toLowerCase();
            if ((h0 === 'check' || h0 === 'name') && h1 === 'status') {
                inChecks = true;
                continue;
            }
            if (inChecks && cells.length >= 3 && !/^[-:]+$/.test(cells[0] ?? '')) {
                checks.push({
                    name: cells[0] ?? '',
                    status: (cells[1] ?? '').toLowerCase(),
                    evidence: cells[2] ?? '',
                });
            }
        }
    }

    if (acceptanceCriteria.length > 0) {
        const downgraded = acceptanceCriteria.filter(
            (row) =>
                row.status === 'PARTIAL' &&
                requiresExecutableEvidence(row.id) &&
                row.evidenceType !== 'test' &&
                row.evidenceType !== 'command',
        );
        checks.push({
            name: downgraded.length > 0 ? 'evidence-rule-failed' : 'evidence-rule-pass',
            status: downgraded.length > 0 ? 'fail' : 'pass',
            evidence:
                downgraded.length > 0
                    ? `Executable evidence missing for: ${downgraded.map((row) => row.id).join(', ')}`
                    : 'All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral.',
        });
    }

    return checks;
}

// ─── Batch aggregation (verifyall) ──────────────────────────────────────
//
// Batch verdict rollup for `/sp:dev-verifyall`. Extracted from agent-discretion
// prose (dev-operations.md §3a) into deterministic, tested code (task 0341).
// The single-task verdict union (PASS/PARTIAL/FAIL/UNKNOWN) is unchanged;
// NOT-STARTED is a verifyall-layer classification over task status.

/** Per-task outcome in a verifyall batch. NOT-STARTED is distinct from FAIL. */
export type BatchTaskOutcome = 'PASS' | 'PARTIAL' | 'FAIL' | 'NOT-STARTED' | 'UNKNOWN';

/** A single task's outcome within a verifyall batch. */
export interface BatchTaskResult {
    wbs: string;
    outcome: BatchTaskOutcome;
    /** Short reason string for the summary table (e.g. "task at status todo, no implementation to trace"). */
    reason?: string;
}

/** Aggregated batch verdict for verifyall. */
export interface BatchAggregation {
    /** Headline verdict over rolledUp only. UNKNOWN when nothing has been implemented yet. */
    verdict: 'PASS' | 'PARTIAL' | 'FAIL' | 'UNKNOWN';
    /** Tasks that contributed to the verdict (excludes NOT-STARTED). */
    rolledUp: BatchTaskResult[];
    /** Tasks classified NOT-STARTED — excluded from rollup, reported separately so the operator sees them. */
    notStarted: BatchTaskResult[];
    /** One-line summary, e.g. "3 PASS, 0 PARTIAL, 1 FAIL, 2 NOT-STARTED (excluded)". */
    summary: string;
}

/** Statuses that mean "not started yet" — implementation work has not begun (task 0341). */
const NOT_STARTED_STATUSES: Record<TaskStatus, boolean> = {
    backlog: true,
    todo: true,
    wip: false,
    testing: false,
    blocked: true, // blocked has no verifiable work yet — distinct from FAIL
    done: false,
    cancelled: false,
};

/**
 * Classify a single task's batch outcome from its lifecycle status and verify verdict.
 *
 * A task at `backlog` or `todo` reached via `--force` is NOT-STARTED — the verify
 * step had nothing implemented to trace, so FAIL would be misleading. Tasks at any
 * post-start status (`wip`/`testing`/`done`) use their own verify verdict.
 *
 * `blocked` is treated as NOT-STARTED: a blocked task has not produced verifiable
 * work, and reporting it as FAIL would conflate two distinct conditions.
 */
export function classifyTaskOutcome(
    taskStatus: TaskStatus | string,
    verdict: VerifyVerdict['verdict'] | string | undefined,
): BatchTaskOutcome {
    const status = String(taskStatus).toLowerCase() as TaskStatus;
    if (NOT_STARTED_STATUSES[status]) {
        return 'NOT-STARTED';
    }
    const v = String(verdict ?? 'UNKNOWN').toUpperCase();
    if (v === 'PASS' || v === 'PARTIAL' || v === 'FAIL') return v;
    return 'UNKNOWN';
}

/**
 * Aggregate per-task outcomes into a deterministic batch verdict.
 *
 * Rollup rule (mirrors single-task semantics, applied over rolledUp only):
 *   rolledUp empty (all NOT-STARTED)  → UNKNOWN  ("nothing implemented yet")
 *   any FAIL in rolledUp             → FAIL
 *   any PARTIAL in rolledUp (no FAIL) → PARTIAL
 *   all PASS                         → PASS
 *   otherwise (UNKNOWN present)       → PARTIAL  (cannot certify)
 *
 * NOT-STARTED tasks are excluded from the rollup but surfaced in `notStarted`
 * so the operator sees them in the summary. They never cause a FAIL.
 */
export function aggregateBatchVerdicts(results: BatchTaskResult[]): BatchAggregation {
    const notStarted = results.filter((r) => r.outcome === 'NOT-STARTED');
    const rolledUp = results.filter((r) => r.outcome !== 'NOT-STARTED');

    const counts = {
        PASS: rolledUp.filter((r) => r.outcome === 'PASS').length,
        PARTIAL: rolledUp.filter((r) => r.outcome === 'PARTIAL').length,
        FAIL: rolledUp.filter((r) => r.outcome === 'FAIL').length,
        UNKNOWN: rolledUp.filter((r) => r.outcome === 'UNKNOWN').length,
    };

    let verdict: BatchAggregation['verdict'];
    if (rolledUp.length === 0) {
        verdict = 'UNKNOWN';
    } else if (counts.FAIL > 0) {
        verdict = 'FAIL';
    } else if (counts.PARTIAL > 0 || counts.UNKNOWN > 0) {
        // UNKNOWN per-task rows cannot be certified — treat as PARTIAL at the batch level.
        verdict = 'PARTIAL';
    } else {
        verdict = 'PASS';
    }

    const summary = `${counts.PASS} PASS, ${counts.PARTIAL} PARTIAL, ${counts.FAIL} FAIL, ${notStarted.length} NOT-STARTED (excluded)`;

    return { verdict, rolledUp, notStarted, summary };
}
