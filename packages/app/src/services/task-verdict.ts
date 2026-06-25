/**
 * Task verdict — deterministic verdict derivation from verify step output.
 *
 * Pure functions: same input → same output. Extracted from the pipeline YAML's
 * grep/shell block (task 0111; same pattern as task 0108's spur task record).
 */

import type { VerdictCheck, VerdictRequirement } from './task-record';

// ─── Types ──────────────────────────────────────────────────────────────

/** Raw answer text from the verify step's agent.run output. */
export type AnswerText = string;

/** Outcome of verdict derivation. */
export interface VerdictResult {
    verdict: 'PASS' | 'PARTIAL' | 'FAIL' | 'UNKNOWN';
    requirements: VerdictRequirement[];
    checks: VerdictCheck[];
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
    const checks = extractChecks(answerText, taskCheckPassed);

    // If we couldn't parse any requirements, the answer is unparseable.
    if (requirements.length === 0) {
        return { verdict: 'UNKNOWN', requirements, checks };
    }

    const hasUnmet = requirements.some((r) => r.status === 'UNMET');
    if (hasUnmet) {
        return { verdict: 'FAIL', requirements, checks };
    }

    const hasPartial = requirements.some((r) => r.status === 'PARTIAL');
    if (hasPartial) {
        return { verdict: 'PARTIAL', requirements, checks };
    }

    // All MET: gate on task check.
    if (!taskCheckPassed) {
        return { verdict: 'PARTIAL', requirements, checks };
    }

    return { verdict: 'PASS', requirements, checks };
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

/** Extract checks from the answer text. Always includes a task-check entry. */
function extractChecks(_text: string, taskCheckPassed: boolean): VerdictCheck[] {
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

    return checks;
}
