# Environment-improvement lens

One mapping turns retrospective "environment" observations into concrete surface improvements
across the two live report owners: `sp:dogfood-testing` report §6 and `sp:history-anatomy`
sections 4/9. (The inspiration is an out-of-tree retrospective practice; it is deliberately not
shipped or invoked by anything in this plugin.)

**This file is the single source of truth for the seven categories and the placement rule.**
Neither report projection restates the table below; each links here as its category table
(task 0686 / feature I9; accepted design `docs/design/environment-improvement-lens.md`,
ADR-084/085). There is deliberately no `/sp:dev-retro` command, no CLI change, and no protocol
bump behind this mapping. `sp:session-review` consumes only the placement rule for supported
live-session proposals; it adds no category projection or imported-history analysis owner (ADR-089).

## Canonical categories and projections

Exactly one file (this one) enumerates these seven names. Encode them **only** in the projected
field named by each column — never as a history-anatomy `category` (that vocabulary is frozen at
`reliability | repetition | workflow | performance | coverage | telemetry | positive`).

| Retro category | History-anatomy `category` (closed) | History-anatomy `<signal>` | Dogfood class |
| --- | --- | --- | --- |
| navigation | `workflow` | `navigation` | `environment` (P3–P2) |
| automated checks | `reliability` | `automated-checks` | `environment`; action is a gate, not prose |
| coding standards | `workflow` | `coding-standards` | `environment`; owner surface is review, never implementer |
| AGENTS.md placement | `workflow` | `agents-md-placement` | `environment`; action = move to skill/reference/check |
| tool economy | `performance` | `tool-economy` | existing cache-health P3; `environment` when the tool itself is the waste |
| no-ops | `workflow` | `no-ops` | `environment`; `file:line` of the dead instruction |
| information access | `telemetry` | `information-access` | existing chained-step `~unknown` P3; `environment` when access is missing |

Dogfood class tags are optional and closed: `environment` | `testee` | `waste`. Grammar,
classification table, and fix-mode boundaries live in the owning projection:
[`report-template.md` §6](../skills/dogfood-testing/references/report-template.md).
History-anatomy key grammar and the structure gate live in
[`report-contract.md`](../skills/history-anatomy/references/report-contract.md).

## Placement rule

When an observation lands, choose a home in this order — never a new sentence in an
always-loaded steering file when a lower step fits:

1. **Automatable → propose a check.** Anything a linter, typechecker, test, script-contract
   check, or filesystem linter could catch becomes a new-or-tighter automated gate
   (`spur-check`, biome rules, bun tests), not a reminder sentence.
2. **Coding standard → the review path.** The owner surface is `sp:code-verification`,
   `sp:code-review`, or pipeline review — never the implementer skill.
3. **Always-loaded steering (`AGENTS.md` / `CLAUDE.md`) → navigation pointer only.** Detail
   moves to a skill, reference, or check; the steering file keeps at most a pointer.

## Present-don't-apply

Findings projected through this lens are **proposals**, in either owner's report. No projection
applies a change, produces a diff, or claims to have executed anything. Dogfood bounded fix-mode
may repair a failed `testee`-class step, but never mutates a finding tagged `environment`;
class — not the cited file path — decides whether bounded fix may mutate. History-anatomy stays
report-only. Accepted proposals reach the tree through operator-approved surfaces (`spur task
create` handoff, manual edit), which remain explicit human gates.

## Keep / drop boundary

Kept here because both live reports consume it: the seven names above, their projections, and
this placement rule. The active-session reviewer may apply the placement rule without copying the
table. Dropped (each needs its own operator decision): installing or invoking the
out-of-tree retro practice, a standalone retro command, `CODING_STANDARDS.md` as a file, runtime
parsing of this markdown by validators, automatic remediation of environment findings, and
folding the lens into wrap-up learnings or `.spur/context/` memory.
`plugins/sp/skills/issue-finding/` remains the legacy coexistence non-target — it gains nothing
from this mapping.
