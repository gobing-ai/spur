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
 *   build-binaries                              cross-compile per-platform spur
 *   build-cli                                  patch ts-runtime + compile local `spur` binary
 *   dev-all                                     run server + web under one supervisor
 *   corpus-check [--since <ref>]                sweep task/feature corpus against the baseline
 *   link-check                                  fail if a linked @gobing-ai pkg serves a stale dist/
 */
import { buildBinaries } from './commands/build-binaries';
import { buildCli } from './commands/build-cli';
import { bundleConfig } from './commands/bundle-config';
import { bundleWeb } from './commands/bundle-web';
import { corpusCheck } from './commands/corpus-check';
import { devAll } from './commands/dev-all';
import { linkCheck } from './commands/link-check';
import { publish } from './commands/publish';
import { bumpVer, dropTags } from './commands/release';

function usage(message?: string): never {
    console.error(
        'Commands: bump-ver, drop-tags, publish, bundle-config, bundle-web, build-binaries, build-cli, dev-all, corpus-check, link-check',
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
        case 'build-cli':
            await buildCli();
            break;
        case 'build-binaries':
            await buildBinaries();
            break;
        case 'dev-all':
            devAll();
            break;
        case 'corpus-check': {
            const sinceIndex = args.indexOf('--since');
            const since = sinceIndex === -1 ? undefined : args[sinceIndex + 1];
            // Fail loud: `--since` with no value would otherwise silently fall back to the default
            // branch-scoped range, i.e. an audit that quietly measured something else than asked.
            if (sinceIndex !== -1 && (since === undefined || since.startsWith('--'))) {
                throw new Error('corpus-check: --since requires a git ref (e.g. --since ee0771ab~1)');
            }
            process.exit(await corpusCheck(process.cwd(), since));
            break;
        }
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
