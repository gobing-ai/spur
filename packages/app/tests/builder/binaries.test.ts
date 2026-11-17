import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, writeFileSync as writeSync } from 'node:fs';
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
