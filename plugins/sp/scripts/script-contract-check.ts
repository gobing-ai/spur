#!/usr/bin/env bun
/**
 * script-contract-check — two-sided gate over plugins/sp script entrypoint contracts
 * (task 0600, feature I, ADR-065).
 *
 * Enforces superskill's standard plugin script contract across plugins/sp:
 * 1. A 'standard' entry must have a valid .mjs twin not older than its .ts source.
 * 2. A .mjs twin on disk must be registered under a 'standard' entry (never 'repo-only' or unlisted).
 * 3. Every script file under plugins/sp/scripts/ must have a manifest entry (two-sided).
 * 4. No shipped surface (commands/, skills/, agents/, README.md) may reference 'bun plugins/sp/scripts/'.
 *
 * Usage:
 *   bun plugins/sp/scripts/script-contract-check.ts
 *     [--manifest <path>]     default: config/plugin-scripts.json
 *     [--scripts-dir <path>]  default: plugins/sp/scripts
 *     [--plugin-dir <path>]   default: plugins/sp
 *
 * Exit code: 0 on success, 1 on any violation.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type ScriptContractType = 'standard' | 'repo-only';

export interface ScriptManifestEntry {
    rel: string;
    contract: ScriptContractType;
    twin?: string;
}

export interface ScriptManifest {
    schema_version?: number;
    description?: string;
    entries: ScriptManifestEntry[];
}

export interface Violation {
    kind:
        | 'missing_twin'
        | 'stale_twin'
        | 'unexpected_twin'
        | 'unregistered_script'
        | 'forbidden_invocation'
        | 'incomplete';
    target: string;
    message: string;
}

export function parseArgs(argv: string[]): {
    manifest: string;
    scriptsDir: string;
    pluginDir: string;
    cwd: string;
} {
    let manifest = 'config/plugin-scripts.json';
    let scriptsDir = 'plugins/sp/scripts';
    let pluginDir = 'plugins/sp';
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--manifest') manifest = argv[++i] ?? manifest;
        else if (argv[i] === '--scripts-dir') scriptsDir = argv[++i] ?? scriptsDir;
        else if (argv[i] === '--plugin-dir') pluginDir = argv[++i] ?? pluginDir;
    }
    return { manifest, scriptsDir, pluginDir, cwd: process.cwd() };
}

export function loadManifest(path: string): { manifest: ScriptManifest | null; error: string | null } {
    if (!existsSync(path)) return { manifest: null, error: `manifest not found at ${path}` };
    try {
        const raw = readFileSync(path, 'utf8');
        const parsed = JSON.parse(raw) as ScriptManifest;
        if (!Array.isArray(parsed.entries)) {
            return { manifest: null, error: `${path}: missing "entries" array` };
        }
        return { manifest: parsed, error: null };
    } catch (err) {
        return { manifest: null, error: `malformed JSON at ${path}: ${String(err)}` };
    }
}

export function listDiskScripts(scriptsDir: string): { tsFiles: string[]; mjsFiles: string[] } {
    const tsFiles: string[] = [];
    const mjsFiles: string[] = [];

    function walk(dir: string, base: string): void {
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            return;
        }
        for (const entry of entries) {
            const fullPath = join(dir, entry);
            let st: ReturnType<typeof statSync>;
            try {
                st = statSync(fullPath);
            } catch {
                continue;
            }
            if (st.isDirectory()) {
                walk(fullPath, base ? `${base}/${entry}` : entry);
            } else if (st.isFile()) {
                const rel = base ? `${base}/${entry}` : entry;
                if (entry.endsWith('.ts')) {
                    tsFiles.push(rel);
                } else if (entry.endsWith('.mjs')) {
                    mjsFiles.push(rel);
                }
            }
        }
    }

    walk(scriptsDir, '');
    return { tsFiles: tsFiles.sort(), mjsFiles: mjsFiles.sort() };
}

export function scanShippedSurfaces(pluginDir: string): Array<{ file: string; line: number; content: string }> {
    const matches: Array<{ file: string; line: number; content: string }> = [];
    const forbiddenPattern = 'bun plugins/sp/scripts/';

    const searchDirs = ['commands', 'skills', 'agents'];
    const singleFiles = ['README.md'];

    function scanFile(filePath: string): void {
        if (!existsSync(filePath)) return;
        let text: string;
        try {
            text = readFileSync(filePath, 'utf8');
        } catch {
            return;
        }
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? '';
            if (line.includes(forbiddenPattern)) {
                matches.push({
                    file: filePath,
                    line: i + 1,
                    content: line.trim(),
                });
            }
        }
    }

    function walk(dir: string): void {
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            return;
        }
        for (const entry of entries) {
            const fullPath = join(dir, entry);
            let st: ReturnType<typeof statSync>;
            try {
                st = statSync(fullPath);
            } catch {
                continue;
            }
            if (st.isDirectory()) {
                walk(fullPath);
            } else if (
                st.isFile() &&
                (entry.endsWith('.md') || entry.endsWith('.json') || entry.endsWith('.yaml') || entry.endsWith('.yml'))
            ) {
                scanFile(fullPath);
            }
        }
    }

    for (const d of searchDirs) {
        walk(join(pluginDir, d));
    }
    for (const f of singleFiles) {
        scanFile(join(pluginDir, f));
    }

    return matches;
}

export function validateContract(manifest: ScriptManifest, scriptsDir: string, pluginDir: string): Violation[] {
    const violations: Violation[] = [];
    const { tsFiles, mjsFiles } = listDiskScripts(scriptsDir);

    const manifestMap = new Map<string, ScriptManifestEntry>();
    for (const entry of manifest.entries) {
        if (!entry.rel || !entry.contract) {
            violations.push({
                kind: 'incomplete',
                target: entry.rel ?? '<missing>',
                message: `manifest entry missing required fields (rel, contract)`,
            });
            continue;
        }
        manifestMap.set(entry.rel, entry);
    }

    // Rule 1: standard entries must have valid .mjs twins not older than the .ts source
    for (const entry of manifest.entries) {
        if (entry.rel && entry.contract === 'standard') {
            const expectedTwinRel = entry.twin ?? entry.rel.replace(/\.ts$/, '.mjs');
            const twinPath = join(scriptsDir, expectedTwinRel);
            const tsPath = join(scriptsDir, entry.rel);

            if (!existsSync(twinPath)) {
                violations.push({
                    kind: 'missing_twin',
                    target: entry.rel,
                    message: `standard script ${entry.rel} is missing its .mjs twin (${expectedTwinRel})`,
                });
            } else if (existsSync(tsPath)) {
                const tsStat = statSync(tsPath);
                const twinStat = statSync(twinPath);
                if (twinStat.mtimeMs < tsStat.mtimeMs) {
                    violations.push({
                        kind: 'stale_twin',
                        target: entry.rel,
                        message: `standard script .mjs twin ${expectedTwinRel} is older than source ${entry.rel}`,
                    });
                }
            }
        }
    }

    // Rule 2: committed .mjs files must belong to a 'standard' entry
    for (const mjsRel of mjsFiles) {
        const correspondingTsRel = mjsRel.replace(/\.mjs$/, '.ts');
        const entry = manifestMap.get(correspondingTsRel);
        if (!entry) {
            violations.push({
                kind: 'unexpected_twin',
                target: mjsRel,
                message: `.mjs twin ${mjsRel} exists on disk but has no manifest entry for ${correspondingTsRel}`,
            });
        } else if (entry.contract === 'repo-only') {
            violations.push({
                kind: 'unexpected_twin',
                target: mjsRel,
                message: `repo-only script ${correspondingTsRel} must not have a .mjs twin (${mjsRel})`,
            });
        }
    }

    // Rule 3: all .ts files on disk must have a manifest entry
    const diskTsSet = new Set(tsFiles);
    for (const tsRel of tsFiles) {
        if (!manifestMap.has(tsRel)) {
            violations.push({
                kind: 'unregistered_script',
                target: tsRel,
                message: `script ${tsRel} exists in scripts dir but is not registered in manifest`,
            });
        }
    }

    // Also verify manifest entries exist on disk
    for (const [rel] of manifestMap) {
        if (!diskTsSet.has(rel)) {
            violations.push({
                kind: 'unregistered_script',
                target: rel,
                message: `manifest entry ${rel} does not exist on disk in ${scriptsDir}`,
            });
        }
    }

    // Rule 4: scan shipped surfaces for forbidden invocation
    const forbiddenHits = scanShippedSurfaces(pluginDir);
    for (const hit of forbiddenHits) {
        violations.push({
            kind: 'forbidden_invocation',
            target: `${hit.file}:${hit.line}`,
            message: `shipped surface ${hit.file}:${hit.line} contains forbidden invocation 'bun plugins/sp/scripts/': ${hit.content}`,
        });
    }

    return violations;
}

export function run(argv: string[] = process.argv.slice(2)): number {
    const { manifest, scriptsDir, pluginDir, cwd } = parseArgs(argv);
    const manifestPath = resolve(cwd, manifest);
    const absScriptsDir = resolve(cwd, scriptsDir);
    const absPluginDir = resolve(cwd, pluginDir);

    const { manifest: parsed, error } = loadManifest(manifestPath);
    if (error || !parsed) {
        console.error(`script-contract-check: FAIL - ${error}`);
        return 1;
    }

    const violations = validateContract(parsed, absScriptsDir, absPluginDir);
    const ok = violations.length === 0;

    const standardCount = parsed.entries.filter((e) => e.contract === 'standard').length;
    const repoOnlyCount = parsed.entries.filter((e) => e.contract === 'repo-only').length;

    console.log(
        `script-contract-check: ${parsed.entries.length} script(s) baselined (${standardCount} standard, ${repoOnlyCount} repo-only), ` +
            `${violations.length} violation(s) — ${ok ? 'PASS' : 'FAIL'}`,
    );

    if (ok) return 0;

    for (const v of violations) {
        console.error(`script-contract-check: FAIL (${v.kind}) - ${v.message}`);
    }
    return 1;
}

if (import.meta.main) {
    process.exit(run());
}
