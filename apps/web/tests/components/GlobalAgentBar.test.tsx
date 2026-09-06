registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import BoardLayout from '../../src/components/BoardLayout';
import GlobalAgentBar from '../../src/components/GlobalAgentBar';
import { resetFetchForTesting, setFetchForTesting } from '../../src/lib/rpc-client';
import type { WebModule } from '../../src/modules/types';
import { registerHappyDom, teardownHappyDom } from '../happy-dom';

afterAll(async () => {
    resetFetchForTesting();
    await teardownHappyDom();
});

afterEach(() => {
    cleanup();
    resetFetchForTesting();
});

function setPromptValue(textarea: Element, value: string): void {
    const holder = textarea as unknown as Record<string, Record<string, unknown> | undefined>;
    const key = Object.keys(holder).find((k) => k.startsWith('__reactProps$'));
    const props = key ? holder[key] : undefined;
    const onChange = props?.onChange as ((e: { target: { value: string } }) => void) | undefined;
    if (!onChange) throw new Error('onChange not found on agent-bar-input');
    act(() => onChange({ target: { value } }));
}

describe('GlobalAgentBar', () => {
    test('folded by default as a spirit dock, opens to wider 84rem glass bar, and collapses back', () => {
        const { getByTestId, getByLabelText, queryByTestId } = render(<GlobalAgentBar />);
        // Starts folded
        expect(queryByTestId('agent-bar')).toBeNull();
        const dock = getByTestId('agent-bar-dock');
        expect(dock.className).toContain('fixed');
        expect(dock.className).toContain('bottom-6');
        expect(dock.className).toContain('right-6');
        expect(dock.className).toContain('z-30');

        // Click to open
        fireEvent.click(dock);
        const bar = getByTestId('agent-bar');
        expect(bar.className).toContain('fixed');
        expect(bar.className).toContain('backdrop-blur-md');
        expect(bar.className).toContain('bg-base-100/80');
        expect(bar.className).toContain('w-[calc(100vw-2rem)]');
        expect(bar.className).toContain('max-w-[84rem]');
        expect(bar.className).toContain('z-30');

        // Collapse back
        fireEvent.click(getByLabelText('Collapse agent prompt bar'));
        expect(queryByTestId('agent-bar')).toBeNull();
        expect(getByTestId('agent-bar-dock')).toBeDefined();
    });

    test('Send is disabled while the prompt is empty, enabled once text is entered', () => {
        const { getByTestId, getByText } = render(<GlobalAgentBar />);
        fireEvent.click(getByTestId('agent-bar-dock'));
        const send = getByText('Send') as HTMLButtonElement;
        expect(send.disabled).toBe(true);
        setPromptValue(getByTestId('agent-bar-input'), 'refine this feature');
        expect((send as HTMLButtonElement).disabled).toBe(false);
    });

    test('submitting clears the field and surfaces the stub notice', () => {
        const { getByTestId, getByText, getByRole } = render(<GlobalAgentBar />);
        fireEvent.click(getByTestId('agent-bar-dock'));
        const input = getByTestId('agent-bar-input') as HTMLTextAreaElement;
        setPromptValue(input, 'implement F84');
        fireEvent.click(getByText('Send'));
        expect(input.value).toBe('');
        expect(getByRole('status').textContent).toContain('Agent dispatch is not wired yet');
    });

    test('BoardLayout renders the global agent bar dock', () => {
        setFetchForTesting((async () => new Response('{}', { status: 200 })) as unknown as typeof fetch);
        const { getByTestId } = render(
            <MemoryRouter initialEntries={['/board/tasks']}>
                <BoardLayout />
            </MemoryRouter>,
        );
        expect(getByTestId('agent-bar-dock')).toBeDefined();
    });
});

describe('GlobalAgentBar context, chips, and execution drawer', () => {
    test('renders context badge matching active module label and falls back to Board', () => {
        const mockModule: WebModule = {
            id: 'features',
            name: 'Features',
            sidebarLabel: 'Features',
            route: 'features',
            icon: '🗺️',
            component: () => null,
        };

        const { getByTestId, rerender } = render(<GlobalAgentBar activeModule={mockModule} />);
        fireEvent.click(getByTestId('agent-bar-dock'));
        expect(getByTestId('agent-bar-context').textContent).toBe('Context: Features');

        // Without active module, falls back to Board
        rerender(<GlobalAgentBar activeModule={undefined} />);
        expect(getByTestId('agent-bar-context').textContent).toBe('Context: Board');
    });

    test('renders task-route chip set and clicking a chip populates the prompt input', () => {
        const tasksModule: WebModule = {
            id: 'tasks',
            name: 'Tasks',
            sidebarLabel: 'Tasks',
            route: 'tasks',
            icon: '📋',
            component: () => null,
        };

        const { getByTestId, getByText } = render(<GlobalAgentBar activeModule={tasksModule} />);
        fireEvent.click(getByTestId('agent-bar-dock'));

        const chips = getByTestId('agent-bar-chips');
        expect(chips).toBeDefined();
        expect(chips.textContent).toContain('Run task');
        expect(chips.textContent).toContain('Check readiness');
        expect(chips.textContent).toContain('Refine requirements');

        const input = getByTestId('agent-bar-input') as HTMLTextAreaElement;
        expect(input.value).toBe('');

        fireEvent.click(getByText('Run task'));
        expect(input.value).toBe('Run task');
    });

    test('renders no chip set when module has no quick actions or is undefined', () => {
        const workspaceModule: WebModule = {
            id: 'workspace',
            name: 'Workspace',
            sidebarLabel: 'Workspace',
            route: 'workspace',
            icon: '📂',
            component: () => null,
        };

        const { getByTestId, queryByTestId, rerender } = render(<GlobalAgentBar activeModule={workspaceModule} />);
        fireEvent.click(getByTestId('agent-bar-dock'));
        expect(queryByTestId('agent-bar-chips')).toBeNull();

        rerender(<GlobalAgentBar activeModule={undefined} />);
        expect(queryByTestId('agent-bar-chips')).toBeNull();
    });

    test('toggling execution drawer displays not-wired-yet notice and closes back', () => {
        const { getByTestId, queryByTestId } = render(<GlobalAgentBar />);
        fireEvent.click(getByTestId('agent-bar-dock'));

        // Drawer closed initially
        expect(queryByTestId('agent-bar-drawer')).toBeNull();

        // Toggle open
        fireEvent.click(getByTestId('agent-bar-drawer-toggle'));
        const drawer = getByTestId('agent-bar-drawer');
        expect(drawer).toBeDefined();
        expect(drawer.textContent).toContain('Streamed telemetry and tool calls are not wired yet');

        // Toggle closed
        fireEvent.click(getByTestId('agent-bar-drawer-toggle'));
        expect(queryByTestId('agent-bar-drawer')).toBeNull();
    });
});
