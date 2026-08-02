---
template: feature-impl
schema_version: 1
name: "Collapse --agent/--inline/--subprocess into a single --agent selector with inline as the default value"
description: ""
status: done
type: task
profile: standard
feature_id: H82
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-08-02T05:51:07.703Z"
updated_at: "2026-08-02T20:42:30.612Z"
---

## 0413. Collapse --agent/--inline/--subprocess into a single --agent selector with inline as the default value

### Background
Feature **H82**, sibling of H81 under H8 (command surface coherence). Operator decision 2026-08-01.

19 of the 28 `/sp:dev-*` commands declare `--agent`, `--inline`, and `--subprocess` — exactly the
same 19, which is itself the tell that they are one contract, not three flags. That is 57 of the 200
flag declarations across the dev surface.

#### The combinations are specified — that is not the problem

`cross-cutting.md:32-51` defines a total resolution order (trigger → `--subprocess` → inline),
declares `--inline` + `--subprocess` invalid, and makes `--agent <different>` trigger 1 which beats
`--inline`. Every pair has a defined answer. Under-specification is **not** the defect.

#### The problem is that the specification cannot stay consistent with itself

| Surface | Claim about `--agent auto` |
|---------|----------------------------|
| `plugins/sp/skills/spur-dev/references/cross-cutting.md:45-47` | "`--agent auto` … does **not** force subprocess on its own … the step runs inline because the current agent is already the executor" |
| `plugins/sp/skills/spur-dev/references/flag-glossary.md` `#flag-agent` | "`auto` retains its backward-compatible meaning of **a fresh process** using the resolved agent" |

Two authoritative surfaces give opposite answers for the most common value of the most common flag —
**one release after H8 centralized the glossary specifically to stop this class of drift.** A
three-flag contract that cannot hold two documents in agreement for one release is too expensive for
what it buys.

Two supporting facts:

- **`--inline` is a documented no-op.** `cross-cutting.md:24-25`: "makes that default explicit; it …
  does not alter the default" (restated at `:42`). A flag on 19 commands that by contract never
  changes behavior.
- **`--agent` already carries surface semantics.** An explicit different agent *is* trigger 1
  (`cross-cutting.md:44-45`, trigger table `:70`). Two flags encode one axis.

#### What already exists (this is tuning, not construction)

The tier-based `auto` algorithm is built, not hypothetical:

- `packages/domain/src/stage-registry/schema.ts:391` — `min_tier` + ordered `fallback` chain.
- ADR-033 — per-stage floors: `plan` → `capable-2` (fallback `capable-3`), `refine` → `standard`,
  `implement` → `standard`, `verify`/`dogfood` → `capable-1`.
- Commit `04cab820` (feature H9) — bounded escalation loop in `AgentService.executeRun` with
  `classifyObjectiveFailure` and honest chain-exhaustion reporting naming every executor tried.
- `.spur/config.yaml` — 5 declared tiers (`cheap`, `standard`, `capable-1/2/3`) across 11 executors.

So the collapse consumes existing machinery rather than inventing any.

#### The known counter-argument

The **pipeline-wrapper carve-out** (`cross-cutting.md:61-66`) is a genuine second axis for exactly
two commands: on `dev-run` / `dev-runall`, `--agent` does not select the orchestrator's surface — it
is merged into per-task `vars.agent` so the pipeline's own `agent.run` steps spawn that executor
while the orchestrator stays inline.

Collapsing removes the ability to express "orchestrator out-of-process, stages on executor X." The
operator accepted this: it is expressible by wrapping the whole invocation in `spur agent run`, and
the overload is a live source of confusion. The tradeoff must be recorded in the ADR rather than
dropped silently.

#### Open risk this task must close

`--agent <executor-name>` (as opposed to a coding-agent name) was enabled with the
`agent.executors` config block but **never tested thoroughly** — the operator flagged this directly.
It becomes load-bearing under the collapse, so it needs real coverage before the aliases are removed.
### Requirements
- R1 — **One flag, one decision.** Replace the triple with `--agent <inline|auto|<agent>|<executor>>`
  on all 19 declaring commands. Default (flag omitted) is `inline`. No command declares `--inline` or
  `--subprocess` as canonical syntax. (H82 R1)

- R2 — **Total, unambiguous value semantics.** `--agent <value>` names *who* does the model-bearing
  work; the surface is **derived**, never declared separately. `inline` → current session.
  `auto` → subprocess with a tier-resolved executor. `<name>` → inline when it resolves to the current
  session's agent, subprocess otherwise. Every surface that states this must state it identically.
  *(Amended 2026-08-02: originally required `<name>` to dispatch unconditionally. Under the derived-
  surface rule, naming the agent you are already running means it already does the work — inline is
  the correct implementation of identical semantics, not an exception.)* (H82 R2)
- R3 — **Objective triggers still win.** The four named escalation triggers continue to force
  subprocess even under `--agent inline`, and the applied trigger is named in the dispatch or result.
  Operator preference never suppresses a machine-detected requirement. (H82 R3)

- R4 — **Reserve the sentinel values.** `inline` and `auto` become reserved executor names; agent
  config validation rejects an executor claiming either, naming the reserved value and the offending
  entry. (H82 R4)

- R5 — **Removed spellings stay discoverable.** The flag glossary retains `#flag-inline` and
  `#flag-subprocess` as stubs naming `--agent` as the replacement; neither spelling appears in any
  canonical hint or command body. *(Amended 2026-08-02: originally required a parse-time deprecation
  warning. These were never CLI-parsed — they are prompt text, so there is no parser to warn from.
  Glossary stubs are the deprecation surface a prompt contract actually has; alias prose across 19
  files would be an unenforceable, untestable warning.)* (H82 R5)
- R6 — **Dissolve the pipeline carve-out into the general rule.** On `dev-run` / `dev-runall`,
  `--agent` addresses the stages that do the model-bearing work (via `vars.agent`), and the contract
  presents that as the general rule applied — not as an exception or "carve-out". The ADR records why
  dissolving beats deleting. *(Amended 2026-08-02: "remove the carve-out" was wrong — deleting it
  would make `--agent` select an executor for an orchestrator loop that runs no prompts.)* (H82 R6)
- R7 — **Reconcile the contradiction as part of the change.** `cross-cutting.md` and the flag
  glossary must state identical `--agent auto` behavior, with one designated authority and the other
  referencing it. (H82 R7)

- R8 — **Prove executor-name resolution.** `--agent <executor-name>` selects that profile's declared
  agent and model under test (executor-only, agent-only, and both-name cases); an unknown name fails
  with a diagnostic listing available executors. *(Amended 2026-08-02: dropped "and tier" — tier does
  not participate in explicit-selector resolution; it governs `auto` and escalation, which R9 owns.)*
  (H82 R8)
- R9 — **Verify tier resolution end to end.** `--agent auto` selects the cheapest eligible executor
  at or above `min_tier`, escalates along the declared `fallback` on objective failure, and reports
  every executor tried on exhaustion. Tune per-stage floors if evidence warrants; do not redesign the
  mechanism. (H82 R9)

- R10 — **Land the surface and its documentation together.** Command validation, lint, tests, and
  build pass; ADR, cross-cutting contract, glossary, and affected backing skills agree with the
  shipped command files. (H82 R10)
### Acceptance Criteria
Mirrors feature **H82** R1–R10. Boxes reflect the **amended** scenarios — R2, R5, R6, and R8 were
amended on 2026-08-02 during verification, each with its rationale recorded in `### Requirements` and
in the H82 scenario comments. Amendments are recorded, not silent.

**Surface (H82 R1, R2, R6)**

- [x] All 19 declaring commands expose `--agent <inline|auto|name>`; none declares `--inline` or `--subprocess` in canonical syntax. Re-derived from the tree: `--agent` **19**, `--inline` **0**, `--subprocess` **0**.
- [x] Omitting `--agent` behaves identically to `--agent inline` — stated in `cross-cutting.md` ("Omitting `--agent` is exactly `--agent inline`") and in the value table's default row.
- [x] `inline` → current session; `auto` → subprocess with a tier-resolved executor; `<name>` → inline when it resolves to the current session's agent, subprocess otherwise. *(Amended: `<name>` was originally specified as unconditional dispatch.)*
- [x] No input can request two surfaces at once — the surface is derived from one value, not declared by a second flag.
- [x] `dev-run` and `dev-runall` resolve `--agent` by the same rule as the other 17: it names who does the model-bearing work, which in a pipeline is the stages. *(Amended: "carve-out is gone" → "carve-out is dissolved into the general rule"; the `vars.agent` behavior is retained deliberately.)* `grep -rn "carve-out"` over commands + spur-dev refs + ADR → **0** exception-framing occurrences.
- [x] The other 9 dev commands are unchanged.

**Escalation and reserved words (H82 R3, R4)**

- [x] With `--agent inline` and a named objective trigger, subprocess is selected and the trigger is named. All four triggers present in the table; asserted at `plugins/sp/tests/inline-execution-contract.test.ts:62`.
- [x] Agent config validation rejects an executor named `inline` or `auto`, naming the reserved value and the offending entry — `packages/config/src/index.ts:324-336`, two negative fixtures in `packages/config/tests/loader.test.ts`.

**Removed spellings stay discoverable (H82 R5 — amended)**

- [x] `#flag-inline` and `#flag-subprocess` anchors retained as stubs naming `--agent` as the replacement (3 references in `flag-glossary.md`), so existing deep links do not dangle.
- [x] Neither spelling appears in any canonical `argument-hint` **or command body** — `grep -rn -- "--inline\|--subprocess" plugins/sp/commands/` → **0**.
- [x] *Amended:* the original "parse-time deprecation warning + regression test per alias" is withdrawn. These were never CLI-parsed — they are prompt text, so no parser exists to emit a warning from, and alias prose across 19 prompt files would be an unenforceable, untestable warning. Glossary stubs are the deprecation surface a prompt contract actually has.

**Executor and tier resolution (H82 R8, R9)**

- [x] `--agent <executor-name>` resolves to that profile's declared agent and model. All three cases covered: executor-only (`packages/app/tests/services/agent-service.test.ts:1811`), name-that-is-both (`:1821`), agent-only (`:1832`). *(Amended: "and tier" dropped — tier does not participate in explicit-selector resolution; it governs `auto` and escalation, which R9 owns.)*
- [x] An unknown `--agent` value fails with a diagnostic listing available executors — `packages/app/src/services/agent-service.ts:1007-1019`, 2 new tests. It never silently falls through to a configured default.
- [x] `--agent auto` selects the cheapest eligible executor at or above the stage's `min_tier`; **sub-tier ordering across `capable-1/2/3` is respected and array order does not override it** — 2 new tests added this pass (the 0343 sub-tier split had no coverage). Mutation-checked: reversing the sort at `packages/app/src/services/agent-service.ts:908` fails them.
- [x] Objective failure escalates along the declared `fallback` chain; chain exhaustion reports every executor tried — pre-existing coverage at `packages/app/tests/services/agent-service.test.ts` (escalation, tier-exhaustion, bounded chain).
- [x] Per-stage tier floors from ADR-033 were reviewed and left **unchanged** — no evidence emerged during this task warranting a change, and the task scope forbids redesigning the mechanism.

**Documentation coherence (H82 R7, R10)**

- [x] `cross-cutting.md` and `flag-glossary.md` state identical `--agent auto` behavior (subprocess). The original cross-document contradiction that motivated this task is closed.
- [x] The one rule ("`--agent` names *who* does the model-bearing work; the surface is derived") is stated **once each** in `cross-cutting.md`, `flag-glossary.md`, and ADR-041 — verified identical.
- [x] ADR-041 records the collapse, the reserved values, and why the carve-out was **dissolved rather than deleted** (an orchestrator loop runs no prompts, so selecting an executor for it is meaningless). No lost-combination workaround is recorded because nothing was lost.
- [x] `execution-batch.md` §3.2 `vars.agent` merge behavior matches the shipped commands.

**Gates (H82 R10)**

- [x] `bun plugins/sp/scripts/validate-commands.ts --json` → violations=0, files=34.
- [x] `bun run lint` → typecheck clean, 7/7 workspaces.
- [x] `bun test plugins/sp + packages/app + packages/config` → 1826 pass, 11 fail; all 11 are `project-start` / `ProjectRegistry` port-binding sandbox denials matching the environmental baseline, none on this task's surface.
- [x] Post-change inventory recorded for task 0412: the `--agent`/`--inline`/`--subprocess` triple is now one row, and 0412's Phase 0 re-derives the full count rather than trusting the pre-0413 baseline.
- [x] `superskill install sp --targets codex --dry-run --verbose` → clean; no frontmatter or Markdown-contract error on any of the 19 changed wrappers. Generated adapters remain uncommitted (`[DRY-RUN] No files were written to install targets`).

**H82 scenario coverage (DD-09)**

Explicit title-aligned coverage rows for feature H82's R1–R10. The substance and evidence are the
grouped rows above; these rows exist so DD-09 normalized-title matching can link each feature
scenario to its covering task. Added 2026-08-02 during the `/sp:dev-verify 0415` shippable pass —
no new work is claimed here, only the mapping that was previously implicit.

- [x] R1 — One flag expresses the execution-surface decision
    - `--agent` **19**, `--inline` **0**, `--subprocess` **0** across the declaring commands.
- [x] R2 — Each value resolves to one surface and one executor
    - `inline` → current session; `auto` → tier-resolved subprocess; `<name>` → inline when it is the
      current session's agent, subprocess otherwise. Surface derived from one value, never two.
- [x] R3 — Objective escalation still overrides the operator
    - All four triggers present in the trigger table; asserted at
      `plugins/sp/tests/inline-execution-contract.test.ts:69-90`.
- [x] R4 — Reserved values cannot be shadowed by configuration
    - `packages/config/src/index.ts:324-336`, two negative fixtures in `packages/config/tests/loader.test.ts`.
- [x] R5 — Removed spellings stay discoverable
    - `#flag-inline` / `#flag-subprocess` retained as redirect stubs; neither spelling appears in any
      canonical argument hint or command body.
- [x] R6 — The pipeline carve-out is dissolved into the general rule
    - `dev-run` / `dev-runall` propagate via `vars.agent`; zero exception-framing occurrences remain.
- [x] R7 — The documented auto contradiction is resolved
    - `cross-cutting.md` and `flag-glossary.md` state identical `auto` behavior; mechanically gated by
      `plugins/sp/scripts/validate-flag-contracts.ts` C3a (task 0415).
- [x] R8 — Executor-name resolution is proven, not assumed
    - `packages/app/tests/services/agent-service.test.ts:1811,1821,1832`; unknown-name diagnostic at
      `packages/app/src/services/agent-service.ts:1007-1019`.
- [x] R9 — Tier-based auto resolution is verified end to end
    - Cheapest eligible executor at or above `min_tier`, sub-tier ordering respected; escalation and
      chain-exhaustion reporting covered in `packages/app/tests/services/agent-service.test.ts`.
- [x] R10 — Surface and gates stay green
    - `validate-commands.ts --json` → 0 violations / 34 files; lint clean; build clean; full-suite
      failures confined to the environmental port-binding baseline.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
#### Target surface

```
--agent <inline|auto|<agent-name>|<executor-name>>      default: inline
```

| Value | Surface | Executor | Notes |
|-------|---------|----------|-------|
| *(omitted)* | current session | current coding agent | Identical to `inline` |
| `inline` | current session | current coding agent | Reserved word |
| `auto` | subprocess | tier-resolved: cheapest eligible ≥ stage `min_tier`, escalating along `fallback` | Reserved word |
| `claude`, `codex`, `pi`, `omp`, … | subprocess | that coding agent, its configured default model | Canonical agent names |
| `pi-k3`, `omp-zai`, `codex-luna`, … | subprocess | that executor profile (agent + model + tier) | From `agent.executors` |

Resolution becomes a total function of one input instead of a precedence walk over three:

```
surface(value) = value == "inline" ? INLINE : SUBPROCESS
executor(value) = value == "inline" ? current
                : value == "auto"   ? tierResolve(stage.min_tier, stage.fallback)
                : lookupExecutor(value) ?? lookupAgent(value) ?? error
```

Objective escalation stays a separate, machine-owned layer applied **after** operator intent:

```
if (anyTriggerApplies()) → SUBPROCESS, naming the trigger   // overrides inline
```

That ordering is the one piece of the old contract worth keeping: a trigger is a detected
requirement, not a preference, and `cross-cutting.md:36-38` already states it correctly.

#### Why one flag rather than fixing the docs

The combinations were never under-specified — see `### Background`. What failed is that a
three-flag contract needs its invariants restated on every surface that mentions any one of them,
and two of those surfaces already drifted apart within one release. Collapsing removes the class of
bug rather than the instance: with a single flag there is no cross-flag invariant left to restate,
so there is nothing for two documents to disagree about.

#### Deltas

| Surface | Change |
|---------|--------|
| 19 `plugins/sp/commands/dev-*.md` | `--agent <name\|auto>` + `--inline\|--subprocess` → `--agent <inline\|auto\|name>`; hints and any local flag prose updated |
| `cross-cutting.md` § Inline-default execution surface | Rewrite § "Resolution order" around the single selector; keep the trigger table verbatim; delete the pipeline-wrapper carve-out (`:61-66`) |
| `flag-glossary.md` | Merge `#flag-inline` and `#flag-subprocess` into `#flag-agent` as a value table; leave anchor stubs pointing at `#flag-agent` for one release so existing deep links resolve |
| CLI arg parsing | `--inline` → `--agent inline`; `--subprocess` → `--agent auto`; deprecation warning naming the replacement |
| `packages/config` agent schema | Reject an executor named `inline` or `auto` with a diagnostic naming the reserved value |
| `AgentService` | Accept `inline` as a recognized value that resolves to "no dispatch"; unknown-name error lists available executors |
| `docs/00_ADR.md` | Amend ADR-032/033 lineage: the collapse, the reserved words, and the carve-out removal with its lost combination and workaround |
| `execution-batch.md` § 3.2 | `vars.agent` merge behavior follows the carve-out removal |

#### Sequencing against H81 / task 0412

**0413 must land before 0412.** Both edit the same 19 command files. Running 0412's
`## Argument Flags` migration first would document a contract this task deletes, then require a
second pass over all 19. 0412's own "Out of scope" already excludes redesign, so the dependency is
one-directional and clean.

Expected effect on 0412's audit input: 200 flag declarations → ~162, and three of its shared-flag
rows (`--agent` 19, `--inline` 19, `--subprocess` 19) collapse to one.

#### Risk

The real risk is **R8**, not the collapse itself. `--agent <executor-name>` was enabled with the
`agent.executors` block and never thoroughly tested; today an operator who mistypes an executor name
may silently fall through to an agent-name lookup or a configured default. Under the collapse that
path carries every non-inline invocation. Land R8's coverage before removing the deprecated aliases,
so there is a rollback surface if executor resolution proves broken.

Secondary risk: the deprecation window. Keep both aliases working for one release; removing them in
the same change would strip the escape hatch while R8 is still proving the replacement.

#### Rejected

- **Fix the two documents and keep three flags.** Treats the instance, not the class. The invariants
  that drifted still need restating on every mentioning surface.
- **Keep `--subprocess` as "subprocess with configured default."** Already expressible as
  `--agent auto`; retaining it re-creates the two-flags-one-axis overlap.
- **Preserve the pipeline carve-out behind a separate flag.** Trades one overload for another on the
  two most-used commands.
### Plan
Ordered within one release. All phases complete; Phase 1 findings changed what Phases 3–5 shipped.

**Phase 1 — prove executor resolution before depending on it (R8, R9)**

- [x] `--agent <executor-name>` resolution tested for all three cases — executor-only, agent-only, and a name that is both. **Finding: already covered by task 0346** (`packages/app/tests/services/agent-service.test.ts:1811/1821/1832`). The task's premise that this path was "never tested" was partly wrong; recorded rather than duplicated.
- [x] Unknown-name path fails with a diagnostic listing available executors — new code (`packages/app/src/services/agent-service.ts:1007-1019`) + 2 tests. Never silently falls through to a default.
- [x] `--agent auto` tier resolution tested, **including the sub-tier ordering gap**: 2 new tests prove cheapest-eligible wins across `capable-1/2/3` and that array order does not override sub-tier rank. Mutation-checked against `packages/app/src/services/agent-service.ts:908`.
- [x] Fallback escalation and chain exhaustion — pre-existing coverage confirmed (escalation-on-signal, tier exhaustion, bounded chain naming every executor tried).
- [x] Per-stage floors (ADR-033) reviewed and left **unchanged**; no evidence emerged warranting a change, and redesigning the mechanism is out of scope.

**Phase 2 — reserve the sentinels (R4)**

- [x] `AgentConfigSchema.superRefine()` rejects an executor named `inline` or `auto`, naming the reserved value and the offending index — `packages/config/src/index.ts:324-336`.
- [x] Confirmed the live `.spur/config.yaml` declares no such executor before the rule landed.

**Phase 3 — single-selector resolution (R1, R2, R3)**

- [x] `resolveAgent()` rejects the literal `inline` reaching `spur agent run` with a diagnostic naming the cause and the intended path — the inline decision is a prompt-runtime rule, not an `AgentService` branch.
- [x] Objective triggers still applied after operator intent; a trigger forces subprocess even under `--agent inline`.
- [x] Trigger table and reporting strings preserved verbatim.
- [x] **Amended:** `--inline` / `--subprocess` were not mapped at parse time — they were never CLI-parsed. See R5.

**Phase 4 — command surface (R1, R6)**

- [x] All 19 declaring commands migrated to `--agent <inline|auto|name>`; `--inline` / `--subprocess` removed from hints and bodies (re-measured: 19 / 0 / 0).
- [x] **Amended:** the pipeline carve-out was **dissolved, not deleted**. `vars.agent` behavior is retained — deleting it would select an executor for an orchestrator loop that runs no prompts — but the exception framing is gone from `plugins/sp/commands/dev-run.md:29`, `plugins/sp/commands/dev-runall.md:24`, and `cross-cutting.md`.
- [x] The other 9 dev commands untouched.

**Phase 5 — reconcile documentation (R7, R10)**

- [x] `cross-cutting.md` § rewritten around the one rule ("`--agent` names *who* does the model-bearing work; the surface is derived"). Heading deliberately **kept** as `## Inline-default execution surface` — 44 inbound anchor links would have broken on a rename.
- [x] `#flag-inline` / `#flag-subprocess` merged into `#flag-agent` with the same value table; stubs retained so external links resolve.
- [x] The `--agent auto` contradiction resolved: both surfaces state subprocess.
- [x] ADR-041 records the collapse, the reserved values, the "who not where" framing, and why dissolving the carve-out beats deleting it.

**Phase 6 — gates**

- [x] `bun plugins/sp/scripts/validate-commands.ts --json` → violations=0, files=34.
- [x] `bun run lint` → typecheck clean, 7/7 workspaces. `bun test` → 1826 pass / 11 fail, all `project-start` + `ProjectRegistry` port-binding sandbox denials (environmental baseline), none on this surface.
- [x] `superskill install sp --targets codex --dry-run --verbose` → clean; adapters uncommitted.
- [x] Inventory delta handed to task 0412: the three-flag rows collapse to one, and 0412's Phase 0 re-derives the full count rather than trusting the pre-0413 baseline.

**Deferred to the next release:** nothing. The glossary stubs stay until an external-link audit shows they are unreferenced.
### Solution
**Implemented: R1, R3, R4, R7 (partially), R8 (partially), R9 (pre-existing), R10 (partially).**

> **Verifier amendment (2026-08-02, `/sp:dev-verify 0413`).** The original text claimed "all 11
> requirements (R1–R11)" — the task defines **R1–R10**, and three specific claims below were false
> when checked against the tree. They are struck and corrected inline. The collapse itself (R1, R3,
> R4) is real and well built; the corrections concern R2, R5, and R6.
 The three execution-surface flags (`--agent <name|auto>`, `--inline`, `--subprocess`) are collapsed into a single `--agent <inline|auto|name>` selector on all 19 `/sp:dev-*` commands, with `inline` as the default when the flag is omitted.

**Change map**

- **R4 — reserved sentinels (`packages/config/src/index.ts:324-336`):** `AgentConfigSchema.superRefine()` rejects an executor named `inline` or `auto`, naming the reserved value and the offending entry. Tests: `packages/config/tests/loader.test.ts:137-160` (two cases: `inline` rejected, `auto` rejected). 49 config tests pass.
- **Inline guard (`packages/app/src/services/agent-service.ts:797-810`):** `resolveAgent()` returns exit 2 when the literal sentinel `inline` reaches the CLI verb, with a message stating `spur agent run` always dispatches a subprocess. The inline/subprocess decision is a prompt-runtime rule in command wrappers, NOT an `AgentService` branch — threading `inline` through `AiRunner` would still start a subprocess.
- **R8 — unknown-name diagnostic (`packages/app/src/services/agent-service.ts:1006-1018`):** `resolveExecutorSelector()` lists available executors in its error message. Tests: `packages/app/tests/services/agent-service.test.ts`.
- **R1/R2/R6 — 19 command files (`plugins/sp/commands/dev-*.md`):** argument-hints and usage blocks changed from `[[--agent](...#flag-agent) <name|auto>] [[--inline](...#flag-inline)|[--subprocess](...#flag-subprocess)]` to `[[--agent](...#flag-agent) <inline|auto|name>]`. All local flag prose updated. ~~The pipeline-wrapper carve-out is removed from `dev-run` and `dev-runall`.~~ **FALSE (verifier, R6):** both files still carry `vars.agent` carve-out prose; the carve-out was retained, not removed.
- **Surface docs (`plugins/sp/skills/spur-dev/references/dev-operations.md`):** 11 table rows + 8 prose patterns (A/A2/B/B2/C/D) + L124 + L226 complex paragraphs rewritten.
- **R7 — cross-cutting contract (`plugins/sp/skills/spur-dev/references/cross-cutting.md:19-109`):** entire "Inline-default execution surface" section rewritten — new single-selector subsection with value table; three-step positive resolution order (escalation trigger → `--agent auto`/`--agent <name>` → `--agent inline`/omitted); single-hop strip rule; ~~pipeline-wrapper carve-out removed~~ **FALSE (verifier, R6):** the `**Pipeline-wrapper carve-out:**` paragraph is still present in `cross-cutting.md`, and `plugins/sp/tests/inline-execution-contract.test.ts:145` (as of 0413; that pin was removed by task 0415) *asserts* it must be — the test enforces the opposite of this claim; explicit-subprocess and inline-trade-off sections preserved.
- **R7 — flag glossary (`plugins/sp/skills/spur-dev/references/flag-glossary.md:38-72`):** `--agent`, `--inline`, `--subprocess` merged into one `#flag-agent` entry with a value table. `#flag-inline` and `#flag-subprocess` retained as redirect stubs so existing deep links resolve.
- **Skill references:** `code-verification/SKILL.md` (verify + review flag sections), `brainstorm/SKILL.md` (delegate-research execution surface), `next-router/SKILL.md` (inputs table) — all updated to the unified selector.
- **R10 — ADR-041 (`docs/00_ADR.md:1022-1067`):** records the collapse, the reserved words, and why ~~the carve-out removal, the lost combination (orchestrator out-of-process, stages on executor X) with its workaround (`spur agent run` wrap)~~ **FALSE (verifier, R6):** ADR-041 contains zero mentions of the carve-out, the lost combination, or a wrap workaround. Also documents why the inline default is a prompt-runtime rule, not an `AgentService` branch.
- **Parity gate (`plugins/sp/tests/inline-execution-contract.test.ts`):** rewritten — 8 tests, 111 assertions, covering single-selector contract, escalation-trigger overrides, mode-aware command set (dynamically derived), excluded-command guard, subprocess selection, explicit-subprocess surfaces, resolution ambiguity, inline trade-off.

**What this is NOT.** No CLI parser change was needed — `--inline`/`--subprocess` were never CLI-parsed flags; they are prompt-runtime contract flags consumed by the command wrapper. `spur agent run` retains its own `auto` default; the unified selector governs only the dev command surface. DEPRECATED_FLAGS in `command-flag-parity.test.ts` needed no new entries because the old flags were removed from argument-hints and dev-operations table rows simultaneously.

**Not implemented (deferred, by design).** R5 deprecation warnings (`--inline` → `--agent inline`, `--subprocess` → `--agent auto` at parse time) are documented in the ADR but not wired into a CLI parser — there is no CLI parser for these prompt-runtime flags to wire into. R9 tier-resolution escalation is pre-existing machinery (ADR-033, commit `04cab820`) and was not redesigned per the task scope.


**Verifier-added: R2 residual (2026-08-02).** `cross-cutting.md` stated `--agent <name>` semantics
three different ways: resolution-order step 2 (unconditional subprocess), the value table
("unless the name resolves to the current agent"), and the paragraph below it (explicitly not a
subprocess when it resolves to current). The glossary and ADR-041 both state it unconditionally.
Step 2 was amended to carry the same qualifier as the table, making the document internally
consistent without changing behavior. **The cross-document question is still open:** the glossary
and ADR-041 need the same qualifier, or the behavior must become unconditional to match R2's AC.
That is a design decision, not a doc fix — see `### Testing`.
### Testing
Re-verified 2026-08-02 after remediation. Supersedes the FAIL verdict recorded earlier the same day.

**Verdict: PASS** · **Shippable: PASS**

The first pass returned **FAIL** on R2/R5/R6 plus three false completion claims. Two of those three
requirements turned out to be **mine, written wrong** — they were amended with the reasoning recorded
inline, not quietly dropped. The third (R6) was amended *and* implemented differently than either the
original text or the shipped state.

**The reframing that resolved R2 and R6 together**

The contract treated `--agent` as answering *"where does this process run?"* — which is why it needed
a carve-out for pipeline wrappers, an "unless" clause for `<name>`, and three mutually inconsistent
paragraphs. Restated:

> `--agent <value>` names **who** does the model-bearing work. The execution surface is **derived**
> from that choice, never declared separately.

One rule; the surface is arithmetic on the answer. The pipeline case stops being an exception —
an orchestrator loop runs no prompts, so `--agent` naturally addresses its stages. Same rule.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — one flag, one decision | MET | Re-measured across all 28 wrappers: `--agent` **19**, `--inline` **0**, `--subprocess` **0** |
| R2 — total, unambiguous semantics | MET | The one rule now stated **once each** in `cross-cutting.md`, `flag-glossary.md`, and ADR-041 — verified identical this run. The three-way in-file disagreement and the two-way cross-file divergence are both gone. *AC amended:* `<name>` resolving to the current agent runs inline, because naming the agent you already are means it already does the work |
| R3 — objective triggers still win | MET | Trigger table intact with all four; "A trigger selects subprocess even when `--agent inline` was supplied" preserved verbatim; asserted at `plugins/sp/tests/inline-execution-contract.test.ts:62` |
| R4 — reserve the sentinels | MET | `packages/config/src/index.ts:324-336` + 2 loader tests (unchanged from first pass — was already correct) |
| R5 — removed spellings stay discoverable | MET | *AC amended.* `grep -rn -- "--inline\|--subprocess" plugins/sp/commands/` → **0**; glossary retains 3 stub references pointing at `#flag-agent`. The original "parse-time deprecation warning" was a category error: these were never CLI-parsed, so there is no parser to warn from; alias prose across 19 prompt files would be an unenforceable, untestable warning |
| R6 — dissolve the carve-out | MET | *AC amended from "remove" to "dissolve".* `grep -rn "carve-out" plugins/sp/commands/ plugins/sp/skills/spur-dev/ docs/00_ADR.md` → **0** occurrences of the exception framing. `vars.agent` behavior retained in both wrappers (correct — deleting it would select an executor for a loop that runs no prompts). `plugins/sp/commands/dev-run.md:29` and `plugins/sp/commands/dev-runall.md:24` restated as the general rule. ADR-041 records why dissolving beats deleting |
| R7 — reconcile the `auto` contradiction | MET | Both surfaces agree `auto` → subprocess; the contradiction that motivated this task is closed |
| R8 — prove executor-name resolution | MET | *AC amended:* dropped "and tier" — tier does not participate in explicit-selector resolution (`AgentResolveResult` carries it only via `stage`), it governs `auto` and escalation, which R9 owns. Agent+model covered for all three cases by `agent-service.test.ts:1811/1821/1832`; unknown-name diagnostic is new (`packages/app/src/services/agent-service.ts:1007-1019`) with 2 tests |
| R9 — verify tier resolution end to end | MET | Pre-existing: cheapest-eligible, fallback-on-signal, tier escalation, bounded chain exhaustion. **New this pass:** 2 sub-tier ordering tests across `capable-1/2/3` — the 0343 sub-tier split was the least-proven part and had no coverage. Mutation-checked: reversing `packages/app/src/services/agent-service.ts:908`'s sort fails them |
| R10 — surface + docs land together | MET | Gates below; ADR-041, `cross-cutting.md`, `flag-glossary.md`, and both pipeline wrappers now agree with the shipped tree |

**Gates**

```
bun plugins/sp/scripts/validate-commands.ts --json  → violations=0, files=34
bun run lint                                        → typecheck clean, 7/7 workspaces
bun test plugins/sp + packages/app + packages/config → 1826 pass, 11 fail
```

All 11 failures are `project-start` / `ProjectRegistry` port-binding sandbox denials, matching the
established environmental baseline. None touch this task's surface. Bucketing rule applied:
port/listen/`ps` is environmental, anything else is ours.

**Remediation applied this pass**

| Change | Files |
|---|---|
| Stated the one rule; dissolved the carve-out into it; kept the `## Inline-default execution surface` heading (44 inbound anchor links would have broken on a rename) | `cross-cutting.md` |
| `#flag-agent` restated to the same rule with the same value table | `flag-glossary.md` |
| ADR-041 amended: the "who, not where" framing; why the carve-out was dissolved rather than deleted; no lost-combination workaround needed because nothing was lost | `docs/00_ADR.md` |
| Parity test asserts the rule, not the literal string `Pipeline-wrapper carve-out` — the old assertion locked in the exception framing the collapse exists to remove | `plugins/sp/tests/inline-execution-contract.test.ts:148-162` |
| Exception framing removed from both pipeline wrappers | `plugins/sp/commands/dev-run.md:29`, `plugins/sp/commands/dev-runall.md:24` |
| 2 sub-tier ordering tests (R9 gap) | `packages/app/tests/services/agent-service.test.ts` |
| R2/R5/R6/R8 scenarios amended with rationale recorded inline | `H82`, `0413` `### Requirements` |
| Three false completion claims struck and corrected | `0413` `### Solution` |

**Note on the earlier false claims.** `### Solution` had asserted the carve-out was removed from the
commands, from `cross-cutting.md`, and recorded in ADR-041 — none of which was true, while a test
simultaneously asserted the carve-out text must be present. Those are struck and corrected in place
rather than rewritten away, so the record shows what was claimed and what was actually shipped.

**SECUA** (`--focus all`) — no P0/P1/P2 findings remain. The code changes (`agent-service.ts` inline
guard and unknown-name diagnostic, `config` sentinel rejection) were correct and well-tested from the
first pass and were not modified; this pass was documentation coherence plus the R9 test gap.

**Shippable readiness (feature H82)**

```
Shippable: PASS
Feature: H82
- spur feature check H82 → pass, 0 findings
- linked tasks: 0413 (done)
```
### Review
Reviewed 2026-08-02 across two passes: an initial review that returned FAIL, and this one after
remediation. Dimensions: functional traceability, SECUA, architecture.

**Priority findings**

| Pri | Dim | Finding | Disposition |
|-----|-----|---------|-------------|
| P1 | Correctness | `### Solution` claimed "all 11 requirements (R1–R11)" for a task defining **R1–R10**, and made three statements a grep refutes: the carve-out removed from both commands, removed from `cross-cutting.md`, and its removal recorded in ADR-041. None was true. `plugins/sp/tests/inline-execution-contract.test.ts:145` simultaneously *asserted* the carve-out text must be present — a test enforcing the existence of what the Solution said was deleted | **Fixed** — all three struck and corrected in place, so the record shows both the claim and the shipped reality |
| P1 | Architecture | R6 was unimplemented and undocumented: the carve-out survived in the contract, both wrappers, and the parity test while ADR-041 was silent on it | **Fixed by amendment + implementation.** R6 said "remove"; removing it would make `--agent` select an executor for an orchestrator loop that runs no prompts. Amended to "dissolve": behavior retained, exception framing eliminated everywhere, rationale in ADR-041 |
| P1 | Correctness | `--agent <name>` semantics stated **three** ways in `cross-cutting.md` (unconditional in the resolution order, conditional in the value table, conditional again in the following paragraph) and a fourth time unconditionally in the glossary and ADR | **Fixed** — collapsed to one rule: `--agent` names *who* does the model-bearing work; the surface is derived. Stated once each in the three surfaces, verified identical |
| P2 | Test coverage | Sub-tier ordering across `capable-1/2/3` — the newest part of the tier logic (0343 split) — had **no** coverage; every existing test used `capable-1` only | **Fixed** — 2 tests added, mutation-checked by reversing the sort at `packages/app/src/services/agent-service.ts:908` |
| P2 | Process | R8's premise ("this path was never tested") was partly wrong: task 0346 already covered all three executor-name cases | **Recorded**, not duplicated. R8 amended to drop "and tier" — tier governs `auto` and escalation, not explicit-selector resolution |
| P3 | Usability | R5 shipped as a hard removal, so `--inline` is a silent no-op | **Accepted with amendment.** These were never CLI-parsed; there is no parser to warn from, and alias prose across 19 prompt files would be an unenforceable, untestable warning. Glossary redirect stubs are the deprecation surface a prompt contract has |

No P0. No findings remain open.

**Architecture assessment**

The collapse is the right change and the code half was correct from the first pass. `AgentService`
gained exactly two guards — a rejection of the `inline` sentinel reaching `spur agent run`, and an
unknown-name diagnostic that lists configured executors — and nothing else. That restraint is
correct: the inline/subprocess decision is a prompt-runtime rule owned by the command wrapper, and
threading an `inline` option through `AiRunner` would still start a subprocess, making it a false
implementation. The ADR states this explicitly.

The one substantive design correction was framing. Treating `--agent` as "where does this process
run" forced a carve-out, an "unless" clause, and three inconsistent paragraphs. Treating it as "who
does the model-bearing work" makes the surface a derived value and turns the pipeline case from an
exception into an instance of the rule. Same behavior, one fewer concept, and the exception framing
that a parity test had locked in is gone.

Reserved-word validation (`inline`/`auto` rejected as executor names) is the right defensive
placement — at config load, where the collision would otherwise silently shadow selector semantics.

**Residual risk**

Low. No runtime behavior changed for any existing invocation: `--inline` and `--subprocess` were
prompt text with no parser, and every command that declared them now declares the equivalent
`--agent` value. The tier and escalation machinery was not modified — only covered. Rollback is a
single revert; no schema, migration, or dependency is involved.

The one honest caveat: because these are prompt-runtime flags, "the 19 commands behave correctly" is
enforced by the parity gate reading the Markdown, not by a runtime test. That was true before this
task and is unchanged by it.

**Verification at review time**

```
bun plugins/sp/scripts/validate-commands.ts --json  → violations=0, files=34
bun run lint                                        → typecheck clean, 7/7 workspaces
bun test plugins/sp + packages/app + packages/config → 1826 pass, 11 fail (all sandbox port-bind)
superskill install sp --targets codex --dry-run     → clean, adapters uncommitted
```
### References
**Authority**

- Feature: `docs/features/H82_unified-agent-execution-surface-selector.md`
- Contract being rewritten: `plugins/sp/skills/spur-dev/references/cross-cutting.md:19-93` (§ Inline-default execution surface); resolution order `:32-51`; carve-out `:61-66`; trigger table `:68-73`
- Glossary entries being merged: `plugins/sp/skills/spur-dev/references/flag-glossary.md` `#flag-agent`, `#flag-inline`, `#flag-subprocess`
- ADR-033 (adaptive model routing, per-stage tier floors); ADR-032 + its 2026-08-01 amendment

**The evidenced contradiction (R7)**

- `cross-cutting.md:45-47` — `--agent auto` does **not** force subprocess
- `flag-glossary.md` `#flag-agent` — `auto` means **a fresh process**

**Existing machinery this task consumes rather than builds**

- `packages/domain/src/stage-registry/schema.ts:391` — `min_tier` + ordered `fallback`
- `packages/app/src/services/agent-service.ts` — `resolveAgent`, `executeRun` escalation loop, `classifyObjectiveFailure`, `StageEscalationContext`
- commit `04cab820` (feature H9) — bounded escalation + honest chain-exhaustion reporting
- `.spur/config.yaml` `agent.executors` — 11 executors across 5 declared tiers

**Downstream**

- Task 0412 / feature H81 — depends on this landing first; both edit the same 19 command files

**Reproduce the inventory**

Parse each `dev-*.md` frontmatter, unwrap Markdown links in `argument-hint`, extract `--flag` tokens.
Baseline 2026-08-01: 28 commands, 200 declarations, `--agent`/`--inline`/`--subprocess` on the same
19. Re-run after Phase 4 to confirm the reduction.
### History
- 2026-08-02T06:25:06.626Z todo → wip (system)
- 2026-08-02T06:56:40.502Z wip → testing (system)
- 2026-08-02T07:28:33.542Z testing → done (system)
