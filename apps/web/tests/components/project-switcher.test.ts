import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import ProjectSwitcher, {
    directBoardUrl,
    projectDisplayName,
    projectEndpointLabel,
    projectIdentity,
    registryFindingMessages,
} from '@/components/ProjectSwitcher';
import { resetFetchForTesting, setFetchForTesting } from '../../src/lib/rpc-client';
import { registerHappyDom, teardownHappyDom } from '../happy-dom';

registerHappyDom();
afterEach(() => {
    cleanup();
    resetFetchForTesting();
});
afterAll(teardownHappyDom);

describe('projectDisplayName', () => {
    it('appends the host for remote entries', () => {
        expect(projectDisplayName({ name: 'knowledge-kit', host: '192.168.87.27' })).toBe(
            'knowledge-kit (192.168.87.27)',
        );
        expect(projectDisplayName({ name: 'kk', host: 'dev.example.com' })).toBe('kk (dev.example.com)');
    });

    it('keeps the bare name for local or missing hosts', () => {
        for (const host of [undefined, '', 'localhost', 'LOCALHOST', '127.0.0.1', '::1', ' localhost ']) {
            expect(projectDisplayName({ name: 'spur-new', host })).toBe('spur-new');
        }
    });
});

describe('directBoardUrl', () => {
    it('always resolves local and remote entries without requiring running state', () => {
        expect(directBoardUrl({ host: '192.168.87.27', port: 3003, running: false })).toBe(
            'http://192.168.87.27:3003/board',
        );
        expect(directBoardUrl({ host: 'localhost', port: 3001, running: false })).toBe('http://localhost:3001/board');
        expect(directBoardUrl({ host: 'localhost', port: 3001, running: true })).toBe('http://localhost:3001/board');
    });

    it('returns null only when no url, no usable prefix, and no valid port exist', () => {
        expect(directBoardUrl({ host: 'localhost', port: 0, running: false }, '/')).toBeNull();
        expect(directBoardUrl({ host: '192.168.87.27', port: 0, running: false })).toBeNull();
    });

    it('navigates a local entry by prefix on the current origin behind the gateway (K4 R7)', () => {
        expect(directBoardUrl({ host: 'localhost', port: 3001, running: false, prefix: '/kk' }, '/kk/')).toBe(
            '/kk/board',
        );
        expect(directBoardUrl({ host: 'localhost', port: 0, running: false, prefix: '/kk' }, '/kk/')).toBe('/kk/board');
    });

    it('uses the absolute canonical gateway URL at the direct origin root', () => {
        expect(
            directBoardUrl(
                {
                    host: 'localhost',
                    port: 3001,
                    running: true,
                    prefix: '/kk',
                    url: 'http://localhost:3000/kk/board',
                },
                '/',
            ),
        ).toBe('http://localhost:3000/kk/board');
        expect(
            directBoardUrl(
                {
                    host: 'localhost',
                    port: 0,
                    running: false,
                    prefix: '/kk',
                    url: 'http://localhost:3000/kk/board',
                },
                '/',
            ),
        ).toBe('http://localhost:3000/kk/board');
    });

    it('sends a remote entry to its own host and port even behind the gateway', () => {
        expect(directBoardUrl({ host: '192.168.87.27', port: 3003, running: false, prefix: null }, '/kk/')).toBe(
            'http://192.168.87.27:3003/board',
        );
    });
});

describe('project identity and endpoint labels (1444 R8)', () => {
    it('distinguishes same-path entries by effective host', () => {
        expect(projectIdentity({ path: '/tmp/kk', host: 'localhost' })).not.toBe(
            projectIdentity({ path: '/tmp/kk', host: '192.168.87.27' }),
        );
        expect(projectIdentity({ path: '/tmp/kk', host: '127.0.0.1' })).toBe(
            projectIdentity({ path: '/tmp/kk', host: 'localhost' }),
        );
    });

    it('shows a local prefix rather than presenting its internal port as the destination', () => {
        expect(projectEndpointLabel({ prefix: '/kk', port: 3002 })).toBe('/kk');
        expect(projectEndpointLabel({ prefix: null, port: 3003 })).toBe(':3003');
    });
});

describe('registryFindingMessages (Q R6)', () => {
    it('renders every server-derived finding verbatim', () => {
        expect(
            registryFindingMessages([
                {
                    kind: 'prefix-collision',
                    prefix: '/b',
                    names: ['b', 'b'],
                    message: 'Prefix /b is claimed by "b" and "b"',
                },
                {
                    kind: 'duplicate-path',
                    path: '/tmp/kk',
                    names: ['kk', 'kk'],
                    message: 'Path /tmp/kk is registered 2 times',
                },
            ]),
        ).toEqual(['Prefix /b is claimed by "b" and "b"', 'Path /tmp/kk is registered 2 times']);
    });

    it('renders nothing for a clean registry or a malformed payload', () => {
        expect(registryFindingMessages([])).toEqual([]);
        expect(registryFindingMessages(undefined)).toEqual([]);
        expect(registryFindingMessages([{ kind: 'prefix-collision' }])).toEqual([]);
        expect(registryFindingMessages('nope')).toEqual([]);
    });
});

describe('ProjectSwitcher UI without start/stop logic', () => {
    it('renders local and remote entries as always-ready with endpoint labels, no stopped badges or status dots, and no remote health probes', async () => {
        const requestedUrls: string[] = [];
        const mockFetch: typeof fetch = Object.assign(
            async (input: string | URL | Request) => {
                const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
                requestedUrls.push(url);
                return new Response(
                    JSON.stringify({
                        projects: [
                            {
                                name: 'spur-new',
                                path: '/Users/robin/xprojects/spur-new',
                                host: 'localhost',
                                port: 3001,
                                running: true,
                                current: true,
                                prefix: '/spur-new',
                                url: '/spur-new/board',
                            },
                            {
                                name: 'alpha',
                                path: '/Users/robin/xprojects/alpha',
                                host: 'localhost',
                                port: 0,
                                running: false,
                                current: false,
                                prefix: '/alpha',
                                url: '/alpha/board',
                            },
                            {
                                name: 'knowledge-kit',
                                path: '/srv/kk',
                                host: '192.168.87.27',
                                port: 3003,
                                running: false,
                                current: false,
                                prefix: null,
                                url: 'http://192.168.87.27:3003/board',
                            },
                        ],
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            },
            { preconnect: () => {} },
        );
        setFetchForTesting(mockFetch);

        const view = render(createElement(ProjectSwitcher, { currentName: 'spur-new' }));
        fireEvent.click(view.getByTestId('project-switcher-trigger'));

        await waitFor(() => {
            expect(view.getByTestId('project-item-alpha')).toBeDefined();
        });

        // No browser-side remote /api/health probe is fired on menu open
        expect(requestedUrls).toEqual(['http://localhost:3000/api/projects']);

        const menu = view.getByTestId('project-switcher-menu');
        expect(menu.textContent).toContain('current');
        expect(menu.textContent).toContain('/alpha');
        expect(menu.textContent).toContain(':3003');
        expect(menu.textContent).not.toContain('stopped');
        expect(menu.textContent).not.toContain('Starting...');
        expect(menu.querySelector('[title="Stopped"]')).toBeNull();
    });
});
