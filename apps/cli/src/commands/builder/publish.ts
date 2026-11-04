import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { publishPackage } from '../../release-ops';

/** Register `spur builder publish`. */
export function registerBuilderPublishCommand(noun: Command, context: CliContext): void {
    noun.command('publish')
        .summary('resolve workspace/catalog ranges, build, and npm publish a package (CI)')
        .description(
            [
                'CI publish for npm Trusted Publishing (OIDC): rewrite workspace:/catalog: ranges in',
                '<dir>/package.json, run `bun run build:bundle`, `npm publish --access public`, and',
                'restore the manifest on every exit path.',
            ].join('\n'),
        )
        .option('--otp <code>', 'npm one-time password (local publishes only)')
        .argument('<dir>', 'package directory, relative to the workspace root')
        .action(async (dir, options) => {
            try {
                await publishPackage(dir, {
                    repoRoot: context.cwd,
                    output: context.output,
                    ...(options.otp !== undefined ? { otp: options.otp } : {}),
                });
            } catch (err) {
                context.output.error(err instanceof Error ? err.message : String(err));
                context.setExitCode(1);
            }
        });
}
