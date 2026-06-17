import { PlaceholderModule } from './placeholder';
import type { WebModule } from './types';

/**
 * Built-in modules in registration order.
 * Task Kanban (W3/0084) replaces the placeholder once implemented.
 */
const builtins: WebModule[] = [PlaceholderModule];

/** Read-only module list — registry entries appended in the builtins array above. */
export const modules: ReadonlyArray<WebModule> = builtins;
/** Look up a module by its id. Returns undefined for unknown ids. */
export function getModule(id: string): WebModule | undefined {
    return builtins.find((m) => m.id === id);
}

/** The first registered module — used as the default landing route. */
export const defaultModule = builtins[0];
