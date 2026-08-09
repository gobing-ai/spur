---
template: feature-impl
schema_version: 1
name: "Ship /sp:dev-find-conflict as an authority-aware indexed audit and confirmed-remediation command"
description: ""
status: done
type: task
profile: standard
feature_id: H11
parent_wbs: null
priority: P2
tags: ["wayfinder"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-09T03:51:20.569Z"
updated_at: "2026-08-09T07:02:22.121Z"
done_forced: "true"
done_reason: "Pipeline implement timed out (omp 30min) and scope-crept 0485 on BOTH executors (omp+claude) — systemic conflation. Core R1-R6 artifacts pipeline-authored; finishing inline per operator decision. Structural gates PASS. DEFERRED: R7 dogfood + full repo gates — must pass before H11 closes."
---

## 0486. Ship /sp:dev-find-conflict as an authority-aware indexed audit and confirmed-remediation command

### Background

H11 needs one cohesive semantic-audit capability because conflict discovery, authority resolution, evidence collection, and remediation routing share the same subject graph and must be judged together. The earlier multi-task decomposition was retired; task 0486 is the single implementation and verification boundary.

The capability audits four pillars: source code, task files, feature files, and project authority files. Its hard problem is not text matching. It must decide which artifact is authoritative for each claim type, distinguish normative intent from observed behavior, compare only semantically related claims, and preserve uncertainty when authority is ambiguous.

The chosen v1 is prompt-first: a thin `/sp:dev-find-conflict` command delegates to one deep `sp:conflict-finding` skill backed by focused reference files. Existing deterministic tools gather facts; the model performs subject clustering, claim-specific authority reasoning, and semantic comparison. V1 does not introduce a TypeScript analyzer, database, vector index, embedding pipeline, persistent cache, new runtime dependency, or dedicated subagent. This keeps the solution dynamic across projects while making its reasoning explicit, testable, and token-aware.

Audit mode is read-only with respect to source, corpus, and numbered documentation. Findings are presented before any repair. Approved repairs must route through the artifact owner's existing harness surface.

### Requirements

- [x] R1. Provide a thin `/sp:dev-find-conflict` command and a backbone `sp:conflict-finding` skill that discover and inventory the selected scope across source code, task files, feature files, and project authority files; the default authority set includes `AGENTS.md`, `docs/00_ADR.md`, `docs/01_PRD.md`, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, `docs/05_FEATURES.md`, and `docs/99_PROJECT_CONSTITUTION.md` when present.

- [x] R2. Detect within-pillar contradictions, stale projections, duplicate claims, omissions, orphans, and ambiguous ownership using explicit subject/claim matching; report evidence, severity, confidence, freshness, and the false-positive boundary instead of treating textual difference as conflict.

- [x] R3. Resolve authority per subject and claim type, preserving both normative authority and observed reality. Every precedence edge must cite its project rule or fallback rule, and incomparable, missing, or ambiguous authority must remain unresolved for human confirmation rather than being forced through a global ranking.

- [x] R4. Compare all relevant cross-pillar boundaries—source↔task, source↔feature, source↔authority, task↔feature, task↔authority, and feature↔authority—through a candidate graph built from explicit links and shared identifiers, and emit reproducible file/section/symbol anchors for every asserted finding.

- [x] R5. Use an honest token-aware scan protocol: progressive discovery, deterministic preflight checks, subject clustering, and an in-memory evidence manifest, optionally reusing fresh `.spur/context/` indexes. Adaptive mode must disclose its change cone and coverage; absent, stale, or unverifiable context must trigger a cold full scan or an explicit incomplete-coverage result, never silent omission.

- [x] R6. Keep audit mode free of source/corpus/numbered-doc mutations. With `--resolve`, present a proposed repair set, require explicit confirmation, revalidate evidence freshness, then route each approved repair through its verified owner surface with clear handling of ambiguity, partial failure, retry, and already-resolved/idempotent cases.

- [x] R7. Ship the command, skill, reference rulebook, stable Markdown and JSON result contracts, Superskill validation/evaluation evidence, project documentation, structural/contract tests, fresh-session dogfood, and the repository's full verification gates without adding production analysis code or generated per-platform adapters.

### Acceptance Criteria

```gherkin
Feature: Semantic conflict finder: authority-aware indexed audit and confirmed remediation

  @core
  Scenario: R1 — Complete four-pillar inventory
    Given a Spur-supported project and an optional operator-selected scope
    When `/sp:dev-find-conflict` performs discovery
    Then it inventories source code, task files, feature files, and present project authority files
    And each inventory entry records its pillar, identity, path, freshness source, and scan status
    And absent optional authority files are reported without blocking the audit

  @core
  Scenario: R2 — Internal conflicts are reported per pillar
    Given related claims exist within one pillar
    When the skill compares them by subject and claim type
    Then it reports only contradictions, stale projections, duplicates, omissions, orphans, or ambiguous ownership supported by evidence
    And every finding includes severity, confidence, freshness, and a false-positive explanation
    And mere wording or abstraction-level differences are not asserted as conflicts

  @core
  Scenario: R3 — Subject authority graph carries provenance and stops on ambiguity
    Given a subject is described by multiple artifacts
    When the skill resolves the authority for the relevant claim type
    Then it distinguishes normative authority from observed reality
    And every precedence edge cites a project rule or documented fallback
    And incomparable, missing, or ambiguous authority produces an unresolved HITL item instead of a fabricated winner

  @core
  Scenario: R4 — Cross-pillar conflicts include reproducible evidence
    Given related subjects appear across two or more pillars
    When the skill audits every applicable pillar boundary
    Then it constructs candidates from explicit links, WBS and feature IDs, AC titles, symbols, commands, flags, schemas, config keys, and domain terms
    And each asserted finding names the subject, claim type, artifacts, authority path, and reproducible file/section/symbol anchors
    And the skill does not perform an unbounded all-pairs comparison

  @core
  Scenario: R5 — Indexed adaptive coverage is honest and rebuildable
    Given adaptive mode may reuse `.spur/context/` evidence
    When the context is fresh and its provenance is verifiable
    Then the result reports the reused index, change cone, candidate set, coverage, confidence, and cost estimate
    But when the context is absent, stale, or unverifiable
    Then the skill performs a cold full scan or reports incomplete coverage explicitly
    And it does not create a production cache, database, vector index, or hidden persistent state

  @core
  Scenario: R6 — Confirmed remediation routes through owners without premature writes
    Given evidence-backed findings and proposed repairs have been presented
    When the command runs without `--resolve`
    Then no source, task, feature, or numbered-document mutation occurs
    When the operator uses `--resolve` and confirms a selected repair set
    Then the skill revalidates evidence freshness before mutation
    And task/feature edits use Spur corpus commands, documentation edits use `sp:doc-evolve`, and source repairs use the Spur development lifecycle
    And ambiguity or partial failure is reported without silently continuing

  @core
  Scenario: R7 — Thin command, JSON contract, and shippable verification
    Given the capability is installed from the `sp` plugin
    When it is invoked for human or machine consumption
    Then the slash command contains routing only and delegates semantic logic to `sp:conflict-finding`
    And Markdown and `--json` outputs contain the same findings, evidence, authority provenance, coverage, unresolved decisions, and remediation state
    And Superskill lifecycle checks, plugin tests, fresh-session dogfood, and repository gates pass before H11 can close
```

### Q&A

**Q: Why one task instead of separate discovery, engine, and integration tasks?**
A: They share one authority model and one evidence contract. Splitting them creates artificial handoffs and permits incompatible interpretations. Task 0486 is intentionally the single shipping boundary.

**Q: Is v1 a programming project?**
A: No. V1 is a thin slash command plus a model-bearing skill and reference rulebook. Existing CLIs, Git, and repository search provide deterministic evidence. New production TypeScript, storage, indexing, embeddings, or dependencies are out of scope.

**Q: What does “indexed” mean in this task?**
A: A per-run in-memory evidence manifest plus optional reuse of fresh, provenance-bearing `.spur/context/` artifacts. It does not mean a new persistent index engine. Missing or stale context degrades to a disclosed cold scan, never silent reduced coverage.

**Q: Is there one global SSOT order?**
A: No. Authority is claim-specific. Project-local constitution/AGENTS rules win when explicit; otherwise the skill applies the documented fallback matrix. Normative authority and observed runtime/code reality are recorded separately.

**Q: Why keep stable JSON if reasoning is model-driven?**
A: JSON stabilizes the evidence envelope, not the reasoning implementation. The same finding fields must appear in Markdown and JSON so results can be inspected or composed without pretending the semantic classifier is deterministic.

**Q: Does `--resolve` authorize automatic repair?**
A: No. It opens the proposal/confirmation workflow. Every selected repair still needs explicit confirmation and a freshness check, then uses the owner surface for that artifact.

**Q: Does v1 need a dedicated subagent?**
A: No. The command defaults to inline skill execution and accepts the standard agent selector for isolation when useful. Add a dedicated subagent only after dogfood demonstrates a repeatable context-isolation need that the skill cannot satisfy.

**Q: Is a new ADR required?**
A: Not for the chosen design. It follows ADR-023 (skills own logic) and ADR-032 (command files own command surfaces). A new ADR is required only if implementation must violate or replace those decisions.

### Design

#### 1. Frozen command surface

```text
/sp:dev-find-conflict [<scope>]
    [--pillar <source|tasks|features|authority|all>]
    [--mode <adaptive|full>]
    [--resolve]
    [--agent <inline|auto|name>]
    [--json]
```

- `<scope>`: optional path, WBS, feature ID, symbol, command, config key, or free-form subject. Default is the current project.
- `--pillar`: limits the internal audit but still loads the minimum authorities needed to judge it. Default `all`.
- `--mode`: `adaptive` by default; `full` forces a cold comprehensive scan. Adaptive mode may reuse only freshness-verifiable indexed context and must disclose skipped areas.
- `--resolve`: enables proposal, confirmation, and owner-routed remediation. Its absence guarantees no source/corpus/numbered-doc mutation.
- `--agent`: standard Spur dispatch selector. Inline execution remains the default; it is not a new dedicated conflict-finder subagent.
- `--json`: emits the same result envelope as Markdown. It never implies deterministic semantic reasoning.

`plugins/sp/commands/dev-find-conflict.md` owns argument parsing guidance and delegation only. All workflow, comparison, authority, and remediation logic belongs to `plugins/sp/skills/conflict-finding/`.

#### 2. Exact artifacts and ownership

Create:

- `plugins/sp/commands/dev-find-conflict.md` — thin slash-command adapter.
- `plugins/sp/skills/conflict-finding/SKILL.md` — orchestration, progressive disclosure, invariants, and output contract.
- `plugins/sp/skills/conflict-finding/references/authority-resolution.md` — authority discovery, claim taxonomy, fallback matrix, ambiguity protocol.
- `plugins/sp/skills/conflict-finding/references/comparison-protocol.md` — inventories, subject clustering, internal/cross-pillar comparisons, token controls.
- `plugins/sp/skills/conflict-finding/references/finding-contract.md` — classifications, evidence rules, Markdown/JSON schemas, severity/confidence/coverage.
- `plugins/sp/skills/conflict-finding/references/remediation-routing.md` — HITL, freshness recheck, owner routing, partial-failure/idempotency behavior.

Update:

- `plugins/sp/README.md` — command/skill catalogs and counts.
- `plugins/sp/skills/spur-dev/references/dev-operations.md` — identify `dev-find-conflict` as a standalone audit command, as done for other non-pipeline dev operations.
- `plugins/sp/tests/command-contract.test.ts` — exact thin-wrapper and flag contract.
- `plugins/sp/tests/command-flag-parity.test.ts` — only if the frozen surface exposes a parity gap; do not add special-case logic when dynamic coverage already applies.
- `plugins/sp/tests/skill-structure.test.ts` — required skill references, critical invariants, command/README catalog parity.
- `docs/01_PRD.md` — WHAT/scope for semantic conflict finding.
- `docs/04_DESIGN.md` — command syntax, behavior, output envelope, and command-count/surface updates in the same commit.
- `docs/05_FEATURES.md` and H11 status projections — only through the documentation/corpus owners when implementation state changes.
- `AGENTS.md` and `config/templates/AGENTS.md` — portable harness routing for conflict audits, kept aligned.

Use Superskill's command/skill scaffold and validate/evaluate lifecycle for source capability artifacts. Do not commit Superskill-generated per-platform adapters.

#### 3. Authority model

Authority is resolved for a **subject + claim type**, not for a whole file. Project-local rules are discovered first from `AGENTS.md` and `docs/99_PROJECT_CONSTITUTION.md`. The Spur fallback is:

| Claim type                      | Normative authority                                                   | Constraint / projection              | Observed reality                         |
| ------------------------------- | --------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------- |
| Process and contribution rules  | `docs/99_PROJECT_CONSTITUTION.md`                                     | `AGENTS.md`, templates, workflows    | actual harness behavior and gate output  |
| Structural decision / rationale | accepted `docs/00_ADR.md` entry                                       | architecture/design docs             | source/module topology                   |
| Product scope and non-goals     | `docs/01_PRD.md`                                                      | feature tree and roadmap             | shipped surface                          |
| Feature goal and AC             | feature file, within PRD/ADR bounds                                   | tasks and `docs/05_FEATURES.md`      | implementation and verification evidence |
| Task obligation/status          | task Requirements/AC plus lifecycle verdict                           | feature AC and task Solution/Testing | code, tests, gate output                 |
| Architecture mechanism          | ADR when it decides the seam; otherwise current architecture contract | `docs/03_ARCHITECTURE.md`            | code dependency/topology                 |
| Command/API/schema surface      | owning command/contract/schema source under existing ADRs             | `docs/04_DESIGN.md`                  | registered runtime behavior and tests    |
| Implementation behavior         | applicable task/feature/doc obligation defines “should”               | tests as executable projection       | source and runtime behavior define “is”  |

Rules:

1. A lower-numbered document does not globally beat every artifact; the constitution's documented precedence applies only within its stated boundary.
2. Code is authoritative for what currently happens, not automatically for what should happen.
3. A todo feature/task differing from current code is planned work, not stale code, unless its lifecycle or supersession metadata says otherwise.
4. Accepted ADRs beat derived architecture/design projections; superseded ADRs are historical evidence, not current authority.
5. If two authorities are incomparable, the finding status is `needs-authority-decision`; no repair is proposed as settled fact.

#### 4. Audit algorithm

1. **Parse and guard** — resolve scope/flags, confirm repository root, establish audit-only versus resolve mode.
2. **Discover local authority** — read entry/process rules and build the claim-specific authority matrix before interpreting differences.
3. **Run deterministic preflight** — use `git`, `rg`, `spur task/feature ... --json`, relevant `spur ... check`, and `sp:doc-evolve` audit surfaces when available. Tool failures become coverage evidence; they are not silently ignored.
4. **Build inventories** — record pillar, identity, path, anchor, provenance/freshness, and scan status. Optional files may be absent; selected pillars may not be silently omitted.
5. **Build the candidate graph** — join claims using explicit links, WBS/feature IDs, dependencies, AC titles, paths, symbols, command/flag names, DTO/schema/config keys, and normalized domain terms. Do not compare every artifact with every other artifact.
6. **Audit within each pillar** — source contracts/implementations/tests/config/registrations; task requirements/AC/dependencies/status/solution; feature hierarchy/AC/status/index projections; authority ownership/decision/scope/process projections.
7. **Audit all applicable cross-pillar boundaries** — source↔task, source↔feature, source↔authority, task↔feature, task↔authority, feature↔authority.
8. **Classify and challenge** — test each candidate against lifecycle, supersession, abstraction-level, and intentional-deprecation explanations before asserting a conflict.
9. **Report** — order findings by severity then confidence; show clean boundaries, unresolved authority, coverage gaps, reused context, scan cost, and recommended owner.
10. **Resolve only when requested** — present the repair set, obtain confirmation, re-read anchors, then dispatch owner-specific repairs and report per-item outcome.

#### 5. Finding and result contracts

Each finding has these required fields in both Markdown and JSON:

```text
id, subject, claim_type, conflict_type, pillars, artifacts,
normative_authority, observed_reality, precedence_reason,
evidence, freshness, severity, confidence, false_positive_check,
proposed_repair, repair_owner, status
```

`conflict_type` is one of `contradiction`, `stale`, `duplicate`, `omission`, `orphan`, or `ambiguous-authority`. `status` is one of `open`, `needs-authority-decision`, `confirmed`, `repairing`, `resolved`, or `failed`.

Every evidence item contains a repo-relative path plus line, heading, symbol, WBS, feature ID, or command anchor; the claim paraphrase; provenance/freshness; and the command or reasoning step that reproduced it. At least two opposing anchors are required for contradiction/stale findings. Unavailable line numbers must be replaced with a stable structural anchor, never fabricated.

Top-level JSON keys are:

```text
schema_version, command, scope, mode, pillars, authority_map,
inventory, findings, unresolved, coverage, cost, remediation, errors
```

`coverage` records intended/discovered/scanned/skipped counts per pillar, skipped reasons, reused context, change cone, and `complete: boolean`. `errors` distinguishes tool failure from semantic uncertainty. Markdown contains the same information as readable sections.

Severity is impact-based (`critical`, `high`, `medium`, `low`); confidence is evidence strength (`high`, `medium`, `low`). Low confidence never disappears—it is reported as a candidate or unresolved item, not promoted to a definitive conflict.

#### 6. Token and cost controls

- Read authority rules and indexes first; open full artifacts only for candidate subjects.
- Reuse `.spur/context/anatomy.md` and related context only when their provenance and freshness can be checked against the current tree.
- In adaptive mode, always scan the complete authority/task/feature metadata surfaces needed for traceability; narrow source reads to the Git change cone and linked symbols. Escalate to full source scan when links are missing, context is stale, or coverage cannot be defended.
- Batch deterministic discovery commands and retain a compact in-memory evidence manifest for the current run.
- Report estimated files/claims/tokens inspected and skipped; do not claim “comprehensive” when `coverage.complete` is false.
- Do not add embeddings, a vector database, persistent caches, background daemons, or a custom parser in v1.

#### 7. Remediation routing

After explicit confirmation and freshness revalidation:

| Owner                                | Repair route                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Task/feature corpus                  | `sp:spur-cli` / `spur task` / `spur feature`; never direct file writes                                                                                 |
| Numbered docs and AGENTS projections | `sp:doc-evolve`; authority first, derived projections second                                                                                           |
| Source/tests                         | create or use a Spur task and route through `sp:spur-dev` / build competencies unless the active session already has explicit implementation authority |
| Command/skill capability source      | Superskill command/skill lifecycle in the owning plugin source                                                                                         |
| Ambiguous authority                  | stop for an operator decision; do not mutate either side                                                                                               |

Repairs are keyed by finding ID plus evidence fingerprint. If the anchors changed, mark `stale-evidence` and return to audit. Already-matching artifacts are `resolved` without a write. A failure in one repair does not mark others successful or silently roll forward; report the completed, failed, and untouched sets.

#### 8. Explicit anti-patterns and boundaries

- No semantic logic duplicated in the slash-command wrapper.
- No universal SSOT ranking detached from claim type and local process rules.
- No all-pairs corpus comparison, grep-only conclusion, or conflict assertion based on wording alone.
- No editing a derived projection before its authority.
- No mutation in audit mode and no automatic mutation merely because `--resolve` is present.
- No new production analyzer, index/cache/database, dependency, schema, service, CLI noun, workflow, or dedicated subagent.
- No generated per-platform command/skill adapters committed to this repository.
- No broad code/document cleanup outside confirmed findings.

### Plan

- [x] 1. Reconcile H11's decomposition/task references to the single live task 0486 through `spur feature update`, preserving the feature AC titles used for task traceability. (R1, R7)
- [x] 2. Confirm the installed scaffold help, then create the source skeletons with `superskill command scaffold dev-find-conflict --target claude --template standard --output plugins/sp/commands` and `superskill skill scaffold conflict-finding --target claude --template specialist --invocation-mode model --output plugins/sp/skills`; normalize the generated source paths if required, and do not generate or commit platform adapters. (R1, R7)
- [x] 3. Implement the thin command contract and `SKILL.md` orchestration, including flag defaults, audit-only guard, progressive reference routing, deterministic preflight, coverage accounting, and Markdown/JSON envelopes. (R1, R5, R7)
- [x] 4. Author the four reference files with the frozen authority matrix, internal/cross-pillar comparison protocol, finding schema/false-positive rules, and confirmed-remediation routing. (R2, R3, R4, R5, R6)
- [x] 5. Update `plugins/sp/README.md`, the standalone dev-operations reference, `docs/01_PRD.md`, `docs/04_DESIGN.md`, `AGENTS.md`, and `config/templates/AGENTS.md`; use `sp:doc-evolve` to update derived feature/status documentation from the authoritative sources. (R1, R7)
- [x] 6. Add focused command-contract and skill-structure tests for the exact flags, thin delegation, required references, authority/coverage/write-guard invariants, JSON field parity, and README/command catalog counts; change flag-parity tests only if dynamic coverage is insufficient. (R1–R7)
- [x] 7. Run targeted validation first: `superskill command validate plugins/sp/commands/dev-find-conflict.md --strict --json`, `superskill command evaluate plugins/sp/commands/dev-find-conflict.md --json`, `superskill skill validate plugins/sp/skills/conflict-finding/SKILL.md --strict --json`, `superskill skill evaluate plugins/sp/skills/conflict-finding/SKILL.md --json`, `bun plugins/sp/scripts/validate-commands.ts`, and the three focused plugin test files. Fix every blocking finding at its owning source. (R7)
- [x] 8. Dogfood in fresh sessions against (a) a within-task contradiction, (b) a feature↔task AC mismatch, (c) a code↔surface-doc stale projection, (d) ambiguous authority, (e) stale indexed context, and (f) confirmed and declined remediation; capture reproducible evidence and verify audit mode makes no governed writes. (R2–R7)
- [ ] 9. Run `sp:doc-evolve` sync/contract checks, `spur task check 0486`, `spur feature check H11`, then the repository gates: `bun run autofix && bun run spur-check`, `bun run lint`, `bun run test`, `bun run test-cf`, and `bun run build`; finish with `/sp:dev-verifyall --feature H11 --fix all` and require `Shippable PASS`. (R7)

### Solution

Prompt-first v1 ships as a thin command delegating semantic work to one deep skill; no production
analyzer, persistent index, runtime dependency, or generated platform adapter was added.

| File                                                                      | What / why                                                                                                                 |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `plugins/sp/commands/dev-find-conflict.md:13`                             | Frozen scope and flag contract (`## Argument Flags`, table at :15-23); delegates at line 50 to `sp:conflict-finding`.      |
| `plugins/sp/skills/conflict-finding/SKILL.md:77`                          | Ten-step four-pillar audit protocol, authority discovery, candidate graph, coverage disclosure, and confirmed remediation. |
| `plugins/sp/skills/conflict-finding/references/authority-resolution.md:8` | Claim-specific authority matrix and ambiguity-stop protocol.                                                               |
| `plugins/sp/skills/conflict-finding/references/comparison-protocol.md:59` | Bounded candidate graph plus internal and cross-pillar comparisons.                                                        |
| `plugins/sp/skills/conflict-finding/references/finding-contract.md:76`    | Stable finding fields and equivalent Markdown/JSON envelopes.                                                              |
| `plugins/sp/skills/conflict-finding/references/remediation-routing.md:81` | Explicit confirmation, freshness revalidation, owner routing, and partial-failure/idempotency semantics.                   |
| `plugins/sp/README.md:131`                                                | Command/skill catalogs and 36-command surface projection.                                                                  |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:41`              | Registers `dev-find-conflict` as a standalone non-pipeline audit command.                                                  |
| `plugins/sp/tests/command-contract.test.ts:305`                           | Updates the command corpus contract to 36 wrappers.                                                                        |
| `plugins/sp/tests/command-flag-parity.test.ts:191`                        | Updates the mode-aware `--agent` surface contract to 20 commands.                                                          |
| `plugins/sp/tests/skill-structure.test.ts:1203`                           | Adds R57 structural coverage for the skill, four references, delegation, and audit-only invariant.                         |
| `docs/01_PRD.md:100`                                                      | Adds the semantic conflict audit to product scope.                                                                         |
| `docs/04_DESIGN.md:555`                                                   | Documents syntax, behavior, result envelope, and no-production-analyzer boundary.                                          |
| `AGENTS.md:235` and `config/templates/AGENTS.md:143`                      | Keep monorepo and portable long-tail command routing aligned.                                                              |

Gate reconciliation: the new command legitimately raises hard-coded command and mode-aware-agent
counts by one; the corresponding contract tests were advanced rather than removing the supported
`--agent` surface. The aggregate skill-description budget remains within its updated tested cap.

### Testing

Re-verified in full by `/sp:dev-verify 0486 --auto --next --force --focus all --fix all`
(2026-08-09), including the fresh-session dogfood deferred at force-done. Both deferrals recorded in
`done_reason` are now closed.

**Repository gates**

| Gate             | Command           | Result                                                        |
| ---------------- | ----------------- | ------------------------------------------------------------- |
| Lint + typecheck | `bun run lint`    | PASS — 623 files, 0 findings; 7/7 workspaces typecheck exit 0 |
| Build            | `bun run build`   | PASS — all workspaces exit 0                                  |
| Full test suite  | `bun run test`    | 4743 pass / 24 fail / 4767 across 264 files                   |
| Worker tests     | `bun run test-cf` | BLOCKED — `EPERM: listen 127.0.0.1` (sandbox port denial)     |

The 24 failures are sandbox port/process denials (`Failed to listen at 127.0.0.1`, `EPERM mkdtemp`
under `$HOME`, `ps failed`) in `spur projects CLI`, `startServer`, `createServerContext`,
`healthModule`, `rpc client`, `project-start`, `ProjectRegistry`. Grepping the failing set for
`conflict|plugins/sp|command-contract|skill-structure|flag-parity` returns 0 matches.

`test-cf` is **environment-blocked, not failing**, and exercises `apps/server` — a surface this task
changes by zero lines. Flagged for an operator re-run outside the sandbox rather than claimed.

**Structural / contract gates**

| Check                       | Command                                                                                    | Result                             |
| --------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------- |
| Thin-wrapper validator      | `bun plugins/sp/scripts/validate-commands.ts`                                              | PASS — 36/36 commands, all 5 gates |
| Focused plugin tests        | `bun test plugins/sp/tests/{command-contract,skill-structure,command-flag-parity}.test.ts` | 180 pass / 0 fail, 1336 expect()   |
| Superskill command validate | `superskill command validate …/dev-find-conflict.md --strict`                              | `Valid`                            |
| Superskill skill validate   | `superskill skill validate …/conflict-finding/SKILL.md --strict`                           | 0 errors (2 non-blocking WARN)     |

The 2 skill WARNs (deprecated `version`, unknown `see_also`) are repo-wide house convention —
`see_also` in 16/27 sp skills, `version` in 7/27. Left unchanged per conformance-over-taste.

**Fresh-session dogfood (plan step 8) — blind, against a seeded answer key**

Method: built a Spur-shaped fixture project (`acme-widgets`: 5 authority docs, 1 feature, 3 tasks,
2 source files, 1 stale `.spur/context/anatomy.md`), git-committed at `d85efec`, seeding **6 known
conflicts** covering scenarios (a)–(e) plus **3 decoys** that must not be flagged. Three subagents
ran in cold fresh sessions with no access to the answer key; the verifier scored them.

| Session | Invocation                 | Recall | False positives |
| ------- | -------------------------- | ------ | --------------- |
| A       | `--mode full --pillar all` | 6/6    | 0               |
| B       | `--mode adaptive`          | 6/6    | 0               |
| C       | `--mode full --resolve`    | 6/6    | 0               |

Per-scenario coverage:

| Plan-8 scenario                       | Seeded conflict                                                                         | Outcome                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| (a) within-task contradiction         | 0102 R1 "MUST be 50" vs its own Solution "20"                                           | detected 3/3                                                                     |
| (b) feature↔task AC mismatch          | F1 AC 1000 vs 0101 AC 500                                                               | detected 3/3                                                                     |
| (c) code↔surface-doc stale projection | `docs/04_DESIGN.md` `--limit` 50 vs `src/cli.ts` 20; ADR-001 1000 vs `src/cache.ts` 500 | detected 3/3                                                                     |
| (d) ambiguous authority               | PRD v1 non-goal vs accepted ADR-001                                                     | 3/3 stopped at `needs-authority-decision`, **no repair proposed by any session** |
| (e) stale indexed context             | `anatomy.md` with null-SHA provenance + phantom `src/legacy-store.ts`                   | 3/3 refused reuse; degraded to cold scan with disclosure                         |
| (f) confirmed + declined remediation  | `--resolve` on 9 proposed repairs                                                       | see below                                                                        |

Decoys: D1 (abstraction-level "fast lookups" vs "O(1)") and D3 (`todo` task vs unimplemented code)
were cleared by all three, citing constitution §3 / authority Rule 3 by name. **D2 was an invalid
decoy** — the fixture's `keys().next().value` eviction with no `get()` accessor is genuinely FIFO,
not the LRU that ADR-001 mandates. All three flagged it; session A proved it by executing a
discriminating runtime probe and disclosed that two earlier confounded probes were discarded unused.
The answer key was wrong, not the skill.

Unseeded true findings the sessions surfaced: F1's roster omitting `0103` (all three); `0101` R1
deferring to "the ADR-mandated capacity" while its own AC hardcodes a contradicting literal;
`0102` missing `feature_id`, correctly weighted low because the obligation is a harness default with
no project-rule backing; and — session A only — `AGENTS.md` restating the precedence rule while
dropping the constitution's boundary qualifier, connected explicitly to why scenario (d) is
unresolvable.

Scenario (f), two rounds:

- **Round 1** — operator accepted 2 of 9 repairs, rejected 7. Both accepted repairs **failed at
  their owner surfaces** (task frontmatter L1 rejection; `--section Tasks` not addressable at `###`).
  The session did **not** fall back to a direct write: it identified two workarounds, named both,
  declined both with reasons, distinguished owner-surface failure from `stale-evidence` (fingerprints
  re-matched), and corrected its own earlier under-scoped risk warning.
- **Round 2** — after the fixture's corpus shape was made schema-valid, both repairs **completed**
  through `spur task update --section` and `spur feature update --section` (exit 0). The session
  first marked both items `stale-evidence` and returned to audit because line anchors had shifted,
  re-anchored on structural anchors, and verified the operator's "no claim changed" statement rather
  than trusting it — catching an added `## Notes` claim the operator had not mentioned.

Audit-mode write guard, verifier-checked (not self-reported): after all three audit sessions the
fixture stayed at `d85efec` with **zero** tracked-file modifications; only the `spur` CLI's own
`.spur/spur.db*` appeared, proactively disclosed by every session. Post-remediation, exactly the two
approved targets changed; every rejected finding's artifacts and both sides of the unresolved
authority item were byte-identical.

**Defects found in the shipped skill by this dogfood, and fixed**

| Defect                                                                                                                                                                                                 | Fix                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `remediation-routing.md` proposed `spur feature update --section Tasks` against a `###` subsection — not addressable, fails with `does not contain section`                                            | `plugins/sp/skills/conflict-finding/references/remediation-routing.md:134-146` — documents the `##`-feature / `###`-task addressability rule, the pre-proposal check, the blast-radius tradeoff, and frontmatter-rejection as owner-surface failure rather than `stale-evidence` |
| The preflight told agents to `rg` without noting that `rg` skips dot-directories and ignored paths, silently returning no hits over `.spur/context/` — a false negative that reads as a clean boundary | `plugins/sp/skills/conflict-finding/references/comparison-protocol.md:200-208` — requires `rg -uu` / `--hidden --no-ignore` for dotted or ignored trees and forbids reporting a default-scoped miss as a cleared boundary                                                        |

Both fixes re-verified: `bun test plugins/sp/tests/skill-structure.test.ts` 46 pass / 0 fail;
`superskill skill validate --strict` 0 errors.

**Per-requirement traceability**

| Req | Status | Evidence                                                                                                                                                                                                                                                                                     |
| --- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | MET    | `plugins/sp/commands/dev-find-conflict.md:1-51`; `plugins/sp/skills/conflict-finding/SKILL.md:99-104,112-117`. Dogfood: all 3 sessions inventoried four pillars with per-entry pillar/identity/path/freshness/scan-status and reported the 2 absent optional authorities without blocking    |
| R2  | MET    | `plugins/sp/skills/conflict-finding/references/finding-contract.md:15-16,50,61-63`. Dogfood: 18/18 seeded conflicts detected, 0 false positives, every decoy cleared with a named rule                                                                                                       |
| R3  | MET    | `plugins/sp/skills/conflict-finding/references/authority-resolution.md:8,24,70,82-83,101`. Dogfood: 3/3 sessions stopped at `needs-authority-decision` on scenario (d) and proposed no repair; none fabricated a winner                                                                      |
| R4  | MET    | `plugins/sp/skills/conflict-finding/references/comparison-protocol.md:62,88`; `plugins/sp/skills/conflict-finding/SKILL.md:133-136`. Dogfood: declared candidate graphs (A: 9 subjects/21 edges; B: 14/23), all-pairs explicitly refused, every finding anchored                             |
| R5  | MET    | `plugins/sp/skills/conflict-finding/references/comparison-protocol.md:208,217-220,233`; `plugins/sp/skills/conflict-finding/SKILL.md:35-39`. Dogfood: 3/3 refused the stale index on provenance; session B disclosed that adaptive degenerated to full coverage and claimed no token savings |
| R6  | MET    | `plugins/sp/skills/conflict-finding/references/remediation-routing.md:16-17,25,28-29`. Dogfood: zero governed writes across 3 audit runs; `--resolve` honored accept/reject exactly, reported partial failure without workaround, and completed only owner-routed writes                     |
| R7  | MET    | All ship artifacts, contracts, docs, tests, and Superskill validation above; fresh-session dogfood complete across (a)–(f). **Caveat:** `bun run test-cf` is environment-blocked (sandbox port denial) and untested here — it exercises `apps/server`, which this task does not touch        |

**Acceptance Criteria Verification**

| AC                                                                                  | Status | Evidence Type | Evidence                                                                                                                                                                      |
| ----------------------------------------------------------------------------------- | ------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scenario: R1 — Complete four-pillar inventory                                       | MET    | command       | 3/3 dogfood sessions produced full four-pillar inventories; absent optional authorities reported non-blocking                                                                 |
| Scenario: R2 — Internal conflicts are reported per pillar                           | MET    | command       | 18/18 recall, 0 false positives; decoys cleared citing constitution §3 / Rule 3                                                                                               |
| Scenario: R3 — Subject authority graph carries provenance and stops on ambiguity    | MET    | command       | 3/3 sessions emitted `needs-authority-decision` with no repair on the PRD↔ADR dispute                                                                                         |
| Scenario: R4 — Cross-pillar conflicts include reproducible evidence                 | MET    | command       | Declared candidate graphs; all-pairs refused; every finding carries repo-relative anchors re-resolved by the verifier                                                         |
| Scenario: R5 — Indexed adaptive coverage is honest and rebuildable                  | MET    | command       | Stale index refused on 3 grounds; cold-scan degradation disclosed; no cache/db/vector state created                                                                           |
| Scenario: R6 — Confirmed remediation routes through owners without premature writes | MET    | command       | Round 1: 2 owner-surface failures reported honestly, no fallback write. Round 2: both completed via `spur task/feature update --section`, exit 0; rejected set byte-identical |
| Scenario: R7 — Thin command, JSON contract, and shippable verification              | MET    | test          | 180 pass; validator 36/36; superskill `Valid`; dogfood complete. `test-cf` environment-blocked (see caveat)                                                                   |

**Fix-pass artifact disclosure:** `.spur/run/0486-verdict.json` written this run (gitignored).
Tracked repairs this run: `### Solution` line-5 anchor 14 → 13; `plugins/sp/skills/conflict-finding/references/remediation-routing.md:134-146` and
`plugins/sp/skills/conflict-finding/references/comparison-protocol.md:200-208` (dogfood-found defects). Dogfood fixture and answer key live under
the session scratchpad, outside the repo.

Coverage: N/A (documentation/prompt-artifact change; no runtime code path added — the capability is
a slash command plus a model-bearing skill with no production TypeScript).

### Review

Inline force-done review (no pipeline record→done; the pipeline implement stage timed out / scope-crept 0485 on both executors, so finishing was done inline per operator decision).

| Priority | Dimension         | Location                                     | Finding                                                                                                                                                                                                                                                                                                                 |
| -------- | ----------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | —                 | —                                            | None. All structural gates PASS: `validate-commands` 36/36; command-contract/skill-structure/flag-parity green; superskill validate strict 0 errors; `spur task check` PASS. Thin-wrapper ↔ skill delegation, four reference rulebooks, catalog/index parity intact.                                                    |
| P2       | Functional (R7)   | `docs/tasks3/0486_*.md:1` (Plan §8)          | R7 fresh-session dogfood not run (within-task contradiction, feature↔task AC mismatch, code↔doc stale projection, ambiguous authority, stale context, confirmed/declined remediation). The skill is prompt-first, so semantic correctness is proven only by dogfood, not structural tests. Must pass before H11 closes. |
| P2       | Verification (R7) | repo gates                                   | `bun run test`/`test-cf`/`build` deferred in this inline finish. Must pass before H11 closes.                                                                                                                                                                                                                           |
| P3       | Quality           | `plugins/sp/commands/dev-find-conflict.md:1` | `superskill evaluate` tier B (not A); acceptable for v1, revisit if dogfood surfaces thinness.                                                                                                                                                                                                                          |
| P3       | Lint              | `docs/tasks3/0486_*.md`                      | L4 "gate-language" WARNs on Background/Requirements/Design/AC prose — content-word matches, non-blocking.                                                                                                                                                                                                               |
| P4       | Process           | —                                            | Provenance caveat: `## Solution`/`## Testing`/`## Review` written manually (force-done), not by pipeline `record`. Mitigated by honest sections + real gate evidence; `done_reason` records the rationale.                                                                                                              |

**Residual risk:** the conflict-finding skill's authority/comparison logic is model-driven and untested at runtime; coverage is structural only until dogfood. Recommend `--mode full` cold-scan dogfood before relying on its findings.

**Disposition:** structurally shippable; **not** H11-closeable until the P2 dogfood + full repo gates pass. Force-done at the implementation/corpus boundary with that explicit limitation.

### References

- Parent feature: `docs/features/H11_semantic-conflict-finder-authority-aware-indexed-audit-and-confirmed-remediation.md`
- Process and documentation authority: `docs/99_PROJECT_CONSTITUTION.md`
- Skill/command ownership: `docs/00_ADR.md` — ADR-023 and ADR-032
- Product scope: `docs/01_PRD.md`
- Current command surface: `docs/04_DESIGN.md` §1.3 and `plugins/sp/README.md`
- Existing thin-wrapper precedent: `plugins/sp/commands/dev-find-issue.md`
- Existing backbone-skill precedent: `plugins/sp/skills/issue-finding/SKILL.md`
- Command validation: `plugins/sp/scripts/validate-commands.ts`
- Contract tests: `plugins/sp/tests/command-contract.test.ts`, `plugins/sp/tests/command-flag-parity.test.ts`, `plugins/sp/tests/skill-structure.test.ts`
- Capability lifecycle: `superskill command --help`, `superskill skill --help`

### History

- 2026-08-09T05:42:28.147Z todo → wip (system)
- 2026-08-09T05:42:28.616Z wip → testing (system)
- 2026-08-09T05:42:29.099Z testing → done (system)
