---
schema_version: 1
name: "Close the 2026-08-21 dogfood residue: lifecycle projections and gates that report a state the tree contradicts"
status: backlog
template: meta
created_at: 2026-08-21T21:34:00.042Z
updated_at: "2026-08-21T21:38:26.933Z"
feature_id: F91
ac_altitude: task-local
---

## 0625. Close the 2026-08-21 dogfood residue: lifecycle projections and gates that report a state the tree contradicts

### Background
Four dogfood reports were produced on 2026-08-21 (`docs/dogfood/2026-08-21-*.md`, gitignored):

| Report | Testee |
| --- | --- |
| `2026-08-21-sp-dev-run-0622-auto-next-dogfood.md` | `/sp:dev-run 0622 --auto --next` |
| `2026-08-21-sp-dev-run-0622-auto-next-agent-inline-dogfood.md` | same, `--agent inline` |
| `2026-08-21-A3-harness-surface-governance-batch-dogfood.md` | `/sp:dev-runall --feature A3 --auto --next --agent inline` |
| `2026-08-21-A3-sp-dev-verify-feature-A3-auto-next-force-focus-all-fix-all-dogfood.md` | `/sp:dev-verify --feature A3 --auto --next --force --focus all --fix all` |

Together they raised eleven findings. **Six were closed before this task was written** and are
recorded here so no one re-opens them:

| Finding | Status |
| --- | --- |
| Role `coder` probed as an executor; `agent doctor coder` fabricates `{usable:false}` | **FIXED** `649bbaf7` — `doctor-probe.ts:190` classifies against `resolvedAgent`; live `agent doctor coder --json` returns `omp-dsv4-flash-volc`, `usable: true` |
| `ensurePipelineRunLink` idempotency binds a second run to the first run's provenance | **FIXED** `649bbaf7` — `pipeline-run-link.ts:57-66` re-points on an explicit differing `runId` |
| `task record` clobbers an authored `## Testing` with the UNKNOWN stub | **FIXED** `79593c0a` — record preserves an authored Testing when the verdict is UNKNOWN |
| `TASK_CANONICAL_SECTIONS` ordered `Solution` before `Root Cause` (~200 false findings) | **FIXED** `77702bb2` |
| Boundary-rule debt surfacing late in the batch | **MITIGATED** — gate-preflight codified in `execution-batch.md` §Gate preflight |
| Change-map rows citing `cmd_*.md` underscore paths trip `L4.anchor-subject-mismatch` | **MITIGATED** — authoring rule codified in `inline-pipeline-driver.md`; the checker is unchanged |

The five findings left share one root, and it is not the same root the fixed six had: **a Spur
surface reports a lifecycle state that the tree contradicts, and no gate is positioned to notice.**

- The pipeline quality gate is `bun run autofix && bun run spur-check` (`execution-workflow.md:49`)
  — the **fast** gate, which excludes `corpus-check`. A commit that transitions a feature therefore
  never runs the only sweep that sees feature-level findings. `247b51f8` moved A3 to `verifying`,
  which armed `L4.dogfood-missing`, and left `main` red on `bun run spur-check-new` until
  `4c3bf737` — undetected across three commits.
- `spur feature sync` moves status; `spur feature refresh` rewrites the `## Tasks` projection. They
  are separate verbs and the wrap path calls only the first, so A3's roster read `todo` for all nine
  tasks while every task was `done`. This is a **recurrence**: the same defect was filed as P4 in
  `docs/dogfood/2026-07-27-sp-dev-verifyall-feature-F81-…-dogfood.md`, four weeks earlier, against
  feature F81.
- Tasks 0619 and 0620 reached `done` carrying `Verdict: UNKNOWN … No requirements recorded` in
  `## Testing` while `.spur/run/06{19,20}-verdict.json` held `PASS` with populated MET rows. The
  clobber that produced the stub is fixed; nothing detects a stub already sitting in a task file.
- 0620's `### Solution` change map cited `apps/cli/src/commands/workflow.ts:744`; the symbol is at
  `:759`. `checkLineAnchors` covers `['Testing','Solution']` (`task-check.ts:1237`) but a bare
  change-map row carries no subject words, so subject-matching has nothing to match and the drift
  passes. The identical drift in 0591 **was** caught, because its rows carry prose.
- `spur feature refresh` with no `--feature` rewrote the `## Tasks` table of D3, D5, D6 and E5
  alongside A3, and `L4.dogfood-missing` clears on any `docs/dogfood/` filename merely *containing*
  the feature id (`feature-check.ts:566`), which for a two-character id like `A3` is loose.

**Not in this task.** F9 agy parse errors → **0623 R5**. History data-plane residue (F6/F8/F10/F12/F14)
→ **0624**. Neither overlaps: 0623 is CLI-surface parity SSOT plus the agy mapper, 0624 is the
history schema and importers. This task touches neither.
### Requirements
- [ ] R1. Make a lifecycle transition that changes feature state run the corpus-aware gate. The pipeline quality gate defaults to `bun run autofix && bun run spur-check` (`plugins/sp/skills/spur-dev/references/execution-workflow.md:49`), which omits `corpus-check` — the only sweep that observes feature-level findings. A commit that advances a feature must not be able to leave `bun run spur-check-new` red. Out of scope: making `corpus-check` part of the per-task fast gate — the ~41 s cost is why the split exists (commit `4b929877`), and per-task transitions do not arm feature-level findings.

- [ ] R2. Converge the feature status/docs projection so `spur feature sync` cannot leave a `## Tasks` table contradicting the task edges it just read. Either `sync` refreshes the features it touched, or the wrap path calls both verbs — decide which in `### Q&A` before writing code. Out of scope: changing the `## Tasks` table format or the `AUTO-GENERATED` marker contract.

- [ ] R3. Give `spur task check` a finding for a `## Testing` section whose body is the `record` UNKNOWN stub (`| — | — | No requirements recorded; verify verdict … |`, emitted at `packages/app/src/services/task-record.ts:191`), so the stub cannot sit in a `done` task unobserved. Severity must be chosen against the two-sided ratchet: the corpus holds tasks in this shape today, so a new **error** obliges same-commit baseline reconciliation (constitution T10). Out of scope: re-authoring the historical tasks the sweep surfaces — record them in the warning baseline.

- [ ] R4. Make `### Solution` change-map anchor drift detectable. `checkLineAnchors` already covers `Solution` (`packages/app/src/services/task-check.ts:1237`) but only for existence and line bounds; subject-matching cannot fire on a change-map row that carries no prose (0620 cited `workflow.ts:744`, symbol at `:759`, gate silent — while 0591's prose-bearing row with identical drift reported). Out of scope: the `cmd_*.md` underscore false-positive, which has a landed authoring mitigation and needs its own measurement.

- [ ] R5. Tighten two feature-surface imprecisions that let a broad action look narrow and a loose match look like proof: `spur feature refresh` with no `--feature` rewrites every feature's `## Tasks` table (it rewrote D3/D5/D6/E5 alongside A3 during the A3 verify run), and `L4.dogfood-missing` clears on any `docs/dogfood/` filename *containing* the feature id (`packages/app/src/services/feature-check.ts:566`), which a two-character id like `A3` matches by accident. Out of scope: changing the dogfood requirement itself or which features arm it.
### Acceptance Criteria
```gherkin
@core
Scenario: R1 — A feature transition cannot leave the corpus gate red
  Given a feature whose transition arms a feature-level finding
  When the lifecycle path that performs the transition runs its quality gate
  Then the gate that observes feature-level findings runs before the transition is reported complete
  And a finding armed by the transition fails that gate naming the feature

@core
Scenario: R2 — Feature status and the task roster agree after a sync
  Given a feature whose linked tasks are all done while its Tasks table reads todo
  When the feature status is synced from those task edges
  Then the rendered Tasks table reports the same statuses the sync just read
  And no separate command is required to make the two agree

@core
Scenario: R3 — A hollow Testing section is reported
  Given a task whose Testing section carries the record UNKNOWN stub row
  When spur task check runs against it
  Then a finding names the Testing section and the stub
  And a task whose Testing carries a populated requirement table reports no such finding

@edge
Scenario: R3 — The new finding is reconciled two-sided in the same commit
  Given the corpus already holds tasks carrying the stub
  When the corpus sweep runs after the finding is added
  Then every pre-existing occurrence is accounted for in the accepted baseline
  And the sweep reports zero new and zero stale entries

@core
Scenario: R4 — Change-map anchor drift is caught
  Given a Solution change-map row citing a path and line where the named symbol no longer sits
  When spur task check runs against it
  Then a finding names the drifted anchor
  And a row whose cited line still names its symbol reports no finding

@core
Scenario: R5 — A refresh touches only what it was asked to touch
  Given several features whose Tasks tables are stale
  When a refresh is invoked without naming a feature
  Then it does not silently rewrite features the caller did not name
  And naming a feature rewrites exactly that feature

@edge
Scenario: R5 — The dogfood gate matches the feature it is named for
  Given a dogfood report whose filename contains a feature id only as an incidental substring
  When the feature check evaluates the dogfood requirement for that feature
  Then the incidental match does not satisfy the requirement
  And a report genuinely named for the feature does satisfy it
```
### Q&A
**Q: Why one task for five findings instead of five tasks?**
A: They share one root — a surface reporting a lifecycle state the tree contradicts — and two of
them (R1's gate, R3/R4's new findings) interact: R1 is the gate that must observe R3's and R4's
fallout. Splitting them would repeat 0622's failure mode, where a deferred item with no owner reads
as done. Each is independently implementable and independently verifiable; split at scheduling time
if the batch is too large, not before.

**Q: Six of the eleven dogfood findings are marked FIXED in Background. Was that verified or assumed?**
A: Verified this session, not read off the reports. `agent doctor coder --json` was run live and
returns `omp-dsv4-flash-volc` with `usable: true` — the fabricated `{usable:false}` is gone.
`pipeline-run-link.ts:57-66` was read and carries the explicit-`runId` re-point. Both landed in
`649bbaf7`, which post-dates the two 0622 dogfood runs (00:34Z and 00:40Z). The dogfood reports were
accurate when written and are stale now; proposing those fixes again would be the exact
post-mortem-inflation trap this task is meant to avoid.

**Q: Why is this under F91, and what does `ac_altitude: task-local` do here?**
A: F91's Goal is "make the task-corpus gates tell the truth, and make sure they keep telling it",
which is this task's root stated from the gate side. R3 and R4 are direct RC-1 descendants (the
anchor gate checks existence and bounds, never content); R1 is the same defect one level up (the
gate that would catch a feature finding is not the gate the transition runs); R5(b) is a
`feature check` matching defect. R2 is the outlier — it is feature-service convergence, not a gate
— and R5(a) is an ADR-051 CLI surface change that F91's § Out of scope excludes. Both are kept here
rather than split because they share the root and R1's gate is what makes R2's symptom visible.
`ac_altitude: task-local` (task 0584 R3) is set because these scenarios are deliberately finer than
F91's ship contract: they are this task's verification bar, not feature-ship criteria, so the DD-09
subset rule is skipped rather than F91's AC being widened to absorb them. Raise re-homing of R2/R5(a)
at scheduling if the split is preferred.

**Q: R2 says decide service-level vs caller-level "in Q&A". What is the recommendation?**
A: Service-level — `syncFeature` calls `refresh({ featureId })` for the feature it touched. It
already holds the task edges, so the projection costs nothing extra at that point, and it closes the
invariant for a bare `spur feature sync`, which is exactly how A3's roster went stale. Caller-level
(patching `feature-sync-bounded.ts`) fixes the pipeline and leaves the trap armed for the next
caller — which is how this became a recurrence of the F81 finding rather than a first sighting.

**Q: Why land R3 as a warning rather than an error?**
A: Because the corpus already holds tasks in this shape, and the ratchet is two-sided: a new error
obliges reconciling every occurrence in the same commit (constitution T10). Warning-first with a
same-commit warning-baseline reconciliation is F91's own landed pattern for RC-1 (operator ruling
2026-08-17: land the content check as a warning, promote to error only after migration). Promotion
belongs to a follow-up once the count is known.

**Q: Isn't R1 just "run the slow gate everywhere"?**
A: No, and that distinction is the requirement. The per-task gate stays `spur-check`; the split
between it and `spur-check-new` is deliberate and measured (commit `4b929877` — the corpus sweep is
more than half the gate again). R1 adds the corpus-aware gate at exactly one place: the
`feature-transition` step, which runs once per feature and is the only transition that arms
feature-level findings.

**Q: What is deliberately NOT in this task?**
A: F9 agy chunk-boundary parse errors → **0623 R5**. History data-plane residue F6/F8/F10/F12/F14 →
**0624**. The `cmd_*.md` underscore false-positive in subject-matching → has a landed authoring
mitigation, blast radius unmeasured, needs its own task. The one-writer-per-working-tree hazard →
recorded in `### Notes` as an observation; no mechanism was proposed and inventing one here would be
speculative. 0622's R8 retention never firing → belongs to E5/0622, recorded in 0624's Background.

**Q: Will R5(a) trip the ADR-051 consent gate?**
A: Yes. Changing `spur feature refresh` so the bare form no longer sweeps every feature is an
observable behavior change to a public verb, which ADR-051's amended consent gate covers explicitly
("the consent gate covers observable output changes of existing verbs, not just noun/verb
additions"). Present the options with design context and get consent before landing. R5(b) is
internal matching logic and needs no consent.
### Design
Five findings, one root: **a Spur surface reports a lifecycle state the tree contradicts, and no
gate is positioned to notice.** Sequenced **R1 → R2 → R3 → R4 → R5** because R1 is the gate that
would have caught R2's symptom, and R3/R4 add findings whose fallout R1's gate must then observe.

#### Frozen names

| Kind | Name | Location |
| --- | --- | --- |
| Finding code | `L4.testing-verdict-stub` | `packages/config/src/finding-codes.ts` (beside `L4_STALE_LINE_ANCHOR`) |
| Constant | `TESTING_VERDICT_STUB_RE` | `packages/app/src/services/task-check.ts` |
| Workflow var | `featureGateCmd` (default `bun run spur-check-new`) | `config/workflows/wrapup-pipeline.yaml` `vars` |

Confirm `L4.testing-verdict-stub` is absent from `finding-codes.ts` before adding it; the file is
the two-sided registry the corpus ratchet reads.

#### R1 — feature transitions run the corpus-aware gate

**WHERE:** `config/workflows/wrapup-pipeline.yaml` — `feature-transition` step at `:140-163`;
the pipeline gate default lives at `plugins/sp/skills/spur-dev/references/execution-workflow.md:49`
(`bun run autofix && bun run spur-check`).

**WHAT:** the per-task gate stays `spur-check` — that split is deliberate (commit `4b929877`: the
corpus sweep costs ~41 s against a ~72 s gate, and per-task transitions arm no feature-level
findings). Add a `featureGateCmd` var to `wrapup-pipeline.yaml`, default `bun run spur-check-new`,
run in the `feature-transition` step **after** the sync reports applied and **before** the step
reports success. A feature transition happens once per feature, so the ~41 s is paid once.

**Evidence it is needed:** `247b51f8` advanced A3 to `verifying`, arming `L4.dogfood-missing`
(`feature-check.ts:552` fires on `verifying` or `done`). `main` stayed red on `spur-check-new`
across `247b51f8` → `79593c0a` → `0e247f03` until `4c3bf737`. Every one of those commits ran the
fast gate and passed.

**Anti-patterns:** Do **not** add `corpus-check` to `spur-check` or to the per-task `record` step —
that re-merges the split `4b929877` created and taxes every task with a feature-scope sweep. Do not
make the step hard-fail the wrap-up: `feature-transition` is a soft shell by design
(`wrapup-pipeline.yaml:32`); report the gate result and let the operator decide, exactly as the
blocked-sync path does.

#### R2 — sync and its projection converge

**WHERE:** `packages/app/src/services/feature-service.ts` — `refresh({ featureId })` at `:331`,
`syncFeature` at `:514`, `syncAllFeatures` at `:578`. Callers: `wrapup-pipeline.yaml`
`feature-transition` and `task-pipeline.yaml` `record`, both through
`plugins/sp/scripts/feature-sync-bounded.ts` (`execution-batch.md:306`).

**WHAT:** `syncFeature` reads every linked task's status to derive the feature status, then writes
only the status. The `## Tasks` table it just contradicted is rewritten by a different verb. Have
`syncFeature` call `refresh({ featureId })` for the feature it touched — it already holds the task
edges, so the projection is free at that point and cannot drift from the status it was derived from.

**Decide first, in `### Q&A`:** service-level (`syncFeature` refreshes) versus caller-level
(`feature-sync-bounded.ts` calls both). Service-level is preferred — it closes the invariant for
every caller including a bare `spur feature sync`, which is how A3's table went stale. Caller-level
leaves the same trap for the next caller.

**Anti-patterns:** Do not call `refresh()` with no `featureId` from inside `syncFeature` — that is
R5's bug and would rewrite every feature on every sync. Do not reach for `syncAllFeatures` +
global refresh as the fix; the bug is missing convergence, not missing breadth.

**Recurrence note:** filed as P4 against feature F81 on 2026-07-27
(`docs/dogfood/2026-07-27-sp-dev-verifyall-feature-F81-…-dogfood.md`) and not acted on. A fix that
leaves the two verbs independently callable without convergence will produce a third occurrence.

#### R3 — the hollow-Testing finding

**WHERE:** emit site `packages/app/src/services/task-record.ts:191`; check site
`packages/app/src/services/task-check.ts` beside the existing section checks; code registry
`packages/config/src/finding-codes.ts`.

**WHAT:** match the stub row `record` writes — `| — | — | No requirements recorded; verify verdict
<V> |` — in the `## Testing` body. Match the row shape, not the prose: an author who writes "no
requirements recorded" in a sentence must not trip it.

**Severity is the hard part.** The corpus holds tasks in this shape today. Under the two-sided
ratchet a new **error** obliges reconciling every occurrence in the same commit (constitution T10);
a **warning** lands in the warning baseline. Land it as a **warning**, reconcile the baseline in the
same commit, and record in `### Q&A` what promotion to error would require — this is the
RC-1 precedent from feature F91 (land as warning, promote after migration).

**Anti-patterns:** Do not re-author the historical tasks the sweep surfaces — baseline them. Do not
make this a `--strict-core` `testing → done` gate layer; F91 § Out of scope explicitly excludes
changes to those layers, and this finding is a corpus-sweep concern.

#### R4 — change-map anchor drift

**WHERE:** `packages/app/src/services/task-check.ts` — `checkLineAnchors` at `:1235`, already
covering `['Testing','Solution']` at `:1237`; subject-match finding at `:1319`; token extraction at
`:349-366`.

**WHAT:** existence and line-bounds pass for a drifted anchor whose file still has that many lines.
Subject-matching is the content check, and it cannot fire on a `### Solution` change-map row that is
a bare table cell holding only the path — there are no subject tokens to match. 0620 cited
`apps/cli/src/commands/workflow.ts:744` (symbol now at `:759`) and the gate was silent; 0591's
prose-bearing row with the identical drift reported twice.

**Approach:** when a Solution-section anchor row yields no subject tokens, derive the subject from
the row's own path — the basename's identifier tokens (`mermaid-render` → `mermaid`, `render`) — and
match those against the cited lines. That reuses the existing token pipeline rather than adding a
second matcher.

**Anti-patterns:** Do not extend this to the `cmd_*.md` underscore false-positive — it has a landed
authoring mitigation (`inline-pipeline-driver.md`) and its blast radius is unmeasured; measuring it
is its own task. Do not resolve drift by dropping line numbers from change maps: the anchor is the
reviewable artifact.

#### R5 — two feature-surface precision fixes

**WHERE:** `apps/cli/src/commands/feature.ts` `refresh` registration; `feature-service.ts:331`;
`packages/app/src/services/feature-check.ts:562-573` (the `entries.some((f) => f.includes(featureId))`
match at `:566`).

**WHAT (a):** `feature refresh` with no `--feature` rewrites every feature's `## Tasks` table. During
the A3 verify run this silently modified D3, D5, D6 and E5 — all correct rewrites, all outside the
caller's intent. Make the broad sweep explicit (an `--all` flag, or require one of `--feature`/`--all`).
This is a public CLI surface change: **ADR-051 consent gate applies** — present the options and get
operator consent before landing.

**WHAT (b):** `f.includes(featureId)` matches `A3` anywhere in a filename. Anchor the match to a
filename segment (the id delimited by `-`, `.`, or string boundary) so an unrelated report cannot
clear another feature's gate.

**Anti-patterns:** Do not change which features arm the dogfood requirement, or the requirement
itself — only how a filename is matched against it. Do not land (a) without consent; the surface
governance record is `docs/design/harness-surface-governance.md`.

#### Cross-task

Depends on nothing. Does not touch **0623** (CLI-surface parity SSOT + agy mapper) or **0624**
(history schema and importers) — no shared file. R3's new finding code and R4's widened
subject-matching both change corpus-sweep output, so land them **before** any batch that would
otherwise absorb their fallout into an unrelated baseline reconciliation.
### Plan
- [ ] Add a `featureGateCmd` var (default `bun run spur-check-new`) to `config/workflows/wrapup-pipeline.yaml` and run it in the `feature-transition` step after an applied sync, reporting the result without hard-failing the soft shell (R1)
- [ ] Have `syncFeature` call `refresh({ featureId })` for the feature it touched, so status and the `## Tasks` projection cannot disagree; assert convergence for a bare `spur feature sync` as well as the pipeline callers (R2)
- [ ] Register `L4.testing-verdict-stub` in `finding-codes.ts` and match the `record` stub row shape (not prose) in the `## Testing` body from `task-check.ts`; land at warning severity (R3)
- [ ] Reconcile the warning baseline for every pre-existing occurrence in the same commit and record in `### Q&A` what promoting to error would require (R3)
- [ ] In `checkLineAnchors`, derive subject tokens from the row's own path basename when a `Solution` change-map row yields none, reusing the existing token pipeline (R4)
- [ ] Make the bare `spur feature refresh` sweep explicit (`--all`, or require one of `--feature`/`--all`) — present the surface options and obtain ADR-051 operator consent before landing (R5)
- [ ] Anchor the `L4.dogfood-missing` filename match to a delimited id segment instead of a raw substring (R5)
- [ ] Verification: per-requirement tests; re-run `bun run spur-check-new` and record the corpus sweep's new/stale counts before and after in `### Testing` — the bar is measured deltas plus a green two-sided ratchet, not green tests alone
### Root Cause
**One root, five surfaces.** Each finding is a place where a Spur surface reports a lifecycle state
that the tree contradicts, and no gate is positioned to observe the contradiction:

| # | Surface | Reports | Tree says | Why nothing noticed |
| --- | --- | --- | --- | --- |
| R1 | pipeline quality gate | green | `spur-check-new` red | the gate that sees feature findings is not the gate the transition runs |
| R2 | feature `## Tasks` table | 9× `todo` | 9× `done` | status and its projection are separate verbs; only one is called |
| R3 | task `## Testing` | `Verdict: UNKNOWN` | verdict artifact `PASS` | presence-checking passes a stub; no content check exists |
| R4 | `### Solution` change map | `workflow.ts:744` | symbol at `:759` | bounds pass; subject-matching has no tokens on a bare row |
| R5 | `L4.dogfood-missing` | satisfied | any filename containing `A3` | substring match stands in for identity |

**Not a common code path** — five different modules. The commonality is a *design habit*: each
surface derives a projection once and never re-checks it, and the gate that could re-check sits
somewhere the write path does not run. R1 is the load-bearing fix; R3 and R4 give that gate more to
see.

**Observation, not a requirement — one writer per working tree.** During the 2026-08-21 A3 verify
run, `packages/app/src/services/task-service.ts` and its test changed under an active session
between two of its own `git status` reads, landing as `79593c0a`; two later commits (`0e247f03`,
`4c3bf737`) absorbed that session's uncommitted work before it could stage anything. The change was
benign and relevant, but the failure mode `CLAUDE.md` § Conventions warns about — a silent overwrite
read as a model regression — was live throughout. Recorded because it is evidence the rule needs a
mechanical guard rather than prose; no mechanism is proposed here, and inventing one without
measuring the frequency would be speculative.
### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Source dogfood reports (gitignored, local-only — `.gitignore:177`): `docs/dogfood/2026-08-21-sp-dev-run-0622-auto-next-dogfood.md` · `docs/dogfood/2026-08-21-sp-dev-run-0622-auto-next-agent-inline-dogfood.md` · `docs/dogfood/2026-08-21-A3-harness-surface-governance-batch-dogfood.md` · `docs/dogfood/2026-08-21-A3-sp-dev-verify-feature-A3-auto-next-force-focus-all-fix-all-dogfood.md`
- Recurrence precedent (R2): `docs/dogfood/2026-07-27-sp-dev-verifyall-feature-F81-auto-next-force-focus-all-fix-all-dogfood.md` § Findings P4 — the identical stale-Tasks-table finding, 2026-07-27, not acted on.
- Siblings, no overlap: task **0623** (CLI-surface parity SSOT + agy mapper — owns F9) · task **0624** (history data-plane residue — owns F6/F8/F10/F12/F14).
- Closed-by-others: `649bbaf7` (0622 executor routing, lifecycle terminals, inline provenance — closes both 0622 dogfood findings) · `79593c0a` (record preserves authored Testing on UNKNOWN) · `77702bb2` (canonical section order).
- Features: **F91** corpus gate integrity (RC-1 is R4's parent defect; R3 follows its warning-first landing pattern) · **F82** / **F821** feature status feedback loop (R2's and R5(a)'s surface).
- Gate split rationale (R1): commit `4b929877`, 2026-08-09 — `spur-check` vs `spur-check-new`; the corpus sweep costs ~41 s against a ~72 s gate. Recorded in `CLAUDE.md` § Verification gate.
- Surface governance (R5a): `docs/design/harness-surface-governance.md` · **ADR-051** amended 2026-08-20 (consent gate covers observable output changes of existing verbs).
- Corpus ratchet obligation (R3): `docs/99_PROJECT_CONSTITUTION.md` **T10** — adding or tightening a finding code obliges reconciling the fallout in the same commit.
- Anchors verified 2026-08-21: `plugins/sp/skills/spur-dev/references/execution-workflow.md:49` · `config/workflows/wrapup-pipeline.yaml:140-163` · `packages/app/src/services/feature-service.ts:331` / `:514` · `packages/app/src/services/task-record.ts:191` · `packages/app/src/services/task-check.ts:1235` / `:1237` / `:1319` · `packages/app/src/services/feature-check.ts:552` / `:566`.
### History
