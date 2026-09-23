# Next-generation Spur workflows — delivery proposal

Date: 2026-09-21. Status: **architecture and eight-task breakdown approved by Robin; registered as D63**.
Approval authorizes this delivery plan and corpus registration; runtime implementation and measured
activation remain subject to the per-slice prerequisites below.
Scope: all ten definitions in `config/workflows`, their CLI/runtime seams, and their plugin callers.
Revision 2026-09-22: 0912 and 0913 are done; 0914 is done. The selected 0912 pilot is inline
trace emission and terminal closure, not a speed route. D63 scenario R4 and task 0917 now separate
that observability result from any later speed candidate. This plan does not take over their owners.

## 1. Recommendation and readiness

Evolve the canonical workflows in place. Make deterministic work cheap, preserve judgment where it
earns its cost, and bind every reused result to the inputs it actually verified. Keep lifecycle state
machines separate from execution; keep batch coordination in its existing host loop. Do not build a
universal workflow, another engine, or permanent `*-v2.yaml` definitions.

We are ready to plan the entire migration and fix demonstrated integration gaps. We are **not yet
ready to enable faster routes across the catalogue**. The completed 0912 baseline selected an
observability pilot but found too little comparable real execution to select a speed change. The
completed 0913 contract makes future evidence attributable. Shipped dispatch/session features are
enabling mechanisms, not proof that each workflow is faster or safe to resume.

The new work differs from D8/D9 and D62: those established routing, tracing, contracts, gate placement,
and promotion mechanisms. This proposal makes their adoption portable, closes remaining result-validity
boundaries, and applies measured changes across the daily-development flows. It does not redo those
features or treat previously deferred fast paths as newly authorized.

### Options considered

| Option | Benefit | Cost / decision |
| --- | --- | --- |
| Stabilize and measure only | Lowest change risk; fixes real correctness/installation gaps | Valid fallback if 0912 finds insufficient evidence; misses later simplification opportunities |
| Evolve existing workflows in bounded slices | Reuses shipped contracts and makes each change reversible | **Recommended**; measurements govern each optimization independently |
| Replace everything with one configurable orchestrator | Superficially uniform execution | Reject: new interpreter/profile complexity, broad migration risk, lost lifecycle boundaries |

## 2. What the current code establishes

These are source observations, not newly measured production outcomes.

| Observation | Evidence | Consequence |
| --- | --- | --- |
| Ten YAML definitions include two externally driven lifecycle machines and one example | [workflow directory](../../config/workflows), [task lifecycle](../../config/workflows/task-lifecycle.yaml), [feature lifecycle](../../config/workflows/feature-lifecycle.yaml) | Do not equate YAML count or missing action rows with redundant workflows |
| Inline setup imports the application service from a repository checkout and explicitly refuses a bundle-only install | [inline-run-setup.ts](../../plugins/sp/scripts/inline-run-setup.ts), [application owner](../../packages/app/src/services/inline-run-setup.ts) | An installed-plugin user cannot use that authoritative inline setup path without the checkout; portability precedes broad adoption |
| Inline action tracing and terminal closure already exist | [inline driver](../../plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md), same setup script's `--action` and `--close` | Reuse these surfaces; do not commission another journal or claim closure is absent |
| Feature verification writes a feature-named PASS file; the lifecycle completion guard reads it without checking a tree/run digest | [feature verification](../../config/workflows/feature-verification.yaml), [feature lifecycle](../../config/workflows/feature-lifecycle.yaml) | Stale-result rejection must be explicit; this is a code-level validity gap, not a claim of an observed false completion |
| Wrapup already combines doc synchronization and learning capture in one model stage | [wrapup pipeline](../../config/workflows/wrapup-pipeline.yaml) | Do not propose that consolidation again; fix its evidence/closure ordering instead |
| Batch execution already freezes membership, orders dependencies, preserves evidence, and reads checkpoints | [batch execution](../../plugins/sp/skills/spur-dev/references/execution-batch.md) | Harden continuation identity and reconciliation; do not add a batch FSM or duplicate ledger |
| History scope normalization is still an `agent.run` stage; analysis/cache/independent validation already exist | [history anatomy](../../config/workflows/history-anatomy.yaml), [cache helper](../../plugins/sp/scripts/history-anatomy-cache.ts) | A declared argument grammar is a concrete deterministic candidate; preserve the fresh analysis/cache boundary |
| PR review already deduplicates by HEAD and supports pending/collect | [PR workflow](../../config/workflows/pr-review.yaml), [review skill](../../plugins/sp/skills/pr-reviewing/SKILL.md) | Keep the specialized external flow; test replay safety rather than inventing polling/deduplication again |
| Promotion has a registry, deadlines and retirement records | [candidate registry](../../config/workflow-candidates.json), [promotion implementation](../../scripts/commands/workflow-promotion.ts) | Extend/reuse the promotion path; analytical projections alone do not prove realized savings |

Read the current source again at implementation time: 0912/0913 and other concurrent work may close
some gaps. Cancel or narrow a proposed slice when its outcome already exists.

## 3. Target architecture and catalogue decisions

The architecture has three existing responsibilities, not three new modules:

1. **Lifecycle:** task and feature status transitions, guarded by valid evidence.
2. **Execution:** canonical task, planning, investigation, closure and specialized pipelines.
3. **Coordination:** existing skills drive one workflow or a frozen batch; application services own
   persistence/resolution/policy; upstream libraries own the engine and runner.

The host-inline and subprocess surfaces share definition resolution, proof and outcome contracts.
They need explicit behavioral conformance, not a false assertion of identical capabilities. Inline
execution remains the interactive default. Engine recovery and evidence-mode DecisionMaker behavior
remain subprocess capabilities unless a separately designed change makes them available inline.

| Current workflow | Proposed disposition | Concrete change / boundary | Slice |
| --- | --- | --- | --- |
| `task-lifecycle` | Retain as status FSM | Preserve canonical statuses and guarded transitions. Do not restore the unsafe one-edge-per-pair proportional pilot | W02, W03 |
| `feature-lifecycle` | Retain as status FSM | Require current verification evidence at completion; rework and changed inputs invalidate it | W02 |
| `feature-verification` | Retain as separate reusable verifier | Replace unbound PASS consumption with a run/input-bound receipt; run after relevant closure edits and reuse only exact valid evidence | W02 |
| `task-pipeline` | Retain; measure after the selected observability pilot | Validate inline action emission and closure against 0912's live target. Change a speed route only if later comparable runs identify a repeated bottleneck and pass a separate candidate gate | W04 |
| `idea-pipeline` | Retain; consolidate adjacent authoring only if demonstrated | Candidate: one model produces coherent feature intent + AC, followed by existing deterministic CLI writes/checks. Keep design decision and preparation/handoff boundaries | W05 |
| `wrapup-pipeline` | Retain; integrate with trustworthy closure | Conditional doc work based on actual changes; idempotent evidence/learning writes; exact post-edit verification ordering. Existing doc-sync/learning model merge stays | W02, W03 |
| `wayfinder-resolution` | Retain research boundary | Preserve research mutation policy, independent verification and operator decision. Reuse shared proof/recovery helpers, not an implementation profile disguised as research | W03 |
| `history-anatomy` | Retain diagnostic boundary | Normalize explicit scope deterministically, adopt declared executor/session capabilities, retain fresh analysis, digest-keyed cache, independent validation and atomic publication | W07 |
| `pr-review` | Retain external boundary | Keep authorized submit separate from local execution and read-only collection; verify interruptions cannot duplicate requests or accept stale HEAD evidence | W03 |
| `decision-routing-example` | Example, not daily production workflow | Prefer moving to an examples location only after loader, package and documentation consumers are checked; otherwise retain with explicit example classification | W08 |

**Merges:** consider feature-intent/AC model authoring inside `idea-pipeline`; do not merge its human
design decision with authoring. Do not merge task and feature lifecycle or local verification with
external PR review. Do not merge research execution into code execution merely because graphs resemble
one another: different mutation and evidence contracts currently justify the separate definition.

**Splits:** split oversized shell logic into existing narrow application/plugin helpers when needed;
do not create another YAML per helper or per phase. Feature verification is already the right split.

**Adds/deletes:** no new production YAML is currently justified. No production deletion has enough
evidence now. Move the example only with compatibility coverage; any later retirement uses the existing
caller/history audit and retirement registry. Historical runs remain readable.

## 4. Faster and smarter behavior in daily use

| Situation | Desired behavior |
| --- | --- |
| Small, well-specified change | Fast admission; minimum relevant context; reuse eligible coder context; run the checks protecting the change; retain independent review and proof-bound verification |
| Uncertain or high-impact change | Safety route, explicit design decisions and broader checks; uncertainty must not be interpreted as low risk |
| Changed spec or tree after a PASS | Reject stale evidence, explain the changed inputs, repeat only the invalidated checks when dependency coverage proves that is sufficient |
| Several related tasks | Freeze membership/dependency order once; share valid feature-level work; resume from reconciled evidence rather than replay completed tasks |
| Independent tasks | Opt-in worktree/fleet execution only when ownership and dependencies prove independence; honor availability and runner capabilities |
| Agent/executor interruption | Use existing ownership-aware recovery where supported; replay only explicitly safe entry actions; return an actionable outcome otherwise |
| Report-only session review or dogfood | Consume 0913's provenance and evidence distinctions; do not introduce mandatory review agents into every run |
| External review still running | Report pending and collect later against the current HEAD; no duplicate request or fabricated clean result |

“Smart” means deterministic admission and evidence reuse first, model judgment second. DecisionMaker is
optional, not a universal router. Human taste/authorization gates retain `decision.mode: never`.
Evidence-mode adoption requires a genuine judgment question, declared trusted producer evidence and
the existing validator constraints; a boolean check belongs in a deterministic guard. This proposal
does not add inline DecisionMaker parity.

Keep executor availability (B6), run-scoped role pins and session policies (B7), capability declarations
(B8), and persistent fleet sessions (G66). Warm context is useful for the same permitted role/task;
it is not permission to share reviewer context with the implementer or reuse a fleet member across
unrelated work without reset. Unknown token measurements remain unknown. No token-to-price subsystem.

## 5. Feature ownership

Registered **one delivery child of D6**, [D63 — Reliable and measured daily-workflow
adoption](../features/D63_reliable-and-measured-daily-workflow-adoption.md). This is a concrete
integration outcome, not a new top-level program.

| Feature | Role in this plan |
| --- | --- |
| D63 | Own the eight adoption slices and the whole-catalogue acceptance contract below |
| D62 | Reuse tracing, contracts, gate placement and promotion; 0912 supplies the current baseline and pilot recommendation |
| I / task 0913 | Supply reliable session-review/dogfood evidence; owned by the other agent, not duplicated |
| I31 / I32 | Reuse the post-delivery roadmap and shipped plugin guidance; update affected consumers as part of each slice |
| B6 / B61, B7, B8 | Availability, session pins and declared capabilities; dependencies by contract, not new reimplementation tasks |
| G66 | Persistent fleet substrate; used only by already-authorized parallel/headless surfaces |
| D3 / tasks 0901–0902 | Reuse engine-owned recovery and CLI resume integration |
| D / tasks 0910–0911 | Reuse optional DecisionMaker policy and validation; preserve explicit participation limits |
| D8 / D9 | Prior strategy and rollout constraints remain binding; no reopening or erasing the failed measurement |
| I8 / I81 | History report/cache ownership; W07 changes orchestration, not analysis semantics |
| P | Keep `implementAgent=auto`, watcher identity/freshness and mutation-classification issues under their existing owner if encountered |
| E6 / J6 | Reuse existing correlation and role-routing attribution; do not introduce pricing or an alternate selector |

### Proposed feature acceptance contract

- **R1 — Installed and source execution preserve authoritative identity:** supported inline and
  subprocess invocations resolve the same selected definition/layer and produce valid run/evidence
  identities; unsupported capabilities fail explicitly rather than silently downgrading.
- **R2 — Completion uses current evidence:** a changed tree/spec/check contract, wrong feature/run,
  missing receipt or failed check cannot satisfy feature completion; unchanged valid evidence can be reused.
- **R3 — Recovery preserves ownership and side effects:** interruption/race/replay tests preserve
  upstream ownership rules, human decisions and external-request identity without false completion.
- **R4 — Task optimization earns promotion:** the 0912 observability pilot is checked against its
  own real-run target. A later speed candidate preserves the safety floor and meets predeclared
  measured benefit/reliability criteria, or is retired by its deadline. Insufficient evidence leaves
  the graph unchanged and makes no speed claim.
- **R5 — Planning preserves intent through handoff:** the optimized idea path retains all requested
  scope, valid AC/design and dependency-bound preparation; ambiguity and human decisions remain explicit.
- **R6 — Batch continuation uses the original authorized set:** unrelated checkpoints, new task-list
  members and stale results cannot silently change or skip the frozen plan.
- **R7 — Diagnostics retain validity with fewer unnecessary model calls:** explicit scope normalization
  is deterministic; cache, independent validation and publication keep their existing guarantees.
- **R8 — Migration preserves users and demonstrates outcomes:** installed/source/override callers remain
  supported, existing runs are handled explicitly, and each changed graph is promoted or retired with
  real evidence and a rollback path.

These scenarios are registered in D63 in Gherkin form through the feature CLI. Each maps to its
corresponding task, with finer task-local regression criteria. Existing D62 acceptance criteria remain
unchanged.

## 6. Dependency-ordered task proposal

W01–W08 are design cross-references, mapped to **tasks 0914–0921** below. The companion
[task batch](2026-09-21-next-generation-spur-workflows.tasks.json) contains Requirements, Design, Plan
and task-local acceptance specifications with `feature_id: D63`. It is the registration input, not a
rerunnable migration: do not batch-create it again. Dependencies were applied through `spur task deps`.

| Slice | Independently reviewable outcome | Depends on | Covers | Estimate |
| --- | --- | --- | --- | --- |
| W01 / 0914 | Installed inline execution uses the authoritative application boundary | Done; reconcile R1 feature-verdict mapping at W08 | R1 | 8h |
| W02 / 0915 | Feature closure and wrapup consume current verification receipts | Ready: private receipt contract and application/plugin seam frozen | R2 | 8h |
| W03 / 0916 | Canonical workflows declare and test safe interruption/replay behavior | 0914, 0915; reuse 0902/0911 | R3 | 6h |
| W04 / 0917 | Validate the 0912 observability pilot; gate any later speed candidate on comparable real runs | 0914, 0915, 0912, 0913; separate pilot and speed decisions | R4 | 8h |
| W05 / 0918 | Simplify idea authoring while preserving the complete planning handoff | Ready: 0914 done; candidate and explicit evidence stop condition frozen | R5 | 8h |
| W06 / 0919 | Bind batch continuation to its frozen plan and verified child results | 0914, 0915 | R6 | 6h |
| W07 / 0920 | Remove model-only argument normalization from history orchestration | Ready: current-digest scope baseline and helper seam frozen; no W04 dependency | R7 | 6h |
| W08 / 0921 | Complete catalogue migration and measured promotion/retirement | 0916–0920, 0912, 0913 | R8 | 6h |

Approximate active engineering effort: **56 hours**, excluding the separately owned 0912/0913 work,
review turnaround, real-run observation windows, upstream fixes and materially expanded scope. These
are planning estimates, not throughput promises. Re-estimate W04 after its live observation window.

Decomposition rationale: whole scope E56 + D8 + L3 + C2 + R2 = 71; separate installation, completion,
recovery, execution, planning, coordination, diagnostics and migration acceptance boundaries justify
the split. Each child has one delivered behavior and one rollback boundary. Do not add a task for
every YAML, command, test suite or documentation edit; those travel with their behavior-owning slice.

### Sequencing and stop conditions

1. **Now:** 0912/0913 and W01 are done. Hand W02's feature-evidence design to a coding agent; its
   correctness premise does not depend on speed measurements.
2. **Foundation:** Finish W02, then W03/W06. Independent slices may use separate worktrees; one writer
   per tree. Do not create parallel agents merely because the DAG permits it.
3. **Pilot:** W04 consumes 0912 and 0913. Check the selected tracing/closure pilot against its
   frozen 2026-10-06 target of at least three real terminal inline runs; reuse any D62/P delivery.
   This pilot makes future speed comparisons possible but does not establish one. A later speed
   candidate needs its own baseline, frozen threshold and expiry. With insufficient evidence,
   keep the safety graph and record the smallest next experiment.
4. **Expansion:** W05 and W07 are ready for just-in-time refinement now; their own baselines and the
   existing D62 promotion process govern activation. Neither needs to wait for W04's task-pipeline
   observation window. A failed pilot is not permission to activate another unmeasured route. W06
   is not gated on model-speed gains.
5. **Closure:** W08 reconciles all ten definitions, every affected caller and remaining candidates.
   Deferred optimizations are explicitly retired/deferred with evidence, not marked implemented.

Task readiness is separate from registration: 0914 is done; 0915, 0918 and 0920 are `todo` with
implement-ready designs; 0916, 0917, 0919 and 0921 remain `blocked` on recorded prerequisites.
The CLI creates populated batch items as `todo` and the current lifecycle has no `todo → backlog`
edge, so dependent tasks use the supported `blocked` state instead of the originally proposed
backlog state. A valid task batch is not execution readiness.

## 7. CLI, skills and implementation boundaries

**No new public CLI noun or verb is justified yet.** Use the existing `workflow validate/run/continue/
clean/cancel/list/show/trace/progress`, task/feature APIs, and installed Superskill capabilities. The
portable inline bridge should first reuse the narrow app service through the existing plugin bundle
pattern ([bundle owner](../../scripts/commands/bundle-plugin-lib.ts)), not expose arbitrary SQL or
copy the engine. W01 must prove that packaging the needed runtime dependencies is feasible. If it is
not, stop that implementation choice and present a concrete, minimal existing-noun API proposal for
operator consent; do not silently invent a public journaling/step API or bundle the entire CLI.

| Owner | Required or conditional work |
| --- | --- |
| `packages/app` | Shared definition identity, inline bridge and receipt validation; reuse current services, resolver and fingerprint implementations |
| `apps/cli` | Thin transport/error/installed-binary coverage only where W01/W02/W03 require it; additive JSON/flag changes need concrete design and surface consent |
| Upstream engine / runner | Existing CAS recovery, action/guard execution, session capabilities; new reusable engine behavior belongs upstream, not a local workaround |
| `sp:spur-dev` + inline/batch references | Update supported capability matrix, actual three-layer resolution, closure ordering and continuation reconciliation |
| `sp:super-planner`, `sp:parallel-execution`, `sp:next-router` | Preserve one frozen batch, per-role ownership, bounded concurrency and status-correct next actions |
| `sp:super-coder`, review/verification skills | Preserve role/session separation, bounded repair and proof-bound outcomes; only edit where the new contract changes callers |
| Planning/decomposition skills and `dev-idea`/`dev-plan` | Consume consolidated authoring artifact, deterministic corpus writes and unchanged design/handoff checks |
| `sp:doc-evolve`, `dev-wrap`/`dev-wrapall` | Apply doc edits before the evidence that certifies their affected inputs; do not duplicate the learning/doc model stage |
| `sp:history-anatomy`, `sp:pr-reviewing`, `sp:wayfinder` | Keep specialized contracts while adopting the shared replay/proof/capability improvements |
| `sp:session-review`, `sp:dogfood-testing`, their two commands | Consume 0913's landed contract; no parallel redesign by this plan |
| `sp:spur-composer`, `sp:spur-doctor`, workflow authoring skills | Preserve propose/apply ownership and use the existing candidate/promotion process |
| Superskill packaging and init templates | Generate adapters; update portable defaults from their owner, test fresh install plus retained project overrides |

No new skill or subagent is planned. Update the existing owners and wrappers only when their behavior
changes. A slash-command rename, user-facing option, receipt schema or workflow relocation requires
its owning design contract and migration coverage within the same slice.

## 8. Evidence and promotion rules

Start from 0912's cohort definition and artifacts; do not produce a competing baseline. Distinguish
inline, explicit subprocess and fleet execution, workflow/source-layer/digest, code versus docs work,
attempts versus logical runs, interrupted/cancelled outcomes, and measurement coverage. Never mix
historical definitions and new candidates into one apparent improvement.

Measure completed-task/run throughput, first-pass completion, machine elapsed time, operator waiting
time separately, model calls and available token usage, repeated checks, contract-repair/full-retry
rates, trace coverage, and stale-evidence/recovery incidents. Cached-token counters and context-size
heuristics retain the distinction established by 0913. Report null/unknown rather than zero.

Before each candidate executes, record one primary benefit metric, a concrete improvement threshold
derived from its baseline, reliability non-regression criteria, cohort exclusions, sample requirements,
owner and deadline. Do not pick the threshold after seeing results or promise an arbitrary universal
percentage. Low-volume workflows may end with “insufficient evidence; keep the safety path.”

ADR-107's existing activation floor remains **at least five real terminal runs and at least 80%
mappedRuns/terminalRuns for the relevant workflow**. That is an eligibility floor, not statistical
proof of faster execution. Replay fixtures prove routing equivalence; static stage-count or analytical
duration projections indicate candidates; only comparable real execution demonstrates realized benefit.
Never shadow-run external writes or corpus mutations against a live project just to obtain a sample.

W04 must use the 0912 frozen target for observability and the current promotion tooling for any
separate graph candidate. Later slices reuse that distinction. Any change requiring an experiment
exception must have an explicit decision; an exception
cannot turn missing measurements into PASS. Candidate expiry results in promotion or deletion from the
candidate set under the existing contract, never a standing alternative production graph.

## 9. Verification, migration and rollback

Each slice carries focused behavioral tests plus its required task-local gate. The feature-scoped
suite runs at the settled-input boundary, once while its receipt remains valid; later relevant changes
invalidate it. “Once per feature” does not mean “once forever despite changed inputs.”

Required scenario matrix:

- Source checkout and bundle-only install; explicit project override, registered configuration, and
  shared installed fallback; selected layer/digest remains visible and consistent.
- Inline versus subprocess supported behavior, fresh/reused roles, unavailable/disabled executors and
  unsupported runner capabilities; intentional differences are asserted, not erased.
- Happy path, missing/malformed/stale evidence, changed dirty tree and spec, failing checks and rework.
- Interrupted entry, concurrent resume claim, paused human decision, replayed deterministic mutation,
  cancellation and external side-effect deduplication.
- Empty/blocked/mixed-result batch, unrelated newer checkpoint, changed task metadata, completed child
  with stale proof, worktree evidence preservation and opt-in parallel ownership.
- History cached/uncached and invalid selectors; PR pending/stale/current HEAD; research mutation policy.

Run the existing workflow validators, inline parity, script-contract, promotion, dependency and rule
gates as applicable. Use `bun run spur-check`, feature-level `bun run spur-check-feature`, package/build
checks and `bun run plugin-smoke` where the corresponding source/installation surfaces change. Run
`test-cf` when relevant cross-runtime code changes. Tests of this planning document do not stand in for
those future implementation gates. Do not regenerate broad baselines to hide new findings.

For migration, preserve user-owned `.spur/workflows` overrides and show which layer wins. Do not
overwrite a project graph because a new bundled version exists. Active runs keep their recorded
definition identity; a changed definition must not silently resume an old snapshot. Use the existing
supported compatibility/refusal behavior and retain old evidence. Roll back per canonical graph or
helper change, disable the candidate route, and retain diagnostic history; do not roll back by deleting
user artifacts or rewriting completion evidence.

Documentation stays incremental: update owning design satellites and the `04` pointer when their
contract changes, ADRs only for accepted boundary/invariant decisions, `03` only after mechanisms land,
and feature/task records through Spur. No PRD/constitution rewrite is needed for this proposal. Keep
source, generated plugin/bundled configuration and init defaults aligned within each affected slice.

## 10. Registration and execution handoff

Robin accepted the architecture and breakdown with “approved” on 2026-09-21. D63 and tasks 0914–0921
were registered through the source-local Spur CLI, with task-local AC altitude, feature-scenario links
and the dependency table above. At registration, ready preparation was skipped. Since then 0912,
0913 and 0914 completed independently. The 0912 outcome and 0913 evidence contract are now reflected
in D63 R4 and 0917; neither an observability pilot nor a replay projection is a speed result.

The next delegated handoffs are 0915, 0918 and 0920 in isolated worktrees. 0918's graph edit is not
yet eligible: the currently selected idea definition has only one terminal done run. Its agent starts
with the frozen evidence gate and may produce a documented no-change outcome. Refine 0916/0919 after 0915's
current-evidence contract lands; refine
0917 against observed post-instrumentation runs and the D62/P pilot receipt before any graph edit.
Before D63 completion, reconcile 0914's feature-check warning: its done-task Testing rows do not
currently map to D63 R1, so `feature check` cannot treat that scenario as verified.
After dependencies and evidence premises are satisfied, refine and unblock each later task through
the normal lifecycle. Do not run the companion registration batch again or launch all eight tasks
indiscriminately.

Affected-input checks cover all eight tasks and D63. Unfinished-prerequisite and unverified-feature
scenario warnings are expected at registration; they are not implementation PASS evidence. The
feature roster and generated index are refreshed through the CLI.
