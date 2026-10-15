/**
 * Argv detection for `spur self hook …`, split from `self-hook.ts` so the CLI entry can route a
 * hook invocation without importing the hook runner (PR-L, lazy CLI loading).
 */

/** The verb `self-hook.ts` mounts; the parent (`self`) is chosen by the caller. */
export const SELF_HOOK_VERB = 'hook';

/** True when argv addresses `spur self hook …` (global flags ignored) — the early-dispatch test. */
export function isSelfHookInvocation(argv: readonly string[]): boolean {
    const tokens = argv.filter((token) => !['--no-logo', '--cli-verbose', '-v'].includes(token));
    return tokens[0] === 'self' && tokens[1] === SELF_HOOK_VERB;
}
