#!/usr/bin/env bun
/**
 * CI publish helper for npm Trusted Publishing (OIDC).
 *
 * Resolves `workspace:*` and `catalog:` deps to real semver ranges so
 * `npm publish --access public` accepts the manifest, then publishes.
 * The original package.json is restored afterward.
 *
 * Usage (from inside the package directory):
 *   bun ../../scripts/ci-publish.ts .
 */

const repoRoot = new URL('../', import.meta.url).pathname;

async function loadJson(path: string): Promise<Record<string, unknown>> {
    return await Bun.file(path).json();
}

const target = process.argv[2];
if (!target) {
    console.error('Usage: bun scripts/ci-publish.ts <package-dir>');
    process.exit(1);
}

// Resolve relative to cwd so `bun scripts/ci-publish.ts .` works.
const dir = target.startsWith('/') ? target : `${process.cwd()}/${target}`.replace(/\/+$/, '');
const manifestPath = `${dir}/package.json`;
const original = await Bun.file(manifestPath).text();
const manifest = JSON.parse(original) as Record<string, unknown>;

// Build a name->version map from all workspace packages.
const wsVersions = new Map<string, string>();
for (const wsDir of ['apps', 'packages']) {
    const glob = new Bun.Glob(`${wsDir}/*/package.json`);
    for await (const entry of glob.scan({ cwd: repoRoot, absolute: true })) {
        const pkg = await loadJson(entry);
        if (pkg.name) wsVersions.set(pkg.name as string, pkg.version as string);
    }
}

// Resolve workspace:* and catalog: ranges.
const root = await loadJson(`${repoRoot}package.json`);
const catalog =
    ((root as Record<string, unknown>).workspaces as { catalog?: Record<string, string> } | undefined)?.catalog ?? {};

let changed = 0;
for (const field of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    const deps = manifest[field] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
        if (range.startsWith('workspace:')) {
            const version = wsVersions.get(name);
            if (!version) throw new Error(`workspace package not found: ${name}`);
            deps[name] = `^${version}`;
            changed++;
        } else if (range === 'catalog:' && catalog[name]) {
            deps[name] = catalog[name];
            changed++;
        }
    }
}

if (changed > 0) {
    await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
    console.log(`Resolved ${changed} workspace/catalog range(s)`);
}

const result = Bun.spawnSync(['npm', 'publish', '--access', 'public'], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
});
const output = [result.stdout.toString(), result.stderr.toString()].filter(Boolean).join('\n').trim();
console.log(output);

// Restore original manifest before potentially exiting.
if (changed > 0) {
    await Bun.write(manifestPath, original);
}

if (result.exitCode !== 0) process.exit(result.exitCode);
