#!/usr/bin/env bun
import { readFileSync } from 'node:fs';

/**
 * history-surface-freeze-check (0745 R1/R2) — a mechanical diff gate over the
 * two protected History surfaces.
 *
 * E91's central constraint is a no-change claim: the History UI and its
 * transport contract must not change at all. A constraint that is only stated
 * is not a constraint, so this script makes it mechanical. It compares the
 * working tree against the MERGE BASE with the default branch (never HEAD~1) —
 * a multi-commit branch that changes a frozen file in one commit and reverts it
 * in another leaves the merge-base diff clean and the HEAD~1 diff dirty or vice
 * versa. Merge base is the question the constraint actually asks: did this
 * branch change the surface.
 *
 * It fails when any line under a frozen path differs, and reports the offending
 * path plus its changed line counts (a bare non-zero exit gets bypassed).
 *
 * Internal self-development tooling: it lives in scripts/commands/ and is
 * composed into the gate from package.json. It is NOT a public `spur` noun or
 * verb (ADR-051 surface governance).
 */

/** The two protected surfaces. Directory paths end in '/'. */
export const FROZEN_HISTORY_SURFACES = ['apps/web/src/modules/history/', 'packages/contracts/src/history.ts'] as const;

export interface FrozenSurfaceChange {
    path: string;
    added: number;
    deleted: number;
}

export interface FreezeCheckResult {
    ok: boolean;
    base: string;
    changes: FrozenSurfaceChange[];
}

interface GitResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

function git(args: string[], cwd: string): GitResult {
    const proc = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
    return {
        exitCode: proc.exitCode ?? 1,
        stdout: proc.stdout?.toString() ?? '',
        stderr: proc.stderr?.toString() ?? '',
    };
}

function isUnderFrozen(path: string): boolean {
    return FROZEN_HISTORY_SURFACES.some((surface) =>
        surface.endsWith('/') ? path.startsWith(surface) : path === surface,
    );
}

/** The merge base of the default branch and HEAD — the commit this branch forked from. */
export function resolveFrozenBase(cwd: string, defaultBranch = 'main'): string {
    const res = git(['merge-base', defaultBranch, 'HEAD'], cwd);
    if (res.exitCode !== 0) {
        throw new Error(
            `history-surface-freeze-check: cannot resolve merge-base against '${defaultBranch}' at ${cwd}: ${res.stderr.trim()}`,
        );
    }
    return res.stdout.trim();
}

function parseNumstat(line: string): FrozenSurfaceChange {
    const [addPart, delPart, ...pathParts] = line.split('\t');
    // git emits '-' for binary files; count a binary change as one line.
    return {
        path: pathParts.join('\t'),
        added: addPart === '-' ? 1 : Number(addPart),
        deleted: delPart === '-' ? 1 : Number(delPart),
    };
}

function countLines(cwd: string, path: string): number {
    try {
        const content = readFileSync(`${cwd.replace(/\/$/, '')}/${path}`, 'utf8');
        return Math.max(1, content.split('\n').length);
    } catch {
        return 1;
    }
}

/**
 * Compare the working tree against the merge base for every frozen surface.
 * Returns ok=false with the offending paths + line counts when anything differs.
 */
export function historySurfaceFreezeCheck(
    cwd: string,
    opts: { defaultBranch?: string; base?: string } = {},
): FreezeCheckResult {
    const base = opts.base ?? resolveFrozenBase(cwd, opts.defaultBranch ?? 'main');
    const changes: FrozenSurfaceChange[] = [];

    for (const surface of FROZEN_HISTORY_SURFACES) {
        // Tracked files that differ from the merge base.
        const diff = git(['diff', '--numstat', base, '--', surface], cwd);
        if (diff.exitCode !== 0) {
            throw new Error(`history-surface-freeze-check: git diff failed: ${diff.stderr.trim()}`);
        }
        for (const line of diff.stdout.split('\n').filter(Boolean)) {
            const change = parseNumstat(line);
            if (change.path) changes.push(change);
        }
    }

    // Untracked files under a frozen surface are also changes to the surface.
    // `git diff` ignores untracked paths, so surface them explicitly.
    const untracked = git(['ls-files', '--others', '--exclude-standard'], cwd);
    if (untracked.exitCode === 0) {
        for (const path of untracked.stdout.split('\n').filter(Boolean)) {
            if (isUnderFrozen(path)) {
                changes.push({ path, added: countLines(cwd, path), deleted: 0 });
            }
        }
    }

    return { ok: changes.length === 0, base, changes };
}

if (import.meta.main) {
    const result = historySurfaceFreezeCheck(process.cwd());
    if (!result.ok) {
        console.error(
            `history-surface-freeze-check FAILED — ${result.changes.length} path(s) changed under a frozen History surface (merge base ${result.base}):`,
        );
        for (const change of result.changes) {
            console.error(`  ${change.path}: +${change.added} -${change.deleted}`);
        }
        process.exit(1);
    }
    console.log(`history-surface-freeze-check OK — History surfaces unchanged against merge base ${result.base}.`);
    process.exit(0);
}
