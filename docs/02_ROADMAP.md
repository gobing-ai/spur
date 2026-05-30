# 02 Roadmap — Spur

**Version:** 0.8.1
**Derived from:** `docs/01_PRD.md` v0.7.0 (§7–10), `docs/03_ARCHITECTURE.md` v0.3.3
**Last Updated:** 2026-05-08
**Owner:** Robin Min

> Phasing follows PRD §8 (Delivery Roadmap) and the architectural commitments in `03_ARCHITECTURE.md`.
> Each phase gates on the previous one; no phase ships until its predecessor is stable.
> When this document conflicts with a decision in [`docs/06_DECISIONS.md`](./06_DECISIONS.md), the decision wins — flag the drift and resolve it explicitly.

---

## Phase 0 — Foundation Stabilisation _(current)_

**Goal:** The existing Bun monorepo starter must be a reliable development base before any Spur-specific work begins. Phase 0 is a quality gate, not a feature phase.

| #   | Task                                                                                      | Status                                                                                          |
| --- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 0.1 | `dev:all` port cleanup — kill stale processes on ports 3000/4321 before spawning new ones | ✅ done                                                                                         |
| 0.2 | Eager lifecycle registration — SIGINT/SIGTERM handlers fire before first HTTP request     | ✅ done                                                                                         |
| 0.3 | Pass `FileSystem` to DB middleware adapter creation (parent-directory safety)             | ✅ done                                                                                         |
| 0.4 | Fix any remaining HMR / hot-reload race conditions uncovered by 0.1–0.3                   | ✅ done — fixed grandchild orphan issue in `scripts/dev-all.ts`; 5/5 start-stop cycles verified |
| 0.5 | Hardening: ensure `bun run check` gate remains green after every Phase 0 commit           | 🔲 _(needs explicit verification)_                                                              |
| 0.6 | Developer ergonomics: `bun run dev:all` must start cleanly from a cold checkout           | 🔲 _(needs explicit verification)_                                                              |
| 0.7 | Remove stale `apps/server/data/` directory (DB lives at `<repo>/data/`)                   | ✅ done                                                                                         |

**Phase 1 cannot start until 0.4–0.6 are explicitly verified.** Run `bun run dev:all` from a cold checkout, exercise the three endpoints below, hit `Ctrl+C`, and confirm `bun run check` is green. Update the status column inline.

**Acceptance criteria:**

- `bun run dev:all` starts server + web on first attempt with no port conflicts.
- Health (`/api/health`), events (`/api/events`), and queue-jobs (`/api/health/queue/jobs`) all return 200.
- `Ctrl+C` on `dev:all` terminates both server and web processes within 2 seconds.
- `bun run check` passes (typecheck + lint + test + coverage + policy).

---

## Phase 1 — MVP Harness Loop

**Goal:** Prove one local-first harness loop: `doctor → run → capture events → verify/constraint-check → inspect`.
**Thesis from PRD §3 Problem Statement:** Ship only the minimum needed to make one coding-agent run more controlled, auditable, and inspectable than today's scattered workflow.

> **Architecture map.** Phase 1 implements: §4 Domain Model (entities), §5 FSM Workflow Engine, §6 Rule Engine, §7 AI Runner, §8 Event Taxonomy, §9 Redaction & ETL (pre-persistence stage only), §10 Workspace Model, §11 Profile, §12 CLI Surface (Phase 1 row).
> **Decisions in scope:** D-003 (Pi default), D-004 (wrap airunner), D-005 (YAML rules), D-006 (FSM engine), D-007 (gates as predicates), D-008 (peer packages), D-009 (workspace as static record), D-010 (CLI-only), D-011 (rg/sg only), D-012 (redaction as pre-processing), D-013 (append-only events), D-014 (internal registry).

### 1.1 Kernel — Rule Engine

> **References:** Architecture §6, §17.7 §6 note (read `quick-grep` skill + `scripts/policy-check.ts` together as joint direction references). **ADRs:** D-005, D-011.

| #     | Task                                                                                                                                                          | Effort |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1.1.1 | Define `ConstraintRule` and `RuleSet` schema in `@spur/contracts` (id, description, severity, target globs, evaluator method, allowlist, remediation)         | S      |
| 1.1.2 | Implement rule loader in `@spur/kernel/src/rules/config` (D-027): read `.spur/rules/*.yaml` into normalized rule objects using `@spur/core/loader` primitives; kernel evaluation/execution code never reads YAML directly (D-008, D-027) | S      |
| 1.1.3 | Implement Phase 1 rule evaluators (`rg` and `sg` only — tree-sitter deferred per D-011): `path`, `regex`, `import-boundary`, `tsdoc-export`, `test-location`  | M      |
| 1.1.4 | Port existing repo AGENTS rules into YAML rule files (`.env*`, `.github/workflows/*`, `Dockerfile*`, migration changes, cross-imports, TSDoc, test locations) | S      |
| 1.1.5 | Implement `ConstraintFinding` persistence and structured JSON output                                                                                          | S      |
| 1.1.6 | CLI: `spur rule run --json`                                                                                                                                   | S      |

### 1.2 Kernel — FSM Workflow Engine

> **References:** Architecture §5, §17.7 §5 note (read `~/projects/cc-agents/plugins/rd3/skills/orchestration-v2` `engine/`, `state/`, `verification/` for design lessons; no code reuse per D-015). **ADRs:** D-006, D-007, D-015.

| #     | Task                                                                                                                                                                  | Effort |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1.2.1 | Define `WorkflowDefinition` schema in `@spur/contracts` (states, actions, transitions; transitions carry `when` predicates evaluated by gates per D-007)              | M      |
| 1.2.2 | Implement generic FSM engine in `@spur/kernel`: load normalized definition, validate transitions, execute actions, evaluate transition gates, persist `WorkflowState` | L      |
| 1.2.3 | Define and test the Phase 1 workflow `implement → check → fix-until-pass` with bounded max iterations (default 2)                                                     | M      |
| 1.2.4 | Persist workflow state transitions and make them inspectable via `spur inspect`                                                                                       | M      |

### 1.3 Kernel — AI Runner / Executor

> **References:** Architecture §7, §17.2 airunner rows (script + library). **Decisions:** D-003, D-004.
> Phase 1 wraps `~/projects/cc-agents/scripts/airunner.ts` via subprocess (D-004); typed extraction is a Phase 2 task.

| #     | Task                                                                                                                                                        | Effort |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1.3.1 | Wrap `airunner` via subprocess from `@spur/kernel`, exposing the three capabilities defined in Architecture §7.1 (doctor, list, run)                        | L      |
| 1.3.2 | Integrate ai-runner into the Spur CLI as a Kernel engine (not a one-off script)                                                                             | M      |
| 1.3.3 | ~~`spur agents --json`~~ — _removed; subsumed by `spur doctor`_                                                                                             | —      |
| 1.3.4 | `spur doctor --json` — match the `airunner doctor` table contract (PRD §10): per-agent installed/version/authenticated/usable; `-a, --agent` narrows to one | M      |

### 1.4 Kernel — Domain Model & Persistence

> **References:** Architecture §4 (all 9 entities), §8 Event Taxonomy. **Decisions:** D-009 (Workspace as static), D-013 (append-only events).

| #     | Task                                                                                                                                                                                            | Effort |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1.4.1 | Define and migrate Drizzle tables for the full Phase 1 entity set: `workspace`, `run`, `phase_run`, `run_event`, `gate_result`, `artifact`, `constraint_finding`, `asset_ref`, `workflow_state` | L      |
| 1.4.2 | Implement `RunEvent` append-only write path (D-013) with redaction before persistence (D-012)                                                                                                   | M      |
| 1.4.3 | Implement `Artifact` reference model (file, log, patch, report, generated output)                                                                                                               | S      |
| 1.4.4 | Wire typed event bus emissions (Architecture §8 taxonomy) into `RunEvent` persistence via the redacting observer                                                                                | M      |
| 1.4.5 | CLI: `spur run <task>` — resolves workspace, creates persisted run, drives FSM through at least one phase                                                                                       | L      |
| 1.4.6 | CLI: `spur status [run-id]` — show current/recent run status                                                                                                                                    | S      |
| 1.4.7 | CLI: `spur inspect <run-id>` — show timeline, events, artifacts, gates, findings                                                                                                                | M      |

### 1.5 Workspace Registry

> **References:** Architecture §10. **Decision:** D-009.
> Workspace is a static binding record; lifecycle lives on `Run`. Git context is computed at read time, not stored. Without a workspace, `spur run` has nothing to bind to — this sub-section is a Phase 1 prerequisite for §1.4.5.

| #     | Task                                                                                               | Effort |
| ----- | -------------------------------------------------------------------------------------------------- | ------ |
| 1.5.1 | Implement `@spur/workspaces` package with workspace registry queries (read-only kernel-facing API) | M      |
| 1.5.2 | CLI: `spur workspace add <repo-root> [--workdir] [--agent] [--workflow] [--purpose]`               | S      |
| 1.5.3 | CLI: `spur workspace list [--json]` — show registered workspaces with read-time git context        | S      |
| 1.5.4 | Resolve current workspace from `cwd` for `spur run` invocations (closest ancestor match)           | S      |

### 1.6 Verification Gates

> **References:** Architecture §5.3, §5.4. **Decision:** D-007.
> Gates are transition predicates, not standalone actions.

| #     | Task                                                                                                                                | Effort |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1.6.1 | Implement gate types: `command` (exit code), `file-exists`, `content-match`, `compound` (all/any)                                   | M      |
| 1.6.2 | Persist `GateResult` and link to `PhaseRun` and the FSM transition that evaluated it                                                | S      |
| 1.6.3 | Gate failure on a transition triggers the configured fallback transition (e.g. `check → fix`), bounded by max iterations on a guard | M      |

### 1.7 Profile

> **References:** Architecture §11. **Decision:** D-005.
> Profile loader resolves `.spur/config.yaml`, validates, expands templates, emits `NormalizedProfile` consumed by the kernel. The kernel never reads YAML directly.

| #     | Task                                                                                                                                          | Effort |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1.7.1 | Define `.spur/config.yaml` schema in `@spur/contracts` (project identity, runner defaults, gate defaults, storage paths, redaction overrides) | S      |
| 1.7.2 | Implement profile loader composed from `@spur/core/loader` + `@spur/kernel/src/{rules,workflow}/config` (D-027): resolve `.spur/` from closest ancestor, validate the envelope, dispatch rule/workflow loading to the kernel config modules | M      |
| 1.7.3 | `spur init` — generate `.spur/` scaffolding with default config, rule dirs, workflow dirs, empty DB                                           | S      |

### 1.8 Assets — Minimal Reference + Inspect (Registry Seam)

> **References:** Architecture §15 Extension Seams. **Decision:** D-014 (internal registry).
> Phase 1 ships only the asset _reference_ slice of the seam. The registry interface that Phase 4 promotes to plugin-loaded contributions is established here.

| #     | Task                                                                                                                                            | Effort |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1.8.1 | Define `AssetRef` model in `@spur/contracts`: path, type, minimal manifest fields                                                               | S      |
| 1.8.2 | `spur asset inspect <path>` — show metadata for a referenced rd3/Spur asset                                                                     | S      |
| 1.8.3 | Link `AssetRef` to `Run` for audit trail (table established in 1.4.1)                                                                           | S      |
| 1.8.4 | Establish the internal asset-adapter registry interface in `@spur/assets` (Phase 1 has one built-in adapter; Phase 4 promotes to plugin-loaded) | S      |

### 1.9 Privacy & Redaction (ETL Pre-Processing)

> **References:** Architecture §9. **Decision:** D-012.
> Redaction is the pre-processing stage of an ETL pipeline. Phase 1 hardcodes this single stage at the persistence boundary; Phase 2 generalizes it to a multi-stage FSM-driven ETL workflow (see Phase 2 transition note below).

| #     | Task                                                                                                                                                                                                                                                            | Effort |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1.9.1 | Define the Phase 1 redaction rule pack in `@spur/contracts/redaction-rules` (single source of truth shared with Phase 2 ETL) covering at minimum: AWS keys, GitHub tokens, generic `sk-…` keys, bearer tokens, configured env-var values, configured path globs | M      |
| 1.9.2 | Stream `RunEvent` payloads line-by-line through the redaction pipeline before persistence; no plaintext touches the DB (architectural invariant — see D-012)                                                                                                    | S      |
| 1.9.3 | Replace matched substrings with `[REDACTED:type]` placeholders; store redaction metadata (rule id, count, byte-offset summary on the redacted payload) per event                                                                                                | S      |

### 1.10 Web Inspection — _deferred to Phase 2_

CLI inspect is the only inspection surface in Phase 1 (D-010). Web routes ship in Phase 2 §2.8.

### Phase 1 Exit Criteria

- `spur doctor --json` returns detected agents with readiness status, matching the airunner doctor contract (PRD §10).
- `spur workspace add` and `spur workspace list` create and report a workspace; `spur run` resolves a workspace from `cwd`.
- `spur run <task>` creates a persisted run with at least one phase through the basic FSM workflow.
- Killing and restarting preserves run state (append-only events make this trivial — D-013).
- `spur inspect <run-id>` shows events, artifacts, gate results, and constraint findings.
- `spur rule run --json` returns structured findings with rule id, severity, evidence, and remediation hint.
- One rd3 asset can be referenced by path and shown in `spur asset inspect`.
- Command/file/content/compound gates pass and fail deterministically in tests.
- The basic workflow can perform one bounded fix iteration after a failed check.
- Redaction rules from `@spur/contracts/redaction-rules` prevent common token/key patterns from being persisted.
- Phase 1 ships CLI-only (D-010); web inspection is a Phase 2 deliverable.

---

## Phase 2 — Analytics + Asset Registry + Web Inspection

**Goal:** Generalize the redaction stage into a real ETL pipeline. Import Spur-native events into projections. Add selected Magnifier-style import for external coding-agent histories. Build the asset registry. Add one scaffold path. Ship the read-only web inspection surface deferred from Phase 1.

> **References:** Architecture §9.3 (ETL Framing), §15 (registry seams). **Decisions in scope:** D-012 (ETL generalization), D-014 (registry continues internal).
> **Phase 1 → Phase 2 redaction transition:** the Phase 1 hardcoded pre-persistence redaction stage is **replaced** by Phase 2's FSM-driven ETL pipeline whose first state is "redact". The pre-persistence invariant (D-012) is preserved by making the FSM stage non-bypassable, not by retaining the Phase 1 codepath. Do not maintain both paths.

| #    | Task                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | Replace the Phase 1 hardcoded redaction stage with an FSM-defined pre-processing stage; same rule pack from `@spur/contracts/redaction-rules`     |
| 2.2  | Import Spur-native `RunEvent` records into minimal projections (duration, pass/fail, token estimates) — implemented as ETL post-processing stages |
| 2.3  | Selected Magnifier-style ETL for external coding-agent histories (Claude/Codex/Pi/OpenCode)                                                       |
| 2.4  | Model agent conversation ETL as an FSM workflow definition (ingest → pre-process → parse → project → store)                                       |
| 2.5  | Asset registry: catalog skills, commands, subagents, workflows, hooks (extends the registry seam from Phase 1.8.4)                                |
| 2.6  | Minimal Spur asset manifest validation                                                                                                            |
| 2.7  | One scaffold path: `spur asset scaffold skill` or `spur asset scaffold workflow`                                                                  |
| 2.8  | Read-only web inspection: run list + run detail (timeline, events, gates, findings) via existing Hono server and Astro web app                    |
| 2.9  | Tree-sitter-backed evaluators (deferred from Phase 1 per D-011) for finer-grained AST checks                                                      |
| 2.10 | Improve idea/concept → feature tree → concrete task conversion tooling                                                                            |
| 2.11 | Extract `airunner` into a typed library inside `@spur/kernel` (subprocess wrapper from Phase 1.3 retires per D-004)                               |

---

## Phase 3 — Orchestration + Cooperation

**Goal:** Expand FSM workflow definitions beyond the basic bounded loop. Add durable cooperation.

> **References:** Architecture §15 (cooperation transport seam).

| #   | Task                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 3.1 | Expand FSM workflow definitions: parallel phases, conditional branching, retry strategies (any new grammar construct requires a new decision per Architecture §16) |
| 3.2 | Durable inbox/outbox as a real cooperation substrate                                                                                                               |
| 3.3 | Support message types: `question`, `answer`, `handoff`, `status`, `blocker`, `artifact`                                                                            |
| 3.4 | Typed event bus integration for orchestration ↔ inbox ↔ notifications                                                                                              |
| 3.5 | Run detail cooperation view (web)                                                                                                                                  |
| 3.6 | Keep external A2A protocol compatibility as a later adapter/plugin concern                                                                                         |

---

## Phase 4 — Plugin Expansion + Skill Engineering

**Goal:** Promote the internal registry into a real plugin mechanism. Expand asset tooling.

> **References:** Architecture §15. **Decision:** D-014 (this is the phase that promotes internal → plugin-loaded; the seam contract stays stable).
> A new decision records the plugin-manifest contract when this phase starts.

| #   | Task                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 | External plugin loading with manifest validation, version compatibility, capability declaration                                         |
| 4.2 | Plugin disable/remove flows                                                                                                             |
| 4.3 | Asset commands: `scaffold`, `validate`, `test`, `package`, `adapt/export`, `inspect`                                                    |
| 4.4 | Extension points promoted to plugin-loaded: importers, projections, constraints, gates, runners, asset adapters, cooperation transports |
| 4.5 | Asset packager/exporter for Claude/Codex/Gemini/Pi targets                                                                              |

---

## Phase 5 — Team + Advanced Intelligence

**Goal:** Multi-machine aggregation, advisory engine, NL query, advanced dashboards.

| #   | Task                                                                    |
| --- | ----------------------------------------------------------------------- |
| 5.1 | Team/multi-computer aggregation                                         |
| 5.2 | Advisory engine for workflow and skill recommendations                  |
| 5.3 | Natural-language query over runs, events, findings                      |
| 5.4 | Advanced skill accuracy/token-efficiency tuning from aggregate run data |
| 5.5 | Rich web dashboards (beyond read-only inspection)                       |
| 5.6 | Optional remote cooperation transports                                  |

---

## Phase 6+ — Deferred Capabilities _(out of scope for Phases 0–5)_

> **Decision:** D-002 (BYOK and key storage deferred).

The following capabilities are deliberately deferred and tracked here only to document the boundary:

- BYOK / LLM provider key storage and management
- Sandboxed execution environments (containerised runners, ephemeral filesystems)
- Multi-tenant cloud deployment, team SaaS surface
- Desktop / mobile clients

---

## Effort Legend

| Label | Meaning                                           |
| ----- | ------------------------------------------------- |
| S     | Small — hours, single dev                         |
| M     | Medium — 1–3 days, single dev                     |
| L     | Large — 3–10 days, may benefit from parallel work |

Phases 2–5 tasks are coarse-grained and not effort-labeled — decompose at phase entry, not now.

---

## Architecture Pointer

Implementation topology, package layout, domain model, FSM grammar, rule schema, gate semantics, event taxonomy, redaction pipeline, extension seams, and implementation references all live in **[`docs/03_ARCHITECTURE.md`](./03_ARCHITECTURE.md)**. Decisions are canonical in **[`docs/06_DECISIONS.md`](./06_DECISIONS.md)**. The roadmap should not duplicate them — when in doubt about a boundary or invariant, those documents are canonical.

---

## Changelog

| Version | Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.8.0   | 2026-05-08 | Comprehensive sync with PRD v0.7.0 / Architecture v0.3.2 (option C). Fixed broken §-references. Added Workspace Registry as new Phase 1.5. Added §17/ADR pointers per Phase 1 sub-section. Renamed sub-sections (1.5→1.6 Gates, 1.6→1.7 Profile, 1.7→1.8 Assets+seam, 1.8→1.9 Redaction, 1.10 Web deferred). Tightened redaction tasks to point at `@spur/contracts/redaction-rules`. Added explicit Phase 1→Phase 2 redaction transition note. Added Phase 2 task to extract airunner as typed library. Replaced redundant Architecture Notes section with a pointer. Added Phase 0 verification reminder for 0.4–0.6. |
| 0.7.0   | 2026-05-08 | Aligned with PRD v0.7.0; gates as predicates; CLI-only Phase 1; web → Phase 2; tree-sitter → Phase 2; ETL framing for redaction; Phase 6+ deferred section.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 0.6.0   | earlier    | Initial roadmap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
