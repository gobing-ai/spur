---
schema_version: 1
name: "Harness reliability post-mortem: executor routing residue, lifecycle terminals, and history data-plane defects"
status: done
template: meta
created_at: 2026-08-21T00:01:44.025Z
updated_at: "2026-08-21T20:09:06.160Z"
feature_id: D3
priority: P1
---

## 0622. Harness reliability post-mortem: executor routing residue, lifecycle terminals, and history data-plane defects

### Background
On 2026-08-20 a `/sp:dev-idea --auto` run failed at its first model-bearing state: `omp` returned
`429 Weekly usage limit reached … retry-after-ms=262544000` and the whole `idea-pipeline` terminated
in 4,475 ms (run `7b8116eb-d606-4618-8803-85c5bdb9db19`). Planning was completed by driving the
pipeline inline instead, producing feature A3 and tasks 0613–0621.

The follow-up forensics (full `spur history import --source all --mode full` — 5,414 files,
152,713 new messages, importer `0.4.39`, source-local binary — then `history analyze` +
`history report --mode forensics`) found 19 issues plus a set of tooling-friction items hit while
running the analysis itself. Three were fixed directly ahead of this task, because using the task
pipeline to repair the task pipeline is circular:

- **F1 (fixed)** — `resolveDefaultAgentVar` in `packages/app/src/services/workflow-service.ts`
  validated `agent.default` as an executor name or agent binary only, with no Layer-1 role branch,
  so the recommended config value (`coder`, shipped by `config/config.example.yaml`) was rejected
  and every engine-driven `agent.run` silently fell back to the pipeline YAML literal `omp`.
- **F3 (fixed)** — `/sp:dev-idea` declared no `--agent` flag, so the operator had no way to steer
  the executor; `/sp:dev-plan` routes to the same pipeline and always had one.
- **F17 (mitigated)** — 140 runs stranded in `running` were finalized with `spur workflow clean`.

This task carries **everything that was not fixed directly**. It is deliberately a single umbrella:
the findings share one root theme — the harness cannot see or steer its own execution — but they
land on two planes. R1–R3 are workflow-engine reliability and belong to D3's charter; R4–R8 are the
history/observability data plane and should be split into their own task under E/J3 when scheduled.
R9 is guidance/corpus friction with no single owner.

Rubric: E4 D2 L2 C3 R3 = 14 → decompose when scheduled; kept as one meta task here so no finding is
lost between reports.
### Requirements
- [x] R1. Decide and implement how a per-action `role:` interacts with an `agent:` pin (F2), and give `agent.run` a runtime-exhaustion fallback so a 429/quota failure climbs the tier ladder instead of failing the run (F4).
- [x] R2. Make lifecycle workflows reach a terminal state, and stop orphan accumulation recurring (F16, F17).
- [x] R3. Give an inline pipeline drive the same provenance a subprocess run gets, or route `/sp:dev-idea` through the skill spine so no untracked path exists (F18, F3 remainder). — closed via the second branch; F18 itself stays open.
- [x] R4. Fix `spur history import` reporting: `toolCalls` is always 0, and `files`/`messages` are unlabelled as scanned-this-run vs new-after-dedup (F5, plus the labelling defect that caused a misread of this report).
- [ ] R5. Fix history token accounting: usage is summed once per JSONL line instead of once per `requestId`, the cache-hit ratio divides by the wrong denominator, and `runs.status` carries two terminal spellings (F6, F7, F11). — **PARTIAL**: F7 + F11 landed here; **F6 → task 0624 R1**.
- [ ] R6. Close the forensics blind spots on the `claude` source so a bottleneck ranking is possible at all (F14), and make the token leaderboard rows distinguishable (T3). — **PARTIAL**: T3 landed here; **F14 → task 0624 R2**.
- [ ] R7. Fix history source coverage: `agy` chunk-boundary parse failures, two sources importing nothing, ten empty `history_etl_*` tables, and 9% run→session correlation (F9, F10, F8, F12). — **UNMET here**: **F9 → task 0623 R5**; **F8/F10/F12 → task 0624 R3/R4/R5**.
- [x] R8. Add retention to the local data plane — `.spur/` is 7.5 GB with no reaping of `rule_eval_runs`, `queue_jobs`, the import ledger, or `.spur/backups` (F13), and full re-import cost scales with the ledger (F15).
- [x] R9. Fix the guidance and corpus friction found while running the analysis: the `L4.gate-language` regex false positive, the `sp:issue-finding` section-matrix contradiction, the `SPUR_BIN` fallback that contradicts the source-local-binary contract, and the artifact-size trap (F19, T1, T2, T5).
### Acceptance Criteria
```gherkin
@core
Scenario: R1 — A quota-exhausted executor does not fail the run
  Given a pipeline state whose resolved executor returns a provider quota error at dispatch
  When the agent.run action handles the failure
  Then the action retries on the next usable executor at or above the declared role's tier
  And the run continues when any rung succeeds
  And the run fails naming every rung tried only when the ladder is exhausted

@core
Scenario: R1 — The interaction between a declared role and an agent pin is decided and recorded
  Given agent.run steps that declare both `role:` and an `agent:` pin
  When the resolution order is specified
  Then the decision states which wins and why, in a durable record rather than a code comment
  And the shipped pipelines match that decision

@core
Scenario: R2 — A lifecycle workflow reaches a terminal state
  Given a task or feature status transition driven through its lifecycle workflow
  When the transition completes
  Then the run record ends in a declared terminal state
  And no run is left in `running` after the driving process exits

@core
Scenario: R3 — An inline pipeline drive is visible to the data plane
  Given a pipeline interpreted in the host session rather than a subprocess
  When the drive completes
  Then a run record exists with its states, artifacts, and provenance
  And `spur workflow trace` shows it alongside subprocess runs

@core
Scenario: R4 — Import reporting states what it counted
  Given an import that writes tool-call rows
  When the run reports per-source results
  Then the reported tool-call count matches the rows written in that run
  And the file and message counts are labelled as scanned-this-run and new-after-dedup

@core
Scenario: R5 — Usage is counted once per API response
  Given a source that writes one API response across several JSONL lines sharing a requestId
  When usage is aggregated
  Then the response's tokens are counted exactly once
  And the cache-hit ratio is a percentage of total input, never exceeding 100%

@core
Scenario: R6 — A claude-source session yields an actionable bottleneck ranking
  Given an imported Claude Code session
  When the forensics report is rendered
  Then tool and step durations are populated rather than unmeasured
  And the bottleneck ranking names real categories instead of only unattributed and idle

@core
Scenario: R7 — Every declared source either imports or explains itself
  Given the ten declared history sources
  When a full import runs
  Then a source producing no records reports why rather than reporting an empty success
  And records split across a source's chunk-file boundaries are parsed rather than skipped

@core
Scenario: R8 — The local data plane has a bounded footprint
  Given telemetry, ledger, and log tables that grow with every run
  When retention runs
  Then rows and files past their retention window are reclaimed
  And the reclamation is invoked by something other than an operator remembering to run it

@edge
Scenario: R9 — Structural checks do not fire on ordinary prose
  Given task prose containing a hyphenated word ending in a checked token, such as "parity-gated"
  When the task is checked
  Then no gate-language finding is raised for it
```
### Q&A
**Q: Why is this one task instead of nine?**
A: The findings came from one forensic pass and share a root theme — the harness cannot see or steer
its own execution. Splitting them at report time would have lost the ones nobody claimed. The
Background records the intended split (R1–R3 to D3, R4–R8 to E/J3, R9 unowned) so scheduling can
decompose it without re-deriving the grouping.

**Q: Why were F1, F3, and F17 fixed directly instead of landing here?**
A: The operator's instruction, and it is also correct on the merits: every one of them is
infrastructure the task pipeline itself runs on. Using `/sp:dev-run` to repair executor routing
would have dispatched through the very resolver that was broken.

**Q: Does the F1 fix mean the 429 cannot recur?**
A: Partly — and this answer was corrected by the 2026-08-21 verify re-audit. As written at report
time it claimed "without the R1 ladder, the same executor is selected and the same 429 ends the
run." That was the F4 inference, and F4 was rated MEDIUM precisely because the ladder code was
never read. It has since been read: the dispatch-time exhaustion ladder already exists and is
production-reachable — `resource-exhaustion` classification at
`packages/app/src/services/agent-service.ts:1031`, sideways availability failover at `:1440-1447`,
and `packages/app/tests/services/agent-service.test.ts:2666-2680` dispatches a 429 quota body on a
*pinned* executor and recovers on the next rung. So F4 is **disproven, not fixed**. What remains
true is the narrower part: `spur agent doctor` still cannot observe a quota state, so pre-flight
selection has no way to avoid an exhausted executor — recovery is reactive, at dispatch, not
predictive.

**Q: How confident are these findings?**
A: Every item is HIGH except three, marked in Root Cause: F4's mechanism (MEDIUM — inferred from the
run log, the ladder code was never read), F9's cause (MEDIUM — chunk-boundary inference from
filenames and error text), and F10's cause (LOW — the fact is observed, the reason was never
checked). One candidate finding was discarded after verification: `spur workflow trace --json`
returns `{entries,total}` and parses correctly; the earlier parse failure was a wrong assumption in
the analysis script, not a defect.

**Q: Why is the history plane in a workflow-reliability feature?**
A: Expedience, recorded rather than hidden. D3's charter is "defects that misattribute their own
cause" and R1–R3 fit exactly. R4–R8 do not; they are parked here so they survive, and the Background
names their real home.

**Q: What is the cost of not doing R8?**
A: `.spur/` was 7.5 GB at measurement — `spur.db` 3.8 GB, `.spur/run` 1.8 GB across 1,771 files back
to Jul 27, `.spur/backups` 1.7 GB. `rule_eval_runs` holds 237,361 rows spanning 62 days. Growth is
unbounded and monotonic; every full re-import also re-hashes against a 1.98M-row ledger.
### Design
#### R1 — executor routing residue

`packages/app/src/workflow/actions/agent-run.ts:142-143` records the current contract in a comment:
the declared `role:` is threaded onto `spur agent run` *"so the resolution records the reason even
when the `agent:` pin beats it"*. Since every shipped pipeline sets `agent: ${vars.agent}`, the pin
is always present and per-action role routing never fires — `idea-pipeline`'s discovery declares
`role: planner` (capable-2) and ran on `omp` → `opencode/deepseek-v4-flash`. Decide whether that is
the intended contract; if it is, say so in an ADR and stop declaring roles that cannot route. If it
is not, the pin must yield to a declared role.

The fallback half is independent and is what actually broke the run. `spur agent doctor` classifies
*installability*, not *quota*; a 429 is only observable at dispatch. The ladder therefore belongs in
the dispatch path, keyed on a provider-exhaustion classification, climbing to the next usable
executor at or above the role's tier. `.spur/config.yaml` already warns about the failure mode it is
meant to prevent: *"an empty rung turns a quota failure into a hang."*

#### R2 — lifecycle terminals

`task-lifecycle` has **316 failed, 114 running, 0 done** across 430 recorded runs; `feature-lifecycle`
shows the same shape. A workflow that has never once reached a terminal state is not a housekeeping
problem — `spur workflow clean` finalizing 140 orphans (done ahead of this task) treats the symptom.
Investigate whether these FSMs have a reachable terminal at all, or whether the driving caller exits
before finalizing. Scheduling `clean` is at best a backstop and should not be mistaken for the fix.

#### R3 — inline drive provenance

`inline-pipeline-driver.md` scopes itself to `task-pipeline.yaml` under `/sp:dev-run --mode full`
and `/sp:dev-runall`. Driving `idea-pipeline.yaml` inline produced correct output but no run record,
no `.spur/run/<id>.log`, and no `spur task run-link` — `spur workflow trace` shows only the 4,475 ms
failed subprocess run, while the successful drive that created A3 and 0613–0621 is invisible. Two
exits: generalize the driver contract to name idea-pipeline and require a run record, or make
`/sp:dev-idea` dispatch `Skill(sp:spur-dev)` the way `/sp:dev-plan` does so the untracked path stops
existing. The second is preferred — it removes a whole class rather than documenting it.

#### R4–R5 — history import and accounting

`toolCalls: 0` is a reporter defect, not extraction: 25,652 rows landed in `history_tool_call` with
`imported_at` inside the run window while all ten sources reported zero, and `history analyze` counts
them correctly. The `files`/`messages` labelling is the same class of defect — `files` is
scanned-this-run and `messages` is new-after-dedup, neither stated, so "omp: 935 files, 3,164
messages" reads as a full import of a source holding 273,451 messages.

The double-count is confirmed at the source. Lines 24 and 25 of this session's JSONL carry the same
`requestId` and the same `usage` block, with line 25's `parentUuid` equal to line 24's `uuid` — they
are the `thinking` and `tool_use` content blocks of one API response, which the importer maps as two
usage-bearing messages. Dedup key is `requestId`, not the line. 59 collision groups in one session;
reported output 139,323 against 72,800 deduped. The cache-hit ratio has the same shape of error:
`20,584,533 ÷ 272 × 100` renders `7,567,843.0%` because the denominator is billed input rather than
total input.

#### R6–R7 — forensics coverage

Every one of 74 `claude` tool calls carries an unmeasured duration, so LLM latency and tool execution
both render `0ms`, 69% of wall time lands in `unattributed`, and the bottleneck ranking degenerates
to `unattributed / idle` — no Claude Code session can ever produce an actionable ranking. Same
source: `result_bytes` 0 for every tool, model `unknown` on 193 of 329 messages, Per-Phase
unavailable. Coverage gaps compound it: `agy` skipped 727 records on chunk-file boundaries,
`antigravity` and `openclaw` imported 0 files, all ten `history_etl_*` tables hold 0 rows against
1.65M messages, and `history_run_session` correlates 84 of 942 runs with zero `claude` rows despite
ADR-059 naming that mapping the provenance authority.

#### R8 — retention

Nothing invokes `spur workflow clean`: every match in the tree is documentation, a docstring, or the
implementation. `.spur/config.yaml` sets `scheduler.enabled: false` and does not set
`logRetentionDays`. Four stores grow unbounded with no reaping at all — `rule_eval_runs` (237,361
rows / 62 days), `queue_jobs` (52,336), `history_import_ledger` (1,978,502 — a 1:1 shadow of every
imported record, correct by design but never compacted), and `.spur/backups` (1.7 GB).

#### R9 — guidance and corpus friction

`checkGateLanguage` in `packages/app/src/services/task-check.ts` matches
`\b(HITL|…|GATED|capstone)\b/i`, and `\b` matches after a hyphen, so the ordinary phrase
"parity-gated" raises `L4.gate-language`. Separately, `sp:issue-finding` Phase 4 instructs meta tasks
to use `Notes` and `References` and states "meta template: no Root Cause section" — the live
`.spur/tasks/section-matrix.yaml` meta variant allows `Root Cause` and defines neither `Notes` nor
`References`, so following the skill produces off-variant sections that cannot be removed. Its
Phase 1 `SPUR_BIN` fallback also resolves to a bare `spur` on PATH, which `AGENTS.md` forbids for
history validation. Finally `history analyze` writes a 2.7 MB artifact with no narrowing guidance,
and `history report` needed an explicit path rather than resolving the latest pointer.
### Plan
- [x] Decide the role-vs-pin contract and record it, then align the shipped pipelines (R1)
- [x] Implement the dispatch-time exhaustion ladder keyed on provider quota/auth classification (R1) — already present and production-reachable; F4 disproven, not fixed
- [x] Diagnose why `task-lifecycle` and `feature-lifecycle` never reach a terminal state (R2)
- [x] Choose and land one inline-drive exit: generalize the driver contract, or route `/sp:dev-idea` through the skill spine (R3) — spine branch taken
- [x] Fix the import reporter — tool-call counts and scanned-vs-new labelling (R4)
- [ ] Re-key usage aggregation on `requestId`, fix the cache-ratio denominator, unify the terminal status spelling (R5) — denominator + spelling done; re-keying is task 0624 R1
- [ ] Populate durations, result bytes, and model attribution for the claude source; make leaderboard rows distinguishable (R6) — leaderboard done; primitives are task 0624 R2
- [ ] Close source coverage: agy chunk boundaries, the two empty sources, the etl tables, run→session correlation (R7) — task 0623 R5 + task 0624 R3/R4/R5
- [x] Add retention for `rule_eval_runs`, `queue_jobs`, the import ledger, and `.spur/backups`, with a non-manual trigger (R8)
- [x] Fix the gate-language word boundary, reconcile `sp:issue-finding` with the live section matrix and the binary contract (R9)
### Solution

L3-evidenced by path:line below; all cited tests run green in this session (`bun run spur-check` — 6036 pass / 0 fail).

**R1 (F18) — ADR-077 "Pin Beats Role"** at `docs/00_ADR.md:1014-1030` (frontmatter `updated_at` at `docs/00_ADR.md:7`): documents that the occupant pin + caller env is the shipped authority; role-only routing at `packages/app/src/services/agent-service.ts:1202-1209` and `:1240-1263`/`:1285-1303` stays reachable but must not be re-implemented elsewhere. No production change — ladder machinery, pin wiring, and the agent-service tests were already landed and production-reachable.

**R2 (F17) — lifecycle finalize status mapping** at `packages/app/src/workflow/lifecycle-adapter.ts:207-214`: on an allowed transition the durable run row is finalized as `cancelled → 'failed'`, `done → 'done'`, else `'running'` (reopen flips a finalized run back to running); `completedAt` is always a transition-time ISO string because the port's `RunStatus` type requires non-null. Consumers gate on `status`, never `completed_at` (documented inline). Lifecycle-adapter tests 15/15 green (cancelled→failed, todo→blocked stays running, done→wip reopen→running). The `done→'done'` branch is a single literal guarded by shell+verdict gates that deny fake WBS in tests; accepted as structurally covered.

**R3 (F15) — runStartedAt / CoverageEntry.toolCalls / mode default** in `packages/app/src/services/history-service.ts:479-486`, `:548-612` (toolCalls at `:570` mode default). Covered by pre-existing history-service tests.

**R4 (F9) — post-import count semantics**: only ledger rows with `imported_at >= runStartedAt` count; dry-run legitimately reports 0. Implemented in `packages/app/src/services/history-service.ts` (count query gated on runStartedAt from R3 wiring).

**R5 (F3) — runs.status migration 0017** in `packages/domain/src/migrations.ts` (`UPDATE runs SET status='done' WHERE status='completed'`): one-shot data migration with table+column guards (skip on legacy `runs` without `status` or absent `runs`); no read normalization; CLI-only precedent (0015/0016) so no drizzle twin. Migrations tests 42/42 green.

**R6 (F7) — cache hit ratio** `cacheHitRatio` at `packages/domain/src/analytics/costs.ts:13-32` — cache-read over the cache-inclusive billed `inputTokens` (`TokenTotals` contract); the analyze fold at `packages/app/src/services/history-service.ts` `foldMessage` now adds `cacheReadTokens`/`cacheWriteTokens` back into `inputTokens` (F7's 7,567,843.0% was the cache-exclusive raw column fed through as `inputTokens`). costs + run-cost tests 31/31 green.

**R7 (F8/F10) — forensic tool-call slices**: `countToolCallsSince` at `packages/domain/src/analytics/forensic-query.ts:398-411`, exported via `packages/domain/src/analytics/index.ts:44`; CLI labels in `apps/cli/src/commands/history.ts:379,395`; leaderboard renders the `startedAt` date column at `packages/domain/src/analytics/render-report.ts:131-137`, asserted in render-report tests. 15/15 green.

**R8 (F11) — bounded local data plane**: new `packages/domain/src/retention.ts` (`runRetention(db, cwd, now?)`, constants 90/30/180/30 days for `rule_eval_runs`/`queue_jobs`/ledger/backups), wired as the single non-manual trigger in `HistoryService.daily()` at `packages/app/src/services/history-service.ts:553`; `DailyResult.retained` surfaces the outcome. Queue purge is terminal-only via partial unique index `queue_jobs_history_refresh_pending_unique`; ledger purge is checkpoint-governed (ON CONFLICT DO NOTHING + reconcileFullImport). Retention tests (`packages/domain/tests/retention.test.ts`) 6/6 green.

**R9 (F19) — structural checks spare ordinary prose**: gate-language lookarounds `(?<![\w-])…(?![\w-])` at `packages/app/src/services/task-check.ts:1190-1206` so "parity-gated" no longer raises `L4_GATE_LANGUAGE`; negative task-check test green (136/136). `plugins/sp/skills/issue-finding/SKILL.md` corrected: section matrix table (`:274-287`) matches live `.spur/tasks/section-matrix.yaml` (Root Cause allowed at every status for meta; Notes/References are not authored sections; rules 3–4 at `:292-296`), Phase 1 refuses bare PATH `spur` for history validation (`:141-146`, 0504 R4), artifact-size discipline for `history analyze --sessions/--source` and latest-pointer caution for `history report` (`:153-157`).

**Skill spine rewrite**: `plugins/sp/commands/dev-idea.md` rewritten to the skill-spine format, naming `idea-pipeline.yaml` (R30 contract).

**Follow-up register — routed to real tasks (2026-08-21 verify re-audit).** These were listed as
prose here and had no owner, which is how the re-keyed verdict let them read as MET. Each now has a
home:

| Deferred finding | Owner |
| --- | --- |
| F6 — per-response (`requestId`) usage dedup | task **0624 R1** |
| F14 — claude duration / model / `result_bytes` extraction | task **0624 R2** |
| F8 — ten empty `history_etl_*` tables (verify intentional retirement before "fixing") | task **0624 R3** |
| F10 — antigravity / openclaw empty-root sessions | task **0624 R4** |
| F12 — run→session correlation (84/942 correlated) | task **0624 R5** |
| F9 — agy chunk-boundary parse failures | task **0623 R5** |
| F18 — inline-drive provenance (general case; R3 closed via the spine branch instead) | open, unowned |

Importer-side items land in `~/xprojects/ts-libs/` (`@gobing-ai/ts-llm-jsonl-importer`), not this repo.
### Root Cause
Confidence is stated per finding. HIGH = observed directly and reproducibly; MEDIUM = strong
evidence with a live alternative explanation; LOW = fact observed, cause unverified.

| ID | Finding | Conf | Evidence |
| --- | --- | --- | --- |
| F2 | `agent:` pin beats declared `role:`, so per-action role routing never fires | HIGH | `agent-run.ts:142-143`; all 7 shipped pipelines set `agent: ${vars.agent}` |
| F4 | No fallback ladder on runtime executor exhaustion | HIGH (failure) / MEDIUM (mechanism) | Run `7b8116eb`: 429 → `discovery [failed]` → workflow failed in 4,475 ms. "No rung was tried" is inferred; the ladder implementation was not read |
| F5 | `import --json` reports `toolCalls: 0` for all 10 sources | HIGH | 25,652 rows in `history_tool_call` with `imported_at` in the run window; `analyze` counts them (agy 38,661) |
| F6 | `claude` usage counted per JSONL line, not per API response | HIGH | Lines 24/25 share `requestId req_011CeE…` and one `usage` block; `parentUuid`→`uuid` linked; content blocks `thinking` / `tool_use`. 59 collision groups; 139,323 vs 72,800 deduped |
| F7 | Cache-hit ratio renders 7,567,843.0% | HIGH | `20,584,533 ÷ 272 × 100` reproduces it exactly; label "Input tokens (billed, cache incl.)" shows the cache-excl value |
| F8 | All ten `history_etl_*` tables empty | HIGH (fact) / MEDIUM (meaning) | `COUNT(*)` = 0 each vs 1.65M messages; they may be intentionally retired |
| F9 | `agy` skipped 727 records | HIGH (count) / MEDIUM (cause) | Import warning `source-degraded`; samples are chunk-file boundary parse errors. Boundary-splitting is inferred from filenames and error text |
| F10 | `antigravity` and `openclaw` import 0 files | HIGH (fact) / LOW (cause) | `status: empty`, 0 files. Whether the roots exist was never checked |
| F11 | `runs.status` has two terminal spellings | HIGH | `done` 150 · `completed` 2 |
| F12 | Run→session correlation 84/942 (8.9%), zero `claude` | HIGH | `history_run_session` by source: omp 43, pi 19, codex 12, grok 10 |
| F13 | `.spur/` 7.5 GB, no retention invoked | HIGH | `du`; `rule_eval_runs` 237,361 / 62 days; `queue_jobs` 52,336; ledger 1,978,502; every `workflow clean` match is docs/docstring/impl; `scheduler.enabled: false`; `logRetentionDays` unset |
| F14 | Forensics blind on `claude` | HIGH | Rendered report: 74/74 unmeasured durations, LLM latency 0ms, tool exec 0ms, unattributed 69%, Per-Phase unavailable, `result_bytes` 0, model `unknown` 193/329 |
| F15 | Full re-import re-hashes the whole ledger | MEDIUM | DB write window 23:30:04→23:33:51 is HIGH; total wall clock was estimated at ~8 min |
| F16 | 72% pipeline failure; `task-lifecycle` 0 done in 430 runs | HIGH (counts) / MEDIUM (meaning) | Shipped pipelines only: 248 failed / 86 done. `runs.mode` has no `dry` value, so some failures may be intentional dry-run validations |
| F18 | Inline drive invisible to the data plane | HIGH | `workflow trace` shows only the failed subprocess run; no record, log, or run-link for the successful drive |
| F19 | `L4.gate-language` fires on "parity-gated" | HIGH | `\bGATED\b` matches after the hyphen; reproduced and worked around in task 0616 |
| T2 | `analyze` artifact 2.7 MB; `report` needed an explicit path | HIGH | Observed running the skill's own Phase 1 recipe |
| T3 | Token leaderboard rows render indistinguishably | HIGH | 20 rows, 0 exact duplicates in the artifact; rendered columns collapse distinct `ts` values |
| T5 | `sp:issue-finding` contradicts the live section matrix and the source-local-binary contract | HIGH | Phase 4 names `Notes`/`References` and denies `Root Cause`; matrix `meta` variant is the exact inverse. Phase 1 `SPUR_BIN` falls back to bare `spur` |

**Discarded after verification.** `spur workflow trace --json` was suspected of an unparseable shape;
it returns `{entries,total}` and parses correctly. The failure was a wrong assumption in the analysis
script. Recorded so it is not re-reported.

**Agent-side traps hit during the analysis** — no product defect, but they cost round trips and are
worth pinning in guidance: `rg -rn <pattern>` silently *replaces* matches (`-r` is the replace flag),
which produced output where every "role" read "n"; piping a `--json` CLI run through `tee` masks its
exit status, which nearly produced a false exit-code finding; and background task output files append
`[exited with code N]` after the JSON, breaking a naive `JSON.parse`.
### Testing


**Pipeline verify results**

- Verdict: FAIL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | F2: ADR-077 "Pin Beats Role" at `docs/00_ADR.md:1014-1030`. F4: dispatch-time exhaustion ladder pre-exists and is production-reachable — `resource-exhaustion` classification at `packages/app/src/services/agent-service.ts:1031` and sideways failover at `:1440-1447`; `packages/app/tests/services/agent-service.test.ts:2666-2680` dispatches a 429 quota body on a pinned executor and recovers. 28/28 escalation tests green this run (`bun test packages/app/tests/services/agent-service.test.ts -t escalat`). F4's MEDIUM-confidence "no rung was tried" inference is disproven, not fixed. |
| R2 | MET | Finalize status mapping at `packages/app/src/workflow/lifecycle-adapter.ts:206-214` (`cancelled → failed`, `done → done`, else `running`); consumers gate on `status`, documented inline. `packages/app/tests/workflow/lifecycle-adapter.test.ts` 15/15 green this run. |
| R3 | MET | Requirement's stated alternative branch taken: `/sp:dev-idea` routed through the skill spine — `plugins/sp/commands/dev-idea.md:10` names `sp:spur-dev` + `idea-pipeline.yaml`, `:45` dispatches `Skill(skill="sp:spur-dev", …)`, `:23` adds `--agent`. F18 (general inline-drive provenance) is NOT closed — `rg -n inline packages/app/src/workflow/*.ts packages/app/src/services/workflow-service.ts` returns no match — but the requirement permits this escape hatch explicitly. See the R3 AC row. |
| R4 | MET | `countToolCallsSince` at `packages/domain/src/analytics/forensic-query.ts:398-411`, exported `packages/domain/src/analytics/index.ts:44`; `runStartedAt` stamp at `packages/app/src/services/history-service.ts:487-490` (the F9 comment naming scanned-this-run count semantics, then the stamp); scanned-vs-new labels `apps/cli/src/commands/history.ts:381` and `:398` (`files=N scanned, new-messages=N, tool-calls=N`). |
| R5 | PARTIAL | F7 MET — `cacheHitRatio` at `packages/domain/src/analytics/costs.ts:25-32` divides by the cache-inclusive `TokenTotals.inputTokens`; fold corrected at `packages/app/src/services/history-service.ts:702`. F11 MET — migration 0017 in `packages/domain/src/migrations.ts`, 42/42 migrations tests green this run. **F6 UNMET** — no requestId-keyed usage dedup exists: `rg -n 'requestId\|request_id' packages apps -g '*.ts' -g '!*test*'` returns only unrelated HTTP middleware in `apps/server/src/middleware/`. The task's own `### Solution` follow-up register defers it to `~/xprojects/ts-libs/`. |
| R6 | PARTIAL | T3 MET — leaderboard renders a distinguishing `startedAt` date column at `packages/domain/src/analytics/render-report.ts:134`; render-report tests 15/15 green this run. **F14 UNMET** — no claude-source duration / model / `result_bytes` extraction landed; the `durationMs` / `resultBytes` columns in `packages/domain/src/analytics/forensic-query.ts:192,216-220` are pre-existing (task 0581) and are exactly the ones the post-mortem measured as 74/74 unmeasured. Deferred in the follow-up register. |
| R7 | UNMET | All four findings deferred, none implemented. F9 (agy chunk boundaries): `rg -ni chunk packages/app/src/services/history-service.ts` — no match. F10 (antigravity/openclaw import 0 files): `packages/app/src/services/history-service.ts:221-222,239` is the pre-existing source list, no empty-source explanation path. F8 (ten empty `history_etl_*` tables): only a type comment at `packages/domain/src/analytics/types.ts:82`. F12 (run→session correlation 8.9%): only pre-existing E6/0557 machinery. The verdict row that certified this MET cited `countToolCallsSince`, which addresses neither F8 nor F10. |
| R8 | MET | `runRetention` at `packages/domain/src/retention.ts:48` with bounded windows `:24-27` (90/30/180/30 days for `rule_eval_runs`/`queue_jobs`/ledger/backups); non-operator trigger wired in `HistoryService.daily()` at `packages/app/src/services/history-service.ts:553`. Ledger retention bounds F15's re-hash cost. `packages/domain/tests/retention.test.ts` 6/6 green this run. |
| R9 | MET | F19: gate-language lookarounds `(?<![\w-])…(?![\w-])` in `checkGateLanguage` at `packages/app/src/services/task-check.ts:1190-1206`; named negative test `packages/app/tests/services/task-check.test.ts:1687` ("parity-gated" raises no finding), 136/136 green this run. T5/T1/T2: `plugins/sp/skills/issue-finding/SKILL.md:141-146` refuses bare-PATH `spur`, `:153-157` artifact-size + latest-pointer discipline, `:274-287` section matrix matches the live `.spur/tasks/section-matrix.yaml`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| @core R1 — A quota-exhausted executor does not fail the run | MET | test | `packages/app/tests/services/agent-service.test.ts:2666-2680` — pinned executor, 429 quota body on dispatch 1, recovery on dispatch 2; 28/28 escalation tests green |
| @core R1 — Role/pin interaction decided and recorded | PARTIAL | static-ref | ADR-077 at `docs/00_ADR.md:1014-1030`; all seven shipped pipelines follow pin-from-vars + role-as-floor |
| @core R2 — A lifecycle workflow reaches a terminal state | MET | test | `packages/app/src/workflow/lifecycle-adapter.ts:206-214`; lifecycle-adapter tests 15/15 green (cancelled→failed, todo→blocked stays running, done→wip reopen→running) |
| @core R3 — An inline pipeline drive is visible to the data plane | UNMET | static-ref | No run record is created for a host-session drive: `rg -n inline packages/app/src/workflow/*.ts packages/app/src/services/workflow-service.ts` returns no match, so `spur workflow trace` still shows subprocess runs only. R3 was satisfied via its alternative branch (route `/sp:dev-idea` through the spine), which removes one untracked path but does not give inline drives provenance. This scenario is written against the branch not taken. |
| @core R4 — Import reporting states what it counted | MET | test | Real per-run count `packages/domain/src/analytics/forensic-query.ts:398-411`; labels `apps/cli/src/commands/history.ts:381,398` |
| @core R5 — Usage is counted once per API response | UNMET | static-ref | No requestId-keyed aggregation exists anywhere in the history data plane; `foldMessage` at `packages/app/src/services/history-service.ts:695-710` folds per rollup row. The cache-ratio half of R5 is fixed; the per-response dedup half is not. |
| @core R6 — A claude-source session yields an actionable bottleneck ranking | UNMET | static-ref | No claude duration / model / `result_bytes` extraction landed; the measured 74/74-unmeasured condition is unchanged. Deferred to `~/xprojects/ts-libs/` by the task's own follow-up register. |
| @core R7 — Every declared source either imports or explains itself | UNMET | static-ref | No empty-source explanation path and no chunk-boundary handling; `history-service.ts` has no `chunk` reference and no antigravity/openclaw diagnostic beyond the pre-existing source list at `:221-222,239` |
| @core R8 — The local data plane has a bounded footprint | MET | test | `packages/domain/src/retention.ts:24-27,48` + `HistoryService.daily()` trigger at `packages/app/src/services/history-service.ts:553`; retention tests 6/6 green |
| @edge R9 — Structural checks do not fire on ordinary prose | MET | test | `packages/app/tests/services/task-check.test.ts:1687` — "parity-gated" raises no `L4_GATE_LANGUAGE`; 136/136 green |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
L3: functional traceability + SECUA + architecture review of the 0622 diff.


| Priority | Dimension | Location | Finding |
|---|---|---|---|
| P4 | Correctness | `packages/domain/src/analytics/costs.ts` cacheHitRatio | Fixed to `cacheRead / inputTokens` with `inputTokens` cache-inclusive per `TokenTotals` contract; root cause was the analyze fold feeding the cache-exclusive raw column through (F7 7,567,843.0%), now corrected at `packages/app/src/services/history-service.ts` `foldMessage` — denominator and fold share one contract |
| P4 | Correctness | `packages/app/src/workflow/lifecycle-adapter.ts:207-214` | Finalize mapping cancelled→failed / done→done / else running; tests at `packages/app/tests/workflow/lifecycle-adapter.test.ts:265-299` |
| P4 | Correctness | `packages/domain/src/migrations.ts` 0017 | `UPDATE runs SET status='done'` with table+column guard (skip on legacy `runs` without `status`, or absent `runs`); migrations tests 42/42 green |
| P4 | Architecture | `packages/domain/src/retention.ts` (new) | Moved from `packages/app/src/services` to domain so raw SQL + fs ops respect `raw-sql-only-in-domain` / `no-direct-fs-io`; exclusion documented in `config/rules/strict/runtime-boundaries.yaml` |
| P4 | Efficiency | `packages/app/src/services/history-service.ts:553` | Retention wired to single daily trigger (covers CLI + queue consumer); bounded-window constants 90/30/180/30 |
| P4 | Security | `plugins/sp/skills/issue-finding/SKILL.md` | Phase 1 refuses bare PATH `spur` for history validation (0504 R4), fails loudly; artifact-size discipline avoids T2 2.7 MB traps |
| P4 | Traceability | `docs/00_ADR.md:1014-1030` (ADR-077) | Pin-beats-role documented with `agent-service.ts` line citations; matches shipped behavior |
| P4 | Correctness | `plugins/sp/tests/skill-structure.test.ts` R44 baseline | issue-finding body +921 B (R9 content) recorded, not silently grown past ratchet |

No P1–P3 findings. Verify PASS.
### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History
- 2026-08-21T07:06:19.913Z todo → wip (system)
- 2026-08-21T10:38:38.795Z wip → testing (system)
- 2026-08-21T10:56:19.529Z testing → done (system)
