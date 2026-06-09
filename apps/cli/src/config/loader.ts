/**
 * Load and validate `.spur/config.yaml` using ts-runtime's `loadStructuredConfig`.
 *
 * The config file declares `$schema: "@gobing-ai/spur-cli/schemas/spur-config.schema.json"`.
 * The schema is **statically imported** so Bun embeds it into the compiled binary
 * (`bun build --compile`) — a runtime `node_modules` lookup via `import.meta.resolve`
 * does not exist inside a standalone binary and previously failed with ENOENT. Reads of
 * the schema are served from the embedded copy through an injected `fileSystem.readFile`.
 *
 * In test mode (NODE_ENV=test), schema validation is skipped by default — temp config
 * files don't carry the `$schema` declaration. Pass `{ validateSchema: true }` to opt in.
 */
import { createNodeFileSystem, loadStructuredConfig } from '@gobing-ai/ts-runtime';
import spurConfigSchema from '../../schemas/spur-config.schema.json';

/**
 * Sentinel directory prefix for the binary-embedded Spur CLI package.
 *
 * ts-runtime resolves a bare package schema ref by calling `resolve('<pkg>/package.json')`
 * and then joining `dirname(manifest)` with the schema subpath. Returning this sentinel as
 * the manifest path makes the joined schema path start with the prefix, which the reader
 * recognizes and serves from the embedded copy. The NUL byte guarantees it never collides
 * with a real filesystem path.
 */
const EMBEDDED_PREFIX = '\0embedded-spur-cli';

/** Manifest specifier ts-runtime asks for when resolving the CLI's schema ref. */
const SPUR_CLI_MANIFEST = '@gobing-ai/spur-cli/package.json';

/** Pre-serialized embedded schema text — avoids re-stringifying on every load. */
const EMBEDDED_SCHEMA_TEXT = JSON.stringify(spurConfigSchema);

/**
 * Resolve a package-manifest specifier to a path the embedded-or-disk reader understands.
 *
 * Spur only owns and ships its own config schema, which is embedded into the binary. Any
 * other bare-package `$schema` cannot be served from a compiled binary (there is no
 * `node_modules` to resolve against), so a `node_modules` lookup would only "work" in a
 * dev tree and fail at runtime as ENOENT. We therefore reject non-spur-cli specifiers up
 * front with a clear error instead of resolving a path that does not survive packaging.
 */
function resolveSchema(specifier: string): string {
    if (specifier === SPUR_CLI_MANIFEST) return `${EMBEDDED_PREFIX}/package.json`;
    throw new Error(
        `Unsupported $schema package "${specifier.replace(/\/package\.json$/, '')}". ` +
            'Spur only resolves its own embedded schema (@gobing-ai/spur-cli); use that or a relative/absolute $schema ref.',
    );
}

/**
 * Read a file, serving the embedded Spur config schema for any path under the sentinel
 * prefix and delegating everything else (the config file itself, other schemas) to the
 * real FS.
 */
async function readEmbeddedOrDisk(path: string): Promise<string> {
    if (path.startsWith(EMBEDDED_PREFIX)) return EMBEDDED_SCHEMA_TEXT;
    return createNodeFileSystem().readFile(path);
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
        fileSystem: { readFile: readEmbeddedOrDisk },
    })) as Record<string, unknown>;
}
