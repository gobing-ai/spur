/**
 * Verify the packed @gobing-ai/spur tarball ships the sp plugin + marketplace
 * (task 0500 AC3). Extract-only verification — never certifies by inspecting the
 * monorepo tree or a bun-link symlink.
 *
 * Usage: spur-dev verify-pack <path-to-.tgz>
 *
 * Asserts:
 *  - <extract>/package/plugins/sp/plugin.json and
 *    <extract>/package/.claude-plugin/marketplace.json exist;
 *  - marketplace.json plugin is name "sp", source "./plugins/sp";
 *  - plugin.json + marketplace.json versions equal apps/cli/package.json version;
 *  - no tests/ dir and no *.test.ts anywhere under <extract>/package/plugins.
 */
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;

interface Marketplace {
    plugins?: Array<{ name?: string; version?: string; source?: string }>;
}

/** Parse JSON, failing with a clear path-bearing message on malformed input. */
function parseJson<T>(text: string, label: string): T {
    try {
        return JSON.parse(text) as T;
    } catch (error) {
        throw new Error(
            `verify-pack: ${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

async function listFiles(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await listFiles(full)));
        else out.push(full.replace(/\\/g, '/'));
    }
    return out;
}

/** Assert AC3 invariants against an extracted package root. Throws on violation. */
export async function verifyPackExtract(extractRoot: string): Promise<void> {
    const pkg = join(extractRoot, 'package');
    const pluginJson = join(pkg, 'plugins/sp/plugin.json');
    const marketplaceJson = join(pkg, '.claude-plugin/marketplace.json');
    const pkgVersion = (
        parseJson(await readFile(join(REPO_ROOT, 'apps/cli/package.json'), 'utf-8'), 'apps/cli/package.json') as {
            version?: string;
        }
    ).version;

    await readFile(pluginJson, 'utf-8'); // throws if missing
    const marketplace = parseJson<Marketplace>(await readFile(marketplaceJson, 'utf-8'), marketplaceJson);

    const plugin = parseJson<{ version?: string }>(await readFile(pluginJson, 'utf-8'), pluginJson);
    if (plugin.version !== pkgVersion) {
        throw new Error(`plugin.json version ${plugin.version} != package ${pkgVersion}`);
    }
    const entry = marketplace.plugins?.[0];
    if (entry?.name !== 'sp' || entry.source !== './plugins/sp') {
        throw new Error(`marketplace entry mismatch: ${JSON.stringify(entry)}`);
    }
    if (entry.version !== pkgVersion) {
        throw new Error(`marketplace version ${entry.version} != package ${pkgVersion}`);
    }

    const files = await listFiles(join(pkg, 'plugins'));
    const rel = files.map((f) => f.slice(join(pkg, 'plugins').length + 1));
    if (
        rel.some(
            (f) => f.includes('/tests/') || f.startsWith('tests/') || f.endsWith('.test.ts') || f.includes('/evals/'),
        )
    ) {
        throw new Error(
            `pruned content found in packed plugins: ${rel.filter((f) => /tests|\/evals\/|\.test\.ts/.test(f)).join(', ')}`,
        );
    }
}

/** Extract a tarball to a temp dir and run AC3 assertions. Exit non-zero on failure. */
export async function verifyPack(tarball: string): Promise<number> {
    const extractRoot = await mkdtemp(join(tmpdir(), 'spur-verify-'));
    try {
        const run = Bun.spawnSync(['tar', '-xzf', tarball, '-C', extractRoot]);
        if (run.exitCode !== 0) throw new Error(`tar extract failed: ${run.stderr?.toString()}`);
        await verifyPackExtract(extractRoot);
        console.log(
            `verify-pack: OK — ${tarball} ships sp plugin + marketplace (versions match, no test/evals content)`,
        );
        return 0;
    } catch (error) {
        console.error(`verify-pack: FAIL — ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    } finally {
        await rm(extractRoot, { recursive: true, force: true });
    }
}
