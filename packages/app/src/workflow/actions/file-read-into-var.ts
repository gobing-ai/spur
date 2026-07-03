import type { ActionResult, ActionRunContext, ActionRunner } from '@gobing-ai/ts-dual-workflow-engine';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { joinPath } from '@gobing-ai/ts-runtime';

const KIND = 'file.read.into-var';

/**
 * Read a file's utf-8 content and project it into a workflow var via `setVars`.
 *
 * Options:
 * - `path` (string, required): path to read. Relative paths resolve against
 *   `context.workdir`. The path is resolved once at execution time; the resolved
 *   absolute path is included in the action result for traceability.
 * - `var` (string, required): destination var name. The trimmed file content is
 *   written into `setVars[var]`; downstream transitions and notes can reference it
 *   via `${vars.<var>}`. The var name is validated against `[A-Za-z_][A-Za-z0-9_]*`
 *   to match the engine's `vars` schema (the workflow must declare it in `vars:` or
 *   `${vars.X}` resolution throws at runtime).
 * - `trim` (boolean, default `true`): strip trailing newlines / whitespace from the
 *   read content before projecting into the var. The raw content is still returned
 *   in `data.content` for inspection. Disable when the file's trailing newline is
 *   semantically meaningful.
 *
 * Why this action exists: the engine's `resolveTemplates` substitutes only
 * `${vars.X}` and `${env.X}` in note/prompt/guard strings — it does not run a shell
 * inside the template. Workflows that need to interpolate a file's content (e.g.
 * a feature id written to `.spur/run/idea-feature-id.txt`) had to embed the literal
 * `$(cat ...)` shell substitution, which the engine renders verbatim and is the
 * bug behind 0177 R4. This action reads the file once at execution time and projects
 * the value into a var so `${vars.<var>}` substitutes correctly.
 */
export class FileReadIntoVarActionRunner implements ActionRunner {
    readonly kind = KIND;

    constructor(private readonly fileSystem: FileSystem) {}

    async execute(options: Record<string, unknown>, context: ActionRunContext): Promise<ActionResult> {
        const rawPath = options.path;
        if (typeof rawPath !== 'string' || rawPath === '') {
            return { ok: false, error: 'file.read.into-var: path is required' };
        }
        const varName = options.var;
        if (typeof varName !== 'string' || varName === '') {
            return { ok: false, error: 'file.read.into-var: var is required' };
        }
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) {
            return {
                ok: false,
                error: `file.read.into-var: var name must match /^[A-Za-z_][A-Za-z0-9_]*$/, got "${varName}"`,
            };
        }
        const trim = options.trim === undefined ? true : options.trim !== false;

        const resolved = joinPath(context.workdir ?? '.', rawPath);
        const stat = await this.fileSystem.stat(resolved);
        if (stat === null) {
            return { ok: false, error: `file.read.into-var: file not found: ${resolved}` };
        }

        const raw = await this.fileSystem.readFile(resolved);
        const projected = trim ? raw.replace(/\s+$/u, '') : raw;

        return {
            ok: true,
            data: { content: projected, raw, var: varName, path: resolved, size: stat.size },
            setVars: { [varName]: projected },
        };
    }
}
