import type { ActionResult, ActionRunContext, ActionRunner } from '@gobing-ai/ts-dual-workflow-engine';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { joinPath } from '@gobing-ai/ts-runtime';

const KIND = 'file.exists';

/**
 * Workflow action that checks whether a file exists.
 *
 * Options:
 * - `path` (string, required): path to check. Relative paths are resolved against context.workdir.
 * - `negate` (boolean): when true, ok = file does NOT exist; defaults to false.
 */
export class FileExistsActionRunner implements ActionRunner {
    readonly kind = KIND;

    private readonly fileSystem: FileSystem;

    constructor(fileSystem: FileSystem) {
        this.fileSystem = fileSystem;
    }

    async execute(options: Record<string, unknown>, context: ActionRunContext): Promise<ActionResult> {
        const rawPath = options.path;
        if (typeof rawPath !== 'string') {
            return { ok: false, error: 'file.exists: path is required' };
        }
        const negate = asBoolean(options.negate) ?? false;
        const resolved = joinPath(context.workdir ?? '.', rawPath);

        const exists = await this.fileSystem.exists(resolved);
        const ok = negate ? !exists : exists;

        return {
            ok,
            data: { exists, path: resolved },
            error: ok ? undefined : `file.exists: ${exists ? 'file exists (negated)' : 'file not found'}: ${resolved}`,
        };
    }
}

function asBoolean(value: unknown): boolean | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
}
