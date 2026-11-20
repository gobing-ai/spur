import { afterEach, expect, test } from 'bun:test';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
    writeFileSync as writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { binaryAssetName, buildBinaries, releaseAssetNames, writeSha256Sums } from '../../src/builder/binaries';

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test('writeSha256Sums emits GNU sha256sum format that real tools verify (task 0971 AC1)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sha256sums-'));
    writeFileSync(join(dir, 'spur-a'), 'alpha');
    writeFileSync(join(dir, 'spur-b'), 'bravo\n');

    const content = await writeSha256Sums(dir, ['spur-a', 'spur-b']);

    expect(content).toMatch(/^[0-9a-f]{64} {2}spur-a\n[0-9a-f]{64} {2}spur-b\n$/);
    expect(readFileSync(join(dir, 'SHA256SUMS'), 'utf8')).toBe(content);
    for (const [i, name] of ['spur-a', 'spur-b'].entries()) {
        const digest = new Bun.CryptoHasher('sha256').update(readFileSync(join(dir, name))).digest('hex');
        expect(content.split('\n')[i]).toBe(`${digest}  ${name}`);
    }
    // The format is what the installer's shasum/sha256sum fallback actually consumes.
    const check = Bun.spawnSync(['shasum', '-a', '256', '-c', 'SHA256SUMS'], { cwd: dir });
    expect(check.exitCode, check.stderr.toString()).toBe(0);
});

test('windows release assets use the .exe name bun compile writes', () => {
    expect(binaryAssetName('linux-x64')).toBe('spur-linux-x64');
    expect(binaryAssetName('darwin-arm64')).toBe('spur-darwin-arm64');
    expect(binaryAssetName('windows-x64')).toBe('spur-windows-x64.exe');
    expect(binaryAssetName('windows-arm64')).toBe('spur-windows-arm64.exe');
});

test('buildBinaries compiles all six targets and writes SHA256SUMS (A93 1354 R2)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'spur-binaries-unit-'));
    for (const dir of ['apps/cli/src', 'apps/server/src', 'packages/app/src/decision']) {
        mkdirSync(join(root, dir), { recursive: true });
    }
    const distDir = join(root, 'node_modules', '@gobing-ai', 'ts-runtime', 'dist');
    mkdirSync(distDir, { recursive: true });
    writeSync(join(root, 'node_modules', '@gobing-ai', 'ts-runtime', 'package.json'), '{"name":"x","main":"m"}');
    writeSync(
        join(distDir, 'runtime-node-bun.js'),
        "const moduleSpecifier = '@gobing-ai/ts-db';\nexport async function load() { return await import(moduleSpecifier); }\n",
    );
    writeSync(join(root, 'apps', 'cli', 'package.json'), '{}');
    writeSync(join(root, 'packages', 'app', 'package.json'), '{}');
    writeSync(join(root, 'apps', 'cli', 'src', 'index.ts'), 'console.log(1);\n');

    // The fake compiler writes the requested outfile, which is what SHA256SUMS then hashes.
    const result = await buildBinaries({
        cwd: root,
        run: async (command, args) => {
            const outfile = args[args.indexOf('--outfile') + 1] ?? '';
            writeSync(outfile, `binary:${outfile}`);
            return { command, args: [...args], exitCode: 0, stdout: '', stderr: '' };
        },
    });
    const assets = releaseAssetNames();
    expect(result.artifacts.filter((artifact) => artifact.kind.startsWith('binary:'))).toHaveLength(assets.length);
    const sums = readFileSync(join(root, 'dist', 'cli', 'SHA256SUMS'), 'utf8');
    expect(sums.trim().split('\n')).toHaveLength(assets.length);
    expect(sums).toContain('  spur-windows-x64.exe');
});

/** A fake compiler that writes the requested outfile so SHA256SUMS has real bytes to hash. */
function fakeCompiler() {
    return async (command: string, args: readonly string[]) => {
        const outfile = args[args.indexOf('--outfile') + 1] ?? '';
        writeSync(outfile, `binary:${outfile}`);
        return { command, args: [...args], exitCode: 0, stdout: '', stderr: '' };
    };
}

test('buildBinaries --entry compiles one project without a Spur source check (A94 1411 R1)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'spur-entry-'));
    dir = root;
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'tool.ts'), 'console.log(1);\n');

    const result = await buildBinaries({
        cwd: root,
        entry: 'src/tool.ts',
        targets: ['linux-x64', 'windows-x64'],
        run: fakeCompiler(),
    });

    const out = join(root, 'dist', 'bin');
    expect(result.artifacts.map((artifact) => artifact.path)).toEqual([
        join(out, 'tool-linux-x64'),
        join(out, 'tool-windows-x64.exe'),
        join(out, 'SHA256SUMS'),
    ]);
    expect(result.artifacts.at(-1)?.kind).toBe('sha256sums:2');
    // The generic path never patches the runtime: a downstream project has none of those sources.
    for (const diagnostic of result.diagnostics) expect(diagnostic.args).not.toContain('--asset');
});

test('buildBinaries --entry honours --name and --out, defaults to `dist/bin` under the cwd', async () => {
    const root = mkdtempSync(join(tmpdir(), 'spur-entry-out-'));
    dir = root;
    writeFileSync(join(root, 'main.ts'), 'console.log(1);\n');

    const named = await buildBinaries({
        cwd: root,
        entry: 'main.ts',
        name: 'demo',
        targets: ['linux-arm64'],
        out: 'release',
        run: fakeCompiler(),
    });
    expect(named.artifacts[0]?.path).toBe(join(root, 'release', 'demo-linux-arm64'));

    const defaults = await buildBinaries({
        cwd: root,
        entry: 'main.ts',
        targets: ['darwin-arm64'],
        run: fakeCompiler(),
    });
    // `main.ts` without --name => asset base name `main`.
    expect(defaults.artifacts[0]?.path).toBe(join(root, 'dist', 'bin', 'main-darwin-arm64'));
});

test('buildBinaries --entry refuses an unknown target before compiling anything', async () => {
    const root = mkdtempSync(join(tmpdir(), 'spur-entry-bad-'));
    dir = root;
    writeFileSync(join(root, 'main.ts'), 'console.log(1);\n');
    let compiled = 0;
    await expect(
        buildBinaries({
            cwd: root,
            entry: 'main.ts',
            targets: ['linux-x64', 'beos-mips'],
            run: async (command, args) => {
                compiled++;
                return { command, args: [...args], exitCode: 0, stdout: '', stderr: '' };
            },
        }),
    ).rejects.toThrow(/unknown target: beos-mips \(valid: .*linux-x64/);
    expect(compiled).toBe(0);
    expect(existsSync(join(root, 'dist'))).toBe(false);
});
