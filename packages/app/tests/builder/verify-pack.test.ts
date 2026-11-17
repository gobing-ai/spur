import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { assertSafeMembers, parseArchiveListing, verifyPack, verifyPackExtract } from '../../src/builder/verify-pack';

/**
 * Tarball verification (A93 1355 R3). Failure modes first — each one is a way the verifier could
 * certify a hostile or mismatched package:
 *
 *   - extraction following a link, or writing outside the private temp dir (absolute / traversal)
 *   - a `..` segment hidden mid-path rather than at the start
 *   - a member outside `package/`
 *   - comparing versions against the verifier's checkout instead of the archive
 *   - treating an uninspectable archive as valid
 */
describe('parseArchiveListing', () => {
    test('classifies the permission string into file, directory, link and special', () => {
        const verbose = [
            'drwxr-xr-x  0 user group      0 Jan  1 00:00 package/',
            '-rw-r--r--  0 user group    120 Jan  1 00:00 package/package.json',
            'lrwxr-xr-x  0 user group      0 Jan  1 00:00 package/link -> package/package.json',
            'crw-rw-rw-  0 user group      0 Jan  1 00:00 package/dev/zero',
        ].join('\n');
        // Names come from the plain listing: spaces and BSD/GNU padding never affect them.
        const names = ['package/', 'package/package.json', 'package/link', 'package/dev/zero'].join('\n');
        expect(parseArchiveListing(verbose, names)).toEqual([
            { name: 'package/', type: 'directory' },
            { name: 'package/package.json', type: 'file' },
            { name: 'package/link', type: 'link' },
            { name: 'package/dev/zero', type: 'special' },
        ]);
    });

    test('an empty listing is a failure, not an empty package', () => {
        expect(() => parseArchiveListing('\n', '\n')).toThrow('archive listing is empty');
    });

    test('inconsistent listings are refused rather than guessed at', () => {
        expect(() => parseArchiveListing('-rw-r--r-- a\n-rw-r--r-- b', 'package/a')).toThrow('inconsistent');
    });

    test('an unclassifiable entry type fails instead of being skipped', () => {
        expect(() => parseArchiveListing('?rw-r--r-- a', 'package/a')).toThrow('cannot classify archive member type');
    });
});

describe('assertSafeMembers', () => {
    const file = (name: string) => ({ name, type: 'file' as const });

    test('accepts ordinary package members', () => {
        expect(() =>
            assertSafeMembers([file('package/package.json'), { name: 'package/plugins/', type: 'directory' }]),
        ).not.toThrow();
    });

    test('refuses link and special members', () => {
        expect(() => assertSafeMembers([{ name: 'package/link', type: 'link' }])).toThrow('refusing link member');
        expect(() => assertSafeMembers([{ name: 'package/fifo', type: 'special' }])).toThrow('refusing special member');
    });

    test('refuses absolute, drive-qualified and backslash paths', () => {
        expect(() => assertSafeMembers([file('/etc/passwd')])).toThrow('absolute or non-portable');
        expect(() => assertSafeMembers([file('C:/Windows/system32')])).toThrow('absolute or non-portable');
        expect(() => assertSafeMembers([file('package\\evil')])).toThrow('absolute or non-portable');
    });

    test('refuses traversal anywhere in the path, and members outside package/', () => {
        expect(() => assertSafeMembers([file('package/../../escape')])).toThrow('traversal member path');
        expect(() => assertSafeMembers([file('..')])).toThrow('traversal member path');
        expect(() => assertSafeMembers([file('other/package.json')])).toThrow('outside the package/ root');
    });
});

describe('verifyPackExtract — the archive owns the version', () => {
    function fixtureArchive(version: string | undefined, options: { pluginVersion?: string; pruned?: boolean } = {}) {
        const root = mkdtempSync(join(tmpdir(), 'spur-pack-unit-'));
        const pkg = join(root, 'package');
        mkdirSync(join(pkg, 'plugins', 'sp'), { recursive: true });
        mkdirSync(join(pkg, '.claude-plugin'), { recursive: true });
        writeFileSync(join(pkg, 'package.json'), JSON.stringify(version === undefined ? {} : { version }));
        writeFileSync(
            join(pkg, 'plugins', 'sp', 'plugin.json'),
            JSON.stringify({ version: options.pluginVersion ?? version }),
        );
        writeFileSync(
            join(pkg, '.claude-plugin', 'marketplace.json'),
            JSON.stringify({ plugins: [{ name: 'sp', source: './plugins/sp', version }] }),
        );
        writeFileSync(join(pkg, 'plugins', 'sp', 'README.md'), '# sp\n');
        if (options.pruned === true) writeFileSync(join(pkg, 'plugins', 'sp', 'x.test.ts'), 'test\n');
        return root;
    }

    test('reports the archive version and plugin file count', async () => {
        const result = await verifyPackExtract(fixtureArchive('9.9.9'));
        expect(result.version).toBe('9.9.9');
        expect(result.files).toBeGreaterThan(0);
    });

    test('a plugin version that disagrees with the archive manifest fails', async () => {
        await expect(verifyPackExtract(fixtureArchive('9.9.9', { pluginVersion: '0.0.1' }))).rejects.toThrow(
            'plugin.json version 0.0.1 != archive package 9.9.9',
        );
    });

    test('a manifest without a version fails instead of assuming one', async () => {
        await expect(verifyPackExtract(fixtureArchive(undefined))).rejects.toThrow('carries no version');
    });

    test('a marketplace entry that does not name the sp plugin fails', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-pack-market-'));
        const pkg = join(root, 'package');
        mkdirSync(join(pkg, 'plugins', 'sp'), { recursive: true });
        mkdirSync(join(pkg, '.claude-plugin'), { recursive: true });
        writeFileSync(join(pkg, 'package.json'), JSON.stringify({ version: '1.0.0' }));
        writeFileSync(join(pkg, 'plugins/sp/plugin.json'), JSON.stringify({ version: '1.0.0' }));
        writeFileSync(
            join(pkg, '.claude-plugin/marketplace.json'),
            JSON.stringify({ plugins: [{ name: 'other', source: './plugins/other', version: '1.0.0' }] }),
        );
        await expect(verifyPackExtract(root)).rejects.toThrow('marketplace entry mismatch');
    });

    test('a malformed plugin.json fails with its path', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-pack-bad-'));
        const pkg = join(root, 'package');
        mkdirSync(join(pkg, 'plugins', 'sp'), { recursive: true });
        mkdirSync(join(pkg, '.claude-plugin'), { recursive: true });
        writeFileSync(join(pkg, 'package.json'), JSON.stringify({ version: '1.0.0' }));
        writeFileSync(join(pkg, 'plugins/sp/plugin.json'), '{not json');
        writeFileSync(
            join(pkg, '.claude-plugin/marketplace.json'),
            JSON.stringify({ plugins: [{ name: 'sp', source: './plugins/sp', version: '1.0.0' }] }),
        );
        await expect(verifyPackExtract(root)).rejects.toThrow('plugins/sp/plugin.json');
    });

    test('pruned test content is refused', async () => {
        await expect(verifyPackExtract(fixtureArchive('9.9.9', { pruned: true }))).rejects.toThrow(
            'pruned content found',
        );
    });
});

describe('verifyPack — uninspectable archives', () => {
    test('a listing failure is a failure, never an extraction fallback', async () => {
        await expect(
            verifyPack('whatever.tgz', {
                run: async () => ({ exitCode: 2, stdout: '', stderr: 'not a tarball' }),
            }),
        ).rejects.toThrow('cannot inspect archive: not a tarball');
    });

    test('an unsafe listing is refused before any extraction runs', async () => {
        const calls: string[][] = [];
        await expect(
            verifyPack('whatever.tgz', {
                run: async (args) => {
                    calls.push([...args]);
                    return {
                        exitCode: 0,
                        stdout:
                            args[0] === '-tvzf' ? 'lrwxr-xr-x 0 user group 0 Jan 1 00:00 package/link' : 'package/link',
                        stderr: '',
                    };
                },
            }),
        ).rejects.toThrow('refusing link member');
        // Only the two listing calls happened: nothing was extracted.
        expect(calls).toHaveLength(2);
        expect(calls.map((call) => call[0])).toEqual(['-tvzf', '-tzf']);
    });
});

describe('verifyPack — real archives (default tar runner)', () => {
    /** Build a real tarball from `package/` using the host tar; returns its path. */
    function packArchive(entries: Record<string, string | null>): string {
        const root = mkdtempSync(join(tmpdir(), 'spur-pack-tar-'));
        const pkg = join(root, 'package');
        for (const [rel, content] of Object.entries(entries)) {
            if (content === null) {
                mkdirSync(join(pkg, rel), { recursive: true });
                continue;
            }
            mkdirSync(join(pkg, dirname(rel)), { recursive: true });
            writeFileSync(join(pkg, rel), content);
        }
        const tarball = join(root, 'pkg.tgz');
        const result = Bun.spawnSync(['tar', '-czf', tarball, '-C', root, 'package']);
        expect(result.exitCode, result.stderr.toString()).toBe(0);
        return tarball;
    }

    const manifest = (version: string) => JSON.stringify({ version });
    const plugin = (version: string) => JSON.stringify({ version });
    const market = (version: string) => JSON.stringify({ plugins: [{ name: 'sp', source: './plugins/sp', version }] });

    test('a valid archive verifies and reports its own version', async () => {
        const tarball = packArchive({
            'package.json': manifest('3.2.1'),
            'plugins/sp/plugin.json': plugin('3.2.1'),
            '.claude-plugin/marketplace.json': market('3.2.1'),
            'plugins/sp/README.md': '# sp\n',
        });
        const result = await verifyPack(tarball);
        expect(result.version).toBe('3.2.1');
    });

    test('a real link member is refused before extraction', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-pack-link-'));
        const pkg = join(root, 'package');
        mkdirSync(join(pkg, 'plugins/sp'), { recursive: true });
        writeFileSync(join(pkg, 'package.json'), manifest('1.0.0'));
        symlinkSync('/etc/passwd', join(pkg, 'plugins/sp/leak'));
        const tarball = join(root, 'pkg.tgz');
        expect(Bun.spawnSync(['tar', '-czf', tarball, '-C', root, 'package']).exitCode).toBe(0);
        await expect(verifyPack(tarball)).rejects.toThrow('refusing link member');
    });

    test('an extraction failure is reported (never silently "verified")', async () => {
        const calls: string[][] = [];
        await expect(
            verifyPack('whatever.tgz', {
                run: async (args) => {
                    calls.push([...args]);
                    if (args[0] === '-xzf') return { exitCode: 2, stdout: '', stderr: 'truncated' };
                    return {
                        exitCode: 0,
                        stdout: args[0] === '-tvzf' ? '-rw-r--r-- a' : 'package/package.json',
                        stderr: '',
                    };
                },
            }),
        ).rejects.toThrow('extraction failed: truncated');
        expect(calls.map((call) => call[0])).toEqual(['-tvzf', '-tzf', '-xzf']);
    });
});
