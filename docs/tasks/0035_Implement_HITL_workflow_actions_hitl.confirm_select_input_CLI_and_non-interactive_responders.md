---
name: Implement HITL workflow actions (hitl.confirm/select/input) + CLI and non-interactive responders
description: Implement HITL workflow actions (hitl.confirm/select/input) + CLI and non-interactive responders
status: Done
created_at: 2026-06-10T06:48:43.386Z
updated_at: 2026-06-10T06:48:43.386Z
folder: docs/tasks
type: task
feature-id: ""
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0035. Implement HITL workflow actions (hitl.confirm/select/input) + CLI and non-interactive responders

### Background

Adds human-in-the-loop (HITL) interactive steps to spur workflows: `hitl.confirm`, `hitl.select`,
`hitl.input`. These are **opinionated, I/O-bearing domain actions** and therefore live in spur (the
same boundary as `agent.run`/`rule.check`/`file.*` from task 0032) — **not** in the workflow engine.

**Hard dependency:** ts-libs task **0031** (the engine keystone) must be released first. It provides
the `HitlResponder` interface, `HitlRequest`/`HitlAnswer` types, and **`events` in `ActionRunContext`**
that these actions stand on. Pin the published 0031 version in the catalog before implementing.

**Why a responder seam, not `inquirer`-in-the-action:** the action runner must stay I/O-agnostic so the
same workflow runs interactively (TTY) **or** headless (CI/`--json`/web). The action emits a request and
delegates the actual prompt to an injected `HitlResponder`. This mirrors how `agent.run` delegates to
`AgentService` — the proven 0032 injection pattern.

**Operator decisions (locked):**
- Responder injected **per-host** via `registerSpurBuiltins({ …, hitlResponder })` (like
  `agentService`/`ruleService`), NOT per-run.
- **Headless / no interactive responder → return a configured default** (do not hang, do not fail by
  default).
- **`hitl.confirm` Cancel → `ok: false`** (fails the run).
- Answers flow back via **`setVars`** (engine `setVars`, available ≥ 0.3.9) so guards can branch on the
  choice, not just on `action-ok`.

### Requirements

**R1 — `HitlConfirmActionRunner` (`hitl.confirm`).** Options: `prompt` (string, required), `var`
(string, optional — the var name to store the answer in; default `__hitlAnswer`). Builds a
`HitlRequest { kind:'confirm', prompt, runId, node }`, calls `hitlResponder.respond(req)`. Maps:
`yes` → `{ ok:true, setVars:{[var]:'yes'} }`; `no` → `{ ok:true, setVars:{[var]:'no'} }`; `cancel` →
`{ ok:false, error:'hitl.confirm cancelled' }`. Emits nothing extra (the engine emits
`workflow.hitl.request`? — see Q3). Three-option Yes/No/Cancel.

**R2 — `HitlSelectActionRunner` (`hitl.select`).** Options: `prompt` (required), `options` (string[],
required, ≥1), `var` (optional, default `__hitlAnswer`). `HitlRequest { kind:'select', prompt, options,
… }`. Returns `{ ok:true, setVars:{[var]: chosen} }`. Empty `options` → `{ ok:false }`. A cancel from
the responder → `{ ok:false }`.

**R3 — `HitlInputActionRunner` (`hitl.input`).** Options: `prompt` (required), `var` (optional, default
`__hitlInput`). `HitlRequest { kind:'input', prompt, … }`. Returns `{ ok:true, setVars:{[var]: text} }`.
This is the steering-input/description use case. Empty input allowed unless a future `required` option.

**R4 — CLI responder (`ClackHitlResponder`).** Implements `HitlResponder` using **`@clack/prompts`**
(recommended over `inquirer`: smaller, modern, TS-first, better UX). `confirm` → 3-way select
(Yes/No/Cancel) mapping to `'yes'|'no'|'cancel'`; `select` → `@clack/prompts` select over `options`;
`input` → text. A clack-level cancel (Ctrl-C / `isCancel`) maps to `cancelled:true` / `value:'cancel'`.
Used only when stdout is a TTY and not `--json`.

**R5 — Non-interactive responder (`DefaultHitlResponder`).** Implements `HitlResponder` returning a
**configured default** without prompting (CI/`--json`/no TTY): `confirm` → configurable default
(default `'yes'`), `select` → first option (or configured), `input` → configured default string (or
empty). Constructed with the defaults; never reads stdin. This is what keeps `feature-dev.yaml` and CI
runs from hanging.

**R6 — Responder selection + wiring.** `registerSpurBuiltins` gains `hitlResponder: HitlResponder`.
The CLI command layer selects the responder: `isatty(1) && !jsonOutput ? new ClackHitlResponder() :
new DefaultHitlResponder(configuredDefaults)`. Pass it through `WorkflowAppServiceContext` like
`agentService`/`ruleService`. The three `hitl.*` runners take the responder in their constructors.

**R7 — Tests** (`packages/app/tests/workflow/`): each runner with a **fake `HitlResponder`** (no TTY):
confirm yes/no/cancel → ok/setVars/fail; select returns chosen → setVars; empty options → fail; input →
setVars. `DefaultHitlResponder` returns configured defaults for all three kinds. Responder-selection
logic (TTY+json → which responder). An **end-to-end** test through `StateMachineDriver`: a `hitl.input`
sets a var, a later node reads `${vars.__hitlInput}` (proves setVars across steps, like the 0032 latch
e2e test). `@clack/prompts` itself is not unit-tested (it's the I/O lib); the responder wrapper logic is.

**R8 — Gate.** `bun run check` + `bun run build` green; no regressions; `@clack/prompts` added as a
package-private dep of `apps/cli` (or wherever the responder lives) — **literal version, not catalog**
(single-workspace dep, per the SSOT rule).

### Q&A

**Q1. Why `@clack/prompts` over `inquirer`?** Smaller dep tree, modern TS-first API, better default UX,
actively maintained. `inquirer` is heavier/older. `node-notifier` is a *different axis* (fire-and-forget
desktop toast, no return value) — it cannot answer confirm/select/input; it belongs to the future
note-display responder (task 0036), not here.

**Q2. Where do the answers go?** Into run `vars` via `setVars` (engine ≥0.3.9), under a `var`-named key
(default `__hitlAnswer`/`__hitlInput`). This lets a downstream guard branch on the choice — strictly
more powerful than `action-ok`. Cancel is the exception: it fails the run (`ok:false`) per operator
decision.

**Q3. Does the action emit `workflow.hitl.request`?** Decide in design. Two options: (a) the **action**
emits it via `context.events` before calling the responder (pure observability — a UI could mirror it);
(b) skip it (the responder already does the I/O). Lean (a) for observability symmetry with
`hitl.note`/`workflow.custom`, low cost. Not gating.

**Q4. Headless default — fail or default?** **Return a configured default** (operator decision). Keeps
unattended runs (CI, `feature-dev.yaml` non-interactive) flowing. A workflow that *must* have real human
input in CI is a workflow-design problem, not this action's concern.

### Design

- **Files:** `packages/app/src/workflow/actions/hitl-confirm.ts`, `hitl-select.ts`, `hitl-input.ts`;
  responders `packages/app/src/workflow/hitl/clack-responder.ts`, `default-responder.ts` (or under
  `apps/cli` if `@clack/prompts` should not be an app-layer dep — decide by where TTY concerns belong;
  lean: responders in `apps/cli`, actions in `packages/app`, responder injected at the CLI seam).
- **Wiring:** extend `SpurWorkflowBuiltinsOptions` with `hitlResponder`; register the three actions in
  `registerSpurBuiltins`; thread `hitlResponder()` through `WorkflowAppServiceContext` and the CLI
  `makeSvc()` factory (mirror `agentService`/`ruleService`).
- **Answer shaping:** `var` option → `setVars[var] = answer.value`; cancel short-circuits to `ok:false`.

### Solution

_Pending design pass (depends on 0031 published shapes)._

### Plan

1. Pin the released ts-libs 0031 version in the catalog; `bun install`; confirm `HitlResponder` +
   `ActionRunContext.events` are present.
2. Add `@clack/prompts` (literal version) to the responder's workspace.
3. Implement `ClackHitlResponder` + `DefaultHitlResponder`.
4. Implement `hitl.confirm`/`select`/`input` action runners (answer→`setVars`, cancel→`ok:false`).
5. Extend `registerSpurBuiltins` + context + CLI responder selection (`isatty && !json`).
6. Tests (fake responder per runner + default responder + e2e setVars-across-steps).
7. Gate green; optionally add an interactive `hitl.confirm` checkpoint to a sample workflow.

### Review


---

## Finding 1 resolved — 2026-06-10 (via task 0037)

The P3 `--json` responder-selection gap is **fixed**. `context.hitlResponder(json?)` now selects the
interactive `ClackHitlResponder` only when `isatty(1) && json !== true`; `--json` always gets the
non-interactive `DefaultHitlResponder`. The `run` command passes `options.json` through `makeSvc(json)`.
Test in `apps/cli/tests/context.test.ts`; both changed files at 100% coverage; full `spur-check` green.
**0035 now has no remaining open findings.**


### Phase 8 — Requirements traceability (against real source)

| Req | Verified at | Status |
|-----|-------------|--------|
| R1 `hitl.confirm` (Yes/No/Cancel, cancel→ok:false, answer→setVars) | `hitl-confirm.ts:21-45` | MET |
| R2 `hitl.select` (options req, choice→setVars) | `hitl-select.ts:22-52` (empty options→ok:false) | MET |
| R3 `hitl.input` (text→setVars, default `__hitlInput`) | `hitl-input.ts:21-45` | MET |
| R4 CLI responder `@clack/prompts` | `clack-responder.ts` (confirm→3-way select; isCancel handled) | MET |
| R5 non-interactive default responder | `default-responder.ts` (configured defaults; index clamped) | MET |
| R6 responder selection + wiring | `builtins.ts:14-31` (per-host inject, all 7 actions); `context.ts:62` (isatty→Clack/Default); `workflow-service.ts:50,114` | MET — but selection ignores `--json` (Finding 1) |
| R7 tests incl. e2e setVars-across-steps | unit: `hitl-*.test.ts`; **e2e: ADDED this pass** `builtins.test.ts` "hitl answer propagates to a later step via setVars end-to-end" | MET (after fix) |
| R8 gate + `@clack/prompts` literal dep | lint clean; `apps/cli/package.json:69` `"@clack/prompts": "1.5.1"` (literal, not catalog ✓) | MET |

### Phase 7 — SECU

- **Security:** no secrets/injection/auth surface. Responders do TTY I/O only; default responder reads
  nothing. Clean.
- **Correctness:** all three runners guard `prompt`, default the `var`, delegate to the responder,
  cancel→`ok:false`, answer→`setVars`. `confirm` checks both `cancelled` and `value==='cancel'`
  (correct: only confirm has a cancel value). `DefaultHitlResponder` clamps `selectDefaultIndex`. Clean.
- **Efficiency/Usability:** thin adapters, consistent shape, good JSDoc, correct layer split (actions in
  `packages/app`, TTY responders in `apps/cli`). Clean.

### Findings

| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | Responder selection ignores `--json` | Correctness | `apps/cli/src/context.ts:62` | **P3.** Selects `ClackHitlResponder` on `isatty(1)` alone; R6 specified `isatty && !jsonOutput`. A `--json` run on a TTY would launch an interactive clack UI mid-run, corrupting the JSON stream and blocking a machine consumer. The `--json` flag isn't available at context-construction time (per-command option), so the fix needs the flag threaded to the responder factory or the factory deferred — not a one-liner. Low likelihood (interactive workflow + --json is unusual); failure mode is hang/corrupt-output, not data loss. Track for a follow-up. |
| 2 | (FIXED) Missing R7 end-to-end setVars test | Usability (test) | `packages/app/tests/workflow/builtins.test.ts` | **Resolved this pass.** Added an e2e test running `hitl.input → capture(${vars.__hitlInput})` through `StateMachineDriver`, asserting the answer (`'ship it'`) resolves in a later step. Closes the same class of gap that hid the 0032 inert-latch bug (unit tests passed while the cross-step path was unproven). |

No P1/P2.

### Gate (post-fix)
- `bun run lint` clean (biome + all-workspace typecheck).
- `bun test` → **445 pass / 0 fail** (444 + the new e2e test).

### Conclusion
PASS. The three `hitl.*` actions, both responders, and the wiring are correct, typed, and gate-green;
the engine `setVars` (0031/0.3.10) is consumed correctly and now **proven end-to-end** for HITL answers.
The one remaining P3 (`--json` responder selection) is tracked, not blocking.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References

- **ts-libs 0031** — engine keystone (HitlResponder contract, events-in-context). **Blocking dependency.**
- **0036** — future web/notifier responder (deferred).
- `packages/app/src/workflow/builtins.ts` — `registerSpurBuiltins` (injection site).
- `packages/app/src/workflow/actions/agent-run.ts` — the injection pattern to mirror.
- `@clack/prompts` — chosen CLI prompt library.

### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


