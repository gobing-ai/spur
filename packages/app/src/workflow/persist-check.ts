/**
 * Persist check — the WT-4 pre-removal assertion for E71 persist-out (task 1067 R1, 1148 R1).
 * Transport: `spur workflow persist-check --from <worktree> …` (script-absorption PR-4; moved
 * from the retired `plugins/sp/scripts/persist-out-check.ts`, pinned to its golden output by
 * It pairs with `spur workflow persist-out`.
 *
 * Before `git worktree remove`, verify the worktree's OWNED durable evidence would not be abandoned:
 * every `.spur/run/` and `.spur/memory/evidence/` file starting with a forwarded `<wbs>-`/`<runId>-`
 * prefix must exist in the invoking tree with identical bytes. Unowned evidence is counted
 * (`unowned: N`) and does not block (1148 R1). Exit 0 ok, 1 blocked/divergent, 2 usage error.
 * Normal output is the finding lines themselves; the result carries them instead of printing.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { NodeSyncProcessExecutor } from '@gobing-ai/ts-runtime';

const EVIDENCE_DIR = join('.spur', 'memory', 'evidence');
const RUN_DIR = join('.spur', 'run');
const NAMED_CAP = 32;
const PREFIX_CAP = 64;
/** The durable-verdict family persist-out itself transfers (1026/1043) — the one artifact class whose
 *  silent abandonment WT-4 exists to prevent, even when the driver forwarded no matching prefix. */
const DURABLE_FAMILY_RE = /^\d{4}-(?:verdict|feature-verification)\.json$/;

/** One-line usage printed when `persist-check` is invoked without `--from`. */
export const PERSIST_CHECK_USAGE =
    'usage: spur workflow persist-check --from <worktree> [--task-file <path>]… [--run-id <id>]… [--root <invoke-tree>] [--success-json <path>]';

/** Task files own their `<wbs>-*` evidence: leading digits before `_` in the basename. */
export function wbsOfTaskFile(path: string): string | null {
    const m = /^(\d+)_/.exec(basename(path));
    return m?.[1] ?? null;
}

/** Evidence files a worktree owes the invoke tree, plus how many plane files no task/run owns. */
export interface ListObligationsResult {
    files: string[];
    unowned: number;
    /** Every file seen in both planes (recursive) — lets callers audit outside the forwarded prefixes. */
    planeFiles: string[];
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

/** Owned evidence (prefix-matched) under one plane; false once a prefix exceeds PREFIX_CAP. */
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
 * Evidence the worktree owns: `.spur/memory/evidence/` (recursive) and `.spur/run/` (recursive — the
 * driver keeps run scratch under `.spur/run/<run-id>/`, which a flat scan silently missed) files whose
 * basename starts with a forwarded `<wbs>-`/`<runId>-` prefix. Evidence matching no prefix is
 * counted as `unowned` (1148 R1). Null when no prefix is forwarded or a prefix cap is exceeded.
 */
export function listObligations(wtRoot: string, wbsList: string[], runIds: string[]): ListObligationsResult | null {
    const prefixes = [...new Set([...wbsList, ...runIds].filter(Boolean))];
    if (prefixes.length === 0) return null;

    const evFiles = walkFiles(join(wtRoot, EVIDENCE_DIR), wtRoot);
    const runFiles = walkFiles(join(wtRoot, RUN_DIR), wtRoot);

    const files: string[] = [];
    const counts = new Map<string, number>();
    if (!collectOwned(evFiles, prefixes, counts, files)) return null;
    if (!collectOwned(runFiles, prefixes, counts, files)) return null;
    const unowned = evFiles.length - files.filter((f) => f.startsWith(EVIDENCE_DIR)).length;
    return { files: [...new Set(files)].sort(), unowned, planeFiles: [...evFiles, ...runFiles] };
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
        if (foreignDivergent.has(rel) || foreignDivergent.has(basename(rel))) continue;
        const invPath = join(invokeRoot, rel);
        if (!existsSync(invPath)) {
            missing.push(rel);
            continue;
        }
        try {
            if (readFileSync(join(wtRoot, rel)).equals(readFileSync(invPath))) ok++;
            else divergent.push(rel);
        } catch {
            divergent.push(rel);
        }
    }
    return { missing, divergent, ok };
}

/**
 * The invoking tree is the MAIN repo root — never default to cwd: WT-4 runs from the
 * worktree, and comparing the worktree against itself is a vacuous pass (caught live in
 * task 1067 R4). `--git-common-dir` resolves to the shared `.git`, whose parent is the
 * main tree; inside the main tree itself this falls back to cwd, which is correct there.
 * Outside any work tree (git fails or is absent) the cwd is the answer too.
 */
export function defaultInvokeRoot(cwd: string): string {
    const run = new NodeSyncProcessExecutor().runSync({
        command: 'git',
        args: ['-C', cwd, 'rev-parse', '--git-common-dir'],
    });
    const common = run.stdout.trim();
    if (run.exitCode === 0 && common) return dirname(isAbsolute(common) ? common : join(cwd, common));
    return cwd;
}

/** Input for {@link runPersistCheck}; relative paths resolve against `cwd`. */
export interface PersistCheckInput {
    /** The worktree whose evidence is about to be torn down. */
    readonly from: string;
    /** Task files whose `<wbs>-` prefix the worktree owns (non-task basenames are ignored). */
    readonly taskFiles?: readonly string[];
    /** Run ids whose `<runId>-` prefix the worktree owns. */
    readonly runIds?: readonly string[];
    /** The invoking (main) tree; defaults to {@link defaultInvokeRoot} of `cwd`. */
    readonly root?: string;
    /** A persist-out result to read skips from before the two default locations. */
    readonly successJson?: string;
    readonly cwd: string;
}

/** Exit code plus the stdout / stderr lines one check produced. */
export interface PersistCheckReport {
    exitCode: number;
    stdout: string[];
    stderr: string[];
}

/** Skips recorded by the persist-out pass that preceded this check (first readable candidate wins). */
function readPersistOutSkips(candidates: string[]): {
    foreignDivergent: Set<string>;
    skips: Array<{ id: string; reason: string }>;
} {
    const foreignDivergent = new Set<string>();
    const skips: Array<{ id: string; reason: string }> = [];
    for (const cand of candidates) {
        if (!existsSync(cand)) continue;
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
    return { foreignDivergent, skips };
}

/** Run the WT-4 assertion. Exit 0 ok · 1 blocked/divergent/unforwarded · 2 usage. */
export function runPersistCheck(input: PersistCheckInput): PersistCheckReport {
    const usage = (detail?: string): PersistCheckReport => ({
        exitCode: 2,
        stdout: [],
        stderr: [PERSIST_CHECK_USAGE, ...(detail === undefined ? [] : [`persist-out-check: ${detail}`])],
    });
    const wbsList = (input.taskFiles ?? []).map(wbsOfTaskFile).filter((wbs): wbs is string => wbs !== null);
    const runIds = (input.runIds ?? []).filter(Boolean);
    if (wbsList.length === 0 && runIds.length === 0) return usage('at least one --task-file or --run-id required');
    const wtRoot = input.from === '' ? '' : resolve(input.cwd, input.from);
    if (!wtRoot || !existsSync(wtRoot) || !statSync(wtRoot).isDirectory()) {
        return usage('--from must be an existing directory');
    }
    const invokeRoot = input.root === undefined ? defaultInvokeRoot(input.cwd) : resolve(input.cwd, input.root);
    const { foreignDivergent, skips } = readPersistOutSkips(
        [
            input.successJson === undefined || input.successJson === '' ? '' : resolve(input.cwd, input.successJson),
            join(invokeRoot, '.spur', 'run', 'persist-out.json'),
            join(wtRoot, '.spur', 'run', 'persist-out.json'),
        ].filter(Boolean),
    );
    const obligations = listObligations(wtRoot, wbsList, runIds);
    if (obligations === null) {
        return {
            exitCode: 1,
            stdout: [],
            stderr: [
                `persist-out-check: BLOCKED — worktree evidence listing failed or exceeded caps (${PREFIX_CAP}/prefix) — inspect by hand`,
            ],
        };
    }
    const { files, unowned, planeFiles } = obligations;
    // Session-incident class (runall-1208-1209-bdcd): the driver forwarded only the batch run id, no
    // prefix matched, and the check passed at 0 obligations while the worktree held its verdicts. Family
    // files outside the prefixes (not foreign-divergent) block teardown; non-family scratch never does.
    const unforwarded = planeFiles
        .filter((rel) => DURABLE_FAMILY_RE.test(basename(rel)))
        .filter((rel) => !files.includes(rel) && !foreignDivergent.has(rel) && !foreignDivergent.has(basename(rel)));
    const { missing, divergent, ok } = compareTrees(wtRoot, invokeRoot, files, foreignDivergent);
    const findings = [
        ...missing.map((f) => `MISSING ${f}`),
        ...divergent.map((f) => `DIVERGENT ${f} — reconcile by hand (persist-out never overwrites)`),
        ...unforwarded.map((f) => `UNFORWARDED ${f} — durable verdict/receipt outside the forwarded prefixes`),
    ];
    const stdout = findings.slice(0, NAMED_CAP);
    if (findings.length > NAMED_CAP) stdout.push(`… +${findings.length - NAMED_CAP} more`);
    if (findings.length === 0) {
        const abandonedMsg = skips.length > 0 ? `${skips.length} skipped` : 'nothing abandoned';
        return {
            exitCode: 0,
            stdout: [
                ...skips.map((skip) => `SKIP ${skip.id}: ${skip.reason}`),
                `persist-out-check: ok — ${ok} evidence file(s) persisted, unowned: ${unowned}, ${abandonedMsg}`,
            ],
            stderr: [],
        };
    }
    return {
        exitCode: 1,
        stdout,
        stderr: [
            `persist-out-check: BLOCKED ${missing.length} missing, ${divergent.length} divergent` +
                `${unforwarded.length > 0 ? `, ${unforwarded.length} unforwarded durable verdict/receipt` : ''}` +
                ' — run `spur workflow persist-out --from <worktree>` (--task-file <wbs>_<slug>.md) before worktree removal',
        ],
    };
}
