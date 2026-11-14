/**
 * Frame fixture proof in a real browser (task 0988 R5, AC2).
 *
 * One harness embeds an owned frame-PERMITTING app and an owned frame-DENYING app on separate
 * origins, and offers an external-open link per embed. The proof records what the parent can
 * observe (focus, mobile layout, the link) and what only the browser can settle (whether the child
 * document actually ran), and it claims NO readiness for the denied frame — a blocked frame still
 * fires `load` in Chromium, which is exactly why the load event is never treated as readiness.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { availableBrowserBinary, type BrowserSession, launchBrowser } from '../test-helpers/cdp';

// Browser proofs require a real Chromium; state the absence instead of failing machines (and CI runners) without one.
const browserReady = availableBrowserBinary() !== undefined;

import {
    type FrameFixtureServer,
    type FrameHarnessServer,
    serveFrameFixtures,
    serveFrameHarness,
} from '../test-helpers/frame-fixtures';

let fixtures: FrameFixtureServer;
let harness: FrameHarnessServer;
let browser: BrowserSession;
let page: string;

/** Parent-side harness record. */
async function frameProof(): Promise<{
    loadFired: Record<string, boolean>;
    readiness: Record<string, string>;
    activeElement: string | null;
    inlineWidth: string | null;
    viewportWidth: number;
}> {
    return browser.evaluate('window.__frameProof', { sessionId: page });
}

/** Every execution context's view of the fixture marker ('' when the document never ran). */
async function fixtureTextPerContext(): Promise<{ origin: string; text: string }[]> {
    const contexts = browser.executionContexts();
    const out: { origin: string; text: string }[] = [];
    for (const context of contexts) {
        const text = await browser
            .evaluate<string>('(document.querySelector("[data-frame-fixture]") ?? {}).textContent ?? ""', {
                sessionId: page,
                contextId: context.id,
            })
            .catch(() => '');
        out.push({ origin: context.origin, text });
    }
    return out;
}

beforeAll(async () => {
    if (!browserReady) return;
    fixtures = await serveFrameFixtures();
    harness = await serveFrameHarness(fixtures);
    browser = await launchBrowser();
    page = await browser.newPage();
    await browser.navigate(harness.url, page);
    await browser.waitFor('Boolean(window.__frameProof && Object.keys(window.__frameProof.loadFired).length >= 1)', {
        sessionId: page,
        label: 'harness to embed both fixtures',
        timeoutMs: 30_000,
    });
}, 300_000);

afterAll(async () => {
    await browser?.close();
    harness?.stop();
    fixtures?.stop();
});

describe.skipIf(!browserReady)('frame embedding policy (R5, AC2)', () => {
    test('the permitted app actually runs inside the frame', async () => {
        const contexts = await fixtureTextPerContext();
        const permitted = contexts.filter((context) => context.origin === fixtures.origin);
        expect(permitted.length).toBeGreaterThan(0);
        expect(permitted.map((context) => context.text)).toContain('permitted frame fixture');

        const childFrame = (await browser.childFrames(page)).find((frame) => frame.url.startsWith(fixtures.origin));
        expect(childFrame).toBeDefined();
        const childContext = browser
            .executionContexts()
            .find((context) => context.origin === fixtures.origin && context.frameId === childFrame?.frameId);
        expect(childContext).toBeDefined();
        expect(await browser.evaluate<string>('document.title', { sessionId: page, contextId: childContext?.id })).toBe(
            'Frameable fixture app',
        );
    }, 60_000);

    test('the denied app never runs in the frame and its refusal is observable', async () => {
        const record = await frameProof();
        // The load event may fire for a blocked frame; the harness must not read it as readiness.
        expect(record.readiness.denied).toBe('not-claimed');

        const contexts = await fixtureTextPerContext();
        expect(contexts.map((context) => context.text)).not.toContain('denied frame fixture');
        expect(
            contexts.some((context) => context.origin.startsWith(fixtures.deniedUrl.replace('/denied.html', ''))),
        ).toBe(false);

        const refusals = browser
            .logEntries()
            .filter((entry) => /frame-ancestors|X-Frame-Options|Refused to (frame|display)/i.test(entry.text));
        expect(refusals.length).toBeGreaterThan(0);
    }, 60_000);

    test('no readiness claim comes from a frame load event', async () => {
        const record = await frameProof();
        // Both embeds fired `load`; neither is reported as ready by the harness.
        expect(record.loadFired.permitted).toBe(true);
        expect(record.readiness.permitted).toBe('not-claimed');
        expect(record.readiness.denied).toBe('not-claimed');
    }, 60_000);

    test('the external-open link stays available with noopener/noreferrer and opens the app', async () => {
        const link = await browser.evaluate<{ href: string; target: string; rel: string }>(
            '(() => { const a = document.querySelector("[data-external-open=denied]");' +
                ' return { href: a.href, target: a.target, rel: a.rel }; })()',
            { sessionId: page },
        );
        expect(link.href).toBe(fixtures.deniedUrl);
        expect(link.target).toBe('_blank');
        expect(link.rel).toContain('noopener');
        expect(link.rel).toContain('noreferrer');

        await browser.click('[data-external-open=denied]', page);
        await Bun.sleep(1000);
        const targets = (await browser.send('Target.getTargets')) as {
            targetInfos?: { url: string }[];
        };
        expect((targets.targetInfos ?? []).map((target) => target.url)).toContain(fixtures.deniedUrl);
    }, 60_000);

    test('focus and scrolling inside the framed document are observed separately', async () => {
        expect((await frameProof()).activeElement).toBe('permitted');

        const childContext = browser
            .executionContexts()
            .find((context) => context.origin === fixtures.origin && context.name === '');
        expect(childContext).toBeDefined();
        const scrollY = await browser.evaluate<number>(
            '(() => { window.scrollTo(0, 200); return window.scrollY; })()',
            { sessionId: page, contextId: childContext?.id },
        );
        expect(scrollY).toBe(200);
        // The parent document did not scroll: the framing document and the child are independent.
        expect(await browser.evaluate<number>('window.scrollY', { sessionId: page })).toBe(0);
    }, 60_000);

    test('a mobile viewport keeps the embed working without a readiness claim from the refusal', async () => {
        await browser.send(
            'Emulation.setDeviceMetricsOverride',
            { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
            page,
        );
        await browser.navigate(harness.url, page);
        await browser.waitFor('window.__frameProof.viewportWidth === 390', {
            sessionId: page,
            label: 'mobile viewport to apply',
        });
        await browser.waitFor('Boolean(window.__frameProof.loadFired.permitted)', {
            sessionId: page,
            label: 'permitted frame to load on mobile',
        });

        const record = await frameProof();
        expect(record.viewportWidth).toBe(390);
        expect(Number(record.inlineWidth)).toBe(390);
        expect(record.readiness.denied).toBe('not-claimed');

        const contexts = await fixtureTextPerContext();
        expect(contexts.map((context) => context.text)).toContain('permitted frame fixture');
        expect(contexts.map((context) => context.text)).not.toContain('denied frame fixture');
    }, 60_000);
});
