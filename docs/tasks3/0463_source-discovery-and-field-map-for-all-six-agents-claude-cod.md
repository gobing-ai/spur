---
template: feature-impl
schema_version: 1
name: "Source discovery and field map for all six agents: claude, codex, pi, omp, agy, grok"
description: ""
status: todo
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-08-06T23:30:12.554Z"
updated_at: "2026-08-06T23:32:28.778Z"
---

## 0463. Source discovery and field map for all six agents: claude, codex, pi, omp, agy, grok

### Background
**Wayfinder ticket** — type: `wayfinder:research`. Map: feature E1. Unblocked — this is the map's
entry point. Consolidates cancelled tickets 0456, 0458, and the discovery half of 0462.

**The question:** For all six in-scope agents — claude, codex, pi, omp, agy, grok — where do
transcripts live, what is the record shape, and what does each carry for tool calls, timing, model,
and usage?

**Why it is open.** Measured import yield is ~1% for claude and codex, 0.07% for pi, and zero for
sources with no definition at all. The loss is not one broken field: `ts-llm-jsonl-importer@0.4.19`
maps every source through a single flat `sourceDefinition` requiring top-level `content: string`,
while real transcripts nest their payload. Nothing downstream can be designed without a real field
inventory.

**Where transcripts live** (measured 2026-08-06 — every agent dir under `$HOME` is a symlink into
`~/tools/dot_files/config/`, so probes must follow symlinks: `find -L`, not `find`):

| source | layout | `.jsonl` |
| --- | --- | --- |
| claude | `~/.claude/projects/<slug>/<uuid>.jsonl` | 358 |
| codex | `~/.codex/sessions/…` | 1,336 |
| pi | `~/.pi/agent/sessions/--<slug>--/*.jsonl` | 1,237 |
| omp | `~/.omp/agent/sessions/<slug>/<ts>_<uuid>/*.jsonl` | 691 |
| grok | `~/.grok/sessions/<url-encoded-cwd>/<uuid>/*.jsonl` | 418 |
| agy | `~/.gemini/antigravity-cli/brain/<uuid>/.system_generated/logs/transcript{,_full}.jsonl` | 147 |

agy additionally keeps `~/.gemini/antigravity-cli/conversations/<uuid>.db` — 80 SQLite databases
keyed by the same session UUIDs. Whether the `.db` is a better source than the JSONL transcript is
part of this ticket.

**Sub-questions, per source:**

- Top-level keys, record types, and which types are conversational vs bookkeeping. For claude, one
  400-line sample showed `attachment` 158, `assistant` 131, `user` 64, `mode` 18, `last-prompt` 17,
  `file-history-delta` 4, `system` 3, `file-history-snapshot` 3, `ai-title` 2 — `attachment` alone is
  40% of lines. Codex needs the same census; its 221,911 validation errors are uncategorized.
- Where tool calls appear and how a call pairs with its result. Claude carries `toolUseID`,
  `sourceToolUseID`, and `toolUseResult` — establish the join concretely.
- Timing: explicit durations or timestamps only? Claude carries `durationMs` on some records —
  establish which, and whether it is reliable enough to build a report on.
- Model and token usage: per-message or per-session? Claude's `message.usage` carries
  cache-creation and cache-read counts plus a nested `iterations[]` array that can disagree with the
  top-level numbers.
- Session and turn identity: in the path, the record, or both? grok and omp encode the working
  directory in the path.
- `transcript.jsonl` vs `transcript_full.jsonl` for agy — what differs, which is authoritative.
- Correct `defaultRoots` and `filePatterns` per source, narrow enough to exclude non-transcript
  files. pi's current roots are `['.pi/history', '.pi']`; `.pi/history` does not exist, so the walk
  falls back to all of `~/.pi` and matches 3,843 stray `*.json`. Correct root: `.pi/agent/sessions`.
- Expected post-fix yield per source, so the contract in 0455 can be judged against a number.

**Also inventory the two ingestion paths** (facts only — the decision belongs to 0455):

- **Spur-launched runs.** `packages/app/src/workflow/actions/agent-run.ts:143` routes sessions into
  `.spur/run/<runId>/agent-sessions/<agent>/`; `discoverSessionId()` (`:408`) reads the id back.
  Already correlated to a `runId`. But only **pi and omp** honor `--session-dir`
  (`shims.ts:167,266`) — claude, codex, agy, grok ignore it.
- **Ambient history.** Everything run interactively, including the session that chartered this map.
  Where the volume is; no run correlation.
- Are `.spur/run/**` session dirs pruned or archived? If cleaned up, ingestion must run first.

**Registry facts to confirm.** `@gobing-ai/ts-ai-runner` `src/agents/shims.ts` is the canonical
roster — `agy` is `antigravity-cli` (`:198`), omp (`:254`) and grok (`:282`) have shims. The
importer's `LlmJsonlSource` union is a drifted second list missing omp, grok, and hermes.

**Resolved when** the task body carries a per-source field map covering every sub-question above,
proposed roots and patterns per source, the ingestion-path facts, and an expected post-fix yield.
Note explicitly where a source cannot supply something step forensics wants — those constraints are
0455's inputs.

**Method:** `sp:source-driven-development`. These formats are undocumented and drift between agent
versions (claude records carry a `version` field — check whether the shape changed under it). Sample
across projects and dates. Verify against files on disk, never from memory.
### Requirements
- R1 — Produce a per-source field map for all six agents (claude, codex, pi, omp, agy, grok): top-level keys, record types, and which types are conversational vs bookkeeping.
- R2 — Locate tool calls in each format and establish concretely how a call pairs with its result.
- R3 — Record what timing, model, and token-usage information each source carries, at what granularity, and whether nested usage disagrees with top-level counts.
- R4 — Record how session and turn identity are expressed in each source — in the path, the record, or both.
- R5 — Characterize agy both ways: the brain transcript JSONL (including transcript vs transcript_full) and the conversations SQLite store, and state which is authoritative.
- R6 — Propose correct defaultRoots and filePatterns per source, narrow enough to exclude non-transcript files.
- R7 — Inventory both ingestion paths as facts: Spur-launched run session dirs (including which sources honor --session-dir and whether those dirs are pruned) and ambient $HOME history.
- R8 — State the expected post-fix import yield per source, so the contract in 0455 can be judged against a number.
### Acceptance Criteria
```gherkin
Feature: 0463 wayfinder investigation

  Scenario: R1 — every in-scope source is characterized from real files
    Given transcripts on disk for claude, codex, pi, omp, agy, and grok
    When ticket 0463 is resolved
    Then the task body carries a per-source field map covering R1 through R4
    And agy is characterized in both its JSONL and SQLite forms
    And proposed roots and patterns are stated per source
    And both ingestion paths are inventoried as facts without deciding between them
    And an expected post-fix yield is stated per source
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
