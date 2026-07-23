---
name: task-section-editing
description: The temp-file → --section/--from-file recipe for editing task sections, when to use record instead, and which sections to fill when.
see_also:
  - spur-cli
---

# Editing task sections

Task bodies are edited section-by-section through `spur task update --section <name> --from-file
<path>`. The write is **file-wins and crash-safe** (atomic write): the named section's body is
replaced wholesale from the file you point at. There is no inline-body flag — always stage the new
body in a file first.

For **pipeline output** (`Testing` / `Review` / safety-net `Solution`), prefer `spur task record`
over hand-assembling files — it renders the matrix-compliant tables from a verify verdict for you.
Use the manual recipe below for `Plan`, `Acceptance Criteria`, hand-authored `Solution`, and any
narrative section.

## The recipe

1. **Assemble the full section body** in a temp file. The body is everything *under* the `###`
   heading — do not include the heading line itself; the CLI owns the heading.

   ```bash
   cat > /tmp/review.md <<'EOF'
   **Verdict: PASS**

   | # | Finding | Dim | Location | P | Disposition |
   |---|---------|-----|----------|---|-------------|
   | 1 | … | Correctness | src/foo.ts:42 | P2 | FIXED |
   EOF
   ```

2. **Replace the section:**

   ```bash
   spur task update 0040 --section Review --from-file /tmp/review.md
   ```

3. The whole `### Review` body is now that file's contents. To amend rather than overwrite, read
   the current body (`spur task show 0040`), edit the temp file to the full desired state, and
   replace again — there is no append mode.

`--section` **requires** `--from-file` (exit `2` otherwise). Section names match the DD-08 headings
exactly: `Background`, `Requirements`, `Acceptance Criteria`, `Q&A`, `Design`, `Plan`, `Solution`, `Root Cause`, `Testing`, `Review`, `References`, `History`, `Notes` (universal sections are `History`, `References`, `Notes`; `Root Cause` is carried by the `issue` template variant).

## `record` vs. hand-editing

`spur task record 0040 --transition testing` reads `.spur/run/0040-verdict.json` and writes both
`Testing` (per-requirement table) and `Review` (P1–P4 findings table) in the matrix-required shape,
optionally backfilling a bare `Solution` from `git diff -U0`. It never transitions to `done`.

- **Use `record`** when a verify step produced a verdict artifact — it is the pipeline's record step.
- **Use `update --section`** when you are authoring a section by hand (planning, design, narrative
  solution) or amending one `record` already wrote.

The two are interchangeable on the same section: `record` writes `Review`, a later
`update --section Review` overwrites it. Both go through the same file-wins atomic write.

## Which section, when

During a pipeline run the sections fill in roughly this order — but *what* goes in each is the
LLM's job (orchestrated by `sp:spur-dev`); this skill only owns the *mechanism*:

| Section | Filled | Holds |
| ------- | ------ | ----- |
| `Background` | at create (derived from feature `Goal` if `--feature`) | why this task exists |
| `Acceptance Criteria` | planning (present at `todo` for spec'd tasks) | the scenarios this task satisfies (matched to feature AC by title) |
| `Plan` | before `wip` | the step list |
| `Solution` | during impl (first appears at `wip`) | the approach actually taken; L3 `file:line` rule fires once it has real content |
| `Testing` | testing phase (via `record`) | what was verified and how — gated at `wip→testing` by `check` |
| `Review` | review phase (via `record`) | SECU findings + verdict — gated at `testing→done` by `check --strict-core` |

A spec'd task (`--feature` link or batch item with `background`/`requirements`) is created at `todo`
with Acceptance Criteria + Plan scaffolding present; a bare capture is created at `backlog` with
Background only.

## Status vs. section — don't conflate

`update 0040 wip` is a lifecycle transition. `update 0040 --section …` is a body edit. They are
separate invocations and mutually exclusive in one call. A typical step does the section edit first,
then the transition:

```bash
spur task update 0040 --section Plan --from-file /tmp/plan.md
spur task update 0040 wip
```

The `wip→testing` and `testing→done` transitions run a `check` guard (§7.5) — fill the gated
sections (`Testing`, `Review`, `Solution`) before attempting the transition, or it will be blocked.
