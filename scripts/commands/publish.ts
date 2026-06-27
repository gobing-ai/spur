/**
 * CI publish helper for npm Trusted Publishing (OIDC).
 *
 * Resolves `workspace:*` and `catalog:` deps to real semver ranges so
 * `npm publish --access public` accepts the manifest, then publishes.
 * is required: only the npm CLI implements the OIDC provenance handshake.
 *
 * Builds the package BEFORE calling npm publish so that bin files exist on disk
 * when npm validates them (npm ≥ 11 checks bin existence pre-lifecycle-scripts).
 */

const repoRoot = new URL('../../', import.meta.url).pathname;

async function loadJson(path: string): Promise<Record<string, unknown>> {
    return await Bun.file(path).json();
}

/** Resolve workspace/catalog ranges in `<package-dir>`, then `npm publish` it. */
export async function publish(target: string | undefined, otp?: string): Promise<void> {
    if (!target) {
        throw new Error('Usage: spur-dev publish <package-dir>');
    }

    // Resolve relative to cwd so `spur-dev publish .` works.
    const dir = target.startsWith('/') ? target : `${process.cwd()}/${target}`.replace(/\/+$/, '');
    const manifestPath = `${dir}/package.json`;
    const original = await Bun.file(manifestPath).text();
    const manifest = JSON.parse(original) as Record<string, unknown>;

    // Build name->{version, private} map from all workspace packages. `private` marks
    // packages that are never published — `bun build --target=bun` compiles them into
    // the bundle, so their `workspace:*` refs must be STRIPPED from the published
    // manifest (npm cannot resolve unpublished names) rather than version-resolved.
    const wsInfo = new Map<string, { version?: string; private: boolean }>();
    for (const wsDir of ['apps', 'packages']) {
        const glob = new Bun.Glob(`${wsDir}/*/package.json`);
        for await (const entry of glob.scan({ cwd: repoRoot, absolute: true })) {
            const pkg = await loadJson(entry);
            if (pkg.name) {
                wsInfo.set(pkg.name as string, {
                    version: pkg.version as string | undefined,
                    private: pkg.private === true,
                });
            }
        }
    }

    // Resolve workspace:* and catalog: ranges.
    const root = await loadJson(`${repoRoot}package.json`);
    const catalog =
        ((root as Record<string, unknown>).workspaces as { catalog?: Record<string, string> } | undefined)?.catalog ??
        {};

    let changed = 0;
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
        const deps = manifest[field] as Record<string, string> | undefined;
        if (!deps) continue;
        for (const [name, range] of Object.entries(deps)) {
            if (range.startsWith('workspace:')) {
                const info = wsInfo.get(name);
                if (info === undefined) throw new Error(`workspace package not found: ${name}`);
                if (info.private) {
                    // Bundled into the artifact at build time; not resolvable from npm.
                    delete deps[name];
                    changed++;
                } else {
                    if (!info.version) throw new Error(`workspace package has no version: ${name}`);
                    deps[name] = `^${info.version}`;
                    changed++;
                }
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

    // Build before npm publish so bin files exist when npm validates them.
    // npm ≥ 11 checks bin file existence BEFORE running prepublishOnly, so
    // relying on the lifecycle hook alone causes npm to strip the bin entry.
    const build = Bun.spawnSync(['bun', 'run', 'build:bundle'], {
        cwd: dir,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (build.exitCode !== 0) {
        // Restore original manifest before throwing on build failure.
        if (changed > 0) await Bun.write(manifestPath, original);
        console.error(build.stderr.toString().trim());
        throw new Error(`build:bundle failed (exit ${build.exitCode})`);
    }

    const publishArgs = ['npm', 'publish', '--access', 'public'];
    if (otp) publishArgs.push('--otp', otp);
    const result = Bun.spawnSync(publishArgs, {
        cwd: dir,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = [result.stdout.toString(), result.stderr.toString()].filter(Boolean).join('\n').trim();
    console.log(output);

    // Restore original manifest before potentially throwing.
    if (changed > 0) {
        await Bun.write(manifestPath, original);
    }

    if (result.exitCode !== 0) throw new Error(`npm publish failed (exit ${result.exitCode})`);
}
