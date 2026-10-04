import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDependencyDrift, dependencyDriftCheck, lockKeyPackageName } from './dependency-drift-check';

describe('dependency-drift-check (0738 R3/R17)', () => {
    test('returns 0 when all installed packages match locked versions', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'drift-check-test-'));
        const lockPath = join(dir, 'bun.lock');
        const nodeModulesDir = join(dir, 'node_modules');

        const lockContent = JSON.stringify({
            packages: {
                '@gobing-ai/ts-ai-runner': ['@gobing-ai/ts-ai-runner@0.4.55'],
                '@gobing-ai/ts-db': ['@gobing-ai/ts-db@0.4.55'],
            },
        });
        await writeFile(lockPath, lockContent);

        await mkdir(join(nodeModulesDir, '@gobing-ai', 'ts-ai-runner'), { recursive: true });
        await writeFile(
            join(nodeModulesDir, '@gobing-ai', 'ts-ai-runner', 'package.json'),
            JSON.stringify({ version: '0.4.55' }),
        );
        await mkdir(join(nodeModulesDir, '@gobing-ai', 'ts-db'), { recursive: true });
        await writeFile(
            join(nodeModulesDir, '@gobing-ai', 'ts-db', 'package.json'),
            JSON.stringify({ version: '0.4.55' }),
        );

        const drifts = checkDependencyDrift({ lockfilePath: lockPath, nodeModulesDir });
        expect(drifts).toHaveLength(0);

        const code = await dependencyDriftCheck({ lockfilePath: lockPath, nodeModulesDir, quiet: true });
        expect(code).toBe(0);

        await rm(dir, { recursive: true });
    });

    test('detects version mismatch and missing packages', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'drift-check-test-'));
        const lockPath = join(dir, 'bun.lock');
        const nodeModulesDir = join(dir, 'node_modules');

        const lockContent = JSON.stringify({
            packages: {
                '@gobing-ai/ts-llm-jsonl-importer': ['@gobing-ai/ts-llm-jsonl-importer@0.4.55'],
                '@gobing-ai/ts-db': ['@gobing-ai/ts-db@0.4.55'],
            },
        });
        await writeFile(lockPath, lockContent);

        // ts-llm-jsonl-importer is older version 0.4.51 (reproducing E91 root cause)
        await mkdir(join(nodeModulesDir, '@gobing-ai', 'ts-llm-jsonl-importer'), { recursive: true });
        await writeFile(
            join(nodeModulesDir, '@gobing-ai', 'ts-llm-jsonl-importer', 'package.json'),
            JSON.stringify({ version: '0.4.51' }),
        );
        // ts-db is completely missing

        const drifts = checkDependencyDrift({ lockfilePath: lockPath, nodeModulesDir });
        expect(drifts).toHaveLength(2);

        const importerDrift = drifts.find((d) => d.name === '@gobing-ai/ts-llm-jsonl-importer');
        expect(importerDrift?.installed).toBe('0.4.51');
        expect(importerDrift?.locked).toBe('0.4.55');

        const dbDrift = drifts.find((d) => d.name === '@gobing-ai/ts-db');
        expect(dbDrift?.installed).toBeNull();
        expect(dbDrift?.locked).toBe('0.4.55');

        const code = await dependencyDriftCheck({ lockfilePath: lockPath, nodeModulesDir, quiet: true });
        expect(code).toBe(1);

        await rm(dir, { recursive: true });
    });

    test('resolves nested bun.lock keys to the nested install location (regression: scoped-key flattening)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'drift-check-test-'));
        const lockPath = join(dir, 'bun.lock');
        const nodeModulesDir = join(dir, 'node_modules');

        // bun.lock shape from E93: a ts-* parent pinning its own ts-db resolution
        // emits key "<parent>/<child>", installed at
        // node_modules/<parent>/node_modules/<child>.
        const lockContent = JSON.stringify({
            packages: {
                '@gobing-ai/ts-llm-jsonl-importer/@gobing-ai/ts-db': ['@gobing-ai/ts-db@0.4.65'],
            },
        });
        await writeFile(lockPath, lockContent);

        const nestedDir = join(
            nodeModulesDir,
            '@gobing-ai',
            'ts-llm-jsonl-importer',
            'node_modules',
            '@gobing-ai',
            'ts-db',
        );
        await mkdir(nestedDir, { recursive: true });
        await writeFile(join(nestedDir, 'package.json'), JSON.stringify({ version: '0.4.65' }));

        const drifts = checkDependencyDrift({ lockfilePath: lockPath, nodeModulesDir });
        expect(drifts).toHaveLength(0);

        await rm(dir, { recursive: true });
    });

    test('detects nested-resolution divergence without blaming the hoisted copy', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'drift-check-test-'));
        const lockPath = join(dir, 'bun.lock');
        const nodeModulesDir = join(dir, 'node_modules');

        // Hoisted ts-db matches its own top-level entry; the nested key pins an
        // older copy for the importer. Only the nested mismatch may be reported,
        // under the child package name.
        const lockContent = JSON.stringify({
            packages: {
                '@gobing-ai/ts-db': ['@gobing-ai/ts-db@0.5.12'],
                '@gobing-ai/ts-llm-jsonl-importer/@gobing-ai/ts-db': ['@gobing-ai/ts-db@0.4.65'],
            },
        });
        await writeFile(lockPath, lockContent);

        await mkdir(join(nodeModulesDir, '@gobing-ai', 'ts-db'), { recursive: true });
        await writeFile(
            join(nodeModulesDir, '@gobing-ai', 'ts-db', 'package.json'),
            JSON.stringify({ version: '0.5.12' }),
        );
        const nestedDir = join(
            nodeModulesDir,
            '@gobing-ai',
            'ts-llm-jsonl-importer',
            'node_modules',
            '@gobing-ai',
            'ts-db',
        );
        await mkdir(nestedDir, { recursive: true });
        await writeFile(join(nestedDir, 'package.json'), JSON.stringify({ version: '0.4.60' }));

        const drifts = checkDependencyDrift({ lockfilePath: lockPath, nodeModulesDir });
        expect(drifts).toHaveLength(1);
        expect(drifts[0]?.name).toBe('@gobing-ai/ts-db');
        expect(drifts[0]?.installed).toBe('0.4.60');
        expect(drifts[0]?.locked).toBe('0.4.65');

        await rm(dir, { recursive: true });
    });

    test('lockKeyPackageName derives the package from plain, scoped, and nested keys', () => {
        expect(lockKeyPackageName('zod')).toBe('zod');
        expect(lockKeyPackageName('@gobing-ai/ts-db')).toBe('@gobing-ai/ts-db');
        expect(lockKeyPackageName('parent-pkg/zod')).toBe('zod');
        expect(lockKeyPackageName('@gobing-ai/ts-llm-jsonl-importer/@gobing-ai/ts-db')).toBe('@gobing-ai/ts-db');
    });
});
