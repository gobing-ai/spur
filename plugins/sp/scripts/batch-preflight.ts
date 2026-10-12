/**
 * batch-preflight — planner adapter over the pure admission policy (task 0279; task 1176 move).
 *
 * The decisions — TABLE A STOP evaluation, quick command-aware readiness and feature-finding
 * classification — are application policy in `packages/app/src/services/planning-admission.ts`,
 * reached through the generated pure bundle. This entry keeps what belongs to the planner: the CLI
 * surface, its argv/usage/error contracts, and the one-shot recovery hints the batch driver prints.
 *
 * Recovery hints (one-shot after FAIL) map stuck statuses to a single /sp:dev-* hop per TABLE A; the
 * batch driver prints or dispatches at most once per WBS.
 */

import {
    classifyFeaturePreflightFindings,
    type FeaturePreflightClassification,
    type FeaturePreflightFinding,
    NON_ABORTING_PREFLIGHT_CODES,
    type PreflightInput,
    type PreflightResult,
    preflightTask,
    type QuickReadinessInput,
    type QuickReadinessResult,
    quickReadiness,
    type ReadinessOperation,
    type TaskStatus,
} from '../lib/plan-projection.generated.mjs';

export type {
    FeaturePreflightClassification,
    FeaturePreflightFinding,
    PreflightInput,
    PreflightResult,
    QuickReadinessInput,
    QuickReadinessResult,
    ReadinessOperation,
    TaskStatus,
};
// R1: existing plugin callers keep their import path — the moved names are re-exported, not relocated
// out from under them.
export { classifyFeaturePreflightFindings, NON_ABORTING_PREFLIGHT_CODES, preflightTask, quickReadiness };

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

// ── CLI for agents / dogfood (optional) ──────────────────────────────────────

export interface PreflightCliArgs {
    status: string | null;
    deps: string[];
    depStatuses: Record<string, string>;
    wbs: string;
    recovery: boolean;
    help: boolean;
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
    /** Feature findings to classify (1132 R4). */
    classifyFeature: string | null;
}

export function parsePreflightCliArgs(argv: string[]): PreflightCliArgs {
    let status: string | null = null;
    let deps: string[] = [];
    const depStatuses: Record<string, string> = {};
    let wbs = '0000';
    let recovery = false;
    let help = false;
    let json = false;
    let operation: ReadinessOperation | null = null;
    let force = false;
    let filteredCount: number | null = null;
    let requiredSections: string[] = [];
    let presentSections: string[] = [];
    let classifyFeature: string | null = null;

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--help' || a === '-h') help = true;
        else if (a === '--json') json = true;
        else if (a === '--recovery') recovery = true;
        else if (a === '--force') force = true;
        else if (a === '--operation') {
            const v = argv[++i] ?? '';
            operation = v === 'run' || v === 'refine' || v === 'verify' ? v : null;
        } else if (a === '--filtered-count') {
            const v = Number(argv[++i]);
            filteredCount = Number.isFinite(v) ? v : null;
        } else if (a === '--required-sections') {
            const raw = argv[++i] ?? '';
            requiredSections =
                raw.length === 0
                    ? []
                    : raw
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean);
        } else if (a === '--present-sections') {
            const raw = argv[++i] ?? '';
            presentSections =
                raw.length === 0
                    ? []
                    : raw
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean);
        } else if (a === '--wbs') wbs = argv[++i] ?? wbs;
        else if (a === '--classify-feature') {
            classifyFeature = argv[++i] ?? '[]';
        } else if (a === '--status') status = argv[++i] ?? null;
        else if (a === '--deps') {
            const raw = argv[++i] ?? '';
            deps =
                raw.length === 0
                    ? []
                    : raw
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean);
        } else if (a === '--dep-status') {
            // format: 0275:done,0276:todo
            const raw = argv[++i] ?? '';
            for (const part of raw.split(',')) {
                const [k, v] = part.split(':');
                if (k && v) depStatuses[k.trim()] = v.trim();
            }
        }
    }
    return {
        status,
        deps,
        depStatuses,
        wbs,
        recovery,
        help,
        json,
        operation,
        force,
        filteredCount,
        requiredSections,
        presentSections,
        classifyFeature,
    };
}

export const PREFLIGHT_CLI_USAGE = `Usage:
  bun plugins/sp/scripts/batch-preflight.ts --wbs <wbs> --status <status> \\
    [--deps 0275,0276] [--dep-status 0275:done,0276:todo] [--recovery] [--json]
  bun plugins/sp/scripts/batch-preflight.ts --operation <run|refine|verify> --wbs <wbs> --status <status> \
    [--filtered-count <n>] [--required-sections A,B] [--present-sections A,B] [--force] [--json]

Exit: 0 = run (or recovery hint printed); 2 = skip; 1 = usage.`;

export function runPreflightCli(argv: string[]): { exitCode: number; stdout: string; stderr: string } {
    const args = parsePreflightCliArgs(argv);
    if (args.help) return { exitCode: 0, stdout: '', stderr: PREFLIGHT_CLI_USAGE };

    // Feature findings classification (1132 R4)
    if (args.classifyFeature !== null) {
        try {
            const findings = JSON.parse(args.classifyFeature);
            const res = classifyFeaturePreflightFindings(Array.isArray(findings) ? findings : []);
            return {
                exitCode: res.shouldAbort ? 1 : 0,
                stdout: `${JSON.stringify(res, null, 2)}\n`,
                stderr: '',
            };
        } catch (e) {
            return {
                exitCode: 1,
                stdout: '',
                stderr: `Invalid JSON for --classify-feature: ${String(e)}`,
            };
        }
    }

    if (!args.status) return { exitCode: 1, stdout: '', stderr: PREFLIGHT_CLI_USAGE };

    if (args.recovery) {
        const hint = recoveryHint(args.status, args.wbs);
        const body = args.json
            ? `${JSON.stringify({ recovery: hint }, null, 2)}\n`
            : hint
              ? `${hint.command}\n`
              : 'no recovery hop\n';
        return { exitCode: 0, stdout: body, stderr: '' };
    }

    // Quick command-aware readiness (0814 R2) — read-only admission decision.
    if (args.operation !== null) {
        const result = quickReadiness({
            wbs: args.wbs,
            status: args.status,
            operation: args.operation,
            dependencies: args.deps,
            depStatuses: args.depStatuses,
            ...(args.filteredCount !== null ? { filteredCount: args.filteredCount } : {}),
            ...(args.requiredSections.length > 0 ? { requiredSections: args.requiredSections } : {}),
            ...(args.presentSections.length > 0 ? { presentSections: args.presentSections } : {}),
            ...(args.force ? { force: true } : {}),
        });
        const runnable = result.action === 'runnable' || result.action === 'needs-refinement';
        if (args.json) {
            return { exitCode: runnable ? 0 : 2, stdout: `${JSON.stringify(result, null, 2)}\n`, stderr: '' };
        }
        return {
            exitCode: runnable ? 0 : 2,
            stdout: `${result.action}${result.code ? ` ${result.code}` : ''}: ${result.reason}\n`,
            stderr: '',
        };
    }

    const result = preflightTask({
        wbs: args.wbs,
        status: args.status,
        dependencies: args.deps,
        depStatuses: args.depStatuses,
    });
    if (args.json) {
        return {
            exitCode: result.action === 'run' ? 0 : 2,
            stdout: `${JSON.stringify(result, null, 2)}\n`,
            stderr: '',
        };
    }
    if (result.action === 'run') {
        return { exitCode: 0, stdout: `run: ${result.reason ?? 'ok'}\n`, stderr: '' };
    }
    return {
        exitCode: 2,
        stdout: `skip ${result.code}: ${result.reason}\n`,
        stderr: '',
    };
}

if (import.meta.main) {
    const { exitCode, stdout, stderr } = runPreflightCli(process.argv.slice(2));
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(`${stderr}\n`);
    process.exit(exitCode);
}
