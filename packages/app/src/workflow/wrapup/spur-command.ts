/**
 * `spurBin` → spawnable command for the wrap-up steps' nested spur lookups.
 *
 * Moved verbatim from the retired `plugins/sp/lib/spur-bin.ts` `spurCommand` (script-absorption
 * PR-5): a workflow's `spurBin` var may be a multi-word launch (`bun apps/cli/src/index.ts`), so it
 * splits on whitespace into a command plus prefix args.
 */
export function spurCommand(spurBin: string | undefined): { cmd: string; prefix: string[] } {
    const parts = (spurBin ?? 'spur')
        .trim()
        .split(/\s+/)
        .filter((p) => p.length > 0);
    return { cmd: parts[0] ?? 'spur', prefix: parts.slice(1) };
}

/**
 * Environment for the nested spur lookups and the `sh -c` feature gate: the step env itself (the
 * CLI passes the process env merged with its flag overrides), so `--feature`/`--spur-bin` reach
 * `$feature`/`$spurBin` inside `featureGateCmd` exactly as the workflow's exported vars do.
 */
export function childEnv(env: Record<string, string | undefined>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) if (value !== undefined) out[key] = value;
    return out;
}
