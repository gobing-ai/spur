---
schema_version: 1
name: Pi RPC warm task-turn adapter
status: done
template: feature-impl
created_at: 2026-10-22T07:00:34.914Z
updated_at: "2026-10-25T03:02:21.108Z"
feature_id: G74
priority: P2
tags:
  - fleet
  - performance

dependencies: ["1275"]
ac_altitude: task-local
ac_numbering: task-local
estimate_hours: 6
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1277-verdict.json
---

## 1277. Pi RPC warm task-turn adapter

### Background

Implements: R4 — Pi completes keyed tasks in a warm process.
Work package E4. Runs after the correlated task-turn seam. Candidate transport: Pi RPC JSON records over stdio.
Rubric: E6 D1 L2 C1 R1 = 11 → own task.

**Refine corrections (2026-10-22)**
- Claim "adapter selection in the Spur turn seam" → reality: protocol mechanics belong to ts-ai-runner (ADR-145); the 1284 facade defines a per-agent `TurnSessionDriver` registry. → resolution: the driver is written in ts-libs `packages/ai-runner/src/turn-drivers/pi-rpc.ts` and released by Robin; Spur's part is the catalog bump, capability evidence and receipt rows. ts-libs edits authorized by Robin on 2026-10-22; publishing is his.
- Capability row is stale: `AGENT_SESSION_CAPABILITY.pi` (ts-libs `src/agents/shims.ts:533`) — verifiedAgainst 0.87.0; observed on this host 2026-10-22: PATH pi 1.4.0 (repository dependency version must be recorded separately). → resolution: re-probe and update `verifiedAgainst` with the driver.
- Transport premise: `pi --mode rpc` JSON records over stdio: a command response (acceptance) followed by agent activity events and an end-of-agent record — **unverified against the installed binary**; step 1 records the observed record shapes as redacted fixtures before any parser is written.

### Requirements

- [x] R1. Record exact Pi executable provenance (PATH binary vs repository dependency versions) in `verifiedAgainst` and the receipt.
- [x] R2. Two related keyed tasks execute serially in one process with correlated terminal outcomes and validated artifacts.
- [x] R3. Command acceptance responses are distinguished from completed agent activity; fragmented and interleaved records parse deterministically.
- [x] R4. Unqualified versions keep session/one-shot fallback with a named reason.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Pi provenance is exact (req: R1)
  Given the PATH pi and the repository dependency
  When qualification runs
  Then both paths and versions are recorded and only the qualified one is used by the driver

Scenario: AC2 — Two keyed tasks complete in one warm Pi process (req: R2)
  Given the Pi driver replaying two recorded turns through a real child
  When two keyed tasks drain through the 1275 seam
  Then one process serves both with correlated outcomes and passing action contracts

Scenario: AC3 — Acceptance is not completion; framing is deterministic (req: R3)
  Given transcripts with a command response then exit, a record split across chunks, and interleaved records
  When each settles
  Then the first is `outcome-unknown`, and the split/interleaved transcripts yield the same outcome as their unsplit form

Scenario: AC4 — Unqualified Pi falls back by name (req: R4)
  Given a version not in `verifiedAgainst`
  When a keyed task dispatches
  Then it runs once via session/one-shot with reason `unqualified-version`
```

Feature scenario coverage (the detailed task-local scenarios above remain the behavior contract):

- [x] R4 — Pi completes keyed tasks in a warm process

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T16:25:45.206Z

- **Q: Where does the driver live?** CLOSED — ts-libs `packages/ai-runner/src/turn-drivers/pi-rpc.ts`, registered in `TURN_SESSION_DRIVERS` (1284). Spur imports nothing agent-specific.
- **Q: Which versions qualify?** CLOSED — exactly the probed version(s) recorded in `verifiedAgainst`; `qualify()` refuses others with `unqualified-version`, and Spur falls back (session resume then one-shot) with that reason (1275).
- **Q: Release?** CLOSED — implementer stops at a green, committed, untagged ts-libs tree with version 0.6.x (next patch); Robin tags/publishes; Spur catalog bump + evidence follow in this task's last steps.
- **Q: Real-agent runs?** CLOSED — opt-in (`fleet-e2e --perf --real-agents --agents pi`); deterministic lane replays recorded fixtures.

### Design

**Driver:** ts-libs `packages/ai-runner/src/turn-drivers/pi-rpc.ts`; reuse `piRpcFrame` (`shims.ts:248/374`) for input; bounded line buffer (1284: 1 MiB) for output; correlate records to the single active turn (one turn per session).
**Rejected:** treating the command response as completion.
**Invariants:** one active turn per worker; malformed framing → `contract-violation` deterministically.

### Plan

1. Qualification spike: probe `pi --version` and the persistent protocol on the installed binary; capture redacted transcripts (two turns, an error turn, a cancel) to ts-libs `packages/ai-runner/tests/fixtures/turn-drivers/pi/*.jsonl`. No parser before fixtures.
2. Failure cases first in ts-libs `tests/turn-drivers/pi.test.ts`: command response without completion (accepted, then exit → outcome-unknown); fragmented record across chunks; interleaved event and response records; error response (not-started); two serial turns; malformed record.
3. Implement `src/turn-drivers/pi-rpc.ts`, register it, update `AGENT_SESSION_CAPABILITY.pi.verifiedAgainst`/note; fixture-replay tests pass through a real child (fake agent replaying the captured transcript).
4. ts-libs `bun run spur-check`; commit `feat(ai-runner): pi turn-session driver`; version 0.6.x (next patch); CHANGELOG. Handoff note in Solution; **Robin releases**.
5. Spur: bump catalog to the released version; run `bun run fleet-e2e --perf` (deterministic) and, opt-in, `--real-agents --agents pi`; warm rows replace `unsupported` in `docs/reports/fleet-perf-receipt.json`.
6. `bun run spur-check`.

#### Implement progress — 2026-10-23

- [x] Steps 1, 3 and the upstream half of step 4 were supplied by escalations A1/A2 and released
      as `@gobing-ai/ts-ai-runner` 0.6.4. Re-verified in this tree: runner 0.6.4,
      `TURN_SESSION_DRIVERS` = `["claude","pi"]`, pi `verifiedAgainst` 0.87.1, repository
      `./node_modules/.bin/pi` 0.87.1. Upstream full checks were not rerun here.
- [x] Step 2: all seven failure/success replay scenarios pass, including pre-acceptance rejection
      surfaced as `nativeOutcome: 'not-started'` on the single fallback receipt.
- [x] Step 5: the catalog repin arrived in starting commit `59deb95ef`; Spur-side executable
      provenance, selected-agent perf config, fallback evidence and receipt integration are
      implemented. The deterministic `fleet-e2e --perf` probe regenerated both receipts with
      9/9 trials validated, carrying separate host (1.4.0) and repository (0.87.1) Pi identities.
      The real-agent lane remains opt-in and unrun.
- [x] Step 6 — **owned by the parent pipeline gate, not implement.** Closed by run `f1c5ef2e`:
      `.spur/run/1277-check-receipt.json` records tier `full` **PASS** at tree digest
      `5d214a99d741`, so the parent gate certified the current tree. The earlier light FAIL
      (sandbox denied Git object writes for tree capture) and the retained prior-run receipt
      `.spur/run/1277-prior-full-check-receipt.json` remain historical only.

#### Re-entry — run `c91bde96` (2026-10-23)

Run `6905fc1d` failed at the review state, not on code: its reviewer wrote a prose summary into the
run-scoped answer file instead of the certification artifact, so `spur task verdict --from-answer`
lint-failed on 6 findings (no `Verdict:`/`Confidence:` line, R1–R4 rows absent) and the auto
approval decision denied. The durable verdict artifact is PASS with R1–R4 MET and the review-gate
residual check reports `blocking=0`. This pass therefore made only the one in-scope code change the
review asked for (finding 3's stale seam comment) and named the carried plugin flake fix in the
Solution change map (finding 4). Full diagnosis and fresh checks: `## Solution`.

### Solution

**Implemented against released runner 0.6.4; ready for the parent gate/review.**
Escalations A1/A2 supplied the upstream driver and the pre-acceptance-rejection fix. This is an
implement-only handoff: no verify PASS, lifecycle transition or full-project gate is claimed.

**Change map**

- `packages/app/src/services/warm-turn-dispatch.ts:123-139` retains the upstream native outcome
  when a not-started warm attempt creates a fallback receipt (`:230` passes `outcome.kind`
  through). Pre-acceptance rejection now records `nativeOutcome: 'not-started'` separately from
  the fallback action's validated result.
- `packages/app/src/services/agent-loop-service.ts:577-581` corrects the 1275 seam comment: the
  driver registry is no longer empty, so the comment now names claude (1276) and pi (1277) as
  registered and keeps the fall-back-by-name statement for every other agent. Comment only — no
  behaviour change.
- `packages/app/tests/workflow/pi-warm-work-item.test.ts:58` exercises the registered Pi driver,
  real replay child, warm dispatcher, AgentService and workflow artifact validator. Two serial
  keys reuse one pid, carry distinct correlated outcomes and validate distinct files. The
  acceptance-only exit, malformed JSON, pre-acceptance rejection, unqualified version and missing
  artifact cases guard against false success and duplicate execution.
- `packages/app/tests/fixtures/claude-warm/replay.ts:1` replays the captured transcript, with labelled
  fragmentation/interleaving and fault injection. `packages/app/tests/fixtures/pi-warm/README.md:1`
  records provenance and distinguishes synthetic rejection from live captured records.
- `scripts/commands/fleet-e2e.ts:1439` records separate Pi host/repository executable identities;
  `scripts/commands/fleet-e2e.ts:1536` bounds version probes and qualifies only the selected binary.
  `scripts/commands/fleet-e2e.ts:1590` configures the requested agent in real-agent scratch fleets;
  the deterministic lane retains the common stub. `scripts/commands/fleet-e2e.ts:1802` adds
  executable provenance to the Markdown receipt.
- `scripts/commands/fleet-e2e-perf.test.ts:173` checks separate identities, unqualified host
  refusal and Pi scratch-fleet configuration. `packages/app/tests/services/warm-turn-dispatch.test.ts:120`
  and `packages/app/tests/services/agent-loop-service.test.ts:342` retain unsupported-agent tests
  using unregistered Gemini now that Pi is registered.
- `plugins/sp/tests/hooks/agent-lifecycle.test.ts:127-140` — **test-only flake fix carried in this
  task's tree** (previously missing from this map; review finding 4). The lifecycle-shim assertion
  polled `existsSync(record)`, but the shim's `>` redirect creates the file before `printf` writes
  it, so under load the test read back an empty argv. It now polls the expected content. Unrelated
  to the Pi adapter; kept because it keeps the full suite green, and named here so the task commit
  declares it.
- `docs/design/fleet-task-turn-execution.md:113` documents qualification, acceptance vs terminal
  completion, fallback outcome evidence and the output-capture limitation (constitution T3).
  The existing index pointer is unchanged. `docs/reports/fleet-perf-receipt.json:1` and
  `docs/reports/fleet-perf-receipt.md:1` carry the regenerated deterministic receipt.

**Installed prerequisite (re-verified this pass)**

- `node_modules/@gobing-ai/ts-ai-runner` is **0.6.4**; `TURN_SESSION_DRIVERS` keys are
  `["claude","pi"]`; `getAgentSessionCapability('pi').verifiedAgainst` is **0.87.1**.
  `./node_modules/.bin/pi --version` prints **0.87.1**; host PATH pi is 1.4.0 and is not the
  qualification target. Starting commit `59deb95ef` already repinned the catalog to `^0.6.4`.
- The upstream decoder classifies a prompt rejected before acceptance as `not-started` and the
  facade preserves that terminal kind. No Spur protocol decoder or upstream repository edit was
  added. Evidence: @gobing-ai/ts-ai-runner `src/turn-drivers/pi-rpc.ts` line 114.
  Evidence: @gobing-ai/ts-ai-runner `src/turn-session.ts` line 507.
- Pi's output event is an object without `finalText`. These proofs validate model-written
  `expectFile` artifacts; they do not certify `answerFile` capture. Real-model measurement remains
  opt-in and was not run; warm rows certify qualification and carry no latency claim.
  Evidence: @gobing-ai/ts-ai-runner `src/turn-drivers/pi-rpc.ts` line 163.

**Re-entry — pipeline run `c91bde96` (2026-10-23)**

The previous run (`6905fc1d`) reached a **green gate** and a PASS requirement/AC verdict, then
failed at the review state's certification. Diagnosed this pass, reproduced verbatim:
`spur task verdict 1277 --from-answer .spur/run/.done-6905fc1d/6905fc1d-…-review-answer.txt`
→ `answer lint failed — 6 finding(s)`: no `Verdict:` line, no `Confidence:` line, and a missing
requirement row for each of R1–R4. The reviewer had written a **prose summary about** its artifact
into the run-scoped answer file instead of the artifact itself, so `review.status` fell to FAIL and
the auto approval decision denied. **No code defect was implicated** — the durable
`.spur/run/1277-verdict.json` is PASS with R1–R4 MET and `spur task residual 1277 review-gate`
reports `blocking=0`. The fix belongs to the review state's answer, not to this diff; this pass
changed no behaviour on account of it.

This pass's only tree change is the stale-comment correction above (review finding 3, ACCEPTED).
Findings 1 and 2 stay DEFER-ed as reviewed (claude 2.1.309 re-qualification is 1276/G74; the
`Bun.file(...).size` absence assertion hardens in the 1278 fixture round), and finding 5 is an
upstream `node_modules` concern with no Spur-side edit.

**Verification — all commands run 2026-10-23 in this implement pass**

Prior pass (unchanged tree except the comment above):

- From `packages/app`: `bun test tests/workflow/pi-warm-work-item.test.ts
  tests/services/warm-turn-dispatch.test.ts tests/services/agent-loop-service.test.ts
  tests/workflow/claude-warm-work-item.test.ts tests/services/agent-service.test.ts`
  — **264 pass, 0 fail** (1037 expect calls, 5 files).
- From `scripts`: `bun test commands/fleet-e2e-perf.test.ts commands/fleet-e2e-matrix.test.ts`
  — **34 pass, 0 fail**.
- From `apps/cli`: `bun test tests/commands/agent/loop.test.ts
  tests/commands/agent/loop-member-session.test.ts` — **20 pass, 0 fail**.
- Public-surface probe (changed `fleet-e2e` script entry), bounded, throwaway registries under
  `$TMPDIR`:
  `SPUR_PROJECTS_FILE=$PROBE/projects.json SPUR_SLASH_COMMANDS_FILE=$PROBE/slash_commands.json
  SPUR_SKIP_GLOBAL_CONFIG=true bun run fleet-e2e --perf`
  — **`fleet-perf: 9/9 trials validated`**. The regenerated
  `docs/reports/fleet-perf-receipt.json` `measured.pi.warm` records
  `provenance.host = {/Users/robin/node_modules/.bin/pi, 1.4.0}`,
  `provenance.repository = {node_modules/.bin/pi, 0.87.1}`, `verifiedVersion 0.87.1`,
  `status: qualified` — AC1's separate-identity requirement.
- Parent-gate receipt `.spur/run/1277-check-receipt.json`: tier `full`, **PASS**
  (`spur self exec check`, 313 s, input digest `45f2504e`). That digest predates this pass's
  comment edit, so it does not certify the current tree — Plan step 6 stays with the parent gate.

Re-entry pass (changed path `packages/app/src/services/agent-loop-service.ts`, comment only):

- From `packages/app`: `bun test tests/services/agent-loop-service.test.ts` — **17 pass, 0 fail**
  (45 expect calls).
- `bun run --filter @gobing-ai/spur-app typecheck` — **exit 0**.
- `bunx biome check packages/app/src/services/agent-loop-service.ts` — **no fixes applied**.
- `bun apps/cli/src/index.ts rule run --preset recommended-pre-check --json` — **51 rules,
  0 findings**.
- Fresh installed-prerequisite probe: `TURN_SESSION_DRIVERS` → `["claude","pi"]`, pi
  `verifiedAgainst` → `0.87.1`, `./node_modules/.bin/pi --version` → `0.87.1`, runner → `0.6.4`.
- `probe: not-applicable (no public surface changed this pass)` — the comment edit changes no CLI
  verb, route or script entry; the prior pass's `fleet-e2e --perf` probe above still stands.

Plan step 6 (`bun run spur-check`) is deliberately handed to the parent pipeline gate: implement
mode forbids rerunning the full project suite, and that run is also what re-binds the gate receipt
to the current tree. Implementation changes remain uncommitted; the parent owns gate binding,
review, verify and the task commit.

**Implement re-entry — 2026-10-24**

The existing implementation and recorded escalations A1/A2 were inspected against R1–R4.
No additional source changes were necessary. This pass preserves the starting source, fixture,
design and receipt changes and refreshes their implementation evidence. The implementation anchors
are `packages/app/src/services/warm-turn-dispatch.ts:123` (fallback outcome retention) and
`packages/app/tests/workflow/pi-warm-work-item.test.ts:58` (the seven real-child replay scenarios).
Runner 0.6.4 is installed;
the registered drivers are `claude` and `pi`; Pi's qualification version and the repository binary
both report 0.87.1. The real-model lane remains opt-in and was not run.

Fresh targeted verification:

- From `packages/app`: `bun test tests/workflow/pi-warm-work-item.test.ts
  tests/services/warm-turn-dispatch.test.ts tests/services/agent-loop-service.test.ts
  tests/workflow/claude-warm-work-item.test.ts tests/services/agent-service.test.ts`
  — **264 pass, 0 fail**, including all seven Pi replay scenarios.
- From `scripts`: `bun test commands/fleet-e2e-perf.test.ts commands/fleet-e2e-matrix.test.ts`
  — **34 pass, 0 fail**.
- From `apps/cli`: `bun test tests/commands/agent/loop.test.ts
  tests/commands/agent/loop-member-session.test.ts` — **20 pass, 0 fail**.
- `bun run --filter @gobing-ai/spur-app typecheck` and
  `bun run --filter @gobing-ai/spur typecheck` — **exit 0**.
- Biome over the ten changed/new TypeScript files — **no fixes applied**;
  `git diff --check` — **exit 0**.
- Source-local `bun run apps/cli/src/index.ts rule run --preset recommended-pre-check --json`
  — **51 rules, 0 findings**.

`bun run apps/cli/src/index.ts task gate 1277 light` wrote a **FAIL** light receipt.
Formatting, pre-check rules, app typechecking, 262 app tests and 10 hook tests passed.
`rules:post` failed on coverage provenance: `coverage-artifact: tree-unavailable`, because Git's
temporary-index capture could not insert objects (`unable to create temporary file: Operation
not permitted`). This session's sandbox permits reading the shared Git metadata and denies
those writes. The light command exited 0 despite the receipt's FAIL; the old
`.spur/run/1277-test-gate.status` still reads PASS and does not certify this light attempt.
The receipt at `.spur/run/1277-check-receipt.json` now describes this light attempt, replacing
the previous full receipt; a historical full PASS from run `f0158221` remains separately preserved
in `.spur/run/1277-prior-full-check-receipt.json` and is not fresh certification.

Detailed logs are `.spur/run/1277-{app,scripts,cli}-reentry-20261024.log` and
`.spur/run/1277-light-gate.log`. These are repeatable implementation probes; the parent pipeline
still owns the full gate, review/certification, lifecycle transition and task commit. No full
project gate, new verify PASS or lifecycle transition was performed in this pass.

probe: not-applicable (no public surface changed this pass).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `scripts/commands/fleet-e2e.ts:2034`; `packages/app/tests/workflow/pi-warm-work-item.test.ts:67`; fresh perf receipt distinguishes PATH Pi 1.4.0 from repository Pi 0.87.1; only the repository binary qualifies. Script suite: 34 pass, 0 fail. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/runner-proof/tests --timeout 20000; exit 0, 63 pass. Work-item suite separately passed 102 cases across 8 files. Re-audit artifact writes: .spur/run/1277-verify-answer.txt:1-38; .spur/run/1277-verdict.json:1-92. |
| R2 | MET | `packages/app/tests/workflow/pi-warm-work-item.test.ts:67`; Fresh packages/app targeted run: 102 pass, 0 fail across 8 files; fresh-role regressions additionally rerun after the final fix. One registered Pi RPC replay child serves two keyed tasks with distinct facade correlation and validated artifacts; unavailable native ids stay absent. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/runner-proof/tests --timeout 20000; exit 0, 63 pass. Work-item suite separately passed 102 cases across 8 files. |
| R3 | MET | `packages/app/tests/workflow/pi-warm-work-item.test.ts:67`; `packages/app/tests/workflow/pi-warm-work-item.test.ts:165`; Fresh copied upstream suites against the installed published dist: 63 pass, 0 fail (18 facade cases plus all three native drivers). Fragmented/interleaved transcript matches plain replay; accepted exit stays outcome-unknown and malformed frames cannot become success. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/runner-proof/tests --timeout 20000; exit 0, 63 pass. Work-item suite separately passed 102 cases across 8 files. |
| R4 | MET | `packages/app/tests/workflow/pi-warm-work-item.test.ts:67`; `scripts/commands/fleet-e2e.ts:1960`; Fresh packages/app targeted run: 102 pass, 0 fail across 8 files; fresh-role regressions additionally rerun after the final fix. Unqualified Pi executes one named fallback with zero warm child launches. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/runner-proof/tests --timeout 20000; exit 0, 63 pass. Work-item suite separately passed 102 cases across 8 files. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — Pi provenance is exact (req: R1) | MET | test | `scripts/commands/fleet-e2e.ts:2034`; `packages/app/tests/workflow/pi-warm-work-item.test.ts:67`; fresh perf receipt distinguishes PATH Pi 1.4.0 from repository Pi 0.87.1; only the repository binary qualifies. Script suite: 34 pass, 0 fail. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/runner-proof/tests --timeout 20000; exit 0, 63 pass. Work-item suite separately passed 102 cases across 8 files. |
| Scenario: AC2 — Two keyed tasks complete in one warm Pi process (req: R2) | MET | test | `packages/app/tests/workflow/pi-warm-work-item.test.ts:67`; Fresh packages/app targeted run: 102 pass, 0 fail across 8 files; fresh-role regressions additionally rerun after the final fix. One registered Pi RPC replay child serves two keyed tasks with distinct facade correlation and validated artifacts; unavailable native ids stay absent. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/runner-proof/tests --timeout 20000; exit 0, 63 pass. Work-item suite separately passed 102 cases across 8 files. |
| Scenario: AC3 — Acceptance is not completion; framing is deterministic (req: R3) | MET | test | `packages/app/tests/workflow/pi-warm-work-item.test.ts:67`; `packages/app/tests/workflow/pi-warm-work-item.test.ts:165`; Fresh copied upstream suites against the installed published dist: 63 pass, 0 fail (18 facade cases plus all three native drivers). Fragmented/interleaved transcript matches plain replay; accepted exit stays outcome-unknown and malformed frames cannot become success. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/runner-proof/tests --timeout 20000; exit 0, 63 pass. Work-item suite separately passed 102 cases across 8 files. |
| Scenario: AC4 — Unqualified Pi falls back by name (req: R4) | MET | test | `packages/app/tests/workflow/pi-warm-work-item.test.ts:67`; `scripts/commands/fleet-e2e.ts:1960`; Fresh packages/app targeted run: 102 pass, 0 fail across 8 files; fresh-role regressions additionally rerun after the final fix. Unqualified Pi executes one named fallback with zero warm child launches. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/runner-proof/tests --timeout 20000; exit 0, 63 pass. Work-item suite separately passed 102 cases across 8 files. |
| R4 — Pi completes keyed tasks in a warm process | MET | test | `packages/app/tests/workflow/pi-warm-work-item.test.ts:67`; Fresh packages/app targeted run: 102 pass, 0 fail across 8 files; fresh-role regressions additionally rerun after the final fix. One registered Pi RPC replay child serves two keyed tasks with distinct facade correlation and validated artifacts; unavailable native ids stay absent. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/runner-proof/tests --timeout 20000; exit 0, 63 pass. Work-item suite separately passed 102 cases across 8 files. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1277 (Pi RPC warm task-turn adapter)

**Scope:** task 1277 working tree — 12 modified files (632/−246): `packages/app` warm-dispatch fallback receipt kind plus the Pi replay E2E and fixtures, `scripts/commands/fleet-e2e*` executable provenance and real-agent fleet configuration, the design note, the regenerated perf receipts, and the task file.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture

Confidence: MEDIUM

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| - | -------- | --------- | ------- | -------- | ----------- |
| 1 | P3 (minor) | correctness | Regenerating the perf receipt flipped the claude warm row from qualified to `unsupported` — host 2.1.309 vs the driver-pinned 2.1.308 (`docs/reports/fleet-perf-receipt.json:450-459`) — so the committed receipt no longer evidences 1276's qualified-claude row for G74. The probe is honest and the Pi change did not cause it, but the evidence loss is real. | `docs/reports/fleet-perf-receipt.json:450-459` | DEFER(claude 2.1.309 re-qualification belongs to 1276/G74, outside this task's scope) |
| 2 | P3 (minor) | correctness | The stub-absence assertion cannot prove absence: `Bun.file(...)` reports size 0 for a missing path (`scripts/commands/fleet-e2e-perf.test.ts:210`), so the `toBe(0)` check passes for both an absent and an empty stub. The `agent: pi` and `not.toContain('agent: claude')` assertions still carry the selected-agent behaviour, and the smoke write is correctly gated on `!options.realAgents`. | `scripts/commands/fleet-e2e-perf.test.ts:210` | DEFER(test-only weakness; strengthen with existsSync in the 1278 fixture round) |
| 3 | P4 (advisory) | correctness | The 1275 seam comment previously claimed the driver registry ships empty; it now names claude (1276) and pi (1277) as registered and keeps the fall-back-by-name statement for every other agent. Comment only, no behaviour change. | `packages/app/src/services/agent-loop-service.ts:577-581` | RESOLVED (re-entry pass) |
| 4 | P4 (advisory) | usability | The unrelated test-only lifecycle flake fix is now declared in the executable change map with its cause, so the commit will not carry an undeclared edit. | `plugins/sp/tests/hooks/agent-lifecycle.test.ts:127-140` | RESOLVED (named in Solution) |
| 5 | P4 (advisory) | security | The driver spawns bare `pi` from the live PATH while qualification probes that same command and does not pin the probed absolute path. An unqualified probe is refused before spawn, so the exposure is a PATH change between probe and spawn, not an unqualified warm run. Upstream ts-libs code; not editable from this task. | `node_modules/@gobing-ai/ts-ai-runner/src/turn-drivers/pi-rpc.ts:71-80` | ACCEPTED (upstream; acceptance requires exact version match) |
| 6 | P4 (advisory) | usability | The regenerated Markdown receipt newly embeds a developer-specific absolute host path — `/Users/robin/node_modules/.bin/pi`, headed 1.4.0 (`docs/reports/fleet-perf-receipt.md:38-44`) — while HEAD carried none. That path is one of two identical host aliases of the same install, so the identity is honest, but the committed evidence is machine-specific and the `host` column implies a stable install location. | `docs/reports/fleet-perf-receipt.md:38-44` | ACCEPTED (provenance evidence; relativise or label as host-specific in a follow-up) |

##### Functional Traceability

| Req | Status | Evidence |
| --- | ------ | -------- |
| R1 | MET | `scripts/commands/fleet-e2e.ts:1536-1568` probes the selected binary and, for pi, separate host and repository identities (repository bin filtered out of PATH only to identify the host install); `scripts/commands/fleet-e2e.ts:1462-1502` keeps the driver's `qualify()` as the sole verdict and records both provenance slots; `scripts/commands/fleet-e2e.ts:1802-1815` renders the provenance table. Committed row `docs/reports/fleet-perf-receipt.json:500-520`; installed `verifiedAgainst` 0.87.1 at `node_modules/@gobing-ai/ts-ai-runner/src/agents/shims.ts:551`. Fresh `bun test commands/fleet-e2e-perf.test.ts commands/fleet-e2e-matrix.test.ts` in `scripts` — 34 pass, 0 fail, including the refusal case at `scripts/commands/fleet-e2e-perf.test.ts:174-198`. Fresh probes this review: repository `./node_modules/.bin/pi --version` → 0.87.1; host `pi --version` → 1.4.0. |
| R2 | MET | `packages/app/tests/workflow/pi-warm-work-item.test.ts:110-201` drives two serial keyed work items through `runFleetWorkItem` → `AgentService` → warm dispatcher → registered Pi driver and one real replay child; `:189-201` asserts one `openCalls`, one child launch, distinct turn ids, a shared policy digest and no invented native ids; `:185` validates both declared artifacts (`alpha`, `beta`) through the workflow action contract. Fresh `bun test tests/workflow/pi-warm-work-item.test.ts` in `packages/app` — 7 pass, 0 fail. |
| R3 | MET | `packages/app/tests/workflow/pi-warm-work-item.test.ts:165-169` settles response-then-exit as `outcome-unknown` and malformed JSON as `contract-violation`; `packages/app/tests/fixtures/pi-warm/replay.ts:44-52` splits every record across writes and interleaves captured extension noise, and the `fragmented` case yields the same `alpha`/`beta` artifacts and receipts as the unsplit `plain` case. The decoder treats `agent_settled` as the only terminal at `node_modules/@gobing-ai/ts-ai-runner/src/turn-drivers/pi-rpc.ts:149-159`; the fixture README records that the rejection line is synthetic injection, not a live capture. |
| R4 | MET | `packages/app/tests/workflow/pi-warm-work-item.test.ts:148-150,170-177,189-191` drives a 1.4.0 selection to exactly one one-shot fallback with `unqualified-version`, zero child launches and one fallback call; `packages/app/tests/services/warm-turn-dispatch.test.ts:164-171` covers the named pre-spawn refusal. `packages/app/src/services/warm-turn-dispatch.ts:123-140` carries the named reason and the retained native outcome into the fallback receipt, and `:230` passes the pre-acceptance kind through. Fresh `packages/app` run of `warm-turn-dispatch`, `agent-loop-service`, `claude-warm-work-item` and `agent-service` — 257 pass, 0 fail. |

##### Residual risk

- Warm rows are qualification evidence only: no real-model latency and no `answerFile` capture were exercised (`docs/design/fleet-task-turn-execution.md:113-122`). The opt-in real-agent lane remains unrun.
- The claude warm row is now `unsupported` at 2.1.309; finding 1 carries that re-qualification to the feature follow-up.
- The fresh checks in this pass are scoped suites plus typecheck (`bun run --filter @gobing-ai/spur-app typecheck` exit 0, Biome over the six touched TypeScript files with no fixes); the full project gate is the parent pipeline's step and its receipt is not claimed here.

**Next:** the captured answer certifies the requirement and AC rows; no remediation is required for this diff.

Verdict: PASS

### References

- Feature G74; design `docs/design/fleet-task-turn-execution.md` §5; ADR-145.
- Depends on: 1275 (seam) → 1284 (facade). Receipt: 1273.
- ts-libs anchors: `packages/ai-runner/src/agents/shims.ts:533` (capability rows), `:248`/`:374` (`piRpcFrame`).

### History

- 2026-10-23T16:55:58.260Z todo → wip (system)
- 2026-10-24T21:22:49.963Z wip → testing (system)
- 2026-10-24T21:24:56.865Z testing → done (system)

