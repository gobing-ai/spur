---
topic: dev-history-load slash command (cumulative history import + analyze)
date: 2026-08-15
needs_design: false
run_id: 25da545c-dcd1-4fac-85ea-58d1042e36f2
---

# Brainstorm: `/sp:dev-history-load`

## Overview

Proposal: a slash command that loads all conversation history into the database and runs the
relevant analysis (`spur history import` + `spur history analyze`), with a **cumulative** import —
only newly added conversation data loads on each run. Use cases: (1) ad-hoc investigation right
after a conversation, (2) periodic import + analysis.

Discovery found the pipeline already exists at the CLI layer: `spur history daily` (task 0470 R6)
is exactly import-all (fan-out, per-source isolation) → analyze → artifact → 90-day prune, with
checkpoint resume making imports cumulative, additive, and self-healing. `import --mode
incremental` also exists. So the idea is not "build the pipeline" but "surface a discoverable
command that converts intent into the right sequence" — and it must not duplicate `daily`.

## Approaches

### Approach 1: On-demand load+analyze command with narrowing ⭐ Recommended

**Description:** `plugins/sp/commands/dev-history-load.md` wraps the existing CLI verbs in a
reliable sequence: `spur history import` (cumulative via checkpoint resume, `--source` passthrough)
→ `spur history analyze` (passthrough `--session`/`--task`/`--since`/`--until`/`--source`) →
optional `spur history report --mode forensics` render. Bare invocation = full-window load+analyze
(periodic users keep `spur history daily`); narrowed invocation (`--session <stem>` after a
conversation) = post-conversation investigation.

**Trade-offs:**
- **Pros:**
  - Single discoverable surface in the `/sp:dev-*` family; intent→sequence conversion (ADR-016).
  - Cumulative contract comes free from checkpoint resume — zero new import logic or state.
  - Narrowing composes with `analyze`'s native filters; `--json`/`--dry-run` for automation and
    safe preview.
- **Cons:**
  - Two usage modes grow the flag surface; must document the `daily` boundary explicitly.
  - Maintenance (command doc, plugin tests, flag-glossary conformance) for a convenience wrapper.

**Implementation Notes:**
- Sequence invariant: import must precede analyze; fail loud with the CLI exit code.
- `--dry-run` → `import --dry-run` (scans without persisting); no analyze on dry-run.
- No new skill required — model-bearing analysis delegates to existing `sp:issue-finding` if ever
  needed; default output is the CLI summary / forensics render.

**Confidence:** HIGH
**Sources:** live CLI help (`spur history import/analyze/daily --help`, verified 2026-08-16);
`plugins/sp/skills/issue-finding/SKILL.md` (checkpoint resume); `plugins/sp/commands/dev-find-issue.md`
(data-plane-first, no import preflight); AGENTS.md (spur-cli surface).

### Approach 2: No new command — import preflight on `/sp:dev-find-issue` + document `daily`

**Description:** Close the actual gap (find-issue assumes the data plane is loaded) by adding an
import preflight to `/sp:dev-find-issue`; point periodic users at the existing `spur history daily`
verb. No new surface at all.

**Trade-offs:**
- **Pros:** Zero new command surface; fixes the real integration gap; periodic is already solved.
- **Cons:** No named `dev-history-load` command (the explicit ask); ad-hoc session narrowing still
  requires raw CLI flags; import stays implicit.

**Confidence:** HIGH — same evidence as Approach 1.

### Approach 3: Minimal forwarder — `/sp:dev-history-load` runs `spur history daily`

**Description:** A thin command that invokes `spur history daily` (plus `--since`/`--until`) and
prints the result. Smallest diff.

**Trade-offs:**
- **Pros:** ~20 lines; cumulative guarantee native; prunes old reports.
- **Cons:** Bare forwarder per ADR-016 — adds discoverability but no sequence value; use case 1
  (session-scoped ad-hoc) unsupported without analyze narrowing; duplicates a documented CLI verb's
  surface.

**Confidence:** HIGH

## Recommendations

Adopt **Approach 1**, explicitly scoped: the command owns *load now + analyze (optionally
narrowed)*; the periodic cadence stays on `spur history daily` (already prunes and self-heals).
This preserves the idea's two use cases while avoiding duplicate pipeline surface. If zero new
surface is preferred, Approach 2 delivers most of the ad-hoc value at lower cost.

## Next Steps

- Feature-create via `/sp:dev-idea` (or task batch) with: command file, flag-glossary conformance,
  `--dry-run`/`--json`, plugin structure test (R-series), docs note that periodic = `spur history
  daily`.
- Decide the `daily` boundary wording in the command description (bare run = full window, not a
  daily scheduler).

## Design Summary

Single-file addition to the plugin surface, existing pattern (command wraps existing CLI verbs —
cf. `/sp:dev-find-issue`, `/sp:dev-daily`). No schema/config/DTO change, no new package, service,
dependency, transport, or boundary; the cumulative-import requirement is inherited from the shipped
checkpoint-resume contract (task 0470), so no import logic is designed here.

- **Shape:** `plugins/sp/commands/dev-history-load.md` with `[--source <…>] [--since <iso>]
  [--until <iso>] [--session <id>] [--task <wbs>] [--report <mode>] [--dry-run] [--json]`.
- **Sequence:** import (cumulative, checkpoint-resumed) → analyze (narrowed) → optional
  `report --mode forensics` render. Import-before-analyze is the only ordering invariant.
- **Behavior:** no narrowing flags = full-window load+analyze; `--dry-run` scans without
  persisting and skips analyze; `--json` emits machine-readable results; failures propagate the CLI
  exit code (fail loud, no silent fallback).
- **Delegation boundary:** periodic cadence, report pruning, and missed-night self-healing remain
  owned by `spur history daily`; the command never re-implements them.
- **Self-review:** no placeholders; scope limited to load+analyze surface; no ambiguity left for
  decompose (every flag maps 1:1 to a documented CLI verb option).
