import { join } from 'node:path';
import type { CliContext } from '../context';
import { CommandError } from '../errors';
import { gitContext } from '../git-context';
import { toJson } from '../output';

/** Render detailed usage for `spur status`. */
export function helpText(): string {
    return [
        'spur status - show project, Git, and optional path status',
        '',
        'Usage: spur status [path] [options]',
        '',
        'Options:',
        '  --json             Output machine-readable JSON',
        '  -h, --help         Show this help',
        '',
        'Examples:',
        '  spur status',
        '  spur status package.json',
        '  spur status --json',
    ].join('\n');
}

/** Report basic project and Git status. */
export async function runStatusCommand(
    context: CliContext,
    flags: Record<string, string | boolean>,
    positionals: string[] = [],
): Promise<number> {
    const targetPath = positionals[0];
    const [packageJsonExists, spurConfigExists, git, agentSpecs] = await Promise.all([
        context.fs.exists(join(context.cwd, 'package.json')),
        context.fs.exists(join(context.cwd, '.spur', 'config.json')),
        gitContext(context.cwd),
        listAgentSpecIds(context),
    ]);
    const target = targetPath === undefined ? undefined : await readTargetStatus(context, targetPath);

    const status = {
        ok: packageJsonExists,
        packageJson: packageJsonExists,
        spurConfig: spurConfigExists,
        git,
        agentSpecs,
        ...(target === undefined ? {} : { target }),
    };

    if (flags.json === true) {
        context.output.write(toJson(status));
    } else {
        context.output.write(
            [
                `Project: ${status.ok ? 'ok' : 'missing package.json'}`,
                `.spur: ${spurConfigExists ? 'ok' : 'missing'}`,
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
    path: string,
): Promise<{
    path: string;
    size: number;
    isFile: boolean;
    isDirectory: boolean;
}> {
    const resolved = join(context.cwd, path);
    const stat = await context.fs.stat(resolved);
    if (stat === null) throw new CommandError(`status failed: path does not exist at ${resolved}`);
    return { path, size: stat.size, isFile: stat.isFile(), isDirectory: stat.isDirectory() };
}
