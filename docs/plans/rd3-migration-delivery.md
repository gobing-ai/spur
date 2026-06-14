# rd3 Migration — Delivery Surface Catalog

**Date:** 2026-06-12 · **Updated:** 2026-06-12 (operator review round 1 — see §13)
**Input:** `docs/plans/2026-06-10-rd3-migration-feature-list.md` (disposition record; item IDs
referenced below are its IDs). **Governing decisions:** ADR-020–023.
**Consumers:** the Stage-D collective design (ADR-023(3)), `04_DESIGN.md §7` fill-in, and wave
planning.

## Purpose & ground rules

This document fixes **two things** for every deliverable in the upcoming implementation batch
(53 `need` + 18 `fixed-need` + X01/X02/X04/X05 at triage; the 2026-06-12 review postponed the
board slice E01/E08/E09/E10 — see §6):

1. **Exact name** — so design, implementation, and review all say the same word for the same thing.
2. **What it's for** — the core purpose that survives design iteration, even where scope and
   boundary shift.

It deliberately says **nothing about internals** — no algorithms, no schemas-in-full, no module
wiring. Where a concrete shape is still a Stage-D output (event payloads, flag lists), the row
says so; the *name* and *purpose* are still committed here.

Name status legend:

| Status | Meaning |
|---|---|
| **fixed** | Committed now; changing it later requires updating this doc + dependents. |
| **proposed** | Best-fit name following an existing convention; operator review pending. |
| **reserved** | Named now, built later (binding-when-built decisions). |
| **postponed** | Pushed behind a later design task (operator review 2026-06-12); name reserved. |
| **held** | Direction undecided (drop vs. rewrite); not batch scope; revisit explicitly. |
| **TBD** | Open surface question recorded here; decided at Stage D. |

### Naming conventions applied

Derived from what already ships, so new names read like existing ones:

- **CLI:** noun-verb grammar, one binary (`spur task create`, never `spur-task`) — ADR-014.
- **Services:** `<Noun>Service` PascalCase in `packages/app` (`AgentService`, `RuleService`, …).
- **DB:** snake_case tables; migration files `drizzle/NNNN_spur_cli_<topic>.sql` with the
  `_spur_cli_` marker.
- **JSON schemas:** `apps/cli/schemas/<topic>.schema.json` (existing: `spur-config`, `rule-file`,
  `preset`, two workflow schemas).
- **Default config assets:** repo-root `./config/<area>/…` (ADR-015), copied by `spur init`.
- **plugins/sp:** skills `sp:spur-<noun>` for CLI-noun companions; slash commands
  `<noun>-<verb>.md`; subagents `expert-<noun>.md` (existing: `sp:spur-rules`, `rule-add`,
  `expert-rules`).
- **Umbrella vocabulary — two registers (operator decision 2026-06-12):**
  **"planning"** is the architecture-internal term for the task+feature domain
  (`PlanningWriteService`, `planning_events`, `PlanningEventMap` — matches ADR-020–023 language;
  no renames). **"dev"** is the agent-facing register: the daily slash-command family is
  `sp:dev-*` (continuing the operator's `rd3:dev-*` muscle memory), backed by the `sp:spur-dev`
  umbrella skill. The later "development" migration wave extends the dev-* family naturally.

---

## 1. CLI surface

Two new nouns (ADR-020) plus one new verb on an existing noun. Every command supports `--json`
(A16, ADR-010 invariant). Flags shown are the committed core; the full flag tables land in
`04_DESIGN.md §7.1–7.2` (same commit as each verb ships).

### 1.1 `spur task` — fixed

| Command | What it's for | Items |
|---|---|---|
| `spur task create <title> [--template <variant>] [--feature <id>] [--parent <wbs>] [--folder <path>]` | Create a task markdown file with race-safe WBS allocation; default Background derived from the active feature's `## Goal`. | A01 A02 A12 B09 X02 |
| `spur task show <wbs>` | Read one task (full content or `--json` structured, frontmatter as a top-level field). | A01 |
| `spur task update <wbs> <status>` | Hot path 1: status transition (runs through the lifecycle workflow). | A01 A04 |
| `spur task update <wbs> --section <name> --from-file <path>` | Hot path 2: replace one body section from a file — the dominant agent write pattern. | A03 |
| `spur task list [--status <s>] [--phase <p>] [--parent <wbs>] [--json]` | Filterable task listing, including sub-task grouping. `--json` is explicit here because list output is the primary integration surface. **Filter correctness is a reimplementation requirement with tests, not a port** — the legacy filter bugs die with the legacy code. | A05 X02 A16 |
| `spur task refresh` | Regenerate `kanban.md` (output artifact, never input). | A06 |
| `spur task check [<wbs>]` | The single validation surface: frontmatter schema, Section-Status-Matrix, section format rules, feature traceability. Absorbs C04. `--json` reports required/missing sections for the task's current status — the zero-token way for agents to ask "what does this task need now". | A07 A13 A14 C04 |
| `spur task batch-create --file <json>` | Create many tasks from one validated JSON document — the deterministic landing verb for LLM decomposition output. | A08 C03 |
| `spur task resolve <file-path>` | Map a repo file path to its owning task (WBS + file) — the write-guard hook's lookup. Replaces legacy `get-wbs`/`get-file`. | A10 |
| `spur task migrate` | One idempotent normalization pass over the legacy corpora (status canon, key collapse, timestamps, `parent_wbs`). Built in the batch; **cutover waits for the new board** (§6). | A17 |

> **No `delete` verb (operator decision 2026-06-12).** `Cancelled` is the auditable terminal
> status; files are SSOT, so a genuine mistake is `rm` + `refresh`. A delete verb would destroy
> traceability edges (feature `## Tasks` links, history) for no job a status can't do.

> Note: `spur task migrate` coexists with the DB utility `spur migrate`. They are noun-scoped and
> unambiguous in grammar; flagged in §12 in case the operator prefers a distinct verb (e.g.
> `normalize`).

### 1.2 `spur feature` — fixed

| Command | What it's for | Items |
|---|---|---|
| `spur feature create <name> [--parent <id>]` | Create `docs/features/<ID>_<slug>.md` — hierarchical letter+digit ID allocated under the parent; no parent = next free top-level group letter (design DD-14). | B01 |
| `spur feature show <id>` | Read one feature (`--json` structured, frontmatter as a top-level field). | B01 |
| `spur feature update <id> <status>` / `update <id> --section <name> --from-file <path>` | Status transition + section editing — same write contract as tasks. | B05 B07 |
| `spur feature list [--status <s>] [--priority <p>] [--json]` | Filterable feature listing; same explicit-`--json` and filter-correctness requirements as `task list`. | B02 A16 |
| `spur feature refresh` | Regenerate `INDEX.md` (see §2 for the tree-view shape) and auto-populate feature `## Tasks` sections. Task files are never touched. | B03 B04 B06 |
| `spur feature check [<id>]` | Feature validation: Gherkin AC check, traceability, "one active goal" enforcement. | B08 B09 C04 |
| `spur feature move <id> --parent <id> [--dry-run]` | Cascade rename for hierarchy changes — the ID encodes position, so a move re-IDs the node + all descendants, renames files, updates every task `feature_id` edge, and appends History; validate-before-write + best-effort rollback; `--dry-run` reports the old→new map with zero writes (design §2.4, DD-14). | B01 |

> **No `delete` verb** — same reasoning as tasks. Consequence: the feature lifecycle gains a
> `cancelled` terminal status, and a `verifying` acceptance status (design DD-13) — B07's enum
> becomes backlog/active/**verifying**/blocked/done/**cancelled**.

### 1.3 TBD verbs (recorded now, decided at Stage D)

| Command | Status | What it's for | Items |
|---|---|---|---|
| `spur task info <file-path>` · `spur feature info <file-path>` | TBD | Path → frontmatter-only JSON in **one** call, for machine/API integration. `resolve` + `show --json` composes the same capability in two calls; the case that earns the verb is the write-guard hook (one subprocess spawn instead of two). Decide when the hook contract is designed. | — |

### 1.4 Existing nouns — additions / hardening

| Command | What it's for | Items |
|---|---|---|
| `spur workflow continue [run-id] [--yes]` — **fixed** | Resume a paused workflow run: the CLI-first HITL approval gate. If `run-id` is omitted, discover the most recent paused run and confirm with the operator; `--yes` accepts the discovered run without prompting. (Board-side trigger follows the server/web design.) | D04 |
| `spur agent run` — existing | No new name. Batch work: verify team-mode, harden, and document it as the **single LLM execution surface** for skills and workflow YAML. | M12 |

---

## 2. Planning files & generated artifacts

The markdown files are the **single source of truth**; the DB holds only derived data (03 §12.1).

| Name | Status | What it's for | Items |
|---|---|---|---|
| `<task-folder>/<WBS>_<slug>.md` (folders registered in config, e.g. `docs/tasks/`) | fixed | Task file: YAML frontmatter (Zod-validated, `schema_version`, `parent_wbs`, `feature_id` — snake_case canonical per design DD-07) + structured body sections. | A18 X02 |
| `docs/features/<ID>_<slug>.md` | fixed | Feature file: frontmatter + `## Goal`, `## Acceptance Criteria` (Gherkin/checklist), `## Tasks` (generated). ID is hierarchical letter+digit (groups `A`,`B`,… → children `A1`… → `A11`…; length = depth; design DD-14). | B01 |
| `<task-folder>/kanban.md` | fixed | Generated board view, grouped by status (and by `parent_wbs`). Output of `spur task refresh`; never hand-edited, never an input. | A06 X02 |
| `docs/features/INDEX.md` | fixed | Generated feature index rendered as a **tree view** (à la the `tree` command) from the ID-encoded hierarchy: one node per feature with its status and a markdown hyperlink to the feature file. Output of `spur feature refresh`; same never-input rule. | B03 B06 |
| `## History` section (inside each task/feature file) | fixed | Append-only status-transition log written by the write service on every lifecycle event; also the `updated_at` reliability fix. | A15 |

---

## 3. Configuration — YAML files & JSON validation schemas

### 3.1 Project config keys — `.spur/config.yaml` (ADR-017: one config, extended not forked)

| Key | Status | What it's for | Items |
|---|---|---|---|
| `tasks:` (`folders`, `active`, `counterBase`) | proposed | Task-folder registration, active folder for new tasks, WBS base counter — the legacy `docs/.tasks/config.json` concepts, absorbed. | A11 H03 |
| `features:` (`dir`) | proposed | Feature directory location (default `docs/features`). | B01 |

### 3.2 Default config assets — repo-root `./config` (ADR-015)

**Orchestration is configuration, not code:** every workflow file below executes via the existing
`spur workflow run` engine — the batch builds **no new orchestration machinery**. Skills call
`spur workflow run`, never the engine directly; engine capability gaps close upstream (§9).

| File | Status | What it's for | Items |
|---|---|---|---|
| `config/workflows/task-lifecycle.yaml` | fixed | The **state machine** governing a task's `status` field across its lifetime — what `spur task update <wbs> <status>` consults. One run per task; lives for days/weeks; externally triggered (ADR-022). Frontmatter `status` stays SSOT. | A04 |
| `config/workflows/feature-lifecycle.yaml` | fixed | Feature state machine (backlog/active/verifying/blocked/done/cancelled), same mechanism. | B07 |
| `config/workflows/task-pipeline.yaml` | fixed (renamed from triage's `task-standard.yaml`, see §13) | The **work pipeline** an agent runs to *do* a task: implement → test → review → verify. One run per execution attempt; `spur task check` as pre-gate guard; result recording as a step. State vs. work: `task-lifecycle` governs *what status a task is in*; `task-pipeline` performs *the work that moves it*. | D01 D05 D06 |
| `config/tasks/section-matrix.yaml` | fixed | Section-Status-Matrix + per-section format rules: which sections each status requires, warning-first; only the small core hard-gates. **Evaluated CLI-side** (operator decision 2026-06-12): deterministic config is ADR-016 CLI territory — agents query it via `task check --json` / `show --json` at zero prompt-token cost; skills never embed the matrix. | A13 A14 |
| `config/templates/task/default.md` | fixed | The base task template — every variant derives from it. | A12 |
| `config/templates/task/feature-impl.md` | fixed | Variant: feature implementation task (the workhorse) — AC subset, solution, review sections. | A12 |
| `config/templates/task/issue.md` | fixed | Variant: bug/issue report task — repro, root cause, fix sections. | A12 |
| `config/templates/task/review.md` | fixed | Variant: code-review summary task — P1–P4 findings table, verdict. | A12 |
| `config/templates/task/meta.md` | fixed | Variant: process/docs/chore task — minimal sections, no AC requirement. | A12 |
| `config/templates/feature/default.md` | fixed | Feature file template. | B01 |
| `config/templates/bdd/gherkin.md` · `config/templates/bdd/checklist.md` | proposed | The two-tier `## Acceptance Criteria` skeletons (fenced-Gherkin tier and checklist tier, per the BDD research recommendation) — used by templates and the spec pipeline alike. | A12 C02 X01 |

No sub-task template variant: `parent_wbs` makes any task a sub-task (X02).

### 3.3 JSON validation schemas — `apps/cli/schemas/`

| File | Status | What it's for | Items |
|---|---|---|---|
| `spur-config.schema.json` | fixed (existing, extended) | Gains the `tasks:`/`features:` keys. | A11 |
| `task-batch.schema.json` | fixed | Validates `spur task batch-create` input — **the contract gating LLM decomposition output before any write**. | A08 C03 |
| `section-matrix.schema.json` | proposed | Validates `config/tasks/section-matrix.yaml`. | A13 |
| `task-frontmatter.schema.json` · `feature-frontmatter.schema.json` | proposed | Generated from the Zod SSOT (never hand-maintained) so non-TS consumers (editors, other agents) can validate frontmatter. | A18 |

Workflow YAML needs no new schema — the existing `state-machine-workflow` /
`transition-flow-workflow` schemas cover the lifecycle and pipeline definitions.

---

## 4. Database

Derived data only — deleting the DB loses no planning state (03 §12.1).

| Name | Status | What it's for | Items |
|---|---|---|---|
| `drizzle/0003_spur_cli_planning.sql` | proposed | The planning-layer migration file (carries the `_spur_cli_` marker; next free number at design time). | — |
| `planning_events` table | proposed | Append-only task/feature lifecycle events (the §10.1 catalog) — feeds observability and later analytics/scheduler. Rehydratable from the files' `## History`. | A15 X04 |
| `task_run_links` table | proposed | Links a task (WBS) to workflow run-ids — how execution results trace back to the task that produced them. | D06 |

Lifecycle **runs** themselves persist in the existing engine tables (`runs`, `transition_runs`,
`workflow_states`) — no new tables for them. Further derived tables (caches) may join at Stage D;
the derived-only principle is fixed.

---

## 5. Packages — exported types / classes / functions

Default homes per 03 §12.1: services + write path → `packages/app`; schemas, file I/O, locks,
DAOs → `packages/domain`. **No new runtime package** (operator decision 2026-06-12: H01 and X01
land as `packages/domain` modules).

### 5.1 `@gobing-ai/spur-domain` additions

| Export | Status | What it's for | Items |
|---|---|---|---|
| `taskFrontmatterSchema` / `featureFrontmatterSchema` (Zod) + `TaskFrontmatter` / `FeatureFrontmatter` types | fixed | The single source of truth for file shape — parse-validate-serialize replaces all regex read-modify-write. Includes `schema_version`, `parent_wbs`. | A18 X02 |
| `TaskStatus` / `FeatureStatus` (union types) | fixed | Canonical status enums consumed by CLI, lifecycle YAML, board, and migration. `FeatureStatus` includes `verifying` and `cancelled` (§1.2 note; design DD-13). | A04 B07 A17 |
| `MarkdownDocument` (frontmatter module, H01) | proposed | Unified frontmatter + body-section read/write/validate — the one markdown I/O layer for tasks and features. (Module home: `packages/domain`; promote upstream only when a second project needs it.) | H01 |
| BDD validator module: `parseGherkinSubset`, `parseChecklist`, `validateAcceptanceCriteria`, `checkAcCoverage` | proposed | **One** shared BDD validator behind `task check`, `feature check`, and pipeline-output gating — instead of four private parsers. AST aligned with `@cucumber/gherkin` types (no runtime dep). Port of `validate-feature.ts`. | X01 K08 A14 B08 C02 |
| Lock utilities: `acquireWbsLock`, `acquireCreateLock` | proposed | Per-WBS and create-time file locks with staleness detection — **one lock domain** shared by every transport via the write service. | H04 E11 |
| `PlanningEventDao` / `TaskRunLinkDao` | proposed | DAOs over the §4 tables. | A15 D06 X04 |
| `PLANNING_SCHEMA_SQL` (composed into `CLI_SCHEMA_SQL`) | fixed | Schema composition entry, same pattern as history/workflow schemas. | — |

### 5.2 `@gobing-ai/spur-app` additions

| Export | Status | What it's for | Items |
|---|---|---|---|
| `TaskService` | fixed | Task domain orchestration: every `spur task` verb's logic (CRUD-minus-delete, list, check, batch, resolve, migrate, refresh). | A-group |
| `FeatureService` | fixed | Feature domain orchestration: every `spur feature` verb's logic. | B-group |
| `PlanningWriteService` | fixed | **The** unified write path (ADR-021): all task/feature mutations from any transport pass through it — one validated path, one lock domain, lifecycle dispatch, `## History` append, event emission. No mutation path may bypass it. | E11 H04 A15 |
| `PlanningEventMap` (typed event map) | fixed | The Spur-side typed contract for the §10.1 event catalog on the engine's EventBus seam. Built in the batch even though its first transport consumer (SSE) is postponed — observability, future board, and scheduler all attach here with zero rework. | X04 D07-prep D08 |

### 5.3 `@gobing-ai/spur-contracts` — postponed (with §6; names reserved)

| Export | Status | What it's for | Items |
|---|---|---|---|
| `taskContract` / `featureContract` | reserved | oRPC route contracts for the board's task/feature CRUD — built with the server/web design task, not in this batch. | E09 E10 |
| `planningEventContract` | reserved | Contract for the live event stream (SSE). | E08 |
| `TaskDto` / `FeatureDto` / `PlanningEventDto` | reserved | The shared transport shapes. Domain types never leak into contracts. | E10 |

### 5.4 Test utilities (H05) — held

`@gobing-ai/spur-testing` (the proposed `tooling/testing` workspace) is **held** (operator
decision 2026-06-12) pending the later `spur inspect` / `spur builder` direction. Interim: test
helpers (temp dirs, fixture factories, CLI invocation, in-memory SQLite) live per-workspace in
`tests/helpers.ts` — the ≥90% coverage bar is unaffected; only the shared-workspace packaging is
deferred. (H05 is internal dev-test tooling, distinct from any product surface.)

---

## 6. Server & web surface — postponed (operator decision 2026-06-12)

The HTTP API on `apps/server`, the SSE endpoint, the board web UI, and any plugin-hub/container
notion are **postponed** behind the Stage-D server/web design task (ADR-021.b) — nothing
server/web ships in this batch. What **stays** in the batch is the architecture that makes the
postponement cheap:

| Name | Status | What it's for | Items |
|---|---|---|---|
| `PlanningWriteService` (§5.2) | fixed — **in batch** | The single write path is `packages/app` architecture, not a server feature; when routes arrive they bind to it — one lock domain by construction. | E11 |
| `PlanningEventMap` (§5.2) + `planning_events` (§4) | fixed — **in batch** | The event contract + persistence ship now; SSE/board/scheduler are later subscribers. | X04 |
| Task/feature HTTP API · SSE endpoint · `/board` page | postponed | Shapes, routes, and stack decided by the server/web design task; contract names reserved in §5.3. | E01 E08 E09 |
| Board launcher | reserved — **deliberately unnamed** | `spur serve` vs. running `apps/server` is that design task's decision (X03). Do not coin a name before then. | X03 |

**Cutover constraint (updated 2026-06-12):** `spur task migrate` is built in the batch, but
**corpus cutover waits for the new board** — the legacy `tasks server` board stays the operator's
daily driver, untouched, until the server/web design task delivers a daily-driver-usable
replacement. The new `spur task`/`spur feature` CLI is fully usable on fresh corpora meanwhile.
The operator is never boardless.

---

## 7. `plugins/sp` — skills, slash commands, subagents, hooks

Fat Skills doctrine (ADR-023) fixes **where the SSOT lives** (skills; commands and subagents are
thin wrappers *of skills*) — it does **not** fix how many skills exist. Granularity is balanced
per design: as many skills as the work has natural seams, no more (operator clarification
2026-06-12).

### 7.1 Skills

| Skill | Status | What it's for | Items |
|---|---|---|---|
| `sp:spur-dev` | fixed (operator-selected 2026-06-12) | **The fat daily-workflow umbrella skill** backing the whole `sp:dev-*` command family. Its planning half is the spec pipeline (C01–C03): description → feature file with BDD AC → CLI-validated task decomposition. Its execution half drives the work loop: run a task through `task-pipeline.yaml`, review, verify. Delegates every deterministic step to CLI verbs. Split later only when size actually hurts. | C01 C02 C03 D01 F01 |
| `sp:spur-tasks` | proposed | Reference companion for `spur task`: when/how agents drive the verbs, section-editing workflow, check-before-write discipline. | F01 |
| `sp:spur-features` | proposed | Reference companion for `spur feature`: feature authoring, AC conventions, traceability habits. | F01 |

Existing `sp:spur-rules` / `sp:spur-workflows` are untouched.

### 7.2 Prompt-skill dispositions (was "move-only relocations" — revised per operator review)

| Skill | Status | What it's for | Items |
|---|---|---|---|
| `sp:brainstorm` | proposed (move + enhance) | Ideation protocol delegating to `spur agent run` (CLI verb rejected — C06). **Planned enhancement:** today's skill is too generic — it gains a set of scenario-specific slash commands with targeted customization; command names at Stage D. | I05 |
| `sp:doc-evolve` | proposed (full rewrite of `rd3:code-docs`) | **Self-evolution driver for the project key files**: maintains and enhances `docs/00–05`, `AGENTS.md`, and friends per `docs/99_PROJECT_CONSTITUTION.md` (edit rules, sync triggers, drift audits). Not a port — a constitution-native rewrite. | I15 |
| `sp:daily-summary` | proposed (verify + enhance) | Daily summary generator — built but never adopted; **verify and enhance before first use**. Its script stays embedded in the skill (no CLI extraction). | I16 |
| `sp:anti-hallucination` | proposed (move-only) | How-to-think protocol; stays a skill forever (package rejected — K05). | K05 |
| `code-review` / `code-verification` / `code-improvement` / `functional-review` wrappers | **held** | Drop-or-rewrite-on-new-infrastructure, decided later; they stay live in cc-agents meanwhile (extends the K01–K04 deferral to the prompt wrappers too — they do **not** move in this batch). | I10 K1–K4 |

### 7.3 Slash commands — the `sp:dev-*` family

Operator direction (2026-06-12): the daily command surface continues the **`dev-*`** names from
`rd3:dev-*` — muscle-memory continuity — all thin wrappers of `sp:spur-dev`. The exact subset is
the Stage-D ADR-016 decision test (expect few, not the legacy 42). Candidates, by usage:

| Command | Status | What it's for | Items |
|---|---|---|---|
| `sp:dev-plan` | proposed | Spec-pipeline entry: description → feature + decomposed tasks. | C01 C03 F03 |
| `sp:dev-run` | proposed | Run one task through `task-pipeline.yaml`. | D01 F03 |
| `sp:dev-unit` · `sp:dev-review` · `sp:dev-verify` | proposed | Test / review / verify entry points of the work loop. | F03 |
| `sp:dev-new-task` · `sp:dev-fixall` · `sp:dev-gitmsg` · `sp:dev-docs` · `sp:dev-changelog` · `sp:dev-handover` · `sp:dev-refine` | proposed | The rest of the daily family — each passes or fails the ADR-016 test individually at Stage D. | F03 I06 |
| `sp:plan-feature` / `sp:plan-decompose` / `sp:task-run` | **held** | Superseded by the dev-* family above (operator decision 2026-06-12); kept here only so the names aren't accidentally reused for something else. | — |

### 7.4 Subagents (thin wrappers of §7.1 skills)

| Subagent | Status | What it's for | Items |
|---|---|---|---|
| `sp:expert-dev` | proposed | Isolated-context runs of the full dev workflow (wraps `sp:spur-dev`; replaces the earlier `expert-plan` proposal). | F02 |
| `sp:expert-tasks` | proposed | Isolated-context multi-step task-management work. | F02 |
| `sp:expert-features` | proposed | Same, feature side. | F02 |

### 7.5 Hooks

| Hook | Status | What it's for | Items |
|---|---|---|---|
| `task-write-guard` (`plugins/sp/hooks/task-write-guard.ts`) | proposed | PreToolUse write-guard: maps the edited file to its task via `spur task resolve` (or the TBD `task info`, §1.3), validates via `spur task check` — the hook holds **no logic**, only delegation. | F04 A10 A07 |

---

## 8. External scripts

Near-zero **by design** — the ADR-023 dividing line moves executable logic into the CLI. The
complete list:

| Script | Status | What it's for | Items |
|---|---|---|---|
| `plugins/sp/hooks/task-write-guard.ts` | proposed | The §7.5 hook executable (delegation only). | F04 |
| Embedded script inside `sp:daily-summary` | fixed (decision) | Stays embedded; explicitly **not** a `spur` verb. | I16 |

Per-platform install scripts keep working as-is; cross-agent plugin conversion/adapter tooling
(F05–F11, M11 `spur plugin convert`) is **out of scope** — the operator builds it as an
independent tool outside Spur (decision 2026-06-12).

---

## 9. Upstream dependencies (`~/xprojects/ts-libs/`)

Gaps close **upstream**, never via local re-implementation (shared-library evolution rule). These
are named ts-libs work items gating dependent waves:

| Work item | Package | What it's for | Items |
|---|---|---|---|
| Long-lived, externally-triggered runs | `@gobing-ai/ts-dual-workflow-engine` | A task lifecycle spans days and is driven by CLI invocations, not one process — the engine must rehydrate run state across invocations. | A04 B07 ADR-022 |
| Pause / continue (run suspension API) | `@gobing-ai/ts-dual-workflow-engine` | Backs `spur workflow continue [run-id]` and HITL approval gates. | D04 |
| Result/error primitive gaps (if any) | `@gobing-ai/ts-utils` | H02/H13 consolidate on ts-utils output/errors; anything missing for a true `Result<T>` goes upstream — no local `cli-utils` fork. | H02 H13 |
| FS helper gaps (if any) | `@gobing-ai/ts-runtime` | H12: `FileSystem` is the seam; only genuinely missing helpers go upstream — no parallel fs wrapper. | H12 |
| `@gobing-ai/ts-bdd` | reserved (future) | The promotion target for the §5.1 BDD validator module once a second project consumes it (operator decision 2026-06-12: Spur-local first). | X01 |

No other upstream changes: rule engine, EventBus, scheduler, logger, AI runner, DB adapter, JSONL
importer are consumed as-is (G-group all `done`).

---

## 10. Downstream contracts / machine interfaces

What other systems (agents, web clients, future consumers) hold onto:

| Contract | Status | What it's for | Items |
|---|---|---|---|
| `--json` output of every task/feature verb | fixed | The machine-consumption surface for skills, hooks, and scripts (ADR-010 invariant). | A16 |
| `task-batch.schema.json` | fixed | The LLM→CLI gate: `sp:spur-dev` produces it, `spur task batch-create` validates it — the only sanctioned path for generated tasks. | A08 C03 |
| `PlanningEventMap` (§10.1 catalog) | fixed | The typed lifecycle-event contract on the EventBus seam — observability now; board (postponed), scheduler (D07), and custom extensions (D08) attach later without rework. | X04 |
| oRPC contracts + DTOs (§5.3) | reserved | Built with the server/web design task. | E09 E10 E08 |
| `kanban.md` / `INDEX.md` | fixed | Read-only generated views — humans and agents may read them, nothing may treat them as input. | A06 B03 |

### 10.1 Event catalog (X04 — all events, for observability)

The committed event set on `PlanningEventMap`. Payload shapes are Stage-D output; the
authoritative list lands in `04_DESIGN.md §7` (X05 sync). All planning events are emitted by
`PlanningWriteService` and persisted to `planning_events`.

| Event | Status | Fired when |
|---|---|---|
| `task.created` | fixed | A task file is created (including each item of a `batch-create`). |
| `task.updated` | fixed | Any non-status write to a task (section edit, frontmatter change). |
| `task.transitioned` | fixed | A task status change completes through the lifecycle workflow (includes cancellation). |
| `feature.created` | fixed | A feature file is created. |
| `feature.updated` | fixed | Any non-status write to a feature. |
| `feature.transitioned` | fixed | A feature status change completes (includes cancellation). |

Engine-seam events (from `ts-dual-workflow-engine`, per lifecycle/pipeline run — ADR-022):

| Event | Status | Fired when |
|---|---|---|
| `on_transition` | fixed (engine) | A workflow run moves between states — the seam planning events derive from. |
| `on_guard_fail` | fixed (engine) | A guard (e.g. `spur task check` pre-gate) blocks a transition. |
| `on_complete` | fixed (engine) | A workflow run reaches its terminal state. |

No `task.deleted` / `feature.deleted` — there are no delete verbs (§1.1/§1.2). Future
subscribers: SSE/board (postponed, §6), scheduler auto-trigger (deferred, D07), custom extensions
(D08).

---

## 11. Documentation deliverables (X05 — scheduled, not remembered)

| Deliverable | What it's for |
|---|---|
| `04_DESIGN.md §7.1–7.6` filled | Verbs/flags/exit codes, frontmatter field tables, matrix + lifecycle/pipeline YAML shapes, the §10.1 event catalog, task DTOs (when un-postponed) — **same commit** as each command/config/schema lands (AGENTS.md sync rule). |
| `05_FEATURES.md` planning-layer rows | Status tracking (✅/🔶/⏳) per shipped item. |
| `02_ROADMAP.md` phase status | Updated as waves complete. |

---

## 12. Reserved names & open naming questions

**Reserved (binding when built, not batch scope):**

- `spur inspect <verb>` — the project-state interrogation noun (N group). Never `inspector`; the
  run-inspection surface joins as `spur inspect run <id>` later. (The `spur inspect` vs.
  `spur builder` direction itself is a later decision — see §5.4.)
- `@gobing-ai/ts-bdd` — BDD validator promotion target (§9).
- `taskContract` / `featureContract` / `planningEventContract` + DTOs — server/web design task (§5.3).
- Board launcher name — owned by the server/web design task; intentionally absent here (X03).

**Open for operator review (all carry a recommendation):**

1. **§7.1 companion-skill and §7.3 command-subset names** — `sp:spur-dev` is settled; the
   companions (`sp:spur-tasks`/`sp:spur-features`) and the exact dev-* subset are confirmed at
   Stage D. Recommend keeping the patterns as listed.
2. **`spur task migrate` vs `spur migrate`** — superficially similar; grammatically unambiguous.
   Recommend keeping `migrate` (matches the triage doc and the verb's meaning) over coining
   `normalize`.
3. **`spur task info` / `spur feature info`** (§1.3) — TBD; recommend deciding with the
   write-guard hook contract at Stage D.

**Settled this round (2026-06-12):** umbrella vocabulary (two registers — see Naming
conventions); pipeline-skill shape (`sp:spur-dev` umbrella); A17 cutover timing (waits for the
board, §6); template variant set (§3.2).

---

## 13. Adjustments made relative to the triage doc

Recorded so the triage doc and this catalog never silently diverge:

| Adjustment | Triage said | This doc records | Authority |
|---|---|---|---|
| H01 home | "Spur-local package first" | Module in `packages/domain` (no new package) | 03 §12.1 default-home rule + operator decision 2026-06-12 |
| X01 home | "ts-libs package (preferred) or Spur package until a second consumer" | `packages/domain` module now; `@gobing-ai/ts-bdd` reserved for promotion | Operator decision 2026-06-12 |
| `delete` verbs | A01/B01 "CRUD" | No `task delete` / `feature delete` — cancellation via lifecycle (`Cancelled` status; feature enum gains `cancelled`) | Operator review 2026-06-12 |
| D01 workflow name | `config/workflows/task-standard.yaml` | `config/workflows/task-pipeline.yaml` — "standard" vs "lifecycle" invited exactly the state-vs-work confusion this doc exists to prevent | Operator review 2026-06-12 |
| Board slice timing | E01/E08/E09/E10 in batch (Wave 3); board lands with schema migration | Postponed behind the server/web design task; A17 cutover waits for the board; E11 + X04 stay in batch | Operator decision 2026-06-12 |
| K-wrapper relocation | I10: prompt skills move into `plugins/sp` (incl. review/verification wrappers) | Review/verification wrappers **held** (drop-or-rewrite later, live in cc-agents meanwhile); only brainstorm / doc-evolve / daily-summary / anti-hallucination move, each with its §7.2 disposition | Operator review 2026-06-12 |
| H05 packaging | Testing utilities as batch work | Shared workspace held; per-workspace `tests/helpers.ts` interim | Operator decision 2026-06-12 |
| C-pipeline skill shape | "a `plugins/sp` fat skill" (singular, planning-only) | `sp:spur-dev` umbrella: spec pipeline is its planning half, the dev-* work loop its other half; `sp:spur-tasks`/`sp:spur-features` are reference companions. Fat-Skills fixes SSOT placement, **not** skill count — granularity is balanced per design | Operator decisions 2026-06-12 |
| Command family naming | (implicit `plan-*` in v1 of this doc) | `sp:dev-*`, continuing `rd3:dev-*` names — operator's daily drivers; two-register vocabulary (planning = architecture, dev = agent-facing) | Operator decision 2026-06-12 |
| Feature lifecycle | B07: backlog/active/blocked/done | Gains `verifying` (acceptance state — makes verification work derivable) and `cancelled` (terminal) | Operator decisions 2026-06-12 (design DD-13) |
| Feature ID scheme | Feature-file spec: `FT-NNN` + `parent_id` | Hierarchical letter+digit IDs (groups at init; one digit per level; length = depth; no `parent_id` field); files `docs/features/<ID>_<slug>.md` | Operator decision 2026-06-12 (design DD-14) |
| Platform adapters | F05–F11/M11 deferred | **Out of scope** — independent external tool planned by the operator | Operator decision 2026-06-12 |

---

*Companion documents: `2026-06-10-rd3-migration-feature-list.md` (dispositions; item IDs),
`2026-06-10-rd3-tasks-bdd-research.md` (BDD format evidence). Decisions: ADR-020–023 in
`docs/00_ADR.md`. Mechanism: `docs/03_ARCHITECTURE.md §12`. Landing zone: `docs/04_DESIGN.md §7`.*
