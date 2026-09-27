---
schema_version: 1
name: Order the residual-sweep box check against the record-stage box flip
status: todo
template: feature-impl
created_at: 2026-09-27T07:11:28.202Z
updated_at: "2026-09-27T07:12:01.260Z"
feature_id: F96

ac_altitude: task-local
---

## 0983. Order the residual-sweep box check against the record-stage box flip

### Background

Found during `/sp:dev-run 0967 --auto --next --agent inline --worktree` (run `20445c34-e98e-4928-a30a-a6746f503be3`).

**Symptom.** The `verify` state's residual sweep folded the verdict `PASS` → `PARTIAL` with `blocking=13 deferrable=0`, all 13 items category `unchecked-box`: the task's 5 Requirement boxes, 2 AC boxes and 6 Plan boxes. That downgrade makes the `record → done` guard (`jq -r .verdict … == "PASS"`) unreachable, so the run cannot complete on the normal path.

**Root cause — the fold and the box flip are ordered the wrong way round.**

- `plugins/sp/scripts/residual-scan.ts:318` — `findUncheckedBoxes(taskContent)` scans the **whole** task file; there is no section exemption.
- `plugins/sp/scripts/residual-scan.ts:290` — the deferral exemption deliberately excludes `unchecked-box` (`item.category !== 'unchecked-box'`), so an unchecked box can never be deferred by a `residual-deferrals.json` entry.
- `plugins/sp/scripts/residual-scan.ts:410` — `foldVerdict` downgrades `PASS` → `PARTIAL` whenever `blocking.length > 0`.
- `packages/app/src/services/task-record.ts:189` — `flipVerifiedCheckboxes` (the verdict-driven `[ ]` → `[x]` flip, R2 task 0692) runs inside the **`record`** state.
- `config/workflows/task-pipeline.yaml` — `record` runs after `verify`, and its `record → done` guard requires a `PASS` verdict artifact.

So on the first pass — and on every pass — verify folds `PARTIAL` on a task whose Requirement/AC boxes are still unticked, while the only component that flips them runs afterwards. The verdict artifact already proves those rows (`MET`), so the boxes are *record-owned*, not unresolved work.

**Observed recovery (hand-certification, 4m45s of extra gate time).** Ticked the 13 boxes via `spur task update --section …`, re-captured the proof digest with `inline-run-setup.ts --fingerprint`, re-ran the full gate (`bun run spur-check`, 4m45s), re-ran `residual-scan scan|fold`, then re-bound the verdict with the verify state's `jq` proof block.

**Second-order cost (measured).** The Requirement/AC/Plan boxes are **inside** the proof-input scope: the certified digest moved `sha256:ac78bd41…` → `sha256:d5a73aa2…` purely from box flips, invalidating the gate receipt and forcing the gate to re-run. `## Review` / `## Testing` / `## Solution` writes do *not* move the digest (verified in the same run).

Related prior work: 0949 (scanner modes), 0950 (sweep wired into task-pipeline), 0951 (standalone verify + C6 recovery), 0977 (placeholder review rows).

### Requirements

- [ ] R1. A task whose Requirement/AC boxes are flipped by `task record` must reach `record → done` with a `PASS` verdict artifact on the normal pipeline path — no hand-certification, no extra gate run.
- [ ] R2. The chosen rule lives in exactly one owner (the residual-sweep design satellite), and both `residual-scan` and the pipeline conform to it; do not duplicate the rule in workflow prose.
- [ ] R3. A genuinely unticked box that no verdict proves must still block the fold (the sweep's protective intent is preserved — do not weaken it to "all unchecked boxes are deferrable").
- [ ] R4. Regression coverage fails if a verdict-proven, not-yet-flipped Requirement/AC box makes `foldVerdict` downgrade `PASS`.

### Acceptance Criteria

- [ ] AC1 — Verdict-proven Requirement and AC boxes do not block the fold (req: R1, R3)
- [ ] AC2 — Unproven unchecked boxes still block, and the rule has one owner (req: R2, R3)
- [ ] AC3 — A regression test pins the fold's box classification (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Chosen direction — make the box classification section-aware in `scanResiduals`.** A `unchecked-box` item located in `## Requirements` or `## Acceptance Criteria` classifies as `deferrable` rather than `blocking`; a `unchecked-box` anywhere else (`## Plan`, `## Background`, prose) stays `blocking`. Those two sections are exactly the set `task record` flips from the verdict, so the fold stops double-counting work that a later state owns, while Plan items keep their gate.

Touch points: `plugins/sp/scripts/residual-scan.ts` (the `classify`/`scanResiduals` path around :290 and the box collection at :318) plus the residual-sweep design satellite for the rule text. `residual-scan` already parses sections for review findings, so the section lookup is available rather than new machinery.

**Rejected alternatives.**

- **Move the flip into `verify`.** Verify is observe-only by contract (`/sp:dev-verify --fix none`; ADR-071 — "the verifier certifies the state, it never repairs its own subject"). Making certify mutate the corpus inverts that invariant and would let a verifier manufacture the boxes it claims to prove.
- **Have the implement agent tick Requirement/AC boxes.** Implement cannot prove AC rows (the verifier owns that verdict) and would pre-flip rows the verdict could still mark `UNMET`, which is exactly the silent-pass the fold protects against.
- **Make every `unchecked-box` deferrable.** Removes the gate for Plan items, which have no other blocker.
- **Tick boxes before `verify` in the workflow.** Requires a pre-verify flip driven by a verdict that does not exist yet — circular.

**Rule owner.** The residual-sweep design satellite (`docs/design/…residual-sweep…`, the F96 contract owner referenced at `plugins/sp/scripts/residual-scan.ts:5`) carries the section-scoped classification rule; the script implements it and the pipeline relies on it.

### Plan

- [ ] Add section-scoped classification for `unchecked-box` in `plugins/sp/scripts/residual-scan.ts` (`deferrable` in Requirements/Acceptance Criteria, `blocking` elsewhere) and update the rule in the residual-sweep design satellite.
- [ ] Extend the scanner's tests: a verdict-proven-but-unflipped Requirement/AC box folds `PASS`; a Plan box still folds `PARTIAL`.
- [ ] Re-run the affected path end to end (focused scanner tests, then the pipeline's verify→record sequence on a fixture task) and confirm `PASS` survives the fold with unflipped R/AC boxes.

**Out of scope.** The digest-move cost when a proof-input section changes (tracked as a separate finding — the gate re-run is a consequence, not the defect). The `task record` flip mechanics themselves (`packages/app/src/services/task-record.ts`) stay as they are.

**Evidence already resolved by the source session.** The 0967 run completed via hand-certification; this task removes the need for that recovery, not the 0967 evidence.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

Not yet implemented — capture only.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-27T07:12:01.260Z backlog → todo (system)

