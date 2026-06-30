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
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleConfig } from './bundle-config';

const SCHEMA_LINE = /^\s*(?:\$schema|"\$schema")\s*:/gm;

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
        await bundleConfig(target);

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
        await bundleConfig(target);

        const yamlFiles = await collectYaml(join(target, 'workflows'));
        for (const file of yamlFiles) {
            const content = await readFile(file, 'utf-8');
            const matches = content.match(SCHEMA_LINE) ?? [];
            expect(matches.length, `${file} must carry a $schema for IDE validation`).toBeGreaterThanOrEqual(1);
        }
    });
});
