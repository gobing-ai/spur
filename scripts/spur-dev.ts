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
 *   plugin-install-smoke                       prove the plugin surface is standalone and installs clean
 *
 *   Retired into the CLI by A94 1410/1411 (each name now prints its replacement and exits 2):
 *   build-cli, build-server, bundle-config, bundle-web, bundle-plugins, bundle-laya-worker,
 *   emit-board-types, emit-migration-sql, verify-pack, build-binaries — all `spur builder <verb>`;
 *   link-check and dependency-drift-check — both `spur builder check-deps`.
 *
 *   L2 test runner / coverage
 *   run-tests <bun test args>                  run the suite with the repo's hermetic env; owns coverage certification
 *
 *   L3 repo contract checks
 *   link-check                                  fail if a linked @gobing-ai pkg serves a stale dist/
 *   script-contract-check [--placement-only]    ADR-130 script/hook placement contract
 *   dependency-drift-check                     lockfile @gobing-ai versions must match installed
 *   validate-commands                          sp command files against the thin-wrapper contract
 *   flag-contract-check                        cross-surface flag parity gate for the sp contract surfaces
 *   surface-drift-inventory [--out <file>]     re-runnable plugin/workflow drift inventory against the live CLI
 *   promotion [args]                            workflow candidate promotion/retirement records
 *
 *   L4 dev / eval
 *   eval-pipeline [args]                        run fixture tasks through a pipeline and record cost/outcome
 *   fleet-e2e [--inject-failure <step>]         prove the inbox-only fleet end to end, write the receipt
 *   a2a-serve-e2e                               prove `spur self serve` speaks A2A through the real `a2a` CLI, write the receipt
 *   a2a-member-e2e                              prove A2A member delivery cold, live and on restart, write the receipt
 *   a2a-two-install-e2e                         prove two Spur installs dispatch over A2A with write fencing, write the receipt
 *   delegate-workflow-e2e                       prove both 1397 delegation workflows link tasks across two installs
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
import { runA2aMemberE2e } from './commands/a2a-member-e2e';
import { runA2aServeE2e } from './commands/a2a-serve-e2e';
import { runA2aTwoInstallE2e } from './commands/a2a-two-install-e2e';
import { runDelegateWorkflowE2e } from './commands/delegate-workflow-e2e';
import { runFleetE2e } from './commands/fleet-e2e';

/**
 * L2–L4 modules that own their own argv parsing and exit code (A92 R5). They run as a child
 * process so `bun scripts/spur-dev.ts <command> <args>` forwards `<args>` verbatim.
 */
const DELEGATED: Record<string, string> = {
    'run-tests': 'run-tests.ts',
    'plugin-install-smoke': 'plugin-install-smoke.ts',
    'script-contract-check': 'script-contract-check.ts',
    'validate-commands': 'validate-commands.ts',
    'flag-contract-check': 'validate-flag-contracts.ts',
    'surface-drift-inventory': 'surface-drift-inventory.ts',
    'skill-eval': 'skill-eval.ts',
};

/**
 * Every name the switch below answers. `usage()` prints it and
 * `repo-wide-tests/a93-script-ownership.test.ts` pins it to the switch's own `case` labels, so a
 * registration cannot drift out of the usage list (task 1409 R3).
 */
const COMMANDS = ['fleet-e2e', 'a2a-serve-e2e', 'a2a-member-e2e', 'a2a-two-install-e2e', 'delegate-workflow-e2e'];

/**
 * Retired dispatcher names mapped to the spur command that replaced them (A94 waves add entries as
 * they delete routes). A retired name prints a pointer and exits 2 — never the generic unknown-command
 * failure that leaves a caller guessing (task 1409 R4).
 */
export const RETIRED: Record<string, string> = {
    'build-cli': 'spur builder build-cli',
    'build-server': 'spur builder build-server',
    'bundle-config': 'spur builder bundle-config',
    'bundle-web': 'spur builder bundle-web',
    'bundle-plugins': 'spur builder bundle-plugins',
    'bundle-laya-worker': 'spur builder bundle-laya-worker',
    'emit-board-types': 'spur builder emit-board-types',
    'emit-migration-sql': 'spur builder emit-migration-sql',
    'verify-pack': 'spur builder verify-pack',
    'build-binaries': 'spur builder build-binaries',
    'link-check': 'spur builder check-deps',
    'dependency-drift-check': 'spur builder check-deps',
    'transition-shim-check': 'spur rule check-shims',
    'coverage-provenance-check': 'spur rule check-coverage-cert',
    'eval-pipeline': 'spur workflow eval',
    promotion: 'spur workflow promote-check',
};

function usage(message?: string): never {
    console.error(`Commands: ${[...COMMANDS, ...Object.keys(DELEGATED)].join(', ')}`);
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

const replacement = command === undefined ? undefined : RETIRED[command];
if (replacement !== undefined) {
    console.error(`spur-dev: '${command}' moved to '${replacement}'`);
    process.exit(2);
}

try {
    switch (command) {
        case 'fleet-e2e':
            process.exit(await runFleetE2e(args));
            break;
        case 'a2a-serve-e2e':
            process.exit(await runA2aServeE2e(args));
            break;
        case 'a2a-member-e2e':
            process.exit(await runA2aMemberE2e(args));
            break;
        case 'a2a-two-install-e2e':
            process.exit(await runA2aTwoInstallE2e(args));
            break;
        case 'delegate-workflow-e2e':
            process.exit(await runDelegateWorkflowE2e(args));
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
