#!/usr/bin/env bun
/**
 * script-contract-check — two-sided gate over plugins/sp script entrypoint contracts
 * (task 0600, feature I, ADR-065).
 *
 * Enforces superskill's standard plugin script contract across plugins/sp:
 * 1. A 'standard' entry must have a valid .mjs twin byte-identical to a fresh convert of its .ts source.
 * 2. A .mjs twin on disk must be registered under a 'standard' entry (never 'repo-only' or unlisted).
 * 3. Every script file under plugins/sp/scripts/ must have a manifest entry (two-sided).
 * 4. No shipped surface (commands/, skills/, agents/, README.md) may reference 'bun plugins/sp/scripts/'.
 *
 * Usage:
 *   bun scripts/commands/script-contract-check.ts
 *     [--manifest <path>]     default: config/plugin-scripts.json
 *     [--scripts-dir <path>]  default: plugins/sp/scripts
 *     [--plugin-dir <path>]   default: plugins/sp
 *
 * Placement scan (ADR-130, task 1000) — plugins/sp script placement contract only:
 *   bun scripts/commands/script-contract-check.ts --placement-only
 *     [--baseline <path>]     default: config/script-placement-baseline.json
 *     [--repo-root <dir>]     default: . (fixture tests point this at a temp tree)
 *
 * Exit code: 0 on success, 1 on any violation.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

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
        | 'converter_unavailable'
        | 'gobing_ai_import'
        | 'incomplete';
    target: string;
    message: string;
}

export function parseArgs(argv: string[]): {
    manifest: string;
    scriptsDir: string;
    pluginDir: string;
    placementOnly: boolean;
    baseline: string;
    repoRoot: string;
    cwd: string;
} {
    let manifest = 'config/plugin-scripts.json';
    let scriptsDir = 'plugins/sp/scripts';
    let pluginDir = 'plugins/sp';
    let placementOnly = false;
    let baseline = 'config/script-placement-baseline.json';
    let repoRoot = '.';
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--manifest') manifest = argv[++i] ?? manifest;
        else if (argv[i] === '--scripts-dir') scriptsDir = argv[++i] ?? scriptsDir;
        else if (argv[i] === '--plugin-dir') pluginDir = argv[++i] ?? pluginDir;
        else if (argv[i] === '--placement-only') placementOnly = true;
        else if (argv[i] === '--baseline') baseline = argv[++i] ?? baseline;
        else if (argv[i] === '--repo-root') repoRoot = argv[++i] ?? repoRoot;
    }
    return { manifest, scriptsDir, pluginDir, placementOnly, baseline, repoRoot, cwd: process.cwd() };
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
    const guardMarker = 'config/plugin-scripts.json';

    // 0960 R5: the probe shapes the guard idiom introduces, plus the legacy literal. A hit is
    // legal only when its line (or, for a YAML command block, its folded block) names the
    // source-repo marker — otherwise it is a project-first probe that shadows the installed
    // twin in a consumer.
    const projectFirstPatterns = [
        /\[ -f "?plugins\/sp\/scripts\//,
        /\b[A-Z_]*S(?:CRIPT)?="?plugins\/sp\/scripts\//,
        /\bbun plugins\/sp\/scripts\//,
    ];
    const isHit = (line: string): boolean => projectFirstPatterns.some((pattern) => pattern.test(line));

    function push(file: string, line: number, content: string): void {
        matches.push({ file, line, content: content.trim() });
    }

    function scanLines(filePath: string): void {
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
            const trimmed = line.trim();
            if (trimmed.startsWith('#')) continue; // comment lines are not executable probes
            if (!isHit(line)) continue;
            if (line.includes(guardMarker)) continue; // same-line source-repo guard
            push(filePath, i + 1, trimmed);
        }
    }

    /**
     * 0960 R5: the repo-root workflow definitions also ship, and their shell lives in folded
     * `command:` blocks. A guard on one physical line legalizes the invocation on the next, so
     * the block — not the line — is the unit of judgment. Markdown prose references (backticked
     * paths with no `[ -f` / assignment / `bun ` prefix) never match the patterns, so they stay
     * legal.
     */
    function scanYamlCommands(filePath: string): void {
        if (!existsSync(filePath)) return;
        let text: string;
        try {
            text = readFileSync(filePath, 'utf8');
        } catch {
            return;
        }
        const lines = text.split('\n');
        let i = 0;
        while (i < lines.length) {
            const line = lines[i] ?? '';
            const blockKey = /^(\s*)command:\s*(?:>[+-]?|\|[+-]?)?\s*$/.exec(line);
            const inlineKey = /^(\s*)command:\s+(.+)$/.exec(line);
            if (blockKey) {
                const indent = (blockKey[1] ?? '').length;
                const block: Array<{ no: number; text: string }> = [];
                let j = i + 1;
                while (j < lines.length) {
                    const next = lines[j] ?? '';
                    if (next.trim() === '') {
                        block.push({ no: j + 1, text: next });
                        j++;
                        continue;
                    }
                    const nextIndent = (next.match(/^\s*/)?.[0] ?? '').length;
                    if (nextIndent <= indent) break;
                    block.push({ no: j + 1, text: next });
                    j++;
                }
                if (!block.some((b) => b.text.includes(guardMarker))) {
                    for (const b of block) {
                        const trimmed = b.text.trim();
                        if (trimmed.startsWith('#')) continue;
                        if (!isHit(b.text)) continue;
                        if (b.text.includes(guardMarker)) continue;
                        push(filePath, b.no, trimmed);
                    }
                }
                i = j;
                continue;
            }
            if (inlineKey) {
                const value = inlineKey[2] ?? '';
                if (!line.trim().startsWith('#') && isHit(value) && !value.includes(guardMarker)) {
                    push(filePath, i + 1, line.trim());
                }
                i++;
                continue;
            }
            i++;
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
                scanLines(fullPath);
            }
        }
    }

    for (const d of ['commands', 'skills', 'agents']) {
        walk(join(pluginDir, d));
    }
    scanLines(join(pluginDir, 'README.md'));

    // 0960 R5: the workflow tree is repo-only (resolved from pluginDir/../..); a consumer's own
    // workflow definitions are not this rule's subject.
    const workflowsDir = resolve(pluginDir, '..', '..', 'config', 'workflows');
    let workflowFiles: string[] = [];
    try {
        workflowFiles = readdirSync(workflowsDir).filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'));
    } catch {
        workflowFiles = [];
    }
    for (const name of workflowFiles.sort()) {
        scanYamlCommands(join(workflowsDir, name));
    }

    return matches;
}

// Bare-specifier value imports in bundled surfaces break `superskill install`, which
// bundles hooks/scripts on targets with no node_modules (task 0669; releases
// 0.3.81–0.3.88 failed with "Bundle failed" when scripts imported @gobing-ai/ts-utils).
// Type-only imports are erased before bundling, so they stay legal. Line-based
// statement walk (import/export statements are column 0 under biome) — lookahead
// regexes misbehave in Bun 1.3.x (JSC) when grouped with lazy quantifiers.
function findGobingAiValueImports(dir: string): { file: string; line: number }[] {
    const hits: { file: string; line: number }[] = [];
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return hits;
    }
    for (const entry of entries) {
        const full = join(dir, entry);
        let st: ReturnType<typeof statSync>;
        try {
            st = statSync(full);
        } catch {
            continue;
        }
        if (st.isDirectory()) {
            hits.push(...findGobingAiValueImports(full));
        } else if (entry.endsWith('.ts')) {
            const lines = readFileSync(full, 'utf8').split('\n');
            let stmtStart = 0;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i] ?? '';
                if (/^\s*(?:import|export)\b/.test(line)) stmtStart = i;
                if (/(?:from\s*|import\s*|import\s*\(\s*)['"]@gobing-ai\//.test(line)) {
                    const opener = lines.slice(stmtStart, i + 1).join(' ');
                    if (!/^\s*(?:import|export)\s+type\b/.test(opener)) {
                        hits.push({ file: full, line: i + 1 });
                    }
                }
            }
        }
    }
    return hits;
}

/** Regenerates a standard script's twin into `outPath`; false when conversion could not run. */
export type ConvertTwin = (rel: string, outPath: string) => boolean;

/**
 * The real converter: `superskill script convert sp <rel> --out <outPath>` run from the repo
 * root, because `convert` resolves `plugins/<plugin>/scripts/<rel>` against the process cwd.
 * Returns false — never throws — on spawn error, non-zero exit, or a missing output file, and
 * records the command plus stderr in `lastError` for the `converter_unavailable` violation.
 */
export function spawnConvertTwin(repoRoot: string, bin = 'superskill'): ConvertTwin & { lastError?: string } {
    const convert: ConvertTwin & { lastError?: string } = (rel, outPath) => {
        const args = ['script', 'convert', 'sp', rel, '--out', outPath];
        const res = spawnSync(bin, args, { cwd: repoRoot, encoding: 'utf-8' });
        if (res.error || res.status !== 0 || !existsSync(outPath)) {
            const detail = (res.stderr ?? '').trim() || res.error?.message || `exit ${res.status}`;
            convert.lastError = `${bin} ${args.join(' ')}: ${detail}`;
            return false;
        }
        return true;
    };
    return convert;
}

export function validateContract(
    manifest: ScriptManifest,
    scriptsDir: string,
    pluginDir: string,
    opts: { convertTwin?: ConvertTwin } = {},
): Violation[] {
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

    // Rule 1: standard entries must have a .mjs twin byte-identical to a fresh convert.
    // mtime is never consulted: git does not store mtimes, so a committed stale twin looks
    // freshly checked-out in every clone and worktree. Only regenerating the twin proves it
    // matches its source (task 0970; replaces the 0606 sub-second mtime tolerance).
    const twinTmpDir = mkdtempSync(join(tmpdir(), 'script-twin-'));
    try {
        const convertTwin = opts.convertTwin ?? spawnConvertTwin(resolve(pluginDir, '..', '..'));
        let converterDown = false;
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
                } else if (existsSync(tsPath) && !converterDown) {
                    const outPath = join(twinTmpDir, expectedTwinRel);
                    mkdirSync(dirname(outPath), { recursive: true });
                    if (!convertTwin(entry.rel, outPath)) {
                        // One violation, then stop: a broken converter is one environment failure,
                        // not 17 stale twins. It never silently passes (task 0970 R3).
                        const detail = (convertTwin as { lastError?: string }).lastError;
                        violations.push({
                            kind: 'converter_unavailable',
                            target: entry.rel,
                            message: `could not regenerate ${expectedTwinRel} from ${entry.rel}${detail ? ` — ${detail}` : ''}; twin content cannot be verified`,
                        });
                        converterDown = true;
                    } else if (!readFileSync(outPath).equals(readFileSync(twinPath))) {
                        violations.push({
                            kind: 'stale_twin',
                            target: entry.rel,
                            message: `standard script .mjs twin ${expectedTwinRel} does not match a fresh convert of ${entry.rel} — run bun run build:scripts`,
                        });
                    }
                }
            }
        }
    } finally {
        rmSync(twinTmpDir, { recursive: true, force: true });
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

    // Rule 5: bundled surfaces (scripts, hooks, lib) must not value-import @gobing-ai/*.
    // superskill install bundles them where no node_modules exists; resolution then
    // depends on the host superskill's private dep tree (0.3.28+ happens to carry
    // ts-utils — an accident we do not depend on). Vendor into plugins/sp/lib/ instead.
    for (const dir of [scriptsDir, join(pluginDir, 'hooks'), join(pluginDir, 'lib')]) {
        for (const hit of findGobingAiValueImports(dir)) {
            violations.push({
                kind: 'gobing_ai_import',
                target: `${hit.file}:${hit.line}`,
                message:
                    `bundled surface ${hit.file}:${hit.line} value-imports @gobing-ai/* — ` +
                    'superskill install bundles it with no node_modules ("Bundle failed", task 0669). ' +
                    'Vendor into plugins/sp/lib/ or use a relative import; `import type` is exempt.',
            });
        }
    }

    return violations;
}

// ---- Placement scan (ADR-130, task 1000): W0 placement-contract enforcement ----

export const GLUE_BUDGET_LINES = 250;

export type PlacementFindingKind = 'budget' | 'db-import' | 'corpus-parse' | 'noun-clash' | 'stale-baseline';

export interface PlacementFinding {
    file: string;
    kind: PlacementFindingKind;
    detail: string;
}

export interface PlacementBaselineEntry {
    kinds: string[];
    reason?: string;
    exempt?: boolean;
}

export interface PlacementBaseline {
    schemaVersion: number;
    entries: Record<string, PlacementBaselineEntry>;
}

export function loadPlacementBaseline(path: string): { baseline: PlacementBaseline | null; error: string | null } {
    if (!existsSync(path)) return { baseline: null, error: `baseline not found: ${path}` };
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as PlacementBaseline;
        if (
            typeof parsed !== 'object' ||
            parsed === null ||
            typeof parsed.entries !== 'object' ||
            parsed.entries === null
        ) {
            return { baseline: null, error: `malformed baseline (missing entries object): ${path}` };
        }
        return { baseline: parsed, error: null };
    } catch (error) {
        return { baseline: null, error: `unreadable baseline: ${(error as Error).message}` };
    }
}

function placementLineCount(content: string): number {
    const lines = content.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    return lines.length;
}

// ponytail: single line-shape regex; a value-import spread across statements in one
// expression is not a real pattern. Widen only if a false negative is reported.
const DB_IMPORT_RE = /import\s+(?!type\b)[^;]*?from\s+['"](bun:sqlite|drizzle-orm(?:\/[\w.-]+)?)['"]/;
const DB_DYNAMIC_IMPORT_RE = /\bimport\(\s*['"](bun:sqlite|drizzle-orm(?:\/[\w.-]+)?)['"]\s*\)/;

function collectPlacementTsFiles(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) collectPlacementTsFiles(abs, out);
        else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(abs);
    }
    return out;
}

export function checkPlacement(opts: { repoRoot: string; baselinePath: string }): PlacementFinding[] {
    const root = resolve(opts.repoRoot);
    const findings: PlacementFinding[] = [];
    const produced = new Map<string, Set<PlacementFindingKind>>();
    const record = (file: string, kind: PlacementFindingKind, detail: string): void => {
        findings.push({ file, kind, detail });
        let kinds = produced.get(file);
        if (!kinds) {
            kinds = new Set<PlacementFindingKind>();
            produced.set(file, kinds);
        }
        kinds.add(kind);
    };

    const cliCommandsDir = join(root, 'apps', 'cli', 'src', 'commands');
    const cliCommandNames = existsSync(cliCommandsDir)
        ? new Set(readdirSync(cliCommandsDir).filter((f) => f.endsWith('.ts')))
        : new Set<string>();
    const repoCommandsDir = join(root, 'scripts', 'commands');
    if (existsSync(repoCommandsDir)) {
        for (const name of readdirSync(repoCommandsDir)) {
            if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
            if (cliCommandNames.has(name)) {
                record(
                    join('scripts/commands', name),
                    'noun-clash',
                    `basename clashes with public CLI command apps/cli/src/commands/${name}`,
                );
            }
        }
    }

    for (const dir of [join(root, 'plugins', 'sp', 'scripts'), join(root, 'plugins', 'sp', 'hooks')]) {
        for (const abs of collectPlacementTsFiles(dir)) {
            const rel = abs.slice(root.length + 1);
            const content = readFileSync(abs, 'utf8');
            const lines = placementLineCount(content);
            if (lines > GLUE_BUDGET_LINES) record(rel, 'budget', `${lines} lines > budget ${GLUE_BUDGET_LINES}`);
            const dbImport = DB_IMPORT_RE.exec(content);
            if (dbImport) {
                record(rel, 'db-import', `value-import of ${dbImport[1]}`);
            } else {
                // ponytail: per-line comment skip — `//`, continuation `*`, and single-line
                // `/* … */` shapes. Trailing comments on code lines, multi-line block interiors,
                // and template-string content are not handled — widen only on a false negative.
                for (const line of content.split('\n')) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
                    const dynamic = DB_DYNAMIC_IMPORT_RE.exec(line);
                    if (dynamic) {
                        record(rel, 'db-import', `dynamic import of ${dynamic[1]}`);
                        break;
                    }
                }
            }
            if (content.includes('docs/tasks') || content.includes('docs/features')) {
                record(rel, 'corpus-parse', 'contains a docs/tasks or docs/features path literal (corpus parsing)');
            }
        }
    }

    const { baseline, error } = loadPlacementBaseline(resolve(opts.baselinePath));
    if (error || !baseline) {
        // No baseline: report raw findings (fail closed for placement purposes).
        return findings;
    }
    const entries = baseline.entries;
    const out: PlacementFinding[] = [];
    for (const finding of findings) {
        const entry = entries[finding.file];
        if (entry?.kinds.includes(finding.kind)) continue;
        out.push(finding);
    }
    for (const [file, entry] of Object.entries(entries)) {
        const has = produced.get(file);
        for (const kind of entry.kinds) {
            if (!has?.has(kind as PlacementFindingKind)) {
                out.push({
                    file,
                    kind: 'stale-baseline',
                    detail: `baseline lists '${kind}' but the file no longer produces it (baseline can only shrink)`,
                });
            }
        }
    }
    return out;
}

export function run(argv: string[] = process.argv.slice(2)): number {
    const { manifest, scriptsDir, pluginDir, placementOnly, baseline, repoRoot, cwd } = parseArgs(argv);

    if (placementOnly) {
        const findings = checkPlacement({ repoRoot: resolve(cwd, repoRoot), baselinePath: resolve(cwd, baseline) });
        for (const f of findings) console.error(`script-contract-check: FAIL (${f.kind}) - ${f.file}: ${f.detail}`);
        console.log(
            `script-contract-check: placement scan over plugins/sp scripts+hooks — ${findings.length} finding(s) — ${findings.length === 0 ? 'PASS' : 'FAIL'}`,
        );
        return findings.length === 0 ? 0 : 1;
    }

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
