---
name: flag-glossary
description: "Extracted sections (task 0408): the shared-flag glossary — one canonical entry per flag shared by two or more /sp:dev-* commands — and the --next chain contract that expands the --next entry. Moved verbatim from dev-operations.md; the operation catalog stays there."
see_also:
  - spur-dev
  - dev-operations
---

# Flag Glossary

The shared-flag glossary and the `--next` chain contract, extracted from `dev-operations.md` (task
0408). Every flag shared by two or more `/sp:dev-*` commands has exactly one canonical entry here;
the chain contract is the prose expansion of the `--next` entry. The operation catalog (map, backing
patterns, skill-backed, inline) remains in `dev-operations.md`.

## Flag glossary

Every flag shared by two or more commands has exactly one entry here. This is the single place a
shared flag's meaning is stated; command argument-hints and table rows cite it and must not
re-define it. The shared-flag set is derived mechanically from the 28 command argument-hints (a flag
counts as shared when it appears in two or more); flags appearing on a single command stay documented
in that command's body and are not listed here.

**Reference form (mechanically detectable).** A command file points at a glossary entry with a
markdown link whose link target is the entry's anchor — `[`--next`](#flag-next)`. The anchor is
always `#flag-<name>` where `<name>` is the flag minus its leading `--` (so `--keep-going` →
`#flag-keep-going`). The test gate (`command-flag-parity.test.ts`, task 0403) finds these references
with the regex ``\[`--<flag>`\]\(#flag-`` over each command file — **a shared flag declared without
this reference fails the build.** Prose-only citations (the flag name mentioned in a sentence but not
in the link form) do not count; the reference must be the link.

**Availability rule.** Two flags are only declared where the underlying capability already exists:
`--json` where the command already produces a structured result a script could consume; `--auto`
where the command already has at least one HITL gate. The rule forces a declaration only where the
capability exists — a command that would benefit from `--json` but produces only prose is recorded
as a follow-up, not quietly left inconsistent.

### `--agent <inline|auto|name>` — name who does the model-bearing work

**Anchor:** `#flag-agent`.

**SSOT:** the full contract — the one rule, value semantics, executor precedence chain,
`implementAgent` override, objective triggers, and surface-derivation logic — lives in
[cross-cutting.md](cross-cutting.md#inline-default-execution-surface).
The value table below is the C3a cross-file parity surface (kept in lockstep with the SSOT by
`validate-flag-contracts.ts`), not an independent restatement.

| Value                           | Who does the work                                                           | Derived surface                                                             |
| ------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `inline` (default when omitted) | Whoever is running this session (interactive) or `agent.default` (headless) | Interactive: inline (host session); headless: subprocess of `agent.default` |
| `auto`                          | Tier-resolved from the stage's `min_tier` + `fallback`                      | Subprocess                                                                  |
| `<name>`                        | That coding agent or configured executor                                    | Inline when it is the current session's agent; subprocess otherwise         |

The previous `--inline` and `--subprocess` flags (feature H82, task 0413) are collapsed into this
selector: `--inline` → `--agent inline`, `--subprocess` → `--agent auto`. Those two flags are no
longer part of the command surface; their anchors (`#flag-inline`, `#flag-subprocess`) are retained
as stubs below so external links do not dangle. Operator-layer vocabulary (task 0405): `agent` names
the concrete coding-agent tool; `executor` remains the domain-layer role and is not a command flag.
`inline` and `auto` are reserved values — config validation rejects an executor claiming either.

#### `--inline` (removed — collapsed into `--agent`)

**Anchor:** `#flag-inline` (stub retained to avoid dangling external links).

Removed in feature H82 (task 0413). `--inline` is now `--agent inline`. See
[`--agent`](#flag-agent) above and
[cross-cutting.md](cross-cutting.md#inline-default-execution-surface) for the full contract.

#### `--subprocess` (removed — collapsed into `--agent`)

**Anchor:** `#flag-subprocess` (stub retained to avoid dangling external links).

Removed in feature H82 (task 0413). `--subprocess` is now `--agent auto`. See
[`--agent`](#flag-agent) above and
[cross-cutting.md](cross-cutting.md#inline-default-execution-surface) for the full contract.

### `--next` — chain-to-completion with propagation

**Anchor:** `#flag-next`.

On success, hand the task back to `sp:next-router`, which resolves the next dispatch and re-invokes
with `--next` still set, until the work is done or a gate stops it. The flag is a **chain
to completion**, not a single step, a mode selector, or a status transition. `/sp:dev-next` (the
command) runs the next step **once**; `--next` (the flag) makes any command it is passed to **keep
going**. Neither is renamed.

**Redefinition (breaking).** Before this entry (feature H8, task 0399, 2026-07-31) `--next` carried
four incompatible meanings across seven commands: chain-ish (`dev-verify`, `dev-verifyall`), a
mode selector (`dev-run` → implement-only), a deprecated no-op (`dev-review`), and undeclared
declarations never explained (`dev-refine`, `dev-refineall`, `dev-brainstorm`). Task 0401 reconciled
all seven against this single definition. Existing `dev-run --next` invocations selecting
implement-only mode are the only genuinely breaking case; the replacement is `--mode implement`.

### `--json` — emit machine-readable output

**Anchor:** `#flag-json`.

Emit the command's result as structured JSON a script can consume, instead of the human-readable
default. Only declared where the command already produces a structured result; declaring it never
implies building a new output shape.

### `--auto` — skip objective HITL confirmations

**Anchor:** `#flag-auto`.

Skip objective HITL confirmations inside this command (feature-check, batch-create, the approve
gate). Taste gates and irreversible HITL gates (e.g. `--merge`) still pause even under `--auto`.
Only declared where the command already has at least one HITL gate the flag can skip.

### `--keep-going` — batch failure policy: skip dependents, continue independents

**Anchor:** `#flag-keep-going`.

Batch operation only (`dev-refineall`, `dev-runall`). When a task in the batch
fails, skip its in-batch dependents and continue the independent ones, instead of the default
halt-on-first-failure. Never silently retried; the failure is still reported.

### `--continue` — resume an interrupted batch from checkpoint

**Anchor:** `#flag-continue`.

Resume a batch (`dev-runall`) or task (`dev-run`) that was interrupted mid-run, picking up from the
recorded checkpoint rather than restarting. Orthogonal to `--next` (lifecycle chaining) and
`--keep-going` (failure policy): the three axes address different problems and `routing-table.md`
offers `--continue` and `--next` as competing options only when the batch was interrupted mid-run.

### `--wrap` — run the wrap hop after the main step

**Anchor:** `#flag-wrap`.

After the main step completes, run the wrap hop (learnings, metrics, doc-sync). On `dev-runall`
with `--next`, wrap runs **once for the batch** after every task reaches terminal status, mirroring
the batch-once shippable gate `dev-verifyall` uses. Without `--next`, `--wrap` is wrap-without-
chaining — the single task or batch wraps without advancing the lifecycle.

### `--force` — bypass a named guard

**Anchor:** `#flag-force`.

Bypass a specific named guard that would otherwise stop the command (e.g. a shippable check on
`dev-verify`/`dev-verifyall`). Named, not global: the command documentation states which guard is
forced. Never bypasses lifecycle status transitions or irreversible HITL gates.

### `--feature <id>` — scope the operation to a feature

**Anchor:** `#flag-feature`.

Scope the operation to all tasks under a feature id (`^[A-Z][1-9]*$`). On feature-advancing
commands (`dev-wrapall`) it also advances the feature through legal lifecycle edges with guards
honored.

### `--focus <dims>` — constrain the operation to specific dimensions

**Anchor:** `#flag-focus`.

Constrain the operation to a named subset of dimensions — review dimensions on `dev-review`/
`dev-verify`/`dev-verifyall` (`all|stack|dependencies|data|flows|api|security|quality|performance`),
a refine focus mode on `dev-refine`/`dev-refineall`, or a reconstruction lens on `dev-reverse`.
Narrowing reduces token cost; omitting runs
all dimensions.

### `--scope <path>` — limit the operation to a path

**Anchor:** `#flag-scope`.

Limit the operation to a file or directory path (`dev-arch`, `dev-debug`, `dev-fixall`,
`dev-gitmsg`, `dev-gtd`, `dev-simplify`) to bound the working set.

### `--dry-run` — print the plan without executing

**Anchor:** `#flag-dry-run`.

Resolve and print what the command would do, without dispatching or mutating state. The plan output
is the contract; divergence between `--dry-run` and the real run is a bug.

### `--tasks <selector>` — explicit task selector for a batch

**Anchor:** `#flag-tasks`.

Batch operation only (`dev-parallel`, `dev-refineall`, `dev-runall`, `dev-verifyall`). An explicit selector — WBS
list, status pseudo-list (`todo`, `wip`), `feature:<id>`, or `ready` — resolving to the set the
batch runs over. Required on `dev-parallel`, `dev-runall`, and `dev-verifyall`, where `--feature` is an optional
restrictor. On `dev-refineall` it is instead one of a required pair — supply exactly one of
`--feature` or `--tasks`.

### `--mode <kind>` — select an execution mode

**Anchor:** `#flag-mode`.

Select an execution mode: `full|implement` on `dev-run` (full pipeline vs implement-only),
`sequential|parallel` on `dev-runall` (serial vs fanned-out-independent-subset),
`fan-out|review-panel|investigation` on `dev-parallel`, and the reconstruction depth
`briefing|structure|architecture|design|full` on `dev-reverse`. Mode selection is explicit and orthogonal
to `--next`.

### `--task [<feature-id>]` — seed a task from the current result

**Anchor:** `#flag-task`.

Connect the current command's result to task work (`dev-brainstorm`, `dev-debug`, `dev-dogfood`,
`dev-find-next`). The optional value and the effect are per-command — this flag is a family, not one
behavior:

- `dev-brainstorm` `[<feature-id>]` — **creates** one task from the chosen approach, landing at
  `todo` ready for refine. Optional feature id scopes it.
- `dev-find-next` `[<feature-id>]` — after an **explicit operator confirm**, dispatches the planning
  half on the ranked winner (`/sp:dev-plan` to decompose, then `/sp:dev-refineall --depth ready` to
  freeze implement-ready). Creates no task itself; the confirm pauses regardless of `--auto`.
  Optional feature id names the target instead of offering rank 1.
- `dev-debug` `[<wbs>]` — **attaches** findings to an existing task. Optional WBS names it.
- `dev-dogfood` (no value) — **records** run outcomes against the task under test.

### `--since <ref>` — lower bound on a range

**Anchor:** `#flag-since`.

Lower bound on a range: a git ref on `dev-changelog`, or an ISO date on `dev-find-issue` and
`dev-wrapall` (filters done
tasks by `updated_at >= date`).

### `--fix <policy>` — remediation policy

**Anchor:** `#flag-fix`.

Remediation policy on verify-family commands (`dev-verify`, `dev-verifyall`):
`none|blockers-first|all`. `none` reports findings without fixing; `blockers-first` fixes only P1/P2;
`all` fixes everything found. Deprecated on `dev-review` (routes to `dev-verify --fix`).

### `--until <ref>` — upper bound on a range

**Anchor:** `#flag-until`.

Upper bound on a range: a git ref on `dev-changelog` (defaults to `HEAD`), or an ISO date on
`dev-find-issue` (defaults to now).

### `--status <s>` — filter by task status

**Anchor:** `#flag-status`.

Filter the operation by task status (`dev-wrapall` default `done`; `dev-refineall` to target a
specific status slice).

### `--skip-shippable` — skip the shippable check

**Anchor:** `#flag-skip-shippable`.

Skip the shippable guard on verify-family commands (`dev-verify`, `dev-verifyall`). Used when
verifying a task whose artifact is intentionally not yet shippable (e.g. a doc-only task).

### `--skip-design` — omit the design package

**Anchor:** `#flag-skip-design`.

Omit the design package (system-design satellite + task `### Design`) on planning commands
(`dev-plan`, `dev-idea`). The task is created without the design section; refine supplies it later.

### `--output <path>` — write the result to a path

**Anchor:** `#flag-output`.

Write the command's result to a file path (`dev-daily`, `dev-reverse`) instead of stdout.

### `--merge` — trigger branch cleanup

**Anchor:** `#flag-merge`.

Trigger branch cleanup after wrap (`dev-wrap`, `dev-wrapall`). Irreversible HITL gate — always
pauses, even under `--auto`.

### `--max-retry <n>` — bound the retry loop

**Anchor:** `#flag-max-retry`.

Bound the retry loop on fix-family commands (`dev-dogfood`, `dev-fixall`, `dev-gtd`). After `n` consecutive
failed fix attempts, stop and ask the operator rather than looping indefinitely.

### `--full` — rewrite a `--next` run as full pipeline

**Anchor:** `#flag-full`.

**Context-specific — two unrelated meanings; do not collapse them.**

- `dev-next`: rewrite a `dev-run … --next` primary dispatch into `dev-run <wbs> --mode full`
  (without `--next`). No effect on non-run routes (warning W-FULL).
- `dev-dogfood`: full report verbosity — emit all report sections rather than the summary set.

The shared spelling is historical. A rename would be the cleaner fix; until then each command's
Argument Flags row states its own meaning and this entry records that they differ.

### `--description <text>` — supply a description

**Anchor:** `#flag-description`.

Supply a description (`dev-refine` / `dev-refineall` focus description). Used when the operator
wants to inject a specific framing rather than derive it from context. `dev-idea` takes its idea as
a positional argument, not via this flag.

### `--depth <…>` — depth control (context-specific values)

**Anchor:** `#flag-depth`.

**Context-specific — two unrelated value sets; do not collapse them.** Declared on
`dev-brainstorm`, `dev-refine`, and `dev-refineall`.

**`dev-brainstorm`:** `--depth <basic|detailed|comprehensive>` — breadth vs depth of the ideation
tree (default `detailed`). Unrelated to task-section readiness.

**`dev-refine` / `dev-refineall`:** `--depth <standard|ready>` — how deep refine must take target
sections (Background, Requirements, Acceptance Criteria, Design, Plan) before SKIP/success.
Orthogonal to `--focus` (which _narrows_ domains) and to `--mode` on other commands.

| Value (refine family)             | Bar                                                                                                                                                                                | `--auto` SKIP behavior                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `standard` (default when omitted) | L3 structural completeness (not empty/placeholder; check-clean for target sections)                                                                                                | **SKIP** when no L3 findings on target sections                                                    |
| `ready`                           | **Implement-ready** freeze: another agent can implement without inventing design (frozen names/APIs or explicit "no new API", anti-patterns, file targets, handoffs, out-of-scope) | **Do not SKIP** on L3-clean alone — run the ready checklist; rewrite sections until the bar is met |

Default for refine stays `standard` so ordinary `refineall --auto` remains cheap. Use `ready` for
multi-package / multi-agent handoffs and flaky-pipeline features where a wrong implement is costly.
Full checklist: [dev-operations.md](dev-operations.md) § refine (depth ready).

### `--bdd` — use BDD scenarios as the verification lens

**Anchor:** `#flag-bdd`.

Use the task's Gherkin scenarios as the verification lens on verify-family commands (`dev-verify`,
`dev-verifyall`).

### `--approve-taste` — pre-clear all taste gates this run

**Anchor:** `#flag-approve-taste`.

Planning commands (`dev-idea`, `dev-plan`): with `--auto`, skip all remaining taste pauses this
run (idea-eval + design-approval). Sets `idea_approved=true` and `design_approved=true`. One CLI
flag sets both.

### `--worktree` — run the batch in an isolated git worktree

**Anchor:** `#flag-worktree`.

Batch commands only (`dev-refineall`, `dev-runall`, `dev-verifyall`): run the entire driver loop
inside an isolated git worktree instead of the operator's working directory. On a fully successful
batch the worktree branch is fast-forward-merged onto its base ref and removed; on any failure,
halt, or non-fast-forward base, the worktree is **retained intact** — never auto-deleted, never
auto-merged. `/sp:dev-next` does not get the flag (single step; not worth the worktree cost), and
`--worktree --mode parallel` is rejected (per-task parallel isolation stays task 0142). The full
lifecycle — dirty-tree precheck, creation, crash-safe marker, merge-or-retain, and `--continue`
re-entry — is specified in
[execution-batch.md § Worktree isolation](execution-batch.md#worktree-isolation---worktree). Portable
`git worktree` commands only; the git mechanics are reused from
[worktree-patterns.md](../../branch-workflow/references/worktree-patterns.md).

---

## `--next` chain contract

The canonical definition lives in the glossary above; this section states the chain's stop
conditions, hop bound, and reporting contract that every declaring command and the router inherit.
These are derived from the per-row `Stop / notes` column in
[routing-table.md](../../next-router/references/routing-table.md), not invented here.

**Chain owner.** `sp:next-router` is the single owner of chain progression. Given a task and
`--next`, it resolves the next dispatch, invokes it with `--next` propagated, and repeats. The chain
does **not** live in the command files — per-command "what comes after me" logic would duplicate the
routing table seven or more times. Commands reference the glossary entry and the router; they do not
describe successors.

**Stop conditions.** A chain running under `--next` halts, cleanly, when any of these is true. Each
is named so the operator can tell **which step halted the chain and why**:

| Halt cause                                                         | Who reports it                               | Report shape                                                                                   |
| ------------------------------------------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A failing gate (lint/type/test/rule)                               | The step that hit it                         | "chain halted at `<step>` — `<gate>` failed: `<one-line cause>`"                               |
| A non-PASS verdict (PARTIAL/FAIL)                                  | The verify step                              | "chain halted at `dev-verify <wbs>` — verdict `<VERDICT>`; see `.spur/run/<wbs>-verdict.json`" |
| A HITL pause (taste gate, irreversible gate, multi-candidate fork) | The step that paused                         | "chain halted at `<step>` — HITL pause (`<which>`); resume after operator input"               |
| Unmet dependencies                                                 | `dev-refine`/`dev-run` precheck or router A2 | "chain halted at `<step>` — unmet deps: `<WBS list>`"                                          |
| Terminal status (`done`, `cancelled`)                              | The router                                   | "chain complete — task `<wbs>` is `<status>`" (distinct from a halt)                           |

A chain that stops at a gate is a **normal outcome, not an error**: it reports where and why and
exits cleanly. It is distinct from a chain that stops because the task is complete — the report
wording makes the two unambiguous (one says "halted at", the other says "complete").

**Hop bound.** A single `--next` chain performs at most **8 primary hops** (router invocations). A
routing cycle, or a task whose status never converges on terminal, would otherwise loop forever.
When the bound is hit the chain stops and reports: "chain halted — hop bound (8) reached at
`<step>` without reaching terminal status; this indicates a routing cycle, not completion." The
bound is sized for the longest legitimate chain (refine → run → verify → wrap is four hops; the
extra four absorb probe short-circuits like `dev-fixall`/`dev-unit`) and is a rule the router agent
follows and reports against, not a counter in code (the router is a prompt skill, not executable).

**Flag vs command disambiguation.** `/sp:dev-next` runs the next step **once** and stops;
`--next` makes any command it is passed to **keep going** until the work is done or a gate stops
it. The two compose: `/sp:dev-next <wbs> --next` is valid but redundant (the flag makes the single
dispatch keep going, which is what re-running `/sp:dev-next` without `--next` would do one hop at
a time). Neither is renamed.

---
