/**
 * Shared dnd-kit mock for kanban tests.
 *
 * Bun's mock.module is process-global and hoisted: ALL top-level mock.module
 * calls across the test files sharing a worker process are collected before any
 * test runs, and the LAST registration per path wins globally (see
 * rpc-client-mock.ts). A single shared registration here (instead of one inline
 * copy per test file) keeps every dnd-kit consumer on the SAME mock, so
 * "last wins" cannot starve one file's behavior.
 *
 * The mock renders DndContext/DragOverlay as pass-throughs so the real
 * KanbanBoard can mount in happy-dom without drag sensors that depend on real
 * layout/DOM APIs. The DndContext callbacks (onDragEnd/onDragStart) are captured
 * into `dndState` so tests can drive drag-and-drop deterministically.
 */
import { mock } from 'bun:test';

type DragEndEvent = {
    active: { id: string | number };
    over: { id: string | number } | null;
};
type DragStartEvent = { active: { id: string | number } };

export const dndState: {
    onDragEnd: ((event: DragEndEvent) => void) | null;
    onDragStart: ((event: DragStartEvent) => void) | null;
} = {
    onDragEnd: null,
    onDragStart: null,
};

export function resetDndState(): void {
    dndState.onDragEnd = null;
    dndState.onDragStart = null;
}

export function mockDndKit(): void {
    mock.module('@dnd-kit/core', () => ({
        DndContext: ({
            children,
            onDragEnd,
            onDragStart,
        }: {
            children: unknown;
            onDragEnd?: (event: DragEndEvent) => void;
            onDragStart?: (event: DragStartEvent) => void;
        }) => {
            dndState.onDragEnd = onDragEnd ?? null;
            dndState.onDragStart = onDragStart ?? null;
            return children;
        },
        DragOverlay: ({ children }: { children: unknown }) => children,
        PointerSensor: class {},
        KeyboardSensor: class {},
        useSensor: (..._args: unknown[]) => ({}),
        useSensors: (...s: unknown[]) => s,
        useDraggable: () => ({
            attributes: {},
            listeners: {},
            setNodeRef: () => {},
            transform: null,
            isDragging: false,
            active: null,
        }),
        useDroppable: () => ({
            setNodeRef: () => {},
            isOver: false,
        }),
    }));
    mock.module('@dnd-kit/utilities', () => ({
        CSS: { Transform: { toString: () => '' } },
    }));
}
