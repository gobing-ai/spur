import { join } from 'node:path';
import { WorkspaceDao } from '@gobing-ai/spur-domain';
import type { CliContext } from '../context';
import { gitContext } from '../git-context';
import { toJson } from '../output';

/** Report basic project, Git, and workspace registry status. */
export async function runStatusCommand(context: CliContext, flags: Record<string, string | boolean>): Promise<number> {
    const [packageJsonExists, spurConfigExists, git] = await Promise.all([
        context.fs.exists(join(context.cwd, 'package.json')),
        context.fs.exists(join(context.cwd, '.spur', 'config.json')),
        gitContext(context.cwd),
    ]);
    const workspaces = await new WorkspaceDao(await context.getDb()).list();

    const status = {
        ok: packageJsonExists,
        packageJson: packageJsonExists,
        spurConfig: spurConfigExists,
        git,
        workspaces: workspaces.length,
    };

    if (flags.json === true) {
        context.output.write(toJson(status));
    } else {
        context.output.write(
            [
                `Project: ${status.ok ? 'ok' : 'missing package.json'}`,
                `.spur: ${spurConfigExists ? 'ok' : 'missing'}`,
                `Git: ${git.root === null ? 'none' : `${git.branch ?? 'detached'}${git.dirty ? ' dirty' : ' clean'}`}`,
                `Workspaces: ${workspaces.length}`,
            ].join('\n'),
        );
    }

    return status.ok ? 0 : 1;
}
