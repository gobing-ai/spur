/**
 * Host module inventory for `board-runtime.json` (task 0988 R2).
 *
 * Prints the reserved identities a project contribution may not claim: the board's own
 * built-in module id/route metadata, plus the route identities retired by G64 (task 0849).
 *
 * Bun-only by construction: it loads the board's real module graph (TSX + `import.meta.glob`
 * fallback), which Node's type stripping cannot execute. `src/modules/runtime/integration.ts`
 * spawns it during the board build, so the shipped inventory is generated from the same
 * declarations the board itself discovers — never a second hand-written list.
 *
 *   bun apps/web/scripts/host-inventory.ts     # -> JSON array on stdout
 */

import { modules } from '../src/modules/registry';
import type { BoardReservedModule } from '../src/modules/runtime/manifest';
import { RETIRED_ROUTES } from '../src/router';

/** Reserved host identities, in board order then retirement order. */
export function hostReservedModules(): BoardReservedModule[] {
    return [
        ...modules.map((mod) => ({ id: mod.id, route: mod.route })),
        ...RETIRED_ROUTES.map((retired) => ({
            id: retired.from,
            route: retired.from,
            retired: true as const,
            redirectTo: retired.to,
        })),
    ];
}

if (import.meta.main) {
    process.stdout.write(JSON.stringify(hostReservedModules()));
}
