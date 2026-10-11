---
schema_version: 1
name: Residuals from 1159
status: cancelled
template: standard
created_at: 2026-10-10T22:52:21.560Z
updated_at: "2026-10-11T03:04:23.146Z"

---

## 1166. Residuals from 1159

### Background

Source task: 1159 (feature H21) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:ba85cf0d — plugins/sp/hooks/hooks.json:33,88: The changed Claude hook files are not the runtime on the installed Claude path: `hooks.json` routes SessionStart/SessionEnd to `superskill hook run sp context-session-*`, and the installed superskill implements those runners in-CLI with its own `.session-<sha16>.json` pointer and no owner field, so the plugin's `.session.json` ownership never appears there. Pre-existing duplication (tasks 0398/0600); cross-repo and outside this task's declared scope. The Pi extension path (live via `plugin.json`) does exercise the fix.
- review-finding:815bf389 — plugins/sp/hooks/context-session-stop.ts:97,153: `findSessionEnd` dedups `session_end` by ledger id, but ids are minute-granular (`session-YYYY-MM-DD-HHMM`), so a new session started in the same minute as an already-ended one shares the id and receives no `session_end` row. Pre-existing id scheme; the dedup itself is frozen by the design's end algorithm.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Keep empty until requirements are known. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

Both residuals resolved inline (operator directive: no deferral to new task files), then cancelled.

- review-finding:815bf389 (session id collision): fixed at mint time at plugins/sp/hooks/context-session-start.ts:150 — ids are now `session-<date>-<HHMMSS>-<8 random hex>` (seconds + `randomUUID().slice(0,8)`), so a session started in the same minute an earlier one ended no longer shares the ledger id and gets its own `session_end` under the frozen end algorithm. Regression test "two sessions minted in the same minute get distinct ids and each closes once" at plugins/sp/hooks/context-hooks.test.ts:868; format assertions updated in plugins/sp/hooks/token-estimate.test.ts:294 and plugins/sp/hooks/pi/guard-extension.test.ts:314.
- review-finding:ba85cf0d (Claude path drift): fixed cross-repo in superskill at apps/cli/src/commands/hook-run.ts:278 (`resolveSpPluginScript`) and apps/cli/src/commands/hook-run.ts:309 (`loadSpPluginDelegate`) — the `sp/context-session-start|stop|post-tool` runners now delegate in-process (Bun dynamic import of the plugin's dependency-free TS) to the plugin's self-contained scripts resolved via `SPUR_PLUGIN_ROOT` → `CLAUDE_PLUGIN_ROOT` → newest Claude plugin-cache version, so the plugin's `.session.json` ownership gating (1159) becomes the single source of truth. All-or-nothing: missing/unloadable adapter exports fail open to the in-CLI runners, never a mixed pointer scheme. Tests in superskill apps/cli/tests/commands/hook-run.test.ts (delegation, all-or-nothing fallback, unloadable script, version ordering).

Deployment note: delegation activates on the installed Claude path once a spur plugin release containing the 1159 payload adapters (> 0.4.1) and a superskill release containing this change are published; until then the in-CLI fallback keeps current behavior.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-11T03:04:23.146Z backlog → cancelled (system)

