import type { BoardCatalog } from '@gobing-ai/spur-contracts';
import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router';
import { api } from '../lib/rpc-client';
import { composeBoardModules } from '../modules/compose';
import { BoardRegistryProvider, type BoardRegistryValue } from '../modules/RegistryProvider';
import { builtinRegistry, createRegistry } from '../modules/registry';
import { createAppRouter } from '../router';

/**
 * Resolve the one registry the Board renders from: fetch the typed project catalog through the
 * existing bounded client, compose it with the built-in entries, and validate the result.
 *
 * Both failure directions are non-fatal: an unreachable catalog becomes a host diagnostic with
 * built-ins alone, and a composed set that fails registry validation (e.g. a claimed built-in
 * route) also falls back to built-ins — the Board stays navigable either way (R1, R3).
 */
export async function loadBoardRegistry(
    fetchCatalog: () => Promise<BoardCatalog> = () => api.board.modules(),
): Promise<BoardRegistryValue> {
    const catalog = await fetchCatalog().catch(() => null);
    const composed = await composeBoardModules(catalog, builtinRegistry.modules);
    try {
        return { registry: createRegistry([...composed.modules]), hostDiagnostics: composed.hostDiagnostics };
    } catch (error) {
        return {
            registry: builtinRegistry,
            hostDiagnostics: [
                ...composed.hostDiagnostics,
                {
                    moduleId: 'catalog',
                    category: 'catalog',
                    message: error instanceof Error ? error.message : String(error),
                },
            ],
        };
    }
}

interface BoardBoot {
    readonly value: BoardRegistryValue;
    readonly router: ReturnType<typeof createAppRouter>;
}

/**
 * Client-only root: owns all React Router routing. Rendered via `client:only="react"` so the router
 * (and `createBrowserRouter`, which needs `document`) is only built in the browser, never at build
 * time. The catalog settles first, then exactly one combined registry is built and the router is
 * constructed from it once per mount.
 */
export default function BoardApp() {
    const [boot, setBoot] = useState<BoardBoot | null>(null);

    useEffect(() => {
        let alive = true;
        loadBoardRegistry().then((value) => {
            if (alive) setBoot({ value, router: createAppRouter(value.registry) });
        });
        return () => {
            alive = false;
        };
    }, []);

    if (!boot) return null;

    return (
        <BoardRegistryProvider value={boot.value}>
            <RouterProvider router={boot.router} />
        </BoardRegistryProvider>
    );
}
