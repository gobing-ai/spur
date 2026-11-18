/**
 * Runtime base path for the Board (feature K4, ADR-151 §5).
 *
 * The Board is one static build served either at the origin root (direct per-port `spur self serve`, the
 * Astro dev server, memory-router tests) or under `/<prefix>/` behind the project gateway. The build
 * stays root-absolute and the gateway rebases the HTML; the client learns its mount point from the
 * `<meta name="spur-base">` tag the gateway injects. No global JS variable and no cookie, so a
 * direct per-port serve needs no server-side change.
 */

/** Base path of the current document, memoized per document (the meta cannot change at runtime). */
let cached: string | undefined;

/** `'/<prefix>/'` from `<meta name="spur-base">`, else `'/'`. Always leading and trailing slash. */
export function basePath(): string {
    if (cached !== undefined) return cached;
    const meta =
        typeof document === 'undefined' ? null : document.querySelector<HTMLMetaElement>('meta[name="spur-base"]');
    const content = meta?.content.trim() ?? '';
    if (content === '' || content === '/') {
        cached = '/';
        return cached;
    }
    cached = `/${content.replace(/^\/+|\/+$/g, '')}/`;
    return cached;
}

/**
 * Resolve a root-relative URL against the active base path.
 *
 * Left untouched: absolute URLs (scheme), protocol-relative `//host`, in-page `#fragment`,
 * query-only `?q` and relative paths — only `/…` belongs to this origin's root.
 */
export function withBase(path: string): string {
    if (!path.startsWith('/') || path.startsWith('//')) return path;
    const base = basePath();
    if (base === '/') return path;
    return `${base.replace(/\/$/, '')}${path}`;
}

/**
 * Resolve the public API base URL for browser, SSR and test contexts.
 *
 * In both dev and production the API is same-origin: under the gateway it lives at
 * `/<prefix>/api`, at the root it is `/api`. `PUBLIC_API_URL` still overrides (standalone API).
 */
export function resolveApiUrl(
    envUrl = import.meta.env.PUBLIC_API_URL,
    origin = globalThis.location?.origin,
    // Kept for the existing call/test shape: the API is always same-origin now, dev or not.
    _isDev?: boolean,
): string {
    if (envUrl) return envUrl;
    return origin && origin !== 'null' ? new URL(withBase('/api'), origin).toString() : 'http://localhost:3000/api';
}

/**
 * Namespace one browser-storage key by the active base path.
 *
 * Every local project shares the gateway origin, so `localStorage` is shared too: without a
 * namespace a draft or panel width set in one project would appear in the next. At `/` (direct
 * per-port serve) the key is returned unchanged, so no operator loses existing drafts or layout.
 */
export function scopedKey(key: string): string {
    const base = basePath();
    return base === '/' ? key : `${key}@${base}`;
}

/** Test-only: forget the memoized base path (a new document/meta needs a fresh read). */
export function resetBasePathForTesting(): void {
    cached = undefined;
}
