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
 *
 * **Executable positions (task 1313).** `classifyCommand` lexes quotes, escapes,
 * command separators (including a redirection's `&`, which is not a separator),
 * `$(...)` / backticks, the `SHELL_WRAPPERS` that forward a shell, and a `-c` script from
 * any `SHELL_BINS` interpreter — matched on the basename, so `/bin/bash` counts, and
 * `SHELL_OPTIONS_WITH_VALUE` options (`-O extglob`, `--rcfile x`) do not end the scan.
 * Proven standalone `rg` / `grep` operands are data: single quotes never recurse, and
 * only substitutions inside double quotes
 * or unquoted text are classified again. `--pre` is not data, and neither is a search
 * whose pipeline feeds anything but a known text consumer (`DATA_CONSUMERS`) — matched on
 * the argv0 basename, so `/bin/sh` and `nice sh` count as execution. Malformed or
 * unsupported syntax keeps the whole-string scan below — it never becomes an allow.
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

/** How many nested scripts or substitutions to follow before the whole-string scan. */
const MAX_LEX_DEPTH = 8;

interface ShellWord {
    text: string;
    substitutions: string[];
}

interface ShellSegment {
    start: number;
    end: number;
    words: ShellWord[];
    substitutionSpans: Array<[number, number]>;
    /** Segments joined by `|` / `|&` share an id; `;`, newline, `&`, `&&`, `||` start a new one. */
    pipeline: number;
}

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Index of the `)` that closes a `$(` whose body starts at `start`, or -1.
 * Quotes hide parens; a backslash hides the next character.
 */
function scanBalancedParen(source: string, start: number): number {
    let depth = 1;
    let i = start;
    while (i < source.length) {
        const ch = source[i];
        if (ch === '\\') {
            i += 2;
            continue;
        }
        if (ch === "'") {
            i++;
            while (i < source.length && source[i] !== "'") i++;
            if (i >= source.length) return -1;
            i++;
            continue;
        }
        if (ch === '"') {
            i++;
            while (i < source.length) {
                if (source[i] === '\\') {
                    i += 2;
                    continue;
                }
                if (source[i] === '"') break;
                i++;
            }
            if (i >= source.length) return -1;
            i++;
            continue;
        }
        if (ch === '(') {
            depth++;
            i++;
            continue;
        }
        if (ch === ')') {
            depth--;
            if (depth === 0) return i;
            i++;
            continue;
        }
        i++;
    }
    return -1;
}

/** Index of the closing backtick, or -1. A backslash can escape a backtick. */
function scanBacktick(source: string, start: number): number {
    let i = start + 1;
    while (i < source.length) {
        if (source[i] === '\\' && i + 1 < source.length) {
            const next = source[i + 1];
            if (next === '`' || next === '\\' || next === '$') {
                i += 2;
                continue;
            }
        }
        if (source[i] === '`') return i;
        i++;
    }
    return -1;
}

function readSubstitution(
    source: string,
    dollar: number,
    word: ShellWord,
    spans: Array<[number, number]>,
): number | null {
    if (source[dollar + 2] === '(') return null;
    const close = scanBalancedParen(source, dollar + 2);
    if (close < 0) return null;
    word.substitutions.push(source.slice(dollar + 2, close));
    spans.push([dollar, close + 1]);
    return close + 1;
}

function readBacktick(source: string, open: number, word: ShellWord, spans: Array<[number, number]>): number | null {
    const close = scanBacktick(source, open);
    if (close < 0) return null;
    word.substitutions.push(source.slice(open + 1, close));
    spans.push([open, close + 1]);
    return close + 1;
}

/**
 * Split a command into simple commands and words.
 * Returns null for unclosed quotes, unclosed substitutions, or syntax this pass
 * does not claim to understand (ANSI-C quotes, arithmetic, heredocs, process
 * substitutions, subshells). Null means "use the whole-string scan".
 */
function lexShell(command: string): ShellSegment[] | null {
    const segments: ShellSegment[] = [];
    const n = command.length;
    let i = 0;
    let segStart = 0;
    let pipeline = 0;
    let words: ShellWord[] = [];
    let spans: Array<[number, number]> = [];
    let current: ShellWord | null = null;

    const flushWord = (): void => {
        if (current === null) return;
        words.push(current);
        current = null;
    };
    const flushSegment = (end: number): void => {
        flushWord();
        if (command.slice(segStart, end).trim().length > 0) {
            segments.push({ start: segStart, end, words, substitutionSpans: spans, pipeline });
        }
        words = [];
        spans = [];
    };

    while (i < n) {
        const ch = command[i] ?? '';
        if (current === null) {
            if (ch === ' ' || ch === '\t' || ch === '\r') {
                i++;
                continue;
            }
            if (ch === '\n' || ch === ';') {
                flushSegment(i);
                pipeline++;
                i++;
                segStart = i;
                continue;
            }
            if (ch === '|') {
                flushSegment(i);
                if (command[i + 1] === '|') pipeline++;
                i += command[i + 1] === '|' || command[i + 1] === '&' ? 2 : 1;
                segStart = i;
                continue;
            }
            // `&` only separates commands on its own: inside a redirection (`2>&1`, `&>log`,
            // `<&3`) it is part of the operand. Treating it as a separator split `a 2>&1 | sh`
            // into two pipelines, which silently disabled the "search piped into an executor"
            // rule and let `rg 'rm -rf /' x 2>&1 | bash` through.
            if (ch === '&') {
                const redirectAmp = command[i - 1] === '>' || command[i - 1] === '<' || command[i + 1] === '>';
                if (redirectAmp) {
                    // Redirect operand (`2>&1`, `&>log`): not a separator, but the index MUST
                    // advance or the segment scanner re-reads the same char forever.
                    i++;
                    continue;
                }
                flushSegment(i);
                pipeline++;
                i += command[i + 1] === '&' ? 2 : 1;
                segStart = i;
                continue;
            }
            if (ch === '#') {
                while (i < n && command[i] !== '\n') i++;
                continue;
            }
            if (ch === '<' || ch === '>') {
                if (command[i + 1] === '(' || (ch === '<' && command[i + 1] === '<')) return null;
                i += command[i + 1] === '>' ? 2 : 1;
                if (command[i] === '&') i++;
                continue;
            }
            if (ch === '(' || ch === ')') return null;
        }

        current ??= { text: '', substitutions: [] };
        if (ch === "'") {
            i++;
            while (i < n && command[i] !== "'") {
                current.text += command[i] ?? '';
                i++;
            }
            if (i >= n) return null;
            i++;
            continue;
        }
        if (ch === '"') {
            i++;
            let closed = false;
            while (i < n) {
                const quoted = command[i] ?? '';
                if (quoted === '\\') {
                    const next = command[i + 1];
                    if (next === undefined) return null;
                    if (next === '\n') {
                        i += 2;
                        continue;
                    }
                    current.text += next === '$' || next === '`' || next === '"' || next === '\\' ? next : `\\${next}`;
                    i += 2;
                    continue;
                }
                if (quoted === '"') {
                    i++;
                    closed = true;
                    break;
                }
                if (quoted === '$' && (command[i + 1] === "'" || command[i + 1] === '"')) return null;
                if (quoted === '$' && command[i + 1] === '(') {
                    const next = readSubstitution(command, i, current, spans);
                    if (next === null) return null;
                    i = next;
                    continue;
                }
                if (quoted === '`') {
                    const next = readBacktick(command, i, current, spans);
                    if (next === null) return null;
                    i = next;
                    continue;
                }
                current.text += quoted;
                i++;
            }
            if (!closed) return null;
            continue;
        }
        if (ch === '\\') {
            const next = command[i + 1];
            if (next === undefined) return null;
            if (next !== '\n') current.text += next;
            i += 2;
            continue;
        }
        if (ch === '$' && (command[i + 1] === "'" || command[i + 1] === '"')) return null;
        if (ch === '$' && command[i + 1] === '(') {
            const next = readSubstitution(command, i, current, spans);
            if (next === null) return null;
            i = next;
            continue;
        }
        if (ch === '`') {
            const next = readBacktick(command, i, current, spans);
            if (next === null) return null;
            i = next;
            continue;
        }
        if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === ';' || ch === '|' || ch === '&') {
            flushWord();
            continue;
        }
        if (ch === '(' || ch === ')') return null;
        if ((ch === '<' || ch === '>') && current.text === '' && current.substitutions.length === 0) {
            current = null;
            if (command[i + 1] === '(' || (ch === '<' && command[i + 1] === '<')) return null;
            i += command[i + 1] === '>' ? 2 : 1;
            continue;
        }
        current.text += ch;
        i++;
    }
    flushSegment(n);
    return segments;
}

/** Drop leading `command` / `env` wrappers this pass understands. Unknown flags stay. */
function stripWrappers(words: readonly ShellWord[]): ShellWord[] {
    let i = 0;
    while (i < words.length) {
        const name = words[i]?.text ?? '';
        const substituted = (words[i]?.substitutions.length ?? 0) > 0;
        if (substituted) break;
        if (ENV_ASSIGNMENT.test(name)) {
            i++;
            continue;
        }
        if (name === 'command') {
            i++;
            if (words[i]?.text === '-p' || words[i]?.text === '--') i++;
            continue;
        }
        if (argvName(words[i]) === 'env') {
            const envAt = i;
            let j = i + 1;
            let known = true;
            while (j < words.length && (words[j]?.text ?? '').startsWith('-')) {
                const flag = words[j]?.text ?? '';
                if (flag === '--') {
                    j++;
                    break;
                }
                if (flag === '-i' || flag === '-0' || flag === '--ignore-environment') {
                    j++;
                    continue;
                }
                if (flag === '-u' || flag === '--unset') {
                    j += 2;
                    continue;
                }
                if (flag.startsWith('--unset=')) {
                    j++;
                    continue;
                }
                known = false;
                break;
            }
            // An unrecognized flag is not a wrapper. Leave argv0 at `env` so the
            // whole-string scan still sees the original command.
            if (!known) {
                i = envAt;
                break;
            }
            while (j < words.length && ENV_ASSIGNMENT.test(words[j]?.text ?? '')) j++;
            i = j;
            continue;
        }
        break;
    }
    return words.slice(i);
}

/** Shell interpreters whose `-c` operand is code, matched on the basename so `/bin/bash` counts. */
const SHELL_BINS = new Set(['sh', 'bash', 'zsh', 'dash', 'ash', 'ksh', 'mksh', 'busybox-sh']);

/** True for a bare or path-qualified shell interpreter (`bash`, `/bin/bash`, `/usr/bin/env`-less). */
function isShellBin(name: string): boolean {
    const base = name.slice(name.lastIndexOf('/') + 1);
    return SHELL_BINS.has(base);
}

/**
 * These wrappers can forward a shell invocation. Their option grammar is deliberately
 * not used to grant exemptions: inspect possible shell operands for destructive code,
 * then retain the conservative scan even when every inspected script appears safe.
 */
const SHELL_WRAPPERS = new Set(['env', 'sudo', 'exec', 'nice', 'xargs']);

function classifyWrappedShell(words: readonly ShellWord[], depth: number): string | null {
    const name = argvName(words[0]);
    if (name === null || !SHELL_WRAPPERS.has(name)) return null;
    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        if (word === undefined || word.substitutions.length > 0 || !isShellBin(word.text)) continue;
        const script = extractDashC(words.slice(i));
        if (script === null || script === 'missing') continue;
        const hit = classifyLexical(script, depth + 1);
        if (hit !== null) return hit;
    }
    return null;
}

/** The `-c` script, `missing` when `-c` has no operand, or null when this is not `-c`. */
/** Shell options whose operand is a separate word, so `-c` detection must step over it. */
const SHELL_OPTIONS_WITH_VALUE = new Set(['-o', '+o', '-O', '+O', '--rcfile', '--init-file', '--rc-file']);

function extractDashC(words: readonly ShellWord[]): string | null | 'missing' {
    let i = 1;
    while (i < words.length) {
        const token = words[i]?.text ?? '';
        if (token === '--') return null;
        // A bare word (`bash script.sh -c x`) ends the option list: `-c` after it is the script's
        // own argument, not the shell's.
        if ((!token.startsWith('-') && !token.startsWith('+')) || token === '-') break;
        if (token.startsWith('--')) {
            i += SHELL_OPTIONS_WITH_VALUE.has(token) ? 2 : 1;
            continue;
        }
        if (token.includes('c')) {
            const script = words[i + 1];
            if (script === undefined) return 'missing';
            return script.text;
        }
        // `-O extglob -c …` / `-o noglob -c …`: the operand is a value, not the command.
        i += SHELL_OPTIONS_WITH_VALUE.has(token) ? 2 : 1;
    }
    return null;
}

/** True when every operand is data for a standalone rg/grep, with no `--pre` command. */
function isLiteralSearch(words: readonly ShellWord[]): boolean {
    const bin = words[0]?.text;
    if ((bin !== 'rg' && bin !== 'grep') || (words[0]?.substitutions.length ?? 0) > 0) return false;
    let options = true;
    for (let i = 1; i < words.length; i++) {
        const token = words[i]?.text ?? '';
        if (options && token === '--') {
            options = false;
            continue;
        }
        if (options && (token === '--pre' || token.startsWith('--pre='))) return false;
    }
    return true;
}

function maskedRaw(command: string, segment: ShellSegment): string {
    const chars = [...command.slice(segment.start, segment.end)];
    for (const [start, end] of segment.substitutionSpans) {
        for (let i = start; i < end; i++) {
            const local = i - segment.start;
            if (local >= 0 && local < chars.length) chars[local] = ' ';
        }
    }
    return chars.join('');
}

/** Return a human label for the destructive command, or null when the command is safe. */
export function classifyCommand(command: string): string | null {
    return classifyLexical(command, 0);
}

function classifyLexical(command: string, depth: number): string | null {
    if (depth > MAX_LEX_DEPTH) return classifyConservatively(command);
    const segments = lexShell(command);
    if (segments === null) return classifyConservatively(command);
    const codePipelines = new Set(
        segments.filter((segment) => !isDataConsumer(segment)).map((segment) => segment.pipeline),
    );
    for (const segment of segments) {
        const hit = classifySegment(command, segment, depth, !codePipelines.has(segment.pipeline));
        if (hit !== null) return hit;
    }
    return null;
}

/**
 * Commands that read a pipeline's flow as text: filters, viewers and plain formatters.
 * A strict allowlist, so an unnamed consumer folds toward `ask` — the same search piped
 * into a shell, an interpreter or an unknown wrapper emits code, not data.
 */
const DATA_CONSUMERS = new Set([
    'cat',
    'cut',
    'env',
    'grep',
    'head',
    'less',
    'more',
    'nl',
    'rg',
    'sort',
    'tac',
    'tail',
    'tee',
    'tr',
    'uniq',
    'wc',
]);

/** Basename of an argv0 word, or null when a substitution leaves the head unresolved. */
function argvName(word: ShellWord | undefined): string | null {
    if (word === undefined || word.substitutions.length > 0) return null;
    const slash = word.text.lastIndexOf('/');
    return slash < 0 ? word.text : word.text.slice(slash + 1);
}

/**
 * True when this segment treats what flows into it as text. The argv0 basename is used so a
 * path-qualified shell (`/bin/sh`) or a wrapper (`nice sh`) is not mistaken for a consumer;
 * stripping the whole head away (`| env`) falls back to the original word.
 */
function isDataConsumer(segment: ShellSegment): boolean {
    const stripped = stripWrappers(segment.words);
    const name = argvName(stripped[0] ?? segment.words[0]);
    return name !== null && DATA_CONSUMERS.has(name);
}

function classifySegment(
    command: string,
    segment: ShellSegment,
    depth: number,
    searchExemptable: boolean,
): string | null {
    for (const word of segment.words) {
        for (const body of word.substitutions) {
            const hit = classifyLexical(body, depth + 1);
            if (hit !== null) return hit;
        }
    }
    const words = stripWrappers(segment.words);
    if (words.length === 0) return null;
    const head = words[0];
    if (head !== undefined && head.substitutions.length === 0 && isShellBin(head.text)) {
        const script = extractDashC(words);
        if (script === 'missing') return classifyConservatively(maskedRaw(command, segment));
        if (script !== null) return classifyLexical(script, depth + 1);
    }
    // A search piped into an executor (`rg 'rm -rf /' x | sh`) emits code, not data:
    // drop the exemption and keep the whole-string scan.
    if (searchExemptable && isLiteralSearch(words)) return null;
    const wrappedHit = classifyWrappedShell(words, depth);
    if (wrappedHit !== null) return wrappedHit;
    const rawHit = classifyConservatively(command.slice(segment.start, segment.end));
    if (rawHit !== null) return rawHit;
    return classifyConservatively(words.map((word) => word.text).join(' '));
}

function classifyConservatively(command: string): string | null {
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
