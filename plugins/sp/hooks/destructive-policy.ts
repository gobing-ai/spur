/**
 * destructive-policy — the single destructive-command classifier shared by every
 * platform guard (task 0215 R3; extracted from `careful-guard.ts`).
 *
 * **Why this module exists.** The policy used to live inline in `careful-guard.ts`
 * (Claude Code) and was re-implemented with hand-rolled regexes in
 * `pi/guard-extension.ts` (Pi). The two drifted: the Pi copy allowed
 * `rm -rf node_modules /etc/nginx`, `rm -R --force /var/data`, `git push -f`, and
 * `git push origin +main` — all of which the Claude matrix pins as `ask` — while
 * warning on `git push --force-with-lease` and `rm -f config.json`, which it pins as
 * `allow`. Seven of ten pinned cases diverged. A safety control with one
 * implementation per platform is a safety control that is wrong on all but one of
 * them, so the policy is defined once, here, and every adapter imports it.
 *
 * Adapters own **I/O only** (payload shape, how a prompt is raised). They must not
 * re-derive classification.
 */

/**
 * Well-known rebuildable caches a `rm -rf` may target without a warning.
 *
 * Project-relative only — the leading `/` this used to accept made the exception
 * match by *basename anywhere on the filesystem*, so `rm -rf /Users/me/dist` was
 * treated as routine. Escaping targets are rejected by {@link escapesProject}
 * before this is consulted; keeping the anchor tight is belt-and-braces.
 */
const SAFE_RM_TARGET =
    /^(?:\.\/)?(?:[\w.@-]+\/)*(?:node_modules|dist|\.next|coverage|build|\.turbo|\.cache|\.parcel-cache|out)\/?\*?$/;

/**
 * True when a target points outside the project tree: an absolute path, a `~`
 * home path, or one that walks out via `..`.
 *
 * Recursive deletion inside the project is routine (build caches, scratch dirs) and
 * recoverable from git; recursive deletion *outside* it is neither, whatever the
 * directory happens to be named. This is the axis that decides a bare `rm -r`,
 * which is otherwise unguarded — `rm -r ./tmpdir` stays routine while
 * `rm -r /Users/me/photos` prompts.
 */
function escapesProject(target: string): boolean {
    const t = target.replace(/^['"]|['"]$/g, '');
    if (t.startsWith('/') || t.startsWith('~')) return true;
    if (t.startsWith('$')) return true; // `$HOME/...`, `"$HOME"/...` — unknown expansion
    return t.split('/').includes('..');
}

/**
 * Expand an argument string into the set of flags it sets, splitting short-flag
 * clusters into their individual letters: `-Rf --force` → `{R, f, --force}`.
 *
 * Matching flags with ad-hoc regexes per call site is what let `rm -R` through —
 * `-\w*r` only ever matched the lowercase spelling, even though `man rm` defines
 * `-r` as "Equivalent to -R". Parsing once, case-preserved, makes that class of
 * miss unrepresentable: a caller names every spelling it cares about explicitly.
 */
export function parseFlags(args: string): Set<string> {
    const flags = new Set<string>();
    for (const token of args.trim().split(/\s+/)) {
        if (token.length < 2 || !token.startsWith('-') || token === '--') continue;
        if (token.startsWith('--')) {
            flags.add(token.split('=')[0] as string); // `--force=x` → `--force`
            continue;
        }
        for (const ch of token.slice(1)) flags.add(ch);
    }
    return flags;
}

/** True when a `rm` invocation is both recursive and forced (any flag spelling). */
export function isRecursiveForceRm(args: string): boolean {
    const flags = parseFlags(args);
    // POSIX rm accepts -r and -R interchangeably; --recursive is the GNU long form.
    const recursive = flags.has('r') || flags.has('R') || flags.has('--recursive');
    const force = flags.has('f') || flags.has('--force');
    return recursive && force;
}

/**
 * True when **every** non-flag target of a `rm` invocation is a known-safe cache
 * path. Every, not some: `rm -rf node_modules /etc/nginx` must still warn, and a
 * substring test over the whole argument string (the Pi copy's approach) let one
 * cache path whitelist every other target in the same command.
 */
export function rmTargetsAllSafe(args: string): boolean {
    const targets = rmTargets(args);
    if (targets.length === 0) return false;
    return targets.every((t) => SAFE_RM_TARGET.test(t));
}

/** Non-flag targets of a `rm` invocation. */
function rmTargets(args: string): string[] {
    return args
        .trim()
        .split(/\s+/)
        .filter((t) => t.length > 0 && !t.startsWith('-'));
}

/** Always-warn destructive patterns (no safe exception). */
const DESTRUCTIVE: Array<{ label: string; re: RegExp }> = [
    {
        label: 'a SQL DROP/TRUNCATE (DROP TABLE/DATABASE, TRUNCATE)',
        re: /\b(?:DROP\s+(?:TABLE|DATABASE)|TRUNCATE(?:\s+TABLE)?)\b/i,
    },
    { label: 'a force push (git push --force / -f)', re: /\bgit\s+push\b[^\n]*(?:--force(?!-with-lease)|\s-f\b)/i },
    {
        // `git push origin +main` forces that ref without any --force flag.
        label: 'a force push via a + refspec (git push … +ref)',
        re: /\bgit\s+push\b[^\n]*\s\+[\w./-]+/i,
    },
    { label: 'a hard reset (git reset --hard)', re: /\bgit\s+reset\b[^\n]*--hard\b/i },
    {
        label: 'a working-tree discard (git checkout . / git restore .)',
        re: /\bgit\s+(?:checkout|restore)\s+(?:--\s+)?\.(?:\s|$)/i,
    },
    {
        // `git clean` destroys UNTRACKED files — nothing in git to recover them from,
        // which makes it the least recoverable command in this family. `-n`/`--dry-run`
        // only lists, so the prompt is gated on the force flag git itself requires.
        label: 'an untracked-file delete (git clean -f)',
        re: /\bgit\s+clean\b[^\n]*(?:\s-[a-zA-Z]*f|\s--force\b)/i,
    },
    { label: 'a cluster delete (kubectl delete)', re: /\bkubectl\s+delete\b/i },
    { label: 'a docker prune (docker system prune)', re: /\bdocker\s+system\s+prune\b/i },
];

/** Return a human label for the destructive command, or null when the command is safe. */
export function classifyCommand(command: string): string | null {
    for (const rmMatch of command.matchAll(/\brm\b([^\n&|;]*)/g)) {
        const args = rmMatch[1] ?? '';
        const flags = parseFlags(args);
        const recursive = flags.has('r') || flags.has('R') || flags.has('--recursive');
        // A recursive delete reaching outside the project prompts whether or not
        // `--force` was passed: `rm -r` deletes a whole tree without prompting for
        // any writable file, and nothing outside the project is recoverable from git.
        if (recursive && rmTargets(args).some(escapesProject)) {
            return 'a recursive remove outside the project (rm -r on an absolute, ~, or ../ path)';
        }
        if (isRecursiveForceRm(args) && !rmTargetsAllSafe(args)) {
            return 'a recursive force remove (rm -rf)';
        }
    }
    for (const { label, re } of DESTRUCTIVE) {
        if (re.test(command)) return label;
    }
    return null;
}

/** Convenience predicate for adapters that only need the boolean. */
export function isDestructiveCommand(command: string): boolean {
    return classifyCommand(command) !== null;
}
