import type { ActionResult, ActionRunContext, ActionRunner } from '@gobing-ai/ts-dual-workflow-engine';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { joinPath } from '@gobing-ai/ts-runtime';

const KIND = 'file.read';

/**
 * Workflow action that reads a file's utf-8 content.
 *
 * Options:
 * - `path` (string, required): path to read. Relative paths are resolved against context.workdir.
 * - `maxSize` (number): reject files larger than this many bytes before reading.
 */
export class FileReadActionRunner implements ActionRunner {
    readonly kind = KIND;

    private readonly fileSystem: FileSystem;

    constructor(fileSystem: FileSystem) {
        this.fileSystem = fileSystem;
    }

    async execute(options: Record<string, unknown>, context: ActionRunContext): Promise<ActionResult> {
        const rawPath = options.path;
        if (typeof rawPath !== 'string') {
            return { ok: false, error: 'file.read: path is required' };
        }
        const maxSize = asNumber(options.maxSize);
        const resolved = joinPath(context.workdir ?? '.', rawPath);

        const stat = await this.fileSystem.stat(resolved);
        if (stat === null) {
            return { ok: false, error: `file.read: file not found: ${resolved}` };
        }
        if (maxSize !== undefined && stat.size > maxSize) {
            return { ok: false, error: `file.read: file too large (${stat.size} > ${maxSize}): ${resolved}` };
        }

        const content = await this.fileSystem.readFile(resolved);
        return {
            ok: true,
            data: { content, size: stat.size, path: resolved },
        };
    }
}

function asNumber(value: unknown): number | undefined {
    if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
    return value;
}
