# 05 Features — Spur

**Version:** 0.1.0
**Status:** Draft
**Derived from:** `docs/01_PRD.md` v0.7.0, `docs/02_ROADMAP.md` v0.8.1, `docs/03_ARCHITECTURE.md` v0.3.3, `docs/04_DESIGN.md` v0.1.0
**Last Updated:** 2026-05-08
**Owner:** Robin Min

> This document is the **feature decomposition** for Phase 0 (foundation stabilisation), Common Foundations (cross-cutting shared layers), and Phase 1 (MVP harness loop). It is the seed for the `ftree` feature tree and the `tasks` WBS list.
>
> Sizing principle: each **leaf feature** is a single deliverable that can be expanded into one `tasks create` WBS item with a clear acceptance check. Non-leaf features group leaves under a meaningful boundary; they are not implementation units themselves.
>
> When this document conflicts with the Roadmap (`docs/02_ROADMAP.md`), the Roadmap wins; update this doc in the same commit.

---

## 1. How To Read This Document

### 1.1 Identifier scheme

Features carry a stable two-part identifier:

```text
F-<phase>.<group>.<leaf>     # leaf feature
F-<phase>.<group>            # group feature (parent)
F-<phase>                    # phase root
```

| Phase prefix | Meaning                                                    |
| ------------ | ---------------------------------------------------------- |
| `F-0`        | Phase 0 — Foundation Stabilisation                         |
| `F-C`        | Common Foundations — shared layers consumed by every phase |
| `F-1`        | Phase 1 — MVP Harness Loop                                 |

`F-C.*` is **not** a separate execution phase; it is the cross-cutting work that Phase 1 sub-sections depend on. Common Foundations features are scheduled inside Phase 1's critical path — they exist as a separate group in the tree only because every Phase 1 group consumes them.

### 1.2 Status legend

| Status          | Meaning                                                         |
| --------------- | --------------------------------------------------------------- |
| `done`          | Already shipped; included for tree completeness                 |
| `verify`        | Code exists; needs explicit verification before downstream work |
| `todo`          | Not started                                                     |
| `blocked:F-X.Y` | Blocked by another feature                                      |

The `ftree` `--status` field accepts these as free-form strings.

### 1.3 Sizing

| Size  | Rough effort | Mapping to `tasks`                                                                     |
| ----- | ------------ | -------------------------------------------------------------------------------------- |
| **S** | hours        | One WBS item, no decomposition                                                         |
| **M** | 1–3 days     | One WBS item, may decompose during planning                                            |
| **L** | 3–10 days    | Already split here into multiple leaves; if any L remains, split before `tasks create` |

The decomposition target: **no leaf is L**. Where the Roadmap shows an L task (`1.2.2`, `1.3.1`, `1.4.1`, `1.4.5`), this doc splits it into S/M leaves.

### 1.4 Per-leaf shape

Every leaf below carries:

- **Title** — short imperative.
- **Why** — one-line rationale or invariant it preserves.
- **Acceptance** — a single, observable signal that the leaf is done.
- **References** — pointers to PRD/Architecture/Design/Roadmap sections; decisions where applicable.
- **Size** — S or M.
- **Depends on** — sibling features that must precede it.

These are the fields `ftree add --metadata` will carry, and `tasks create` will inherit via `--feature-id`.

### 1.5 Seeding into `ftree`

The expected seeding flow (executed by the next command, not this document):

```text
ftree init
for each phase root:
  ftree add --title "<phase root>" --status todo
  for each group:
    ftree add --title "<group>" --parent <phase-root-id> --status todo
    for each leaf:
      ftree add --title "<leaf>" --parent <group-id> --status todo \
                --metadata '{"size": "S|M", "depends_on": [...], "refs": [...]}'
```

Then for each leaf the tooling can run `tasks create --feature-id <id>` to seed a WBS item.

### 1.6 Sourcing rules

Every leaf in this document traces to a roadmap task or an architecture/design invariant. The mapping is recorded in §5 so a reader can audit "is this here because the roadmap says so?" without re-reading the roadmap.

---

## 2. F-0 — Phase 0: Foundation Stabilisation

**Goal.** The Bun monorepo starter is a reliable development base. Phase 0 is a quality gate, not a feature phase.
**Roadmap reference.** `docs/02_ROADMAP.md` Phase 0.
**Exit criteria.** All of the four bullets in Roadmap Phase 0 "Acceptance criteria" pass on a cold checkout.

### F-0.1 — Closed Stabilisation Items _(reference only)_

These leaves are already done. They live in the tree so the dependency graph is complete, but they generate no new work.

| ID      | Title                                                                                 | Status | Roadmap |
| ------- | ------------------------------------------------------------------------------------- | ------ | ------- |
| F-0.1.1 | `dev:all` port cleanup — kill stale processes on 3000/4321 before spawning            | done   | 0.1     |
| F-0.1.2 | Eager lifecycle registration — SIGINT/SIGTERM handlers fire before first HTTP request | done   | 0.2     |
| F-0.1.3 | Pass `FileSystem` to DB middleware adapter creation (parent-directory safety)         | done   | 0.3     |
| F-0.1.4 | Remove stale `apps/server/data/` directory (DB lives at `<repo>/data/`)               | done   | 0.7     |

### F-0.2 — Verification Sweep _(must pass before Phase 1 starts)_

#### F-0.2.1 — HMR / hot-reload race-condition audit

- **Why.** Race conditions surfaced by 0.1–0.3 may still exist; the harness CLI cannot rely on a flaky dev loop.
- **Acceptance.** `bun run dev:all` runs continuously for 30 minutes with file edits applied every 2 minutes; no crash, no port reuse error, no orphaned processes after `Ctrl+C`.
- **References.** Roadmap 0.4.
- **Size.** M.
- **Depends on.** F-0.1.1, F-0.1.2.

#### F-0.2.2 — `bun run check` green-gate verification

- **Why.** Every Phase 1 commit must inherit a green baseline; `bun run check` is the single contract.
- **Acceptance.** `bun run check` exits 0 on a clean checkout with no `biome-ignore` additions, no test skips added.
- **References.** Roadmap 0.5; project AGENTS.md "Gate".
- **Size.** S.
- **Depends on.** F-0.2.1.

#### F-0.2.3 — Cold-checkout `dev:all` ergonomics

- **Why.** Spur's CLI assumes `data/` and `logs/` exist at repo root with correct ownership. A broken cold start breaks every downstream demo.
- **Acceptance.** From a `git clone` + `bun install`, `bun run dev:all` starts within 10 seconds; `/api/health`, `/api/events`, `/api/health/queue/jobs` return 200; `Ctrl+C` terminates both server and web within 2 seconds.
- **References.** Roadmap 0.6 + Phase 0 Acceptance criteria bullets 1–3.
- **Size.** M.
- **Depends on.** F-0.2.1, F-0.2.2.

---

## 3. F-C — Common Foundations _(shared layers consumed by every Phase 1 group)_

**Goal.** Establish the shared schemas, packages, and infrastructure that every Phase 1 group imports. Without these, the Phase 1 groups have nothing to import from.
**Architecture reference.** §2 Top-Level Topology, §4 Domain Model, §8 Event Taxonomy, §9 Redaction.
**Design reference.** §3 YAML Schemas, §4 Env Vars, §5 ER Diagram, §6 Common / Shared Library Design.

### F-C.1 — Package Scaffolding

#### F-C.1.1 — Scaffold `@spur/kernel` package

- **Why.** Phase 1 groups 1.1–1.6 land code here; the package must exist with strict TS, Biome config, `tests/` mirror, public `src/index.ts` before any group starts.
- **Acceptance.** `bun run check` is green with the empty package present; `import {} from '@spur/kernel'` resolves; `tests/index.test.ts` placeholder runs.
- **References.** Architecture §2.1, §2.2; D-008.
- **Size.** S.
- **Depends on.** F-0.2.3.

#### F-C.1.2 — Scaffold generic loader in `@spur/core/src/loader` (supersedes the prior `@spur/profiles` scaffold) — D-027

- **Why.** Per D-027, generic YAML/file/source-loading mechanics live in `@spur/core/loader`. Engine-specific authoring schemas, source layering, and normalization live in `@spur/kernel/src/rules/config` and `@spur/kernel/src/workflow/config`. Kernel evaluation/execution code never reads YAML directly (D-008, D-027).
- **Acceptance.** `@spur/core/loader` exports `readYamlFile`, `parseYamlString`, `validateWithZod`, source-layer primitives, and structured loader errors; no dependency on `@spur/kernel`. `@spur/kernel/src/{rules,workflow}/config` scaffolds compile and expose their own surface. The retired `packages/profiles` is absent from workspaces, `tsconfig` paths, deps, and imports.
- **References.** Architecture §2, §11; Design §3.1, §6.4; D-005, D-006, D-027.
- **Size.** M.
- **Depends on.** F-C.1.1.

#### F-C.1.3 — Scaffold `@spur/workspaces` package

- **Why.** Workspace registry is a Phase 1 prerequisite for `spur run` (Roadmap §1.5 note).
- **Acceptance.** Package present, exports a typed read-only API placeholder; `bun run check` green.
- **References.** Architecture §10; D-009.
- **Size.** S.
- **Depends on.** F-C.1.1.

#### F-C.1.4 — Scaffold `@spur/assets` package

- **Why.** Phase 1.8 Assets seam lives here; Phase 4 promotes the registry to plugin-loaded with the same contract.
- **Acceptance.** Package present; built-in adapter registry placeholder compiles.
- **References.** Architecture §15; D-014.
- **Size.** S.
- **Depends on.** F-C.1.1.

#### F-C.1.5 — Scaffold `@spur/tooling` package

- **Why.** Pure utility home; enforces the "no I/O, no global state" boundary from Design §6.5.
- **Acceptance.** Package present with at least one pure helper exported and tested; `tests/` runs without any setup file.
- **References.** Design §6.5.
- **Size.** S.
- **Depends on.** F-C.1.1.

### F-C.2 — Cross-Tier Contracts (`@spur/contracts`)

#### F-C.2.1 — Domain DTO Zod schemas (9 entities)

- **Why.** Every cross-tier shape (CLI ↔ kernel ↔ DB) flows through `@spur/contracts`; the kernel cannot land DAOs (F-1.4.1) without them.
- **Acceptance.** Zod schemas for `Workspace`, `Run`, `PhaseRun`, `RunEvent`, `GateResult`, `Artifact`, `ConstraintFinding`, `AssetRef`, `WorkflowState` published from `@spur/contracts/index.ts`; round-trip parse tests pass.
- **References.** Architecture §4; Design §5, §6.2.
- **Size.** M.
- **Depends on.** F-C.1.1.

#### F-C.2.2 — Event-taxonomy discriminated union

- **Why.** Architecture §8 requires a typed bus; the redacting observer (F-1.9.2) and the kernel emitters need one shape.
- **Acceptance.** Discriminated union of all event names from Architecture §8 exported with payload schemas; exhaustiveness check passes in tests.
- **References.** Architecture §8; Design §6.2.
- **Size.** M.
- **Depends on.** F-C.2.1.

#### F-C.2.3 — Profile-envelope Zod schema in `@spur/contracts`; rule/workflow authoring schemas in kernel config modules (D-027)

- **Why.** Per D-027, `@spur/contracts` owns the project-level `.spur/config.yaml` envelope (cross-tier surface). Rule, preset, and workflow authoring schemas (the per-engine YAML files) are co-located with their engines: `@spur/kernel/src/rules/config` owns `.spur/rules/*.yaml` and preset schemas; `@spur/kernel/src/workflow/config` owns `.spur/workflows/*.yaml` schemas for both `state-machine` and `transition-flow` dialects.
- **Acceptance.** Schemas published from their respective owners per Design §3.1–§3.3; valid examples parse, malformed examples fail with structured errors; cross-dialect fields rejected by the workflow loader; absent `kind:` defaults to `state-machine` for compatibility.
- **References.** Design §3.1–§3.3, §6.2; D-027.
- **Size.** M.
- **Depends on.** F-C.2.1.

#### F-C.2.4 — Redaction rule pack (`@spur/contracts/redaction-rules`)

- **Why.** Single source of truth shared by Phase 1 pre-persistence redaction and Phase 2 ETL (D-012).
- **Acceptance.** Built-in rule pack covering AWS keys, GitHub tokens, generic `sk-…` keys, bearer tokens, configured env-var values, configured path globs is exported; pack carries a stable id per rule; unit tests verify each rule's match and replacement.
- **References.** Architecture §9; Design §3.4; D-012; Roadmap 1.9.1.
- **Size.** M.
- **Depends on.** F-C.2.1.

#### F-C.2.5 — Typed error classes (split by owner per D-027)

- **Why.** Consumers `instanceof`-check, never string-match (Design §6.6). D-027 splits ownership by concern: cross-tier errors stay in `@spur/contracts`; loader-tier errors live in `@spur/core/loader`; engine-config errors live in their kernel config modules.
- **Acceptance.** `@spur/contracts` exports `RuleEvaluationError`, `GateEvaluationError`, `RedactionError`. `@spur/core/loader` exports `YamlParseError`, `SchemaValidationError`, `SourceResolveError` with file/path/source-layer context. `@spur/kernel/src/rules/config` and `@spur/kernel/src/workflow/config` export `RuleConfigError` and `WorkflowConfigError` (covering preset composition, extension reference resolution, dialect dispatch, semantic validation). All consuming packages thread the right error class.
- **References.** Design §6.6; D-027.
- **Size.** S.
- **Depends on.** F-C.2.1, F-C.1.2.

### F-C.3 — Tooling Primitives (`@spur/tooling`)

#### F-C.3.1 — Path & glob primitives

- **Why.** Closest-ancestor `.spur/` resolution (F-1.7.2) and rule target globs (F-1.1.3) both consume these.
- **Acceptance.** Pure functions for glob-to-regex, path normalisation, closest-ancestor search; unit-tested against string inputs only (no fs).
- **References.** Design §6.5.
- **Size.** S.
- **Depends on.** F-C.1.5.

#### F-C.3.2 — Redaction primitives

- **Why.** The pure regex-replace step the redacting observer (F-1.9.2) wraps with I/O.
- **Acceptance.** Pure function `redact(input, rulePack) → { output, metadata }`; no fs/process/DB; unit tests cover every built-in rule shape.
- **References.** Design §6.5; D-012.
- **Size.** S.
- **Depends on.** F-C.1.5, F-C.2.4.

### F-C.4 — Environment Variable Contract

#### F-C.4.1 — CLI env-var contract documented and enforced

- **Why.** Spur's secret-light invariant (Design §4.4) must be enforceable; an audit catches drift.
- **Acceptance.** A test enumerates every `process.env.*` read in `apps/cli` and `packages/{kernel,profiles,workspaces,assets,tooling}` and asserts it is one of the allowed CLI env vars from Design §4.1; new reads fail the test until Design §4 is updated.
- **References.** Design §4.1, §4.4; D-002.
- **Size.** S.
- **Depends on.** F-C.1.1.

---

## 4. F-1 — Phase 1: MVP Harness Loop

**Goal.** Prove one local-first harness loop: `doctor → run → capture events → check → inspect`.
**Roadmap reference.** `docs/02_ROADMAP.md` Phase 1.
**Architecture coverage.** §4–§12.
**Decisions in scope.** D-003, D-004, D-005, D-006, D-007, D-008, D-009, D-010, D-011, D-012, D-013, D-014.
**Exit criteria.** The 11 bullets in Roadmap "Phase 1 Exit Criteria".

> Sequencing within Phase 1: `F-C` (Common Foundations) and **F-1.7 Profile** unblock everything else. **F-1.4 Persistence** unblocks **F-1.2 FSM**, **F-1.3 AI Runner**, **F-1.5 Workspace**, **F-1.6 Gates**. **F-1.1 Rule Engine** is the only group that can land in parallel with F-1.4 once F-C is done.

### F-1.1 — Rule Engine

**Roadmap.** §1.1. **Architecture.** §6. **Decisions.** D-005, D-011.

#### F-1.1.1 — Rule loader in `@spur/kernel/src/rules/config` (D-027)

- **Why.** Per D-027, rule-engine authoring schemas, preset composition, source-layer merging, extension reference resolution, and rule normalization live with the rule engine. Generic YAML/file primitives come from `@spur/core/loader`. Kernel evaluation code (`rules/host`, `rules/evaluators`) consumes only the normalized output.
- **Acceptance.** `loadRules(profilePath) → NormalizedRuleSet` reads `.spur/rules/*.yaml` in lex order (using `@spur/core/loader`), validates each against the rule/preset schemas in `kernel/src/rules/config`, resolves extension references, surfaces structured errors via F-C.2.5; tests cover lex-order override, preset composition, extension resolution, malformed file, missing file.
- **References.** Architecture §6.1, §11; Design §3.2; D-005, D-027.
- **Size.** S.
- **Depends on.** F-C.2.3, F-C.2.5, F-C.3.1, F-C.1.2.

#### F-1.1.2 — Evaluator: `path`

- **Why.** Simplest evaluator; serves as the contract template for the other four.
- **Acceptance.** `path` evaluator implements `must: present|absent` against target globs; produces structured findings; tests cover present-but-forbidden, absent-but-required, allowlist override.
- **References.** Design §3.2.1.
- **Size.** S.
- **Depends on.** F-1.1.1.

#### F-1.1.3 — Evaluator: `regex` (powered by `rg`)

- **Why.** Most general evaluator; covers the bulk of project AGENTS rules (F-1.1.7).
- **Acceptance.** `regex` evaluator wraps `rg` via `core/process-executor`; `(?i)` and `multiline` honoured; findings include file, line, byte range, matched evidence; tests cover hit, no-hit, allowlist.
- **References.** Design §3.2.1; D-011.
- **Size.** M.
- **Depends on.** F-1.1.1.

#### F-1.1.4 — Evaluator: `import-boundary` (powered by `sg`)

- **Why.** Phase 1 enforces the Architecture §2.1 package dependency rules in code, not docs.
- **Acceptance.** `import-boundary` evaluator wraps `sg`; `from`/`forbid`/`allow` are package globs; finding cites the offending import statement; tests include the kernel-no-yaml example from Design §3.2.
- **References.** Architecture §2.1; Design §3.2.1; D-011.
- **Size.** M.
- **Depends on.** F-1.1.1.

#### F-1.1.5 — Evaluator: `tsdoc-export` (powered by `sg`)

- **Why.** Project rule "every export carries TSDoc" must be enforced by the engine, not by manual review.
- **Acceptance.** `tsdoc-export` evaluator detects exports of the configured `kinds` lacking a `/** … */`; tests cover function/class/type/const/enum.
- **References.** Design §3.2.1; project AGENTS.md TSDoc rule.
- **Size.** S.
- **Depends on.** F-1.1.1.

#### F-1.1.6 — Evaluator: `test-location`

- **Why.** Project rule "tests in `tests/` mirror, not `__tests__`" requires automated enforcement.
- **Acceptance.** `test-location` evaluator with `expected` + `forbid` globs; tests cover correct layout, forbidden layout, missing tests for an exported file.
- **References.** Design §3.2.1; project AGENTS.md test-location rule.
- **Size.** S.
- **Depends on.** F-1.1.1.

#### F-1.1.7 — Port existing AGENTS rules to YAML

- **Why.** Demonstrates that the engine subsumes today's scattered policy-check; without this, `spur rule run` has nothing to enforce.
- **Acceptance.** YAML rule files cover: `.env*` write protection, `.github/workflows/*` write protection, `Dockerfile*` write protection, `drizzle/` migration write protection, kernel-no-yaml import boundary, every-export-has-TSDoc, tests-in-tests-mirror; `spur rule run` (F-1.1.9) on the live repo passes; `scripts/policy-check.ts` is retired in the same commit.
- **References.** Architecture §17.6; Roadmap 1.1.4.
- **Size.** S.
- **Depends on.** F-1.1.2, F-1.1.3, F-1.1.4, F-1.1.5, F-1.1.6.

#### F-1.1.8 — `ConstraintFinding` persistence

- **Why.** Findings produced inside a workflow gate (F-1.6) link back to the Run for audit.
- **Acceptance.** `ConstraintFinding` rows inserted with `runId` (nullable for standalone `spur rule run`); tests cover linked-and-unlinked write paths.
- **References.** Architecture §4.2; Roadmap 1.1.5.
- **Size.** S.
- **Depends on.** F-1.4.1.

#### F-1.1.9 — CLI: `spur rule`

- **Why.** Enables pre-commit / CI usage; the renamed command per Architecture v0.3.3.
- **Acceptance.** `spur rule run` and `spur rule run --json` produce output matching Design §2.7; `--rule`, `--target`, `--severity`, `--fail-on` flags honoured; exit codes 0/1 deterministic.
- **References.** Design §2.7.
- **Size.** S.
- **Depends on.** F-1.1.7, F-1.1.8.

### F-1.2 — FSM Workflow Engine

**Roadmap.** §1.2. **Architecture.** §5. **Decisions.** D-006, D-007, D-015.

> Roadmap 1.2.2 was L; split into F-1.2.2 (definition validator) and F-1.2.3 (driver) here.

#### F-1.2.1 — Workflow definition loader in `@spur/kernel/src/workflow/config` (D-027)

- **Why.** Same boundary as rules under D-027: the kernel's workflow execution code consumes a `NormalizedWorkflow` and never reads YAML directly. The new workflow config module owns both dialects: `state-machine` (current behavior) and `transition-flow` (new, runtime driver lands in Task 0120).
- **Acceptance.** `loadWorkflows(profilePath) → NormalizedWorkflowSet` validates against the workflow authoring schemas in `kernel/src/workflow/config`; dispatches by `kind:` (missing → `state-machine`); produces `NormalizedStateMachineWorkflow` or `NormalizedTransitionFlowWorkflow` discriminated unions; structured errors for unknown state references, terminal-state-with-transitions, unconditional-non-last transitions, cross-dialect fields.
- **References.** Architecture §5.2, §11; Design §3.3; D-006, D-027.
- **Size.** M.
- **Depends on.** F-C.2.3, F-C.2.5, F-C.1.2.

#### F-1.2.2 — FSM definition validator

- **Why.** Catches malformed workflows before any action runs.
- **Acceptance.** Validator enforces all schema invariants from Design §3.3; structured findings cite state ids; tests cover every invariant violation.
- **References.** Design §3.3.
- **Size.** M.
- **Depends on.** F-1.2.1.

#### F-1.2.3 — FSM driver in `@spur/kernel`

- **Why.** The engine that turns a normalized definition into a Run.
- **Acceptance.** Driver enters initial state, executes ordered actions, evaluates ordered transitions, takes first passing transition, persists `WorkflowState` after each transition; tests cover terminal entry, gate-driven branching, guard rejection, action failure propagation.
- **References.** Architecture §5; Roadmap 1.2.2.
- **Size.** M.
- **Depends on.** F-1.2.2, F-1.4.1, F-1.6.1.

#### F-1.2.4 — Action: `agent.run`

- **Why.** The harness loop's primary verb; without it the workflow has nothing to do.
- **Acceptance.** Action invokes the bound coding agent via F-1.3.1; stdout/stderr captured as artifacts; prompt template interpolation tested.
- **References.** Design §3.3.1.
- **Size.** S.
- **Depends on.** F-1.2.3, F-1.3.1.

#### F-1.2.5 — Action: `shell`

- **Why.** Lets workflows run `bun run check` and similar without an agent in the loop.
- **Acceptance.** Action runs a command in the workdir via `core/process-executor`; stdout/stderr captured as artifacts; non-zero exit propagated as action failure.
- **References.** Design §3.3.1.
- **Size.** S.
- **Depends on.** F-1.2.3.

#### F-1.2.6 — Action: `check`

- **Why.** Inline rule-engine invocation lets a workflow phase own its constraint checks.
- **Acceptance.** Action runs the rule engine, persists findings linked to the current Run (F-1.1.8), respects `failOn`; tests cover pass and fail paths.
- **References.** Design §3.3.1.
- **Size.** S.
- **Depends on.** F-1.2.3, F-1.1.8.

#### F-1.2.7 — Action: `note`

- **Why.** Smallest possible action; useful for fixture workflows and documentation examples.
- **Acceptance.** Action emits a `note` event with the configured message; visible in `spur inspect`.
- **References.** Design §3.3.1.
- **Size.** S.
- **Depends on.** F-1.2.3.

#### F-1.2.8 — Iteration & time guards

- **Why.** Bounded loops are the whole point of D-007; without guards, `fix-until-pass` is unbounded.
- **Acceptance.** `iteration` and `time` guards evaluated in declaration order; transitions whose guard fails are skipped; tests verify the canonical 2-iteration fix loop.
- **References.** Architecture §5.4; Design §3.3.3.
- **Size.** S.
- **Depends on.** F-1.2.3.

#### F-1.2.9 — Canonical `basic` workflow + tests

- **Why.** The Phase 1 acceptance demo workflow.
- **Acceptance.** `basic.yaml` from Design §3.3 ships under a fixture directory; integration test drives it through pass-on-first-check, pass-after-one-fix, fail-after-iteration-cap.
- **References.** Design §3.3 example; Roadmap 1.2.3.
- **Size.** M.
- **Depends on.** F-1.2.3, F-1.2.4, F-1.2.5, F-1.2.6, F-1.2.8, F-1.6.1.

### F-1.3 — AI Runner / Executor

**Roadmap.** §1.3. **Architecture.** §7. **Decisions.** D-003, D-004.

> Roadmap 1.3.1 was L; split into F-1.3.1 (subprocess wrap), F-1.3.2 (agent detection), F-1.3.3 (channel resolution) here.

#### F-1.3.1 — `airunner` subprocess wrapper in `@spur/kernel`

- **Why.** Phase 1 wraps the existing `airunner` script (D-004); typed extraction is Phase 2.
- **Acceptance.** Wrapper exposes `run(agent, channel, workdir, prompt) → { exitCode, artifactRefs }`; uses `core/process-executor`; stdout/stderr persisted as artifacts; tests use a stub binary.
- **References.** Architecture §7.1; Roadmap 1.3.1; D-004.
- **Size.** M.
- **Depends on.** F-C.1.1, F-1.4.3.

#### F-1.3.2 — Agent installation & version detection

- **Why.** `spur doctor` needs this; Roadmap 1.3.1 bundled it with the wrap.
- **Acceptance.** `detectAgents() → DetectedAgent[]` returns each known agent's installed/version status by invoking the agent's own `--version`; works offline; tests use stub binaries.
- **References.** Architecture §7.1.
- **Size.** S.
- **Depends on.** F-1.3.1.

#### F-1.3.3 — Agent resolution & default selection

- **Why.** Implements the precedence chain in Architecture §7.3.
- **Acceptance.** `resolveAgent(invocationFlag, workspace, profile)` returns the chosen agent following the documented precedence; tests cover every precedence step including the Pi default fallback.
- **References.** Architecture §7.3; D-003.
- **Size.** S.
- **Depends on.** F-1.3.2, F-1.7.2, F-1.5.1.

#### F-1.3.4 — _(removed)_ CLI: `spur agents`

> **Removed 2026-05-11.** Functionality is fully subsumed by `spur doctor`. See D-022 in [`docs/06_DECISIONS.md`](./06_DECISIONS.md) (2026-05-11).

#### F-1.3.5 — CLI: `spur doctor`

- **Why.** PRD §10/B3 contract — the operator's first sanity check.
- **Acceptance.** `spur doctor` and `spur doctor --json` produce output matching Design §2.3 and the PRD §10/B3 table contract; `-a, --agent` narrows; exit 0 only if every probed agent is `usable`.
- **References.** Design §2.3; PRD §10/B3; Roadmap 1.3.4.
- **Size.** M.
- **Depends on.** F-1.3.2.

### F-1.4 — Domain Model & Persistence

**Roadmap.** §1.4. **Architecture.** §4, §8. **Decisions.** D-009, D-013.

> Roadmap 1.4.1 was L; split per-entity into S/M leaves below. Roadmap 1.4.5 was L; split into F-1.4.7 (run create), F-1.4.8 (FSM drive), F-1.4.9 (CLI surface).

#### F-1.4.1 — Drizzle migration: workspace + run + phase_run + workflow_state

- **Why.** Foundational tables every other table FKs to.
- **Acceptance.** Drizzle schema for these four tables generated and migrated; bun-sqlite + D1 both targeted; round-trip insert/select tests via DAOs in `core/db`.
- **References.** Architecture §4; Design §5.
- **Size.** M.
- **Depends on.** F-C.2.1.

#### F-1.4.2 — Drizzle migration: run_event + gate_result + artifact + asset_ref + constraint_finding

- **Why.** Append-only event store and audit-trail tables.
- **Acceptance.** Drizzle schema for these five tables generated and migrated; FK invariants verified; D-013 append-only invariant captured by absence of `updatedAt` and presence of a write-only DAO method.
- **References.** Architecture §4; Design §5; D-013.
- **Size.** M.
- **Depends on.** F-1.4.1.

#### F-1.4.3 — `Artifact` reference DAO

- **Why.** Both AI Runner (F-1.3.1) and shell action (F-1.2.5) capture artifacts; persistence must precede them.
- **Acceptance.** DAO writes file/log/patch/report artifacts with `phaseRunId` link; reader returns artifacts by run; tests cover all four kinds.
- **References.** Architecture §4.2; Roadmap 1.4.3.
- **Size.** S.
- **Depends on.** F-1.4.2.

#### F-1.4.4 — `RunEvent` append-only write path

- **Why.** D-013 invariant; nothing else ships until this is in place.
- **Acceptance.** DAO supports append only — no update method exists; redaction (F-1.9.2) is a non-bypassable upstream of the write; tests verify that bypassing redaction is impossible by construction.
- **References.** Architecture §4.3; D-012, D-013.
- **Size.** M.
- **Depends on.** F-1.4.2, F-1.9.2.

#### F-1.4.5 — Redacting event-bus observer

- **Why.** Wires Architecture §8 emissions into `RunEvent` persistence (F-1.4.4) through redaction.
- **Acceptance.** Observer subscribes to the event taxonomy from F-C.2.2; every event passes through redaction (F-1.9.2) before persistence; integration test verifies plaintext never appears in DB rows.
- **References.** Architecture §8, §9.1; Roadmap 1.4.4; D-012.
- **Size.** M.
- **Depends on.** F-1.4.4, F-C.2.2.

#### F-1.4.6 — Run lifecycle DAO

- **Why.** `Run.status` is the single source of run lifecycle (D-009).
- **Acceptance.** DAO supports `createRun`, `setRunStatus(running|done|failed)`, `getRun(id)`, `listRecentRuns(workspaceId)`; status transitions logged as `run.*` events not column updates; tests verify each transition.
- **References.** Architecture §4, §10; Design §5.
- **Size.** S.
- **Depends on.** F-1.4.5.

#### F-1.4.7 — `spur run` workspace + workflow resolution

- **Why.** First half of Roadmap 1.4.5 — getting from `cwd` to a ready-to-drive Run.
- **Acceptance.** `spur run <task>` resolves the closest-ancestor workspace, picks workflow + agent following the precedence chain, validates all inputs, and creates a `Run` row before driving any FSM step; tests cover missing workspace, missing workflow, ambiguous workspace.
- **References.** Architecture §10; Design §2.4; Roadmap 1.4.5.
- **Size.** M.
- **Depends on.** F-1.4.6, F-1.5.4, F-1.7.2.

#### F-1.4.8 — `spur run` FSM drive integration

- **Why.** Second half of Roadmap 1.4.5 — the actual harness loop.
- **Acceptance.** Resolved Run is handed to the FSM driver (F-1.2.3); each phase emits events through the redacting observer; `--dry-run` validates without executing; tests cover golden path and failure terminal.
- **References.** Architecture §3.1; Design §2.4.
- **Size.** M.
- **Depends on.** F-1.4.7, F-1.2.3, F-1.4.5.

#### F-1.4.9 — CLI: `spur status`

- **Why.** The cheapest operator question: "is anything running?".
- **Acceptance.** `spur status` and `spur status <run-id>` produce output matching Design §2.5; `--json` shape stable.
- **References.** Design §2.5; Roadmap 1.4.6.
- **Size.** S.
- **Depends on.** F-1.4.6.

#### F-1.4.10 — CLI: `spur inspect`

- **Why.** Phase 1's only inspection surface (D-010); blocks the Phase 1 exit criterion "shows events, artifacts, gate results, and constraint findings".
- **Acceptance.** `spur inspect <run-id>` and its `--events`/`--gates`/`--artifacts`/`--findings`/`--since`/`--limit` flags produce output matching Design §2.6; `--json` shape stable; large runs paginate.
- **References.** Design §2.6; D-010.
- **Size.** M.
- **Depends on.** F-1.4.6, F-1.4.5, F-1.6.2, F-1.1.8.

### F-1.5 — Workspace Registry

**Roadmap.** §1.5. **Architecture.** §10. **Decision.** D-009.

#### F-1.5.1 — Workspace registry table + DAO

- **Why.** The static binding record; lifecycle stays on `Run`.
- **Acceptance.** DAO supports `addWorkspace`, `listWorkspaces`, `getWorkspaceByCwd(path)`, `removeWorkspace`; no mutable lifecycle field exists on the row; tests verify uniqueness and absence of lifecycle columns.
- **References.** Architecture §10; D-009; Roadmap 1.5.1.
- **Size.** M.
- **Depends on.** F-1.4.1.

#### F-1.5.2 — Read-time git context

- **Why.** Registry must never carry stale branch/dirty/ahead/behind data.
- **Acceptance.** `gitContext(workdir)` invokes `git` only when called; gracefully handles non-repo workdirs; tests use stub repo + non-repo fixtures.
- **References.** Architecture §10.
- **Size.** S.
- **Depends on.** F-1.5.1.

#### F-1.5.3 — CLI: `spur workspace add`

- **Why.** Without an `add` command, every other workspace flow is hypothetical.
- **Acceptance.** `spur workspace add` accepts the flags from Design §2.9; warns (does not error) on non-Git workdir; errors on duplicate `--name`; `--json` shape stable.
- **References.** Design §2.9; Roadmap 1.5.2.
- **Size.** S.
- **Depends on.** F-1.5.1.

#### F-1.5.4 — CLI: `spur workspace list` + cwd resolution

- **Why.** Both the operator-facing list and the internal "what workspace owns this cwd?" lookup share git-context plumbing.
- **Acceptance.** `spur workspace list` produces output matching Design §2.10 with read-time git context; `getWorkspaceByCwd` returns the closest-ancestor match; tests cover nested workspaces.
- **References.** Design §2.10; Roadmap 1.5.3, 1.5.4.
- **Size.** S.
- **Depends on.** F-1.5.2, F-1.5.3.

### F-1.6 — Verification Gates

**Roadmap.** §1.6. **Architecture.** §5.3, §5.4. **Decision.** D-007.

#### F-1.6.1 — Gate evaluators (`command`, `file-exists`, `content-match`, `compound`)

- **Why.** The four gate kinds enumerated in Design §3.3.2; the FSM driver consumes a uniform predicate interface.
- **Acceptance.** Each kind implements `evaluate(context) → { passed, evidence }`; `compound` honours `all`/`any`; tests cover pass, fail, error-during-evaluation for each kind.
- **References.** Architecture §5.3; Design §3.3.2; Roadmap 1.6.1.
- **Size.** M.
- **Depends on.** F-1.4.2, F-C.2.1.

#### F-1.6.2 — `GateResult` persistence

- **Why.** Audit trail: a failed gate is recorded even when the engine then takes a fallback transition.
- **Acceptance.** Every gate evaluation writes a `GateResult` linked to the `PhaseRun` and the candidate transition; tests cover passed-and-taken, failed-and-fallback.
- **References.** Architecture §5.3; Roadmap 1.6.2.
- **Size.** S.
- **Depends on.** F-1.6.1, F-1.4.2.

#### F-1.6.3 — Fallback transition wiring

- **Why.** The "fix-until-pass" half of the harness loop only works when gate failure cleanly hands control to the next transition.
- **Acceptance.** Gate failure on a transition causes the FSM driver to consider the next transition in declaration order; iteration guards bound the loop; integration test in F-1.2.9 covers this.
- **References.** Architecture §5.3, §5.4; Roadmap 1.6.3.
- **Size.** S.
- **Depends on.** F-1.6.1, F-1.2.8.

### F-1.7 — Profile

**Roadmap.** §1.7. **Architecture.** §11. **Decision.** D-005.

#### F-1.7.1 — `.spur/config.yaml` schema

- **Why.** Schema lives in `@spur/contracts` (already covered by F-C.2.3); this leaf records the dependency.
- **Acceptance.** F-C.2.3 ships the profile schema with full Design §3.1 coverage; consumed by F-1.7.2.
- **References.** Design §3.1.
- **Size.** _(merged into F-C.2.3 — no separate work)_
- **Depends on.** F-C.2.3.

> _F-1.7.1 is a pointer, not a leaf. Roadmap 1.7.1 is satisfied by F-C.2.3._

#### F-1.7.2 — Profile loader composed from `@spur/core/loader` + kernel config modules (D-027)

- **Why.** Per D-027, profile loading is no longer one package. The CLI resolves the closest-ancestor `.spur/config.yaml` using `@spur/core/loader`, validates it against the project-envelope schema in `@spur/contracts`, expands `${ENV_VAR}` interpolation per Design §4.3, then delegates rule/workflow loading to the kernel config modules.
- **Acceptance.** `loadProfile(workdir)` resolves closest-ancestor `.spur/`, validates the envelope, expands env interpolation, and returns a composite normalized profile assembled from `loadRules` (F-1.1.1) and `loadWorkflows` (F-1.2.1); structured errors are surfaced via F-C.2.5; tests cover missing, malformed, env-var-missing, valid, and the dialect-aware workflow path (state-machine present, transition-flow present, mixed).
- **References.** Architecture §11; Design §3.1, §4.3; Roadmap 1.7.2; D-027.
- **Size.** M.
- **Depends on.** F-C.2.3, F-C.2.5, F-C.3.1, F-C.1.2, F-1.1.1, F-1.2.1.

#### F-1.7.3 — CLI: `spur init`

- **Why.** First user touchpoint; without it, every other command requires hand-edited YAML.
- **Acceptance.** `spur init` writes the scaffold described in Design §2.2 (`.spur/config.yaml`, `.spur/rules/`, `.spur/workflows/`, empty SQLite at configured `data/` path); `--force`, `--minimal` honoured; idempotent without `--force`.
- **References.** Design §2.2; Roadmap 1.7.3.
- **Size.** S.
- **Depends on.** F-1.7.2.

### F-1.8 — Assets — Minimal Reference + Inspect

**Roadmap.** §1.8. **Architecture.** §15. **Decision.** D-014.

#### F-1.8.1 — `AssetRef` model + DAO

- **Why.** Same shape Phase 4 promotes to plugin-loaded; locking the contract here prevents Phase 4 churn.
- **Acceptance.** `AssetRef` schema in `@spur/contracts` (covered by F-C.2.1); DAO supports insert + lookup-by-runId + lookup-by-path; tests verify both lookup paths.
- **References.** Architecture §15; Design §6.2; Roadmap 1.8.1, 1.8.3.
- **Size.** S.
- **Depends on.** F-C.2.1, F-1.4.2.

#### F-1.8.2 — Asset adapter registry interface in `@spur/assets`

- **Why.** D-014: same registry contract that Phase 4 promotes to plugin-loaded.
- **Acceptance.** `registerAdapter(name, adapter)` + `lookupAdapter(name)` exist in `@spur/assets`; one built-in adapter for "rd3 skill" is registered and inspectable; tests verify the contract is symmetric to a future plugin-loaded registry.
- **References.** Architecture §15; D-014; Roadmap 1.8.4.
- **Size.** S.
- **Depends on.** F-C.1.4.

#### F-1.8.3 — CLI: `spur asset inspect`

- **Why.** The Phase 1 asset-side acceptance criterion.
- **Acceptance.** `spur asset inspect <path>` shows manifest, type, references; `--json` shape matches Design §2.8; one rd3 asset can be referenced by path and shown.
- **References.** Design §2.8; Roadmap 1.8.2.
- **Size.** S.
- **Depends on.** F-1.8.1, F-1.8.2.

### F-1.9 — Privacy & Redaction (ETL Pre-Processing)

**Roadmap.** §1.9. **Architecture.** §9. **Decision.** D-012.

#### F-1.9.1 — Redaction rule pack in `@spur/contracts/redaction-rules`

- **Why.** Single source of truth shared with Phase 2 ETL.
- **Acceptance.** Covered by F-C.2.4.
- **References.** Roadmap 1.9.1.
- **Size.** _(merged into F-C.2.4 — no separate work)_
- **Depends on.** F-C.2.4.

> _F-1.9.1 is a pointer, not a leaf. Roadmap 1.9.1 is satisfied by F-C.2.4._

#### F-1.9.2 — Streaming redaction pipeline

- **Why.** Architecture invariant: no plaintext touches the DB.
- **Acceptance.** Redaction runs line-by-line on every event payload before the DAO write; pipeline composed from F-C.3.2 primitive + F-C.2.4 rule pack; integration test verifies that injecting a known-secret payload results in a redacted DB row with metadata.
- **References.** Architecture §9; D-012; Roadmap 1.9.2.
- **Size.** S.
- **Depends on.** F-C.3.2, F-C.2.4.

#### F-1.9.3 — Redaction metadata persistence

- **Why.** Audit trail: which rules matched and how many times, without leaking plaintext.
- **Acceptance.** Each `RunEvent` row carries `redaction.metadata` per Design §5; metadata schema covered by F-C.2.1; tests verify metadata accuracy on multi-rule matches.
- **References.** Architecture §9; Design §5; Roadmap 1.9.3.
- **Size.** S.
- **Depends on.** F-1.9.2, F-C.2.1.

### F-1.10 — Web Inspection — _deferred to Phase 2_

> Documented for completeness. **No Phase 1 work.** Per D-010, the Phase 1 inspection surface is CLI-only; web routes ship in Phase 2 §2.8.

---

## 5. Source Trace

Every leaf in §3–§4 maps to a line in the Roadmap, the Architecture, or the Design doc. This table answers "why is this feature here?".

| Leaf             | Source                                  |
| ---------------- | --------------------------------------- |
| F-0.1.\*         | Roadmap Phase 0 done items              |
| F-0.2.1          | Roadmap 0.4                             |
| F-0.2.2          | Roadmap 0.5                             |
| F-0.2.3          | Roadmap 0.6 + Acceptance criteria       |
| F-C.1.\*         | Architecture §2.1, §2.2; D-008          |
| F-C.2.1          | Architecture §4; Design §5, §6.2        |
| F-C.2.2          | Architecture §8; Design §6.2            |
| F-C.2.3          | Design §3.1–§3.3                        |
| F-C.2.4          | Roadmap 1.9.1; Design §3.4; D-012       |
| F-C.2.5          | Design §6.6                             |
| F-C.3.1          | Design §6.5                             |
| F-C.3.2          | Design §6.5; D-012                      |
| F-C.4.1          | Design §4                               |
| F-1.1.1          | Roadmap 1.1.2                           |
| F-1.1.2–F-1.1.6  | Roadmap 1.1.3 (split per evaluator)     |
| F-1.1.7          | Roadmap 1.1.4                           |
| F-1.1.8          | Roadmap 1.1.5                           |
| F-1.1.9          | Roadmap 1.1.6                           |
| F-1.2.1          | Roadmap 1.2.1 (loader half)             |
| F-1.2.2          | Roadmap 1.2.1 (validator half)          |
| F-1.2.3          | Roadmap 1.2.2 (driver)                  |
| F-1.2.4–F-1.2.7  | Design §3.3.1 actions                   |
| F-1.2.8          | Architecture §5.4; Design §3.3.3        |
| F-1.2.9          | Roadmap 1.2.3                           |
| F-1.3.1          | Roadmap 1.3.1 (subprocess wrap)         |
| F-1.3.2          | Roadmap 1.3.1 (detection)               |
| F-1.3.3          | Architecture §7.3                       |
| F-1.3.4          | Roadmap 1.3.3                           |
| F-1.3.5          | Roadmap 1.3.4                           |
| F-1.4.1, F-1.4.2 | Roadmap 1.4.1 (split by FK layer)       |
| F-1.4.3          | Roadmap 1.4.3                           |
| F-1.4.4          | Roadmap 1.4.2                           |
| F-1.4.5          | Roadmap 1.4.4                           |
| F-1.4.6          | Architecture §10; D-009                 |
| F-1.4.7, F-1.4.8 | Roadmap 1.4.5 (split by responsibility) |
| F-1.4.9          | Roadmap 1.4.6                           |
| F-1.4.10         | Roadmap 1.4.7                           |
| F-1.5.\*         | Roadmap 1.5.\*                          |
| F-1.6.\*         | Roadmap 1.6.\*                          |
| F-1.7.1          | Roadmap 1.7.1 (pointer to F-C.2.3)      |
| F-1.7.2          | Roadmap 1.7.2                           |
| F-1.7.3          | Roadmap 1.7.3                           |
| F-1.8.1          | Roadmap 1.8.1, 1.8.3                    |
| F-1.8.2          | Roadmap 1.8.4                           |
| F-1.8.3          | Roadmap 1.8.2                           |
| F-1.9.1          | Roadmap 1.9.1 (pointer to F-C.2.4)      |
| F-1.9.2          | Roadmap 1.9.2                           |
| F-1.9.3          | Roadmap 1.9.3                           |

---

## 6. Critical Path

The shortest sequence of leaves to reach the Phase 1 exit criteria (every other leaf is parallelizable around this path):

```text
F-0.2.1 → F-0.2.2 → F-0.2.3
  → F-C.1.1 → F-C.2.1 → F-C.2.4 → F-C.3.2
  → F-1.4.1 → F-1.4.2 → F-1.9.2 → F-1.4.4 → F-1.4.5 → F-1.4.6
  → F-C.2.3 → F-1.7.2 → F-1.7.3
  → F-1.5.1 → F-1.5.4
  → F-1.6.1 → F-1.6.2
  → F-1.2.1 → F-1.2.2 → F-1.2.3 → F-1.2.4 → F-1.2.5 → F-1.2.6 → F-1.2.8 → F-1.2.9
  → F-1.3.1 → F-1.3.2 → F-1.3.3 → F-1.3.5
  → F-1.4.7 → F-1.4.8 → F-1.4.10
  → exit
```

Parallelizable around the path:

- **Rule engine** (F-1.1.\*) lands any time after F-1.4.2 + F-C.2.3.
- **Asset slice** (F-1.8.\*) lands any time after F-1.4.2 + F-C.1.4.
- **Workspace CLI** (F-1.5.3) lands any time after F-1.5.1.
- **`spur status`** (F-1.4.9) lands any time after F-1.4.6.
- **CLI surfaces** (`spur agents`, `spur rule`) land any time after their core leaves.

---

## 7. Open Questions

These do not block seeding the feature tree. They are recorded so they surface during `tasks create` planning rather than mid-implementation.

1. **Workflow registry persistence.** Workflow definitions are file-backed (Architecture §4.1). Phase 1 has no DB row for workflow definitions — should it? Affects F-1.2.1, F-1.4.10 (inspect surfacing).
2. **Asset adapter discovery.** F-1.8.2 ships one built-in adapter. Where does the rd3 asset corpus live during Phase 1 — in-repo fixture or `~/projects/cc-agents` reference? Affects F-1.8.3 acceptance test fixtures.
3. **Telemetry default.** Design §3.1 has telemetry default-off (local-only). Roadmap is silent. Confirm before F-1.7.3 lands.

---

## 8. Changelog

| Version | Date       | Change                                                                                                                                                                                                                                                                                                                                                                                              |
| ------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.2.0   | 2026-05-17 | D-027 alignment (Task 0116): F-C.1.2 retargeted from `@spur/profiles` scaffold to `@spur/core/src/loader` + kernel config modules; F-C.2.3 ownership split between contracts (envelope) and kernel config (engine authoring schemas, both dialects); F-C.2.5 typed-error ownership split by tier; F-1.1.1, F-1.2.1, F-1.7.2 retargeted to kernel config modules. References to `@spur/profiles` retired throughout. |
| 0.1.0   | 2026-05-08 | Initial feature decomposition for Phase 0, Common Foundations, and Phase 1. Counts: F-0 = 4 closed (reference) + 3 active verification leaves; F-C = 13 leaves across 4 groups (packages, contracts, tooling, env-contract); F-1 = 47 worked leaves + 2 pointer-only leaves (F-1.7.1 → F-C.2.3, F-1.9.1 → F-C.2.4) across 9 groups (1.10 deferred). Critical path and source-trace tables included. |
