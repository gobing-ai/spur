registerHappyDom();

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import type { TaskSummary } from '../../../src/modules/task-kanban/types';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

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

// Shared full-surface rpc-client mock — prevents "last mock wins" starvation
import { buildFullRpcMock } from '../../test-helpers/rpc-client-mock';

afterAll(teardownHappyDom);

const actionCalls: Array<{ wbs: string; action: string; channel?: string; skipDeps?: boolean }> = [];
const listCalls: number[] = [];

const restoreMockTD = () => {
    mock.module('../../../src/lib/rpc-client', () =>
        buildFullRpcMock({
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
                    // Inherit full-surface defaults for methods this file doesn't override
                    create: async () => ({ data: { wbs: '0003', filePath: 'c.md' } }),
                    transition: async () => ({ ok: true }),
                    folders: async () => ({ data: [] }),
                },
            },
        }),
    );
};

beforeEach(() => {
    restoreMockTD();
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

import TaskDetail from '../../../src/modules/task-kanban/TaskDetail';

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

/** Expand the metadata pane (folded by default since 0101 #2) so its fields render. */
function expandMetadata(getByText: (text: string) => HTMLElement): void {
    fireEvent.click(getByText('Metadata'));
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

        const { getByText, getAllByText } = renderDetail();

        await waitFor(() => expect(getByText('Metadata')).toBeDefined());
        expandMetadata(getByText);

        // Dates render (metadata pane only)
        expect(getByText('Jan 15, 2025')).toBeDefined();
        expect(getByText('Jun 1, 2025')).toBeDefined();

        // Tags render — now in both the header chips and the metadata pane.
        expect(getAllByText('api').length).toBeGreaterThanOrEqual(1);
        expect(getAllByText('frontend').length).toBeGreaterThanOrEqual(1);

        // Priority and feature from TaskSummary — header chip + metadata.
        expect(getAllByText('P1').length).toBeGreaterThanOrEqual(1);
        expect(getAllByText('W3').length).toBeGreaterThanOrEqual(1);
    });

    test('R1b — priority and feature omit when absent on TaskSummary', async () => {
        const noMetaTask: TaskSummary = { wbs: '0002', name: 'No meta', status: 'todo', filePath: 'b.md' };
        const { getByText, queryByText } = render(<TaskDetail task={noMetaTask} onTransition={() => {}} />);

        await waitFor(() => expect(queryByText('Metadata')).toBeDefined());
        expandMetadata(getByText);

        expect(queryByText('Priority')).toBeNull();
        expect(queryByText('Feature')).toBeNull();
        // File still renders
        expect(queryByText('b.md')).toBeDefined();
    });

    test('R2 — progress stepper renders lifecycle phase labels', async () => {
        const { getByText, getAllByText } = renderDetail();

        await waitFor(() => expect(getAllByText('Metadata')[0]).toBeDefined());
        expandMetadata(getByText);

        // Each lifecycle label exists at least once (progress stepper + status dropdown options)
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
        expandMetadata(getByText);

        // Off-track badge renders the status (getAllByText: header pill + badge + dropdown all use it)
        expect(getAllByText('blocked').length).toBeGreaterThanOrEqual(1);
    });

    test('R4 — metadata pane toggles collapse/expand (folded by default)', async () => {
        const { getByText, queryByText } = renderDetail();

        await waitFor(() => expect(getByText('Metadata')).toBeDefined());

        // Folded by default: progress not rendered
        expect(queryByText('Progress')).toBeNull();

        // Click header to expand
        fireEvent.click(getByText('Metadata'));
        await waitFor(() => expect(getByText('Progress')).toBeDefined());

        // Click again to collapse
        fireEvent.click(getByText('Metadata'));
        await waitFor(() => expect(queryByText('Progress')).toBeNull());
    });

    test('R5 — missing dates and tags render gracefully (no undefined leakage)', async () => {
        showImpl = async () => ({
            data: { ...DEFAULT_SHOW_DATA, frontmatter: {} },
        });

        const { getByText, getAllByText, queryByText } = renderDetail();

        await waitFor(() => expect(getByText('Metadata')).toBeDefined());
        expandMetadata(getByText);

        // Dates section omits when both fields absent
        expect(queryByText('Dates')).toBeNull();
        expect(queryByText('Created')).toBeNull();
        expect(queryByText('Updated')).toBeNull();

        // Tags section omits when array absent
        expect(queryByText('Tags')).toBeNull();

        // Progress and file always present
        expect(getByText('Progress')).toBeDefined();
        // P1 appears in the header chip and the metadata pane.
        expect(getAllByText('P1').length).toBeGreaterThanOrEqual(1);
    });

    test('R5b — empty tags array renders nothing', async () => {
        showImpl = async () => ({
            data: { ...DEFAULT_SHOW_DATA, frontmatter: { tags: [] } },
        });

        const { getByText, queryByText } = renderDetail();

        await waitFor(() => expect(getByText('Metadata')).toBeDefined());
        expandMetadata(getByText);

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
        expandMetadata(getByText);

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

    test('R1 — renders Refine/Start/Cancel for backlog status', async () => {
        showImpl = async () => ({ data: { ...DEFAULT_SHOW_DATA, status: 'backlog' } });
        const { getByLabelText } = render(<TaskDetail task={{ ...task, status: 'backlog' }} onTransition={() => {}} />);
        await waitFor(() => expect(getByLabelText('Edit body')).toBeDefined());

        expect(getByLabelText('Refine')).toBeDefined();
        expect(getByLabelText('Start')).toBeDefined();
        expect(getByLabelText('Cancel')).toBeDefined();
        expect(() => getByLabelText('Plan')).toThrow();
    });

    test('R1 — renders Run/Block/Cancel for wip status', async () => {
        showImpl = async () => ({ data: { ...DEFAULT_SHOW_DATA, status: 'wip' } });
        const { getByLabelText } = render(<TaskDetail task={{ ...task, status: 'wip' }} onTransition={() => {}} />);
        await waitFor(() => expect(getByLabelText('Edit body')).toBeDefined());

        expect(getByLabelText('Run')).toBeDefined();
        expect(getByLabelText('Block')).toBeDefined();
        expect(getByLabelText('Cancel')).toBeDefined();
    });

    test('R1 — renders Verify/Complete/Block/Cancel for testing status', async () => {
        showImpl = async () => ({ data: { ...DEFAULT_SHOW_DATA, status: 'testing' } });
        const { getByLabelText } = render(<TaskDetail task={{ ...task, status: 'testing' }} onTransition={() => {}} />);
        await waitFor(() => expect(getByLabelText('Edit body')).toBeDefined());

        expect(getByLabelText('Verify')).toBeDefined();
        expect(getByLabelText('Complete')).toBeDefined();
        expect(getByLabelText('Cancel')).toBeDefined();
        expect(() => getByLabelText('Run')).toThrow();
    });

    test('R1 — renders Refine/Unblock/Cancel for blocked status', async () => {
        showImpl = async () => ({ data: { ...DEFAULT_SHOW_DATA, status: 'blocked' } });
        const { getByLabelText } = render(<TaskDetail task={{ ...task, status: 'blocked' }} onTransition={() => {}} />);
        await waitFor(() => expect(getByLabelText('Edit body')).toBeDefined());

        expect(getByLabelText('Refine')).toBeDefined();
        expect(getByLabelText('Unblock')).toBeDefined();
        expect(getByLabelText('Cancel')).toBeDefined();
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
    test('R4 — clicking the header Cancel button shows the modal', async () => {
        const { getByText, getByLabelText, getByRole } = renderDetail();
        await waitFor(() => expect(getByText('Edit')).toBeDefined());

        fireEvent.click(getByLabelText('Cancel'));

        // Modal should appear — the dialog role confirms it's rendered
        expect(getByRole('dialog')).toBeDefined();
        expect(getByRole('button', { name: 'Keep' })).toBeDefined();
        expect(getByRole('button', { name: 'Cancel task' })).toBeDefined();
    });

    test('R4 — "Keep" dismisses the modal without firing transition', async () => {
        const transitions: Array<{ wbs: string; status: string }> = [];
        const { getByText, getByLabelText, getByRole } = render(
            <TaskDetail task={task} onTransition={(w, s) => transitions.push({ wbs: w, status: s })} />,
        );
        await waitFor(() => expect(getByText('Edit')).toBeDefined());

        fireEvent.click(getByLabelText('Cancel'));
        fireEvent.click(getByRole('button', { name: 'Keep' }));

        // No transition should have fired
        expect(transitions.length).toBe(0);
    });

    test('R4 — "Cancel task" fires the cancelled transition', async () => {
        const transitions: Array<{ wbs: string; status: string }> = [];
        const { getByText, getByLabelText, getByRole } = render(
            <TaskDetail task={task} onTransition={(w, s) => transitions.push({ wbs: w, status: s })} />,
        );
        await waitFor(() => expect(getByText('Edit')).toBeDefined());

        fireEvent.click(getByLabelText('Cancel'));
        fireEvent.click(getByRole('button', { name: 'Cancel task' }));

        expect(transitions).toEqual([{ wbs: '0001', status: 'cancelled' }]);
    });

    test('R4 — clicking the backdrop dismisses the modal', async () => {
        const transitions: Array<{ wbs: string; status: string }> = [];
        const { getByLabelText } = render(
            <TaskDetail task={task} onTransition={(w, s) => transitions.push({ wbs: w, status: s })} />,
        );

        fireEvent.click(getByLabelText('Cancel'));

        // Click the backdrop (the dialog container itself — target === currentTarget)
        const backdrop = document.querySelector('[role="dialog"][aria-label="Confirm cancel task"]');
        expect(backdrop).not.toBeNull();
        fireEvent.click(backdrop as HTMLElement);

        // Modal dismissed without firing the transition
        expect(document.querySelector('[role="dialog"][aria-label="Confirm cancel task"]')).toBeNull();
        expect(transitions.length).toBe(0);
    });
});

// ── Status display (0101 — plaintext header pill + plaintext metadata field) ──

describe('TaskDetail — header title & close', () => {
    test('header shows the real task title (wbs + name), not a fixed "Task Detail" label', async () => {
        const { getByText, queryByText } = renderDetail();
        await waitFor(() => expect(getByText('Edit')).toBeDefined());

        // The real task title renders; the old fixed "Task Detail" bar is gone.
        expect(getByText(/0001 — Build the board/)).toBeDefined();
        expect(queryByText('Task Detail')).toBeNull();
    });

    test('the ✕ close button fires onClose', async () => {
        let closed = false;
        const { getByText, getByLabelText } = render(
            <TaskDetail task={task} onTransition={() => {}} onClose={() => (closed = true)} />,
        );
        await waitFor(() => expect(getByText('Edit')).toBeDefined());

        fireEvent.click(getByLabelText('Close detail'));
        expect(closed).toBe(true);
    });

    test('omits the close button when no onClose is provided', async () => {
        const { getByText, queryByLabelText } = renderDetail();
        await waitFor(() => expect(getByText('Edit')).toBeDefined());
        expect(queryByLabelText('Close detail')).toBeNull();
    });
});

describe('TaskDetail — status display', () => {
    test('header shows the status as a plaintext pill with its icon (not a dropdown)', async () => {
        const { getByText, getByTestId } = renderDetail();
        await waitFor(() => expect(getByText('Edit')).toBeDefined());

        // The header pill renders the current status as text, not a <select>.
        const pill = getByTestId('status-pill');
        expect(pill.tagName).not.toBe('SELECT');
        expect(pill.textContent).toContain('todo');
    });

    test('metadata pane shows the status as plaintext (with icon), not a dropdown', async () => {
        const { getByText, getByTestId, queryByLabelText } = renderDetail();
        await waitFor(() => expect(getByText('Edit')).toBeDefined());

        fireEvent.click(getByText('Metadata'));
        // No status <select> anywhere — status is read-only plaintext now.
        expect(queryByLabelText('Task status')).toBeNull();

        const metaStatus = getByTestId('metadata-status');
        expect(metaStatus.tagName).not.toBe('SELECT');
        expect(metaStatus.textContent).toContain('todo');
    });

    test('header chips show priority, feature, and tags alongside the status pill', async () => {
        showImpl = async () => ({
            data: { ...DEFAULT_SHOW_DATA, frontmatter: { tags: ['api', 'frontend'] } },
        });

        const { getByText, getByTestId } = renderDetail();
        await waitFor(() => expect(getByText('Edit')).toBeDefined());

        const chips = getByTestId('header-chips');
        // task fixture: priority 'P1', featureId 'W3'.
        expect(chips.textContent).toContain('P1');
        expect(chips.textContent).toContain('W3');
        // Tags come from frontmatter once the body loads.
        await waitFor(() => expect(chips.textContent).toContain('api'));
        expect(chips.textContent).toContain('frontend');
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
        expandMetadata(getByText);

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

        const { getByText, getAllByText } = renderDetail();
        await waitFor(() => expect(getAllByText('Metadata')[0]).toBeDefined());
        expandMetadata(getByText);

        // All five phase labels render (testing also appears in the status dropdown, so getAllByText)
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
        expandMetadata(getByText);

        // The fallback lifecycle bar renders phase labels (backlog, todo, wip, testing, done)
        // These also appear in the status dropdown, so use getAllByText
        expect(getAllByText('backlog').length).toBeGreaterThanOrEqual(1);
        expect(getAllByText('todo').length).toBeGreaterThanOrEqual(1);
        expect(getAllByText('wip').length).toBeGreaterThanOrEqual(1);
        expect(getAllByText('testing').length).toBeGreaterThanOrEqual(1);
        expect(getAllByText('done').length).toBeGreaterThanOrEqual(1);
    });
});
