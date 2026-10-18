registerHappyDom();

import { afterAll, afterEach, expect, test } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import AgentsView from '../../../src/modules/settings/AgentsView';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

// Regression (2026-10-17): Settings › Agents showed only "Fleet roster unavailable" — the
// configured roles/stages/executors rendered only when BOTH the fleet and the process feed
// succeeded, and every poll aborted the previous in-flight request, whose AbortError was
// reported as a feed failure. A feed slower than the poll interval therefore never rendered.

const FLEET = {
    path: '/p',
    enabled: true,
    strategy: null,
    orchestrator: { state: 'missing', reason: 'no-orchestrator-declared' },
    members: [],
    capacity: { total: 0, enabled: 0, writeCapable: 0, missing: [] },
    roles: [
        { name: 'auditor', tier: 'cheap', stages: [], isCustom: true, electedExecutor: null, candidateExecutors: [] },
    ],
    stages: [],
    executors: [],
};

const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A feed that answers after `ms`, honouring abort like the platform fetch. */
const slow = (input: Request, ms: number, body: () => Response): Promise<Response> =>
    new Promise((resolve, reject) => {
        const handle = setTimeout(() => resolve(body()), ms);
        input.signal.addEventListener('abort', () => {
            clearTimeout(handle);
            reject(input.signal.reason);
        });
    });

afterEach(() => {
    cleanup();
    resetFetchForTesting();
});

afterAll(async () => {
    await teardownHappyDom();
});

test('configured roles render when the process feed fails', async () => {
    setFetchForTesting((async (input: Request) =>
        input.url.endsWith('/project/fleet') ? json(FLEET) : json({ error: 'boom' }, 500)) as typeof fetch);
    const view = render(createElement(AgentsView, { pollMs: 60_000 }));
    await waitFor(() => expect(view.container.textContent).toContain('auditor'));
});

test('a feed slower than the poll interval still renders instead of reporting failure', async () => {
    setFetchForTesting(((input: Request) =>
        slow(input, 150, () =>
            input.url.endsWith('/project/fleet') ? json(FLEET) : json({ processes: [] }),
        )) as unknown as typeof fetch);
    const view = render(createElement(AgentsView, { pollMs: 40 }));
    await waitFor(() => expect(view.container.textContent).toContain('auditor'), { timeout: 1000 });
    expect(view.container.querySelector('[data-roster-fetch-failed]')).toBeNull();
});
