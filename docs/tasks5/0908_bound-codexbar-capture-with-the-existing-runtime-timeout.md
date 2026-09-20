---
schema_version: 1
name: Bound Codexbar capture with the existing runtime timeout
status: todo
template: feature-impl
created_at: 2026-09-20T15:48:46.080Z
updated_at: "2026-09-20T15:50:09.950Z"
feature_id: B61
priority: P1
tags:
  - i31-next-batch
estimate_hours: 2

ac_numbering: task-local
ac_altitude: task-local
---

## 0908. Bound Codexbar capture with the existing runtime timeout

### Background

I31/0904 measured a roughly 113-second capture and found no deadline in CodexbarUsageSource. Installed ts-runtime 0.5.0 already owns timeout, process-group cleanup and structured completion outcomes.

### Requirements

- [ ] R1. Apply a finite 180000 ms default timeout to CodexbarUsageSource through NodeProcessExecutor.run timeout; allow only an internal constructor test override, not a new public CLI flag or configuration field.
- [ ] R2. Reject timeout/abort/signal/unusable capture outcomes as UsageSourceError before producer writes, even if partial stdout happens to parse. Error text must identify timeout rather than incorrectly recommend installing the binary.
- [ ] R3. Preserve normally completed nonzero captures containing parsable arrays, including mixed healthy/provider-error entries, and preserve launch failure handling.
- [ ] R4. Prove bounded termination and fail-closed writes with a disposable hanging child and a short injected test deadline; document the limit and retained partial-provider behavior in the existing owning design.

### Acceptance Criteria

- [ ] AC1 — Codexbar capture has a finite deadline (req: R1)
- [ ] AC2 — interrupted capture cannot update availability (req: R2)
- [ ] AC3 — usable partial provider results remain supported (req: R3)
- [ ] AC4 — timeout regression leaves prior state intact (req: R4)

### Q&A

Ready freeze — 2026-09-20, inline planning owner.

- Q: Implement now or prepare delegation? A: Prepare a reviewable implementation-ready task; production implementation belongs to the delegated coding agent.
- Q: Is I31 evidence sufficient? A: The reports identify candidate defects; current source anchors substantiate the bounded fixes. The implementation starts with executable regression evidence. Sparse 0905 runs do not authorize trace/cost redesign.
- Q: Dependencies and execution order? A: No unfinished semantic upstream dependency. I31 tasks 0903/0904/0905 are done. Recommended serial order: 0906 → 0907 → 0908 → 0909. Parallel work requires isolated worktrees and serial integration; 0907/0908 share a design satellite.
- Q: Which scope choices remain open? A: None required for this task. Requirements and Design freeze the implementation behavior; freshness policy, installed role propagation, fleet receipts and cost attribution are separate follow-ups.
- Q: Feature traceability? A: B61 R3 ↔ AC1/AC2/AC4; B61 R4 ↔ AC3. Task-local AC describe the implementation checks without redefining feature shipment criteria.
- Q: How is this checked? A: Focused tests listed in Plan, then `bun run spur-check`, task verify PASS and a separate task commit. Run `bun run spur-check-feature` once per completed feature (after both tasks for B61). CLI source changes additionally require `bun link` inside apps/cli and `bun run --filter @gobing-ai/spur build:bundle` from the root. New feature completion must satisfy its real dogfood gate; historical parent evidence is not fabricated.

### Design

Use the installed @gobing-ai/ts-runtime NodeProcessExecutor.run({timeout:180000,...}) and its structured outcome. That dependency owns Unix process-group termination, kill grace and output settlement; do not add Promise.race, a second watchdog or manual pkill. Preserve the existing command-array constructor seam; add a defaulted numeric timeout argument for tests only. Validate a finite positive test override or retain the default so accidental undefined/zero cannot disable the safety boundary. Capture failure must be raised before runAgentUsageProducer reaches its snapshot write.

180 seconds is a bounded initial default with headroom above the observed 113-second all-provider capture; it is a chosen limit, not a measured percentile or provider SLA. A timed-out capture is unusable even with valid JSON output; only normal exit outcomes may preserve the existing nonzero partial-result behavior. Check runtime outcome before exit-code fallback. Keep UsageCapture and app layer spawn-free.

Test by running a disposable Bun child that writes valid JSON and then remains alive; inject a short deadline with generous CI tolerance, assert timeout error, and prove the child/owned descendant is no longer running using runtime-owned cleanup behavior. An application-level injected capture rejection asserts prior snapshot/config/observation state unchanged. Use existing tests, no live provider calls and no new test framework. Own apps/cli/src/services/agent-usage-source.ts and its tests, plus §3 timeout wording in session-pinned-dispatch.md.

No semantic implementation prerequisite. Integrate after the usage-decision task to avoid shared design/test merge work; run B61 feature-wide gates once after both tasks. Source-local CLI must be linked and bundled after source change.

Source anchors:
- `apps/cli/src/services/agent-usage-source.ts`
- `apps/cli/tests/services/agent-usage-source.test.ts`
- `packages/app/src/services/agent-usage-source.ts`
- `packages/app/src/services/agent-usage-producer.ts`
- `node_modules/@gobing-ai/ts-runtime/src/process-executor.ts`
- `docs/design/session-pinned-dispatch.md`
- `docs/reports/i31/0904-availability.md`

### Plan

- [ ] 1. Confirm runtime timeout/outcome contract in the installed dependency and add a failing hanging-child capture test (R1-R2/AC1-AC2).
- [ ] 2. Wire the default timeout and reject interrupted outcomes before parsing while keeping normal nonzero captures usable (R1-R3/AC1-AC3).
- [ ] 3. Run capture-source and usage-command tests inside apps/cli and the producer fail-closed test inside packages/app; assert prior state and child cleanup (R4/AC4).
- [ ] 4. Update the owning design, run task-local gates, rebuild/link CLI and verify; once both B61 tasks pass, run the B61 feature gate and wrap with one task commit.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
