/**
 * batch-preflight — pure TABLE A STOP evaluation for sp:super-planner (task 0279).
 *
 * Mirrors routing-table.md TABLE A hard-STOP preconditions so the batch driver can
 * skip doomed pipeline launches without spawning a Skill subprocess. Happy-path
 * statuses still return `action: 'run'` — the caller launches task-pipeline.yaml
 * verbatim (preflight is readiness only, never a pipeline substitute).
 *
 * Recovery hints (one-shot after FAIL) map stuck statuses to a single /sp:dev-* hop
 * per TABLE A; the batch driver prints or dispatches at most once per WBS.
 */

export type TaskStatus = 'backlog' | 'todo' | 'wip' | 'testing' | 'blocked' | 'done' | 'cancelled' | string;

export interface PreflightInput {
    wbs: string;
    status: TaskStatus;
    /** Frontmatter dependencies[] WBS list. */
    dependencies: string[];
    /** Status of each dependency WBS (from spur task show). Missing → treated as unmet. */
    depStatuses: Record<string, string>;
}

export type PreflightResult =
    | { action: 'run'; code?: string; reason?: string }
    | { action: 'skip'; code: string; reason: string; unmetDeps?: string[] };

// ── Command-aware quick readiness (task 0814 R2) ──────────────────────────────
// Read-only admission decision for the requested dev operation. Distinguishes
// runnable / needs-refinement / blocked / skipped / invalid outcomes without
// LLM dispatch, full tests/lint, live-data probes, feature mutation, or
// corpus-wide relational checking. Refinement gaps are work to do, not errors.

export type ReadinessOperation = 'run' | 'refine' | 'verify';

export interface QuickReadinessInput {
    wbs: string;
    status: TaskStatus;
    operation: ReadinessOperation;
    /** Frontmatter dependencies[] WBS list (run only). */
    dependencies?: string[];
    /** Status of each dependency WBS; missing → treated as unmet (run only). */
    depStatuses?: Record<string, string>;
    /** Size of the status-filtered candidate set after the selector resolved; 0 = empty set. */
    filteredCount?: number;
    /** Required planning sections for this variant+status; empty = not applicable. */
    requiredSections?: string[];
    /** Sections that are actually present (non-placeholder) in the task. */
    presentSections?: string[];
    /** L1/L2/L3 content-policy findings keyed by section; empty = clean. */
    sectionFindings?: Record<string, string>;
    /** Verify only: re-verification semantics (--force) — never a dirty-tree bypass. */
    force?: boolean;
}

export type QuickReadinessResult =
    | { action: 'runnable'; code: string; reason: string }
    | { action: 'needs-refinement'; code: string; reason: string; gaps: string[] }
    | { action: 'blocked'; code: string; reason: string; unmetDeps?: string[] }
    | { action: 'skipped'; code: string; reason: string }
    | { action: 'invalid'; code: string; reason: string };

/**
 * Evaluate quick readiness for a requested dev operation (0814 R2). Read-only:
 * no model, no full tests/lint, no live-data probe, no feature mutation, no
 * corpus-wide relational check. An empty status-filtered set is `skipped`
 * (mirrors the zero-task rule), never an error. Refinement gaps under `refine`
 * are work to do, so they do not block; under `run` they are `needs-refinement`.
 */
export function quickReadiness(input: QuickReadinessInput): QuickReadinessResult {
    const status = (input.status ?? '').toLowerCase();
    const operation = input.operation;

    if (operation !== 'run' && operation !== 'refine' && operation !== 'verify') {
        return {
            action: 'invalid',
            code: 'IV',
            reason: `quick-readiness: unknown operation '${operation}' (${input.wbs})`,
        };
    }

    if (input.filteredCount !== undefined) {
        if (input.filteredCount < 0) {
            return {
                action: 'invalid',
                code: 'IV',
                reason: `quick-readiness: invalid negative filtered count '${input.filteredCount}' (${input.wbs})`,
            };
        }
        if (input.filteredCount === 0) {
            return {
                action: 'skipped',
                code: 'EMPTY',
                reason: `quick-readiness: empty status-filtered set — nothing to ${operation} (${input.wbs})`,
            };
        }
    }

    if (status === 'cancelled' || status === 'done') {
        // verify --force re-verification (R2 AC): an already-verified terminal task
        // is re-checked, not skipped — but force never bypasses a dirty tree or the
        // owning gates; it only re-admits a terminal task for re-verification.
        if (operation === 'verify' && input.force === true) {
            return {
                action: 'runnable',
                code: 'FORCE',
                reason: `quick-readiness: verify --force re-verification of ${status} task ${input.wbs}`,
            };
        }
        return {
            action: 'skipped',
            code: status === 'done' ? 'DONE' : 'CANCELLED',
            reason: `quick-readiness: already ${status} — no ${operation} hop (${input.wbs})`,
        };
    }

    if (status === 'blocked') {
        return {
            action: 'blocked',
            code: 'BLK',
            reason: `quick-readiness: blocked — human/handover first (${input.wbs})`,
        };
    }

    // Unmet out-of-set dependency is a block for the operation that needs it.
    if (operation === 'run' && input.dependencies && input.dependencies.length > 0) {
        const unmet = input.dependencies.filter((d) => (input.depStatuses?.[d] ?? 'missing').toLowerCase() !== 'done');
        if (unmet.length > 0) {
            return {
                action: 'blocked',
                code: 'DEP',
                reason: `quick-readiness: unmet deps — ${unmet.join(', ')} (${input.wbs})`,
                unmetDeps: unmet,
            };
        }
    }

    const required = input.requiredSections ?? [];
    const present = input.presentSections ?? [];
    // A required section is a gap when it is absent from the present-set OR carries a
    // content-policy finding (the caller-supplied `sectionFindings` from the matrix /
    // `TaskCheckService.checkContentPolicy`). This lets the function detect a gap itself
    // rather than depending on the caller to pre-enumerate every missing section.
    const gaps = required.filter((s) => {
        const finding = input.sectionFindings?.[s];
        return !present.includes(s) || (finding !== undefined && finding !== '');
    });

    // refine: missing/incomplete planning sections are the work, not a failure.
    if (operation === 'refine') {
        if (status !== 'backlog' && status !== 'todo') {
            return {
                action: 'skipped',
                code: 'NONPLAN',
                reason: `quick-readiness: refine targets backlog/todo only, not '${status}' (${input.wbs})`,
            };
        }
        return {
            action: 'runnable',
            code: 'OK',
            reason: `quick-readiness: refine ready for ${input.wbs} (${gaps.length} planning gap(s) to fill)`,
        };
    }

    if (operation === 'verify') {
        if (status !== 'testing' && status !== 'wip') {
            return {
                action: 'invalid',
                code: 'NOVERIFY',
                reason: `quick-readiness: verify needs testing/wip, not '${status}' (${input.wbs})`,
            };
        }
        return {
            action: 'runnable',
            code: 'OK',
            reason: `quick-readiness: verify ready for ${input.wbs}`,
        };
    }

    // run: implementation admission. Eligible statuses are todo/wip/testing;
    // a backlog task needs the chain's auto-promotion first (step 0).
    if (status !== 'todo' && status !== 'wip' && status !== 'testing') {
        return {
            action: 'invalid',
            code: 'NORUN',
            reason: `quick-readiness: run needs todo/wip/testing, not '${status}' (${input.wbs})`,
        };
    }
    if (gaps.length > 0) {
        return {
            action: 'needs-refinement',
            code: 'REFINE',
            reason: `quick-readiness: implementation sections incomplete (${input.wbs})`,
            gaps,
        };
    }
    return {
        action: 'runnable',
        code: 'OK',
        reason: `quick-readiness: run ready for ${input.wbs}`,
    };
}

/**
 * Evaluate whether the batch should launch task-pipeline.yaml for this WBS.
 * STOP codes align with routing-table TABLE A row ids (A2, A7, A8, A9).
 */
export function preflightTask(input: PreflightInput): PreflightResult {
    const status = (input.status ?? '').toLowerCase();
    const deps = input.dependencies ?? [];
    const depStatuses = input.depStatuses ?? {};

    if (status === 'cancelled') {
        return {
            action: 'skip',
            code: 'A9',
            reason: `dev-next: cancelled — nothing to advance (${input.wbs})`,
        };
    }

    if (status === 'done') {
        return {
            action: 'skip',
            code: 'A8',
            reason: `dev-next: already done — batch does not auto-wrap (${input.wbs})`,
        };
    }

    if (status === 'blocked') {
        return {
            action: 'skip',
            code: 'A7',
            reason: `dev-next: blocked — do not launch pipeline; human/handover first (${input.wbs})`,
        };
    }

    // A2: todo/backlog with any dependency not done (mirrors TABLE A2 / ready filter).
    if (status === 'todo' || status === 'backlog') {
        const unmet = deps.filter((d) => {
            const st = (depStatuses[d] ?? 'missing').toLowerCase();
            return st !== 'done';
        });
        if (unmet.length > 0) {
            return {
                action: 'skip',
                code: 'A2',
                reason: `dev-next: blocked by deps — unmet: ${unmet.join(', ')} (${input.wbs})`,
                unmetDeps: unmet,
            };
        }
    }

    // Ready for pipeline: backlog/todo (deps ok), wip, testing.
    return { action: 'run', code: 'OK', reason: `preflight clear — launch task-pipeline for ${input.wbs}` };
}

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
        else if (a === '--status') status = argv[++i] ?? null;
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
