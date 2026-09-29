import { createContext, type ReactNode, useContext } from 'react';
import type { BoardModuleDiagnostic } from './compose';
import { builtinRegistry, type Registry } from './registry';

/**
 * Board registry context (task 0990 R1).
 *
 * The shell (sidebar, layout, router) reads ONE registry instance from here so downstream
 * modules and built-ins are ordered, disabled and validated by a single authority. The
 * default value is the built-in registry: component tests mount the shell without a
 * provider, and with no catalog they must behave exactly as before.
 */

/** What the shell consumes: the resolved registry plus host-level catalog diagnostics. */
export interface BoardRegistryValue {
    readonly registry: Registry;
    readonly hostDiagnostics: readonly BoardModuleDiagnostic[];
}

const BoardRegistryContext = createContext<BoardRegistryValue>({
    registry: builtinRegistry,
    hostDiagnostics: [],
});

/** Supply the composed registry to the shell. Mounted once, above the router. */
export function BoardRegistryProvider({
    value,
    children,
}: {
    readonly value: BoardRegistryValue;
    readonly children: ReactNode;
}) {
    return <BoardRegistryContext.Provider value={value}>{children}</BoardRegistryContext.Provider>;
}

/** Read the resolved Board registry. Falls back to built-ins when no provider is mounted. */
export function useBoardRegistry(): BoardRegistryValue {
    return useContext(BoardRegistryContext);
}
