---
doc: design/workflows-reading-surface
area: project workflows reading surface — server workflows endpoint and the web settings workflows tab
status: built (2026-09-22, server 803c51d09; web 84e420a6e..4a8ca580b)
authority: derived
owner: Robin Min
updated_at: 2026-09-22
read_before: changing the workflows endpoint payload, workflow listing resolution, or the settings workflows view
---

# Workflows reading surface

Read-only exposure of registered project workflows for the web settings UI.
No write surface: creation/editing stays in `config/workflows/` (ADR-115); this slice only reads
what `workflowService` already resolves.

## 1. HTTP read contract

Both routes live in `apps/server/src/modules/health/index.ts` (server module placement is
historical; the handler only reads through `workflowService`):

- `GET /api/workflows`
- `GET /api/project/workflows` (alias)

Response: `{ workflows: WorkflowEntry[], total: number }` where each entry carries:

| Field | Meaning |
| --- | --- |
| `name` / `kind` / `version` / `description` | workflow identity from the listing (`version`/`description` null when absent) |
| `path` | cwd-relative file path; falls back to the entry path when outside cwd |
| `source` | layer id (ephemeral / project / bundled), resolved against `listResult.layers` |
| `valid` / `error` | entry validity; read or resolve failures degrade the entry instead of failing the request |
| `rawYaml` | raw file text read via the context filesystem (empty string on read failure) |
| `mermaidDiagram` | fenced mermaid render of the fully resolved definition, only for valid entries |

Resolution order per entry: `registeredWorkflowPaths(ctx.spurConfig)` → `workflowService().list(paths)`
→ raw YAML read → for valid entries `resolveWorkflowDefinition(ctx.cwd, path, { registered })` →
`renderWorkflowMermaid(resolved.workflow, { fenced: true })`. Mermaid resolution errors degrade the
entry to `valid: false` with `error`. With no project context or on unexpected failure the endpoint
returns the empty shape `{ workflows: [], total: 0 }` — it never throws.

## 2. Web surface (settings Workflows tab)

`apps/web/src/modules/settings/WorkflowsView.tsx` consumes the endpoint and renders:

- YAML viewer (raw `rawYaml`) in a streamlined drawer.
- Direct diagram view of the fenced mermaid payload, with orientation toggle and markdown viewer
  (added 92e838716; edge-label/format refinements b1cea2e5f; drawer streamlining 4a8ca580b).

UI visual language follows root `DESIGN.md` tokens; this satellite owns only the surface contract.

## 3. Tests

- Server payload/shape coverage under `apps/server/tests/` (workflows endpoint cases, c46b864b7).
- Web view coverage under `apps/web/tests/` for the tab, diagram view and drawer.
