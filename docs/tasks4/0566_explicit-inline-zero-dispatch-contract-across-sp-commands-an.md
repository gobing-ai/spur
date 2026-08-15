---
template: feature-impl
schema_version: 1
name: "Explicit-inline zero-dispatch contract across sp commands and skills"
description: ""
status: done
type: task
profile: standard
feature_id: G5
parent_wbs: null
priority: P2
tags: ["plugins/sp", "contracts", "adr-047"]
dependencies: ["0565"]
ac_numbering: task-local
created_at: "2026-08-15T16:12:04.377Z"
updated_at: "2026-08-15T21:43:36.201Z"
---

## 0566. Explicit-inline zero-dispatch contract across sp commands and skills

### Background

Run after the CLI/service/workflow error contract lands (sibling task in this batch — contract text documents shipped behavior). The plugin-side inline-default execution-surface contract (plugins/sp/skills/spur-dev/references/cross-cutting.md) currently treats explicit `inline` as equivalent to omit, which under 0508 permits a single native-subagent dispatch — leaking the host-session guarantee. Design: docs/design/agent-inline-host-session.md. Enforcement here is convention, not mechanism — the CLI error (sibling task) is the mechanical backstop.

### Requirements
- [x] **R1.** `cross-cutting.md` § inline-default execution surface gains the explicit-`inline` carve-out: all model-bearing work executes in the invoking host session — no subagent, no subprocess, no workflow hop; 0508 eligibility applies to `omit` only. Measurable: the contract text states the carve-out and names the CLI error as backstop.
- [x] **R2.** `flag-glossary.md` and `dev-plan.md` inline rows no longer document `inline` ≡ omit; `dev-parallel.md` documents explicit-inline as sequential host-session execution with a printed notice (parallel fan-out is dispatch). Measurable: each file's inline row states the zero-dispatch semantics.
- [x] **R3.** Same-change sweep (feature AC R4): no command, skill, or reference under `plugins/sp` resolves or documents `inline` as `agent.default`/omit-equivalent after this task. Measurable: a grep over the plugin tree for the old equivalence returns no live row (the 0539 inventory script's plugin assertions stay green).
### Acceptance Criteria
Covers feature G5 scenarios:

- **R2 — Explicit inline on slash commands and agent skills means zero dispatch**
- **R4 — Consumers documenting inline as omit-equivalent are corrected in the same change**

```gherkin
Scenario: R2 — Explicit inline on slash commands and agent skills means zero dispatch
  Given a slash command or backend agent skill invoked with `--agent inline`
  When it executes model-bearing work
  Then all of that work runs in the invoking host session
  And no subagent, subprocess, or workflow hop receives the prompt

Scenario: R4 — Consumers documenting inline as omit-equivalent are corrected in the same change
  Given `agent-service` resolution, the workflow `agent.run` action, and `dev-plan` docs
  When the feature ships
  Then none of them resolve or document `inline` as `agent.default`
  And the ADR-047 amendment, flag glossary, and docs/04 §7.8 updates land in the same commit
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Implement-ready freeze (refine --depth ready, 2026-08-15). Implements design satellite
`docs/design/agent-inline-host-session.md` § Component 4. Depends on 0565 (consumes the shipped
`AGENT_INLINE_HEADLESS_MESSAGE` text verbatim — do not paraphrase it in docs).

**Frozen contract language (the carve-out — this wording is the deliverable):**

> Explicit `--agent inline` is a hard host-session guarantee: all model-bearing work executes in
> the invoking host session — never a native subagent, never a subprocess, never a workflow hop.
> The 0508 native-subagent eligibility applies to **omitted** `--agent` only. Headless surfaces
> (`spur agent run`, workflow `agent.run`, serve-side dispatch) reject `inline` with the stable
> special error (exit 2 at the CLI) and take no further action — no dispatch, no `agent.default`
> fallback.

**File targets (current anchors — re-locate by content, lines drift):**

- `plugins/sp/skills/spur-dev/references/cross-cutting.md` § inline-default execution surface —
  rewrite `:39` ("Omitting `--agent` is exactly `--agent inline`" → omit keeps the default;
  explicit inline is the zero-dispatch carve-out), the `:44` table row (split omit vs explicit
  inline; headless column → special error), and `:53-56` (the "not rejected (ADR-047)" note →
  reversed: headless surfaces reject with the frozen message).
- `plugins/sp/skills/spur-dev/references/flag-glossary.md` — `--agent` entry `:50` table row:
  same omit/inline split; `:61-62` collapse note stays historical (mark the inline leg superseded
  by G5).
- `plugins/sp/commands/dev-plan.md:19` — the `--agent` row: replace "synonym for omit, resolving
  to `agent.default`" with the special-error contract (planning pipeline `agent.run` stages are
  headless ⇒ explicit `inline` errors; use omit/auto/name).
- `plugins/sp/commands/dev-parallel.md:19` — the `--agent` row: explicit `inline` = legs run
  sequentially in the host session with a printed notice (parallel fan-out is dispatch); omit
  keeps the default fan-out semantics.

**Anti-patterns:** no new flag/env/config; do not soften MUST/NEVER wording; do not document
`inline` as `agent.default` anywhere; do not change `dev-run`/`dev-runall` semantics beyond the
carve-out wording; historical notes (H82/0413 collapse) stay as history, marked superseded.

**R3 sweep (frozen procedure):** `rg -n -i "inline.{0,40}(omit|agent\.default)|synonym for omit|exactly .inline" plugins/sp`
— every hit is either corrected to the carve-out or explicitly a superseded-history note; then
re-run `bun plugins/sp/scripts/surface-drift-inventory.ts --out docs/tasks2/0539-inventory.md`
(exit 0 expected; refreshed artifact committed).

**Handoffs:** none downstream; this task closes feature G5's AC R2/R4. Out of scope: any code
change (0565 owns all code); workflow YAML edits; serve-side docs (inherits service behavior).
### Plan
- [x] Rewrite cross-cutting.md § inline-default execution surface (:39 equivalence, :44 table row, :53-56 ADR-047 note) with the frozen carve-out language (R1)
- [x] Correct flag-glossary.md `--agent` entry (:50 row; mark :61-62 collapse note superseded-by-G5) (R2)
- [x] Correct dev-plan.md:19 `--agent` row to the special-error contract (R2)
- [x] Add dev-parallel.md:19 explicit-inline sequential-notice semantics (R2)
- [x] R3 sweep: run the frozen `rg` pattern over plugins/sp; correct or mark-superseded every hit (R3)
- [x] Re-run the surface-drift inventory and commit the refreshed artifact (R3)
- [x] Run `bun run autofix && bun run spur-check`
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/agent.ts:163` |
| `apps/cli/src/commands/agent.ts:171` |
| `apps/cli/src/commands/agent.ts:173` |
| `apps/cli/src/commands/agent.ts:3` |
| `apps/cli/src/commands/agent.ts:406` |
| `apps/cli/src/commands/agent.ts:54` |
| `apps/cli/tests/commands/agent.test.ts:11` |
| `apps/cli/tests/commands/agent.test.ts:8` |
| `apps/cli/tests/commands/agent.test.ts:937` |
| `packages/app/src/index.ts:44` |
| `packages/app/src/services/agent-service.ts:1140` |
| `packages/app/src/services/agent-service.ts:53` |
| `packages/app/src/workflow/actions/agent-run.ts:130` |
| `packages/app/src/workflow/actions/agent-run.ts:147` |
| `packages/app/src/workflow/actions/agent-run.ts:7` |
| `packages/app/tests/services/agent-service.test.ts:11` |
| `packages/app/tests/services/agent-service.test.ts:1658` |
| `packages/app/tests/services/agent-service.test.ts:1949` |
| `packages/app/tests/services/agent-service.test.ts:1954` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:14` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:1987` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:1999` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2008` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2020` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2024` |
| `plugins/sp/scripts/validate-flag-contracts.ts:409` |
| `plugins/sp/scripts/validate-flag-contracts.ts:413` |
| `plugins/sp/scripts/validate-flag-contracts.ts:415` |
| `plugins/sp/tests/inline-execution-contract.test.ts:122` |
| `plugins/sp/tests/inline-execution-contract.test.ts:53` |
| `plugins/sp/tests/inline-execution-contract.test.ts:63` |
**Re-verify (--force, focus all) 2026-08-15 — Verdict: PASS.** Fresh evidence this run: carve-out blockquote re-read at `plugins/sp/skills/spur-dev/references/cross-cutting.md:44-49`; `plugins/sp/commands/dev-parallel.md:19` sequential-inline row and `plugins/sp/commands/dev-plan.md:19` special-error row re-read; frozen R3 sweep re-run — only the two *prohibition* statements match (`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:119`, `plugins/sp/skills/spur-dev/references/execution-workflow.md:102`), zero live equivalences; `validate-flag-contracts.ts --check` → "All 67 contract surfaces agree"; `plugins/sp/tests/inline-execution-contract.test.ts` 12/12 pass this run. Original pipeline evidence below, reproduced:

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/skills/spur-dev/references/cross-cutting.md:44-49` — frozen carve-out blockquote: explicit `--agent inline` is a hard host-session guarantee — all model-bearing work executes in the invoking host session, never a native subagent, never a subprocess, never a workflow hop; 0508 native-subagent eligibility applies to **omitted** `--agent` only; headless surfaces reject `inline` (exit 2, stable special error). `:53-54` — value table splits `(omitted)` (host-controlled; eligible model stages may use a native subagent, 0508) from `inline` (zero dispatch; headless reject exit 2). `:65-70` — names the CLI error as backstop verbatim: headless surfaces reject with the exported `AGENT_INLINE_HEADLESS_MESSAGE` (exit 2 at the CLI), no dispatch, no `agent.default` fallback. `:84-87` — triggers select subprocess for omit/auto/name; explicit inline is the hard carve-out that rejects rather than dispatching. |
| R2 | MET | `plugins/sp/skills/spur-dev/references/flag-glossary.md:50-51` — value table: `(omitted)` row keeps 0508 eligibility; `inline` row states the zero-dispatch carve-out and headless rejection (no `inline` ≡ omit wording). `:65-68` — H82 collapse note marked **Superseded (feature G5)**: the `--inline` → `--agent inline` leg no longer means "equivalent to omitting the flag". `plugins/sp/commands/dev-plan.md:19` — inline row now documents the special-error contract: planning `agent.run` stages are headless, explicit `inline` is rejected (exit 2), use omit/auto/name; no synonym-for-omit language. `plugins/sp/commands/dev-parallel.md:19` — explicit `inline` runs the batch **sequentially in the host session** with a printed notice (parallel fan-out is dispatch); omit keeps default fan-out. |
| R3 | MET | Frozen sweep (pattern: `inline` within 40 chars of `omit` or `agent.default`, or the phrases `synonym for omit` / `exactly .inline`, over `plugins/sp`) — zero live violations; every hit is corrected carve-out prose (`plugins/sp/commands/dev-run.md:41`, `plugins/sp/commands/dev-runall.md:84`, `plugins/sp/skills/spur-dev/references/dev-operations.md:143,148`), a never-fall-back prohibition (`plugins/sp/skills/spur-dev/references/execution-workflow.md:102`, `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:119`), the frozen `AGENT_INLINE_HEADLESS_MESSAGE` quoted verbatim (`plugins/sp/skills/spur-dev/references/cross-cutting.md:68`), or test fixtures/assertions (`plugins/sp/tests/flag-contract-parity.test.ts:43,59,87,273` — deliberate drift fixtures exercising the validator; `plugins/sp/tests/inline-execution-contract.test.ts:65,122,141` — G5 assertions). No `--agent` row in `plugins/sp/commands/` retains an `inline` default cell (17 corrected; post-fix cell sweep matches nothing). `bun plugins/sp/scripts/validate-flag-contracts.ts --check` exit 0 — "All 67 contract surfaces agree across all claims". `bun plugins/sp/scripts/surface-drift-inventory.ts --out docs/tasks2/0539-inventory.md` exit 0 — "No confirmed mismatches" (refreshed artifact in the working tree). Plugin suite `bun test plugins/sp/tests/` — 622 pass, 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R2 — Explicit inline on slash commands and agent skills means zero dispatch | MET | test | `plugins/sp/skills/spur-dev/references/cross-cutting.md:44-49` — the carve-out: all model-bearing work executes in the invoking host session, never a native subagent, never a subprocess, never a workflow hop; headless surfaces reject `inline` with the stable special error (exit 2, `:65-70`). `:53-54` — omit (0508 eligibility) and inline (zero dispatch) are distinct table rows. `plugins/sp/commands/dev-run.md:41`, `plugins/sp/commands/dev-runall.md:84`, `plugins/sp/commands/dev-parallel.md:19` — every consumer surface states the zero-dispatch carve-out. Test: `plugins/sp/tests/inline-execution-contract.test.ts:65` — `expect(table.get('inline')?.defaultWhenOmitted).toBe(false)` and no subprocess surface (zero-dispatch carve-out), suite 622 pass / 0 fail this run. |
| Scenario: R4 — Consumers documenting inline as omit-equivalent are corrected in the same change | MET | command | Commands: frozen sweep (pattern: `inline` within 40 chars of `omit` or `agent.default`, or the phrases `synonym for omit` / `exactly .inline`, over `plugins/sp`) → zero live rows; `bun plugins/sp/scripts/validate-flag-contracts.ts --check` exit 0 ("All 67 contract surfaces agree"); `bun plugins/sp/scripts/surface-drift-inventory.ts --out docs/tasks2/0539-inventory.md` exit 0 ("No confirmed mismatches"). Doc rows: 17 command files' `--agent` default cells corrected `inline` → `omit` (the 15 review-flagged: `plugins/sp/commands/dev-arch.md:18`, `plugins/sp/commands/dev-brainstorm.md:19`, `plugins/sp/commands/dev-debug.md:19`, `plugins/sp/commands/dev-dogfood.md:17`, `plugins/sp/commands/dev-find-next.md:23`, `plugins/sp/commands/dev-next.md:20`, `plugins/sp/commands/dev-refine.md:22`, `plugins/sp/commands/dev-refineall.md:23`, `plugins/sp/commands/dev-refresh.md:19`, `plugins/sp/commands/dev-reverse.md:21`, `plugins/sp/commands/dev-review.md:17`, `plugins/sp/commands/dev-simplify.md:19`, `plugins/sp/commands/dev-unit.md:18`, `plugins/sp/commands/dev-verify.md:17`, `plugins/sp/commands/dev-verifyall.md:18`; plus same-class rows the review list missed: `plugins/sp/commands/dev-find-conflict.md:22`, `plugins/sp/commands/dev-find-issue.md:33`). `plugins/sp/skills/next-router/SKILL.md:50` — router defaults to omit semantics, explicit `inline` is the zero-dispatch carve-out forwarded as-is, escalation triggers reject `inline` (no override). `plugins/sp/skills/spur-dev/references/flag-glossary.md:50-51,65-68` — equivalence removed, collapse note superseded-by-G5. `plugins/sp/commands/dev-plan.md:19` / `plugins/sp/commands/dev-parallel.md:19` — corrected rows. `docs/00_ADR.md:383-389` — ADR-047 G5 amendment: explicit `inline` is a hard host-session guarantee, not a synonym for `omit`. `docs/04_DESIGN.md:1674-1685` — §7.8 amendment block; `:160-166` — §1.1 `spur agent run` prose corrected (omit keeps host-session default; triggers select subprocess for omit/auto/name; explicit inline rejects); `:886,:925` — command-shape `# default inline` → `# default omitted`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P1 | ac-row-dropped | — | 4 AC row(s) could not be parsed and were omitted from the verdict: Priority (unrecognised status "Dimension"); P2 (unrecognised status "contract-doc"); P3 (unrecognised status "contract-doc"); P4 (unrecognised status "docs"). Accepted evidence types: test, command, static-ref (aliases: static, doc, docs, documentation), manual-review, llm-judge, n/a. Accepted statuses: MET, PARTIAL, UNMET, N/A. |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

L

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

- 2026-08-15T17:39:29.107Z todo → wip (system)
- 2026-08-15T17:56:40.593Z wip → testing (system)
- 2026-08-15T17:57:30.584Z testing → done (system)
### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/agent.ts:163` |
| `apps/cli/src/commands/agent.ts:171` |
| `apps/cli/src/commands/agent.ts:173` |
| `apps/cli/src/commands/agent.ts:3` |
| `apps/cli/src/commands/agent.ts:406` |
| `apps/cli/src/commands/agent.ts:54` |
| `apps/cli/tests/commands/agent.test.ts:11` |
| `apps/cli/tests/commands/agent.test.ts:8` |
| `apps/cli/tests/commands/agent.test.ts:937` |
| `packages/app/src/index.ts:44` |
| `packages/app/src/services/agent-service.ts:1140` |
| `packages/app/src/services/agent-service.ts:53` |
| `packages/app/src/workflow/actions/agent-run.ts:130` |
| `packages/app/src/workflow/actions/agent-run.ts:147` |
| `packages/app/src/workflow/actions/agent-run.ts:7` |
| `packages/app/tests/services/agent-service.test.ts:11` |
| `packages/app/tests/services/agent-service.test.ts:1658` |
| `packages/app/tests/services/agent-service.test.ts:1949` |
| `packages/app/tests/services/agent-service.test.ts:1954` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:14` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:1987` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:1999` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2008` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2020` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2024` |
| `plugins/sp/scripts/validate-flag-contracts.ts:409` |
| `plugins/sp/scripts/validate-flag-contracts.ts:413` |
| `plugins/sp/scripts/validate-flag-contracts.ts:415` |
| `plugins/sp/tests/inline-execution-contract.test.ts:122` |
| `plugins/sp/tests/inline-execution-contract.test.ts:53` |
| `plugins/sp/tests/inline-execution-contract.test.ts:63` |
### Testing
**Re-verify (--force, focus all) 2026-08-15 — Verdict: PASS.** Fresh evidence this run: carve-out blockquote re-read at `plugins/sp/skills/spur-dev/references/cross-cutting.md:44-49`; `plugins/sp/commands/dev-parallel.md:19` sequential-inline row and `plugins/sp/commands/dev-plan.md:19` special-error row re-read; frozen R3 sweep re-run — only the two *prohibition* statements match (`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:119`, `plugins/sp/skills/spur-dev/references/execution-workflow.md:102`), zero live equivalences; `validate-flag-contracts.ts --check` → "All 67 contract surfaces agree"; `plugins/sp/tests/inline-execution-contract.test.ts` 12/12 pass this run. Original pipeline evidence below, reproduced:

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/skills/spur-dev/references/cross-cutting.md:44-49` — frozen carve-out blockquote: explicit `--agent inline` is a hard host-session guarantee — all model-bearing work executes in the invoking host session, never a native subagent, never a subprocess, never a workflow hop; 0508 native-subagent eligibility applies to **omitted** `--agent` only; headless surfaces reject `inline` (exit 2, stable special error). `:53-54` — value table splits `(omitted)` (host-controlled; eligible model stages may use a native subagent, 0508) from `inline` (zero dispatch; headless reject exit 2). `:65-70` — names the CLI error as backstop verbatim: headless surfaces reject with the exported `AGENT_INLINE_HEADLESS_MESSAGE` (exit 2 at the CLI), no dispatch, no `agent.default` fallback. `:84-87` — triggers select subprocess for omit/auto/name; explicit inline is the hard carve-out that rejects rather than dispatching. |
| R2 | MET | `plugins/sp/skills/spur-dev/references/flag-glossary.md:50-51` — value table: `(omitted)` row keeps 0508 eligibility; `inline` row states the zero-dispatch carve-out and headless rejection (no `inline` ≡ omit wording). `:65-68` — H82 collapse note marked **Superseded (feature G5)**: the `--inline` → `--agent inline` leg no longer means "equivalent to omitting the flag". `plugins/sp/commands/dev-plan.md:19` — inline row now documents the special-error contract: planning `agent.run` stages are headless, explicit `inline` is rejected (exit 2), use omit/auto/name; no synonym-for-omit language. `plugins/sp/commands/dev-parallel.md:19` — explicit `inline` runs the batch **sequentially in the host session** with a printed notice (parallel fan-out is dispatch); omit keeps default fan-out. |
| R3 | MET | Frozen sweep (pattern: `inline` within 40 chars of `omit` or `agent.default`, or the phrases `synonym for omit` / `exactly .inline`, over `plugins/sp`) — zero live violations; every hit is corrected carve-out prose (`plugins/sp/commands/dev-run.md:41`, `plugins/sp/commands/dev-runall.md:84`, `plugins/sp/skills/spur-dev/references/dev-operations.md:143,148`), a never-fall-back prohibition (`plugins/sp/skills/spur-dev/references/execution-workflow.md:102`, `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:119`), the frozen `AGENT_INLINE_HEADLESS_MESSAGE` quoted verbatim (`plugins/sp/skills/spur-dev/references/cross-cutting.md:68`), or test fixtures/assertions (`plugins/sp/tests/flag-contract-parity.test.ts:43,59,87,273` — deliberate drift fixtures exercising the validator; `plugins/sp/tests/inline-execution-contract.test.ts:65,122,141` — G5 assertions). No `--agent` row in `plugins/sp/commands/` retains an `inline` default cell (17 corrected; post-fix cell sweep matches nothing). `bun plugins/sp/scripts/validate-flag-contracts.ts --check` exit 0 — "All 67 contract surfaces agree across all claims". `bun plugins/sp/scripts/surface-drift-inventory.ts --out docs/tasks2/0539-inventory.md` exit 0 — "No confirmed mismatches" (refreshed artifact in the working tree). Plugin suite `bun test plugins/sp/tests/` — 622 pass, 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R2 — Explicit inline on slash commands and agent skills means zero dispatch | MET | test | `plugins/sp/skills/spur-dev/references/cross-cutting.md:44-49` — the carve-out: all model-bearing work executes in the invoking host session, never a native subagent, never a subprocess, never a workflow hop; headless surfaces reject `inline` with the stable special error (exit 2, `:65-70`). `:53-54` — omit (0508 eligibility) and inline (zero dispatch) are distinct table rows. `plugins/sp/commands/dev-run.md:41`, `plugins/sp/commands/dev-runall.md:84`, `plugins/sp/commands/dev-parallel.md:19` — every consumer surface states the zero-dispatch carve-out. Test: `plugins/sp/tests/inline-execution-contract.test.ts:65` — `expect(table.get('inline')?.defaultWhenOmitted).toBe(false)` and no subprocess surface (zero-dispatch carve-out), suite 622 pass / 0 fail this run. |
| Scenario: R4 — Consumers documenting inline as omit-equivalent are corrected in the same change | MET | command | Commands: frozen sweep (pattern: `inline` within 40 chars of `omit` or `agent.default`, or the phrases `synonym for omit` / `exactly .inline`, over `plugins/sp`) → zero live rows; `bun plugins/sp/scripts/validate-flag-contracts.ts --check` exit 0 ("All 67 contract surfaces agree"); `bun plugins/sp/scripts/surface-drift-inventory.ts --out docs/tasks2/0539-inventory.md` exit 0 ("No confirmed mismatches"). Doc rows: 17 command files' `--agent` default cells corrected `inline` → `omit` (the 15 review-flagged: `plugins/sp/commands/dev-arch.md:18`, `plugins/sp/commands/dev-brainstorm.md:19`, `plugins/sp/commands/dev-debug.md:19`, `plugins/sp/commands/dev-dogfood.md:17`, `plugins/sp/commands/dev-find-next.md:23`, `plugins/sp/commands/dev-next.md:20`, `plugins/sp/commands/dev-refine.md:22`, `plugins/sp/commands/dev-refineall.md:23`, `plugins/sp/commands/dev-refresh.md:19`, `plugins/sp/commands/dev-reverse.md:21`, `plugins/sp/commands/dev-review.md:17`, `plugins/sp/commands/dev-simplify.md:19`, `plugins/sp/commands/dev-unit.md:18`, `plugins/sp/commands/dev-verify.md:17`, `plugins/sp/commands/dev-verifyall.md:18`; plus same-class rows the review list missed: `plugins/sp/commands/dev-find-conflict.md:22`, `plugins/sp/commands/dev-find-issue.md:33`). `plugins/sp/skills/next-router/SKILL.md:50` — router defaults to omit semantics, explicit `inline` is the zero-dispatch carve-out forwarded as-is, escalation triggers reject `inline` (no override). `plugins/sp/skills/spur-dev/references/flag-glossary.md:50-51,65-68` — equivalence removed, collapse note superseded-by-G5. `plugins/sp/commands/dev-plan.md:19` / `plugins/sp/commands/dev-parallel.md:19` — corrected rows. `docs/00_ADR.md:383-389` — ADR-047 G5 amendment: explicit `inline` is a hard host-session guarantee, not a synonym for `omit`. `docs/04_DESIGN.md:1674-1685` — §7.8 amendment block; `:160-166` — §1.1 `spur agent run` prose corrected (omit keeps host-session default; triggers select subprocess for omit/auto/name; explicit inline rejects); `:886,:925` — command-shape `# default inline` → `# default omitted`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P1 | ac-row-dropped | — | 4 AC row(s) could not be parsed and were omitted from the verdict: Priority (unrecognised status "Dimension"); P2 (unrecognised status "contract-doc"); P3 (unrecognised status "contract-doc"); P4 (unrecognised status "docs"). Accepted evidence types: test, command, static-ref (aliases: static, doc, docs, documentation), manual-review, llm-judge, n/a. Accepted statuses: MET, PARTIAL, UNMET, N/A. |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References

L

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-15T17:39:29.107Z todo → wip (system)
- 2026-08-15T17:56:40.593Z wip → testing (system)
- 2026-08-15T17:57:30.584Z testing → done (system)
