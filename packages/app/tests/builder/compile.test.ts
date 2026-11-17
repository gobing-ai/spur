import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseAssetNames, writeSha256Sums } from '../../src/builder/binaries';
import {
    BuildError,
    type BuildRunner,
    buildCli,
    buildCompiledBinary,
    buildOutputPath,
    buildServer,
    layaMlxInstalled,
    patchLayaMlxSourceImport,
    patchTsRuntimeImport,
    resolveSourceRoot,
} from '../../src/builder/compile';

/**
 * Compile service internals (A93 1354 R2/R3). The decision rules under test are the ones a failed
 * build depends on: refuse a non-checkout, one lock, both patches restored even when the second
 * acquisition throws, and reviews resolved from the *given* checkout.
 */
const DIST =
    "const moduleSpecifier = '@gobing-ai/ts-db';\nexport async function load() { return await import(moduleSpecifier); }\n";
const DECISION =
    "const spec = '@gobing-ai/ts-laya-mlx';\nexport async function load() { return await import(spec); }\n";

function checkout(options: { laya?: boolean; decision?: string } = {}): string {
    const root = mkdtempSync(join(tmpdir(), 'spur-compile-unit-'));
    const dist = join(root, 'node_modules', '@gobing-ai', 'ts-runtime', 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(root, 'node_modules', '@gobing-ai', 'ts-runtime', 'package.json'), '{"name":"x","main":"m"}');
    writeFileSync(join(dist, 'runtime-node-bun.js'), DIST);
    mkdirSync(join(root, 'apps', 'cli', 'src'), { recursive: true });
    mkdirSync(join(root, 'apps', 'server', 'src'), { recursive: true });
    mkdirSync(join(root, 'packages', 'app', 'src', 'decision'), { recursive: true });
    writeFileSync(join(root, 'apps', 'cli', 'package.json'), '{}');
    writeFileSync(join(root, 'packages', 'app', 'package.json'), '{}');
    writeFileSync(join(root, 'apps', 'cli', 'src', 'index.ts'), 'console.log(1);\n');
    writeFileSync(join(root, 'apps', 'server', 'src', 'index.ts'), 'console.log(2);\n');
    writeFileSync(
        join(root, 'packages', 'app', 'src', 'decision', 'decision-service.ts'),
        options.decision ?? DECISION,
    );
    if (options.laya === true) {
        mkdirSync(join(root, 'node_modules', '@gobing-ai', 'ts-laya-mlx'), { recursive: true });
        writeFileSync(join(root, 'node_modules', '@gobing-ai', 'ts-laya-mlx', 'package.json'), '{"name":"laya"}');
    }
    return root;
}

const distPath = (root: string): string =>
    join(root, 'node_modules', '@gobing-ai', 'ts-runtime', 'dist', 'runtime-node-bun.js');

const okRunner =
    (seen: string[][] = []): BuildRunner =>
    async (command, args) => {
        seen.push([command, ...args]);
        return { command, args: [...args], exitCode: 0, stdout: 'built', stderr: '' };
    };

describe('resolveSourceRoot', () => {
    test('relative roots resolve from the invocation cwd; a non-checkout is refused', () => {
        const root = checkout();
        expect(resolveSourceRoot('.', root)).toBe(root);
        expect(resolveSourceRoot(root, '/')).toBe(root);
        expect(() => resolveSourceRoot('.', tmpdir())).toThrow(BuildError);
    });
});

describe('patches', () => {
    test('the ts-runtime patch is exclusive and always restorable', () => {
        const root = checkout();
        const restore = patchTsRuntimeImport(root);
        const lock = `${distPath(root)}.spur-compile.lock`;
        expect(existsSync(lock)).toBe(true);
        expect(readFileSync(distPath(root), 'utf-8')).toContain("await import('@gobing-ai/ts-db')");
        expect(() => patchTsRuntimeImport(root)).toThrow('another compiled build holds');
        restore();
        expect(existsSync(lock)).toBe(false);
        expect(readFileSync(distPath(root), 'utf-8')).toBe(DIST);
    });

    test('the laya patch throws when the shape is gone instead of silently compiling', () => {
        const root = checkout({ decision: 'export const nothing = 1;\n' });
        expect(() => patchLayaMlxSourceImport(root)).toThrow('no variable-specifier');
    });

    test('layaMlxInstalled reflects the given checkout, not the running package', () => {
        expect(layaMlxInstalled(checkout())).toBe(false);
        expect(layaMlxInstalled(checkout({ laya: true }))).toBe(true);
    });
});

describe('buildCompiledBinary', () => {
    test('restores both patches after a successful build and reports artifacts', async () => {
        const root = checkout({ laya: true });
        const seen: string[][] = [];
        const result = await buildCompiledBinary({
            entry: join(root, 'apps', 'cli', 'src', 'index.ts'),
            outfile: join(root, 'dist', 'cli', 'spur'),
            sourceRoot: root,
            run: okRunner(seen),
        });
        expect(result.ok).toBe(true);
        expect(result.artifacts).toEqual([{ path: join(root, 'dist', 'cli', 'spur'), kind: 'binary' }]);
        expect(seen[0]?.slice(0, 3)).toEqual(['bun', 'build', join(root, 'apps', 'cli', 'src', 'index.ts')]);
        expect(readFileSync(distPath(root), 'utf-8')).toBe(DIST);
        expect(readFileSync(join(root, 'packages', 'app', 'src', 'decision', 'decision-service.ts'), 'utf-8')).toBe(
            DECISION,
        );
    });

    test('a second-acquisition failure still restores the first patch and the lock', async () => {
        const root = checkout({ laya: true, decision: 'export const nothing = 1;\n' });
        await expect(
            buildCompiledBinary({
                entry: join(root, 'apps', 'cli', 'src', 'index.ts'),
                outfile: join(root, 'dist', 'cli', 'spur'),
                sourceRoot: root,
                run: okRunner(),
            }),
        ).rejects.toThrow('no variable-specifier');
        expect(readFileSync(distPath(root), 'utf-8')).toBe(DIST);
        expect(existsSync(`${distPath(root)}.spur-compile.lock`)).toBe(false);
    });

    test('a nonzero compiler exit is a BuildError and the checkout is restored', async () => {
        const root = checkout();
        const failing: BuildRunner = async (command, args) => ({
            command,
            args: [...args],
            exitCode: 2,
            stdout: '',
            stderr: 'boom',
        });
        await expect(
            buildCompiledBinary({
                entry: join(root, 'apps', 'cli', 'src', 'index.ts'),
                outfile: join(root, 'dist', 'cli', 'spur'),
                sourceRoot: root,
                run: failing,
            }),
        ).rejects.toThrow('bun build failed with exit code 2');
        expect(readFileSync(distPath(root), 'utf-8')).toBe(DIST);
    });

    test('cross-compilation passes one target per invocation', async () => {
        const root = checkout();
        const seen: string[][] = [];
        const result = await buildCompiledBinary({
            entry: join(root, 'apps', 'cli', 'src', 'index.ts'),
            outfile: join(root, 'dist', 'cli', 'spur-linux-x64'),
            sourceRoot: root,
            targets: ['bun-linux-x64'],
            run: okRunner(seen),
        });
        expect(seen[0]).toContain('--target=bun-linux-x64');
        expect(result.artifacts[0]?.kind).toBe('binary:bun-linux-x64');
    });
});

describe('buildCli and release assets', () => {
    test('buildCli validates the checkout before opening a lock', async () => {
        await expect(buildCli({ cwd: tmpdir(), run: okRunner() })).rejects.toThrow('not a Spur source checkout');
    });

    test('the six release names and SHA256SUMS format stay pinned', async () => {
        expect(releaseAssetNames()).toEqual([
            'spur-darwin-arm64',
            'spur-darwin-x64',
            'spur-linux-arm64',
            'spur-linux-x64',
            'spur-windows-x64.exe',
            'spur-windows-arm64.exe',
        ]);
        const dir = mkdtempSync(join(tmpdir(), 'spur-sums-'));
        writeFileSync(join(dir, 'spur-linux-x64'), 'bytes');
        const content = await writeSha256Sums(dir, ['spur-linux-x64']);
        expect(content).toBe(`${new Bun.CryptoHasher('sha256').update('bytes').digest('hex')}  spur-linux-x64\n`);
        expect(readFileSync(join(dir, 'SHA256SUMS'), 'utf-8')).toBe(content);
    });

    test('buildOutputPath joins under the source root', () => {
        expect(buildOutputPath('/repo', 'dist', 'cli', 'spur')).toBe(join('/repo', 'dist', 'cli', 'spur'));
    });
});

describe('buildServer and the default runner', () => {
    test('buildServer targets the checkout dist/server path', async () => {
        const root = checkout();
        const seen: string[][] = [];
        const result = await buildServer({ cwd: root, run: okRunner(seen) });
        expect(result.artifacts[0]?.path).toBe(join(root, 'dist', 'server', 'spur-server'));
        expect(seen[0]).toContain(join(root, 'apps', 'server', 'src', 'index.ts'));
    });

    test('the default runner captures a real child exit (no injected runner)', async () => {
        const root = checkout();
        const result = await buildCompiledBinary({
            entry: join(root, 'apps', 'cli', 'src', 'index.ts'),
            outfile: join(root, 'dist', 'cli', 'spur'),
            sourceRoot: root,
        });
        expect(result.ok).toBe(true);
        expect(result.diagnostics[0]?.exitCode).toBe(0);
        expect(existsSync(join(root, 'dist', 'cli', 'spur'))).toBe(true);
        expect(readFileSync(distPath(root), 'utf-8')).toBe(DIST);
    }, 60_000);
});
