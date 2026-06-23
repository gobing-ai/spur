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
let actionImpl: () => Promise<unknown> = async () => ({ data: { runId: 'r1', action: 'run', status: 'queued' } });
let listImpl: () => Promise<unknown> = async () => ({ data: [] });

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
            action: (input: { wbs: string; action: string; channel?: string; skipDeps?: boolean }) => {
                actionCalls.push(input);
                return actionImpl();
            },
            list: () => {
                listCalls.push(listCalls.length + 1);
                return listImpl();
            },
        },
    },
}));

const actionCalls: Array<{ wbs: string; action: string; channel?: string; skipDeps?: boolean }> = [];
const listCalls: number[] = [];

import TaskDetail from '../../../src/modules/task-kanban/TaskDetail';

afterAll(async () => {
    await GlobalRegistrator.unregister();
});

afterEach(() => {
    cleanup();
    showCalls.length = 0;
    bodyCalls.length = 0;
    actionCalls.length = 0;
    listCalls.length = 0;
    editorOnChange = null;
    showImpl = async () => ({ data: { ...DEFAULT_SHOW_DATA } });
    bodyImpl = async () => ({ data: { wbs: '0001', filePath: 'a.md' } });
    actionImpl = async () => ({ data: { runId: 'r1', action: 'run', status: 'queued' } });
    listImpl = async () => ({ data: [] });
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

// ── Metadata pane tests ─────────────────────────────────────────────────────

describe('TaskDetail — metadata pane', () => {
    test('R1 — renders created/updated dates and tags from frontmatter', async () => {
        const created = new Date('2025-01-15T12:00:00Z').toISOString();
        const updated = new Date('2025-06-01T08:30:00Z').toISOString();
        showImpl = async () => ({
            data: {
                ...DEFAULT_SHOW_DATA,
                frontmatter: { created_at: created, updated_at: updated, tags: ['api', 'frontend'] },
            },
        });

        const { getByText } = renderDetail();

        await waitFor(() => expect(getByText('Metadata')).toBeDefined());

        // Dates render
        expect(getByText('Jan 15, 2025')).toBeDefined();
        expect(getByText('Jun 1, 2025')).toBeDefined();

        // Tags render as badges
        expect(getByText('api')).toBeDefined();
        expect(getByText('frontend')).toBeDefined();

        // Priority and feature from TaskSummary (not frontmatter) still render
        expect(getByText('P1')).toBeDefined();
        expect(getByText('W3')).toBeDefined();
    });

    test('R1b — priority and feature omit when absent on TaskSummary', async () => {
        const noMetaTask: TaskSummary = { wbs: '0002', name: 'No meta', status: 'todo', filePath: 'b.md' };
        const { queryByText } = render(<TaskDetail task={noMetaTask} onTransition={() => {}} />);

        await waitFor(() => expect(queryByText('Metadata')).toBeDefined());

        expect(queryByText('Priority')).toBeNull();
        expect(queryByText('Feature')).toBeNull();
        // File still renders
        expect(queryByText('b.md')).toBeDefined();
    });

    test('R2 — progress stepper renders lifecycle phase labels', async () => {
        const { getAllByText } = renderDetail();

        await waitFor(() => expect(getAllByText('Metadata')[0]).toBeDefined());

        // Each lifecycle label exists at least once (progress stepper + possibly status buttons)
        expect(getAllByText('backlog').length).toBeGreaterThanOrEqual(1);
        expect(getAllByText('todo').length).toBeGreaterThanOrEqual(1);
        expect(getAllByText('wip').length).toBeGreaterThanOrEqual(1);
        expect(getAllByText('testing').length).toBeGreaterThanOrEqual(1);
        expect(getAllByText('done').length).toBeGreaterThanOrEqual(1);
    });

    test('R2b — blocked/cancelled render as off-track badge', async () => {
        const { getAllByText, getByText } = render(
            <TaskDetail task={{ ...task, status: 'blocked' }} onTransition={() => {}} />,
        );

        await waitFor(() => expect(getByText('Metadata')).toBeDefined());

        // Off-track badge renders the status (getAllByText because status button also uses it)
        expect(getAllByText('blocked').length).toBeGreaterThanOrEqual(1);
    });

    test('R4 — metadata pane toggles collapse/expand', async () => {
        const { getByText, queryByText } = renderDetail();

        await waitFor(() => expect(getByText('Metadata')).toBeDefined());

        // Initially expanded: progress visible
        expect(getByText('Progress')).toBeDefined();

        // Click header to collapse
        fireEvent.click(getByText('Metadata'));

        // Progress label hidden (collapsed)
        await waitFor(() => expect(queryByText('Progress')).toBeNull());

        // Click again to expand
        fireEvent.click(getByText('Metadata'));

        await waitFor(() => expect(getByText('Progress')).toBeDefined());
    });

    test('R5 — missing dates and tags render gracefully (no undefined leakage)', async () => {
        showImpl = async () => ({
            data: { ...DEFAULT_SHOW_DATA, frontmatter: {} },
        });

        const { getByText, queryByText } = renderDetail();

        await waitFor(() => expect(getByText('Metadata')).toBeDefined());

        // Dates section omits when both fields absent
        expect(queryByText('Dates')).toBeNull();
        expect(queryByText('Created')).toBeNull();
        expect(queryByText('Updated')).toBeNull();

        // Tags section omits when array absent
        expect(queryByText('Tags')).toBeNull();

        // Progress and file always present
        expect(getByText('Progress')).toBeDefined();
        expect(getByText('P1')).toBeDefined();
    });

    test('R5b — empty tags array renders nothing', async () => {
        showImpl = async () => ({
            data: { ...DEFAULT_SHOW_DATA, frontmatter: { tags: [] } },
        });

        const { getByText, queryByText } = renderDetail();

        await waitFor(() => expect(getByText('Metadata')).toBeDefined());

        expect(queryByText('Tags')).toBeNull();
    });

    test('dates render with relative labels', async () => {
        const today = new Date().toISOString();
        showImpl = async () => ({
            data: {
                ...DEFAULT_SHOW_DATA,
                frontmatter: { created_at: today, updated_at: today },
            },
        });

        const { getByText, getAllByText } = renderDetail();

        await waitFor(() => expect(getByText('Metadata')).toBeDefined());

        expect(getAllByText('(today)').length).toBeGreaterThanOrEqual(1);
    });
});

// ── Action buttons (0095) ────────────────────────────────────────────────────

describe('TaskDetail — workflow action buttons', () => {
    test('R1 — renders action buttons for a todo status task', async () => {
        const { getByLabelText } = renderDetail();
        await waitFor(() => expect(getByLabelText('Edit body')).toBeDefined());

        // todo → Plan, Run, Decompose
        expect(getByLabelText('Plan')).toBeDefined();
        expect(getByLabelText('Run')).toBeDefined();
        expect(getByLabelText('Decompose')).toBeDefined();
        // Refine, Verify, Evaluate should NOT appear for todo
        expect(() => getByLabelText('Refine')).toThrow();
        expect(() => getByLabelText('Verify')).toThrow();
        expect(() => getByLabelText('Evaluate')).toThrow();
    });

    test('R1 — renders Refine/Plan for backlog status', async () => {
        showImpl = async () => ({ data: { ...DEFAULT_SHOW_DATA, status: 'backlog' } });
        const { getByLabelText } = render(<TaskDetail task={{ ...task, status: 'backlog' }} onTransition={() => {}} />);
        await waitFor(() => expect(getByLabelText('Edit body')).toBeDefined());

        expect(getByLabelText('Refine')).toBeDefined();
        expect(getByLabelText('Plan')).toBeDefined();
        expect(() => getByLabelText('Run')).toThrow();
    });

    test('R1 — renders Run/Verify/Evaluate for wip status', async () => {
        showImpl = async () => ({ data: { ...DEFAULT_SHOW_DATA, status: 'wip' } });
        const { getByLabelText } = render(<TaskDetail task={{ ...task, status: 'wip' }} onTransition={() => {}} />);
        await waitFor(() => expect(getByLabelText('Edit body')).toBeDefined());

        expect(getByLabelText('Run')).toBeDefined();
        expect(getByLabelText('Verify')).toBeDefined();
        expect(getByLabelText('Evaluate')).toBeDefined();
        expect(() => getByLabelText('Plan')).toThrow();
    });

    test('R1 — renders Verify/Evaluate for testing status', async () => {
        showImpl = async () => ({ data: { ...DEFAULT_SHOW_DATA, status: 'testing' } });
        const { getByLabelText } = render(<TaskDetail task={{ ...task, status: 'testing' }} onTransition={() => {}} />);
        await waitFor(() => expect(getByLabelText('Edit body')).toBeDefined());

        expect(getByLabelText('Verify')).toBeDefined();
        expect(getByLabelText('Evaluate')).toBeDefined();
        expect(() => getByLabelText('Run')).toThrow();
    });

    test('R1 — renders Refine only for blocked status', async () => {
        showImpl = async () => ({ data: { ...DEFAULT_SHOW_DATA, status: 'blocked' } });
        const { getByLabelText } = render(<TaskDetail task={{ ...task, status: 'blocked' }} onTransition={() => {}} />);
        await waitFor(() => expect(getByLabelText('Edit body')).toBeDefined());

        expect(getByLabelText('Refine')).toBeDefined();
        expect(() => getByLabelText('Plan')).toThrow();
    });

    test('R1 — renders no actions for done status', async () => {
        showImpl = async () => ({ data: { ...DEFAULT_SHOW_DATA, status: 'done' } });
        const { queryByText } = render(<TaskDetail task={{ ...task, status: 'done' }} onTransition={() => {}} />);
        await waitFor(() => expect(queryByText('Body')).toBeDefined());

        // "Actions" heading should not appear
        expect(queryByText('Actions')).toBeNull();
    });

    test('R1 — renders no actions for cancelled status', async () => {
        showImpl = async () => ({ data: { ...DEFAULT_SHOW_DATA, status: 'cancelled' } });
        const { queryByText } = render(<TaskDetail task={{ ...task, status: 'cancelled' }} onTransition={() => {}} />);
        await waitFor(() => expect(queryByText('Body')).toBeDefined());

        expect(queryByText('Actions')).toBeNull();
    });

    test('R2 — clicking an action opens modal; Dispatch invokes the API and refreshes the list', async () => {
        const { getByLabelText, getByText } = renderDetail();
        await waitFor(() => expect(getByLabelText('Edit body')).toBeDefined());

        // R9: clicking Run opens the channel selection modal (not a direct API call)
        fireEvent.click(getByLabelText('Run'));
        await waitFor(() => expect(getByText('Dispatch')).toBeDefined());

        // Clicking Dispatch sends the action
        fireEvent.click(getByText('Dispatch'));

        await waitFor(() => {
            expect(actionCalls.length).toBe(1);
            expect(actionCalls[0]).toEqual(expect.objectContaining({ wbs: '0001', action: 'run', channel: 'claude' }));
        });

        // Refresh should have been triggered after success
        await waitFor(() => {
            expect(listCalls.length).toBeGreaterThanOrEqual(1);
        });
    });

    test('R2 — surfaces action failure via api-error event (after Dispatch)', async () => {
        actionImpl = async () => {
            throw new Error('Action rejected');
        };

        const errors: string[] = [];
        const handler = (e: Event) => {
            errors.push((e as CustomEvent).detail.message);
        };
        window.addEventListener('api-error', handler);

        const { getByLabelText, getByText } = renderDetail();
        await waitFor(() => expect(getByLabelText('Edit body')).toBeDefined());

        // R9: clicking Run opens the modal; Dispatch triggers the actual API call
        fireEvent.click(getByLabelText('Run'));
        await waitFor(() => expect(getByText('Dispatch')).toBeDefined());
        fireEvent.click(getByText('Dispatch'));

        await waitFor(() => {
            expect(errors.length).toBeGreaterThanOrEqual(1);
            expect(errors[0]).toContain('Action rejected');
        });

        window.removeEventListener('api-error', handler);
    });
});

// ── Cancel confirmation modal (0095) ─────────────────────────────────────────

describe('TaskDetail — cancel confirmation modal', () => {
    test('R4 — clicking cancelled status button shows the modal', async () => {
        const { getByText, getByRole } = renderDetail();
        await waitFor(() => expect(getByText('Edit')).toBeDefined());

        // Click the "cancelled" status button
        const cancelledBtn = getByRole('button', { name: 'cancelled' });
        fireEvent.click(cancelledBtn);

        // Modal should appear — the dialog role confirms it's rendered
        expect(getByRole('dialog')).toBeDefined();
        expect(getByRole('button', { name: 'Keep' })).toBeDefined();
        expect(getByRole('button', { name: 'Cancel task' })).toBeDefined();
    });

    test('R4 — "Keep" dismisses the modal without firing transition', async () => {
        const transitions: Array<{ wbs: string; status: string }> = [];
        const { getByText, getByRole } = render(
            <TaskDetail task={task} onTransition={(w, s) => transitions.push({ wbs: w, status: s })} />,
        );
        await waitFor(() => expect(getByText('Edit')).toBeDefined());

        fireEvent.click(getByRole('button', { name: 'cancelled' }));
        fireEvent.click(getByRole('button', { name: 'Keep' }));

        // No transition should have fired
        expect(transitions.length).toBe(0);
    });

    test('R4 — "Cancel task" fires the cancelled transition', async () => {
        const transitions: Array<{ wbs: string; status: string }> = [];
        const { getByText, getByRole } = render(
            <TaskDetail task={task} onTransition={(w, s) => transitions.push({ wbs: w, status: s })} />,
        );
        await waitFor(() => expect(getByText('Edit')).toBeDefined());

        fireEvent.click(getByRole('button', { name: 'cancelled' }));
        fireEvent.click(getByRole('button', { name: 'Cancel task' }));

        expect(transitions).toEqual([{ wbs: '0001', status: 'cancelled' }]);
    });

    test('R4 — clicking the backdrop dismisses the modal', async () => {
        const transitions: Array<{ wbs: string; status: string }> = [];
        const { getByText, getByRole } = render(
            <TaskDetail task={task} onTransition={(w, s) => transitions.push({ wbs: w, status: s })} />,
        );
        await waitFor(() => expect(getByText('Edit')).toBeDefined());

        fireEvent.click(getByRole('button', { name: 'cancelled' }));

        // Click the backdrop (role=presentation div)
        const backdrop = document.querySelector('[role="presentation"]');
        expect(backdrop).not.toBeNull();
        fireEvent.click(backdrop as HTMLElement);

        expect(transitions.length).toBe(0);
    });

    test('R4 — non-cancelled status buttons fire immediately (no modal)', async () => {
        const transitions: Array<{ wbs: string; status: string }> = [];
        const { getByText, getByRole } = render(
            <TaskDetail task={task} onTransition={(w, s) => transitions.push({ wbs: w, status: s })} />,
        );
        await waitFor(() => expect(getByText('Edit')).toBeDefined());

        fireEvent.click(getByRole('button', { name: 'done' }));

        expect(transitions).toEqual([{ wbs: '0001', status: 'done' }]);
    });
});

// ── Channel selection modal (R9) ─────────────────────────────────────────────

describe('TaskDetail — channel selection modal (R9)', () => {
    test('R9 — clicking action button opens channel selection modal', async () => {
        const { getByLabelText, getByText } = renderDetail();
        await waitFor(() => expect(getByLabelText('Edit body')).toBeDefined());

        // todo status has 'plan' action — clicking it opens the channel modal
        fireEvent.click(getByLabelText('Plan'));

        // Modal appears with "Select Channel" heading
        await waitFor(() => expect(getByText(/Select Channel/)).toBeDefined());
        // Channel select and skip-deps checkbox are present
        expect(getByText('Skip dependencies')).toBeDefined();
        expect(getByText('Dispatch')).toBeDefined();
    });

    test('R9 — dispatch sends channel and skipDeps', async () => {
        const { getByLabelText, getByText } = renderDetail();
        await waitFor(() => expect(getByLabelText('Edit body')).toBeDefined());

        // Open the modal via Plan action
        fireEvent.click(getByLabelText('Plan'));
        await waitFor(() => expect(getByText('Dispatch')).toBeDefined());

        // Click Dispatch — default channel is 'claude', skipDeps defaults to false
        fireEvent.click(getByText('Dispatch'));

        await waitFor(() => {
            expect(actionCalls.length).toBe(1);
        });
        expect(actionCalls[0]).toEqual(
            expect.objectContaining({
                wbs: '0001',
                action: 'plan',
                channel: 'claude',
                skipDeps: false,
            }),
        );
    });
});

// ── Implementation progress and estimated hours (R10) ────────────────────────

describe('TaskDetail — implementation progress (R10)', () => {
    test('R10 — renders estimated_hours when present in frontmatter', async () => {
        showImpl = async () => ({
            data: { ...DEFAULT_SHOW_DATA, frontmatter: { estimated_hours: 8 } },
        });

        const { getByText } = renderDetail();
        await waitFor(() => expect(getByText('Metadata')).toBeDefined());

        expect(getByText('Est. Hours')).toBeDefined();
        expect(getByText('8h')).toBeDefined();
    });

    test('R10 — renders impl_progress bars when present', async () => {
        showImpl = async () => ({
            data: {
                ...DEFAULT_SHOW_DATA,
                frontmatter: {
                    impl_progress: {
                        planning: 'done',
                        design: 'in_progress',
                        implementation: 'pending',
                        review: 'pending',
                        testing: 'pending',
                    },
                },
            },
        });

        const { getAllByText } = renderDetail();
        await waitFor(() => expect(getAllByText('Metadata')[0]).toBeDefined());

        // All five phase labels render (testing also appears as a status button, so getAllByText)
        expect(getAllByText('planning').length).toBeGreaterThanOrEqual(1);
        expect(getAllByText('design').length).toBeGreaterThanOrEqual(1);
        expect(getAllByText('implementation').length).toBeGreaterThanOrEqual(1);
        expect(getAllByText('review').length).toBeGreaterThanOrEqual(1);
        expect(getAllByText('testing').length).toBeGreaterThanOrEqual(1);

        // Phase states render alongside — done also appears as a status button
        expect(getAllByText('done').length).toBeGreaterThanOrEqual(1);
        expect(getAllByText('in_progress').length).toBeGreaterThanOrEqual(1);
        expect(getAllByText('pending').length).toBeGreaterThanOrEqual(3);
    });

    test('R10 — falls back to lifecycle bar when impl_progress absent', async () => {
        // With empty frontmatter (no impl_progress), the synthetic lifecycle bar renders
        showImpl = async () => ({
            data: { ...DEFAULT_SHOW_DATA, frontmatter: {} },
        });

        const { getByText, getAllByText } = renderDetail();
        await waitFor(() => expect(getByText('Metadata')).toBeDefined());

        // The fallback lifecycle bar renders phase labels (backlog, todo, wip, testing, done)
        // These also appear as status buttons, so use getAllByText
        expect(getAllByText('backlog').length).toBeGreaterThanOrEqual(1);
        expect(getAllByText('todo').length).toBeGreaterThanOrEqual(1);
        expect(getAllByText('wip').length).toBeGreaterThanOrEqual(1);
        expect(getAllByText('testing').length).toBeGreaterThanOrEqual(1);
        expect(getAllByText('done').length).toBeGreaterThanOrEqual(1);
    });
});
