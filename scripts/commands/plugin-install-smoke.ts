#!/usr/bin/env bun
// plugin-install-smoke — release gate for the sp plugin's standalone contract.
//
// (1) hooks/**, lib/** and the hook entries under scripts/hooks/** are bundled by
//     superskill AT INSTALL time on targets with no node_modules, so they may
//     value-import only node:*/bun:* builtins or relative paths (*:*.test.ts never
//     bundles). We scan ourselves rather than trusting superskill's resolution,
//     which 0.3.28+ masks via its private deps.
// (2) A synthetic marketplace snapshot installs clean via `superskill install
//     --dry-run` — validates plugin.json, hooks.json and the install pipeline
//     without writing to real targets.

import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dir, '..', '..');
const PLUGIN = join(REPO, 'plugins', 'sp');

// Import-specifier scan, line-based statement walk (column-0 statements under
// biome; avoids Bun 1.3.x JSC lookahead quirks). `import type` / `export type`
// statements are exempt — erased before bundling.
function scanValueImports(source: string, onBare: (specifier: string) => void): void {
    const lines = source.split('\n');
    let stmtStart = 0;
    for (const [i, line] of lines.entries()) {
        if (/^\s*(?:import|export)\b/.test(line)) stmtStart = i;
        const spec = /(?:from\s*|import\s*|import\s*\(\s*)['"]([^'"]+)['"]/.exec(line)?.[1];
        // Report once per statement, on the line carrying the specifier (single-line
        // statements report here; multiline ones report on the `} from '...'` closer).
        if (!spec) continue;
        if (/^\s*(?:import|export)\s+type\b/.test(openerOf(lines, stmtStart, i))) continue;
        onBare(spec);
    }
}

function openerOf(lines: string[], from: number, to: number): string {
    return lines.slice(from, to + 1).join(' ');
}

function walkTs(dir: string): string[] {
    const files: string[] = [];
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return files;
    }
    for (const entry of entries) {
        const full = join(dir, entry);
        let st: ReturnType<typeof statSync>;
        try {
            st = statSync(full);
        } catch {
            continue;
        }
        if (st.isDirectory()) files.push(...walkTs(full));
        else if (entry.endsWith('.ts')) files.push(full);
    }
    return files;
}

const failures: string[] = [];

// Gate 1: install-bundled surfaces (hooks, lib, and the hook entries under scripts/hooks, which
// `superskill hook run` executes as-is under Bun on targets with no node_modules) — node:*/bun:*
// builtins + relative only. After 1213 every file under scripts/ is a hook entry, so the scan
// is uniformly strict.
for (const dir of ['hooks', 'lib', 'scripts']) {
    for (const file of walkTs(join(PLUGIN, dir))) {
        if (file.endsWith('.test.ts')) continue;
        const source = readFileSync(file, 'utf8');
        scanValueImports(source, (specifier) => {
            const builtin = specifier.startsWith('node:') || specifier.startsWith('bun:');
            const relative = specifier.startsWith('.') || specifier.startsWith('/');
            if (!builtin && !relative) {
                failures.push(
                    `${file}: value-imports '${specifier}' — install-bundled surface must import node:*/bun:* or relative paths only`,
                );
            }
        });
    }
}

// Gate 2: synthetic marketplace snapshot installs clean (dry-run: no target writes).
const tmp = mkdtempSync(join(tmpdir(), 'plugin-smoke-'));
try {
    mkdirSync(join(tmp, '.claude-plugin'), { recursive: true });
    const marketplace = JSON.parse(readFileSync(join(REPO, '.claude-plugin', 'marketplace.json'), 'utf8'));
    marketplace.name = 'spur-plugin-smoke';
    writeFileSync(join(tmp, '.claude-plugin', 'marketplace.json'), JSON.stringify(marketplace, null, 4));
    cpSync(PLUGIN, join(tmp, 'plugins', 'sp'), { recursive: true });

    const res = Bun.spawnSync(['superskill', 'install', 'sp', '--marketplace', tmp, '--dry-run'], {
        cwd: tmp,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const out = `${res.stdout?.toString() ?? ''}${res.stderr?.toString() ?? ''}`;
    if (res.exitCode !== 0) {
        failures.push(`superskill install --dry-run exited ${res.exitCode}:\n${out.slice(0, 2000)}`);
    } else if (!/installed|install/i.test(out)) {
        failures.push(`dry-run output missing install confirmation:\n${out.slice(0, 500)}`);
    }
} finally {
    rmSync(tmp, { recursive: true, force: true });
}

if (failures.length > 0) {
    console.error(`plugin-install-smoke FAIL — ${failures.length} violation(s):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
}
console.log('plugin-install-smoke PASS — plugin surface is standalone and installs clean');
