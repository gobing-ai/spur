---
name: Plugin harness registry (AgentShim overlay)
description: Plugin harness registry via a Spur-side AgentShim overlay map — no upstream gate (ADR-012)
status: Blocked
created_at: 2026-06-03T17:06:55.431Z
updated_at: 2026-06-03T22:40:01.303Z
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

Phase 5d of the plugin system (ADR-012). **DEFERRED** as of 2026-06-03 (ADR-012 addendum) — not
built pending Phase 5f. This section supersedes the original "NOT upstream-blocked" framing.

**Original premise (still partly true):** `@gobing-ai/ts-ai-runner` models agents with a *structural*
`AgentShim` interface; the `AgentName` union is compile-time only — at runtime `AGENT_SHIMS` is a
plain object, `isAgentName` is `Object.hasOwn(AGENT_SHIMS, v)`, `getAgentShim(a)` is `AGENT_SHIMS[a]`.
A Spur-side overlay `Map<string, AgentShim>` checked before `getAgentShim` **resolves** a plugin shim
with no upstream change.

**Why it is deferred (decision 2026-06-03):**

1. **No PRD-committed consumer.** `01_PRD §1`/`§5.1` enumerate exactly 7 supported agents (Claude,
   Codex, Gemini, Antigravity, pi, OpenCode, OpenClaw). No committed product surface needs
   user-defined / plugin-defined agent types. Building the overlay now is speculative infrastructure
   (R2): its only real consumer is the **unscheduled 5f** built-in-harness migration.
2. **Execution is upstream-blocked.** `AiRunner.runPromptCommand(agent: AgentName, …)` accepts only
   the closed `AgentName` union and re-resolves via `getAgentShim` internally. Resolving a plugin
   shim through the overlay does **not** let `AiRunner` run it. `spur agent run --agent <plugin-type>`
   therefore requires *either* an upstream `AiRunner` change to accept an injected `AgentShim`, *or*
   Spur re-implementing the subprocess + identity-preamble path (duplicating the runner). The
   original task framed this upstream change as an "optional nicety" — it is in fact the prerequisite
   for the execution requirement, contradicting ADR-012's "no upstream change" claim (now scoped to
   resolution only; see ADR-012 addendum).

**Reactivation criteria:** schedule 5f, OR a concrete product need for plugin-defined harnesses
appears. At that point the upstream `AiRunner` shim-injection is the first dependency to land.


### Requirements

**Status: DEFERRED — do not implement until reactivation criteria (see Background) are met.**

When reactivated, the build must cover (in dependency order):

1. **[Prerequisite, upstream]** `@gobing-ai/ts-ai-runner` enhancement so `AiRunner` can execute an
   injected `AgentShim` (e.g. `runPromptCommand(agent: AgentName | AgentShim, …)`), released by
   semver. Per the shared-library-evolution rule, fix the boundary upstream rather than duplicating
   runner internals in Spur.
2. Spur-side `HarnessRegistry` overlay `Map<string, AgentShim>` in the app layer (which already
   depends on `ts-ai-runner`; the SDK must stay `ts-infra` + `zod` only). Resolution: overlay first,
   then `getAgentShim` for built-ins — one map, no built-in-vs-plugin branching.
3. `host.harnesses.register(typeName, shim)` accepts any object satisfying the structural `AgentShim`
   contract (`name`, `command`, `tier`, `getHelpCommand`, `getVersionCommand`, `getPromptCommand`,
   `getAuthCommand`); validated at registration time. Public, SemVer-significant SDK contract.
4. After registration, `spur agent create --type <plugin-type>` and `spur agent run --agent
   <plugin-type>` resolve **and execute** through the overlay; `spur agent list --types` shows plugin
   harnesses.
5. Collision with a built-in or another plugin's type → error at registration.
6. Tests: register a fake harness, assert resolution + execution + list; assert collision rejection.

**SUBSTRATE note (ADR-012 Decision 7):** this registry is the first instance of the "built-ins are
pre-registered through the same path as plugins" model, so the 7 built-in `AgentShim`s become
pre-registrations in the overlay and the 5f migration is a *move*, not a re-architecture. This is the
reason 5d only earns its keep once 5f is scheduled.


### Q&A

**2026-06-03 — Deferral decision (operator-approved).**

Q: Do we actually need a plugin harness registry (5d) now?
A: No. Analysis during a `dev-run 0015` attempt found: (a) no PRD-committed consumer — the product
targets a fixed set of 7 mainstream agents and does not ask for user-defined agent types; (b) the
overlay's only real consumer is the unscheduled 5f built-in-harness migration; (c) the execution path
is upstream-blocked — `AiRunner` accepts only the closed `AgentName` union, so resolving a plugin shim
via the overlay does not let it run. Building now would be speculative infrastructure (R2) plus either
an upstream change or a duplicated runner.

Decision: defer. Recorded as a dated ADR-012 addendum; 5d marked deferred in `02_ROADMAP`; this task
set to `Blocked` with reactivation criteria + the upstream prerequisite captured above. No code
shipped.


### Design



### Solution



### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


