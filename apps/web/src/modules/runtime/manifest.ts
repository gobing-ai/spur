import type { BoardModuleContribution } from '../contribution';

/**
 * Board runtime distribution contract (task 0988 R2) — the frozen shape written to
 * `board-runtime.json` at the web distribution root and consumed by the shipped board's
 * import map.
 *
 * Kept pure and side-effect free so the build integration, the unit tests and the
 * distribution assertions all read ONE implementation. Nothing here imports React: the
 * facade sources are strings supplied to the bundler.
 */
export interface BoardRuntimeManifest {
    readonly manifestVersion: 1;
    readonly catalogVersion: 1;
    readonly contributionApiVersion: BoardModuleContribution['apiVersion'];
    readonly reactVersion: string;
    readonly reactDomVersion: string;
    readonly reactRouterVersion: string;
    /**
     * Supported bare specifier -> same-origin facade asset URL. Explicit per specifier;
     * there is NO wildcard promise, so an unsupported subpath fails to resolve instead of
     * silently loading a second React.
     */
    readonly imports: Readonly<Record<string, string>>;
    /** Host module identities (and retired identities) a project contribution may not claim. */
    readonly reservedModules: readonly BoardReservedModule[];
}

/** One reserved host identity: built-in module metadata, or a retired route identity. */
export interface BoardReservedModule {
    readonly id: string;
    readonly route: string;
    /** Set for the identities retired by G64 (task 0849): no module exists any more. */
    readonly retired?: true;
    /** Route a retired identity resolves to today. */
    readonly redirectTo?: string;
}

/** Installed versions the manifest records, in the order they appear there. */
export interface BoardRuntimeVersions {
    readonly react: string;
    readonly reactDom: string;
    readonly reactRouter: string;
}

/**
 * Supported bare specifiers, mapped to the facade chunk that serves them.
 *
 * The React/JSX trio is mandatory (any compiled JSX needs it); React DOM and React Router
 * subpaths are listed explicitly because the Board renders with those instances too. Add a
 * specifier only with a demonstrated need — each entry is a public resolution promise.
 */
export const BOARD_FACADE_SPECIFIERS = [
    'react',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'react-dom',
    'react-dom/client',
    'react-router',
    'react-router/dom',
] as const;

/**
 * One bare specifier the Board guarantees to resolve.
 *
 * Derived from the list above rather than declared separately, so a facade can only be named
 * for a specifier the manifest actually advertises — the two cannot drift.
 */
export type BoardFacadeSpecifier = (typeof BOARD_FACADE_SPECIFIERS)[number];

/** Emitted chunk name for one facade — also its `_astro/<name>.<hash>.js` file stem. */
export function facadeChunkName(specifier: BoardFacadeSpecifier): string {
    return `board-facade-${specifier.replaceAll('/', '-')}`;
}

/**
 * Facade module source for one specifier, given the export names measured from the module
 * the client build actually resolves (see `integration.ts`).
 *
 * The facade is generated from that named list instead of `export * from 'react'` because
 * Vite's production CJS interop (`strictRequires`) hides React's named exports from Rollup's
 * static analysis: `export *` from React emits nothing usable, while accessing the interop
 * namespace at evaluation time yields the renderer's real bindings — the SAME function
 * objects the Board hydrates with (evidence: task 0988 browser proof).
 */
export function facadeSource(specifier: BoardFacadeSpecifier, exportNames: readonly string[]): string {
    const lines = [`import * as ns from '${specifier}';`];
    for (const name of exportNames) {
        if (name === 'default') continue;
        lines.push(`export const ${name} = ns.${name};`);
    }
    lines.push("export default typeof ns.default === 'undefined' ? ns : ns.default;");
    return `${lines.join('\n')}\n`;
}

/** Assemble the manifest — versions and imports are measured, never guessed. */
export function buildRuntimeManifest(input: {
    readonly versions: BoardRuntimeVersions;
    readonly imports: Readonly<Record<string, string>>;
    readonly reservedModules: readonly BoardReservedModule[];
}): BoardRuntimeManifest {
    return {
        manifestVersion: 1,
        catalogVersion: 1,
        contributionApiVersion: 1,
        reactVersion: input.versions.react,
        reactDomVersion: input.versions.reactDom,
        reactRouterVersion: input.versions.reactRouter,
        imports: Object.fromEntries(
            BOARD_FACADE_SPECIFIERS.map((specifier) => {
                const url = input.imports[specifier];
                if (!url) throw new Error(`board-runtime: no facade asset emitted for "${specifier}"`);
                return [specifier, url];
            }),
        ),
        reservedModules: input.reservedModules,
    };
}

/** The document import map body for a manifest. */
export function importMapFor(manifest: BoardRuntimeManifest): { imports: Record<string, string> } {
    return { imports: { ...manifest.imports } };
}

/** The `<script type="importmap">` element to place before any module import. */
export function renderImportMapScript(manifest: BoardRuntimeManifest): string {
    return `<script type="importmap">${JSON.stringify(importMapFor(manifest))}</script>`;
}
/**
 * Insert the import map into built HTML BEFORE any module import.
 *
 * An import map is only honored before the document's first module load, so the element goes
 * immediately after `<head>`; when a document has no head it goes before the first script, and
 * failing that at the front of the document. Idempotent: an existing import map is left alone.
 */
export function injectImportMap(html: string, importMapScript: string): string {
    if (html.includes('<script type="importmap">')) return html;

    const headOpen = /<head[^>]*>/i.exec(html);
    if (headOpen) {
        const at = headOpen.index + headOpen[0].length;
        return `${html.slice(0, at)}${importMapScript}${html.slice(at)}`;
    }
    const firstScript = /<script[^>]*>/i.exec(html);
    if (firstScript) return `${html.slice(0, firstScript.index)}${importMapScript}${html.slice(firstScript.index)}`;
    return `${importMapScript}${html}`;
}
