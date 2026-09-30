---
schema_version: 1
name: "dev-review contract hygiene: single target forwarding, coordinator Review ownership, triage tools, one --focus vocabulary, stale flags"
status: todo
template: feature-impl
created_at: 2026-09-30T18:12:18.743Z
updated_at: "2026-09-30T18:14:44.704Z"
feature_id: I33

ac_numbering: task-local
---

## 1022. dev-review contract hygiene: single target forwarding, coordinator Review ownership, triage tools, one --focus vocabulary, stale flags

### Background

The `/sp:dev-review` command, its coordinator agent and its three review skills disagree on arguments, flags and section ownership (review of 2026-09-30):

- `dev-review.md:37-38` dispatches `args="<wbs> $ARGUMENTS"` to `sp:functional-review` and `sp:code-improvement`; `$ARGUMENTS` already holds the target, so they receive it twice (`0962 0962 --triage`).
- The command says the coordinator `sp:super-reviewer` writes `## Review`, but it only calls three `Skill()`s inline and never dispatches the agent; the invoking session is never told it is the coordinator.
- `--triage` applies direct fixes (`dev-operations.md` §2 step 2) but `allowed-tools` is `["Bash","Read","Skill"]` — no `Edit`/`Write`.
- `--focus` has four vocabularies: `dev-review.md` (functional/SECUA/architecture), `flag-glossary.md#flag-focus` (`all|stack|dependencies|data|flows|api|security|quality|performance`), `code-verification/SKILL.md:88,488` (`all|security|efficiency|correctness|usability|architecture`), `dev-operations.md` §2 ("one SECUA dimension").
- Stale routes: `next-router/references/routing-table.md:134` routes to `/sp:dev-review <wbs> --fix blockers-first` (deprecated no-op); `super-reviewer.md` "Two modes" still cites `--next` (removed, H8); `code-verification/SKILL.md:488` lists `--fix` as a live review-mode flag.
- `super-reviewer.md` says standalone WBS review only emits output, while `dev-review.md` and `gate-checklists.md:128-136` require standalone `/sp:dev-review <wbs>` to populate `## Review`.
- The pipeline calls `/sp:dev-review ${vars.wbs} --auto` (`task-pipeline.yaml:593`) but `--auto` is not in the argument-hint; `super-reviewer` documents `--json` which the command does not declare.
- `functional-review` frontmatter declares `modes: [verify]` though it runs as a review component.

### Requirements

- **R1** — Each review skill receives the target exactly once: dispatch passes `<target> <flags-without-target>` (or `$ARGUMENTS` alone), never both.
- **R2** — `dev-review.md` states that the invoking session is the review coordinator: it merges fragments per `sp:super-reviewer` Output Format and, in WBS mode (standalone or pipeline), writes `## Review` via `spur task update <wbs> --section Review --from-file`. `super-reviewer.md` "Two modes" is aligned: WBS target → writes Review; path target → advisory output only.
- **R3** — `allowed-tools` adds `Edit` and `Write`, with the body stating they are used only by `--triage` direct fixes.
- **R4** — One `--focus` vocabulary for review: `all|functional|security|efficiency|correctness|usability|architecture` (functional → `sp:functional-review`; architecture → `sp:code-improvement` + SECUA-A; S/E/C/U → `sp:code-verification`). SSOT lives in `code-verification/SKILL.md`; `dev-review.md`, `dev-operations.md` §2 and `flag-glossary.md#flag-focus` link to it instead of restating another list.
- **R5** — No live route recommends `dev-review --fix` or `--next`: routing-table row uses `--triage`; `super-reviewer.md` drops `--next`; `code-verification` review-mode flag list drops `--fix` (kept only as the documented deprecated no-op in `dev-review.md`).
- **R6** — `--auto` is declared in the `dev-review` argument-hint, Argument Flags table and dev-operations row; `--json` is either declared on the command or removed from `super-reviewer.md` (choose declare-nothing: remove, since no consumer parses it).
- **R7** — `functional-review` frontmatter `modes` includes `review`.

### Acceptance Criteria

```gherkin
  @core
  Scenario: R7 — command, agent and skill contracts agree
    Given the dev-review command, super-reviewer agent, review skills, flag glossary and dev-operations row
    When command-flag-parity and plugin structure tests run
    Then the target is forwarded once, one --focus vocabulary is referenced, no live route uses the deprecated --fix or removed --next, and --tasks/--feature/--scope/--auto appear in the argument hint, dev-operations row and glossary
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **Coordinator = invoking session.** Dispatching the `sp:super-reviewer` agent from the command would add a subagent hop to every review and break the inline-default contract (`cross-cutting.md#inline-default-execution-surface`). The agent file stays the Output Format + rules SSOT; the command says "act as the coordinator defined in `agents/super-reviewer.md`".
- **`--focus` SSOT in `code-verification`** because it already owns SECUA; `functional` and `architecture` route to their skills. Rejected: keeping the glossary's generic `stack|dependencies|…` list for review — it names dimensions no review skill implements.
- **`--json`:** remove from `super-reviewer.md` rather than add a command flag — no caller consumes it (YAGNI).
- **Tests:** extend the existing `command-flag-parity.test.ts` dev-review assertions; no new test file.

### Plan

1. `plugins/sp/commands/dev-review.md`: fix dispatch args (R1), coordinator paragraph (R2), `allowed-tools` + note (R3), `--focus` row link (R4), add `--auto` (R6).
2. `plugins/sp/agents/super-reviewer.md`: Two modes (R2), drop `--next` (R5) and `--json` (R6).
3. `plugins/sp/skills/code-verification/SKILL.md`: `--focus` SSOT list; drop `--fix` from review-mode flags (R4/R5).
4. `plugins/sp/skills/spur-dev/references/dev-operations.md` §2 + table row; `flag-glossary.md#flag-focus` (R4/R6).
5. `plugins/sp/skills/next-router/references/routing-table.md:134` → `--triage` (R5).
6. `plugins/sp/skills/functional-review/SKILL.md` frontmatter `modes` (R7).
7. Extend `plugins/sp/tests/command-flag-parity.test.ts`; run `(cd plugins/sp && bun test tests/command-flag-parity.test.ts tests/skill-structure.test.ts)`, then `bun run spur-check`.

**Verification checks (evidence for the AC above):**

- [ ] `grep -n 'args="<wbs> \$ARGUMENTS"\|args="<path> \$ARGUMENTS"' plugins/sp/commands/dev-review.md` returns nothing.
- [ ] `grep -rn "dev-review[^\n]*--fix blockers-first" plugins/sp/skills` returns nothing.
- [ ] `grep -n -- "--next" plugins/sp/agents/super-reviewer.md` returns nothing.
- [ ] `plugins/sp/tests/command-flag-parity.test.ts` asserts `--auto` in the dev-review hint and passes.
- [ ] `bun run spur-check` is green.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `plugins/sp/commands/dev-review.md:5,18,37-38`
- `plugins/sp/agents/super-reviewer.md` (Two modes, Output Format)
- `plugins/sp/skills/code-verification/SKILL.md:88,482-488`
- `plugins/sp/skills/spur-dev/references/dev-operations.md` §2 review
- `plugins/sp/skills/spur-dev/references/flag-glossary.md` `#flag-focus`
- `plugins/sp/skills/next-router/references/routing-table.md:134`
- `plugins/sp/skills/spur-dev/references/gate-checklists.md:128-136`
- `config/workflows/task-pipeline.yaml:593`

### History

- 2026-09-30T18:14:44.704Z backlog → todo (system)

