import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import type { TaskSummary } from '../../../src/modules/task-kanban/types';

// ── Mock @uiw/react-md-editor: the real MDEditor's internal event system does
//    not fire onChange under happy-dom + React 19. The mock exposes its onChange
//    callback via a module-level ref so tests can call it directly (wrapped in
//    act()) instead of simulating textarea events that React won't process. ────
let editorOnChange: ((val?: string) => void) | null = null;

interface MockEditorProps {
    value?: string;
    onChange?: (val?: string) => void;
    height?: number;
}

const MockMDEditor = Object.assign(
    function MockEditor({ value, onChange }: MockEditorProps) {
        editorOnChange = onChange ?? null;
        return <textarea value={value} readOnly aria-label="markdown editor" />;
    } as ComponentType<MockEditorProps>,
    {
        Markdown: function MockMarkdown({ source }: { source?: string }) {
            return <div>{source}</div>;
        },
    },
);

mock.module('@uiw/react-md-editor', () => ({ default: MockMDEditor }));

// ── api stub: TaskDetail imports `{ api }` from lib/rpc-client for show + body. ──
const showCalls: string[] = [];
const bodyCalls: Array<{ wbs: string; body: string }> = [];

const DEFAULT_SHOW_DATA = {
    wbs: '0001',
    name: 'Test',
    status: 'todo',
    frontmatter: {},
    content: '## Original body',
    filePath: 'a.md',
};

let showImpl: () => Promise<unknown> = async () => ({ data: { ...DEFAULT_SHOW_DATA } });
let bodyImpl: () => Promise<unknown> = async () => ({ data: { wbs: '0001', filePath: 'a.md' } });

mock.module('../../../src/lib/rpc-client', () => ({
    api: {
        task: {
            show: (input: { wbs: string }) => {
                showCalls.push(input.wbs);
                return showImpl();
            },
            body: (input: { wbs: string; body: string }) => {
                bodyCalls.push(input);
                return bodyImpl();
            },
        },
    },
}));

import TaskDetail from '../../../src/modules/task-kanban/TaskDetail';

afterAll(async () => {
    await GlobalRegistrator.unregister();
});

afterEach(() => {
    cleanup();
    showCalls.length = 0;
    bodyCalls.length = 0;
    editorOnChange = null;
    showImpl = async () => ({ data: { ...DEFAULT_SHOW_DATA } });
    bodyImpl = async () => ({ data: { wbs: '0001', filePath: 'a.md' } });
});

const task: TaskSummary = {
    wbs: '0001',
    name: 'Build the board',
    status: 'todo',
    priority: 'P1',
    featureId: 'W3',
    filePath: 'docs/tasks/0001.md',
};

function renderDetail() {
    return render(<TaskDetail task={task} onTransition={() => {}} />);
}

/** Set the editor draft by calling the mock's onChange callback, wrapped in act(). */
function setDraft(value: string): void {
    act(() => {
        editorOnChange?.(value);
    });
}

describe('TaskDetail — body rendering and inline editing', () => {
    test('R1 — renders the task body in preview mode after fetch', async () => {
        const { getByText, getByTestId } = renderDetail();

        await waitFor(() => expect(getByText('## Original body')).toBeDefined());
        expect(getByTestId('body-preview')).toBeDefined();
    });

    test('R2 — Save calls the body API with the edited content', async () => {
        const { getByText, getByLabelText } = renderDetail();
        await waitFor(() => expect(getByText('## Original body')).toBeDefined());

        fireEvent.click(getByLabelText('Edit body'));
        setDraft('## Updated body');

        fireEvent.click(getByLabelText('Save body'));

        await waitFor(() => expect(bodyCalls).toEqual([{ wbs: '0001', body: '## Updated body' }]));
    });

    test('R2b — Cancel discards local edits and restores the last-fetched body', async () => {
        const { getByText, getByLabelText, getByTestId } = renderDetail();
        await waitFor(() => expect(getByText('## Original body')).toBeDefined());

        fireEvent.click(getByLabelText('Edit body'));
        setDraft('## Discarded edit');

        fireEvent.click(getByLabelText('Cancel edit'));

        await waitFor(() => expect(getByTestId('body-preview')).toBeDefined());
        expect(getByText('## Original body')).toBeDefined();
        expect(bodyCalls).toHaveLength(0);
    });

    test('R3 — a server denial reverts to server state and surfaces an api-error event', async () => {
        bodyImpl = async () => {
            throw new Error('409 lock denied');
        };

        const errorEvents: string[] = [];
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { message: string };
            errorEvents.push(detail.message);
        };
        window.addEventListener('api-error', handler);

        const { getByText, getByLabelText, getByTestId } = renderDetail();
        await waitFor(() => expect(getByText('## Original body')).toBeDefined());

        fireEvent.click(getByLabelText('Edit body'));
        setDraft('## Changed');
        fireEvent.click(getByLabelText('Save body'));

        await waitFor(() => expect(getByTestId('body-preview')).toBeDefined());
        expect(getByText('## Original body')).toBeDefined();
        expect(errorEvents).toContain('409 lock denied');

        window.removeEventListener('api-error', handler);
    });

    test('R4 — an open editor is not clobbered by a poll-induced re-render', async () => {
        const { getByText, getByLabelText, getByTestId, rerender } = renderDetail();
        await waitFor(() => expect(getByText('## Original body')).toBeDefined());

        fireEvent.click(getByLabelText('Edit body'));
        setDraft('## Editing in progress');

        // Simulate a poll: re-render with a new task object reference (same wbs).
        const polledTask: TaskSummary = { ...task, name: 'Build the board (polled)' };
        rerender(<TaskDetail task={polledTask} onTransition={() => {}} />);

        // The editor should still be open with the draft content — not clobbered.
        expect(getByTestId('body-editor')).toBeDefined();
        const textarea = getByTestId('body-editor').querySelector('textarea') as HTMLTextAreaElement;
        expect(textarea.value).toBe('## Editing in progress');
        // No extra show fetch fired (wbs is unchanged).
        expect(showCalls).toHaveLength(1);
    });

    test('R5 — empty body save is allowed and round-trips', async () => {
        showImpl = async () => ({
            data: { wbs: '0001', name: 'Test', status: 'todo', frontmatter: {}, content: '', filePath: 'a.md' },
        });

        const { getByLabelText, getByTestId } = renderDetail();
        await waitFor(() => expect(getByTestId('body-preview')).toBeDefined());

        fireEvent.click(getByLabelText('Edit body'));
        setDraft('');

        fireEvent.click(getByLabelText('Save body'));

        await waitFor(() => expect(bodyCalls).toEqual([{ wbs: '0001', body: '' }]));
        await waitFor(() => expect(getByTestId('body-preview')).toBeDefined());
    });
});
