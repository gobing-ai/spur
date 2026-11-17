import { join } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import { collectSelfStatus } from '@gobing-ai/spur-app';
import { CLI_CONFIG } from '../config';
import type { CliContext } from '../context';
import { CommandError } from '../errors';
import { gitContext } from '../git-context';
import { toEnvelopeJson, writeJsonError } from '../output';
import { SHARED_OPTIONS } from './shared-options';

/**
 * Register `spur status` / `spur self status` (optionally hidden from the top-level help listing).
 *
 * Since A93 1352 the aggregate is app-owned (`collectSelfStatus`) so the standalone command and the
 * consolidated one cannot disagree: this module only reads the optional path target and renders.
 * It also runs before the CLI's database boot — reporting readiness must never create the schema it
 * reports on.
 */
export function registerStatusCommand(program: Command, context: CliContext, options: { hidden?: boolean } = {}): void {
    program
        .command('status', { hidden: options.hidden === true })
        .summary('show project, Git, machine readiness and optional path status')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .argument('[path]', 'Optional file/dir path to check')
        .action(async (path, options) => {
            try {
                const code = await runStatusCore(path, options, context);
                context.setExitCode(code);
            } catch (err) {
                writeJsonError(context.output, options, err instanceof Error ? err.message : String(err));
                context.setExitCode(1);
            }
        });
}

/** Report consolidated read-only readiness, keeping the legacy fields and exit contract. */
async function runStatusCore(
    path: string | undefined,
    options: { json?: boolean; jsonEnvelope?: boolean },
    context: CliContext,
): Promise<number> {
    const target = path === undefined ? undefined : await readTargetStatus(context, path);
    const aggregate = await collectSelfStatus({
        cwd: context.cwd,
        env: context.env,
        config: context.spurConfig ?? null,
        git: await gitContext(context.cwd),
        version: CLI_CONFIG.binaryVersion,
    });
    const status = { ...aggregate, ...(target === undefined ? {} : { target }) };

    if (options.json === true) {
        context.output.write(toEnvelopeJson(status, { enveloped: options.jsonEnvelope }));
        return aggregate.ok ? 0 : 1;
    }

    const lines = [
        `Project: ${aggregate.spurConfig ? 'ok' : 'missing .spur/config.yaml'}`,
        `Package: ${aggregate.packageJson ? 'ok' : 'none'}`,
        `Agents: ${aggregate.agentSpecs.length === 0 ? 'none' : aggregate.agentSpecs.join(', ')}`,
        `Git: ${
            aggregate.git.root === null
                ? 'none'
                : `${aggregate.git.branch ?? 'detached'}${aggregate.git.dirty ? ' dirty' : ' clean'}`
        }`,
        `DecisionMaker: ${aggregate.decisionMaker.state}${aggregate.decisionMaker.credentialPresent ? ' (key present)' : ''}`,
        `Readiness: ${aggregate.overallState}`,
        ...Object.entries(aggregate.sections).map(
            ([name, section]) => `  ${name}: ${section.state}${section.message === '' ? '' : ` — ${section.message}`}`,
        ),
        ...(target === undefined ? [] : [`Path: ${target.path}\t${target.size} bytes`]),
    ];
    context.output.write(lines.join('\n'));
    return aggregate.ok ? 0 : 1;
}

async function readTargetStatus(
    context: CliContext,
    targetPath: string,
): Promise<{
    path: string;
    size: number;
    isFile: boolean;
    isDirectory: boolean;
}> {
    const resolved = join(context.cwd, targetPath);
    const stat = await context.fs.stat(resolved);
    if (stat === null) throw new CommandError(`status failed: path does not exist at ${resolved}`);
    return { path: targetPath, size: stat.size, isFile: stat.isFile(), isDirectory: stat.isDirectory() };
}
