#!/usr/bin/env bun
/**
 * persist-out-check — WT-4 pre-removal assertion for E71 persist-out (task 1067 R1).
 *
 * Before `git worktree remove`, verify the worktree's durable evidence would not be
 * abandoned: every file the worktree owns under `.spur/run/` (`<wbs>-*` per forwarded
 * task file, `<runId>-*` per forwarded run id) and the whole `.spur/memory/evidence/`
 * tree must exist in the invoking tree with identical bytes. Missing files BLOCK the
 * removal (persist-out was skipped or stale); divergent files block too (persist-out
 * never overwrites — reconcile by hand per execution-batch.md). No new public CLI verb:
 * this is a driver-side assertion step, not a corpus tool.
 *
 * ponytail: file-level comparison only — DB run rows and nested-run deep walks stay
 * persist-out's job (`inline-run-setup --persist-out`); this checks the planes E71
 * names as files. Listing caps (64/prefix, 256 evidence) refuse runaways by name.
 *
 * Node-builtin imports only; pure helpers are exported for tests. Exit 0 ok, 1
 * blocked/divergent, 2 usage error. Normal output is the finding lines themselves.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';

const EVIDENCE_DIR = join('.spur', 'memory', 'evidence');
const RUN_DIR = join('.spur', 'run');
const NAMED_CAP = 32;
const PREFIX_CAP = 64;
const EVIDENCE_CAP = 256;

/** Task files own their `<wbs>-*` evidence: leading digits before `_` in the basename. */
export function wbsOfTaskFile(path: string): string | null {
    const m = /^(\d+)_/.exec(basename(path));
    return m?.[1] ?? null;
}

function listFilesUnder(root: string, rel: string, cap: number): string[] | null {
    const dir = join(root, rel);
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    const walk = (cur: string): boolean => {
        for (const entry of readdirSync(cur, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const p = join(cur, entry.name);
            if (entry.isDirectory()) {
                if (!walk(p)) return false;
            } else {
                out.push(relative(root, p));
                if (out.length > cap) return false;
            }
        }
        return true;
    };
    return walk(dir) ? out : null;
}

/**
 * Evidence files the worktree owns: `.spur/memory/evidence/**` plus `.spur/run/<prefix>-*`
 * direct children per task-file WBS / run id. Returns null on a cap overrun or a listing
 * failure (not a directory, permission denied) — the caller refuses either way.
 */
export function listObligations(wtRoot: string, wbsList: string[], runIds: string[]): string[] | null {
    const evidence = listFilesUnder(wtRoot, EVIDENCE_DIR, EVIDENCE_CAP);
    if (evidence === null) return null;
    const out = [...evidence];
    const prefixes = [...wbsList, ...runIds];
    for (const prefix of prefixes) {
        const dir = join(wtRoot, RUN_DIR);
        if (!existsSync(dir)) continue;
        let entries: string[];
        try {
            entries = readdirSync(dir).sort();
        } catch {
            return null;
        }
        const owned = entries.filter((n) => n.startsWith(`${prefix}-`));
        if (owned.length > PREFIX_CAP) return null;
        out.push(...owned.map((n) => join(RUN_DIR, n)));
    }
    return [...new Set(out)].sort();
}

/** Classify obligations against the invoking tree: missing, divergent (byte-differs), or ok. */
export function compareTrees(
    wtRoot: string,
    invokeRoot: string,
    files: string[],
): { missing: string[]; divergent: string[]; ok: number } {
    const missing: string[] = [];
    const divergent: string[] = [];
    let ok = 0;
    for (const rel of files) {
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
    return 'usage: persist-out-check --from <worktree> [--task-file <path>]… [--run-id <id>]… [--root <invoke-tree>]';
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
        } else {
            process.stderr.write(`${persistOutCheckUsage()}\n`);
            return 2;
        }
    }
    if (!wtRoot || !existsSync(wtRoot) || !statSync(wtRoot).isDirectory()) {
        process.stderr.write(
            `${persistOutCheckUsage()}\npersist-out-check: --from must be an existing worktree directory\n`,
        );
        return 2;
    }
    const files = listObligations(wtRoot, wbsList, runIds);
    if (files === null) {
        process.stderr.write(
            `persist-out-check: BLOCKED — worktree evidence listing failed or exceeded caps (64/prefix, ${EVIDENCE_CAP} evidence files) — inspect by hand\n`,
        );
        return 1;
    }
    const { missing, divergent, ok } = compareTrees(wtRoot, invokeRoot, files);
    const findings = [
        ...missing.map((f) => `MISSING ${f}`),
        ...divergent.map((f) => `DIVERGENT ${f} — reconcile by hand (persist-out never overwrites)`),
    ];
    for (const line of findings.slice(0, NAMED_CAP)) process.stdout.write(`${line}\n`);
    if (findings.length > NAMED_CAP) process.stdout.write(`… +${findings.length - NAMED_CAP} more\n`);
    if (findings.length === 0) {
        process.stdout.write(`persist-out-check: ok — ${ok} evidence file(s) persisted, nothing abandoned\n`);
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
