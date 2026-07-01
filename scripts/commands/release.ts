import { fileURLToPath } from 'node:url';

/**
 * Multi-package release helper, aligned with the ts-libs release UX
 * (`bump-ver` / `drop-tags` + a tag→CI→npm-Trusted-Publishing flow).
 * `RELEASE_PACKAGES`. The published CLI is a self-contained bundle with
 * zero runtime dependencies, so its bundled internal deps (spur-config,
 * spur-domain) never reach the registry.
 */

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

interface ReleaseConfig {
    packageDir: string;
    packageName: string;
    /** Optional source file whose version constant must be rewritten alongside package.json. */
    versionSourceFile?: string;
    tagVersionSeparator: string;
    publishWorkflow: string;
    releaseCommitType: string;
    releaseCommitScope: string;
    releaseCommitSubject: (version: string) => string;
    releaseTagMessage: (tag: string) => string;
    ghRunListLimit: number;
}

const RELEASE_PACKAGES = {
    spur: {
        packageDir: 'apps/cli',
        packageName: '@gobing-ai/spur',
        versionSourceFile: 'apps/cli/src/config.ts',
        tagVersionSeparator: '-v',
        publishWorkflow: 'publish.yml',
        releaseCommitType: 'chore',
        releaseCommitScope: 'release',
        releaseCommitSubject: (version: string) => `bump spur to ${version}`,
        releaseTagMessage: (tag: string) => `release: ${tag}`,
        ghRunListLimit: 5,
    },
} as const satisfies Record<string, ReleaseConfig>;

/** Packages bumped together by the aggregate (`--all`) release path. */
const ALL_RELEASE_PACKAGES: readonly ReleaseConfig[] = [RELEASE_PACKAGES.spur];

type PackageId = keyof typeof RELEASE_PACKAGES;

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

/** The git tag that, when pushed, triggers the Publish workflow. */
function releaseTag(config: ReleaseConfig, version: string): string {
    return `${config.packageName}${config.tagVersionSeparator}${version}`;
}

/** Run a command synchronously, capturing stdout; never throws (caller checks `ok`). */
function run(cmd: string[]): { ok: boolean; stdout: string; stderr: string } {
    const result = Bun.spawnSync(cmd, { cwd: repoRoot });
    return {
        ok: result.exitCode === 0,
        stdout: result.stdout.toString().trim(),
        stderr: result.stderr.toString().trim(),
    };
}

/** Run git and return trimmed stdout; throws with context on failure. */
function git(args: string[]): string {
    const result = run(['git', ...args]);
    if (!result.ok) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
    }
    return result.stdout;
}

/** True if `name@version` is already on the npm registry (so we never re-tag a published version). */
function npmViewVersion(name: string, version: string): boolean {
    const result = run(['npm', 'view', `${name}@${version}`, 'version']);
    return result.ok && result.stdout === version;
}

/**
 * Scan every workspace package.json for `"<pkgName>": "workspace:<oldVersion>"`
 * and rewrite to `"workspace:<newVersion>"`. Returns the relative paths
 * of any manifest files that were changed (already written to disk).
 */
async function updateWorkspacePins(pkgName: string, oldVersion: string, newVersion: string): Promise<string[]> {
    const changed: string[] = [];
    // Resolve via git to stay fast and .gitignore-aware.
    const files = git(['ls-files', 'apps/*/package.json', 'packages/*/package.json'])
        .split('\n')
        .filter((f) => f.length > 0);

    for (const file of files) {
        const manifest = await Bun.file(`${repoRoot}${file}`).json();
        let dirty = false;
        const pin = `workspace:${oldVersion}`;
        for (const field of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
            const deps = manifest[field] as Record<string, string> | undefined;
            if (deps?.[pkgName] === pin) {
                deps[pkgName] = `workspace:${newVersion}`;
                dirty = true;
            }
        }
        if (dirty) {
            await Bun.write(`${repoRoot}${file}`, `${JSON.stringify(manifest, null, 4)}\n`);
            console.log(`  ↳ ${file}: ${pkgName} workspace pin ${oldVersion} → ${newVersion}`);
            changed.push(file);
        }
    }
    return changed;
}

/**
 * Rewrite the `binaryVersion` string literal in a source file so the compiled
 * binary carries the correct version without runtime package.json reads.
 * Returns `true` when the file was actually modified.
 */
async function updateVersionSourceFile(filePath: string, previous: string, next: string): Promise<boolean> {
    const absPath = `${repoRoot}${filePath}`;
    const content = await Bun.file(absPath).text();
    // Match: binaryVersion: 'x.y.z' or binaryVersion: "x.y.z"
    const updated = content.replace(
        /(binaryVersion:\s*['"])\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?(['"])/,
        `$1${next}$2`,
    );
    if (updated === content) {
        console.warn(`  ⚠ ${filePath}: binaryVersion pattern not found (expected ${previous})`);
        return false;
    }
    await Bun.write(absPath, updated);
    console.log(`  ↳ ${filePath}: binaryVersion ${previous} → ${next}`);
    return true;
}

/**
 * Sync `.claude-plugin/marketplace.json` and each listed plugin's `plugin.json`
 * to `version` so the `sp` plugin version stays in lockstep with the spur CLI
 * release (the plugin ships alongside the CLI, not independently — ADR-022).
 * Appends the relative paths of any changed files to `staged`.
 */
async function syncMarketplaceAndPlugins(version: string, staged: string[]): Promise<void> {
    const marketplacePath = `${repoRoot}.claude-plugin/marketplace.json`;
    const marketplaceFile = Bun.file(marketplacePath);
    if (!(await marketplaceFile.exists())) return;

    const marketplace = (await marketplaceFile.json()) as {
        plugins?: Array<{ name: string; version: string; source: string }>;
    };
    const plugins = marketplace.plugins ?? [];
    let mpUpdated = false;
    for (const entry of plugins) {
        if (entry.version !== version) {
            entry.version = version;
            mpUpdated = true;
        }
    }
    if (mpUpdated) {
        await Bun.write(marketplacePath, `${JSON.stringify(marketplace, null, 4)}\n`);
        staged.push('.claude-plugin/marketplace.json');
        console.log(`Bumped marketplace plugins to ${version}`);
    }

    // Update each plugin's own plugin.json manifest.
    for (const entry of plugins) {
        const pluginJsonPath = `${repoRoot}${entry.source}/plugin.json`;
        const pluginJsonFile = Bun.file(pluginJsonPath);
        if (!(await pluginJsonFile.exists())) {
            console.warn(`  ⚠ plugin.json not found at ${entry.source}/plugin.json — skipping`);
            continue;
        }
        const pluginJson = (await pluginJsonFile.json()) as { name: string; version: string };
        if (pluginJson.version !== version) {
            pluginJson.version = version;
            await Bun.write(pluginJsonPath, `${JSON.stringify(pluginJson, null, 4)}\n`);
            staged.push(`${entry.source}/plugin.json`);
            console.log(`Bumped ${entry.source}/plugin.json to ${version}`);
        }
    }
}

function assertCleanTreeOnBranch(): string {
    if (git(['status', '--porcelain']) !== '') {
        throw new Error('working tree is not clean. Commit or stash changes before releasing.');
    }
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch === 'HEAD') {
        throw new Error('detached HEAD — checkout a branch before releasing.');
    }
    return branch;
}

function assertTagFree(config: ReleaseConfig, tag: string, version: string): void {
    const localTags = new Set(git(['tag', '-l']).split('\n').filter(Boolean));
    if (localTags.has(tag)) {
        const id = Object.keys(RELEASE_PACKAGES).find((k) => RELEASE_PACKAGES[k] === config);
        throw new Error(`tag already exists locally: ${tag}. Run "bun run drop-tags ${id} ${version}" first.`);
    }
    // Remote clash is best-effort: a missing/unreachable origin must not block a
    // release (the push step would surface a genuine remote problem anyway).
    const remote = run(['git', 'ls-remote', '--tags', 'origin']);
    if (remote.ok && remote.stdout.includes(`refs/tags/${tag}`)) {
        const id = Object.keys(RELEASE_PACKAGES).find((k) => RELEASE_PACKAGES[k] === config);
        throw new Error(
            `tag already exists on origin: ${tag}. Run "bun run drop-tags ${id} ${version} --remote" first.`,
        );
    }
    if (!remote.ok) {
        console.warn('warning: could not check origin for tag clashes (remote unreachable); continuing.');
    }
}

async function bumpVersion(config: ReleaseConfig, version: string, options: { push: boolean }): Promise<void> {
    if (!SEMVER.test(version)) {
        throw new Error(`"${version}" is not a valid semver version (expected e.g. 0.1.4).`);
    }

    const tag = releaseTag(config, version);
    const branch = assertCleanTreeOnBranch();
    assertTagFree(config, tag, version);

    if (npmViewVersion(config.packageName, version)) {
        throw new Error(`${config.packageName}@${version} is already published on npm. Use a new version.`);
    }
    const manifestPath = `${repoRoot}${config.packageDir}/package.json`;
    const manifest = await Bun.file(manifestPath).json();
    const previous: string = manifest.version;
    manifest.version = version;
    await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
    console.log(`${config.packageName}: ${previous} -> ${version}`);

    const staged = [`${config.packageDir}/package.json`];
    // Update in-source version constant (e.g. binaryVersion in config.ts) for compiled binaries.
    if (config.versionSourceFile) {
        const updated = await updateVersionSourceFile(config.versionSourceFile, previous, version);
        if (updated) staged.push(config.versionSourceFile);
    }
    // Cascade workspace pin updates for consumers of this package.
    const pinChanges = await updateWorkspacePins(config.packageName, previous, version);
    staged.push(...pinChanges);
    await syncMarketplaceAndPlugins(version, staged);
    if (Bun.file(`${repoRoot}bun.lock`).size > 0) staged.push('bun.lock');
    git(['add', ...staged]);

    const message = `${config.releaseCommitType}(${config.releaseCommitScope}): ${config.releaseCommitSubject(version)}`;
    git(['commit', '-m', message]);
    console.log(`Committed: ${message}`);

    git(['tag', '-a', tag, '-m', config.releaseTagMessage(tag)]);
    console.log(`Tagged: ${tag}`);

    if (!options.push) {
        console.log('\nDone (local). Review, then push to release:');
        console.log(`  git push origin ${branch}`);
        console.log(`  git push origin ${tag}`);
        console.log('Or re-run with --push next time to do this automatically.');
        return;
    }

    console.log(`\nPushing branch ${branch} (tags excluded)...`);
    git(['push', 'origin', branch]);
    console.log(`Pushing release trigger tag ${tag}...`);
    git(['push', 'origin', tag]);

    console.log(`\nReleased ${version}. The Publish workflow should now be running:`);
    console.log(`  gh run list --workflow=${config.publishWorkflow} --limit ${config.ghRunListLimit}`);
}

async function bumpAll(version: string, options: { push: boolean }): Promise<void> {
    if (!SEMVER.test(version)) {
        throw new Error(`"${version}" is not a valid semver version (expected e.g. 0.1.4).`);
    }

    const branch = assertCleanTreeOnBranch();
    const configs = ALL_RELEASE_PACKAGES;
    const aggregateTag = `@gobing-ai/spur-v${version}`;

    // Pre-flight: check all tags (aggregate + per-package) and npm before touching any file.
    const existingLocal = new Set(git(['tag', '-l']).split('\n').filter(Boolean));
    const allTags = [aggregateTag, ...configs.map((c) => releaseTag(c, version))];
    for (const tag of allTags) {
        if (existingLocal.has(tag)) throw new Error(`tag already exists locally: ${tag}`);
    }
    const remoteRefs = git(['ls-remote', '--tags', 'origin']);
    for (const tag of allTags) {
        if (remoteRefs.includes(`refs/tags/${tag}`)) {
            throw new Error(
                `tag already exists on origin: ${tag}. Run "bun run drop-tags --all ${version} --remote" first.`,
            );
        }
    }
    for (const config of configs) {
        if (npmViewVersion(config.packageName, version)) {
            throw new Error(`${config.packageName}@${version} is already published on npm. Use a new version.`);
        }
    }

    // Bump all manifests in one pass.
    const staged: string[] = [];
    for (const config of configs) {
        const manifestPath = `${repoRoot}${config.packageDir}/package.json`;
        const manifest = await Bun.file(manifestPath).json();
        const previous: string = manifest.version;
        manifest.version = version;
        await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
        console.log(`${config.packageName}: ${previous} -> ${version}`);
        staged.push(`${config.packageDir}/package.json`);
        if (config.versionSourceFile) {
            const updated = await updateVersionSourceFile(config.versionSourceFile, previous, version);
            if (updated) staged.push(config.versionSourceFile);
        }
        const pinChanges = await updateWorkspacePins(config.packageName, previous, version);
        staged.push(...pinChanges);
    }

    await syncMarketplaceAndPlugins(version, staged);

    if (Bun.file(`${repoRoot}bun.lock`).size > 0) staged.push('bun.lock');
    git(['add', ...staged]);

    const shortNames = configs.map((c) => c.packageName.replace('@gobing-ai/', '')).join(' + ');
    const message = `chore(release): bump ${shortNames} to ${version}`;
    git(['commit', '-m', message]);
    console.log(`Committed: ${message}`);

    // Per-package tags for traceability + aggregate tag to trigger publish.
    for (const config of configs) {
        const tag = releaseTag(config, version);
        if (tag !== aggregateTag) {
            git(['tag', '-a', tag, '-m', config.releaseTagMessage(tag)]);
            console.log(`Tagged (trace): ${tag}`);
        }
    }
    git(['tag', '-a', aggregateTag, '-m', `Spur ${version} — ${shortNames}`]);
    console.log(`Tagged (publish): ${aggregateTag}`);

    if (!options.push) {
        console.log('\nDone (local). Review, then push to release:');
        console.log(`  git push origin ${branch}`);
        console.log(`  git push origin ${aggregateTag}`);
        console.log('Or re-run with --push next time to do this automatically.');
        return;
    }

    console.log(`\nPushing branch ${branch} (tags excluded)...`);
    git(['push', 'origin', branch]);
    console.log(`Pushing release trigger tag ${aggregateTag}...`);
    git(['push', 'origin', aggregateTag]);

    console.log(`\nReleased ${version}. The Publish workflow should now be running:`);
    console.log(`  gh run list --workflow=publish.yml --limit 3`);
}

async function dropTagsFor(config: ReleaseConfig, version: string, options: { remote: boolean }): Promise<void> {
    if (!SEMVER.test(version)) {
        throw new Error(`"${version}" is not a valid semver version (expected e.g. 0.1.2).`);
    }
    const tag = releaseTag(config, version);

    const localTags = new Set(git(['tag', '-l']).split('\n').filter(Boolean));
    if (localTags.has(tag)) {
        git(['tag', '-d', tag]);
        console.log(`Deleted local tag ${tag}`);
    } else {
        console.log(`No local tag ${tag}`);
    }

    if (options.remote) {
        const result = run(['git', 'push', 'origin', `:refs/tags/${tag}`]);
        console.log(result.ok ? `Deleted remote tag ${tag}` : `Remote tag ${tag} not present or already removed`);
    }
}

async function dropAll(version: string, options: { remote: boolean }): Promise<void> {
    if (!SEMVER.test(version)) {
        throw new Error(`"${version}" is not a valid semver version (expected e.g. 0.1.2).`);
    }
    for (const config of ALL_RELEASE_PACKAGES) {
        await dropTagsFor(config, version, options);
    }
    // Also drop the aggregate tag.
    const aggregateTag = `@gobing-ai/spur-v${version}`;
    const localTags = new Set(git(['tag', '-l']).split('\n').filter(Boolean));
    if (localTags.has(aggregateTag)) {
        git(['tag', '-d', aggregateTag]);
        console.log(`Deleted local tag ${aggregateTag}`);
    }
    if (options.remote) {
        const result = run(['git', 'push', 'origin', `:refs/tags/${aggregateTag}`]);
        console.log(
            result.ok
                ? `Deleted remote tag ${aggregateTag}`
                : `Remote tag ${aggregateTag} not present or already removed`,
        );
    }
}

function releaseUsage(message?: string): never {
    if (message) console.error(`error: ${message}\n`);
    const ids = Object.keys(RELEASE_PACKAGES).join(', ');
    console.error('Usage:');
    console.error(
        `  bun run bump-ver <package-id> <version> [--push]    bump one package, commit, tag, optionally push`,
    );
    console.error(`  bun run bump-ver --all <version> [--push]              bump all packages in one commit + tags`);
    console.error(`  bun run drop-tags <package-id> <version> [--remote] delete one package's release tag`);
    console.error(`  bun run drop-tags --all <version> [--remote]              delete all packages' release tags`);
    console.error(`\nPackage IDs: ${ids}`);
    process.exit(message ? 1 : 0);
}

/**
 * Entry for `spur-dev bump-ver ...` — bump one package or all, commit, tag, optionally push.
 * "All packages" is the default: a bare `bump-ver <version>` (single positional that parses
 * as semver, or explicit `--all`) bumps every package. The two-arg `bump-ver <pkg> <version>`
 * form scopes to one package.
 */
export async function bumpVer(args: string[]): Promise<void> {
    const positional = args.filter((arg) => !arg.startsWith('--'));
    if (args.includes('--all') || (positional.length === 1 && SEMVER.test(positional[0] ?? ''))) {
        const allVersion = positional[0];
        if (!allVersion) releaseUsage('bump-ver [--all] <version> [--push]');
        await bumpAll(allVersion, { push: args.includes('--push') });
        return;
    }
    const packageId = positional[0] as PackageId | undefined;
    const version = positional[1];
    if (!packageId || !version) releaseUsage('bump-ver <version> | bump-ver <package-id> <version> [--push]');
    if (!(packageId in RELEASE_PACKAGES)) releaseUsage(`unknown package "${packageId}"`);
    await bumpVersion(RELEASE_PACKAGES[packageId], version, { push: args.includes('--push') });
}

/**
 * Entry for `spur-dev drop-tags ...` — delete one package's release tag or all.
 * Mirrors `bumpVer`: a bare `drop-tags <version>` drops every package's tag (plus the
 * aggregate); `drop-tags <pkg> <version>` scopes to one.
 */
export async function dropTags(args: string[]): Promise<void> {
    const positional = args.filter((arg) => !arg.startsWith('--'));
    if (args.includes('--all') || (positional.length === 1 && SEMVER.test(positional[0] ?? ''))) {
        const allVersion = positional[0];
        if (!allVersion) releaseUsage('drop-tags [--all] <version> [--remote]');
        await dropAll(allVersion, { remote: args.includes('--remote') });
        return;
    }
    const packageId = positional[0] as PackageId | undefined;
    const version = positional[1];
    if (!packageId || !version) releaseUsage('drop-tags <version> | drop-tags <package-id> <version> [--remote]');
    if (!(packageId in RELEASE_PACKAGES)) releaseUsage(`unknown package "${packageId}"`);
    await dropTagsFor(RELEASE_PACKAGES[packageId], version, { remote: args.includes('--remote') });
}
