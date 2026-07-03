---
name: glossary
description: "Extracted section: sp's own vocabulary — canonical terms with Avoid lists. Owns TERM DEFINITIONS only; process rules stay in cross-cutting.md (see the split note below)."
see_also:
  - spur-dev
---

# sp Glossary

This is the single physical copy of sp's plugin-internal vocabulary — one canonical term per
concept, each with an **Avoid:** list of near-synonyms that must not be used interchangeably.
Every other skill body collapses its own re-explanation of these terms to the bare word and
links here instead of repeating the definition.

**Split from `cross-cutting.md`:** this file owns **term definitions** (what a word means).
`cross-cutting.md` owns **process rules** (how writes happen, what the Iron Laws are, what
`--auto` does). A term used inside a process rule is defined here once; the rule itself stays
in `cross-cutting.md`. Neither file restates the other's content.

## Terms

**spine** — the thin orchestration skill (`sp:spur-dev`) that drives the planning→execution
lifecycle by running gates and dispatching competency skills; it contains no domain logic of
its own.
Avoid: *orchestrator* (ambiguous with `sp:super-coder`, the batch orchestrator agent),
*controller*, *coordinator*.

**competency** — a deep, functionally-scoped skill (`sp:sys-architecture`,
`sp:spec-decomposition`, `sp:code-implementation`, `sp:code-testing`, `sp:code-verification`)
that owns one unit of work end-to-end. The spine dispatches to a competency; a competency never
dispatches back to the spine.
Avoid: *module* (reserved for the deep-module design vocabulary, see `sys-architecture`),
*plugin*, *sub-skill*.

**facade** — a skill that exposes CLI-verb usage for a `spur` noun (`sp:spur-cli`) without
owning any lifecycle logic. One reference file per noun; the facade is a lookup surface, not a
workflow driver.
Avoid: *wrapper* (reserved for thin command docs — see **command wrapper** below), *adapter*
(reserved for the deep-module design vocabulary).

**corpus** — the validated set of task and feature files under `docs/tasks2/` and
`docs/features/`, mutated only through `spur task` / `spur feature` CLI verbs.
Avoid: *database*, *store*, *repo` (ambiguous with the git repository).

**gate** — a deterministic CLI check that must exit clean before a lifecycle transition
proceeds (`spur feature check`, `task-batch.schema.json` validation, `spur task check`,
`spur rule run`). A gate either passes or blocks; there is no partial pass.
Avoid: *checkpoint* (reserved for the Session Checkpoint Convention — a resumability artifact,
not a pass/fail gate), *validation* (the generic verb; *gate* is the noun for the specific
enforcement point), *step* (a gate is a property of a step, not a step itself).

**verdict** — the structured PASS/PARTIAL/FAIL outcome of a verify step, recorded as an
artifact (`.spur/run/<wbs>-verdict.json`) and consumed by `spur task record`.
Avoid: *result* (too generic — a verdict has a fixed three-value contract), *report` (reserved
for narrative output like the dogfood report or batch report).

**noun/verb** — the two-part CLI grammar: a noun names the domain object (`task`, `feature`,
`rule`, `workflow`, `agent`, `message`, `team`), a verb names the operation on it (`create`,
`update`, `check`, `run`, `list`). The `sp:spur-cli` facade organizes its references one file
per noun.
Avoid: *command* alone (ambiguous with a `/sp:dev-*` slash command, which is a different
grammar layer).

**half** (planning / execution) — the two lifecycle phases `sp:spur-dev` drives: **planning**
(vague description → validated, decomposed feature) and **execution** (one task → done through
the pipeline). The two halves share this skill today but are designed to split cleanly; new
logic belongs in exactly one half.
Avoid: *phase* alone (the pipeline-phase table in `cross-cutting.md` uses *phase* for a
different, finer-grained partition — ideation/design/execution/wrap-up — so *half* stays
reserved for this specific planning/execution split).

**HITL** (human-in-the-loop) — a workflow state that pauses for explicit operator approval
before continuing (`hitl.confirm`). A HITL gate is never auto-dismissed by the engine; `--auto`
can only route *around* one whose objective precondition is already met (see the `--auto`
routing contract in `cross-cutting.md`).
Avoid: *prompt* (reserved for LLM input text), *interrupt* (implies an exception, not a planned
pause point).

**WBS** (work-breakdown-structure ID) — the four-digit task identifier (e.g. `0187`) that
names a task file and its position in the corpus. WBS IDs are assigned once and never reused.
Avoid: *task ID* alone (acceptable in prose, but *WBS* is the canonical term when precision
matters — e.g. distinguishing a task WBS from a feature ID).

**section-write contract** — the rule that every corpus write goes through
`spur task update <wbs> --section <name> --from-file <path>` with body-only content (no
duplicate heading, no same-level sub-headings), gated by the section-status matrix for the
task's current status. Fully specified in `cross-cutting.md`; this glossary only names the term.
Avoid: *section edit* alone (too generic — *contract* signals the CLI-gated, matrix-checked
nature of the write).

## See also

- [cross-cutting.md](cross-cutting.md) — the process rules that use these terms (Iron Laws,
  Auto-Decision Principles, the section-editing workflow, pipeline phase table).
- [spur-dev/SKILL.md](../SKILL.md) — the spine that dispatches by these terms.
