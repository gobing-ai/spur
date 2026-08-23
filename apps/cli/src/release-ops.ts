import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import type { CommandOutput } from './output';
import { consoleOutput } from './output';

/**
 * Release plumbing shared by the public `spur builder` noun and the internal
 * `bun scripts/spur-dev.ts bump-ver|drop-tags` forwarders (task 0617, ADR-051).
 *
 * Generic by design: package set, aggregate tag, and workspace pins are all
 * discovered from the repo's own manifests, so any git+semver release flow works.
 * Everything takes an explicit `repoRoot` so tests can drive temp git repos.
 * Terminal output goes through the `CommandOutput` seam (default: console) so the
 * CLI noun can render through `context.output` while scripts keep console output.
 */

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

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

interface WorkspaceManifest {
    /** Repo-relative package directory, e.g. `apps/cli`. */
    dir: string;
    name: string;
    version: string;
    manifest: Record<string, unknown>;
}

interface ReleaseContext {
    repoRoot: string;
    rootName: string;
    packages: Map<string, ReleaseConfig>;
    /** Packages bumped together by the aggregate (`--all`) path: those pinned via `workspace:` by another workspace package. */
    allPackages: ReleaseConfig[];
}

/** The git tag that, when pushed, triggers the publish workflow. */
function releaseTag(config: ReleaseConfig, version: string): string {
    return `${config.packageName}${config.tagVersionSeparator}${version}`;
}

/** Run a command, capturing stdout; never throws (caller checks `ok`). */
async function run(repoRoot: string, cmd: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    const executor = new NodeProcessExecutor({ defaultTimeout: 30_000, defaultMaxOutput: 512_000 });
    const result = await executor.run({
        command: cmd[0] ?? '',
        args: cmd.slice(1),
        cwd: repoRoot,
        forceBuffered: true,
    });
    return {
        ok: result.exitCode === 0,
        stdout: result.stdout.toString().trim(),
        stderr: result.stderr.toString().trim(),
    };
}

/** Run git and return trimmed stdout; throws with context on failure. */
async function git(repoRoot: string, args: string[]): Promise<string> {
    const result = await run(repoRoot, ['git', ...args]);
    if (!result.ok) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
    }
    return result.stdout;
}

/** True if `name@version` is already on the npm registry (so we never re-tag a published version). */
async function npmViewVersion(repoRoot: string, name: string, version: string): Promise<boolean> {
    const result = await run(repoRoot, ['npm', 'view', `${name}@${version}`, 'version']);
    return result.ok && result.stdout === version;
}

/** Read a JSON object file, or null when absent/malformed. */
async function readJson(path: string): Promise<Record<string, unknown> | null> {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    try {
        const parsed = (await file.json()) as unknown;
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        return parsed as Record<string, unknown>;
    } catch {
        return null;
    }
}

/** Best-effort read of the root manifest's `workspaces` globs (array or `{packages: []}`). */
function rootWorkspaceGlobs(repoRoot: string): string[] {
    let root: unknown;
    try {
        root = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    } catch {
        return [];
    }
    if (root === null || typeof root !== 'object') return [];
    const raw: unknown = (root as Record<string, unknown>).workspaces;
    const rawPackages = (raw as Record<string, unknown>).packages;
    const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray(rawPackages) ? rawPackages : [];
    return list.filter((g): g is string => typeof g === 'string');
}

/** Expand root `workspaces` globs into repo-relative package dirs containing a package.json. */
function workspaceDirs(repoRoot: string): string[] {
    const dirs: string[] = [];
    for (const glob of rootWorkspaceGlobs(repoRoot)) {
        if (!glob.endsWith('/*')) continue;
        const parent = glob.slice(0, -2);
        const parentAbs = join(repoRoot, parent);
        if (!existsSync(parentAbs)) continue;
        for (const entry of readdirSync(parentAbs, { withFileTypes: true })) {
            if (entry.isDirectory() && existsSync(join(parentAbs, entry.name, 'package.json'))) {
                dirs.push(`${parent}/${entry.name}`);
            }
        }
    }
    return dirs;
}

/**
 * Discover every workspace package and derive its release config. The CLI id for each
 * package is its unscoped name (`@gobing-ai/spur` -> `spur`).
 */
async function releaseContext(repoRoot: string): Promise<ReleaseContext> {
    const rootManifest = await readJson(join(repoRoot, 'package.json'));
    if (rootManifest === null) {
        throw new Error(`no package.json found at ${repoRoot} — builder operates on a package workspace root.`);
    }
    const rootName = typeof rootManifest.name === 'string' ? rootManifest.name : 'root';

    const workspaces: WorkspaceManifest[] = [];
    for (const dir of workspaceDirs(repoRoot)) {
        const manifest = await readJson(join(repoRoot, dir, 'package.json'));
        if (manifest === null) continue;
        workspaces.push({
            dir,
            name: typeof manifest.name === 'string' ? manifest.name : dir,
            version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
            manifest,
        });
    }

    const shortName = (name: string): string => name.split('/').pop() ?? name;
    const packages = new Map<string, ReleaseConfig>();
    for (const ws of workspaces) {
        const versionSourceFile = existsSync(join(repoRoot, ws.dir, 'src', 'config.ts'))
            ? `${ws.dir}/src/config.ts`
            : undefined;
        packages.set(shortName(ws.name), {
            packageDir: ws.dir,
            packageName: ws.name,
            versionSourceFile,
            tagVersionSeparator: '-v',
            publishWorkflow: 'publish.yml',
            releaseCommitType: 'chore',
            releaseCommitScope: 'release',
            releaseCommitSubject: (version: string) => `bump ${shortName(ws.name)} to ${version}`,
            releaseTagMessage: (tag: string) => `release: ${tag}`,
            ghRunListLimit: 5,
        });
    }

    // The `--all` set: workspace packages pinned as `workspace:` deps by any other workspace package,
    // PLUS the package whose name equals the workspace root name (the CLI release target, e.g.
    // `@gobing-ai/spur`). The aggregate tag is `<rootName>-v<version>` and that tag is what triggers
    // the publish workflow, so the package it names MUST be bumped by `--all` — otherwise a bare
    // `bump-ver <version> --push` pushes an aggregate tag whose version the CLI does not carry, and
    // the publish gate (tag version == package.json version) fails or the run never ships (dogfood
    // 2026-08-21: 0.3.57 was never published because the CLI stayed at 0.3.55).
    const pinnedNames = new Set<string>();
    for (const ws of workspaces) {
        for (const field of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
            const deps = ws.manifest[field];
            if (deps === null || typeof deps !== 'object' || Array.isArray(deps)) continue;
            for (const [dep, spec] of Object.entries(deps)) {
                if (typeof spec === 'string' && spec.startsWith('workspace:') && dep !== ws.name) {
                    pinnedNames.add(dep);
                }
            }
        }
    }
    pinnedNames.add(rootName);
    const allPackages = [...packages.values()].filter((c) => pinnedNames.has(c.packageName));

    return { repoRoot, rootName, packages, allPackages };
}

/**
 * Scan every workspace package.json for `"<pkgName>": "workspace:<oldVersion>"`
 * and rewrite to `"workspace:<newVersion>"`. Returns the relative paths
 * of any manifest files that were changed (already written to disk).
 */
async function updateWorkspacePins(
    ctx: ReleaseContext,
    pkgName: string,
    oldVersion: string,
    newVersion: string,
    output: CommandOutput,
): Promise<string[]> {
    const changed: string[] = [];
    for (const dir of workspaceDirs(ctx.repoRoot)) {
        const relPath = `${dir}/package.json`;
        const manifest = await readJson(join(ctx.repoRoot, relPath));
        if (manifest === null) continue;
        let dirty = false;
        const pin = `workspace:${oldVersion}`;
        const nextPin = `workspace:${newVersion}`;
        for (const field of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
            const deps = manifest[field];
            if (deps === null || typeof deps !== 'object' || Array.isArray(deps)) continue;
            const map = deps as Record<string, unknown>;
            if (map[pkgName] === pin) {
                map[pkgName] = nextPin;
                dirty = true;
            }
        }
        if (dirty) {
            await Bun.write(join(ctx.repoRoot, relPath), `${JSON.stringify(manifest, null, 4)}\n`);
            output.write(`  ↳ ${relPath}: ${pkgName} workspace pin ${oldVersion} → ${newVersion}`);
            changed.push(relPath);
        }
    }
    return changed;
}

/**
 * Rewrite the `binaryVersion` string literal in a source file so the compiled
 * binary carries the correct version without runtime package.json reads.
 * Returns `true` when the file was actually modified.
 */
async function updateVersionSourceFile(
    ctx: ReleaseContext,
    filePath: string,
    previous: string,
    next: string,
    output: CommandOutput,
): Promise<boolean> {
    const absPath = join(ctx.repoRoot, filePath);
    const content = await Bun.file(absPath).text();
    // Match: binaryVersion: 'x.y.z' or binaryVersion: "x.y.z"
    const updated = content.replace(
        /(binaryVersion:\s*['"])\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?(['"])/,
        `$1${next}$2`,
    );
    if (updated === content) {
        output.write(`  ⚠ ${filePath}: binaryVersion pattern not found (expected ${previous})`);
        return false;
    }
    await Bun.write(absPath, updated);
    output.write(`  ↳ ${filePath}: binaryVersion ${previous} → ${next}`);
    return true;
}

/**
 * Sync `.claude-plugin/marketplace.json` and each listed plugin's `plugin.json`
 * to `version` (the plugin ships alongside the CLI, not independently — ADR-022).
 * No-ops when the marketplace file is absent. Appends changed paths to `staged`.
 */
async function syncMarketplaceAndPlugins(
    ctx: ReleaseContext,
    version: string,
    staged: string[],
    output: CommandOutput,
): Promise<void> {
    const marketplacePath = join(ctx.repoRoot, '.claude-plugin', 'marketplace.json');
    const marketplaceFile = Bun.file(marketplacePath);
    if (!(await marketplaceFile.exists())) return;

    const marketplace = await readJson(marketplacePath);
    const rawPlugins = marketplace?.plugins;
    if (marketplace === null || !Array.isArray(rawPlugins)) return;

    const isPlugin = (entry: unknown): entry is { name: string; version: string; source: string } =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as Record<string, unknown>).name === 'string' &&
        typeof (entry as Record<string, unknown>).version === 'string' &&
        typeof (entry as Record<string, unknown>).source === 'string';
    const plugins: Array<{ name: string; version: string; source: string }> = [];
    for (const entry of rawPlugins) {
        if (isPlugin(entry)) {
            plugins.push({ name: entry.name, version: entry.version, source: entry.source });
        }
    }

    let mpUpdated = false;
    for (const entry of plugins) {
        if (entry.version !== version) {
            entry.version = version;
            mpUpdated = true;
        }
    }
    if (mpUpdated) {
        marketplace.plugins = plugins;
        await Bun.write(marketplacePath, `${JSON.stringify(marketplace, null, 4)}\n`);
        staged.push('.claude-plugin/marketplace.json');
        output.write(`Bumped marketplace plugins to ${version}`);
    }

    // Update each plugin's own plugin.json manifest.
    for (const entry of plugins) {
        const pluginJsonPath = join(ctx.repoRoot, entry.source, 'plugin.json');
        const pluginJson = await readJson(pluginJsonPath);
        if (pluginJson === null) {
            output.write(`  ⚠ plugin.json not found at ${entry.source}/plugin.json — skipping`);
            continue;
        }
        if (pluginJson.version !== version) {
            pluginJson.version = version;
            await Bun.write(pluginJsonPath, `${JSON.stringify(pluginJson, null, 4)}\n`);
            staged.push(`${entry.source}/plugin.json`);
            output.write(`Bumped ${entry.source}/plugin.json to ${version}`);
        }
    }
}

async function assertCleanTreeOnBranch(ctx: ReleaseContext): Promise<string> {
    if ((await git(ctx.repoRoot, ['status', '--porcelain'])) !== '') {
        throw new Error('working tree is not clean. Commit or stash changes before releasing.');
    }
    const branch = await git(ctx.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch === 'HEAD') {
        throw new Error('detached HEAD — checkout a branch before releasing.');
    }
    return branch;
}

async function assertTagFree(
    ctx: ReleaseContext,
    config: ReleaseConfig,
    tag: string,
    version: string,
    output: CommandOutput,
): Promise<void> {
    const localTags = new Set((await git(ctx.repoRoot, ['tag', '-l'])).split('\n').filter(Boolean));
    if (localTags.has(tag)) {
        throw new Error(
            `tag already exists locally: ${tag}. Run "spur builder drop-tags ${config.packageName.split('/').pop()} ${version}" first.`,
        );
    }
    // Remote clash is best-effort: a missing/unreachable origin must not block a
    // release (the push step would surface a genuine remote problem anyway).
    const remote = await run(ctx.repoRoot, ['git', 'ls-remote', '--tags', 'origin']);
    if (remote.ok && remote.stdout.includes(`refs/tags/${tag}`)) {
        throw new Error(
            `tag already exists on origin: ${tag}. Run "spur builder drop-tags ${config.packageName.split('/').pop()} ${version} --remote" first.`,
        );
    }
    if (!remote.ok) {
        output.write('warning: could not check origin for tag clashes (remote unreachable); continuing.');
    }
}

async function bumpVersion(
    ctx: ReleaseContext,
    config: ReleaseConfig,
    version: string,
    options: { push: boolean },
    output: CommandOutput,
): Promise<void> {
    if (!SEMVER.test(version)) {
        throw new Error(`"${version}" is not a valid semver version (expected e.g. 0.1.4).`);
    }

    const tag = releaseTag(config, version);
    const branch = await assertCleanTreeOnBranch(ctx);
    await assertTagFree(ctx, config, tag, version, output);

    if (await npmViewVersion(ctx.repoRoot, config.packageName, version)) {
        throw new Error(`${config.packageName}@${version} is already published on npm. Use a new version.`);
    }
    const manifestPath = join(ctx.repoRoot, config.packageDir, 'package.json');
    const manifest = await readJson(manifestPath);
    if (manifest === null) throw new Error(`missing or malformed manifest at ${config.packageDir}/package.json`);
    const previous = typeof manifest.version === 'string' ? manifest.version : '0.0.0';
    manifest.version = version;
    await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
    output.write(`${config.packageName}: ${previous} -> ${version}`);

    const staged = [`${config.packageDir}/package.json`];
    // Update in-source version constant (e.g. binaryVersion in config.ts) for compiled binaries.
    if (config.versionSourceFile) {
        const updated = await updateVersionSourceFile(ctx, config.versionSourceFile, previous, version, output);
        if (updated) staged.push(config.versionSourceFile);
    }
    // Cascade workspace pin updates for consumers of this package.
    staged.push(...(await updateWorkspacePins(ctx, config.packageName, previous, version, output)));
    await syncMarketplaceAndPlugins(ctx, version, staged, output);
    const lockPath = join(ctx.repoRoot, 'bun.lock');
    if (existsSync(lockPath) && Bun.file(lockPath).size > 0) staged.push('bun.lock');
    await git(ctx.repoRoot, ['add', ...staged]);

    const message = `${config.releaseCommitType}(${config.releaseCommitScope}): ${config.releaseCommitSubject(version)}`;
    await git(ctx.repoRoot, ['commit', '-m', message]);
    output.write(`Committed: ${message}`);

    await git(ctx.repoRoot, ['tag', '-a', tag, '-m', config.releaseTagMessage(tag)]);
    output.write(`Tagged: ${tag}`);

    if (!options.push) {
        output.write('\nDone (local). Review, then push to release:');
        output.write(`  git push origin ${branch}`);
        output.write(`  git push origin ${tag}`);
        output.write('Or re-run with --push next time to do this automatically.');
        return;
    }

    output.write(`\nPushing branch ${branch} (tags excluded)...`);
    // --no-follow-tags: push.followTags in user git config would silently bundle all
    // annotated release tags into this branch push; >3 tags in one push makes GitHub
    // drop every tag push event, so the publish workflow never triggers.
    await git(ctx.repoRoot, ['push', '--no-follow-tags', 'origin', branch]);
    output.write(`Pushing release trigger tag ${tag}...`);
    await git(ctx.repoRoot, ['push', 'origin', tag]);

    output.write(`\nReleased ${version}. The publish workflow should now be running:`);
    output.write(`  gh run list --workflow=${config.publishWorkflow} --limit ${config.ghRunListLimit}`);
}

async function bumpAll(
    ctx: ReleaseContext,
    version: string,
    options: { push: boolean },
    output: CommandOutput,
): Promise<void> {
    if (!SEMVER.test(version)) {
        throw new Error(`"${version}" is not a valid semver version (expected e.g. 0.1.4).`);
    }
    if (ctx.allPackages.length === 0) {
        throw new Error('no workspace packages are pinned via "workspace:" by another package — nothing to bump.');
    }

    const branch = await assertCleanTreeOnBranch(ctx);
    const configs = ctx.allPackages;
    const aggregateTag = `${ctx.rootName}-v${version}`;

    // Pre-flight: check all tags (aggregate + per-package) and npm before touching any file.
    const existingLocal = new Set((await git(ctx.repoRoot, ['tag', '-l'])).split('\n').filter(Boolean));
    const allTags = [aggregateTag, ...configs.map((c) => releaseTag(c, version))];
    for (const tag of allTags) {
        if (existingLocal.has(tag)) throw new Error(`tag already exists locally: ${tag}`);
    }
    const remoteRefs = await git(ctx.repoRoot, ['ls-remote', '--tags', 'origin']);
    for (const tag of allTags) {
        if (remoteRefs.includes(`refs/tags/${tag}`)) {
            throw new Error(
                `tag already exists on origin: ${tag}. Run "spur builder drop-tags --all ${version} --remote" first.`,
            );
        }
    }
    for (const config of configs) {
        if (await npmViewVersion(ctx.repoRoot, config.packageName, version)) {
            throw new Error(`${config.packageName}@${version} is already published on npm. Use a new version.`);
        }
    }

    // Bump all manifests in one pass.
    const staged: string[] = [];
    for (const config of configs) {
        const manifestPath = join(ctx.repoRoot, config.packageDir, 'package.json');
        const manifest = await readJson(manifestPath);
        if (manifest === null) {
            throw new Error(`missing or malformed manifest at ${config.packageDir}/package.json`);
        }
        const previous = typeof manifest.version === 'string' ? manifest.version : '0.0.0';
        manifest.version = version;
        await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
        output.write(`${config.packageName}: ${previous} -> ${version}`);
        staged.push(`${config.packageDir}/package.json`);
        if (config.versionSourceFile) {
            const updated = await updateVersionSourceFile(ctx, config.versionSourceFile, previous, version, output);
            if (updated) staged.push(config.versionSourceFile);
        }
        staged.push(...(await updateWorkspacePins(ctx, config.packageName, previous, version, output)));
    }

    await syncMarketplaceAndPlugins(ctx, version, staged, output);

    const lockPath = join(ctx.repoRoot, 'bun.lock');
    if (existsSync(lockPath) && Bun.file(lockPath).size > 0) staged.push('bun.lock');
    await git(ctx.repoRoot, ['add', ...staged]);

    const shortNames = configs.map((c) => c.packageName.split('/').pop() ?? c.packageName).join(' + ');
    const message = `chore(release): bump ${shortNames} to ${version}`;
    await git(ctx.repoRoot, ['commit', '-m', message]);
    output.write(`Committed: ${message}`);

    // Per-package tags for traceability + aggregate tag to trigger publish.
    for (const config of configs) {
        const tag = releaseTag(config, version);
        if (tag !== aggregateTag) {
            await git(ctx.repoRoot, ['tag', '-a', tag, '-m', config.releaseTagMessage(tag)]);
            output.write(`Tagged (trace): ${tag}`);
        }
    }
    await git(ctx.repoRoot, ['tag', '-a', aggregateTag, '-m', `${ctx.rootName} ${version} — ${shortNames}`]);
    output.write(`Tagged (publish): ${aggregateTag}`);

    if (!options.push) {
        output.write('\nDone (local). Review, then push to release:');
        output.write(`  git push origin ${branch}`);
        output.write(`  git push origin ${aggregateTag}`);
        output.write('Or re-run with --push next time to do this automatically.');
        return;
    }

    output.write(`\nPushing branch ${branch} (tags excluded)...`);
    // Same followTags guard as bumpVersion: the branch push must not smuggle the
    // per-package trace tags past GitHub's >3-tags-per-push event limit.
    await git(ctx.repoRoot, ['push', '--no-follow-tags', 'origin', branch]);
    output.write(`Pushing release trigger tag ${aggregateTag}...`);
    await git(ctx.repoRoot, ['push', 'origin', aggregateTag]);

    output.write(`\nReleased ${version}. The publish workflow should now be running:`);
    output.write('  gh run list --workflow=publish.yml --limit 3');
}

async function dropTagsFor(
    ctx: ReleaseContext,
    config: ReleaseConfig,
    version: string,
    options: { remote: boolean },
    output: CommandOutput,
): Promise<void> {
    if (!SEMVER.test(version)) {
        throw new Error(`"${version}" is not a valid semver version (expected e.g. 0.1.2).`);
    }
    const tag = releaseTag(config, version);

    const localTags = new Set((await git(ctx.repoRoot, ['tag', '-l'])).split('\n').filter(Boolean));
    if (localTags.has(tag)) {
        await git(ctx.repoRoot, ['tag', '-d', tag]);
        output.write(`Deleted local tag ${tag}`);
    } else {
        output.write(`No local tag ${tag}`);
    }

    if (options.remote) {
        const result = await run(ctx.repoRoot, ['git', 'push', 'origin', `:refs/tags/${tag}`]);
        output.write(result.ok ? `Deleted remote tag ${tag}` : `Remote tag ${tag} not present or already removed`);
    }
}

async function dropAll(
    ctx: ReleaseContext,
    version: string,
    options: { remote: boolean },
    output: CommandOutput,
): Promise<void> {
    if (!SEMVER.test(version)) {
        throw new Error(`"${version}" is not a valid semver version (expected e.g. 0.1.2).`);
    }
    for (const config of ctx.allPackages) {
        await dropTagsFor(ctx, config, version, options, output);
    }
    // Also drop the aggregate tag.
    const aggregateTag = `${ctx.rootName}-v${version}`;
    const localTags = new Set((await git(ctx.repoRoot, ['tag', '-l'])).split('\n').filter(Boolean));
    if (localTags.has(aggregateTag)) {
        await git(ctx.repoRoot, ['tag', '-d', aggregateTag]);
        output.write(`Deleted local tag ${aggregateTag}`);
    }
    if (options.remote) {
        const result = await run(ctx.repoRoot, ['git', 'push', 'origin', `:refs/tags/${aggregateTag}`]);
        output.write(
            result.ok
                ? `Deleted remote tag ${aggregateTag}`
                : `Remote tag ${aggregateTag} not present or already removed`,
        );
    }
}

function releaseUsage(message?: string): Error {
    const usage = [
        'Usage:',
        '  bump-ver <version> | bump-ver --all <version> [--push]    bump all released packages',
        '  bump-ver <package-id> <version> [--push]                 bump one package, commit, tag',
        '  drop-tags <version> | drop-tags --all <version> [--remote]  drop all release tags',
        '  drop-tags <package-id> <version> [--remote]              drop one package release tag',
    ].join('\n');
    return new Error(message === undefined ? usage : `${message}\n\n${usage}`);
}

/**
 * `spur builder bump-ver` — bump one package or all, commit, tag, optionally push.
 * "All packages" is the default: a bare `bump-ver <version>` (single positional that parses
 * as semver, or explicit `--all`) bumps every released package. The two-arg
 * `bump-ver <pkg> <version>` form scopes to one package.
 */
export async function bumpVer(
    args: string[],
    repoRoot: string = process.cwd(),
    output: CommandOutput = consoleOutput,
): Promise<void> {
    const ctx = await releaseContext(repoRoot);
    const positional = args.filter((arg) => !arg.startsWith('--'));
    if (args.includes('--all') || (positional.length === 1 && SEMVER.test(positional[0] ?? ''))) {
        const allVersion = positional[0];
        if (!allVersion) throw releaseUsage('bump-ver [--all] <version> [--push]');
        await bumpAll(ctx, allVersion, { push: args.includes('--push') }, output);
        return;
    }
    const packageId = positional[0];
    const version = positional[1];
    if (!packageId || !version) throw releaseUsage('bump-ver <version> | bump-ver <package-id> <version> [--push]');
    const config = ctx.packages.get(packageId);
    if (config === undefined) {
        throw releaseUsage(`unknown package "${packageId}". Package IDs: ${[...ctx.packages.keys()].join(', ')}`);
    }
    await bumpVersion(ctx, config, version, { push: args.includes('--push') }, output);
}

/**
 * `spur builder drop-tags` — delete one package's release tag or all of them.
 * Mirrors `bumpVer`: a bare `drop-tags <version>` drops every released tag (plus the
 * aggregate); `drop-tags <pkg> <version>` scopes to one.
 */
export async function dropTags(
    args: string[],
    repoRoot: string = process.cwd(),
    output: CommandOutput = consoleOutput,
): Promise<void> {
    const ctx = await releaseContext(repoRoot);
    const positional = args.filter((arg) => !arg.startsWith('--'));
    if (args.includes('--all') || (positional.length === 1 && SEMVER.test(positional[0] ?? ''))) {
        const allVersion = positional[0];
        if (!allVersion) throw releaseUsage('drop-tags [--all] <version> [--remote]');
        await dropAll(ctx, allVersion, { remote: args.includes('--remote') }, output);
        return;
    }
    const packageId = positional[0];
    const version = positional[1];
    if (!packageId || !version) {
        throw releaseUsage('drop-tags <version> | drop-tags <package-id> <version> [--remote]');
    }
    const config = ctx.packages.get(packageId);
    if (config === undefined) {
        throw releaseUsage(`unknown package "${packageId}". Package IDs: ${[...ctx.packages.keys()].join(', ')}`);
    }
    await dropTagsFor(ctx, config, version, { remote: args.includes('--remote') }, output);
}
