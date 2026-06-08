/**
 * Load and validate `.spur/config.yaml` using ts-runtime's `loadStructuredConfig`.
 *
 * The config file declares `$schema: "@gobing-ai/spur-cli/schemas/spur-config.schema.json"`.
 * Resolution uses `import.meta.resolve` from the CLI's own module context, not from the
 * config file's directory — this ensures the schema is found regardless of where the
 * config file lives (project dir, temp dir, global ~/.config/spur/).
 *
 * In test mode (NODE_ENV=test), schema validation is skipped by default — temp config
 * files don't carry the `$schema` declaration. Pass `{ validateSchema: true }` to opt in.
 */
import { loadStructuredConfig } from '@gobing-ai/ts-runtime';

/**
 * Resolve a `$schema` package specifier from the Spur CLI install root.
 *
 * Uses `import.meta.resolve` which anchors on the CLI module's location (inside
 * the workspace `node_modules` or a global install), not the config file's cwd.
 */
function resolveSchema(specifier: string): string {
    const resolved = import.meta.resolve(specifier);
    if (!resolved) throw new Error(`Cannot resolve schema "${specifier}"`);
    return new URL(resolved).pathname;
}

/**
 * Load a Spur config file from disk with JSON Schema validation.
 *
 * By default, schema validation is enabled in production and skipped in test
 * mode. Pass `validateSchema: true` to force it on (e.g. in tests that cover
 * the resolution path).
 */
export async function loadSpurConfig(
    configPath: string,
    opts?: { validateSchema?: boolean },
): Promise<Record<string, unknown>> {
    const validateSchema = opts?.validateSchema ?? process.env.NODE_ENV !== 'test';
    return (await loadStructuredConfig(configPath, {
        validateSchema,
        resolve: (specifier, _from) => resolveSchema(specifier),
    })) as Record<string, unknown>;
}
