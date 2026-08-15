---
template: feature-impl
schema_version: 1
name: "Headless --agent inline special error across CLI, service, and workflow action"
description: ""
status: todo
type: task
profile: standard
feature_id: G5
parent_wbs: null
priority: P2
tags: ["agent", "cli-surface", "adr-047"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-15T16:12:04.361Z"
updated_at: "2026-08-15T16:54:05.828Z"
---

## 0565. Headless --agent inline special error across CLI, service, and workflow action

### Background
Explicit `--agent inline` is silently ≡ omit → `agent.default` on headless surfaces (agent-service resolution ~:1131-1136, workflow agent-run ~:129-133), so an inline request can execute in another session with zero signal — the debugging trap feature G5 removes. Design: docs/design/agent-inline-host-session.md. Error contract (operator decision 2026-08-15): hard error, no fallback, split by class — `inline` on a headless surface gets a stable greppable message at exit 2; invalid names keep the existing 0536 R3 flag-boundary rejection.
### Requirements
- [ ] **R1.** CLI boundary: `spur agent run --agent inline` exits 2 printing the frozen
      `AGENT_INLINE_HEADLESS_MESSAGE` (see Design); no agent process spawns and no `agent.default`
      fallback occurs. `--agent` help text gains the inline clause. Measurable: CLI test asserts
      exit 2 + verbatim message + dispatch mock never called.
- [ ] **R2.** Defense in depth: `agent-service` resolution (`agent-service.ts:1136`) and the
      workflow `agent.run` action (`agent-run.ts:133`) no longer normalize `inline` to
      `agent.default`; both fail with the same frozen message through their existing failure
      channels. Serve-side dispatch inherits the service-layer failure. Measurable: service-level
      and workflow-action tests assert the message; no normalization remains (grep).
- [ ] **R3.** `omit`, `--agent auto`, and named role/executor selectors keep current behavior
      (0508 native-subagent eligibility is omit-only and untouched). Measurable: regression tests
      over the three selector classes stay green. Same commit carries the ADR-047 amendment,
      `docs/04_DESIGN.md` §7.8 update, and the `docs/design/` index row (T3).
### Acceptance Criteria
Covers feature G5 scenarios:

- **R1 — Headless CLI surfaces reject --agent inline with a stable special error**
- **R3 — omit, auto, and named selectors are unchanged**
- **R5 — Invalid --agent names keep failing at the flag boundary**

```gherkin
Scenario: R1 — Headless CLI surfaces reject --agent inline with a stable special error
  Given `spur agent run` is a headless surface that cannot host a session
  When it is invoked with `--agent inline`
  Then the run exits non-zero with a stable, greppable error message naming `inline`
  And no agent process is spawned and no fallback to `agent.default` occurs

Scenario: R3 — omit, auto, and named selectors are unchanged
  Given the existing resolution paths for omitted `--agent`, `--agent auto`, and named roles
  When this feature lands
  Then their behavior, including 0508 native-subagent eligibility for omit, is unchanged

Scenario: R5 — Invalid --agent names keep failing at the flag boundary
  Given a value that is neither inline, auto, a configured role, nor a configured executor
  When `spur agent run` is invoked with it
  Then it exits with an explicit error naming the valid values before any process spawns
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Implement-ready freeze (refine --depth ready, 2026-08-15). Implements design satellite
`docs/design/agent-inline-host-session.md` § Components 1-3,6.

**Frozen names (do not rename):**

- `AGENT_INLINE_HEADLESS_MESSAGE` — exported const, single definition in
  `packages/app/src/services/agent-service.ts` (near `resolveAgent`), imported by
  `packages/app/src/workflow/actions/agent-run.ts` and `apps/cli/src/commands/agent.ts`.
  Frozen text (stable, greppable — tests assert it verbatim):
  `"--agent inline requires a host session: this surface is headless and never dispatches inline runs (no fallback to agent.default). Use 'auto', a role, or an executor name."`
- Exit code `2` at the CLI boundary (usage class, matches existing `validateAgentSelector` failure path).
- No new API surface beyond the exported const; no new flag, no config knob.

**File targets (current anchors — re-locate by name, lines drift):**

- `apps/cli/src/commands/agent.ts:165` `validateAgentSelector` — today `raw === 'inline'` returns null
  (`:167`). Change: `inline` → return `AGENT_INLINE_HEADLESS_MESSAGE` (omit/auto stay null). Both
  call sites (`:391`, `:400`) already print the message and `return 2` — reuse, no new plumbing.
  Commander `--agent` option help gains one clause: `inline` = host-session-only, errors on
  headless surfaces.
- `packages/app/src/services/agent-service.ts:1136` — remove `if (raw === 'inline') return
  this.resolveAgentAuto(flags, doctorRunner, exclude);` and rewrite the ADR-047 comment block
  (`:1131-1135`) to the new semantics. `inline` fails resolution loudly with
  `AGENT_INLINE_HEADLESS_MESSAGE` through the existing resolve-failure channel used by
  `resolvePinned` (same result shape — no new channel). `omit`/`auto`/named paths untouched.
- `packages/app/src/workflow/actions/agent-run.ts:133` — delete the
  `agent === 'inline' ? (this.agentConfig.default ?? undefined) : agent` normalization and its
  ADR-047 comment (`:131-133`); `agent === 'inline'` fails the action with
  `AGENT_INLINE_HEADLESS_MESSAGE` via the action's existing failure result. Serve-side dispatch
  inherits the service-layer failure — no extra branch there.

**Tests (siblings of each edited file):**

- `apps/cli/tests/commands/agent*.test.ts` — `validateAgentSelector('inline')` returns the frozen
  message; end-to-end `agent run --agent inline` exits 2, prints the message, spawns nothing
  (assert the dispatch mock is never called).
- `packages/app/tests/services/agent-service.test.ts` — resolution with `agent: 'inline'` fails
  with the message; `omit`/`auto`/role/executor resolution unchanged (regression guard).
- `packages/app/tests/workflow/` (agent-run action suite) — `agent: 'inline'` action fails with
  the message; a step with no `agent:` still dispatches to `agentConfig.default` (regression).

**Anti-patterns:** no fallback to `agent.default` on any surface; no spawn before the error; no new
flag/env/config; do not alter `resolveAgentAuto`, `resolvePinned`, or `getNextFallback`; do not
change the omit path (0508 native-subagent eligibility is omit-only and untouched); no PTY/terminal
reads.

**Handoffs:** 0566 documents the shipped message text and the sequential-inline contract in plugin
docs — it consumes `AGENT_INLINE_HEADLESS_MESSAGE` verbatim; keep the text stable.

**Out of scope:** serve-side-specific branches; changes to `omit`/`auto`/named behavior; message
internationalization; a dedicated exit code (2 is reused by design).
### Plan
- [ ] Add `AGENT_INLINE_HEADLESS_MESSAGE` const (frozen text in Design) to `agent-service.ts` (R1, R2)
- [ ] `validateAgentSelector` (`apps/cli/src/commands/agent.ts:165`): `inline` returns the message; help text clause (R1)
- [ ] Remove `inline → resolveAgentAuto` (`agent-service.ts:1136`) — resolution fails with the message; rewrite ADR-047 comment block (R2)
- [ ] Remove `inline → agentConfig.default` normalization (`agent-run.ts:133`) — action fails with the message (R2)
- [ ] Tests: CLI selector + no-spawn e2e; service resolution + omit/auto/named regression; workflow action failure + default regression (R1-R3)
- [ ] ADR-047 amendment entry in `docs/00_ADR.md`; `docs/04_DESIGN.md` §7.8; `docs/design/` index row for the satellite (T3, same commit)
- [ ] Grep: no remaining `inline` → `agent.default` normalization or doc equivalence in edited layers (R2)
- [ ] Run `bun run autofix && bun run spur-check`
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

L

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
