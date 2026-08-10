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
 *   bundle-web [out-dir]                        copy dist/web into apps/cli/web for npm
 *   bundle-plugins                               copy plugins/ + .claude-plugin into apps/cli for npm
 *   check-marketplace-version                    fail if marketplace/plugin versions drifted from the CLI package
 *   verify-pack <tgz>                            extract + assert the packed tarball ships plugin + marketplace
 *   build-binaries                              cross-compile per-platform spur
 *   build-cli                                  patch ts-runtime + compile local `spur` binary
 *   dev-all                                     run server + web under one supervisor
 *   link-check                                  fail if a linked @gobing-ai pkg serves a stale dist/
 */
import { buildBinaries } from './commands/build-binaries';
import { buildCli } from './commands/build-cli';
import { bundleConfig } from './commands/bundle-config';
import { bundlePlugins } from './commands/bundle-plugins';
import { bundleWeb } from './commands/bundle-web';
import { checkMarketplaceVersion } from './commands/check-marketplace-version';
import { devAll } from './commands/dev-all';
import { linkCheck } from './commands/link-check';
import { publish } from './commands/publish';
import { bumpVer, dropTags } from './commands/release';
import { verifyPack } from './commands/verify-pack';

function usage(message?: string): never {
    console.error(
        'Commands: bump-ver, drop-tags, publish, bundle-config, bundle-web, bundle-plugins, check-marketplace-version, verify-pack, build-binaries, build-cli, dev-all, link-check',
    );
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
        case 'publish': {
            const otpIndex = args.indexOf('--otp');
            const otp = otpIndex !== -1 ? args[otpIndex + 1] : undefined;
            await publish(args[0], otp);
            break;
        }
        case 'bundle-config': {
            const result = await bundleConfig(args[0]);
            console.log(
                `Bundled config -> ${result.target} (fixtures/OS junk excluded, ${result.injected} $schema directives injected)`,
            );
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
        case 'check-marketplace-version':
            process.exit(await checkMarketplaceVersion());
            break;
        case 'verify-pack': {
            const tarball = args[0];
            if (!tarball) throw new Error('Usage: spur-dev verify-pack <path-to-.tgz>');
            process.exit(await verifyPack(tarball));
            break;
        }
        case 'build-cli':
            await buildCli();
            break;
        case 'build-binaries':
            await buildBinaries();
            break;
        case 'dev-all':
            devAll();
            break;
        case 'link-check':
            process.exit(await linkCheck());
            break;
        default:
            usage(command ? `unknown command "${command}"` : undefined);
    }
} catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
