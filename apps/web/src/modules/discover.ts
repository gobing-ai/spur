import type * as Fs from 'node:fs';
import type * as NodePath from 'node:path';
import type * as NodeUrl from 'node:url';

import type { WebModule } from './types';

/**
 * Build-time module discovery.
 *
 * The only place `import.meta.glob` is called. Eager (`{ eager: true, as: 'sync' }`)
 * so the registry can validate / order synchronously at load. Each direct child
 * directory of a configured root exports a {@link WebModule} via a **named `module`
 * export** or a **default export**; missing both → the child is skipped (not an
 * error), so non-module directories do not break discovery.
 *
 * `import.meta.glob` is a Vite/Astro build-time transform and is **not** available
 * under `bun test` (it is `undefined`). {@link discoverModules} falls back to a
 * synchronous filesystem scan + `require()` in that runtime so the registry —
 * and the consumer tests that mount the real board — still resolve the
 * `task-kanban` module. The Astro build path (which provides `import.meta.glob`)
 * is the source of truth; the fallback exists only to keep unit tests honest.
 *
 * The `node:*` dependencies of the fallback are **type-only at the top level**
 * (erased at compile) and **runtime-required inside `discoverViaFs`** — never as
 * static value imports — so Vite/Rollup tree-shakes them out of the browser
 * bundle. The fallback function is dead code in the browser (glob is always
 * defined there).
 */

/** Eager glob entries keyed by path. */
type GlobEntries = Record<string, unknown>;

/** The Vite glob — `undefined` under `bun test`. Narrowed with `in` + `typeof`. */
const globRef = import.meta as unknown;
const glob =
    globRef !== null &&
    typeof globRef === 'object' &&
    'glob' in globRef &&
    typeof (globRef as { glob?: unknown }).glob === 'function'
        ? (globRef as { glob: (pattern: string, opts: Record<string, unknown>) => GlobEntries }).glob
        : undefined;

/** Read a discovered module from a glob/require entry by its `module` or `default` export. */
export function readModule(entry: unknown): WebModule | null {
    if (entry === null || typeof entry !== 'object') return null;
    if ('module' in entry && isWebModule(entry.module)) return entry.module;
    if ('default' in entry && isWebModule(entry.default)) return entry.default;
    return null;
}

/** Runtime narrowing for a `WebModule`-shaped value — checks every required field. */
export function isWebModule(value: unknown): value is WebModule {
    if (value === null || typeof value !== 'object') return false;
    return (
        'id' in value &&
        typeof value.id === 'string' &&
        'name' in value &&
        typeof value.name === 'string' &&
        'icon' in value &&
        typeof value.icon === 'string' &&
        'route' in value &&
        typeof value.route === 'string' &&
        'component' in value &&
        typeof value.component === 'function'
    );
}

/**
 * Build-runtime path: scan the default root via `import.meta.glob`.
 *
 * Exported with an injectable glob dependency so the branch (always live in the
 * browser bundle, dead under `bun test`) is unit-testable. Production callers
 * use {@link discoverModules}, which binds the real `import.meta.glob`.
 */
export function discoverViaGlob(globFn: (pattern: string, opts: Record<string, unknown>) => GlobEntries): WebModule[] {
    const found: WebModule[] = [];
    const entries = globFn('./*/index.{ts,tsx}', { eager: true, as: 'sync' });
    for (const entry of Object.values(entries)) {
        const mod = readModule(entry);
        if (mod) found.push(mod);
    }
    // Sort within root by id for deterministic order (glob return order is unspecified).
    found.sort((a, b) => a.id.localeCompare(b.id));
    return found;
}

/**
 * Discover all board modules across configured roots.
 *
 * Under the Vite/Astro build this uses `import.meta.glob`; under `bun test` it
 * falls back to a synchronous filesystem scan + `require()` of each discovered
 * `index.{ts,tsx}`. The fallback wires the real `node:fs` + `require` into
 * {@link discoverViaFs}; tests inject fakes directly.
 */
export function discoverModules(): WebModule[] {
    if (glob) return discoverViaGlob(glob);
    // Node modules lazily required here — never reached in the browser bundle (glob is defined there).
    const fs = require('node:fs') as typeof Fs;
    const path = require('node:path') as typeof NodePath;
    const url = require('node:url') as typeof NodeUrl;
    const root = typeof __dirname !== 'undefined' ? __dirname : path.dirname(url.fileURLToPath(import.meta.url));
    return discoverViaFs(root, {
        readdirSync: (r, opts) => fs.readdirSync(r, opts),
        tryRequire: (p) => require(p) as Record<string, unknown>,
    });
}

/** A directory entry as produced by `readdirSync({ withFileTypes: true })`. */
export interface FsDirent {
    name: string;
    isDirectory(): boolean;
}

/** Filesystem seam for {@link discoverViaFs} — injectable so the fs fallback is unit-testable. */
export interface FsSeam {
    readdirSync(root: string, opts: { withFileTypes: true }): FsDirent[];
    /** Try to load a module; throw on any failure (caught by the caller). */
    tryRequire(p: string): Record<string, unknown>;
}

/**
 * Bun-test / Node fallback — only reached when `import.meta.glob` is absent.
 *
 * Exported with an injectable filesystem seam so the catch paths and the sort
 * comparator (unreachable with a single real module dir) are unit-testable.
 * Production callers pass the real `node:fs` + `require`.
 */
export function discoverViaFs(root: string, seam: FsSeam): WebModule[] {
    // node:path is a pure builtin; required here (not top-level) so the browser bundle
    // (where this whole function is dead — glob is defined) tree-shakes it out.
    const path = require('node:path') as typeof NodePath;
    const found: WebModule[] = [];
    let dirs: FsDirent[] = [];
    try {
        dirs = seam.readdirSync(root, { withFileTypes: true });
    } catch {
        return found;
    }

    const names = dirs
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b));

    for (const name of names) {
        for (const ext of ['tsx', 'ts']) {
            const candidate = path.join(root, name, `index.${ext}`);
            try {
                const entry = seam.tryRequire(candidate);
                const mod = readModule(entry);
                if (mod) {
                    found.push(mod);
                    break;
                }
            } catch {
                // not a module directory or no WebModule export — skip
            }
        }
    }
    return found;
}
