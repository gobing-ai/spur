---
schema_version: 1
name: Dogfood 0800 findings register — inline proof binding, fingerprint globs, gate busy-retry, verify AC-id contract, and done-guard
status: todo
template: issue
created_at: 2026-09-08T00:53:08.613Z
updated_at: "2026-09-08T01:05:05.889Z"

priority: P2
ac_altitude: task-local
---

## 0804. Dogfood 0800 findings register — inline proof binding, fingerprint globs, gate busy-retry, verify AC-id contract, and done-guard

### Background

Consolidated register of every **unsolved, still-actionable** finding from the 2026-09-07 dogfood of
`/sp:dev-run 0800 --auto --next --agent inline`
(run `2026-09-07-dev-run-0800`; report `docs/dogfood/2026-09-07-dev-run-0800-dogfood.md`;
protocol `sp:dogfood-testing@1.2`; HEAD at fingerprint `e31827153`).

The dogfood itself **PASS**ed (task 0800 reached terminal `done` with verify PASS). Nothing here is
a regression in 0800's shipped requirements. These are latent harness defects the run surfaced
while exercising the inline full pipeline. Each finding carries file:line evidence and a frozen
fix so this task is implementable without reopening the report.

#### Findings inventory

IDs `F1`–`F11` are referenced consistently across Requirements, Root Cause, Design, Plan, and
Acceptance Criteria.

| ID | Report severity | Class | Finding | Primary seam |
| --- | --- | --- | --- | --- |
| F1 | P2 | testee | Bound `run.artifact` (`proofBinding: current`) refuses on the inline path — no `runs` row, empty `__definitionDigest` — so `record` silently drops verdict-ledger registration. Reproduced twice (0795-run dogfood P2 + this run). | `packages/app/src/workflow/actions/run-artifact.ts:324`; inline driver Run setup |
| F2 | P2 | testee | Proof fingerprint `DEFAULT_EXCLUDE_GLOBS` is only `docs/tasks*` + `docs/features*`. The dogfood driver's own writes under `docs/dogfood/` invalidate the digest mid-run (this run needed an operator-sanctioned proof-window restart). | `packages/app/src/workflow/proof-input-fingerprint.ts:172` |
| F3 | P2 | testee | Quality-gate SQLite retry greps the literal `SQLiteError: database is locked`, but the CLI remaps `SQLITE_BUSY` to `SQLite database is busy; another Spur process is holding the lock.` The 5×/10s retry never fires. Same miss on `retry_transient`. | `config/workflows/task-pipeline.yaml:434,:550,:338,:750,:797`; `apps/cli/src/errors.ts:37-44` |
| F4 | P2 | testee | `verify-answer-lint` rejects the AC IDs `/sp:dev-verify` actually emits (descriptive paraphrases such as `AC1 transition refused with open box`). Substantive PASS, shape FAIL; cost one verifier resume (~84k tokens). | `plugins/sp/scripts/verify-answer-lint.ts:260-368`; `plugins/sp/skills/code-verification/SKILL.md:168-176,284-297` |
| F5 | P2 | environment | Concurrent external writers (a second agent session) mutated/committed the tree mid-run, including 0800's own implementation. The worktree advisory already exists (dogfood-testing R2 / task 0296) but is not surfaced at Phase 1 when porcelain is dirty. | `plugins/sp/skills/dogfood-testing/SKILL.md` §Workspace-drift guard / Worktree advisory |
| F6 | P3 | testee | In-pipeline `record → done` guard runs plain `spur task check $wbs` (no `--as done`). Combined with `task update done --no-lifecycle` (skips `task-lifecycle.yaml`, which *does* pass `--as done`), 0800 R1's transition-target `error` never fires inside the pipeline. 0800 nearly closed with 2 open Close boxes; only the driver's documented `--as done` probe caught it. | `config/workflows/task-pipeline.yaml:1020`; `config/workflows/task-pipeline.yaml:806`; `packages/app/src/services/task-check.ts:546,911` |
| F7 | P3 | testee | Chained-step cost is half-observable: subagent usage gives totals (tokens / tool-uses / duration) but no fresh/cached split, forcing pessimistic `Cached ~0` and a misleading run-level ~1% cache rate. Report tagged `[unverifiable]`. | dogfood-testing Cost segmentation; monitor-ledger.md |
| F8 | P3 | waste | Driver-only cache% ~5%, dominated by two 39626-byte `spur-check` logs consumed in full (one of them the sanctioned restart). Both could have been tail-consumed. | dogfood-testing monitor-ledger practice |
| F9 | P4 | testee | `.spur/run/${vars.__runId}-route-reason.txt` exists literally — some past inline run wrote the route-reason without resolving `__runId`. The empty-check fallback to `pipeline-$wbs` does not catch an unresolved interpolation (the literal is non-empty). | `config/workflows/task-pipeline.yaml:267-279` |
| F10 | P4 | testee | Verify answers carry glob / underscore anchors (`0787_*.md:204-275`) that L4 can never match (`L4.anchor-subject-mismatch`). The rule is already documented for Solution tables in the inline driver; the verify skill still emits the bad form. | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:206-210`; `plugins/sp/skills/code-verification/SKILL.md:123-143,178-180` |
| F11 | P4 | environment | An external writer deleted the `docs/dogfood/` report file mid-run (untracked, no git trace). The live SSOT under `.spur/run/dogfood/` saved the run. Dual artifacts proved their worth; finalize must restore the report from live when the report path is missing. | dogfood-testing Phase 4 finalize; report-template.md dual-artifact contract |

#### Excluded (already in the pipeline / already shipped)

Do **not** re-implement these. They are listed so an implementer does not rediscover them from the
same report.

| Report item | Why excluded | Owner |
| --- | --- | --- |
| P2 history-daily child wedge (WAL static, write lock held indefinitely; 3/3 at 21:15, 21:49, 23:00) | Filed and shipped | **0803** (`done` 2026-09-08) — watchdog timeout, PASSIVE checkpoint, bounded BUSY, stale-processing sweep |
| SQLITE_BUSY CLI diagnostic message + rule-run `busy_timeout` | Different seam; 0801 changed the *message* this task's F3 must now match | **0801** (`done`) — `apps/cli/src/errors.ts:37-44` remaps to `SQLite database … is busy` |
| Task 0800 itself (Plan checkboxes, review heading level, docs/help drift, task-list status, transition-target severity) | The dogfood testee; shipped | **0800** (`done`) |
| 0795 F1–F5 (status-filter validation, pipeline-token table, ADR-110 premise, Q&A write-contract docs, `replaceSection` spacing) | Different dogfood (refineall J31) | **0795** (`done`) |
| In-session verify-answer AC-ID workaround | Runtime resume of the verifier with the 9 canonical titles; lint PASS on re-run. The **root-cause producer/consumer mismatch remains as F4**. | Dogfood fix-attempt 1 (answer-file only; no gate weakening) |
| Open pipeline tasks 0796 / 0797 / 0798 / 0799 / 0802 | Executor quota / observability polish — no overlap with this report | current `todo` set |

Open tasks at filing (2026-09-08): 0796, 0797, 0798, 0799, 0802. None share a seam with F1–F11.

#### Why one task

F1–F11 share one evidence source and one review pass, not one module. They are independently
landable — see the Plan's slice boundaries. Grouping them avoids eleven one-line follow-ups that
lose the dogfood context.

Deliberately created **without** `feature_id`. The findings span the inline driver, the pipeline
YAML, proof fingerprinting, the verify skill, and the dogfood protocol — no single feature owns
the set. `ac_altitude: task-local` is set so a later accidental feature link cannot fail DD-09.
The L4 missing-feature_id advisory is accepted.

#### Incident facts the implementer must not re-derive

- **Repro:** `/sp:dev-dogfood "/sp:dev-run 0800 --auto --next --agent inline" --save --full --task --max-retry --agent inline`
- **Exact invocation:** `Skill(skill="sp:spur-dev", args="run-inline 0800 --auto --next --agent inline")`
- **Wall-clock:** ~210 min, including ~55 min environmental DB-lock block (0803) and two operator-assisted daemon/child kills.
- **Proof-window restart:** first digest `9ec75cca…` invalidated when 0800's impl was committed externally mid-run (5 commits). Operator-sanctioned recapture `f3c1ea53…`. Gate re-run then hit `SQLite database is busy` (23:00 tick) — YAML retry did not fire (F3).
- **run.artifact skip:** inline record continued with `spur task record --solution-from-diff --transition testing` after bound registration refused. Authentic YAML would halt record. Same skip in the 0795-run dogfood (`docs/dogfood/2026-09-07-sp-dev-run-0795-auto-next-agent-inline-dogfood.md:67,84,104`).
- **Verify lint:** producer wrote `AC1 transition refused with open box`; lint requires the task's canonical Gherkin scenario title (0800 AC1 is `AC1. With a second writer holding the project db…` / Scenario title form). Resume with the 9 canonical titles → lint PASS.
- **Done-probe:** `spur task check 0800 --as done` was the only in-run enforcement of 0800 R1; the YAML guard at `:1020` would have accepted the testing-status warning.
- **Literal route-reason file:** `.spur/run/${vars.__runId}-route-reason.txt` observed on disk from a prior inline run.

#### Review Findings (input table for this register)

| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P2 | `packages/app/src/workflow/actions/run-artifact.ts:324` | Inline run id has no `runs` row; `__definitionDigest` empty; 0785 R3 refuses binding; driver skips registration | Persist a run row + definition digest on the inline path before `run.artifact`. Do **not** unbind. |
| P2 | `packages/app/src/workflow/proof-input-fingerprint.ts:172` | `DEFAULT_EXCLUDE_GLOBS` misses generated-report dirs | Add `docs/dogfood*`, `docs/plans*`, `docs/report*`. |
| P2 | `config/workflows/task-pipeline.yaml:434` | Retry keys on raw `SQLiteError: database is locked` only | Match a lock-class pattern covering the remapped busy string, at every retry site. |
| P2 | `plugins/sp/scripts/verify-answer-lint.ts:366` | Lint requires exact identity; verify skill example invites paraphrases / short titles | Producer copies canonical Scenario titles; lint accepts the four identity forms; paraphrases still fail. |
| P2 | `plugins/sp/skills/dogfood-testing/SKILL.md` | Worktree advisory exists but is not echoed at Phase 1 on a dirty tree | Echo a dirty-porcelain / parallel-session warning in the Phase 1 plan. Do not refuse. |
| P3 | `config/workflows/task-pipeline.yaml:1020` | `record → done` guard is plain `task check` | Use `task check $wbs --as done`. Leave `--no-lifecycle` as bookkeeping. |
| P3 | dogfood Cost block | Chained cache split unobservable | Always report driver-only and chained cache% separately. Map cache fields when present. Do not invent. |
| P3 | dogfood monitor ledger | Full 39626 B spur-check logs ingested twice | Capture gate logs to file; consume status + tail only. |
| P4 | `config/workflows/task-pipeline.yaml:279` | Unresolved `${vars.__runId}` becomes a filename | Refuse unresolved interpolation; keep `pipeline-$wbs` only for a truly empty value. |
| P4 | `plugins/sp/skills/code-verification/SKILL.md:123` | Glob / underscore evidence anchors | Verify skill emits the prose form already documented in the inline driver. |
| P4 | dogfood Phase 4 | Report file deleted mid-run | Finalize restores `docs/dogfood/` from the live SSOT when the report path is missing. |

### Requirements

- [ ] R1. **(F1)** An inline full-pipeline run (`--agent inline` or omitted) persists an authoritative `runs` row for its allocated run id **and** a non-empty definition digest of the resolved pipeline YAML **before** the `record` state's `run.artifact` action. Bound registration (`proofBinding: current`, `artifactKind: verify-verdict`) then succeeds on the same criteria the subprocess path already meets (0785 R3): `RunDao.traceRowById(runId)` returns a row, `proof.definitionDigest` equals the run's `definitionDigest` (or `resumeDefinitionDigest`). The inline driver no longer skips bound registration. Persistence goes through an **internal** plugin script or existing workflow-service seam — **no new public `spur` noun or verb**. Idempotent on resume. Unbound registration on this surface is a non-goal.

- [ ] R2. **(F2)** `DEFAULT_EXCLUDE_GLOBS` in `packages/app/src/workflow/proof-input-fingerprint.ts` excludes generated-report trees that a dogfood/pipeline run writes while a proof window is open: at least `docs/dogfood*`, `docs/plans*`, and `docs/report*`. A content change under `docs/dogfood/` (or the other two) must not change the git-tree half of the fingerprint. Existing excludes (`docs/tasks*`, `docs/features*`) stay. Do **not** exclude `docs/design/`, numbered authority docs (`docs/00`–`05`, `docs/99`), or `docs/help/`. Ignored-path pathspec pitfall (task 0612 comment at `:165-171`) remains: do not name gitignored paths in the exclude list.

- [ ] R3. **(F3)** Every SQLite-lock retry in `config/workflows/task-pipeline.yaml` treats the remapped CLI busy message as retryable, not only the raw driver error. The lock-class pattern must match at least: `SQLiteError: database is locked`, `database is locked`, `SQLite database is busy`, `SQLITE_BUSY`. Sites: quality-gate loop (`:434`), test-recheck loop (`:550`), and every `retry_transient` copy (`:338`, `:750`, `:797`, and any sibling that still keys on `database is locked` only). A gate whose log contains only the remapped busy string retries up to the existing 5×/10s budget instead of FAIL on attempt 1. Do not raise `busy_timeout`. Do not change 0801's `errorMessage()` text.

- [ ] R4. **(F4)** The verify answer-file contract and `verify-answer-lint` agree on AC identity. (a) Producer: `plugins/sp/skills/code-verification/SKILL.md` Step 5/11 and `references/verdict-schema.md` require the AC table `id` to be copied **verbatim** from the task's `Scenario:` title or checkbox label — no paraphrases. The worked example stops using the fictional short title `Scenario: CLI emits JSON` as if it were sufficient. (b) Consumer: `verify-answer-lint.ts` accepts the same four identity forms `rowMatchesScenario` / ac-style-guide already accept (`exact title`, `bare title`, `Scenario:` prefix, `AC-N` / `ACn` positional alias) and still **rejects** a descriptive paraphrase such as `AC1 transition refused with open box` when that string is not a checklist label. Requirement IDs stay exact (`R1`, `R2`, …). No lint weakening of status / evidence-type / empty-evidence rules.

- [ ] R5. **(F5)** A mutating pipeline-driving dogfood (`detect-pipeline-driving` plus `--max-retry ≥ 1`) whose Phase 1 workspace fingerprint shows a dirty porcelain **or** whose testee is pipeline-driving echoes a one-line worktree advisory in the Phase 1 plan (`prefer an isolated git worktree when parallel sessions are active`). It does **not** refuse the run (task 0296: advisory, not a hard gate). The existing SKILL.md worktree paragraph stays; this requirement is the missing *echo at plan time*.

- [ ] R6. **(F6)** The pipeline `record → done` guard invokes `spur task check $wbs --as done` (same target-aware projection `task-lifecycle.yaml:93` already uses). An open Plan/body checkbox that is only a `warning` at status `testing` becomes an `error` on this edge (0800 R1, `task-check.ts:911`) and the guard fails closed. `--no-lifecycle` on the done `task update` stays bookkeeping (no nested lifecycle run); it is not a substitute for `--as done`. Do not auto-flip checkboxes.

- [ ] R7. **(F7, F8)** Dogfood cost accounting is honest and cheap. (a) The Cost block always reports **two** cache percentages: driver-only and chained. When a chained row's subagent usage object includes cache fields (`cache_read` / `cache_creation` or the platform's equivalent), map them into Cached; otherwise keep `Cached ~0` with Basis `unobservable`. Do **not** invent a fresh/cached split. Do **not** require the host platform to grow new usage fields. (b) The driver does not ingest a full quality-gate / `spur-check` log into context: it writes the log to `.spur/run/<wbs>-test-gate.log`, reads the status file, and consumes at most a tail (the YAML already prints `tail -n 40` on FAIL). Conservation rule lives in `monitor-ledger.md` with a one-line pointer in SKILL.md.

- [ ] R8. **(F9)** The route-reason writer refuses to create a filename that still contains unresolved interpolation (`$`, `{`, `}`, or `vars.`). Empty `__runId` still falls back to `pipeline-$wbs` (0759 R5). An unresolved literal such as `${vars.__runId}` is a hard failure of that shell action (non-zero, no file written at the literal path), not a successful write of `.spur/run/${vars.__runId}-route-reason.txt`.

- [ ] R9. **(F10)** Verify-mode evidence instructions require the prose form for paths that L4 cannot match: glob paths (`cmd_*.md`) and underscore-heavy basenames whose extracted subject cannot appear in the cited line. Copy the rule already at `inline-pipeline-driver.md:206-210` into `code-verification/SKILL.md` (Step 4/5 evidence) and `verdict-schema.md` (answer-file evidence examples). In-repo `file:line` remains required for ordinary paths. Do not change the L4 matcher.

- [ ] R10. **(F11)** Dogfood Phase 4 finalize treats `.spur/run/dogfood/<run_id>.md` as the mid-run SSOT. If the report path under `docs/dogfood/` is missing or empty at finalize, restore it from the live file before setting `status: complete`. Do not treat the report path as authoritative during the proof window (the 0800 run already froze the mirror inside that window — pin that as required protocol).

**Non-goals.**

- Unbinding `run.artifact` on the inline surface (rejects 0785 R3 / ADR-071).
- A new public `spur` noun or verb (harness-surface governance).
- History-daily watchdog / PASSIVE checkpoint / BUSY abort (0803).
- Changing `errorMessage()` or the rule-run connection pragma (0801).
- Raising `SQLITE_BUSY_TIMEOUT_MS` or merging import transactions.
- Auto-flipping Plan checkboxes (0800 R1 non-goal, preserved).
- Host-platform `cache_read` / `cache_creation` field work as a hard requirement.
- Comma-list `--status`, Q&A append behaviour, `replaceSection` spacing (0795).
- Making the worktree advisory a refuse-gate.

### Acceptance Criteria

```gherkin
Scenario: F1 inline record binds the verify-verdict artifact
  Given an inline full-pipeline run whose run id is allocated by the inline driver
  And the resolved task-pipeline YAML has a non-empty definition digest
  And a canonical PASS verify-verdict artifact exists at .spur/run/<wbs>-verdict.json
  When the record state's run.artifact action executes with proofBinding current
  Then RunDao.traceRowById returns a row for that run id
  And the artifact is ledger-registered (ArtifactDao row present)
  And the action does not return the 0785 R3 refusal "run … has no authoritative row"
  And a second invocation with the same run id is idempotent

Scenario: F2 a dogfood report write does not move the proof digest
  Given two fingerprint captures of the same working tree and the same task/feature specs
  When the only byte change between them is a file under docs/dogfood/
  Then the git-tree half of the digest is unchanged
  And the same holds for a write under docs/plans/ and under docs/report/
  And a change under packages/app/src still changes the digest

Scenario: F3 the quality-gate retry fires on the remapped busy message
  Given a quality-gate attempt whose log contains
        "SQLite database is busy; another Spur process is holding the lock."
    And does not contain "SQLiteError: database is locked"
  When the test (and test-recheck) retry loop classifies the attempt
  Then gate_locked is treated as true
  And the loop retries within the existing 5×/10s budget rather than FAIL on attempt 1
  And retry_transient classifies the same message as retryable
  And a structural test pins every site's pattern to the lock-class set

Scenario: F4 verify-answer-lint accepts canonical AC ids and rejects paraphrases
  Given a task whose Acceptance Criteria include a Gherkin scenario titled
        "F1 inline record binds the verify-verdict artifact"
  When the answer-file AC id is that exact title (or "Scenario: <title>", or "AC-1" / "AC1")
  Then verify-answer-lint exits 0 for that row
  When the answer-file AC id is the paraphrase "AC1 transition refused with open box"
  Then verify-answer-lint exits non-zero naming that id as unmatched
  And the code-verification answer-file schema tells the verifier to copy the title verbatim

Scenario: F5 Phase 1 plan echoes the worktree advisory on a dirty tree
  Given a pipeline-driving dogfood with --max-retry ≥ 1
  And git status --porcelain is non-empty at Phase 1
  When the driver prints the Phase 1 plan
  Then the plan contains a worktree-advisory line
  And the run is not refused

Scenario: F6 record-to-done evaluates the done row
  Given a task at testing with at least one open checkbox
  When the pipeline record → done guard runs
  Then the command includes "task check" and "--as done"
  And the guard fails (non-zero) while that box is open
  And the same task with every box checked passes the guard
  And a structural test pins config/workflows/task-pipeline.yaml record→done to --as done

Scenario: F7-F8 Cost block splits cache figures and tail-consumes gate logs
  Given a dogfood report whose ledger has both driver rows and chained:<step> rows
  When Phase 4 writes the Cost block
  Then driver-only cache% and chained cache% appear as two labelled figures
  And a chained row without cache fields still has Cached ~0 and Basis unobservable
  And no invented split is documented as measured
  And monitor-ledger.md instructs the driver to capture quality-gate / spur-check logs to file
    and to consume the status file plus a tail, not the full log body

Scenario: F9 unresolved run-id cannot become a filename
  Given the route-reason shell with __runId set to the literal "${vars.__runId}"
  When the shell runs
  Then it exits non-zero
  And it does not create .spur/run/${vars.__runId}-route-reason.txt
  Given __runId is empty
  Then it writes .spur/run/pipeline-$wbs-route-reason.txt as today

Scenario: F10 verify skill forbids glob evidence anchors
  Given code-verification SKILL.md Step 4/5 and verdict-schema.md after this task
  Then they state that glob paths and underscore-heavy basenames use the prose form
    already documented in inline-pipeline-driver.md:206-210
  And they do not show `0787_*.md:204-275` (or equivalent) as a legal in-repo file:line

Scenario: F11 finalize restores a missing report from live
  Given a dogfood run whose live file exists and whose docs/dogfood report path is missing
  When Phase 4 finalize runs
  Then it copies live → report before setting status complete
  And the protocol states live is mid-run SSOT and the report mirror may be frozen inside a proof window
```

### Q&A

Refinement decisions frozen at filing (2026-09-08) so the implementer inherits no open choices.

- **D1 — F1 persist, do not unbind.** Bound `proofBinding: current` stays fail-closed (0785 R3 / ADR-071). The defect is the missing `runs` row, not the refusal. Persistence is an internal plugin script (or workflow-service `createOrAttachRun` reused from a script), not a new public `spur` verb (harness-surface governance). `task run-link` is the wrong table.

- **D2 — F2 exclude generated-report trees only.** Add `docs/dogfood*`, `docs/plans*`, `docs/report*`. Do not exclude `docs/design/`, `docs/00`–`05`/`99`, `docs/help/`, or gitignored `.spur/**` (0612 pathspec pitfall). `docs/report/` is the directory that exists (not `docs/reports/`).

- **D3 — F3 match the remapped message; do not edit 0801.** The classifier expands; `errorMessage()` stays. 0803's watchdog is a different process (the wedged child); this slice is "retry when the message is busy, not only locked".

- **D4 — F4 both ends, paraphrases still fail.** Producer copies canonical titles. Lint gains the four ac-style-guide forms (including `AC-N` / `ACn` positional). A descriptive sentence that is not a label remains a hard fail — that is the 0800 resume cost we are preventing, not papering over.

- **D5 — F5 echo, do not refuse.** Task 0296 made the worktree advisory non-gating. Phase 1 prints it when porcelain is dirty or the testee is pipeline-driving. Parallel-session detection via `lsof` / process lists is out of scope (sandboxed CLIs may lack them; porcelain is enough).

- **D6 — F6 put `--as done` on the pipeline guard.** `task-lifecycle.yaml` is already correct; `--no-lifecycle` is why that YAML is skipped. Auto-flip remains a non-goal (0800 R1).

- **D7 — F7 report split only.** Host-platform cache fields are `[unverifiable]` and out of scope. Shipping a second Cost line is the feasible half of the report's own reframe.

- **D8 — F8 conservation rule, not a new meter.** The YAML already tails 40 lines on FAIL. The driver must not ingest the body.

- **D9 — F9 refuse unresolved literals.** Empty still maps to `pipeline-$wbs`. A string containing `$` / `{` / `}` / `vars.` is a failed action, not a creative filename.

- **D10 — F10 document at the producer.** L4 matcher unchanged. Glob / underscore paths become prose in verify answers, matching the Solution-table rule.

- **D11 — F11 restore from live.** The report's "no action beyond keeping live authoritative" is promoted to a finalize restore so a deleted report cannot abort a complete run.

- **D12 — no feature_id.** Cross-cutting harness register. `ac_altitude: task-local`. L4 missing-feature_id advisory accepted (same posture as 0801).

- **Dependencies / premises.** No prerequisite WBS. 0803 and 0801 are related but shipped; this task must not reopen them. Premises verified in Root Cause.

### Design

Frozen for implementation. Anti-patterns honoured: no new public CLI noun/verb; no unbinding of
`proofBinding: current`; no 0801/0803 relitigation; no refuse-gate for worktree; no invented
cache split.

#### D1 — F1 persist an inline run row (do not unbind)

WHAT: before the inline FSM reaches `record`, the allocated run id must exist in `runs` with a
definition digest identical to what `computeDefinitionDigest` would stamp on the subprocess path.

HOW:

1. Add an **internal** helper (plugin script under `plugins/sp/scripts/`, ADR-065 — not a public
   `spur` verb) that: resolves the pipeline YAML the driver already read; computes
   `computeDefinitionDigest` (reuse `packages/app`, do not fork a second hasher); inserts or
   upserts a `runs` row via `RunDao` / the existing `createOrAttachRun` persistence; writes the
   digest to `.spur/run/<runId>-definition-digest.txt` (and/or prints `--json` `{ runId, definitionDigest }`).
   Idempotent: a second call with the same id returns the existing row.
2. Inline driver Run setup (`inline-pipeline-driver.md` after step 2 / before `run-link`) invokes
   that helper, exports `__runId` and `__definitionDigest` into the var overlay used for YAML
   interpolation, and logs one provenance line.
3. Delete the "skip bound `run.artifact` on inline" workaround from the driver (0800 What-We-Did
   step 9 / 0795-run record skip). On refusal, follow the YAML error policy — do not fall through
   to `task record`.
4. Tests: extend `packages/app/tests/workflow/actions/run-artifact.test.ts` (the existing missing-row
   refusal at `:109-198` stays); add a case where a pre-inserted run row + matching digest
   **succeeds**. Script-level test: second persist is a no-op.

Rejected: unbound registration on inline (0785 R3 / ADR-071 — a silent drop of the ledger row is
the bug, not the refusal). Rejected: a new `spur workflow ensure-run` public verb (governance).

#### D2 — F2 extend DEFAULT_EXCLUDE_GLOBS

WHAT: generated-report directories a dogfood/pipeline writes during a proof window are excluded
from the git-tree half.

HOW: change `packages/app/src/workflow/proof-input-fingerprint.ts:172` to

```text
['docs/tasks*', 'docs/features*', 'docs/dogfood*', 'docs/plans*', 'docs/report*']
```

Tests in `packages/app/tests/workflow/proof-input-fingerprint.test.ts`: given a temp repo with
tracked files in those trees, a content change under `docs/dogfood/` (and the other two) does not
change `createGitAlternateTree`; a change under `packages/` does. Do not add gitignored paths
(0612). Callers that pass explicit `excludeGlobs` are unchanged.

#### D3 — F3 lock-class retry pattern

WHAT: one lock-class regex, copied at every existing retry site (YAML has no shared function
across states without duplicating a snippet — duplicate the pattern with a comment pointing at
this task).

Pattern (extended grep `-E`):

```text
SQLiteError: database is locked|database is locked|SQLite database is busy|SQLITE_BUSY
```

Sites: `:434`, `:550`, `:338`, `:750`, `:797` (and any other `database is locked` retry in this
file — grep before editing). Keep the 5×/10s budget and the `retry_transient` single-retry
behaviour; only the classifier changes.

Structural pin: `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts` (or a sibling)
asserts each site's command contains `SQLite database is busy` **and** `database is locked`.

Do not touch `apps/cli/src/errors.ts`.

#### D4 — F4 producer copies titles; lint accepts the four forms

WHAT: close the contract from both ends without accepting paraphrases.

HOW:

1. Producer — `code-verification/SKILL.md` Step 5 table + Step 11 Answer-File Schema, and
   `verdict-schema.md` authoring contract: "The AC id is the task's `Scenario:` title (or
   checkbox label) copied verbatim. Do not paraphrase. Legal aliases: exact title, bare title,
   `Scenario:` prefix, `AC-N` / `ACn` positional. Illegal: `AC1 transition refused with open
   box` when that string is not a label." Replace the fictional `Scenario: CLI emits JSON`
   example with a sentence that names the verbatim-copy rule.
2. Consumer — `extractAcIdentities` / the AC-row check in `verify-answer-lint.ts` reuse the same
   matching rules as `rowMatchesScenario` (ac-style-guide four forms). Prefer importing or
   copying the smallest shared matcher; do not drift a third copy. Positional `AC-N` / `ACn`
   maps to the Nth scenario/checklist item. Paraphrases still fail `includes` / matcher.
3. Tests: a fixture task with one Gherkin scenario; lint PASS for exact / `Scenario:` / `AC-1`
   / `AC1`; lint FAIL for `AC1 transition refused with open box`.

#### D5 — F5 echo the worktree advisory

WHAT: Phase 1 plan output, not a new gate.

HOW: after the fingerprint is taken, if the run is fix-mode/mutating-`--fix` **and**
(pipeline-driving **or** porcelain non-empty), print one line:

```text
⚠ concurrent writers likely / pipeline-driving mutating dogfood — prefer an isolated git worktree
```

Do not exit 2. Do not Edit AGENTS.md. SKILL.md §Worktree advisory gains a "Phase 1 plan must
echo this line when …" sentence. Optional tiny helper next to `detect-pipeline-driving.ts` is
allowed; a new public flag is not.

#### D6 — F6 `--as done` on the pipeline guard

WHAT: one flag on one command.

HOW: `config/workflows/task-pipeline.yaml:1019-1022` becomes:

```text
$spurBin task check $wbs --as done &&
test "$(jq -r .verdict …)" = PASS &&
test "$(jq -r '.proof.digest // ""' …)" = "$proofDigest"
```

`--no-lifecycle` on `:806` stays. No auto-flip. Structural test pins `--as done` on the
`record → done` command (same suite as D3). Behaviour is already unit-tested in
`task-check.test.ts` "0800" (do not duplicate; this task proves the YAML calls that path).

#### D7 — F7 split the Cost figures

WHAT: reporting contract only.

HOW: `plugins/sp/skills/dogfood-testing/SKILL.md` §Cost segmentation +
`references/report-template.md` Cost honesty + `references/monitor-ledger.md`: the Cost block
MUST print driver-only cache% and chained cache% as two lines. Chained rows without cache
fields stay `Cached ~0` / `unobservable`. Mapping cache_read/cache_creation **when present**
is in-scope; requiring the host to add those fields is not.

#### D8 — F8 tail-consume gate logs

WHAT: driver heuristic, documented.

HOW: `monitor-ledger.md` cache-conservation section gains: "Quality-gate / spur-check logs
live at `.spur/run/<wbs>-test-gate.log` (and the attempt files). Read `*-test-gate.status`
and at most `tail -n 40` of the log. Never paste a 30kB+ log body into context." SKILL.md
Gotchas / conservation pointer names it. No runtime code unless a helper already centralises
ledger estimates.

#### D9 — F9 refuse unresolved interpolation

WHAT: tighten the existing empty-check.

HOW: after `RUN_ID="$__runId"`, if `RUN_ID` is empty → `pipeline-$wbs` (unchanged); if `RUN_ID`
matches `[\${}]` or `vars.` → echo a named error and `exit 1` (no write). Same guard anywhere
else this file interpolates `__runId` into a filename (0759 route-reason is the cited site;
grep `__runId` before editing). Structural test: the command contains the refusal
(`vars.` or `\${`).

#### D10 — F10 copy the glob-anchor rule into verify

WHAT: documentation of an existing L4 limitation, at the producer.

HOW: paste the `inline-pipeline-driver.md:206-210` rule (one `file:line` per row; glob /
underscore-heavy basenames use prose, not a table anchor) into `code-verification/SKILL.md`
Step 4 (after the in-repo backtick rule) and Step 5 (AC evidence), and into
`verdict-schema.md` under the answer-file example. Do not change `checkLineAnchors`.

#### D11 — F11 restore report from live at finalize

WHAT: Phase 4 checklist item.

HOW: report-template.md Phase 4 + SKILL.md finalize-or-abort: if `report_path` is missing or
size 0 and `live_path` exists, copy live → report, then continue. If both are missing, abort
as today. Pin "live is mid-run SSOT; the docs/dogfood mirror may be frozen inside a proof
window" (the 0800 run already did this — make it required, not tribal knowledge).

#### Slice boundaries

| Slice | Findings | Files (expected) |
| --- | --- | --- |
| A | F3, F6, F9 | `config/workflows/task-pipeline.yaml` + structural tests |
| B | F2 | `proof-input-fingerprint.ts` + tests |
| C | F1 | internal persist script + inline-pipeline-driver.md + run-artifact test |
| D | F4, F10 | verify-answer-lint.ts, code-verification SKILL.md, verdict-schema.md |
| E | F5, F7, F8, F11 | dogfood-testing SKILL.md, report-template.md, monitor-ledger.md |

Slices A and B are independent of C–E and can land first.

### Plan

- [ ] F3. Expand the lock-class grep at every retry site in `task-pipeline.yaml` (`:434`, `:550`, every `retry_transient` copy at `:338`, `:750`, `:797`, plus any sibling still keyed on `database is locked` only — grep the file before editing) to `SQLiteError: database is locked|database is locked|SQLite database is busy|SQLITE_BUSY`. Pin both strings in a structural test.
- [ ] F6. Change the `record → done` guard (`:1020`) from `$spurBin task check $wbs` to `$spurBin task check $wbs --as done`. Pin `--as done` in the same structural suite. Do not touch `--no-lifecycle` on `:806`.
- [ ] F9. After `RUN_ID="$__runId"`, refuse values matching `[\${}]` or `vars.` (exit 1, no write); keep empty → `pipeline-$wbs`. Grep other `__runId` filename interpolations in this YAML and guard them the same way.
- [ ] F2. Extend `DEFAULT_EXCLUDE_GLOBS` with `docs/dogfood*`, `docs/plans*`, `docs/report*`. Test: a tracked write under each of those trees does not change `createGitAlternateTree`; a `packages/` write does.
- [ ] F1-script. Internal persist helper: create-or-attach a `runs` row for the inline run id, stamp `definitionDigest`, print `{ runId, definitionDigest }`, idempotent. No public CLI noun.
- [ ] F1-driver. Inline driver Run setup invokes the helper, exports `__runId` + `__definitionDigest`, and stops skipping bound `run.artifact`.
- [ ] F1-test. run-artifact test: missing row still refuses; pre-inserted matching row binds.
- [ ] F4. verify-answer-lint accepts exact / `Scenario:` / `AC-N` / `ACn` and rejects paraphrases (fixture tests). code-verification SKILL.md + verdict-schema.md: verbatim-copy rule; retire the fictional short-title example as a sufficient id.
- [ ] F10. Copy the glob / underscore prose-form rule from `inline-pipeline-driver.md:206-210` into verify Step 4/5 and verdict-schema.md.
- [ ] F5. Phase 1 plan echoes the worktree advisory when pipeline-driving or porcelain is dirty; do not refuse.
- [ ] F7-F8. Cost block prints driver-only and chained cache% as two figures; chained-without-fields stays unobservable. monitor-ledger.md (+ SKILL.md pointer): capture gate logs to file; consume status + tail only.
- [ ] F11. Phase 4 finalize restores `docs/dogfood/` from live when the report path is missing/empty; pin live-as-SSOT + proof-window freeze.
- [ ] Close. `spur task check 0804 --json` green at current status; targeted tests for slices landed this run; no 0801/0803/0800 files in the diff except citations.

### Root Cause

Verified against the 2026-09-08 tree and the 0800 dogfood report. Each cause is a distinct seam.

#### F1 — bound run.artifact refuses on inline

`RunArtifactActionRunner.executeBound` loads the certifying run from the DB and refuses when
missing:

- `packages/app/src/workflow/actions/run-artifact.ts:321-328` —
  `new RunDao(db).traceRowById(context.runId)` → `"run ${context.runId} has no authoritative row — refusing binding (0785 R3)"`.
- `:336-346` — `proof.definitionDigest` must equal the row's `definitionDigest` /
  `resumeDefinitionDigest`. An empty `__definitionDigest` cannot match.

The subprocess path injects both values at engine start:

- `packages/app/src/services/workflow-service.ts:689-696` — `runVars.__runId` and
  `__definitionDigest: computeDefinitionDigest(workflow)`.
- The engine's `createRun` / `createOrAttachRun` persistence (`workflow-service.ts:141-151`)
  writes the `runs` row 0785 R3 reads.

The inline driver never enters that seam. Run setup
(`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:49-76`) allocates a uuid run
id, opens `.spur/run/<id>.log`, and calls `spur task run-link` (a **task-link** row, not a
workflow `runs` row). There is no `createRun` and no definition-digest stamp. The YAML still
declares bound registration first on `record`
(`config/workflows/task-pipeline.yaml:736-742`). The 0800 and 0795-run drivers skipped the
action and continued with `spur task record`, so Testing landed and the verdict-ledger row did
not. Authentic YAML would halt.

#### F2 — fingerprint glob misses generated reports

`DEFAULT_EXCLUDE_GLOBS = ['docs/tasks*', 'docs/features*']`
(`packages/app/src/workflow/proof-input-fingerprint.ts:172`). The git-tree half is
`git add -A -- . :(exclude)<glob>` (`:204-205`). Tracked files under `docs/dogfood/`,
`docs/plans/`, and `docs/report/` are hashed. Dual-artifact delivery always writes
`docs/dogfood/YYYY-MM-DD-…-dogfood.md` (dogfood-testing Phase 1). That write is a
proof-input change even when the task/feature specs are byte-stable, so a mid-run report
update (or an external delete+restore, as happened here) invalidates `proofDigest` and
forces a recapture. 0612 removed `.spur/run*` from the glob list because those paths are
gitignored and naming them made `git add` exit 1 — `docs/dogfood/` reports are **tracked**,
so excluding them is safe.

#### F3 — retry matcher vs remapped busy message

Quality-gate loops:

- `:434` and `:550` — `grep -q 'SQLiteError: database is locked' "$ATTEMPT_LOG" && gate_locked=1`.

`retry_transient` copies (`:338`, `:750`, `:797`):

- `grep -Eq 'ENOENT|EBUSY|ENOTEMPTY|database is locked'`.

The CLI no longer prints the raw driver string. `errorMessage()`
(`apps/cli/src/errors.ts:37-44`, shipped by 0801) returns
`SQLite database .spur/spur.db is busy; another Spur process is holding the lock. identify the holder: …`.
The 0800 review-gate re-run at the 23:00 tick logged that remapped line, `gate_locked` stayed 0,
and the gate FAILed on a transient environmental lock. The 0795-run dogfood recorded the same
miss (`docs/dogfood/2026-09-07-sp-dev-run-0795-auto-next-agent-inline-dogfood.md:60,102`).

0801 is **not** this fix: it made the message diagnosable and honoured `busy_timeout` on the
rule-run connection. It is why the YAML matcher is now blind.

#### F4 — producer/consumer AC-id mismatch

Lint identity set (`verify-answer-lint.ts:260-282`) is:

- checkbox / bullet label text up to `:`
- the label's leading token
- `Scenario:` titles from the task and the linked feature

Membership is exact (`:366` `!acIdentities.includes(row.id)`). It does **not** implement the
four forms ac-style-guide / `rowMatchesScenario` already accept (`exact`, `bare title`,
`Scenario:` prefix, `AC-N` positional).

Producer schema (`code-verification/SKILL.md:168-176,284-297` and
`verdict-schema.md:99-117`) shows `| Scenario: CLI emits JSON |` and says ids must match "a
task AC checklist label (or its leading token, e.g. `AC1`) or a linked feature scenario
title" — it never says **copy the title verbatim, do not paraphrase**. Verifiers therefore
emit descriptive ids (`AC1 transition refused with open box`). That string is neither a
label, nor a leading token, nor a Scenario title, so a substantively correct PASS hard-fails
the lint. 0800 paid one verifier resume (~84147 tokens) to rewrite the nine canonical titles.

#### F5 — worktree advisory not echoed

`plugins/sp/skills/dogfood-testing/SKILL.md` §Workspace-drift guard (task 0296) already
recommends an isolated git worktree for mutating pipeline-driving dogfoods, and R2 records a
fingerprint. The 0800 run took the fingerprint (`porcelain_hash: c0d5ec71…`) and then ran in
the shared tree. A second agent committed 0800's implementation mid-run (5 commits), deleted
the report file, edited README.md, and moved HEAD 4× (`drift:external` ledger row). The
advisory exists as buried prose; Phase 1 did not echo it when porcelain was already dirty.
Not a refuse-gate (0296 preserved).

#### F6 — pipeline done edge is not target-aware

0800 R1 made `L3.unchecked-checklist` an **error** only when
`isTransitionTarget` (`task-check.ts:546`, `:911`) — i.e. when `--as done` is passed and the
file is not already `done`. `task-lifecycle.yaml:93` already runs
`spur task check $wbs --as done`. The **pipeline** YAML does not:

- `record → done` guard (`task-pipeline.yaml:1020`) — `$spurBin task check $wbs` (current
  status = `testing` → open boxes are **warnings**, `pass: true`).
- done `onEnter` (`:806`) — `task update "$wbs" done --no-lifecycle`. `--no-lifecycle`
  skips the lifecycle workflow that would have passed `--as done`; the pipeline's weaker
  guard is then the only YAML-side gate.

The inline driver documents a `--as done` done-probe
(`inline-pipeline-driver.md:202-204`) as operator discipline. That probe is what stopped
0800 from closing with two open Close boxes. The pipeline itself would have accepted them.

#### F7 — chained cache split

Dogfood-testing @1.2 requires a `chained:<step>` ledger row and, when usage is unreadable,
`Cached ~0` + finding P3. Subagent usage fields observed this run (139421 / 72356 / 84147
tokens, tool-uses, duration) have no fresh/cached split. The aggregate cache% formula then
treats chained cost as 0% cache and reports ~1% for the whole run. Driver-only was ~5%.
Mixing the two is the defect we can fix without host-platform work.

#### F8 — full gate-log ingest

Two 39626-byte `spur-check` logs were consumed in full (test + sanctioned review restart).
The YAML already writes `.spur/run/$wbs-test-gate.log` and tails 40 lines on FAIL
(`task-pipeline.yaml:445-446`). The driver has no conservation rule to prefer that file +
status over the body.

#### F9 — unresolved `__runId` filename

`:277-279`:

```text
RUN_ID="$__runId" &&
if [ -z "$RUN_ID" ]; then RUN_ID="pipeline-$wbs"; fi &&
REASON_FILE=".spur/run/$RUN_ID-route-reason.txt"
```

Empty → `pipeline-$wbs` (0759). An **unexpanded** `${vars.__runId}` is non-empty, so the
fallback never fires and the literal becomes a filename. Observed:
`.spur/run/${vars.__runId}-route-reason.txt`. The inline driver interpolates vars itself;
a missed substitution is enough.

#### F10 — glob evidence anchors

L4 extracts a subject token from `file:line` and requires it to appear in the cited line.
A glob (`0787_*.md`) or underscore-heavy basename cannot match. The inline driver already
forbids those rows in Solution tables (`:206-210`, "prose still covers them"). Verify-mode
Step 4/5 still requires in-repo `` `path:line` `` (`code-verification/SKILL.md:123-143`)
with no glob exception, so verifiers emit unmatchable anchors and the driver hand-cleans
L4 warnings.

#### F11 — report-path deletion

Dual artifacts: live `.spur/run/dogfood/<run_id>.md` (mid-run SSOT) and
`docs/dogfood/…-dogfood.md` (operator artifact). An external writer deleted the report
file mid-run (untracked, no git trace). The live file survived; finalize re-synced after
record. The protocol does not currently **require** restore-from-live when the report path
is missing, so a future finalize could abort or write an empty complete report.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

**Evidence source**

- Dogfood report: `docs/dogfood/2026-09-07-dev-run-0800-dogfood.md` (§5 Issues, §6 Findings, ledger rows `pipeline:record`, `pipeline:verify`, `pipeline:done`, `drift:external`)
- Live ledger: `.spur/run/dogfood/2026-09-07-dev-run-0800.md`
- Prior reproduction of F1 + F3: `docs/dogfood/2026-09-07-sp-dev-run-0795-auto-next-agent-inline-dogfood.md:60,67,84,102,104`

**Excluded owners (do not re-implement)**

- Task 0803 (history-daily watchdog / PASSIVE checkpoint / bounded BUSY) — `done` 2026-09-08
- Task 0801 (SQLITE_BUSY `errorMessage()` + rule-run busy_timeout) — `done`; F3 matches the message 0801 shipped
- Task 0800 (Plan boxes, review heading, docs/help, transition-target severity) — the dogfood testee, `done`
- Task 0795 F1–F5 — refineall J31 findings register, `done`
- Task 0785 R3 / 0751 R4 — bound `run.artifact` fail-closed (constraint on F1, not a reopen)

**F1 — inline run row**

- `packages/app/src/workflow/actions/run-artifact.ts:321-346` — missing row / digest mismatch refusals
- `packages/app/src/services/workflow-service.ts:689-696` — subprocess `__runId` + `__definitionDigest` injection
- `packages/app/src/services/workflow-service.ts:141-151` — `createRun` / `createOrAttachRun`
- `config/workflows/task-pipeline.yaml:736-742` — bound `run.artifact` on `record` entry
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:49-76` — Run setup (uuid, log, `run-link`; no `runs` row)
- `packages/app/tests/workflow/actions/run-artifact.test.ts` — existing refusal suite to extend

**F2 — fingerprint globs**

- `packages/app/src/workflow/proof-input-fingerprint.ts:165-172,204-205` — `DEFAULT_EXCLUDE_GLOBS` + `:(exclude)` pathspec
- `packages/app/tests/workflow/proof-input-fingerprint.test.ts` — suite to extend

**F3 — lock-class retry**

- `config/workflows/task-pipeline.yaml:434,:550` — gate loops
- `config/workflows/task-pipeline.yaml:338,:750,:797` — `retry_transient`
- `apps/cli/src/errors.ts:37-44` — remapped message (read-only for this task)
- `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts` — structural pin home

**F4 — AC identity**

- `plugins/sp/scripts/verify-answer-lint.ts:260-282,361-368`
- `plugins/sp/skills/code-verification/SKILL.md:168-176,284-297`
- `plugins/sp/skills/code-verification/references/verdict-schema.md:99-117`
- `plugins/sp/skills/spur-dev/references/ac-style-guide.md:101-114` — four accepted id forms

**F5 / F7 / F8 / F11 — dogfood protocol**

- `plugins/sp/skills/dogfood-testing/SKILL.md` — worktree advisory, Cost segmentation, finalize-or-abort, cache-conservation
- `plugins/sp/skills/dogfood-testing/references/report-template.md` — dual artifacts, Cost honesty, Phase 4
- `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md` — conservation discipline

**F6 — done guard**

- `config/workflows/task-pipeline.yaml:1019-1022` — current plain `task check`
- `config/workflows/task-pipeline.yaml:806` — `task update done --no-lifecycle`
- `config/workflows/task-lifecycle.yaml:93` — already `--as done` (precedent)
- `packages/app/src/services/task-check.ts:546,911` — 0800 R1 `isTransitionTarget` error
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:202-204` — driver done-probe

**F9 — route-reason filename**

- `config/workflows/task-pipeline.yaml:267-279` — `RUN_ID="$__runId"` + empty fallback

**F10 — glob anchors**

- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:206-210` — Solution-table rule to copy
- `plugins/sp/skills/code-verification/SKILL.md:123-143,178-180` — in-repo `file:line` with no glob exception

### History
