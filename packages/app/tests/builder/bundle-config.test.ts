/**
 * Regression guard for the release-blocker where the publish-time bundler
 * prepended an unquoted `$schema:` onto workflow YAMLs that already carried a
 * quoted `"$schema":` directive, producing a duplicate YAML key and a
 * `YAMLParseError` in every bundled workflow.
 *
 * Invariant: after `bundleConfig`, no bundled `.yaml` file may contain more
 * than one `$schema` directive (quoted or unquoted).
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleConfig } from '../../src/builder/bundle-config';

const SCHEMA_LINE = /^\s*(?:\$schema|"\$schema")\s*:/gm;
/** Repo root: packages/app/tests/builder → repo. */
const SOURCE_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

async function collectYaml(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await collectYaml(full)));
        else if (entry.name.endsWith('.yaml')) out.push(full);
    }
    return out;
}

describe('bundleConfig', () => {
    let target: string;

    afterEach(async () => {
        if (target) await rm(target, { recursive: true, force: true });
    });

    test('no bundled workflow YAML has a duplicate $schema directive', async () => {
        target = await mkdtemp(join(tmpdir(), 'spur-bundle-'));
        await bundleConfig(target, { sourceRoot: SOURCE_ROOT });

        const yamlFiles = await collectYaml(join(target, 'workflows'));
        expect(yamlFiles.length, 'expected bundled workflow files').toBeGreaterThan(0);

        for (const file of yamlFiles) {
            const content = await readFile(file, 'utf-8');
            const matches = content.match(SCHEMA_LINE) ?? [];
            expect(matches.length, `${file} must have exactly one $schema directive`).toBe(1);
        }
    });

    test('every bundled workflow YAML has at least one $schema directive', async () => {
        target = await mkdtemp(join(tmpdir(), 'spur-bundle-'));
        await bundleConfig(target, { sourceRoot: SOURCE_ROOT });

        const yamlFiles = await collectYaml(join(target, 'workflows'));
        for (const file of yamlFiles) {
            const content = await readFile(file, 'utf-8');
            const matches = content.match(SCHEMA_LINE) ?? [];
            expect(matches.length, `${file} must carry a $schema for IDE validation`).toBeGreaterThanOrEqual(1);
        }
    });
});

describe('bundleConfig target guard (1155 — physical overlap, not lexical)', () => {
    const SENTINEL = 'source sentinel bytes — must survive every rejection\n';
    let root: string;
    let repoOut: string;

    /**
     * A disposable checkout: its own `config/` tree and explicit `sourceRoot`, so the destructive
     * safety cases never point at the live checkout (1155 R3). A93 1355 removed the old
     * copy-the-module trick — the service now takes the root as a parameter, so no module ancestry
     * (and no fixture copy that Bun's coverage gate would instrument) is involved.
     */
    async function fixture(): Promise<{
        repo: string;
        run: (target: string) => Promise<{ target: string; source: string; injected: number }>;
    }> {
        root = await mkdtemp(join(tmpdir(), 'spur-bundle-guard-'));
        const repo = join(root, 'checkout');
        await mkdir(join(repo, 'config', 'workflows'), { recursive: true });
        await mkdir(join(repo, 'config', 'fixtures', 'rule'), { recursive: true });
        await writeFile(join(repo, 'config', 'SENTINEL.txt'), SENTINEL);
        await writeFile(join(repo, 'config', 'workflows', 'plain.yaml'), 'kind: state-machine\n');
        await writeFile(join(repo, 'config', 'workflows', 'quoted.yaml'), '"$schema": "x"\nkind: state-machine\n');
        await writeFile(join(repo, 'config', 'fixtures', 'rule', 'junk.yaml'), 'junk: true\n');
        repoOut = join(root, 'repo-out');
        return { repo, run: (target: string) => bundleConfig(target, { sourceRoot: repo }) };
    }

    /** Every path under `dir`, relative to it — the source inventory a rejection must leave intact. */
    async function inventory(dir: string): Promise<string[]> {
        const out: string[] = [];
        for (const entry of await readdir(dir, { withFileTypes: true })) {
            const rel = entry.name;
            out.push(rel);
            if (entry.isDirectory())
                out.push(...(await inventory(join(dir, rel)).then((xs) => xs.map((x) => `${rel}/${x}`))));
        }
        return out.sort();
    }

    afterEach(async () => {
        if (root) await rm(root, { recursive: true, force: true });
    });

    async function expectRefused(run: (t: string) => Promise<unknown>, target: string): Promise<void> {
        await expect(run(target)).rejects.toThrow('refusing to replace');
    }

    test('rejects a direct source destination and leaves the source untouched', async () => {
        const { repo, run } = await fixture();
        const before = await inventory(join(repo, 'config'));
        await expectRefused(run, join(repo, 'config'));
        expect(await readFile(join(repo, 'config', 'SENTINEL.txt'), 'utf-8')).toBe(SENTINEL);
        expect(await inventory(join(repo, 'config'))).toEqual(before);
    });

    test('rejects the repo root (a direct ancestor of the source)', async () => {
        const { repo, run } = await fixture();
        await expectRefused(run, repo);
        await expectRefused(run, join(repo, '.'));
        expect(await readFile(join(repo, 'config', 'SENTINEL.txt'), 'utf-8')).toBe(SENTINEL);
    });

    test('rejects a destination inside the source, including one with missing final directories', async () => {
        const { repo, run } = await fixture();
        await expectRefused(run, join(repo, 'config', 'sub'));
        await expectRefused(run, join(repo, 'config', 'sub', 'deeper'));
        expect(await readFile(join(repo, 'config', 'SENTINEL.txt'), 'utf-8')).toBe(SENTINEL);
    });

    test('rejects a symlinked ancestor that aliases the repo (the a71c reproduction)', async () => {
        const { repo, run } = await fixture();
        const alias = join(root, 'alias');
        await symlink(repo, alias, 'dir');
        for (const target of [join(alias, 'config'), join(alias, 'config', 'subdir'), alias]) {
            await expectRefused(run, target);
        }
        expect(await readFile(join(repo, 'config', 'SENTINEL.txt'), 'utf-8')).toBe(SENTINEL);
    });

    test('rejects a symlinked final component that points at the source', async () => {
        const { repo, run } = await fixture();
        const link = join(root, 'source-link');
        await symlink(join(repo, 'config'), link, 'dir');
        await expectRefused(run, link);
        expect(await readFile(join(repo, 'config', 'SENTINEL.txt'), 'utf-8')).toBe(SENTINEL);
    });

    test('a non-ENOENT resolution failure rejects before any cleanup', async () => {
        const { repo, run } = await fixture();
        const notADir = join(repo, 'plain-file');
        await writeFile(notADir, 'x');
        await expect(run(join(notADir, 'child'))).rejects.toThrow();
        expect(await readFile(join(repo, 'config', 'SENTINEL.txt'), 'utf-8')).toBe(SENTINEL);
    });

    test('a safe destination with missing final directories still bundles', async () => {
        const { run } = await fixture();
        const result = await run(join(repoOut, 'nested', 'deep'));
        expect(result.injected).toBeGreaterThan(0);
        expect(await readFile(join(repoOut, 'nested', 'deep', 'SENTINEL.txt'), 'utf-8')).toBe(SENTINEL);
        // Authoring fixtures are excluded; every bundled YAML carries exactly one $schema directive.
        expect(existsSync(join(repoOut, 'nested', 'deep', 'fixtures'))).toBe(false);
        for (const file of await collectYaml(join(repoOut, 'nested', 'deep'))) {
            const content = await readFile(file, 'utf-8');
            expect((content.match(SCHEMA_LINE) ?? []).length, `${file} $schema count`).toBe(1);
        }
    });

    test('a safe sibling whose name merely starts with ".." is not rejected', async () => {
        const { run } = await fixture();
        const dotted = join(root, '..safe-out');
        await run(dotted);
        expect(await readFile(join(dotted, 'SENTINEL.txt'), 'utf-8')).toBe(SENTINEL);
    });

    test('a safe destination under an aliased outside parent still bundles', async () => {
        const { run } = await fixture();
        const real = join(root, 'outside-real');
        await mkdir(real, { recursive: true });
        const alias = join(root, 'outside-alias');
        await symlink(real, alias, 'dir');
        await run(join(alias, 'nested', 'deep'));
        expect(await readFile(join(real, 'nested', 'deep', 'SENTINEL.txt'), 'utf-8')).toBe(SENTINEL);
    });
});
