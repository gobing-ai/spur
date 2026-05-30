import { join } from 'node:path';
import type { CliContext } from '../context';
import { CommandError } from '../errors';
import { toJson } from '../output';

/** Inspect a local file and report basic metadata. */
export async function runInspectCommand(
    context: CliContext,
    flags: Record<string, string | boolean>,
    positionals: string[],
): Promise<number> {
    const path = positionals[0];
    if (path === undefined) throw new CommandError('inspect requires a file path');

    const resolved = join(context.cwd, path);
    const stat = await context.fs.stat(resolved);
    if (stat === null) throw new CommandError(`inspect failed: file does not exist at ${resolved}`);

    const result = { path, size: stat.size, isFile: stat.isFile(), isDirectory: stat.isDirectory() };
    context.output.write(flags.json === true ? toJson(result) : `${path}\t${stat.size} bytes`);
    return 0;
}
