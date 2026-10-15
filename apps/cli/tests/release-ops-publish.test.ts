/**
 * `spur builder bump-ver --check` and `spur builder publish` (script-absorption PR-9). Ports the
 * retired `check-marketplace-version` coverage (task 0500 R6, formerly in verify-pack.test.ts)
 * and pins the retired `publish.ts` behaviour (range resolution, build-before-publish, manifest
 * restore on every path) with a stub runner — no real npm call.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from '@commander-js/extra-typings';
import { registerBuilderCommand } from '../src/commands/builder';
import type { CliContext } from '../src/context';
import {
    checkVersionDrift,
    defaultPublishRunner,
    findMarketplaceVersionDriftFrom,
    type PublishRunner,
    publishPackage,
    resolvePublishRanges,
} from '../src/release-ops';

const REPO_ROOT = join(import.meta.dir, '../../..');
const roots: string[] = [];

function capture() {
    const lines: string[] = [];
    const errors: string[] = [];
    return { lines, errors, output: { write: (m: string) => lines.push(m), error: (m: string) => errors.push(m) } };
}

function writeJson(path: string, value: unknown): void {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 4)}\n`);
}

/** A workspace: root + apps/cli (aggregate, public) + packages/core (private) + a plugin. */
function mkWorkspace(
    opts: { pluginVersion?: string; marketplaceVersion?: string; marketplace?: boolean } = {},
): string {
    const root = join(tmpdir(), `spur-pr9-release-${crypto.randomUUID()}`);
    roots.push(root);
    // The root shares the CLI package name, so `@demo/spur` resolves as the aggregate package.
    writeJson(join(root, 'package.json'), {
        name: '@demo/spur',
        private: true,
        workspaces: { packages: ['apps/*', 'packages/*'], catalog: { yaml: '^2.0.0' } },
    });
    writeJson(join(root, 'apps/cli/package.json'), {
        name: '@demo/spur',
        version: '1.2.3',
        dependencies: { '@demo/core': 'workspace:*', '@demo/pub': 'workspace:*', yaml: 'catalog:', zod: '^3' },
    });
    writeJson(join(root, 'packages/core/package.json'), { name: '@demo/core', version: '1.2.3', private: true });
    writeJson(join(root, 'packages/pub/package.json'), { name: '@demo/pub', version: '2.0.0' });
    if (opts.marketplace !== false) {
        writeJson(join(root, '.claude-plugin/marketplace.json'), {
            name: 'demo',
            plugins: [{ name: 'sp', version: opts.marketplaceVersion ?? '1.2.3', source: './plugins/sp' }],
        });
        writeJson(join(root, 'plugins/sp/plugin.json'), { name: 'sp', version: opts.pluginVersion ?? '1.2.3' });
    }
    return root;
}

afterEach(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('findMarketplaceVersionDriftFrom (0500 R6)', () => {
    test('reports a marketplace plugin whose version differs from the package', () => {
        const text = JSON.stringify({ plugins: [{ name: 'sp', version: '9.9.9' }] });
        expect(
            findMarketplaceVersionDriftFrom(text, [{ label: 'plugins/sp/plugin.json', version: '0.3.41' }], '0.3.41'),
        ).toEqual(['marketplace plugin "sp": 9.9.9 (package is 0.3.41)']);
    });

    test('reports a plugin.json whose version differs from the package', () => {
        expect(
            findMarketplaceVersionDriftFrom(
                '{"plugins":[]}',
                [{ label: 'plugins/sp/plugin.json', version: '0.3.42' }],
                '0.3.41',
            ),
        ).toEqual(['plugins/sp/plugin.json: 0.3.42 (package is 0.3.41)']);
    });

    test('malformed marketplace JSON is a path-bearing error', () => {
        expect(() => findMarketplaceVersionDriftFrom('{nope', [], '1')).toThrow(/marketplace\.json is not valid JSON/);
    });
});

describe('checkVersionDrift (spur builder bump-ver --check)', () => {
    test('this repository: marketplace and plugin versions match the CLI package', async () => {
        const { output, errors } = capture();
        expect(await checkVersionDrift('spur', REPO_ROOT, output)).toBe(0);
        expect(errors).toEqual([]);
    });

    test('match → 0; drift → 1 naming each carrier; default target is the aggregate package', async () => {
        const ok = capture();
        expect(await checkVersionDrift('spur', mkWorkspace(), ok.output)).toBe(0);
        expect(ok.lines).toEqual(['Marketplace/plugin versions match package version.']);

        const bad = capture();
        expect(
            await checkVersionDrift(
                undefined,
                mkWorkspace({ pluginVersion: '1.0.0', marketplaceVersion: '0.9.0' }),
                bad.output,
            ),
        ).toBe(1);
        expect(bad.errors).toEqual([
            'Marketplace/plugin version drift:\n  marketplace plugin "sp": 0.9.0 (package is 1.2.3)\n  plugins/sp/plugin.json: 1.0.0 (package is 1.2.3)',
        ]);
    });

    test('no marketplace → nothing to check; unknown package → usage error', async () => {
        const none = capture();
        expect(await checkVersionDrift('spur', mkWorkspace({ marketplace: false }), none.output)).toBe(0);
        expect(none.lines[0]).toContain('nothing to check');
        await expect(checkVersionDrift('nope', mkWorkspace(), capture().output)).rejects.toThrow(
            /unknown package "nope"/,
        );
    });

    test('CLI wiring: --check exit codes, --json, and a stray version argument', async () => {
        const run = async (root: string, argv: string[]) => {
            let code = 0;
            const { output, lines, errors } = capture();
            const context = { cwd: root, output, setExitCode: (c: number) => (code = c) } as unknown as CliContext;
            const program = new Command();
            program.exitOverride();
            registerBuilderCommand(program, context);
            await program.parseAsync(argv, { from: 'user' });
            return { code, lines, errors };
        };
        expect((await run(mkWorkspace(), ['builder', 'bump-ver', '--check', 'spur'])).code).toBe(0);
        const drift = await run(mkWorkspace({ pluginVersion: '0.0.1' }), ['builder', 'bump-ver', '--check', '--json']);
        expect(drift.code).toBe(1);
        expect(JSON.parse(drift.lines.at(-1) ?? '{}')).toMatchObject({ ok: false, check: true, target: 'aggregate' });
        const stray = await run(mkWorkspace(), ['builder', 'bump-ver', '--check', 'spur', '1.0.0']);
        expect(stray.code).toBe(1);
        expect(stray.errors.join('\n')).toContain('takes only a package id');
    });
});

describe('resolvePublishRanges', () => {
    test('drops private workspace deps, pins public ones, resolves catalog, leaves others', () => {
        const manifest = {
            dependencies: { a: 'workspace:*', b: 'workspace:^', c: 'catalog:', d: '^1' },
            devDependencies: { c: 'catalog:' },
        };
        const ws = new Map([
            ['a', { private: true }],
            ['b', { version: '2.0.0', private: false }],
        ]);
        expect(resolvePublishRanges(manifest, ws, { c: '^9' })).toBe(4);
        expect(manifest).toEqual({ dependencies: { b: '^2.0.0', c: '^9', d: '^1' }, devDependencies: { c: '^9' } });
    });

    test('unknown workspace package, versionless public package, and missing catalog entry throw', () => {
        expect(() => resolvePublishRanges({ dependencies: { x: 'workspace:*' } }, new Map(), {})).toThrow(
            /not found: x/,
        );
        expect(() =>
            resolvePublishRanges({ dependencies: { x: 'workspace:*' } }, new Map([['x', { private: false }]]), {}),
        ).toThrow(/has no version: x/);
        expect(() => resolvePublishRanges({ dependencies: { y: 'catalog:' } }, new Map(), {})).toThrow(
            /catalog entry not found/,
        );
    });
});

describe('publishPackage (spur builder publish)', () => {
    function stubRunner(results: Record<string, { ok: boolean; stdout?: string; stderr?: string }>) {
        const calls: Array<{ cwd: string; cmd: string[]; manifest: string }> = [];
        const runner: PublishRunner = async (cwd, cmd) => {
            calls.push({ cwd, cmd, manifest: readFileSync(join(cwd, 'package.json'), 'utf8') });
            const r = results[cmd[0] ?? ''] ?? { ok: true };
            return { ok: r.ok, stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.ok ? 0 : 3 };
        };
        return { runner, calls };
    }

    test('resolves ranges, builds, publishes with --otp, and restores the manifest', async () => {
        const root = mkWorkspace();
        const before = readFileSync(join(root, 'apps/cli/package.json'), 'utf8');
        const { runner, calls } = stubRunner({ npm: { ok: true, stdout: '+ @demo/spur@1.2.3' } });
        const { output, lines } = capture();
        await publishPackage('apps/cli/', { repoRoot: root, otp: '123456', output, runner });
        expect(calls.map((c) => c.cmd)).toEqual([
            ['bun', 'run', 'build:bundle'],
            ['npm', 'publish', '--access', 'public', '--otp', '123456'],
        ]);
        expect(calls[0]?.cwd).toBe(join(root, 'apps/cli'));
        const published = JSON.parse(calls[1]?.manifest ?? '{}') as { dependencies: Record<string, string> };
        expect(published.dependencies).toEqual({ '@demo/pub': '^2.0.0', yaml: '^2.0.0', zod: '^3' });
        expect(lines).toEqual(['Resolved 3 workspace/catalog range(s)', '+ @demo/spur@1.2.3']);
        expect(readFileSync(join(root, 'apps/cli/package.json'), 'utf8')).toBe(before);
    });

    test('a build failure stops before npm publish and still restores the manifest', async () => {
        const root = mkWorkspace();
        const before = readFileSync(join(root, 'apps/cli/package.json'), 'utf8');
        const { runner, calls } = stubRunner({ bun: { ok: false, stderr: 'boom' } });
        const { output, errors } = capture();
        await expect(publishPackage(join(root, 'apps/cli'), { repoRoot: root, output, runner })).rejects.toThrow(
            'build:bundle failed (exit 3)',
        );
        expect(calls).toHaveLength(1);
        expect(errors).toEqual(['boom']);
        expect(readFileSync(join(root, 'apps/cli/package.json'), 'utf8')).toBe(before);
    });

    test('an npm publish failure is reported and restores the manifest', async () => {
        const root = mkWorkspace();
        const { runner } = stubRunner({ npm: { ok: false, stderr: 'E403' } });
        const { output, lines } = capture();
        await expect(publishPackage('apps/cli', { repoRoot: root, output, runner })).rejects.toThrow(
            'npm publish failed (exit 3)',
        );
        expect(lines.at(-1)).toBe('E403');
    });

    test('a manifest with nothing to resolve is published untouched; usage and missing-dir errors', async () => {
        const root = mkWorkspace();
        const { runner, calls } = stubRunner({});
        const { output, lines } = capture();
        await publishPackage('packages/pub', { repoRoot: root, output, runner });
        expect(calls).toHaveLength(2);
        expect(lines).toEqual([]);
        await expect(publishPackage(undefined)).rejects.toThrow(/usage: spur builder publish/);
        await expect(publishPackage('nope', { repoRoot: root, runner })).rejects.toThrow(/no package\.json/);
    });

    test('CLI wiring: a failure renders on stderr with exit 1', async () => {
        let code = 0;
        const { output, errors } = capture();
        const context = { cwd: mkWorkspace(), output, setExitCode: (c: number) => (code = c) } as unknown as CliContext;
        const program = new Command();
        program.exitOverride();
        registerBuilderCommand(program, context);
        await program.parseAsync(['builder', 'publish', 'does-not-exist', '--otp', '1'], { from: 'user' });
        expect(code).toBe(1);
        expect(errors.join('\n')).toContain('no package.json');
    });

    test('defaultPublishRunner reports exit status and output', async () => {
        const ok = await defaultPublishRunner(tmpdir(), ['sh', '-c', 'echo hi; echo err >&2']);
        expect(ok).toMatchObject({ ok: true, stdout: 'hi', stderr: 'err', exitCode: 0 });
        expect((await defaultPublishRunner(tmpdir(), ['sh', '-c', 'exit 4'])).ok).toBe(false);
    });
});
