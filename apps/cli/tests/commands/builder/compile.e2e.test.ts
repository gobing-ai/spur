import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { runCli } from '../../helpers';

test('a standalone binary carries config and rule seeds without source or sibling assets', async () => {
    const seedModule = join(import.meta.dir, '../../../../../packages/app/src/services/global-seed.ts');
    const runtime = Bun.resolveSync('@gobing-ai/ts-runtime', import.meta.dir);
    const configModule = Bun.resolveSync('@gobing-ai/spur-config', import.meta.dir);
    const fx = checkout({
        entry: [
            `import { createNodeFileSystem } from ${JSON.stringify(runtime)};`,
            `import { getEnvVars } from ${JSON.stringify(configModule)};`,
            `import { seedGlobalConfig, seedGlobalRules } from ${JSON.stringify(seedModule)};`,
            'const fs = createNodeFileSystem();',
            'const ctx = {cwd:process.cwd(),env:getEnvVars()};',
            'console.log(JSON.stringify({config:await seedGlobalConfig(fs,ctx),rules:await seedGlobalRules(fs,ctx)}));',
        ].join('\n'),
    });
    mkdirSync(join(fx.root, 'config', 'rules'), { recursive: true });
    mkdirSync(join(fx.root, 'config', 'workflows'), { recursive: true });
    mkdirSync(join(fx.root, 'config', 'fixtures'), { recursive: true });
    writeFileSync(join(fx.root, 'config', 'config.global.yaml'), '# embedded global\n');
    writeFileSync(join(fx.root, 'config', 'rules', 'seed.yaml'), '# embedded rule\n');
    writeFileSync(join(fx.root, 'config', 'workflows', 'seed.yaml'), '# embedded workflow\n');
    writeFileSync(join(fx.root, 'config', 'fixtures', 'not-shipped.yaml'), '# fixture\n');
    const built = await runCli(['builder', 'build-cli', '--source-root', fx.root, '--json'], fx.cwd, fx.env);
    expect(built.code, built.stdout).toBe(0);
    const target = join(fx.root, 'machine');
    const executed = Bun.spawnSync([join(fx.root, 'dist', 'cli', 'spur')], {
        cwd: tmpdir(),
        env: { ...fx.env, SPUR_GLOBAL_RULES_DIR: target },
    });
    expect(executed.exitCode, executed.stderr.toString()).toBe(0);
    const result = JSON.parse(executed.stdout.toString());
    expect(result.config.assetsFound).toBe(true);
    expect(result.rules.assetsFound).toBe(true);
    expect(readFileSync(join(target, 'config.yaml'), 'utf-8')).toContain('embedded global');
    expect(readFileSync(join(target, 'seed.yaml'), 'utf-8')).toContain('embedded rule');
    expect(existsSync(join(target, 'fixtures', 'not-shipped.yaml'))).toBe(false);
}, 60_000);

/**
 * `spur builder build-cli|build-server|build-binaries` (A93 1354 R1/R2/R4).
 *
 * Failure modes first — each one would silently corrupt a checkout:
 *   - a bad `--source-root` accepted instead of refused before any mutation
 *   - the ts-runtime patch left applied (or its lock left behind) after a failed build
 *   - the laya patch acquisition failing after the ts-runtime patch, stranding that patch
 *   - a compiler non-zero exit reported as success
 *   - a concurrent build not refused by the single compile lock
 *   - the wrong checkout patched (the running package instead of `--source-root`)
 */

const TS_RUNTIME_DIST = `
const moduleSpecifier = '@gobing-ai/ts-db';
export async function load() { return await import(moduleSpecifier); }
`;

const DECISION_SERVICE = `
const layaSpecifier = '@gobing-ai/ts-laya-mlx';
export async function loadLaya() { return await import(layaSpecifier); }
`;

interface Fixture {
    root: string;
    cwd: string;
    env: Record<string, string | undefined>;
    distFile: string;
    decisionFile: string;
    cleanup: () => void;
}

/**
 * A disposable Spur-shaped checkout: just the markers the service validates, a fake ts-runtime dist
 * with the variable specifier, and a decision service the laya patch can rewrite.
 */
function checkout(options: { layaInstalled?: boolean; layaFile?: string; entry?: string } = {}): Fixture {
    const root = mkdtempSync(join(tmpdir(), 'spur-build-'));
    const dist = join(root, 'node_modules', '@gobing-ai', 'ts-runtime', 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(
        join(root, 'node_modules', '@gobing-ai', 'ts-runtime', 'package.json'),
        JSON.stringify({ name: '@gobing-ai/ts-runtime', version: '0.0.0', main: 'dist/runtime-node-bun.js' }),
    );
    const distFile = join(dist, 'runtime-node-bun.js');
    writeFileSync(distFile, TS_RUNTIME_DIST);

    mkdirSync(join(root, 'apps', 'cli', 'src'), { recursive: true });
    mkdirSync(join(root, 'apps', 'server', 'src'), { recursive: true });
    mkdirSync(join(root, 'packages', 'app', 'src', 'decision'), { recursive: true });
    writeFileSync(join(root, 'apps', 'cli', 'package.json'), JSON.stringify({ name: 'cli', dependencies: {} }));
    writeFileSync(join(root, 'packages', 'app', 'package.json'), JSON.stringify({ name: 'app' }));
    writeFileSync(join(root, 'apps', 'cli', 'src', 'index.ts'), options.entry ?? 'console.log("cli");\n');
    writeFileSync(join(root, 'apps', 'server', 'src', 'index.ts'), options.entry ?? 'console.log("server");\n');
    const decisionFile = join(root, 'packages', 'app', 'src', 'decision', 'decision-service.ts');
    writeFileSync(decisionFile, options.layaFile ?? DECISION_SERVICE);
    if (options.layaInstalled === true) {
        const laya = join(root, 'node_modules', '@gobing-ai', 'ts-laya-mlx');
        mkdirSync(laya, { recursive: true });
        writeFileSync(join(laya, 'package.json'), JSON.stringify({ name: '@gobing-ai/ts-laya-mlx', version: '0.0.0' }));
    }
    return {
        root,
        cwd: root,
        env: { ...getEnvVars() },
        distFile,
        decisionFile,
        cleanup: () => {},
    };
}

const lockPath = (fx: Fixture): string => `${fx.distFile}.spur-compile.lock`;

describe('spur builder build-cli — source root validation', () => {
    test('validation bypasses database boot and unrelated malformed project configuration', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-build-no-boot-'));
        mkdirSync(join(dir, '.spur'));
        writeFileSync(join(dir, '.spur', 'config.yaml'), 'invalid: [unterminated');
        const result = await runCli(['builder', 'build-cli', '--source-root', dir, '--json'], dir);
        expect(result.code).toBe(1);
        expect(result.json).toMatchObject({ error: { code: 'build' } });
        expect(existsSync(join(dir, '.spur', 'spur.db'))).toBe(false);
    });

    test('a directory that is not a Spur checkout is refused before any mutation', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-not-a-checkout-'));
        const result = await runCli(['builder', 'build-cli', '--source-root', dir, '--json'], dir);
        expect(result.code).toBe(1);
        const payload = result.json as { error: { code: string; message: string } };
        expect(payload.error.code).toBe('build');
        expect(payload.error.message).toContain('not a Spur source checkout');
    });
});

describe('spur builder build-cli — lock and restoration', () => {
    test('a concurrent build is refused by the single compile lock and leaves the tree untouched', async () => {
        const fx = checkout();
        try {
            writeFileSync(lockPath(fx), 'other-pid');
            const result = await runCli(['builder', 'build-cli', '--source-root', fx.root, '--json'], fx.cwd, fx.env);
            expect(result.code).toBe(1);
            const payload = result.json as { error: { message: string } };
            expect(payload.error.message).toContain('another compiled build holds');
            // The pre-existing lock is not ours to remove, and no patch was applied.
            expect(existsSync(lockPath(fx))).toBe(true);
            expect(readFileSync(fx.distFile, 'utf-8')).toBe(TS_RUNTIME_DIST);
        } finally {
            fx.cleanup();
        }
    });

    test('a second patch acquisition failure restores the first patch and releases the lock', async () => {
        // The decision service carries no laya variable specifier, so the laya patch throws AFTER
        // the ts-runtime patch was already applied.
        const fx = checkout({ layaInstalled: true, layaFile: 'export const nothing = 1;\n' });
        try {
            const result = await runCli(['builder', 'build-cli', '--source-root', fx.root, '--json'], fx.cwd, fx.env);
            expect(result.code).toBe(1);
            const payload = result.json as { error: { message: string } };
            expect(payload.error.message).toContain('no variable-specifier ts-laya-mlx import');
            expect(readFileSync(fx.distFile, 'utf-8')).toBe(TS_RUNTIME_DIST);
            expect(readFileSync(fx.decisionFile, 'utf-8')).toBe('export const nothing = 1;\n');
            expect(existsSync(lockPath(fx))).toBe(false);
        } finally {
            fx.cleanup();
        }
    });

    test('a compiler failure restores both patches and reports nonzero', async () => {
        const broken = 'export const = ;\n';
        const fx = checkout({ layaInstalled: true, entry: broken });
        try {
            const result = await runCli(
                ['builder', 'build-server', '--source-root', fx.root, '--json'],
                fx.cwd,
                fx.env,
            );
            expect(result.code).toBe(1);
            expect(readFileSync(fx.distFile, 'utf-8')).toBe(TS_RUNTIME_DIST);
            expect(readFileSync(fx.decisionFile, 'utf-8')).toBe(DECISION_SERVICE);
            expect(existsSync(lockPath(fx))).toBe(false);
        } finally {
            fx.cleanup();
        }
    }, 20_000);
});

describe('spur builder build-cli — cold checkout artifact', () => {
    test('a host-native build produces the binary and restores both patches', async () => {
        const fx = checkout({ layaInstalled: true });
        try {
            const result = await runCli(['builder', 'build-cli', '--source-root', fx.root, '--json'], fx.cwd, fx.env);
            const payload = result.json as { ok: boolean; artifacts: { path: string }[]; diagnostics: unknown[] };
            expect(result.code, JSON.stringify(payload)).toBe(0);
            expect(payload.ok).toBe(true);
            const binary = join(fx.root, 'dist', 'cli', 'spur');
            expect(payload.artifacts.some((artifact) => artifact.path === binary)).toBe(true);
            expect(existsSync(binary)).toBe(true);
            expect(payload.diagnostics.length).toBeGreaterThan(0);
            // Restoration is the contract: the checkout is unchanged after a successful build.
            expect(readFileSync(fx.distFile, 'utf-8')).toBe(TS_RUNTIME_DIST);
            expect(readFileSync(fx.decisionFile, 'utf-8')).toBe(DECISION_SERVICE);
            expect(existsSync(lockPath(fx))).toBe(false);
        } finally {
            fx.cleanup();
        }
    }, 60_000);
});
