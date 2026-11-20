import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';

/**
 * Packed-tarball verification (A93 1355 R3, design §5).
 *
 * Two integrity rules changed with ownership:
 *
 *  1. **The archive is the version authority.** The old verifier compared plugin/marketplace
 *     versions against the *verifier checkout's* `apps/cli/package.json`, so an installed `spur`
 *     verifying a tarball built from a different version reported a false mismatch — or a false
 *     match. Versions are now compared against `package/package.json` INSIDE the archive.
 *  2. **Members are validated before extraction.** Absolute paths, `..` traversal, links and
 *     special files are refused from the archive listing, so extraction can never write outside the
 *     private temp directory or follow an attacker-controlled link.
 *
 * Verification is extract-only: it never certifies by inspecting the monorepo tree or a bun-link
 * symlink, and an archive that cannot be inspected is a failure, not a fallback.
 */

interface Marketplace {
    plugins?: Array<{ name?: string; version?: string; source?: string }>;
}

/** One member of the archive listing. */
export interface ArchiveMember {
    name: string;
    type: 'file' | 'directory' | 'link' | 'special';
}

/**
 * Pair a verbose listing with the exact names listing.
 *
 * `tar -tvzf` is portable for the ENTRY TYPE (its first character) but not for parsing a name out of
 * it: BSD/GNU pad owner, group and size differently and a name may contain spaces. `tar -tzf` gives
 * the exact name, one per line, in the same order — so the type comes from column 1 of the verbose
 * line and the name from the plain listing. A count mismatch means the archive changed between the
 * two reads and is refused rather than guessed at.
 */
export function parseArchiveListing(verbose: string, names: string): ArchiveMember[] {
    const nameLines = names.split('\n').filter((line) => line !== '');
    const typeLines = verbose.split('\n').filter((line) => line.trim() !== '');
    if (nameLines.length === 0) {
        throw new Error('verify-pack: archive listing is empty — refusing to treat it as a valid package');
    }
    if (nameLines.length !== typeLines.length) {
        throw new Error(
            `verify-pack: archive listing is inconsistent (${typeLines.length} typed entries vs ${nameLines.length} names)`,
        );
    }
    return typeLines.map((line, index) => {
        const kind = line[0];
        const name = nameLines[index] ?? '';
        if (kind === '-') return { name, type: 'file' as const };
        if (kind === 'd') return { name, type: 'directory' as const };
        if (kind === 'l') return { name, type: 'link' as const };
        if (kind !== undefined && 'bcps'.includes(kind)) return { name, type: 'special' as const };
        throw new Error(`verify-pack: cannot classify archive member type '${kind ?? ''}' for ${name}`);
    });
}

/** Refuse any member that could escape the extraction root or smuggle a link/special file. */
export function assertSafeMembers(members: readonly ArchiveMember[]): void {
    for (const member of members) {
        if (member.type !== 'file' && member.type !== 'directory') {
            throw new Error(`verify-pack: refusing ${member.type} member "${member.name}" in the archive`);
        }
        if (member.name.startsWith('/') || /^[A-Za-z]:[\\/]/.test(member.name) || member.name.includes('\\')) {
            throw new Error(`verify-pack: refusing absolute or non-portable member path "${member.name}"`);
        }
        // A directory member legitimately ends with '/'; trailing separators are not traversal.
        const segments = member.name.replace(/\/+$/, '').split('/');
        if (segments.includes('..') || segments.some((segment) => segment === '' && member.name !== '/')) {
            throw new Error(`verify-pack: refusing traversal member path "${member.name}"`);
        }
        if (segments[0] !== 'package') {
            throw new Error(`verify-pack: member "${member.name}" is outside the package/ root`);
        }
    }
}

/** Parse JSON, failing with a clear path-bearing message on malformed input. */
function parseJson<T>(text: string, label: string): T {
    try {
        return JSON.parse(text) as T;
    } catch (error) {
        throw new Error(
            `verify-pack: ${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

async function listFiles(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await listFiles(full)));
        else out.push(full.replace(/\\/g, '/'));
    }
    return out;
}

/**
 * Generic extract assertions (A94 1411): the archive's own `package/package.json` carries a version,
 * and every `--require` member is present at `package/<member>`.
 *
 * @param extractRoot - directory the archive was extracted into
 * @param requires - repo-relative members that must ship (default: none)
 */
export async function verifyPackExtract(
    extractRoot: string,
    requires: readonly string[] = [],
): Promise<{ version: string; files: number }> {
    const pkg = join(extractRoot, 'package');
    const manifest = parseJson<{ version?: string }>(
        await readFile(join(pkg, 'package.json'), 'utf-8'),
        'package/package.json',
    );
    if (typeof manifest.version !== 'string' || manifest.version === '') {
        throw new Error('verify-pack: package/package.json carries no version');
    }
    for (const member of requires) {
        const target = join(pkg, member);
        if (!existsSync(target)) {
            throw new Error(`required member missing: ${member}`);
        }
    }
    return { version: manifest.version, files: (await listFiles(pkg)).length };
}

/**
 * Assert the version equality and prune invariants of Spur's own package, and report the packed
 * plugin file count.
 *
 * A94 1411 moved these out of the generic verb: plugin/marketplace version equality and the
 * tests/evals prune are Spur-package facts, so only Spur's packed-tarball E2E calls this.
 */
export async function verifySpurPackExtract(extractRoot: string): Promise<{ version: string; files: number }> {
    const { version } = await verifyPackExtract(extractRoot);
    const pkg = join(extractRoot, 'package');

    const pluginJson = join(pkg, 'plugins/sp/plugin.json');
    const marketplaceJson = join(pkg, '.claude-plugin/marketplace.json');
    const plugin = parseJson<{ version?: string }>(await readFile(pluginJson, 'utf-8'), 'plugins/sp/plugin.json');
    if (plugin.version !== version) {
        throw new Error(`plugin.json version ${plugin.version} != archive package ${version}`);
    }
    const marketplace = parseJson<Marketplace>(
        await readFile(marketplaceJson, 'utf-8'),
        '.claude-plugin/marketplace.json',
    );
    const entry = marketplace.plugins?.[0];
    if (entry?.name !== 'sp' || entry.source !== './plugins/sp') {
        throw new Error(`marketplace entry mismatch: ${JSON.stringify(entry)}`);
    }
    if (entry.version !== version) {
        throw new Error(`marketplace version ${entry.version} != archive package ${version}`);
    }

    const files = await listFiles(join(pkg, 'plugins'));
    const rel = files.map((file) => file.slice(join(pkg, 'plugins').length + 1));
    const pruned = rel.filter(
        (file) =>
            file.includes('/tests/') ||
            file.startsWith('tests/') ||
            file.endsWith('.test.ts') ||
            file.includes('/evals/'),
    );
    if (pruned.length > 0) {
        throw new Error(`pruned content found in packed plugins: ${pruned.join(', ')}`);
    }
    return { version, files: rel.length };
}

/** Default runner: buffered `tar`, so its output is evidence rather than console noise. */
async function runTar(
    args: readonly string[],
    cwd?: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const executor = new NodeProcessExecutor({ defaultTimeout: 120_000, defaultMaxOutput: 4_000_000 });
    const result = await executor.run({
        command: 'tar',
        args: [...args],
        cwd: cwd ?? process.cwd(),
        forceBuffered: true,
    });
    return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
}

/** Runs one `tar` invocation; injected so tests can supply a crafted listing. */
export type TarRunner = (
    args: readonly string[],
    cwd?: string,
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

/**
 * Inspect a tarball: list → validate members → extract into a private temp dir → assert.
 * The temp dir is always removed, including on every failure path.
 *
 * Generic form (A94 1411): member safety, the archive's own version, and every `--require` member.
 * Spur's plugin/marketplace invariants live in {@link verifySpurPack}.
 */
export async function verifyPack(
    tarball: string,
    options: { run?: TarRunner; requires?: readonly string[] } = {},
): Promise<{ version: string; files: number }> {
    const run = options.run ?? runTar;
    const verbose = await run(['-tvzf', tarball]);
    if (verbose.exitCode !== 0) {
        throw new Error(`verify-pack: cannot inspect archive: ${verbose.stderr.trim()}`);
    }
    const names = await run(['-tzf', tarball]);
    if (names.exitCode !== 0) {
        throw new Error(`verify-pack: cannot list archive members: ${names.stderr.trim()}`);
    }
    assertSafeMembers(parseArchiveListing(verbose.stdout, names.stdout));

    const extractRoot = await mkdtemp(join(tmpdir(), 'spur-verify-'));
    try {
        const extract = await run(['-xzf', tarball, '-C', extractRoot]);
        if (extract.exitCode !== 0) {
            throw new Error(`verify-pack: extraction failed: ${extract.stderr.trim()}`);
        }
        return await verifyPackExtract(extractRoot, options.requires ?? []);
    } finally {
        await rm(extractRoot, { recursive: true, force: true });
    }
}

/** Spur's own package: the generic assertions plus plugin/marketplace equality and prune. */
export async function verifySpurPack(
    tarball: string,
    options: { run?: TarRunner } = {},
): Promise<{ version: string; files: number }> {
    const run = options.run ?? runTar;
    const verbose = await run(['-tvzf', tarball]);
    if (verbose.exitCode !== 0) {
        throw new Error(`verify-pack: cannot inspect archive: ${verbose.stderr.trim()}`);
    }
    const names = await run(['-tzf', tarball]);
    if (names.exitCode !== 0) {
        throw new Error(`verify-pack: cannot list archive members: ${names.stderr.trim()}`);
    }
    assertSafeMembers(parseArchiveListing(verbose.stdout, names.stdout));

    const extractRoot = await mkdtemp(join(tmpdir(), 'spur-verify-'));
    try {
        const extract = await run(['-xzf', tarball, '-C', extractRoot]);
        if (extract.exitCode !== 0) {
            throw new Error(`verify-pack: extraction failed: ${extract.stderr.trim()}`);
        }
        return await verifySpurPackExtract(extractRoot);
    } finally {
        await rm(extractRoot, { recursive: true, force: true });
    }
}
