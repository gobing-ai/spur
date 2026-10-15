/**
 * `spur task preflight` — planner surface over the pure admission policy (task 0279; task 1176 move).
 *
 * Absorbed from the retired sp plugin script `plugins/sp/scripts/batch-preflight.ts` (script-absorption
 * plan PR-5). The decisions — TABLE A STOP evaluation, quick command-aware readiness and feature-finding
 * classification — stay in `./planning-admission.ts`; this module owns the planner-side pieces the
 * script carried: the one-shot recovery hints the batch driver prints and the render/exit-code
 * contract (0 = run / recovery hint printed / classification non-aborting, 2 = skip, 1 = usage or an
 * aborting classification). Behavior is pinned by `apps/cli/tests/script-absorption-pr5-parity.test.ts`.
 *
 * Recovery hints (one-shot after FAIL) map stuck statuses to a single /sp:dev-* hop per TABLE A; the
 * batch driver prints or dispatches at most once per WBS.
 */

import {
    classifyFeaturePreflightFindings,
    preflightTask,
    quickReadiness,
    type ReadinessOperation,
    type TaskStatus,
} from './planning-admission';

/**
 * One-shot recovery hint after a non-PASS pipeline or stuck status (TABLE A primary hop).
 * Caller substitutes the real WBS; never loop this — at most one hop per WBS per batch.
 */
export function recoveryHint(status: TaskStatus, wbs: string): { command: string; code: string } | null {
    const st = (status ?? '').toLowerCase();
    switch (st) {
        case 'backlog':
            return { code: 'A1', command: `/sp:dev-refine ${wbs} --auto --next` };
        case 'todo':
            return { code: 'A3', command: `/sp:dev-run ${wbs} --auto --next` };
        case 'wip':
            return { code: 'A5', command: `/sp:dev-run ${wbs} --mode implement --auto --next` };
        case 'testing':
            return { code: 'A6', command: `/sp:dev-verify ${wbs} --auto --next` };
        case 'blocked':
            return {
                code: 'A7',
                command: `/sp:dev-handover "blocked task ${wbs} — see Notes/History"`,
            };
        default:
            return null;
    }
}

/** Parsed `spur task preflight` request (the CLI adapter maps flags and the task corpus onto it). */
export interface PreflightRequest {
    wbs: string;
    /** Task status; null means "unknown", which is a usage error outside `classifyFeature`. */
    status: string | null;
    deps: string[];
    depStatuses: Record<string, string>;
    recovery: boolean;
    json: boolean;
    /** Quick-readiness operation (run|refine|verify); when set, run quickReadiness. */
    operation: ReadinessOperation | null;
    /** Verify-only re-verification (R2 AC). */
    force: boolean;
    /** Status-filtered candidate set size; 0 = empty set. */
    filteredCount: number | null;
    /** Required planning sections (matrix-selected). */
    requiredSections: string[];
    /** Sections actually present in the task. */
    presentSections: string[];
    /** Feature findings JSON to classify (1132 R4). */
    classifyFeature: string | null;
}

/** Outcome of one preflight request: exit code plus the exact stdout/stderr text (newline-terminated). */
export interface PreflightOutcome {
    exitCode: number;
    stdout: string;
    stderr: string;
}

/** Usage line printed when no status is available (exit 1). */
export const PREFLIGHT_USAGE = `Usage:
  spur task preflight <wbs> [--status <status>] [--deps 0275,0276] [--dep-status 0275:done,0276:todo] [--recovery] [--json]
  spur task preflight <wbs> --operation <run|refine|verify> [--status <status>] \\
    [--filtered-count <n>] [--required-sections A,B] [--present-sections A,B] [--force] [--json]
  spur task preflight --classify-feature '<findings json>'

Exit: 0 = run (or recovery hint printed); 2 = skip; 1 = usage.`;

/** Split a comma list into trimmed, non-empty items (`''` → `[]`). */
export function parseCommaList(raw: string | undefined): string[] {
    if (raw === undefined || raw.length === 0) return [];
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

/** Parse `0275:done,0276:todo` into a status map; malformed parts are skipped. */
export function parseDepStatuses(raw: string | undefined): Record<string, string> {
    const depStatuses: Record<string, string> = {};
    for (const part of (raw ?? '').split(',')) {
        const [k, v] = part.split(':');
        if (k && v) depStatuses[k.trim()] = v.trim();
    }
    return depStatuses;
}

/** Evaluate one preflight request exactly as the retired `batch-preflight` script did. */
export function runPreflight(req: PreflightRequest): PreflightOutcome {
    // Feature findings classification (1132 R4)
    if (req.classifyFeature !== null) {
        try {
            const findings = JSON.parse(req.classifyFeature);
            const res = classifyFeaturePreflightFindings(Array.isArray(findings) ? findings : []);
            return {
                exitCode: res.shouldAbort ? 1 : 0,
                stdout: `${JSON.stringify(res, null, 2)}\n`,
                stderr: '',
            };
        } catch (e) {
            return { exitCode: 1, stdout: '', stderr: `Invalid JSON for --classify-feature: ${String(e)}\n` };
        }
    }

    if (!req.status) return { exitCode: 1, stdout: '', stderr: `${PREFLIGHT_USAGE}\n` };

    if (req.recovery) {
        const hint = recoveryHint(req.status, req.wbs);
        const body = req.json
            ? `${JSON.stringify({ recovery: hint }, null, 2)}\n`
            : hint
              ? `${hint.command}\n`
              : 'no recovery hop\n';
        return { exitCode: 0, stdout: body, stderr: '' };
    }

    // Quick command-aware readiness (0814 R2) — read-only admission decision.
    if (req.operation !== null) {
        const result = quickReadiness({
            wbs: req.wbs,
            status: req.status,
            operation: req.operation,
            dependencies: req.deps,
            depStatuses: req.depStatuses,
            ...(req.filteredCount !== null ? { filteredCount: req.filteredCount } : {}),
            ...(req.requiredSections.length > 0 ? { requiredSections: req.requiredSections } : {}),
            ...(req.presentSections.length > 0 ? { presentSections: req.presentSections } : {}),
            ...(req.force ? { force: true } : {}),
        });
        const runnable = result.action === 'runnable' || result.action === 'needs-refinement';
        const stdout = req.json
            ? `${JSON.stringify(result, null, 2)}\n`
            : `${result.action}${result.code ? ` ${result.code}` : ''}: ${result.reason}\n`;
        return { exitCode: runnable ? 0 : 2, stdout, stderr: '' };
    }

    const result = preflightTask({
        wbs: req.wbs,
        status: req.status,
        dependencies: req.deps,
        depStatuses: req.depStatuses,
    });
    if (req.json) {
        return {
            exitCode: result.action === 'run' ? 0 : 2,
            stdout: `${JSON.stringify(result, null, 2)}\n`,
            stderr: '',
        };
    }
    if (result.action === 'run') {
        return { exitCode: 0, stdout: `run: ${result.reason ?? 'ok'}\n`, stderr: '' };
    }
    return { exitCode: 2, stdout: `skip ${result.code}: ${result.reason}\n`, stderr: '' };
}
