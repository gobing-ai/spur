#!/usr/bin/env bun
/**
 * persist-out-check — WT-4 pre-removal assertion for E71 persist-out (task 1067 R1, 1148 R1).
 *
 * Before `git worktree remove`, verify the worktree's OWNED durable evidence would not be abandoned:
 * every `.spur/run/` and `.spur/memory/evidence/` file starting with a forwarded `<wbs>-`/`<runId>-`
 * prefix must exist in the invoking tree with identical bytes. Unowned evidence is counted
 * (`unowned: N`) and does not block (1148 R1). Node builtins only; helpers are exported for tests.
 * Exit 0 ok, 1 blocked/divergent, 2 usage error. Normal output is the finding lines themselves.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';

const EVIDENCE_DIR = join('.spur', 'memory', 'evidence');
const RUN_DIR = join('.spur', 'run');
const NAMED_CAP = 32;
const PREFIX_CAP = 64;

/** Task files own their `<wbs>-*` evidence: leading digits before `_` in the basename. */
export function wbsOfTaskFile(path: string): string | null {
    const m = /^(\d+)_/.exec(basename(path));
    return m?.[1] ?? null;
}

export interface ListObligationsResult {
    files: string[];
    unowned: number;
}

/** Recursively list files under `dir`, relative to `root`. */
function walkFiles(dir: string, root: string): string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    const walk = (cur: string): void => {
        for (const e of readdirSync(cur, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const p = join(cur, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.isFile()) out.push(relative(root, p));
        }
    };
    walk(dir);
    return out;
}

/** Owned evidence (prefix-matched) under one plane; null once a prefix exceeds PREFIX_CAP. */
function collectOwned(rels: string[], prefixes: string[], counts: Map<string, number>, out: string[]): boolean {
    for (const rel of rels) {
        const prefix = prefixes.find((p) => basename(rel).startsWith(`${p}-`));
        if (prefix === undefined) continue;
        const count = (counts.get(prefix) ?? 0) + 1;
        if (count > PREFIX_CAP) return false;
        counts.set(prefix, count);
        out.push(rel);
    }
    return true;
}

/**
 * Evidence the worktree owns: `.spur/memory/evidence/` (recursive) and `.spur/run/` (flat) files
 * whose basename starts with a forwarded `<wbs>-`/`<runId>-` prefix. Evidence matching no prefix is
 * counted as `unowned` (1148 R1). Null when no prefix is forwarded or a prefix cap is exceeded.
 */
export function listObligations(wtRoot: string, wbsList: string[], runIds: string[]): ListObligationsResult | null {
    const prefixes = [...new Set([...wbsList, ...runIds].filter(Boolean))];
    if (prefixes.length === 0) return null;

    const evDir = join(wtRoot, EVIDENCE_DIR);
    const runDir = join(wtRoot, RUN_DIR);
    const evFiles = walkFiles(evDir, wtRoot);
    const runFiles = existsSync(runDir)
        ? readdirSync(runDir, { withFileTypes: true })
              .filter((e) => e.isFile())
              .map((e) => join(RUN_DIR, e.name))
              .sort()
        : [];

    const files: string[] = [];
    const counts = new Map<string, number>();
    if (!collectOwned(evFiles, prefixes, counts, files)) return null;
    if (!collectOwned(runFiles, prefixes, counts, files)) return null;
    const unowned = evFiles.length - files.filter((f) => f.startsWith(EVIDENCE_DIR)).length;
    return { files: [...new Set(files)].sort(), unowned };
}

/** Classify obligations against the invoking tree: missing, divergent (byte-differs), or ok. */
export function compareTrees(
    wtRoot: string,
    invokeRoot: string,
    files: string[],
    foreignDivergent = new Set<string>(),
): { missing: string[]; divergent: string[]; ok: number } {
    const missing: string[] = [];
    const divergent: string[] = [];
    let ok = 0;
    for (const rel of files) {
        if (foreignDivergent.has(rel) || foreignDivergent.has(basename(rel))) {
            continue;
        }
        const wtPath = join(wtRoot, rel);
        const invPath = join(invokeRoot, rel);
        if (!existsSync(invPath)) {
            missing.push(rel);
            continue;
        }
        try {
            const same = readFileSync(wtPath).equals(readFileSync(invPath));
            if (same) ok++;
            else divergent.push(rel);
        } catch {
            divergent.push(rel);
        }
    }
    return { missing, divergent, ok };
}

export function persistOutCheckUsage(): string {
    return 'usage: persist-out-check --from <worktree> [--task-file <path>]… [--run-id <id>]… [--root <invoke-tree>] [--success-json <path>]';
}

/**
 * The invoking tree is the MAIN repo root — never default to cwd: WT-4 runs from the
 * worktree, and comparing the worktree against itself is a vacuous pass (caught live in
 * task 1067 R4). `--git-common-dir` resolves to the shared `.git`, whose parent is the
 * main tree; inside the main tree itself this falls back to cwd, which is correct there.
 */
export function defaultInvokeRoot(cwd: string): string {
    try {
        const run = spawnSync('git', ['-C', cwd, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' });
        const common = run.stdout.trim();
        if (run.status === 0 && common) return dirname(isAbsolute(common) ? common : join(cwd, common));
    } catch {
        // git unavailable — fall through to cwd
    }
    return cwd;
}

export function main(argv: string[], invokeRoot = defaultInvokeRoot(process.cwd())): number {
    let wtRoot = '';
    let successJsonPath = '';
    const wbsList: string[] = [];
    const runIds: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--spur-bin') {
            i++;
        } else if (arg === '--from') {
            wtRoot = argv[++i] ?? '';
        } else if (arg === '--root') {
            invokeRoot = argv[++i] ?? invokeRoot;
        } else if (arg === '--task-file') {
            const wbs = wbsOfTaskFile(argv[++i] ?? '');
            if (wbs) wbsList.push(wbs);
        } else if (arg === '--run-id') {
            const id = argv[++i] ?? '';
            if (id) runIds.push(id);
        } else if (arg === '--success-json') {
            successJsonPath = argv[++i] ?? '';
        } else {
            process.stderr.write(`${persistOutCheckUsage()}\n`);
            return 2;
        }
    }
    if (wbsList.length === 0 && runIds.length === 0) {
        process.stderr.write(
            `${persistOutCheckUsage()}\npersist-out-check: at least one --task-file or --run-id prefix required\n`,
        );
        return 2;
    }
    if (!wtRoot || !existsSync(wtRoot) || !statSync(wtRoot).isDirectory()) {
        process.stderr.write(
            `${persistOutCheckUsage()}\npersist-out-check: --from must be an existing worktree directory\n`,
        );
        return 2;
    }
    const foreignDivergent = new Set<string>();
    const skips: Array<{ id: string; reason: string }> = [];
    const candidates = [
        successJsonPath,
        join(invokeRoot, '.spur', 'run', 'persist-out.json'),
        join(wtRoot, '.spur', 'run', 'persist-out.json'),
    ].filter(Boolean);
    for (const cand of candidates) {
        if (existsSync(cand)) {
            try {
                const parsed = JSON.parse(readFileSync(cand, 'utf8'));
                if (Array.isArray(parsed.evidenceSkipped)) {
                    for (const item of parsed.evidenceSkipped) {
                        if (item.reason === 'foreign-divergent' && typeof item.name === 'string') {
                            foreignDivergent.add(item.name);
                            foreignDivergent.add(join(EVIDENCE_DIR, item.name));
                        }
                    }
                }
                if (Array.isArray(parsed.skipped)) {
                    for (const item of parsed.skipped) {
                        if (typeof item.id === 'string' && typeof item.reason === 'string') {
                            skips.push({ id: item.id, reason: item.reason });
                        }
                    }
                }
                break;
            } catch {}
        }
    }
    const obligations = listObligations(wtRoot, wbsList, runIds);
    if (obligations === null) {
        process.stderr.write(
            `persist-out-check: BLOCKED — worktree evidence listing failed or exceeded caps (${PREFIX_CAP}/prefix) — inspect by hand\n`,
        );
        return 1;
    }
    const { files, unowned } = obligations;
    const { missing, divergent, ok } = compareTrees(wtRoot, invokeRoot, files, foreignDivergent);
    const findings = [
        ...missing.map((f) => `MISSING ${f}`),
        ...divergent.map((f) => `DIVERGENT ${f} — reconcile by hand (persist-out never overwrites)`),
    ];
    for (const line of findings.slice(0, NAMED_CAP)) process.stdout.write(`${line}\n`);
    if (findings.length > NAMED_CAP) process.stdout.write(`… +${findings.length - NAMED_CAP} more\n`);
    if (findings.length === 0) {
        for (const skip of skips) {
            process.stdout.write(`SKIP ${skip.id}: ${skip.reason}\n`);
        }
        const abandonedMsg = skips.length > 0 ? `${skips.length} skipped` : 'nothing abandoned';
        process.stdout.write(
            `persist-out-check: ok — ${ok} evidence file(s) persisted, unowned: ${unowned}, ${abandonedMsg}\n`,
        );
        return 0;
    }
    process.stderr.write(
        `persist-out-check: BLOCKED ${missing.length} missing, ${divergent.length} divergent — run inline-run-setup --persist-out --from <worktree> before worktree removal\n`,
    );
    return 1;
}

if (import.meta.main) {
    process.exit(main(process.argv.slice(2)));
}
