/**
 * Spawnable stand-in for the retired `plugins/sp/scripts/inline-run-{setup,dispatch}.ts`: translates
 * the legacy argv ({@link translateLegacyInlineArgv}) and runs the real CLI entry. Test-only.
 */
import { runCli } from '../../src/index';
import { translateLegacyInlineArgv } from './legacy-argv';

process.argv = [process.argv[0] ?? 'bun', process.argv[1] ?? '', ...translateLegacyInlineArgv(process.argv.slice(2))];
runCli().then((code) => {
    process.exitCode = code;
});
