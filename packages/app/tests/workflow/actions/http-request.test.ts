import { describe, expect, test } from 'bun:test';
import type { ActionRunContext, Vars } from '@gobing-ai/ts-dual-workflow-engine';
import {
    type HostAllowlist,
    HttpRequestActionRunner,
    type HttpRequester,
    type RawHttpResponse,
} from '../../../src/workflow/actions/http-request';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(vars?: Vars): ActionRunContext {
    return {
        runId: 'test-run',
        workdir: '/tmp',
        stateOrNodeId: 'test',
        vars: vars ?? {},
        env: {},
    };
}

function makeResponse(status: number, body: string): RawHttpResponse {
    return { status, headers: { 'content-type': 'text/plain' }, body };
}

/**
 * Fake HttpRequester that records calls and returns a canned response or throws.
 */
class FakeHttpRequester implements HttpRequester {
    calls: Array<{ method: string; url: string; body?: string; opts?: Record<string, unknown> }> = [];
    nextResponse?: RawHttpResponse;
    nextError?: Error;

    async rawRequest(
        method: string,
        url: string,
        body?: string,
        opts?: Record<string, unknown>,
    ): Promise<RawHttpResponse> {
        this.calls.push({ method, url, body, opts });
        if (this.nextError) {
            const err = this.nextError;
            this.nextError = undefined;
            throw err;
        }
        const res = this.nextResponse ?? makeResponse(200, 'ok');
        this.nextResponse = undefined;
        return res;
    }
}

function newRunner(allowlist?: HostAllowlist): { runner: HttpRequestActionRunner; fake: FakeHttpRequester } {
    const fake = new FakeHttpRequester();
    const runner = new HttpRequestActionRunner(fake, allowlist ?? new Set(['https://api.example.com']));
    return { runner, fake };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HttpRequestActionRunner', () => {
    // --- Happy path ---

    test('GET request with default method and allowed host', async () => {
        const { runner, fake } = newRunner();
        fake.nextResponse = makeResponse(200, 'hello');

        const result = await runner.execute({ url: 'https://api.example.com/data' }, makeContext());

        expect(result.ok).toBe(true);
        expect(result.data).toEqual({ status: 200, headers: { 'content-type': 'text/plain' }, body: 'hello' });
        expect(fake.calls[0]?.method).toBe('GET');
        expect(fake.calls[0]?.url).toBe('https://api.example.com/data');
    });

    test('POST request with body', async () => {
        const { runner, fake } = newRunner();
        fake.nextResponse = makeResponse(201, 'created');

        const result = await runner.execute(
            { url: 'https://api.example.com/data', method: 'POST', body: '{"x":1}' },
            makeContext(),
        );

        expect(result.ok).toBe(true);
        expect(fake.calls[0]?.method).toBe('POST');
        expect(fake.calls[0]?.body).toBe('{"x":1}');
    });

    test('exports setVars for bodyVar, statusVar, headersVar', async () => {
        const { runner, fake } = newRunner();
        fake.nextResponse = makeResponse(200, 'exported');

        const result = await runner.execute(
            {
                url: 'https://api.example.com/data',
                bodyVar: 'respBody',
                statusVar: 'respStatus',
                headersVar: 'respHeaders',
            },
            makeContext(),
        );

        expect(result.ok).toBe(true);
        expect(result.setVars).toEqual({
            respBody: 'exported',
            respStatus: '200',
            respHeaders: JSON.stringify({ 'content-type': 'text/plain' }),
        });
    });

    // --- Scheme + URL security ---

    test('rejects non-http scheme before any network call', async () => {
        const { runner, fake } = newRunner();

        const result = await runner.execute({ url: 'file:///etc/passwd' }, makeContext());

        expect(result.ok).toBe(false);
        expect(result.error).toContain('only http/https schemes allowed');
        expect(fake.calls.length).toBe(0);
    });

    test('rejects URL with embedded credentials', async () => {
        const { runner, fake } = newRunner();

        const result = await runner.execute({ url: 'https://user:pass@api.example.com/data' }, makeContext());

        expect(result.ok).toBe(false);
        expect(result.error).toContain('embedded credentials');
        expect(fake.calls.length).toBe(0);
    });

    test('rejects invalid URL', async () => {
        const { runner } = newRunner();

        const result = await runner.execute({ url: 'not-a-url' }, makeContext());

        expect(result.ok).toBe(false);
        expect(result.error).toContain('invalid URL');
    });

    // --- Allowlist ---

    test('empty allowlist fails all requests', async () => {
        const runner = new HttpRequestActionRunner(new FakeHttpRequester(), new Set());

        const result = await runner.execute({ url: 'https://api.example.com/data' }, makeContext());

        expect(result.ok).toBe(false);
        expect(result.error).toContain('no host allowlist configured');
    });

    test('host not in allowlist is rejected', async () => {
        const { runner, fake } = newRunner();

        const result = await runner.execute({ url: 'https://evil.com/data' }, makeContext());

        expect(result.ok).toBe(false);
        expect(result.error).toContain('host not in allowlist');
        expect(result.error).toContain('evil.com');
        expect(fake.calls.length).toBe(0);
    });

    test('explicit hostname entry in allowlist works', async () => {
        const { runner, fake } = newRunner(new Set(['api.example.com']));
        fake.nextResponse = makeResponse(200, 'ok');

        const result = await runner.execute({ url: 'https://api.example.com/data' }, makeContext());

        expect(result.ok).toBe(true);
    });

    // --- Private host blocking ---

    test('private host EXACTLY in allowlist passes', async () => {
        const { runner, fake } = newRunner(new Set(['127.0.0.1', 'http://127.0.0.1:8080']));
        fake.nextResponse = makeResponse(200, 'ok');

        const result = await runner.execute({ url: 'http://127.0.0.1:8080/data' }, makeContext());

        expect(result.ok).toBe(true);
    });

    test('private host not in allowlist fails at allowlist gate', async () => {
        const { runner, fake } = newRunner(new Set(['https://api.example.com']));

        const result = await runner.execute({ url: 'http://192.168.1.1/data' }, makeContext());

        expect(result.ok).toBe(false);
        expect(result.error).toContain('host not in allowlist');
        expect(fake.calls.length).toBe(0);
    });

    test('loopback IPv6 not in allowlist fails at allowlist gate', async () => {
        const { runner, fake } = newRunner(new Set(['https://api.example.com']));

        const result = await runner.execute({ url: 'http://[::1]:8080/data' }, makeContext());

        expect(result.ok).toBe(false);
        expect(result.error).toContain('host not in allowlist');
        expect(fake.calls.length).toBe(0);
    });

    // --- Method bounds ---

    test('rejects unsupported HTTP method', async () => {
        const { runner } = newRunner();

        const result = await runner.execute({ url: 'https://api.example.com/data', method: 'TRACE' }, makeContext());

        expect(result.ok).toBe(false);
        expect(result.error).toContain('unsupported method');
    });

    test('normalizes method to uppercase', async () => {
        const { runner, fake } = newRunner();
        fake.nextResponse = makeResponse(200, 'ok');

        const result = await runner.execute({ url: 'https://api.example.com/data', method: 'post' }, makeContext());

        expect(result.ok).toBe(true);
        expect(fake.calls[0]?.method).toBe('POST');
    });

    // --- Timeout bounds ---

    test('rejects zero timeoutMs', async () => {
        const { runner } = newRunner();

        const result = await runner.execute({ url: 'https://api.example.com/data', timeoutMs: 0 }, makeContext());

        expect(result.ok).toBe(false);
        expect(result.error).toContain('timeoutMs must be 1');
    });

    test('rejects timeoutMs over max', async () => {
        const { runner } = newRunner();

        const result = await runner.execute({ url: 'https://api.example.com/data', timeoutMs: 999_999 }, makeContext());

        expect(result.ok).toBe(false);
        expect(result.error).toContain('timeoutMs must be 1');
    });

    // --- maxResponseBytes ---

    test('rejects zero maxResponseBytes', async () => {
        const { runner } = newRunner();

        const result = await runner.execute(
            { url: 'https://api.example.com/data', maxResponseBytes: 0 },
            makeContext(),
        );

        expect(result.ok).toBe(false);
        expect(result.error).toContain('maxResponseBytes must be positive');
    });

    // --- Header validation ---

    test('rejects header name with control characters', async () => {
        const { runner } = newRunner();

        const result = await runner.execute(
            { url: 'https://api.example.com/data', headers: { 'X\n-Injected': 'value' } },
            makeContext(),
        );

        expect(result.ok).toBe(false);
        expect(result.error).toContain('invalid header name');
    });

    test('rejects header value with newline', async () => {
        const { runner } = newRunner();

        const result = await runner.execute(
            { url: 'https://api.example.com/data', headers: { Accept: 'text\n\rInjected' } },
            makeContext(),
        );

        expect(result.ok).toBe(false);
        expect(result.error).toContain('invalid header value');
    });

    test('rejects a header whose value carries CR/LF', async () => {
        const { runner, fake } = newRunner();

        // The engine resolves templates before dispatch, so what arrives here is the
        // value that reaches the wire — CR/LF in it is header injection.
        const result = await runner.execute(
            { url: 'https://api.example.com/data', headers: { 'X-Token': 'abc\r\nX-Injected: 1' } },
            makeContext(),
        );

        expect(result.ok).toBe(false);
        expect(result.error).toContain('invalid header value');
        // The secret-bearing value must not leak into the error.
        expect(result.error).not.toContain('abc');
        expect(fake.calls.length).toBe(0);
    });

    // --- Error handling ---

    test('network error returns ok:false with redacted message', async () => {
        const { runner, fake } = newRunner();
        fake.nextError = new Error('connect ECONNREFUSED');

        const result = await runner.execute({ url: 'https://api.example.com/data' }, makeContext());

        expect(result.ok).toBe(false);
        expect(result.error).toContain('http.request: connect ECONNREFUSED');
        expect(result.data).toBeUndefined();
    });

    test('timeout error returns ok:false', async () => {
        const { runner, fake } = newRunner();
        fake.nextError = new Error('The operation was aborted');

        const result = await runner.execute({ url: 'https://api.example.com/data' }, makeContext());

        expect(result.ok).toBe(false);
        expect(result.error).toContain('http.request:');
    });

    // --- failOnStatus ---

    test('200 with empty failOnStatus returns ok:true', async () => {
        const { runner, fake } = newRunner();
        fake.nextResponse = makeResponse(200, 'ok');

        const result = await runner.execute({ url: 'https://api.example.com/data' }, makeContext());

        expect(result.ok).toBe(true);
    });

    test('500 with empty failOnStatus returns ok:true (engine sees response)', async () => {
        const { runner, fake } = newRunner();
        fake.nextResponse = makeResponse(500, 'error');

        const result = await runner.execute({ url: 'https://api.example.com/data' }, makeContext());

        expect(result.ok).toBe(true);
        expect(result.data).toEqual({ status: 500, headers: { 'content-type': 'text/plain' }, body: 'error' });
    });

    test('200 with failOnStatus:[200] returns ok:false', async () => {
        const { runner, fake } = newRunner();
        fake.nextResponse = makeResponse(200, 'ok');

        const result = await runner.execute(
            { url: 'https://api.example.com/data', failOnStatus: [200] },
            makeContext(),
        );

        expect(result.ok).toBe(false);
        expect(result.error).toContain('status 200 is in failOnStatus');
    });

    test('404 with failOnStatus:[404] returns ok:false', async () => {
        const { runner, fake } = newRunner();
        fake.nextResponse = makeResponse(404, 'not found');

        const result = await runner.execute(
            { url: 'https://api.example.com/data', failOnStatus: [404] },
            makeContext(),
        );

        expect(result.ok).toBe(false);
        expect(result.error).toContain('status 404 is in failOnStatus');
    });

    // --- Redaction ---

    test('error messages do not include request header values', async () => {
        const { runner, fake } = newRunner();
        fake.nextError = new Error(
            'some error related to headers {"Authorization":"Bearer secret123","x-api-key":"abc"} and more',
        );

        const result = await runner.execute(
            { url: 'https://api.example.com/data', headers: { Authorization: 'Bearer secret123' } },
            makeContext(),
        );

        expect(result.ok).toBe(false);
        expect(result.error).not.toContain('Bearer secret123');
        expect(result.error).not.toContain('abc');
        expect(result.error).toContain('<redacted>');
    });

    // --- Template ownership ---
    //
    // The engine expands `${…}` once, over every option, before dispatch. The runner
    // must NOT expand again: a second pass would run over already-resolved *values*,
    // so untrusted content captured into a var could reference other vars.

    test('does not expand templates itself — options arrive already resolved', async () => {
        const { runner, fake } = newRunner();
        fake.nextResponse = makeResponse(200, 'ok');

        // Engine-resolved options: no `${…}` left. Vars are populated but irrelevant.
        const result = await runner.execute(
            { url: 'https://api.example.com/users/42', method: 'POST', body: 'user=42' },
            makeContext({ path: 'SHOULD-NOT-BE-USED' }),
        );

        expect(result.ok).toBe(true);
        expect(fake.calls[0]?.url).toBe('https://api.example.com/users/42');
        expect(fake.calls[0]?.body).toBe('user=42');
    });

    test('does not re-expand a vars reference carried inside a resolved value', async () => {
        const { runner, fake } = newRunner();
        fake.nextResponse = makeResponse(200, 'ok');

        // Models untrusted content that reached a var (a captured response body, a
        // file, agent output) and happens to contain template syntax. It must travel
        // verbatim — expanding it would splice `apiToken` into the request.
        const untrusted = `https://api.example.com/echo?leak=$${'{vars.apiToken}'}`;
        const result = await runner.execute({ url: untrusted }, makeContext({ apiToken: 'super-secret' }));

        expect(result.ok).toBe(true);
        expect(fake.calls[0]?.url).toBe(untrusted);
        expect(fake.calls[0]?.url).not.toContain('super-secret');
    });

    test('does not re-expand template syntax carried in a resolved header value', async () => {
        const { runner, fake } = newRunner();
        fake.nextResponse = makeResponse(200, 'ok');

        const untrusted = `token-$${'{vars.apiToken}'}`;
        await runner.execute(
            { url: 'https://api.example.com/data', headers: { 'X-Token': untrusted } },
            makeContext({ apiToken: 'super-secret' }),
        );

        const sent = (fake.calls[0]?.opts as Record<string, unknown>).headers as Record<string, string>;
        expect(sent['X-Token']).toBe(untrusted);
        expect(sent['X-Token']).not.toContain('super-secret');
    });

    // --- Required options ---

    test('a missing url fails the step instead of throwing', async () => {
        const { runner, fake } = newRunner();

        // Must not reject: the engine's runActionStep has no catch around
        // execute(), so a throw escapes the run's onError policy entirely.
        const result = await runner.execute({}, makeContext());

        expect(result.ok).toBe(false);
        expect(result.error).toContain('url is required');
        expect(fake.calls.length).toBe(0);
    });

    test('an empty url fails the step instead of throwing', async () => {
        const { runner } = newRunner();

        const result = await runner.execute({ url: '' }, makeContext());

        expect(result.ok).toBe(false);
        expect(result.error).toContain('url is required');
    });

    test('an unparseable url is reported without echoing its query string', async () => {
        const { runner } = newRunner();

        const result = await runner.execute({ url: 'ht!tp://bad url?token=super-secret' }, makeContext());

        expect(result.ok).toBe(false);
        expect(result.error).toContain('invalid URL');
        expect(result.error).not.toContain('super-secret');
    });

    // --- Redirect policy ---

    test('redirect defaults to manual', async () => {
        const { runner, fake } = newRunner();
        fake.nextResponse = makeResponse(200, 'ok');

        await runner.execute({ url: 'https://api.example.com/data' }, makeContext());

        expect(fake.calls[0]?.opts).toHaveProperty('redirect', 'manual');
    });

    test("redirect:'error' is passed through", async () => {
        const { runner, fake } = newRunner();
        fake.nextResponse = makeResponse(200, 'ok');

        await runner.execute({ url: 'https://api.example.com/data', redirect: 'error' }, makeContext());

        expect(fake.calls[0]?.opts).toHaveProperty('redirect', 'error');
    });

    test("redirect:'follow' is rejected (SSRF: would bypass per-hop host gate)", async () => {
        const { runner, fake } = newRunner();
        fake.nextResponse = makeResponse(200, 'ok');

        const result = await runner.execute({ url: 'https://api.example.com/data', redirect: 'follow' }, makeContext());

        expect(result.ok).toBe(false);
        expect(result.error).toContain("redirect:'follow' is not allowed");
        // The request must never be issued when 'follow' is requested.
        expect(fake.calls.length).toBe(0);
    });
});
