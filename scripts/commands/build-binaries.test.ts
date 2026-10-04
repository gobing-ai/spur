import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { binaryAssetName, writeSha256Sums } from './build-binaries';

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
