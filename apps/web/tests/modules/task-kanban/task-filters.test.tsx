registerHappyDom();

import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import type { InputHTMLAttributes } from 'react';
import TaskFilters from '../../../src/modules/task-kanban/TaskFilters';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

// Mock `@/ui` so we can capture the onChange handler that TaskFilters wires to each Input,
// bypassing the happy-dom + React 19 incompatibility that prevents fireEvent.change from
// triggering React's onChange on text inputs (capricorn86/happy-dom#856).
type SyntheticFilterEvent = { currentTarget: { dataset: { key: string }; value: string } };
type CapturedInput = {
    label: string;
    dataKey: string | undefined;
    value: string;
    onChange: (e: SyntheticFilterEvent) => void;
};
const capturedInputs: CapturedInput[] = [];

mock.module('@/ui', () => ({
    Input: (props: InputHTMLAttributes<HTMLInputElement>) => {
        const ref = (e: HTMLInputElement | null) => {
            if (!e || !props.onChange) return;
            const label = e.getAttribute('aria-label') || '';
            if (capturedInputs.some((c) => c.label === label)) return;
            capturedInputs.push({
                label,
                dataKey: e.dataset.key || undefined,
                value: (props.value as string) ?? '',
                onChange: props.onChange as unknown as CapturedInput['onChange'],
            });
        };
        // defaultValue (not value) avoids React's controlled-without-onChange warning;
        // the real onChange lives on `props` and is captured above via the ref.
        return (
            <input
                ref={ref}
                aria-label={props['aria-label'] as string}
                data-key={props['data-key' as keyof InputHTMLAttributes<HTMLInputElement>] as string}
                defaultValue={props.value as string}
            />
        );
    },
}));

afterAll(teardownHappyDom);
afterEach(() => {
    capturedInputs.length = 0;
    cleanup();
});

const findByLabel = (label: string): CapturedInput => {
    const input = capturedInputs.find((c) => c.label === label);
    if (!input)
        throw new Error(
            `Expected captured input with label "${label}", got: ${capturedInputs.map((c) => c.label).join(', ')}`,
        );
    return input;
};

describe('TaskFilters', () => {
    test('renders feature/parent/assignee filter controls (R3 — no status dropdown)', () => {
        const changes: Array<{ key: string; value: string | null }> = [];
        const { queryByLabelText } = render(
            <TaskFilters
                filters={{ featureId: 'W3', parentWbs: '0001', assignee: 'robin' }}
                onChange={(key, value) => changes.push({ key, value })}
            />,
        );
        // R3: status <select> removed — no control labeled "Filter by status".
        expect(queryByLabelText('Filter by status')).toBeNull();

        // Each input is rendered with its bound filter value and data-key.
        const feature = capturedInputs.find((c) => c.label === 'Filter by feature');
        const parent = capturedInputs.find((c) => c.label === 'Filter by parent WBS');
        const assignee = capturedInputs.find((c) => c.label === 'Filter by assignee');
        expect(feature?.value).toBe('W3');
        expect(parent?.value).toBe('0001');
        expect(assignee?.value).toBe('robin');
    });

    test('change handler maps data-key + value onto onChange prop', () => {
        const changes: Array<{ key: string; value: string | null }> = [];
        render(
            <TaskFilters
                filters={{ featureId: 'W3', parentWbs: '0001', assignee: 'robin' }}
                onChange={(key, value) => changes.push({ key, value })}
            />,
        );

        findByLabel('Filter by feature').onChange({ currentTarget: { dataset: { key: 'feature' }, value: 'W4' } });
        findByLabel('Filter by parent WBS').onChange({ currentTarget: { dataset: { key: 'parent' }, value: '0002' } });
        findByLabel('Filter by assignee').onChange({ currentTarget: { dataset: { key: 'assignee' }, value: 'codex' } });

        expect(changes).toContainEqual({ key: 'feature', value: 'W4' });
        expect(changes).toContainEqual({ key: 'parent', value: '0002' });
        expect(changes).toContainEqual({ key: 'assignee', value: 'codex' });
    });

    test('change handler emits null for empty values', () => {
        const changes: Array<{ key: string; value: string | null }> = [];
        render(
            <TaskFilters
                filters={{ featureId: '', parentWbs: '', assignee: '' }}
                onChange={(key, value) => changes.push({ key, value })}
            />,
        );
        const feature = findByLabel('Filter by feature');
        feature.onChange({ currentTarget: { dataset: { key: 'feature' }, value: '' } });
        expect(changes).toContainEqual({ key: 'feature', value: null });
    });
});
