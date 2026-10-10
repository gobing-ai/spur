#!/usr/bin/env bun
/**
 * run-summary — the measured execution summary `/sp:dev-run` and `/sp:dev-runall` print by default
 * (`--no-summary` skips it). Inputs: one or more `spur workflow progress <run-id> --json` files
 * (`--progress [<label>=]<file>`) and the host transcript (resolved like session-timeline, or
 * `--transcript`), OR the close-written per-run summary files (`--rollup [<label>=]<file>`, 1146 R3).
 * Measurement and rendering live in `../lib/run-summary-core` (ADR-130 glue budget); this script is
 * argv parsing and dispatch. Reporting only: no transcript or no timed attempts → an `n/a` result,
 * exit 0. Node builtins only.
 */
import { readFileSync } from 'node:fs';
import { getEnvVars } from '../lib/env';
import {
    buildRunSummary,
    gateFromReceipt,
    type Progress,
    type RollupInput,
    renderRollupMarkdown,
    renderSummaryMarkdown,
} from '../lib/run-summary-core';
import { resolveTranscript } from '../lib/transcript';

// Re-exported so the suite and any consumer keep one import path for the whole surface.
export * from '../lib/run-summary-core';

export const RUN_SUMMARY_USAGE =
    'usage: run-summary (--progress [<label>=]<file> [--progress ...] | --rollup [<label>=]<summary.json> [--rollup ...]) [--transcript <path>] [--since <iso>] [--markdown]';

export function main(
    argv: string[],
    env: Record<string, string | undefined> = getEnvVars(),
    write: (s: string) => void = (s) => process.stdout.write(s),
    projectsRoot?: string,
): number {
    let transcript: string | undefined;
    let since: string | undefined;
    let markdown = false;
    const progressArgs: string[] = [];
    const rollupArgs: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--transcript' && argv[i + 1]) transcript = argv[++i];
        else if (arg === '--progress' && argv[i + 1]) progressArgs.push(argv[++i] as string);
        else if (arg === '--rollup' && argv[i + 1]) rollupArgs.push(argv[++i] as string);
        else if (arg === '--since' && argv[i + 1]) since = argv[++i];
        else if (arg === '--markdown') markdown = true;
        else if (arg === '--spur-bin' && argv[i + 1])
            i++; // 0482 R2: accepted, unused (no spur calls)
        else {
            process.stderr.write(`${RUN_SUMMARY_USAGE}\n`);
            return 2;
        }
    }
    // 1146 AC5: --rollup is a different mode — it reads close-written summary files and never
    // re-measures, so combining it with a measurement source is a usage error.
    if (rollupArgs.length > 0 && (progressArgs.length > 0 || since !== undefined || transcript !== undefined)) {
        process.stderr.write(`${RUN_SUMMARY_USAGE}\n`);
        return 2;
    }
    if (rollupArgs.length > 0) {
        try {
            const inputs: RollupInput[] = rollupArgs.map((arg) => {
                const eq = arg.indexOf('=');
                const [label, file] = eq > 0 ? [arg.slice(0, eq), arg.slice(eq + 1)] : [undefined, arg];
                const summary = JSON.parse(readFileSync(file as string, 'utf8')) as RollupInput['summary'];
                return { label: label ?? summary.runId ?? (file as string), summary };
            });
            write(`${renderRollupMarkdown(inputs)}\n`);
            return 0;
        } catch (error) {
            process.stderr.write(`run-summary: ${(error as Error).message}\n`);
            return 2;
        }
    }
    if (!progressArgs.length) {
        process.stderr.write(`${RUN_SUMMARY_USAGE}\n`);
        return 2;
    }
    const resolved = resolveTranscript(env, projectsRoot, transcript);
    if (!resolved.ok) {
        const out = markdown
            ? `Execution summary: n/a (${resolved.reason})`
            : JSON.stringify({ available: false, reason: resolved.reason });
        write(`${out}\n`);
        return 0;
    }
    try {
        const inputs = progressArgs.map((arg) => {
            const eq = arg.indexOf('=');
            const [label, file] = eq > 0 ? [arg.slice(0, eq), arg.slice(eq + 1)] : [undefined, arg];
            return { label, progress: JSON.parse(readFileSync(file, 'utf8')) as Progress };
        });
        const summary = buildRunSummary(readFileSync(resolved.path, 'utf8').split('\n'), inputs, since);
        summary.gate = gateFromReceipt(process.cwd(), inputs[0]?.progress.runId ?? '');
        write(
            `${markdown ? renderSummaryMarkdown(summary) : JSON.stringify({ ...summary, transcript: resolved.path })}\n`,
        );
        return 0;
    } catch (error) {
        process.stderr.write(`run-summary: ${(error as Error).message}\n`);
        return 2;
    }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
