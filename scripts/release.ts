#!/usr/bin/env bun
import { fileURLToPath } from 'node:url';

/**
 * Single-package release helper, aligned with the ts-libs release UX
 * (`bump-ver` / `drop-tags` + a tag→CI→npm-Trusted-Publishing flow) but pared
 * down: Spur publishes exactly one package, `@gobing-ai/spur-cli`. There is no
 * dependency ordering, aggregate tag, or `workspace:` range substitution to do —
 * the published CLI is a self-contained bundle with zero runtime dependencies, so
 * its bundled internal deps (spur-config, spur-domain) never reach the registry.
 */

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

const releaseConfig = {
    /** The one publishable package whose version drives a release. */
    packageDir: 'apps/cli',
    packageName: '@gobing-ai/spur-cli',
    /** `<name>-v<version>` — same separator ts-libs uses; this tag triggers Publish. */
    tagVersionSeparator: '-v',
    publishWorkflow: 'publish.yml',
    releaseCommitType: 'chore',
    releaseCommitScope: 'release',
    releaseCommitSubject: (version: string) => `bump spur-cli to ${version}`,
    releaseTagMessage: (tag: string) => `release: ${tag}`,
    ghRunListLimit: 5,
} as const;

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

/** The git tag that, when pushed, triggers the Publish workflow. */
function releaseTag(version: string): string {
    return `${releaseConfig.packageName}${releaseConfig.tagVersionSeparator}${version}`;
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

function assertTagFree(tag: string, version: string): void {
    const localTags = new Set(git(['tag', '-l']).split('\n').filter(Boolean));
    if (localTags.has(tag)) {
        throw new Error(`tag already exists locally: ${tag}. Run "bun run drop-tags ${version}" first.`);
    }
    // Remote clash is best-effort: a missing/unreachable origin must not block a
    // release (the push step would surface a genuine remote problem anyway).
    const remote = run(['git', 'ls-remote', '--tags', 'origin']);
    if (remote.ok && remote.stdout.includes(`refs/tags/${tag}`)) {
        throw new Error(`tag already exists on origin: ${tag}. Run "bun run drop-tags ${version} --remote" first.`);
    }
    if (!remote.ok) {
        console.warn('warning: could not check origin for tag clashes (remote unreachable); continuing.');
    }
}

async function bumpVersion(version: string, options: { push: boolean }): Promise<void> {
    if (!SEMVER.test(version)) {
        throw new Error(`"${version}" is not a valid semver version (expected e.g. 0.1.4).`);
    }

    const tag = releaseTag(version);
    const branch = assertCleanTreeOnBranch();
    assertTagFree(tag, version);

    if (npmViewVersion(releaseConfig.packageName, version)) {
        throw new Error(`${releaseConfig.packageName}@${version} is already published on npm. Use a new version.`);
    }

    const manifestPath = `${repoRoot}${releaseConfig.packageDir}/package.json`;
    const manifest = await Bun.file(manifestPath).json();
    const previous = manifest.version;
    manifest.version = version;
    await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
    console.log(`${releaseConfig.packageName}: ${previous} -> ${version}`);

    const staged = [`${releaseConfig.packageDir}/package.json`];
    if (Bun.file(`${repoRoot}bun.lock`).size > 0) staged.push('bun.lock');
    git(['add', ...staged]);

    const message = `${releaseConfig.releaseCommitType}(${releaseConfig.releaseCommitScope}): ${releaseConfig.releaseCommitSubject(version)}`;
    git(['commit', '-m', message]);
    console.log(`Committed: ${message}`);

    git(['tag', '-a', tag, '-m', releaseConfig.releaseTagMessage(tag)]);
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
    console.log(`  gh run list --workflow=${releaseConfig.publishWorkflow} --limit ${releaseConfig.ghRunListLimit}`);
}

async function dropTags(version: string, options: { remote: boolean }): Promise<void> {
    if (!SEMVER.test(version)) {
        throw new Error(`"${version}" is not a valid semver version (expected e.g. 0.1.2).`);
    }
    const tag = releaseTag(version);

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

function usage(message?: string): never {
    if (message) console.error(`error: ${message}\n`);
    console.error('Usage:');
    console.error('  bun run bump-ver <version> [--push]    bump spur-cli, commit, tag, optionally push');
    console.error('  bun run drop-tags <version> [--remote] delete the release tag locally (and on origin)');
    process.exit(message ? 1 : 0);
}

const [command, ...args] = process.argv.slice(2);
const version = args.find((arg) => !arg.startsWith('--'));

try {
    switch (command) {
        case 'bump-version':
        case 'bump-ver':
            if (!version) usage('bump-ver <version> [--push]');
            await bumpVersion(version, { push: args.includes('--push') });
            break;
        case 'drop-tags':
            if (!version) usage('drop-tags <version> [--remote]');
            await dropTags(version, { remote: args.includes('--remote') });
            break;
        default:
            usage();
    }
} catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
