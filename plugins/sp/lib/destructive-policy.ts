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

/**
 * A single shell word usable as a git global-option value. Quoted forms are kept
 * whole — `-C "my repo"` must read as one argument — while an unquoted word stops at
 * whitespace and the shell separators `; & |`, so the pass can never swallow a
 * following command.
 */
const GIT_OPTION_VALUE = String.raw`(?:"[^"]*"|'[^']*'|[^\s;&|]+)`;

/**
 * Git global options that consume a following word in their separated form — the word
 * after them is a value, never the subcommand. Verified against git 2.55.0: each of
 * these takes the next word (`git --git-dir rev-parse …` → `unknown option:
 * --is-inside-work-tree`, i.e. git had already consumed `rev-parse` as the value).
 * The value-less long options (`--no-pager`, `--bare`, `--no-replace-objects`, …) need
 * no list: missing one only makes the pass stop earlier, it can never misread a value
 * as a subcommand. Do NOT add an option here unless it really consumes the next word —
 * `--exec-path` is optional-value, so listing it would swallow the subcommand and hide
 * a destructive verb (git 2.55.0: `git --exec-path /tmp/p reset --hard` prints the exec
 * path and exits; the `=`-glued form does consume the value).
 */
const GIT_VALUE_TAKING_OPTION = '--(?:git-dir|work-tree|namespace|config-env|attr-source)';

/**
 * One `git` global option unit, including the whitespace before its value.
 *
 * - `--name=value` — any long option in glued form.
 * - `KNOWN --name value` — the value-taking long options above, separated form.
 * - `-C value` / `-c value` — the value-taking short options; git rejects glued short
 *   forms (`git -C. status` → `unknown option: -C.`, verified on 2.55.0), so their
 *   value is always the next word.
 * - `--name` / `-xy` — any value-less flag (`--no-pager`, `--bare`, `-p`, …).
 *
 * An option run is a sequence of these units; it ends at the first token that is not an
 * option — the subcommand. Matching the whole grammar rather than a four-form whitelist
 * keeps sibling options of the same defect class from hiding a destructive verb without
 * teaching every destructive pattern git's option table.
 */
const GIT_GLOBAL_OPTION = String.raw`(?:--[A-Za-z][A-Za-z0-9-]*=${GIT_OPTION_VALUE}|${GIT_VALUE_TAKING_OPTION}[ \t]+${GIT_OPTION_VALUE}|-(?:[A-Za-z]*[Cc])[ \t]+${GIT_OPTION_VALUE}|--[A-Za-z][A-Za-z0-9-]*|-[A-Za-z]+)`;

/**
 * `git` followed by any run of global options directly before the subcommand. Replacing
 * the whole span with `git` lets the destructive subcommand patterns fire on
 * option-prefixed invocations without teaching every pattern git's option grammar.
 *
 * The run cannot cross a command boundary: units match `[ \t]` only (never a newline)
 * and an unquoted value stops at `; & |`.
 */
const GIT_WITH_GLOBAL_OPTIONS = new RegExp(String.raw`\bgit\b(?:[ \t]+${GIT_GLOBAL_OPTION})*`, 'g');

/**
 * Remove supported git global options between the `git` executable and its subcommand.
 *
 * `git -C . push --force`, `git --no-pager push --force` and
 * `git -c core.hooksPath=/tmp/hooks push -f` used to classify as safe because the
 * subcommand patterns require `git` immediately before the verb. The
 * replacement edits only the matched option span: every other byte — newlines, command
 * separators, quotes — is preserved, so the patterns cannot begin matching across a
 * command boundary, and no shell expansion or `git` process is involved.
 */
export function stripGitGlobalOptions(command: string): string {
    return command.replace(GIT_WITH_GLOBAL_OPTIONS, 'git');
}

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
    const normalized = stripGitGlobalOptions(command);
    for (const { label, re } of DESTRUCTIVE) {
        if (re.test(normalized)) return label;
    }
    return null;
}
