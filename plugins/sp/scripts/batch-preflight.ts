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
}

export function parsePreflightCliArgs(argv: string[]): PreflightCliArgs {
    let status: string | null = null;
    let deps: string[] = [];
    const depStatuses: Record<string, string> = {};
    let wbs = '0000';
    let recovery = false;
    let help = false;
    let json = false;

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--help' || a === '-h') help = true;
        else if (a === '--json') json = true;
        else if (a === '--recovery') recovery = true;
        else if (a === '--wbs') wbs = argv[++i] ?? wbs;
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
    return { status, deps, depStatuses, wbs, recovery, help, json };
}

export const PREFLIGHT_CLI_USAGE = `Usage:
  bun plugins/sp/scripts/batch-preflight.ts --wbs <wbs> --status <status> \\
    [--deps 0275,0276] [--dep-status 0275:done,0276:todo] [--recovery] [--json]

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
    const { exitCode, stdout, stderr } = runPreflightCli(Bun.argv.slice(2));
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(`${stderr}\n`);
    process.exit(exitCode);
}
