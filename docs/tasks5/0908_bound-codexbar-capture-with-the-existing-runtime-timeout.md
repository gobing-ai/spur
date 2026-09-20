---
schema_version: 1
name: Bound Codexbar capture with the existing runtime timeout
status: done
template: feature-impl
created_at: 2026-09-20T15:48:46.080Z
updated_at: "2026-09-20T19:55:49.268Z"
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

- [x] R1. Apply a finite 180000 ms default timeout to CodexbarUsageSource through NodeProcessExecutor.run timeout; allow only an internal constructor test override, not a new public CLI flag or configuration field.
- [x] R2. Reject timeout/abort/signal/unusable capture outcomes as UsageSourceError before producer writes, even if partial stdout happens to parse. Error text must identify timeout rather than incorrectly recommend installing the binary.
- [x] R3. Preserve normally completed nonzero captures containing parsable arrays, including mixed healthy/provider-error entries, and preserve launch failure handling.
- [x] R4. Prove bounded termination and fail-closed writes with a disposable hanging child and a short injected test deadline; document the limit and retained partial-provider behavior in the existing owning design.

### Acceptance Criteria

- [x] AC1 — Codexbar capture has a finite deadline (req: R1)
- [x] AC2 — interrupted capture cannot update availability (req: R2)
- [x] AC3 — usable partial provider results remain supported (req: R3)
- [x] AC4 — timeout regression leaves prior state intact (req: R4)

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

- [x] 1. Confirm runtime timeout/outcome contract in the installed dependency and add a failing hanging-child capture test (R1-R2/AC1-AC2).
- [x] 2. Wire the default timeout and reject interrupted outcomes before parsing while keeping normal nonzero captures usable (R1-R3/AC1-AC3).
- [x] 3. Run capture-source and usage-command tests inside apps/cli and the producer fail-closed test inside packages/app; assert prior state and child cleanup (R4/AC4).
- [x] 4. Update the owning design, run task-local gates, rebuild/link CLI and verify; once both B61 tasks pass, run the B61 feature gate and wrap with one task commit.

### Solution

Implemented per Design; all changes CLI-layer capture + tests + owning design.

Change map:

- `apps/cli/src/services/agent-usage-source.ts:24` — `DEFAULT_CAPTURE_TIMEOUT_MS = 180_000` (bounded headroom above the ~113 s I31/0904 capture; chosen limit, not an SLA).
- `apps/cli/src/services/agent-usage-source.ts:38` — constructor gains a defaulted `timeoutMs` test-only override; non-finite/non-positive values (0/NaN/negative/Infinity) fall back to the default so the boundary cannot be disabled accidentally (R1).
- `apps/cli/src/services/agent-usage-source.ts:55` — `NodeProcessExecutor.run({ timeout })` passes the deadline; the runtime's group-owned containment (SIGTERM → escalate → output settlement) provides termination + cleanup; no caller-side watchdog (Design).
- `apps/cli/src/services/agent-usage-source.ts:66` — structured `outcome` checked before the exit-code/parsing fallback: `timeout|cancelled` ⇒ `UsageSourceError` naming the deadline and explicitly not the install advice; `signal|error` ⇒ fail-closed unusable-capture error; only `outcome: 'exit'` reaches the existing nonzero pass-through (R2/R3).

Tests:

- `apps/cli/tests/services/agent-usage-source.test.ts` — regression: disposable Bun child writes valid JSON `[]` then hangs; injected 2000 ms deadline asserts `UsageSourceError` containing `deadline` (and not `install codexbar`), then probes the child pid with `kill(pid, 0)` to prove runtime-owned reaping (R4/AC1/AC2).
- `packages/app/tests/services/agent-usage-producer.test.ts` — R4 (0908): seeded prior state (snapshot + observation row + config), then an injected timed-out capture rejection; asserts snapshot bytes, observation row, and config ownership all unchanged (AC4).

Design:

- `docs/design/session-pinned-dispatch.md` §3.4 steps 1 and 5 — documents the 180000 ms default, runtime-owned termination, and that retained partial-provider behavior applies only to normally completed runs (R4).

No public CLI flag or config field was added; app layer stays spawn-free.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/services/agent-usage-source.ts:21` — `DEFAULT_CAPTURE_TIMEOUT_MS = 180_000`; `:36-38` — defaulted constructor `timeoutMs` test-only override, non-finite/non-positive falls back to default; `:52` — `NodeProcessExecutor.run({ timeout })`; runtime owns the boundary (`node_modules/@gobing-ai/ts-runtime/src/process-executor.ts:72,129-129` — `timeout?: number |
| R2 | MET | `apps/cli/src/services/agent-usage-source.ts:64-75` — structured `outcome` checked before any exit-code/parsing fallback: `timeout |
| R3 | MET | Normal nonzero pass-through preserved: `apps/cli/tests/services/agent-usage-source.test.ts:51-56` (exit 1 with parsable `[]` returns capture, only `outcome: 'exit'` reaches it per source `:76-83`); mixed healthy/provider-error entries still applied: `apps/cli/tests/commands/agent-usage.test.ts:154-155` (openai `error` skipped, grok `headroom` applied); launch-failure handling preserved: `agent-usage-source.test.ts:62-70` (missing binary fail-closed). |
| R4 | MET | Bounded termination proven: disposable Bun child writes valid JSON then hangs; injected 2000 ms deadline ⇒ `UsageSourceError`, child pid probed with `kill(pid,0)` and not alive (`apps/cli/tests/services/agent-usage-source.test.ts:72-102`). Fail-closed writes proven: injected timed-out capture rejection leaves snapshot bytes, observation row and config ownership unchanged (`packages/app/tests/services/agent-usage-producer.test.ts:168-203`). Limit + retained partial-provider behavior documented in owning design (`docs/design/session-pinned-dispatch.md:59,63` — §3.4 steps 1 and 5). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Finite deadline: `agent-usage-source.ts:21,36-38,52`; hanging-child test green with injected 2 s deadline (`agent-usage-source.test.ts:72`, "hanging capture hits the deadline and the child is reaped" pass, 2131.86 ms). |
| AC2 | MET | test | Interrupted capture cannot update availability: outcome gate before parsing (`agent-usage-source.ts:64-75`) + producer fail-closed test asserting snapshot/row/config unchanged (`agent-usage-producer.test.ts:168-203`). |
| AC3 | MET | test | Usable partial provider results preserved: nonzero pass-through (`agent-usage-source.test.ts:51`) and mixed healthy/error entries applied (`agent-usage.command test:154-155`); only normally completed runs keep this (`agent-usage-source.ts:76`). |
| AC4 | MET | test | Timeout regression leaves prior state intact: producer test `agent-usage-producer.test.ts:168-203` pass; design §3.4 documents the 180000 ms limit and retained partial-provider behavior (`docs/design/session-pinned-dispatch.md:59,63`). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:d960af7c99afc09ea29e2a30cff76e5edcd711561ec626392c87e4cb68c2016f |
| P4 | proof-input-digest | — | sha256:d960af7c99afc09ea29e2a30cff76e5edcd711561ec626392c87e4cb68c2016f |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-20T19:34:30.969Z todo → wip (system)
- 2026-09-20T19:54:56.953Z wip → testing (system)
- 2026-09-20T19:55:49.268Z testing → done (system)

