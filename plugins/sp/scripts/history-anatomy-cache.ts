#!/usr/bin/env bun
/**
 * history-anatomy-cache — CLI glue (task 1005 R4, ADR-130 lib rule) for the history-anatomy
 * report cache (feature I8, HA-S1 0659 / ADR-079): eight verbs, byte-identical argv/stdout/exit.
 * Logic lives in packages/app/src/services/history-anatomy.ts, reached through the generated
 * standalone bundle `plugins/sp/lib/history-anatomy.generated.mjs`; twin runs under bare `node`
 * (`bun run build:scripts`).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as core from '../lib/history-anatomy.generated.mjs';

export * from '../lib/history-anatomy.generated.mjs';

const VALID_COMMANDS = 'digest, check, paths, assert-clean, probe, stamp, refresh, publish';
const PROBE_USAGE =
    '<script> probe --artifact <a.json> --target <report.md> [--baseline <b.json>] [--mode daily|ad-hoc] ' +
    '[--date <YYYY-MM-DD>] [--recompute true] [--out <prov.json>] [--skill-dir <d>] [--contract <f>] [--workflow <f>] [--helper <f>]';

/** `--key value` / `--flag` → record. Bare flags become `"true"` so `--recompute` needs no value. */
function parseFlags(args: string[]): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {};
    for (let i = 0; i < args.length; i++) {
        const a = args[i] ?? '';
        if (!a.startsWith('--')) continue;
        const key = a.slice(2);
        const next = args[i + 1];
        if (next === undefined || next.startsWith('--')) {
            out[key] = 'true';
        } else {
            out[key] = next;
            i++;
        }
    }
    return out;
}

/**
 * Run the CLI with captured stdout/stderr (data, not process side-effects) so unit tests invoke
 * it in-process without leaking into the test runner's own output.
 */
export function runCacheCli(argv: string[]): core.CacheCliResult {
    const [cmd, a, b] = argv;
    switch (cmd) {
        case 'digest': {
            if (a === undefined) {
                return { exitCode: 1, stdout: '', stderr: 'usage: <script> digest <artifact.json>\n' };
            }
            let artifact: unknown;
            try {
                artifact = JSON.parse(readFileSync(a, 'utf8'));
            } catch {
                return { exitCode: 1, stdout: '', stderr: `could not parse artifact at ${a}\n` };
            }
            const digest = core.semanticArtifactDigest(artifact);
            return { exitCode: 0, stdout: `${digest}\n`, stderr: '' };
        }
        case 'check': {
            if (a === undefined) {
                return { exitCode: 1, stdout: '', stderr: 'usage: <script> check <report.md>\n' };
            }
            const result = core.checkReportStructure(readFileSync(a, 'utf8'));
            const stdout = `${result.ok ? 'PASS' : 'FAIL'}\n${result.problems.map((p) => `- ${p}\n`).join('')}`;
            return { exitCode: result.ok ? 0 : 1, stdout, stderr: '' };
        }
        case 'publish': {
            if (a === undefined || b === undefined) {
                return { exitCode: 1, stdout: '', stderr: 'usage: <script> publish <candidate.md> <target.md>\n' };
            }
            core.publishAtomically(a, b);
            return { exitCode: 0, stdout: '', stderr: '' };
        }
        case 'assert-clean': {
            // 0676 R3: fingerprint diff around a model stage. `--baseline` holds the
            // pre-stage `git status --porcelain`; every path present now but absent there
            // must be one of the stage's declared outputs, else exit 1 naming each.
            const f = parseFlags(argv.slice(1));
            if (f.baseline === undefined) {
                return {
                    exitCode: 1,
                    stdout: '',
                    stderr: 'usage: <script> assert-clean --baseline <porcelain.txt> [--expect <path>]...\n',
                };
            }
            const expects = new Set<string>();
            for (const arg of argv.slice(1)) {
                if (arg.startsWith('--expect=')) expects.add(arg.slice('--expect='.length));
            }
            let now: string;
            try {
                now =
                    spawnSync('git', ['status', '--porcelain'], {
                        encoding: 'utf8',
                        ...(f.cwd !== undefined ? { cwd: f.cwd } : {}),
                    }).stdout ?? '';
            } catch {
                return { exitCode: 0, stdout: '', stderr: 'assert-clean: git unavailable; skipped\n' };
            }
            const undeclared = core.diffPorcelain(readFileSync(f.baseline, 'utf8'), now, expects);
            if (undeclared.length > 0) {
                return {
                    exitCode: 1,
                    stdout: '',
                    stderr: undeclared.map((p) => `undeclared write: ${p}\n`).join(''),
                };
            }
            return { exitCode: 0, stdout: 'clean\n', stderr: '' };
        }
        case 'paths': {
            const f = parseFlags(argv.slice(1));
            if (f.helper === undefined || f.out === undefined) {
                return {
                    exitCode: 1,
                    stdout: '',
                    stderr: 'usage: <script> paths --helper <p> --out <env> [--report-dir <d>] [--date <d>] [--output <p>] [--mode <m>] [--since <s>] [--until <u>] [--focus <text>] [--recompute true|false] [--run-id <id>]\n',
                };
            }
            const v = core.validateSelector({
                mode: f.mode,
                date: f.date,
                since: f.since,
                until: f.until,
                focus: f.focus,
                recompute: f.recompute,
                output: f.output,
            });
            if (!v.ok) return { exitCode: 1, stdout: '', stderr: `${v.errors.join('\n')}\n` };
            const env = core.resolvePaths({
                helper: f.helper,
                reportDir: f['report-dir'] ?? 'docs/report',
                date: f.date,
                output: f.output,
                mode: v.mode,
                since: f.since,
                until: f.until,
            });
            writeFileSync(f.out, env);
            // 0920: run-scoped selector observation artifact — written only after successful
            // validation; historical selector files have incompatible shapes and are not consumed.
            if (f['run-id'] !== undefined && f['run-id'] !== '') {
                mkdirSync('.spur/run', { recursive: true });
                const envVars = Object.fromEntries(
                    env
                        .trim()
                        .split('\n')
                        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
                );
                const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
                writeFileSync(
                    `.spur/run/${f['run-id']}-selector.json`,
                    `${JSON.stringify(
                        {
                            mode: v.mode,
                            date: envVars.HA_DATE ?? null,
                            focus: v.focus,
                            since: envVars.HA_SINCE ?? null,
                            until: envVars.HA_UNTIL ?? null,
                            timezone: tz,
                        },
                        null,
                        2,
                    )}\n`,
                );
            }
            return { exitCode: 0, stdout: '', stderr: '' };
        }
        case 'probe': {
            const f = parseFlags(argv.slice(1));
            if (f.artifact === undefined || f.target === undefined) {
                return { exitCode: 1, stdout: '', stderr: `usage: ${PROBE_USAGE}\n` };
            }
            let result: ReturnType<typeof core.probe>;
            try {
                result = core.probe({
                    artifact: f.artifact,
                    target: f.target,
                    baseline: f.baseline,
                    mode: f.mode === 'ad-hoc' ? 'ad-hoc' : 'daily',
                    date: f.date,
                    recompute: f.recompute === 'true',
                    executor: f.executor,
                    model: f.model,
                    skillDir: f['skill-dir'],
                    contractFile: f.contract,
                    workflowFile: f.workflow,
                    helperFile: f.helper,
                    contractVersion: f['contract-version'],
                    runId: f['run-id'],
                    spurVersion: f['spur-version'],
                });
            } catch {
                return { exitCode: 1, stdout: '', stderr: `could not read artifact at ${f.artifact}\n` };
            }
            if (f.out !== undefined) writeFileSync(f.out, `${JSON.stringify(result.current, null, 2)}\n`);
            const reasons = result.decision.reasons.map((r) => `- ${r}\n`).join('');
            return { exitCode: 0, stdout: `${result.decision.disposition}\n${reasons}`, stderr: '' };
        }
        case 'stamp': {
            const f = parseFlags(argv.slice(1));
            if (f.candidate === undefined || f.provenance === undefined || f.out === undefined) {
                return {
                    exitCode: 1,
                    stdout: '',
                    stderr: 'usage: <script> stamp --candidate <c.md> --provenance <p.json> --out <o.md>\n',
                };
            }
            try {
                const p = JSON.parse(readFileSync(f.provenance, 'utf8')) as core.CacheProvenance;
                writeFileSync(f.out, `${core.stampReport(readFileSync(f.candidate, 'utf8'), p)}\n`);
            } catch {
                return { exitCode: 1, stdout: '', stderr: 'stamp: could not read candidate or provenance\n' };
            }
            return { exitCode: 0, stdout: '', stderr: '' };
        }
        case 'refresh': {
            const f = parseFlags(argv.slice(1));
            if (f.report === undefined || f.out === undefined) {
                return {
                    exitCode: 1,
                    stdout: '',
                    stderr: 'usage: <script> refresh --report <published.md> --out <o.md> [--disposition hit]\n',
                };
            }
            try {
                const disposition = (f.disposition ?? 'hit') as core.CacheDisposition;
                const refreshed = core.refreshReport(
                    readFileSync(f.report, 'utf8'),
                    f['validated-at'] ?? new Date().toISOString(),
                    disposition,
                );
                writeFileSync(f.out, refreshed.endsWith('\n') ? refreshed : `${refreshed}\n`);
            } catch {
                return { exitCode: 1, stdout: '', stderr: `refresh: could not read report at ${f.report}\n` };
            }
            return { exitCode: 0, stdout: '', stderr: '' };
        }
        default:
            return { exitCode: 1, stdout: '', stderr: `valid commands: ${VALID_COMMANDS}\n` };
    }
}

if (import.meta.main) {
    const { exitCode, stdout, stderr } = runCacheCli(process.argv.slice(2));
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    process.exitCode = exitCode;
}
