#!/usr/bin/env bun
// CLI entry (PR-L, lazy CLI loading): only light modules are imported statically. The DB/config
// boot (`./cli-runtime`), every command module (`./program`'s registry) and the startup banner are
// reached through string-literal dynamic imports, which `bun build --compile` still bundles.
import './sanitize-env';
import { Command } from '@commander-js/extra-typings';
import { getEnvVars } from '@gobing-ai/spur-config/env';
import type { MainOptions } from './cli-runtime';
import { errorMessage } from './errors';
import { type CommandOutput, consoleOutput } from './output';
import { buildProgram, createRootProgram } from './program';
import { isSelfHookInvocation } from './self-hook-argv';

export type { MainOptions } from './cli-runtime';
export { buildProgram };

/** Root flags `main()` ignores when classifying an invocation (they take no value). */
const GLOBAL_FLAGS = ['--no-logo', '--cli-verbose', '-v'];

/**
 * Set once an invocation has loaded the application layer (full boot or `serve`); `runCli()` then
 * releases the cached decision services. Boot-free paths (`--version`, `self hook`) never load it.
 */
let applicationLoaded = false;

/** Run the Spur CLI with explicit argv and injectable runtime dependencies. */
export async function main(argv = process.argv.slice(2), options: MainOptions = {}): Promise<number> {
    const output = options.output ?? consoleOutput;
    let exitCode = 0;

    const cwd = options.cwd ?? process.cwd();
    const env = options.env ?? getEnvVars();
    const context = {
        cwd,
        output,
        env,
        setExitCode: (code: number) => {
            exitCode = code;
        },
    };
    const commandTokens = argv.filter((token) => !GLOBAL_FLAGS.includes(token));

    // Serve owns its sole runtime and database. Dispatch before the CLI's adapter
    // and configuration runtime boot, including the canonical `self serve` form.
    if (commandTokens[0] === 'serve' || (commandTokens[0] === 'self' && commandTokens[1] === 'serve')) {
        applicationLoaded = true;
        const { registerServeCommand } = await import('./commands/serve');
        const program = earlyProgram(output);
        registerServeCommand(program, context, { startServer: options.startServer });
        registerServeCommand(program.command('self'), context, { startServer: options.startServer });
        return parseEarly(program, argv, output, () => exitCode);
    }

    // `self hook` is a host hook transport (script-absorption PR-2a): it must answer in
    // milliseconds, never create or migrate a database, never fail on a broken config, and
    // always exit 0. Dispatch it before the adapter and configuration boot, like serve.
    if (isSelfHookInvocation(argv)) {
        const { registerSelfHookCommand } = await import('./self-hook');
        const program = earlyProgram(output);
        registerSelfHookCommand(program.command('self'), context, options.selfHook);
        return parseEarly(program, argv, output, () => exitCode);
    }

    // `spur --version` (PR-L): print through the same root program and Commander path as the full
    // tree, but without creating a database or loading config it never reads.
    if (commandTokens.length === 1 && (commandTokens[0] === '--version' || commandTokens[0] === '-V')) {
        return parseEarly(createRootProgram(output), argv, output, () => exitCode);
    }

    applicationLoaded = true;
    const { runFullCli } = await import('./cli-runtime');
    return runFullCli(argv, options, output, cwd, env);
}

/** Root program for the boot-free early dispatches: global flags only, no version or nouns. */
function earlyProgram(output: CommandOutput): Command {
    const program = new Command().name('spur').exitOverride();
    program.option('--no-logo').option('-v, --cli-verbose');
    program.configureOutput({ writeOut: (str) => output.write(str), writeErr: (str) => output.error(str) });
    return program;
}

async function parseEarly(program: Command, argv: string[], output: CommandOutput, exitCode: () => number) {
    try {
        await program.parseAsync(argv, { from: 'user' });
        return exitCode();
    } catch (error) {
        const code = (error as { exitCode?: number }).exitCode;
        if (code !== undefined) return code;
        output.error(errorMessage(error));
        return 1;
    }
}

/**
 * Startup-banner policy (A31/0719) — single composition-root owner. Exact argv
 * tokens only: near-misses like `--no-logos` must not suppress the logo. `main()`
 * never consults this — programmatic dispatch stays banner-free by construction.
 */
export function shouldRenderBanner(argv: readonly string[]): boolean {
    // Hook output is read by the host as JSON; a banner would corrupt every decision.
    if (isSelfHookInvocation(argv)) return false;
    return !argv.some((arg) => arg === '--no-logo' || arg === '--json' || arg === '--quiet' || arg === '--silent');
}

/** CLI entry point extracted for test coverage. Does NOT call process.exit(). */
export async function runCli(): Promise<number> {
    const argv = process.argv.slice(2);
    if (shouldRenderBanner(argv)) {
        const { bannerText } = await import('./banner');
        consoleOutput.write(bannerText());
    }
    try {
        return await main();
    } finally {
        // A `laya-local` decision leaves a warm Python worker whose open pipes keep this process
        // alive; the CLI owns that client, so it releases it at the process boundary (otherwise the
        // command prints its result and the process never exits). Only paths that loaded the
        // application layer can hold one.
        if (applicationLoaded) {
            const { disposeDecisionServices } = await import('@gobing-ai/spur-app');
            await disposeDecisionServices();
        }
    }
}

if (import.meta.main) {
    // main() closes its runtime and DB; natural shutdown also drains buffered pipe output.
    process.exitCode = await runCli();
}
