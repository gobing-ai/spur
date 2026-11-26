/**
 * The A2A cooperation sequence (A821 1454, R1–R8).
 *
 * The failure modes: a configuration list where the cooperation should be, an arrow order that
 * follows the array instead of `(createdAt, id)`, a filter that narrows the screen but not the query
 * (or clobbers another tab's URL state), a card read on every hover, a credential VALUE rendered where
 * its variable name belongs, a Trace link for an id that is not a run, and a drawer that takes the
 * default view back from the sequence.
 */
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { IntegrationsStatus, IntegrationsUsage } from '@gobing-ai/spur-contracts';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { SequenceClient } from '../../../src/modules/integrations/A2aSequence';
import { A2aTab } from '../../../src/modules/integrations/A2aTab';
import type { A2aTimelineInput, InboxRow } from '../../../src/modules/integrations/helpers';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';
import { FakePlanningSource } from '../../lib/planning-source.fixture';

registerHappyDom();
afterAll(teardownHappyDom);
afterEach(cleanup);

/** Rows are stamped relative to now so the header's 24h window is genuinely below them. */
const NOW = Date.now();

/** One timeline row with everything the sequence reads. */
function row(over: Partial<InboxRow> & { id: string }): InboxRow {
    return {
        fromId: 'operator',
        toId: 'proj-coder',
        body: 'body',
        kind: 'chat',
        status: 'queued',
        attempts: 1,
        error: null,
        claimedAt: null,
        deliveredAt: null,
        readAt: null,
        inReplyTo: null,
        threadId: over.id,
        requestKey: null,
        taskId: null,
        parentRunId: null,
        createdAt: NOW,
        ...over,
    };
}

/** Request → claim → deliver → read, with a receipt that persisted this run's own remote refs. */
const ROWS: InboxRow[] = [
    row({
        id: 'm1',
        fromId: 'operator',
        toId: 'proj-coder',
        kind: 'request',
        status: 'delivered',
        attempts: 1,
        claimedAt: NOW - 2_800,
        deliveredAt: NOW - 2_600,
        readAt: NOW - 2_400,
        requestKey: 'a2a:proj-coder:m1',
        body: 'implement task 1454',
        createdAt: NOW - 3_000,
    }),
    row({
        id: 'm2',
        fromId: 'proj-coder',
        toId: 'operator',
        kind: 'chat',
        status: 'claimed',
        attempts: 2,
        error: 'credential expired',
        inReplyTo: 'm1',
        threadId: 'm1',
        claimedAt: NOW - 1_900,
        body: 'the lane is fenced',
        createdAt: NOW - 2_000,
    }),
    row({
        id: 'm3',
        fromId: 'proj-coder',
        toId: 'proj-coder',
        status: 'queued',
        body: 'note to self',
        createdAt: NOW - 1_000,
    }),
];

const UUID_RUN = '9f1d2c3b-4a5e-4f60-8b71-2c3d4e5f6071';

const STATUS: IntegrationsStatus = {
    generatedAt: '2026-11-26T00:00:00.000Z',
    mcp: {
        enabled: false,
        path: '/mcp',
        url: null,
        auth: { envName: '', tokenPresent: false },
        protocolVersion: '2026-07-28',
        tools: [],
        resources: [],
    },
    a2a: {
        enabled: true,
        basePath: '/a2a',
        auth: { envName: 'SPUR_A2A_TOKEN', tokenPresent: false },
        members: [
            {
                member: 'proj-coder',
                direction: 'inbound',
                role: 'coder',
                cardUrl: 'http://localhost:3007/a2a/members/proj-coder/.well-known/agent-card.json',
                writeFenced: true,
            },
            {
                member: 'proj-peer',
                direction: 'outbound',
                kind: 'a2a',
                target: 'https://peer.example',
                auth: { envName: 'PEER_A2A_TOKEN', tokenPresent: false },
            },
        ],
    },
    gateway: { served: false },
};

/** The Agent Card the card route answers: the projection this server emits (§F4). */
const CARD = {
    name: 'proj-coder',
    description: 'Spur fleet member proj-coder (claude)',
    version: '1.0.0',
    supportedInterfaces: [{ url: 'http://localhost:3007/a2a/members/proj-coder', protocolVersion: '1.0' }],
    skills: [{ id: 'coder', name: 'coder', description: 'writes the code', tags: ['coder'] }],
    securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: 'bearer' } } },
};

let timelineCalls: A2aTimelineInput[] = [];
let requestCalls: Array<{ messageId?: string }> = [];
let timelineAnswer: () => Promise<{ messages: InboxRow[]; nextCursor: string | null }>;
let requestAnswer: (input: { messageId?: string }) => Promise<unknown[]>;
let cardReads: string[];
let cardAnswer: (url: string) => Promise<Response>;

/** A recording client: the seam is the whole transport, so the assertions read its inputs. */
function makeClient(): SequenceClient {
    return {
        timeline: (async (input: A2aTimelineInput) => {
            timelineCalls.push(input);
            return timelineAnswer();
        }) as unknown as SequenceClient['timeline'],
        requests: (async (input: { messageId?: string }) => {
            requestCalls.push(input);
            return requestAnswer(input);
        }) as unknown as SequenceClient['requests'],
    };
}

const USAGE: IntegrationsUsage = {
    tools: [],
    resources: [],
    byActor: [],
    a2a: [],
    authDenied: [],
    failureClusters: [],
};

/** One tab element with the sequence's seam and the card route stubbed. */
function tabElement(over: { status?: IntegrationsStatus; window?: '1h' | '24h' | '7d' | 'all' } = {}) {
    return (
        <A2aTab
            status={over.status ?? STATUS}
            requests={[]}
            receipts={[]}
            events={[]}
            usage={USAGE}
            window={over.window ?? '24h'}
            client={makeClient()}
            fetchCard={async (url) => {
                cardReads.push(url);
                return cardAnswer(url);
            }}
        />
    );
}

/** Render the tab. */
function renderTab(over: { status?: IntegrationsStatus; window?: '1h' | '24h' | '7d' | 'all' } = {}) {
    return render(tabElement(over));
}

/**
 * Install a fake `location` so the URL round-trip is observable. happy-dom's own document is
 * `about:blank`, whose `replaceState` is a no-op, so the descriptor is swapped and restored by hand.
 */
function stubLocation(search: string) {
    const original = Object.getOwnPropertyDescriptor(window, 'location');
    const written: string[] = [];
    Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: {
            search,
            pathname: '/board/integrations',
            hash: '',
            href: `http://localhost/board/integrations${search}`,
        },
    });
    const replaceState = spyOn(window.history, 'replaceState').mockImplementation(((
        _state: unknown,
        _title: string,
        url: string,
    ) => {
        written.push(url);
    }) as typeof window.history.replaceState);
    return {
        written,
        restore: () => {
            replaceState.mockRestore();
            if (original === undefined) delete (window as unknown as Record<string, unknown>).location;
            else Object.defineProperty(window, 'location', original);
        },
    };
}

beforeEach(() => {
    timelineCalls = [];
    requestCalls = [];
    cardReads = [];
    timelineAnswer = async () => ({ messages: ROWS, nextCursor: null });
    requestAnswer = async () => [];
    cardAnswer = async () => Response.json(CARD);
});

describe('1454 — the sequence leads the A2A tab (R1)', () => {
    test('the grid renders before the collapsed configuration drawer', async () => {
        const view = renderTab();
        const grid = await waitFor(() => view.getByTestId('integrations-a2a-sequence-grid'));
        const drawer = view.getByTestId('integrations-a2a-config-drawer');
        expect(drawer.tagName).toBe('DETAILS');
        // Collapsed by default: the sequence owns the view, the configuration is opt-in.
        expect(drawer.hasAttribute('open')).toBe(false);
        // DOCUMENT_POSITION_FOLLOWING: the drawer comes after the grid.
        expect(grid.compareDocumentPosition(drawer) & 4).toBe(4);
        // No capability loss: the moved content is still in the document, under its own testids.
        expect(view.getByTestId('integrations-a2a-members')).toBeTruthy();
    });

    test('one lifeline per participant and one arrow per message in (createdAt, id) order', async () => {
        const view = renderTab();
        await waitFor(() => view.getByTestId('integrations-a2a-sequence-grid'));
        const lanes = view.getByTestId('integrations-a2a-lanes');
        expect(lanes.textContent).toBe('operatorproj-coder');
        const rows = view.getAllByTestId(/^integrations-a2a-arrow-row-/);
        expect(rows.map((entry) => entry.getAttribute('data-testid'))).toEqual([
            'integrations-a2a-arrow-row-m1',
            'integrations-a2a-arrow-row-m2',
            'integrations-a2a-arrow-row-m3',
        ]);
        // One arrow per message: no fabricated rows beyond the page.
        expect(rows).toHaveLength(ROWS.length);
    });

    test('a reply indents under its thread and a self-message is drawn as a loop', async () => {
        const view = renderTab();
        await waitFor(() => view.getByTestId('integrations-a2a-arrow-row-m2'));
        const reply = view.getByTestId('integrations-a2a-arrow-row-m2');
        expect(reply.querySelector('[style*="padding-left"]')?.getAttribute('style')).toContain('padding-left: 12px');
        const root = view.getByTestId('integrations-a2a-arrow-row-m1');
        expect(root.querySelector('[style*="padding-left"]')?.getAttribute('style')).toContain('padding-left: 0px');
        // A self-message is one column and a loop glyph, never an arc between two lanes.
        const loop = view.getByTestId('integrations-a2a-arrow-trigger-m3').textContent ?? '';
        expect(loop).toContain('proj-coder ↺');
    });

    test('past eight lifelines the tail collapses into a +N column the operator can expand', async () => {
        const many = Array.from({ length: 9 }, (_, index) =>
            row({ id: `x${index}`, fromId: 'agent0', toId: `agent${index + 1}`, createdAt: NOW - 900 + index }),
        );
        timelineAnswer = async () => ({ messages: many, nextCursor: null });
        const view = renderTab();
        await waitFor(() => view.getByTestId('integrations-a2a-lane-overflow'));
        expect(view.getByTestId('integrations-a2a-lane-overflow').textContent).toBe('+2');
        expect(view.getByTestId('integrations-a2a-lanes').textContent).not.toContain('agent9');
        fireEvent.click(view.getByTestId('integrations-a2a-lane-toggle'));
        await waitFor(() => expect(view.queryByTestId('integrations-a2a-lane-overflow')).toBeNull());
        expect(view.getByTestId('integrations-a2a-lanes').textContent).toContain('agent9');
    });
});

describe('1454 — filters (R2)', () => {
    test('a filter change re-reads inbox.timeline with the mapped input', async () => {
        const view = renderTab();
        await waitFor(() => view.getByTestId('integrations-a2a-sequence-grid'));
        // The first read already carries the header window as an epoch-ms lower bound.
        expect(timelineCalls).toHaveLength(1);
        expect(typeof timelineCalls[0]?.since).toBe('number');
        expect(timelineCalls[0]?.limit).toBe(200);

        fireEvent.change(view.getByTestId('integrations-a2a-filter-member'), { target: { value: 'proj-coder' } });
        await waitFor(() => expect(timelineCalls).toHaveLength(2));
        expect(timelineCalls[1]).toMatchObject({ members: ['proj-coder'] });

        fireEvent.change(view.getByTestId('integrations-a2a-filter-direction'), { target: { value: 'out' } });
        await waitFor(() => expect(timelineCalls).toHaveLength(3));
        expect(timelineCalls[2]).toMatchObject({ members: ['proj-coder'], direction: 'out' });

        fireEvent.change(view.getByTestId('integrations-a2a-filter-kind'), { target: { value: 'request' } });
        await waitFor(() => expect(timelineCalls).toHaveLength(4));
        expect(timelineCalls[3]).toMatchObject({ kind: 'request' });

        fireEvent.change(view.getByTestId('integrations-a2a-filter-status'), { target: { value: 'failed' } });
        await waitFor(() => expect(timelineCalls).toHaveLength(5));
        expect(timelineCalls[4]).toMatchObject({ status: 'failed' });
        // Every read is a bounded, paged query — the filters are pushed into it, never applied here.
        expect(timelineCalls[4]?.limit).toBe(200);

        // The thread filter commits on Enter, so a typed id issues one read rather than one per key.
        const thread = view.getByTestId('integrations-a2a-filter-thread');
        fireEvent.focusIn(thread);
        fireEvent.change(thread, { target: { value: 'm1' } });
        expect(timelineCalls).toHaveLength(5);
        fireEvent.keyDown(thread, { key: 'Enter' });
        await waitFor(() => expect(timelineCalls).toHaveLength(6));
        expect(timelineCalls[5]).toMatchObject({ threadId: 'm1' });
    });

    test('the header window is the read lower bound, and a preset change re-reads', async () => {
        const view = renderTab({ window: '1h' });
        await waitFor(() => view.getByTestId('integrations-a2a-sequence-grid'));
        const hour = 60 * 60 * 1000;
        expect(Math.abs(Date.now() - (timelineCalls[0]?.since ?? 0) - hour)).toBeLessThan(60_000);
        // The unbounded preset sends no lower bound at all: the window is the header's, not a constant.
        view.rerender(tabElement({ window: 'all' }));
        await waitFor(() => expect(timelineCalls.length).toBeGreaterThan(1));
        expect(timelineCalls.at(-1)?.since).toBeUndefined();
    });

    test('the filters round-trip through the URL and leave other params alone', async () => {
        const location = stubLocation('?tab=a2a&members=other');
        try {
            const view = renderTab();
            await waitFor(() => view.getByTestId('integrations-a2a-sequence-grid'));
            fireEvent.change(view.getByTestId('integrations-a2a-filter-kind'), { target: { value: 'request' } });
            await waitFor(() => expect(location.written.length).toBeGreaterThan(0));
            const written = new URLSearchParams(location.written.at(-1)?.split('?')[1] ?? '');
            expect(written.get('a2a.kind')).toBe('request');
            // Another tab's params survive the write untouched.
            expect(written.get('tab')).toBe('a2a');
            expect(written.get('members')).toBe('other');
            // Clearing removes every `a2a.` param and still keeps the rest.
            fireEvent.click(view.getByTestId('integrations-a2a-filter-clear'));
            await waitFor(() =>
                expect(new URLSearchParams(location.written.at(-1)?.split('?')[1] ?? '').get('a2a.kind')).toBeNull(),
            );
            const cleared = new URLSearchParams(location.written.at(-1)?.split('?')[1] ?? '');
            expect(cleared.get('tab')).toBe('a2a');
            expect(cleared.get('members')).toBe('other');
        } finally {
            location.restore();
        }
    });

    test('the URL restores the view: the first read carries the decoded filters', async () => {
        const location = stubLocation('?tab=a2a&a2a.kind=chat&a2a.members=proj-peer&a2a.direction=out');
        try {
            const view = renderTab();
            await waitFor(() => view.getByTestId('integrations-a2a-sequence-grid'));
            expect(timelineCalls[0]).toMatchObject({
                kind: 'chat',
                members: ['proj-peer'],
                direction: 'out',
            });
            // The controls render the restored state, not an empty default.
            expect((view.getByTestId('integrations-a2a-filter-kind') as HTMLSelectElement).value).toBe('chat');
            expect((view.getByTestId('integrations-a2a-filter-member') as HTMLSelectElement).value).toBe('proj-peer');
        } finally {
            location.restore();
        }
    });
});

describe('1454 — lifeline tooltips (R3)', () => {
    test('an inbound lifeline opens the Agent Card summary, fetched once, with raw JSON when pinned', async () => {
        const view = renderTab();
        await waitFor(() => view.getByTestId('integrations-a2a-sequence-grid'));
        expect(cardReads).toEqual([]);

        await act(async () => {
            fireEvent.focusIn(view.getByTestId('integrations-a2a-lane-trigger-proj-coder'));
        });
        const panel = await waitFor(() => view.getByTestId('integrations-a2a-lane-detail-proj-coder'));
        await waitFor(() => expect(view.getByTestId('integrations-a2a-lane-card-proj-coder')).toBeTruthy());
        const card = view.getByTestId('integrations-a2a-lane-card-proj-coder').textContent ?? '';
        expect(card).toContain('proj-coder');
        expect(card).toContain('Spur fleet member proj-coder');
        expect(card).toContain('coder');
        expect(card).toContain('writes the code');
        expect(card).toContain('http://localhost:3007/a2a/members/proj-coder');
        expect(card).toContain('bearer');
        expect(cardReads).toEqual(['/a2a/members/proj-coder/.well-known/agent-card.json']);
        // The preview does not leak the raw JSON: that is the pinned state's addition.
        expect(view.queryByTestId('integrations-a2a-lane-card-json-proj-coder')).toBeNull();

        // The hover preview closes after the component's 150 ms grace period; wait it out.
        await act(async () => {
            fireEvent.mouseLeave(view.getByTestId('integrations-a2a-lane-trigger-proj-coder'));
            // The preview's close is a 150 ms timer: let it run inside act, not after the test.
            await new Promise((resolve) => setTimeout(resolve, 250));
        });
        expect(view.queryByTestId('integrations-a2a-lane-detail-proj-coder')).toBeNull();
        // Pinning at the trigger adds the raw JSON, and reopening reads nothing new.
        fireEvent.click(view.getByTestId('integrations-a2a-lane-trigger-proj-coder'));
        await waitFor(() => expect(view.getByTestId('integrations-a2a-lane-card-json-proj-coder')).toBeTruthy());
        expect(view.getByTestId('integrations-a2a-lane-card-json-proj-coder').textContent).toContain(
            '"name": "proj-coder"',
        );
        // Two opens, one read: the card is cached, not re-fetched on every hover.
        expect(cardReads).toHaveLength(1);
        expect(panel.getAttribute('role')).toBeDefined();
    });

    test('a card that cannot be read renders a Diagnostic, not a blank panel', async () => {
        cardAnswer = async () => new Response('nope', { status: 503 });
        const view = renderTab();
        await waitFor(() => view.getByTestId('integrations-a2a-sequence-grid'));
        await act(async () => {
            fireEvent.focusIn(view.getByTestId('integrations-a2a-lane-trigger-proj-coder'));
        });
        await waitFor(() => expect(view.getByTestId('integrations-a2a-lane-card-diagnostic-proj-coder')).toBeTruthy());
        const diagnostic = view.getByTestId('integrations-a2a-lane-card-diagnostic-proj-coder');
        expect(diagnostic.textContent).toContain('Agent Card could not be read');
        expect(diagnostic.textContent).toContain('503');
        // The sequence itself is untouched by one failed card.
        expect(view.getByTestId('integrations-a2a-sequence-grid')).toBeTruthy();
    });

    test('an outbound peer shows the target and its credential state, never a token', async () => {
        const view = renderTab();
        await waitFor(() => view.getByTestId('integrations-a2a-lanes'));
        // `proj-peer` has no message in this page, so its lifeline comes from the declaration: render
        // it through a row the peer receives to prove the header's content.
        expect(view.queryByTestId('integrations-a2a-lane-trigger-proj-peer')).toBeNull();
        timelineAnswer = async () => ({
            messages: [row({ id: 'peer-1', fromId: 'operator', toId: 'proj-peer', createdAt: NOW - 100 })],
            nextCursor: null,
        });
        view.unmount();
        const second = renderTab();
        await waitFor(() => second.getByTestId('integrations-a2a-lane-trigger-proj-peer'));
        await act(async () => {
            fireEvent.focusIn(second.getByTestId('integrations-a2a-lane-trigger-proj-peer'));
        });
        const panel = await waitFor(() => second.getByTestId('integrations-a2a-lane-detail-proj-peer'));
        const text = panel.textContent ?? '';
        expect(text).toContain('https://peer.example');
        expect(text).toContain('PEER_A2A_TOKEN');
        expect(text).toContain('unset');
        // The variable NAME crosses the port; a value never does.
        expect(text).toContain("variable's name");
        expect(document.body.innerHTML).not.toContain('SPUR_MCP_TOKEN_VALUE');
        expect(cardReads).toEqual([]);
    });
});

describe('1454 — arrow tooltip (R4)', () => {
    test('the arrow tooltip carries the excerpt, kind, delivery timeline, attempts, error and request key', async () => {
        requestAnswer = async (input) => [
            {
                messageId: input.messageId,
                requestKey: 'a2a:proj-coder:m1',
                status: 'delivered',
                attempts: 3,
                error: null,
                runId: UUID_RUN,
                runStatus: 'exited',
                taskId: null,
                outcome: 'completed',
                reason: null,
                hold: null,
                remoteTaskId: 'remote-t1',
                remoteContextId: 'ctx-1',
                remoteBranch: 'lane/one',
            },
        ];
        const view = renderTab();
        await waitFor(() => view.getByTestId('integrations-a2a-arrow-trigger-m1'));
        await act(async () => {
            fireEvent.focusIn(view.getByTestId('integrations-a2a-arrow-trigger-m1'));
        });
        await waitFor(() => expect(view.getByTestId('integrations-a2a-arrow-detail-m1')).toBeTruthy());
        const detail = view.getByTestId('integrations-a2a-arrow-detail-m1');
        const text = detail.textContent ?? '';
        expect(text).toContain('implement task 1454');
        expect(text).toContain('request');
        expect(text).toContain('delivered');
        expect(text).toContain('queued');
        expect(text).toContain('claimed');
        expect(text).toContain('read');
        expect(text).toContain('a2a:proj-coder:m1');
        // The receipt's attempts win over the row's, because the receipt is the delivery's own record.
        expect(text).toContain('3');
        await waitFor(() => expect(view.getByTestId('integrations-a2a-arrow-run-m1')).toBeTruthy());
        expect(view.getByTestId('integrations-a2a-arrow-run-m1').getAttribute('href')).toBe(
            `/board/observability?tab=trace&runId=${UUID_RUN}`,
        );
        const refs = view.getByTestId('integrations-a2a-arrow-refs-m1').textContent ?? '';
        expect(refs).toContain('remote-t1');
        expect(refs).toContain('ctx-1');
        expect(refs).toContain('lane/one');
        // The receipt is read once for this message, by id.
        expect(requestCalls).toEqual([{ messageId: 'm1' }]);
    });

    test('a non-UUID run is plain text and a failed delivery names its error', async () => {
        requestAnswer = async (input) => [
            {
                messageId: input.messageId,
                requestKey: null,
                status: 'claimed',
                attempts: 2,
                error: 'credential expired',
                runId: 'run-1',
                runStatus: 'running',
                taskId: null,
                outcome: null,
                reason: null,
                hold: null,
            },
        ];
        const view = renderTab();
        await waitFor(() => view.getByTestId('integrations-a2a-arrow-trigger-m2'));
        await act(async () => {
            fireEvent.focusIn(view.getByTestId('integrations-a2a-arrow-trigger-m2'));
        });
        await waitFor(() => expect(view.getByTestId('integrations-a2a-arrow-detail-m2')).toBeTruthy());
        const detail = view.getByTestId('integrations-a2a-arrow-detail-m2');
        expect(detail.textContent).toContain('the lane is fenced');
        expect(detail.textContent).toContain('credential expired');
        expect(detail.textContent).toContain('in reply to');
        expect(detail.textContent).toContain('m1');
        // `run-1` is not a run id: no dead Trace link, and the receipt's empty refs still say so.
        expect(view.queryByTestId('integrations-a2a-arrow-run-m2')).toBeNull();
        expect(view.getByTestId('integrations-a2a-arrow-refs-m2').textContent).toContain('no remote refs');
    });
});

describe('1454 — configuration drawer and the warning (R5)', () => {
    test('the drawer is collapsed by default and the no-inbound warning sits above the grid', async () => {
        const noInbound: IntegrationsStatus = {
            ...STATUS,
            a2a: {
                ...STATUS.a2a,
                members: STATUS.a2a.members.filter((member) => member.direction === 'outbound'),
            },
        };
        const view = renderTab({ status: noInbound });
        await waitFor(() => view.getByTestId('integrations-a2a-sequence-grid'));
        const warning = view.getByTestId('integrations-a2a-no-inbound');
        // The warning is visible above the sequence, not buried in the collapsed drawer.
        expect(warning.compareDocumentPosition(view.getByTestId('integrations-a2a-sequence-grid')) & 4).toBe(4);
        expect(view.getByTestId('integrations-a2a-config-drawer').hasAttribute('open')).toBe(false);
        expect(view.getByTestId('integrations-a2a-members')).toBeTruthy();
    });
});

describe('1454 — live updates (R6)', () => {
    const originalEventSource = globalThis.EventSource;
    afterEach(() => {
        globalThis.EventSource = originalEventSource;
        FakePlanningSource.instances = [];
    });

    test('a message.* frame refetches from the oldest loaded row, and a non-message frame does not', async () => {
        globalThis.EventSource = FakePlanningSource as unknown as typeof EventSource;
        const view = renderTab();
        await waitFor(() => view.getByTestId('integrations-a2a-sequence-grid'));
        expect(timelineCalls).toHaveLength(1);

        act(() => FakePlanningSource.latest.emit('task.updated', { wbs: '1454' }));
        await act(async () => undefined);
        expect(timelineCalls).toHaveLength(1);

        act(() => FakePlanningSource.latest.emit('message.created', { messageId: 'm4' }));
        await waitFor(() => expect(timelineCalls).toHaveLength(2));
        // Bounded by the oldest loaded row (not the whole window) and by the rows already on screen.
        expect(timelineCalls[1]?.since).toBe(ROWS[0]?.createdAt);
        expect(timelineCalls[1]?.limit).toBe(ROWS.length + 1);
        expect(timelineCalls[1]?.members).toBeUndefined();
        expect(timelineCalls[1]?.cursor).toBeUndefined();
    });
});

describe('1454 — empty and degraded states (R8)', () => {
    test('the empty state names both ways to send the first message', async () => {
        timelineAnswer = async () => ({ messages: [], nextCursor: null });
        const view = renderTab();
        await waitFor(() => view.getByTestId('integrations-a2a-sequence-empty'));
        const text = view.getByTestId('integrations-a2a-sequence-empty').textContent ?? '';
        expect(text).toContain('spur message send');
        expect(text).toContain('a2a send');
    });

    test('a timeline failure renders a Diagnostic and the drawer still renders', async () => {
        timelineAnswer = async () => {
            throw new Error('inbox/timeline answered 500');
        };
        const view = renderTab();
        await waitFor(() => view.getByTestId('integrations-a2a-sequence-diagnostic'));
        expect(view.getByTestId('integrations-a2a-sequence-diagnostic').textContent).toContain(
            'inbox/timeline answered 500',
        );
        // The configuration detail is never taken down by a failed sequence read.
        expect(view.getByTestId('integrations-a2a-config-drawer')).toBeTruthy();
        expect(view.getByTestId('integrations-a2a-members')).toBeTruthy();
    });

    test('status is an icon plus its text, never color alone', async () => {
        const view = renderTab();
        await waitFor(() => view.getByTestId('integrations-a2a-sequence-grid'));
        const delivered = view.getByTestId('integrations-a2a-arrow-status-m1');
        expect(delivered.textContent).toBe('delivered');
        expect(delivered.querySelector('svg')).toBeTruthy();
        const claimed = view.getByTestId('integrations-a2a-arrow-status-m2');
        expect(claimed.textContent).toBe('claimed');
        expect(claimed.querySelector('svg')).toBeTruthy();
        // The stacked list and the grid share the mark, so the text is never the only signal there either.
        expect(view.getByTestId('integrations-a2a-sequence-grid').textContent).toContain('delivered');
    });
});
