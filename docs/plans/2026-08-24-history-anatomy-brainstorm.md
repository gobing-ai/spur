---
title: "History anatomy: daily cache, ad-hoc diagnosis, and bounded migration"
date: 2026-08-24
topic: history-anatomy
run_id: 61e76806-3cbf-4523-b4ba-a6e304a9eac1
baseline_run_id: 7fa52fa5-acc8-4b52-b8e4-2d78071d76f2
needs_design: true
design_status: pending_operator_review
---

# Brainstorm: History anatomy

## Overview

Continue from the operator-approved discovery baseline rather than reopening broad repository
discovery. The feature introduces an independent `sp:history-anatomy` skill, immediately repoints
`/sp:dev-find-issue` to it, and keeps direct `sp:issue-finding` invocation available for a measured
coexistence window. The new capability is report-only: it analyzes already imported history,
produces a comprehensive cacheable daily report or a bounded ad-hoc investigation, and never turns
findings into tasks, rules, workflow edits, source changes, or process changes.

The recommended implementation uses a dedicated `history-anatomy.yaml` workflow. Existing
`spur history analyze` and `spur history report --mode forensics` remain the deterministic data
plane; the skill owns interpretation and the report contract; the workflow owns cache decisions,
stage ordering, bounded model calls, validation, and publication. `bun run load-history` and the
History UI's **Import & Analyze** path remain the independent import owners.

The binding direction is already operator-approved. This artifact records the concrete approach and
design for the idea-evaluation taste gate; it does not create a feature or tasks.

## Targeted Evidence Audit

The prior evaluation supplied the discovery baseline. Inspection was limited to evidence needed for
cache correctness, workflow ownership, and report completeness.

| Dimension | Existing evidence | Gap / decision |
| --- | --- | --- |
| Deterministic analysis | `HistoryArtifact` already contains selector, source coverage, totals, tools, sessions, loops, warnings, phases, time decomposition, per-step rankings, and cache waste. | Sufficient for the initial data plane. Do not add a new history verb or flag. |
| Provenance/freshness | Artifact has `generatedAt`, `spurVersion`, selector, per-source `lastImportedAt`, source status, and parse/validation counts. | Final report can carry explicit provenance and a normalized artifact digest without a new CLI surface. |
| Population coverage | `analyze --top` bounds `bySession` and `byTool`, but the forensics renderer prints `artifact.bySession.length` as total `Sessions`. | Concrete correctness gap: a daily report cannot claim complete session coverage from that number. Candidate additive artifact/template fix requires explicit operator surface consent. |
| Coverage rendering | The forensics Raw Data table omits `lastImportedAt`, parse errors, validation errors, sample overflow, and warning detail even though the artifact carries them. | Concrete template gap. Candidate additive rendering change is paired with the population fix; no new flag. |
| Baselines | `analyze` accepts explicit time bounds and output paths. | Run a second deterministic analyze over the previous comparable window; no analyzer change. |
| Root-cause detail | Aggregate artifacts identify repeated argument digests and tool error counts, but not every command/error narrative. | Treat unsupported causality as inference or telemetry gap. Do not restore raw JSONL parsing or expand the artifact speculatively. |
| Cache identity | Selector digest identifies scope but intentionally excludes corpus state; `generatedAt` changes on every analyze. | Compute a semantic SHA-256 over normalized artifact JSON, excluding only volatile generation fields. Add a corpus-version field only if this proves inadequate, after separate consent. |
| Workflow fit | Shipped workflows already compose deterministic shell/command actions, `agent.run`, `expectFile`, HITL, and run artifacts. | Complexity threshold is met: use one dedicated state-machine workflow and one small plugin-shipped cache/validation helper, not logic duplicated in prompts. |

**Verified:** 2026-08-24 against:

- [Prior idea evaluation](../../.spur/run/7fa52fa5-acc8-4b52-b8e4-2d78071d76f2-idea-eval-report.md)
- [History artifact schema](../../packages/domain/src/analytics/artifact.ts) (`HistoryArtifact`, `CoverageEntry`, selector digest)
- [Forensics renderer](../../packages/domain/src/analytics/render-forensics.ts) (bounded session count and Raw Data coverage table)
- [History service](../../packages/app/src/services/history-service.ts) (analyze, daily, artifact paths, explicit-path renderer)
- [History CLI](../../apps/cli/src/commands/history.ts) (`analyze`, `report`, `daily`)
- [Current command](../../plugins/sp/commands/dev-find-issue.md) and [legacy skill](../../plugins/sp/skills/issue-finding/SKILL.md)
- [Idea workflow](../../config/workflows/idea-pipeline.yaml) (`agent.run`, `expectFile`, HITL, run artifacts)
- [Import script](../../package.json) and [History UI](../../apps/web/src/modules/history/SourcesTab.tsx)

No external research or subprocess research escalation was needed.

## Approaches

### Approach 1: Workflow-owned diagnostic pipeline — Recommended

**Description:** Add `sp:history-anatomy` as the only owner of analysis semantics and report
structure. Its normal entry resolves arguments and launches a dedicated `history-anatomy.yaml`
workflow. The workflow probes the daily cache, generates current and comparison artifacts on a
miss, renders them through the existing forensics mode, invokes the skill's enrichment operation,
runs structural plus independent evidence validation, and publishes only a valid report.

`/sp:dev-find-issue` becomes a thin forwarder to the new skill. `sp:issue-finding` remains directly
invocable during the coexistence window but is no longer the command default.

**Trade-offs:**

- **Pros:** deterministic cache and validation decisions; one auditable run record; clean ownership
  between CLI data, skill judgment, and orchestration; bounded retries; no duplicated prompt logic.
- **Cons:** adds a workflow plus a small standard plugin script and internal skill operations; model
  enrichment remains only as good as the imported evidence.

**Implementation notes:**

- Reuse the existing `analyze` → explicit artifact → `report --mode forensics` seam.
- Use one dependency-free script for semantic digest, cache metadata checks, structural validation,
  and atomic publication. Ship its `.mjs` twin through the existing plugin-script contract.
- The workflow calls the same skill in explicit `enrich` and `validate` operations; those operations
  never launch another workflow, preventing recursion and keeping the report rubric single-sourced.
- One bounded correction pass is allowed after validation failure; a second failure terminates
  without replacing the last valid daily cache.

**Confidence:** HIGH

**Sources:** repository files in the Targeted Evidence Audit | **Verified:** 2026-08-24

### Approach 2: Skill-owned direct orchestration

**Description:** Keep the same modes, report contract, cache identity, and coexistence policy, but
have `sp:history-anatomy` execute every analyze/render/cache/publish step directly in the active
agent session. Do not add a workflow.

**Trade-offs:**

- **Pros:** fewer shipped files and no internal workflow invocation.
- **Cons:** cache branching and retry behavior live in prose executed by a model; validation and
  publication are less deterministic; run observability is fragmented; future command and direct
  skill invocations can drift.

**Implementation notes:** A helper script would still be necessary for safe cache validation and
atomic publication, so the file-count saving is mostly one YAML definition, not a simpler system.

**Confidence:** HIGH that it can work; MEDIUM that it remains reliable as the contract grows.

**Sources:** current `sp:issue-finding` four-phase prose protocol and existing workflow action
patterns | **Verified:** 2026-08-24

### Approach 3: Two-stage rollout, workflow after adoption

**Description:** Ship a direct skill and repointed command first, keep daily caching minimal, then
add the diagnostic workflow only after usage demonstrates the need.

**Trade-offs:**

- **Pros:** smallest initial launch and easier early editing of the report rubric.
- **Cons:** the operator-identified complexity is already present; cache validity, independent
  validation, and publication are not optional details. A later workflow would replace a temporary
  orchestration path and create avoidable migration work.

**Implementation notes:** Suitable only if the first release intentionally excludes daily caching
or evidence validation, which conflicts with the binding scope.

**Confidence:** HIGH that this is lower initial effort; LOW that it satisfies the approved feature.

**Sources:** binding requirements and existing idea/task workflow reliability patterns | **Verified:** 2026-08-24

## Recommendation

Use **Approach 1**. The workflow is justified by five independent responsibilities with different
failure semantics: cache decision, deterministic artifact generation/rendering, model enrichment,
evidence validation, and atomic publication. Keep all interpretation and rubric content in
`sp:history-anatomy`; the YAML coordinates operations and the helper performs only deterministic
file/hash/schema work.

Do not add a new `spur history` verb or flag. Request separate operator consent for one narrow
additive artifact/renderer correction identified by the audit:

**HA-S1 — public history artifact/template correction (recommended, consent pending):** add true
selection population counts plus the applied leaderboard depth to the analyze artifact; render
“top N of M” instead of treating a bounded array length as the total; add last-import and
parse/validation error columns plus warning detail to the existing forensics coverage section.
Approval of the idea alone does not grant HA-S1 consent.

If HA-S1 is declined, the feature still proceeds: the workflow uses a fixed bounded leaderboard,
labels it as bounded, and derives freshness from artifact JSON. It must not call the bounded length
the total population.

## Design Summary

### Decision and `needs_design`

`needs_design: true`. The feature introduces a new skill module and a state-machine workflow,
changes the `/sp:dev-find-issue` command contract, adds persistent cache semantics under
`docs/report`, spans command → skill → workflow → public history artifact boundaries, and defines a
bounded migration from an existing capability. The tie therefore leans design.

The design is deliberately small: no new package, dependency, database schema, transport DTO,
scheduler, UI path, template engine, public CLI noun, or automatic remediation surface.

### Operator surface

```text
/sp:dev-find-issue [--mode daily] [--date YYYY-MM-DD] [--recompute] [--agent <inline|auto|name>]
/sp:dev-find-issue "<focus>" --mode ad-hoc --since <RFC3339> --until <RFC3339>
                   [--agent <inline|auto|name>] [--output <path>]
```

- `--mode <daily|ad-hoc>` replaces `--full`; default is `daily`.
- `daily` is comprehensive and unfocused. It accepts an optional local calendar date; no date means
  today. `--since`, `--until`, focus text, and custom output are invalid in daily mode.
- `ad-hoc` requires non-empty focus plus both inclusive time bounds. It is bounded, never cached,
  and writes to the run directory unless `--output` is explicit.
- `--recompute` is daily-only and bypasses both deterministic and model-enrichment cache reuse.
- The command does not expose legacy source/session/category/severity/task-creation flags. The
  artifact itself still reports all selected sources and coverage.

### Ownership

- `/sp:dev-find-issue`: discoverability, argument hint, reviewer role, one skill invocation.
- `sp:history-anatomy`: mode validation, evidence policy, finding taxonomy, interpretation,
  comparison semantics, report contract, enrichment rubric, and evidence-validation rubric.
- `history-anatomy.yaml`: cache branch, deterministic stage ordering, executor dispatch, one bounded
  correction loop, terminal status, and publication sequencing.
- Cache helper: normalized artifact digest, metadata comparison, structural checks, and atomic file
  replacement only. It contains no finding or remediation logic.
- `spur history analyze`: DB-backed aggregation and versioned JSON artifact.
- `spur history report --mode forensics <explicit-path>`: deterministic rendering; never the mutable
  `latest.json` pointer.
- `bun run load-history` and History UI **Import & Analyze**: import/update ownership. The new skill
  never imports implicitly and never claims freshness beyond the imported snapshot.

### Workflow

```text
resolve scope
  → deterministic cache probe
      → valid daily hit: refresh validation provenance → publish/return
      → miss or --recompute:
          analyze selected window + previous comparable window
          → render explicit artifacts
          → model enrichment via sp:history-anatomy
          → deterministic structure gate
          → independent evidence validation
              → PASS: atomic publish
              → FAIL: one correction pass → PASS publish | terminal failure
```

No failed or partial candidate replaces a valid cached report.

### Daily cache contract

Default path: `docs/report/YYYY-MM-DD-history-anatomy.md`.

Cache identity is the tuple:

`(contract version, mode=daily, calendar date, timezone, normalized bounds, source scope)`.

Every report carries machine-readable frontmatter with:

- report contract version, mode, date, timezone, normalized inclusive bounds;
- `window_state: provisional|closed`, `generated_at`, and `validated_at`;
- source coverage/status and per-source `lastImportedAt`;
- current and baseline explicit artifact paths plus normalized semantic SHA-256 digests;
- Spur/schema version, skill digest, workflow digest, executor/model identity, and run id;
- cache disposition: `miss`, `hit`, or `forced-recompute`.

A daily cache is reusable only when all identity fields, contract/skill/workflow digests, and the
freshly analyzed semantic artifact digest match. Missing or malformed provenance, changed data,
changed report logic, changed timezone/bounds, degraded coverage, or a provisional→closed day
transition invalidates it. The candidate is regenerated before it can be presented as current.

Current-day semantics are strict:

- The range is local midnight through invocation time and is always labeled `provisional`.
- Every invocation reruns the deterministic cache probe against the imported DB. An unchanged digest
  may reuse model enrichment, but `validated_at` and the visible “imported snapshot as of” banner are
  refreshed; the report never claims the underlying source files were imported after their recorded
  timestamps.
- Once the local day closes, the next invocation analyzes the complete DST-aware calendar interval,
  changes `window_state` to `closed`, and invalidates any provisional cache.
- Late imports for a closed day alter the semantic digest and force regeneration.
- `--recompute` forces the full analyze/render/enrich/validate path even when the cache is valid.

### Comparison and finding contract

Daily mode compares the immediately preceding local calendar day. Ad-hoc mode compares the
immediately preceding equal-duration window and labels comparability limits. Missing or materially
different coverage produces `not comparable`, never an invented trend.

Every report contains:

1. Scope, provenance, normalized bounds, current-day state, cache disposition, and source coverage.
2. Executive summary with observations separated from interpretations.
3. Baseline comparison and explicit comparability verdict.
4. Findings table with stable key, category, impact, trend, observation, inference, confidence,
   contradictions, and evidence anchors.
5. Recurrence/regression ledger: `new`, `recurring`, `regressed`, `improved`, `resolved`, or
   `not-comparable`.
6. Telemetry gaps and unavailable dimensions.
7. Remediation options with owner surface, expected impact, verification method, and reversibility.
8. Performance analysis across wall time, LLM/tool/unattributed time, tool errors, tokens/cache,
   per-step outliers, and repeated work.
9. Workflow/process improvements, gated by either recurrence across two independent sessions or one
   explicit high-impact contract violation.
10. Positive patterns worth preserving, with the same evidence/confidence standard as problems.
11. Evidence ledger linking each quantitative claim to artifact fields/renderer sections and each
    repository-contract claim to repo-relative `file:line` evidence.

Finding categories are `reliability`, `repetition`, `workflow`, `performance`, `coverage`,
`telemetry`, and `positive`. Stable keys use `<category>:<owner-surface>:<signal>`; prose titles may
change without turning a recurring finding into a new one.

Evidence rules:

- An observation is directly present in an artifact or cited repository authority.
- An inference names its supporting observations. Causality needs two independent signals; one
  signal remains a hypothesis with a stated confirmation path.
- Confidence is `high`, `medium`, or `low` per finding, not one blanket report score.
- Contradictory signals are shown beside the finding and lower confidence; they are not silently
  reconciled.
- Unsupported values are `not available`, never zero and never omitted.

### Public history surface consent gate

The audit proves HA-S1 is useful but does not assume approval. Before implementation changes the
public artifact/renderer contract, present exactly two choices:

1. **Approve HA-S1 (recommended):** additive population/ranking metadata plus truthful freshness and
   error rendering in the existing `forensics` mode. No new verb or flag.
2. **Decline HA-S1:** keep public history output unchanged; the workflow labels leaderboards as
   bounded and reads existing JSON coverage fields for its own report provenance.

Any future request for command/error exemplars, a corpus-version field, or a new history flag is a
separate evidence-and-consent decision.

### Bounded coexistence and retirement

- Launch: create `sp:history-anatomy`; repoint `/sp:dev-find-issue`; keep direct
  `sp:issue-finding` available and documented as the legacy path. Do not copy its logic into the new
  skill.
- Parity means the retained report-only use cases have fixtures in the new contract: typed history
  analysis, daily and focused range selection, repeated-work/error reporting, evidence/confidence,
  remediation proposals, performance, process observations, and positive patterns. Raw JSONL and
  task creation are intentional exclusions, not parity gaps.
- Adoption evidence comes from successful workflow run records covering both modes and available
  source families, plus absence of unresolved high-impact correctness gaps. Do not add bespoke
  telemetry solely to count adoption.
- Review after one minor release or 30 days, whichever is later. Retire `sp:issue-finding` only with
  parity PASS, demonstrated use of both modes, no open high-impact regression, and explicit operator
  approval. If the gate fails, record the missing evidence and one dated extension; coexistence does
  not silently become permanent.
- Retirement is a separate change that removes the old skill/fixtures/references after the gate; it
  is not bundled into initial rollout.

### Preserved and removed surfaces

- Preserve `package.json`'s `bun run load-history` exactly as the source-local import+analyze path.
- Preserve History UI **Import & Analyze** and its queued refresh path.
- Remove `/sp:dev-history-load` and its plugin helper/twin from the capability surface because the
  supported import owners above remain. This is independent of report cache logic.
- Preserve `spur history analyze`, `report`, and `daily`. The history-anatomy workflow composes
  `analyze` and explicit-path `report`; it does not repurpose the import-owning `history daily` verb.

### Non-mutation boundary

Allowed writes are run-scoped intermediates, `spur history analyze` artifacts, and the requested
report/cache file. Reports stop at recommendations. The skill/workflow must not call task, feature,
rule, workflow-definition mutation, docs-process mutation, source edit, or import commands, and must
not auto-apply a remediation.

### Verification contract

- Command structure: `/sp:dev-find-issue` has one forwarded `sp:history-anatomy` invocation and the
  exact mode hint.
- Mode validation: daily/ad-hoc conflicts fail loud; daily defaults correctly; ad-hoc requires focus
  and two valid ordered bounds.
- Cache fixtures: hit, data change, logic digest change, malformed provenance, provisional→closed,
  late import, forced recompute, and failed candidate preserving the prior cache.
- Artifact path: analyze and report always share explicit run-scoped paths; no mutable latest pointer.
- Report contract: all required sections and per-finding fields; no placeholders; unsupported data
  is `not available`.
- Validation: an unsupported causal claim or missing evidence anchor fails the independent review;
  correction is capped at one.
- Boundary test: no raw JSONL/import/task/rule/workflow/source mutation recipes in the new skill or
  workflow.
- Preservation tests: `bun run load-history` and History UI trigger remain unchanged.
- Coexistence test: direct `sp:issue-finding` remains packaged while the command resolves to
  `sp:history-anatomy`.
- If HA-S1 is approved, artifact/renderer tests pin true population counts, bounded rankings,
  last-import/error rendering, and backward compatibility for pre-addition artifacts.

### Spec self-review

PASS — no placeholders, internal contradictions, unbounded cache claim, hidden import, automatic
remediation, or premature legacy retirement. Scope remains the skill, thin command, dedicated
workflow, report/cache contract, bounded coexistence, and removal of the obsolete slash loader while
preserving both supported import paths. Public HA-S1 remains explicitly consent-pending.

## Next Steps

1. Operator approves or rejects this idea evaluation and Design Summary.
2. Operator separately records `HA-S1 approved` or `HA-S1 declined`.
3. On approval, run `sp:sys-architecture` to freeze workflow states, cache metadata, internal skill
   operations, coexistence evidence, and the chosen HA-S1 boundary.
4. Then create/decompose the feature through the normal Spur idea pipeline; do not implement from
   this brainstorm artifact directly.

---

**Generated by:** `sp:brainstorm`
**Research execution:** inline targeted repository verification; no external research and no
subprocess escalation trigger.
