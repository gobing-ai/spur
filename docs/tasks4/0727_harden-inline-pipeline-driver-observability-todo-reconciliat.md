---
schema_version: 1
name: "Harden inline pipeline driver observability: todo reconciliation, implement-stage timeout, run-log timestamps"
status: done
template: issue
created_at: 2026-08-31T21:21:06.461Z
updated_at: "2026-09-01T00:28:39.262Z"
feature_id: F91
---

## 0727. Harden inline pipeline driver observability: todo reconciliation, implement-stage timeout, run-log timestamps

### Background

Task 0726 (F91) reached verdict PASS and done, but the session consumed ~4:00 elapsed with three
avoidable sinks, and the host-session todo list was left showing 0/11 (precheck/implement stuck
in_progress) after completion. Session review (--triage, 2026-08-31) triaged the driver/observability
findings into this task. The indent war root cause (.pi-lens.json ignore for config/workflows/**) and
the 4 task-attribution.test.ts reds (missing importerVersion ctx under the new assertPiImporterSafe
guard) were fixed directly in the same session and are excluded here.

Evidence: run log `.spur/run/a33bbfbd-ed97-4325-ab4b-c9f5a4f64c50.log`; host todo store (11 stale
items reconciled manually).

**Filed against a stale plugin; re-validated 2026-08-31 against sp 0.3.70.** The filing agent was
running an older installed `sp`. Every item was re-checked against the reloaded plugin — R1 and R3
survive (with R1's root-cause framing corrected), R2 was re-scoped after two of its three asks were
found to contradict or duplicate contracts already in the tree. See `## Q&A` for the per-item
verdict and evidence.

### Requirements

- [x] R1. Host-owned stage-todo reconciliation. `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`
  step 4 must require that, at every state transition, the host marks the finished stage `completed`
  and the next stage `in_progress` in the host todo list, and that this reconciliation is
  **host-owned and execution-surface-independent** — it fires identically whether the stage ran via
  native subagent, host-inline, or a post-dispatch fallback. Current text says only "Mark the active
  state" with a stage-boundary refresh cadence, so a run can terminate with earlier stages stuck
  `in_progress` (0726: 0/11, precheck + implement never closed).
- [x] R2. Inline-dispatch timeout and partial-work contract. The driver's "Native-subagent dispatch"
  section must state: (a) which timeout boundary governs a **dispatched** native subagent — the host
  platform's subagent limit, not the YAML `timeoutMs`, which the driver already declares "not
  applicable" for host execution (`inline-pipeline-driver.md:76-77`) — and require that boundary and
  its source be appended to the run log **before** dispatch; (b) that a dispatch timeout is a
  started-subagent failure, so the existing no-host-replay rule
  (`inline-pipeline-driver.md:118-120`) and the stage's declared YAML error policy govern
  (implement's default `fail` policy → `failed`); (c) the inline recovery route — the task 0424
  timed-out-implement runbook (`execution-workflow.md` § "Large tasks and timed-out implement
  resume") is scoped "On the subprocess path" and keyed on `.spur/run/<runId>-implement-partial.md`,
  written only by `packages/app/src/workflow/actions/agent-run.ts`, so the inline path has no
  equivalent; give it one (resume from the partial tree, never restart the stage inline).
- [x] R3. Run-log timestamps must be normalized to one timezone (ISO-8601 UTC throughout). The driver's
  run-log contract must prescribe the stamp format for every appended line and prohibit bare
  local-clock forms; the current log mixes `2026-08-31T17:17:21Z` with `[implement close-out 12:00]`.
  No code-side sink stamps these lines (`packages/app/src/observability/workflow-run-log-sink.ts`
  mirrors the human renderer and adds no timestamps), so the rule belongs in the driver contract.

**Out of scope / non-goals.** No CLI noun/verb/flag, config key, or schema change. No edit to
`config/workflows/task-pipeline.yaml` (`implementTimeoutMs` governs the subprocess path and stays).
No timestamping added to the subprocess sink `packages/app/src/observability/workflow-run-log-sink.ts`.
No execution-surface policy switch or stage-size heuristic — ADR-047's 2026-08-10 amendment (task
0508) forbids one, so "host-inline by default for implement-scale stages" is dropped, not deferred.
No citation-repair or reformat pass on the touched files.

### Acceptance Criteria

- AC1: Given `inline-pipeline-driver.md` step 4, when read, then it states that each transition marks
  the finished stage `completed` and the next `in_progress`, and that this reconciliation is
  host-owned and identical across native-subagent, host-inline, and post-fallback execution; and
  `plugins/sp/tests/inline-execution-contract.test.ts` asserts those contract phrases and passes.
- AC2: Given the driver's "Native-subagent dispatch" section, when read, then it (i) names the
  governing timeout boundary for a dispatched subagent and requires it logged before dispatch,
  (ii) classifies a dispatch timeout as a started-subagent failure subject to the existing
  "do **not** replay the stage in the host" rule and the YAML error policy, and (iii) routes recovery
  to an inline-path partial-tree resume rather than an inline re-execution; and
  `plugins/sp/tests/inline-execution-contract.test.ts` asserts those phrases and passes.
- AC3: Given the driver's run-log contract, when read, then it prescribes ISO-8601 UTC for every
  appended line and explicitly prohibits bare local-clock stamps (`[stage 12:31]`); the contract test
  asserts the rule; and on a new inline run,
  `grep -cE '^\[[a-z-]+ [0-9]{1,2}:[0-9]{2}\]' .spur/run/<run-id>.log` returns 0.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-08-31T22:21:12.181Z

**Re-validation against sp 0.3.70 (2026-08-31).** 0727 was filed by an agent running a stale
installed `sp` plugin. Re-checked each item against the reloaded plugin
(`~/.claude/plugins/cache/spur/sp/0.3.70`, byte-identical to `plugins/sp/` at HEAD 834bd934f).

- **R1 — still valid, framing corrected.** Real gap confirmed at `inline-pipeline-driver.md:35-45`:
  step 4 says "Mark the active state" and sets a stage-boundary refresh cadence, but never says to
  mark the *finished* stage `completed`, and says nothing about the post-fallback path. The original
  claim that stage state "died with the subagent's todo store" is a misdiagnosis — step 4 is a host
  step and the todo list is host-owned by contract; nothing hands it to a subagent. Requirement
  reworded to the actual defect: reconciliation is host-owned and surface-independent.
- **R2 — partially invalid, re-scoped.** Two of its three asks are dead:
  1. "host-inline by default for implement-scale stages" contradicts the settled contract —
     ADR-047 amendment 2026-08-10 (task 0508, `docs/00_ADR.md:388`) and the driver's
     "Native-subagent dispatch (R2 eligibility)" section make native-subagent-first the default for
     eligible model stages, with "No token estimate, stage-size threshold, model heuristic, or
     configuration switch" allowed. Dropped.
  2. "and then re-execute everything inline" is *already prohibited*:
     `inline-pipeline-driver.md:118-120` ("do **not** replay the stage in the host") plus the
     implement stage's default `fail` policy (`config/workflows/task-pipeline.yaml`, implement
     `description`). The 0726 run violated an existing rule; no new prohibition is needed.
  What survives is a genuine gap: the inline dispatch path has **no** timeout/partial-work contract.
  `timeoutMs` is declared "not applicable" only for *host* execution (`:76-77`) and is silent on a
  dispatched subagent; and the task-0424 resume runbook is scoped "On the subprocess path"
  (`execution-workflow.md`) and keyed on `.spur/run/<runId>-implement-partial.md`, written only by
  `packages/app/src/workflow/actions/agent-run.ts` — never reached inline. R2 now targets that.
- **R3 — valid as filed.** No timestamp rule exists anywhere in the driver contract, and the
  code-side sink `packages/app/src/observability/workflow-run-log-sink.ts` stamps nothing (it mirrors
  the human renderer). All timestamps in `.spur/run/*.log` on the inline path are hand-appended, so
  the normalization rule belongs in the driver contract. Evidence reconfirmed in
  `.spur/run/a33bbfbd-ed97-4325-ab4b-c9f5a4f64c50.log`: line 5 `2026-08-31T17:51:11Z` vs lines 7-30
  `[re-apply 11:58]` / `[implement close-out 12:00]` / `[stage 12:31]`.

**Scope shape.** All three land in `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`
with contract assertions in `plugins/sp/tests/inline-execution-contract.test.ts` (the existing guard
for this doc). No CLI surface change, so no public-surface consent and no `docs/04_DESIGN.md` entry.

#### Q&A entry — 2026-08-31T22:25:46.504Z

**Re-validation against sp 0.3.70 (2026-08-31).** 0727 was filed by an agent running a stale
installed `sp` plugin. Re-checked each item against the reloaded plugin
(`~/.claude/plugins/cache/spur/sp/0.3.70`, byte-identical to `plugins/sp/` at HEAD 834bd934f).

- **R1 — still valid, framing corrected.** Real gap confirmed at `inline-pipeline-driver.md:35-45`:
  step 4 says "Mark the active state" and sets a stage-boundary refresh cadence, but never says to
  mark the *finished* stage `completed`, and says nothing about the post-fallback path. The original
  claim that stage state "died with the subagent's todo store" is a misdiagnosis — step 4 is a host
  step and the todo list is host-owned by contract; nothing hands it to a subagent. Requirement
  reworded to the actual defect: reconciliation is host-owned and surface-independent.
- **R2 — partially invalid, re-scoped.** Two of its three asks are dead:
  1. "host-inline by default for implement-scale stages" contradicts the settled contract —
     ADR-047 amendment 2026-08-10 (task 0508, `docs/00_ADR.md:388`) and the driver's
     "Native-subagent dispatch (R2 eligibility)" section make native-subagent-first the default for
     eligible model stages, with "No token estimate, stage-size threshold, model heuristic, or
     configuration switch" allowed. Dropped.
  2. "and then re-execute everything inline" is *already prohibited*:
     `inline-pipeline-driver.md:118-120` ("do **not** replay the stage in the host") plus the
     implement stage's default `fail` policy (`config/workflows/task-pipeline.yaml`, implement
     `description`). The 0726 run violated an existing rule; no new prohibition is needed.
  What survives is a genuine gap: the inline dispatch path has **no** timeout/partial-work contract.
  `timeoutMs` is declared "not applicable" only for *host* execution (`:76-77`) and is silent on a
  dispatched subagent; and the task-0424 resume runbook is scoped "On the subprocess path"
  (`execution-workflow.md`) and keyed on `.spur/run/<runId>-implement-partial.md`, written only by
  `packages/app/src/workflow/actions/agent-run.ts` — never reached inline. R2 now targets that.
- **R3 — valid as filed.** No timestamp rule exists anywhere in the driver contract, and the
  code-side sink `packages/app/src/observability/workflow-run-log-sink.ts` stamps nothing (it mirrors
  the human renderer). All timestamps in `.spur/run/*.log` on the inline path are hand-appended, so
  the normalization rule belongs in the driver contract. Evidence reconfirmed in
  `.spur/run/a33bbfbd-ed97-4325-ab4b-c9f5a4f64c50.log`: line 5 `2026-08-31T17:51:11Z` vs lines 7-30
  `[re-apply 11:58]` / `[implement close-out 12:00]` / `[stage 12:31]`.

**Scope shape.** All three land in `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`
with contract assertions in `plugins/sp/tests/inline-execution-contract.test.ts` (the existing guard
for this doc). No CLI surface change, so no public-surface consent and no `docs/04_DESIGN.md` entry.

**Open premise (LOW confidence) — the source of the 1800000ms boundary is unproven.** The 0726 run
log records `host timeout 1800000ms`, and `config/workflows/task-pipeline.yaml` sets
`implementTimeoutMs: "1800000"`. Whether the driver self-applied that YAML value to a native-subagent
dispatch, or the host platform independently imposed a 30-minute subagent limit that coincides with
it, was **not** established — the two are indistinguishable from the log alone. R2 is written as a
prescription (declare and log whichever boundary governs), so it holds under either reading and the
implementer is not blocked. But do not assert the cause in `## Solution` without evidence: confirm it
first by dispatching a native subagent from an inline run with `implementTimeoutMs` temporarily set to
a distinct value (e.g. 90000) and reading which boundary fires. If the platform limit turns out to be
the governing one, the frozen phrase "the host platform's subagent limit, not the YAML timeoutMs"
is confirmed as written; if the driver was applying the YAML value, the same phrase becomes the
corrective rule rather than a description, and the R2 text should say so explicitly.

#### Q&A entry — 2026-09-01T00:03:28.390Z

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-08-31T22:25:46.504Z

**Re-validation against sp 0.3.70 (2026-08-31).** 0727 was filed by an agent running a stale
installed `sp` plugin. Re-checked each item against the reloaded plugin
(`~/.claude/plugins/cache/spur/sp/0.3.70`, byte-identical to `plugins/sp/` at HEAD 834bd934f).

- **R1 — still valid, framing corrected.** Real gap confirmed at `inline-pipeline-driver.md:35-45`:
  step 4 says "Mark the active state" and sets a stage-boundary refresh cadence, but never says to
  mark the *finished* stage `completed`, and says nothing about the post-fallback path. The original
  claim that stage state "died with the subagent's todo store" is a misdiagnosis — step 4 is a host
  step and the todo list is host-owned by contract; nothing hands it to a subagent. Requirement
  reworded to the actual defect: reconciliation is host-owned and surface-independent.
- **R2 — partially invalid, re-scoped.** Two of its three asks are dead:
  1. "host-inline by default for implement-scale stages" contradicts the settled contract —
     ADR-047 amendment 2026-08-10 (task 0508, `docs/00_ADR.md:388`) and the driver's
     "Native-subagent dispatch (R2 eligibility)" section make native-subagent-first the default for
     eligible model stages, with "No token estimate, stage-size threshold, model heuristic, or
     configuration switch" allowed. Dropped.
  2. "and then re-execute everything inline" is *already prohibited*:
     `inline-pipeline-driver.md:118-120` ("do **not** replay the stage in the host") plus the
     implement stage's default `fail` policy (`config/workflows/task-pipeline.yaml`, implement
     `description`). The 0726 run violated an existing rule; no new prohibition is needed.
  What survives is a genuine gap: the inline dispatch path has **no** timeout/partial-work contract.
  `timeoutMs` is declared "not applicable" only for *host* execution (`:76-77`) and is silent on a
  dispatched subagent; and the task-0424 resume runbook is scoped "On the subprocess path"
  (`execution-workflow.md`) and keyed on `.spur/run/<runId>-implement-partial.md`, written only by
  `packages/app/src/workflow/actions/agent-run.ts` — never reached inline. R2 now targets that.
- **R3 — valid as filed.** No timestamp rule exists anywhere in the driver contract, and the
  code-side sink `packages/app/src/observability/workflow-run-log-sink.ts` stamps nothing (it mirrors
  the human renderer). All timestamps in `.spur/run/*.log` on the inline path are hand-appended, so
  the normalization rule belongs in the driver contract. Evidence reconfirmed in
  `.spur/run/a33bbfbd-ed97-4325-ab4b-c9f5a4f64c50.log`: line 5 `2026-08-31T17:51:11Z` vs lines 7-30
  `[re-apply 11:58]` / `[implement close-out 12:00]` / `[stage 12:31]`.

**Scope shape.** All three land in `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`
with contract assertions in `plugins/sp/tests/inline-execution-contract.test.ts` (the existing guard
for this doc). No CLI surface change, so no public-surface consent and no `docs/04_DESIGN.md` entry.

**Open premise (LOW confidence) — the source of the 1800000ms boundary is unproven.** The 0726 run
log records `host timeout 1800000ms`, and `config/workflows/task-pipeline.yaml` sets
`implementTimeoutMs: "1800000"`. Whether the driver self-applied that YAML value to a native-subagent
dispatch, or the host platform independently imposed a 30-minute subagent limit that coincides with
it, was **not** established — the two are indistinguishable from the log alone. R2 is written as a
prescription (declare and log whichever boundary governs), so it holds under either reading and the
implementer is not blocked. But do not assert the cause in `## Solution` without evidence: confirm it
first by dispatching a native subagent from an inline run with `implementTimeoutMs` temporarily set to
a distinct value (e.g. 90000) and reading which boundary fires. If the platform limit turns out to be
the governing one, the frozen phrase "the host platform's subagent limit, not the YAML timeoutMs"
is confirmed as written; if the driver was applying the YAML value, the same phrase becomes the
corrective rule rather than a description, and the R2 text should say so explicitly.

### Design

**WHAT.** Three amendments to one contract file plus the assertions that hold them. No behavior code:
the inline driver *is* the contract text an agent reads, so the fix is the text and the tests that
freeze it.

**WHY.** All three defects are under-specification, not implementation bugs. RC-2's prohibition
(no host replay) and RC-2's recovery runbook (0424) both already exist — they simply never name the
inline dispatch path, so a driver reading only the driver doc cannot reach them.

**WHERE (file targets — no others).**

| File | Change |
| --- | --- |
| `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` | R1 step-4 bullet; R2 dispatch/join paragraph; R3 run-log rule |
| `plugins/sp/skills/spur-dev/references/execution-workflow.md` | one pointer under § "Large tasks and timed-out implement resume" naming the inline-path equivalent |
| `plugins/sp/tests/inline-execution-contract.test.ts` | one new `test('0727 …')` asserting the frozen phrases against the driver doc |
| `plugins/sp/tests/inline-pipeline-driver.test.ts` | stamp the harness's appended log lines; assert the produced log is ISO-8601 UTC throughout |

**Frozen contract phrases** — the tests assert these literals; implement them verbatim, do not
paraphrase:

- R1: `mark the finished stage completed and the next stage in_progress` ·
  `host-owned and execution-surface-independent`
- R2: `the host platform's subagent limit, not the YAML timeoutMs` ·
  `record the governing timeout boundary and its source before dispatch` ·
  `a dispatch timeout is a started-subagent failure` ·
  `resume from the partial tree, never restart the stage inline`
- R3: `ISO-8601 UTC` · `bare local-clock stamps are prohibited`

**Precedence.** Where R2's new text meets an existing rule, the existing rule wins. The no-replay
sentence at `inline-pipeline-driver.md:119` and each stage's declared YAML error policy are unchanged;
the new text classifies a timeout *into* them and does not create an exception to them.

**Anti-patterns — do NOT implement.**

1. **No execution-surface policy switch.** ADR-047's 2026-08-10 amendment (task 0508,
   `docs/00_ADR.md:388`) forbids any "token estimate, stage-size threshold, model heuristic, or
   configuration switch"; native-subagent-first stands. The original R2's "host-inline by default for
   implement-scale stages" is dropped, not deferred.
2. **No inline replay of a failed or timed-out stage.** That is the defect, not the fix.
3. **Do not edit `config/workflows/task-pipeline.yaml`.** `implementTimeoutMs` governs the subprocess
   path and stays as-is; touching that file also re-enters the 0726 indent war (four rounds).
4. **Do not add timestamping to `workflow-run-log-sink.ts`.** It is the subprocess sink and is out of
   scope; R3 is a driver-contract rule for hand-appended lines.
5. **No reformat.** Surgical hunks at HEAD-native indent only — 0726's P1 review finding was a
   whitespace-tolerant edit that reindented a whole file.

**No new API.** No CLI noun/verb/flag, no config key, no schema change — so no public-surface consent
(`docs/design/harness-surface-governance.md`) and no `docs/04_DESIGN.md` entry is required.

**Handoff.** `dependencies[]` is empty; nothing is left for a dependent task.

### Plan

- [x] 1. R1 — amend `inline-pipeline-driver.md` step 4 (the refresh-cadence bullet, `:42`) so each
      transition marks the finished stage completed and the next in_progress, and state that the
      reconciliation is host-owned and execution-surface-independent (subagent, host-inline, fallback).
- [x] 2. R2 — amend the "Dispatch and join" paragraph (`:100`–`:120`): name the governing timeout
      boundary for a dispatched subagent, require it logged before dispatch, and classify a dispatch
      timeout as a started-subagent failure that routes through the existing no-replay rule and the
      stage's YAML error policy.
- [x] 3. R2 — add the inline recovery route: resume from the partial tree, never restart the stage
      inline; cross-link it from `execution-workflow.md` § "Large tasks and timed-out implement
      resume" so the 0424 runbook is reachable from the inline path.
- [x] 4. R3 — add the run-log timestamp rule to the driver's provenance/log paragraph: ISO-8601 UTC on
      every appended line, bare local-clock stamps prohibited.
- [x] 5. Tests — add `test('0727 …')` to `plugins/sp/tests/inline-execution-contract.test.ts`
      asserting each frozen phrase; in `plugins/sp/tests/inline-pipeline-driver.test.ts` stamp the
      appended lines and assert the produced log parses as ISO-8601 UTC with zero local-clock matches.
- [x] 6. Verify — `bun test ./plugins` from the repo root (plugins/sp is not a workspace; a
      repo-root run is required), then `bun run spur-check` and `git status --short`.

### Root Cause

Three independent gaps in one contract file, each re-confirmed against sp 0.3.70 (installed cache
byte-identical to `plugins/sp/` at HEAD `834bd934f`).

**RC-1 (R1) — the todo contract never closes a stage.**
`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:38` ends the layer-1 rule at
"Mark the active state", and `:42` sets the refresh cadence to stage boundaries. Neither line says
the *finished* stage is marked completed, and nothing binds the rule to the post-dispatch fallback
path. A driver that follows the text to the letter leaves every prior stage `in_progress` — exactly
the 0/11 end state the 0726 run produced.

**RC-2 (R2) — the inline dispatch path has no timeout contract and no resume route.**
`inline-pipeline-driver.md:77` scopes the `timeoutMs`-is-not-applicable rule to *host* execution
("the host session has no independent kill boundary"). The native-subagent dispatch block
(`:100`–`:120`) never states which boundary governs a **dispatched** subagent, so the driver applied
the YAML's `implementTimeoutMs` (1800000) and, on expiry, fell back to host execution — contradicting
`:119`, which already forbids replaying the stage in the host. The runbook that should have caught
this, `plugins/sp/skills/spur-dev/references/execution-workflow.md:283` ("Large tasks and timed-out
implement resume", task 0424), is scoped "On the subprocess path" (`:255`) and keyed on the
partial-work artifact built at `packages/app/src/workflow/actions/agent-run.ts:566` — code the inline
driver never executes. Inline therefore has neither a timeout rule nor a recovery route.

**RC-3 (R3) — no timestamp format is prescribed anywhere.**
The driver's run-log contract specifies line *content* but never a stamp format. The subprocess sink
`packages/app/src/observability/workflow-run-log-sink.ts:39` mirrors the foreground human renderer
and adds no timestamps; on the inline path every line is hand-appended, mirrored by the smoke harness
at `plugins/sp/tests/inline-pipeline-driver.test.ts:158`, which appends the provenance line with no
stamp at all. With no prescribed format the driver mixed `2026-08-31T17:51:11Z` with
`[implement close-out 12:00]` in the same file.

### Solution

| File | What/why |
| --- | --- |
| `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:44-50` | R1 — step-4 "Transition reconciliation" bullet: each boundary must mark the finished stage completed and the next stage in_progress; host-owned and execution-surface-independent (subagent/host-inline/fallback). |
| `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:128-141` | R2 — "Timeout boundary" paragraph: dispatched subagent governed by the host platform's subagent limit (not YAML timeoutMs); boundary+source logged before dispatch; dispatch timeout = started-subagent failure → existing no-replay rule + YAML error policy; recovery resumes the partial tree inline. |
| `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:151-155` | R3 — run-log stamp rule: ISO-8601 UTC prefix on every appended line; bare local-clock stamps prohibited. |
| `plugins/sp/skills/spur-dev/references/execution-workflow.md:317-322` | R2 — pointer under § "Large tasks and timed-out implement resume" naming the inline-path equivalent (no partial-work artifact inline; working tree is the recovery input). |
| `plugins/sp/tests/inline-execution-contract.test.ts:316-341` | `test('0727 …')` asserting every frozen contract phrase against the driver doc and the execution-workflow cross-link. |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:108-110` | R3 — smoke harness `isoStamp()` helper; both log-append sites (provenance + note) now stamp lines. |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:224-231` | R3 — smoke asserts every produced log line matches ISO-8601 UTC and zero bare local-clock forms. |

Rationale: all three defects are contract under-specification in the inline driver doc, so the fix is the text plus the contract assertions that freeze it (per task Design). Frozen phrases implemented verbatim; no code-side sink touched (`workflow-run-log-sink.ts` stays unstamped by scope); `task-pipeline.yaml` untouched (0726 indent war). No CLI/config/schema change — no public-surface consent needed.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:44-49` — step-4 bullet "Transition reconciliation (task 0727)": at every stage boundary the host must **mark the finished stage completed and the next stage in_progress** in the host todo list; declared **host-owned and execution-surface-independent**, firing identically via native subagent, host-inline, or post-dispatch host fallback (`:46-48`), naming the 0726 0/11 end state it closes (`:48-49`). Frozen phrases asserted at `plugins/sp/tests/inline-execution-contract.test.ts:322-323`. |
| R2 | MET | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:128-139` — "Timeout boundary (task 0727)": (i) a dispatched subagent is governed by `the host platform's subagent limit, not the YAML timeoutMs` (`:128-129`) and the driver must `record the governing timeout boundary and its source before dispatch` in the run log, with example format (`:130-132`); (ii) `a dispatch timeout is a started-subagent failure` routed into the pre-existing no-replay rule at `:124-126` (unchanged — Design precedence held) plus the stage's declared YAML error policy, implement's default `fail` → `failed`, "never a host re-execution" (`:132-135`); (iii) inline recovery `resume from the partial tree, never restart the stage inline`, with no `<runId>-implement-partial.md` written on this path (`:135-139`). Cross-linked from `plugins/sp/skills/spur-dev/references/execution-workflow.md:317-321` under § "Large tasks and timed-out implement resume" (`:284`), so the 0424 runbook is reachable inline. Asserted at `plugins/sp/tests/inline-execution-contract.test.ts:325-328` and `:338`. |
| R3 | MET | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:151-155` — "Run-log stamps (task 0727)": every appended line prefixed with an **ISO-8601 UTC** timestamp (`YYYY-MM-DDTHH:MM:SSZ`), exact-template provenance lines keeping their content after the prefix (`:151-153`); `bare local-clock stamps are prohibited`, naming the `[stage 12:31]` form as the violation (`:154-155`). Harness enforces it: `plugins/sp/tests/inline-pipeline-driver.test.ts:108-110` `isoStamp()` helper, both append sites stamped (`:162` provenance, `:166` note), smoke asserts every produced line ISO-stamped with zero bare local-clock matches and a non-vacuous line count (`:224-230`). Asserted at `plugins/sp/tests/inline-execution-contract.test.ts:330-331`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Driver text carries both R1 phrases at `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:44-49`; `plugins/sp/tests/inline-execution-contract.test.ts:322-323` asserts them verbatim. Fresh run this session: `bun test plugins/sp/tests/inline-execution-contract.test.ts plugins/sp/tests/inline-pipeline-driver.test.ts` → 18 pass, 0 fail, 285 expect() calls, exit 0. |
| AC2 | MET | test | Driver text at `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:128-139` covers (i) governing boundary + pre-dispatch logging, (ii) timeout-as-started-subagent-failure routed to the intact no-replay rule (`:124-126`) and YAML error policy, (iii) partial-tree resume; cross-link at `plugins/sp/skills/spur-dev/references/execution-workflow.md:317-321`. All four phrases plus the cross-link asserted at `plugins/sp/tests/inline-execution-contract.test.ts:325-328,338`; same 18/0 run above. |
| AC3 | MET | command | Contract phrases asserted at `plugins/sp/tests/inline-execution-contract.test.ts:330-331`; smoke enforcement at `plugins/sp/tests/inline-pipeline-driver.test.ts:108-110,162,166,224-230`. **Live-run clause satisfied this run** (upgrade over the prior verdict's smoke-proxy caveat): the first post-0727 inline run log `.spur/run/c75b6823-1200-4964-aaad-56fe6a52c03a.log` is 44/44 lines ISO-8601 UTC-prefixed, and `grep -cE '^\[[a-z-]+ [0-9]{1,2}:[0-9]{2}\]' .spur/run/c75b6823-1200-4964-aaad-56fe6a52c03a.log` → `0`. Repo-wide sweep of all 66 `.spur/run/*.log`: the only file with bare local-clock stamps is the pre-fix defect exhibit `.spur/run/a33bbfbd-ed97-4325-ab4b-c9f5a4f64c50.log` (17), which is 0726's evidence log, not a post-fix run. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

**Scope:** task 0727 diff — `inline-pipeline-driver.md`, `execution-workflow.md`, `inline-execution-contract.test.ts`, `inline-pipeline-driver.test.ts` (+ task doc)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS — review run `d5491d0d`; verdict **transfers** to this rerun: all four diff-basis files byte-identical to review-time hashes (`.spur/run/0727-diff-hashes.txt`, confirmed 2026-08-31T17:01Z), targeted contract tests re-run post-0728: 18 pass / 0 fail.

Findings from run `2c5949b8`, enumerated: **2 minor + 3 advisory** (the log header's "3 minor + 2 advisory" is a miscount; enumeration is authoritative). Rerun dispositions inline.

#### Findings (ranked)

| # | Priority | Severity | Dimension | Finding | Location | Rerun disposition |
| --- | ---------- | ---------- | ----------- | --------- | ---------- | ----------------- |
| 1 | P2 | minor | scope | stray one-line `>` blockquote continuation under the R1/0478 note; benign rendering fix outside the file's three declared changes (autofix-attributed) | `execution-workflow.md:100` | kept — the formatter re-applies it at every gate; reverting fights the gate |
| 2 | P2 | minor | housekeeping | `## Testing` empty placeholder while Plan item 6 checked; gate evidence exists but section not backfilled | task doc | resolved by pipeline design — `spur task record` writes Testing from the verdict artifact (as executed on 0728) |
| 3 | P3 | advisory | correctness | R2 states "the host platform's subagent limit" as settled fact while the Q&A open premise (platform limit vs driver-applied YAML `timeoutMs` in the 0726 run) was never empirically tested | `inline-pipeline-driver.md:128-131` | premise stands open (LOW confidence): run 2c5949b8's pre-dispatch line *recorded* the boundary per R2 but is assertion, not the controlled experiment (distinct `implementTimeoutMs`) the Q&A proposes; R2's prescription holds under either reading, so accepted as-is |
| 4 | P3 | advisory | hygiene | duplicate verbatim Q&A entries (22:21:12Z / 22:25:46Z) | task doc `## Q&A` | root cause found this rerun: `spur task update --section Q&A` is **append-only** (no dedupe/replace verb; repeated applies each append a timestamped entry — now 4 incl. two CLI stubs); no sanctioned CLI path to remove entries, so left as-is; raw corpus edit declined (CLI-gated writes rule). Follow-up candidate: Q&A section replace verb |
| 5 | P3 | advisory | functional | AC3's live-run grep clause covered only by the smoke-harness proxy; real hand-appended lines proven compliant only by future runs | `inline-pipeline-driver.test.ts:224-231` | accepted — contract rule by design; smoke asserts ISO stamps on both append sites; this rerun's log is hand-stamped ISO-8601 UTC throughout (R3 practicing) |

No blocker or major findings.

#### Functional Traceability

| Req | Status | Evidence |
| ----- | -------- | ---------- |
| R1 | MET | `inline-pipeline-driver.md:44-50` — step-4 "Transition reconciliation" bullet: finished stage `completed` / next `in_progress`, host-owned and execution-surface-independent (subagent / host-inline / post-dispatch fallback); asserted at `inline-execution-contract.test.ts:320-322` |
| R2 | MET | `inline-pipeline-driver.md:128-141` — governing boundary named (`the host platform's subagent limit, not the YAML timeoutMs`), boundary+source logged before dispatch, dispatch timeout = started-subagent failure routed to the intact no-replay rule + YAML error policy; inline recovery `resume from the partial tree, never restart the stage inline`; cross-linked from `execution-workflow.md:317-322`; asserted at `inline-execution-contract.test.ts:323-332` |
| R3 | MET | `inline-pipeline-driver.md:151-156` — ISO-8601 UTC prefix on every appended line, bare local-clock stamps prohibited; harness stamps both append sites (`inline-pipeline-driver.test.ts:108-110,162,166`) and asserts all lines ISO + zero local-clock forms (`:224-231`); contract phrases asserted at `inline-execution-contract.test.ts:333-335` |

Anti-pattern compliance: `config/workflows/task-pipeline.yaml` and `packages/app/src/observability/workflow-run-log-sink.ts` diffs empty (out of scope respected); no CLI/config/schema change; no host-inline default switch.

#### Verification (fresh, review run `d5491d0d`)

- `bun test plugins/sp/tests/inline-execution-contract.test.ts plugins/sp/tests/inline-pipeline-driver.test.ts` → 18 pass, 0 fail
- `bun test ./plugins` → 1244 pass, 0 fail; `bun run spur-check` → 7073 pass, 0 fail, exit 0
- `git status --short` → exactly the 5 expected modified files, nothing staged

#### Residual risk

- R2 governing-boundary source (platform limit vs YAML `timeoutMs`) remains empirically unconfirmed (Q&A open premise, LOW confidence); the prescription holds under either reading — the Q&A's proposed controlled experiment remains the closure path.
- AC3 compliance of future human/agent-appended log lines is enforced by contract text plus each run's per-dispatch logging discipline.

### References

- Evidence run log: `.spur/run/a33bbfbd-ed97-4325-ab4b-c9f5a4f64c50.log` (0726 inline full run).
- Contract under change: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`.
- Subprocess timeout runbook (task 0424): `plugins/sp/skills/spur-dev/references/execution-workflow.md`
  § "Large tasks and timed-out implement resume".
- Partial-work artifact writer (subprocess-only): `packages/app/src/workflow/actions/agent-run.ts:566`.
- Subprocess run-log sink (stamps nothing): `packages/app/src/observability/workflow-run-log-sink.ts`.
- Execution-surface decision: `docs/00_ADR.md:388` — ADR-047 amendment 2026-08-10 (task 0508).
- Contract tests: `plugins/sp/tests/inline-execution-contract.test.ts`,
  `plugins/sp/tests/inline-pipeline-driver.test.ts`.
- Parent session task: 0726 (F91, done). Re-validation baseline: installed sp 0.3.70 at
  `~/.claude/plugins/cache/spur/sp/0.3.70`, byte-identical to `plugins/sp/` at HEAD `834bd934f`.

### History

- 2026-08-31T22:45:50.139Z todo → wip (system)
- 2026-09-01T00:15:51.520Z wip → testing (system)
- 2026-09-01T00:15:51.771Z testing → done (system)
