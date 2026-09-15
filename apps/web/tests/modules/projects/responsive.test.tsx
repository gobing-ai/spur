registerHappyDom();

/**
 * LB-1 structural half (0845 R4/R5). happy-dom has NO layout engine —
 * scrollWidth/clientWidth pass vacuously here, so geometry is asserted by the
 * untracked browser runner (.spur/run/g63-projects/browser-check.mjs). This
 * suite pins the structural invariants that MAKE both widths hold: no element
 * declares a min-width wider than 390 px; the terminal pane owns its
 * overflow-x container; roster rows
 * wrap on breakpoint-qualified tracks instead of a fixed track count.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import ProjectsShell from '../../../src/modules/projects/ProjectsShell';
import {
    ProjectContext,
    type ProjectFleetSnapshot,
    type ResolvedFleetMember,
} from '../../../src/modules/projects/useProjectContext';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

afterAll(teardownHappyDom);

// happy-dom has no EventSource; the detail pane's terminal needs an inert stub.
const OriginalEventSource = (globalThis as Record<string, unknown>).EventSource;
beforeAll(() => {
    Object.defineProperty(globalThis, 'EventSource', {
        value: class {
            onmessage: unknown = null;
            onerror: unknown = null;
            close(): void {}
        },
        writable: true,
        configurable: true,
    });
});
afterAll(() => {
    Object.defineProperty(globalThis, 'EventSource', {
        value: OriginalEventSource,
        writable: true,
        configurable: true,
    });
});

afterEach(() => {
    cleanup();
    resetFetchForTesting();
    localStorage.clear();
});

function member(overrides: Partial<ResolvedFleetMember> = {}): ResolvedFleetMember {
    return {
        instanceId: 'a1',
        role: 'planner',
        executor: 'claude',
        enabled: true,
        writeCapable: true,
        capabilityState: 'active',
        ...overrides,
    };
}

function fleet(): ProjectFleetSnapshot {
    return {
        path: '/repo/wt',
        enabled: true,
        strategy: { name: 'gtd', version: 1 },
        orchestrator: { state: 'bound-online', instanceId: 'orch' },
        members: [member({ instanceId: 'orch' }), member()],
        capacity: { total: 2, enabled: 2, writeCapable: 2, missing: [] },
    };
}

// Full well-formed fixtures on /api/project/* (a bare `{}` fleet crashes the
// bar/shell mid-render — see BoardLayout.test.tsx) + process rows for the
// roster; everything else (kanban/feature surfaces) serves empty rows.
function installSilentApiFetch(): void {
    setFetchForTesting(((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('/api/project/fleet')) {
            return Promise.resolve(new Response(JSON.stringify(fleet()), { status: 200 }));
        }
        if (url.includes('/api/project/requests')) {
            return Promise.resolve(new Response(JSON.stringify({ requests: [] }), { status: 200 }));
        }
        if (url.includes('/api/project')) {
            return Promise.resolve(new Response(JSON.stringify({ name: 'spur', path: '/repo/wt' }), { status: 200 }));
        }
        if (url.includes('/api/processes')) {
            return Promise.resolve(
                new Response(
                    JSON.stringify({
                        processes: [
                            {
                                agentId: 'orch',
                                pid: 1,
                                status: 'running',
                                startedAt: '2026-09-12T10:00:00.000Z',
                                exitCode: null,
                            },
                            {
                                agentId: 'a1',
                                pid: 2,
                                status: 'running',
                                startedAt: '2026-09-12T10:00:00.000Z',
                                exitCode: null,
                            },
                        ],
                    }),
                    { status: 200 },
                ),
            );
        }
        return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
    }) as typeof fetch);
}

function renderView(tab: 'conversation' | 'agents' | 'processes') {
    return render(
        <MemoryRouter initialEntries={[`/board/projects/${tab}`]}>
            <ProjectContext.Provider
                value={{ path: '/repo/wt', name: 'spur', fleet: fleet(), state: 'ready' as const } as never}
            >
                <ProjectsShell />
            </ProjectContext.Provider>
        </MemoryRouter>,
    );
}

/** The one structural rule that makes 390 px hold: no declared min-width above 390 px. */
function assertNoWideMinWidth(html: string): void {
    for (const m of html.matchAll(/min-w-\[(\d+(?:\.\d+)?)(px|rem)\]/g)) {
        const px = Number.parseFloat(m[1] ?? '') * (m[2] === 'rem' ? 16 : 1);
        expect(px, m[0]).toBeLessThanOrEqual(390);
    }
    for (const m of html.matchAll(/min-width:\s*(\d+(?:\.\d+)?)px/g)) {
        expect(Number.parseFloat(m[1] ?? ''), m[0]).toBeLessThanOrEqual(390);
    }
}

describe('LB-1 structural invariants (0845 R4)', () => {
    test('no rendered element in any view declares a min-width above 390 px', async () => {
        installSilentApiFetch();
        for (const tab of ['conversation', 'agents', 'processes'] as const) {
            const { container, unmount } = renderView(tab);
            await act(async () => {});
            expect(container.querySelector('[data-projects-shell]'), tab).not.toBeNull();
            assertNoWideMinWidth(container.innerHTML);
            unmount();
        }
    });

    test('the terminal pane owns its overflow-x container', async () => {
        installSilentApiFetch();
        // Agents view: open a member — the terminal <pre> scrolls horizontally itself.
        const agents = renderView('agents');
        await act(async () => {});
        const card = agents.container.querySelector('[data-roster-entry="a1"]') as HTMLButtonElement;
        await act(async () => {
            card.click();
        });
        const terminal = agents.container.querySelector('[data-terminal-output]') as HTMLElement;
        expect(terminal, 'terminal pane').not.toBeNull();
        expect(terminal.className).toContain('overflow-x-auto');
        agents.unmount();
    });

    test('roster rows wrap on breakpoint-qualified tracks; card facts wrap, never one fixed grid', async () => {
        installSilentApiFetch();
        const { container } = renderView('agents');
        await act(async () => {});
        const grid = container.querySelector('[data-roster-grid]') as HTMLElement;
        expect(grid).not.toBeNull();
        expect(grid.className).toContain('md:grid-cols-2');
        expect(grid.className).not.toMatch(/(?:^|\s)grid-cols-\d/); // no fixed track count at 390 px
        const factsRow = container.querySelector('[data-roster-declared]')?.parentElement as HTMLElement;
        expect(factsRow.className).toContain('flex-wrap');
    });
});
