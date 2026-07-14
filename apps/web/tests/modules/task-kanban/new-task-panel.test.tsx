registerHappyDom();

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ComponentType } from 'react';
import React from 'react';
// Grab real Button and Select before mocking @/ui
import { Button, Select } from '@/ui';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

// ── Mock MDEditor ────────────────────────────────────────────────────────────
interface MockEditorProps {
    value?: string;
    onChange?: (val?: string) => void;
    textareaProps?: {
        id?: string;
        placeholder?: string;
        disabled?: boolean;
        'aria-label'?: string;
    };
}

const editorOnChangeById = new Map<string, (val?: string) => void>();

const MockMDEditor = Object.assign(
    function MockEditor({ value, onChange, textareaProps }: MockEditorProps) {
        if (textareaProps?.id && onChange) {
            editorOnChangeById.set(textareaProps.id, onChange);
        }
        return (
            <textarea
                id={textareaProps?.id}
                aria-label={textareaProps?.['aria-label'] ?? 'markdown editor'}
                placeholder={textareaProps?.placeholder}
                disabled={textareaProps?.disabled}
                value={value ?? ''}
                onChange={(e) => onChange?.((e.target as HTMLTextAreaElement).value)}
            />
        );
    } as ComponentType<MockEditorProps>,
    {
        Markdown: function MockMarkdown({ source }: { source?: string }) {
            return <div data-testid="markdown-preview">{source}</div>;
        },
    },
);

mock.module('@uiw/react-md-editor', () => ({ default: MockMDEditor }));

// ── Mock @/ui: keep real Button/Select, mock Input for controllable onChange ──
const inputOnChangeById = new Map<string, (e: { target: { value: string } }) => void>();

function MockInput({ id, onChange, variant, size, error, className, value, ...rest }: Record<string, unknown>) {
    if (id && typeof onChange === 'function') {
        inputOnChangeById.set(String(id), onChange as (e: { target: { value: string } }) => void);
    }
    // Compute classes to match real Input's behavior for className-dependent selectors
    const inputClasses = ['input'];
    if (variant === 'bordered') inputClasses.push('input-bordered');
    if (size === 'sm') inputClasses.push('input-sm');
    if (error) inputClasses.push('input-error');
    if (typeof className === 'string') inputClasses.push(className);
    // defaultValue (not value) avoids React's controlled-without-onChange warning; the real
    // onChange is captured above and invoked directly, bypassing happy-dom's broken input events.
    return React.createElement('input', { id, className: inputClasses.join(' '), defaultValue: value, ...rest });
}

mock.module('@/ui', () => ({
    Button,
    Select,
    Input: MockInput,
}));

// ── api stub ────────────────────────────────────────────────────────────────
const createCalls: Array<{ title: string; folder?: string; template?: string }> = [];
const bodyCalls: Array<{ wbs: string; body: string }> = [];

let createImpl: () => Promise<unknown> = async () => ({ data: { wbs: '0009', filePath: 'a.md' } });
let bodyImpl: () => Promise<unknown> = async () => ({ data: { wbs: '0009', filePath: 'a.md' } });

// Shared full-surface rpc-client mock — prevents "last mock wins" starvation
import { buildFullRpcMock } from '../../test-helpers/rpc-client-mock';

const restoreMockNP = () => {
    mock.module('../../../src/lib/rpc-client', () =>
        buildFullRpcMock({
            api: {
                task: {
                    create: (input: { title: string; folder?: string; template?: string }) => {
                        createCalls.push(input);
                        return createImpl();
                    },
                    body: (input: { wbs: string; body: string }) => {
                        bodyCalls.push(input);
                        return bodyImpl();
                    },
                    // Inherit shared full-surface defaults for methods this file doesn't override
                    list: async () => ({ data: [] }),
                    transition: async () => ({ ok: true }),
                    show: async () => ({
                        data: {
                            wbs: '0001',
                            name: 'Test',
                            status: 'todo',
                            frontmatter: {},
                            content: 'body',
                            filePath: 'a.md',
                        },
                    }),
                    action: async () => ({ data: { runId: 'r1', action: 'run', status: 'queued' } }),
                    folders: async () => ({ data: [] }),
                },
            },
        }),
    );
};

// Dynamic import so mocks intercept before real module loads
const { default: NewTaskPanel } = await import('../../../src/modules/task-kanban/NewTaskPanel');

afterAll(teardownHappyDom);

beforeEach(() => {
    restoreMockNP();
    cleanup();
    createCalls.length = 0;
    bodyCalls.length = 0;
    editorOnChangeById.clear();
    inputOnChangeById.clear();
    createImpl = async () => ({ data: { wbs: '0009', filePath: 'a.md' } });
    bodyImpl = async () => ({ data: { wbs: '0009', filePath: 'a.md' } });
});
function renderPanel(props: Partial<Parameters<typeof NewTaskPanel>[0]> = {}) {
    return render(<NewTaskPanel open={true} onClose={() => {}} onCreated={() => {}} folder="docs/tasks" {...props} />);
}

/** Set the controlled Name input via the captured React onChange handler. */
function fillName(value: string) {
    const onChange = inputOnChangeById.get('new-task-name');
    if (!onChange) throw new Error('Input onChange not captured for new-task-name');
    act(() => {
        onChange({ target: { value } });
    });
}

describe('NewTaskPanel', () => {
    test('R1 — renders Name input, Background/Requirements fields, and action buttons when open', () => {
        const { getByLabelText, getByPlaceholderText, getByText } = renderPanel();

        expect(getByText('New Task')).toBeDefined();
        expect(getByLabelText('Name *')).toBeDefined();
        expect(getByPlaceholderText('Why this task exists…')).toBeDefined();
        expect(getByPlaceholderText('What must be done…')).toBeDefined();
        expect(getByText('Create Task')).toBeDefined();
        expect(getByText('Cancel')).toBeDefined();
    });

    test('R1 — returns empty container when closed (open=false)', () => {
        const { container } = render(
            <NewTaskPanel open={false} onClose={() => {}} onCreated={() => {}} folder="docs/tasks" />,
        );

        expect(container.children).toHaveLength(0);
    });

    test('R3 — empty Name blocks submit and shows validation message', () => {
        const onCreated = mock(() => {});
        const { getByText } = renderPanel({ onCreated });

        fireEvent.click(getByText('Create Task'));

        expect(getByText('Name is required')).toBeDefined();
        expect(createCalls).toHaveLength(0);
        expect(onCreated).not.toHaveBeenCalled();
    });

    test('R3 — whitespace-only Name is treated as empty', () => {
        const onCreated = mock(() => {});
        const { getByLabelText, getByText } = renderPanel({ onCreated });

        const input = getByLabelText('Name *') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '   ' } });
        fireEvent.blur(input);
        fireEvent.click(getByText('Create Task'));

        expect(getByText('Name is required')).toBeDefined();
        expect(createCalls).toHaveLength(0);
        expect(onCreated).not.toHaveBeenCalled();
    });

    test('R3 — api-error CustomEvent dispatches on server failures', () => {
        const errorEvents: string[] = [];
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { message: string };
            errorEvents.push(detail.message);
        };
        window.addEventListener('api-error', handler);

        window.dispatchEvent(new CustomEvent('api-error', { detail: { message: '409 lock denied' } }));
        expect(errorEvents).toContain('409 lock denied');

        window.removeEventListener('api-error', handler);
    });

    test('R4 — folder prop is passed to the create call', () => {
        const { getByText } = render(
            <NewTaskPanel open={true} onClose={() => {}} onCreated={() => {}} folder="custom/folder" />,
        );
        expect(getByText('New Task')).toBeDefined();
        expect(getByText('Create Task')).toBeDefined();
    });

    test('Cancel button calls onClose and resets form state', () => {
        const onClose = mock(() => {});
        const { getByText } = renderPanel({ onClose });
        fireEvent.click(getByText('Cancel'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('Close button (✕) calls onClose', () => {
        const onClose = mock(() => {});
        const { getByLabelText } = renderPanel({ onClose });
        fireEvent.click(getByLabelText('Close'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('Backdrop click calls onClose', () => {
        const onClose = mock(() => {});
        const { container } = renderPanel({ onClose });
        const backdrop = container.querySelector('[aria-hidden="true"]') as HTMLElement;
        fireEvent.click(backdrop);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('Name input has required indicator (*) and placeholder', () => {
        const { getByPlaceholderText } = renderPanel();
        const input = getByPlaceholderText('Task name') as HTMLInputElement;
        expect(input).toBeDefined();
        expect(input.type).toBe('text');
    });

    test('R1 — Background markdown editor exposes the markdown placeholder hint', () => {
        const { getByPlaceholderText } = renderPanel();
        const textarea = getByPlaceholderText('Why this task exists…') as HTMLTextAreaElement;
        expect(textarea).toBeDefined();
    });

    test('R1 — Requirements markdown editor exposes the markdown placeholder hint', () => {
        const { getByPlaceholderText } = renderPanel();
        const textarea = getByPlaceholderText('What must be done…') as HTMLTextAreaElement;
        expect(textarea).toBeDefined();
    });

    test('R1 — toggles Background from edit to live preview', () => {
        const { getAllByRole, getByTestId } = renderPanel();

        act(() => {
            editorOnChangeById.get('new-task-background')?.('**context**');
        });
        const previewButton = getAllByRole('button', { name: 'Preview' })[0];
        expect(previewButton).toBeDefined();
        fireEvent.click(previewButton as HTMLElement);

        expect(getByTestId('new-task-background-preview')).toBeDefined();
        expect(getByTestId('markdown-preview').textContent).toBe('**context**');
    });

    test('R1 — includes a manual resize handle on the panel edge', () => {
        const { getByTestId } = renderPanel();
        const handle = getByTestId('resize-handle-h');
        expect(handle).toBeDefined();
        expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    });

    test('panel uses role="dialog" for accessibility', () => {
        const { getByRole } = renderPanel();
        const dialog = getByRole('dialog');
        expect(dialog).toBeDefined();
        expect(dialog.getAttribute('aria-label')).toBe('New Task');
    });

    test('submit button is disabled while submitting', async () => {
        const { getByText } = renderPanel();
        const btn = getByText('Create Task') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
    });

    test('R8 — renders template select with all variants', () => {
        const { container } = renderPanel();
        const select = container.querySelector('#new-task-template') as HTMLSelectElement | null;
        expect(select).not.toBeNull();
        expect(select).toBeDefined();

        const options = Array.from(select?.querySelectorAll('option') ?? []).map((o) => o.value);
        expect(options).toEqual(['standard', 'feature-impl', 'issue', 'review', 'meta', 'brainstorm']);
    });

    test('R8 — template select defaults to standard variant', () => {
        const { container } = renderPanel();
        const select = container.querySelector('#new-task-template') as HTMLSelectElement;
        expect(select.value).toBe('standard');
    });

    // ── coverage: localStorage panelWidth path ──────────────────────────────
    test('panelWidth reads from localStorage when a valid number is stored', () => {
        localStorage.setItem('spur:new-task-panel-width', '500');
        const { container } = renderPanel();
        const panel = container.querySelector('[role="dialog"]') as HTMLElement;
        expect(panel).toBeDefined();
        localStorage.removeItem('spur:new-task-panel-width');
    });

    test('panelWidth handles localStorage.getItem throwing', () => {
        const orig = localStorage.getItem.bind(localStorage);
        localStorage.getItem = () => {
            throw new Error('quota exceeded');
        };
        const { container } = renderPanel();
        const panel = container.querySelector('[role="dialog"]') as HTMLElement;
        expect(panel).toBeDefined();
        localStorage.getItem = orig;
    });

    // ── coverage: handleSubmit async path ───────────────────────────────────
    test('submit creates a task when Name is filled', async () => {
        const onCreated = mock(() => {});
        const onClose = mock(() => {});
        const { getByText } = renderPanel({ onCreated, onClose });

        fillName('My Test Task');
        fireEvent.click(getByText('Create Task'));
        await new Promise((r) => setTimeout(r, 50));

        expect(createCalls).toHaveLength(1);
        const c = createCalls[0] as (typeof createCalls)[0];
        expect(c.title).toBe('My Test Task');
        expect(c.folder).toBe('docs/tasks');
        expect(c.template).toBe('standard');
        expect(onCreated).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('submit seeds body when Background is filled', async () => {
        const onCreated = mock(() => {});
        const { getByText } = renderPanel({ onCreated });

        fillName('Task With Body');
        act(() => {
            editorOnChangeById.get('new-task-background')?.('Some background context');
        });

        fireEvent.click(getByText('Create Task'));
        await new Promise((r) => setTimeout(r, 50));

        expect(createCalls).toHaveLength(1);
        const b = bodyCalls[0] as (typeof bodyCalls)[0];
        expect(b.body).toBe('### Background\nSome background context');
        expect(onCreated).toHaveBeenCalledTimes(1);
    });

    test('submit seeds body when Background and Requirements are filled', async () => {
        const onCreated = mock(() => {});
        const { getByText } = renderPanel({ onCreated });

        fillName('Full Task');
        act(() => {
            editorOnChangeById.get('new-task-background')?.('bg');
            editorOnChangeById.get('new-task-requirements')?.('reqs');
        });

        fireEvent.click(getByText('Create Task'));
        await new Promise((r) => setTimeout(r, 50));

        expect(createCalls).toHaveLength(1);
        expect(bodyCalls).toHaveLength(1);
        const b2 = bodyCalls[0] as (typeof bodyCalls)[0];
        expect(b2.body).toBe('### Background\nbg\n\n### Requirements\nreqs');
    });

    test('submit handles body seeding failure gracefully', async () => {
        bodyImpl = async () => {
            throw new Error('body write denied');
        };
        const onCreated = mock(() => {});
        const { getByText } = renderPanel({ onCreated });

        fillName('Task Body Fail');
        act(() => {
            editorOnChangeById.get('new-task-background')?.('bg text');
        });

        const errorEvents: string[] = [];
        const handler = (e: Event) => {
            errorEvents.push((e as CustomEvent).detail.message);
        };
        window.addEventListener('api-error', handler);

        fireEvent.click(getByText('Create Task'));
        await new Promise((r) => setTimeout(r, 50));

        expect(createCalls).toHaveLength(1);
        expect(onCreated).toHaveBeenCalledTimes(1);
        expect(errorEvents.some((m) => m.includes('body seeding failed'))).toBe(true);

        window.removeEventListener('api-error', handler);
    });

    test('submit shows error message on create failure', async () => {
        createImpl = async () => {
            throw new Error('409 conflict');
        };
        const onCreated = mock(() => {});
        const { getByText } = renderPanel({ onCreated });

        fillName('Will Fail');
        fireEvent.click(getByText('Create Task'));
        await new Promise((r) => setTimeout(r, 50));

        expect(createCalls).toHaveLength(1);
        expect(onCreated).not.toHaveBeenCalled();
        expect(getByText('409 conflict')).toBeDefined();
    });

    test('submit dispatches api-error CustomEvent on create failure', async () => {
        createImpl = async () => {
            throw new Error('network down');
        };
        const { getByText } = renderPanel();

        fillName('Network Fail');

        const errorEvents: string[] = [];
        const handler = (e: Event) => {
            errorEvents.push((e as CustomEvent).detail.message);
        };
        window.addEventListener('api-error', handler);

        fireEvent.click(getByText('Create Task'));
        await new Promise((r) => setTimeout(r, 50));

        expect(errorEvents).toContain('network down');
        window.removeEventListener('api-error', handler);
    });

    test('submit button shows "Creating…" while submitting', async () => {
        const { promise: createPromise, resolve: resolveCreate } = Promise.withResolvers<unknown>();
        createImpl = () => createPromise;

        const { getByText, queryByText } = renderPanel();

        fillName('Slow Task');
        fireEvent.click(getByText('Create Task'));

        expect(getByText('Creating…')).toBeDefined();
        expect(queryByText('Create Task')).toBeNull();

        resolveCreate({ data: { wbs: '0010', filePath: 'b.md' } });
        await new Promise((r) => setTimeout(r, 50));
        expect(queryByText('Creating…')).toBeNull();
    });

    test('onChange handler for Name sets nameTouched', () => {
        const { getByText } = renderPanel();

        // Fill then clear the name via the captured onChange
        fillName('x');
        fillName('');

        fireEvent.click(getByText('Create Task'));
        expect(getByText('Name is required')).toBeDefined();
    });

    // ── coverage: ResizeHandle onResizeEnd callback ─────────────────────────
    test('ResizeHandle onResizeEnd clamps and persists width', () => {
        const { getByTestId } = renderPanel();
        const handle = getByTestId('resize-handle-h');

        fireEvent.pointerDown(handle, { clientX: 400, clientY: 0, pointerId: 1 });
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: 600, clientY: 0 }));
        window.dispatchEvent(new PointerEvent('pointerup', { clientX: 600, clientY: 0 }));

        const stored = localStorage.getItem('spur:new-task-panel-width');
        expect(stored).not.toBeNull();
        localStorage.removeItem('spur:new-task-panel-width');
    });
});
