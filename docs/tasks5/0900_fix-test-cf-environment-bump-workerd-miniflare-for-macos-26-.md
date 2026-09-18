---
schema_version: 1
name: "Fix test-cf environment: bump workerd/miniflare for macOS 26.5 and re-verify 0897 to done"
status: todo
template: feature-impl
created_at: 2026-09-18T22:34:41.215Z
updated_at: "2026-09-18T22:39:40.710Z"
feature_id: G66

---

## 0900. Fix test-cf environment: bump workerd/miniflare for macOS 26.5 and re-verify 0897 to done

### Background

Restore a runnable `bun run test-cf` (apps/server Cloudflare Workers vitest pool) so task 0897 can re-verify to PASS and reach done. Gates 0897 completion; no G66 feature surface change.
`bun run test-cf` segfaults (signal 11) in miniflare 4.20260526.0 cloudflare-pool worker startup — zero tests execute ("Worker exited unexpectedly"). Reproduced 2026-09-18 under bun 1.3.14 AND node 26.5.0, and on clean base @ eae5c7ac6. workerd standalone `--version` works. Pool deps unchanged in bun.lock since 2026-05-30; last recorded test-cf PASS 2026-08-10 (0503/0504). Host macOS updated to 26.5 (25F71) in between — suspected macOS-vs-workerd incompatibility.

### Requirements

- **R1** Bump miniflare/workerd (and `@cloudflare/vitest-pool-workers` if coupled) to a macOS 26.5 aarch64-compatible version; update `bun.lock` + catalog pins; no unrelated dependency drift.
- **R2** **Re-pack the ts-ai-runner overlay before/after any `bun install`** — top-level `node_modules/@gobing-ai/ts-ai-runner` and the `.bun/@gobing-ai+ts-ai-runner@0.4.68+2375bb4235721b28/…` store path must both carry the packed persistent-stdin build, or G66 agent tests regress.
- **R3** `bun run test-cf` green on this host (tests actually execute); `bun run spur-check` still PASS.
- **R4** Re-run 0897 verify (fresh sp-super-reviewer, observe-only) → verdict PASS → record → done. AC2 evidence must cite the gate's redelivery regression suites as `test`-type evidence (manual-review-only AC evidence is mechanically downgraded to PARTIAL by the verdict evidence rule).

### Acceptance Criteria

- [ ] AC1 — `bun run test-cf` executes its tests and passes on this macOS 26.5 host (req: R1, R3)
- [ ] AC2 — 0897 re-verifies PASS and reaches done with an honest verdict artifact (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-18T22:39:40.710Z backlog → todo (system)

