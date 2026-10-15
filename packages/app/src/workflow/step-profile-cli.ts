/**
 * `spur workflow profile <workflow>` — per-node step evidence for `sp:spur-doctor` (task 0827,
 * feature I21). Argv parsing, `spur workflow trace --json` spawning and the two output modes;
 * the aggregation core is `./step-profile.ts`. Absorbed from the retired
 * `plugins/sp/scripts/workflow-step-profile.ts` (script-absorption PR-6; argv, stdout and exit
 * codes pinned by the PR-6 golden).
 *
 * Exit: 0 whenever a profile is produced (including `sampledRuns: 0` and flagged rows). Flags are
 * evidence, not a gate. 1, with a stderr message, only when a `spur` call fails, its JSON does not
 * parse, or the workflow argument is missing.
 */
import { NodeSyncProcessExecutor } from '@gobing-ai/ts-runtime';
import {
    buildStepProfile,
    DEFAULT_LAST,
    DEFAULT_WINDOW_SEC,
    formatStepProfileHuman,
    nonDryRuns,
    type StepProfileRun,
    type TraceActionEvent,
    type TraceRunEntry,
} from './step-profile';
import { spurCommand } from './wrapup/spur-command';

/** Parsed `spur workflow profile` arguments. */
export interface StepProfileCliArgs {
    workflow: string;
    last: number;
    windowSec: number;
    spurBin: string;
    json: boolean;
    help: boolean;
}

function positiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Parse `spur workflow profile` argv; `defaultSpurBin` is the caller-resolved spur invocation. */
export function parseStepProfileCliArgs(argv: string[], defaultSpurBin = 'spur'): StepProfileCliArgs {
    let workflow = '';
    let spurBin = defaultSpurBin;
    let last = DEFAULT_LAST;
    let windowSec = DEFAULT_WINDOW_SEC;
    let json = false;
    let help = false;

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === undefined) continue;
        if (a === '--help' || a === '-h') help = true;
        else if (a === '--json') json = true;
        else if (a === '--last') last = positiveInt(argv[++i], last);
        else if (a === '--window') windowSec = positiveInt(argv[++i], windowSec);
        else if (a === '--spur-bin') spurBin = argv[++i] ?? spurBin;
        else if (!a.startsWith('--') && workflow === '') workflow = a;
    }
    return { workflow, last, windowSec, spurBin, json, help };
}

type SpawnResult = { stdout: string; stderr: string; exitCode: number; ok: boolean };

function runSpurJson(spurBin: string, args: string[], spurArgv?: readonly string[]): SpawnResult {
    const { cmd, prefix } = spurCommand(spurBin, spurArgv);
    const r = new NodeSyncProcessExecutor().runSync({ command: cmd, args: [...prefix, ...args] });
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode ?? 1, ok: r.exitCode === 0 };
}

/** Captured output and exit code of one `spur workflow profile` run. */
export interface StepProfileCliResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

/** Usage text for `spur workflow profile`. */
export const STEP_PROFILE_USAGE = `usage: spur workflow profile <workflow> [--last <N>] [--window <sec>] [--json] [--spur-bin <cmd>]

Read-only step profile from \`spur workflow trace\`: per node and action kind it reports runs,
executions, p50/max durationMs, p50 idle gap, session mode and cacheHit p50 with coverage, then
flags the satellite §10 cache-window budgets. --last defaults to ${DEFAULT_LAST} runs and --window
(W) to ${DEFAULT_WINDOW_SEC} seconds. Unknown evidence is reported as \`?\` / null, never 0.

Exit: 0 = profile produced (flags included); 1 = a spur call failed, its JSON did not parse, or the
workflow argument is missing.`;

function failure(message: string): StepProfileCliResult {
    return { exitCode: 1, stdout: '', stderr: `spur workflow profile: ${message}\n` };
}

function runFailure(spurBin: string, result: SpawnResult, what: string): StepProfileCliResult {
    const detail = result.stderr.trim().split('\n').slice(-1)[0] ?? '';
    return failure(`${what} failed (exit ${result.exitCode}${detail === '' ? '' : `: ${detail}`}) [${spurBin}]`);
}

/** Run one profile; `defaultSpurBin` is the spur invocation used when `--spur-bin` is absent. */
export function runStepProfileCli(
    argv: string[],
    defaultSpurBin = 'spur',
    defaultSpurArgv?: readonly string[],
): StepProfileCliResult {
    const spurArgv = argv.includes('--spur-bin') ? undefined : defaultSpurArgv;
    const args = parseStepProfileCliArgs(argv, defaultSpurBin);
    if (args.help) return { exitCode: 0, stdout: `${STEP_PROFILE_USAGE}\n`, stderr: '' };
    if (args.workflow === '') return failure(`a workflow name is required\n${STEP_PROFILE_USAGE}`);

    const listArgs = [
        'workflow',
        'trace',
        '--workflow',
        args.workflow,
        '--status',
        'done',
        '--last',
        String(args.last),
        '--json',
    ];
    const list = runSpurJson(args.spurBin, listArgs, spurArgv);
    if (!list.ok) return runFailure(args.spurBin, list, `spur ${listArgs.join(' ')}`);

    let entries: TraceRunEntry[];
    try {
        const parsed = JSON.parse(list.stdout) as { entries?: unknown };
        if (!Array.isArray(parsed.entries)) throw new Error('no "entries" array');
        entries = parsed.entries as TraceRunEntry[];
    } catch (err) {
        return failure(`spur workflow trace output did not parse as JSON: ${String(err)}`);
    }

    const runs: StepProfileRun[] = [];
    for (const entry of nonDryRuns(entries)) {
        const runArgs = ['workflow', 'trace', entry.runId, '--json'];
        const timeline = runSpurJson(args.spurBin, runArgs, spurArgv);
        if (!timeline.ok) return runFailure(args.spurBin, timeline, `spur ${runArgs.join(' ')}`);
        try {
            const parsed = JSON.parse(timeline.stdout) as { events?: unknown };
            if (!Array.isArray(parsed.events)) throw new Error('no "events" array');
            runs.push({ runId: entry.runId, events: parsed.events as TraceActionEvent[] });
        } catch (err) {
            return failure(`spur workflow trace ${entry.runId} output did not parse as JSON: ${String(err)}`);
        }
    }

    const profile = buildStepProfile({ workflow: args.workflow, windowSec: args.windowSec, runs });
    return {
        exitCode: 0,
        stdout: args.json ? `${JSON.stringify(profile, null, 2)}\n` : formatStepProfileHuman(profile),
        stderr: '',
    };
}
