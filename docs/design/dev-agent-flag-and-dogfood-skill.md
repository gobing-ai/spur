# Design — `--agent` on critical dev-* commands + `sp:dogfood-testing` extraction

Owning task: [`0125`](../tasks/0125_add-agent-to-critical-dev-commands-extract-sp-dogfood-testin.md).
Surface index: [`04_DESIGN.md §0`](../04_DESIGN.md), operations SSOT
`plugins/sp/skills/spur-dev/references/dev-operations.md`. Feature: `F` (Planning).

## Task 0406 amendment — inline-default execution

Model-bearing `/sp:dev-*` commands expose the unified execution-surface selector
`--agent <inline|auto|name>` (ADR-041/047); `inline` is the default when the operator invokes a
command from a live coding-agent session. `--agent auto` / `--agent <name>` force `spur agent run`.
A dispatch-surface trigger (different model/agent, headless/unattended, durable run record, or
workspace/credential isolation) also forces subprocess and must be named; it overrides `inline`.
Direct `spur agent run` and workflow `agent.run` remain subprocess surfaces.

The operator selector is `--agent <inline|auto|name>`; the former `--inline`/`--subprocess` flags
and the legacy `current`/`inherit` tokens are collapsed/removed (ADR-041/047). An explicit different
agent is trigger 1. Inline provides no isolated workspace, separate run record,
independent timeout/abort boundary, or tier-selected executor. The current contract is
`plugins/sp/skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface`.

## Task 0503 amendment — interactive full-pipeline inversion

Interactive `/sp:dev-run --mode full` and sequential `/sp:dev-runall` with `--agent` omitted or
`inline` read `task-pipeline.yaml` as the SSOT and execute its model-bearing actions through their
backing skills in the host session. The driver preserves declaration-order shell actions, guards,
answer/diff artifacts, HITL behavior, and the iteration bound. It records a pipeline run link plus
`stage <id> executed inline in session <session-id>` lines in `.spur/run/<run-id>.log`.

`--agent auto`, a named executor, parallel batch mode, `spur workflow run`, and `spur agent run`
retain the subprocess surface and its timeout/trace contracts. The engine and YAML schema are
unchanged; the command/skill wrapper owns the control inversion. Driver contract:
`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`.

## Problem

Two coupled gaps in the `/sp:dev-*` surface:

1. **`--agent` inconsistency.** `dev-run`/`verify`/`unit`/`review` expose `--agent`; the model-heavy
   `dev-refine`/`dev-plan`/`dev-brainstorm` did not — the operator could not steer which agent does
   AC generation, decomposition, refine synthesis, or ideation. Worse, a baseline dogfood
   ([`2026-06-25-dev-refine-0125-baseline-dogfood.md`](../dogfood/2026-06-25-dev-refine-0125-baseline-dogfood.md))
   showed the backing skills' `spur agent run` calls were **bare** — adding the flag to commands
   alone would be theater (the skill ignores it).
2. **`dev-dogfood` fat-file debt.** `dev-dogfood.md` was the lone fat inline `sp:*` command, a
   sanctioned-but-temporary exception whose own header named the graduation path: extract to a
   backbone skill, collapse the command to a thin wrapper. The protocol had stabilized across 0109–
   0124.

## Decision

**Stream 1 — `--agent` everywhere it's missing, threaded for real.**
- Add `--agent <name|inherit|auto>` to `dev-refine`, `dev-plan`, `dev-brainstorm` (argument-hint +
  Arguments row + "Agent override" prose, copied from `dev-verify` for consistency).
- Update the operations SSOT (`dev-operations.md`) rows + detail blocks (P1 from the baseline dogfood —
  otherwise the catalog drifts from the command docs).
- **Thread it through the skills** (the anti-theater step): a canonical "Honor `--agent`" rule in
  `spur-dev/references/cross-cutting.md` (shared by both halves) + a "Honor `--agent`" note in
  `brainstorm/SKILL.md`. The rule: forward `--agent <value>` into every `spur agent run` call;
  `inherit` omits the flag (CLI default `auto`); no flag forwarded → bare call (prior behavior).
  *(Task-0125-era vocabulary: `inherit` and `current` were later collapsed into `--agent inline`
  by ADR-041 and removed as usable values by ADR-047 — see § Task 0406 amendment above.)*

**Stream 2 — extract `sp:dogfood-testing`, enhance on the way out.**
- New fat backbone skill `plugins/sp/skills/dogfood-testing/` (`SKILL.md` + `references/`), owning the
  4-phase protocol (Plan → Execute+fix → Monitor → Report).
- `dev-dogfood.md` collapses to a thin `Skill(skill="sp:dogfood-testing", args="$ARGUMENTS")` wrapper;
  the fat-file-exception note is removed.
- **Testee-scoped `--agent`** (distinct from the standard semantics): `--agent` sets the agent the
  **testee** runs under (forwarded into the testee invocation); the driver always runs in the current
  session. Documented with a worked example to prevent driver/testee confusion.
- **Report template** (`references/report-template.md`): fixed machine-parseable sections, a verdict
  rule, and findings that each carry severity + `file:line` + a **recommended action** — rich enough
  to fine-tune the testee from the report alone.
- **Monitor + ledger** (`references/monitor-ledger.md`): the live-ledger rule (write a row the instant
  a step resolves), an explicit column contract, the token/cache `~estimate` heuristic, and the
  cache-health finding rule (<50% aggregate / <40% per-step → P3).

## Why these choices

- **Skill threading, not command-only** — verified by dogfood that bare `spur agent run` ignores a
  forwarded selector; the flag is meaningless without the skill rule. (Operator: both layers.)
- **Testee-scoped `--agent` for dogfood** — dogfood is a *driver* of other testees; the only useful
  meaning of "which agent" is the testee's, not the always-current driver's.
- **Backbone skill over staying inline** — the protocol is stable and reused; extraction matches every
  other `sp:*` command (thin wrapper + fat skill) and unblocks independent iteration of the protocol.

## Idempotency / invariants

- The operations SSOT (`dev-operations.md`) stays the single source for the dev-* surface; `04 §7.8`
  points at it (count updated to 9 `Skill()`-backed + 4 inline).
- `--agent` wording is identical across the three standard commands (and matches `dev-verify`).
- `sp:dogfood-testing` is auto-discovered by directory presence — no `plugin.json` edit.

## Scope

**In:** 3 command docs (refine/plan/brainstorm); `dev-operations.md`; `cross-cutting.md`;
`brainstorm/SKILL.md`; new `dogfood-testing` skill (SKILL + 2 references); `dev-dogfood.md` collapse;
`04_DESIGN.md` (§0 row + §7.8 count).

**Out:** `--agent` on the 4 non-critical commands (gitmsg/handover/fixall/changelog); any
`app`/`domain`/`cli` TypeScript; new CLI verbs; changes to how `spur agent run` resolves agents (the
resolution already exists — we only forward the selector).

## Consequences

- The operator can now steer the agent for every model-backed dev-* operation, and the steering is
  real (threaded), not documented-but-ignored.
- `sp:dogfood-testing` becomes the reusable protocol home; future dogfood enhancements land in one
  skill instead of a fat command file.
- The enhanced report/ledger make dogfood output directly actionable for testee refinement — the
  motivating goal.

## References

- Baseline dogfood that surfaced the P1 catalog gap:
  [`2026-06-25-dev-refine-0125-baseline-dogfood.md`](../dogfood/2026-06-25-dev-refine-0125-baseline-dogfood.md).
- `plugins/sp/commands/dev-verify.md` — the canonical `--agent` block.
- `plugins/sp/skills/spur-dev/references/cross-cutting.md` §Inline-default execution surface — the threading rule.
- `plugins/sp/skills/dogfood-testing/SKILL.md` — the extracted backbone skill.
