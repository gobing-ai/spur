import { join } from 'node:path';
import type { CliContext } from '../context';
import { CommandError } from '../errors';
import { gitContext } from '../git-context';
import { toJson } from '../output';

/** Report basic project and Git status. */
export async function runStatusCommand(
    context: CliContext,
    flags: Record<string, string | boolean>,
    positionals: string[] = [],
): Promise<number> {
    const targetPath = positionals[0];
    const [packageJsonExists, spurConfigExists, git] = await Promise.all([
        context.fs.exists(join(context.cwd, 'package.json')),
        context.fs.exists(join(context.cwd, '.spur', 'config.json')),
        gitContext(context.cwd),
    ]);
    const target = targetPath === undefined ? undefined : await readTargetStatus(context, targetPath);

    const status = {
        ok: packageJsonExists,
        packageJson: packageJsonExists,
        spurConfig: spurConfigExists,
        git,
        ...(target === undefined ? {} : { target }),
    };

    if (flags.json === true) {
        context.output.write(toJson(status));
    } else {
        context.output.write(
            [
                `Project: ${status.ok ? 'ok' : 'missing package.json'}`,
                `.spur: ${spurConfigExists ? 'ok' : 'missing'}`,
                `Git: ${git.root === null ? 'none' : `${git.branch ?? 'detached'}${git.dirty ? ' dirty' : ' clean'}`}`,
                ...(target === undefined ? [] : [`Path: ${target.path}\t${target.size} bytes`]),
            ].join('\n'),
        );
    }

    return status.ok ? 0 : 1;
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
