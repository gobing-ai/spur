#!/usr/bin/env bun
import { fileURLToPath } from 'node:url';

/**
 * Multi-package release helper, aligned with the ts-libs release UX
 * (`bump-ver` / `drop-tags` + a tag→CI→npm-Trusted-Publishing flow).
 * Each publishable package is keyed by a short ID (e.g. `spur-cli`) in
 * `RELEASE_PACKAGES`. The published CLI is a self-contained bundle with
 * zero runtime dependencies, so its bundled internal deps (spur-config,
 * spur-domain) never reach the registry.
 */

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

interface ReleaseConfig {
    packageDir: string;
    packageName: string;
    tagVersionSeparator: string;
    publishWorkflow: string;
    releaseCommitType: string;
    releaseCommitScope: string;
    releaseCommitSubject: (version: string) => string;
    releaseTagMessage: (tag: string) => string;
    ghRunListLimit: number;
}

const RELEASE_PACKAGES = {
    'spur-cli': {
        packageDir: 'apps/cli',
        packageName: '@gobing-ai/spur-cli',
        tagVersionSeparator: '-v',
        publishWorkflow: 'publish.yml',
        releaseCommitType: 'chore',
        releaseCommitScope: 'release',
        releaseCommitSubject: (version: string) => `bump spur-cli to ${version}`,
        releaseTagMessage: (tag: string) => `release: ${tag}`,
        ghRunListLimit: 5,
    },
    'spur-plugin-sdk': {
        packageDir: 'packages/plugin-sdk',
        packageName: '@gobing-ai/spur-plugin-sdk',
        tagVersionSeparator: '-v',
        publishWorkflow: 'publish.yml',
        releaseCommitType: 'chore',
        releaseCommitScope: 'release',
        releaseCommitSubject: (version: string) => `bump spur-plugin-sdk to ${version}`,
        releaseTagMessage: (tag: string) => `release: ${tag}`,
        ghRunListLimit: 5,
    },
} as const satisfies Record<string, ReleaseConfig>;

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
    // Cascade workspace pin updates for consumers of this package.
    const pinChanges = await updateWorkspacePins(config.packageName, previous, version);
    staged.push(...pinChanges);
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
    const configs = [RELEASE_PACKAGES['spur-cli'], RELEASE_PACKAGES['spur-plugin-sdk']];

    // Pre-flight: check all tags and npm before touching any file.
    for (const config of configs) {
        const tag = releaseTag(config, version);
        assertTagFree(config, tag, version);
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
        // Cascade workspace pin updates for consumers.
        const pinChanges = await updateWorkspacePins(config.packageName, previous, version);
        staged.push(...pinChanges);
    }

    if (Bun.file(`${repoRoot}bun.lock`).size > 0) staged.push('bun.lock');
    git(['add', ...staged]);

    const message = `chore(release): bump spur-cli and spur-plugin-sdk to ${version}`;
    git(['commit', '-m', message]);
    console.log(`Committed: ${message}`);

    // Tag both.
    for (const config of configs) {
        const tag = releaseTag(config, version);
        git(['tag', '-a', tag, '-m', config.releaseTagMessage(tag)]);
        console.log(`Tagged: ${tag}`);
    }

    if (!options.push) {
        console.log('\nDone (local). Review, then push to release:');
        console.log(`  git push origin ${branch}`);
        console.log(`  git push origin @gobing-ai/spur-cli-v${version} @gobing-ai/spur-plugin-sdk-v${version}`);
        console.log('Or re-run with --push next time to do this automatically.');
        return;
    }

    console.log(`\nPushing branch ${branch} (tags excluded)...`);
    git(['push', 'origin', branch]);
    console.log('Pushing release trigger tags...');
    git(['push', 'origin', `@gobing-ai/spur-cli-v${version}`, `@gobing-ai/spur-plugin-sdk-v${version}`]);

    console.log(`\nReleased ${version} for both packages. The Publish workflows should now be running:`);
    console.log(`  gh run list --workflow=publish.yml --limit 5`);
}

async function dropTags(config: ReleaseConfig, version: string, options: { remote: boolean }): Promise<void> {
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
    for (const config of [RELEASE_PACKAGES['spur-cli'], RELEASE_PACKAGES['spur-plugin-sdk']]) {
        await dropTags(config, version, options);
    }
}

function usage(message?: string): never {
    if (message) console.error(`error: ${message}\n`);
    const ids = Object.keys(RELEASE_PACKAGES).join(', ');
    console.error('Usage:');
    console.error(
        `  bun run bump-ver <package-id> <version> [--push]    bump one package, commit, tag, optionally push`,
    );
    console.error(`  bun run bump-ver --all <version> [--push]              bump both packages in one commit + tags`);
    console.error(`  bun run drop-tags <package-id> <version> [--remote] delete one package's release tag`);
    console.error(`  bun run drop-tags --all <version> [--remote]              delete both packages' release tags`);
    console.error(`\nPackage IDs: ${ids}`);
    process.exit(message ? 1 : 0);
}

const [command, ...args] = process.argv.slice(2);
const positionalArgs = args.filter((arg) => !arg.startsWith('--'));
const packageId = positionalArgs[0] as PackageId | undefined;
const version = positionalArgs[1];

try {
    switch (command) {
        case 'bump-version':
        case 'bump-ver':
            if (args.includes('--all')) {
                const allVersion = positionalArgs[0];
                if (!allVersion) usage('bump-ver --all <version> [--push]');
                await bumpAll(allVersion, { push: args.includes('--push') });
                break;
            }
            if (!packageId || !version) usage('bump-ver <package-id> <version> [--push]');
            if (!(packageId in RELEASE_PACKAGES)) usage(`unknown package "${packageId}"`);
            await bumpVersion(RELEASE_PACKAGES[packageId], version, { push: args.includes('--push') });
            break;
        case 'drop-tags':
            if (args.includes('--all')) {
                const allVersion = positionalArgs[0];
                if (!allVersion) usage('drop-tags --all <version> [--remote]');
                await dropAll(allVersion, { remote: args.includes('--remote') });
                break;
            }
            if (!packageId || !version) usage('drop-tags <package-id> <version> [--remote]');
            if (!(packageId in RELEASE_PACKAGES)) usage(`unknown package "${packageId}"`);
            await dropTags(RELEASE_PACKAGES[packageId], version, { remote: args.includes('--remote') });
            break;
        default:
            usage();
    }
} catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
