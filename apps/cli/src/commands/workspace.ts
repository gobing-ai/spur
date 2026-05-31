import { resolve } from 'node:path';
import { WorkspaceDao } from '@gobing-ai/spur-domain';
import { booleanFlag, stringFlag } from '../args';
import type { CliContext } from '../context';
import { CommandError } from '../errors';
import { toJson } from '../output';

/** Add a workspace binding to the local registry. */
export async function runWorkspaceAddCommand(
    context: CliContext,
    flags: Record<string, string | boolean>,
): Promise<number> {
    const name = stringFlag(flags, 'name', 'default');
    const root = resolve(context.cwd, stringFlag(flags, 'root', '.'));
    const workspace = await new WorkspaceDao(await context.getDb()).add({
        name,
        root,
        purpose: typeof flags.purpose === 'string' ? flags.purpose : undefined,
        defaultAgent: typeof flags.agent === 'string' ? flags.agent : undefined,
    });

    context.output.write(
        booleanFlag(flags, 'json') ? toJson(workspace) : `Workspace ${workspace.name}: ${workspace.root}`,
    );
    return 0;
}

/** List workspace bindings from the local registry. */
export async function runWorkspaceListCommand(
    context: CliContext,
    flags: Record<string, string | boolean>,
): Promise<number> {
    const workspaces = await new WorkspaceDao(await context.getDb()).list();
    if (booleanFlag(flags, 'json')) {
        context.output.write(toJson({ workspaces }));
        return 0;
    }

    if (workspaces.length === 0) {
        context.output.write('No workspaces registered');
        return 0;
    }

    context.output.write(workspaces.map((workspace) => `${workspace.name}\t${workspace.root}`).join('\n'));
    return 0;
}

/** Dispatch workspace subcommands. */
export async function runWorkspaceCommand(
    subcommand: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
): Promise<number> {
    if (subcommand === 'add') return runWorkspaceAddCommand(context, flags);
    if (subcommand === 'list' || subcommand === undefined) return runWorkspaceListCommand(context, flags);
    throw new CommandError(`Unknown workspace command: ${subcommand}`);
}
