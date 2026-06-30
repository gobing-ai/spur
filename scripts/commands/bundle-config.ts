/**
 * Copy the repo-root `config/` tree into a package's bundled config dir for the
 * npm tarball, excluding test fixtures and OS junk, then inject `$schema`
 * directives so end users get IDE validation via the published schemas.
 *
 * Source config files MAY already carry a `$schema` directive — those are
 * left untouched. Files without one get an unquoted `$schema:` prepended so
 * end-user IDE validation resolves against the schemas shipped with the CLI.
 */
import { cp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const SOURCE = new URL('../../config', import.meta.url).pathname;

// Skip anything that is not a shippable config asset. `cp`'s filter runs per
// entry: returning false prunes the entry (and, for a directory, its subtree).
const EXCLUDE = /(^|\/)(\.DS_Store|fixtures)($|\/)/;

/** Bundle `config/` into `target`, excluding fixtures and OS junk, then inject `$schema`. */
export async function bundleConfig(target: string | undefined): Promise<{ target: string; injected: number }> {
    if (!target) {
        throw new Error('Usage: spur-dev bundle-config <dist-config-dir>');
    }
    await rm(target, { recursive: true, force: true });
    await cp(SOURCE, target, {
        recursive: true,
        filter: (src) => !EXCLUDE.test(src.slice(SOURCE.length)),
    });

    // Inject $schema directives so end-user IDE validation resolves against
    // the schemas shipped alongside the CLI in the npm package. Files that
    // already carry a $schema directive are skipped to avoid duplicate keys.
    const injected = await injectSchemas(target, '');

    return { target, injected };
}

const SCHEMA_PREFIX = '@gobing-ai/spur/schemas/';

/** Map a YAML file path (relative to config root) to its $schema specifier. */
function schemaFor(relPath: string): string | null {
    if (basename(relPath) === 'config.example.yaml') return null; // already has $schema
    if (relPath.startsWith('workflows/')) return `${SCHEMA_PREFIX}state-machine-workflow.schema.json`;
    // Presets are at the rules/ root; rule files live in category subdirs.
    if (dirname(relPath) === 'rules') return `${SCHEMA_PREFIX}preset.schema.json`;
    if (relPath.startsWith('rules/')) return `${SCHEMA_PREFIX}rule-file.schema.json`;
    return null;
}

async function injectSchemas(dir: string, relPrefix: string): Promise<number> {
    let count = 0;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            count += await injectSchemas(full, rel);
        } else if (entry.name.endsWith('.yaml')) {
            const schema = schemaFor(rel);
            if (schema) {
                const content = await readFile(full, 'utf-8');
                // Skip files that already carry a $schema directive (quoted or
                // unquoted) — duplicating it produces a "Map keys must be
                // unique" YAMLParseError in every bundled workflow that has one.
                if (/^\s*(?:\$schema|"\$schema")\s*:/m.test(content)) continue;
                await writeFile(full, `$schema: "${schema}"\n${content}`);
                count++;
            }
        }
    }
    return count;
}
