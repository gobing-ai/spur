registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import type { SearchHit, SearchResponse, SearchStatus } from '@gobing-ai/spur-contracts';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { api } from '../../../src/lib/rpc-client';
import { HitGroup, module as searchModule } from '../../../src/modules/search/index';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';
import '../../test-helpers/rpc-client-mock';

afterAll(teardownHappyDom);
afterEach(() => cleanup());

/**
 * Type into a controlled field. react-dom under happy-dom wires its legacy input
 * polyfill (focusin + keyup value check), so a bare fireEvent.change never reaches
 * onChange (pattern: projects/inbox-view.test.ts type()).
 */
function type(field: HTMLInputElement, value: string): void {
    fireEvent.focusIn(field);
    fireEvent.change(field, { target: { value } });
    fireEvent.keyUp(field);
}

function makeStatus(): SearchStatus {
    return {
        rg: { available: true, version: '15.2.0' },
        zg: { available: true, version: '0.2.2', index: 'ready', hint: 'index ready' },
    };
}

function makeHit(overrides?: Partial<SearchHit>): SearchHit {
    return {
        rank: 1,
        path: 'docs/design/hybrid-search.md',
        startLine: 12,
        endLine: 14,
        snippet: '…hybrid search combines exact and fuzzy…',
        route: 'exact',
        matchedBy: ['exact', 'fuzzy'],
        ...overrides,
    };
}

function makeResponse(): SearchResponse {
    return {
        query: 'hybrid search',
        mode: 'auto',
        scope: 'all',
        groups: { exact: [makeHit()], fuzzy: null },
        skipped: [{ route: 'fuzzy', reason: 'zg-not-installed', hint: 'install zg (bunx zg)' }],
        status: makeStatus(),
    } as SearchResponse;
}

/** Install a full search api surface on the shared mock (search key absent from defaultApi). */
function mockSearchApi() {
    const calls: Array<Record<string, unknown>> = [];
    const apiRecord = api as unknown as Record<string, unknown>;
    apiRecord.search = {
        query: (req: unknown) => {
            calls.push(req as Record<string, unknown>);
            return Promise.resolve({ data: makeResponse() });
        },
        status: () => Promise.resolve({ data: makeStatus() }),
    };
    return {
        searchApi: apiRecord.search as {
            query: (req: unknown) => Promise<{ data: SearchResponse }>;
            status: () => Promise<{ data: SearchStatus }>;
        },
        calls,
    };
}

describe('Search Board Web Module', () => {
    test('module metadata adheres to WebModule contract (sidebar order 15)', () => {
        expect(searchModule.id).toBe('search');
        expect(searchModule.name).toBe('Search');
        expect(searchModule.route).toBe('search');
        expect(searchModule.sidebarLabel).toBe('Search');
        expect(searchModule.order).toBe(15);
        expect(searchModule.component).toBeDefined();
    });

    test('HitGroup renders skipped degradation as inline reason + hint, never an error state', () => {
        const { container } = render(
            createElement(HitGroup, {
                label: 'Fuzzy',
                hits: null,
                skip: { reason: 'zg-not-installed', hint: 'install zg (bunx zg)' },
            }),
        );
        const section = container.querySelector('section');
        expect(section?.getAttribute('aria-label')).toBe('Fuzzy group');
        expect(section?.textContent).toContain('skipped: zg-not-installed');
        expect(section?.textContent).toContain('install zg (bunx zg)');
        expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    test('HitGroup renders path:line, snippet, and a matchedBy badge only when both routes agree', () => {
        const { container } = render(
            createElement(HitGroup, {
                label: 'Exact',
                hits: [
                    makeHit({ rank: 1 }),
                    makeHit({
                        rank: 2,
                        path: 'packages/app/src/services/search.ts',
                        startLine: 5,
                        endLine: 5,
                        snippet: '…exact only…',
                        matchedBy: ['exact'],
                    }),
                ],
                skip: null,
            }),
        );
        const text = container.textContent ?? '';
        expect(text).toContain('docs/design/hybrid-search.md:12-14');
        expect(text).toContain('packages/app/src/services/search.ts:5');
        expect(container.querySelectorAll('.badge')).toHaveLength(1);
    });

    test('SearchShell renders status badges and degraded results without an error state', async () => {
        mockSearchApi();
        const { container } = render(createElement(searchModule.component));
        await waitFor(() => expect(container.textContent).toContain('rg 15.2.0'));

        type(container.querySelector('#search-query') as HTMLInputElement, 'hybrid search');
        fireEvent.submit(container.querySelector('form') as HTMLFormElement);
        await waitFor(() => expect(container.textContent).toContain('Exact (1)'));

        const text = container.textContent ?? '';
        expect(text).toContain('skipped: zg-not-installed');
        expect(container.querySelectorAll('.text-error')).toHaveLength(0);
    });

    test('mode switch sends the selected mode in the query request', async () => {
        const { calls } = mockSearchApi();
        const { container } = render(createElement(searchModule.component));
        await waitFor(() => expect(container.textContent).toContain('rg 15.2.0'));

        type(container.querySelector('#search-query') as HTMLInputElement, 'zg index');
        const buttons = [...container.querySelectorAll('button')];
        fireEvent.click(buttons.find((b) => b.textContent === 'fuzzy') as HTMLButtonElement);
        fireEvent.submit(container.querySelector('form') as HTMLFormElement);
        await waitFor(() => expect(calls.length).toBeGreaterThan(0));

        expect(calls[0]?.mode).toBe('fuzzy');
    });
});
