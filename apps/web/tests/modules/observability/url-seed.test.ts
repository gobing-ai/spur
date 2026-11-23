/**
 * A82 1424 R6 — an Observability deep link seeds the System Events intent.
 *
 * The failure: another module links to `?tab=system-events&eventName=…&runId=…` and the shell
 * ignores the filter, so the operator lands on the unfiltered ledger and re-types the search.
 */
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import SystemEventsTab from '../../../src/modules/observability/SystemEventsTab';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

registerHappyDom();
afterEach(() => {
    cleanup();
    resetFetchForTesting();
});
afterAll(teardownHappyDom);

const shellSource = readFileSync(
    join(import.meta.dir, '../../../src/modules/observability/ObservabilityShell.tsx'),
    'utf8',
);

describe('1424 R6 — URL deep link seeds the nav intent', () => {
    test('the shell reads eventName and runId from the URL for the system-events tab', () => {
        // The seed is a lazy `useState` initializer, so it must read the params before any effect.
        expect(shellSource).toContain("params.get('eventName')");
        expect(shellSource).toContain("params.get('runId')");
        expect(shellSource).toContain("requestedTab !== 'system-events'");
        expect(shellSource).toContain("tab: 'system-events'");
    });

    test('the seed is the initial nav intent, not a later effect that could be overwritten', () => {
        const initializer = /useState<ObservabilityNavIntent \| null>\(\(\) => \{[\s\S]*?\}\)/.exec(shellSource);
        expect(initializer).not.toBeNull();
        expect(initializer?.[0]).toContain('eventName');
        expect(initializer?.[0]).toContain('runId');
    });

    test('System Events still consumes navIntent for its filter', () => {
        const tabSource = readFileSync(
            join(import.meta.dir, '../../../src/modules/observability/SystemEventsTab.tsx'),
            'utf8',
        );
        expect(tabSource).toContain('navIntent');
    });

    test('SystemEventsTab includes names filter on its initial fetch when navIntent sets eventName without runId', async () => {
        const historyUrls: string[] = [];
        const mockFetch: typeof fetch = Object.assign(
            async (input: string | URL | Request) => {
                const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
                if (url.includes('/api/events/history')) {
                    historyUrls.push(url);
                }
                return new Response(
                    JSON.stringify({ events: [], count: 0, catalog: [], nextCursor: null, hasMore: false }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            },
            { preconnect: () => {} },
        );
        setFetchForTesting(mockFetch);

        render(
            createElement(SystemEventsTab, {
                timeRange: '4h',
                navIntent: { tab: 'system-events', eventName: 'a2a.message.received' },
            }),
        );

        await waitFor(() => {
            expect(historyUrls.length).toBeGreaterThanOrEqual(1);
        });
        expect(historyUrls[0]).toContain('names=a2a.message.received');
    });
});
