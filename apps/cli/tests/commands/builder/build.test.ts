import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { BOARD_FACADE_SPECIFIERS } from '@gobing-ai/spur-contracts';
import { main } from '../../../src';

/**
 * `spur builder build-*` transport (A93 1354 R1): one grammar for three artifacts, `--source-root`
 * validation, structured JSON on failure, and a nonzero exit. The compile behaviour itself is owned
 * by `packages/app/tests/builder/compile.test.ts` and the subprocess E2E (`compile.e2e.test.ts`).
 */
describe('spur builder build-* transport', () => {
    test('each verb is registered with --source-root and the shared JSON flags', async () => {
        const messages: string[] = [];
        const code = await main(['builder', 'build-cli', '--help'], {
            cwd: tmpdir(),
            env: getEnvVars(),
            output: { write: (m) => messages.push(m), error: (m) => messages.push(m) },
        });
        const help = messages.join('\n');
        expect(code).toBe(0);
        expect(help).toContain('--source-root <dir>');
        expect(help).toContain('--json');
        expect(help).toContain('--json-envelope');
    });

    test('a non-checkout source root fails with a structured build error', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-builder-transport-'));
        writeFileSync(join(dir, 'package.json'), '{"name":"not-spur"}');
        const messages: string[] = [];
        const code = await main(['builder', 'build-server', '--source-root', dir, '--json'], {
            cwd: dir,
            env: getEnvVars(),
            output: { write: (m) => messages.push(m), error: (m) => messages.push(m) },
        });
        expect(code).toBe(1);
        const payload = JSON.parse(messages.at(-1) ?? '{}') as {
            error: { code: string; message: string; sourceRoot: string };
        };
        expect(payload.error.code).toBe('build');
        expect(payload.error.sourceRoot).toBe(dir);
        expect(payload.error.message).toContain('not a Spur source checkout');
    });
});

/** A minimal Spur-checkout fixture the artifact verbs accept as `--source-root`. */
function checkoutFixture(): string {
    const repo = mkdtempSync(join(tmpdir(), 'spur-builder-artifacts-'));
    mkdirSync(join(repo, 'apps', 'cli'), { recursive: true });
    mkdirSync(join(repo, 'packages', 'app'), { recursive: true });
    mkdirSync(join(repo, 'config', 'workflows'), { recursive: true });
    writeFileSync(join(repo, 'apps', 'cli', 'package.json'), '{"name":"cli"}');
    writeFileSync(join(repo, 'packages', 'app', 'package.json'), '{"name":"app"}');
    writeFileSync(join(repo, 'config', 'workflows', 'plain.yaml'), 'kind: state-machine\n');
    return repo;
}

describe('spur builder artifact verbs', () => {
    async function run(args: string[]): Promise<{ code: number; messages: string[] }> {
        const messages: string[] = [];
        const code = await main(args, {
            cwd: tmpdir(),
            env: getEnvVars(),
            output: { write: (m) => messages.push(m), error: (m) => messages.push(m) },
        });
        return { code, messages };
    }

    test('bundle-config stages a checkout and reports its artifacts as JSON', async () => {
        const repo = checkoutFixture();
        const out = join(repo, 'dist', 'config');
        const { code, messages } = await run(['builder', 'bundle-config', out, '--source-root', repo, '--json']);
        expect(code, messages.join('\n')).toBe(0);
        const payload = JSON.parse(messages.at(-1) ?? '{}') as { ok: boolean; artifacts: { kind: string }[] };
        expect(payload.ok).toBe(true);
        expect(payload.artifacts[0]?.kind).toContain('1 schema directive');
    });

    test('bundle-config renders a text line per artifact', async () => {
        const repo = checkoutFixture();
        const { code, messages } = await run([
            'builder',
            'bundle-config',
            join(repo, 'dist', 'config'),
            '--source-root',
            repo,
        ]);
        expect(code).toBe(0);
        expect(messages.join('\n')).toContain('ok');
    });

    test('an overlap refusal exits 1 with the artifact error code', async () => {
        const repo = checkoutFixture();
        const { code, messages } = await run(['builder', 'bundle-config', repo, '--source-root', repo, '--json']);
        expect(code).toBe(1);
        const payload = JSON.parse(messages.at(-1) ?? '{}') as { error: { code: string; message: string } };
        expect(payload.error.code).toBe('artifact');
        expect(payload.error.message).toContain('refusing to replace');
    });

    test('bundle-web reports a board without a distribution instead of copying', async () => {
        const repo = checkoutFixture();
        const { code, messages } = await run(['builder', 'bundle-web', '--source-root', repo, '--json']);
        expect(code).toBe(1);
        const payload = JSON.parse(messages.at(-1) ?? '{}') as { error: { message: string } };
        // No `dist/web` → the default-source auto-build runs and fails in this fixture checkout.
        expect(payload.error.message.length).toBeGreaterThan(0);
    }, 20_000);

    test('verify-pack inspects an artifact without needing a checkout', async () => {
        const { code, messages } = await run(['builder', 'verify-pack', 'does-not-exist.tgz', '--json']);
        expect(code).toBe(1);
        expect((JSON.parse(messages.at(-1) ?? '{}') as { error: { message: string } }).error.message).toContain(
            'cannot inspect archive',
        );
    });
});

describe('spur builder artifact verbs — success paths', () => {
    async function run(args: string[]): Promise<{ code: number; messages: string[] }> {
        const messages: string[] = [];
        const code = await main(args, {
            cwd: tmpdir(),
            env: getEnvVars(),
            output: { write: (m) => messages.push(m), error: (m) => messages.push(m) },
        });
        return { code, messages };
    }

    test('bundle-web stages a built board into the CLI package tree', async () => {
        const repo = checkoutFixture();
        const dist = join(repo, 'dist', 'web');
        mkdirSync(join(dist, 'assets'), { recursive: true });
        writeFileSync(join(dist, 'assets', 'facade.js'), 'export const react = 1;\n');
        const imports: Record<string, string> = {};
        for (const specifier of BOARD_FACADE_SPECIFIERS) imports[specifier] = '/assets/facade.js';
        writeFileSync(
            join(dist, 'index.html'),
            `<script type="importmap">${JSON.stringify({ imports })}</script><script type="module" src="/assets/app.js"></script>`,
        );
        writeFileSync(
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
        const { code, messages } = await run(['builder', 'bundle-web', '--source-root', repo, '--json']);
        expect(code, messages.join('\n')).toBe(0);
        const payload = JSON.parse(messages.at(-1) ?? '{}') as { artifacts: { kind: string }[] };
        expect(payload.artifacts[0]?.kind).toBe('web');
    }, 20_000);

    test('verify-pack verifies a real tarball and reports the archive version', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-builder-pack-'));
        const pkg = join(root, 'package');
        mkdirSync(join(pkg, 'plugins', 'sp'), { recursive: true });
        mkdirSync(join(pkg, '.claude-plugin'), { recursive: true });
        writeFileSync(join(pkg, 'package.json'), JSON.stringify({ version: '5.5.5' }));
        writeFileSync(join(pkg, 'plugins', 'sp', 'plugin.json'), JSON.stringify({ version: '5.5.5' }));
        writeFileSync(
            join(pkg, '.claude-plugin', 'marketplace.json'),
            JSON.stringify({ plugins: [{ name: 'sp', source: './plugins/sp', version: '5.5.5' }] }),
        );
        const tarball = join(root, 'pkg.tgz');
        expect(Bun.spawnSync(['tar', '-czf', tarball, '-C', root, 'package']).exitCode).toBe(0);

        const { code, messages } = await run(['builder', 'verify-pack', tarball, '--json']);
        expect(code, messages.join('\n')).toBe(0);
        const payload = JSON.parse(messages.at(-1) ?? '{}') as { artifacts: { kind: string }[] };
        expect(payload.artifacts[0]?.kind).toContain('5.5.5');
    }, 20_000);
});
