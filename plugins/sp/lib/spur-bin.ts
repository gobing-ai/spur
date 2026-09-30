/**
 * Shared spur-invocation helper for the sp plugin scripts (task 1007 R9, RF-architect-001).
 *
 * `spurCommand` and `defaultSpurBin` moved verbatim from `wrapup-steps.ts` and
 * `workflow-step-profile.ts` so every surviving plugin script imports one copy (imported by
 * relative path like `lib/env.ts`, so the standalone contract holds; not an app bundle
 * because it carries no Spur-domain logic). Node/bun builtins and the vendored `./env`
 * gateway only — bundled standalone by `superskill install`, so no `@gobing-ai/*` value
 * imports (task 0669).
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getEnvVar } from './env';

/** `spurBin` splits on whitespace into a command plus prefix args (so `bun x.ts` works). */
export function spurCommand(spurBin: string | undefined): { cmd: string; prefix: string[] } {
    const parts = (spurBin ?? 'spur')
        .trim()
        .split(/\s+/)
        .filter((p) => p.length > 0);
    return { cmd: parts[0] ?? 'spur', prefix: parts.slice(1) };
}

/**
 * Resolve the spur CLI monorepo-safely (twin-safe resolution:
 * self-contained and no plugin script imports another):
 * --spur-bin > SPUR_BIN > monorepo-local CLI entry > PATH `spur`.
 */
export function defaultSpurBin(): string {
    const fromEnv = getEnvVar('SPUR_BIN');
    if (fromEnv) return fromEnv;
    const local = fileURLToPath(new URL('../../../apps/cli/src/index.ts', import.meta.url));
    if (existsSync(local)) return `bun ${local}`;
    return 'spur';
}
