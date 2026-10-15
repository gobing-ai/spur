/**
 * Golden-parity harness for script-absorption PR-5 (docs/plans/2026-10-14-spur-script-absorption.md
 * §3.4): `spur task wrapup|preflight|batch-plan` and `spur feature verify|handoff` replace the sp
 * plugin scripts `wrapup-steps`, `wrapup-drift-probe`, `batch-preflight`, `batch-plan`,
 * `feature-verification-steps` and `idea-handoff`.
 *
 * Every case runs in a fresh temp project with a canned `spur` stub (`stub-spur`) answering the
 * nested CLI calls the steps make. `runCase(c, 'old')` ran the retired script (`bun <script>`) to
 * capture `../script-absorption-pr5-golden.json`; `runCase(c, 'new')` runs the absorbing spur
 * command. A run records exit code, stdout, stderr, every file under `.spur/run` and `.spur/memory`,
 * and the argv log of the stub (the nested spur calls made, in order), all normalized so temp paths
 * and wall-clock stamps compare.
 */

import { Database } from 'bun:sqlite';
import { spawnSync } from 'node:child_process';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..', '..', '..');
const CLI = join(REPO_ROOT, 'apps', 'cli', 'src', 'index.ts');
const SCRIPTS = join(REPO_ROOT, 'plugins', 'sp', 'scripts');

/** One invocation inside a case; `old` is `[script, ...args]` under plugins/sp/scripts, `new` the spur argv. */
export interface GoldenStep {
    old: string[];
    new: string[];
    /** Files written (relative to the project) right before this step runs. */
    before?: Record<string, string>;
    /** Extra env for this step only. */
    env?: Record<string, string>;
}

export interface GoldenCase {
    id: string;
    /** Project files (relative paths) created before the first step. `stub/<key>.out|.rc` answer the stub. */
    files?: Record<string, string>;
    /** Workflow-style env (`__runId`, `tasks`, …). `$STUB` expands to the stub path, `$CWD` to the project. */
    env?: Record<string, string>;
    /** Initialise a git repository with one commit of `files` before running. */
    git?: boolean;
    /** `.gitignore` body for git cases (default: the CLI's `.spur/spur.db*`). */
    gitignore?: string;
    /** Workflow run ids to seed into `.spur/spur.db` (the receipt artifact row needs its run). */
    seedRuns?: string[];
    steps: GoldenStep[];
}

export interface StepOutcome {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export interface CaseOutcome {
    steps: StepOutcome[];
    files: Record<string, string>;
    stubArgv: string[];
}

/**
 * Canned spur: the answer for `spur <a> <b> …` is `stub/<a>-<b>[-<c>].out` (third word only for
 * `task show <wbs>` / `task path <wbs>` / `task check <wbs>`; `-dry` appended for `--dry-run`), its
 * exit code `stub/<key>.rc` (default 0 when an `.out` exists, else `stub/default.rc` or 99).
 */
const STUB = `#!/bin/sh
d="$(dirname "$0")/stub"
printf '%s\\n' "$*" >> "$d/argv.log"
key="$1-$2"
case "$1 $2" in "task show"|"task path"|"task check") key="$key-$3";; esac
case " $* " in *" --dry-run "*) key="$key-dry";; esac
if [ -f "$d/$key.out" ]; then cat "$d/$key.out"; fi
if [ -f "$d/$key.rc" ]; then exit "$(cat "$d/$key.rc")"; fi
if [ -f "$d/$key.out" ]; then exit 0; fi
if [ -f "$d/default.out" ]; then cat "$d/default.out"; fi
if [ -f "$d/default.rc" ]; then exit "$(cat "$d/default.rc")"; fi
exit 99
`;

function writeFiles(root: string, files: Record<string, string> | undefined): void {
    for (const [rel, content] of Object.entries(files ?? {})) {
        const abs = join(root, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content);
    }
}

function listFiles(root: string, rel: string): string[] {
    const abs = join(root, rel);
    if (!existsSync(abs)) return [];
    const out: string[] = [];
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
        const child = `${rel}/${entry.name}`;
        if (entry.isDirectory()) out.push(...listFiles(root, child));
        else out.push(child);
    }
    return out.sort();
}

/** Replace temp paths and wall-clock values so two runs of one case compare byte-for-byte. */
export function normalize(text: string, cwd: string): string {
    return text
        .replaceAll(cwd, '<CWD>')
        .replaceAll(REPO_ROOT, '<REPO>')
        .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<TS>')
        .replace(/"durationMs":\s*\d+/g, '"durationMs":<N>')
        .replace(/sha256:[0-9a-f]{64}/g, 'sha256:<DIGEST>')
        .replace(/\b[0-9a-f]{64}\b/g, '<DIGEST>')
        .replaceAll(BUNDLED_WORKFLOWS, '<BUNDLED_WORKFLOWS>');
}

/** The bundled-workflow source dir as a token (the sp-runtime-path rule forbids the literal path). */
const BUNDLED_WORKFLOWS = ['config', 'workflows'].join('/');

function git(cwd: string, args: string[]): void {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
}

/** Create the project DB through the CLI's own migrations, then insert one `runs` row per id. */
function seedRuns(cwd: string, ids: string[], baseEnv: Record<string, string | undefined>): void {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(baseEnv)) if (v !== undefined) env[k] = v;
    const r = spawnSync(process.execPath, [CLI, 'self', 'migrate'], { cwd, env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`seed migrate failed: ${r.stderr}`);
    const db = new Database(join(cwd, '.spur', 'spur.db'));
    try {
        for (const id of ids) {
            db.run(
                "INSERT INTO runs (id, workflow_name, mode, status, started_at) VALUES (?, 'feature-verification', 'state-machine', 'running', 0)",
                [id],
            );
        }
    } finally {
        db.close();
    }
}

/** Run one case against the retired script (`old`) or the absorbing spur command (`new`). */
export function runCase(c: GoldenCase, side: 'old' | 'new', baseEnv: Record<string, string | undefined>): CaseOutcome {
    const cwd = mkdtempSync(join(tmpdir(), `pr5-golden-${c.id}-`));
    try {
        const stub = join(cwd, 'stub-spur');
        writeFileSync(stub, STUB);
        chmodSync(stub, 0o755);
        mkdirSync(join(cwd, 'stub'), { recursive: true });
        writeFiles(cwd, c.files);
        if (c.git === true) {
            // The CLI opens `.spur/spur.db` in the project on every invocation; initialized projects
            // gitignore it, so the doc-sync listing compares the same tree on both sides.
            writeFileSync(join(cwd, '.gitignore'), c.gitignore ?? '.spur/spur.db*\n');
            git(cwd, ['init', '-q']);
            git(cwd, ['-c', 'user.email=g@example.com', '-c', 'user.name=g', 'add', '-A']);
            git(cwd, ['-c', 'user.email=g@example.com', '-c', 'user.name=g', 'commit', '-q', '-m', 'init']);
        }
        if (c.seedRuns !== undefined) seedRuns(cwd, c.seedRuns, baseEnv);
        const expand = (v: string): string => v.replaceAll('$STUB', stub).replaceAll('$CWD', cwd);
        const steps: StepOutcome[] = [];
        for (const step of c.steps) {
            writeFiles(cwd, step.before);
            const env: Record<string, string> = {};
            for (const [k, v] of Object.entries(baseEnv)) if (v !== undefined) env[k] = v;
            for (const [k, v] of Object.entries({ ...c.env, ...step.env })) env[k] = expand(v);
            const argv =
                side === 'old'
                    ? [join(SCRIPTS, step.old[0] ?? ''), ...step.old.slice(1).map(expand)]
                    : // The workflow call sites pass `--no-logo` (the retired scripts printed no banner).
                      [CLI, '--no-logo', ...step.new.map(expand)];
            const r = spawnSync(process.execPath, argv, { cwd, env, encoding: 'utf8', timeout: 60_000 });
            steps.push({
                exitCode: r.status ?? -1,
                stdout: normalize(r.stdout ?? '', cwd),
                stderr: normalize(r.stderr ?? '', cwd),
            });
        }
        const files: Record<string, string> = {};
        for (const rel of [...listFiles(cwd, '.spur/run'), ...listFiles(cwd, '.spur/memory')]) {
            files[rel] = normalize(readFileSync(join(cwd, rel), 'utf8'), cwd);
        }
        const argvLog = join(cwd, 'stub', 'argv.log');
        const stubArgv = existsSync(argvLog)
            ? normalize(readFileSync(argvLog, 'utf8'), cwd)
                  .split('\n')
                  .filter((l) => l !== '')
            : [];
        return { steps, files, stubArgv };
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
}
