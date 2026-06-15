---
name: "W3: task-write-guard hook and resolve/info decision"
description: "W3: task-write-guard hook and resolve/info decision"
status: Done
created_at: 2026-06-13T01:08:18.985Z
updated_at: 2026-06-15T04:04:51.192Z
folder: docs/tasks
type: task
feature-id: H2
priority: P1
tags: ["rd3-migration","wave-3"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0067. "W3: task-write-guard hook and resolve/info decision"

### Background

Design §12.3, F04 + delivery doc §1.3 TBD. Pure delegation; SPUR_WRITE_GUARD=off escape hatch.


### Requirements

R1. PreToolUse hook: path → resolve → owned? → post-edit check; deny with findings on hard failure.
R2. Decide task info/feature info (one-call path→frontmatter) vs resolve+show composition; record decision + sync delivery doc.
R3. Hook contains zero logic beyond delegation.


### Q&A



### Design

Authority: design §12.3 hook contract (PreToolUse: path → `spur task resolve` → if owned →
`spur task check` post-edit state → deny with findings on hard failure; **pure delegation, zero logic**;
`SPUR_WRITE_GUARD=off` escape hatch), F04. This task also settles the delivery doc §1.3 TBD: `spur task
info` / `spur feature info` (one-call path→frontmatter JSON) vs `resolve` + `show --json` composition —
measured by what the hook actually needs (subprocess count, latency).


### Solution

Built the ownership write-guard hook (R1/R3) and settled the R2 decision; synced the docs same-commit.

**Hook** (`plugins/sp/hooks/task-write-guard.ts`, registered in `plugins/sp/hooks/hooks.json`):
- PreToolUse on `Write|Edit`. Reads the `{tool_name, tool_input:{file_path}}` stdin payload, walks up
  from `CLAUDE_PROJECT_DIR` to the in-repo `apps/cli/src/index.ts` (avoids the stale global `spur`),
  and shells `spur task resolve <path> --json`. Exit 0 (owned) → **deny** with a message steering to
  `spur task update …`; non-zero (not owned) → **allow**. `SPUR_WRITE_GUARD=off` short-circuits to
  allow before any subprocess. Emits the PreToolUse JSON (`hookSpecificOutput.permissionDecision`)
  and always exits 0 so a guard hiccup never wedges the agent (fail-open on malformed input too).
- R3: zero validation logic — ownership is decided entirely by the CLI's exit code (file:line at
  `plugins/sp/hooks/task-write-guard.ts:85` is the sole delegation point).

**R2 decision — `task info`/`feature info` rejected.** The hook's only need is *is this path owned?*,
which `spur task resolve` answers in one call; it never reads frontmatter. A one-call `info` verb
would collapse no subprocesses, so it earns no surface. Recorded in delivery §1.3 + design §16.

**Scope decision — ownership-only, check-gating deferred.** Design §12.3 also called for a post-edit
`spur task check` gate, but `check` enforces the DD-07 schema (schema_version:1, lowercase status)
while the live corpus is still rd3-dialect (title-case, no schema_version) — `check` fails 100% of
`docs/tasks/*.md` today, so gating on it would block every legitimate edit. Shipped ownership-only;
the check delegation is the documented next step once the corpus migrates (design §12.3 amended).
Also corrected the now-stale forward-ref in `task-service.ts` resolve() (it claimed 0067 would add
walk-up-to-nearest-owner; 0067 shipped ownership-only and did not).


### Plan

- [x] R1: `plugins/sp/hooks/task-write-guard.ts` — PreToolUse (`Write|Edit`); stdin payload → path → `spur task resolve` (ownership) → deny owned / allow otherwise
- [x] R1 (scoped): ownership-guard decision — deny on owned-path raw write; post-edit `spur task check` gating DEFERRED until corpus migrates to DD-07 (check rejects 100% of the rd3-authored corpus today)
- [x] R2: decision recorded — `task info`/`feature info` REJECTED; hook needs only `resolve`, so a one-call frontmatter verb collapses no subprocesses
- [x] R2 same-commit doc-sync: delivery §1.3 (TBD → rejected), §7.5 (proposed → shipped, ownership-only), §16 exclusions (TBD → Rejected); design §12.3 hook contract + §16 registry
- [x] R3: zero logic beyond delegation — hook only reads stdin, shells `spur task resolve`, decides on its exit code; `SPUR_WRITE_GUARD=off` escape hatch
- [x] Hook registration: `plugins/sp/hooks/hooks.json` (PreToolUse matcher `Write|Edit`, `bun ${CLAUDE_PLUGIN_ROOT}/hooks/task-write-guard.ts`)
- [x] Tests: `plugins/sp/hooks/task-write-guard.test.ts` — 7 subprocess integration cases (deny owned Edit+Write, allow non-task, escape hatch, non-mutating tool, fail-open malformed, no-path)
- [x] CLI binary resolution: hook walks up from `CLAUDE_PROJECT_DIR` to the in-repo `apps/cli/src/index.ts` (never the stale global `spur`)


### Review

**SECU verdict: FAIL (unbuilt) → PASS** (verified + built 2026-06-14 via `/rd3:dev-verify 0067 --auto --fix all --force`)

The `/rd3:dev-run` loop shipped **nothing** for 0067 — `plugins/sp/hooks/` was empty (no hook, no
`hooks.json`, no R2 decision). All of R1/R2/R3 were unmet. Built from scratch; surfaced and settled
two design-vs-corpus conflicts with the operator.

**S — Security:** The hook *is* a security control (corpus-integrity guard). Pure delegation, no
shell injection (args passed as an array to `spawnSync`, never interpolated). Fail-open is the
correct posture for a guard hook — a crash must not block all tool use; the CLAUDE.md "task files via
CLI only" rule is enforced when the guard is healthy, and `SPUR_WRITE_GUARD=off` is an explicit,
documented bypass.

**C — Correctness / architecture:**
- R1 ✓ PreToolUse `Write|Edit` → path → `spur task resolve` → deny owned / allow otherwise. **Scoped
  to ownership** (operator decision): the post-edit `spur task check` gate is deferred because `check`
  rejects 100% of the rd3-authored corpus today (DD-07 dialect gap) — gating on it would block every
  edit. Documented in design §12.3 as the next step post-corpus-migration.
- R2 ✓ Decision recorded + synced: `task info`/`feature info` **rejected** — the hook needs only
  `resolve`, so a one-call frontmatter verb collapses no subprocesses. delivery §1.3 / §16, design §16.
- R3 ✓ Zero logic beyond delegation — ownership decided solely by the CLI exit code; verified by
  reading the single `spawnSync` delegation point. Lint-clean (no non-null assertions, no `any`).

**U — Usability:** Deny message names the file and the exact CLI command to use instead; the escape
hatch is discoverable in the message.

### Findings

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | Hook + registration + R2 decision did not exist — dev-run produced nothing. R1/R2/R3 unmet. | Correctness | `plugins/sp/hooks/` | P1 | **FIXED** — hook + hooks.json + 7 tests + doc-sync. |
| 2 | Design §12.3's `spur task check` gate is unbuildable-as-useful today: `check` fails 100% of the rd3-dialect corpus (missing schema_version, title-case status), so a check-gating hook would block all task edits. | Correctness | `task-write-guard.ts`, design §12.3 | P1 | **RESOLVED (operator decision)** — shipped ownership-only; check-gating deferred until corpus migrates to DD-07; design amended. Underlying dialect gap tracked (bug-531). |
| 3 | R2 `info`-verb call-count question was open (delivery §1.3 TBD). | Process | delivery §1.3 | P2 | **DECIDED** — rejected; hook needs only `resolve`. |
| 4 | Same-commit doc-sync (the §7.x class from 0064/0065/0066): §7.5 hook row, §1.3, §16 all needed updating. | Process | delivery §1.3/§7.5/§16, design §12.3/§16 | P2 | **FIXED** — all synced this commit. |

No remaining P1/P2.

**Gate:** lint clean · test 1115 pass / 0 fail (+7) · test-cf 1 pass · build OK · hook delegates only
(no validation logic) · escape hatch works · non-corpus edits unaffected.


### Testing

Verified 2026-06-14. Real code deliverable — verified by unit tests + manual hook runs + the gate.

- **Hook tests (R1/R3):** `plugins/sp/hooks/task-write-guard.test.ts` — 7 subprocess integration
  cases exercising the real `spur task resolve` delegation:
  1. owned task file + `Edit` → deny, message contains `spur task update` (steers to CLI)
  2. owned task file + `Write` → deny (Write is as dangerous as Edit)
  3. non-task source file → allow (never blocks normal work)
  4. `SPUR_WRITE_GUARD=off` → allow even on a task file (escape hatch)
  5. `Read` on a task file → allow (non-mutating tools ignored)
  6. malformed stdin → allow (fail-open; a broken hook must never wedge the agent)
  7. missing `file_path` → allow (nothing to guard)
- **Manual end-to-end:** all 5 happy/edge payloads run through `bun run plugins/sp/hooks/task-write-guard.ts`
  produce the correct `permissionDecision` JSON (file:line citations in Solution).
- **Grounding:** `spur task resolve` exit codes confirmed (0 owned / 1 not-owned); the deferred
  `spur task check` confirmed to reject 100% of the rd3-authored corpus (2 L1 schema errors per file:
  missing schema_version:1, title-case status) — the evidence for the ownership-only scope decision.

**Status before verify:** UNBUILT — `plugins/sp/hooks/` was empty; the dev-run loop produced no hook,
no registration, no decision. R1/R2/R3 all unmet; authored from scratch here.

Gate: `bun run lint` clean · `bun run test` 1115 pass / 0 fail (+7) · `bun run test-cf` 1 pass ·
`bun run build` all workspaces OK.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


