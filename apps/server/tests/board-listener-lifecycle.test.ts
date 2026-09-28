/**
 * Bun/Hono listener lifecycle probe (task 0988 R6 / AC3).
 *
 * `spur serve` builds ONE Hono app before `Bun.serve` and never rebuilds it: the
 * board catalogue and the project-module asset handlers are fixed at boot (design
 * §4.4, "no live route mutation"). Before writing that down as "v1 does not mutate
 * live routes" the claim needs to be observable rather than assumed, so this probe
 * distinguishes the three lifecycle facts:
 *
 *   a. a Bun listener CAN swap its own fetch handler after `listen` (`reload`),
 *   b. Hono THROWS when a route is added after its matcher has been built by the
 *      first dispatch — the router's own guard, not a silent 404,
 *   c. a freshly constructed app that had the route at construction DOES serve it
 *      once the listener dispatches to the replacement app.
 *
 * Conclusion recorded here for v1: register the fixed catalogue/asset handlers
 * BEFORE `listen`; a changed handler set requires restart (or a fresh app swapped in
 * through the listener's own handler seam), never a live `app.get(...)`.
 *
 * Ephemeral ports (`port: 0`) and `afterEach` cleanup keep the probe hermetic.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';

/** Hono's guard message (hono/dist/router/smart-router/router.js) — asserted verbatim. */
const MATCHER_ALREADY_BUILT = 'Can not add a route since the matcher is already built.';

let server: Bun.Server<unknown> | undefined;

afterEach(() => {
    server?.stop(true);
    server = undefined;
});

/** Start a listener on an ephemeral port with the supplied fetch handler. */
function listen(fetch: (req: Request) => Response | Promise<Response>): Bun.Server<unknown> {
    server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch });
    return server;
}

describe('Bun listener + Hono matcher lifecycle (R6)', () => {
    test('a Bun listener serves its handler and accepts a replacement handler after listen', async () => {
        const listener = listen(() => new Response('first'));
        expect(listener.port).toBeGreaterThan(0);
        expect(await (await fetch(`http://127.0.0.1:${listener.port}/`)).text()).toBe('first');

        // (a) handler replacement — the listener's own seam, independent of Hono.
        listener.reload({ fetch: () => new Response('second') });
        const after = await fetch(`http://127.0.0.1:${listener.port}/`);
        expect(after.status).toBe(200);
        expect(await after.text()).toBe('second');
    });

    test('a Hono app rejects route insertion after its matcher has served a request', async () => {
        const app = new Hono();
        app.get('/early', (c) => c.text('early'));

        // Finalize the matcher: Hono builds its route table on first dispatch.
        expect(await (await app.request('/early')).text()).toBe('early');

        // (b) late insertion throws — the matcher will never see the new route.
        expect(() => app.get('/late', (c) => c.text('late'))).toThrow(MATCHER_ALREADY_BUILT);
        expect((await app.request('/late')).status).toBe(404);
        // The pre-finalization route still works, so the 404 is about the late route only.
        expect(await (await app.request('/early')).text()).toBe('early');
    });

    test('a freshly constructed app serves the route the finalized matcher rejected', async () => {
        const stale = new Hono();
        stale.get('/early', (c) => c.text('early'));
        await stale.request('/early');
        expect(() => stale.get('/late', (c) => c.text('late'))).toThrow(MATCHER_ALREADY_BUILT);

        // (c) a replacement app that had the route at construction always served it.
        const fresh = new Hono();
        fresh.get('/early', (c) => c.text('early'));
        fresh.get('/late', (c) => c.text('late'));

        const listener = listen((req) => fresh.fetch(req));
        const port = listener.port;
        expect(await (await fetch(`http://127.0.0.1:${port}/late`)).text()).toBe('late');

        // Swapping the listener's handler over to the same fresh app preserves both routes.
        listener.reload({ fetch: (req) => fresh.fetch(req) });
        expect(await (await fetch(`http://127.0.0.1:${port}/early`)).text()).toBe('early');
        expect(await (await fetch(`http://127.0.0.1:${port}/late`)).text()).toBe('late');
    });

    test('fixed handlers before listen: the wire preserves the boot handler set', async () => {
        const app = new Hono();
        app.get('/catalog', (c) => c.text('catalog'));
        const listener = listen((req) => app.fetch(req));
        const port = listener.port;

        expect(await (await fetch(`http://127.0.0.1:${port}/catalog`)).text()).toBe('catalog');

        // The v1 shape: the catalogue/asset handler set is fixed BEFORE listen. A module
        // asset route added after traffic started is rejected by the matcher and stays 404
        // on the wire — reloading the listener handler is the supported change path.
        expect(() => app.get('/modules/x/index.js', (c) => c.text('module asset'))).toThrow(MATCHER_ALREADY_BUILT);
        const late = await fetch(`http://127.0.0.1:${port}/modules/x/index.js`);
        expect(late.status).toBe(404);

        const reloaded = new Hono();
        reloaded.get('/catalog', (c) => c.text('catalog'));
        reloaded.get('/modules/x/index.js', (c) => c.text('module asset'));
        listener.reload({ fetch: (req) => reloaded.fetch(req) });
        expect(await (await fetch(`http://127.0.0.1:${port}/modules/x/index.js`)).text()).toBe('module asset');
    });
});
