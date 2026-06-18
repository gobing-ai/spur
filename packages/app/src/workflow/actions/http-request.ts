import type { ActionResult, ActionRunContext, ActionRunner, Vars } from '@gobing-ai/ts-dual-workflow-engine';

const KIND = 'http.request';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Narrow HTTP requester interface backed by APIClient. */
export interface HttpRequester {
    rawRequest(method: string, url: string, body?: string, opts?: HttpRequesterOptions): Promise<RawHttpResponse>;
}

/** Raw HTTP response shape consumed by the workflow action runner. */
export interface RawHttpResponse {
    status: number;
    headers: Record<string, string>;
    body: string;
}

/** Options forwarded to the underlying HTTP requester. */
export interface HttpRequesterOptions {
    headers?: Record<string, string>;
    timeout?: number;
    redirect?: 'follow' | 'error' | 'manual';
    maxResponseBytes?: number;
}

/** Per-run network policy: allowed origins/hosts. Default-deny when empty. */
export type HostAllowlist = ReadonlySet<string>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_METHODS: Record<string, true> = {
    GET: true,
    POST: true,
    PUT: true,
    PATCH: true,
    DELETE: true,
    HEAD: true,
    OPTIONS: true,
};

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576; // 1 MiB

const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9a-zA-Z]+$/;
const HEADER_VALUE_RE = /^[ \t]*[!-~\x80-\xff][\t -~\x80-\xff]*$/;

/** Private/loopback/link-local IP ranges blocked unless explicitly allowed. */
const PRIVATE_IP_PATTERNS: readonly RegExp[] = [
    /^127\./, // loopback 127.0.0.0/8
    /^10\./, // private 10.0.0.0/8
    /^172\.(1[6-9]|2\d|3[01])\./, // private 172.16.0.0/12
    /^192\.168\./, // private 192.168.0.0/16
    /^169\.254\./, // link-local
    /^0\./, // "this" network
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // carrier-grade NAT 100.64.0.0/10
    /^fc|^fd|^fe80:/i, // IPv6 unique local + link-local
    /^::1$/, // IPv6 loopback
    /^::$/, // IPv6 unspecified
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve `${vars.key}` and `${key}` template syntax from context.vars. */
function resolveTemplate(value: string, vars: Vars): string {
    return value.replace(/\$\{(vars\.)?(\w+)\}/g, (_match, _prefix, key: string) => {
        return vars[key] ?? '';
    });
}

/** Check if a hostname is a private/loopback/link-local IP. */
function isPrivateHost(hostname: string): boolean {
    const normalized = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
    return PRIVATE_IP_PATTERNS.some((re) => re.test(normalized));
}

/** Strip header values from error messages (auth tokens must not leak to logs). */
function redactHeaders(message: string): string {
    // Match both `"headers":{...}` (JSON) and `headers {...}` (stringified/Error output) forms.
    return message.replace(/"?headers"?\s*[: ]\s*\{[^}]+\}/gi, 'headers <redacted>');
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Workflow action that makes an outbound HTTP request with security hardening.
 *
 * Security properties:
 * - Rejects non-http(s) schemes.
 * - Default-deny host allowlist: empty allowlist → action fails.
 * - Rejects URLs with embedded credentials.
 * - Blocks private/loopback/link-local hosts unless explicitly allowed.
 * - Never logs or emits request headers (auth tokens).
 * - Rejects `redirect: 'follow'` — auto-following escapes the allowlist /
 *   private-host gate, which only validates the initial URL (SSRF guard).
 *   Callers re-issue the request per hop so every host is re-validated.
 *
 * Options:
 * - `url` (string, required): the target URL, may contain `${vars.*}` templates.
 * - `method` (string, default `GET`): HTTP method, normalized to uppercase.
 * - `headers` (Record<string,string>): request headers, template-resolved.
 * - `body` (string): raw request body, template-resolved.
 * - `failOnStatus` (number[]): status codes that should be treated as failure.
 * - `timeoutMs` (number, default 30000, max 120000): request timeout.
 * - `maxResponseBytes` (number, default 1048576): max response body size.
 * - `redirect` ('error'|'manual', default 'manual'): redirect policy. 'follow'
 *   is rejected — it would bypass the per-hop host gate (SSRF).
 * - `bodyVar` (string): export response body to this var.
 * - `statusVar` (string): export status code (as string) to this var.
 * - `headersVar` (string): export response headers (as JSON string) to this var.
 */
export class HttpRequestActionRunner implements ActionRunner {
    readonly kind = KIND;

    private readonly requester: HttpRequester;
    private readonly allowlist: HostAllowlist;

    constructor(requester: HttpRequester, allowlist: HostAllowlist) {
        this.requester = requester;
        this.allowlist = allowlist;
    }

    async execute(options: Record<string, unknown>, context: ActionRunContext): Promise<ActionResult> {
        // --- Extract and template-resolve options ---
        const rawUrl = asRequiredString(options.url, 'url');
        const method = (asOptionalString(options.method) ?? 'GET').toUpperCase();
        const rawHeaders = asRecord(options.headers) ?? {};
        const rawBody = asOptionalString(options.body);
        const failOnStatus = asNumberArray(options.failOnStatus);
        const timeoutMs = asNumber(options.timeoutMs) ?? DEFAULT_TIMEOUT_MS;
        const maxResponseBytes = asNumber(options.maxResponseBytes) ?? DEFAULT_MAX_RESPONSE_BYTES;
        const redirect = asOptionalString(options.redirect) as 'follow' | 'error' | 'manual' | undefined;
        const bodyVar = asOptionalString(options.bodyVar);
        const statusVar = asOptionalString(options.statusVar);
        const headersVar = asOptionalString(options.headersVar);

        // --- Bounds validation ---
        if (!Object.hasOwn(ALLOWED_METHODS, method)) {
            return { ok: false, error: `http.request: unsupported method: ${method}` };
        }

        if (timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
            return {
                ok: false,
                error: `http.request: timeoutMs must be 1–${MAX_TIMEOUT_MS}, got ${timeoutMs}`,
            };
        }

        if (maxResponseBytes <= 0) {
            return { ok: false, error: `http.request: maxResponseBytes must be positive, got ${maxResponseBytes}` };
        }

        // --- Template-resolve strings ---
        let url: string;
        let body: string | undefined;
        let headers: Record<string, string>;
        try {
            url = resolveTemplate(rawUrl, context.vars);
            body = rawBody !== undefined ? resolveTemplate(rawBody, context.vars) : undefined;
            headers = {};
            for (const [key, value] of Object.entries(rawHeaders)) {
                if (!HEADER_NAME_RE.test(key)) {
                    throw new Error(`invalid header name: ${JSON.stringify(key)}`);
                }
                if (!HEADER_VALUE_RE.test(value)) {
                    throw new Error(`invalid header value for ${JSON.stringify(key)}`);
                }
                headers[key] = resolveTemplate(value, context.vars);
            }
        } catch (err) {
            return { ok: false, error: `http.request: ${(err as Error).message}` };
        }

        // --- URL security gates ---
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            return { ok: false, error: redactHeaders(`http.request: invalid URL: ${url}`) };
        }

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return {
                ok: false,
                error: `http.request: only http/https schemes allowed, got: ${parsed.protocol.replace(':', '')}`,
            };
        }

        if (parsed.username || parsed.password) {
            return { ok: false, error: `http.request: URLs with embedded credentials are not allowed` };
        }

        // --- Redirect gate (SSRF) ---
        // Auto-following redirects would let a redirect to a private/internal
        // host bypass the gates below, which only see the initial URL. Reject
        // 'follow'; callers re-issue per hop so every host is re-validated.
        if (redirect === 'follow') {
            return {
                ok: false,
                error: `http.request: redirect:'follow' is not allowed — use 'manual' (default) or 'error' and re-issue the request per hop so each host is re-validated`,
            };
        }

        // --- Allowlist gate ---
        if (this.allowlist.size === 0) {
            return {
                ok: false,
                error: `http.request: no host allowlist configured — outbound HTTP is denied by default`,
            };
        }

        const origin = parsed.origin; // scheme://host:port
        const hostname = parsed.hostname;

        if (!this.allowlist.has(origin) && !this.allowlist.has(hostname)) {
            return {
                ok: false,
                error: `http.request: host not in allowlist: ${hostname}`,
            };
        }

        // --- Private-host gate ---
        if (isPrivateHost(hostname) && !this.allowlist.has(hostname) && !this.allowlist.has(origin)) {
            return {
                ok: false,
                error: `http.request: private/internal host not allowed unless explicitly in allowlist: ${hostname}`,
            };
        }

        // --- Execute request ---
        let rawResponse: RawHttpResponse;
        try {
            rawResponse = await this.requester.rawRequest(method, url, body, {
                headers,
                timeout: timeoutMs,
                redirect: redirect ?? 'manual',
                maxResponseBytes,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { ok: false, error: redactHeaders(`http.request: ${message}`) };
        }

        // --- Success mapping ---
        const status = rawResponse.status;
        const ok = !failOnStatus.includes(status);

        // --- Build setVars ---
        const setVars: Vars = {};
        if (statusVar) setVars[statusVar] = String(status);
        if (bodyVar) setVars[bodyVar] = rawResponse.body;
        if (headersVar) setVars[headersVar] = JSON.stringify(rawResponse.headers);

        return {
            ok,
            data: { status, headers: rawResponse.headers, body: rawResponse.body },
            error: ok ? undefined : `http.request: status ${status} is in failOnStatus`,
            setVars: Object.keys(setVars).length > 0 ? setVars : undefined,
        };
    }
}

// ---------------------------------------------------------------------------
// Option coercion helpers
// ---------------------------------------------------------------------------

function asRequiredString(value: unknown, name: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`${name} is required`);
    }
    return value;
}

function asOptionalString(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    return String(value);
}

function asNumber(value: unknown): number | undefined {
    if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
    return value;
}

function asRecord(value: unknown): Record<string, string> | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(record)) {
        if (typeof val === 'string') {
            result[key] = val;
        }
    }
    return result;
}

function asNumberArray(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
}
