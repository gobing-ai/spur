import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveBundledConfigRoot } from '@gobing-ai/spur-config/bundled-config';
import { BOARD_FACADE_SPECIFIERS } from '@gobing-ai/spur-contracts';
import { runCli } from '../../helpers';

/**
 * `spur builder bundle-config|bundle-web|verify-pack` (A93 1355 R1-R4).
 *
 * Failure modes first — each one is a way packaging could ship or destroy the wrong bytes:
 *   - the destructive target wipe deleting the source it is copying from
 *   - a custom (unbuilt) web source silently auto-building instead of reporting its missing index
 *   - extraction following an archive link, or writing outside the private temp dir
 *   - versions compared against the verifier's checkout instead of the archive
 *   - a "verified" result for an archive that could not be inspected
 */

interface Fixture {
    root: string;
    cwd: string;
    /** Explicit PATH: the suite's hermetic env has no `bun`, which the child CLI needs to spawn. */
    env: Record<string, string | undefined>;
    cleanup: () => Promise<void>;
}

async function fixture(): Promise<Fixture> {
    const root = mkdtempSync(join(tmpdir(), 'spur-artifacts-'));
    const cwd = join(root, 'work');
    await mkdir(cwd, { recursive: true });
    return {
        root,
        cwd,
        env: { PATH: [dirname(process.execPath), '/usr/bin', '/bin'].join(':') },
        cleanup: () => rm(root, { recursive: true, force: true }),
    };
}

/** A minimal checkout with a `config/` tree the bundle verb can stage. */
async function checkout(root: string): Promise<string> {
    const repo = join(root, 'checkout');
    // Every artifact verb validates the source root as a Spur checkout before touching anything.
    await mkdir(join(repo, 'apps', 'cli'), { recursive: true });
    await mkdir(join(repo, 'packages', 'app'), { recursive: true });
    await writeFile(join(repo, 'apps', 'cli', 'package.json'), JSON.stringify({ name: 'cli' }));
    await writeFile(join(repo, 'packages', 'app', 'package.json'), JSON.stringify({ name: 'app' }));
    await mkdir(join(repo, 'config', 'workflows'), { recursive: true });
    await mkdir(join(repo, 'config', 'fixtures', 'rule'), { recursive: true });
    await writeFile(join(repo, 'config', 'SENTINEL.txt'), 'source sentinel\n');
    await writeFile(join(repo, 'config', 'workflows', 'plain.yaml'), 'kind: state-machine\n');
    await writeFile(join(repo, 'config', 'fixtures', 'rule', 'junk.yaml'), 'junk: true\n');
    return repo;
}

describe('spur builder bundle-config', () => {
    test('stages the tree, injects schemas, prunes authoring fixtures', async () => {
        const fx = await fixture();
        try {
            const repo = await checkout(fx.root);
            const out = join(fx.root, 'out');
            const result = await runCli(
                ['builder', 'bundle-config', out, '--source-root', repo, '--json'],
                fx.cwd,
                fx.env,
            );
            expect(result.code, result.stderr).toBe(0);
            const payload = result.json as { ok: boolean; artifacts: { path: string; kind: string }[] };
            expect(payload.ok).toBe(true);
            const bundled = await readFile(join(out, 'workflows', 'plain.yaml'), 'utf-8');
            expect(bundled.startsWith('$schema: "')).toBe(true);
            expect(existsSync(join(out, 'fixtures'))).toBe(false);
        } finally {
            await fx.cleanup();
        }
    });

    test('refuses a target that contains the source and leaves the source intact', async () => {
        const fx = await fixture();
        try {
            const repo = await checkout(fx.root);
            const result = await runCli(
                ['builder', 'bundle-config', repo, '--source-root', repo, '--json'],
                fx.cwd,
                fx.env,
            );
            expect(result.code).toBe(1);
            const payload = result.json as { error: { message: string } };
            expect(payload.error.message).toContain('refusing to replace');
            expect(await readFile(join(repo, 'config', 'SENTINEL.txt'), 'utf-8')).toBe('source sentinel\n');
        } finally {
            await fx.cleanup();
        }
    });
});

describe('spur builder bundle-web', () => {
    /** A minimal valid board distribution: import map before the module script + runtime manifest. */
    async function boardDist(repo: string, options: { withManifest?: boolean } = {}): Promise<void> {
        const dist = join(repo, 'dist', 'web');
        await mkdir(join(dist, 'assets'), { recursive: true });
        await writeFile(join(dist, 'assets', 'facade.js'), 'export const react = 1;\n');
        // Every advertised facade specifier must map to a real asset, so build the map from the
        // contract's own list rather than hand-copying it.
        const imports: Record<string, string> = {};
        for (const specifier of BOARD_FACADE_SPECIFIERS) imports[specifier] = '/assets/facade.js';
        await writeFile(
            join(dist, 'index.html'),
            `<script type="importmap">${JSON.stringify({ imports })}</script><script type="module" src="/assets/app.js"></script>`,
        );
        if (options.withManifest === false) return;
        await writeFile(
            join(dist, 'board-runtime.json'),
            JSON.stringify({
                manifestVersion: 1,
                catalogVersion: 1,
                contributionApiVersion: 1,
                reactVersion: '19.0.0',
                reactDomVersion: '19.0.0',
                reactRouterVersion: '7.0.0',
                uiKitVersion: '1.0.0',
                reservedModules: [],
                imports,
            }),
        );
    }

    test('a built board is staged into the CLI package tree', async () => {
        const fx = await fixture();
        try {
            const repo = await checkout(fx.root);
            await boardDist(repo);
            const result = await runCli(['builder', 'bundle-web', '--source-root', repo, '--json'], fx.cwd, fx.env);
            expect(result.code, result.stderr).toBe(0);
            expect(existsSync(join(repo, 'apps', 'cli', 'web', 'index.html'))).toBe(true);
            expect(existsSync(join(repo, 'apps', 'cli', 'web', 'board-runtime.json'))).toBe(true);
        } finally {
            await fx.cleanup();
        }
    });

    test('a board without the runtime manifest is refused before the target is touched', async () => {
        const fx = await fixture();
        try {
            const repo = await checkout(fx.root);
            await boardDist(repo, { withManifest: false });
            const result = await runCli(['builder', 'bundle-web', '--source-root', repo, '--json'], fx.cwd, fx.env);
            expect(result.code).toBe(1);
            expect((result.json as { error: { message: string } }).error.message).toContain(
                'board-runtime.json is missing',
            );
            expect(existsSync(join(repo, 'apps', 'cli', 'web'))).toBe(false);
        } finally {
            await fx.cleanup();
        }
    });
});

describe('spur builder verify-pack', () => {
    /** Build a real tarball from a `package/` tree. */
    async function archive(root: string, entries: Record<string, string>): Promise<string> {
        const pkg = join(root, 'package');
        for (const [rel, content] of Object.entries(entries)) {
            await mkdir(dirname(join(pkg, rel)), { recursive: true });
            await writeFile(join(pkg, rel), content);
        }
        const tarball = join(root, 'pkg.tgz');
        const result = Bun.spawnSync(['tar', '-czf', tarball, '-C', root, 'package']);
        expect(result.exitCode, result.stderr.toString()).toBe(0);
        return tarball;
    }

    const entries = (version: string) => ({
        'package.json': JSON.stringify({ version }),
        'plugins/sp/plugin.json': JSON.stringify({ version }),
        '.claude-plugin/marketplace.json': JSON.stringify({
            plugins: [{ name: 'sp', source: './plugins/sp', version }],
        }),
        'plugins/sp/README.md': '# sp\n',
    });

    test('a valid archive verifies using the archive’s own version', async () => {
        const fx = await fixture();
        try {
            // Deliberately a version this checkout's package.json does NOT carry: the archive owns it.
            const tarball = await archive(fx.root, entries('123.456.789'));
            const result = await runCli(['builder', 'verify-pack', tarball, '--json'], fx.cwd, fx.env);
            expect(result.code, result.stderr).toBe(0);
            const payload = result.json as { ok: boolean; artifacts: { kind: string }[] };
            expect(payload.ok).toBe(true);
            expect(payload.artifacts[0]?.kind).toContain('123.456.789');
        } finally {
            await fx.cleanup();
        }
    });

    test('a link member is refused before extraction', async () => {
        const fx = await fixture();
        try {
            const pkg = join(fx.root, 'package');
            await mkdir(join(pkg, 'plugins', 'sp'), { recursive: true });
            await writeFile(join(pkg, 'package.json'), JSON.stringify({ version: '1.0.0' }));
            symlinkSync('/etc/passwd', join(pkg, 'plugins', 'leak'));
            const tarball = join(fx.root, 'pkg.tgz');
            expect(Bun.spawnSync(['tar', '-czf', tarball, '-C', fx.root, 'package']).exitCode).toBe(0);
            const result = await runCli(['builder', 'verify-pack', tarball, '--json'], fx.cwd, fx.env);
            expect(result.code).toBe(1);
            const payload = result.json as { error: { message: string } };
            expect(payload.error.message).toContain('refusing link member');
        } finally {
            await fx.cleanup();
        }
    });

    test('an uninspectable archive fails instead of falling back to extraction', async () => {
        const fx = await fixture();
        try {
            const bogus = join(fx.root, 'not-a-tarball.tgz');
            writeFileSync(bogus, 'definitely not an archive');
            const result = await runCli(['builder', 'verify-pack', bogus, '--json'], fx.cwd, fx.env);
            expect(result.code).toBe(1);
            const payload = result.json as { error: { message: string } };
            expect(payload.error.message).toContain('cannot inspect archive');
        } finally {
            await fx.cleanup();
        }
    });

    test('a plugin version that disagrees with the archive manifest fails', async () => {
        const fx = await fixture();
        try {
            const tarball = await archive(fx.root, {
                ...entries('2.0.0'),
                'plugins/sp/plugin.json': JSON.stringify({ version: '1.0.0' }),
            });
            const result = await runCli(['builder', 'verify-pack', tarball, '--json'], fx.cwd, fx.env);
            expect(result.code).toBe(1);
            expect((result.json as { error: { message: string } }).error.message).toContain(
                'plugin.json version 1.0.0 != archive package 2.0.0',
            );
        } finally {
            await fx.cleanup();
        }
    });

    test('no temp extraction directory is left behind', async () => {
        const fx = await fixture();
        try {
            const tarball = await archive(fx.root, entries('1.0.0'));
            const before = (await readdir(tmpdir())).filter((name) => name.startsWith('spur-verify-')).length;
            await runCli(['builder', 'verify-pack', tarball, '--json'], fx.cwd, fx.env);
            const after = (await readdir(tmpdir())).filter((name) => name.startsWith('spur-verify-')).length;
            expect(after).toBe(before);
        } finally {
            await fx.cleanup();
        }
    });

    test('a path outside the invocation cwd is rejected for a missing file', async () => {
        const fx = await fixture();
        try {
            const result = await runCli(['builder', 'verify-pack', 'missing.tgz', '--json'], fx.cwd, fx.env);
            expect(result.code).toBe(1);
            expect((result.json as { error: { message: string } }).error.message).toContain('cannot inspect archive');
        } finally {
            await fx.cleanup();
        }
    });
});

/**
 * A94 1410 — the four staging/generator verbs that moved out of `scripts/commands/` into
 * `packages/app/src/builder` and became `spur builder <verb>`.
 */
describe('spur builder bundle-plugins', () => {
    test('stages both trees, prunes test content, and reports both artifacts', async () => {
        const fx = await fixture();
        try {
            const repo = await checkout(fx.root);
            await mkdir(join(repo, 'plugins', 'sp', 'skills', 'dev-plan'), { recursive: true });
            await writeFile(
                join(repo, 'plugins', 'sp', 'plugin.json'),
                JSON.stringify({ name: 'sp', version: '0.1.0' }),
            );
            await writeFile(join(repo, 'plugins', 'sp', 'skills', 'dev-plan', 'SKILL.md'), '# skill\n');
            await writeFile(join(repo, 'plugins', 'sp', 'hooks.test.ts'), '// pruned\n');
            await mkdir(join(repo, 'plugins', 'sp', 'tests'), { recursive: true });
            await writeFile(join(repo, 'plugins', 'sp', 'tests', 'fixture.ts'), '// pruned\n');
            await mkdir(join(repo, '.claude-plugin'), { recursive: true });
            await writeFile(join(repo, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'demo' }));

            const result = await runCli(['builder', 'bundle-plugins', '--source-root', repo, '--json'], fx.cwd, fx.env);
            expect(result.code, result.stderr).toBe(0);
            const payload = result.json as { ok: boolean; artifacts: { path: string; kind: string }[] };
            expect(payload.ok).toBe(true);
            expect(payload.artifacts.map((artifact) => artifact.kind)).toEqual(['plugins', 'marketplace']);
            expect(existsSync(join(repo, 'apps', 'cli', 'plugins', 'sp', 'plugin.json'))).toBe(true);
            expect(existsSync(join(repo, 'apps', 'cli', 'plugins', 'sp', 'skills', 'dev-plan', 'SKILL.md'))).toBe(true);
            expect(existsSync(join(repo, 'apps', 'cli', 'plugins', 'sp', 'hooks.test.ts'))).toBe(false);
            expect(existsSync(join(repo, 'apps', 'cli', 'plugins', 'sp', 'tests'))).toBe(false);
            expect(existsSync(join(repo, 'apps', 'cli', '.claude-plugin', 'marketplace.json'))).toBe(true);
        } finally {
            await fx.cleanup();
        }
    });
});

describe('spur builder bundle-laya-worker', () => {
    // The worker package is a darwin-only optional dependency (ADR-041): absent on Linux/Windows CI.
    const hasLayaMlx = (() => {
        try {
            Bun.resolveSync('@gobing-ai/ts-laya-mlx', join(import.meta.dir, '../../../../../packages/app'));
            return true;
        } catch {
            return false;
        }
    })();

    test.skipIf(!hasLayaMlx)('stages the installed worker into the CLI package tree', async () => {
        const fx = await fixture();
        try {
            const repo = await checkout(fx.root);
            const result = await runCli(
                ['builder', 'bundle-laya-worker', '--source-root', repo, '--json'],
                fx.cwd,
                fx.env,
            );
            expect(result.code, result.stderr).toBe(0);
            const payload = result.json as { ok: boolean; artifacts: { path: string; kind: string }[] };
            expect(payload.artifacts[0]).toEqual({
                path: join(repo, 'apps', 'cli', 'worker', 'laya_worker.py'),
                kind: 'worker',
            });
            const workerPath = join(repo, 'apps', 'cli', 'worker', 'laya_worker.py');
            expect(await readFile(workerPath, 'utf-8')).toContain('laya_mlx');
        } finally {
            await fx.cleanup();
        }
    });
});

describe('spur builder emit-board-types and emit-migration-sql', () => {
    test('regenerating this checkout reproduces the committed artifacts byte for byte', async () => {
        // The real checkout is the subject: these generators read its authoring sources and must
        // report `unchanged`, which is the drift proof for the move out of scripts/commands.
        const repo = join(import.meta.dir, '../../../../..');
        const fx = await fixture();
        try {
            const board = await runCli(
                ['builder', 'emit-board-types', '--source-root', repo, '--json'],
                fx.cwd,
                fx.env,
            );
            expect(board.code, board.stderr).toBe(0);
            const boardPayload = board.json as { ok: boolean; artifacts: { path: string; kind: string }[] };
            expect(boardPayload.ok).toBe(true);
            expect(boardPayload.artifacts).toHaveLength(2);
            for (const artifact of boardPayload.artifacts) expect(artifact.kind).toEndWith(':unchanged');

            const sql = await runCli(
                ['builder', 'emit-migration-sql', '--source-root', repo, '--json'],
                fx.cwd,
                fx.env,
            );
            expect(sql.code, sql.stderr).toBe(0);
            const sqlPayload = sql.json as { ok: boolean; artifacts: { kind: string }[] };
            expect(sqlPayload.artifacts[0]?.kind).toBe('migration-sql:unchanged');
        } finally {
            await fx.cleanup();
        }
    });
});

describe('spur builder artifact verbs outside a checkout', () => {
    test('each refuses a non-Spur source root with exit 1 before writing', async () => {
        const fx = await fixture();
        try {
            for (const verb of ['bundle-plugins', 'bundle-laya-worker', 'emit-board-types', 'emit-migration-sql']) {
                const result = await runCli(['builder', verb, '--source-root', fx.cwd, '--json'], fx.cwd, fx.env);
                expect([verb, result.code]).toEqual([verb, 1]);
                expect(JSON.stringify(result.json)).toContain('not a Spur source checkout');
            }
        } finally {
            await fx.cleanup();
        }
    });
});

describe('source CLI boot without the generated config bundle (1410 R1)', () => {
    test('config resolution reaches the tracked config/ tree from the config package source', () => {
        const repo = join(import.meta.dir, '../../../../..');
        expect(resolveBundledConfigRoot(join(repo, 'packages', 'config', 'src'), process.execPath)).toBe(
            join(repo, 'config'),
        );
    });
});
