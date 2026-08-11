---
template: meta
schema_version: 1
name: "Fix 0505 run inefficiencies: inline wrap hop, dry-run probe guard, SQL schema discipline"
description: ""
status: backlog
type: meta
profile: standard
feature_id: E
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: ["0505"]
ac_numbering: task-local
created_at: "2026-08-11T05:35:30.065Z"
updated_at: "2026-08-11T06:00:09.899Z"
---

## 0506. Fix 0505 run inefficiencies: inline wrap hop, dry-run probe guard, SQL schema discipline

### Background
Task 0505 completed successfully, but its post-run evidence exposed three avoidable failure modes worth fixing.

1. The task pipeline honored `--agent inline`, then the automatic done-state route invoked `/sp:dev-wrap 0505`. `dev-wrap` and `dev-wrapall` currently expose no `--agent` selector and always launch `wrapup-pipeline.yaml`, whose `agent.run` steps use the workflow executor. The subprocess behavior is valid for a durable workflow run, but the handoff is silent and drops the operator's selector.
2. A probe used `history import --file <tmp> --mode full` without `--dry-run`. Full reconciliation treated the temporary file as authoritative for that source and mutated the real repository database. The sanctioned all-source full write is valid; the unsafe shape is a narrowed single-file full write by omission of `--dry-run`.
3. Ad-hoc verification SQL guessed columns before inspecting the live importer-owned schema, producing four `no such column` retries. The current issue-finding history bridge has no schema-first instruction.

Current-tree checks also invalidate two proposed fixes from the original draft: the relative `inline-pipeline-driver.md` links already resolve under `plugins/sp/skills/spur-dev/`, and `isInScope` has one internal production caller while the supported `extractTaskScopeAllowlist` surface already has focused tests. Neither needs a code change.

This task depends on completed task 0505 for the incident evidence. It hardens the three reusable seams above without changing history reconciliation semantics.
### Requirements
- [ ] R1. Make wrap execution-surface behavior explicit and selector-preserving. Add `--agent <inline|auto|name>` to `dev-wrap` and `dev-wrapall`; propagate the selector from `dev-run`/`dev-runall` wrap handoffs and next-router routes. Because wrap remains workflow-backed, interactive omission/`inline` must emit a pre-dispatch notice naming `subprocess`, objective trigger 3 (durable auditable wrapup run record), and `agent.default` as the executor-resolution source. `auto` tier-resolves before merge, and named executors continue on the existing workflow path.
- [ ] R2. Reject a non-dry-run single-file full import before opening the database: `history import --file <path> --mode full` without `--dry-run` exits non-zero and directs probes to `--mode force-file` or `--dry-run`. Preserve valid `--file --mode full --dry-run`, `--file --mode force-file`, and all-source/source-root full writes. Add no threshold, configuration key, or confirmation flag.
- [ ] R3. Add schema-first guidance to the issue-finding history bridge: before ad-hoc SQL references importer-owned history tables, inspect their live definitions in one `sqlite_schema`/`.schema` query. Keep the importer schema authoritative; do not copy column lists into Spur skill prose.

Non-goals: a second inline FSM driver for `wrapup-pipeline.yaml`; changes to reconciliation algorithms; a new public `spur history` flag or config value; exporting `isInScope`; changing Review-table validation or `spur task record`; fixing one-off skill-path guesses that do not exist in repository content.
### Acceptance Criteria
Scenario: R1 — Inline wrap handoff is explicit before subprocess dispatch
  Given an interactive `/sp:dev-run <wbs> --wrap` uses omitted/`--agent inline`, or next-router preserves that selection into a wrap handoff
  When `dev-wrap` prepares `wrapup-pipeline.yaml`
  Then the `--agent` selector is preserved through the handoff
  And output before workflow launch names `execution surface: subprocess`, objective trigger 3, and `agent.default` resolution
  And the wrap workflow still creates its durable run record

Scenario: R1 — Explicit subprocess selectors remain unchanged
  Given `dev-wrap` or `dev-wrapall` receives `--agent auto` or a named executor
  When the wrap workflow launches
  Then `vars.agent` receives the selected executor using the existing resolution contract
  And no inline-driver path is introduced

Scenario: R2 — A full single-file write fails before database access
  Given `spur history import --source antigravity --file probe.jsonl --mode full` omits `--dry-run`
  When the CLI validates the invocation
  Then it exits non-zero before `context.getDb()` or `HistoryService.importAll` is called
  And the text and JSON errors name `--dry-run` and `--mode force-file`

Scenario: R2 — Supported import combinations do not regress
  Given a full single-file dry-run, a force-file write, or a full import without `--file`
  When history import runs
  Then the invocation reaches the existing `HistoryService.importAll` path unchanged

Scenario: R3 — Forensic SQL discovers the live schema once
  Given issue-finding uses the history database for ad-hoc verification SQL
  When it first needs importer-owned history columns
  Then the history-bridge instructions require one schema-introspection query before data queries
  And the instructions point to the importer schema as authority without embedding a duplicate column contract
### Q&A
**Q: Why warn instead of adding an inline driver for wrap?**

A: `wrapup-pipeline.yaml` is intentionally a durable workflow with answer-file and housekeeping semantics. The existing cross-cutting contract permits subprocess execution when objective trigger 3 applies. Preserving the selector and reporting that override before launch fixes the contract violation without duplicating a second FSM interpreter.

**Q: Why not add a database-size threshold or confirmation flag?**

A: Size is not the unsafe semantic and creates configuration drift. The incident's dangerous combination is exact and deterministic: a temporary `--file` used as the authoritative input for a non-dry-run full reconciliation. Rejecting that combination prevents the incident while preserving the sanctioned all-source full write and requires no new public surface.

**Q: Why keep R3 as guidance instead of documenting all four table schemas?**

A: The tables are owned by `@gobing-ai/ts-llm-jsonl-importer` and can evolve independently. One live schema query is both shorter and correct for the installed version; copied column lists would become a second schema authority.

**Q: Why are the original skill-path and `isInScope` fixes removed?**

A: Premise verification found no broken repository link. `isInScope` is private, has one internal caller, and does not need to become package API for an ad-hoc helper script. The exported allowlist parser is already the supported test seam.
### Design
**R1 — freeze the wrap execution-surface contract**

- Public prompt surfaces: add the existing shared selector spelling `--agent <inline|auto|name>` to `plugins/sp/commands/dev-wrap.md` and `dev-wrapall.md`; update the corresponding rows and prose in `plugins/sp/skills/spur-dev/references/dev-operations.md` and the shared-flag parity fixtures.
- Handoffs: preserve `--agent` through `dev-run`/`dev-runall` wrap paths and `plugins/sp/skills/next-router/references/routing-table.md` A8/B6 when the originating command supplied it. Omission remains omission.
- Execution: keep `spur workflow run .spur/workflows/wrapup-pipeline.yaml` as the only wrap implementation. Tier-resolve `auto` before merging it into `vars.agent`, pass a name unchanged, and map interactive omission/`inline` to the documented headless resolution (`agent.default`). Before launching the workflow, emit a notice with the exact fields `execution surface: subprocess`, `reason: trigger 3 — durable auditable run record required`, `requested agent: inline`, and `executor: agent.default`.
- Tests: extend `plugins/sp/tests/inline-execution-contract.test.ts`, `flag-contract-parity.test.ts`, and existing wrap command structure assertions so selector presence, propagation, pre-dispatch notice, and workflow-only execution are mechanically pinned.
- Anti-patterns: no `inline-wrapup-driver.md`, no copied task-pipeline interpreter, no direct execution of the three wrap `agent.run` bodies, and no claim that the literal executor name is known before `agent.default` resolves.

**R2 — reject the hazardous import shape at the CLI boundary**

- In `apps/cli/src/commands/history.ts`, validate after mode parsing but before constructing/using the database-backed service. The exact predicate is `options.file && mode === 'full' && options.dryRun !== true`.
- Return exit code 1. Human output and JSON `message` must say that non-dry-run `--file --mode full` is unsafe because full mode treats the file as authoritative, and name both supported alternatives: add `--dry-run` to preview or use `--mode force-file` to import one file.
- Do not inspect database paths or sizes. Do not alter `HistoryService`, importer modes, or all-source/source-root full reconciliation.
- Tests in `apps/cli/tests/commands/history.test.ts` must spy at the existing CLI/service seam and prove the rejected case never opens the DB or calls import, while the three supported combinations still reach the existing path. Update `docs/04_DESIGN.md` history-import surface in the same implementation commit; no new CLI flag is introduced.

**R3 — live schema, one authority**

- Add a short guard to `plugins/sp/skills/issue-finding/references/session-formats.md` under the history bridge: before ad-hoc SQL, query `sqlite_schema` (or use one `.schema` invocation) for every referenced `history_*` table, then compose data queries from that result.
- Name `@gobing-ai/ts-llm-jsonl-importer` as schema authority and forbid copied column lists. Extend the existing R24b structure test in `plugins/sp/tests/skill-structure.test.ts` with semantic markers for schema introspection and authority.
- Do not modify generic `sp:code-verification`; it has no history-SQL workflow.

**Cross-task contract:** task 0505 supplies the incident evidence only. Task 0506 must not reopen 0505's real-data write, change task 0504 reconciliation, or mutate `.spur/spur.db` during implementation/tests.

**Traceability:** feature E is a grouping feature with no feature-level acceptance scenarios; task 0506 therefore keeps `ac_numbering: task-local`, and its R1–R3 scenarios above are the verification authority.
### Plan
- [ ] P1 (R1) Update `dev-wrap`/`dev-wrapall`, wrap handoff routing, `dev-operations.md`, and flag/inline contract tests to accept and propagate `--agent` while reporting the trigger-3 subprocess override before workflow launch. Keep `wrapup-pipeline.yaml` as the sole implementation.
- [ ] P2 (R2) Add the pre-database `--file + --mode full + !--dry-run` validation in `apps/cli/src/commands/history.ts`, focused CLI tests for the rejected and preserved combinations, and the matching `docs/04_DESIGN.md` surface note.
- [ ] P3 (R3) Add one live-schema-first rule to the issue-finding history bridge and extend its existing structure test; do not duplicate importer column definitions.
- [ ] P4 (R1–R3) Run targeted tests first: `bun test plugins/sp/tests/inline-execution-contract.test.ts plugins/sp/tests/flag-contract-parity.test.ts plugins/sp/tests/skill-structure.test.ts apps/cli/tests/commands/history.test.ts`. Then run the repository completion gates required by `AGENTS.md`, including `bun run autofix`, `bun run spur-check`, lint, test, test-cf, build, corpus check, and intentional `git status`.
### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Incident task: 0505 (`docs/tasks4/0505_run-real-data-full-mode-verification-pass-for-history-import.md`)
- Wrap commands: `plugins/sp/commands/dev-wrap.md`, `plugins/sp/commands/dev-wrapall.md`
- Wrap workflow: `config/workflows/wrapup-pipeline.yaml`
- Execution-surface SSOT: `plugins/sp/skills/spur-dev/references/cross-cutting.md` § Inline-default execution surface
- Command/flag catalog: `plugins/sp/skills/spur-dev/references/dev-operations.md`, `flag-glossary.md`
- Wrap routing: `plugins/sp/skills/next-router/references/routing-table.md` rows A8/B6
- History import command: `apps/cli/src/commands/history.ts`
- Focused history CLI tests: `apps/cli/tests/commands/history.test.ts`
- History skill bridge: `plugins/sp/skills/issue-finding/references/session-formats.md`
- Skill structure gate: `plugins/sp/tests/skill-structure.test.ts` R24b
- Importer schema authority: `@gobing-ai/ts-llm-jsonl-importer` (`HISTORY_IMPORT_SCHEMA_SQL`)
- Internal scope guard: `packages/app/src/workflow/actions/agent-run.ts` (`extractTaskScopeAllowlist`, private `isInScope`)
### History

### Notes
**Verified incident evidence**

- Wrap: task 0505's main stages stayed inline; the automatic A8 handoff launched three wrap subprocess sessions (7.2 minutes, $0.11, 3.2M tokens) because wrap is workflow-backed and the selector was not propagated or surfaced.
- Import probe: `--file <tmp> --mode full` without `--dry-run` reconciled the temporary file against the real database; recovery restored the affected source rows and task 0505 later completed with PASS.
- SQL: four `no such column` failures occurred before live-schema inspection.

**Refinement dispositions**

- Keep the wrap workflow and expose the objective subprocess override; do not build a second inline driver.
- Guard the exact unsafe single-file full-write combination; do not add thresholds, configuration, or flags.
- Query the live importer schema once; do not duplicate table definitions.
- No action on the alleged skill-path defect (repository links resolve), Review-table retry, unsupported `record --no-lifecycle` retry, or private `isInScope` helper. These were one-run usage errors or already-enforced contracts, not missing product seams.

No open design decisions remain.
