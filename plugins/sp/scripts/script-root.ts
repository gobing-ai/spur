#!/usr/bin/env bun
/**
 * script-root — run-start script-resolution identity for the sp pipelines (task 0960 R2).
 *
 * WHY: the pipeline YAML ships to every consumer, but its script probes resolved
 * `plugins/sp/scripts/` **project-first**. A consumer that hand-vendored a stale copy then ran
 * a different revision than the installed twin, mixing revisions across steps that write and
 * read the same cross-step artifacts (status files, verdicts, proof digests). The probe is
 * dogfooding-only, so it is now gated on `config/plugin-scripts.json` — a marker that lives
 * outside `plugins/sp/`, so copying the plugin tree cannot reproduce it.
 *
 * This script records *which* tree a run resolved, once, before any step executes:
 *   `.spur/run/<runId>-script-root.json`  `{ mode, source, dir, scriptSetDigest }`
 *
 * - `source-repo` — the marker is present; the project's live `plugins/sp/scripts/` is the
 *   resolved tree (the dogfood path).
 * - `installed` — no marker; the tree is `dirname(superskill script path sp script-root.mjs
 *   --json .path)`, with `source` from the same probe. One stderr warning names a dead
 *   vendored `plugins/sp/scripts/` dir that is no longer executed.
 * - `unresolved` — nothing resolved. Written with an `error` and **exit 0**: a missing
 *   optional script must stay a per-step fail-closed outcome, never a run-wide abort (R3).
 *
 * `scriptSetDigest` is one sha256 over the sorted `name:sha256` list of the resolved dir's
 * regular files (non-recursive) — the installed staging has no version file, so this answers
 * "which revision produced this run?" without a Superskill change.
 *
 * Node/bun builtins and the vendored `../lib/env` gateway only — bundled standalone by
 * `superskill install`, so no `@gobing-ai/*` value imports (task 0669).
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getEnvVars } from '../lib/env';

export type ScriptRootMode = 'source-repo' | 'installed' | 'unresolved';

export interface ScriptRoot {
    mode: ScriptRootMode;
    source?: string;
    dir?: string;
    scriptSetDigest?: string;
    error?: string;
}

export interface ScriptRootResult extends ScriptRoot {
    resultFile: string;
    exitCode: number;
}

export interface ScriptRootEnv {
    __runId?: string;
    [key: string]: string | undefined;
}

/** Resolved script descriptor from `superskill script path sp <rel> --json`. */
export interface ResolvedScript {
    path?: string;
    source?: string;
}

export interface ScriptRootOptions {
    /** Base directory for `.spur/run` and the project marker; defaults to process cwd. */
    cwd?: string;
    /** Test seam: run `superskill script path sp script-root.mjs --json`. */
    resolveScript?: (rel: string) => ResolvedScript | null;
    /** Test seam: the one-warning sink. */
    warn?: (message: string) => void;
}

/** Marker that identifies the Spur source repo (owned by script-contract-check, outside plugins/sp). */
export const SOURCE_REPO_MARKER = join('config', 'plugin-scripts.json');
/** The project-first tree the dogfood probes execute. */
export const PROJECT_SCRIPTS_DIR = join('plugins', 'sp', 'scripts');
/** The rel the installed twin resolves under (its own staging name). */
export const SCRIPT_ROOT_TWIN_REL = 'script-root.mjs';

function defaultResolveScript(cwd?: string): (rel: string) => ResolvedScript | null {
    return (rel: string): ResolvedScript | null => {
        const run = spawnSync('superskill', ['script', 'path', 'sp', rel, '--json'], {
            cwd,
            encoding: 'utf8',
            env: getEnvVars(),
        });
        if (run.status !== 0 || !run.stdout) return null;
        const lastLine = run.stdout.trim().split('\n').pop() ?? '';
        try {
            const parsed = JSON.parse(lastLine) as ResolvedScript;
            return typeof parsed.path === 'string' && parsed.path.length > 0 ? parsed : null;
        } catch {
            return null;
        }
    };
}

/** sha256 over the sorted `name:sha256` list of `dir`'s regular files (non-recursive). */
export function digestScriptSet(dir: string, cwd?: string): string {
    const abs = cwd ? join(cwd, dir) : dir;
    const names = readdirSync(abs)
        .filter((name) => {
            try {
                return statSync(join(abs, name)).isFile();
            } catch {
                return false;
            }
        })
        .sort();
    const list = names.map(
        (name) =>
            `${name}:${createHash('sha256')
                .update(readFileSync(join(abs, name)))
                .digest('hex')}`,
    );
    return `sha256:${createHash('sha256').update(list.join('\n')).digest('hex')}`;
}

/**
 * Resolve the run's script root and write `.spur/run/<runId>-script-root.json`.
 * Never aborts: every failure is recorded as `mode: "unresolved"` with exit 0 (R3).
 */
export function runScriptRoot(env: ScriptRootEnv, options: ScriptRootOptions = {}): ScriptRootResult {
    const cwd = options.cwd;
    const runId = env.__runId ?? env.runId ?? '';
    const relResult = join('.spur', 'run', `${runId}-script-root.json`);
    const abs = (p: string): string => (cwd ? join(cwd, p) : p);
    const warn = options.warn ?? ((message: string): void => void process.stderr.write(`${message}\n`));
    mkdirSync(abs(join('.spur', 'run')), { recursive: true });

    const write = (row: ScriptRoot): ScriptRootResult => {
        writeFileSync(abs(relResult), `${JSON.stringify(row)}\n`);
        return { ...row, resultFile: relResult, exitCode: 0 };
    };

    // Source repo: the project's live tree is the resolved tree (R6).
    if (existsSync(abs(SOURCE_REPO_MARKER))) {
        try {
            return write({
                mode: 'source-repo',
                source: 'project',
                dir: PROJECT_SCRIPTS_DIR,
                scriptSetDigest: digestScriptSet(PROJECT_SCRIPTS_DIR, cwd),
            });
        } catch (error) {
            return write({ mode: 'unresolved', error: `source-repo digest failed: ${String(error)}` });
        }
    }

    // Installed: resolve the twin, and name a dead vendored dir that is no longer executed.
    if (existsSync(abs(PROJECT_SCRIPTS_DIR))) {
        warn(
            `script-root: ignoring vendored ${PROJECT_SCRIPTS_DIR}/ (no ${SOURCE_REPO_MARKER} marker) — ` +
                `steps resolve the installed twin via 'superskill script path sp <rel>'`,
        );
    }
    const resolve = options.resolveScript ?? defaultResolveScript(cwd);
    const resolved = resolve(SCRIPT_ROOT_TWIN_REL);
    if (!resolved?.path) {
        return write({
            mode: 'unresolved',
            error: `'superskill script path sp ${SCRIPT_ROOT_TWIN_REL}' resolved nothing`,
        });
    }
    const dir = dirname(resolved.path);
    try {
        return write({
            mode: 'installed',
            source: resolved.source ?? 'unknown',
            dir,
            scriptSetDigest: digestScriptSet(dir),
        });
    } catch (error) {
        return write({ mode: 'unresolved', error: `installed digest failed: ${String(error)}` });
    }
}

export const SCRIPT_ROOT_USAGE = 'usage: script-root --run-id <id>';

export function main(argv: string[], env: ScriptRootEnv = getEnvVars(), options: ScriptRootOptions = {}): number {
    let runId = env.__runId ?? '';
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--run-id') {
            runId = argv[i + 1] ?? '';
            i++;
            continue;
        }
        process.stderr.write(`${SCRIPT_ROOT_USAGE}\n`);
        return 2;
    }
    return runScriptRoot({ ...env, __runId: runId }, options).exitCode;
}

if (import.meta.main) {
    process.exit(main(process.argv.slice(2)));
}
