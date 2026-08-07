---
template: feature-impl
schema_version: 1
name: "Source inventory: locate and characterize history output for pi, omp, agy, and grok"
description: ""
status: cancelled
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-08-06T23:09:53.868Z"
updated_at: "2026-08-06T23:29:58.841Z"
---

## 0456. Source inventory: locate and characterize history output for pi, omp, agy, and grok

### Background
**Wayfinder ticket** — type: `wayfinder:research`. Map: feature E1. Unblocked; runs independently
of 0455.

**The question:** For pi, omp, agy, and grok — where do transcripts live, what is the record shape,
and what does each carry for tool calls, timing, model, and usage?

**What is already known** (measured 2026-08-06; every agent dir under `$HOME` is a symlink into
`~/tools/dot_files/config/`, so probes must follow symlinks — `find -L`, not `find`):

| source | layout | `.jsonl` |
| --- | --- | --- |
| pi | `~/.pi/agent/sessions/--<slug>--/*.jsonl` | 1,237 |
| omp | `~/.omp/agent/sessions/<slug>/<ts>_<uuid>/*.jsonl` | 691 |
| grok | `~/.grok/sessions/<url-encoded-cwd>/<uuid>/*.jsonl` | 418 |
| agy | none found under `.antigravity` / `.antigravity-ide` / `.antigravity_tools` — 238 `.json` only | 0 |

None of pi's, omp's, agy's or grok's real layouts are reachable from `SOURCE_DEFINITIONS` today: omp
and grok and agy have no definition at all, and pi's `defaultRoots` are `['.pi/history', '.pi']`
where `.pi/history` does not exist.

**Sub-questions:**

- Per source: top-level keys, record types, and which types are conversational vs bookkeeping.
- Where tool calls appear, and how a call is paired with its result.
- What timing information exists — explicit durations or timestamps only.
- Model and token usage fields, and whether they are per-message or per-session.
- Session and turn identity: is it in the path, the record, or both? grok and omp encode the working
  directory in the path — does the record carry it too?
- **agy specifically:** does it emit line-delimited transcripts anywhere, or only structured `.json`?
  If the latter, is it importable by this pipeline at all, or does it need a different ingestion
  path? An honest "not JSONL, needs a separate decision" is a valid answer.
- Correct `defaultRoots` and `filePatterns` per source, narrow enough not to sweep non-transcript
  files (pi's current fallback matches 3,843 stray `*.json`).

**Resolved when** the task body carries a per-source field map covering the above, plus proposed
roots and patterns. Note where a source cannot supply something the forensic contract wants — that
constraint feeds 0455.

**Start from the canonical roster, not from guesses.** `@gobing-ai/ts-ai-runner`
`src/agents/shims.ts` already names every agent Spur supports and their commands — `agy` is
`antigravity-cli` (`:198`), `omp` and `grok` have shims (`:254`, `:282`). The importer's
`LlmJsonlSource` union is a second, drifted list. Whether the shim should also own history locations
is decided in 0462; this ticket supplies the facts that decision needs.

**Method:** read real files with `sp:source-driven-development` discipline. These formats are
undocumented and version-drifting; verify against files on disk, never from memory. Follow symlinks —
every agent dir under `$HOME` points into `~/tools/dot_files/config/`, and a plain `find` silently
reports zero.
### Requirements
- R1 — Produce a per-source field map for pi, omp, agy, and grok: top-level keys, record types, and which types are conversational vs bookkeeping.
- R2 — Locate tool calls in each format and establish how a call pairs with its result.
- R3 — Record what timing, model, and token-usage information each source carries, and at what granularity.
- R4 — Record how session and turn identity are expressed — in the path, the record, or both.
- R5 — Determine whether agy emits line-delimited transcripts at all; if it only emits structured `.json`, say so and flag it as needing a separate ingestion decision.
- R6 — Propose correct `defaultRoots` and `filePatterns` per source, narrow enough to exclude non-transcript files.
### Acceptance Criteria
```gherkin
Feature: 0456 wayfinder investigation

  Scenario: R1 — every in-scope source is characterized from real files
    Given transcripts on disk for pi, omp, agy, and grok
    When ticket 0456 is resolved
    Then the task body carries a per-source field map covering R1 through R4
    And the agy format question in R5 has a definite answer
    And proposed roots and patterns are stated per source
    And every claim cites a real file inspected, not remembered format knowledge
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

E1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-06T23:29:58.841Z todo → cancelled (system)
