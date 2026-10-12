---
schema_version: 1
name: Normalize hook entries helpers and tests without changing host behavior
status: todo
template: feature-impl
created_at: 2026-10-12T03:34:10.714Z
updated_at: "2026-10-12T04:01:53.980Z"
feature_id: A91
priority: P1
tags:
  - script-consolidation
estimate_hours: 6

dependencies: ["1173"]
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

- [ ] R1. Keep the six registered hook identities, shared lifecycle entry, opt-in careful-guard and plugin-declared Pi extension at their current entry paths.
- [ ] R2. Move hook helper/capture cores into plugin lib, move every hook/extension test into plugins/sp/tests/hooks, and update imports and platform callers without duplicated capture policy.
- [ ] R3. Activate the strict hook-layout checker from 1173 once the move is complete; prove redaction, session ownership, destructive/task guard and installed extension behavior.

Out of scope: No new public CLI API: do not add/change a spur noun, verb, flag, hidden command, output/error contract or implicit automation. Use current services and the explicitly documented standalone packaging exception. Do not edit generated adapters by hand. Preserve supported installed argv and exit behavior, redaction, validation, run identities and durable evidence. No new dependency, generic runner, lock manager or unrelated refactor. Only planning sections are changed by this refinement; implementation owns Solution/Testing/Review.

### Acceptance Criteria

- [ ] AC1 — Hook entries preserve behavior with helpers and tests in their owners (req: R1)

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

- [ ] 1. Verify 1173 exported checker contract and existing hooks/extensions before moving files.
- [ ] 2. Move helper/core modules with existing names/signatures, reduce original hooks to adapters, and switch Pi imports to the single cores.
- [ ] 3. Move all hook tests/fixtures to plugin tests/hooks and update README/source structure assertions and imports.
- [ ] 4. Activate checkHookLayout in the existing placement scan, shrink moved budget baseline rows, regenerate/install with Superskill, and run host regression + isolated install smoke + task-local gate.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
