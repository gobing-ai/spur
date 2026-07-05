import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { render } from '@testing-library/react';
import type { FeatureSummary } from '../../../src/lib/feature-types';
import { isWebModule } from '../../../src/modules/discover';
import FeatureTree from '../../../src/modules/features/FeatureTree';
import { module } from '../../../src/modules/features/index';
import { teardownHappyDom } from '../../happy-dom';

beforeAll(() => {
    GlobalRegistrator.register();
});

afterAll(async () => {
    await teardownHappyDom();
});

// ── Module discovery (R6) ──

test('features module is a valid WebModule (auto-discoverable)', () => {
    expect(isWebModule(module)).toBe(true);
    expect(module.id).toBe('features');
    expect(module.name).toBe('Feature Board');
    expect(module.route).toBe('features');
});

// ── FeatureTree (R2) ──

describe('FeatureTree', () => {
    test('renders without crashing (empty list)', () => {
        const { container } = render(<FeatureTree features={[]} selectedId={null} onSelect={() => {}} />);
        expect(container.querySelector('[data-feature-tree]')).not.toBeNull();
    });

    test('renders feature ids, names, and status badges from flat list', () => {
        // Root features have 1-char ids. Children have longer ids (F → F1 → F1A).
        const features: FeatureSummary[] = [
            { id: 'F', name: 'Root', status: 'active' },
            { id: 'F1', name: 'Child', status: 'done' },
        ];
        const { container } = render(<FeatureTree features={features} selectedId={null} onSelect={() => {}} />);
        const html = container.innerHTML;
        expect(html).toContain('F');
        expect(html).toContain('F1');
        expect(html).toContain('Root');
        expect(html).toContain('Child');
        expect(html).toContain('active');
        expect(html).toContain('done');
        const buttons = container.querySelectorAll('button');
        expect(buttons.length).toBe(2);
    });

    test('selectedId applies accent to the selected node', () => {
        const features: FeatureSummary[] = [
            { id: 'F', name: 'Alpha', status: 'active' },
            { id: 'G', name: 'Beta', status: 'active' },
        ];
        render(<FeatureTree features={features} selectedId="F" onSelect={() => {}} />);
        // The selected node's button has the accent class in its class attribute.
        const buttons = document.querySelectorAll('button');
        const alphaBtn = Array.from(buttons).find((b) => b.getAttribute('class')?.includes('bg-spur-accent'));
        expect(alphaBtn).toBeDefined();
        // One button — the selected one — has the accent class.
        const accentButtons = Array.from(buttons).filter((b) => b.getAttribute('class')?.includes('bg-spur-accent'));
        expect(accentButtons.length).toBe(1);
    });
});
