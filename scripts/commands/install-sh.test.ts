import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar } from '@gobing-ai/spur-config';

// Drives the real scripts/install.sh against a file:// "release" (SPUR_RELEASE_URL), so the
// checksum and atomic-replace contracts are exercised without the network (task 0971).
const INSTALL_SH = join(import.meta.dir, '../install.sh');
const ASSET = `spur-${process.platform}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`;
const FAKE_BIN = '#!/bin/sh\necho fake-spur "$@"\n';
const HOST_PATH = getEnvVar('PATH') ?? '/usr/bin:/bin';

let root = '';
let release = '';
let bin = '';
let target = '';

const sha256 = (s: string) => new Bun.CryptoHasher('sha256').update(s).digest('hex');
const writeSums = (content: string) => writeFileSync(join(release, 'SHA256SUMS'), content);
const leftovers = () => readdirSync(bin).filter((f) => f.startsWith('.spur-install.'));

function install(extraEnv: Record<string, string> = {}) {
    const res = Bun.spawnSync(['sh', INSTALL_SH], {
        env: {
            PATH: HOST_PATH,
            HOME: root,
            SPUR_INSTALL: bin,
            SPUR_RELEASE_URL: `file://${release}`,
            ...extraEnv,
        },
    });
    return { code: res.exitCode, stderr: res.stderr.toString() };
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'install-sh-'));
    release = join(root, 'release');
    bin = join(root, 'bin');
    target = join(bin, 'spur');
    mkdirSync(release);
    mkdirSync(bin);
    writeFileSync(join(release, ASSET), FAKE_BIN);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('scripts/install.sh checksum verification (task 0971)', () => {
    test('happy path: verified binary is installed executable with no temp leftovers', () => {
        writeSums(`${sha256(FAKE_BIN)}  ${ASSET}\n`);
        const { code, stderr } = install();
        expect(code, stderr).toBe(0);
        expect(readFileSync(target, 'utf8')).toBe(FAKE_BIN);
        expect(statSync(target).mode & 0o111).not.toBe(0);
        expect(leftovers()).toEqual([]);
    });

    test('AC2: checksum mismatch fails and leaves the existing install untouched', () => {
        writeFileSync(target, 'OLD');
        writeSums(`${'0'.repeat(64)}  ${ASSET}\n`);
        const { code, stderr } = install();
        expect(code).not.toBe(0);
        expect(stderr).toContain(`checksum mismatch for ${ASSET}`);
        expect(readFileSync(target, 'utf8')).toBe('OLD');
        expect(leftovers()).toEqual([]);
    });

    test('AC3: a failed download never destroys a working install', () => {
        writeFileSync(target, 'OLD');
        writeSums(`${sha256(FAKE_BIN)}  ${ASSET}\n`);
        rmSync(join(release, ASSET));
        const { code, stderr } = install();
        expect(code).not.toBe(0);
        expect(stderr).toContain('download failed');
        expect(readFileSync(target, 'utf8')).toBe('OLD');
        expect(leftovers()).toEqual([]);
    });

    test('AC3: an interrupted transfer (partial bytes, then curl error) never replaces the install', () => {
        // A missing file:// source makes curl fail before it opens `-o`, so it cannot tell a
        // temp-file download from a direct-to-target one; a partial write then failure can.
        writeFileSync(target, 'OLD');
        writeSums(`${sha256(FAKE_BIN)}  ${ASSET}\n`);
        const shim = join(root, 'shim');
        mkdirSync(shim);
        writeFileSync(
            join(shim, 'curl'),
            '#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = -o ] && printf PARTIAL > "$2"; shift; done\nexit 56\n',
            { mode: 0o755 },
        );
        const { code, stderr } = install({ PATH: `${shim}:${HOST_PATH}` });
        expect(code).not.toBe(0);
        expect(stderr).toContain('download failed');
        expect(readFileSync(target, 'utf8')).toBe('OLD');
        expect(leftovers()).toEqual([]);
    });

    test('R4: missing SHA256SUMS fails naming the URL; SPUR_SKIP_VERIFY=1 is the only bypass', () => {
        writeFileSync(target, 'OLD');
        const denied = install();
        expect(denied.code).not.toBe(0);
        expect(denied.stderr).toContain(`file://${release}/SHA256SUMS`);
        expect(readFileSync(target, 'utf8')).toBe('OLD');

        const skipped = install({ SPUR_SKIP_VERIFY: '1' });
        expect(skipped.code, skipped.stderr).toBe(0);
        expect(skipped.stderr).toContain(`WARNING — installing ${ASSET} WITHOUT checksum verification`);
        expect(readFileSync(target, 'utf8')).toBe(FAKE_BIN);
    });

    test('R3: SHA256SUMS without an entry for the asset fails loudly', () => {
        writeSums(`${sha256(FAKE_BIN)}  spur-other-os\n`);
        const { code, stderr } = install();
        expect(code).not.toBe(0);
        expect(stderr).toContain(`no SHA256SUMS entry for ${ASSET}`);
        expect(existsSync(target)).toBe(false);
        expect(leftovers()).toEqual([]);
    });
});
