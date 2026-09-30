#!/usr/bin/env bun
/**
 * workflow-step-profile — per-node step evidence for `sp:spur-doctor` (task 0827, feature I21).
 *
 * IO glue only (task 1005 R4, ADR-130 lib rule): argv parsing, `spur workflow trace --json`
 * spawning and the two output modes. The aggregation core (nearestRankP50, extractExecutions,
 * rowFlags, buildRows, buildStepProfile, nonDryRuns, formatStepProfileHuman and their types) lives
 * in packages/app/src/workflow/step-profile.ts and reaches this script through the generated
 * standalone bundle `plugins/sp/lib/step-profile.generated.mjs` — node-builtin only, so the
 * committed `.mjs` twin runs under bare `node`. Regenerate with `bun run build:scripts`.
 *
 * Exit: 0 whenever a profile is produced (including `sampledRuns: 0` and flagged rows). Flags are
 * evidence, not a gate. 1, with a stderr message, only when a `spur` call fails, its JSON does not
 * parse, or the workflow argument is missing.
 */
import { spawnSync } from 'node:child_process';
import { defaultSpurBin } from '../lib/spur-bin';
import {
    buildStepProfile,
    DEFAULT_LAST,
    DEFAULT_WINDOW_SEC,
    formatStepProfileHuman,
    nonDryRuns,
    type StepProfileRun,
    type TraceActionEvent,
    type TraceRunEntry,
} from '../lib/step-profile.generated.mjs';

export * from '../lib/step-profile.generated.mjs';
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

export function parseStepProfileCliArgs(argv: string[]): StepProfileCliArgs {
    let workflow = '';
    let spurBin = defaultSpurBin();
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

function runSpurJson(spurBin: string, args: string[]): SpawnResult {
    const binParts = spurBin.split(/\s+/).filter(Boolean);
    const cmd = binParts[0] ?? 'spur';
    const cmdArgs = [...binParts.slice(1), ...args];
    const r = spawnSync(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    const decode = (b: unknown): string =>
        typeof b === 'string' ? b : Buffer.from((b as Uint8Array) ?? []).toString('utf8');
    return {
        stdout: typeof r.stdout === 'string' ? r.stdout : decode(r.stdout),
        stderr: typeof r.stderr === 'string' ? r.stderr : decode(r.stderr),
        exitCode: r.status ?? (r.error ? 1 : 0),
        ok: (r.status ?? (r.error ? 1 : 0)) === 0,
    };
}

export interface StepProfileCliResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export const STEP_PROFILE_USAGE = `usage: workflow-step-profile <workflow> [--last <N>] [--window <sec>] [--json] [--spur-bin <cmd>]

Read-only step profile from \`spur workflow trace\`: per node and action kind it reports runs,
executions, p50/max durationMs, p50 idle gap, session mode and cacheHit p50 with coverage, then
flags the satellite §10 cache-window budgets. --last defaults to ${DEFAULT_LAST} runs and --window
(W) to ${DEFAULT_WINDOW_SEC} seconds. Unknown evidence is reported as \`?\` / null, never 0.

Exit: 0 = profile produced (flags included); 1 = a spur call failed, its JSON did not parse, or the
workflow argument is missing.`;

function failure(message: string): StepProfileCliResult {
    return { exitCode: 1, stdout: '', stderr: `workflow-step-profile: ${message}\n` };
}

function runFailure(spurBin: string, result: SpawnResult, what: string): StepProfileCliResult {
    const detail = result.stderr.trim().split('\n').slice(-1)[0] ?? '';
    return failure(`${what} failed (exit ${result.exitCode}${detail === '' ? '' : `: ${detail}`}) [${spurBin}]`);
}

export function runStepProfileCli(argv: string[]): StepProfileCliResult {
    const args = parseStepProfileCliArgs(argv);
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
    const list = runSpurJson(args.spurBin, listArgs);
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
        const timeline = runSpurJson(args.spurBin, runArgs);
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

export function main(argv: string[]): number {
    const { exitCode, stdout, stderr } = runStepProfileCli(argv);
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr.endsWith('\n') ? stderr : `${stderr}\n`);
    return exitCode;
}

if (import.meta.main) {
    process.exit(main(process.argv.slice(2)));
}
