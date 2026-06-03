---
name: "Plugin discovery, loader, and CLI plugin commands"
description: "Plugin discovery, loader, and CLI plugin commands"
status: Backlog
created_at: 2026-06-03T17:06:42.792Z
updated_at: 2026-06-03T17:06:42.792Z
folder: docs/tasks
type: task
feature-id: F-5 plugin-system
priority: medium
dependencies: ["Phase 5a (SDK)"]
tags: ["plugin-system","discovery","cli","phase-5b"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0013. "Plugin discovery, loader, and CLI plugin commands"

### Background

Phase 5b of the plugin system (ADR-012). Discovery + lifecycle + CLI surface.


### Requirements


PluginLoader in packages/app: discover(roots) -> validate -> load (dynamic import) -> register; priority-ordered roots (SPUR_PLUGIN_PATH > .spur/plugins > ~/.spur/plugins > bundled); name-shadowing; spur plugin list|info; plugin commands in spur help; integration tests with temp dirs.

SUBSTRATE constraints (ADR-012 Decision 7 — plugins are system primitives):
- TWO-CLASS loading: core/bundled plugins (Spur install dir) load FAIL-FAST — a bundled-plugin failure is a fatal startup error (it IS the system). local/curated plugins stay FAIL-SOFT (logged + skipped, never crash Spur). The "invalid plugins are skipped" rule (R2.3) applies ONLY to non-core classes.
- EXPLICIT bootstrap ordering: core/bundled discovery + registration completes BEFORE command dispatch and BEFORE the server mounts routes, so a primitive is available the moment dependent code runs. Ordering is part of the loader contract, not incidental.
- The loader populates the same registries that future bundled-plugin primitives use; built-in pre-registration (from 5a) is applied first, then discovered plugins overlay/extend.
- Tests: assert a failing BUNDLED plugin aborts startup; a failing LOCAL plugin is skipped and Spur still runs.



YAML+SCHEMA note (ADR-012 Decision 8): the loader's `validate()` step reads `plugin.yaml` with
`@gobing-ai/ts-runtime` `parseYamlObject`, then calls the SDK's `validateManifest()`
(`PluginManifestSchema.safeParse`). A schema failure is the validate() failure: a bad BUNDLED
manifest fails fast (abort startup); a bad LOCAL/curated manifest is logged + skipped. Config
overrides (`.spur/plugins/<name>.yaml`) are parsed the same way and validated before merge. The SDK
owns the schemas; the loader (packages/app) owns the file I/O — keeps the SDK ts-runtime-free.


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


