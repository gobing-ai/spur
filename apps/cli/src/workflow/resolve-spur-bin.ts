import { basename } from 'node:path';

/** The launch handles resolution depends on — injectable so the logic is unit-testable. */
export interface SpurBinLaunch {
    /** The executable running the process (`process.execPath`). */
    execPath: string;
    /** The entry module the runtime is executing (`Bun.main` / `process.argv[1]`). */
    mainModule: string | undefined;
}

/**
 * Pure resolution of a PATH-independent spur invocation from the launch handles.
 *
 * Why this exists: workflow shell guards run via execa-spawned `/bin/sh -c`, whose
 * environment does not reliably carry the user's PATH (so a bare `spur` resolves to
 * "command not found" → the guard fails). The `spur` on PATH may also be a different
 * version or a binary compiled without the `task`/`feature` commands. Injecting an
 * absolute invocation removes both ambiguities.
 *
 * The resolution must hold across the three ways spur runs — the prior
 * "does the source entry exist on disk" heuristic silently broke the most common one
 * (global install) — so it keys off **how the process was launched**:
 *
 * | Launch mode                              | `execPath`           | invocation emitted        |
 * | ---------------------------------------- | -------------------- | ------------------------- |
 * | `bun install -g @gobing-ai/spur` (prod)  | the Bun/Node runtime | `<runtime> <mainModule>`  |
 * | `bun run apps/cli/src/index.ts` (dev)    | the Bun/Node runtime | `<runtime> <mainModule>`  |
 * | compiled single-file binary (`dist/cli`) | the spur executable  | `<execPath>` (it is spur) |
 *
 * For the runtime modes, `mainModule` is the actual entry the runtime executes
 * (`spur.js` when installed, `apps/cli/src/index.ts` in dev), so `<runtime> <mainModule>`
 * re-invokes the *same* spur regardless of CWD or PATH. A compiled binary has no separate
 * runtime: `execPath` is the spur executable itself and handles `task check …` directly.
 */
export function resolveSpurBinFrom(launch: SpurBinLaunch): string {
    const runtime = basename(launch.execPath)
        .toLowerCase()
        .replace(/\.exe$/, '');
    const isJsRuntime = runtime === 'bun' || runtime === 'node';
    if (isJsRuntime && launch.mainModule) {
        return `${launch.execPath} ${launch.mainModule}`;
    }
    return launch.execPath;
}

/** Resolve the spur invocation from the live process handles. */
export function resolveSpurBin(): string {
    const mainModule = typeof Bun !== 'undefined' ? Bun.main : process.argv[1];
    return resolveSpurBinFrom({ execPath: process.execPath, mainModule });
}
