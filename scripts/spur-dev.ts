#!/usr/bin/env bun
/**
 * spur-dev — single entry point for repo developer tooling. Each subcommand
 * lives in its own module under `commands/`; this file only dispatches on
 * `argv[2]`, so adding a command is a one-line registration plus a module.
 *
 *   bun scripts/spur-dev.ts <command> [args...]
 *
 * Commands (the layer is recorded here, never in the path — A92 R5):
 *
 *   L1 build / package
 *   bundle-config <out-dir>                     copy config/ into a tarball dir
 *   bundle-laya-worker [out-dir]                copy the laya-local Python worker next to the bundle
 *   bundle-web [out-dir]                        copy dist/web into apps/cli/web for npm
 *   bundle-plugins                               copy plugins/ + .claude-plugin into apps/cli for npm
 *   emit-board-types                            emit apps/cli/board/index.d.ts from the authoring source
 *   verify-pack <tgz>                            extract + assert the packed tarball ships plugin + marketplace
 *   build-binaries                              cross-compile per-platform spur
 *   build-cli                                  patch ts-runtime + compile local `spur` binary
 *   build-server                               compile standalone server with the same native DB facade
 *   plugin-install-smoke                       prove the plugin surface is standalone and installs clean
 *
 *   L2 test runner / coverage
 *   run-tests <bun test args>                  run the suite with the repo's hermetic env; owns coverage certification
 *   coverage-provenance-check                  refuse a post-check whose LCOV is not certified
 *
 *   L3 repo contract checks
 *   link-check                                  fail if a linked @gobing-ai pkg serves a stale dist/
 *   script-contract-check [--placement-only]    ADR-130 script/hook placement contract
 *   transition-shim-check                      transition-shim manifest ↔ source markers, two-sided
 *   dependency-drift-check                     lockfile @gobing-ai versions must match installed
 *   validate-commands                          sp command files against the thin-wrapper contract
 *   flag-contract-check                        cross-surface flag parity gate for the sp contract surfaces
 *   surface-drift-inventory [--out <file>]     re-runnable plugin/workflow drift inventory against the live CLI
 *   promotion [args]                            workflow candidate promotion/retirement records
 *
 *   L4 dev / eval
 *   dev-all                                     run server + web under one supervisor
 *   eval-pipeline [args]                        run fixture tasks through a pipeline and record cost/outcome
 *   fleet-e2e [--inject-failure <step>]         prove the inbox-only fleet end to end, write the receipt
 *   fleet-e2e --guest-join-fixture              exercise the R4 pre-1081 guest-join skip arm, write its receipt
 *   fleet-e2e --perf [--trials <n>]             task 1273 KPI arm: paired stub trials per target agent, receipts in docs/reports/
 *   skill-eval [--fixtures|--json]             run the skill scenarios and render the report
 *
 * The L2–L4 modules are top-level scripts with their own argv contract and exit code, so they run
 * as a child process with `args` forwarded verbatim: `package.json` reaches them only through this
 * dispatcher, never as `bun scripts/commands/<x>.ts`.
 *
 * Retired into the CLI by script-absorption PR-9: `publish` → `spur builder publish`,
 * `check-marketplace-version` → `spur builder bump-ver --check`, `real-run-cost` /
 * `check-pipeline-budgets` → `spur workflow cost [--budget]`.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildBinaries } from './commands/build-binaries';
import { buildCli } from './commands/build-cli';
import { buildServer } from './commands/build-server';
import { bundleConfig } from './commands/bundle-config';
import { bundleLayaWorker } from './commands/bundle-laya-worker';
import { bundlePlugins } from './commands/bundle-plugins';
import { bundleWeb } from './commands/bundle-web';
import { devAll } from './commands/dev-all';
import { emitBoardDeclarations } from './commands/emit-board-types';
import { evalPipeline } from './commands/eval-pipeline';
import { runFleetE2e } from './commands/fleet-e2e';
import { linkCheck } from './commands/link-check';
import { verifyPack } from './commands/verify-pack';
import { runWorkflowPromotion } from './commands/workflow-promotion';

/**
 * L2–L4 modules that own their own argv parsing and exit code (A92 R5). They run as a child
 * process so `bun scripts/spur-dev.ts <command> <args>` forwards `<args>` verbatim.
 */
const DELEGATED: Record<string, string> = {
    'run-tests': 'run-tests.ts',
    'coverage-provenance-check': 'coverage-provenance-check.ts',
    'plugin-install-smoke': 'plugin-install-smoke.ts',
    'script-contract-check': 'script-contract-check.ts',
    'transition-shim-check': 'transition-shim-check.ts',
    'dependency-drift-check': 'dependency-drift-check.ts',
    'validate-commands': 'validate-commands.ts',
    'flag-contract-check': 'validate-flag-contracts.ts',
    'surface-drift-inventory': 'surface-drift-inventory.ts',
    'skill-eval': 'skill-eval.ts',
};

function usage(message?: string): never {
    console.error(
        `Commands: bundle-config, bundle-laya-worker, bundle-web, bundle-plugins, emit-board-types, verify-pack, build-binaries, build-cli, build-server, dev-all, link-check, eval-pipeline, fleet-e2e, promotion, ${Object.keys(DELEGATED).join(', ')}`,
    );
    process.exit(message ? 1 : 0);
}

function delegate(module: string, args: string[]): never {
    const target = join(import.meta.dir, 'commands', module);
    // A renamed module must fail loudly here, not as an opaque bun "module not found".
    if (!existsSync(target)) usage(`delegated module missing: scripts/commands/${module}`);
    // process.execPath pins the running bun; a bare 'bun' could resolve a different PATH install.
    const child = Bun.spawnSync([process.execPath, target, ...args], {
        stdio: ['inherit', 'inherit', 'inherit'],
    });
    process.exit(child.exitCode ?? 1);
}

const [command, ...args] = process.argv.slice(2);

try {
    switch (command) {
        case 'bundle-config': {
            const result = await bundleConfig(args[0]);
            console.log(
                `Bundled config -> ${result.target} (fixtures/OS junk excluded, ${result.injected} $schema directives injected)`,
            );
            break;
        }
        case 'bundle-laya-worker': {
            const result = await bundleLayaWorker(args[0]);
            console.log(`Bundled laya worker ${result.source} -> ${result.target} (${result.bytes} bytes)`);
            break;
        }
        case 'bundle-web': {
            const result = await bundleWeb(args[0]);
            console.log(`Bundled board assets ${result.source} -> ${result.target}`);
            break;
        }
        case 'bundle-plugins': {
            const result = await bundlePlugins();
            console.log(`Staged plugins ${result.pluginTarget} + marketplace ${result.marketplaceTarget} for npm`);
            break;
        }
        case 'emit-board-types': {
            const result = await emitBoardDeclarations();
            console.log(`${result.changed ? 'Wrote' : 'Unchanged'} board declaration ${result.target}`);
            break;
        }
        case 'verify-pack': {
            const tarball = args[0];
            if (!tarball) throw new Error('Usage: spur-dev verify-pack <path-to-.tgz>');
            process.exit(await verifyPack(tarball));
            break;
        }
        case 'build-cli':
            await buildCli();
            break;
        case 'build-server':
            await buildServer();
            break;
        case 'build-binaries':
            await buildBinaries();
            break;
        case 'dev-all':
            devAll();
            break;
        case 'eval-pipeline':
            process.exit(await evalPipeline(args));
            break;
        case 'fleet-e2e':
            process.exit(await runFleetE2e(args));
            break;
        case 'link-check':
            process.exit(await linkCheck());
            break;
        case 'promotion':
            process.exit(await runWorkflowPromotion(args));
            break;
        default: {
            const module = command === undefined ? undefined : DELEGATED[command];
            if (module === undefined) usage(command ? `unknown command "${command}"` : undefined);
            delegate(module, args);
        }
    }
} catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
