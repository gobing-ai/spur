# D8 Proportional Workflow Upgrade Strategy — Task-Ready Decision Packet

**Date:** 2026-09-02
**Feature:** D8 (proportional workflow upgrade)
**Task:** 0733 (`synthesize-the-task-ready-workflow-upgrade-strategy`)
**Status:** PENDING OPERATOR REVIEW — no authority doc, workflow definition, public CLI surface, or baseline was mutated by this plan. All implementation is post-approval.
**Input evidence (authority artifacts, consumed without re-audit):**

- `docs/inventory/d8-0729-workflow-contract-inventory.md` — ADR/gate/baseline/capability audit, defect register §F (F-1…F-14), Decision 8 (corpus regen → ADR-093 waiver), Decision 11 (budgets RED, FIX-not-raise).
- `docs/analysis/d8-0730-workflow-cost-attention-measurement.md` — cohort (11 workflows, 65 dry / 3 non-terminal / 0 real terminal at audit), no budget established, verified-outcome binding defect §B, collection gaps, sufficiency rule §G.
- `docs/inventory/d8-0731-workflow-fit-classification.md` — deployment roles, dispositions, prerequisite table §5, pilot ranking §6, version classification §7.
- `docs/analysis/d8-0732-proportional-gate-prototype.md` — closed two-path route table, 5 real engine runs (first real terminal runs), version both-forms proof, run-bound evidence, constraints inherited by task-pipeline.

**Operator disposition gate (R9):** Approval of this packet **freezes the strategy** and unlocks creation of the implementation tasks in §7. Rejection keeps D8 open with the operator's requested revisions; this packet is the revision surface. There is no hidden operator decision in this document — every open decision is explicit with a named owner and a default.

---

## 0. Recommendation (one paragraph)

Fix the shared cross-surface seams first (root-cause, not per-workflow patches), repair the derived-doc and baseline drift that makes the corpus and surface gates lie, then validate proportional routing on the two real-caller surrounding pilots (`wrapup-pipeline`, `task-lifecycle`), and only after real runs exist and cost attribution works migrate `task-pipeline` last. Delete or demote machinery whose only role is redundancy before building any new routing: the inert baseline fields, the silent `pipeline-budgets.ts` no-op entry point, the dead `docs/03 §24` "not yet built" framing, and the impossible nested `feature-dev` review. **Option A below.** Nothing in this recommendation depends on a timeout field, a proof binding, a baseline, a composition snapshot, a static query count, or a consolidated log as an *effective control* — each is either fixed to have an executable test or explicitly not counted (0730 §G sufficiency rule: **no budget is established**).

---

## 1. R1 — Strategy options

Two or three evidence-compatible options; deletion/demotion and stabilization-only are considered before new routing machinery (AC).

### Option A — Stabilize → pilot proportional on surrounding workflows → migrate task-pipeline last (RECOMMENDED)

Three phases, each gated:

| Phase | Content | Exits when |
| --- | --- | --- |
| A1 **Stabilize** | Repair the 8 root-cause seams (R3), fix derived-doc + baseline drift, regenerate corpus under ADR-093 waiver fields, re-baseline ADR-069 dispositions, refresh surface inventory, fix docs-pipeline budget (FIX, not raise). | All repaired seams have a green executable gate; corpus gate green on a regenerated snapshot; surface-drift gate green. |
| A2 **Pilot proportional** | Apply the closed route-table contract (R4) to `wrapup-pipeline` (primary) + `task-lifecycle` (secondary, version both-forms), using real engine runs + run-scoped cost attribution (0730 collection work funded). | Both pilots have ≥5 real terminal runs with ≥80% row coverage on run-scoped cost; route table proven on a real caller. |
| A3 **Migrate task-pipeline** | After F-5/F-7/F-8 are repaired and real runs exist, apply proportional gates to `task-pipeline` last, keeping the real engine + real actions (0732 §8 constraint). | task-pipeline has verified real terminal runs; no behavior regression on the canonical pipeline. |

- **Trade-offs:** correctness-first (the recommendation order 0733 AC: correctness & verified outcomes → human attention → fresh premium tokens per verified PASS → wall-clock → maintenance simplicity); highest confidence because every step is executable before the next begins.
- **Confidence:** High. Every phase gate is run-bound evidence, not aspiration.
- **Complexity:** Medium — 3 sequential phases, but each is a small coherent slice (§7).
- **Blast radius:** Low-to-moderate — surrounding workflows first; `task-pipeline` mutations only after its defects are closed.
- **Affected ADRs:** amend 069/071/093/099/100/102; update derived docs 03 §24 / 04 capability-attestation; new ADR-103 (proportional-gate contract) + ADR-104 (optional version contract) drafted post-approval (§6).

### Option B — Stabilize and measure only (no new routing machinery)

Do A1 only; **defer all proportional routing** (A2/A3) until real runs + cost attribution accumulate. Rationale: 0730 §G established no budget and 0 real terminal runs; 0732 proved the route table on a *fixture*, not a real caller. Option B is the conservative floor.

- **Trade-offs:** lowest risk, no speculative machinery; but it leaves the 97%-dry-probe run economy (§F) and the inline-driver-as-real-execution-path asymmetry (0730 §F) untouched, and defers the actual proportional benefit indefinitely.
- **Confidence:** Highest (smallest claim); **Complexity:** Low; **Blast radius:** Low.
- **Affected ADRs:** amend 069/093/100/102 + derived docs; no new ADR for routing.
- **Why not recommended:** The prototype (0732 §8) already proved the route-table pattern is engine-executable on a real caller-class workflow; freezing at A1 would hold back the only path that converts the 65-dry-probe economy into measured real work. But it is the required fallback if the operator wants zero new behavior before more measurement.

### Option C — Direct proportional build on task-pipeline (skip stabilization-first)

Build the route table straight onto `task-pipeline` and ship a version-mandate/registry.

- **Trade-offs:** fastest apparent path; but `task-pipeline` is **non-executable as a pilot today** — it depends on F-5 (fail-open proof), F-7 (suppressed task lookup weakens proof), F-8 (stale expectFile) (0731 §5); the prototype explicitly *avoided* these and cannot transfer without repair (0732 §8). A version-mandate/registry has zero consumers and zero digest-at-resume comparison (0729 §H, 0732 §7) — it is speculative infrastructure.
- **Confidence:** Low (rests on broken primitives); **Complexity:** High; **Blast radius:** High (canonical pipeline).
- **Affected ADRs:** would force premature amendments to 094-100 without the stabilization base.
- **Why rejected:** violates the AC that stabilization repairs one shared root-cause seam per cross-surface defect before proportional optimization; builds registry machinery nothing consumes (YAGNI, 0733 AC "no second engine/DSL/version registry").

### Recommendation

**Option A.** It is the only option that (a) satisfies the AC ordering (correctness/verified outcomes → attention → tokens → wall-clock → simplicity), (b) honors "deletion/demotion and stabilization-only before new routing machinery," (c) keeps every step run-bound, and (d) migrates `task-pipeline` last. Option B is the automatic fallback if the operator prefers measurement-only; Option C is rejected.

---

## 2. R2 — Matrices

### 2.1 Deployment role × disposition (source: 0731 §2, §4)

| Workflow | Deployment role | Proven real caller | Disposition | Notes |
| --- | --- | --- | --- | --- |
| task-lifecycle | lifecycle (entity FSM) | YES (`spur task update/record`) | **keep** | 0 advisories; real caller; secondary pilot |
| feature-lifecycle | lifecycle (entity FSM) | YES (`spur feature update/sync`) | **keep** | 0 advisories; same FSM class |
| wrapup-pipeline | orchestrator (post-execution wrap-up) | YES (`/sp:dev-wrap`) | **keep** (simplify-optimize) | 4 advisories; primary pilot; dry `done` proven |
| task-pipeline | canonical engine pipeline | YES (`/sp:dev-run`, runall) | **keep** (simplify-optimize) | 14 advisories (worst); **migrate last** |
| idea-pipeline | orchestrator (ideation→planning→handoff) | YES (`/sp:dev-idea`, `/sp:dev-plan`) | **keep** (simplify-optimize) | 9 advisories; 4 pauses (F-4-unsafe); not a pilot |
| history-anatomy | engine-driven diagnostic | NO proven `workflow run` caller | keep (caller unproven) | role real; engine-driven; caller adoption unobserved |
| pr-review | reference-SSOT / fixture | NO `workflow run` caller | **demote-to-fixture** | keep the SSOT spine; do not promote to pilot |
| docs-pipeline | canonical engine pipeline (docs-sibling) | NO proven caller | **demote-to-procedure-or-fixture** | real procedure is `/sp:dev-run --mode implement`; no `workflow run docs-pipeline` |
| wayfinder-resolution | unused (declared free-form) | NO caller | **demote-to-procedure-or-fixture** | retire-or-demote deferred to operator (this packet): delete per ADR-072 precedent vs keep as research fixture — explicit open decision §9 |
| basic | example/fixture | NO caller | **keep-as-example/fixture** | generic example; no pilot |
| feature-dev | umbrella orchestrator | Intended but **structurally blocked** (F-2 nested review) | **keep-with-defect** | INELIGIBLE as pilot until F-2 repaired; 1 advisory |

**Retire candidates:** no definition is proven redundant *with a real caller*; the closest are `wayfinder-resolution` (no caller) and `basic` (example only). Both are **demoted, not retired** in this packet — removing a shipped definition is a deployment-surface change that belongs post-approval; the operator decides `wayfinder-resolution` deletion explicitly (§9 decisions D2/D8). `basic` stays as the documented example (ADR-072's planning-pipeline deletion is the precedent for the deletion path when it is chosen).

### 2.2 Gate classification — mandatory / proportional / optional / remove (source: 0729 §F, 0730 §H, 0732 §2)

| Gate / mechanism | Class | Evidence basis | Executable? |
| --- | --- | --- | --- |
| Proof-bracket digest guards (verify→record→done) | **mandatory** (immutable safety floor) | 0730 §H — may not be traded for cost | currently F-5 fail-open → **repair first** |
| Budget-unverifiable fail-closed dispatch (0707/ADR-095) | **mandatory** | 0730 §H safety floor | live; 0 of 11 workflows declare caps (zero adoption) |
| Reviewer/executor independence (0710/ADR-097) | **mandatory** | 0730 §H safety floor | live |
| Run-id confinement | **mandatory** | 0730 §H safety floor; **F-6 broken today** | repair (R3) |
| Corpus gate (ADR-090 single-sided) | **mandatory** (gate), snapshot = **temporary waiver** | 0729 §A — gate failing by design (24 NEW) | regenerate + ADR-093 waiver fields |
| Composition advisory (ADR-069) | **optional** (advisory posture per 069 amendment) | 0729 §A — 42 unsuppressed findings | re-baseline; stay advisory |
| Escalation packets (ADR-098) | mandatory (on blocked/failed) | 0730 §F — fired for all 65 dry probes (noise) | fix by excluding dry-probe escalations (R3) |
| Continue-drift digest comparison | **proportional target** | 0729 §F-4; 0732 §7 — unsafe pause/resume today | repair first (R3), then mandatory |
| Proportional fast/safety routing | **proportional** (post-stabilization) | 0732 §2 closed route table | prototype-proven on fixture; pilot on wrapup |
| `workflow validate` as run-readiness | **remove as evidence** (smoke only) | 0729 §F-14, 0731 §3 | dry-run is smoke; real runs are the proof |
| Static query counts / budgets (docs-pipeline) | **not an effective control** | 0730 §H — static counts reported separately from measured | budgets RED → FIX not raise (0730 Decision 11) |

### 2.3 Baseline semantics — reference / temporary-waiver / remove (source: 0729 §C, ADR-093)

| Baseline | Current role | ADR-093 class | Disposition |
| --- | --- | --- | --- |
| `config/workflow-composition-baseline.json` | two-sided composition gate + advisory suppression | reference (detects drift) + input (dispositions) | **keep**; let `regen` delete the 6 inert per-workflow fields + `proofInputs` (dead weight, §C); re-baseline the 42 advisories |
| `config/pipeline-budgets.json` | regression sensor + source/decision provenance | reference (not waivers) | **keep**; fix docs-pipeline `modelQueries` 1→2 (FIX, not raise — 0730 Decision 11) with recorded decision |
| `config/corpus-baseline.json` | corpus snapshot (waiver-role) | **temporary waiver** — must gain owner/review-date/removal | **regenerate** (24 NEW findings → accepted) + migrate to ADR-093 waiver fields (Decision 8) |
| `plugins/sp/scripts` (plugin-scripts.json) | two-sided script contract | reference | **keep**; PASS live (17 scripts) |
| `config/workflows/*` (definition identity) | stale `digest` fields in composition baseline | not a baseline role | **remove** stale digests; live identity is per-run `metadata_json.definitionDigest` (0730 §A) |

### 2.4 Capability / script ownership (source: 0729 §G)

| Surface | Owner | Mechanical check | Gap |
| --- | --- | --- | --- |
| Public CLI (`apps/cli/src/commands/`) | ADR-051 consent ledger | surface-drift-inventory | **stale** — 3 mismatches live (spur database gone; task create flags gone; builder/projects/self roots new) → refresh + gate |
| `scripts/commands/` (spur-dev.ts) | ADR-051 naming + test-sibling | spur-check chain | no mechanical placement check for this surface vs package.json → add to a mechanical check |
| `package.json` composition entrypoints | ADR-051 | spur-check chain | `regen-corpus-baseline` has **no package.json entry** (invoked as bare path in gate output) → add entry |
| `plugins/sp/scripts` | ADR-065 (.mjs twins) | script-contract-check | PASS live; **verify `superskill script path sp pr-reviewing.ts` stages the `.ts`** (0729 §G-4 unknown — one operator-machine run) |

---

## 3. R3 — Minimal stabilization slice (BEFORE any proportional optimization)

One shared root-cause seam per cross-surface defect — the AC requirement. Each repair fixes the seam all callers route through, not a per-caller patch. The R3 requirement's 8 seams (S1-S8) map to the 13 seam-repair rows below; the final 3 rows (corpus waiver, budgets FIX, escalation noise) are baseline/ops items that land in slice S1, not the 8-seam stabilization.

| R3 seam | Repair | Root cause | One-seam fix | Verification |
| --- | --- | --- | --- | --- |
| S3 config/default-kind/action options | F-1 command.gate timeout key | `command-gate.ts:157` spreads `timeoutMs`; ProcessExecutor contract is `timeout` | spread `timeout` (one-line) | run a command.gate with a timeout and assert the deadline fires |
| S8 nested composition | F-2 nested feature-dev review | `feature-dev.yaml:156-169` nested `spur workflow run pr-review.yaml` refused by `SPUR_WORKFLOW_RUN_ACTIVE` guard | **Decision D1**: either allow one guarded nested level OR replace the gate with a non-spawning check (both restore the review path; no dead weight) | feature-dev integration-review reaches a real decision |
| S1 load/resolve/preflight seam | F-3 spurConfig never threaded | `makeSvc` (apps/cli/src/commands/workflow.ts:253-286) omits `spurConfig` | thread `spurConfig` through `makeSvc` | `agent.default` resolves from CLI `workflow run` |
| S4 exact source/digest resume binding | F-4 continue ignores drift | `continuePaused` (workflow-service.ts:1007,1076) re-resolves by *name*, no digest comparison | enforce digest comparison at resume (block or loudly confirm on drift) | edited YAML between run and resume is caught |
| S7 fail-closed proof/fresh artifacts | F-5 fail-open proof fingerprints | `createGitAlternateTree` returns `''` on git failure (proof-input-fingerprint.ts:99-118) | fail closed on empty tree (no empty-tree digest) | git-failure path refuses, never "verifies" |
| S6 path/run-id confinement | F-6 run-id confinement | `options.runId \|\| crypto.randomUUID()` unvalidated (workflow.ts:424,512) | validate run-id at CLI entry (reject `/`, `..`, absolute) | `--run-id ../../x` rejected |
| S7 fail-closed proof/fresh artifacts | F-7 suppressed task lookup | `task path … 2>/dev/null \|\| true … exit 0` (task-pipeline.yaml) | non-suppressed lookup; empty taskpath is an error | missing task spec fails, not silently tree-only |
| S7 fail-closed proof/fresh artifacts | F-8 stale verifier expectFile | no step removes a prior run's `<wbs>-verify-answer.txt` (agent-run.ts:553+) | remove/require-fresh before assert | stale answer file does not satisfy verifier |
| S7 fail-closed proof/fresh artifacts | F-9 run.artifact proof binding | proofBinding echoed into result data only (run-artifact.ts:88-101) | bind/validate proof at artifact write | decorative binding becomes enforced |
| S1 load/resolve/preflight seam | F-11 pipeline-budgets no-op | no `import.meta.main` bootstrap in `pipeline-budgets.ts` | add bootstrap | `bun scripts/commands/pipeline-budgets.ts` runs, not silent success |
| S2 run/continue execution harness | F-14 dry-run smoke | dry-run validates schema/reachability + runs real guards | treat as smoke only; real runs are the proof | no consumer uses dry-run as run-readiness |
| S2 run/continue harness (parity) | run/continue/validate divergence | validate/run `validateSchema: true`, continue `false` + name re-resolution (0729 §E) | one shared resolve/preflight seam for run/continue/validate | continue and validate agree on the same definition+digest |
| S5 paused progress | resume never reads checkpoint | `continuePaused` never reads the checkpoint (ADR-099 partial) | resume-side freshness validation reads the checkpoint | paused run resumes only with a fresh checkpoint |
| (S1 baseline) | Corpus + waiver | snapshot lacks D8/E81 wave (24 NEW) + no ADR-093 fields | regenerate; add owner/review-date/removal (Decision 8) | corpus gate green on regenerated snapshot |
| (S1 baseline) | Budgets | docs-pipeline `modelQueries` 2 > ceiling 1 (SSOT contradiction) | set 2 with recorded decision (FIX not raise, 0730 Decision 11) | budget gate green with decision recorded |
| (S2 ops) | Escalation noise | 59 packets from dry sweeps (0730 §F) | exclude dry-run-probe escalations from packet emission | dry sweep emits no human-inspect packet |

**Ordering constraint:** repairs are cross-surface (run/continue/validate divergence — 0729 §E) and land **before** any proportional gate, because the prototype (0732 §8) explicitly avoided these and could not transfer them to task-pipeline without repair.

---

## 4. R4 — Target proportional-routing contract

Adopted from the 0732 prototype (§2, §5) as the closed contract for any proportional gate:

1. **Closed route table.** Every input maps to exactly one of a small set of routes via mutually-exhaustive predicates (0732 §2: `tasks.length==0 → skipped`; `tasks>0 && mode==fast → fast-path`; `tasks>0 && mode!=fast → safety-path`). No input is unrouted.
2. **Immutable safety floor.** Proof-bracket guards, budget-unverifiable fail-closed, reviewer independence, run-id confinement are never traded for speed (0730 §H).
3. **Unknown-to-safety.** Missing/unknown/conflicting evidence always routes to the safety path (0732 §2: `mode` missing/unknown/conflict/unrecognized → safety-path).
4. **Bounded observable reasons.** Every route writes a bounded per-run reason to `.spur/run/<runId>-reason.txt`; no silent skip. (Do **not** rely on the fixture's reason *labels* — the `safety:conflict` mislabel quirk in 0732 §2 is a fixture wart; rely on the route table + transition records.)
5. **Exact proof.** Route/skip facts come from `transition_runs` (engine-persisted) + the run's own artifacts + the run-start `definitionDigest` stamp; run-bound evidence is machine-readable (0732 §5).
6. **Rollback.** Each slice is isolated (surrounding-first); a proportional gate is a per-workflow option that can be reverted without touching the engine or other workflows (§7 rollback boundaries).
7. **Budgets.** No budget number is proposed as a gate ceiling — 0730 §G sufficiency rule is **NOT MET** (0 real terminal runs, 0 run-scoped cost mappings, defective verified-outcome binding). Any ceiling written before real runs + ≥80% run-scoped cost coverage is **explicitly unestablished** and must be labeled as such, not treated as evidence.

**Note on the P2-repair quirk:** 0732 §2 documents that the fixture's skip reason mislabels (`safety:conflict` on the `skipped` terminal). This packet reads the corrected route table (skipped is a genuine terminal, not a safety route) and the transition records, not the reason labels.

---

## 5. R5 — Baseline and inline-interpreter decisions

### 5.1 Baselines (keep/simplify/replace/remove)

| Baseline | Decision | Effect/parity check | Lifecycle / sunset | Maintenance budget | Inert fields? |
| --- | --- | --- | --- | --- | --- |
| workflow-composition-baseline.json | **keep (simplify)** | two-sided composition test + advisory input | keep while ADR-069 composition advisory exists; remove with it | regen + gate in spur-check | remove the 6 inert per-workflow fields + `proofInputs` (regen deletes) |
| pipeline-budgets.json | **keep (fix)** | `check-pipeline-budgets` gate + silent-raise provenance check | keep while budgets gate is a regression sensor | budget gate in spur-check | none inert (null = unenforced-until-measured debt, recorded) |
| corpus-baseline.json | **keep (replace-as-waiver)** | corpus gate single-sided | regenerate + migrate to ADR-093 waiver fields; snapshot retires with its wave | corpus gate in spur-check | none after migration |
| plugin-scripts.json | **keep** | script-contract-check (PASS) | keep while plugin-shipped scripts exist | gate in spur-check | none |
| stale definition digests in composition baseline | **remove** | none (dead weight, 0729 §C) | n/a | n/a | removed by regen |

### 5.2 Prompt-level inline interpreter (`inline-pipeline-driver`)

- **Current reality (0730 §F):** the dominant real-work execution cohort is the inline driver + host-session; the task-pipeline engine recorded **zero real runs** in the window. The inline driver is a **second interpreter** whose YAML parity with `task-pipeline` must be maintained (0731 §4 "inline-engine parity cost").
- **Decision:** **keep, single owner, with an executable parity check** — but only for the batch/orchestration paths that genuinely need host-session control (`/sp:dev-runall` orchestration). Per-workflow execution should route through the engine once stabilized.
  - **Single owner:** the spur-dev skill / runall driver (named in §7 slices).
  - **Executable parity check:** a mechanical check that the inline driver's action/guard set matches `task-pipeline.yaml`'s resolved actions (add to the mechanical surface checks in §2.4) — no silent divergence.
  - **Lifecycle/removal criteria:** remove the inline per-task interpreter once the engine covers the runall driver's per-task execution needs with real terminal runs (A3 done) and the parity check is green; the batch orchestration wrapper may remain.
  - **Maintenance budget:** parity check + the driver's test sibling in spur-check; no new flags.
  - **No inert fields:** the inline driver exposes no config that has no effect (audit on adoption).
- The alternative — **remove now** — is documented but rejected at this phase because the inline driver is the *only* path with real terminal work today (0730 §F); removing it before the engine is stabilized would strand D8's real-work execution. It becomes a removal candidate at the A3 gate. This is an explicit open decision for the operator (D7, §9).

---

## 6. R6 — ADR keep / amend / supersede / retire matrix

Including ADR-102 and ADRs 094-100 derived-doc drift. **No authority doc is mutated by this packet** — this is the post-approval map.

| ADR | Claim | Current state (evidence) | Disposition |
| --- | --- | --- | --- |
| 050 | Split check gate (spur-check / spur-check-new) | implemented | **keep** |
| 051 | Surface governance + consent ledger | partial — only plugin-script surface mechanically enforced | **amend**: extend mechanical placement check to `scripts/commands` + package.json (F-13) |
| 062/083/088 | Corpus severity ratchet / supersession chain | implemented / superseded-in-practice | **keep** (chain intact); 090/092/093 are current |
| 065 | Script manifest + .mjs twins | implemented, gate PASS | **keep**; verify superskill stages `.ts` for pr-review (§2.4) |
| 069 | Composition advisory | **drifted** — 42 unsuppressed findings | **amend**: re-baseline; remove inert fields or add a checker |
| 070 | Progress projection, digest diagnostics | implemented | **keep** |
| 071 | Proof-chain symmetry | implemented; F-8 stale expectFile, F-9 decorative binding | **amend**: fix F-8/F-9 (R3) |
| 072 | Delete planning-pipeline / pipeline2 | implemented (precedent for deletion) | **keep** (cited for wayfinder/basic demote-or-retire decision) |
| 076 | Retire task-pipeline2 + modelQueries | implemented | **keep** |
| 090 | Corpus gate single-sided + dated residue | implemented, **gate failing by design** (24 NEW) | **keep**; regenerate snapshot (Decision 8) |
| 092 | Single-sided snapshot ratchet | implemented | **keep** |
| 093 | Waiver fields (owner/review-date/removal) | **partial** — corpus snapshot lacks the fields; migration "pending" never happened | **amend/complete**: migrate corpus snapshot to waiver fields (Decision 8) |
| 094 | Capability attestation (host-enforced) | implemented (0706) | **keep** |
| 095 | Runtime budgets measured; unknown never zero | implemented (0707); budgets RED → FIX | **keep**; apply FIX-not-raise (0730 Decision 11) |
| 096 | Tripwire catalog + evidence-bound events | implemented (0708) | **keep**; wire real budget-verifiable dispatch (zero adoption today, 0730 §H) |
| 097 | Reviewer/executor independence | implemented (0710) | **keep** |
| 098 | Escalation packets | implemented (0709) | **amend**: exclude dry-probe escalations (R3) |
| 099 | Checkpoints freshness-bound resume | **partial** — `continuePaused` never reads checkpoint | **amend**: resume-side freshness validation (R3, F-4) |
| 100 | Verified-outcome metrics digest-bound | implemented (0712); **binding defective** (proof shape + no runId + no re-check, 0730 §B) | **amend**: fix `.proof.digest` shape + write `runId` into verdict + re-check digest at read time |
| 101 | History refresh isolation | implemented (0716-0717) | **keep** (not in D8 scope) |
| 102 | Constrained agent stages attest executor capabilities | implemented, **stale-doc** — detail pointer `04 §agent-capability-attestation` does not resolve as cited; the existing docs/04 section (`04_DESIGN.md:2358`) is labeled **ADR-101/task 0706**, mislabeling the 0706 capability work under the wrong ADR number | **amend (docs)**: fix the docs/04 heading/label to ADR-102 + task 0706; add the missing anchor |

**Derived-doc drift (AC item):**

- `docs/03_ARCHITECTURE.md:1358` — §24 header still reads **"accepted design — ADR-094–100; not yet built"** while tasks 0703–0712 are all `done` and the code is live. **Update header + Implementation column to "built (0703-0712)".**
- ADRs 094-100 appear in docs/03 (1-2 mentions each) and **zero times in docs/04_DESIGN.md** (0729 §A). **Add** the design sections.
- **Authority-first update order** (per AC): architecture (03 §24), design (04 capability-attestation + 094-100 sections), observability (workflow-observability design doc — dry-run smoke posture F-14), composition (workflow-composition-contract — inert fields + 42 advisories), surface governance (ADR-051 mechanical placement). All in slice S1 (§7).

**New ADRs (drafted post-approval, not this packet):**

- **ADR-103 (proposed):** Proportional-gate contract — closed route table, immutable safety floor, unknown-to-safety, bounded reasons, exact proof, rollback, evidence-qualified budgets. Lands with slice S3 (pilot).
- **ADR-104 (proposed):** Optional workflow-version contract (R8). Lands with slice S4. Optional — may instead amend the workflow-schema doc if the operator prefers no new ADR for a behavior-neutral field.

---

## 7. R7 — Implementation slices (surrounding-workflow-first; `task-pipeline` LAST)

Each slice: dependencies, owner, changed surfaces, reproducing/regression/verification checks, rollback boundary, observability, public-surface consent gate.

### S0 — Shared-seam stabilization (root-cause repairs)

- **Dependencies:** none (unblocks all).
- **Owner:** engine/harness (packages/app + apps/cli) with the spur-dev skill for the corpus/budget edits.
- **Changed surfaces:** command-gate.ts, makeSvc (workflow.ts), workflow-service.ts continuePaused, proof-input-fingerprint.ts, run-id validation (workflow.ts), task-pipeline.yaml lookup/expectFile hops, run-artifact.ts, pipeline-budgets.ts bootstrap, escalation emission.
- **Checks:** per-defect regression tests (R3 table); full workflow-service suite.
- **Rollback:** per-file revert; seams are isolated (no schema change).
- **Observability:** per-run digest stamp + resume drift diagnostic now enforced; escalation packets exclude dry probes.
- **Consent gate:** none public (internal seam repairs); corpus regeneration is a baseline change → operator consent (Decision 8).

### S1 — Authority/derived-doc + baseline repair

- **Dependencies:** none.
- **Owner:** spur-dev docs + corpus owners.
- **Changed surfaces:** docs/03 §24 header + Implementation column; docs/04 capability-attestation label fix + 094-100 design sections; workflow-composition-contract (inert fields); workflow-observability (dry-run smoke posture); ADR-051 placement check; surface inventory refresh; corpus-baseline regen + ADR-093 waiver fields; composition-baseline regen (inert fields deleted, 42 advisories re-baselined); pipeline-budgets FIX; add `regen-corpus-baseline` package.json entry.
- **Checks:** corpus gate green; surface-drift gate green; script-contract-check PASS; budget gate green; link check.
- **Rollback:** all doc/baseline changes are git-revertable; baseline regen is a committed snapshot (ADR-093 waiver fields name owner/review-date/removal).
- **Observability:** every gate reports in spur-check.
- **Consent gate:** ADR-051 public-surface inventory refresh + corpus waiver migration need operator sign-off (they change gate-passing sets).

### S2 — Inline-driver parity + ownership (R5.2)

- **Dependencies:** S0 (so the engine is a viable target before comparing against it).
- **Owner:** spur-dev skill (runall driver).
- **Changed surfaces:** `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` + a parity check comparing inline action set vs `task-pipeline.yaml` resolved actions.
- **Checks:** parity check green; no inert inline-driver flags.
- **Rollback:** parity check is additive; driver behavior unchanged until removal gate.
- **Observability:** parity check in spur-check.
- **Consent gate:** none public (plugin skill surface; no CLI change).

### S3 — Surrounding pilot: proportional gates on wrapup-pipeline + task-lifecycle

- **Dependencies:** S0 (F-4 continue-drift fixed → pause/resume safe), S1 (gates green), 0730 collection work funded (run-scoped cost attribution + verified-outcome binding fix).
- **Owner:** workflow + cost-measurement owner.
- **Changed surfaces:** `config/workflows/wrapup-pipeline.yaml` + `config/workflows/task-lifecycle.yaml` (closed route table per §4), the run-scoped cost importer (`history_run_session`), verified-outcome fold (proof shape + runId + digest re-check).
- **Checks:** reproduce the 0732 fixture assertions on the real wrapup graph; ≥5 real terminal runs per pilot with ≥80% run-scoped cost row coverage; version both-forms exercise on task-lifecycle (unversioned vs explicit(1.2.3): same route, digest differs — 0732 §7).
- **Rollback:** per-workflow option flag; revert without touching engine or task-pipeline.
- **Observability:** transition_runs route records + per-run reason files + run-scoped cost rows.
- **Consent gate:** changing a shipped surrounding workflow's routing is a production workflow change → **operator approval required** (this packet is that approval vehicle).

### S4 — Optional workflow-version contract (R8)

- **Dependencies:** S0 (continue-digest fix subsumes version drift at resume).
- **Owner:** domain schema + workflow-service.
- **Changed surfaces:** state-machine + transition-flow JSON/Zod schemas (minLength 1 + empty-value diagnostic), optional version propagation through run/list/show/trace as defined in §8.
- **Checks:** both dialects validate; empty-value emits diagnostic; version-only edit changes digest with no behavior change (regression: 0732 digest-differs test).
- **Rollback:** behavior-neutral field; revert without run impact (no consumer branches on it).
- **Observability:** version rendered in show/trace only if the operator opts in (default: digest remains the identity).
- **Consent gate:** none public (no new CLI flag; version is optional and behavior-neutral).

### S5 — task-pipeline migration LAST

- **Dependencies:** S0 (F-5/F-7/F-8 repaired), S3 (route-table proven on real caller), real runs + cost attribution existing.
- **Owner:** canonical pipeline owner.
- **Changed surfaces:** `config/workflows/task-pipeline.yaml` proportional gates; iterative bounds adjusted only from measured utilization (0731 §3: no measured basis today).
- **Checks:** real terminal runs with exact proof binding; no behavior regression on canonical pipeline; verified-outcome metrics now bound (§B fix).
- **Rollback:** per-workflow option; task-pipeline stays engine+real-actions (0732 §8 constraint).
- **Observability:** full run-bound evidence; verified PASS attributable.
- **Consent gate:** **operator approval required** — this is the canonical pipeline; the highest-blast-radius slice.

**Public-surface consent gates:** S1 (surface inventory + corpus/baseline regen), S3 (production surrounding workflow routing), S5 (production task-pipeline routing) require operator approval; S0/S2/S4 are internal or behavior-neutral and do not.

---

## 8. R8 — Minimal optional workflow-version contract (both dialects)

Behavior-neutral, optional-first, no registry (AC; 0732 §7; 0729 §H):

| Concern | Contract |
| --- | --- |
| Absent | `version` omitted → **`unversioned`** (today's state for all 11 workflows) |
| Present | non-empty quoted literal → **`explicit(<literal>)`**, opaque string, behavior-neutral |
| Empty value | `version: ""` → **diagnostic** (schema `minLength: 1`); today empty validates silently — reject-with-diagnostic, not silent |
| Source/digest propagation | `version` stays folded into `computeDefinitionDigest` (composition-baseline.ts:110) — a version-only edit changes the digest with zero behavior change (proven 0732 §7: `3d5c4d42d…` vs `60fa187c2…`); this is the *only* observable effect and it is intentional |
| Pause-resume propagation | **subsumed by the F-4 continue-digest fix** (S0) — resume compares digests, so any version (or any) edit between run and resume is caught; version alone adds no new risk (0731 §7) |
| Bundled/project precedence | resolve **project-first then bundled** on `run`/`continue` — today `run`/`continue` is project-first but the agent `workflow` tool is bundled-first (0729 §E divergence); unify to project-first (S0), so a versioned project definition always wins |
| In-flight compatibility | unversioned and explicit runs coexist; version is not a dispatch key — no consumer branches on it, no behavior difference, no registry (0732 §7) |
| Rollout | additive: schema + diagnostic only; no workflow is required to add `version` |
| Rollback | remove the field or the diagnostic; zero run impact |
| Future-major mandate evidence | **objective evidence only** (not aspiration): a consumer branching on `version`, or a real drift incident where the digest diagnostic could not disambiguate. Neither exists today (0729 §H). **No version-mandate and no registry until a behavior actually dispatches on it** (AC). |

---

## 9. R9 — Design Summary + self-review

### 9.1 Design Summary

This packet converts the four authority artifacts into a decision surface: one recommended option (A: stabilize → pilot proportional on surrounding workflows → migrate task-pipeline last), four matrices (roles/dispositions, gate classes, baseline semantics, capability ownership), an eight-seam stabilization list, the closed proportional contract, per-baseline and inline-interpreter decisions, the ADR keep/amend/supersede/retire map (incl. ADR-102 stale-doc + ADRs 094-100 derived-doc drift), six ordered implementation slices with consent gates, and the optional version contract. It is a decision packet, not an implementation task — no task is created until the operator approves.

### 9.2 Self-review

- **Evidence links:** every material claim cites its source artifact section (§1-§8 headers name the source; per-row `source:` annotations). No predecessor task body must be loaded to review.
- **Placeholders:** none — every table is fully populated; unknowns are named as unknowns (see §9.3), not masked.
- **Contradictions resolved:**
  - Cohort counts 67 (0730) vs 68 (0731 restored) vs 69→74 (0732 pre/post) are **sequential DB states**, not contradictions; the invariant "0 real terminal engine runs at audit" holds across all three.
  - The version-only-edit-changes-digest fact (0729 §H) is **accepted behavior**, not a defect — the digest is the identity, version is folded in; the F-4 fix subsumes any drift concern.
  - The 0732 fixture's `safety:conflict` reason label on the `skipped` terminal is a **fixture wart** — the route table (not reason labels) is the contract (§4 note).
  - docs/04 "Capability attestation" exists but is **mislabeled ADR-101/task 0706** while ADR-102 cites an unresolvable anchor — one fix, not two, in S1.
- **Scope creep:** explicitly excluded (AC) — Project/Workspace/Inbox/Teams consolidation; a second engine/DSL/version registry; production workflow mutation (none in this packet; all post-approval with consent gates); unapproved public CLI changes.
- **Ambiguous handoff:** the operator disposition gate (§0) is the hard handoff; open decisions below are enumerated with defaults, not hidden.
- **Unproven controls:** no timeout field, proof binding, baseline, composition snapshot, static query count, or consolidated log is treated as an effective control without an executable test (AC). Budgets are **explicitly unestablished** under 0730 §G until real runs + ≥80% run-scoped cost coverage exist.

### 9.3 Open operator decisions (explicit, each with a default)

| # | Decision | Default if not overridden |
| --- | --- | --- |
| D1 | feature-dev nested review: allow one guarded nested level vs replace with non-spawning check | **replace with a non-spawning check** (no new nesting; smallest diff) |
| D2 | `wayfinder-resolution`: retire (delete per ADR-072 precedent) vs keep as research fixture | **demote-to-fixture, keep** (no production change without stronger evidence) |
| D3 | Inline driver: keep with parity check (recommended) vs remove now | **keep with parity check** (D7 removal gate at A3) |
| D4 | Optional version: new ADR-104 vs amend workflow-schema doc | **amend workflow-schema doc** (smallest authority change for a behavior-neutral field) |
| D5 | Version rendered in show/trace vs digest-only | **digest-only** (no surface churn; version is not a dispatch key) |
| D6 | Corpus + surface/baseline regen consent | **approve with S1** |
| D7 | Inline-interpreter removal at A3 gate | **remove per-task interpreter when engine covers runall per-task execution** |
| D8 | Wayfinder/basic retirement timing | **demote now, retire never without operator's explicit delete** |

**Disposition recording:** this packet is PENDING. On approval, the strategy freezes and S0-S5 task creation is unlocked (in slice order). On rejection, D8 stays open with the operator's requested revisions to this packet (the revision surface).

---

## 10. R10 — Deliverable location

Durable artifact: `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` (this file). Task 0733 Solution links it; the task Solution/Testing sections summarize and record verification.

## Unknowns (honest gaps carried forward)

- `superskill script path sp pr-reviewing.ts` / `history-anatomy-cache.mjs` staging behavior (0729 §G-4) — one operator-machine run confirms.
- Real-run frequency for all 11 workflows remains 0 in this window — every budget/bound claim stays unestablished (0730 §G).
- Pause/resume safety stays unproven until the F-4 digest-comparison fix lands (S0).
- Whether `wayfinder-resolution`/`basic` are used via direct `spur workflow run` outside this worktree — unobservable from this plane.
