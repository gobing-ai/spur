/**
 * task-triage — the sensitive-path policy that decides whether a task's diff may be lane-negotiated
 * (task 1176 ownership move, ADR-130).
 *
 * Moved out of `plugins/sp/scripts/task-diffstat.ts`: the script keeps git capture and its output
 * artifact, while the safety floor — which paths always take the sensitive lane, never a model
 * decision — lives with the workflow/task owner. Pure and side-effect free (also Node-compatible).
 */

export const SENSITIVE_PREFIXES = ['drizzle/', 'packages/config/', '.github/', 'plugins/sp/hooks/'] as const;
/** Basename globs that always take the safety lane (matched with dotAll semantics). */
export const SENSITIVE_GLOBS = ['apps/server/src/**/auth*', '**/*secret*', '**/*.sql'] as const;

// Glob → RegExp: `**` + `/` matches any-or-no directories, bare `**` any characters, `*` within one segment.
function globToRegex(glob: string): RegExp {
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replaceAll('**/', '\u0000')
        .replaceAll('**', '\u0001')
        .replaceAll('*', '[^/]*')
        .replaceAll('\u0000', '(?:.*/)?')
        .replaceAll('\u0001', '.*');
    return new RegExp(`^${escaped}$`, 's');
}

const SENSITIVE_MATCHERS: Array<{ label: string; test: (path: string) => boolean }> = [
    ...SENSITIVE_PREFIXES.map((prefix) => ({
        label: prefix,
        test: (path: string): boolean => path.startsWith(prefix),
    })),
    ...SENSITIVE_GLOBS.map((glob) => {
        const regex = globToRegex(glob);
        return { label: glob, test: (path: string): boolean => regex.test(path) };
    }),
];

/** Sensitive-pattern match for one path, or null — mirrors wrapup-drift-probe's driftReasonForPath. */
export function sensitiveReasonForPath(path: string): string | null {
    const match = SENSITIVE_MATCHERS.find((entry) => entry.test(path));
    return match ? `matches sensitive pattern ${match.label}` : null;
}
