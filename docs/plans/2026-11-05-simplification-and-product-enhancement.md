---
kind: plan
title: Spur simplification and product enhancement plan
status: approved
created_at: 2026-11-05
updated_at: 2026-11-05
related:
  - docs/reports/2026-11-05-codebase-review.md
  - docs/reports/2026-11-05-codebase-review-inventory.json
  - docs/01_PRD.md
  - docs/02_ROADMAP.md
tags: [proposal, planning, workflow]
---

# Spur simplification and product enhancement plan

## 1. Outcome and preservation contract

Make Spur the default harness Robin reaches for in every project by making its existing daily loop
easy to adopt, reliable to run, and easy to recover. Reduce implementation and maintenance cost as
part of shipping that loop. The [review](../reports/2026-11-05-codebase-review.md) supplies evidence;
its R/C identifiers below refer to defects and structural candidates, respectively.

Preserve existing successful CLI/JSON behavior, command names, configuration precedence, task/feature
history, lifecycle guards, proof freshness, execution independence, redaction, database migration
history, cancellation/ownership fencing, plugin standalone installation, accessibility, and local-first
operation. Any exception needs a specific compatibility decision. “Almost the same” is not permission
to silently drop these invariants.

Keep Bun/TypeScript, the current workspace layers, Hono/oRPC, Markdown authority, SQLite, Superskill's
installation boundary, and the released shared engines. The available evidence does not justify a
rewrite, a new orchestration framework, another database, or another extension substrate.

Robin approved this plan and requested its conversion into feature updates and implementation tasks
on 2026-11-05. The approved follow-ups are captured through Spur under existing owners and new child
features; prior scenarios and completed task evidence remain intact. The [corpus handoff](../reports/2026-11-05-simplification-corpus-handoff.md)
records the exact mapping, dependencies and conditional scheduling. New public verbs, dependencies,
deployments, or broader scope still require the existing project consent/design process.

## 2. Success measures

Measure outcomes before setting release promises. Establish repeatable fixtures for a fresh project,
a multi-folder corpus, a paused/failed run, an ordinary Board session, and a large history dataset.
Record tool versions, platform, data size, command, elapsed time, and artifacts for each measurement.

| Measure | Baseline from this review | Proposed acceptance target |
| --- | --- | --- |
| Implementation size | 188,960 physical lines; category details in inventory | For each consolidation, remove the replaced path and show net implementation/support delta. Target 10–15% net reduction across the selected areas after all waves; this is a stretch goal, never grounds for deleting behavior. |
| Reliable core loop | Reproduced incomplete reads, stale folder response and lost search hits | Zero failures across the explicit regression scenarios in §4, repeated from a clean fixture |
| Gate credibility | Real-renderer security proof is outside normal discovery | The standard test entrypoint runs every named critical journey and fails if its child proof is absent |
| Fresh-project adoption | Bun/Make discovery exists; other setups need manual bindings | First successful check on each selected non-Bun fixture within five operator actions; record time rather than promise it |
| Board read churn | No request-count baseline captured | Record a 60-second idle/event-burst trace; one shared planning stream, no overlapping identical query, no stale update; improve requests versus baseline |
| Recovery | Run APIs/TraceTab/records already exist | Given one failed and one paused fixture, reach evidence and a valid recovery action from the task/run in at most two navigation steps |
| Economics | Existing history, usage and workflow measurements | Show measured cost per verified completion with explicit unknowns and reproducible attribution |

Do not turn every metric into a new mandatory repository gate. Use the existing evidence/run/report
mechanisms; add enforcement only for a concrete regression the project needs to prevent.

## 3. Strategy and sequence

Work in two tightly coupled tracks within each package: remove duplicated mechanisms and ship one
observable improvement. Keep at most two packages in implementation at once, with one writer per
tree. If parallel work is later requested, use isolated worktrees and the existing batch machinery.

| Wave | Packages | Simplification delivered | User-visible improvement | Exit |
| --- | --- | --- | --- | --- |
| 0 — trust | W0, W1, W2 | Restore missing proof, make read failures explicit, own query freshness | Sync works; tasks do not disappear silently; changing folders is dependable; search errors are honest | Reproductions become regression tests and pass; existing gates remain intact |
| 1 — daily adoption | W3, W4 | One corpus projection and one Board transport/query path | Readiness/blockers view and practical cross-stack onboarding | Fresh fixtures complete the same loop through CLI and Board |
| 2 — execution economy | W5, W6 | One dispatch policy path, reuse run/cost evidence | Consistent recovery and useful cost/outcome feedback | Host/fleet/subprocess preservation matrix passes; one failed/paused-run recovery proof |
| 3 — selective cleanup | W7, W8 | Remove verified duplicate analytics/schema/test machinery | Faster explainable analytics and lower maintenance | Golden outputs and migration compatibility preserved; measured benefit exceeds complexity |

Wave 0 should precede broad additions. W4 can begin after the trust fixes without waiting for a
large dispatch refactor. W7/W8 are optional follow-ups selected by measurements, not prerequisites
for making the product useful. Estimates below are rough focused engineer-days, not elapsed deadlines.

## 4. Concrete work packages

### W0 — repair small Board behavior and restore critical test discovery

Priority: first. Size: 1–2 days. Candidate owners: F8/F84, C3; inspect current tasks before filing.

Targets: FeatureDetail, existing feature action/client/server tests, Markdown safety test wrapper.
Address R2, R3, R6. Default sync to pull and disable push while leaving its server refusal intact.
Restore the isolated real-renderer test invocation using the existing member-terminal wrapper pattern.
For dependency skipping, first confirm the intended queued-runner behavior; either forward controlled
state or remove an unsupported UI promise. Do not silently introduce a bypass.

Failure cases to specify before implementation: default dispatch sends push; unavailable push remains
selectable; successful pull is reported as failure/no refresh; checkbox cannot change; metadata is
not forwarded; a wrapper collects zero tests; a renderer child fails while its parent passes.

Acceptance: rendered sync journey sends pull, preserves the current feature body/draft, reloads state,
and displays success; unavailable options are identified. Normal root tests run the 12 existing
real-renderer proofs and detect child failure. Server push behavior and existing guard denial remain.
The bounded sync fix may be completed during review; it does not imply W0 as a whole is complete.

### W1 — make corpus completeness explicit, then reuse parsed inputs

Priority: P1. Size: 3–5 days. Dependencies: none. Candidate owners: F/F2/F21/F8.

Targets: TaskLocator, TaskQueryOps, FeatureService.collectTasksByFeature, planning-check-base,
TaskCheckService/FeatureCheckService consumers and Board read DTOs. Address R1 and C2.

First separate not-present from failed reads. Add an internal operation-scoped result containing
parsed task/feature records, by-ID/feature/dependency maps, and diagnostics. Reuse existing parsers and
TaskLocator. Build it once per operation; do not add a persistent cache or database authority. A
mutation invalidates the current snapshot. Lifecycle derivation requires complete relevant inputs;
tolerant read views must visibly disclose incomplete results. Keep writes inside PlanningWriteService.

Alternative: patch each catch separately. This is smaller initially but preserves divergent scans;
use it only as an immediate containment fix, then consolidate callers with proven equivalent behavior.
A persistent filesystem index is deferred until a measured workload justifies invalidation complexity.

Acceptance: missing optional folder is tolerated; EACCES/ENOTDIR/I/O/invalid frontmatter produce
actionable diagnostics; an unreadable todo task cannot make a feature appear fully complete; duplicate
WBS and cross-folder dependencies remain visible; aliases still normalize. Run CLI and Board against
the same multi-folder fixture. Record read/parse counts and elapsed time without changing accepted state.

Docs: planning-record/command contracts and affected architecture mechanism. An internal helper
alone needs no new ADR; changed read DTOs require their owning contract update.

### W2 — fix request ownership and bounded search behavior

Priority: P2. Size: 2–3 days. Candidate owners: F7/F8 and A34. Split these independent fixes into
separate implementation tasks. Address R4/R5/R10 before a query-library decision.

TaskStore: reuse the generation-token pattern already in FeatureDetail. A response may commit only
if it owns the current generation and data source. Include stale error handling and unmount ownership;
then coalesce event bursts without suppressing eventual refresh. Avoid a new generic state framework.

Search: preserve null for a skipped/failed fuzzy group in auto mode instead of converting it into
an empty successful group (R10); retain the existing failing CLI assertion and make backend states
deterministic in its fixtures. Propagate the process outcome, including output-limit failure, through SearchDeps. Treat
partial JSON as incomplete output instead of quietly ignoring it. Start with an explicit bounded error;
then use the existing runtime streaming seam to stop after the global result limit if needed. Exact
mode should not wait for optional fuzzy-backend health probes on its critical path unless its public
status response requires them; measure and cache only stable probe facts if changing this contract.

Acceptance: A→B folder switch with B finishing before A keeps B; stale errors cannot hide B; final
unsubscribe prevents updates; 100 planning events coalesce without losing final data. Two 3 MB matching
source lines yield a bounded explicit error or a real hit, never successful empty output. No-match,
invalid regex, timeout, missing rg, missing/stale zg index, and fuzzy degradation remain distinct.

### W3 — one Board data path, plus an actionable readiness view

Priority: next. Size: 4–6 days. Dependencies: W1/W2. Candidate owners: F7/F8/G63/J.

Targets: feature-client, plan-client, design-client, oRPC contracts/router, TaskStore/FeaturesShell,
planning SSE subscription, existing task/feature detail and shell surfaces. Address C3/C4.

Migrate one procedure family at a time to the installed oRPC client. Define missing DTOs at the
contracts boundary rather than recopying server interfaces in React. Retain runtime input/output
validation and domain-error decoding. Share one planning event subscription per Board session and
invalidate only affected query keys. Keep process output, history, and event-ledger streams separate
when they have different cursor/retention contracts.

Recommendation: correctness first using existing stores; then a bounded TanStack Query pilot for
tasks/features if a dependency is approved. The pilot must delete custom fetching/cache/refetch/error
state and have a net reduction after its adapter code. If it merely wraps TaskStore, reject it.

Deliver a readiness panel in existing task/feature surfaces: ready tasks, exact blocking dependencies,
incomplete-input warnings, paused work and the next existing action. Reuse existing next-router/
feature-prioritization skills for qualitative advice; deterministic readiness must not require a model.

Acceptance: identical errors and results through Board and CLI; one planning stream; generation-safe
navigation; actionable empty/degraded states; keyboard access retained; no foreground model/network
dependency for readiness. Record requests, bundle delta, code delta and an end-to-end readiness journey.

### W4 — make existing stack-neutral actions practical across projects

Priority: high product return. Size: 3–5 days. Dependencies: W0; independent of W5.
Candidate owners: A1/A92 (completed owners require an approved follow-up boundary).

Targets: init detection/scaffold, builder.actions resolver, config schema/loader, self exec inspection,
init templates, existing project settings. The mechanism already exists; improve configuration quality.

For Robin's actual project sample, detect available manifest scripts/lockfiles and propose bindings
for npm/pnpm, Cargo, Go, and Python workflows. Prefer declared scripts/Make targets over assumed
framework commands. Resolve conflicting lockfiles explicitly. Generate reviewable builder.actions
with preset none, provenance, working directory and unbound actions; never execute a detected command
or overwrite configured actions during discovery. Support one package root and one representative
monorepo before adding elaborate profile inheritance.

Acceptance fixtures: Bun, npm/pnpm, Cargo, Go, Python, Make, mixed monorepo, missing tool, conflicting
lockfiles, existing custom actions, and a repository with no build/test script. Config preview is
repeatable and idempotent; only declared supported actions execute. First successful check is possible
without copying Spur's own Bun-specific gate scripts into other projects.

Docs: sdlc-actions and init contracts/templates; PRD only if scope membership changes. No new public
noun is needed. An optional new flag still requires its normal contract design, not assumption here.

### W5 — unify dispatch policy while improving recovery

Priority: high after trust fixes. Size: 5–8 days. Dependencies: W0/W2.
Candidate owners: B1/D3/D65/G (choose the existing nonterminal owner with matching scope).

Targets: AgentRunActionRunner, existing host/fleet dispatch methods, capability/independence/budget
helpers, AgentService/runner adapter, receipt and workflow resume paths. Address C1.

Build one normalized invocation from declared inputs. Run common admission and freshness checks,
dispatch through the existing host/fleet/subprocess functions, then apply common result/contract/
usage/partial-work finalization. Preserve surface-specific pause and fencing behavior explicitly.
Use small private functions or existing collaborators; do not introduce a strategy registry or public
executor SDK. Delete duplicated checks only after proving parity across their former branches.

Alternative: move the 2,293 lines into several files without changing control flow. That helps local
navigation but does not remove repeated policy and is not this package's success criterion. Replacing
the workflow engine is rejected because these are Spur-specific policies above an existing engine.

Expose the resulting failure classification in existing run inspection: admission issue, executor
availability, agent-reported refusal, contract failure, timeout/cancel, or task defect, with evidence
and the next safe existing command. Keep recovery explicit and preserve receipt freshness checks.

Acceptance matrix: host/fleet/subprocess × success/refusal/timeout/cancel/contract failure; stale
answer/expect files; unsupported capabilities; independent reviewer; exhausted budget; resumed host
pause; fleet late response and fallback; sensitive path outside scope. No live agent is required for
every matrix cell; use controlled runner fixtures plus a bounded real-agent dogfood per changed surface.

### W6 — complete evidence navigation and outcome feedback

Priority: product value after W1/W3/W5. Size: 3–5 days. Candidate owners: E71/E72/J/I81.

Reuse RunStoreService, existing `/api/runs` and run-record APIs, TraceTab, task-run links, check
receipts, and workflow measurement/history attribution. Add links among task → run → failed step →
redacted log/artifact → valid recovery action. Show when scratch has expired and which durable evidence
remains. Do not create a second run ledger or store raw prompt/log contents in another location.

Add a small outcome view using existing data: verified completions, failure/rework count, gate duration,
measured agent cost and missing attribution. Attribute cost using run/task links; unknown is an explicit
bucket. Display one row per work item/run with drill-through evidence. Recommendations require a
minimum measured sample and show uncertainty; no opaque autonomous routing policy is introduced.

Acceptance: a paused run and failed run are diagnosable/recoverable using the existing commands; stale
proof cannot be reused; expired scratch does not erase durable provenance; seeded known/unknown cost
fixtures reconcile to their totals; no secret output appears in the view or exported proof.

### W7 — reduce analytics and migration duplication where parity is provable

Priority: conditional. Size: 4–7 days. Dependencies: measurements from W6.
Candidate owners: E5/E/E93 and the existing foundation migration owner.

For analytics, first compare raw/rollup/mart outputs on small fixed fixtures containing duplicate
imports, null/unknown usage, midnight boundaries, model/source/tool/skill filters and stale watermarks.
Use a common measure/selector definition only for identical semantics, and keep SQL readable. Reuse
the existing marts before adding another cache. Benchmark actual 7-day/all-history workloads.

For migrations, get authoritative SQL exports from the owning shared engine or generate embedded
SQL from existing tracked migrations during bundling. Preserve released IDs, checksums, idempotent
column guards, upstream-versus-Spur table ownership, and binary startup without source files. Check
fresh, previous-release, already-migrated, interrupted and duplicate-column fixtures. No real database
is migrated as a review experiment, and no historical migration is squashed.

Acceptance: byte/semantic parity where required; golden output equality; equal or improved measured
latency; smaller handwritten surface. Reject extraction if it adds a generic query-builder framework
or needs more configuration than the SQL it replaces.

### W8 — delete only obsolete scaffolding and make checks easier to maintain

Priority: last. Size: 2–4 days. Candidate owners: A6/A91/C3/I6.

Address R7–R9 and C7 in separate tasks. Test safety classifier executable positions and nested
expansions before replacing matching logic; retain fail-closed behavior for destructive execution.
Use native TOML parsing for threshold diagnostics. Remove/deprecate the unused registry registration
stub after caller review; use existing Board contribution composition for real extensions.

Inventory source-text assertions and global mocks, but retain boundary/standalone/source ownership
tests that express actual architectural contracts. Replace a brittle assertion only after a real
behavior proof exists; eliminate shared mock duplication instead of adding one-off test adapters.
Do not lower coverage thresholds, delete failed tests, or move ordinary tests to an unrun heavy tier.

Acceptance: destructive positive controls still request approval; quoted literal searches are allowed;
TOML inline/table syntax produces the same diagnostics; removed stubs have no callers; normal test
discovery includes every critical proof. Record gate time and maintenance/code delta.

## 5. Library and platform choices

| Choice | Decision | Why / validation condition |
| --- | --- | --- |
| Existing oRPC client/contracts | Use now during W3 | Already installed; replaces hand-authored transport envelopes and wire types. Preserve runtime validation and errors. |
| Bun.TOML | Use for R8 | Native parser already used in run-tests. No dependency needed. [Official documentation](https://bun.com/docs/runtime/toml). |
| TanStack Query | Conditional pilot, no installation in this review | Supplies caching, shared query state and request deduplication; cancellation works when the supplied signal is consumed. It does not replace SSE or automatically fix mutation semantics. Require approval, a compatible pinned version, bundle/code measurements and a rollback. [Overview](https://tanstack.com/query/latest/docs/framework/react/overview), [cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation). |
| Existing Zod | Prefer over new validators when schemas need consolidation | Native JSON Schema export is available; refinements/transforms need explicit representability review. Do not regenerate all published schemas blindly. [Official conversion documentation](https://zod.dev/json-schema). |
| Workflow/agent/database engines | Keep current released facades | Product policies are the duplication target. Replacing working engines with XState/Temporal/an ORM is not justified by this review. Fix reusable facade defects upstream. |
| New shell parsing package | No decision yet | R7 needs quote/substitution handling and a preserved safety matrix. Compare installed tooling first; adding a parser without validating its grammar could weaken the guard. |

External documentation was checked during this review; latest docs are not proof of compatibility
with every pinned local version. Bun 1.4.3 behavior was exercised locally; oRPC is already integrated.
TanStack is a proposal, not an installed or benchmarked solution. Zod conversion must be checked
against installed 4.4.3 if that optional consolidation is scheduled.

## 6. Verification, documentation, and rollout

Before code, write the package's failure cases and executable regression/journey proof. Prefer
fixture-based E2E or cross-layer integration with a saved repeatable artifact; use isolated tests for
policy/format parsers where that gives better failure control. Respect workspace preloads.

Each implementation task runs focused checks, the applicable project gate, and review/verify through
the harness. Record real verification PASS via Spur when its pipeline is used. Feature-wide checks
run once per feature, not once per tiny refactor. Preserve Workers/runtime checks for affected graphs,
CLI relink/bundle checks after CLI changes, and standalone plugin smoke after plugin dependency changes.

Update the owning design satellite for changed contracts, architecture for changed mechanisms, and
ADR only for a lasting boundary/decision. Update PRD/roadmap only when accepting changed scope/phase
commitments; task receipts and this proposal do not justify those edits. Propagate portable init
changes to templates. Do not modify the constitution to authorize ordinary engineering work.

Roll out one vertical slice at a time. Old implementation paths remain only until parity is proven,
then are removed in the same work package. Do not leave indefinite feature flags, duplicate workflows,
or two read/write authorities. Keep compatibility adapters thin and time-bounded with an explicit owner.

## 7. Recommended next action and deliberate deferrals

Start W0 and the R1 containment in W1. Then complete W2 and one non-Bun onboarding fixture from W4.
That first increment improves trust and cross-project adoption without committing to a broad rewrite.
Review measured evidence before expanding W3/W5. W7 is deliberately conditional.

Do not add a hosted control plane, BYOK, sandboxing, a new public command family, another agent IPC
transport, a generic plugin SDK, another scheduler, or model-driven automation to simple deterministic
checks. Do not add speculative configuration knobs. The work above should make existing capabilities
more useful while reducing how much code must change to maintain them.

## 8. Approved corpus handoff — 2026-11-05

The plan is decomposed into tasks 1294–1316 under fifteen feature owners. New children are F22
(complete corpus reads), F73 (Board query convergence/readiness), E94 (measured analytics
simplification), and A331 (offline migration artifact integrity). Existing owners were extended in
place with additional scenario identities; historical scenarios were not renamed or renumbered.

At the initial corpus handoff, eighteen tasks were todo, with dependency edges controlling readiness. Five tasks
(1309–1312 and 1316) are blocked on explicit measurement/decision conditions; their features and
task bodies retain the conditional nature of W7/W8. The CLI created their detailed captures as todo,
so the legal todo-to-blocked transition was used rather than rewriting lifecycle state to backlog.
The feature index and task records remain the current status authority.

No implementation was started during this conversion. Task 1294 explicitly preserves and verifies
the sync fix already present in the review diff. The full work-package/scenario/task map, structural
checks and dependency order are in the [dated handoff](../reports/2026-11-05-simplification-corpus-handoff.md).

## 9. Implementation-ready refinement — 2026-11-05

All 23 task specifications were audited against current source and refined through Spur. The
[ready audit](../reports/2026-11-05-implementation-ready-audit.md) records frozen contracts, corrected
premises, test-first plans, prerequisites and per-task checklist evidence. It supersedes the initial
handoff's scheduling table; the task corpus remains the live authority.

The refined batch has 21 todo tasks and two evidence-blocked implementation tasks: 1310 consumes
1309's current positive analytics decision, and 1312 consumes 1311's current positive migration
decision. The investigations themselves do not depend on outcome UI work. Task 1316 now has a
specific cleanup candidate: the duplicated fetch timeout/cancellation seam. Functional dependency
edges replace broad wave-order barriers; one writer per tree and the recommended trust-first
sequence still apply.

For these slices, use the installed oRPC transport, the existing verified-outcome fold and native
TOML parsing. Remove the inert dependency control and internal registry stub. No new query or shell
parser dependency is selected. Analytics consolidation is bounded to time predicates; migration
generation is bounded to the existing 0037 SQL artifact. Broader alternatives in the original
proposal remain deferred. Ready specifications do not certify implementation or completion.
