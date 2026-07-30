registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import ProjectSwitcher from '../../src/components/ProjectSwitcher';
import { resetFetchForTesting, setFetchForTesting } from '../../src/lib/rpc-client';
import { registerHappyDom, teardownHappyDom } from '../happy-dom';

afterAll(async () => {
    resetFetchForTesting();
    await teardownHappyDom();
});

afterEach(() => {
    cleanup();
    resetFetchForTesting();
});

describe('ProjectSwitcher', () => {
    test('renders current project name and opens dropdown menu on click', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
            if (url.endsWith('/projects')) {
                return new Response(
                    JSON.stringify({
                        projects: [
                            { name: 'spur-new', path: '/path/spur-new', port: 3000, running: true, current: true },
                            { name: 'other-proj', path: '/path/other', port: 0, running: false, current: false },
                        ],
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            }
            return new Response(null, { status: 404 });
        }) as typeof fetch);

        const { getByTestId, getByText, queryByTestId } = render(<ProjectSwitcher currentName="spur-new" />);

        expect(getByText('spur-new')).toBeTruthy();
        expect(queryByTestId('project-switcher-menu')).toBeNull();

        fireEvent.click(getByTestId('project-switcher-trigger'));

        await waitFor(() => expect(getByTestId('project-switcher-menu')).toBeTruthy());
        expect(getByText('other-proj')).toBeTruthy();
        expect(getByText('current')).toBeTruthy();
    });

    test('handles project start when clicking a stopped project', async () => {
        let startCalled = false;
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
            if (url.endsWith('/projects')) {
                return new Response(
                    JSON.stringify({
                        projects: [
                            { name: 'spur-new', path: '/path/spur-new', port: 3000, running: true, current: true },
                            { name: 'other-proj', path: '/path/other', port: 0, running: false, current: false },
                        ],
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            }
            if (url.endsWith('/projects/start')) {
                startCalled = true;
                return new Response(
                    JSON.stringify({
                        name: 'other-proj',
                        path: '/path/other',
                        port: 3001,
                        running: true,
                        url: 'http://localhost:3001',
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            }
            return new Response(null, { status: 404 });
        }) as typeof fetch);

        const { getByTestId } = render(<ProjectSwitcher currentName="spur-new" />);

        fireEvent.click(getByTestId('project-switcher-trigger'));
        await waitFor(() => expect(getByTestId('project-item-other-proj')).toBeTruthy());

        fireEvent.click(getByTestId('project-item-other-proj'));
        await waitFor(() => expect(startCalled).toBe(true));
    });

    test('navigates to running project board URL when selecting a non-current running project', async () => {
        const originalLocation = window.location;
        const hrefSetter = { href: '' };
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: {
                ...originalLocation,
                set href(v: string) {
                    hrefSetter.href = v;
                },
                get href() {
                    return hrefSetter.href;
                },
            },
        });

        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
            if (url.endsWith('/projects')) {
                return new Response(
                    JSON.stringify({
                        projects: [
                            { name: 'spur-new', path: '/path/spur-new', port: 3000, running: true, current: true },
                            {
                                name: 'other-running',
                                path: '/path/other-running',
                                port: 5678,
                                running: true,
                                current: false,
                            },
                        ],
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            }
            return new Response(null, { status: 404 });
        }) as typeof fetch);

        try {
            const { getByTestId } = render(<ProjectSwitcher currentName="spur-new" />);
            fireEvent.click(getByTestId('project-switcher-trigger'));
            await waitFor(() => expect(getByTestId('project-item-other-running')).toBeTruthy());
            fireEvent.click(getByTestId('project-item-other-running'));
            expect(hrefSetter.href).toBe('http://localhost:5678/board');
        } finally {
            Object.defineProperty(window, 'location', {
                configurable: true,
                value: originalLocation,
            });
        }
    });

    test('shows running and stopped indicators in the dropdown', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
            if (url.endsWith('/projects')) {
                return new Response(
                    JSON.stringify({
                        projects: [
                            { name: 'spur-new', path: '/path/spur-new', port: 3000, running: true, current: true },
                            { name: 'ts-libs', path: '/path/ts-libs', port: 0, running: false, current: false },
                        ],
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            }
            return new Response(null, { status: 404 });
        }) as typeof fetch);

        const { getByTestId, getByTitle, getByText } = render(<ProjectSwitcher currentName="spur-new" />);
        fireEvent.click(getByTestId('project-switcher-trigger'));
        await waitFor(() => expect(getByTestId('project-switcher-menu')).toBeTruthy());

        expect(getByTitle('Running on port 3000')).toBeTruthy();
        expect(getByTitle('Stopped')).toBeTruthy();
        expect(getByText('stopped')).toBeTruthy();
    });

    test('closes the menu on Escape key', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
            if (url.endsWith('/projects')) {
                return new Response(
                    JSON.stringify({
                        projects: [
                            { name: 'spur-new', path: '/path/spur-new', port: 3000, running: true, current: true },
                        ],
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            }
            return new Response(null, { status: 404 });
        }) as typeof fetch);

        const { getByTestId, queryByTestId } = render(<ProjectSwitcher currentName="spur-new" />);
        fireEvent.click(getByTestId('project-switcher-trigger'));
        await waitFor(() => expect(getByTestId('project-switcher-menu')).toBeTruthy());

        fireEvent.keyDown(document, { key: 'Escape' });
        await waitFor(() => expect(queryByTestId('project-switcher-menu')).toBeNull());
    });
});
