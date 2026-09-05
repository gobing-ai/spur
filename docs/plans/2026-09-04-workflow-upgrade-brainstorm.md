---
status: proposed
needs_design: true
run_id: idea-workflow-upgrade-ecdebca8-d159-4bc7-8bac-046e61305333
---

# Remaining workflow upgrade after D8/D9

## Recommendation

Reshape and proceed: make structural checks proportional to the changed inputs, retire broad
suppression snapshots after preserving their useful checks, and finish versioned, visible execution
across all eleven workflows. Reuse the existing workflow engine, planning projection, trace, and
task/feature check services. Do not build another planner or enable D9's dormant fast routes.

This is the discovery proposal for `sp-dev-idea --auto`, not an approved implementation design.
No feature/task corpus or production workflow has been changed by this audit.

## Verified premises

Verified against the source-local CLI and repository on 2026-09-04 (America/Los_Angeles).
Raw command results and timings: `.spur/run/idea-workflow-upgrade-ecdebca8-d159-4bc7-8bac-046e61305333-checks.json`.
Confidence is HIGH for the observed/source-backed facts; expected savings remain hypotheses until
the proposed before/after checks run.

| Premise | Finding | Consequence |
| --- | --- | --- |
| D8/D9 are prerequisites | Both report `done`. D9 selected Option B after the run-cost coverage gate failed; no production caller enables `mode=fast`. | Preserve the closure and its reopening criteria: ≥5 real terminal runs AND ≥80% run-scoped coverage per candidate. |
| `task check --strict-core` is unnecessary | Correct: the CLI describes it as a compatibility alias and only `options.strict` changes severity. Normal and alias checks of 0751 returned identical PASS output. | Remove it from first-party instructions/callers; retain the alias for installed clients. Preserve `--as testing/done`. |
| `feature check --strict` is unnecessary | Only partly correct: it promotes warnings, including unverified scenarios and incomplete completion evidence. D9 passes both, but a green completed feature does not prove the flag is redundant. | Use normal checks for planning. Make essential completion failures explicit at `--as done`, then remove blanket strictness from automatic completion callers. Keep explicit strict audit opt-in. |
| No baseline cleanup exists | Both regeneration scripts already exist. Corpus regeneration removes vanished keys and accepts all observed keys; composition regeneration refreshes facts and drops removed actions. | Fix acceptance semantics instead of adding a second regeneration tool. |
| Baselines only grow | Current corpus snapshot has 299 keys; D9's composition snapshot covers all 11 workflows and 143 actions. A monotonic-growth claim is not established by this snapshot. | Measure surviving/stale/new keys separately; do not treat occurrence counts as unique keys. |
| Workflow version needs a schema addition | D9/0756 already added the optional non-empty opaque string contract in both JSON schemas and an empty-string guard in the shared resolver. All 11 YAML files still omit it. | Finish adoption and identity projection; no second schema/version mechanism. |
| Planning needs a new command | `workflow show <file> --format todo --json` already exists. Human synchronous run startup already previews a plan; the inline driver already instructs host todo integration. | Finish consistency, fidelity, and cross-surface integration under existing verbs. |

Sources: [D9 closure](../features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md),
[task check registration](../../apps/cli/src/commands/task.ts),
[check severity calculation](../../packages/app/src/services/planning-check-base.ts),
[workflow resolver](../../packages/app/src/workflow/workflow-resolver.ts),
[workflow CLI](../../apps/cli/src/commands/workflow.ts).

## Measured cost and verification limits

One sequential, source-local sample; these are elapsed times and UTF-8-compatible ASCII-heavy output
sizes, not statistical benchmarks or model-token measurements.

| Command | Elapsed | Captured output | Result |
| --- | --- | --- | --- |
| `task check 0751 --json` | 452 ms | 164 characters | PASS |
| `task check 0751 --strict-core --json` | 443 ms | 164 characters | PASS, identical payload |
| `feature check D9 --json` | 855 ms | 161 characters | PASS |
| `feature check D9 --strict --json` | 544 ms | 161 characters | PASS |
| `task check --corpus --json` | 39,586 ms | 317 characters | PASS; 828 observations, 299 baseline keys, zero new findings |
| All 11 `workflow validate ... --json` calls | 271–519 ms each | 4,408–42,798 characters each | All valid |

The corpus has 4 error and 824 warning observations. Baseline acceptance is keyed by kind/id/code,
so these are not 828 distinct exceptions. Full workflow definitions dominate validation output:
`idea-pipeline` emits 42,798 characters and `task-pipeline` 40,573. This is an output-selection
problem even where runtime is cheap. Save full evidence once, return a bounded summary and artifact
path to the agent, and expand only failures. Do not claim a token reduction from character counts.

These probes did not execute implementation, publish PRs, or exercise every runtime branch.
Schema PASS is not evidence that a lifecycle transition, retry, or external-review path works.

## Structural checks: proposed disposition

| Check family | Proposed treatment |
| --- | --- |
| Parseable task/feature data, unique IDs, valid references, legal lifecycle transitions | Keep as hard checks at write/transition boundaries; global uniqueness remains a small inventory check. |
| Executable workflow schema, references, bounded retry, proof freshness, verdict/provenance, path confinement | Keep. These protect execution and truthful completion. |
| Formatting, minimum prose length, heading ordering, lexical/line-anchor heuristics | Authoring diagnostics or explicit audit; do not block unrelated implementation or accept into an expanding waiver snapshot. Retain checks that prove a referenced artifact exists where it is required evidence. |
| AC traceability and completion evidence | Validate the affected task/feature and its linked neighbors. At completion, missing/non-PASS/stale required evidence must still deny completion without blanket warning elevation. |
| Repeated task/feature checks in adjacent guards | Evaluate once per input revision/state boundary, then branch on that result. Recompute after relevant writes; never reuse a pre-edit PASS for post-edit completion. |
| Whole-corpus sweep | Remove from routine per-task/batch wrap paths after essential integrity checks have an owner. Keep explicit full diagnostics for audits and checker changes. |
| Lint/type/tests/coverage and boundary rules | Keep applicable checks. Deduplicate overlapping invocation chains by their actual inputs; do not label executable quality checks “courtesy.” |
| Rule presets with `--fail-on warning` | Inventory every included rule by behavioral consequence. Keep real boundary/type/security failures; move document-style warnings out of automatic blocking presets. |
| Skill checklists and mandatory check-before-every-section-write guidance | Use CLI write validation and one affected-input check after a logical update. Remove obsolete strict/core and two-sided corpus instructions from their canonical owners, then reinstall adapters through Superskill. |

Specific duplicated/stale sources include `idea-pipeline` calling feature check in several sibling
guards; `wayfinder-resolution` repeating task show/check in precheck, collect, evidence-length
guards, record, and done; and `spur-dev/references/gate-checklists.md` prescribing strict planning
and a two-sided corpus gate contrary to current source. `spur-check` already includes lint, rules,
tests and other gates: invoking those again unchanged is not added evidence.

The full-corpus feature filename matcher currently uses `[A-Z][1-9]*`, unlike the duplicate-ID
matcher, and can omit otherwise valid IDs containing `0`. Reuse the canonical feature locator in
the replacement inventory and add a regression case; faster checks must not inherit blind spots.

## Baseline decisions

| Artifact | Decision and migration |
| --- | --- |
| `config/corpus-baseline.json` | Target retirement from routine gating. First classify its 299 keys, preserve essential unsuppressible checks, repair essential active findings, and move legacy document diagnostics to explicit audit. Remove the file/reader/regenerator when no retained essential exception needs it. |
| Corpus regenerator during transition | Extend the existing script with a read-only delta/prune path. Pruning may remove only vanished keys; new acceptance must select explicit keys with reason/owner/review/removal metadata. Stage and verify before replacement. Its current writer reconstructs `{note, entries}`, dropping D9's `waiver` and `generated_at`; its claimed exact round-trip also does not compare the second sweep's key set for equality. Fix both if the script survives the first migration. |
| `config/workflow-composition-baseline.json` | Retire exact prompt/command mirroring. It duplicates 143 actions and carries zero dispositions. Replace useful expectations with small behavioral tests; derive inventory and model-bearing definitions from live YAML. Migrate consumers before deletion. |
| Composition consumers | `pipeline-budgets.ts`, `eval-pipeline.ts`, `real-run-cost.ts`, composition advisory, proof-chain tests, and composition-entrypoint checks must stop assuming the snapshot exists. Preserve measured-budget semantics and definition-digest helpers; other code imports those helpers from the same module. |
| Composition regenerator while retained | Existing refresh is adequate for factual pruning, but it writes the target before its final check. Use a staged replacement if retained. Never automatically re-approve a disposition merely because the same indexed action key survives changed content. |
| `packages/app/tests/fixtures/json-raw-baseline.json` | Keep: this is a JSON compatibility fixture consumed by `json-envelope-adoption.test.ts`, not a waiver. Renaming/deleting by filename pattern would remove useful behavior coverage. |
| `apps/cli/config/*baseline*` | Generated bundle assets, not separate authorities. Rebuild through `build:bundle`; ensure removed canonical assets disappear from output and package contents. |

No new exception framework or permanent cleanup daemon. If no essential waiver survives
classification, delete the corpus snapshot and regenerator instead of implementing their proposed
temporary lifecycle improvements. ADR-090/092/093 and constitution T10 must be reconciled before
changing the enforced policy; updating derived prose alone would recreate drift.

## All eleven workflows

Retain and upgrade all eleven for this requested batch. `basic` remains an explicitly labeled
example; no speculative deletion based solely on absent measured runs. Each row requires a quoted
`version: "1"` only when its upgrade and checks complete; subsequent behavioral revisions bump the
literal by convention, without a semantic-version parser. Existing unversioned user workflows work.

| Workflow | Required review/refinement | Runnable acceptance focus |
| --- | --- | --- |
| `basic.yaml` | Identify it as an example. Ready-depth correction: root `check` exists, so retain `bun run check`; fix compound trusted command execution through the existing `sh -c` pattern. | Green, red→fix→green, exhausted retry, compound command execution. |
| `idea-pipeline.yaml` | One feature check per changed AC/design boundary; shorten repeated prompts; reconcile YAML's batch schema instructions with skill promises of default per-task Design. Preserve meaningful approval, atomic creation, retries, and handoff-only termination. | Auto/taste branches, rejected/revised design, invalid batch, dependency ordering, handoff readiness. |
| `docs-pipeline.yaml` | Consolidate task/doctor probes using existing primitives where behavior matches; scope mutable captures to run+task; trim document formatting ceremony while preserving evidence-backed review. | Missing task, stale answer, changed proof, cancel, successful docs-only run. |
| `feature-dev.yaml` | Reuse an existing feature/AC/task roster instead of always re-brainstorming and replanning; eliminate repeated feature checks. Clarify `requireCleanReview`: current action records request success, not a collected clean review. | Existing feature is not duplicated; children cannot silently fail; REQUESTED/PENDING/FINDINGS are not CLEAN. |
| `feature-lifecycle.yaml` | Keep externally driven single-edge transitions. Replace blanket strict done gate only after essential completion failures are explicit in the application service. | Incomplete/unverified deny done; prose-only warnings do not; rework/reopen work. |
| `task-lifecycle.yaml` | Keep default `task check --as <target>` and one edge per `(from,to)` pair. Clean stale comments; do not repeat D9's rejected sibling-edge pilot. | Testing/done target projection, verdict guard, reopen/cancel, missing evidence. |
| `history-anatomy.yaml` | Preserve cache hit bypass and atomic publication. Replace purely presentation-oriented report gates with minimum parser/evidence requirements; retain independent claim verification and bounded correction. | Cache hit avoids model work; invalid evidence cannot publish; correction exhausts; outputs remain readable by actual consumers. |
| `pr-review.yaml` | Retain head-pinned deduplication, publishing hygiene, pending semantics and bounded waits. Reuse the existing script for repeated status/JSON extraction; keep only helpful visible stage boundaries. | Already reviewed/requested, current-HEAD match, timeout→pending, genuine failure→failed; use mocked external operations. |
| `wayfinder-resolution.yaml` | Remove line/word-count proof proxies and self-validation after preflight. Ready-depth correction: `### Testing` is already the correct task heading; replace repeated scraping with canonical evidence access. Use a current-run verdict accepted by normal task completion, not a standalone PASS word alone. | Short valid evidence passes; long hollow evidence fails; no stale verdict; research-only boundary and done provenance. |
| `wrapup-pipeline.yaml` | Replace whole-corpus transition sweep with affected-feature integrity check. Distinguish advisory diagnostics from failed required synchronization; current gate can print FAIL then exit 0. Scope learning captures per run and make malformed task arrays fail instead of reading as empty. | Empty versus invalid input, orphan tasks, failed sync, repeat-run isolation, explicit skip reason. |
| `task-pipeline.yaml` | Migrate last. Deduplicate structural checks/log dumps and shared retry handling without changing the certified input set. Preserve the full quality→review→verify proof chain and independent-review floor. Keep `mode` default empty. | Changed input invalidates prior proof; stale/missing verdict denies done; full quality failure cannot enter review; bounded fix retries. |

These rows distinguish static findings from runtime hypotheses: all definitions validated, but the
proposed branch tests and adversarial fixtures remain implementation work. Shell length and raw
prompt advisories alone do not justify extracting a new helper: the current 35 shell and 12 prompt
advisories are candidates for inspection, not 47 mandatory refactors.

## Design Summary

Use a single validated/resolved definition for plan, execution, and resume identity. The existing
`resolveWorkflowDefinition` returns path, layer, workflow and digest; `show` currently bypasses it
and loads independently. Route `show` through that seam, add identity to the existing projection,
and propagate the same version/digest into run/trace metadata. Avoid a registry or another engine.

Layer 1 is a human-readable declared state inventory with descriptions and markers. Layer 2 shows
only the active state's useful actions. The current arrow-joined preview implies a linear route
through alternatives and failure terminals; change it to an honest inventory with conditional and
loop markers. A plan is not a prediction: never execute shell guards, models, doctor probes or other
side effects to produce it. Branches unresolved before execution stay unresolved.

Native todo integration belongs to the host adapter: use the built-in todo tool when available,
otherwise emit a Markdown checklist at state boundaries. This session exposes no native todo tool,
so an adapter fallback is necessary. Do not invent tool calls. Use existing traces/progress projection
to reconcile visits and retries; skipped branches are not completed work, failed/pending/cancelled
are not PASS. Resume reads recorded identity and rejects mismatched definitions per D9.

Extend existing `show`, `run`, `trace` and `list` behavior only as needed: identity, descriptions,
compact summaries and consistent plan availability for inline/sync/async. Preserve machine stdout
contracts and quiet/silent/no-plan semantics. Async can expose a plan artifact with the run ID;
it does not need a fabricated host todo API. Public changes are reviewed in the design package.

No persistent validation cache initially. A workflow state captures one deterministic check result
and sibling guards reuse it. The write/transition service remains authoritative for completion.
Any later cross-stage reuse must include task/feature content, linked evidence, target state,
checker/config revision, and relevant definition identity; otherwise rerun the cheap check.

## Alternatives and scores

| Approach | Benefit | Cost/risk | Confidence |
| --- | --- | --- | --- |
| A — Remove flags and all baselines immediately | Small initial patch | Drops actual completion/identity checks and breaks snapshot consumers; no behavior migration | HIGH that this is unsafe as a blanket change |
| B — Essential checks, retire duplication, finish existing plan surfaces (recommended) | Removes routine sweep/acceptance churn while preserving verified outcomes | Requires targeted checker-policy and consumer migration | HIGH feasibility; MEDIUM savings until measured |
| C — New policy DSL, version registry and validation cache | Broad configurability | Adds another maintenance/control plane before evidence justifies it | HIGH that it exceeds current need |

Urgency: **4/5** — repeated ceremony is a demonstrated workflow tax, with a 39.6-second sweep.
Necessity: **4/5** — the useful primitives already exist, but incomplete integration and unreliable
acceptance semantics obstruct the user's cost and observability goals.

Pros: fewer repeated subprocesses and prompt tokens; visible plan/progress identity; all workflows
have an accountable upgrade outcome. Cons: changing completion severity has real semantic impact;
snapshot consumers and portable skills must migrate together; realized savings need measurement.

## Proposed implementation sequence

These are bounded work packages for later CLI-created tasks, not allocated WBS identifiers.
Each package includes its own tests and same-change documentation. Avoid one task per scenario.

| Package | Deliverable | Depends on |
| --- | --- | --- |
| P1 | Gate-policy ADR/design and checker migration: essential completion errors, affected-input checks, strict-core caller cleanup, explicit audit posture, canonical ID lookup. | Approved idea/design |
| P2 | Corpus baseline retirement or minimal transitional pruning; remove routine whole-corpus callers; reconcile T10 and all acceptance readers. | P1 |
| P3 | Remove composition mirroring after migrating budgets, evaluation, inventory, advisory and digest consumers to existing live-definition owners and behavioral checks. | P1 |
| P4 | Shared plan/version identity across show/run/list/trace and host todo fallback; compact evidence output; contracts updated together. | P1 |
| P5 | Upgrade idea, docs and wayfinder workflows; consolidate repeated checks and reconcile planning/refinement contracts. | P2, P3, P4 |
| P6 | Upgrade task/feature lifecycle, feature-dev and wrapup; preserve direct transition semantics and make pending/failed outcomes truthful. | P2, P3, P4 |
| P7 | Upgrade basic, history-anatomy and PR-review; retain actual consumer/evidence contracts and use mocked publishing in tests. | P3, P4 |
| P8 | Upgrade task-pipeline last; synchronize canonical skills/templates and generated bundle; complete all-workflow rollout evidence. | P5, P6, P7 |

Execute sequentially with one writer per tree and one commit per task. Estimated task count may
change during formal decomposition based on actual reviewable seams; these eight packages cover
all requested surfaces without creating eleven identical workflow chores plus separate test chores.

## Acceptance and measurement

1. Routine iteration/wrap uses affected inputs and contains no whole-corpus sweep. Explicit audit
   still diagnoses historical findings. New malformed IDs/data and false completion remain blocked.
2. Normal task checks and legacy strict-core alias remain equivalent; essential feature completion
   failures remain hard without blanket promotion of every warning.
3. No new debt can enter a retained waiver file through automatic “regenerate everything.” Pruning
   does not accept new keys, metadata survives, and failed writes preserve the previous file.
4. Exact composition mirrors and their regeneration disappear after consumer migration; the JSON
   compatibility fixture remains. No duplicate authority in generated CLI assets.
5. All eleven upgraded canonical definitions declare a quoted non-empty version. Unversioned
   external definitions remain usable in both dialects. Plan/run/resume agree on the exact digest.
6. Plans are side-effect-free, readable before execution, and honest about conditional routes.
   Progress covers current state, retries, skips, failure, pending and resume without dumping YAML.
7. Each workflow has focused success and relevant failure-path coverage. Lifecycle graphs are tested
   via transition requests, not automatic walks. Dry runs do not count as real verified outcomes.
8. Record before/after subprocess count, repeated-check count, wall time, output characters and
   measured tokens where available. Compare matched inputs and outcomes; no invented token/USD
   values. Keep D9's fast-mode evidence gate closed until its existing requirements actually pass.
9. Run applicable lint/type/tests/rules and build/package checks once per changed input set; preserve
   real task verification PASS. Do not use baseline regeneration to make unrelated failures green.

## Next pipeline state

Discovery is complete; the next state is `idea-eval`. Approve this reshaped scope to create/select a
feature, author AC, prepare the design package and decompose through the normal CLI gates.
`sp-dev-idea --auto` still has a taste gate before feature creation and a design gate before task
creation. Implementation is a later execution pipeline after handoff.

## Approval and corrections — 2026-09-05 UTC

Robin approved this proposal, including its Design Summary and eight-package sequence, then asked
to continue. That is prior approval for the same design in the idea pipeline; elaborating those
implementation contracts does not require approving the same choices again. Feature D61 is a child
of D6, the existing workflow-cost owner; D already has nine direct children.

- **Correction:** feature IDs intentionally match `^[A-Z][1-9]*$` in
  `packages/domain/src/planning/schema.ts`. The zero-excluding corpus matcher is consistent with
  that contract, not a defect. The proposed ID-matcher fix above is withdrawn.
- **Corpus endpoint clarified:** retain `bun run corpus-check` and `task check --corpus` as explicit
  diagnostics over their documented scope. Remove automatic iteration/wrap/ordinary-commit callers;
  essential errors fail, document-quality warnings report without failing, and suppression retires.
  No expansion of historical task-folder scanning is implied.
- **Existing overlap:** task 0723 is done and its doctor-free task-pipeline precheck is implemented.
  P8 consumes its result with no unfinished 0723 prerequisite or duplicate implementation.
- **Batch contract correction:** runtime `taskBatchItemSchema` and the editor JSON schema accept
  `design`, `plan`, and `acceptance_criteria`. The idea YAML's prose says otherwise. Use the executable
  schema, consistent with the invoked skill's default-on Design contract; repair stale prose in P5.
  The active YAML is not edited during this run.
- **Process coverage:** P2 reconciles both constitution T10 (checker-change fallout) and T11
  (ordinary corpus-touch commit sweep), plus AGENTS/templates and canonical skills. Changing wrapup
  alone would leave the automatic commit sweep in place.

## Planning handoff — 2026-09-05 UTC

Feature D61 has twelve acceptance scenarios and eight CLI-created tasks with Design, Plan and AC.
The runtime batch schema and deterministic idea-handoff writer passed; all eight normal task
readiness checks passed. The feature check passes with only expected unverified-scenario warnings.

| Package | WBS | Outcome |
| --- | --- | --- |
| P1 | 0765 | Essential completion policy |
| P2 | 0766 | Explicit corpus audit and suppression retirement |
| P3 | 0767 | Composition mirror retirement; depends on P2 for combined retirement verification |
| P4 | 0768 | Plan identity and readable progress |
| P5 | 0769 | Idea/docs/wayfinder workflows |
| P6 | 0770 | Lifecycle/feature-dev/wrapup workflows |
| P7 | 0771 | Basic/history/PR-review workflows |
| P8 | 0772 | Final task-pipeline, bundle and measured rollout |

Design: `docs/design/essential-workflow-checks.md`. Decision: ADR-108, accepted design, not built.
Next command: `/sp:dev-runall --feature D61 --auto`. No implementation task was executed by this
idea pipeline. Current checks remain in force until their replacement tasks land.
