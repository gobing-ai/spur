import { isIP } from 'node:net';

/**
 * DNS-rebinding guard for the local Bun server (not the Worker, which sits behind a real domain).
 *
 * `csrf()` compares `Origin` against `new URL(c.req.url).origin`, and Bun builds `req.url` from the
 * `Host` header. A page on `evil.test` that re-resolves to 127.0.0.1 therefore looks same-origin and
 * can drive the unauthenticated process-control API. Rebinding always carries an attacker-owned
 * *name* in `Host`, so IP literals are safe; names are accepted only when the operator chose them:
 * `localhost`, the `--host` bind name, or a host from `SPUR_CORS_ORIGINS`.
 */
export function allowedHostnames(bindHost: string, corsOrigins: readonly string[]): Set<string> {
    const names = new Set(['localhost', normalizeHostname(bindHost)]);
    for (const origin of corsOrigins) {
        try {
            names.add(normalizeHostname(new URL(origin).hostname));
        } catch {
            // Malformed allowlist entries grant nothing.
        }
    }
    return names;
}

/** True when the request's Host may reach the app. */
export function isAllowedHost(req: Request, allowed: ReadonlySet<string>): boolean {
    let hostname: string;
    try {
        hostname = normalizeHostname(new URL(req.url).hostname);
    } catch {
        return false;
    }
    return isIP(hostname) !== 0 || allowed.has(hostname);
}

/** 421 Misdirected Request — names the fix, never echoes the Host back. */
export function rejectHost(): Response {
    return new Response('Misdirected Request: Host is not allowed. Bind with --host <name> to allow a hostname.', {
        status: 421,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
}

function normalizeHostname(hostname: string): string {
    return hostname
        .toLowerCase()
        .replace(/^\[|\]$/g, '')
        .replace(/\.$/, '');
}
