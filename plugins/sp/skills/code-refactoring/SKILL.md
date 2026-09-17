---
name: code-refactoring
description: "Refactoring coordinator with a preservation contract: routes the four taste lenses (api, architect, tests, ui), normalizes findings to a shared schema and P1–P4 severities, gates applies, runs a fix ladder with revert-on-regression. Use for 'dev-refactor', 'safe refactor', 'refactor while keeping every feature'."
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  category: execution
  interactions:
    - technique
  operations:
    - refactor
  openclaw:
    emoji: "♻️"
see_also:
  - sp:taste-refactoring-api
  - sp:taste-refactoring-architect
  - sp:taste-refactoring-tests
  - sp:taste-refactoring-ui
  - sp:code-simplification
  - sp:code-review
---

# code-refactoring — the lens-routed refactoring coordinator

Own everything a cheaper executor must get right **mechanically**: routing, finding schema,
severity normalization, preservation classification, gate policy, apply loop, artifacts. The four
taste lenses keep their principles and judgments; this skill turns their prose into gated,
checkable, reversible work.

The product is **analysis first, edits second**: with the default `--fix none` the run writes two
artifacts and performs no edit at all.

Backs `/sp:dev-refactor`. Authority: `docs/design/dev-refactor-command.md` (§2 phases, §4–§8
contracts, §11 invariants).

## Inputs

| Input | Meaning | Default |
| --- | --- | --- |
| `--scope <path>` | Path bound; no edit may land outside it. | working tree (recent changes) |
| `--focus <api\|architect\|tests\|ui\|auto>` | Lens set; comma list allowed. | `auto` |
| `--fix <none\|blockers-first\|all>` | Apply policy. | `none` |
| `--check <cmd>` | Baseline and per-fix verification command. | project gate (`bun run spur-check` when present) |
| `--auto` | Skips **objective** gates only. | off |
| free-text description | Steering for the lenses (e.g. "pagination consistency"). | — |

## Stop rules (design §11 — verbatim, non-negotiable)

1. **No edit outside `--scope`; no edit before a green baseline.**
2. **`cutting` / `breaking` findings are applied only after an explicit operator `yes`.**
3. **Tests are never removed or weakened by an `auto` fix.**
4. **Every finding carries `file:line` evidence inside scope.**
5. **The command file contains no orchestration logic** — this skill owns the orchestration, the
   command stays a thin wrapper.

Violating any stop rule ends the run as a failure; do not "finish" a partial apply.

## Phase 0 — Resolve

1. Resolve `--scope` to a concrete path; list the in-scope files.
2. Resolve the lens set: if `--focus auto`, classify per
   [focus-detection.md](./references/focus-detection.md) (ordered globs, first match per file,
   union across files); otherwise use the given lens list.
3. **Report the lens set before any lens runs** (one line, per focus-detection.md).
4. Run the `--check` command for a **green baseline**. Red baseline = hard stop: write the report,
   apply nothing, end the run.

## Phase 1 — Analyze (dispatch lenses)

For each lens in the resolved set, dispatch the taste skill and collect native findings:

```text
Skill(sp:taste-refactoring-tests)      # if tests in lens set
Skill(sp:taste-refactoring-ui)         # if ui in lens set
Skill(sp:taste-refactoring-api)        # if api in lens set
Skill(sp:taste-refactoring-architect)  # if architect in lens set
```

Pass each lens the scope path and the free-text description. Read the lens's `## Spur contract`
section, then map its native findings into the shared schema
([finding-schema.md](./references/finding-schema.md)): lens-native rung is kept in `rung`,
severity is translated through the §5 map, and every finding carries a **preserved-behavior
inventory** input from the lens (endpoints / modules / test-protected behaviors / UI controls in
scope) before any proposal.

Classification rules when mapping (enforced by the structural check):

- `preservation`: does the proposal remove a user-visible feature/test/endpoint/control
  (`cutting`), change a contract or observable behavior for a consumer (`breaking`), or keep
  behavior identical (`preserving`)?
- `fix_eligibility`: `auto` only for mechanical, behavior-preserving, checkable changes;
  `confirm` when an operator answer is needed; `suggest` for report-only plans.
- A `cutting`/`breaking` finding is never below P2 and never `auto`.

## Phase 2 — Merge

1. Dedupe by `(evidence file, line span, rung)`: identical span + rung from two lenses is one
   finding — keep the higher severity, keep the first lens's `id` (renumber gaps afterward).
2. Rank P1 → P4 (then focus order tests, ui, api, architect).
3. Re-assert scope: every `evidence[].file` is inside `--scope`; drop or fail findings that are
   not (stop rule 4).

## Phase 3 — Gate

| Gate | Class | `--auto` | Headless (`--agent auto\|name`) |
| --- | --- | --- | --- |
| Confirm resolved scope + lens set | objective | skipped | skipped |
| Confirm apply batch of `auto` findings | objective | skipped | skipped |
| Each `cutting` / `breaking` finding | **taste** | **pauses** | no pause: `status: deferred`, listed as SUGGEST in the report |
| Baseline check red | hard stop | stop, report | stop, report |

- **Objective gates** ask yes/no about facts (scope, lens set, batch contents); `--auto` answers
  them from the resolved state.
- **Taste gates** — every `cutting` or `breaking` finding — **always pause for an explicit
  operator answer** in an interactive session, regardless of `--auto`. Under a headless executor
  there is no operator to ask: set `status: deferred` and list the finding as SUGGEST in the
  report. A headless run never applies a cutting/breaking finding.
- A declined taste gate marks the finding `status: rejected` (operator "no") — never silently
  dropped.

## Phase 4 — Apply (fix ladder)

Execute `--fix` per [fix-ladder.md](./references/fix-ladder.md): green baseline first, one finding
at a time, re-run `--check` after each, revert only the failed finding's own edits (reverse-apply
its hunks — never a file-level checkout; see fix-ladder.md) and mark
`reverted`. `none` skips this phase entirely (both artifacts still written).

## Phase 5 — Report

Run the structural check from [finding-schema.md](./references/finding-schema.md), then write both
artifacts:

1. `.spur/run/<run-id>-refactor-findings.json` — the bare findings array (validated schema).
2. `.spur/run/<run-id>-refactor-report.md` — containing:
   - the resolved **lens set** (and per-file counts for `auto`),
   - a **P1–P4 findings table** with `file:line`,
   - a **preservation summary** (preserving / cutting / breaking counts),
   - **applied / reverted / deferred** lists (plus rejected when taste gates declined findings).

`<run-id>` is the enclosing pipeline run id when invoked inside one, otherwise
`refactor-<yyyymmdd>-<hhmmss>`. `--fix none` still writes both artifacts.

## Cheaper executor — minimum reading

A reduced-context executor may run this skill with exactly these files:

1. this `SKILL.md` (phases, gates, stop rules),
2. `references/finding-schema.md` (fields, severity map, structural check),
3. `references/fix-ladder.md` (apply loop, revert rule),
4. `references/focus-detection.md` (globs, report-before-run),
5. each selected lens's `## Spur contract` section only.

Do not skip the structural check or the stop rules; everything else is compressible.
