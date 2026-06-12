# Spur Harness — Migration Feature Triage (rd3 → spur-new)

**Date:** 2026-06-10 (inventory) · 2026-06-11 (triage)
**Source:** `cc-agents/docs/plans/2026-06-10-rd3-migration-feature-list.md` — item numbers and feature
IDs are preserved exactly. The source doc remains the reference for the original Current/Target
columns; this document is the **disposition record** and the input to the upcoming implementation
batch.
**Governing decisions:** ADR-020 (planning-layer surface: `spur task`/`spur feature`), ADR-021
(functionality in `packages/app`; apps are wrappers — write-path unification is its consequence),
ADR-022 (task/feature lifecycle runs on `spur workflow`), ADR-023 (dividing line, Fat Skills,
design-collectively/implement-in-phases) — see `docs/00_ADR.md`.

## Triage marks

The operator's four marks, plus one addition (`done`) because the source list contains items that
already ship in spur-new today — calling them `need` would schedule no-op work, calling them
`rejected` would misstate intent:

| Mark | Meaning |
|---|---|
| `need` | Necessary as written; in the upcoming implementation batch. |
| `fixed-need` | Necessary, but the description/solution/direction was corrected first — implement per the Note. |
| `deferred` | Necessary eventually; explicitly pushed past this batch so the core lands smoothly. |
| `rejected` | Not added — a strong, stated reason exists. Revisit only if the stated condition changes. |
| `done` | Already exists in spur-new; no migration work. |

**Batch definition:** the upcoming implementation batch = all `need` + `fixed-need` items + the
add-back items X01/X02/X04/X05 (X03 is deferred to the server/web design task). Per ADR-023(3),
the batch opens with a **collective design stage** covering everything below — architecture
adjustments included — before wave implementation. `deferred` items return in later batches;
`rejected` items are dropped with rationale.

## Corrections to the source document (global)

1. **Item count.** The source summary claims **141** features; the group counts it lists
   (18+10+6+8+12+11+8+13+17+8+5+12+12) sum to **140**. There is no missing ID — the source total was
   an arithmetic slip. This document carries all 140 IDs.
2. **Target paths are indicative, not binding.** Final package layout follows ADR-020 and
   `03_ARCHITECTURE §12` (task/feature domain is Spur-local; generic pieces upstream to
   `@gobing-ai/ts-*`). Where an item's original target is wrong in direction (not just path), the
   correction is in its Note and the item is marked `fixed-need`.
3. **Premise 10 / M12 (`spur agent run`).** Listed as "New" in the source; it already exists in
   spur-new (`01_PRD §5.1`: single-shot done, team-mode pending verification). Corrected at M12.
4. **`ftree` CLI name.** The feature-file design spec's `ftree` contract maps to `spur feature <verb>`
   in spur-new (one binary, noun-verb grammar per ADR-014).
5. **Config location.** Legacy `docs/.tasks/config.json` concepts move into `.spur/config.yaml`
   (ADR-017 single config). Corrected at A11/H03.
6. **`spur plan` noun dropped (2026-06-11 operator review).** The pipeline is LLM orchestration —
   skill territory per ADR-016/ADR-023, not CLI territory. C01–C03 re-marked `fixed-need`: a
   `plugins/sp` fat skill drives `spur agent run` + the deterministic verbs; the CLI validates
   every LLM output before write.
7. **`spur serve` deferred (2026-06-11 operator review).** The board launcher belongs to the
   server/web design task (ADR-021 consequence b). X03 re-dispositioned accordingly.
8. **Lifecycle mechanism corrected (2026-06-11 operator review).** Task/feature lifecycles run on
   `spur workflow` (ADR-022), not a local static transition table. A04/B07 re-marked; D08's
   EventBus seam becomes the sanctioned customization mechanism.
9. **"Minimal structural change only" superseded** by ADR-023(3): design collectively, implement
   in phases. Notes below that referenced the old premise read through that lens.

---

## A. Core CLI — Task Management

Target shape: `spur task <verb>`; domain logic in Spur-local packages (ADR-020); templates and
section-matrix config ship as real files under `./config` (ADR-015 pattern).

| # | Feature | Mark | Note |
|---|---|---|---|
| A01 | Task file CRUD — create, read, update, delete markdown task files | need | Slim the create surface (review backlog #9): the two hot paths (`update <wbs> <status>`, `update --section --from-file`) are the ergonomic center. |
| A02 | WBS auto-increment across configured folders with file-lock safety | need | Race-safe allocation preserved from legacy (`create.ts:80` pattern). |
| A03 | Task section editing via `--section --from-file` | need | The dominant agent workflow — 45% of all updates in the 90-day sample. |
| A04 | Status lifecycle — canonical enum + FSM validation | fixed-need | **Correction (ADR-022):** the lifecycle is a `spur workflow` definition under `config/workflows/`, executed by the dual-workflow engine — not a local transition table. Frontmatter `status` stays the SSOT; engine persistence is derived. Upstream engine gaps (long-lived externally-triggered runs) are Stage-D ts-libs tasks. |
| A05 | Task listing with status/phase filter | need | |
| A06 | Kanban board generation (`refresh` → `kanban.md`) | need | |
| A07 | Task validation (`spur task check`) | fixed-need | **Correction:** core validation is Zod schema + Section-Status-Matrix + format rules implemented in the task domain — not "backed by `ts-rule-engine`". The rule engine evaluates path-scoped constraint rules; task check is schema-shaped structural validation. An optional rule-engine evaluator wrapper may expose it to `spur rule run` later. Also absorbs C04 (traceability validation). |
| A08 | Batch task creation from JSON / agent output | need | Feeds C03 decomposition. |
| A09 | Task artifact storage — put/get/tree per-task attachments | **rejected** | Near-zero usage in 90 days of CC transcripts (review §2.1); `--section --from-file` covers the job-to-be-done; ~400 LOC of dead surface. Do not migrate. Revisit only if cross-agent usage data shows real demand. Resolves I08 to "remove". |
| A10 | Task discovery by file path (`get-wbs`, `get-file` → `resolve`) | need | Required by the write-guard hook (F04). |
| A11 | Project config — folder registration, active folder, base counter | fixed-need | **Correction:** lives in `.spur/config.yaml` (ADR-017 single config), not a ported `docs/.tasks/config.json`. Task-domain keys join the existing zod config schema. |
| A12 | Template engine — variant templates (sub-task / spec / meta) with opt-in sections | need | Fixes the "6–8 empty stubs" failure (review §2.6). Templates are real files under `./config/templates` (ADR-015). |
| A13 | Section-Status Matrix — required sections per status | need | Warning-first enforcement; hard-gate only the small core (AC format, Solution `file:line`, Review P1–P4 table) per the operator-feedback "Design Tension" recommendation. |
| A14 | Section format validation — Gherkin syntax, P1–P4 table, citations | need | Uses the shared BDD validator (X01). |
| A15 | Status transition history — append-only `## History` | need | Also fixes `updated_at` reliability (review §2.5); transition events ride the engine's EventBus seam (ADR-022, X04). |
| A16 | `--json` output mode for all commands | need | Already a spur-new invariant (ADR-010); listed for completeness of the new noun. |
| A17 | Task migration — `spur task migrate` normalizes schema/status/timestamps/keys | need | One idempotent pass over all 7 corpora: canonical status, collapse `preset`/`profile`, normalize `feature_id`, drop `description` default, remove `impl_progress` (review backlog #2, #4–#6 fold in here). Cutover gating: see batch sequencing note. |
| A18 | Zod frontmatter schema — single source of truth, parse-validate-serialize | need | P0. Includes `schema_version` (review §3.1) and the `parent_wbs` field (X02). |

## B. Core CLI — Feature Management

Target shape: `spur feature <verb>` over `docs/features/FT-NNN_name.md` per the Feature File Design
Spec (operator-feedback doc).

| # | Feature | Mark | Note |
|---|---|---|---|
| B01 | Feature file CRUD (`docs/features/FT-NNN_name.md`) | need | |
| B02 | Feature listing with status/priority filter | need | |
| B03 | Feature index regeneration (`refresh` → `INDEX.md`) | need | |
| B04 | Task-to-feature link display — auto-populate `## Tasks` sections | need | Task files are never modified by refresh — only feature files. |
| B05 | Feature section editing — same `--section --from-file` contract as tasks | need | Shared write path with tasks (H01 + E11). |
| B06 | Feature tree hierarchy — `parent_id` frontmatter, indented INDEX view | need | Flat filesystem; the index renders the tree. |
| B07 | Feature status lifecycle — backlog/active/blocked/done | fixed-need | **Correction (ADR-022):** same mechanism as A04 — a `spur workflow` definition, frontmatter SSOT. |
| B08 | Feature acceptance criteria validation — Gherkin check in `## Acceptance Criteria` | need | Uses the shared BDD validator (X01). |
| B09 | Active-goal derivation — active P0 feature IS the project goal | need | Quick win: `spur task create` reads the active feature's `## Goal` as default Background; "one active goal" enforced by check. |
| B10 | Feature file migration — convert legacy SQLite/in-memory tree | **rejected** | Nothing of value to migrate: the legacy tree was in-memory (no data survives sessions) and adoption was near-zero (47/67 task `feature-id`s empty). Features are authored fresh in markdown. |

## C. Core CLI — Spec-Driven Pipeline

**No `spur plan` noun** (global correction #6). The pipeline is a `plugins/sp` **fat skill**
(ADR-023) driving `spur agent run` plus the deterministic verbs (`spur feature create|check`,
`spur task batch-create`); the CLI validates every LLM output before write.

| # | Feature | Mark | Note |
|---|---|---|---|
| C01 | Vague-description-to-spec — prompt → feature file with BDD AC | fixed-need | **Correction:** skill step, not a CLI verb. The product through-line (operator Point 2: BDD-as-contract) — the skill creates via B01, fills AC, validates via B08. |
| C02 | BDD scenario generation — LLM generates Gherkin from feature description | fixed-need | **Correction:** skill step via `spur agent run`; output gated by the shared BDD validator (X01) before write. |
| C03 | Feature-to-task decomposition — feature AC → task files linked via `feature-id` | fixed-need | **Correction:** skill step over A08 batch-create; replaces the `rd3:task-decomposition` output contract in lockstep with the new schema (review §5). |
| C04 | Task-to-spec traceability validation | fixed-need | **Correction:** traceability checks live in `spur task check` (A07) and `spur feature check` (B08). One validation surface; no forwarding verbs (lean-CLI preference, ADR-016 logic). |
| C05 | Pipeline status overview — active features, tasks, blockers | deferred | `INDEX.md` + `kanban.md` + `spur status` cover the overview initially; a dedicated view returns with the dashboards (E04). |
| C06 | Brainstorm as a standalone CLI step | **rejected** | Per the ADR-016 decision test: brainstorm is fuzzy-intent LLM work — it stays a prompt skill in `plugins/sp` delegating to `spur agent run`. A dedicated CLI verb is a forwarding layer with no deterministic value. (The skill itself is retained — see I05.) |

## D. Task Execution Engine

Workflow YAML is the primary execution interface; agent skills call `spur workflow run`, never the
engine directly (source premise — confirmed).

| # | Feature | Mark | Note |
|---|---|---|---|
| D01 | Task-runner workflow YAML — implement → test → review → verify | need | `config/workflows/task-standard.yaml`; review/verify steps delegate to `spur agent run` + sp skill prompts. |
| D02 | Workflow orchestration — multi-task pipeline, guards, execution modes | **done** | Already replaced: `@gobing-ai/ts-dual-workflow-engine` + `sp:spur-workflows` + `spur workflow run`. |
| D03 | Execution modes — local (in-process), direct (subprocess) | **done** | Engine execution adapters already in spur-new; LLM steps via `spur agent run`. |
| D04 | HITL actions — approval gates, review checkpoints | need | CLI first (`spur workflow continue <run-id>`); upstream pause/resume in `ts-dual-workflow-engine` is a Stage-D ts-libs task (same engine work the A04/B07 lifecycles need — ADR-022). Board-side HITL trigger follows the server/web design. |
| D05 | Pre-task gate — `spur task check` as workflow guard | need | A guard step in task-standard YAML; trivial once A07 + D01 exist. |
| D06 | Execution result recording — verdict/coverage/findings → task `## Review` | need | A workflow step writing through the unified write service (E11), not a standalone command. |
| D07 | Auto-trigger — scheduler detects Ready tasks, invokes workflows | deferred | Operator verdict stands (Point 10, P3): notify-only first, full auto-trigger later. The architectural prep — lifecycle events on the engine seam (ADR-022, X04) — ships now, so this attaches later without rework. |
| D08 | Workflow extensions — custom logic via EventBus pub/sub | fixed-need | **Correction (ADR-022):** the engine's EventBus pub/sub seam is the sanctioned customization mechanism and ships as part of the lifecycle integration (`on_transition`/`on_guard_fail`/`on_complete`). Concrete custom extensions are added as real needs appear — the seam is batch work, speculative extensions are not. |

## E. Spur Web — Board & API

Per ADR-021, any server task routes mutate through the same `packages/app` write service the CLI
uses — one lock domain by construction. The board's concrete shape and launcher come from the
**Stage-D server/web design task** (ADR-021 consequence b); the E items below are batch scope
executed per that design. **Coupling constraint:** the legacy `tasks server` board must be frozen
(read-only) at A17 corpus-migration cutover — its regex write path would corrupt normalized files —
so the minimal board lands in the same batch as the schema migration.

| # | Feature | Mark | Note |
|---|---|---|---|
| E01 | Kanban web UI — drag-and-drop board with status columns | need | Legacy parity only — this is the operator's daily driver. Built as plain Astro pages/components (no container framework, see E06). |
| E02 | Task detail view — single task, all sections, history | deferred | Not legacy parity (the old board had no detail view); add after the board ships. |
| E03 | Feature tree view — interactive INDEX tree | deferred | `INDEX.md` covers it meanwhile. |
| E04 | Pipeline dashboard — live orchestration status | deferred | Depends on orchestrated runs at volume + D07; Phase-4 territory. |
| E05 | Analytics dashboard — velocity, cycle time, distribution | deferred | Roadmap Phase 4 (inspection surface) item. |
| E06 | Plugin container framework — register/enable/layout plugins | deferred | ADR-012 lesson applies verbatim: don't build a container before a third consumer exists. The board ships as plain pages; extract a container when real modularity pressure appears. The premise-5 vision stands — the timing changes. |
| E07 | Multi-workspace support | deferred | Single workspace first; same YAGNI reasoning as E06. |
| E08 | SSE real-time updates — status changes pushed to web clients | need | Server-mode push is sanctioned (the cerebrum "polling until server mode" preference is about CLI watching; the board IS server mode). Fed by X04 events. |
| E09 | HTTP API — REST/SSE for task CRUD | need | All writes through the unified write service (E11). |
| E10 | oRPC typed contract — task DTOs shared CLI/server/web | need | Transport DTOs only in `packages/contracts` (ADR-005 invariant). |
| E11 | Write-path unification — CLI and HTTP through one validated service, one lock domain | need | A consequence of ADR-021 (write service in `packages/app`); fixes the real file-corruption race (review §2.4). Lifecycle events ride the engine seam (X04). |
| E12 | Cloudflare Pages/Worker deployment | **done** | Bun + CF entrypoints already ship (ADR-019, health slice green under `test-cf`). The task board itself stays local-first (ADR-010); CF deployment of a read-only board is a later option, not batch work. |

## F. Agent Integration Layer (`plugins/sp/`)

| # | Feature | Mark | Note |
|---|---|---|---|
| F01 | SKILL.md wrappers — skills drive `spur task|feature|workflow|agent` | need | Fat Skills (ADR-023): skills are the SSOT and may be rich — incl. the planning pipeline (C01–C03); they delegate deterministic execution to CLI verbs where they exist. |
| F02 | Subagent wrappers — thin wrappers of skills | need | Per ADR-023(2). |
| F03 | Slash command wrappers | fixed-need | **Correction:** do not port the 42 commands 1:1. Apply the ADR-016 decision test per candidate — commands exist only where the LLM converts non-deterministic intent into a reliable sequence. Expect a much smaller set (the `spur rule` precedent: 6 operations → 3 commands). |
| F04 | Hook wrappers — write-guard etc. delegate to the CLI | need | Write-guard maps file→task via `spur task resolve` (A10) and validates via check (A07). |
| F05 | Plugin install / `spur plugin convert` | deferred | Source premise 4 already defers it: per-platform install scripts work; unification is P3 polish. Same item as M11. |
| F06 | Codex adapter | deferred | Generated by F05; blocked behind it. |
| F07 | Antigravity adapter | deferred | Same. |
| F08 | PI adapter | deferred | Same. |
| F09 | OpenCode adapter | deferred | Same. |
| F10 | OpenClaw adapter | deferred | Same. |
| F11 | Gemini CLI adapter | deferred | Same. |

## G. Domain Engines (`@gobing-ai/ts-*`)

The source doc lists these "for completeness — they already exist". All marked `done`: they ship in
spur-new today (`01_PRD §5.1`); no migration work.

| # | Engine | Mark | Note |
|---|---|---|---|
| G01 | Rule engine | **done** | Consumed by `spur rule`; run persistence since 0.3.16. |
| G02 | Dual workflow engine | **done** | Consumed by `spur workflow`. |
| G03 | EventBus | **done** | ts-infra; X04 is its new task-domain producer. |
| G04 | Scheduler + Job Queue | **done** | ts-infra; consumer (D07) deferred. |
| G05 | Logger | **done** | ts-infra; wired via `runApplication` (ADR-017/019). |
| G06 | AI Runner | **done** | Backs `spur agent`; see M12 for remaining verification. |
| G07 | DB Adapter + DAOs | **done** | ts-db facade per ADR-011. |
| G08 | LLM JSONL Importer | **done** | Backs `spur history`. |

## H. Cross-Cutting Concerns

Spur-new already owns much of this layer through `@gobing-ai/ts-*`; the corrections below prevent
parallel re-implementations (AGENTS.md shared-library evolution rule: enhance the owning package,
don't fork a local copy).

| # | Feature | Mark | Note |
|---|---|---|---|
| H01 | Unified markdown frontmatter library — read/write/validate frontmatter + body sections | need | Spur-local package first (tasks + features are its only consumers); promote to ts-libs only when a second project needs it. |
| H02 | Shared error/output formatting — `Result<T>`, JSON/human output, exit codes | fixed-need | **Correction:** reuse/extend `@gobing-ai/ts-utils` (output, errors, api-response already live there). No parallel `packages/cli-utils`; gaps go upstream. |
| H03 | Config loader — project-level config discovery | fixed-need | **Correction:** already solved — `.spur/config.yaml` via the ts-infra/ts-runtime config stack (ADR-017). Don't port `lib/config.ts`; add task-domain keys to the existing schema (A11). |
| H04 | File locking — per-WBS and create-lock with staleness detection | need | One lock domain shared by CLI and server (E11). |
| H05 | Testing utilities — temp dirs, fixture factories, CLI invocation helpers | need | Supports the ≥90% per-file coverage bar; in-memory SQLite per test (project testing rules). |
| H06 | Skill → CLI code extraction (umbrella) | fixed-need | **Correction:** scope reduced to the `need`/`fixed-need` groups of this batch. K/L/M extraction is deferred with those groups — their scripts keep running in cc-agents meanwhile. |
| H07 | Grading utilities | deferred | Meta-tooling backbone — moves with M06–M10. |
| H08 | Validation findings accumulator | deferred | Same. |
| H09 | Markdown analysis (headings, language, TODO counters) | deferred | Same. |
| H10 | Best-practice fix engine (17k) | deferred | Same. |
| H11 | Evolution engine (53k) + contract | deferred | The single largest shared dependency, consumed only by meta-tooling. Moves when M06–M10 move; fully functional in cc-agents until then. |
| H12 | FS utilities — Bun-native file operations wrapper (12k) | fixed-need | **Correction:** `@gobing-ai/ts-runtime` FileSystem is already the seam. Port only genuinely missing helpers upstream; do not land a parallel fs wrapper. |
| H13 | Shared `Result<T>` monad | fixed-need | **Correction:** consolidates on `@gobing-ai/ts-utils` error/result primitives; extend upstream if a true Result monad is missing. (Folds into H02's resolution.) |

## I. What Gets Removed / Archived

Cleanup executes at the batch tail, only after each replacement is verified (Phase-7 position
unchanged).

| # | Item | Mark | Note |
|---|---|---|---|
| I01 | Legacy Vite+React UI (3.2k LOC, 1.4MB assets) | need | After E01 + X03 are the operator's daily driver. |
| I02 | Legacy Bun.serve server (1.1k LOC) | need | After E09/E08 land. |
| I03 | Legacy feature-tree (in-memory + SQLite) | need | After B-group lands (B10 rejected — no data migration). |
| I04 | `rd3:feature-planning` skill logic | need | Consolidated into the C pipeline; prompt stays as a skill. |
| I05 | `rd3:brainstorm` as separate executable | need | Prompt skill stays in `plugins/sp` (C06 rejected the CLI verb). |
| I06 | `rd3:dev-new-task` command | need | Consolidated into the C pipeline. |
| I07 | `rd3:orchestration-v1` skill | need | Deprecated; archival not blocked by its imports. |
| I08 | `tasks put/get/tree` artifact commands | fixed-need | **Conditional resolved:** A09 is rejected ⇒ remove outright; no merge needed. |
| I09 | All `plugins/rd3/` executable scripts post-verification | need | The migration's end state. |
| I10 | Prompt-engineering skills stay in `plugins/sp/skills/` | need | Move action only — no executable logic. |
| I11 | `rd3:orchestration-v2` executable scripts | need | Already replaced; archive scripts, SKILL.md may stay for back-compat. |
| I12 | `rd3:verification-chain` executable scripts | need | Already absorbed as workflow guards; archive. |
| I13 | `rd3:run-acp` | need | Replaced by `spur agent run`; archive. |
| I14 | `rd3:dev-verification` empty stub | need | Delete entirely. |
| I15 | `rd3:code-docs` | need | Stays as prompt template in `plugins/sp` (I10 list). |
| I16 | `rd3:daily-summary` script | fixed-need | **Decision:** the script stays embedded in the `plugins/sp` skill — no CLI extraction. A one-off generator with no harness role doesn't earn a `spur` verb (lean-surface preference). |
| I17 | `acpx-query.ts` (35k) + orchestration/verification cross-skill imports | need | Archive with I07/I11/I12; document any ACP interaction patterns that inform `spur agent run` hardening (M12) — do not migrate the library. |

## K. Verification & Review Engine

The review/testing skills keep working **today** as `plugins/sp` prompt wrappers driving
`spur agent run` — extraction of their executable parts is not on the critical path.

| # | Feature | Mark | Note |
|---|---|---|---|
| K01 | Code review (SECU lenses) | deferred | Runs as sp skill + `spur agent run` meanwhile; extract post-stabilization. |
| K02 | Code verification (P1–P4 findings) | deferred | Same. |
| K03 | Code improvement (refactoring pass) | deferred | Same. |
| K04 | Functional review (traceability assessment) | deferred | Same. |
| K05 | Anti-hallucination protocol → `packages/anti-hallucination` | **rejected** | A prompt protocol (how-to-think) — wrong side of the ADR-023 dividing line. Stays a skill in `plugins/sp`; building a package for it is over-engineering. |
| K06 | Sys-testing — test execution with coverage measurement | deferred | Near-term test gates run via rule presets (coverage-gate) and workflow shell guards; consolidate with the deferred `spur inspect` surface (N group) rather than a standalone command. |
| K07 | Advanced testing — mutation/property/fuzzing | deferred | Niche; after the core. |
| K08 | BDD feature validator (`validate-feature.ts`, 543 lines, 100% coverage) | need | Required **now** by A14/B08/C02. Lands as the shared BDD validator — see X01 for the consolidated shape and ts-libs home. |

## L. Context & Knowledge Layer

| # | Feature | Mark | Note |
|---|---|---|---|
| L01 | Indexed context → `packages/context-engine` | deferred | Skills keep working in cc-agents; design the agent-agnostic shape later. |
| L02 | Deep research CLI | deferred | Also re-apply the ADR-016 test at design time — much of it is prompt work. |
| L03 | Knowledge extraction CLI | deferred | Same. |
| L04 | Reverse engineering CLI | deferred | Same. |
| L05 | Quick grep → CLI command | **rejected** | It is rg-usage guidance; a CLI wrapper duplicates `rg` and adds a drift surface for zero value (lean-surface preference). The prompt skill stays in `plugins/sp`. |

## M. Coordination & Meta-Tooling

The meta-tooling (M06–M10) and its backbone (H07–H11) stay **live in cc-agents** until the core
stabilizes — deferral costs nothing because nothing breaks in the meantime.

| # | Feature | Mark | Note |
|---|---|---|---|
| M01 | Session handoff | deferred | |
| M02 | Sys-debugging | deferred | Prompt-led workflow; re-apply ADR-016 test at design time. |
| M03 | Token optimizer package | deferred | |
| M04 | CLI design guidance package | deferred | |
| M05 | Product management (PRD generation) | deferred | |
| M06 | Skill authoring (cc-skills) | deferred | Stays in cc-agents until core stabilizes. |
| M07 | Command authoring (cc-commands) | deferred | Same. |
| M08 | Agent authoring (cc-agents) | deferred | Same. |
| M09 | Hook authoring (cc-hooks) | deferred | Same. |
| M10 | Main-agent config authoring (cc-magents) | deferred | Same. |
| M11 | `spur plugin convert` | deferred | Same item as F05; P3 per source premise 4. |
| M12 | `spur agent run` — universal LLM execution engine | fixed-need | **Correction:** not new. Already in spur-new (`01_PRD §5.1`: single-shot done; team-mode pending verification). Remaining batch work: verify team-mode, harden, and document it as the single LLM execution surface for skills and workflow YAML. |

## N. `spur inspector` — Project State Interrogation

**Naming correction recorded now (binding when built):** the noun is **`spur inspect <verb>`** — one
noun, no `inspector`/`inspect` near-collision with the planned run-inspection surface (which joins
as `spur inspect run <id>` later). **Group disposition: deferred.** The adapter-based design is
right and is preserved; but near-term guard needs (coverage/lint gates in workflow YAML) are covered
by `ts-rule-engine` evaluators (coverage-gate restoration is Roadmap Phase 3) plus shell guards.
Deferring the whole surface protects the core batch.

| # | Feature | Mark | Note |
|---|---|---|---|
| N01 | `spur inspect coverage [--threshold N]` | deferred | Carries the naming fix; ships with `bun-typescript` adapter MVP when built. |
| N02 | `spur inspect changed [--since <ref>]` | deferred | |
| N03 | `spur inspect lint` | deferred | |
| N04 | `spur inspect typecheck` | deferred | |
| N05 | `spur inspect deps [--outdated]` | deferred | |
| N06 | `spur inspect tasks <wbs>` | **rejected** | The source doc itself calls it a "wrapper around `spur task show --json`" — a pure forwarder, the exact zero-value wrapper ADR-016 forbids. Use `spur task show --json`. |
| N07 | `spur inspect features` | **rejected** | Same reasoning — forwards `spur feature list --json`. |
| N08 | Adapter JSON Schema | deferred | |
| N09 | Adapter validation verb | deferred | |
| N10 | `sp:spur-inspect` skill | deferred | |
| N11 | `sp:inspect-*` slash commands | deferred | |
| N12 | `expert-inspect` subagent | deferred | |

---

## Step 3 — Add-Backs (X group)

Features the original inventory missed (or left implicit). X01/X02/X04/X05 join the batch —
grouping them with their relatives raises delivery quality and token efficiency; X03 is deferred
to the server/web design task (global correction #7).

| # | Feature | Why it's added | Target |
|---|---|---|---|
| X01 | **Shared BDD validator engine** — Gherkin-subset parser + checklist (`- [ ]`) parser + AC-coverage check + tag-filter hooks; AST aligned with `@cucumber/gherkin` types (BDD research §7.2, no runtime dep) | One implementation behind A14, B08, C02-output validation, and the A07 traceability check — instead of four call sites growing private parsers. Port of `validate-feature.ts` (K08). Generic by nature → ts-libs candidate (`@gobing-ai/ts-bdd` or a ts-utils subpath) per the shared-library evolution rule. | ts-libs package (preferred) or Spur package until a second consumer |
| X02 | **Sub-task hierarchy — single `parent_wbs` convention** — schema field (in A18), check validation, `spur task list --parent <wbs>`, grouped kanban rendering | Review backlog #10 (P2): three competing unenforced conventions exist in the corpus; the inventory dropped this item entirely. Costs little while A18/A17 are open; expensive to retrofit later. | task domain + A17 normalization |
| X03 | **Local board launcher** — the `tasks server &` replacement; how the operator starts the board from any project | **Deferred (2026-06-11):** belongs to the Stage-D server/web design task (ADR-021 consequence b) — whether it's a `spur serve` verb wrapping the `packages/app` server factory, or running `apps/server` directly, is decided there. Not batch scope. | server/web design task |
| X04 | **Task lifecycle event contract** — typed event map for task/feature transitions on the engine's EventBus seam (ADR-022) | The architectural prep the operator asked to do now (Point 10): SSE (E08) consumes it in this batch; scheduler (D07) attaches later with zero rework. The seam comes from the engine; this item defines the Spur-side typed contract. | lifecycle integration (A04/B07/E11) |
| X05 | **Doc sync as a scheduled item** — `04_DESIGN.md` gains task/feature/plan/serve command + schema sections in the same commits the commands land; `05_FEATURES.md` rows track status | AGENTS.md mandates same-commit `04` sync for any command/config/schema change; making it an explicit batch item ensures it is scheduled, not remembered. | docs |

---

## Batch sequencing (need + fixed-need + X01/X02/X04/X05)

Dependency order, not a project plan. Deferred groups re-enter in later batches.

```
Stage D — Collective design (ADR-023(3); gates all waves)
  Task/feature schemas + section matrix + templates → 04_DESIGN.md
  Lifecycle-on-workflow design (ADR-022) + upstream ts-dual-workflow-engine gap list
    (long-lived externally-triggered runs, pause/continue, HITL) → ts-libs tasks
  Server/web design task (board shape, launcher = X03, oRPC task surface — ADR-021.b)
  sp planning fat-skill contract (C01–C03)

Wave 0 — Foundation
  H01 (frontmatter lib) · H04 (locking) · H05 (test utils)
  H02/H03/H12/H13 (consolidate on ts-utils / ts-runtime / config — upstream gaps first)
  A18 (Zod schema, schema_version, parent_wbs) · X01 (BDD validator)
  A04/B07 lifecycle workflow definitions + upstream engine enhancements (ADR-022)
  A17 (migrate tool — build now, cut over later, see note)

Wave 1 — Task CLI
  A01–A03, A05, A06, A07(+C04), A08, A10, A11, A12, A13, A14, A15, A16 · X02

Wave 2 — Feature CLI + traceability
  B01–B06, B08, B09

Wave 3 — Board (per Stage-D server/web design)
  E10 → E09 → E11(+X04, H04, D08 seam) → E08 → E01 → launcher per design outcome
  ► A17 cutover gate: run corpus migration + freeze legacy `tasks server` ONLY when
    the spur board is daily-driver usable — the operator must never be boardless.

Wave 4 — Pipeline + execution
  sp planning fat skill (C01–C03) · D01, D04 (HITL continue — engine-backed), D05, D06
  M12 verification

Wave 5 — Agent wrappers
  F01, F02, F03 (ADR-016-filtered), F04 · X05 (continuous from Wave 1)

Wave 6 — Cleanup (cc-agents side)
  I01–I17 as marked, each gated on its replacement being verified
```

---

## Summary — disposition distribution

| Mark | Count | Share |
|---|---|---|
| need | 53 | 37.9% |
| fixed-need | 18 | 12.9% |
| deferred | 51 | 36.4% |
| rejected | 7 | 5.0% |
| done | 11 | 7.9% |
| **Total (matches source IDs)** | **140** | 100% |

**Upcoming implementation batch:** 53 need + 18 fixed-need + 4 add-backs (X01/X02/X04/X05) =
**75 items**, opened by the Stage-D collective design (ADR-023(3)).

| Disposition detail | Items |
|---|---|
| rejected | A09, B10, C06, K05, L05, N06, N07 |
| done | D02, D03, E12, G01–G08 |
| fixed-need | A04, A07, A11, B07, C01, C02, C03, C04, D08, F03, H02, H03, H06, H12, H13, I08, I16, M12 |
| deferred (by theme) | Board launcher (X03 → server/web design task) · web beyond the board (E02–E07) · platform adapters (F05–F11, M11) · meta-tooling + backbone (M01–M11, H07–H11) · review/testing extraction (K01–K04, K06, K07) · context/research (L01–L04) · `spur inspect` (N01–N05, N08–N12) · auto-trigger (D07) & pipeline overview (C05) |

---

*Companion documents: `2026-06-10-rd3-tasks-bdd-research.md` (copied into this repo),
`cc-agents/docs/plans/2026-06-10-rd3-tasks-review-brainstorm.md` (evidence base),
`cc-agents/docs/plans/2026-06-10-rd3-tasks-operator-feedback.md` (operator feedback + feature file
design spec). Decisions: ADR-020–023 in `docs/00_ADR.md`.*
