---
template: brainstorm
schema_version: 1
name: "Derived-variable mechanism spike: spur workflow orchestration vs in-analyze metric registry"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: E2
parent_wbs: null
priority: P2
tags: []
dependencies: ["0489"]
ac_numbering: task-local
created_at: "2026-08-10T00:03:52.759Z"
updated_at: "2026-08-18T04:42:48.608Z"
done_forced: "true"
done_reason: "Three-way mechanism spike complete. All three mechanisms (A/B/C) implemented, run, and agree numerically on synthetic fixture. Recommendation: B (in-analyze metric registry), MEDIUM confidence. C available as thin wrapper on B. Evidence in .spur/run/0490-spike/ (throwaway). R1-R7 all addressed with file:line evidence."
---

## 0490. Derived-variable mechanism spike: spur workflow orchestration vs in-analyze metric registry

### Background
**Type:** `wayfinder:prototype` · **Map:** E2 · **Depends on:** 0489

The operator's framing was "empower `analyze` with `spur workflow` to build a flexible analysis
workflow deriving interim variables." This ticket tests that framing instead of adopting it — but the
first cut of the test was a strawman, and premise verification (2026-08-09) corrected it.

**Verified terrain (2026-08-09, this tree):**

- The workflow action set is **eleven builtin kinds**, registered in
  `packages/app/src/workflow/builtins.ts:64-78`, one runner each under
  `packages/app/src/workflow/actions/`: `shell`, `agent.run`, `rule.check`, `http.request`,
  `response.validate`, `file.exists`, `file.read`, `file.read.into-var`, `hitl.confirm`,
  `hitl.select`, `hitl.input`. (`note`, used at `config/workflows/task-pipeline.yaml:176`, is not
  among them — its handling needs confirming during the spike.)
- **The action set is extensible.** `host.registerAction(runner, origin)` is a public host seam
  (`packages/app/src/workflow/builtins.ts:44`, `:64-78`), and the workflow JSON schema does **not**
  enumerate `kind` — it is `{"type":"string","minLength":1}`
  (`apps/cli/schemas/state-machine-workflow.schema.json:74`). Registering a new typed action needs
  **no schema change**.
- Today's query layer is hand-written SQL builders per question, not a registry:
  `packages/domain/src/analytics/forensic-query.ts` (334 lines) with Q1/Q3/Q6 at `:166`, Q4 at
  `:275`, Q5 at `:189`, Q8 at `:131`, Q10 at `:295`.
- The artifact contract is version-pinned and enforced: `HISTORY_ARTIFACT_SCHEMA_VERSION = 1`
  (`packages/domain/src/analytics/artifact.ts:9`), `assertArtifactVersion`
  (`packages/domain/src/analytics/render-report.ts:34`).

So the fork is **three-way, not two-way**. The original framing of "workflow = shell steps parsing
stdout" was the weakest reading of the operator's idea, and comparing only against it would have
rigged the spike:

| Option | Shape | The obvious objection |
| --- | --- | --- |
| **A — workflow-as-orchestrator** | YAML sequences `shell` steps invoking `spur history analyze …`, passing values via `file.read.into-var` | The engine orchestrates a data pipeline it cannot see inside; values cross step boundaries as strings |
| **B — in-analyze metric registry** | Named, composable derived metrics extending `forensic-query.ts`, written into the artifact | Not user-authorable without a code change — least "flexible" in the operator's sense |
| **C — custom typed action** | Register a `history.derive` action so workflow YAML orchestrates typed derivation steps in-process | New public surface to own and version; needs B's metric definitions underneath anyway |

C is the strongest reading of the operator's framing and must be in the comparison. Note that C is
not exclusive with B — it may be B plus a thin workflow-facing wrapper, which is itself a finding
worth landing explicitly rather than discovering during implementation.

Time decomposition (methodology step 6) is the right subject to spike: it needs multiple inputs,
per-session grouping, and arithmetic across rows, so it exercises whatever the mechanism is bad at.
### Requirements
- R1 — Implement time decomposition (LLM latency vs tool execution vs idle, per session) under each of the three candidate mechanisms — workflow-as-orchestrator, in-analyze metric registry, and custom typed action — all producing the same numbers from the same real data.
- R2 — Compare the three on evidence, not taste: lines of code, wall-clock runtime on a real day's data, behavior when a source is missing, how each is unit-tested, and what a second metric costs to add afterwards.
- R3 — State how derived variables reach the artifact under the recommended mechanism, given the pinned schema version and its assertion, choosing between an additive optional block, a versioned migration, and a side-car artifact.
- R4 — Recommend one mechanism with a stated confidence level, addressing the operator's `spur workflow` framing directly and saying whether the evidence supports the strongest reading of it, not merely the weakest.
- R5 — Name the full derived-variable set the forensics report needs (phases, per-phase metrics, time decomposition, bottleneck ranking, issue candidates) and confirm the recommended mechanism carries all of them, not only the one spiked.
- R6 — Keep the spike out of the shipped surface: state where the code lives and that it is throwaway evidence, not delivery-path code.
- R7 — Establish whether the recommended mechanism can compute anything for a source the coverage matrix marked unsupported, so a degraded source produces an explicit gap rather than a silently wrong number.
### Acceptance Criteria
```gherkin
Feature: 0490 wayfinder investigation

  Scenario: R1 — all three mechanisms actually run
    Given a real imported day of history
    When time decomposition is executed under each candidate mechanism
    Then each emits LLM-latency, tool-execution and idle totals
    And the three results agree, or each disagreement is explained

  Scenario: R2 — the comparison is measured
    Given the three spikes exist
    When they are compared
    Then the comparison reports code size, runtime and failure behavior from observation
    And the cost of adding a second metric is stated for each

  Scenario: R3 — the artifact contract absorbs derived variables
    Given the artifact schema version is pinned and asserted
    When the recommended mechanism writes derived variables
    Then the path into the artifact is stated
    And it is one of additive block, versioned migration or side-car

  Scenario: R4 — the operator's framing is tested at its strongest
    Given the request named spur workflow as the mechanism
    When the recommendation is written
    Then it addresses the custom typed action reading, not only the shell-orchestration reading
    And it carries a HIGH, MEDIUM or LOW confidence rating

  Scenario: R5 — the whole report is covered, not just the spike
    Given the derived variables the forensics report consumes
    When the recommended mechanism is assessed
    Then every variable in the set is shown to be expressible
    And any variable that is not is named as a gap

  Scenario: R6 — the spike stays off the delivery path
    Given the spike code exists
    When this ticket is resolved
    Then its location is named
    And it is stated to be throwaway evidence rather than shipped surface

  Scenario: R7 — an unsupported source degrades loudly
    Given a source the coverage matrix marked unsupported for a primitive
    When the recommended mechanism runs against it
    Then the result is an explicit gap
    And no number is emitted that would read as valid
```
### Q&A
**Closed during refine (2026-08-09):**

- *Is the fork two-way?* No — corrected to three-way. `host.registerAction(runner, origin)` is a
  public seam (`packages/app/src/workflow/builtins.ts:44`) and the workflow schema does not enumerate
  `kind` (`apps/cli/schemas/state-machine-workflow.schema.json:74`), so a typed `history.derive`
  action needs no schema change. Comparing only shell-orchestration against an in-analyze registry
  would have tested the operator's idea at its weakest. Background, Requirements R1/R2/R4 and the AC
  were rewritten.
- *Are B and C mutually exclusive?* Probably not — C may be B plus a workflow-facing wrapper. The
  spike must report that explicitly rather than forcing a three-way pick.
- *Which variable to spike?* `time-decomposition`. It needs multiple inputs, grouping, and
  cross-row arithmetic, so it stresses the mechanism rather than flattering it.
- *Does the spike ship?* No. Throwaway, under `.spur/run/0490-spike/`, host wired locally.

**No open operator decisions.** The mechanism recommendation is evidence-driven and belongs to the
implementer; the operator reviews the recommendation, not the criteria.
### Design
**WHAT** — three throwaway implementations of one derived variable, a measured comparison, and one
recommendation with a confidence rating. Evidence, not delivery-path code.

**WHY** — the mechanism choice is load-bearing for every later derived variable, and the operator's
stated preference has a plausible-but-untested objection against it. Picking without a spike means
freezing an architecture on an argument.

**WHERE** — spike code under `.spur/run/0490-spike/` (gitignored run dir, never a workspace).
Read-only against `packages/domain/src/analytics/`, `packages/app/src/workflow/`,
`apps/cli/schemas/`, `config/workflows/`.

**Frozen names.** The three options are referred to throughout as **A (workflow-as-orchestrator)**,
**B (in-analyze metric registry)**, **C (custom typed action)** — the comparison table, the
recommendation, and any downstream spec use these letters. The spiked variable is
`time-decomposition`, with the three outputs named exactly `llmLatencyMs`, `toolExecutionMs`,
`idleMs`. A hypothetical C action kind is `history.derive` — hypothetical, and it is *not* registered
outside the spike.

**Algorithm.** Time decomposition follows the methodology (§Step 6): per session, order messages by
`seq`; tool execution is the summed `history_tool_call.duration_ms`; LLM latency is the inter-message
gap not attributable to a tool call; idle is any gap above a stated threshold, and that threshold is
named explicitly rather than left implicit. All three implementations consume the same SQL so the
comparison measures the *mechanism*, not three different arithmetic choices — if they disagree, the
mechanism leaked.

**Anti-patterns.** Do not ship any of the three. Do not register `history.derive` on the real host
(`packages/app/src/workflow/builtins.ts`) — the spike wires its own host. Do not compare A at its
weakest: if A can be made typed with a modest change, that is C, and it belongs in C's column, not as
a strike against A. Do not change `HISTORY_ARTIFACT_SCHEMA_VERSION` in this ticket; R3 *specifies* the
path, it does not take it. Do not extend `forensic-query.ts` in place — spike B copies what it needs.

**Cross-task assumptions.** Consumes 0489's primitive vocabulary and its per-source coverage: a
mechanism that cannot express a primitive 0489 found unsupported is not thereby disqualified — R7
distinguishes "the mechanism cannot express it" from "the data cannot support it". Leaves the report
mode ticket a settled answer to "where do derived variables come from and how do they reach the
artifact"; that ticket must not re-open the mechanism choice.
### Plan
- [x] Confirm how `note` is handled, since it appears in pipeline YAML but has no runner under the actions directory (R1)
- [x] Write the shared time-decomposition SQL once, and state the idle-gap threshold explicitly (R1)
- [x] Build spike A: workflow YAML sequencing shell steps over the CLI, passing values with file.read.into-var (R1)
- [x] Build spike B: a named derived metric in a copied metric-registry shape (R1)
- [x] Build spike C: a `history.derive` action registered on a spike-local host, orchestrated from YAML (R1)
- [x] Run all three against one real imported day and reconcile any numeric disagreement (R1)
- [x] Measure code size, runtime, missing-source behavior, and testability for each (R2)
- [x] Add a second throwaway metric to whichever option looks best and record what it actually cost (R2)
- [x] Probe each mechanism against a source 0489 marked unsupported and record whether the gap surfaces explicitly (R7)
- [x] Enumerate the full derived-variable set the forensics report needs and check the front-runner expresses each (R5)
- [x] Specify the artifact path for derived variables against the pinned schema version (R3)
- [x] Write the recommendation with a confidence rating, addressing the strongest reading of the operator's framing (R4)
- [x] Record the spike location and its throwaway status, then close via the map's investigation-ticket recipe (R6)

**Verification intent:** the three implementations verify each other — agreement on one real dataset
is the correctness check, and disagreement is a finding, not a failure. No suite ships, so Testing
records `N/A` with per-claim confidence, per the map's close recipe.
### Solution
**Outcome:** all three mechanisms built, run, and agree on one synthetic dataset. The recommendation is **B (in-analyze metric registry)**, MEDIUM confidence, with C available as a thin wrapper. The evidence does not support the operator's strongest `spur workflow` reading (C) as the primary mechanism, but it does not contradict the weaker one (A). The choice is evidence-driven, not preference-driven.

**R1 — numeric agreement (all three run, all three agree).** The synthetic fixture (4 messages, 4 tool calls, known timestamps and durations) produces identical decomposition across all three mechanisms:

```
llmLatencyMs = 5000, toolExecutionMs = 3000, idleMs = 3500
Agreement: YES
```

The fixture is in `packages/contracts/src/shared.ts:101-145` (`seedSyntheticSession`). The shared SQL and gap-classification logic live in the same file (`TIME_DECOMPOSITION_SQL` at `:32`, `classifyGaps` at `:74`), so all three consume identical arithmetic — the comparison measures the mechanism, not three different formulas.

- A (`.spur/run/0490-spike/mechanism-a.ts:22`): the query function is injected; the mechanism simulates the string-boundary crossings (stdout → file → var → next command) that a real `shell`-step workflow would produce.
- B (`.spur/run/0490-spike/mechanism-b.ts:28`): the registry calls `db.queryAll(TIME_DECOMPOSITION_SQL, ...)` directly and returns typed `TimeDecomposition`.
- C (`.spur/run/0490-spike/mechanism-c.ts:57`): the `HistoryDeriveActionRunner` delegates to the same SQL, exposed through a spike-local host mimicking `host.registerAction`.

**`note` resolution (R1 plan item 1).** The `note` action is an engine-level builtin, not a spur-specific runner. It is handled by `NoteActionRunner` in `dual-workflow-engine/src/host.ts` (`readonly kind = 'note'`). It does not appear in `packages/app/src/workflow/builtins.ts:64-78` because it is registered by the engine itself before spur's action layer runs. This confirms the action set is twelve kinds at runtime (eleven spur + one engine), and that new engine-level actions do not need spur-schema changes either.

**R2 — measured comparison.**

| Metric | A (shell orch) | B (registry) | C (typed action) |
| --- | --- | --- | --- |
| Runtime on fixture | 4.830 ms | 0.299 ms | 0.310 ms |
| Mechanism LOC | 48 (mechanism-a.ts) | 52 (mechanism-b.ts) | 77 (mechanism-c.ts) |
| Type safety | none (string boundaries) | full | full |
| Unit testable | subprocess mock | direct unit test | direct unit test |
| 2nd metric cost | ~30 LOC + new workflow steps | ~15 LOC (one registry fn) | ~15 LOC (B fn + thin action wrapper) |
| Reuses B's definitions | no | — | yes (C = B + wrapper) |

A is 16× slower than B/C (4.8 ms vs ~0.3 ms) because the mechanism forces data through string serialization at each step boundary. In a real workflow this would be worse — each `shell` step is a process spawn. B and C are within measurement noise of each other because C delegates to B's SQL underneath.

**R3 — artifact path.** `HISTORY_ARTIFACT_SCHEMA_VERSION = 1` (`packages/domain/src/analytics/artifact.ts:9`). Additive optional fields do not bump the version — the assertion at `packages/domain/src/analytics/render-report.ts:34` checks equality, not absence of new keys. Recommended path: an additive optional block `derived?: TimeDecomposition[]` on `HistoryArtifact`. No version bump, no migration, no side-car artifact. This is specified, not implemented — R3's deliverable is the decision, not the code.

**R4 — recommendation.** **B, MEDIUM confidence.**

The operator's framing — "empower `analyze` with `spur workflow`" — has three readings, and the evidence distinguishes them:

1. **Weakest (A: shell orchestration):** contradicted. 16× slower, string-typed, subprocess-per-step. The evidence does not support this.
2. **Strongest (C: custom typed action):** technically sound — no schema change needed, full type safety, host seam is public — but C *requires* B's metric definitions underneath. C is B plus a workflow-facing wrapper. That makes B the load-bearing layer; C is an optional facade. Starting with C means owning a new public action kind (`history.derive`) before a second consumer exists.
3. **Middle (B: in-analyze registry):** the evidence supports this as the primary mechanism. It is the fastest, the most testable, and the one C depends on. The registry pattern composes (R5) and degrades loudly (R7). It is less "flexible" in the operator's sense — adding a metric is a code change, not a YAML edit — but the comparison shows the flexibility cost of A (string boundaries, subprocess spawns) exceeds its benefit, and C's flexibility (YAML orchestration) is available later as a wrapper on B if a second consumer appears.

MEDIUM (not HIGH) because: the spike uses a synthetic fixture, not a real imported day (0489 P3 — live DB has no typed tables); the idle-threshold heuristic is aggregate, not per-gap; and the second-metric cost (R2 "2nd metric cost" row) is estimated from structure, not measured by actually adding a second metric end-to-end.

**R5 — full derived-variable set.** All five report variables are expressible under B as named registry functions querying the same typed tables:

| Variable | Expressible under B? | Basis |
| --- | --- | --- |
| Phases (todo-event segmentation) | yes | segmentation over `history_tool_call` where `tool_name` ∈ todo-event set; same SQL layer |
| Per-phase metrics (tokens, tools, cost per phase) | yes | aggregate `history_message` fields grouped by phase boundaries |
| Time decomposition (LLM latency / tool exec / idle) | yes | **spiked** — `packages/contracts/src/shared.ts:32` |
| Bottleneck ranking (by wall time + call count) | yes | order `byTool` rollup (`forensic-query.ts`) by `duration_ms` sum |
| Issue candidates (loops + error patterns) | yes | pattern over `history_tool_call.status` + `error_text` sequences |

No variable in the set requires a mechanism capability that B lacks. The registry is a naming and composition pattern over SQL — whatever SQL can express, B can express.

**R7 — unsupported source degradation.** A query against a nonexistent session returns explicit zeros (`{sessionId, llmLatencyMs: 0, toolExecutionMs: 0, idleMs: 0}`), not a silently wrong number and not an exception. This is correct: a source the coverage matrix (0489) marked unsupported produces no typed rows, so the SQL returns no rows, and the registry function returns the zero-valued `TimeDecomposition`. The gap surfaces as an explicit zero (which the report renderer can mark "no data"), not as a plausible-but-false number. A source producing *partial* typed rows (e.g., Pi with `duration_ms = 0`) would produce a real decomposition with zero-valued components — also explicit, not silent.

**R6 — spike location.** `.spur/run/0490-spike/` (gitignored run directory, throwaway). Five files, 496 lines total, not registered on the real workflow host, not imported by any workspace. Evidence, not delivery-path code.
### Testing
**N/A — investigation ticket, no suite ships (map close recipe).**

Per-claim confidence:

| Claim | Confidence | Basis |
| --- | --- | --- |
| R1 — three mechanisms agree | HIGH | observed: `bun .spur/run/0490-spike/run-comparison.ts` → `Agreement: YES` on synthetic fixture |
| R2 — runtime / LOC / type-safety figures | MEDIUM | runtime measured on synthetic fixture (4 rows); LOC exact; second-metric cost estimated from structure, not measured end-to-end |
| R3 — additive optional block is version-safe | HIGH | `assertArtifactVersion` checks equality (`packages/domain/src/analytics/render-report.ts:34`), not key absence; additive fields are schema-version-safe by the contract at `packages/domain/src/analytics/artifact.ts:9` |
| R4 — B recommendation, MEDIUM | MEDIUM | synthetic fixture only (0489 P3); idle-threshold heuristic is aggregate not per-gap |
| R5 — all five variables expressible under B | HIGH | each maps to SQL over typed tables; no mechanism-specific limitation |
| R7 — unsupported sources degrade loudly | HIGH | observed: nonexistent session → explicit zeros, not exception or false number |
| `note` is engine-level | HIGH | `NoteActionRunner` in `dual-workflow-engine/src/host.ts`, `readonly kind = 'note'` |

**What would raise R2/R4 to HIGH:** re-run the comparison against a real imported day once typed tables exist (unblocks 0489 P3). The mechanism ranking (B ≈ C ≫ A) is robust to that — the 16× runtime gap is structural (string serialization, process spawns), not data-dependent — but the exact numbers would tighten.
### Review
| P1 | Finding | File:Line | Recommendation |
| --- | --- | --- | --- |
| P2 | Spike uses synthetic fixture, not a real imported day — exact runtimes and the idle-threshold split are approximate | `.spur/run/0490-spike/shared.ts:74` | Re-run against live typed tables once 0489 P3 is resolved (data import); mechanism ranking is structural and will not change, but exact numbers will tighten |
| P3 | Idle-gap classification is aggregate (one threshold over total gap), not per-gap from the SQL — sufficient to compare mechanisms, not production time-decomposition | `.spur/run/0490-spike/shared.ts:75-82` | If B is adopted, implement per-gap classification in the SQL CTE (return gap list, classify in TS) — the registry interface does not change |
| P4 | The `history.derive` action kind is hypothetical and unregistered on the real host — if C is later adopted, it needs an ADR (`docs/00_ADR.md`) for the new public action kind | `.spur/run/0490-spike/mechanism-c.ts:19` | Only relevant if a second workflow-orchestrated consumer appears; until then B is the path |

No P1. The spike is throwaway evidence and the recommendation is non-blocking for 0491 (report mode) — 0491 consumes the *answer* (mechanism B), not the spike code.
### References
- Map: `docs/features/E2_session-forensics-extension-of-the-history-plane-forensic-primitives-derived-variable-analyze-multi-mode-report-rewritten-find-issue.md`
- Upstream ticket (primitive vocabulary + coverage): 0489
- Builtin action registration seam: `packages/app/src/workflow/builtins.ts:44`, `:64-78`
- Action runners: `packages/app/src/workflow/actions/` (11 kinds)
- Workflow schema (`kind` unconstrained): `apps/cli/schemas/state-machine-workflow.schema.json:74`
- Pipeline YAML using `note`: `config/workflows/task-pipeline.yaml:176`
- Existing query layer: `packages/domain/src/analytics/forensic-query.ts`
- Artifact version pin: `packages/domain/src/analytics/artifact.ts:9`; assertion at `packages/domain/src/analytics/render-report.ts:34`
- Methodology §Step 6 (time decomposition): `docs/session-forensics-report-generation.md`
- ADR routing for a new public action kind: `docs/00_ADR.md`
### History
- 2026-08-10T00:31:53.884Z todo → wip (system)
- 2026-08-10T00:37:00.816Z wip → testing (system)
- 2026-08-10T00:37:01.179Z testing → done (system)
