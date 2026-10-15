/**
 * `spur agent dogfood <gate|validate-report>` — dogfood-testing skill transport
 * (script-absorption PR-7). Replaces plugins/sp/scripts/dogfood-testing/*.ts.
 *
 * Thin Commander adapter over `@gobing-ai/spur-app/dogfood`. Exit codes match the
 * retired scripts: 0 proceed/ok · 1 usage · 2 refuse / validation failed.
 */
import type { Command } from '@commander-js/extra-typings';
import {
    DOGFOOD_GATE_USAGE,
    DOGFOOD_VALIDATE_USAGE,
    runDogfoodGateCli,
    runDogfoodValidateCli,
} from '@gobing-ai/spur-app/dogfood';
import type { CliContext } from '../../context';
import { SHARED_OPTIONS } from '../shared-options';

function writeResult(context: CliContext, result: { exitCode: number; stdout: string; stderr: string }): void {
    // output.write terminates the line itself; the app renders a trailing newline like the old script.
    if (result.stdout) context.output.write(result.stdout.replace(/\n$/, ''));
    if (result.stderr) context.output.error(result.stderr);
    context.setExitCode(result.exitCode);
}

/** Register `spur agent dogfood gate|validate-report`. */
export function registerAgentDogfoodCommand(agent: Command, context: CliContext): void {
    const dogfood = agent
        .command('dogfood')
        .summary('dogfood-testing gates: pipeline-driving refuse and report contract');

    dogfood
        .command('gate')
        .summary('Refuse a pipeline-driving testee without --max-retry (dogfood Phase 1.0 / W8)')
        .description(DOGFOOD_GATE_USAGE)
        .option('--testee <string>', 'the testee invocation under evaluation')
        .option('--max-retry-present', 'operator already supplied an explicit --max-retry')
        .option('--steps <labels>', 'derived step labels joined by || (Phase 1 W8 re-check)')
        .option(...SHARED_OPTIONS.json)
        .argument('[testee]', 'positional alias for --testee')
        .action((positional, options) => {
            const argv: string[] = [];
            const testee = options.testee ?? positional;
            if (testee) argv.push('--testee', String(testee));
            if (options.maxRetryPresent === true) argv.push('--max-retry-present');
            if (options.steps) argv.push('--steps', String(options.steps));
            if (options.json === true) argv.push('--json');
            writeResult(context, runDogfoodGateCli(argv));
        });

    dogfood
        .command('validate-report')
        .summary('Validate a dogfood report against the @1.2 contract')
        .description(DOGFOOD_VALIDATE_USAGE)
        .option('--file <path>', 'report markdown path')
        .option(...SHARED_OPTIONS.json)
        .argument('[file]', 'positional alias for --file')
        .action(async (positional, options) => {
            const argv: string[] = [];
            const file = options.file ?? positional;
            if (file) argv.push('--file', String(file));
            if (options.json === true) argv.push('--json');
            writeResult(
                context,
                await runDogfoodValidateCli(argv, (path) => context.fs.readFile(context.fs.resolve(path))),
            );
        });
}
