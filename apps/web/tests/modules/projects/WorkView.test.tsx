registerHappyDom();

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import { ConversationDraftProvider, DRAFT_STORAGE_KEY } from '../../../src/modules/projects/drafts';
import ProjectsShell from '../../../src/modules/projects/ProjectsShell';
import { ProjectContext } from '../../../src/modules/projects/useProjectContext';
import type { TaskSummary } from '../../../src/modules/task-kanban/types';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';
import { mockDndKit, resetDndState } from '../../test-helpers/dnd-kit-mock';
import { buildFullRpcMock } from '../../test-helpers/rpc-client-mock';

// ── api stub: WorkView embeds KanbanBoard, which imports `{ api }` from lib/rpc-client. ──
// Same process-global mock arrangement as task-kanban/board.test.tsx: buildFullRpcMock keeps
// the full module surface so last-wins registration cannot starve sibling suites.
const tasks: TaskSummary[] = [
    { wbs: '0001', name: 'Alpha', status: 'todo', priority: 'P1', featureId: 'G63', filePath: 'a.md' },
    { wbs: '0002', name: 'Beta', status: 'wip', filePath: 'b.md' },
];
const listCalls: Array<Record<string, unknown>> = [];

const boardApi = {
    task: {
        list: async (input?: { folder?: string }) => {
            listCalls.push({ ...(input ?? {}) });
            return { data: tasks };
        },
        transition: async () => ({ ok: true }),
        // Active folder differs from the bootstrap default so the board's folder-adoption
        // re-fetch fires on BOTH sides of the R3 byte-for-byte comparison.
        folders: async () => ({ data: [{ path: 'docs/plans', label: 'Plans' }] }),
        // Card clicks open the detail popup one commit before reference capture navigates
        // away; the cached lazy import resolves in time on repeat visits, so `show` must exist.
        show: async () => ({ data: { ...tasks[0], description: '' } }),
    },
};

mock.module('../../../src/lib/rpc-client', () => buildFullRpcMock({ api: boardApi }));
mockDndKit();

const WorkView = (await import('../../../src/modules/projects/WorkView')).default;
const KanbanBoard = (await import('../../../src/modules/task-kanban/KanbanBoard')).default;

const restoreMock = () => {
    mock.module('../../../src/lib/rpc-client', () => buildFullRpcMock({ api: boardApi }));
};

afterAll(teardownHappyDom);

beforeEach(() => {
    listCalls.length = 0;
    restoreMock();
    // WorkView sits under BoardLayout in production; here the providers come from the harness.
    // Serve the surfaces that still use plain fetch (features list, message inbox) so the shell
    // renders without network noise.
    setFetchForTesting((async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes('/features')) {
            return new Response(JSON.stringify({ ok: true, data: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ messages: [], count: 0 }), { status: 200 });
    }) as typeof fetch);
});

afterEach(() => {
    cleanup();
    resetDndState();
    resetFetchForTesting();
    localStorage.clear();
});

function ctx(): Record<string, unknown> {
    return { path: '/repo/wt', name: 'spur', fleet: null, state: 'ready' };
}

/** Reads the live pathname so tests can assert where selection did (and did not) navigate. */
function LocationProbe() {
    const location = useLocation();
    return <span hidden data-test-path={location.pathname} />;
}

/** Full-stack harness: the real shell (tab bar + panel contract) over WorkView, at /board/projects/work. */
function renderShell(initial = ['/board/projects/work']) {
    return render(
        <MemoryRouter initialEntries={initial}>
            <ProjectContext.Provider value={ctx() as never}>
                <ConversationDraftProvider>
                    <LocationProbe />
                    <ProjectsShell />
                </ConversationDraftProvider>
            </ProjectContext.Provider>
        </MemoryRouter>,
    );
}

function pathname(container: HTMLElement): string {
    return container.querySelector('[data-test-path]')?.getAttribute('data-test-path') ?? '';
}

async function clickTaskCard(container: HTMLElement, name: string): Promise<void> {
    await waitFor(() => expect(container.textContent).toContain(name));
    const card = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(name));
    expect(card).toBeDefined();
    act(() => {
        fireEvent.click(card as HTMLButtonElement);
    });
}

// ── R1: reuse, no fork ──

describe('WorkView sections (0843 R1)', () => {
    test('defaults to the Tasks section with the board embedded; Features not mounted', async () => {
        const { container } = renderShell();
        await waitFor(() => expect(container.textContent).toContain('Alpha'));
        expect(container.querySelector('[data-work-section="tasks"]')?.getAttribute('aria-pressed')).toBe('true');
        expect(container.querySelector('[data-work-section="features"]')?.getAttribute('aria-pressed')).toBe('false');
        expect(container.querySelector('[data-g6="use-task"]')).not.toBeNull();
        expect(container.querySelector('[data-features-shell]')).toBeNull();
        expect(pathname(container)).toBe('/board/projects/work');
    });

    test('switching to Features mounts the unmodified FeaturesShell inside the Work panel, board gone', async () => {
        const { container } = renderShell();
        await waitFor(() => expect(container.textContent).toContain('Alpha'));
        act(() => {
            fireEvent.click(container.querySelector('[data-work-section="features"]') as HTMLButtonElement);
        });
        const features = await waitFor(() => {
            const el = container.querySelector('[data-features-shell]');
            expect(el).not.toBeNull();
            return el as Element;
        });
        expect(container.querySelector('[aria-label="todo column"]')).toBeNull();
        // The shell renders inside the Work tab panel — and only fetches the plain feature list
        // (no query parameter, so no project scoping was smuggled in).
        expect(container.querySelector('#projects-tab-panel-work')?.contains(features)).toBe(true);
        expect(container.querySelector('[data-work-section="features"]')?.getAttribute('aria-pressed')).toBe('true');
    });
});

// ── R2: reference capture ──

describe('WorkView reference capture (0843 R2)', () => {
    test('selecting a card captures a structured ref, switches to Conversation, never navigates to /board/tasks', async () => {
        const { container } = renderShell();
        await clickTaskCard(container, 'Alpha');
        await waitFor(() => expect(pathname(container)).toBe('/board/projects/conversation'));
        expect(pathname(container)).not.toContain('/board/tasks');
        // The composer carries the reference as a structured chip, not text in the textarea.
        const chip = container.querySelector('[data-g6="task-chip"]');
        expect(chip).not.toBeNull();
        expect(chip?.getAttribute('data-draft-ref')).toBe('task');
        expect(chip?.textContent).toContain('task 0001');
        expect((container.querySelector('[data-conversation-draft-input]') as HTMLTextAreaElement).value).toBe('');
        const stored = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) ?? 'null');
        expect(stored).toEqual({ path: '/repo/wt', text: '', refs: [{ kind: 'task', wbs: '0001' }], revision: 1 });
    });

    test('referencing the same task across two Work visits yields exactly one chip (addRef dedupes)', async () => {
        const { container } = renderShell();
        await clickTaskCard(container, 'Alpha');
        await waitFor(() => expect(pathname(container)).toBe('/board/projects/conversation'));
        act(() => {
            fireEvent.click(container.querySelector('[data-projects-tab="work"]') as HTMLButtonElement);
        });
        await clickTaskCard(container, 'Alpha');
        await waitFor(() => expect(pathname(container)).toBe('/board/projects/conversation'));
        expect(container.querySelectorAll('[data-draft-ref]')).toHaveLength(1);
        const stored = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) ?? 'null');
        expect(stored.refs).toEqual([{ kind: 'task', wbs: '0001' }]);
    });
});

// ── R3: no project filter — same request as the bare embed ──

describe('WorkView project scoping (0843 R3)', () => {
    test('the embedded board issues the identical task-list request the bare embed makes — no project parameter', async () => {
        // Bare embed (what TaskKanbanView mounts one level up), no props beyond onSelectTask.
        const bare = render(
            <MemoryRouter>
                <KanbanBoard onSelectTask={() => {}} />
            </MemoryRouter>,
        );
        await waitFor(() => expect(listCalls.length).toBeGreaterThanOrEqual(2)); // bootstrap + adopted folder
        const bareCalls = listCalls.map((c) => ({ ...c }));
        bare.unmount();
        cleanup();
        localStorage.clear();

        listCalls.length = 0;
        const embedded = renderShell();
        await waitFor(() => expect(embedded.container.textContent).toContain('Alpha'));
        await waitFor(() => expect(listCalls.length).toBeGreaterThanOrEqual(bareCalls.length));

        // Byte-for-byte at the api seam — the oRPC link serializes identical args to identical wire bytes.
        expect(listCalls.slice(0, bareCalls.length)).toEqual(bareCalls);
        for (const call of listCalls) {
            expect(Object.keys(call)).toEqual(['folder']); // folder is the only parameter — never a project key
        }
        embedded.unmount();
    });
});

// ── R4: the untouched modules ──

describe('WorkView R4 — tasks/features stay their own modules', () => {
    test('the tasks and features routes still resolve to their own modules, not the Projects Work view', async () => {
        const { discoverModules } = await import('../../../src/modules/discover');
        const discovered = discoverModules();
        const tasksModule = discovered.find((m) => m.id === 'tasks');
        const featuresModule = discovered.find((m) => m.id === 'features');
        expect(tasksModule?.route).toBe('tasks');
        expect(featuresModule?.route).toBe('features');
        expect(tasksModule?.component).not.toBe(ProjectsShell);
        expect(featuresModule?.component).not.toBe(WorkView);
    });
});
