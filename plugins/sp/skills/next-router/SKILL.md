---
name: next-router
description: "Status→command router backing /sp:dev-next — resolve a task WBS or feature frontier, load corpus signals, look up TABLE A/B/C, dispatch exactly one existing /sp:dev-* command or stop with an exact dev-next: message. Never a second pipeline FSM. Triggers: \"what's next\", \"advance this task\", \"which dev command\"."
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  protocol: "sp:next-router@1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  interactions:
    - router
  modes:
    - dry-run
    - dispatch
  openclaw:
    emoji: "🧭"
---

# Next Router — Status→Command Dispatcher

`sp:next-router` is the backing skill for `/sp:dev-next`. It inspects corpus status (plus light
gates when a row calls for them), selects the **single best existing** `/sp:dev-*` command (or
documented `spur` verb) for a task WBS or feature frontier, optionally executes it, and on clean
success lets that command's own `--next` chain continue — **without inventing a second pipeline
FSM**.

The routing tables (TABLE A task / TABLE B feature / TABLE C light gates), the frontier-selection
algorithm, the HITL stop matrix, chain semantics, and the explicit non-routes are the SSOT in
**[references/routing-table.md](references/routing-table.md)**. This file owns the driver protocol:
parse → resolve → signals → lookup → shape argv → dispatch or stop.

## When to use

- Unsure which `/sp:dev-*` command to run for a task or feature.
- Want to complete the current lifecycle step and advance when gates are clean.
- Hygiene forks (unit gap, lint red, rule findings) need a deterministic first hop.

Do **not** use this skill to: reimplement `task-pipeline.yaml`, bypass lifecycle guards, batch a
feature (that is `/sp:dev-runall` — a deliberate aperture), or pick among multi-candidate forks
silently (that is a HITL stop).

## Inputs

| Input | Semantics |
|-------|-----------|
| `target` | Task WBS (digits), task `.md` path, or feature id (`^[A-Z][1-9]*$`). Required for dispatch; omit → stop **U1** (usage). |
| `--dry-run` | Print the resolved plan (**P1**) and do not dispatch. |
| `--once` | Strip `--next` from the shaped child argv so only the current step runs; no router re-entry. |
| `--auto` | Forward into dispatched children that support it. **Never** breaks multi-candidate HITL ties. |
| `--agent <inline\|auto\|name>` | Execution-surface selector forwarded into the dispatched child when that child documents `--agent`. Router defaults inline; a named escalation trigger overrides `--agent inline`. Omit → forward nothing. |
| `--full` | When the primary route is `dev-run … --next`, substitute `dev-run <wbs> --mode full` (no `--next`). No effect on non-run routes → warning **W-FULL**. |

## Protocol (deterministic)

1. **Parse** — split `$ARGUMENTS` into target + flags. Unknown flags are not silently dropped:
   note them in the plan line (P1) or stop U1 if no valid target remains.
2. **Resolve target** —
   - digits / known WBS → task mode;
   - task `.md` path → resolve WBS via `spur task resolve` / path handling;
   - feature id → TABLE B: run the **frontier algorithm** (routing-table §2 B3) over
     `spur task list --json` + per-dep `spur task show <dep> --json`; no frontier → feature-level
     row (B4–B8), usually a stop.
   - unresolvable → stop **U2**; omitted → stop **U1**.
3. **Load signals (corpus first)** — `spur task show <wbs> --json` (status, `dependencies[]`),
   dep statuses, `spur feature show <id> --json` when invoked by feature. Light gates only when
   the matched row sets `probe=yes`.
4. **Table lookup** — TABLE A (task) or TABLE B (feature-level). Apply TABLE C **sequential
   short-circuit** probes in order C1→C5; first hit replaces the dispatch.
5. **Cardinality** — 0 candidates → stop **U3**; 1 → continue; >1 → HITL stop **U-HITL**
   (decision-brief; `--auto` does not pick a winner).
6. **Shape child argv** — apply `--once` (strip `--next`), `--full` (run-chain rewrite only),
   `--auto` / `--agent` / execution-surface forwarding per the Inputs table and
   [cross-cutting.md](../spur-dev/references/cross-cutting.md#inline-default-execution-surface).
7. **`--dry-run`** → print plan block **P1**; exit success without dispatching.
8. **Dispatch** — print **P2**, invoke the child:
   - **Claude Code:** `Skill(skill="sp:spur-dev", args="…")` (or the documented backing
     skill/command protocol for refine/run/verify/unit/wrap/wrapall/handover/fixall) with the
     shaped argv.
   - On child guard failure / review-pending → stop **U-GUARD** (leave task status untouched).
   - On success → print **P3**. The child's own `--next` chain (when left intact) continues on
     its own; the router never double-chains.

**Step budget:** one router invocation performs **at most one primary dispatch** (+ whatever that
command's own `--next` chain does). Never self-loop `/sp:dev-next`.

## Chain progression contract (`--next`)

The router is the single owner of `--next` chain progression. The definition of [`--next`](../spur-dev/references/flag-glossary.md#flag-next)
and the full chain contract (stop conditions, hop bound, reporting) live in the glossary; this
section states the router's side: how a chain propagates, how it stops, and how it reports.

**Single dispatch per invocation.** One router invocation performs **at most one primary dispatch**
(already stated above as the step budget). Chain continuation is the child's `--next` re-entering
the router, not the router self-looping. The router never double-chains.

**Propagation.** When the dispatched child completes successfully and its argv carried `--next`
(i.e. `--once` was not applied), the child re-invokes `/sp:dev-next` with the same target and
`--next` still set. The router resolves the next dispatch from the **new** task status (which may
have advanced) and dispatches again. This is the chain: router → child → router → child, until a
stop condition.

**Hop bound: 8 primary dispatches per `--next` chain.** A chain running under `--next` performs at
most **8 primary dispatches**. Each router re-entry is one hop. When the bound is reached without a
terminal task status, the router stops and emits message **W-CHAIN-BOUND** (below): "chain halted —
hop bound (8) reached at `<step>` without terminal status; this indicates a routing cycle, not
completion." The bound is sized for the longest legitimate chain (refine → run → verify → wrap is
four hops; the remaining four absorb probe short-circuits like `dev-fixall`/`dev-unit`).

**Stop conditions.** A chain halts cleanly when a gate fails, the verify verdict is non-PASS, a
HITL pause fires (taste gate, irreversible gate, multi-candidate fork), dependencies are unmet, or
the task reaches terminal status. The stop is a normal outcome, not an error: the report names
which step halted and why ("chain halted at `<step>` — `<cause>`"), distinct from the completion
report ("chain complete — task `<wbs>` is `<status>`"). The per-row `Stop / notes` column in
[routing-table.md](references/routing-table.md) §5 names the stop condition for each route.

**Flag vs command.** `/sp:dev-next` (the command) runs the next step **once** and stops; `--next`
(the flag) makes any command it is passed to **keep going**. `/sp:dev-next <wbs> --next` is valid
but redundant. See the glossary entry for the disambiguation in full.

| Id | Fires when | Kind |
|----|-----------|------|
| W-CHAIN-BOUND | `--next` chain hit the 8-dispatch hop bound without terminal status | warning — stop (routing-cycle suspected) |

## Operator messages

**[references/messages.md](references/messages.md)** (exact templates, prefixed `dev-next:`). The router fires them by id:

| Id | Fires when | Kind |
|----|-----------|------|
| U1 | no target | stop — usage |
| U2 | target unresolvable | stop |
| U3 | no route (table miss / cancelled) | stop |
| U4 | todo with open dependencies (A2) | stop |
| U-HITL | multi-candidate fork | HITL stop — decision-brief, then dispatch only after answer |
| U-GUARD | child guard / review-pending failure | stop — recovery line |
| P1 | `--dry-run` | plan block |
| P2 | dispatch start | info |
| P3 | success | info — re-run hint |
| W-FULL | `--full` on a non-run route | warning — continue |

## Non-routes (summary — full table in routing-table §6)

Never: reimplement the pipeline inside the router; default `todo` to `--mode full`; infer targets
from git/chat; auto-`--merge` on wrap; auto-author rules; use `dev-runall` as the feature default;
bypass lifecycle guards (`--no-lifecycle`) to force progress.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "Two candidates are both fine — pick the higher-priority one." | Multi-candidate is a HITL stop (routing-table §4). A silent pick hides a real fork from the operator; print the decision-brief. |
| "The task is todo, so run the full pipeline to be safe." | Full mode is not the v1 default (non-route). A3 dispatches the `--next` chain link; `--full` exists for the explicit override. |
| "I can loop dev-next until the task is done." | Step budget is one dispatch per invocation. Self-looping makes token cost unbounded; the operator re-invokes after non-chain dispatches. |
| "The guard failed but the fix is obvious — force it through." | Guards are the product (non-route: no lifecycle bypass). Stop U-GUARD, surface the finding, let the operator resolve. |

## Red Flags

- Dispatching more than one primary command in a single invocation.
- `--auto` used to choose among HITL candidates.
- A route that is not in TABLE A/B/C (invented dispatch targets).
- `--once` honored by merely skipping the re-invoke while leaving `--next` in the child argv.
- Omitting the `dev-next:` prefix on stop/plan messages.

## Platform Notes

- **Claude Code:** invoked via `/sp:dev-next` → `Skill(skill="sp:next-router", args="$ARGUMENTS")`;
  dispatch children via `Skill()`; HITL via `AskUserQuestion` with the decision-brief options.
- **Codex / OpenClaw / OpenCode / Antigravity:** no `Skill()` — read this file +
  `references/routing-table.md` as the procedure SSOT; corpus signals via
  `spur task show|list --json`, `spur feature show|list --json`, `spur task check --json`;
  dispatch by invoking the target command protocol (or its backing skill) with forwarded flags;
  message literals in `plugins/sp/commands/dev-next.md`; HITL via the platform's decision-brief
  equivalent (`spur-dev/references/decision-brief.md`). Never reimplement refine/run/verify inside
  the router.

## See also

- **[references/routing-table.md](references/routing-table.md)** — TABLE A/B/C SSOT + algorithm.
- **`sp:spur-dev`** — the spine that owns the lifecycle the router dispatches into.
- **`sp:dogfood-testing`** — peer meta-tool (also outside the numbered dev-operations map).
- **`plugins/sp/skills/spur-dev/references/decision-brief.md`** — HITL brief format.
