import type { BoardCatalog, BoardModuleDescriptor } from '@gobing-ai/spur-contracts';
import { createElement } from 'react';
import { ModuleDiagnostic } from '../components/ModuleErrorBoundary';
import type { BoardModuleContribution } from './contribution';
import type { WebModule } from './types';

/**
 * Composition of the built-in Board registry with a project catalog's downstream modules
 * (task 0990 R1–R3, `docs/design/downstream-board-modules.md`).
 *
 * One pass, one output: the caller feeds {@link ComposedBoardModules.modules} to
 * `createRegistry` and hands the result to the router and the shell. Failures are values,
 * not throw sites — a module that cannot load still gets a route that renders its
 * {@link BoardModuleDiagnostic}, so navigation survives.
 */

/** Bound for one native module's style + entry load. Internal seam — deliberately not a config flag. */
export const NATIVE_MODULE_LOAD_TIMEOUT_MS = 10_000;

/** Failure categories a diagnostic may name. */
export type BoardModuleFailureCategory =
    | 'catalog'
    | 'import'
    | 'style'
    | 'export'
    | 'version'
    | 'render'
    | 'panel'
    | 'unsupported';

/** One unusable module outcome, retained so the shell can render it instead of dropping it. */
export interface BoardModuleDiagnostic {
    readonly moduleId: string;
    readonly category: BoardModuleFailureCategory;
    readonly message: string;
}

/** Result of one composition pass. */
export interface ComposedBoardModules {
    /** Built-ins (unchanged order) followed by resolved downstream entries. */
    readonly modules: readonly WebModule[];
    /** Host-level diagnostics (catalog/host mismatch) — rendered as a banner, not a route. */
    readonly hostDiagnostics: readonly BoardModuleDiagnostic[];
}

/** Injectable loader seams — production defaults below, overridden only by tests. */
export interface ComposeBoardModulesOptions {
    readonly loadTimeoutMs?: number;
    readonly importEntry?: (url: string) => Promise<unknown>;
    readonly loadStyle?: (url: string) => Promise<void>;
}

/** Default entry importer: a runtime, same-origin ESM import the host import map resolves. */
function importEntryDefault(url: string): Promise<unknown> {
    return import(/* @vite-ignore */ url);
}

/** Stylesheets already applied in this document — CSS must land before a module is displayed. */
const appliedStyles = new Set<string>();
const pendingStyles = new Map<string, Promise<void>>();

/** Default stylesheet loader: `<link rel="stylesheet">`, awaited through load/error. */
function loadStyleDefault(url: string): Promise<void> {
    if (appliedStyles.has(url)) return Promise.resolve();
    const pending = pendingStyles.get(url);
    if (pending) return pending;

    const promise = new Promise<void>((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        link.addEventListener('load', () => {
            appliedStyles.add(url);
            pendingStyles.delete(url);
            resolve();
        });
        link.addEventListener('error', () => {
            pendingStyles.delete(url);
            reject(new Error(`stylesheet failed to load: ${url}`));
        });
        document.head.append(link);
    });
    pendingStyles.set(url, promise);
    return promise;
}

/** Reject with a named timeout once `ms` elapses. A timed-out import keeps running — we discard it. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const handle = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
        promise.then(
            (value) => {
                clearTimeout(handle);
                resolve(value);
            },
            (error) => {
                clearTimeout(handle);
                reject(error instanceof Error ? error : new Error(String(error)));
            },
        );
    });
}

/** Router route for a catalog descriptor: the catalog publishes `/modules/<id>`. */
function routeOf(descriptor: BoardModuleDescriptor): string {
    return descriptor.route.replace(/^\//, '').replace(/\/$/, '');
}

/** A route that renders a diagnostic instead of a contribution — bounded and actionable. */
function diagnosticEntry(descriptor: BoardModuleDescriptor, diagnostic: BoardModuleDiagnostic): WebModule {
    return {
        ...entryMetadata(descriptor),
        component: () => createElement(ModuleDiagnostic, { diagnostic }),
        contributionType: descriptor.type,
    };
}

/** Shared sidebar/route metadata for a catalog descriptor. */
function entryMetadata(descriptor: BoardModuleDescriptor) {
    return {
        id: descriptor.id,
        name: descriptor.name,
        icon: descriptor.icon,
        route: routeOf(descriptor),
        sidebarLabel: descriptor.sidebarLabel,
        description: descriptor.description,
        order: descriptor.order,
    };
}

/** Validate the evaluated namespace and narrow it to a usable contribution. */
function readContribution(
    evaluated: unknown,
    descriptor: BoardModuleDescriptor,
    apiVersion: number,
): BoardModuleContribution | BoardModuleDiagnostic {
    const contribution = (evaluated as { webModule?: unknown } | null)?.webModule;
    if (contribution === null || typeof contribution !== 'object') {
        return {
            moduleId: descriptor.id,
            category: 'export',
            message: 'named export "webModule" is missing',
        };
    }
    const { apiVersion: declared, component } = contribution as Partial<BoardModuleContribution>;
    if (declared !== apiVersion) {
        return {
            moduleId: descriptor.id,
            category: 'version',
            message: `contribution apiVersion ${String(declared)} is not supported (host ${apiVersion})`,
        };
    }
    if (typeof component !== 'function') {
        return { moduleId: descriptor.id, category: 'export', message: 'webModule.component is not a component' };
    }
    return contribution as BoardModuleContribution;
}

/** Distinguish a diagnostic (a value) from a resolved contribution or module entry. */
function isDiagnostic(value: object): value is BoardModuleDiagnostic {
    return 'category' in value;
}

/**
 * Load one native module: styles first, then the entry, both bounded. Every failure becomes a
 * diagnostic carrying the module's metadata, so the caller can route it.
 */
async function loadNativeModule(
    descriptor: Extract<BoardModuleDescriptor, { type: 'react' }>,
    apiVersion: number,
    options: {
        readonly timeoutMs: number;
        readonly importEntry: (url: string) => Promise<unknown>;
        readonly loadStyle: (url: string) => Promise<void>;
    },
): Promise<WebModule | BoardModuleDiagnostic> {
    for (const url of descriptor.styles) {
        try {
            await withTimeout(options.loadStyle(url), options.timeoutMs, 'stylesheet load');
        } catch (error) {
            return {
                moduleId: descriptor.id,
                category: 'style',
                message: error instanceof Error ? error.message : String(error),
            };
        }
    }

    let evaluated: unknown;
    try {
        evaluated = await withTimeout(options.importEntry(descriptor.entryUrl), options.timeoutMs, 'entry import');
    } catch (error) {
        return {
            moduleId: descriptor.id,
            category: 'import',
            message: error instanceof Error ? error.message : String(error),
        };
    }

    const resolved = readContribution(evaluated, descriptor, apiVersion);
    if (isDiagnostic(resolved)) return resolved;

    return {
        ...entryMetadata(descriptor),
        component: resolved.component,
        rightPanelComponent: resolved.rightPanelComponent,
        contributionType: 'react',
    };
}

/**
 * Compose built-ins with the catalog's enabled modules.
 *
 * Bounded and settled per module: one failure cannot reject the batch, and a failed module keeps
 * its route with a diagnostic instead of disappearing (R3). Ordering keeps the built-in sequence
 * intact and sorts downstream entries by configured order then id, so the built-in landing target
 * can never be replaced by a downstream `order` value (R1).
 */
export async function composeBoardModules(
    catalog: BoardCatalog | null,
    builtins: readonly WebModule[],
    options: ComposeBoardModulesOptions = {},
): Promise<ComposedBoardModules> {
    const timeoutMs = options.loadTimeoutMs ?? NATIVE_MODULE_LOAD_TIMEOUT_MS;
    const importEntry = options.importEntry ?? importEntryDefault;
    const loadStyle = options.loadStyle ?? loadStyleDefault;

    if (!catalog) {
        return {
            modules: builtins,
            hostDiagnostics: [
                {
                    moduleId: 'catalog',
                    category: 'catalog',
                    message: 'the project module catalog could not be read',
                },
            ],
        };
    }

    if (!catalog.host) {
        return {
            modules: builtins,
            hostDiagnostics: [
                {
                    moduleId: 'catalog',
                    category: 'unsupported',
                    message: 'no Board web distribution is installed, so downstream modules cannot be rendered',
                },
            ],
        };
    }

    const apiVersion = catalog.host.contributionApiVersion;
    const external = [...catalog.modules].sort(
        (a, b) =>
            (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY) || a.id.localeCompare(b.id),
    );

    const resolved = await Promise.all(
        external.map(async (descriptor): Promise<WebModule> => {
            if (descriptor.type === 'iframe') {
                // The iframe slice (0991) replaces this entry with a Board-owned frame component.
                return diagnosticEntry(descriptor, {
                    moduleId: descriptor.id,
                    category: 'unsupported',
                    message: 'iframe contributions are not rendered by this Board build',
                });
            }
            const outcome = await loadNativeModule(descriptor, apiVersion, { timeoutMs, importEntry, loadStyle });
            return isDiagnostic(outcome) ? diagnosticEntry(descriptor, outcome) : outcome;
        }),
    );

    return { modules: [...builtins, ...resolved], hostDiagnostics: [] };
}
