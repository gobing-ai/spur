/**
 * Minimal Chrome DevTools Protocol harness (task 0988 R4/R5).
 *
 * The React-identity and frame-policy proofs must run in a real browser engine: happy-dom or a
 * component mock cannot establish ESM module identity or browser framing policy. This drives a
 * real Chromium over CDP with Bun's built-in WebSocket — no new dependency, no browser automation
 * framework.
 *
 * Chrome discovery order: the Playwright browser cache, then a local Chrome install.
 * `availableBrowserBinary()` returns undefined when no engine is present so callers can state that
 * explicitly instead of silently passing — a simulated DOM cannot stand in for either proof.
 */

import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/** Candidate browser binaries, most specific first. */
function browserCandidates(): string[] {
    const playwrightCache = join(homedir(), 'Library/Caches/ms-playwright');
    const candidates: string[] = [];
    if (existsSync(playwrightCache)) {
        for (const entry of readdirSync(playwrightCache).sort().reverse()) {
            if (!entry.startsWith('chromium_headless_shell-')) continue;
            candidates.push(
                join(playwrightCache, entry, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
                join(playwrightCache, entry, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
            );
        }
    }
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    return candidates;
}

/** First usable Chromium binary, or undefined when this machine has none. */
export function availableBrowserBinary(): string | undefined {
    return browserCandidates().find((candidate) => existsSync(candidate));
}

/** One recorded browser log entry (CSP/frame refusals surface here). */
export interface BrowserLogEntry {
    readonly source: string;
    readonly level: string;
    readonly text: string;
}

/** A CDP execution context (one per frame document that actually executed). */
export interface BrowserExecutionContext {
    readonly id: number;
    readonly origin: string;
    readonly frameId: string | undefined;
    readonly name: string;
}

/** Playwright-installed Chromium versions look like 149.0.7827.55 — recorded for provenance. */
export interface BrowserSession {
    /** Browser version string reported over CDP. */
    readonly version: string;
    /** Create a new page target and return its session id. */
    newPage(): Promise<string>;
    /** Base CDP send (session-scoped when `sessionId` is given). */
    send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>;
    /** Evaluate an expression in a page context and return its JSON value. */
    evaluate<T>(expression: string, options?: { sessionId?: string; contextId?: number }): Promise<T>;
    /** Navigate a page and wait for the load event. */
    navigate(url: string, sessionId: string): Promise<void>;
    /** Poll `expression` until it is truthy (throws with the last value on timeout). */
    waitFor(expression: string, options?: { sessionId?: string; timeoutMs?: number; label?: string }): Promise<void>;
    /** Real user input: click the centre of the first element matching `selector`. */
    click(selector: string, sessionId: string): Promise<void>;
    /** Browser log entries seen so far (CSP violations, console messages). */
    logEntries(): readonly BrowserLogEntry[];
    /** Requests the page issued that did not return 2xx (asset/MIME failures surface here). */
    failedRequests(): readonly string[];
    /** Execution contexts created so far, keyed by frame. */
    executionContexts(): readonly BrowserExecutionContext[];
    /** Child frames of the main frame, with the URL Chromium currently reports. */
    childFrames(sessionId: string): Promise<readonly { frameId: string; url: string }[]>;
    /** Free-form JSON extraction from a page (throws on an in-page exception). */
    close(): Promise<void>;
}

interface CdpMessage {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
    sessionId?: string;
}

/** Launch headless Chromium and connect a CDP session. */
export async function launchBrowser(): Promise<BrowserSession> {
    const binary = availableBrowserBinary();
    if (!binary) throw new Error('no Chromium binary found for the CDP browser proof');

    const profile = await mkdtemp(join(tmpdir(), 'spur-cdp-0988-'));
    const child = Bun.spawn(
        [
            binary,
            '--headless',
            '--remote-debugging-port=0',
            `--user-data-dir=${profile}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            'about:blank',
        ],
        { stdout: 'ignore', stderr: 'ignore' },
    );

    const portFile = join(profile, 'DevToolsActivePort');
    let port = 0;
    for (let attempt = 0; attempt < 200; attempt += 1) {
        if (existsSync(portFile)) {
            port = Number.parseInt((await Bun.file(portFile).text()).split('\n')[0] as string, 10);
            if (port > 0) break;
        }
        await Bun.sleep(50);
    }
    if (!port) {
        child.kill();
        throw new Error('Chromium did not report a DevTools port');
    }

    const versionInfo = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as {
        webSocketDebuggerUrl: string;
        Browser: string;
    };
    const socket = new WebSocket(versionInfo.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve(), { once: true });
        socket.addEventListener('error', () => reject(new Error('CDP websocket failed')), { once: true });
    });

    let nextId = 0;
    const pending = new Map<number, (value: unknown) => void>();
    const logs: BrowserLogEntry[] = [];
    const contexts: BrowserExecutionContext[] = [];
    const requests = new Map<string, string>();
    const failures: string[] = [];

    socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as CdpMessage;
        if (message.id !== undefined) {
            pending.get(message.id)?.(message.result);
            pending.delete(message.id);
            return;
        }
        if (message.method === 'Log.entryAdded') {
            const entry = message.params?.entry as { source?: string; level?: string; text?: string } | undefined;
            logs.push({ source: entry?.source ?? '', level: entry?.level ?? '', text: entry?.text ?? '' });
        }
        if (message.method === 'Runtime.consoleAPICalled') {
            const args = (message.params?.args ?? []) as { value?: unknown; description?: string }[];
            logs.push({
                source: 'console',
                level: String(message.params?.type ?? ''),
                text: args.map((arg) => String(arg.value ?? arg.description ?? '')).join(' '),
            });
        }
        if (message.method === 'Network.requestWillBeSent') {
            const request = message.params?.request as { url?: string } | undefined;
            if (request?.url) requests.set(String(message.params?.requestId), request.url);
        }
        if (message.method === 'Network.responseReceived') {
            const params = message.params as
                | { requestId?: string; status?: number; response?: { status?: number } }
                | undefined;
            const status = Number(params?.status ?? params?.response?.status ?? 0);
            const url = requests.get(String(params?.requestId));
            if (url && status >= 400) failures.push(`${status} ${url}`);
        }
        if (message.method === 'Runtime.executionContextCreated') {
            const context = message.params?.context as
                | { id?: number; origin?: string; name?: string; auxData?: { frameId?: string } }
                | undefined;
            if (context?.id !== undefined) {
                contexts.push({
                    id: context.id,
                    origin: context.origin ?? '',
                    frameId: context.auxData?.frameId,
                    name: context.name ?? '',
                });
            }
        }
    });

    const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> => {
        const id = ++nextId;
        return new Promise((resolve) => {
            pending.set(id, resolve);
            socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
    };

    const evaluate = async <T>(
        expression: string,
        options: { sessionId?: string; contextId?: number } = {},
    ): Promise<T> => {
        const result = (await send(
            'Runtime.evaluate',
            {
                expression,
                returnByValue: true,
                awaitPromise: true,
                ...(options.contextId !== undefined ? { contextId: options.contextId } : {}),
            },
            options.sessionId,
        )) as { result?: { value?: T }; exceptionDetails?: { text?: string; exception?: { description?: string } } };
        if (result.exceptionDetails) {
            throw new Error(
                `CDP evaluate failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'unknown'}`,
            );
        }
        return result.result?.value as T;
    };

    const waitForEvent = (method: string, sessionId?: string, timeoutMs = 15_000): Promise<void> =>
        new Promise((resolve) => {
            const timer = setTimeout(resolve, timeoutMs);
            const listener = (event: MessageEvent): void => {
                const message = JSON.parse(String(event.data)) as CdpMessage;
                if (message.method === method && (!sessionId || message.sessionId === sessionId)) {
                    clearTimeout(timer);
                    socket.removeEventListener('message', listener);
                    resolve();
                }
            };
            socket.addEventListener('message', listener);
        });

    return {
        version: versionInfo.Browser,
        send,
        evaluate,
        logEntries: () => logs.slice(),
        failedRequests: () => failures.slice(),
        executionContexts: () => contexts.slice(),
        async newPage() {
            const target = (await send('Target.createTarget', { url: 'about:blank' })) as { targetId: string };
            const attached = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })) as {
                sessionId: string;
            };
            await send('Page.enable', {}, attached.sessionId);
            await send('Runtime.enable', {}, attached.sessionId);
            await send('Log.enable', {}, attached.sessionId);
            await send('Network.enable', {}, attached.sessionId);
            return attached.sessionId;
        },
        async navigate(url, sessionId) {
            const loaded = waitForEvent('Page.loadEventFired', sessionId);
            await send('Page.navigate', { url }, sessionId);
            await loaded;
        },
        async waitFor(expression, options = {}) {
            const deadline = Date.now() + (options.timeoutMs ?? 30_000);
            let last: unknown;
            while (Date.now() < deadline) {
                last = await evaluate(expression, { sessionId: options.sessionId });
                if (last) return;
                await Bun.sleep(100);
            }
            throw new Error(
                `timed out waiting for ${options.label ?? expression} (last value: ${JSON.stringify(last)})`,
            );
        },
        async click(selector, sessionId) {
            const box = await evaluate<{ x: number; y: number } | null>(
                `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;` +
                    ' const rect = el.getBoundingClientRect();' +
                    ' return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()',
                { sessionId },
            );
            if (!box) throw new Error(`click target not found: ${selector}`);
            await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y }, sessionId);
            await send(
                'Input.dispatchMouseEvent',
                { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 },
                sessionId,
            );
            await send(
                'Input.dispatchMouseEvent',
                { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 },
                sessionId,
            );
        },
        async childFrames(sessionId) {
            const tree = (await send('Page.getFrameTree', {}, sessionId)) as {
                frameTree?: { childFrames?: { frame: { id: string; url: string } }[] };
            };
            return (tree.frameTree?.childFrames ?? []).map((child) => ({
                frameId: child.frame.id,
                url: child.frame.url,
            }));
        },
        async close() {
            socket.close();
            child.kill();
            await rm(profile, { recursive: true, force: true });
        },
    };
}
