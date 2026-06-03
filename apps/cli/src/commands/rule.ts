import { type FailOnSeverity, RuleService } from '@gobing-ai/spur-app';
import { booleanFlag, stringFlag } from '../args';
import { makeColorize, shouldColor } from '../colors';
import type { CliContext } from '../context';

/** Execute `spur rule` commands backed by @gobing-ai/ts-rule-engine. */
export async function runRuleCommand(
    subcommand: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
    positionals: string[],
): Promise<number> {
    const service = new RuleService(context);
    switch (subcommand ?? 'run') {
        case 'run': {
            const preset = stringFlag(flags, 'preset', 'recommended');
            const failOn = parseFailOn(stringFlag(flags, 'fail-on', 'error'));
            const file = typeof flags.file === 'string' ? flags.file : undefined;
            const rule = typeof flags.rule === 'string' ? flags.rule : positionals[0];
            const json = booleanFlag(flags, 'json');
            const verbose = booleanFlag(flags, 'verbose') && !json;
            const color = makeColorize(shouldColor(context.env, process.stderr));
            const result = await service.evaluate({ preset, failOn, file, rule, json, verbose, color });
            return result.exitCode;
        }
        case 'validate': {
            const source = resolveSource(flags, positionals);
            const json = booleanFlag(flags, 'json');
            const validateSchema = booleanFlag(flags, 'no-schema') ? false : undefined;
            const result = await service.validate({ source, json, validateSchema });
            return result.exitCode;
        }
        case 'list': {
            const preset = typeof flags.preset === 'string' ? flags.preset : undefined;
            const result = await service.list(preset);
            context.output.write(
                booleanFlag(flags, 'json')
                    ? JSON.stringify(result, null, 2)
                    : result.rules.length === 0
                      ? 'No rules found.'
                      : result.rules
                            .map(
                                (entry) =>
                                    `${entry.id}\t${entry.severity}\t${entry.enabled ? 'enabled' : 'disabled'}\t${entry.file}`,
                            )
                            .join('\n'),
            );
            return 0;
        }
        default:
            context.output.error(`Unknown rule command: ${subcommand}`);
            return 1;
    }
}

function resolveSource(
    flags: Record<string, string | boolean>,
    positionals: readonly string[],
): { kind: 'file' | 'preset'; value: string } {
    if (typeof flags.file === 'string') return { kind: 'file', value: flags.file };
    if (typeof flags.preset === 'string') return { kind: 'preset', value: flags.preset };
    const positional = positionals[0];
    if (positional !== undefined) return { kind: 'file', value: positional };
    return { kind: 'preset', value: 'recommended' };
}

function parseFailOn(value: string): FailOnSeverity {
    if (value === 'error' || value === 'warning' || value === 'info') return value;
    throw new Error(`Invalid --fail-on value "${value}". Expected error, warning, or info.`);
}
