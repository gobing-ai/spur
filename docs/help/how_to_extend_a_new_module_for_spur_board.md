# How to Add a UI Plugin to the Spur Board

> The Spur Board is a hub for UI plugins. Each plugin is a **module** — a
> self-contained React view (plus optional right-panel contribution) that is
> **auto-discovered** at build time. Adding a plugin touches **one directory,
> zero wiring**: drop an `index.tsx` exporting a `WebModule` under
> `apps/web/src/modules/` and the registry picks it up. No layout, routing,
> sidebar, or registry edits.

This guide is for internal developers adding a new board module. The Tasks
kanban (`apps/web/src/modules/task-kanban/`) is the reference implementation —
read it alongside this guide.

```
                    ┌───────────── apps/web/src/modules/ ─────────────┐
                    │                                                 │
   discover.ts  ──▶ │  import.meta.glob('./*/index.{ts,tsx}')         │
                    │    scans each root, reads the `module` export    │ ◀── build-time
   registry.ts  ──▶ │  createRegistry(discovered) — validate + order  │
                    │                                                 │
   router.tsx   ──▶ │  routes generated FROM registry                 │ ◀── drives URL
   LeftSidebar  ──▶ │  nav items generated FROM registry              │ ◀── drives nav
   BoardLayout  ──▶ │  active module + right panel resolved from URL  │
                    │                                                 │
                    └─────────────────────────────────────────────────┘
```

A module is a `WebModule` object. Everything user-visible (route, sidebar entry,
workspace view, right panel) is derived from that one object — you never wire
routing or navigation by hand. Discovery is eager (`{ eager: true, as: 'sync' }`)
so validation runs at load, not route-hit time.

## The `WebModule` contract

`apps/web/src/modules/types.ts`:

```typescript
export interface WebModule {
    /** Unique id (e.g. 'tasks'). Must match the route segment. */
    readonly id: string;
    /** Display name shown in the sidebar. */
    readonly name: string;
    /** Icon — emoji string or daisyUI icon class. */
    readonly icon: string;
    /** Route segment under /board/ (e.g. 'tasks' → /board/tasks). */
    readonly route: string;
    /** Main workspace component, rendered inside <MainWorkspace>. */
    readonly component: ComponentType;
    /** Optional: component rendered in the right panel when this module is active. */
    readonly rightPanelComponent?: ComponentType;
    /** Optional: sidebar label override (defaults to name). */
    readonly sidebarLabel?: string;
}
```

Invariants — the registry and router assume these; violating them breaks the
board silently:

- `id` and `route` are **unique** across all registered modules.
- `id === route` is the simplest correct choice (the active-module resolver in
  `BoardLayout.tsx` keys off the URL segment, not the id).
- `component` is the only required view; `rightPanelComponent` is optional.

## Step-by-step

The example adds a hypothetical `notes` module at `/board/notes`.

### 1. Create the module directory

```
apps/web/src/modules/notes/
    index.tsx        # exports NotesModule: WebModule
    NotesView.tsx    # the workspace component
```

One module per directory. Co-locate hooks, types, and subcomponents inside it
(see how `task-kanban/` keeps `useTasks.ts`, `useTaskParams.tsx`, `types.ts`,
`KanbanBoard.tsx`, etc. alongside `index.tsx`).

### 2. Write the view component

```typescript
// apps/web/src/modules/notes/NotesView.tsx
export default function NotesView() {
    return <div className="flex flex-col h-full">…</div>;
}
```

The view renders into the main workspace and must fill it — use `h-full`.
Layout/utility Tailwind classes (`flex`, `gap-*`, `p-*`) are fine everywhere.
**daisyUI component classes** (`btn`, `card`, `badge`, …) are confined to
`apps/web/src/components/ui/` by the `no-daisyui-class-leak` rule — import the
wrapped component from `@/ui` instead of authoring the class yourself.

### 3. Export the module object

```typescript
// apps/web/src/modules/notes/index.tsx
import { lazy, Suspense } from 'react';
import type { WebModule } from '../types';
import NotesView from './NotesView';

// Lazy-load heavy subviews (the task module does this for TaskDetail).
const NoteEditor = lazy(() => import('./NoteEditor'));

function NotesDetail() {
    return (
        <Suspense fallback={<div className="p-4 text-spur-text-muted text-sm">Loading…</div>}>
            <NoteEditor />
        </Suspense>
    );
}

export const module: WebModule = {
 id: 'notes',
 name: 'Notes',
 icon: '📝',
 route: 'notes',
 component: NotesView,
 rightPanelComponent: NotesDetail,
};

### 4. There is no step 4 — it's already discovered

That is the entire wiring. The `module` named export you wrote in step 3 is the
discovery contract: `apps/web/src/modules/discover.ts` runs
`import.meta.glob('./*/index.{ts,tsx}', { eager: true, as: 'sync' })` over every
configured root and reads the `module` export (falling back to `default`). The
sidebar nav item, the `/board/notes` route, the `/board/notes/*` wildcard child,
the active-module highlight, and the right panel are all derived automatically.

**Order and the default module.** Within a root, discovered modules are sorted
alphabetically by directory name for a stable order independent of glob return
order. `defaultModule` is the **first** enabled module — the route `/` redirects
to `/board/<defaultModule.route>` (Tasks today, `t` sorts early). A module named
`aaa-notes` would become the landing page; name accordingly.

**Disabling without deleting.** A discovered module can be dropped from the
enabled set by adding its id to `disabledModules` in
`apps/web/src/modules/config.ts`, or by calling `disableModule(id)` at runtime.
`enableModule(id)` restores it. This is the blacklist — the directory and its
discovery contract stay intact; only the enabled flag flips.

**Additional roots (future).** The first cut ships a single root
(`apps/web/src/modules/`). `registerModuleRoot(dir)` is exported from
`registry.ts` for the future multi-root case (extension folders); it is a no-op
stub today and the single-root architecture is fixed for v0.
### 5. Talk to the server through the single RPC seam

Data comes from the Spur server via oRPC. **The only import is `{ api }` from
`@/lib/rpc-client`** — never `@orpc/*` directly, never hand-rolled fetch.

```typescript
import { api } from '@/lib/rpc-client';

const notes = await api.note.list();
```

If your module needs data the server doesn't expose yet, add a server module
(`apps/server/src/modules/<name>/`) and a contract slice in `packages/contracts/`
first — that is a separate change described in
`docs/design/server-side-adjustment-design.md` §2.4 (server modules) and §2.5
(per-module vertical slices).

### 6. Add tests

Mirror the task-kanban test layout under
`apps/web/tests/modules/<your-module>/`:

- A component test that renders the view and asserts key copy/behavior.
- A hook test for any data-fetching hook (the task module's `useTasks.test.ts`
  is the template — it tests the pure refresh factory without mocking oRPC).
- The shared registry test (`apps/web/tests/modules/registry.test.ts`) and the
  discovery test (`apps/web/tests/modules/discover.test.ts`) already assert the
  registry validates/dedupes discovered modules and that `getModule` resolves by
  id — your module is covered by just being discovered.

### 7. Run the gate

```bash
bun run lint     # biome + per-workspace tsc --noEmit
bun run test     # workspace tests + plugins/sp tests
```

The `ui-import-seam-only` and `no-daisyui-class-leak` rules are `error` and run
in the standing pre-check preset — a raw `daisyui` import or a leaked `btn`
class will fail lint, not just review.

## What NOT to do

- **Don't hand-wire routes in `router.tsx`.** Routes come from the registry.
  The router's job is `modules.flatMap(...)`; adding a case there means the
  registry contract is broken.
- **Don't hand-add sidebar entries in `LeftSidebar.tsx`.** Same reason — it maps
  over `modules`.
- **Don't import `@orpc/*` or call `fetch` directly.** Go through
  `{ api }` from `@/lib/rpc-client`. The RPC client owns the transport, timeout,
  and error interception.
- **Don't import third-party UI libs directly.** daisyUI, `@uiw/react-md-editor`,
  and any future UI library must be re-exported through `apps/web/src/ui.ts`
- **Don't put two modules in one directory** or share a directory across modules.
  One module, one directory, one named `module` export (or default export) in
  `index.tsx`. A directory with neither export is silently skipped, not an error.

## Reference

- **Authoritative spec:** `docs/design/server-side-adjustment-design.md` §3.4
  (Web module system) and §3.5 (Task Kanban as the proof-of-mechanism module).
- **Reference implementation:** `apps/web/src/modules/task-kanban/`.
- **Registry:** `apps/web/src/modules/registry.ts` (runtime registry),
  `apps/web/src/modules/discover.ts` (build-time glob discovery),
  `apps/web/src/modules/config.ts` (roots + disabled lists).
- **UI seams:** `apps/web/src/ui.ts` (import seam),
  `apps/web/src/components/ui/` (daisyUI-class authoring seam).
- **Boundary rules:** `config/rules/ui/ui-import-boundary.yaml`.
- **Server-side counterpart:** `docs/design/server-side-adjustment-design.md`
  §2.4 (server modules) — the same registry pattern, server-side.
