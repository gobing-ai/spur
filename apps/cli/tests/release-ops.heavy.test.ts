import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bumpVer as runBumpVer, dropTags as runDropTags } from '../src/release-ops';
import { createCapturedOutput } from './helpers';

// Heavy release-ops cases (real throwaway repos + git + bun install, R1 task 1154).
setDefaultTimeout(30_000);

const repos: string[] = [];

function bumpVer(args: string[], repo: string): Promise<void> {
    return runBumpVer(args, repo, createCapturedOutput());
}

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

describe('builder bump-ver (heavy)', () => {
    test('plugin-install-smoke failure aborts the bump before any mutation', async () => {
        const { repo } = mkRepo();
        mkdirSync(join(repo, 'scripts', 'commands'), { recursive: true });
        writeFileSync(join(repo, 'scripts', 'commands', 'plugin-install-smoke.ts'), 'process.exit(1);\n');
        const manifestPath = join(repo, 'package.json');
        const manifest = (await Bun.file(manifestPath).json()) as { scripts: Record<string, string> };
        manifest.scripts = { 'plugin-smoke': 'bun scripts/commands/plugin-install-smoke.ts' };
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
        sh(repo, ['git', 'add', '.']);
        sh(repo, ['git', 'commit', '-m', 'gate']);

        await expect(bumpVer(['lib', '9.9.9'], repo)).rejects.toThrow('plugin-install-smoke failed');
        expect((await Bun.file(join(repo, 'pkgs', 'lib', 'package.json')).json()).version).toBe('0.1.0');
        expect(localTags(repo)).toEqual([]);
    });

    test('--all rewrites a root-manifest workspace pin and syncs bun.lock', async () => {
        const { repo } = mkRepo();
        const rootManifestPath = join(repo, 'package.json');
        const rootManifest = await Bun.file(rootManifestPath).json();
        rootManifest.dependencies = { '@demo/lib': 'workspace:0.1.0' };
        writeFileSync(rootManifestPath, `${JSON.stringify(rootManifest, null, 4)}\n`);
        writeFileSync(join(repo, '.gitignore'), 'node_modules\n');
        sh(repo, ['git', 'add', '.']);
        sh(repo, ['git', 'commit', '-m', 'root pin']);
        sh(repo, ['bun', 'install']); // seed bun.lock
        sh(repo, ['git', 'add', '.']);
        sh(repo, ['git', 'commit', '-m', 'lockfile']);

        await bumpVer(['--all', '0.3.0'], repo);

        const root = await Bun.file(rootManifestPath).json();
        expect(root.dependencies['@demo/lib']).toBe('workspace:0.3.0');
        const lock = await Bun.file(join(repo, 'bun.lock')).text();
        expect(lock).toContain('workspace:0.3.0');
        expect(lock).not.toContain('workspace:0.1.0');
    });

    test('--all includes the root-named CLI package so the aggregate tag stays consistent', async () => {
        const root = join(tmpdir(), `spur-builder-cliroot-${crypto.randomUUID()}`);
        repos.push(root);
        const repo = join(root, 'repo');
        mkdirSync(join(repo, 'pkgs', 'cli'), { recursive: true });
        mkdirSync(join(repo, 'pkgs', 'lib'), { recursive: true });
        writeFileSync(
            join(repo, 'package.json'),
            `${JSON.stringify({ name: '@demo/root', version: '0.1.0', workspaces: ['pkgs/*'] }, null, 4)}\n`,
        );
        writeFileSync(
            join(repo, 'pkgs', 'cli', 'package.json'),
            `${JSON.stringify({ name: '@demo/root', version: '0.1.0', dependencies: { '@demo/lib': 'workspace:0.1.0' } }, null, 4)}\n`,
        );
        writeFileSync(
            join(repo, 'pkgs', 'lib', 'package.json'),
            `${JSON.stringify({ name: '@demo/lib', version: '0.1.0' }, null, 4)}\n`,
        );
        sh(root, ['git', 'init', '--bare', join(root, 'origin.git')]);
        sh(repo, ['git', 'init']);
        sh(repo, ['git', 'config', 'user.email', 'test@example.com']);
        sh(repo, ['git', 'config', 'user.name', 'Test']);
        sh(repo, ['git', 'add', '.']);
        sh(repo, ['git', 'commit', '-m', 'init']);
        sh(repo, ['git', 'remote', 'add', 'origin', join(root, 'origin.git')]);

        await bumpVer(['--all', '0.3.0'], repo);
        const cli = await Bun.file(join(repo, 'pkgs', 'cli', 'package.json')).json();
        expect(cli.version).toBe('0.3.0');
        const tags = localTags(repo);
        expect(tags).toContain('@demo/root-v0.3.0');
        expect(tags).toContain('@demo/lib-v0.3.0');
    });

    test('builder.bump-ver.aggregatePackage names the publish target when the root name matches no package', async () => {
        const { repo } = mkRepo();
        await runBumpVer(['--all', '0.3.0', '--push'], repo, createCapturedOutput(), {
            builder: { 'bump-ver': { aggregatePackage: 'app' } },
        } as unknown as Parameters<typeof runBumpVer>[3]);

        const app = await Bun.file(join(repo, 'pkgs', 'app', 'package.json')).json();
        const lib = await Bun.file(join(repo, 'pkgs', 'lib', 'package.json')).json();
        expect(app.version).toBe('0.3.0');
        expect(lib.version).toBe('0.3.0');
        expect(remoteTags(repo)).toContain('@demo/app-v0.3.0');
        expect(localTags(repo)).not.toContain('@demo/root-v0.3.0');
    });

    test('drop-tags --all removes the configured aggregate tag locally and on origin', async () => {
        const { repo } = mkRepo();
        const config = {
            builder: { 'bump-ver': { aggregatePackage: 'app' } },
        } as unknown as Parameters<typeof runBumpVer>[3];
        await runBumpVer(['--all', '0.3.0', '--push'], repo, createCapturedOutput(), config);
        expect(remoteTags(repo)).toContain('@demo/app-v0.3.0');

        await runDropTags(['--all', '0.3.0', '--remote'], repo, createCapturedOutput(), config);
        expect(remoteTags(repo)).not.toContain('@demo/app-v0.3.0');
        expect(localTags(repo)).not.toContain('@demo/app-v0.3.0');
    });

    test('rewrites binaryVersion in src/config.ts and bumps plugin manifests', async () => {
        const { repo } = mkRepo();
        mkdirSync(join(repo, 'pkgs', 'lib', 'src'), { recursive: true });
        writeFileSync(join(repo, 'pkgs', 'lib', 'src', 'config.ts'), `export default { binaryVersion: '0.1.0' };\n`);
        mkdirSync(join(repo, '.claude-plugin', 'plugins', 'sp'), { recursive: true });
        writeFileSync(
            join(repo, '.claude-plugin', 'marketplace.json'),
            `${JSON.stringify({ name: 'demo', plugins: [{ name: 'sp', description: 'demo plugin', version: '0.1.0', source: '.claude-plugin/plugins/sp' }] }, null, 4)}\n`,
        );
        writeFileSync(
            join(repo, '.claude-plugin', 'plugins', 'sp', 'plugin.json'),
            `${JSON.stringify({ name: 'sp', version: '0.1.0' }, null, 4)}\n`,
        );
        sh(repo, ['bun', 'install']);
        sh(repo, ['git', 'add', '.']);
        sh(repo, ['git', 'commit', '-m', 'add release metadata']);

        await bumpVer(['lib', '0.2.0'], repo);
        expect(await Bun.file(join(repo, 'pkgs', 'lib', 'src', 'config.ts')).text()).toContain(
            "binaryVersion: '0.2.0'",
        );
        const marketplace = await Bun.file(join(repo, '.claude-plugin', 'marketplace.json')).json();
        expect(marketplace.plugins[0].version).toBe('0.2.0');
        expect(marketplace.plugins[0].description).toBe('demo plugin');
        const pluginJson = await Bun.file(join(repo, '.claude-plugin', 'plugins', 'sp', 'plugin.json')).json();
        expect(pluginJson.version).toBe('0.2.0');
        const manifest = await Bun.file(join(repo, 'pkgs', 'lib', 'package.json')).json();
        expect(manifest.version).toBe('0.2.0');
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
});
