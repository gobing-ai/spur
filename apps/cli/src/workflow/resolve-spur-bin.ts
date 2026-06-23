import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * Resolve a PATH-independent invocation of the spur CLI for shell guards/actions
 * inside workflows (`spur task check`, the verdict-gate `jq`, etc.).
 *
 * Why this exists: workflow shell guards run via execa-spawned `/bin/sh -c`, whose
 * environment does not reliably carry the user's PATH (so a bare `spur` resolves to
 * "command not found" → the guard fails). The `spur` on PATH may also be a different
 * version or a binary compiled without the `task`/`feature` commands. Injecting an
 * absolute invocation removes both ambiguities.
 *
 * Resolution hinges on **what `process.execPath` actually is**, not on whether the
 * source tree is present (the dev entry exists on disk even when a compiled binary
 * runs from the project root):
 * - **Bun runtime (dev/source run):** `execPath` is `bun`; invoke the working-tree
 *   entry through it (`<bun> run <cwd>/apps/cli/src/index.ts`) so guards run the exact
 *   source CLI. Only taken when that entry exists.
 * - **Compiled / installed binary:** `execPath` is the spur executable itself, which
 *   has no `run` subcommand — invoke it directly (`<execPath> task check …`).
 */
export function resolveSpurBin(cwd: string): string {
    const execName = basename(process.execPath).toLowerCase();
    const isBunRuntime = execName === 'bun' || execName === 'bun.exe';
    if (isBunRuntime) {
        const devEntry = join(cwd, 'apps', 'cli', 'src', 'index.ts');
        if (existsSync(devEntry)) {
            return `${process.execPath} run ${devEntry}`;
        }
    }
    return process.execPath;
}
