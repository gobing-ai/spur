---
name: task-section-editing
description: The temp-file → --section/--from-file recipe for editing task sections, and which sections to fill when.
see_also:
  - spur-tasks
---

# Editing task sections

Task bodies are edited section-by-section through `spur task update --section <name> --from-file
<path>`. The write is **file-wins and crash-safe** (atomic write): the named section's body is
replaced wholesale from the file you point at. There is no inline-body flag — always stage the new
body in a file first.

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
exactly: `Background`, `Acceptance Criteria`, `Plan`, `Solution`, `Testing`, `Review`, `References`,
`History`.

## Which section, when

During a pipeline run the sections fill in roughly this order — but *what* goes in each is the
LLM's job (orchestrated by `sp:spur-dev`); this skill only owns the *mechanism*:

| Section | Filled | Holds |
| ------- | ------ | ----- |
| `Background` | at create (derived from feature `Goal` if `--feature`) | why this task exists |
| `Acceptance Criteria` | planning | the scenarios this task satisfies (matched to feature AC by title) |
| `Plan` | before `wip` | the step list; **`done` is refused while this is empty** |
| `Solution` | during impl | the approach actually taken |
| `Testing` | testing phase | what was verified and how |
| `Review` | review phase | SECU findings + verdict |

## Status vs. section — don't conflate

`update 0040 wip` is a lifecycle transition. `update 0040 --section …` is a body edit. They are
separate invocations and mutually exclusive in one call. A typical step does the section edit first,
then the transition:

```bash
spur task update 0040 --section Plan --from-file /tmp/plan.md
spur task update 0040 wip
```
