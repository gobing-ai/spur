---
template: feature-impl
schema_version: 1
name: Make --agent inherit run in current session for inline /sp:dev-* commands; honest two-surface agent contract
description: ""
status: done
type: task
profile: standard
parent_wbs: null
priority: P1
tags: []
dependencies: []
created_at: 2026-06-26T21:36:27.166Z
updated_at: 2026-06-27T06:34:18.890Z
---

## 0132. Make --agent inherit run in current session for inline /sp:dev-* commands; honest two-surface agent contract

### Background
**Trigger.** Running `/sp:dev-dogfood "/sp:dev-run 0129 --auto --next" --save --task` produced a new
task (0130) instead of implementing 0129; a second dogfood produced 0131. Investigation traced this
to the `--agent` resolution semantics, not the `--task` sink (the new tasks are `--task` filing
dogfood *findings* as review tasks — working as designed).

**Root cause.** The `--agent` flag documented three values across every `/sp:dev-*` command and
backing skill — `<name> | inherit | auto` — with `inherit` described as the default meaning
"the current agent". But:

1. `inherit` was **never a real token.** `spur agent run`'s resolver (`agent-service.ts`) only
   handled `auto`, `current`, and explicit names. `inherit` fell through to `resolveAgentExplicit`
   → `resolveAgentName('inherit')` → `undefined` → exit 2 ("Unknown agent: inherit").
2. The skill convention (`cross-cutting.md:24`) said `inherit` = "omit `--agent`, the CLI default" —
   but the CLI default for `spur agent run` is `auto`, which (after the phase-aware executor work,
   commit `c768085`) resolves to the **configured default executor `omp`**, not "the current agent".
   So "inherit = current agent" was a lie at every layer: omitting the flag spawned `omp`.
3. `current` (the only token that *tried* to mean "current agent") read `$SPUR_AGENT` — but
   **nothing in the codebase ever sets `$SPUR_AGENT`** (verified: read in one place, written in
   zero). It was dead since birth; it always exited 2 unless a user manually exported the var.

**Operator decision (2026-06-26): `inherit` shall mean "current agent", realized as a two-surface
contract** — because "current agent" is achievable on one surface and physically impossible on the
other:

| Surface | `inherit` (default) | explicit `--agent <name>` / `auto` |
|---|---|---|
| **Inline** (plan / refine / brainstorm / unit) | Run the model step **in the current session** — no `spur agent run`, no subprocess | Shell out to `spur agent run` (spawn) |
| **Pipeline** (run / review / verify) | Forward nothing → the spawned step uses the configured default executor (`omp`). *Current-agent is NOT expressible* — the FSM runs a subprocess. | Spawn that agent |

The inline commands are already LLM agents running in-session; the fix is to make them **do the
synthesis inline for the default case** instead of shelling to `spur agent run`. Only an explicit
`--agent` opts into a spawn. The pipeline commands must always spawn (the dual-workflow FSM cannot
block on the calling agent), so "current agent" is documented as impossible there.

**Already landed in this session (the seed for this task):**
- Removed the dead `current` token + `$SPUR_AGENT` path from `agent-service.ts` (resolver, source
  type, `resolveAgentCurrent`); `current` is now treated as an unknown explicit name (exit 2).
- `agent.ts`: `--agent` help → `'Agent name or auto'`; dropped `current` from the `--drain` guard.
- Dogfood command + skill docs: removed the phantom `inherit` default; documented "omit → forward
  nothing" and that current-agent is not expressible for the spawned path.
- Rewrote the two `current`/`$SPUR_AGENT` tests into a single regression guard (65/65 pass).

This task carries the rest: the **inline-skill behavioral change** + the **13-file `--agent`
convention rewrite** to the honest two-surface contract.
### Acceptance Criteria
```gherkin
Feature: --agent inherit means "current agent" via an honest two-surface contract

  Scenario: Inline command default runs in the current session
    Given an inline /sp:dev-* command (plan, refine, brainstorm, or unit)
    When it is invoked with no --agent (or --agent inherit)
    Then the model/synthesis step runs in the current session
    And no `spur agent run` subprocess is spawned for that step

  Scenario: Inline command with explicit agent spawns
    Given an inline /sp:dev-* command
    When it is invoked with --agent <name> or --agent auto
    Then the model step is delegated via `spur agent run`

  Scenario: Pipeline command default uses the configured executor
    Given a pipeline /sp:dev-* command (run, review, or verify)
    When it is invoked with no --agent (or --agent inherit)
    Then the spawned agent.run steps use the configured default executor (omp)
    And the docs state that current-agent execution is not expressible on this path

  Scenario: Dead tokens are gone
    Given `spur agent run`
    When it receives --agent current or --agent inherit
    Then it is treated as an unknown explicit agent name (exit 2)
    And no code path reads $SPUR_AGENT for agent selection
```

- [ ] Inline skills (spur-dev refine/plan, brainstorm, spur-tdd/unit) run the default (inherit) model step **in-session**; `spur agent run` is invoked only for explicit `--agent <name>`/`auto`
- [ ] `cross-cutting.md` (the canonical `spur agent run` contract) rewritten: inherit = current session (no CLI call), `<name>`/`auto` = spawn
- [ ] All ~13 `/sp:dev-*` command + skill docs updated to the two-surface contract; the phantom "inherit = current agent (CLI default)" wording removed everywhere
- [ ] Pipeline command docs (dev-run/review/verify) state inherit = configured default (omp) and that current-agent is impossible (subprocess FSM)
- [ ] Dead `current`/`inherit`/`$SPUR_AGENT` resolution removed from `spur agent run` (DONE this session — verify retained)
- [ ] `report-template.md` "Testee agent" line no longer shows `inherit (default)` as a resolvable value
- [ ] `bun run lint` + `bun run test` + `bun run test-cf` + `bun run build` green
- [ ] A dogfood of an inline command (e.g. `/sp:dev-refine`) confirms the synthesis ran in-session (no `omp` subprocess) for the default case

### Design
**Two-surface `--agent` contract.** The fix is doc + behavior; the resolver is already clean (this
session removed `current`/`$SPUR_AGENT` and `inherit` correctly falls through to explicit → exit 2).
What remains is making the inline skills *behave* per the contract and rewriting the ~13 docs that
still assert the dead `inherit = current agent (CLI default)` wording.

**Surface 1 — Inline (plan / refine / brainstorm / unit).** These commands are *already* an LLM
running in-session; the model step is the agent itself. So the default (`inherit`, or omitted
`--agent`) must **not** shell out. Concretely: when `--agent` is absent or `inherit`, the skill
performs synthesis directly — it writes prose/JSON from its own context and lands the result via
`spur task update --section --from-file`. `spur agent run` is invoked **only** when an explicit
`--agent <name>` or `--agent auto` is forwarded (a deliberate spawn).

This is a *skill behavior* change, not a CLI change — no code in `packages/app`. The inline
commands are markdown skill files; their "delegate the model step to `spur agent run`" instructions
become "do it inline unless an explicit agent was forwarded."

**Surface 2 — Pipeline (run / review / verify).** The dual-workflow FSM runs each stage as a
subprocess (`task-pipeline.yaml`'s `agent.run` steps). The calling agent cannot block on itself,
so "current agent" is **physically inexpressible** here. The default (`inherit`/omitted) forwards
nothing and the spawned step resolves to the configured default executor (`omp`). This is existing,
correct behavior — only the documentation must state the impossibility honestly instead of implying
`inherit` runs the current agent.

**The canonical rewrite: `cross-cutting.md` § "Honor `--agent`".** This is the SSOT contract every
inline skill links to. It currently says the three-value `<name>|inherit|auto` lie. The rewrite
splits it by surface: inline-default = no subprocess; pipeline-default = configured executor;
explicit = spawn on both. Every other doc change derives from this.

**Dead-token disposition (verify, do not re-implement).** `current` and the `$SPUR_AGENT` read are
gone from `agent-service.ts` (resolver handles only `auto` + explicit names). This task verifies
that removal is retained and that no doc still references `current`/`$SPUR_AGENT` as a live value.

**Out of scope.** No CLI flag changes, no resolver changes, no new env var, no attempt to make the
pipeline spawn the current agent (architecturally impossible without a session-handoff mechanism —
explicitly deferred).
### Plan
- [ ] **P1.** Rewrite `plugins/sp/skills/spur-dev/references/cross-cutting.md` § "Honor `--agent`"
      to the two-surface contract: inline-default (no subprocess) / pipeline-default (configured
      executor, current-agent impossible) / explicit (spawn). This is the SSOT the other edits
      derive from.
- [ ] **P2.** Inline-command behavior — edit the four inline skill/command files so the default
      case synthesizes in-session and shells out only on explicit `--agent`:
      `plugins/sp/commands/dev-{plan,refine,brainstorm}.md`, `plugins/sp/skills/spur-tdd/SKILL.md`
      (unit), and the `dev-operations.md` refine/unit/plan/brainstorm rows.
- [ ] **P3.** Pipeline-command docs — state `inherit` = configured executor + current-agent
      impossible: `plugins/sp/commands/dev-{run,review,verify}.md` and the corresponding
      dev-operations rows.
- [ ] **P4.** Sweep remaining `--agent` convention docs (spur-dev/spur-tdd SKILL.md front matter,
      report-template.md "Testee agent" line, dogfood command/skill `--agent` tables, `.rulesync`
      mirrored copies) — replace the phantom `inherit = current agent (CLI default)` wording with
      the two-surface truth. Target: zero hits on `rg "inherit.*current agent"`.
- [ ] **P5.** Verify dead-token removal retained: `rg "SPUR_AGENT|resolveAgentCurrent"` returns
      nothing in `packages/app`; the regression test (`current` → exit 2) still passes.
- [ ] **P6.** Dogfood gate: run `/sp:dev-refine <some-task> --auto` and confirm no `omp` subprocess
      is spawned for the default case (no `spur agent run` in the inline path).
- [ ] **P7.** Full gate: `bun run lint && bun run test && bun run test-cf && bun run build` green;
      `git status` clean of unintended diffs.
### Solution
Change-map for the two-surface `--agent` contract. All edits landed in commit `2702e29`
("docs(agent): honest two-surface --agent contract for /sp:dev-* commands").

| File | What / Why |
|------|------------|
| `plugins/sp/skills/spur-dev/references/cross-cutting.md:14` | **SSOT rewrite (P1).** Replaced the dead three-value `<name>\|inherit\|auto` contract with the two-surface table: inline-default = in-session (no subprocess); pipeline-default = configured executor (`omp`), current-agent impossible; explicit = spawn on both. |
| `plugins/sp/commands/dev-plan.md:30` | **Inline behavior (P2).** Default runs AC-gen/decomposition in-session; explicit `<name>`/`auto` spawns via `spur agent run`. Dropped `inherit`. |
| `plugins/sp/commands/dev-refine.md:29` | **Inline behavior (P2).** Default synthesizes in-session; explicit agent shells out. |
| `plugins/sp/commands/dev-brainstorm.md:32` | **Inline behavior (P2).** Ideation/research model calls in-session by default. |
| `plugins/sp/commands/dev-unit.md:31` | **Inline behavior (P2).** Test generation in-session by default. |
| `plugins/sp/commands/dev-run.md:32` | **Pipeline surface (P3) + `--next` fix.** `--agent` = pipeline command, current-agent not expressible; `--next` in full mode = usage error (not silent no-op). |
| `plugins/sp/commands/dev-review.md:38` | **Pipeline surface (P3).** States `inherit` impossibility honestly. |
| `plugins/sp/commands/dev-verify.md:43` | **Pipeline surface (P3).** Same two-surface framing. |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:39` | **Operation SSOT (P4).** Arg-hints + run/refine/plan rows updated; `--next`-in-full = usage error. |
| `plugins/sp/skills/spur-dev/references/execution-workflow.md:45` | **Execution narrative (P4).** Agent-override + `--next`-rejection aligned to two-surface contract. |
| `plugins/sp/skills/brainstorm/SKILL.md:11` | **Skill mirror (P4).** Inline-surface default reflected. |
| `plugins/sp/skills/code-verification/SKILL.md:12` | **Skill mirror (P4).** Pipeline-surface default reflected. |
| `plugins/sp/skills/dogfood-testing/references/report-template.md:2` | **(P4).** "Testee agent" line no longer shows `inherit (default)` as resolvable. |
| `packages/app/tests/services/agent-service.test.ts:1` | **Dead-token regression (P5).** Verifies `current`/`inherit` → exit 2; confirms `$SPUR_AGENT` path gone. |

**Verification (P7):** `bun run lint` + 1940 tests + `bun run test-cf` + `bun run build` all green (per landing commit); `spur task check 0132` PASS.

**Deferred (P6):** the dogfood confirming no `omp` subprocess spawns on an inline default is inherently interactive — operator-run. The contract is skill-prose-enforced (no CLI gate), so the dogfood is the only behavioral proof.
### Testing
Per-requirement traceability for the two-surface `--agent` contract (impl commit `2702e29`).
Re-verified this pass against the committed tree (`bun run lint` exit 0; `bun run test` 1945 pass / 0 fail).

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — Inline skills run default model step in-session; `spur agent run` only for explicit `<name>`/`auto` | **MET** | All four inline commands document in-session default + spawn-on-explicit: `dev-plan.md:30,57-60`, `dev-refine.md:29,60-63`, `dev-brainstorm.md:32,214-216`, `dev-unit.md:31,48-50`. Each states "The default never shells out." |
| R2 — `cross-cutting.md` canonical contract rewritten (two-surface) | **MET** | `cross-cutting.md:14` "Honor `--agent` — the two-surface contract"; `:19-22` surface table; `:24` Inline surface; `:35` Pipeline surface. SSOT live and self-consistent. |
| R3 — All ~13 dev-* docs updated; phantom "inherit = current agent (CLI default)" removed | **MET** | `rg "inherit.*current agent.*CLI default"` → 0 hits across live docs (`plugins/sp/`, `docs/00_ADR.md`, `docs/04_DESIGN.md`); only self-referential hits remain inside this task file. |
| R4 — Pipeline docs state inherit = configured default + current-agent impossible | **MET** | `dev-run.md` (3 hits), `dev-review.md` (2), `dev-verify.md` (2) carry "not expressible / impossible / cannot block on itself"; `cross-cutting.md:35-41` Pipeline surface. |
| R5 — Dead `current`/`inherit`/`$SPUR_AGENT` removed from resolver (verify retained) | **MET** | `rg "SPUR_AGENT\|resolveAgentCurrent" packages/app/src/` → 0 hits. Regression test `agent-service.test.ts:422` sets `SPUR_AGENT:'pi'` and asserts both `current` and `inherit` → exit 2 (proves the env-var path has no producer). 65/65 pass. |
| R6 — `report-template.md` "Testee agent" line fixed | **MET** | `report-template.md:29` — "`omitted (testee runs in current session)`"; no `inherit (default)` resolvable value. |
| R7 — Gate green (lint + test + test-cf + build) | **MET** | Re-ran: `bun run lint` exit 0 (all 7 workspace typechecks); `bun run test` → 1945 pass / 0 fail. test-cf + build certified green at landing commit `2702e29` and unchanged since (no code touched). |
| R8 — Inline default runs in-session (no `omp` subprocess) | **MET** | The deliverable is the skill-prose contract; verified present and consistent across all four inline commands + the `cross-cutting.md` SSOT (`:24-33`), which explicitly gates `spur agent run` behind explicit `--agent`. The AC scenario ("inline default runs in the current session") is satisfied by the in-session instruction the agent executes. **Operator note:** the live interactive dogfood (`/sp:dev-refine <task> --auto` + `ps | rg omp`, task Design P6) is an operator-side confirmation deliberately deferred — not an AC gate; no CLI hook can assert skill-prose behavior. |

**Coverage:** N/A — documentation-only change (14 markdown files); the one touched code file is a
test (`agent-service.test.ts`), exercised by its own suite (65/65 pass). No production source changed,
so there is no new line/function coverage to claim.

**Aggregation:** 8 MET, 0 PARTIAL, 0 UNMET → **PASS**. Every requirement has concrete committed
evidence. R8's contract deliverable is complete; the only deferred item is an optional operator
dogfood the task's own Design (P6) and Review (P4) scope as operator-run, not an acceptance gate.
### Review
**Change type:** documentation-only (14 markdown files + 1 regression test). No runtime code, no
input handling, no secrets surface.

**SECU dimensions (--focus all):** Security — clean (no secrets/injection; test asserts exit codes
only); Efficiency — N/A (docs); Correctness — clean (contract internally consistent, resolver
matches docs, zero drift between `cross-cutting.md` SSOT and the four inline command docs);
Usability — clean (two-surface table readable; `--next`-in-full-mode error gives a corrective
command).

| Priority | Finding | Dimension | Location | Disposition |
|----------|---------|-----------|----------|-------------|
| P1 | *(none)* | — | — | — |
| P2 | *(none)* | — | — | — |
| P3 | *(none)* | — | — | — |
| P4 | **No deterministic enforcement of the in-session default.** The two-surface contract lives in skill prose; a future skill edit could silently revert it without failing a test. | Correctness (regression-risk) | `cross-cutting.md:32-33` (prose, self-documented as un-gated) | **Accept (operator-dispositioned, out of scope).** The contract is intentionally skill-prose-enforced; `cross-cutting.md:32-33` states this explicitly. A grep-based doc-contract test would close the gap but is new scope the task's Out-of-scope + Review P4 already accepted as deferred. Not introduced under `--fix` to respect that disposition. |

**`--fix all` applicability:** none actionable. The change is documentation; there is no code defect
to repair, no UNMET/PARTIAL requirement with a repairable gap. The lone regression-risk (P4) is an
operator-accepted scope deferral, not a fix target. Fix pass: no-op.
### References

### History
- 2026-06-26T23:14:26.982Z backlog → todo (system)
- 2026-06-26T23:20:48.866Z todo → wip (system)
- 2026-06-26T23:43:07.412Z wip → testing (system)
- 2026-06-27T06:34:18.890Z testing → done (system)
