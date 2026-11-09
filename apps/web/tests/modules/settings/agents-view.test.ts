registerHappyDom();

import { afterAll, afterEach, expect, test } from 'bun:test';
import { REGISTERED_CANONICAL_STAGES } from '@gobing-ai/spur-domain';
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

// Regression (1321): the fallback stage table named `/sp:brainstorm`, a command that does not exist.
test('fallback stages name the shipped brainstorm command', async () => {
    setFetchForTesting((async (input: Request) =>
        input.url.endsWith('/project/fleet') ? json(FLEET) : json({ processes: [] })) as typeof fetch);
    const view = render(createElement(AgentsView, { pollMs: 60_000 }));
    await waitFor(() => expect(view.container.textContent).toContain('/sp:dev-brainstorm'));
    expect(view.container.textContent).not.toContain('/sp:brainstorm');
});

// Regression (1321): fallback skills must mirror the registry's `reasoning_skill`
// (packages/domain/src/stage-registry/schema.ts), which the live server path renders.
test('fallback stages name the registry reasoning skills', async () => {
    setFetchForTesting((async (input: Request) =>
        input.url.endsWith('/project/fleet') ? json(FLEET) : json({ processes: [] })) as typeof fetch);
    const view = render(createElement(AgentsView, { pollMs: 60_000 }));
    await waitFor(() => expect(view.container.textContent).toContain('sp:code-implementation'));
    const expectedStageIds = [
        'plan',
        'refine',
        'brainstorm',
        'implement',
        'test',
        'review',
        'verify',
        'dogfood',
        'wrap',
        'changelog',
    ];
    const registrySkills = new Map(REGISTERED_CANONICAL_STAGES.map((stage) => [stage.id, stage.reasoning_skill]));
    const cards = [...view.container.querySelectorAll('[data-stage-card]')];
    expect(cards.map((card) => card.getAttribute('data-stage-card'))).toEqual(expectedStageIds);
    for (const id of expectedStageIds) {
        const badge = view.container.querySelector(`[data-stage-card="${id}"] [title^="Reasoning skill: "]`);
        expect(badge?.getAttribute('title')).toBe(`Reasoning skill: ${registrySkills.get(id)}`);
    }
});
