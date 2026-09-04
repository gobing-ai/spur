#!/usr/bin/env bun
/**
 * composition-entrypoint-check — ADR-051 mechanical placement check widened to
 * `scripts/commands/` and the package.json composition entrypoints
 * (task 0754 R7).
 *
 * Original ADR-051 placement check (via `script-contract-check.ts`) covered
 * plugins/sp scripts against `config/plugin-scripts.json`. This sibling
 * check widens coverage to the main repo's `scripts/commands/` directory:
 * every composition-relevant `.ts` entrypoint there must be reachable through
 * a `package.json` script, and the `regen-corpus-baseline` /
 * `regen-composition-baseline` entrypoints must be invoked through their
 * npm-script names rather than bare paths.
 *
 * Two-sided: a script on disk with no package.json entry FAILS; a
 * package.json composition entry pointing at a missing file FAILS.
 *
 * Usage:
 *   bun scripts/commands/composition-entrypoint-check.ts
 *     [--root <path>]               default: repo root
 *     [--commands-dir <path>]       default: scripts/commands
 *     [--package-json <path>]       default: package.json
 *
 * Exit code: 0 when every commands/*.ts file is reachable and every
 * referenced entrypoint exists; 1 on any violation.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface PackageJson {
    scripts?: Record<string, string>;
}

const COMPOSITION_ENTRYPOINTS = ['regen-corpus-baseline', 'regen-composition-baseline'] as const;

function listTsFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter((f) => f.endsWith('.ts'))
        .map((f) => join(dir, f));
}

function parseArgs(argv: string[]): { root: string; commandsDir: string; packageJson: string } {
    let root = resolve('.');
    let commandsDir = 'scripts/commands';
    let packageJson = 'package.json';
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--root' && i + 1 < argv.length) root = resolve(argv[++i] ?? '.');
        else if (arg === '--commands-dir' && i + 1 < argv.length) commandsDir = argv[++i] ?? commandsDir;
        else if (arg === '--package-json' && i + 1 < argv.length) packageJson = argv[++i] ?? packageJson;
    }
    return { root, commandsDir, packageJson };
}

async function main(): Promise<number> {
    const { root, commandsDir, packageJson } = parseArgs(process.argv.slice(2));
    const errors: string[] = [];

    const pkgPath = join(root, packageJson);
    if (!existsSync(pkgPath)) {
        process.stderr.write(`composition-entrypoint-check: package.json not found at ${pkgPath}\n`);
        return 1;
    }
    let pkg: PackageJson;
    try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJson;
    } catch (err) {
        process.stderr.write(`composition-entrypoint-check: failed to parse ${pkgPath}: ${String(err)}\n`);
        return 1;
    }
    const scripts = pkg.scripts ?? {};

    const tsFiles = listTsFiles(join(root, commandsDir));
    for (const tsFile of tsFiles) {
        const baseName = tsFile.split('/').pop()?.replace(/\.ts$/, '') ?? '';
        const entryName = `regen-${baseName.replace(/^regen-/, '')}`;
        const isCompositionEntry = (COMPOSITION_ENTRYPOINTS as readonly string[]).includes(entryName);
        if (!isCompositionEntry) continue;
        const scriptValue = scripts[entryName] ?? '';
        if (!scriptValue.includes(`${baseName}.ts`)) {
            errors.push(
                `${tsFile}: composition entrypoint "${entryName}" not reachable through package.json (script: ${scriptValue || '<missing>'})`,
            );
        }
    }

    for (const entry of COMPOSITION_ENTRYPOINTS) {
        const scriptValue = scripts[entry];
        if (scriptValue === undefined) {
            errors.push(`${packageJson}: composition entrypoint "${entry}" missing`);
            continue;
        }
        const m = scriptValue.match(/scripts\/commands\/([^\s]+\.ts)/);
        if (!m) {
            errors.push(
                `${packageJson}: composition entrypoint "${entry}" must invoke scripts/commands/<name>.ts (got: ${scriptValue})`,
            );
            continue;
        }
        const target = join(root, 'scripts/commands', m[1] ?? '');
        if (!existsSync(target)) {
            errors.push(`${packageJson}: "${entry}" references ${target} which does not exist`);
        }
    }

    if (errors.length > 0) {
        process.stderr.write(`composition-entrypoint-check: ${errors.length} violation(s)\n`);
        for (const e of errors) process.stderr.write(`  - ${e}\n`);
        return 1;
    }

    process.stdout.write(
        `composition-entrypoint-check: ok (${COMPOSITION_ENTRYPOINTS.length} composition entrypoints wired through package.json)\n`,
    );
    return 0;
}

process.exit(await main());
