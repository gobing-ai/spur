---
kind: plan
title: Harness script consolidation and exception retirement
status: draft
created_at: 2026-10-11
updated_at: 2026-10-11
related: [A91, ADR-130, ADR-129, ADR-065, ADR-021, ADR-051]
tags: [brainstorm, architecture, scripts, simplification]
needs_design: true
run_id: idea-script-boundaries-20261011
---

# Harness script consolidation and exception retirement

## 1. Objective and outcome

Make Spur the implementation owner of reusable harness behavior, including its own development.
Keep host/skill adapters small without turning every repository utility into a public command.
This is the successor review of [A9's migration](A9-script-placement-migration.md), not a replay of it.
The operator requested these boundaries in the 2026-10-11 `sp-dev-idea --auto` invocation.
Feature A91 owns the migration; this planning run stops before implementation.

## 2. Premises and dependencies

- ADR-130 already puts noun behavior in `packages/app`; ADR-021 makes the CLI a thin transport.
- A9 moved residual scanning, quality gates, history anatomy, inline setup and step profiles to app services.
  Their generated plugin bundles share source but can still execute application behavior outside the installed CLI.
- ADR-129 deliberately keeps capture available without the monorepo. Preserve that runtime property while moving
  capture implementations out of hook entry files into plugin lib.
- Public changes include flags, observable output and hidden commands, not just new nouns. This plan approves no
  such change. `--auto` approves planning recommendations only. Before implementation needs a public change,
  present its exact owning noun, inputs, output, errors, callers, compatibility and rejected existing alternatives.
- Superskill's installed help says `hook run <plugin> <hook-id>` runs registered hooks and `script run
  <plugin> <script-id>` runs non-hook scripts. Preserve that separation; `script path` is a supported resolver.
- Repository build, bundle, package, release and contract tests are legitimate self-development utilities.
  Their location alone is not a defect. `spur-dev.ts` is a dispatcher, not a second application service layer.
- The application gate currently has SQLite busy retries, but no host-wide gate-lock acquisition was found.
  Stale lock instructions remain in the plugin skills and test preload comments. Do not conflate those retries,
  corpus create locks or commit protection with the removed gate lock.

### Alternatives

| Approach | Benefits | Costs | Confidence |
| --- | --- | --- | --- |
| Tighten ADR-130 and consolidate in measured slices (chosen) | Preserves existing owners; removes duplicate rules and runtime paths | Requires caller and installed-plugin checks for each slice | High, supported by current service and manifest inventory |
| Promote every script to a CLI verb | One invocation scheme | Bloats public surface with repository fixtures, builds and host protocols | High confidence this violates the requested scope |
| Relocate everything into plugin lib | Small-looking entry files | Hides the same application behavior and DB access behind a folder move | High confidence this fails the ownership goal |

### Design Summary

Classify by responsibility before path. Reusable task/feature/workflow/history/self behavior belongs in application
services; reuse an existing CLI contract when available. Plugin scripts translate skill inputs and invoke those
contracts. Hook entries translate host events; immediate local guard and session-capture cores may remain in plugin
lib when an extra process would defeat their latency or no-CLI behavior. Repository tooling stays in scripts only
when its contract depends on this repository's build, fixtures or release policy. Tests and fixtures follow their
implementation owner. Generated bundles are packaging exceptions, never a license for a parallel persistence owner.
No new noun is justified by the audited files.

Self-review: no placeholders, contradictory owners or unapproved public changes. Design is required because the
policy crosses app, plugin, repository and generated-install boundaries. `--auto` selects the chosen approach.

## 3. Findings and migration proposals

### P1 — Hook entries contain helpers and tests

`plugins/sp/hooks/hooks.json` registers task-write-guard, context-post-tool, context-session-start,
context-session-stop, agent-lifecycle and fleet-guest-stop. `careful-guard` is a conditional guard entry;
`pi/guard-extension.ts` is a Pi extension entry, not a JSON hook. Preserve both supported entry mechanisms.
`agent-hint`, `context-owner`, `destructive-policy` and `task-file-policy` are helper modules: move to lib.
Move hook and Pi tests to `plugins/sp/tests/hooks` and update test discovery/imports. Extract ledger/session
cores from context hooks to lib, retain hook wrappers and redaction, bounded I/O, owner identity and failure policy.
One registered hook identity has one authored entry; one entry may serve several events. Do not duplicate
agent-lifecycle once per SessionStart/UserPromptSubmit/Notification/Stop configuration occurrence.

### P2 — Plugin lib can hide domain ownership violations

`plugins/sp/lib/run-summary-core.ts` explicitly describes moving logic into lib to meet the entry LOC budget.
Its actor/window aggregation belongs with workflow/history measurement in app; host transcript normalization may
remain an adapter. `transcript.ts` needs the same split. Extend placement review to lib so shortening a wrapper
cannot make application logic disappear from the review. A line count is a review trigger, not an architecture test.

### P3 — Task and feature behavior remains in plugin scripts

`batch-preflight.ts` owns status/dependency/section decisions and feature-finding classification; move reusable
readiness decisions into existing task/feature checking services and keep only planner presentation in the plugin.
`task-diffstat.ts` mixes git collection with safety-lane policy: collection is adapter work, route policy belongs to
the workflow/task owner. `feature-verification-steps.ts` orchestrates receipt writes and directly obtains a DB/DAO
through the inline bundle; centralize the entire receipt operation in app, preserving before/after fingerprints,
safe argv execution, PASS/FAIL and artifact ownership. `wrapup-steps.ts` should retain its git/gh flow while delegating
feature sync and lifecycle choices. Do not create `spur task feature-*`: the feature owner is `spur feature`.

### P4 — Workflow setup and packaging carry a second execution path

`inline-run-setup.ts`, `inline-run-dispatch.ts`, `idea-handoff.ts`, `batch-plan.ts`, `persist-out-check.ts`,
`quality-gate.ts`, `residual-scan.ts`, `workflow-step-profile.ts` and `history-anatomy-cache.ts` already have
different degrees of app extraction. Consolidate on existing app services rather than rewriting them.
Retain host-inline model execution, run identity, project-root binding and trace/close semantics.
Inspect each generated entry in `bundle-plugin-lib.ts`; eliminate app DB and DAO exposure to plugin entrypoints.
Use existing engine/action and CLI contracts first. If a missing CLI operation is necessary, stop its implementation
at a concrete consent brief; do not invent an internal hidden command or use an imported bundle to evade consent.
Until cutover, retain the working bundle as a named migration exception with compatibility tests.

### P5 — Some repository tools mix general analytics with repository policy

`real-run-cost.ts` uses general run/action/history queries but pins `.spur/spur.db` and `config/workflows` to this
checkout. Move the reusable query/aggregation into workflow/history app services; keep repository cohort selection
and baseline comparisons local. `workflow-promotion.ts` and `pipeline-budgets.ts` encode Spur release/candidate policy:
keep that policy in scripts, reuse the measurement service. `eval-pipeline.ts`, `fleet-e2e.ts`, history latency/freeze
checks and run-storage census remain repo measurement/proof tools. No generic public command is earned by their names.
`release.ts` is already a three-line forwarding module to the same builder implementation. Prefer migrating internal
callers to existing `spur builder` calls and deleting obsolete aliases only after a caller sweep; no new builder verb.

### P6 — Evals are useful but located in a shipped-surface source tree

`plugins/sp/evals/run-eval.ts` is called by root `package.json` (`eval`); `judge.test.ts` exercises recorded fixtures.
`bundle-plugins.ts` explicitly excludes evals, and `skill-structure.test.ts` requires their present layout.
This is live repository tooling, not dead code. Move the runner to `scripts/commands/skill-eval.ts`, judge/tests to
`plugins/sp/tests/evals`, and scenario/recorded fixture data under that test owner. Preserve `bun run eval` and the
free fixture tier. Live evaluation stays opt-in and outside default checks. Refine runner errors: missing agent may
skip, malformed/missing requested fixtures and real execution failures must be distinguishable from unavailable
agents. Update README, test discovery, package references, dispatch-surface documentation and packaging assertions.
Delete `plugins/sp/evals` only after all live references migrate. No `spur eval` noun is proposed.

### P7 — Skill helpers are not all shared and not all application logic

`daily-summary.ts` has a direct dynamic SQLite query for history health: use the history application owner, retain
git/ccusage collection and report composition as skill adapters. Its `logger.ts` exposes an unused file-channel
option and is a library under scripts: inline the tiny console behavior or move a genuinely reused helper to lib;
do not create a logging framework. Dogfood report grammar and pipeline-driving detection remain skill-owned;
extract pure helpers to lib and keep only executable entries in scripts. Preserve validation and refusal behavior.
`pr-reviewing.ts` is a substantial sp-owned git/gh loop, not evidence of a missing Spur noun: retain unless a measured
duplication can be removed. `commit-guard.ts` protects foreign changes; preserve it while removing obsolete lock prose.

### P8 — Executable config and graduated prototype need disposition

`config/proportional-route-table.ts` exports evaluators used only by two app tests. Move it into
`packages/app/tests/fixtures/proportional-route-table.ts`; do not add a production routing engine. Update both
test imports. Config keeps declarative data only.
`docs/analysis/2026-10-plan-projection-prototype.ts` is explicitly a rough prototype, while current plan projection
lives in `packages/app/src/workflow/plan-projection.ts`. Compare assertions and callers; preserve its historical
Markdown record and remove executable prototype only if current tests cover its still-valid claims.
Generated `.mjs` and `.d.mts` artifacts are outputs, not separately authored implementations; regenerate them after
each owning move. Preserve historical task/report citations rather than rewriting history to make path searches green.

## 4. Execution sequence

1. Policy enforcement: use the ADR-130 amendment and governance §2; add minimal layout/import tests for hooks,
   scripts and lib to the existing placement checker. Test the strict hook-layout helper in 1173, activate it
   after relocation in 1174. Do not grow a second registry or baseline.
2. Hook normalization: helpers/cores → lib, tests → tests/hooks, installed entry validation including Pi.
3. Evals relocation: keep deterministic and live tiers and root eval contract; remove stale layout assertions.
4. Task/feature consolidation: readiness, routing policy, feature receipts and wrapup ownership; consent before
   any unavailable CLI contract is implemented.
5. Workflow execution consolidation: existing app runners, trace, handoff and persistence; retire bundled runtime
   exceptions only with a proven installed path and explicit surface consent where necessary.
6. Analytics consolidation: workflow/history measurement, summary core, daily-summary DB read; keep repo policy local.
7. Skill and legacy cleanup: dogfood helpers, logger, graduated config/prototype, redundant builder aliases and
   stale gate-lock text; preserve git safety and actual DB busy retries.

Tasks run sequentially in this tree. Hook/eval work may be independent in isolated worktrees later, but no parallel
execution is authorized by this planning run. No implementation runs as part of `dev-idea`.

## 5. Risks and verification

- Installed plugins have no monorepo. Prove supported hook/script invocation from an isolated install with Node/Bun
  as declared, and never replace one source import with a different unbundled workspace import.
- CLI/plugin skew: refuse unsupported contracts visibly; do not silently fall back to a bundled database writer.
- Core behavior: test redaction and hook owner binding, readiness status/dependencies, receipts/fingerprints,
  workflow trace/close, null-versus-zero measurement and eval error distinctions.
- Per slice update callers, tests, fixtures, exports, config manifests, generated twins/bundles, skills and docs
  together. Run focused workspace tests, placement/standalone checks and plugin smoke for plugin runtime changes.
- Use task-local `spur-check` during implementation and one feature-wide gate at completion. This planning run
  checks its feature/task records and document scope; it does not certify runtime changes that have not been made.
- No database migration or data deletion is needed by the plan. Preserve run/evidence storage and historical records.

## 6. Follow-up and approval boundary

Next work is the task batch under A91. Public surface candidates belong to task, feature, workflow or history;
self owns local harness operations, projects owns the registry, builder owns release operations. Each candidate
must first show why an existing contract cannot do the job. No generic `dev`, `scripts`, `plugin` or `eval` noun.
Existing A9 consent for unexercised profile/anatomy flags does not approve a different contract in this migration.

### Capability routing and public-contract proposals

| Capability | Existing owner/contract to reuse first | Remaining proposal requiring explicit consent |
| --- | --- | --- |
| Task validation and readiness | `spur task show`, `task check --precheck`; existing checking services | Extend the existing check result with operation-specific admission only if callers cannot derive it from current output. Specify run/refine/verify semantics and compatibility before adding a flag |
| Feature sync and verification | `spur feature sync`; `spur workflow run feature-verification.yaml` and the existing receipt service | No new verify noun/verb by default. Keep receipt orchestration inside the workflow/app operation; any additional feature transport must first show why this workflow contract is insufficient |
| Inline begin/action/close and artifact registration | Current inline app runners, workflow persistence/action writer and artifact action | An installed CLI transport for host-inline lifecycle is a real gap. Design it under `workflow`, with safe run IDs, owning project, action payload, definition binding and failure semantics; no subprocess model execution and no hidden bypass. Exact verb/flag shape remains unapproved |
| Multi-run measurement and summaries | Existing workflow progress, step-profile/history projections and app measurement | Prefer an aggregate mode on an existing workflow reporting contract over a new reporting noun. Preserve cohort filters, unknown values and provenance. Name exact flags/JSON only after comparing current projections |
| History health and anatomy | Existing history services/reporting and anatomy service | Replace the daily-summary DB read with the existing projection if sufficient; otherwise propose the minimal history report extension, with the precise health fields and errors |
| Local harness operations, project registry and release | `spur self`, `spur projects`, `spur builder bump-ver`/`drop-tags` | No new surface identified. Keep repository build/bundle/eval policy local and call existing builder operations where useful |

These are capability proposals, not invented available commands or approval records. The refinement deliverable
for each gap is a concrete consent brief plus executable compatibility expectations, before an implementation task
can expand that public contract. Reuse is the default recommendation.

### Created task handoff

| WBS | Slice | Planning readiness |
| --- | --- | --- |
| 1173 | Enforcement and proven legacy cleanup | Ready; downstream implementation still runs its normal gates |
| 1174 | Hook entries/helpers/tests | Ready after 1173 |
| 1175 | Eval relocation | Ready after 1173 |
| 1176 | Task/feature policy and receipts | Refined ready; high-level app operation via existing packaging; after 1173 |
| 1177 | Inline workflow runtime consolidation | Refined ready; shared loader and reduced exports; after 1176 |
| 1178 | Workflow/history analytics | Refined ready; domain queries/app measurement via existing packaging; after 1177 |

Dependencies are recorded through `spur task deps`; feature roster is refreshed through the CLI.
Planning verification: feature/requirement inventory check PASS, all six task structural checks PASS,
current `sp-script-placement` rule has zero findings, and `git diff --check` passes. Warnings about unverified
feature scenarios are expected: implementation and PASS verdicts belong to the future task runs. The current
placement check does not yet implement the stricter accepted policy; task 1173 owns that enforcement change.
The initial idea handoff left 1176–1178 unready pending contract refinement. The subsequent
`sp-dev-refineall --feature A91 --auto --depth ready` audit closed those designs without expanding the public CLI:
1176 extracts pure admission/triage and a high-level receipt runner; 1177 shares existing entry resolution and
removes the exposed DB/DAO facade; 1178 moves reusable queries to domain and measurement to app. Existing
generated entries retain the named standalone packaging exception. An eventual owning-noun CLI transport
remains operator-owned, separately approved work, outside this implementation batch.

All six remain `todo`; downstream dependency warnings mean prerequisites must execute first. The batch
refines specifications only and starts no task implementation. No commit is created without `--worktree`.

## 7. Ready-depth refinement report — 2026-10-11

Frozen membership/order: 1173, 1174, 1175, 1176, 1177, 1178; default stop-on-failure, no failures or skips.
All seven checklist IDs were audited against source, callers and test seams; structural PASS alone was not used
as semantic readiness evidence. Scratch captures and machine-readable checklist/source/task digests are under
`.spur/run/refineall-A91-20261011/` (gitignored; this record and CLI-owned task sections are the durable handoff).
No wip tasks or additional worktrees existed at kickoff; implementers recheck conflicts before editing.

| Task | Outcome | Corrections | Status | Remaining advisory |
| --- | --- | ---: | --- | --- |
| 1173 | refined | 5 | todo → todo | none |
| 1174 | refined | 4 | todo → todo | prerequisite 1173 pending |
| 1175 | refined | 4 | todo → todo | prerequisite 1173 pending |
| 1176 | refined | 6 | todo → todo | prerequisite 1173 pending |
| 1177 | refined | 4 | todo → todo | prerequisite 1176 pending |
| 1178 | refined | 5 | todo → todo | prerequisite 1177 pending |

28 recorded premise/design corrections. Existing priority/estimate metadata is preserved. Dependencies are
1173 → {1174,1175,1176}, 1176 → 1177 → 1178. Removed artificial eval prerequisite and redundant transitive edges.

Key decisions: preserve executable dogfood adapters, the opt-in careful guard and Pi extension; move only their
helpers/tests. Keep live eval tooling with explicit FAIL versus unavailable-agent SKIPPED behavior. Preserve
root builder alias names but route to existing builder commands. Keep pure Node bundles separate from Bun/SQLite.
Missing measurements remain unavailable, and query-specific cohort predicates retain their existing semantics.

The checklist evidence below points to each task's frozen sections. “PASS” is planning readiness, not implemented
requirements or a verification verdict. Each Background records dated corrections and each References section
contains checked current-tree premise anchors.

| Task | Checklist ID | Pass | Evidence |
| --- | --- | --- | --- |


| [1173](../tasks5/1173_enforce-script-ownership-and-retire-proven-legacy-scaffoldin.md) | requirements | PASS | Requirements: observable slice, compatibility constraints and explicit non-goals |
| [1173](../tasks5/1173_enforce-script-ownership-and-retire-proven-legacy-scaffoldin.md) | design | PASS | Design: named owner/modules, internal seams, existing packaging and no new public API |
| [1173](../tasks5/1173_enforce-script-ownership-and-retire-proven-legacy-scaffoldin.md) | plan | PASS | Plan: ordered R-linked changes, caller/output updates and focused verification |
| [1173](../tasks5/1173_enforce-script-ownership-and-retire-proven-legacy-scaffoldin.md) | ac | PASS | Acceptance Criteria: feature scenario titles, requirement links and executable fixture/test lens |
| [1173](../tasks5/1173_enforce-script-ownership-and-retire-proven-legacy-scaffoldin.md) | decisions | PASS | Q&A: closed choices; operator owns separately deferred public transport |
| [1173](../tasks5/1173_enforce-script-ownership-and-retire-proven-legacy-scaffoldin.md) | dependencies | PASS | Design and CLI dependencies: upstream contract and downstream handoff |
| [1173](../tasks5/1173_enforce-script-ownership-and-retire-proven-legacy-scaffoldin.md) | premises | PASS | Background corrections and References: current source/caller/test anchors; environment/conflict scope |
| [1174](../tasks5/1174_normalize-hook-entries-helpers-and-tests-without-changing-ho.md) | requirements | PASS | Requirements: observable slice, compatibility constraints and explicit non-goals |
| [1174](../tasks5/1174_normalize-hook-entries-helpers-and-tests-without-changing-ho.md) | design | PASS | Design: named owner/modules, internal seams, existing packaging and no new public API |
| [1174](../tasks5/1174_normalize-hook-entries-helpers-and-tests-without-changing-ho.md) | plan | PASS | Plan: ordered R-linked changes, caller/output updates and focused verification |
| [1174](../tasks5/1174_normalize-hook-entries-helpers-and-tests-without-changing-ho.md) | ac | PASS | Acceptance Criteria: feature scenario titles, requirement links and executable fixture/test lens |
| [1174](../tasks5/1174_normalize-hook-entries-helpers-and-tests-without-changing-ho.md) | decisions | PASS | Q&A: closed choices; operator owns separately deferred public transport |
| [1174](../tasks5/1174_normalize-hook-entries-helpers-and-tests-without-changing-ho.md) | dependencies | PASS | Design and CLI dependencies: upstream contract and downstream handoff |
| [1174](../tasks5/1174_normalize-hook-entries-helpers-and-tests-without-changing-ho.md) | premises | PASS | Background corrections and References: current source/caller/test anchors; environment/conflict scope |
| [1175](../tasks5/1175_relocate-behavioral-evaluation-tooling-and-preserve-both-eva.md) | requirements | PASS | Requirements: observable slice, compatibility constraints and explicit non-goals |
| [1175](../tasks5/1175_relocate-behavioral-evaluation-tooling-and-preserve-both-eva.md) | design | PASS | Design: named owner/modules, internal seams, existing packaging and no new public API |
| [1175](../tasks5/1175_relocate-behavioral-evaluation-tooling-and-preserve-both-eva.md) | plan | PASS | Plan: ordered R-linked changes, caller/output updates and focused verification |
| [1175](../tasks5/1175_relocate-behavioral-evaluation-tooling-and-preserve-both-eva.md) | ac | PASS | Acceptance Criteria: feature scenario titles, requirement links and executable fixture/test lens |
| [1175](../tasks5/1175_relocate-behavioral-evaluation-tooling-and-preserve-both-eva.md) | decisions | PASS | Q&A: closed choices; operator owns separately deferred public transport |
| [1175](../tasks5/1175_relocate-behavioral-evaluation-tooling-and-preserve-both-eva.md) | dependencies | PASS | Design and CLI dependencies: upstream contract and downstream handoff |
| [1175](../tasks5/1175_relocate-behavioral-evaluation-tooling-and-preserve-both-eva.md) | premises | PASS | Background corrections and References: current source/caller/test anchors; environment/conflict scope |
| [1176](../tasks5/1176_centralize-task-readiness-triage-and-feature-receipt-operati.md) | requirements | PASS | Requirements: observable slice, compatibility constraints and explicit non-goals |
| [1176](../tasks5/1176_centralize-task-readiness-triage-and-feature-receipt-operati.md) | design | PASS | Design: named owner/modules, internal seams, existing packaging and no new public API |
| [1176](../tasks5/1176_centralize-task-readiness-triage-and-feature-receipt-operati.md) | plan | PASS | Plan: ordered R-linked changes, caller/output updates and focused verification |
| [1176](../tasks5/1176_centralize-task-readiness-triage-and-feature-receipt-operati.md) | ac | PASS | Acceptance Criteria: feature scenario titles, requirement links and executable fixture/test lens |
| [1176](../tasks5/1176_centralize-task-readiness-triage-and-feature-receipt-operati.md) | decisions | PASS | Q&A: closed choices; operator owns separately deferred public transport |
| [1176](../tasks5/1176_centralize-task-readiness-triage-and-feature-receipt-operati.md) | dependencies | PASS | Design and CLI dependencies: upstream contract and downstream handoff |
| [1176](../tasks5/1176_centralize-task-readiness-triage-and-feature-receipt-operati.md) | premises | PASS | Background corrections and References: current source/caller/test anchors; environment/conflict scope |
| [1177](../tasks5/1177_consolidate-inline-workflow-adapters-on-the-application-runt.md) | requirements | PASS | Requirements: observable slice, compatibility constraints and explicit non-goals |
| [1177](../tasks5/1177_consolidate-inline-workflow-adapters-on-the-application-runt.md) | design | PASS | Design: named owner/modules, internal seams, existing packaging and no new public API |
| [1177](../tasks5/1177_consolidate-inline-workflow-adapters-on-the-application-runt.md) | plan | PASS | Plan: ordered R-linked changes, caller/output updates and focused verification |
| [1177](../tasks5/1177_consolidate-inline-workflow-adapters-on-the-application-runt.md) | ac | PASS | Acceptance Criteria: feature scenario titles, requirement links and executable fixture/test lens |
| [1177](../tasks5/1177_consolidate-inline-workflow-adapters-on-the-application-runt.md) | decisions | PASS | Q&A: closed choices; operator owns separately deferred public transport |
| [1177](../tasks5/1177_consolidate-inline-workflow-adapters-on-the-application-runt.md) | dependencies | PASS | Design and CLI dependencies: upstream contract and downstream handoff |
| [1177](../tasks5/1177_consolidate-inline-workflow-adapters-on-the-application-runt.md) | premises | PASS | Background corrections and References: current source/caller/test anchors; environment/conflict scope |
| [1178](../tasks5/1178_unify-workflow-and-history-measurements-used-by-repo-and-ski.md) | requirements | PASS | Requirements: observable slice, compatibility constraints and explicit non-goals |
| [1178](../tasks5/1178_unify-workflow-and-history-measurements-used-by-repo-and-ski.md) | design | PASS | Design: named owner/modules, internal seams, existing packaging and no new public API |
| [1178](../tasks5/1178_unify-workflow-and-history-measurements-used-by-repo-and-ski.md) | plan | PASS | Plan: ordered R-linked changes, caller/output updates and focused verification |
| [1178](../tasks5/1178_unify-workflow-and-history-measurements-used-by-repo-and-ski.md) | ac | PASS | Acceptance Criteria: feature scenario titles, requirement links and executable fixture/test lens |
| [1178](../tasks5/1178_unify-workflow-and-history-measurements-used-by-repo-and-ski.md) | decisions | PASS | Q&A: closed choices; operator owns separately deferred public transport |
| [1178](../tasks5/1178_unify-workflow-and-history-measurements-used-by-repo-and-ski.md) | dependencies | PASS | Design and CLI dependencies: upstream contract and downstream handoff |
| [1178](../tasks5/1178_unify-workflow-and-history-measurements-used-by-repo-and-ski.md) | premises | PASS | Background corrections and References: current source/caller/test anchors; environment/conflict scope |

The appendix below inventories the requested non-test TypeScript scope. It is a classification inventory with
targeted semantic reads of the findings above, not a claim that every branch of every utility was runtime-tested.

## Appendix — complete non-test TypeScript inventory

77 source files, 21,246 source lines; generated twins and declarations are excluded by the TypeScript suffix filter. Hook/eval tests were separately inspected for relocation.

| Current source | Lines | Disposition |
| --- | ---: | --- |
| `config/proportional-route-table.ts` | 155 | P8: test-only fixture to packages/app/tests/fixtures |
| `docs/analysis/2026-10-plan-projection-prototype.ts` | 580 | P8: compare graduated app tests; preserve Markdown history |
| `plugins/sp/evals/judge.ts` | 27 | P6: runner to scripts/commands; judge/scenarios to plugin tests |
| `plugins/sp/evals/run-eval.ts` | 94 | P6: runner to scripts/commands; judge/scenarios to plugin tests |
| `plugins/sp/evals/scenarios.ts` | 68 | P6: runner to scripts/commands; judge/scenarios to plugin tests |
| `plugins/sp/hooks/agent-hint.ts` | 61 | P1: helper to plugin lib; all imports/tests migrate |
| `plugins/sp/hooks/agent-lifecycle.ts` | 155 | P1: retain registered/host entry; core to lib; tests to plugin tests |
| `plugins/sp/hooks/careful-guard.ts` | 74 | P1: retain registered/host entry; core to lib; tests to plugin tests |
| `plugins/sp/hooks/context-owner.ts` | 56 | P1: helper to plugin lib; all imports/tests migrate |
| `plugins/sp/hooks/context-post-tool.ts` | 448 | P1: retain registered/host entry; core to lib; tests to plugin tests |
| `plugins/sp/hooks/context-session-start.ts` | 227 | P1: retain registered/host entry; core to lib; tests to plugin tests |
| `plugins/sp/hooks/context-session-stop.ts` | 205 | P1: retain registered/host entry; core to lib; tests to plugin tests |
| `plugins/sp/hooks/destructive-policy.ts` | 146 | P1: helper to plugin lib; all imports/tests migrate |
| `plugins/sp/hooks/fleet-guest-stop.ts` | 180 | P1: retain registered/host entry; core to lib; tests to plugin tests |
| `plugins/sp/hooks/pi/guard-extension.ts` | 303 | P1: retain registered/host entry; core to lib; tests to plugin tests |
| `plugins/sp/hooks/task-file-policy.ts` | 31 | P1: helper to plugin lib; all imports/tests migrate |
| `plugins/sp/hooks/task-write-guard.ts` | 89 | P1: retain registered/host entry; core to lib; tests to plugin tests |
| `plugins/sp/lib/env.ts` | 46 | Keep plugin adapter helper; standalone dependency checks |
| `plugins/sp/lib/inline-run-app.ts` | 28 | Keep plugin adapter helper; standalone dependency checks |
| `plugins/sp/lib/run-summary-core.ts` | 561 | P2/P5: app aggregation; retain host parsing only when justified |
| `plugins/sp/lib/spur-bin.ts` | 36 | Keep plugin adapter helper; standalone dependency checks |
| `plugins/sp/lib/transcript.ts` | 303 | P2/P5: app aggregation; retain host parsing only when justified |
| `plugins/sp/scripts/batch-plan.ts` | 145 | P4: reuse app service; thin installed adapter; retire bundled persistence |
| `plugins/sp/scripts/batch-preflight.ts` | 530 | P3: task/feature/workflow policy to app; retain host/git glue |
| `plugins/sp/scripts/commit-guard.ts` | 249 | P7: retain skill/git owner; extract helpers; history DB query to app |
| `plugins/sp/scripts/daily-summary/daily-summary.ts` | 848 | P7: retain skill/git owner; extract helpers; history DB query to app |
| `plugins/sp/scripts/daily-summary/logger.ts` | 28 | P7: retain skill/git owner; extract helpers; history DB query to app |
| `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts` | 368 | P7: retain skill/git owner; extract helpers; history DB query to app |
| `plugins/sp/scripts/dogfood-testing/validate-report.ts` | 364 | P7: retain skill/git owner; extract helpers; history DB query to app |
| `plugins/sp/scripts/feature-verification-steps.ts` | 288 | P3: task/feature/workflow policy to app; retain host/git glue |
| `plugins/sp/scripts/history-anatomy-cache.ts` | 247 | P4: reuse app service; thin installed adapter; retire bundled persistence |
| `plugins/sp/scripts/idea-handoff.ts` | 47 | P4: reuse app service; thin installed adapter; retire bundled persistence |
| `plugins/sp/scripts/inline-run-dispatch.ts` | 135 | P4: reuse app service; thin installed adapter; retire bundled persistence |
| `plugins/sp/scripts/inline-run-setup.ts` | 218 | P4: reuse app service; thin installed adapter; retire bundled persistence |
| `plugins/sp/scripts/persist-out-check.ts` | 240 | P4: reuse app service; thin installed adapter; retire bundled persistence |
| `plugins/sp/scripts/pr-reviewing.ts` | 952 | P7: retain skill/git owner; extract helpers; history DB query to app |
| `plugins/sp/scripts/quality-gate.ts` | 80 | P4: reuse app service; thin installed adapter; retire bundled persistence |
| `plugins/sp/scripts/residual-scan.ts` | 247 | P4: reuse app service; thin installed adapter; retire bundled persistence |
| `plugins/sp/scripts/run-summary.ts` | 105 | P2/P5: workflow/history app measurement with host adapter |
| `plugins/sp/scripts/script-root.ts` | 199 | P4: reuse app service; thin installed adapter; retire bundled persistence |
| `plugins/sp/scripts/session-timeline.ts` | 190 | P2/P5: workflow/history app measurement with host adapter |
| `plugins/sp/scripts/task-diffstat.ts` | 250 | P3: task/feature/workflow policy to app; retain host/git glue |
| `plugins/sp/scripts/workflow-step-profile.ts` | 165 | P4: reuse app service; thin installed adapter; retire bundled persistence |
| `plugins/sp/scripts/wrapup-drift-probe.ts` | 261 | P4: reuse app service; thin installed adapter; retire bundled persistence |
| `plugins/sp/scripts/wrapup-steps.ts` | 891 | P3: task/feature/workflow policy to app; retain host/git glue |
| `scripts/commands/build-binaries.ts` | 85 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/build-cli.ts` | 126 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/build-server.ts` | 10 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/bundle-config.ts` | 104 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/bundle-plugin-lib.ts` | 885 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/bundle-plugins.ts` | 60 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/bundle-web.ts` | 166 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/check-marketplace-version.ts` | 78 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/dependency-drift-check.ts` | 162 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/dev-all.ts` | 49 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/emit-board-types.ts` | 106 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/eval-pipeline.ts` | 695 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/fleet-e2e.ts` | 1403 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/history-latency-measure.ts` | 183 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/history-surface-freeze-check.ts` | 185 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/importer-schema-check.ts` | 98 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/inline-pipeline-parity-check.ts` | 298 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/link-check.ts` | 133 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/pipeline-budgets.ts` | 290 | P5: app measurement; keep repo cohort/promotion policy |
| `scripts/commands/plugin-install-smoke.ts` | 120 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/publish.ts` | 113 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/real-run-cost.ts` | 570 | P5: app measurement; keep repo cohort/promotion policy |
| `scripts/commands/release.ts` | 3 | P5: existing builder forwarder; retire aliases after caller sweep |
| `scripts/commands/run-storage-census.ts` | 61 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/script-contract-check.ts` | 680 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/surface-drift-inventory.ts` | 894 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/transition-shim-check.ts` | 241 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/validate-commands.ts` | 689 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/validate-flag-contracts.ts` | 890 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/verify-pack.ts` | 100 | Keep repo tooling; reuse app services for general queries |
| `scripts/commands/workflow-promotion.ts` | 704 | P5: app measurement; keep repo cohort/promotion policy |
| `scripts/spur-dev.ts` | 145 | Keep repository dispatcher; no domain implementation |
