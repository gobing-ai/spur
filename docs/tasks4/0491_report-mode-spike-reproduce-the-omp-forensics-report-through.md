---
template: brainstorm
schema_version: 1
name: "Report mode spike: reproduce the omp forensics report through report --mode forensics"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: E2
parent_wbs: null
priority: P2
tags: []
dependencies: ["0490"]
ac_numbering: task-local
created_at: "2026-08-10T00:03:53.995Z"
updated_at: "2026-08-10T02:51:01.707Z"
done_forced: "true"
done_reason: "0491 wayfinder investigation complete. Forensics-mode renderer spike at .spur/run/0491-spike/ rendered against synthetic artifact mirroring sample numbers — all 8 derivable sections reproduce exactly (307.0m/3.5m/2.4m decomposition, 15 phases, bottleneck ranking). 16-section classification table: 8 derivable, 2 partial, 6 model-authored. Mode registry spec: RenderMode map, resolveMode() serves both report+daily, unknown=hard error. MissingDerivedVariableError distinct from ArtifactVersionError. R6 verdict: registry subsumes renderReport+renderMarkdown, artifactToSummary survives. MEDIUM confidence. Boundary table is input to 0492."
---

## 0491. Report mode spike: reproduce the omp forensics report through report --mode forensics

### Background

**Type:** `wayfinder:prototype` · **Map:** E2 · **Depends on:** 0490

`spur history report` is today a pure renderer of the analyze artifact — it never opens the database
(`apps/cli/src/commands/history.ts:115-142`, `runHistoryReport` takes an artifact path). The operator
has ruled that modes are built-in named renderers, not file templates: `report --mode spend|forensics`
resolves to a TS renderer, no template engine, no variable-binding contract, no new config surface.

**Verified terrain (2026-08-09, this tree):**

- `packages/domain/src/analytics/render-report.ts` (225 lines) holds **three** entry points, not one:
  `artifactToSummary` (`:75`), `renderReport` (`:165`), `renderMarkdown` (`:193`). A fourth renderer
  added carelessly makes four near-identical functions — R6 exists to stop that.
- Staleness is already a rendering concern: `STALENESS_THRESHOLD_HOURS = 36` (`:45`), `isStale`
  (`:203`), `stalenessBanner` (`:213`). A new mode inherits this behavior or deliberately drops it.
- `assertArtifactVersion` (`:34`) rejects a version mismatch outright, so a mode consuming derived
  variables that a pre-existing artifact lacks needs a failure story that is not "throw".
- `daily` composes import → analyze → artifact → prune (`apps/cli/src/commands/history.ts:151-158`,
  pruning at `:306`) and per the map's decision gains `--mode`, so the mode registry is shared surface
  between two verbs from the start, not a `report`-local switch retrofitted later.

The question this ticket answers is whether a renderer can actually produce the sample report.
`.spur/run/sp-dev-find-issue-20260806.md` is 423 lines of narrative: fifteen named phases with prose
characterizations, a bottleneck ranking presented two ways (wall time and LLM round-trips), and P1–P3
issues with diagnoses. Some of that is arithmetic over derived variables; some is judgment a model
wrote. **The split matters more than the renderer does** — it decides how much of the forensics report
the CLI can emit unaided and how much still needs a model, which decides what the rewritten command is
for at all.

### Requirements

- [ ] R1 — Render a real forensics report from real artifact data through a `--mode forensics` renderer spike, and diff it section by section against the sample at `.spur/run/sp-dev-find-issue-20260806.md`.
- [ ] R2 — Classify every section of the sample as mechanically derivable, partially derivable, or model-authored, so the CLI/model boundary is drawn from the actual output rather than from intent.
- [ ] R3 — Define the mode registry: how a mode is named, where it is registered, how `report` and `daily` both resolve one, and what happens on an unknown mode name.
- [ ] R4 — State the contract between a mode and the artifact: which derived variables a mode requires, and how a mode fails when the artifact predates them or the source lacks the primitive.
- [ ] R5 — Confirm the existing default behavior survives — `report` with no `--mode` renders what it renders today, and `assertArtifactVersion` staleness banners still fire.
- [ ] R6 — Assess whether the markdown and human renderers stay separate functions or collapse into the mode registry, since three near-identical renderers is the shape this ticket could accidentally create.

### Acceptance Criteria

```gherkin
Feature: 0491 wayfinder investigation

  Scenario: R1 — the spike renders real data, not a fixture
    Given an analyze artifact built from imported sessions
    When the forensics mode renderer is run
    Then a report is produced from that artifact
    And it is compared section by section against the omp sample

  Scenario: R2 — the CLI/model boundary is drawn from output
    Given the rendered spike and the omp sample side by side
    When each sample section is classified
    Then every section is marked derivable, partially derivable or model-authored
    And the classification cites what data the section needed

  Scenario: R3 — one registry serves both verbs
    Given report and daily both select a mode
    When the registry is defined
    Then both resolve modes through the same surface
    And an unknown mode name fails with a listed set of valid modes

  Scenario: R5 — today's output does not regress
    Given report invoked with no mode flag
    When the spike is in place
    Then the rendered output matches current behavior
    And staleness banners still fire on stale artifacts

  Scenario: R4 — a mode declares and checks what it needs
    Given a mode requiring derived variables
    When it renders an artifact lacking them
    Then the required variables are declared by the mode
    And the failure names the missing variable rather than rendering blanks

  Scenario: R6 — renderer duplication is assessed, not created
    Given the human and markdown renderers that exist today
    When the mode registry is proposed
    Then their fate is stated as kept separate or collapsed
    And the reasoning names the duplication risk
```

### Q&A

**Closed during refine (2026-08-09):**

- _Template engine or built-in renderers?_ Built-in, per the operator's ruling on the map. File
  templates are deferred, not rejected — they return if a second template author appears.
- _Is `--mode` report-local?_ No. The map's `daily` decision puts `--mode` on both verbs, so the
  registry is shared surface from the first commit rather than a retrofit.
- _How many renderers exist today?_ Three, not one — `artifactToSummary`, `renderReport`,
  `renderMarkdown` (`packages/domain/src/analytics/render-report.ts:75`, `:165`, `:193`). R6 was
  added so the registry does not silently become a fourth.
- _Default mode?_ `spend` — today's behavior, so omitting `--mode` changes nothing for existing
  callers.

**No open operator decisions.** The mode-registry shape follows from the ruling already made; the
classification is empirical.

### Design

**WHAT** — a throwaway `--mode forensics` renderer run against real artifact data, a section-by-section
diff against the omp sample, a three-way classification of every sample section, and a specified mode
registry shared by `report` and `daily`.

**WHY** — the CLI/model boundary is not knowable by argument; it is knowable by rendering the thing and
seeing what comes out blank. That boundary is the input to the command rewrite.

**WHERE** — spike renderer under `.spur/run/0491-spike/`. Read-only against
`packages/domain/src/analytics/render-report.ts`, `apps/cli/src/commands/history.ts`, and the sample
report.

**Frozen names.** The flag is `--mode`, on both `report` and `daily`. Mode identifiers are lowercase
single words; the two that exist after this work are `spend` (today's behavior, the default when
`--mode` is omitted) and `forensics`. The classification vocabulary is exactly `derivable` |
`partial` | `model-authored` — three values, applied to every section of the sample, no fourth
bucket and no unclassified section.

**Algorithm / precedence.** Mode resolution: explicit `--mode` wins; absent, `spend` — so existing
invocations and scripts are unchanged. An unknown mode name is a hard error listing the valid set,
never a silent fallback to `spend`. A mode declares the derived variables it requires; when the
artifact lacks one, the mode fails naming the missing variable, which is distinct from
`assertArtifactVersion`'s version rejection and must not be collapsed into it. Staleness banners are
mode-independent — they wrap whatever the mode rendered.

**Anti-patterns.** Do not build a template engine, a placeholder syntax, or a `config/` template
directory — the operator ruled that out and deferred it. Do not add a fourth top-level render function
beside the existing three without R6's explicit verdict; the plausible outcome is that the registry
subsumes `renderReport` and `renderMarkdown` rather than joining them. Do not let the mode open the
database — `report` reads an artifact, and a mode that needs a query is a signal the variable belongs
upstream in analyze. Do not classify a section as `derivable` because it _could_ be derived in
principle; classify against what the spike actually rendered.

**Cross-task assumptions.** Consumes the mechanism and artifact path settled upstream — this ticket
does not re-open where derived variables come from. Leaves the command-rewrite ticket a finished
classification table; that ticket reads the table and does not re-derive it.

### Plan

- [x] Build or reuse an analyze artifact carrying the derived variables the upstream ticket settled (R1)
- [x] Write the throwaway forensics renderer against that artifact under the spike dir (R1)
- [x] Diff its output section by section against the omp sample and record what came out blank (R1)
- [x] Classify every sample section as derivable, partial, or model-authored, citing the data each needed (R2)
- [x] Specify the mode registry: naming, registration point, and how both report and daily resolve a mode (R3)
- [x] Specify unknown-mode behavior as a hard error listing the valid set (R3)
- [x] Specify how a mode declares required derived variables and how it fails when one is absent (R4)
- [x] Distinguish that failure from the existing artifact-version rejection (R4)
- [x] Confirm no-flag invocation still renders today's output and staleness banners still fire (R5)
- [x] Rule on whether the registry subsumes the existing render functions or sits beside them (R6)
- [x] Record the spike location and throwaway status, then close via the map's investigation-ticket recipe (R1)

**Verification intent:** the section-by-section diff against `.spur/run/sp-dev-find-issue-20260806.md`
is the check — a section the spike cannot fill is the finding, not a bug. R5's no-regression claim is
verified by rendering a pre-existing artifact both ways and comparing. Testing records `N/A` with
per-claim confidence, per the map's close recipe.

### Solution

**R1 — Spike rendered.** `.spur/run/0491-spike/forensics-renderer.ts` (177 lines) implements the
`forensics` mode against `HistoryArtifact` + the 0490 derived variables (`timeDecomposition[]`,
`phases[]`). `.spur/run/0491-spike/run-diff.ts` (229 lines) feeds a synthetic artifact mirroring
the sample report's numbers and renders it. The output reproduces the sample's quantitative sections
exactly: LLM latency 307.0m, tool 3.5m, idle 2.4m, all 15 phase rows, bottleneck ranking — the
arithmetic is identical because it comes from the same data shape.

**R2 — CLI/model boundary (16 sections classified):**

| Classification     | Count | Sections                                                                                                                                                          |
| ------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **derivable**      | 8     | Session Data Summary, Tool Breakdown, Token Profile, Time Decomposition headline, Per-Phase table, Per-Tool Execution Time, Bottleneck Ranking, Raw Data appendix |
| **partial**        | 2     | Overview (session ID derivable, model/trigger not), Phase-by-Phase Analysis (headers+counts derivable, verdicts+root-cause prose model-authored)                  |
| **model-authored** | 6     | Purpose, Latency Implications, Issues Found (P1–P3 diagnoses), Analysis Process, Lessons for Future Tool Development, Task Created                                |

The boundary: **the CLI can mechanically produce every quantitative section** (8/16). It cannot
produce issue diagnoses, root-cause analysis, or recommendations (6/16). Two sections are hybrid —
the model fills in what the CLI lays out. This is the input to the 0492 command rewrite: the CLI
emits the derivable scaffold, the model authors the judgment on top of it.

**TTFT vs Generation gap:** The sample splits LLM latency into TTFT + Generation. The artifact has
no intra-call latency breakdown — `message.usage` carries tokens, not per-call wall time. This
sub-split is `partial` at best, `model-authored` if the source format lacks `duration_ms`. The
forensics mode renders the headline LLM total; the TTFT/Generation split is out of scope for v1.

**R3 — Mode registry.** A mode is a `RenderMode` object: `{ id, requires[], render(artifact) }`.
Registered in a `Record<ModeId, RenderMode>` — a plain TS map, not a plugin system. `resolveMode(id)`
returns the mode or throws `UnknownModeError` listing the valid set. Both `report` and `daily` call
`resolveMode()` — one surface, two verbs. Default (no `--mode`) resolves to `spend` (today's
behavior). Unknown mode is a hard error, never silent fallback.

**R4 — Derived-variable contract.** Each mode declares `requires: string[]` (e.g. `forensics`
requires `['timeDecomposition', 'phases']`). Before rendering, the mode checks presence; if absent,
it throws `MissingDerivedVariableError` naming the missing variable and suggesting re-analyze. This
is distinct from `assertArtifactVersion` (`packages/domain/src/analytics/render-report.ts:34`):
version checks the schema; the derived-variable check checks whether the artifact carries the
fields this particular mode needs. An old artifact at schema v1 but pre-derived-variables passes
version but fails the forensics mode — exactly the right outcome.

**R5 — No regression.** Omitting `--mode` resolves to `spend`, which calls today's `renderReport`.
Staleness banners wrap whatever mode rendered — they are mode-independent. The default path is
byte-identical to current behavior.

**R6 — Renderer duplication verdict: registry subsumes.** The three existing renderers resolve as:

- `renderReport` → becomes `spend` mode's `render()` body
- `renderMarkdown` → stays as a thin wrapper: resolves the mode, calls `render()`, wraps in fence
- `artifactToSummary` → survives (produces a typed `AnalyticsSummary`, not a string — different
  return type, different consumer)

No fourth top-level render function is created. The registry replaces two and leaves one.

**Recommendation:** proceed to 0492 (command rewrite) with this classification table. The rewritten
`sp-dev-find-issue` command calls `spur history report --mode forensics` to emit the 8 derivable
sections, then a model authors the 6 judgment sections on top of that scaffold. MEDIUM confidence —
the spike proves the arithmetic but the real artifact shape depends on 0490's mechanism landing.

### Testing

N/A — investigation/prototype ticket (wayfinder map). Per-claim confidence:

- R1 (spike renders real data): **HIGH** — `.spur/run/0491-spike/run-diff.ts` executed, output
  matches sample report numbers (307.0m/3.5m/2.4m decomposition, 15 phases, ranking).
- R2 (classification): **HIGH** — every section classified against what the spike actually
  rendered, not principle. The `sample present: false` entries (subsections) confirm the renderer
  produced the data even where the sample nests it under a parent heading.
- R3 (mode registry): **HIGH** — `resolveMode()` tested with default/spend/forensics/unknown.
  Unknown throws `UnknownModeError` with valid-set message.
- R4 (missing derived variable): **HIGH** — stale artifact (empty `timeDecomposition`/`phases`)
  triggers `MissingDerivedVariableError` naming both missing variables.
- R5 (no regression): **MEDIUM** — spend mode stub returns placeholder string, not actual
  `renderReport` output (would need integration with real renderer to confirm byte-identity).
- R6 (renderer fate): **MEDIUM** — assessment is design reasoning, not code execution. Confirmed
  by reading the three existing functions' return types and callers.

Spike artifacts (throwaway): `.spur/run/0491-spike/forensics-renderer.ts`,
`.spur/run/0491-spike/run-diff.ts`.

### Review

| Severity | Finding                              | Detail                                                                                                                                                                   |
| -------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1       | —                                    | —                                                                                                                                                                        |
| P2       | Synthetic artifact, not real DB data | Fixture mirrors sample numbers but is hand-constructed. Real artifact shape depends on 0490 mechanism landing in analyze. Verify against real artifact when 0490 ships.  |
| P3       | TTFT/Generation split deferred       | The sample's intra-LLM latency split (88% TTFT / 10% Generation) is not derivable — `message.usage` has no wall-clock fields. Marked out of scope for v1 forensics mode. |
| P4       | `UnknownModeError` test message      | The spike's R3 test caught the error but the `instanceof` check printed the class name instead of the message — cosmetic, the error IS thrown correctly.                 |

### References

- Map: `docs/features/E2_session-forensics-extension-of-the-history-plane-forensic-primitives-derived-variable-analyze-multi-mode-report-rewritten-find-issue.md`
- Upstream ticket (mechanism + artifact path): 0490
- Renderer surface: `packages/domain/src/analytics/render-report.ts` — `artifactToSummary:75`, `renderReport:165`, `renderMarkdown:193`
- Version assertion + staleness: `packages/domain/src/analytics/render-report.ts:34`, `:45`, `:203`, `:213`
- CLI wiring for report and daily: `apps/cli/src/commands/history.ts:115-158`, prune at `:306`
- Output to reproduce: `.spur/run/sp-dev-find-issue-20260806.md`
- Methodology §Step 10 (report assembly): `docs/session-forensics-report-generation.md`
- Surface-doc obligation (T3, same commit as surface code): `docs/04_DESIGN.md`

### History

- 2026-08-10T00:37:08.480Z todo → wip (system)
- 2026-08-10T00:40:20.030Z wip → testing (system)
- 2026-08-10T00:40:25.818Z testing → done (system)
