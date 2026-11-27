/**
 * 1472 R2 (feature E11) — the history Board knows dsh as a source: the filter offers it with a
 * monogram icon, and an unknown id still falls back to the colour dot.
 *
 * The failure modes: the option missing from the source filter (dsh filters undisplayable), the id
 * absent from `AGENT_ICON_IDS` so the filter renders a generic dot, and an unknown id crashing the
 * icon instead of returning nothing.
 */
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { AgentIcon } from '../../../src/modules/history/AgentIcon';
import HistoryFilters from '../../../src/modules/history/HistoryFilters';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

registerHappyDom();
afterAll(teardownHappyDom);
afterEach(cleanup);

describe('1472 R2 — dsh in the history source filter and icon set', () => {
    test('the source filter offers dsh with its monogram icon when opened', async () => {
        const { fireEvent, act } = await import('@testing-library/react');
        const view = render(
            createElement(HistoryFilters, {
                filter: { range: '24h' },
                onChange: () => {},
                sourceOptions: [
                    { id: 'claude', label: 'Claude Code', color: '#3987e5' },
                    { id: 'deepseek', label: 'DeepSeek dsh', color: '#65a30d' },
                ],
            }),
        );
        const trigger = [...view.container.querySelectorAll('button')].find((button) =>
            (button.textContent ?? '').startsWith('Agents'),
        );
        expect(trigger).toBeDefined();
        await act(async () => {
            fireEvent.click(trigger as HTMLButtonElement);
        });
        const text = view.container.textContent ?? '';
        expect(text).toContain('DeepSeek dsh');
        // The icon set recognises the id, so the option renders the dsh monogram rather than a dot.
        const titles = [...view.container.querySelectorAll('svg title')].map((title) => title.textContent ?? '');
        expect(titles).toContain('DeepSeek dsh icon');
    });

    test('AgentIcon renders a dsh monogram with an accessible name', () => {
        const view = render(createElement(AgentIcon, { id: 'deepseek' }));
        const svg = view.container.querySelector('svg');
        expect(svg).not.toBeNull();
        expect(view.container.textContent).toContain('DeepSeek dsh icon');
    });

    test('an unknown id still renders nothing (the existing fallback path)', () => {
        const view = render(createElement(AgentIcon, { id: 'not-an-agent' }));
        expect(view.container.querySelector('svg')).toBeNull();
    });
});
