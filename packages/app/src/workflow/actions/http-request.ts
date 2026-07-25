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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip header values from error messages (auth tokens must not leak to logs). */
function redactHeaders(message: string): string {
    // Match both `"headers":{...}` (JSON) and `headers {...}` (stringified/Error output) forms.
    return message.replace(/"?headers"?\s*[: ]\s*\{[^}]+\}/gi, 'headers <redacted>');
}

/**
 * Reduce a URL to `scheme://host/path` for error messages. A URL assembled from
 * workflow vars can carry a token in its query string or userinfo, and an error
 * string reaches logs and the run record — so never echo the raw URL back.
 */
function redactUrl(raw: string): string {
    try {
        const parsed = new URL(raw);
        const query = parsed.search ? '?<redacted>' : '';
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}${query}`;
    } catch {
        // Unparseable: keep only the scheme prefix, which cannot hold credentials.
        return `${raw.split(/[?#]/)[0]?.slice(0, 60) ?? ''}…`;
    }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Workflow action that makes an outbound HTTP request with security hardening.
 *
 * Security properties:
 * - Rejects non-http(s) schemes.
 * - Default-deny host allowlist: empty allowlist → action fails. Private /
 *   loopback / link-local hosts are not special-cased — they succeed only when
 *   explicitly present on the allowlist (same property as any other host).
 * - Rejects URLs with embedded credentials.
 * - Never logs or emits request headers (auth tokens).
 * - Rejects `redirect: 'follow'` — auto-following escapes the host allowlist
 *   gate (which only validates the initial URL), creating an SSRF risk.
 *   Callers must re-issue per hop so every host is re-validated.
 * - Does not itself expand `${…}` templates. The engine resolves them once,
 *   before dispatch; a second pass here would re-expand resolved *values*, so
 *   untrusted content captured into a var (a response body, a file, agent
 *   output) could reference other vars and splice a secret into the request.
 *
 * Options (all `${vars.*}` / `${env.*}` templates are resolved by the engine
 * before this runner sees them; an undefined reference fails the run there):
 * - `url` (string, required): the target URL.
 * - `method` (string, default `GET`): HTTP method, normalized to uppercase.
 * - `headers` (Record<string,string>): request headers.
 * - `body` (string): raw request body.
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

    async execute(options: Record<string, unknown>, _context: ActionRunContext): Promise<ActionResult> {
        // --- Extract options ---
        // Templates are already resolved: the engine expands `${vars.*}` / `${env.*}`
        // over every option before an action sees it (and fails loud on an unknown
        // reference). Re-expanding here would run a second pass over resolved *values* —
        // so a response body or file captured into a var could smuggle its own
        // `${vars.token}` into a URL or header. Consume the options as delivered.
        const url = asOptionalString(options.url);
        if (url === undefined || url.length === 0) {
            return { ok: false, error: 'http.request: url is required' };
        }
        const method = (asOptionalString(options.method) ?? 'GET').toUpperCase();
        const rawHeaders = asRecord(options.headers) ?? {};
        const body = asOptionalString(options.body);
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

        // --- Header validation ---
        // Runs on the already-resolved values, which is what reaches the wire: a var
        // whose value carries CR/LF must not smuggle a header past this gate. Errors
        // name only the key — the value may be a secret.
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(rawHeaders)) {
            if (!HEADER_NAME_RE.test(key)) {
                return { ok: false, error: `http.request: invalid header name: ${JSON.stringify(key)}` };
            }
            if (!HEADER_VALUE_RE.test(value)) {
                return { ok: false, error: `http.request: invalid header value for ${JSON.stringify(key)}` };
            }
            headers[key] = value;
        }

        // --- URL security gates ---
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            return { ok: false, error: `http.request: invalid URL: ${redactUrl(url)}` };
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
