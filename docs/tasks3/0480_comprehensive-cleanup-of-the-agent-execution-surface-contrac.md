---
template: meta
schema_version: 1
name: "Comprehensive cleanup of the --agent execution-surface contract: collapse duplicated definitions to one SSOT and purge ADR-041/046-era stale"
description: ""
status: done
type: meta
profile: standard
feature_id: H1
parent_wbs: null
priority: P1
tags: ["meta"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-08T04:29:03.555Z"
updated_at: "2026-08-09T01:34:47.996Z"
---

## 0480. Comprehensive cleanup of the --agent execution-surface contract: collapse duplicated definitions to one SSOT and purge ADR-041/046-era stale

### Background
The `--agent` execution-surface contract has been re-decided four times — ADR-041 (single
`--agent` selector, `--inline`/`--subprocess` collapsed, H82/0413), ADR-046 (`inline` rejected on
workflow-driven commands, 0434), ADR-047 (supersedes 046: omit and `inline` identical, headless
resolves to `agent.default`, H83) — plus the removal of the env-backed `current` / `inherit` tokens.
Each round updated *some* of the surfaces that state the contract and left the rest behind.

The cost is not theoretical. Over several sessions the same question — "why did my task run on omp
when I invoked it from agy?" — was re-derived from scratch, and the answers disagreed because the
documents disagree. One shipped reference states the opposite of the code
(`execution-batch.md:223` claims `--agent auto` "resolves the current runtime to its canonical
name"; `AgentService.resolveAgentAuto` does no runtime detection at all). Another documents a token
that now exits 2 (`docs/help/cmd_agent.md` still describes `current` reading an env var).

**Root cause: there is no single source of truth for `--agent` semantics.** The value table and its
resolution rules are restated in at least eight places — `cross-cutting.md`, `flag-glossary.md`,
`execution-workflow.md`, `dev-operations.md` (~10 separate restatements), `docs/help/cmd_agent.md`,
`docs/help/cmd_workflow.md`, three ADR entries, and per-command flag rows across **62** command
documents. Nothing mechanically keeps them consistent, so drift is the default outcome of any
future change, and the next ADR round will reproduce this exact task.

A second, sharper instance of the same disorder: **host-agent detection already exists and is
simultaneously declared impossible.** `plugins/sp/hooks/context-session-start.ts:18-24` implements
`resolveAgentHint()` over `SPUR_AGENT` / `CLAUDE_CODE_ENTRYPOINT` / `TERM_PROGRAM` /
`SPUR_DEFAULT_AGENT`, and `plugins/sp/hooks/pi/guard-extension.ts` duplicates the same candidate
chain — while `packages/app/tests/services/agent-service.test.ts:646-656` records that
`--agent current` was deleted because "nothing sets `SPUR_AGENT`". Two layers of the same repo
reached opposite conclusions about whether the calling agent can be identified.

This task is cleanup and consolidation only. It does **not** change `--agent` behavior; the
behavioral question (should headless `inline` resolve to the calling agent rather than
`agent.default`?) is deliberately deferred to a successor task so the cleanup can land without an
ADR amendment blocking it.
### Requirements
- [x] **R1 — One SSOT for the `--agent` value table.** Designate
      `plugins/sp/skills/spur-dev/references/cross-cutting.md` § Inline-default execution surface as
      the single normative definition of `--agent` values and their derived surfaces. Every other
      prose restatement — `flag-glossary.md`, `execution-workflow.md`, `dev-operations.md`,
      `docs/help/cmd_agent.md`, `docs/help/cmd_workflow.md`, skill files — becomes a one-line
      pointer to that anchor instead of a paraphrase. Measurable: exactly one file states the value
      table; a grep for the table's distinguishing phrases returns one definition plus links.

- [x] **R2 — Delete the false `--agent auto` claim.** `execution-batch.md:223` states that
      `--agent auto` "resolves the current runtime to its canonical name before merging."
      `AgentService.resolveAgentAuto` (`packages/app/src/services/agent-service.ts:860-889`)
      resolves stage `model_policy` → `agent.default` → tier priority, and performs no runtime
      detection. Correct the sentence to match the code. Measurable: no shipped document claims
      `auto` detects the calling agent.

- [x] **R3 — Purge dead tokens from documentation.** `current` and `inherit` are legacy, superseded
      by `inline`, and now resolve as unknown executor names (exit 2 —
      `packages/app/tests/services/agent-service.test.ts:646-656`). Remove or explicitly mark them
      as removed in `docs/help/cmd_agent.md` and
      `docs/help/how_to_use_spur_for_daily_software_development.md`. Do not resurrect either token,
      and do not introduce a new synonym (`self`, `same`) for the same meaning. Measurable: no
      document presents `current` or `inherit` as a usable value.

- [x] **R4 — Consolidate duplicated host-agent detection.** `resolveAgentHint()` exists twice
      (`plugins/sp/hooks/context-session-start.ts:18-24` and the inlined candidate chain in
      `plugins/sp/hooks/pi/guard-extension.ts`). Extract one shared helper and have both call it.
      Record in the code that this helper is the only host-agent identification path, so a future
      change cannot again conclude the capability is absent. Measurable: one definition of the
      candidate chain; both hooks consume it.

- [x] **R5 — Reconcile the ADR chain.** ADR-041 and ADR-046 remain readable but must be
      unambiguously marked superseded at the point of every surviving cross-reference, and ADR-047
      must be the only entry a reader lands on for current semantics. Audit each ADR-041 / ADR-046
      citation outside `docs/00_ADR.md` and repoint or annotate it. Measurable: no non-ADR document
      cites a superseded ADR as current authority.

- [x] **R6 — Document `implementAgent` or remove it.** `config/workflows/task-pipeline.yaml:63`
      defines `implementAgent` (default `"omp"`), which the implement stage consumes via
      `${vars.implementAgent}` (`:169`). It appears in **no** skill or command document, so
      `--agent <name>` — which maps only to `vars.agent` — silently leaves the implement hop on the
      pinned default. Either document it in the `--agent` SSOT with its override syntax, or make
      `--agent` set both vars. Measurable: an operator redirecting the pipeline with one documented
      mechanism moves the implement stage too.

- [x] **R7 — Correct the `agent.default` attribution.** Documents and prior analyses attribute the
      pipeline's executor to `.spur/config.yaml` `agent.default`. The pipeline actually pins
      `agent: "omp"` at `config/workflows/task-pipeline.yaml:59`, which overrides the configured
      default (`omp-zai-volc`). State the real precedence — `--agent` / explicit `--vars` → pinned
      workflow var → `agent.default` → tier priority — once, in the SSOT. Measurable: the precedence
      chain appears in one place and names the pinned var.

- [x] **R8 — Parity gate for the `--agent` contract.** Extend the existing cross-surface flag parity
      gate (`plugins/sp/scripts/validate-flag-contracts.ts`, already enforcing glossary
      declaring-commands equality) to fail when a document restates the `--agent` value table
      instead of linking to the SSOT anchor. Without a mechanical check, R1 decays on the next ADR.
      Measurable: adding a paraphrased value table to any reference fails `bun test plugins/sp/tests/`.
### Acceptance Criteria
```gherkin
Feature: Comprehensive cleanup of the --agent execution-surface contract

  Scenario: R1 One document defines the value table
    Given the sp plugin references and docs/help
    When I search for the --agent value table and its resolution rules
    Then exactly one file states them normatively
    And every other mention is a link to that anchor, not a paraphrase

  Scenario: R2 No document claims auto detects the calling agent
    Given AgentService.resolveAgentAuto performs no runtime detection
    When I read every shipped description of --agent auto
    Then each describes stage model_policy, then agent.default, then tier priority
    And none claims auto resolves the current runtime

  Scenario: R3 Dead tokens are not presented as usable
    Given current and inherit resolve as unknown executor names and exit 2
    When I read docs/help/cmd_agent.md and the daily-development guide
    Then neither presents current or inherit as a usable --agent value
    And no new synonym for "the calling agent" has been introduced

  Scenario: R4 Host-agent detection has one definition
    Given resolveAgentHint and an inlined copy of its candidate chain exist in two hooks
    When the hooks are inspected after cleanup
    Then one shared helper defines the candidate chain
    And both hooks call it
    And the code records it as the only host-agent identification path

  Scenario: R5 Superseded ADRs are never cited as current authority
    Given ADR-041 and ADR-046 are superseded by ADR-047
    When I inspect every citation of them outside docs/00_ADR.md
    Then each is repointed to ADR-047 or annotated as superseded

  Scenario: R6 One documented mechanism redirects every pipeline stage
    Given task-pipeline.yaml defines both agent and implementAgent
    When an operator redirects the pipeline using the documented mechanism
    Then the implement stage runs under the requested executor
    And the mechanism is described in the SSOT

  Scenario: R7 The executor precedence chain is stated once and correctly
    Given the pipeline pins agent at task-pipeline.yaml:59
    And .spur/config.yaml sets a different agent.default
    When I read the SSOT
    Then it names the pinned workflow var ahead of agent.default in precedence
    And no document attributes the pipeline's executor solely to agent.default

  Scenario: R8 A reintroduced paraphrase fails the gate
    Given the parity gate has been extended to guard the --agent SSOT
    When a paraphrased --agent value table is added to any reference file
    Then bun test plugins/sp/tests/ fails and names the offending file
    And removing the paraphrase restores a green suite

  Scenario: R9 Behavior is unchanged by this cleanup
    Given this task is documentation and consolidation only
    When the full test suite runs before and after
    Then --agent resolution behavior is identical
    And no ADR amendment was required to land the change
```
### Q&A
**Q: Why not just fix the wrong sentences and move on?**
A: That is what the last three rounds did, and this task exists because of it. Eight-plus surfaces
restate the same contract with no mechanical link between them, so any correction fixes the copy
the author happened to open. R1 (one SSOT) plus R8 (a gate that fails on re-paraphrase) is the only
combination that stops the cycle; without R8, R1 decays at the next ADR.

**Q: Should `--agent current` be revived, or a `--agent self` added?**
A: Neither. `current` is legacy vocabulary already superseded by `inline` — the surviving token for
"the agent running this session" — and it was additionally dead because nothing produced
`SPUR_AGENT`. Adding `self` would introduce a third word for a meaning `inline` already owns and
recreate the token that was deleted. If headless `inline` should resolve to the calling agent, that
is a change to what `inline` *means*, not a new value. See the next question.

**Q: Then does this task change what headless `inline` resolves to?**
A: No — deliberately. Today ADR-047 mandates omit/`inline` → `agent.default` on headless surfaces.
Changing that to "subprocess of the calling agent" is a genuine behavioral improvement, but it needs
an ADR-047 amendment plus the identity-propagation producer, and coupling it to this cleanup would
block the cleanup behind a decision. R9 pins behavior as unchanged; the behavioral change is a
successor task that becomes cheap *because* the contract will then live in one place.

**Q: R4 consolidates hook helpers — isn't that unrelated to a documentation cleanup?**
A: It is the same defect in code form. The repo simultaneously implements host-agent detection
(two copies, in hooks) and records that the capability does not exist (in the agent-service test
rationale). That contradiction is what let a whole analysis round conclude the feature was
unimplementable. Consolidating it and naming it the single detection path is what prevents the
next round from re-deriving the same wrong answer.

**Q: Which feature owns this, and why not H83?**
A: H83 owns ADR-047 and "unified `--agent inline`", so it is the decision's owner — but H83, H82,
H9 and H6 are all `done`, and linking a live task to a terminal feature trips the
`L4.feature-terminal` gate. Reopening a shipped feature is a corpus state change with reporting
blast radius and was not worth it here, because the *work* is mostly in H1's territory: five of the
eight drift surfaces (`cross-cutting.md`, `flag-glossary.md`, `execution-workflow.md`,
`dev-operations.md`, `execution-batch.md`) live under `plugins/sp/skills/spur-dev/`, which H1 owns,
and sibling findings 0478 and 0479 are already H1. Filed under H1; the ADR authority stays H83 and
is cited throughout. If the operator prefers the decision-owner framing, re-parent with
`spur feature update H83 active` + `spur task update 0480 --feature H83`.

**Q: What is explicitly out of scope?**
A: Any change to `--agent` resolution behavior; any ADR amendment; introducing new flag values;
touching the stage-registry `model_policy` cost routing (ADR-033), which `auto` correctly owns and
which must keep working exactly as-is.
### Design
#### Drift inventory (measured 2026-08-08)

| Surface | Restates the `--agent` contract? | Disposition |
|---|---|---|
| `plugins/sp/skills/spur-dev/references/cross-cutting.md` § Inline-default execution surface | Yes — value table + one rule + triggers | **Becomes the SSOT** |
| `plugins/sp/skills/spur-dev/references/flag-glossary.md` § `--agent` | Yes — duplicate value table | Link to SSOT |
| `plugins/sp/skills/spur-dev/references/execution-workflow.md` | Yes — precedence + `inline` merge rules | Link to SSOT |
| `plugins/sp/skills/spur-dev/references/dev-operations.md` | Yes — ~10 separate restatements in per-command Inputs | Link to SSOT |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:223` | Yes — **and contradicts the code** | Correct + link (R2) |
| `docs/help/cmd_agent.md` | Yes — plus dead `current` token | Correct + link (R3) |
| `docs/help/cmd_workflow.md` | Partial — `agent.default` injection | Link to SSOT |
| `docs/00_ADR.md` ADR-041 / ADR-046 / ADR-047 | Decision record (legitimate) | Mark supersession at citations (R5) |
| 62 × `plugins/sp/commands/*.md` | Per-command flag rows | Keep the row; drop paraphrased semantics |

#### The contradiction pair (R2, R4)

| Claim | Where | Reality |
|---|---|---|
| "`--agent auto` resolves the current runtime to its canonical name" | `execution-batch.md:223` | `resolveAgentAuto` (`agent-service.ts:860-889`) does stage `model_policy` → `agent.default` → tier priority. No runtime detection. |
| "nothing sets `SPUR_AGENT`" (rationale for deleting `current`) | `agent-service.test.ts:646-656` | `resolveAgentHint()` (`context-session-start.ts:18-24`) reads `SPUR_AGENT`, `CLAUDE_CODE_ENTRYPOINT`, `TERM_PROGRAM`, `SPUR_DEFAULT_AGENT`; `pi/guard-extension.ts` duplicates the chain. |

Both directions of the same question are answered wrongly, in opposite directions, in the same
repository. That is the strongest evidence that the problem is structural rather than a set of
individual typos.

#### Executor precedence (R7) — the correct chain

```
--agent / explicit --vars
  → pinned workflow var   (task-pipeline.yaml:59 agent: "omp"; :63 implementAgent: "omp")
  → agent.default         (.spur/config.yaml:32 → omp-zai-volc)
  → tier priority
```

The pin at `:59` carries its own rationale in-comment ("so a broken/misconfigured agent on the box
can't silently capture the run") and is intentional — it must be documented, not removed.

#### Why R8 is not optional

R1 without a gate is a one-time tidy. `validate-flag-contracts.ts` already enforces exact
glossary declaring-commands equality across surfaces, so the mechanism and its test harness exist;
extending it to reject a re-paraphrased `--agent` value table is incremental, not new
infrastructure. This is the same reasoning `corpus-check` embodies — a rule nothing re-validates
degrades silently.

#### Out of scope

No `--agent` behavior change, no ADR amendment, no new flag values, no change to stage-registry
`model_policy` routing. The behavioral question (headless `inline` → calling agent) is a successor
task; this cleanup is its precondition, not its vehicle.
### Plan
- [x] **P1 — Fix the two factual errors first.** Correct `execution-batch.md:223` (R2) and the dead
      `current` / `inherit` documentation (R3). These are standalone and unblock nothing, so they
      land immediately and stop the misinformation.
- [x] **P2 — Establish the SSOT.** Confirm `cross-cutting.md` § Inline-default execution surface is
      complete and correct, adding the precedence chain (R7) and `implementAgent` (R6). (R1)
- [x] **P3 — Collapse the restatements.** Replace paraphrases in `flag-glossary.md`,
      `execution-workflow.md`, `dev-operations.md`, `docs/help/cmd_agent.md`,
      `docs/help/cmd_workflow.md` with pointers to the SSOT anchor. (R1)
- [x] **P4 — Consolidate host-agent detection.** Extract one shared `resolveAgentHint` helper;
      repoint both hooks; annotate it as the single detection path. (R4)
- [x] **P5 — Reconcile the ADR chain.** Audit ADR-041 / ADR-046 citations outside `docs/00_ADR.md`;
      repoint or annotate. (R5)
- [x] **P6 — Extend the parity gate.** Fail the suite when a paraphrased `--agent` value table
      reappears outside the SSOT. (R8)
- [x] **P7 — Prove behavior is unchanged.** Full suite before/after; confirm identical `--agent`
      resolution. (R9)
- [x] **P8 — Gate.** `bun run autofix && bun run lint`; `bun test plugins/sp/tests/`;
      `spur task check 0480`.
### Solution
**Documented deviations from `### Design`** (recorded by the 2026-08-08 `--force` verify re-audit;
the implement step recorded none).

**D1 — R7 precedence chain: the Design had it backwards.** `### Design` § Executor precedence and
the R7 requirement text both state `--agent` → **pinned workflow var** → `agent.default` → tier
priority, and the Background asserts the `config/workflows/task-pipeline.yaml:59` pin "overrides the configured
default". The code says the opposite. `WorkflowService.run` spreads the config-derived agent var
*before* caller vars (`packages/app/src/services/workflow-service.ts:485`), and
`resolveDefaultAgentVar` (`:1060-1071`) returns `{}` when the caller already set `agent`, otherwise
injects `agent.default`, otherwise leaves the YAML literal standing. So the real chain is:

1. `--agent` / explicit `--vars`
2. `agent.default` from `.spur/config.yaml` (currently `omp-dsv4-flash-volc`)
3. YAML literal `agent: "omp"` in the pipeline file — last resort, not an override

The SSOT (`plugins/sp/skills/spur-dev/references/cross-cutting.md:111-127`) states the verified chain, not the Design's. R7's *measurable*
("the precedence chain appears in one place and names the pinned var") is satisfied either way — the
pin is named as step 3. The Design section is left as-authored for provenance; this note is the
correction of record.

**D2 — R1 is a gate-locked parity pair, not literally one file.** R1 asks that "exactly one file
states the value table." Two do: `plugins/sp/skills/spur-dev/references/cross-cutting.md:38-42` (the SSOT) and `plugins/sp/skills/spur-dev/references/flag-glossary.md:48-52`.
The second is retained deliberately as the C3a parity surface — `validate-flag-contracts.ts` fails
the suite if the two tables disagree row-for-row, and `plugins/sp/skills/spur-dev/references/flag-glossary.md:44-46` disclaims normative
authority in-file ("a parity surface … not an independent restatement"). The C4 gate encodes the
exemption at `plugins/sp/scripts/validate-flag-contracts.ts:606`. Divergence is mechanically impossible, which is R1's
actual purpose; the literal one-file reading was traded for keeping C3a's three-way check alive.

**D3 — R6 took the "document it" branch; task 0483 R2 later landed the other one. RESOLVED.**
R6 permits either documenting `implementAgent` in the SSOT or making `--agent` set both vars. 0480
documented it (`plugins/sp/skills/spur-dev/references/cross-cutting.md:129-145`) and froze behavior per R9. During this task's verify
re-audit the tree briefly stated *both* answers, because 0483 R2 had updated `execution-batch.md` and
`task-pipeline.yaml` but not yet the SSOT. That is now closed: 0483 R2 landed the both-keys
forwarding rule on every surface, so `--agent X` reaches the implement hop and the SSOT,
`execution-batch.md` §3.2, `execution-workflow.md` and the pipeline YAML all state one answer.
Verified: `rg 'except implement'` outside `docs/tasks3/**` → no hits;
`bun run plugins/sp/scripts/validate-flag-contracts.ts` → *All 64 contract surfaces agree*.
R6's measurable is satisfied literally as well as in spirit.

**Coverage gap this exposes (R8).** While that contradiction was live, the full `plugins/sp` suite
passed 516/516 on it. R8's C4 gate matches the *value table's* structural signature only, so a prose
contract claim ("`--agent` does / does not reach implement") can diverge between the SSOT and a
derived surface with no gate firing. R8 as scoped is satisfied; extending the gate to prose contract
claims is follow-up work, not a defect of this task.

**Repairs applied during the verify re-audit** (`--fix all`):

- **14 dangling SSOT anchors.** Every pointer written by P3 used
  `cross-cutting.md#inline-default-execution-surface-ssot-for---agent` — the slug of a heading that
  was never created (the heading stayed `## Inline-default execution surface`). The links dropped the
  reader at the top of the file, so R1's "every other mention is a link to that anchor" was false at
  ship time. Repointed to the real anchor across `dev-operations.md` (9), `execution-workflow.md`,
  `flag-glossary.md`, `docs/help/cmd_agent.md`, `docs/help/cmd_workflow.md`, and
  `docs/help/how_to_use_dev_slash_commands_for_daily_software_development.md`.
- **New C5 gate — SSOT anchor resolution** (`plugins/sp/scripts/validate-flag-contracts.ts:698`,
  `headingAnchors`/`headingSlug` at `:684-694`). R8's C4 guards paraphrase but not link validity, and
  every existing assertion used `.includes('cross-cutting.md#inline-default-execution-surface')`,
  which a *wrong longer* anchor satisfies as a prefix — that is precisely why 14 broken pointers
  passed a green suite. C5 resolves each `cross-cutting.md#<anchor>` against the SSOT's real headings
  across references, `docs/help`, and command files. 8 tests, including a live-tree assertion.
- **`plugins/sp/skills/spur-dev/references/execution-batch.md:223` second factual error.** The R2 fix corrected the `auto` clause but left
  the same line claiming omission resolves to "the configured default executor (`omp`)" — `omp` is
  the YAML literal, and `agent.default` (`omp-dsv4-flash-volc`) outranks it. Replaced the restatement
  with a link to the SSOT; that link survives inside 0483's subsequent edit to the same row.

A same-run edit correcting the `config/workflows/task-pipeline.yaml:60` comment was **superseded** by task 0483's
concurrent rewrite of the same lines; the current comment is 0483's, and reconciling it with the SSOT
is tracked as D3 above rather than re-applied here.

**Change map** (implement step + surviving verify repairs), first changed line per file:

| Change (`file:line`) |
|----------------------|
| `plugins/sp/hooks/agent-hint.ts:28` |
| `plugins/sp/hooks/context-session-start.ts:17` |
| `plugins/sp/hooks/pi/guard-extension.ts:26` |
| `plugins/sp/scripts/validate-flag-contracts.ts:16` |
| `plugins/sp/scripts/validate-flag-contracts.ts:606` |
| `plugins/sp/scripts/validate-flag-contracts.ts:698` |
| `plugins/sp/tests/flag-contract-parity.test.ts:24` |
| `plugins/sp/tests/flag-contract-parity.test.ts:508` |
| `plugins/sp/skills/spur-dev/references/cross-cutting.md:21` |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:223` |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:84` |
| `plugins/sp/skills/spur-dev/references/execution-workflow.md:125` |
| `plugins/sp/skills/spur-dev/references/flag-glossary.md:44` |
| `docs/help/cmd_agent.md:50` |
| `docs/help/cmd_workflow.md:80` |
| `docs/help/how_to_use_dev_slash_commands_for_daily_software_development.md:385` |
### Testing
**Verify re-audit 2026-08-08** (`--force --fix all --focus all`). Independent re-run; every
`file:line` below was re-read at the cited lines this run. Supersedes the prior pipeline verdict,
whose R1 evidence row was inaccurate (see R1). **Verdict: PASS** — AC R6 was PARTIAL on the first
pass of this audit and was resolved by task 0483 R2; re-verified below.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 — One SSOT for the value table | MET | SSOT declared `plugins/sp/skills/spur-dev/references/cross-cutting.md:21`; table `:38-42`. **14 dangling anchors found and repaired this run** (see Solution) — links now resolve to `## Inline-default execution surface` (`plugins/sp/skills/spur-dev/references/cross-cutting.md:19`). Two files state the table (`plugins/sp/skills/spur-dev/references/flag-glossary.md:48-52` is the gate-locked C3a parity surface, exempt at `plugins/sp/scripts/validate-flag-contracts.ts:606`) — deviation D2. |
| R2 — Delete the false `auto` claim | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:223` no longer claims runtime detection; `resolveAgentAuto` (`packages/app/src/services/agent-service.ts:923-946`) does stage `model_policy` → `config.default` → `resolveAgentPriority`, no runtime detection. A second error on the same line (`omp` named as "the configured default") was found and repaired this run. |
| R3 — Purge dead tokens | MET | `rg -- '--agent (current\|inherit)'` over `docs/help/cmd_agent.md`, `cmd_workflow.md`, `how_to_use_spur_for_daily_software_development.md` → 0 hits. No `self`/`same` synonym introduced (sole repo hit is this task's Q&A rejecting it). |
| R4 — Consolidate host-agent detection | MET | One definition: `plugins/sp/hooks/agent-hint.ts:28` (`resolveAgentHint`), header `:1-15` names it "the **only** host-agent detection path" and forbids duplication. Both hooks consume it: `plugins/sp/hooks/context-session-start.ts:17,140-141`; `pi/guard-extension.ts:26,222-223`. `ExtensionAPI` import intact at `plugins/sp/hooks/pi/guard-extension.ts:25`. |
| R5 — Reconcile the ADR chain | MET | No non-ADR document cites ADR-041/046 as *current* authority; every surviving citation is supersession-annotated: `packages/app/src/services/agent-service.ts:843`, `packages/app/tests/services/agent-service.test.ts:1894`, `docs/design/dev-agent-flag-and-dogfood-skill.md:49`, `plugins/sp/scripts/validate-flag-contracts.ts:13` ("ADR-041 legacy"), `H83_*.md:15,21,41`. |
| R6 — Document `implementAgent` | MET | Documented in the SSOT at `plugins/sp/skills/spur-dev/references/cross-cutting.md:129-145`. R6's *other* branch ("make `--agent` set both vars") was subsequently landed by **task 0483 R2**, so the measurable is now literally satisfied too: `--agent X` reaches the implement hop. Re-verified this run — `cross-cutting.md` (SSOT), `execution-batch.md` §3.2, `plugins/sp/skills/spur-dev/references/execution-workflow.md:121-127` and `task-pipeline.yaml` vars comment all state the both-keys rule; `validate-flag-contracts.ts` → **all 64 contract surfaces agree**. |
| R7 — Precedence chain stated once | MET | `plugins/sp/skills/spur-dev/references/cross-cutting.md:111-127` states `--agent`/`--vars` → `agent.default` → YAML literal, and names the pin. Verified against code: `packages/app/src/services/workflow-service.ts:485` spreads config vars before caller vars; `resolveDefaultAgentVar` `:1060-1071`. This **contradicts the task's own `### Design`**, which had the ordering backwards — deviation D1. |
| R8 — Parity gate | MET | `checkAgentSsotIntegrity` `plugins/sp/scripts/validate-flag-contracts.ts:617`, exemptions `:606`, wired into `validate()`. Mutation-proven this run (see AC R8). Gate covers the value table only, not prose contract claims — boundary recorded in Solution. |
| R9 — Behavior unchanged | MET | `bun test packages/app/tests/services/agent-service.test.ts packages/app/tests/workflow/ packages/app/tests/services/workflow-service.test.ts` → **452 pass, 0 fail**. No behavioral source change; `agent-hint.ts` is a hooks-layer extraction, `validate-flag-contracts.ts` is a gate script. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R1 One document defines the value table | MET | static | `plugins/sp/skills/spur-dev/references/cross-cutting.md:21` normative claim; all pointers resolve after this run's anchor repair. Second stater `plugins/sp/skills/spur-dev/references/flag-glossary.md:48-52` disclaims normative authority in-file (`:44-46`) and is gate-locked by C3a. |
| R2 No document claims auto detects the calling agent | MET | static | `plugins/sp/skills/spur-dev/references/execution-batch.md:223` re-read; matches `packages/app/src/services/agent-service.ts:923-946`. |
| R3 Dead tokens are not presented as usable | MET | command | `rg` over `docs/help/**` → 0 hits for `current`/`inherit` as `--agent` values; 0 hits for `--agent self\|same`. |
| R4 Host-agent detection has one definition | MET | static | `plugins/sp/hooks/agent-hint.ts:28` sole definition; consumed at `plugins/sp/hooks/context-session-start.ts:17` and `plugins/sp/hooks/pi/guard-extension.ts:26`. |
| R5 Superseded ADRs never cited as current authority | MET | command | `rg 'ADR-041\|ADR-046' --glob '!docs/00_ADR.md'` — every hit annotated as superseded/legacy. |
| R6 One documented mechanism redirects every pipeline stage | MET | command | Contradiction resolved by 0483 R2. `rg 'except implement\|does NOT redirect'` outside `docs/tasks3/**` → **no hits**; `bun run plugins/sp/scripts/validate-flag-contracts.ts` → *All 64 contract surfaces agree across all claims*. One mechanism (`--agent`) now moves every hop including implement. |
| R7 Precedence chain stated once and correctly | MET | static | `plugins/sp/skills/spur-dev/references/cross-cutting.md:111-127` vs `packages/app/src/services/workflow-service.ts:485,1060-1071` — chain matches the code exactly. |
| R8 A reintroduced paraphrase fails the gate | MET | command | Mutation check run this turn: appended a paraphrased 3-value table to `execution-workflow.md` → `bun test plugins/sp/tests/` **1 fail**, message `"execution-workflow.md restates the --agent value table instead of linking to the SSOT anchor."`; removed it → **516 pass, 0 fail**. |
| R9 Behavior is unchanged by this cleanup | MET | test | 452 pass / 0 fail across agent-service + workflow + workflow-service. No ADR amendment required. |

**AC R6 closure.** The first pass of this audit found the SSOT and two derived surfaces stating
opposite answers on whether `--agent` reaches the implement hop, and left it with 0483 R2 rather than
editing the SSOT under a concurrent session. 0483 R2 has since landed the both-keys forwarding rule
on every surface. Re-verified here rather than taken on report: all four surfaces agree, and the
mechanical contract gate passes across all 64 surfaces. Deviation **D3** in `## Solution` is
superseded by that outcome — `--agent` no longer skips implement.

**Gates run this turn**

- `bun run lint` — clean (biome 623 files; typecheck 7/7 workspaces exit 0)
- `bun test plugins/sp/tests/` — **516 pass, 0 fail** (508 prior + 8 new C5 tests)
- `bun test packages/app/tests/services/agent-service.test.ts packages/app/tests/workflow/ packages/app/tests/services/workflow-service.test.ts` — **452 pass, 0 fail**
- `spur workflow validate config/workflows/task-pipeline.yaml` — `workflow valid: task-pipeline`, exit 0

Coverage: N/A for the documentation surfaces; `validate-flag-contracts.ts` measured at 100.00% funcs / 99.82% lines in the sp suite run above.
### Review
**Review mode:** sp:super-reviewer (WBS) — multi-dimensional: functional traceability + SECUA + architecture.
**Verdict: PASS — 9/9 requirements MET after 2 review fixes applied.**

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P3 | Functional (R4) | `plugins/sp/hooks/pi/guard-extension.ts:25` | Host-agent detection consolidation dropped the `ExtensionAPI` type import the exported default function depends on. **Fixed**: `import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'` restored, Biome import order corrected. |
| P3 | Functional (R6) | `plugins/sp/skills/spur-dev/references/cross-cutting.md:142` · `docs/04_DESIGN.md:1077` | `implementAgent` fallback wording was inaccurate — it resolves to its own YAML-literal default (`'omp'`), independent of `agent`/`agent.default`. **Fixed**: corrected to state `--agent` does NOT redirect the implement hop. |
| P4 | — | — | No remaining P1–P2 findings; verify verdict PASS (9/9 MET). SECUA clean (no new attack surface), architecture sound (SSOT + C3a/C4 gates self-enforcing). |
### References
- `docs/00_ADR.md` — ADR-041 (single `--agent` selector, H82/0413), ADR-046 (superseded; `inline`
  rejected on workflow-driven commands, 0434), ADR-047 (current authority: omit ≡ `inline`,
  headless → `agent.default`, H83).
- `plugins/sp/skills/spur-dev/references/cross-cutting.md:19-68` — § Inline-default execution
  surface; the one rule, value table, and objective triggers. Designated SSOT (R1).
- `plugins/sp/skills/spur-dev/references/execution-batch.md:223` — the false `--agent auto` claim (R2).
- `packages/app/src/services/agent-service.ts:833-889` — `resolveAgent` / `resolveAgentAuto`; the
  authoritative resolution order, and the absence of any runtime detection.
- `packages/app/tests/services/agent-service.test.ts:646-656` — `current` / `inherit` recorded as
  dead tokens (exit 2) and the "nothing sets `SPUR_AGENT`" rationale (R3, R4).
- `plugins/sp/hooks/context-session-start.ts:18-24` — `resolveAgentHint()`, the host-agent detection
  that does exist (R4).
- `plugins/sp/hooks/pi/guard-extension.ts` — duplicated candidate chain (R4).
- `config/workflows/task-pipeline.yaml:59,63,169` — pinned `agent` and `implementAgent` vars and the
  implement stage that consumes the latter (R6, R7).
- `.spur/config.yaml:32` — `agent.default: omp-zai-volc`, overridden in practice by the pin (R7).
- `plugins/sp/scripts/validate-flag-contracts.ts` — existing cross-surface parity gate to extend (R8).
- `docs/help/cmd_agent.md`, `docs/help/how_to_use_spur_for_daily_software_development.md` — dead-token
  documentation (R3).
- Related: task 0478 (pipeline bottlenecks — `implementAgent` gap surfaced there), task 0479
  (verification-loop gate holes). Neither overlaps this task's scope.
### History
- 2026-08-08T17:10:49.544Z todo → wip (system)
- 2026-08-08T19:37:11.697Z wip → testing (system)
- 2026-08-08T19:37:18.136Z testing → done (system)
### Notes

**Why this is filed as cleanup rather than folded into 0478**

Task 0478 owns concrete pipeline defects found in one run (size gate, verify answer format,
duplicate typecheck). This task owns a structural property of the documentation and code: the
`--agent` contract has no single owner, so every ADR round leaves partial updates. Folding them
together would hide a systemic finding inside a run-specific one, and 0478 is already scoped and
ready to implement.

**Measured drift, 2026-08-08**

- 8+ files state `--agent` semantics normatively; `dev-operations.md` alone restates the sentence
  ~10 times across per-command Inputs.
- 62 command documents carry an `--agent` row.
- 3 ADR entries, two of them superseded, all still cited outside `docs/00_ADR.md`.
- 1 shipped reference contradicts the implementation outright (`execution-batch.md:223`).
- 1 capability (host-agent detection) implemented twice in hooks and declared absent in a service
  test rationale.

**Decisions taken during authoring**

- **No new flag value.** `current` and `inherit` are legacy superseded by `inline`; `self` was
  considered and rejected for the same reason. If the calling agent should be resolvable on a
  headless surface, that is a change to `inline`'s meaning, requiring an ADR-047 amendment and the
  identity-propagation producer — a successor task, not this one.
- **Behavior frozen (R9).** This task must be landable without an ADR amendment. Coupling cleanup
  to a behavioral decision is how the previous rounds stalled.
- **The pin stays.** `task-pipeline.yaml:59` documents its own rationale; R7 documents the pin
  rather than removing it.

