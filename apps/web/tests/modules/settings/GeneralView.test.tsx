registerHappyDom();

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ConfigFilesResponse } from '@gobing-ai/spur-contracts';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import GeneralView from '../../../src/modules/settings/GeneralView';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

afterAll(teardownHappyDom);

afterEach(() => {
    cleanup();
    resetFetchForTesting();
});

const MOCK_CONFIGS: ConfigFilesResponse = {
    global: {
        path: '/Users/robin/.config/spur/config.yaml',
        displayPath: '~/.config/spur/config.yaml',
        exists: true,
        content: '# Global Config\nversion: "1.2"\nagent:\n  executors: []\n',
        sizeBytes: 1024,
        updatedAt: '2026-09-22T08:00:00.000Z',
    },
    project: {
        path: '/Users/robin/xprojects/spur-new/.spur/config.yaml',
        displayPath: '.spur/config.yaml',
        exists: true,
        content: '# Project Config\nname: spur-new\nversion: "1.2"\n',
        sizeBytes: 512,
        updatedAt: '2026-09-22T09:00:00.000Z',
    },
};

describe('GeneralView', () => {
    beforeEach(() => {
        setFetchForTesting(((input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            if (url.includes('/project/configs')) {
                return Promise.resolve(new Response(JSON.stringify(MOCK_CONFIGS), { status: 200 }));
            }
            return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
        }) as unknown as typeof fetch);
    });

    test('renders subtabs for global and project configs', async () => {
        const { container } = render(<GeneralView />);
        const subtabs = container.querySelector('[data-config-subtabs]');
        expect(subtabs).not.toBeNull();

        const globalTab = container.querySelector('[data-subtab="global"]');
        const projectTab = container.querySelector('[data-subtab="project"]');
        expect(globalTab).not.toBeNull();
        expect(projectTab).not.toBeNull();
    });

    test('displays global config by default and switches to project config on click', async () => {
        const { container } = render(<GeneralView />);

        await waitFor(() => {
            expect(container.querySelector('[data-yaml-viewer]')).not.toBeNull();
        });

        // Global config should be active initially
        expect(container.textContent).toContain('~/.config/spur/config.yaml');
        expect(container.textContent).toContain('Global Config');
        expect(container.textContent).toContain('1.0 KB');
        expect(container.querySelector('[data-status-badge]')?.textContent).toContain('Found');

        // Switch to Project Config
        const projectTab = container.querySelector('[data-subtab="project"]') as HTMLButtonElement;
        fireEvent.click(projectTab);

        await waitFor(() => {
            expect(container.textContent).toContain('.spur/config.yaml');
        });
        expect(container.textContent).toContain('Project Config');
        expect(container.textContent).toContain('name: spur-new');
        expect(container.textContent).toContain('512 B');
    });

    test('renders missing file card when config file does not exist', async () => {
        setFetchForTesting((() => {
            const missingData: ConfigFilesResponse = {
                ...MOCK_CONFIGS,
                global: {
                    ...MOCK_CONFIGS.global,
                    exists: false,
                    content: '',
                    sizeBytes: 0,
                },
            };
            return Promise.resolve(new Response(JSON.stringify(missingData), { status: 200 }));
        }) as unknown as typeof fetch);

        const { container } = render(<GeneralView />);

        await waitFor(() => {
            expect(container.querySelector('[data-missing-file-card]')).not.toBeNull();
        });

        expect(container.textContent).toContain('Configuration File Not Found');
        expect(container.querySelector('[data-status-badge]')?.textContent).toContain('Not Created');
    });

    test('handles fetch error and allows retry', async () => {
        let calls = 0;
        setFetchForTesting((() => {
            calls++;
            if (calls === 1) {
                return Promise.resolve(new Response('Server Error', { status: 500 }));
            }
            return Promise.resolve(new Response(JSON.stringify(MOCK_CONFIGS), { status: 200 }));
        }) as unknown as typeof fetch);

        const { container } = render(<GeneralView />);

        await waitFor(() => {
            expect(container.querySelector('[data-error-banner]')).not.toBeNull();
        });
        expect(container.textContent).toContain('Failed to load configuration files (500)');

        // Click retry
        const retryBtn = container.querySelector('[data-error-banner] button') as HTMLButtonElement;
        fireEvent.click(retryBtn);

        await waitFor(() => {
            expect(container.querySelector('[data-yaml-viewer]')).not.toBeNull();
        });
    });
});
