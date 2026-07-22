import { join } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../context';
import { CommandError } from '../errors';
import { gitContext } from '../git-context';
import { toJson } from '../output';

/** Register `spur status` command. */
export function registerStatusCommand(program: Command, context: CliContext): void {
    program
        .command('status')
        .summary('show project, Git, and optional path status')
        .option('--json', 'Output machine-readable JSON')
        .argument('[path]', 'Optional file/dir path to check')
        .action(async (path, options) => {
            try {
                const code = await runStatusCore(path, options, context);
                context.setExitCode(code);
            } catch (err) {
                context.output.error(err instanceof Error ? err.message : String(err));
                context.setExitCode(1);
            }
        });
}

/** Report basic project and Git status. */
async function runStatusCore(
    path: string | undefined,
    options: { json?: boolean },
    context: CliContext,
): Promise<number> {
    const [packageJsonExists, spurConfigExists, git, agentSpecs] = await Promise.all([
        context.fs.exists(join(context.cwd, 'package.json')),
        context.fs.exists(join(context.cwd, '.spur', 'config.yaml')),
        gitContext(context.cwd),
        listAgentSpecIds(context),
    ]);
    const target = path === undefined ? undefined : await readTargetStatus(context, path);

    const status = {
        ok: spurConfigExists,
        packageJson: packageJsonExists,
        spurConfig: spurConfigExists,
        git,
        agentSpecs,
        ...(target === undefined ? {} : { target }),
    };

    if (options.json === true) {
        context.output.write(toJson(status));
    } else {
        context.output.write(
            [
                `Project: ${spurConfigExists ? 'ok' : 'missing .spur/config.yaml'}`,
                `Package: ${packageJsonExists ? 'ok' : 'none'}`,
                `Agents: ${agentSpecs.length === 0 ? 'none' : agentSpecs.join(', ')}`,
                `Git: ${git.root === null ? 'none' : `${git.branch ?? 'detached'}${git.dirty ? ' dirty' : ' clean'}`}`,
                ...(target === undefined ? [] : [`Path: ${target.path}\t${target.size} bytes`]),
            ].join('\n'),
        );
    }

    return status.ok ? 0 : 1;
}

/**
 * List agent spec ids found under `.spur/agents/` (file stem of each `.yaml`/`.yml`).
 * Tolerant by design: a missing directory yields an empty list and `.gitkeep` is
 * ignored, so status never fails on an un-initialized or specless project.
 */
async function listAgentSpecIds(context: CliContext): Promise<string[]> {
    const dir = join(context.cwd, '.spur', 'agents');
    if (!(await context.fs.exists(dir))) return [];
    const entries = await context.fs.readDir(dir);
    return entries
        .filter((entry) => entry.endsWith('.yaml') || entry.endsWith('.yml'))
        .map((entry) => entry.replace(/\.ya?ml$/, ''))
        .sort();
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
