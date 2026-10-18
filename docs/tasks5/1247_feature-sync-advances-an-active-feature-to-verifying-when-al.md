---
schema_version: 1
name: feature sync advances an active feature to verifying when all linked tasks are terminal
status: todo
template: feature-impl
created_at: 2026-10-18T05:10:06.870Z
updated_at: "2026-10-18T05:46:49.033Z"
feature_id: D66
priority: P1
tags:
  - workflow
  - feature-lifecycle

dependencies: ["1246"]
estimate_hours: 4
---

## 1247. feature sync advances an active feature to verifying when all linked tasks are terminal

### Background

Covers feature scenario R4. Design: docs/design/workflow-consolidation.md §3.2.

**Refine correction (2026-10-18, depth ready).** The filed premise "a feature reaches verifying only by an explicit `spur feature update`" is false:

- `deriveFeatureStatus` (packages/app/src/services/feature-service.ts:539-609) already proposes `active→verifying` when every linked task is terminal and at least one is done. It proposes `→verifying→done` when the receipt is valid, and stops at `verifying` with `receiptPending` when it is missing (1119).
- `runSyncFeature` (feature-service.ts:675-731) applies each hop through `transition` → write service → `lifecycle.requestTransition` (packages/app/src/services/planning-write-service.ts:471). So the guarded edge and the `verifying` onEnter already run during a sync (packages/app/src/workflow/lifecycle-adapter.ts:336).
- Sync also advances `backlog`/`blocked` features; the filed R3 "a feature not in active is left unchanged" contradicts that shipped behaviour and is dropped.
- task-pipeline's `done` close already calls `spur feature sync <fid>` best-effort, and `deferFeatureSync` already skips it (config/workflows/task-pipeline.yaml:755). The filed R4 is a no-change constraint, kept as out-of-scope.

The valid residual gap after 1246: the `verifying` onEnter now runs `spur feature verify` directly. A sync with a missing receipt plans only `['verifying']`, because the hops were derived before the pass ran. A PASS recorded by that onEnter therefore needs a second `feature sync` to reach `done`, and today no test proves the onEnter → receipt → done chain.

### Requirements

- [ ] R1. After a sync hop lands in `verifying` and the derived proposal stopped there on `receiptPending`, `runSyncFeature` re-derives once. When the new proposal is `verifying→done` (PASS receipt from the onEnter pass), it applies that hop in the same call.
- [ ] R2. A FAIL or missing receipt after the re-derive leaves the feature in `verifying`. The result's reason names the receipt finding and the rework edge (`spur feature update <id> --status active`), and sync exits 0.
- [ ] R3. The re-derive runs at most once per call, and never when the verifying hop was not applied (guard denied, goal conflict, dry-run).
- [ ] R4. An E2E proof drives a fixture feature (one task done, one cancelled) from `active` through one `feature sync`: it runs the verifying onEnter exactly once and lands in `done` on PASS, or in `verifying` on FAIL. A sibling feature with one `wip` task stays `active`.

Out of scope:
- Derivation rules (≥1 done, backlog/blocked hops, reopen, deprecated sticky).
- `deferFeatureSync`.
- The 1004 blocked-sync fingerprint.
- An all-cancelled feature never advances. That is the shipped "at least one done" rule.

### Acceptance Criteria

- [ ] AC1 — A feature with every linked task terminal can advance to verifying on its own (req: R1, R2, R3, R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-18T05:46:48.134Z

- Q: Should sync also advance a feature whose linked tasks are all cancelled? A: No. The shipped rule requires at least one done task (feature-service.ts:539). The D66 R4 Given ("done or cancelled") is met by a mixed fixture.
- Q: Re-derive inside sync, or let task-pipeline call sync twice? A: Re-derive in sync. One owner, and every caller (CLI, task-pipeline done close, `check --fix`) gets it.

### Design

Chosen: one bounded re-derive in `runSyncFeature`, after the hop loop, when the last applied hop is `verifying` and the original proposal had `receiptPending`. It calls `deriveFeatureStatus` again. Only a `to: 'done'` proposal with hops `['done']` is applied, through the same `transition` path inside the existing `finally` refresh.

Rejected:
- An auto-advance edge in feature-lifecycle: it is externally driven, and `requestTransition` never chains.
- Deriving hops after each transition generally: that widens blast radius to every sync path.
- Running `feature verify` from sync: the onEnter already owns the pass (1246).

Frozen names: none new. The extension stays inside `runSyncFeature`, and `FeatureSyncResult.appliedHops` reports both hops.

File targets:
- packages/app/src/services/feature-service.ts:675-731 — the re-derive.
- packages/app/tests/services/feature-service.test.ts — the receiptPending → re-derive cases (PASS → done, FAIL → verifying, denied hop → no re-derive).
- apps/cli/tests/commands/feature.test.ts — the E2E: a fixture project, the bundled feature-lifecycle, and a stub `spurBin` whose `feature verify` writes a PASS/FAIL receipt.
- plugins/sp/skills/spur-cli/references/features.md:243-275 — sync section: the single-call `active→verifying→done` on PASS.

Invariants:
- Sync never writes status directly.
- The `verifying→done` guard stays the authority.
- The verify pass runs once per sync.

Anti-patterns:
- No loop to a fixpoint.
- No new sync flag.
- No YAML change; 1246 owns the onEnter.

Handoffs:
- Depends on 1246 (direct onEnter and receipt identity).
- 1249's wrapup no longer moves feature state, so this is the forward path.
- 1252 sweeps the dev-wrap and dev-runall wording.

Execution budget: about 4h. Persisted artifacts: test files plus the features.md diff. requireDiff: yes.

### Plan

- [ ] Write the failing unit cases in feature-service.test.ts: receiptPending + onEnter PASS → `appliedHops: ['verifying','done']`; FAIL → `['verifying']` with the rework reason; guard-denied verifying → no re-derive.
- [ ] Write the failing E2E in apps/cli/tests/commands/feature.test.ts with the stub verifier: one sync from active → done on PASS; FAIL → verifying; a wip sibling stays active; onEnter call count is 1.
- [ ] Implement the bounded re-derive in `runSyncFeature`.
- [ ] Update the features.md sync section.
- [ ] Run the targeted tests (`cd packages/app && bun test tests/services/feature-service.test.ts`; `cd apps/cli && bun test tests/commands/feature.test.ts`), then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-18T05:21:28.222Z feature_id Q → D66 (system)

