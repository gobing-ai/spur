---
schema_version: 1
name: Move process-tree deadline and cancellation containment into ts-runtime
status: done
template: feature-impl
created_at: 2026-09-08T22:33:10.231Z
updated_at: "2026-09-08T23:51:41.092Z"
feature_id: A21
priority: P1
tags:
  - A21
  - execution-timeouts
  - upstream

---

## 0810. Move process-tree deadline and cancellation containment into ts-runtime

### Background

Robin selected reusable upstream timeout control and an explicit unlimited mode on 2026-09-08. Feature A21 and ADR-112 define the scope; docs/design/execution-deadlines.md is the accepted design.

- Implements: R3 — Process cancellation reaps the complete child tree

- Owner: Upstream /Users/robin/xprojects/ts-libs: packages/runtime/src/process-executor.ts, its option/result types, packages/runtime/tests, package README and owning upstream design docs. Spur tracking evidence only; no Spur source implementation.
- Rubric: E5 D1 L1 C1 R2 = 10; independently verifiable deliverable, estimated 4–6 hours. Tests/docs stay in this task. Whole feature E23 D4 L5 C2 R2 = 36; split by reusable capability and release boundary, not by scenario.
- Evidence baseline: installed upstream 0.4.57 and read-only ts-libs checkout f01336f7b770219babaf62c2bde2f11ac9c1d86e; existing 65 focused Spur tests passed but do not prove the new contract.

### Requirements

- **R1** — Extend the existing native ProcessExecutor path so finite timeout, explicit unlimited, external abort and normal exit compose without competing caller watchdogs; preserve existing omitted/default behavior and distinguish the termination reason. Reap owned Unix descendants after SIGTERM-to-SIGKILL grace, including a leader that exits first and descendants retaining pipes or a temporary SQLite write transaction; completion must permit lock reacquisition within a measured tolerance.

### Acceptance Criteria

```gherkin
Feature: Move process-tree deadline and cancellation containment into ts-runtime

  @core
  Scenario: R1 — Process cancellation reaps the complete child tree
    Given a shell descendant ignores SIGTERM and retains inherited output pipes
    When the process execution is cancelled or its finite deadline expires
    Then the native runtime escalates after the configured grace and reaps the owned process group
    And the result distinguishes timeout from external cancellation, signal, and normal exit
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Keep lifecycle machinery in the existing ProcessExecutor implementation; do not create an application-specific scheduler executor. Add backwards-compatible optional timeout/grace/outcome fields through the native facade, preserving explicit null versus omitted defaults. Supplied parent cancellation remains effective for unlimited local execution. One termination path owns group isolation, SIGTERM, escalation, output draining and final outcome; a parent context supplies the deadline rather than requiring Spur to race a second timer. Never cancel descendant escalation solely because the direct child exited. On unsupported platforms keep existing behavior explicit and do not promise Unix group semantics. Use the existing optional ProcessOptions.signal and onSpawn seams as the starting point, verified in installed/upstream 0.4.57; new signatures are designed here and must be implemented before callers use them.

#### Decisions

- Follow ADR-112 and docs/design/execution-deadlines.md; null means unlimited, omitted inherits. Native mechanisms own lifecycle; no parallel Spur framework.
- Rejected: constant-only deduplication, -1 sentinels passed to timers, unbounded visibility leases and promise-race-only cancellation.
- Preserve concurrent changes; work in a clean isolated checkout for implementation and use only task-owned temporary processes/databases.

#### Dependencies and premises

The current installed and clean upstream 0.4.57 implementation only sends group SIGTERM for signal cancellation and does not provide equivalent group escalation. Recheck this at implementation start and reuse a newly available native capability instead of duplicating it.

#### Execution budget and evidence

- Budget: 4–6 hours; checkpoint at the upper bound with changed-file/commit/test evidence, then resume against the same requirements.
- Ownership: Upstream /Users/robin/xprojects/ts-libs: packages/runtime/src/process-executor.ts, its option/result types, packages/runtime/tests, package README and owning upstream design docs. Spur tracking evidence only; no Spur source implementation.
- Upstream work follows upstream AGENTS.md and harness; this Spur record tracks acceptance and cross-repository ordering. Record the exact upstream commit and verification commands in this task through spur task, never fabricate local product changes to satisfy requireDiff.
- requireDiff: source changes must be verified in the owning repository; documentation/evidence here is allowed tracking, not proof of upstream implementation. If the task pipeline cannot verify external source scope, use its explicit external-evidence path and report that limit before completion.
- No production mutations, releases, workflow edits, new toolchains or publication are included.

### Plan

1. Read upstream AGENTS.md, ADRs and native process executor tests; record git baseline and source/lockfile version. Reproduce descendant/pipe/SQLite cleanup failure using task-owned temporary processes and database files.
2. Add the minimum compatible native timeout/null/grace/cancellation outcome contract and implement one group termination lifecycle in packages/runtime.
3. Add deterministic unit cases and a real nested TERM-resistant child test, waiting for a readiness handshake before expiry; verify group exit, output settlement and another SQLite writer succeeds.
4. Run focused runtime tests, then upstream bun run spur-check and bun run build. Update runtime README and upstream authority/design docs; attach upstream commit SHA, command provenance and results to this Spur record. Do not publish.

### Solution

Owner-repo implementation (upstream ts-libs checkout; Spur carries tracking evidence only, per task Owner). Native `ProcessExecutor` deadline/cancellation containment, single group-owned termination path:

- `/Users/robin/xprojects/ts-libs/packages/runtime/src/process-executor.ts:882-930` — `ownProcessGroupLifecycle`: first-wins trigger joining finite `timeout` deadline + external `cancelSignal`; escalation group-SIGTERM → `killGraceMs` grace (default 5000) → group-SIGKILL with bounded settle; completion decided by group liveness, never leader exit (`:852-866` `reapProcessGroup`; `:760-771` detached group, execa watchdog suppressed so no competing caller watchdog; `:298-308` pre-spawn validation + group-owned activation).
- `/Users/robin/xprojects/ts-libs/packages/runtime/src/process-executor.ts:129-143` — `ProcessOutcome` distinguishes `timeout` / `cancelled` / `signal` / `exit` (+`error`); `defaultTimeout: null` = explicit unlimited, omitted inherits default.
- `/Users/robin/xprojects/ts-libs/packages/runtime/tests/process-executor.test.ts:462-660` — 9 new containment scenarios: pipes+leader-exit-first timeout escalation, abort→`cancelled`, null-overrides-default, omitted-inherits, natural-leader-exit reap, SQLite `BEGIN EXCLUSIVE` write-lock reap with <2s lock reacquisition, explicit unlimited, abort+normal-exit, invalid-value rejection. 33/33 pass.
- `/Users/robin/xprojects/ts-libs/packages/runtime/README.md` + ts-libs `CHANGELOG.md` `[Unreleased]` — contract docs; `runStreaming` explicitly scoped out (no group containment); `timeout: 0` semantic change (disable → `TypeError`) recorded as a compatibility entry.
- Review findings P1/P2 (README `runStreaming` overclaim, empty changelog) fixed post-review; verify re-read all anchors: R1 MET, AC scenario MET, design conformance 7/7 (`.spur/run/0810-verify-answer.txt`).

Upstream evidence: 5→6 files, +532/−47 pre-docs-fix; focused tests 33/33 (`NODE_ENV=test bun test tests/process-executor.test.ts`), `biome` + `tsc --noEmit` clean. Spur-side gate: quality gate PASS attempt 1 (`.spur/run/0810-test-gate.log`), proof bracket `8c69ad48…` held at verify.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | @gobing-ai/ts-runtime `src/process-executor.ts` lines 298-308 — deadline/grace validation before spawn (`resolveDeadline`/`resolveKillGraceMs`, definitions at lines 794/813) and group-owned activation on finite `timeout` or supplied `signal` (non-win32 gate); lines 760-771 — group-owned runs spawn detached with execa's own `timeout`/`cancelSignal` suppressed so no competing caller watchdog exists; lines 852-866 — `reapProcessGroup` single escalation: group SIGTERM → `killGraceMs` grace → group SIGKILL → bounded settle, decided by group liveness, never direct-child exit; lines 882-930 — `ownProcessGroupLifecycle` first-wins trigger (`timeout` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Process cancellation reaps the complete child tree | MET | test | Given TERM-resistant descendant (`trap "" TERM; sleep 30`) retaining inherited output pipes — @gobing-ai/ts-runtime `tests/process-executor.test.ts` line 427; When cancelled or finite deadline expires — tests at lines 462 (deadline) and 486 (abort); Then escalation after configured grace reaps owned group — `reapProcessGroup` @gobing-ai/ts-runtime `src/process-executor.ts` lines 852-866, asserted via outcome/`expectGroupGone` (test :541) and sub-5000ms bounds (:479, :497, :601); And result distinguishes timeout from external cancellation, signal, and normal exit — `ProcessOutcome` :129 with tests asserting `timeout` (:476), `cancelled` (:499), `exit` (:542, :614, :626) and non-owning-path `classifyFailedCompletion` (:932-943). Executable evidence: `bun test tests/process-executor.test.ts` 33 pass / 0 fail this run. |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
| ---------- | ----------- | ---------- | ---------- |
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:8c69ad4815126d2dd573ad4430f78b657f6dc4f7d2f9d9b8a97479d76fce6899 |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-08T23:24:33.475Z todo → wip (system)
- 2026-09-08T23:51:30.134Z wip → testing (system)
- 2026-09-08T23:51:41.092Z testing → done (system)
