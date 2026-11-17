/**
 * Runtime base path for the Board (feature K4, ADR-151 §5).
 *
 * The Board is one static build served either at the origin root (direct per-port `spur serve`, the
 * Astro dev server, memory-router tests) or under `/<prefix>/` behind the project gateway. The build
 * stays root-absolute and the gateway rebases the HTML; the client learns its mount point from the
 * `<meta name="spur-base">` tag the gateway injects. No global JS variable and no cookie, so a
 * direct per-port serve needs no server-side change.
 */
/** `'/<prefix>/'` from `<meta name="spur-base">`, else `'/'`. Always leading and trailing slash. */
export declare function basePath(): string;
/**
 * Resolve a root-relative URL against the active base path.
 *
 * Left untouched: absolute URLs (scheme), protocol-relative `//host`, in-page `#fragment`,
 * query-only `?q` and relative paths — only `/…` belongs to this origin's root.
 */
export declare function withBase(path: string): string;
/**
 * Resolve the public API base URL for browser, SSR and test contexts.
 *
 * In both dev and production the API is same-origin: under the gateway it lives at
 * `/<prefix>/api`, at the root it is `/api`. `PUBLIC_API_URL` still overrides (standalone API).
 */
export declare function resolveApiUrl(envUrl?: any, origin?: string, _isDev?: boolean): string;
/**
 * Namespace one browser-storage key by the active base path.
 *
 * Every local project shares the gateway origin, so `localStorage` is shared too: without a
 * namespace a draft or panel width set in one project would appear in the next. At `/` (direct
 * per-port serve) the key is returned unchanged, so no operator loses existing drafts or layout.
 */
export declare function scopedKey(key: string): string;
/** Test-only: forget the memoized base path (a new document/meta needs a fresh read). */
export declare function resetBasePathForTesting(): void;
