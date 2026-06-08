#!/usr/bin/env bun
/**
 * spur-dev — single entry point for repo developer tooling. Each subcommand
 * lives in its own module under `commands/`; this file only dispatches on
 * `argv[2]`, so adding a command is a one-line registration plus a module.
 *
 *   bun scripts/spur-dev.ts <command> [args...]
 *
 * Commands:
 *   bump-ver <pkg|--all> <version> [--push]    bump version(s), commit, tag, push
 *   drop-tags <pkg|--all> <version> [--remote] delete release tag(s)
 *   publish <package-dir>                       resolve deps + npm publish (OIDC)
 *   bundle-config <out-dir>                     copy config/ into a tarball dir
 *   build-binaries                              cross-compile per-platform spur
 *   dev-all                                     run server + web under one supervisor
 */
import { buildBinaries } from './commands/build-binaries';
import { bundleConfig } from './commands/bundle-config';
import { devAll } from './commands/dev-all';
import { publish } from './commands/publish';
import { bumpVer, dropTags } from './commands/release';

function usage(message?: string): never {
    if (message) console.error(`error: ${message}\n`);
    console.error('Usage: bun scripts/spur-dev.ts <command> [args...]');
    console.error('Commands: bump-ver, drop-tags, publish, bundle-config, build-binaries, dev-all');
    process.exit(message ? 1 : 0);
}

const [command, ...args] = process.argv.slice(2);

try {
    switch (command) {
        case 'bump-version':
        case 'bump-ver':
            await bumpVer(args);
            break;
        case 'drop-tags':
            await dropTags(args);
            break;
        case 'publish':
            await publish(args[0]);
            break;
        case 'bundle-config':
            await bundleConfig(args[0]);
            break;
        case 'build-binaries':
            await buildBinaries();
            break;
        case 'dev-all':
            devAll();
            break;
        default:
            usage(command ? `unknown command "${command}"` : undefined);
    }
} catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
