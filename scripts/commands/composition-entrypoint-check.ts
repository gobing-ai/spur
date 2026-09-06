#!/usr/bin/env bun
/**
 * composition-entrypoint-check — regression guard for the retired composition
 * baselines (task 0775 R1).
 *
 * The `regen-corpus-baseline` / `regen-composition-baseline` regeneration
 * entrypoints were deleted with the baseline artifacts they maintained. This
 * check keeps the deletion atomic: no `regen-*.ts` entrypoint may reappear in
 * `scripts/commands/`, and no package.json script may reference one.
 *
 * Usage:
 *   bun scripts/commands/composition-entrypoint-check.ts
 *     [--root <path>]               default: repo root
 *     [--commands-dir <path>]       default: scripts/commands
 *     [--package-json <path>]       default: package.json
 *
 * Exit code: 0 when no retired regeneration entrypoint resurfaces; 1 on any
 * violation.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface PackageJson {
    scripts?: Record<string, string>;
}

function listTsFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
        .sort();
}

async function main(): Promise<number> {
    const args = process.argv.slice(2);
    const getArg = (name: string, fallback: string): string => {
        const i = args.indexOf(name);
        return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
    };

    const root = resolve(getArg('--root', process.cwd()));
    const commandsDir = resolve(getArg('--commands-dir', join(root, 'scripts/commands')));
    const pkgPath = resolve(getArg('--package-json', join(root, 'package.json')));

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJson;
    const scripts = pkg.scripts ?? {};

    const errors: string[] = [];
    for (const tsFile of listTsFiles(commandsDir)) {
        const baseName = tsFile.split('/').pop() ?? '';
        if (/^regen-(corpus|composition)-baseline\.ts$/.test(baseName)) {
            errors.push(`${tsFile}: retired composition-baseline regenerator must not reappear (0775 R1)`);
        }
    }
    for (const [name, command] of Object.entries(scripts)) {
        if (/^regen-(corpus|composition)-baseline$/.test(name)) {
            errors.push(`${pkgPath}: package.json script "${name}" references a retired entrypoint (0775 R1)`);
        }
        if (/regen-(corpus|composition)-baseline/.test(command)) {
            errors.push(`${pkgPath}: script "${name}" invokes retired regenerator (0775 R1): ${command}`);
        }
    }

    if (errors.length > 0) {
        process.stderr.write(`composition-entrypoint-check: ${errors.length} violation(s)\n`);
        for (const e of errors) process.stderr.write(`  - ${e}\n`);
        return 1;
    }

    process.stdout.write('composition-entrypoint-check: ok (no retired composition-baseline regenerators)\n');
    return 0;
}

process.exit(await main());
