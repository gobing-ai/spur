#!/usr/bin/env bun
/**
 * careful-guard — PreToolUse guard for destructive shell commands (task 0215, R3).
 *
 * Warn (permission `ask`) before a `Bash` tool call runs a destructive command — `rm -rf`
 * (any flag spelling, including the POSIX uppercase `-R`), `DROP TABLE`/`DROP DATABASE`/
 * `TRUNCATE`, `git push --force`/`-f`/`+refspec`, `git reset --hard`, `git checkout .`/
 * `git restore .`, `kubectl delete`, `docker system prune`. The operator can confirm to
 * proceed. Pure pattern-match + decision, no domain logic (mirrors `task-write-guard`).
 *
 * **Safe exceptions:** `rm -rf` of well-known build/dependency caches (`node_modules`, `dist`,
 * `.next`, `coverage`, `build`, `.turbo`, `.cache`) passes without a warning — deleting a rebuildable
 * cache is routine, not dangerous.
 *
 * **Fail-open contract:** every error path — unparseable payload, non-Bash tool, empty command —
 * emits an `allow` decision. A broken guard must never wedge an agent tool call.
 *
 * **Escape hatch:** `SPUR_CAREFUL=off` short-circuits to allow.
 */

interface ToolPayload {
    tool_name?: string;
    tool_input?: { command?: string };
}

type Decision = 'allow' | 'ask';

function preToolUseDecision(decision: Decision, reason?: string): never {
    const hookSpecificOutput: Record<string, unknown> = {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
    };
    if (reason !== undefined) hookSpecificOutput.permissionDecisionReason = reason;
    const out: Record<string, unknown> = { hookSpecificOutput };
    if (reason !== undefined) out.systemMessage = reason;
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
}

/** Well-known rebuildable caches a `rm -rf` may target without a warning. */
const SAFE_RM_TARGET =
    /^(?:\.?\/)?(?:[\w.@-]+\/)*(?:node_modules|dist|\.next|coverage|build|\.turbo|\.cache|\.parcel-cache|out)\/?\*?$/;

/**
 * Expand an argument string into the set of flags it sets, splitting short-flag
 * clusters into their individual letters: `-Rf --force` → `{R, f, --force}`.
 *
 * Matching flags with ad-hoc regexes per call site is what let `rm -R` through —
 * `-\w*r` only ever matched the lowercase spelling, even though `man rm` defines
 * `-r` as "Equivalent to -R". Parsing once, case-preserved, makes that class of
 * miss unrepresentable: a caller names every spelling it cares about explicitly.
 */
function parseFlags(args: string): Set<string> {
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
function isRecursiveForceRm(args: string): boolean {
    const flags = parseFlags(args);
    // POSIX rm accepts -r and -R interchangeably; --recursive is the GNU long form.
    const recursive = flags.has('r') || flags.has('R') || flags.has('--recursive');
    const force = flags.has('f') || flags.has('--force');
    return recursive && force;
}

/** True when every non-flag target of a `rm` invocation is a known-safe cache path. */
function rmTargetsAllSafe(args: string): boolean {
    const targets = args
        .trim()
        .split(/\s+/)
        .filter((t) => t.length > 0 && !t.startsWith('-'));
    if (targets.length === 0) return false;
    return targets.every((t) => SAFE_RM_TARGET.test(t));
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
    { label: 'a cluster delete (kubectl delete)', re: /\bkubectl\s+delete\b/i },
    { label: 'a docker prune (docker system prune)', re: /\bdocker\s+system\s+prune\b/i },
];

/** Return a human label for the destructive command, or null when the command is safe. */
function classifyCommand(command: string): string | null {
    for (const rmMatch of command.matchAll(/\brm\b([^\n&|;]*)/g)) {
        const args = rmMatch[1] ?? '';
        if (isRecursiveForceRm(args) && !rmTargetsAllSafe(args)) {
            return 'a recursive force remove (rm -rf)';
        }
    }
    for (const { label, re } of DESTRUCTIVE) {
        if (re.test(command)) return label;
    }
    return null;
}

async function main(): Promise<void> {
    if (process.env.SPUR_CAREFUL === 'off') preToolUseDecision('allow');

    const stdinText = await Bun.stdin.text();
    let payload: ToolPayload;
    try {
        payload = JSON.parse(stdinText) as ToolPayload;
    } catch {
        preToolUseDecision('allow'); // unparseable payload — fail open
    }

    if (payload.tool_name !== 'Bash') preToolUseDecision('allow');

    const command = payload.tool_input?.command ?? '';
    if (command.trim() === '') preToolUseDecision('allow');

    const hit = classifyCommand(command);
    if (hit !== null) {
        preToolUseDecision(
            'ask',
            `This command looks like ${hit} — a destructive operation. Confirm you intend to run it. ` +
                'Set SPUR_CAREFUL=off to disable this guard.',
        );
    }
    preToolUseDecision('allow');
}

if (import.meta.main) void main();
