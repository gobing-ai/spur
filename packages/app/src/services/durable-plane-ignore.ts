import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * Leaf module (no app imports): extracted from `run-storage.ts` so
 * `feature-verification-receipt.ts` can install the durable-plane exclusion without importing
 * run-storage, which itself imports the receipt parser (an import cycle).
 */
/** Repo-local ignore entry that keeps the durable run-record plane out of the git tree. */
const DURABLE_PLANE_EXCLUDE = '.spur/memory/';

/**
 * 1026: durable run-record writes must never move the proof-input git tree —
 * `computeProofInputFingerprint` runs `git add -A`, so an untracked record under
 * `.spur/memory/` would shift every subsequent fresh capture mid-run. The plane is
 * therefore excluded via the repo-local `.git/info/exclude` (no tracked `.gitignore`
 * edit, idempotent, once per repo). Best-effort by contract: outside a normal
 * checkout (`.git` is a worktree pointer file) the plain join path is unusable, so the
 * real gitdir is parsed from the pointer line and the common exclude file used —
 * without this, managed-worktree receipts stale instantly and deadlock verifying→done
 * gates. If the layout is unexpected the exclusion cannot be installed and durable
 * files stay tree-visible — the run proceeds; only fingerprint stability is degraded.
 */
export function ensureDurablePlaneIgnored(workdir: string): void {
    try {
        const gitPath = join(workdir, '.git');
        if (!existsSync(gitPath)) return; // not a git checkout — nothing to exclude from
        let excludePath = join(gitPath, 'info', 'exclude');
        try {
            if (statSync(gitPath).isFile()) {
                // Managed worktrees carry `.git` as a `gitdir: <path>` pointer file.
                const gitdir = readFileSync(gitPath, 'utf8')
                    .split(/\r?\n/)
                    .find((line) => line.startsWith('gitdir:'))
                    ?.slice('gitdir:'.length)
                    .trim();
                if (gitdir) {
                    const resolved = isAbsolute(gitdir) ? gitdir : resolve(workdir, gitdir);
                    // Standard linked-worktree layout: <common>/.git/worktrees/<name>
                    // shares the common excludes; otherwise use the resolved gitdir's own.
                    const common = /[/\\]worktrees[/\\][^/\\]+$/.test(resolved)
                        ? resolve(resolved, '..', '..')
                        : resolved;
                    excludePath = join(common, 'info', 'exclude');
                }
            }
        } catch {
            // keep the plain-join fallback for normal checkouts or unreadable pointers
        }
        let current = '';
        try {
            current = readFileSync(excludePath, 'utf8');
        } catch {
            current = ''; // first install in this repo
        }
        if (current.includes(DURABLE_PLANE_EXCLUDE)) return; // idempotent
        mkdirSync(dirname(excludePath), { recursive: true });
        const sep = current === '' || current.endsWith('\n') ? '' : '\n';
        appendFileSync(
            excludePath,
            `${sep}# spur durable run-record plane (E71/1026): must stay proof-fingerprint-inert\n${DURABLE_PLANE_EXCLUDE}\n`,
            'utf8',
        );
    } catch {
        // best-effort: an unwritable info dir leaves durable files untracked-visible; never fail a run
    }
}
