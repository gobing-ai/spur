---
name: Plugin harness registry (AgentShim overlay)
description: Plugin harness registry via a Spur-side AgentShim overlay map — no upstream gate (ADR-012)
status: Todo
created_at: 2026-06-03T17:06:55.431Z
updated_at: 2026-06-03T17:06:55.431Z
folder: docs/tasks
type: task
feature-id: F-5 plugin-system
priority: low
dependencies: ["Phase 5a (SDK)"]
tags: ["plugin-system","harness","phase-5d"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0015. Plugin harness registry (AgentShim overlay)

### Background

Phase 5d of the plugin system (ADR-012). **NOT upstream-blocked** (this corrects the
original task name/framing). `@gobing-ai/ts-ai-runner` models agents with a *structural*
`AgentShim` interface; the `AgentName` "closed union" is compile-time only — at runtime
`AGENT_SHIMS` is a plain object, `isAgentName` is `Object.hasOwn(AGENT_SHIMS, v)`, and
`getAgentShim(a)` is `AGENT_SHIMS[a]`. A plugin harness only needs to supply an object
satisfying `AgentShim`; no `BaseHarness` base class and no upstream change are required.


### Requirements


- Spur-side `HarnessRegistry` holds an overlay `Map<string, AgentShim>`; harness resolution
  checks the overlay first, then falls back to `getAgentShim` for built-ins.
- `host.harnesses.register(typeName, shim)` accepts any object satisfying the structural
  `AgentShim` contract (`name`, `command`, `tier`, `getHelpCommand`, `getVersionCommand`,
  `getPromptCommand`, `getAuthCommand`); validated at registration time.
- After registration, `spur agent create --type <plugin-type>` and `spur agent run --agent
  <plugin-type>` resolve through the overlay; `spur agent list --types` shows plugin harnesses.
- Collision with a built-in or another plugin's type → error at registration.
- Optional upstream nicety (NOT a prerequisite): export an `AgentShim` type guard or let
  `AiRunner` accept an injected shim, to drop the small amount of `as`-casting at the seam.
- Tests: register a fake harness, assert resolution + list; assert collision rejection.



SUBSTRATE note (ADR-012 Decision 7): this registry is the FIRST instance of the
"built-ins are pre-registered through the same path as plugins" model. The seven built-in
`AgentShim`s should be expressible as pre-registrations in the overlay (resolution = one map,
not built-in-vs-plugin branching), so the future migration of built-in harnesses onto bundled
harness plugins is a move, not a re-architecture. Treat `host.harnesses.register` as a public,
SemVer-significant SDK contract.


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


