import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bumpVer, dropTags } from '../src/release-ops';

// Task 0617 R3: the test sibling the spur-dev release command never had. Every case drives
// a throwaway git repo so the tag/push paths run against real git (a local bare "origin").

const repos: string[] = [];

function sh(cwd: string, cmd: string[]): string {
    const result = Bun.spawnSync(cmd, { cwd });
    if (result.exitCode !== 0) {
        throw new Error(`${cmd.join(' ')} failed: ${result.stderr.toString()} ${result.stdout.toString()}`);
    }
    return result.stdout.toString().trim();
}

function mkRepo(): { repo: string; origin: string } {
    const root = join(tmpdir(), `spur-builder-${crypto.randomUUID()}`);
    repos.push(root);
    const repo = join(root, 'repo');
    const origin = join(root, 'origin.git');
    mkdirSync(join(repo, 'pkgs', 'lib'), { recursive: true });
    sh(root, ['git', 'init', '--bare', origin]);
    sh(repo, ['git', 'init']);
    sh(repo, ['git', 'config', 'user.email', 'test@example.com']);
    sh(repo, ['git', 'config', 'user.name', 'Test']);
    writeFileSync(
        join(repo, 'package.json'),
        `${JSON.stringify({ name: '@demo/root', version: '0.1.0', workspaces: ['pkgs/*'] }, null, 4)}\n`,
    );
    writeFileSync(
        join(repo, 'pkgs', 'lib', 'package.json'),
        `${JSON.stringify({ name: '@demo/lib', version: '0.1.0' }, null, 4)}\n`,
    );
    mkdirSync(join(repo, 'pkgs', 'app'), { recursive: true });
    writeFileSync(
        join(repo, 'pkgs', 'app', 'package.json'),
        `${JSON.stringify({ name: '@demo/app', version: '0.1.0', dependencies: { '@demo/lib': 'workspace:0.1.0' } }, null, 4)}\n`,
    );
    sh(repo, ['git', 'add', '.']);
    sh(repo, ['git', 'commit', '-m', 'init']);
    sh(repo, ['git', 'remote', 'add', 'origin', origin]);
    return { repo, origin };
}
function localTags(cwd: string): string[] {
    return Bun.spawnSync(['git', 'tag', '-l'], { cwd })
        .stdout.toString()
        .split('\n')
        .map((t) => t.trim())
        .filter(Boolean);
}

function remoteTags(cwd: string): string[] {
    return Bun.spawnSync(['git', 'ls-remote', '--tags', 'origin'], { cwd })
        .stdout.toString()
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^.*refs\/tags\//, '').replace(/\^\{\}$/, ''));
}

afterEach(() => {
    for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('builder bump-ver', () => {
    test('bumps one package: manifest, commit, annotated tag, no push', async () => {
        const { repo } = mkRepo();
        await bumpVer(['lib', '0.2.0'], repo);

        const manifest = await Bun.file(join(repo, 'pkgs', 'lib', 'package.json')).json();
        expect(manifest.version).toBe('0.2.0');
        expect(localTags(repo)).toContain('@demo/lib-v0.2.0');
        expect(sh(repo, ['git', 'log', '-1', '--pretty=%s'])).toBe('chore(release): bump lib to 0.2.0');
        // No push: the tag must not exist on origin.
        expect(remoteTags(repo)).not.toContain('@demo/lib-v0.2.0');
    });

    test('--push pushes the branch and the tag to origin', async () => {
        const { repo } = mkRepo();
        await bumpVer(['lib', '0.2.0', '--push'], repo);
        expect(remoteTags(repo)).toContain('@demo/lib-v0.2.0');
    });

    test('--all bumps the workspace-pinned set with per-package + aggregate tags', async () => {
        const { repo } = mkRepo();
        await bumpVer(['--all', '0.3.0'], repo);

        const lib = await Bun.file(join(repo, 'pkgs', 'lib', 'package.json')).json();
        const app = await Bun.file(join(repo, 'pkgs', 'app', 'package.json')).json();
        expect(lib.version).toBe('0.3.0');
        // app is not pinned by anyone, so --all leaves it alone.
        expect(app.version).toBe('0.1.0');
        // The workspace pin cascades to the consumer manifest.
        expect(app.dependencies['@demo/lib']).toBe('workspace:0.3.0');
        const tags = localTags(repo);
        expect(tags).toContain('@demo/lib-v0.3.0');
        expect(tags).toContain('@demo/root-v0.3.0');
    });

    test('rejects invalid semver', async () => {
        const { repo } = mkRepo();
        await expect(bumpVer(['lib', 'not-semver'], repo)).rejects.toThrow('not a valid semver');
    });

    test('rejects unknown package ids with the available ids', async () => {
        const { repo } = mkRepo();
        await expect(bumpVer(['nope', '0.2.0'], repo)).rejects.toThrow('unknown package "nope"');
    });

    test('refuses to release on a dirty tree', async () => {
        const { repo } = mkRepo();
        writeFileSync(join(repo, 'pkgs', 'lib', 'package.json'), '{}\n');
        await expect(bumpVer(['lib', '0.2.0'], repo)).rejects.toThrow('working tree is not clean');
    });

    test('refuses to re-tag an existing local tag', async () => {
        const { repo } = mkRepo();
        await bumpVer(['lib', '0.2.0'], repo);
        // Reset the manifest so the second run passes the clean-tree gate.
        sh(repo, ['git', 'reset', '--hard', 'HEAD~1']);
        await expect(bumpVer(['lib', '0.2.0'], repo)).rejects.toThrow('tag already exists locally');
    });
});

describe('builder drop-tags', () => {
    test('deletes the local tag and leaves origin untouched without --remote', async () => {
        const { repo } = mkRepo();
        await bumpVer(['lib', '0.2.0', '--push'], repo);
        await dropTags(['lib', '0.2.0'], repo);
        expect(localTags(repo)).not.toContain('@demo/lib-v0.2.0');
        expect(remoteTags(repo)).toContain('@demo/lib-v0.2.0');
    });

    test('--remote deletes the tag on origin too', async () => {
        const { repo } = mkRepo();
        await bumpVer(['lib', '0.2.0', '--push'], repo);
        await dropTags(['lib', '0.2.0', '--remote'], repo);
        expect(localTags(repo)).not.toContain('@demo/lib-v0.2.0');
        expect(remoteTags(repo)).not.toContain('@demo/lib-v0.2.0');
    });

    test('--all drops per-package and aggregate tags', async () => {
        const { repo } = mkRepo();
        await bumpVer(['--all', '0.3.0', '--push'], repo);
        await dropTags(['--all', '0.3.0', '--remote'], repo);
        expect(localTags(repo)).toEqual([]);
        expect(remoteTags(repo)).toEqual([]);
    });
});

describe('builder edge paths', () => {
    test('rejects bump-ver and drop-tags with missing args via usage', async () => {
        const { repo } = mkRepo();
        await expect(bumpVer([], repo)).rejects.toThrow('Usage');
        await expect(bumpVer(['lib'], repo)).rejects.toThrow('Usage');
        await expect(dropTags([], repo)).rejects.toThrow('Usage');
        await expect(dropTags(['lib'], repo)).rejects.toThrow('Usage');
        await expect(dropTags(['nope', '0.2.0'], repo)).rejects.toThrow('unknown package "nope"');
    });

    test('fails when the root has no package.json', async () => {
        const root = join(tmpdir(), `spur-builder-nopkg-${crypto.randomUUID()}`);
        repos.push(root);
        mkdirSync(root, { recursive: true });
        await expect(bumpVer(['--all', '0.2.0'], root)).rejects.toThrow('no package.json found');
    });

    test('treats a non-object root manifest as absent', async () => {
        const root = join(tmpdir(), `spur-builder-badpkg-${crypto.randomUUID()}`);
        repos.push(root);
        mkdirSync(root, { recursive: true });
        writeFileSync(join(root, 'package.json'), '"just a string"\n');
        await expect(bumpVer(['--all', '0.2.0'], root)).rejects.toThrow('no package.json found');
    });

    test('supports {packages:[...]} workspaces form and skips globs without manifests', async () => {
        const root = join(tmpdir(), `spur-builder-objws-${crypto.randomUUID()}`);
        repos.push(root);
        const repo = join(root, 'repo');
        mkdirSync(join(repo, 'pkgs', 'a'), { recursive: true });
        writeFileSync(
            join(repo, 'package.json'),
            `${JSON.stringify({ name: '@demo/root', version: '0.1.0', workspaces: { packages: ['pkgs/*'] } }, null, 4)}\n`,
        );
        writeFileSync(
            join(repo, 'pkgs', 'a', 'package.json'),
            `${JSON.stringify({ name: '@demo/a', version: '0.1.0' }, null, 4)}\n`,
        );
        // pkgs/empty has no manifest; the glob must simply skip it rather than explode.
        mkdirSync(join(repo, 'pkgs', 'empty'), { recursive: true });
        sh(root, ['git', 'init', '--bare', join(root, 'origin.git')]);
        sh(repo, ['git', 'init']);
        sh(repo, ['git', 'config', 'user.email', 'test@example.com']);
        sh(repo, ['git', 'config', 'user.name', 'Test']);
        sh(repo, ['git', 'add', '.']);
        sh(repo, ['git', 'commit', '-m', 'init']);
        sh(repo, ['git', 'remote', 'add', 'origin', join(root, 'origin.git')]);
        await bumpVer(['a', '0.2.0'], repo);
        expect(localTags(repo)).toContain('@demo/a-v0.2.0');
    });

    test('--all with nothing pinned errors', async () => {
        const root = join(tmpdir(), `spur-builder-nopin-${crypto.randomUUID()}`);
        repos.push(root);
        const repo = join(root, 'repo');
        mkdirSync(join(repo, 'pkgs', 'a'), { recursive: true });
        writeFileSync(
            join(repo, 'package.json'),
            `${JSON.stringify({ name: '@demo/root', version: '0.1.0', workspaces: ['pkgs/*'] }, null, 4)}\n`,
        );
        writeFileSync(
            join(repo, 'pkgs', 'a', 'package.json'),
            `${JSON.stringify({ name: '@demo/a', version: '0.1.0' }, null, 4)}\n`,
        );
        sh(repo, ['git', 'init']);
        sh(repo, ['git', 'config', 'user.email', 'test@example.com']);
        sh(repo, ['git', 'config', 'user.name', 'Test']);
        sh(repo, ['git', 'add', '.']);
        sh(repo, ['git', 'commit', '-m', 'init']);
        await expect(bumpVer(['--all', '0.2.0'], repo)).rejects.toThrow('nothing to bump');
    });

    test('rewrites binaryVersion in src/config.ts and bumps plugin manifests', async () => {
        const { repo } = mkRepo();
        mkdirSync(join(repo, 'pkgs', 'lib', 'src'), { recursive: true });
        writeFileSync(join(repo, 'pkgs', 'lib', 'src', 'config.ts'), `export default { binaryVersion: '0.1.0' };\n`);
        mkdirSync(join(repo, '.claude-plugin', 'plugins', 'sp'), { recursive: true });
        writeFileSync(
            join(repo, '.claude-plugin', 'marketplace.json'),
            `${JSON.stringify({ name: 'demo', plugins: [{ name: 'sp', version: '0.1.0', source: '.claude-plugin/plugins/sp' }] }, null, 4)}\n`,
        );
        writeFileSync(
            join(repo, '.claude-plugin', 'plugins', 'sp', 'plugin.json'),
            `${JSON.stringify({ name: 'sp', version: '0.1.0' }, null, 4)}\n`,
        );
        writeFileSync(join(repo, 'bun.lock'), '# bun lockfile\n');
        sh(repo, ['git', 'add', '.']);
        sh(repo, ['git', 'commit', '-m', 'add release metadata']);

        await bumpVer(['lib', '0.2.0'], repo);
        expect(await Bun.file(join(repo, 'pkgs', 'lib', 'src', 'config.ts')).text()).toContain(
            "binaryVersion: '0.2.0'",
        );
        const marketplace = await Bun.file(join(repo, '.claude-plugin', 'marketplace.json')).json();
        expect(marketplace.plugins[0].version).toBe('0.2.0');
        const pluginJson = await Bun.file(join(repo, '.claude-plugin', 'plugins', 'sp', 'plugin.json')).json();
        expect(pluginJson.version).toBe('0.2.0');
        const manifest = await Bun.file(join(repo, 'pkgs', 'lib', 'package.json')).json();
        expect(manifest.version).toBe('0.2.0');
    });

    test('warns when binaryVersion pattern is absent and skips malformed marketplace', async () => {
        const { repo } = mkRepo();
        mkdirSync(join(repo, 'pkgs', 'lib', 'src'), { recursive: true });
        writeFileSync(join(repo, 'pkgs', 'lib', 'src', 'config.ts'), `export const mode = 'fast';\n`);
        mkdirSync(join(repo, '.claude-plugin'), { recursive: true });
        writeFileSync(
            join(repo, '.claude-plugin', 'marketplace.json'),
            `${JSON.stringify({ name: 'demo' }, null, 4)}\n`,
        );
        sh(repo, ['git', 'add', '.']);
        sh(repo, ['git', 'commit', '-m', 'add metadata']);
        await bumpVer(['lib', '0.2.0'], repo);
        expect(localTags(repo)).toContain('@demo/lib-v0.2.0');
    });

    test('refuses when a pushed tag already exists on origin (single and --all)', async () => {
        const { repo } = mkRepo();
        await bumpVer(['lib', '0.2.0', '--push'], repo);
        sh(repo, ['git', 'reset', '--hard', 'HEAD~1']);
        sh(repo, ['git', 'tag', '-d', '@demo/lib-v0.2.0']);
        await expect(bumpVer(['lib', '0.2.0'], repo)).rejects.toThrow('tag already exists on origin');

        const { repo: repo2 } = mkRepo();
        await bumpVer(['--all', '0.3.0', '--push'], repo2);
        sh(repo2, ['git', 'reset', '--hard', 'HEAD~1']);
        for (const t of ['@demo/lib-v0.3.0', '@demo/root-v0.3.0']) sh(repo2, ['git', 'tag', '-d', t]);
        await expect(bumpVer(['--all', '0.3.0'], repo2)).rejects.toThrow('tag already exists on origin');
    });

    test('drop-tags tolerates absent local and remote tags', async () => {
        const { repo } = mkRepo();
        // Neither @demo/lib-v0.2.0 nor @demo/root-v0.2.0 exist anywhere.
        await dropTags(['lib', '0.2.0', '--remote'], repo);
        await dropTags(['--all', '0.2.0', '--remote'], repo);
        expect(localTags(repo)).toEqual([]);
    });

    test('detached HEAD blocks a release', async () => {
        const { repo } = mkRepo();
        sh(repo, ['git', 'checkout', '--detach']);
        await expect(bumpVer(['lib', '0.2.0'], repo)).rejects.toThrow('detached HEAD');
    });

    test('surfaces git failures as errors', async () => {
        const { repo } = mkRepo();
        sh(repo, ['rm', '-rf', '.git']);
        await expect(bumpVer(['lib', '0.2.0'], repo)).rejects.toThrow('git status');
    });
});
