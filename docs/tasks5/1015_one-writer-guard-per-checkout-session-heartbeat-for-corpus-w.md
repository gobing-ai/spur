---
schema_version: 1
name: "One-writer guard: per-checkout session heartbeat for corpus-writing agents"
status: cancelled
template: issue
created_at: 2026-09-30T13:44:22.688Z
updated_at: "2026-09-30T14:35:00.639Z"
feature_id: A9

ac_numbering: task-local
ac_altitude: task-local
---

## 1015. One-writer guard: per-checkout session heartbeat for corpus-writing agents

### Background

Filed from the A9 post-batch review (open issue O1 + improvement I2). On 2026-09-30 06:14–06:35 PDT two agent sessions worked the SAME checkout concurrently: a re-verify pass editing `docs/tasks5/1000–1007` (evidence rewrites, committed as `afa6a073a`) plus script-root source edits, while the reviewing session held read-only discipline by hand. One-writer-per-tree is a CRITICAL rule (AGENTS.md) but had no detection surface — the collision was caught only by manual observation (dirty count 13→14 during a 60s watch; task-file mtimes 06:20:47–48; `dist/web/*` rebuilt >06:21). Silent mutual overwrite is the failure mode the rule exists to prevent; prose alone does not detect it.

### Requirements

- [ ] R1. Corpus-writing CLI verbs (`spur task create/update`, `spur feature …`) refresh a heartbeat file `.spur/run/session-lock.json`: `{pid, sessionId, hostname, updatedAt, verb}`.
- [ ] R2. Before writing, the verb checks the heartbeat: another LIVE pid (liveness via `process.kill(pid, 0)`; EPERM counts as alive) that updated within N seconds (default 120) triggers a WARN on stderr naming the other session (advisory default).
- [ ] R3. Opt-in block mode (env/config, e.g. `SPUR_ONE_WRITER=block`) denies the second writer with non-zero exit and the same message.
- [ ] R4. Stale heartbeats (pid dead, or older than N) are overwritten silently — no lockfile deadlock; a heartbeat from a different hostname cannot be liveness-checked and is treated as potentially live (warn, never silently overwrite).
- [ ] R5. Heartbeat writes are atomic (tmp + rename) and safe under concurrent writers.
- [ ] R6. `spur agent status` (existing status surface) shows active-writer info when a live heartbeat exists.
- [ ] R7. Advisory default adds no behavior change for single-writer flows (one small file write per corpus write).
- [ ] R8. Unit tests: fresh/stale/dead-pid/foreign-hostname/block-mode paths with tmp-dir fixtures.

### Acceptance Criteria

- [ ] AC1 — Two concurrent writers produce a warning naming the other session (req: R1, R2, R8)
- [ ] AC2 — Stale or dead-pid heartbeats never block a writer (req: R4, R8)
- [ ] AC3 — Block mode denies the second writer with non-zero exit and message (req: R3, R8)
- [ ] AC4 — Single-writer flows behave unchanged (req: R7, R8)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. Heartbeat module in packages/app (corpus services home): read/check/write/atomic-rename helpers.
2. Wire refresh + pre-write check into task/feature write paths (single choke point per verb if one exists; otherwise both).
3. Liveness helper with the EPERM-is-alive and foreign-hostname rules (R4).
4. Block mode via env/config read in the same check (R3).
5. Status surface row (R6) — smallest existing surface that can host it.
6. Unit tests (R8) + a manual two-terminal repro recorded in Testing.
7. One-paragraph doc note in plugins/sp README; AGENTS.md conventions get a pointer only (no restated rule).

### Root Cause

The one-writer rule existed as prose only. No runtime signal distinguished "another session is writing NOW" from "the tree happens to be dirty", so the violation was detectable only through manual mtime/dirty-count observation — which happened by diligence, not by design.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

- Unit tests per R8 (fresh/stale/dead/foreign-hostname/block).
- Manual repro: two terminals, second `spur task create` → warning text names session 1; with block env → non-zero exit.
- Advisory mode regression: normal single-session task create/update unaffected.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Observation log: dirty 13→14 during 60s watch 06:26:47–06:27:47 PDT; task mtimes 06:20:47–48; commit `afa6a073a` 06:35.
- AGENTS.md conventions: one-writer-per-working-tree (CRITICAL).
- Session identity source: existing spur session/self surface (pick the id already used by run records).

### History

- 2026-09-30T14:35:00.639Z todo → cancelled (system)

