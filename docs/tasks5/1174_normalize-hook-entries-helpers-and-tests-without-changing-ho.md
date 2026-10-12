---
schema_version: 1
name: Normalize hook entries helpers and tests without changing host behavior
status: done
template: feature-impl
created_at: 2026-10-12T03:34:10.714Z
updated_at: "2026-10-12T18:10:00.275Z"
feature_id: A91
priority: P1
tags:
  - script-consolidation
estimate_hours: 6

dependencies: ["1173"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1174-verdict.json
---

## 1174. Normalize hook entries helpers and tests without changing host behavior

### Background

Implements: R2 — Hook entries preserve behavior with helpers and tests in their owners.

Plan and detailed dispositions: docs/plans/2026-10-11-harness-script-consolidation.md. Scope is this vertical slice only; unrelated current edits are foreign.

**Refine corrections (2026-10-11)**

- One configuration occurrence was ambiguous → one identity/entry may serve several events; preserve shared agent-lifecycle.
- Unregistered careful-guard looked stale → README explicitly documents opt-in use and Pi consumes the same destructive policy.
- Core extraction destinations and tests were unspecified → froze lib basenames and tests/hooks, retaining original installed entry paths.
- New strict layout gate lacked sequencing → activate the 1173 helper only after hook relocation.

### Requirements

- [x] R1. Keep the six registered hook identities, shared lifecycle entry, opt-in careful-guard and plugin-declared Pi extension at their current entry paths.
- [x] R2. Move hook helper/capture cores into plugin lib, move every hook/extension test into plugins/sp/tests/hooks, and update imports and platform callers without duplicated capture policy.
- [x] R3. Activate the strict hook-layout checker from 1173 once the move is complete; prove redaction, session ownership, destructive/task guard and installed extension behavior.

Out of scope: No new public CLI API: do not add/change a spur noun, verb, flag, hidden command, output/error contract or implicit automation. Use current services and the explicitly documented standalone packaging exception. Do not edit generated adapters by hand. Preserve supported installed argv and exit behavior, redaction, validation, run identities and durable evidence. No new dependency, generic runner, lock manager or unrelated refactor. Only planning sections are changed by this refinement; implementation owns Solution/Testing/Review.

### Acceptance Criteria

- [x] AC1 — Hook entries preserve behavior with helpers and tests in their owners (req: R1)

Given the supported source and installed contracts, when the focused fixtures exercise this migration, then behavior and failure policy remain compatible. Verification lens: Migrate and run the existing hook, token-estimate, session owner and Pi regression tests under plugins/sp/tests/hooks. Extend scripts/commands/script-contract-check.test.ts for shared lifecycle, opt-in careful-guard, Pi entry and stray helper/test cases. Use temporary context directories and real core calls to observe redaction-before-persistence, byte caps, nested owner refusal, duplicate-stop behavior and fail-open guards. Validate isolated Superskill hook run and Pi loader via plugin-smoke; no token/API call required.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-12T03:58:04.373Z

- Closed: no public API or hook registration change; helpers move, entry identities stay.
- Closed: preserve careful-guard opt-in and Pi extension independently of hooks.json membership.
- Closed: ADR-129 local capture is the explicit runtime exception; do not move capture to a per-event CLI subprocess.

### Design

Frozen layout: move agent-hint.ts, context-owner.ts, destructive-policy.ts and task-file-policy.ts to `plugins/sp/lib/` with the same basenames. Extract context-post-tool/session-start/session-stop implementations into `plugins/sp/lib/context-post-tool.ts`, `context-session-start.ts`, `context-session-stop.ts`; retain argv/stdin/main adapters at the original hook paths. Preserve existing exported core names and signatures in their new lib modules. Pi imports the new lib cores directly; lifecycle reporting may remain a callable hook entry. Do not maintain duplicate implementations or compatibility re-export files in hooks solely to satisfy tests.

Move hook *.test.ts files, including Pi's test, to `plugins/sp/tests/hooks/` (Pi under hooks/pi) and fix every relative fixture/helper import. Keep hooks/hooks.json and plugin.json's extension path stable. Superskill hook run remains the installed hook invocation; the Pi host loader remains its extension entry. `careful-guard` is explicitly documented opt-in/unwired and is not deleted as an unregistered helper. `agent-lifecycle` legitimately serves multiple event occurrences from one entry.

Activate checkHookLayout using hooks.json entries, plugin.json extensions and the explicit opt-in careful-guard contract in its fixture expectations. No second registration manifest. Test absence of stray helper/tests in hooks and presence of the opt-in/extension entries. Preserve Bun behavior in stdin adapters and source-local test preloads. No CLI process is inserted into every capture event; ADR-129 standalone bounded capture remains valid.

Dependencies and handoff: Requires 1173 checkHookLayout and source-boundary fixture semantics. Leaves stable installed hook paths and lib cores; no application service ownership moves are handed to 1176/1177.

Primary references: `plugins/sp/hooks/hooks.json:1`; `plugins/sp/plugin.json:6`; `plugins/sp/README.md:515`; `plugins/sp/hooks/context-session-start.ts:128`; `plugins/sp/hooks/context-session-stop.ts:133`; `plugins/sp/hooks/context-post-tool.ts:68`; `plugins/sp/hooks/pi/guard-extension.ts:1`; `plugins/sp/hooks/context-hooks.test.ts:22`.

Environment and scope: root Bun/TypeScript workspaces and existing Superskill conversion; no dependency change. No wip tasks or extra worktrees were present at the frozen batch kickoff. Recheck conflict scope before implementation; prior A91 planning edits are part of the operator-authorized context.

No new public CLI API: do not add/change a spur noun, verb, flag, hidden command, output/error contract or implicit automation. Use current services and the explicitly documented standalone packaging exception. Do not edit generated adapters by hand. Preserve supported installed argv and exit behavior, redaction, validation, run identities and durable evidence. No new dependency, generic runner, lock manager or unrelated refactor. Only planning sections are changed by this refinement; implementation owns Solution/Testing/Review.

### Plan

- [x] 1. Verify 1173 exported checker contract and existing hooks/extensions before moving files.
- [x] 2. Move helper/core modules with existing names/signatures, reduce original hooks to adapters, and switch Pi imports to the single cores.
- [x] 3. Move all hook tests/fixtures to plugin tests/hooks and update README/source structure assertions and imports.
- [x] 4. Activate checkHookLayout in the existing placement scan, shrink moved budget baseline rows, regenerate/install with Superskill, and run host regression + isolated install smoke + task-local gate.

### Solution

Task 1174 moved the hook layer onto the ADR-130 layout without changing host behavior: entries keep their paths, logic moved to plugin lib, suites moved to the plugin test owner, and the 1173 layout checker is now enforced.

Hook entries (paths and installed contracts unchanged):

- `plugins/sp/hooks/context-post-tool.ts:13` — adapter only: resolve the context dir, parse stdin, call `recordToolUseEvent`, exit 0 on every error path. The redaction, 4 KiB cap and unknown-token policy did not move into the adapter.
- `plugins/sp/hooks/context-session-start.ts:10` and `plugins/sp/hooks/context-session-stop.ts:10` — the same shape for session open and teardown, so the owner gate that kept a nested `agent.run`'s shutdown a no-op now lives in the core.
- `plugins/sp/hooks/task-write-guard.ts:23`, `plugins/sp/hooks/careful-guard.ts:26` and `plugins/sp/hooks/pi/guard-extension.ts:31` — redirected at the shared policy cores, so the Claude entry and the Pi extension classify destructive commands and task paths through one implementation.
- `plugins/sp/hooks/hooks.json:1` and `plugins/sp/plugin.json:6` — untouched: the six registered identities, the shared `agent-lifecycle` entry across four event occurrences and the declared Pi extension resolve exactly as installed.

Plugin lib cores:

- `plugins/sp/lib/context-post-tool.ts:26` — capture core (token cascade, secret scrubbing, bounded summary); `plugins/sp/lib/context-session-start.ts:17` and `plugins/sp/lib/context-session-stop.ts:24` — session open/ownership and owner-gated teardown.
- `plugins/sp/lib/agent-hint.ts:1`, `plugins/sp/lib/context-owner.ts:1`, `plugins/sp/lib/destructive-policy.ts:1`, `plugins/sp/lib/task-file-policy.ts:1` — helpers moved at the same basenames, so callers changed import depth only.
- No compatibility re-export files: the cores dropped the pass-through exports that only tests consumed, and every consumer now names the owning module.

Tests:

- `plugins/sp/tests/hooks/context-hooks.test.ts:24` and its eight siblings — suites moved to the plugin test owner; the hooks root is derived from the test file rather than assumed, so the fixtures follow the tree.
- `plugins/sp/hooks/pi/guard-extension.ts:1` stays the single Pi entry, and `plugins/sp/tests/hooks/pi/guard-extension.test.ts:1` is its suite, and drives the real `tool_call` handler against the lib cores.

Enforcement and docs:

- `scripts/commands/script-contract-check.ts:749` — `checkPlacement` now calls `checkHookLayout`, so a stray helper, a misplaced hook test or an unregistered identity fails the placement gate instead of passing review.
- `config/script-placement-baseline.json:1` — the stale `plugins/sp/hooks/context-post-tool.ts:1` budget row was removed (the entry is 28 lines now); the Pi extension row remains because it is still over budget.
- `scripts/commands/script-contract-check.test.ts:673` — the activation fixture (stray helper + misplaced test) and the updated baseline reconciliation; `plugins/sp/README.md:276` and `plugins/sp/README.md:531` document the entry/lib/test split.

Deferred: no application-service ownership moved here, so 1176/1177 keep their own handoffs. The 1173 helper's `hook-layout` kind was already in the placement contract; this task only switched the call on.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Registered identities unchanged in `plugins/sp/hooks/hooks.json:1` (six identities, one shared `agent-lifecycle` entry across four event occurrences); their entry files still resolve at `plugins/sp/hooks/task-write-guard.ts:1`, `plugins/sp/hooks/context-post-tool.ts:1`, `plugins/sp/hooks/context-session-start.ts:1`, `plugins/sp/hooks/context-session-stop.ts:1`, `plugins/sp/hooks/agent-lifecycle.ts:1` and `plugins/sp/hooks/fleet-guest-stop.ts:1`; the opt-in guard and the plugin-declared Pi extension keep their paths `plugins/sp/hooks/careful-guard.ts:1` and `plugins/sp/hooks/pi/guard-extension.ts:1`, with the extension still declared in `plugins/sp/plugin.json:6` |
| R2 | MET | Helpers moved to lib: `plugins/sp/lib/agent-hint.ts:1`, `plugins/sp/lib/context-owner.ts:1`, `plugins/sp/lib/destructive-policy.ts:1`, `plugins/sp/lib/task-file-policy.ts:1`; cores extracted to `plugins/sp/lib/context-post-tool.ts:26`, `plugins/sp/lib/context-session-start.ts:17` and `plugins/sp/lib/context-session-stop.ts:24` with the entries reduced to argv/stdin adapters; every suite relocated under `plugins/sp/tests/hooks/` (nine files, Pi at `plugins/sp/tests/hooks/pi/guard-extension.test.ts:1`) and the moved fixture test `plugins/sp/tests/hooks/context-hooks.test.ts:24` re-derives its hooks root rather than assuming it; one capture policy — the Pi extension and the Claude entry both call the same cores `plugins/sp/hooks/pi/guard-extension.ts:31` and `plugins/sp/hooks/context-post-tool.ts:13` |
| R3 | MET | Strict checker activated in the placement scan `scripts/commands/script-contract-check.ts:749` (task 1173 helper is now the enforcement path) and exercised in `scripts/commands/script-contract-check.test.ts:686` plus the activation fixture `scripts/commands/script-contract-check.test.ts:673`; real tree scan reports `0 finding(s) — PASS`. Behaviour lenses: redaction/byte caps and session ownership in `plugins/sp/tests/hooks/token-estimate.test.ts:21` and `plugins/sp/tests/hooks/context-hooks.test.ts:21`; destructive + task guard parity in `plugins/sp/tests/hooks/destructive-policy.test.ts:119` and `plugins/sp/tests/hooks/task-write-guard.test.ts:22`; installed extension/hook resolution in the plugin install smoke run (`bun run plugin-smoke` → `plugin-install-smoke PASS`) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Hook entries preserve behavior with helpers and tests in their owners (req: R1) | MET | command | Full gate through the sanctioned primitive (`wbs=1174 bun plugins/sp/scripts/quality-gate.ts run`) → `quality gate PASS (attempts: 1)`; durable `.spur/run/1174-test-gate.status` (`PASS`) and `.spur/run/1174-test-gate.log:455` (`11077 pass`, `0 fail`), `:15` (51 pre-check rules), `:460` (2 post-check rules), `:3` (1356 files formatted/linted); hook suites alone `cd plugins/sp && bun test tests/hooks/` → `387 pass / 0 fail` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

**Confidence:** MEDIUM

The gap: the hook move and the activated layout checker were verified by the tree’s own full gate, `plugin-smoke` and the hook suites, but these hops ran out of band from the pipeline. So the `test` hop never captured `proofDigest` and no digest-bound
`.spur/run/1174-check-receipt.json` exists; the deciding evidence is
`.spur/run/1174-test-gate.status` plus its log. A pipeline-driven run that writes that receipt
is what raises this to HIGH.

### References

Feature A91; ADR-130 (2026-10-11 amendment), ADR-129, ADR-065 and ADR-021. Detailed investigation: `docs/plans/2026-10-11-harness-script-consolidation.md`.

Premise sources:
- `plugins/sp/hooks/hooks.json:1`
- `plugins/sp/plugin.json:6`
- `plugins/sp/README.md:515`
- `plugins/sp/hooks/context-session-start.ts:128`
- `plugins/sp/hooks/context-session-stop.ts:133`
- `plugins/sp/hooks/context-post-tool.ts:68`
- `plugins/sp/hooks/pi/guard-extension.ts:1`
- `plugins/sp/hooks/context-hooks.test.ts:22`

### History

- 2026-10-12T05:36:21.480Z todo → wip (system)
- 2026-10-12T05:36:27.850Z wip → testing (system)
- 2026-10-12T05:36:38.404Z testing → done (system)

