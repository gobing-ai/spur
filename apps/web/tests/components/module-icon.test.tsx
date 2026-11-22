/**
 * A83 1428 — built-in module icons resolve by id, and downstream declarations keep working.
 *
 * The failure modes: a built-in without a declared emoji falling back to a generic vector, `search`
 * resolving to an emoji, a downstream `📡` losing its vector, a downstream custom glyph being
 * rewritten, and a screen reader announcing a glyph instead of a name.
 */
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import ModuleIcon from '../../src/components/ModuleIcon';
import { isWebModule } from '../../src/modules/discover';
import { module as observability } from '../../src/modules/observability';
import { registerHappyDom, teardownHappyDom } from '../happy-dom';

registerHappyDom();
afterAll(teardownHappyDom);
afterEach(cleanup);

const BUILTIN_IDS = [
    'designs',
    'features',
    'history',
    'observability',
    'plans',
    'projects',
    'search',
    'settings',
    'tasks',
];

describe('1428 R3/R4 — built-in ids resolve to vector icons with a name', () => {
    for (const id of BUILTIN_IDS) {
        test(`${id} renders an svg and no glyph text`, () => {
            const view = render(createElement(ModuleIcon, { id, size: 'lg' }));
            expect(view.container.querySelector('svg')).not.toBeNull();
            // No emoji in the visible text, and the sr-only label is a NAME.
            const text = view.container.textContent ?? '';
            expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)).toBe(false);
            expect(text.length).toBeGreaterThan(0);
        });
    }

    test('search has its own icon rather than the shared fallback', () => {
        const search = render(createElement(ModuleIcon, { id: 'search' }));
        const searchSvg = search.container.querySelector('svg')?.innerHTML ?? '';
        cleanup();
        const unknown = render(createElement(ModuleIcon, { id: 'not-a-module' }));
        const unknownSvg = unknown.container.querySelector('svg')?.innerHTML ?? '';
        expect(searchSvg).not.toBe(unknownSvg);
    });

    test('a built-in descriptor no longer declares an emoji', () => {
        expect(isWebModule(observability)).toBe(true);
        expect(observability.icon).toBeUndefined();
    });
});

describe('1428 R5 — downstream declarations keep working', () => {
    test('a legacy emoji still renders its vector icon', () => {
        const view = render(createElement(ModuleIcon, { id: 'downstream-thing', icon: '📡', size: 'lg' }));
        expect(view.container.querySelector('svg')).not.toBeNull();
        // The label comes from the entry the emoji aliases, not from the glyph.
        expect(view.container.textContent).toBe('Observability');
    });

    test('an unknown glyph renders verbatim, never rewritten', () => {
        const view = render(createElement(ModuleIcon, { id: 'downstream-thing', icon: '🦊' }));
        expect(view.container.querySelector('svg')).toBeNull();
        expect(view.container.textContent).toBe('🦊');
    });

    test('an id with no entry and no icon falls back to a vector', () => {
        const view = render(createElement(ModuleIcon, { id: 'elsewhere' }));
        expect(view.container.querySelector('svg')).not.toBeNull();
    });
});
