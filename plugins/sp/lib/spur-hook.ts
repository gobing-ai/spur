/**
 * Transport from the sp plugin's in-process entry points to `spur self hook <id> --host <host>`
 * (script-absorption plan §5). The hook logic lives in `@gobing-ai/spur-app` behind that command;
 * the superskill-import shims (`hooks/context-*.ts`) and the Pi extension only hand it the payload.
 *
 * Standalone by design (plugin rule: node builtins + `./env` only). Every failure — spur missing,
 * an interpreter-less shebang (126/127), a timeout, a spawn error — fails open: callers get `null`
 * and treat it as "no decision", exactly like the transport's own fail-open contract.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEnvVars } from './env';
import { spurCommand } from './spur-bin';

/** Host flag forwarded as `--host`; `auto` lets spur pick claude (CLAUDE_PROJECT_DIR set) or codex. */
export type SpurHookHost = 'claude' | 'codex' | 'pi' | 'auto';

/** Per-call options for {@link runSpurHook} / {@link runSpurHookAsync}. */
export interface SpurHookOptions {
    host: SpurHookHost;
    /** Working directory for spur (the project root; Pi resolves its ledger from it). */
    cwd?: string;
    /** Kill the child after this many ms (default 10 000 — the hooks.json ceiling). */
    timeoutMs?: number;
    /** Child environment (default: this process's). */
    env?: Record<string, string | undefined>;
}

/** What spur printed and how it exited. */
export interface SpurHookResult {
    stdout: string;
    exitCode: number;
}

/** Install locations tried when `spur` is not on PATH (GUI-launched hosts often lack ~/.bun/bin). */
export function spurInstallCandidates(home: string = homedir()): string[] {
    return [join(home, '.bun', 'bin', 'spur'), '/opt/homebrew/bin/spur', '/usr/local/bin/spur'];
}

/**
 * Ordered argv prefixes to try. `SPUR_BIN` (may carry arguments) wins outright. Otherwise the
 * monorepo-local CLI when this plugin runs from a spur checkout (dogfooding: hooks run the same
 * revision as the tree, as `defaultSpurBin` does for scripts), `spur` on PATH, each existing install
 * candidate, then each candidate's real `.js` target through the current executable (a shebang
 * whose interpreter is not on PATH).
 */
export function spurCommandAttempts(
    env: Record<string, string | undefined> = getEnvVars(),
    candidates: string[] = spurInstallCandidates(),
    localCli: string = fileURLToPath(new URL('../../../apps/cli/src/index.ts', import.meta.url)),
): string[][] {
    if (env.SPUR_BIN?.trim()) {
        const { cmd, prefix } = spurCommand(env.SPUR_BIN);
        return [[cmd, ...prefix]];
    }
    const attempts: string[][] = existsSync(localCli) ? [['bun', localCli]] : [];
    attempts.push(['spur']);
    const existing = candidates.filter((candidate) => existsSync(candidate));
    for (const candidate of existing) attempts.push([candidate]);
    for (const candidate of existing) {
        const real = realTarget(candidate);
        if (real.endsWith('.js')) attempts.push([process.execPath, real]);
    }
    return attempts;
}

function realTarget(path: string): string {
    try {
        return realpathSync(path);
    } catch {
        return path;
    }
}

/** 126/127: the shell/env could not execute the target (missing interpreter) — try the next attempt. */
const unusable = (code: number | null): boolean => code === 126 || code === 127;

function hookArgs(prefix: string[], id: string, host: SpurHookHost): [string, string[]] {
    return [prefix[0] as string, [...prefix.slice(1), 'self', 'hook', id, '--host', host]];
}

/** Run `spur self hook <id>` synchronously with `stdin`; `null` when no spur could run it. */
export function runSpurHook(id: string, stdin: string, opts: SpurHookOptions): SpurHookResult | null {
    const env = opts.env ?? getEnvVars();
    for (const prefix of spurCommandAttempts(env)) {
        const [command, args] = hookArgs(prefix, id, opts.host);
        const res = spawnSync(command, args, {
            cwd: opts.cwd,
            env,
            input: stdin,
            encoding: 'utf-8',
            timeout: opts.timeoutMs ?? 10_000,
            stdio: ['pipe', 'pipe', 'ignore'],
        });
        if (res.error !== undefined) {
            // A timeout means spur ran and hung: retrying elsewhere would double the wait.
            if ((res.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') return null;
            continue;
        }
        if (unusable(res.status)) continue;
        return { stdout: res.stdout ?? '', exitCode: res.status ?? 1 };
    }
    return null;
}

function spawnOnce(
    command: string,
    args: string[],
    stdin: string,
    opts: SpurHookOptions,
    env: Record<string, string | undefined>,
): Promise<SpurHookResult | null | 'next'> {
    return new Promise((resolve) => {
        let stdout = '';
        let settled = false;
        const finish = (value: SpurHookResult | null | 'next'): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        };
        const child = spawn(command, args, { cwd: opts.cwd, env, stdio: ['pipe', 'pipe', 'ignore'] });
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            finish(null);
        }, opts.timeoutMs ?? 10_000);
        child.stdout?.setEncoding('utf-8');
        child.stdout?.on('data', (chunk: string) => {
            stdout += chunk;
        });
        child.stdin?.on('error', () => {});
        child.on('error', () => finish('next'));
        child.on('close', (code) => finish(unusable(code) ? 'next' : { stdout, exitCode: code ?? 1 }));
        child.stdin?.end(stdin);
    });
}

/** Non-blocking twin of {@link runSpurHook} for long-lived hosts (the Pi extension's event loop). */
export async function runSpurHookAsync(
    id: string,
    stdin: string,
    opts: SpurHookOptions,
): Promise<SpurHookResult | null> {
    const env = opts.env ?? getEnvVars();
    for (const prefix of spurCommandAttempts(env)) {
        const [command, args] = hookArgs(prefix, id, opts.host);
        const result = await spawnOnce(command, args, stdin, opts, env);
        if (result !== 'next') return result;
    }
    return null;
}
