#!/usr/bin/env bun
/**
 * transition-shim-check — two-sided gate over `config/transition-shims.json`
 * (task 0541, feature B2).
 *
 * A transition shim is a compatibility path that must survive the agent-role
 * transition. Every shim carries a source marker comment `@transition-shim(<id>)`
 * so it is a grep target and a review signal, and a manifest entry in
 * `config/transition-shims.json` records who owns it and when it can be removed.
 *
 * The gate is deliberately two-sided: a marker with no manifest entry
 * FAILS, and a manifest entry whose marker no longer appears in source
 * FAILS. Without the second half the manifest would rot into a permanent
 * suppression list — the exact invisible-debt pattern this gate exists to
 * end.
 *
 * Marker convention (docs/04_DESIGN.md §2.5):
 *   // @transition-shim(<id>) — <one line on what this keeps working>
 *   <id> matches ^[a-z0-9][a-z0-9-]*$ (lowercase kebab).
 * Markers live in production source roots (apps, packages, plugins, config,
 * scripts, tooling). Docs and test fixtures are not scanned — prose examples
 * and gate-fixture marker text must not trip the gate.
 *
 * The manifest is the removal worklist: emptying it is the definition of the
 * transition being complete (R4).
 *
 * Ships with the plugin to arbitrary projects, so it stays node-builtin-only —
 * no workspace imports.
 *
 * Usage:
 *   bun plugins/sp/scripts/transition-shim-check.ts
 *     [--manifest <path>]           default: config/transition-shims.json
 *     [--roots <a,b,c>]             default: apps,packages,plugins,config,scripts,tooling
 *
 * Exit code: 0 when every manifest entry is present in source and every source
 * marker is registered; 1 on any violation (unregistered marker, stale entry,
 * or incomplete entry). Violations are printed to stderr; a summary to stdout.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const MARKER_RE = /@transition-shim\(\s*([a-z0-9][a-z0-9-]*)\s*\)/g;
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Directories never scanned for markers (build output, vendored, VCS internals).
 * `tests`/`test` are excluded too: a test fixture that mentions a marker id is
 * data exercising the gate, not a compatibility path — shims live in production
 * source, and only there do they need tracking. */
const SKIP_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    'coverage',
    '.spur',
    'build',
    '.next',
    '.venv',
    '__pycache__',
    'vendors',
    '_legacy_reference',
    'artifacts',
    'tests',
    'test',
]);

const DEFAULT_ROOTS = ['apps', 'packages', 'plugins', 'config', 'scripts', 'tooling'];

/** One manifest record — every field is required (R1). */
interface ManifestEntry {
    id: string;
    wbs: string;
    file: string;
    keepsWorking: string;
    removalCondition: string;
}

interface Violation {
    kind: 'unregistered' | 'stale' | 'incomplete';
    id: string;
    message: string;
}

function parseArgs(argv: string[]): { manifest: string; roots: string[]; cwd: string } {
    let manifest = 'config/transition-shims.json';
    let roots = DEFAULT_ROOTS;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--manifest') manifest = argv[++i] ?? manifest;
        else if (argv[i] === '--roots') roots = (argv[++i] ?? '').split(',').filter(Boolean);
    }
    return { manifest, roots, cwd: process.cwd() };
}

/** Walk a root and return marker id -> repo-relative files. */
function scanMarkers(cwd: string, roots: string[]): Map<string, Set<string>> {
    const found = new Map<string, Set<string>>();
    const walk = (dir: string): void => {
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            return; // unreadable or missing root — skip
        }
        for (const name of entries) {
            if (SKIP_DIRS.has(name)) continue;
            const abs = join(dir, name);
            let st: ReturnType<typeof statSync>;
            try {
                st = statSync(abs);
            } catch {
                continue;
            }
            if (st.isDirectory()) {
                walk(abs);
                continue;
            }
            if (!st.isFile()) continue;
            let text: string;
            try {
                text = readFileSync(abs, 'utf8');
            } catch {
                continue; // binary or unreadable — markers are text only
            }
            for (const m of text.matchAll(MARKER_RE)) {
                const id = m[1] as string;
                const file = relative(cwd, abs);
                const set = found.get(id) ?? new Set<string>();
                set.add(file);
                found.set(id, set);
            }
        }
    };
    for (const root of roots) walk(resolve(cwd, root));
    return found;
}

/** Load the manifest; a missing file degrades to no entries (fail-open). */
function loadManifest(path: string): { entries: ManifestEntry[]; raw: string | null } {
    if (!existsSync(path)) return { entries: [], raw: null };
    const raw = readFileSync(path, 'utf8');
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        return { entries: [], raw: `malformed JSON at ${path}: ${String(error)}` };
    }
    const entries = (parsed as { entries?: unknown[] }).entries;
    if (!Array.isArray(entries)) return { entries: [], raw: `${path}: missing "entries" array` };
    return { entries: entries as ManifestEntry[], raw: null };
}

function validateEntry(e: ManifestEntry, violations: Violation[]): void {
    const field = (key: keyof ManifestEntry, value: unknown, why: string): void => {
        if (typeof value !== 'string' || value.trim() === '') {
            violations.push({
                kind: 'incomplete',
                id: typeof e.id === 'string' ? e.id : '<missing>',
                message: `manifest entry ${JSON.stringify(e.id ?? null)} is missing required field "${key}"${why}`,
            });
        }
    };
    field('id', e.id, '');
    field('wbs', e.wbs, ` in entry ${JSON.stringify(e.id ?? null)}`);
    field('file', e.file, ` in entry ${JSON.stringify(e.id ?? null)}`);
    field('keepsWorking', e.keepsWorking, ` in entry ${JSON.stringify(e.id ?? null)}`);
    field('removalCondition', e.removalCondition, ` in entry ${JSON.stringify(e.id ?? null)}`);
    if (typeof e.id === 'string' && e.id !== '' && !ID_RE.test(e.id)) {
        violations.push({
            kind: 'incomplete',
            id: e.id,
            message: `manifest entry id ${JSON.stringify(e.id)} is not lowercase-kebab (^[a-z0-9][a-z0-9-]*$)`,
        });
    }
}

function run(): number {
    const { manifest, roots, cwd } = parseArgs(process.argv.slice(2));
    const manifestPath = resolve(cwd, manifest);
    const { entries, raw } = loadManifest(manifestPath);
    const violations: Violation[] = [];
    const incomplete = new Set<string>();

    if (raw !== null) {
        violations.push({ kind: 'incomplete', id: '<manifest>', message: raw });
        // A manifest that cannot be parsed has no valid entries to compare against.
        for (const v of violations) console.error(`transition-shim-check: FAIL - ${v.message}`);
        console.error('transition-shim-check: FAIL - manifest unreadable; refusing to pass');
        return 1;
    }

    for (const e of entries) {
        const before = violations.length;
        validateEntry(e, violations);
        if (violations.length > before) incomplete.add(String(e.id));
    }

    const markers = scanMarkers(cwd, roots);
    const observedIds = new Set(markers.keys());
    const manifestIds = new Set(entries.filter((e) => !incomplete.has(String(e.id))).map((e) => e.id));

    for (const [id, files] of markers) {
        if (manifestIds.has(id)) continue;
        const file = [...files].sort().join(', ');
        violations.push({
            kind: 'unregistered',
            id,
            message: `new unregistered shim @transition-shim(${id}) in ${file} — add an entry to ${manifest} or remove the marker`,
        });
    }
    for (const e of entries) {
        if (incomplete.has(e.id)) continue;
        if (observedIds.has(e.id)) continue;
        violations.push({
            kind: 'stale',
            id: e.id,
            message: `stale manifest entry ${e.id} (wbs ${e.wbs}) — @transition-shim(${e.id}) no longer appears in source; remove the entry, its removal condition was: ${e.removalCondition}`,
        });
    }

    const unregistered = violations.filter((v) => v.kind === 'unregistered');
    const stale = violations.filter((v) => v.kind === 'stale');
    const incompleteCount = violations.filter((v) => v.kind === 'incomplete').length;
    const ok = violations.length === 0;

    const noun = entries.length === 1 ? 'entry' : 'entries';
    console.log(
        `transition-shim-check: ${markers.size} marker(s) observed, ${entries.length} manifest ${noun} baselined, ` +
            `${unregistered.length} new, ${stale.length} stale, ${incompleteCount} incomplete — ${ok ? 'PASS' : 'FAIL'}`,
    );
    if (ok) return 0;

    for (const v of violations) {
        console.error(`transition-shim-check: ${v.kind === 'incomplete' ? 'FAIL' : `FAIL (${v.kind})`} - ${v.message}`);
    }
    return 1;
}

process.exit(run());
