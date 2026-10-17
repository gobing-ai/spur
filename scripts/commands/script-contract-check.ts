#!/usr/bin/env bun
/**
 * script-contract-check — final hook-only contract over plugins/sp scripts
 * (task 1213; supersedes the 0600 manifest/twin gate retired with script-root).
 *
 * plugins/sp/scripts holds ONLY registered hook entries; everything else moved to
 * approved CLI surfaces (script absorption PR-1..PR-9). Enforced here:
 * 1. No non-hook script files under plugins/sp/scripts (everything lives in scripts/hooks/)
 *    and no `.mjs` twins — the standard/repo-only registry and `superskill script convert`
 *    machinery are retired.
 * 2. Hook identity/layout (ADR-129): every `hooks.json` identity resolves to one authored
 *    `scripts/hooks/<id>.ts` entry, no shadow entries under `hooks/`, no unregistered
 *    entries, hook tests only in `plugins/sp/tests/hooks`.
 * 3. No bundled surface (scripts, hooks, lib) value-imports `@gobing-ai/*` — install-time
 *    bundling runs with no node_modules (task 0669); `import type` is exempt.
 * 4. No shipped surface (commands/, skills/, agents/, README.md, repo workflows) invokes the
 *    retired script machinery: direct `bun plugins/sp/scripts/…` calls, project-first script
 *    probes, or `superskill script path`.
 *
 * Usage:
 *   bun scripts/spur-dev.ts script-contract-check
 *     [--scripts-dir <path>]  default: plugins/sp/scripts
 *     [--plugin-dir <path>]   default: plugins/sp
 *
 * Placement scan (ADR-130) — plugins/sp script placement contract only:
 *   bun scripts/spur-dev.ts script-contract-check --placement-only
 *     [--repo-root <dir>]     default: . (fixture tests point this at a temp tree)
 *
 * Exit code: 0 on success, 1 on any violation.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface ScriptViolation {
    kind: 'stray_script' | 'stray_twin' | 'hook-layout' | 'gobing_ai_import' | 'forbidden_invocation';
    target: string;
    message: string;
}

export function parseArgs(argv: string[]): {
    scriptsDir: string;
    pluginDir: string;
    placementOnly: boolean;
    repoRoot: string;
    cwd: string;
} {
    let scriptsDir = 'plugins/sp/scripts';
    let pluginDir = 'plugins/sp';
    let placementOnly = false;
    let repoRoot = '.';
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--scripts-dir') scriptsDir = argv[++i] ?? scriptsDir;
        else if (argv[i] === '--plugin-dir') pluginDir = argv[++i] ?? pluginDir;
        else if (argv[i] === '--placement-only') placementOnly = true;
        else if (argv[i] === '--repo-root') repoRoot = argv[++i] ?? repoRoot;
    }
    return { scriptsDir, pluginDir, placementOnly, repoRoot, cwd: process.cwd() };
}

export function scanShippedSurfaces(pluginDir: string): Array<{ file: string; line: number; content: string }> {
    const matches: Array<{ file: string; line: number; content: string }> = [];

    // 1213: every pattern names retired machinery — a hit is always a violation. The 0960-era
    // same-line `config/plugin-scripts.json` guard exemption is gone with the manifest: there is
    // no legal way to probe a plugin script path anymore (the five absorbed scripts and their
    // resolver are deleted; workflows and the driver call `$spurBin` CLI nouns directly).
    const retiredPatterns = [
        /\[ -f "?plugins\/sp\/scripts\//,
        /\b[A-Z_]*S(?:CRIPT)?="?plugins\/sp\/scripts\//,
        /\bbun plugins\/sp\/scripts\//,
        /\bsuperskill script path\b/,
    ];
    const isHit = (line: string): boolean => retiredPatterns.some((pattern) => pattern.test(line));

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
            push(filePath, i + 1, trimmed);
        }
    }

    /**
     * The repo-root workflow definitions also ship, and their shell lives in folded
     * `command:` blocks. The block — not the line — is the unit of judgment: any retired
     * pattern inside the block fails, comments excepted.
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
                for (const b of block) {
                    const trimmed = b.text.trim();
                    if (trimmed.startsWith('#')) continue;
                    if (!isHit(b.text)) continue;
                    push(filePath, b.no, trimmed);
                }
                i = j;
                continue;
            }
            if (inlineKey) {
                const value = inlineKey[2] ?? '';
                if (!line.trim().startsWith('#') && isHit(value)) {
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

    // The workflow tree is repo-only (resolved from pluginDir/../..); a consumer's own
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

export function validateScriptLayout(opts: { scriptsDir: string; pluginDir: string }): ScriptViolation[] {
    const violations: ScriptViolation[] = [];
    const { scriptsDir, pluginDir } = opts;

    // Rule 1: hook-only script layout — every file under scripts/ is an authored hook entry
    // under scripts/hooks/, authored as .ts (no .mjs twins, no registry).
    function walkScripts(dir: string, base: string): void {
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
                walkScripts(fullPath, base ? `${base}/${entry}` : entry);
            } else if (st.isFile()) {
                const rel = base ? `${base}/${entry}` : entry;
                if (rel.endsWith('.mjs')) {
                    violations.push({
                        kind: 'stray_twin',
                        target: rel,
                        message: `.mjs twin ${rel} is retired machinery — delete it; hook entries are authored .ts run by \`superskill hook run\``,
                    });
                } else if (!rel.startsWith('hooks/') || !rel.endsWith('.ts')) {
                    violations.push({
                        kind: 'stray_script',
                        target: rel,
                        message: `non-hook script ${rel} under plugins/sp/scripts — reusable behavior belongs in an approved CLI surface (ADR-130), hook entries in scripts/hooks/`,
                    });
                }
            }
        }
    }
    walkScripts(scriptsDir, '');

    // Rule 2: hook identity/layout (ADR-129) — registry ↔ entries, no shadow entries, tests
    // in the plugin test owner.
    for (const finding of checkHookLayout({ repoRoot: resolve(pluginDir, '..', '..') })) {
        violations.push({
            kind: 'hook-layout',
            target: finding.file,
            message: finding.detail,
        });
    }

    // Rule 3: bundled surfaces (scripts, hooks, lib) must not value-import @gobing-ai/*.
    // superskill install bundles them with no node_modules; vendor into plugins/sp/lib/
    // or use a relative import instead.
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

    // Rule 4: scan shipped surfaces for retired invocations.
    const forbiddenHits = scanShippedSurfaces(pluginDir);
    for (const hit of forbiddenHits) {
        violations.push({
            kind: 'forbidden_invocation',
            target: `${hit.file}:${hit.line}`,
            message: `shipped surface ${hit.file}:${hit.line} invokes retired script machinery: ${hit.content}`,
        });
    }

    return violations;
}

// ---- Placement scan (ADR-130, task 1000): W0 placement-contract enforcement ----

export const GLUE_BUDGET_LINES = 250;

export type PlacementFindingKind = 'budget' | 'db-import' | 'corpus-parse' | 'noun-clash' | 'hook-layout';

export interface PlacementFinding {
    file: string;
    kind: PlacementFindingKind;
    detail: string;
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
// scripts/commands also may not open its own adapter; `import type` stays legal.
const SCRIPT_DB_MODULE = String.raw`(bun:sqlite|drizzle-orm(?:\/[\w.-]+)?|@gobing-ai\/ts-db)`;
const SCRIPT_DB_STATIC_RE = new RegExp(String.raw`^import\s+(?!type\b)[^;]*?from\s+['"]${SCRIPT_DB_MODULE}['"]`, 'm');
const SCRIPT_DB_DYNAMIC_RE = new RegExp(String.raw`\bimport\(\s*['"]${SCRIPT_DB_MODULE}['"]`);

/** First raw DB driver a repo command imports, or null. */
function scriptDbImport(content: string): string | null {
    const staticHit = SCRIPT_DB_STATIC_RE.exec(content);
    if (staticHit) return staticHit[1] ?? null;
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        const hit = SCRIPT_DB_DYNAMIC_RE.exec(line);
        // ponytail: quote-parity before the match tells code from a string literal that merely
        // names the import (build-cli patches one). Escaped quotes are not handled.
        if (hit && (line.slice(0, hit.index).match(/['"`]/g)?.length ?? 0) % 2 === 0) return hit[1] ?? null;
    }
    return null;
}

function collectPlacementTsFiles(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) collectPlacementTsFiles(abs, out);
        else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(abs);
    }
    return out;
}

/** Every `.ts` under a hooks tree, tests included — the hook-layout check owns test placement. */
function collectHookTsFiles(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) collectHookTsFiles(abs, out);
        else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(abs);
    }
    return out;
}

/**
 * The DB/corpus boundary every handwritten plugin source carries (scripts, hooks and lib).
 * Generated `.mjs`/`.d.mts` bundles are build outputs, not authored sources, so they never reach
 * here (`collectPlacementTsFiles` keeps `.ts` only).
 */
function recordDbAndCorpusFindings(
    file: string,
    content: string,
    record: (file: string, kind: PlacementFindingKind, detail: string) => void,
): void {
    const dbImport = DB_IMPORT_RE.exec(content);
    if (dbImport) {
        record(file, 'db-import', `value-import of ${dbImport[1]}`);
    } else {
        // ponytail: per-line comment skip — `//`, continuation `*`, and single-line
        // `/* … */` shapes. Trailing comments on code lines, multi-line block interiors,
        // and template-string content are not handled — widen only on a false negative.
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
            const dynamic = DB_DYNAMIC_IMPORT_RE.exec(line);
            if (dynamic) {
                record(file, 'db-import', `dynamic import of ${dynamic[1]}`);
                break;
            }
        }
    }
    if (content.includes('docs/tasks') || content.includes('docs/features')) {
        record(file, 'corpus-parse', 'contains a docs/tasks or docs/features path literal (corpus parsing)');
    }
}

interface HooksJsonGroup {
    matcher?: string;
    hooks?: Array<{ command?: string }>;
}

interface HooksJson {
    hooks?: Record<string, HooksJsonGroup[]>;
}

/** Identity from `superskill hook run sp <identity>`; null for any other command shape. */
function hookIdentity(command: string | undefined): string | null {
    return /\bhook\s+run\s+sp\s+([\w-]+)/.exec(command ?? '')?.[1] ?? null;
}

/** Registered identities from `hooks.json`, plus the findings its structure produces. */
function registeredHookIdentities(hooksJsonPath: string): { registered: Set<string>; findings: PlacementFinding[] } {
    const registered = new Set<string>();
    const findings: PlacementFinding[] = [];
    if (!existsSync(hooksJsonPath)) return { registered, findings };
    let parsed: HooksJson = {};
    try {
        parsed = JSON.parse(readFileSync(hooksJsonPath, 'utf8')) as HooksJson;
    } catch (error) {
        findings.push({
            file: 'plugins/sp/hooks/hooks.json',
            kind: 'hook-layout',
            detail: `unreadable hooks.json: ${(error as Error).message}`,
        });
    }
    for (const [event, groups] of Object.entries(parsed.hooks ?? {})) {
        // One identity per event: a second registration for the same event would run the same
        // entry twice for any tool matching both matchers (task 1173 R1 — one identity, one entry).
        const seen = new Set<string>();
        for (const group of groups) {
            for (const entry of group.hooks ?? []) {
                const identity = hookIdentity(entry.command);
                if (identity === null) continue;
                registered.add(identity);
                if (seen.has(identity)) {
                    findings.push({
                        file: 'plugins/sp/hooks/hooks.json',
                        kind: 'hook-layout',
                        detail: `hook identity '${identity}' is registered twice for ${event}${group.matcher ? ` (matcher ${group.matcher})` : ''} — one identity, one authored entry`,
                    });
                }
                seen.add(identity);
            }
        }
    }
    return { registered, findings };
}

/**
 * Hook source-layout contract (ADR-129, task 1173; entry location per superskill ADR-039): one
 * registered identity has one authored entry at `plugins/sp/scripts/hooks/<identity>.ts`, reusable
 * helpers live in `plugins/sp/lib`, and hook tests live in `plugins/sp/tests/hooks`.
 *
 * Why `scripts/hooks` and not `hooks`: `superskill hook run sp <id>` resolves `hooks/<id>` before
 * `scripts/hooks/<id>` under every plugin root, but install stages only `scripts/` (and `lib/` as its
 * sibling) for Codex/OpenCode/Antigravity/Hermes. `scripts/hooks/<id>.ts` is therefore the single
 * location every target reaches. `plugins/sp/hooks` keeps the registry only (the plugin Pi extension
 * was retired 2026-10-15) — an entry there would shadow the staged one on native installs and never ship to staged targets.
 * Pure and side-effect free.
 */
export function checkHookLayout(opts: { repoRoot: string }): PlacementFinding[] {
    const root = resolve(opts.repoRoot);
    const hooksDir = join(root, 'plugins', 'sp', 'hooks');
    const entriesDir = join(root, 'plugins', 'sp', 'scripts', 'hooks');
    if (!existsSync(hooksDir)) return [];

    const { registered, findings } = registeredHookIdentities(join(hooksDir, 'hooks.json'));

    for (const identity of [...registered].sort()) {
        if (!existsSync(join(entriesDir, `${identity}.ts`))) {
            findings.push({
                file: `plugins/sp/scripts/hooks/${identity}.ts`,
                kind: 'hook-layout',
                detail: `registered hook identity '${identity}' has no authored entry under plugins/sp/scripts/hooks`,
            });
        }
    }

    const misplacedTest = (file: string): PlacementFinding => ({
        file,
        kind: 'hook-layout',
        detail: 'hook tests belong in plugins/sp/tests/hooks — one test owner for the plugin',
    });

    for (const abs of collectHookTsFiles(hooksDir).sort()) {
        const rel = abs.slice(hooksDir.length + 1);
        const file = `plugins/sp/hooks/${rel}`;
        if (rel.endsWith('.test.ts')) findings.push(misplacedTest(file));
        else {
            findings.push({
                file,
                kind: 'hook-layout',
                detail: 'plugins/sp/hooks holds hooks.json only — hook entries live in plugins/sp/scripts/hooks (the one location superskill reaches on every target, Pi included via its native adapter), helpers in plugins/sp/lib',
            });
        }
    }

    for (const abs of collectHookTsFiles(entriesDir).sort()) {
        const rel = abs.slice(entriesDir.length + 1);
        const file = `plugins/sp/scripts/hooks/${rel}`;
        if (rel.endsWith('.test.ts')) findings.push(misplacedTest(file));
        else if (!registered.has(rel.replace(/\.ts$/, ''))) {
            findings.push({
                file,
                kind: 'hook-layout',
                detail: 'not a registered hook entry (no `superskill hook run sp <id>` in hooks.json) — reusable helpers belong in plugins/sp/lib',
            });
        }
    }
    return findings;
}

export function checkPlacement(opts: { repoRoot: string }): PlacementFinding[] {
    const root = resolve(opts.repoRoot);
    const findings: PlacementFinding[] = [];
    const record = (file: string, kind: PlacementFindingKind, detail: string): void => {
        findings.push({ file, kind, detail });
    };

    const cliCommandsDir = join(root, 'apps', 'cli', 'src', 'commands');
    const cliCommandNames = existsSync(cliCommandsDir)
        ? new Set(
              // A noun is `commands/<noun>.ts` or a per-verb folder `commands/<noun>/` (index.ts inside).
              readdirSync(cliCommandsDir)
                  .map((f) => (existsSync(join(cliCommandsDir, f, 'index.ts')) ? `${f}.ts` : f))
                  .filter((f) => f.endsWith('.ts')),
          )
        : new Set<string>();
    const repoCommandsDir = join(root, 'scripts', 'commands');
    if (existsSync(repoCommandsDir)) {
        for (const name of readdirSync(repoCommandsDir)) {
            if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
            const rel = join('scripts/commands', name);
            if (cliCommandNames.has(name)) {
                record(rel, 'noun-clash', `basename clashes with public CLI command apps/cli/src/commands/${name}`);
            }
            // ADR-130 (2026-10-16): repo tooling reads the DB through packages/domain (`openExistingDb`
            // + a domain query), never a raw driver — raw SQL here is a second query owner. Corpus
            // reads stay legal: repo gates legitimately inspect docs.
            const dbImport = scriptDbImport(readFileSync(join(repoCommandsDir, name), 'utf8'));
            if (dbImport) record(rel, 'db-import', `${dbImport} outside packages/domain — use a domain query`);
        }
    }

    for (const dir of [join(root, 'plugins', 'sp', 'scripts'), join(root, 'plugins', 'sp', 'hooks')]) {
        for (const abs of collectPlacementTsFiles(dir)) {
            const rel = abs.slice(root.length + 1);
            const content = readFileSync(abs, 'utf8');
            const lines = placementLineCount(content);
            if (lines > GLUE_BUDGET_LINES) record(rel, 'budget', `${lines} lines > budget ${GLUE_BUDGET_LINES}`);
            recordDbAndCorpusFindings(rel, content, record);
        }
    }

    // Handwritten lib carries the same DB/corpus boundary but no line budget: P2 of the A91 plan —
    // a line count is a review trigger, not an architecture test — so shortening a wrapper cannot
    // push application logic into lib without the boundary still answering for it.
    for (const abs of collectPlacementTsFiles(join(root, 'plugins', 'sp', 'lib'))) {
        recordDbAndCorpusFindings(abs.slice(root.length + 1), readFileSync(abs, 'utf8'), record);
    }

    // Hook source layout (ADR-129): one authored entry per registered identity, helpers in lib,
    // tests in the plugin test owner.
    for (const finding of checkHookLayout({ repoRoot: root })) {
        record(finding.file, finding.kind, finding.detail);
    }

    // 1213: no baseline machinery — findings always report raw (fail closed). The ADR-130
    // baseline file was an empty migration ledger retired with the manifest.
    return findings;
}

export function run(argv: string[] = process.argv.slice(2)): number {
    const { scriptsDir, pluginDir, placementOnly, repoRoot, cwd } = parseArgs(argv);

    if (placementOnly) {
        const findings = checkPlacement({ repoRoot: resolve(cwd, repoRoot) });
        for (const f of findings) console.error(`script-contract-check: FAIL (${f.kind}) - ${f.file}: ${f.detail}`);
        console.log(
            `script-contract-check: placement scan over plugins/sp + scripts/commands — ${findings.length} finding(s) — ${findings.length === 0 ? 'PASS' : 'FAIL'}`,
        );
        return findings.length === 0 ? 0 : 1;
    }

    const absScriptsDir = resolve(cwd, scriptsDir);
    const absPluginDir = resolve(cwd, pluginDir);

    const violations = validateScriptLayout({ scriptsDir: absScriptsDir, pluginDir: absPluginDir });
    const ok = violations.length === 0;

    console.log(
        `script-contract-check: hook-only script layout over plugins/sp — ` +
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
