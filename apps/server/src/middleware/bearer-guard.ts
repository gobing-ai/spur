import { getEnvVars } from '@gobing-ai/spur-config';

/**
 * The one bearer guard behind the agent-facing protocol surfaces (task 1375): the a2a and mcp
 * modules call it per route and differ only in realm and error envelope, which arrive as the
 * `realm` option and the two body builders — the guard itself knows no surface shape and no
 * `ServerContext`, so 1376 can hook `onDenied` and 1382 can reuse it for the gateway root.
 */

/** Why a request was refused: no token variable at mount, no `Bearer ` header, or a failed comparison. */
export type BearerDenyReason = 'missing' | 'mismatch' | 'unset';

/** Options for `bearerGuard`: realm, the token variable NAME, the env to read it from, and the surface's body builders. */
export interface BearerGuardOptions {
    /** The challenge realm: 'spur-a2a' | 'spur-mcp' (1382 adds 'spur-gateway-mcp'). */
    realm: string;
    /** The NAME of the variable holding the token — never the value itself. */
    authEnv: string | null;
    /** When true, an unset token variable permits unauthenticated requests instead of failing closed with 500. */
    allowUnauthenticated?: boolean;
    /** The map the variable is read from: `bearerEnv(ctx)` at the call site. */
    env: Record<string, string | undefined>;
    /** The surface's 401 body builder (its own error envelope). */
    unauthenticated: () => unknown;
    /** The surface's 500 body builder for the misconfigured (unset token) case. */
    unconfigured: () => unknown;
    /** Refusal seam (1376 wires `auth.denied`); never receives token material. */
    onDenied?: (denial: { reason: BearerDenyReason; path: string }) => void;
}

/** The guard a mount site holds: whether the token variable resolved, and the per-route authorize check. */
export interface BearerGuard {
    /** False when the token variable is unset: the mount site warns; every request gets 500. */
    configured: boolean;
    /** The per-route check: a refusal Response, or null when the request may proceed. */
    authorize: (c: { req: { header(name: string): string | undefined; path: string } }) => Response | null;
}

/** The bearer token this surface accepts, from the variable `authEnv` names (R6). */
function requiredToken(authEnv: string | null, env: Record<string, string | undefined>): string | null {
    if (authEnv === null) return null;
    // The token value reaches this process only through the configured variable; it is never
    // written to the corpus, a receipt or a log. @gobing-ai/spur-app already redacts any
    // env value whose name matches /token|secret|credential/.
    const value = env[authEnv];
    return value === undefined || value === '' ? null : value;
}

/** Constant-time-ish comparison: never short-circuit on the first differing byte. */
function sameToken(provided: string | undefined, expected: string): boolean {
    if (provided === undefined) return false;
    const a = new TextEncoder().encode(provided);
    const b = new TextEncoder().encode(expected);
    let diff = a.length ^ b.length;
    for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
    return diff === 0;
}

/** Build the bearer guard for one protocol surface: reads the token once, refuses per route with the surface's envelopes. */
export function bearerGuard(options: BearerGuardOptions): BearerGuard {
    const token = requiredToken(options.authEnv, options.env);
    const allowUnauthenticated = options.allowUnauthenticated === true;
    return {
        configured: token !== null || allowUnauthenticated,
        authorize: (c) => {
            const path = c.req.path;
            if (token === null) {
                if (allowUnauthenticated) return null;
                options.onDenied?.({ reason: 'unset', path });
                return Response.json(options.unconfigured(), { status: 500 });
            }
            const header = c.req.header('Authorization') ?? '';
            const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;
            if (provided === undefined) options.onDenied?.({ reason: 'missing', path });
            else if (!sameToken(provided, token)) options.onDenied?.({ reason: 'mismatch', path });
            else return null;
            return Response.json(options.unauthenticated(), {
                status: 401,
                headers: { 'WWW-Authenticate': `Bearer realm="${options.realm}"` },
            });
        },
    };
}

/** The environment the token variable is read from: an injected map, else the sanctioned funnel. */
export function bearerEnv(ctx: object): Record<string, string | undefined> {
    // `env` is an options-level injection (CreateServerContextOptions), not declared on
    // ServerContext — same cast the a2a/mcp modules carried before this extraction.
    const injected = (ctx as { env?: Record<string, string | undefined> }).env;
    return injected ?? getEnvVars();
}
