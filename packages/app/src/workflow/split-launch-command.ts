/**
 * Shell metacharacters that must never appear in a resolved launch string.
 *
 * These callers spawn argv directly — no shell is involved — so the presence of shell
 * syntax means a caller is smuggling a program into the executable slot, which is
 * exactly the injection these guards exist to prevent.
 */
const SHELL_METACHARACTERS = /[;&|<>$`(){}[\]!*?~#\n\r"']/;

/**
 * Split a resolved launch string into its argv head and leading arguments.
 *
 * `spurBin` legitimately resolves to a multi-token launch string — `resolveSpurBin()`
 * returns `"<bun> <mainModule>"` when the CLI runs from source — so a single-token
 * rule would make every real gate in the shipped pipelines inexpressible. Splitting
 * on whitespace is safe precisely because no shell is involved: each token becomes
 * one literal argv entry.
 *
 * `label` names the caller's option and must embed the quoted option key, e.g.
 * `command.gate "executable"`, `doctor.probe "spurBin"`, `idea-handoff "spurBin"`.
 * It is caller-supplied so each consumer keeps its own error strings.
 *
 * Ceiling: an execPath/mainModule containing a space mis-splits. Accepted —
 * resolveSpurBin never quotes, and every prior copy of this function had the same
 * ceiling. If a supported install layout ever produces such a path, the fix belongs
 * in resolve-spur-bin.ts, not here.
 */
export function splitLaunchCommand(
    value: string,
    label: string,
): { command: string; leadingArgs: string[] } | { error: string } {
    if (SHELL_METACHARACTERS.test(value)) {
        return { error: `${label} must not contain shell metacharacters (got ${value})` };
    }
    const tokens = value
        .trim()
        .split(/\s+/)
        .filter((t) => t.length > 0);
    const command = tokens[0];
    if (command === undefined) {
        const key = label.slice(label.indexOf('"'));
        return { error: `Action option ${key} must be a non-empty string` };
    }
    return { command, leadingArgs: tokens.slice(1) };
}
