---
name: Plugin server route seam (Hono mount + OpenAPI)
description: Plugin server route seam (Hono mount + OpenAPI)
status: Backlog
created_at: 2026-06-03T17:06:42.835Z
updated_at: 2026-06-03T17:06:42.835Z
folder: docs/tasks
type: task
feature-id: F-5 plugin-system
priority: low
dependencies: ["Phase 5a (SDK)","Phase 5b (loader)"]
tags: ["plugin-system","server","phase-5c"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0014. Plugin server route seam (Hono mount + OpenAPI)

### Background

Phase 5c of the plugin system (ADR-012). Server extensibility.


### Requirements

host.api.register(prefix, router) mounts plugin Hono routers under prefix in apps/server; prefix collision -> error at registration; plugin routes appear in generated OpenAPI; onServerStart/onServerStop hooks; tests incl. test-cf.


### Q&A



### Design



### Solution



### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


