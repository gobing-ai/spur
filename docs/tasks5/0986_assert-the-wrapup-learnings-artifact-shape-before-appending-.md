---
schema_version: 1
name: Assert the wrapup learnings artifact shape before appending it to memory
status: backlog
template: feature-impl
created_at: 2026-09-27T07:21:49.963Z
updated_at: "2026-09-27T07:21:57.271Z"
feature_id: D62

---

## 0986. Assert the wrapup learnings artifact shape before appending it to memory

### Background

Found in the `/sp-dev-wrap 0966 --auto --agent inline --merge` run (`adec4790`).

**Symptom.** `.spur/run/adec4790-…-wrapup-learnings.md` — the wrapup learnings artifact — contained
two lines of the doc-sync agent's *narration* instead of its answer:

```text
Single task WBS `0966`. Let me read the task, the constitution, and the current state of the docs that need drift repair.
The task was run on a worktree branch. Let me find the task file and read the current docs to assess drift.
```

`learnings-append` (a `shell` step) appended that artifact verbatim to the tracked
`.spur/memory/learnings.md`, so the narration was staged into the corpus before the invoking surface
reviewed and hand-repaired it.

**Root cause.** The `doc-sync` `agent.run` declares
`answerFile: .spur/run/${vars.__runId}-wrapup-learnings.md` and the same path as `expectFile`
(`config/workflows/wrapup-pipeline.yaml`, doc-sync block). `expectFile` asserts the file EXISTS and
nothing about its shape, so a stream-of-thought capture satisfies the post-condition. The pipeline's
own comment one step earlier already names this class — "a clean exit that missed its declared
answerFile/expectFile post-condition" — and 0871 built the violation→repair edge for it, but the
learnings capture is not covered by that predicate.

**Evidence.** `.spur/run/adec4790-5b61-456c-95e8-f01addeef35d-wrapup-learnings.md` (2 narration lines);
`adec4790` run record `learnings-append/shell` → `.spur/memory/learnings.md`; the committed
`chore(wrap): record 0966 wrap-up metrics and learnings` (0f92bdd0c) whose message records the repair.

### Requirements

- [ ] R1. The wrapup learnings artifact carries a minimal shape contract (a dated task heading and at
  least one authored bullet), asserted before it is consumed.
- [ ] R2. An artifact that misses the shape is treated as the declared contract violation and routes
  to the existing violation/repair edge — it is not appended.
- [ ] R3. `learnings-append` never appends a preamble-only artifact to `.spur/memory/learnings.md`;
  the tracked memory file is unchanged on a shape failure.
- [ ] R4. A well-formed artifact appends exactly once, byte-for-byte, and the run log distinguishes the
  shape failure from an executor failure.

### Acceptance Criteria

- [ ] AC1 — R1 — The shape contract is asserted for the learnings artifact (req: R1)
- [ ] AC2 — R2 — A narration-only fixture routes to the violation/repair edge (req: R2)
- [ ] AC3 — R3 — `.spur/memory/learnings.md` is untouched on a shape failure (req: R3)
- [ ] AC4 — R4 — A well-formed artifact still appends exactly once (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Two candidate seats, both better than prompt prose:

1. **Contract predicate on the doc-sync `agent.run` step** — reuse the same "declared post-condition"
   predicate shape the pipeline already has for a missed `answerFile`/`expectFile` (0871's repair
   edge), extended from existence to a minimal shape (a dated `## … — <wbs>` heading plus one bullet).
2. **Guard inside `learnings-append`** — the shell step resolves the artifact and the script refuses
   to append when the shape is absent, writing the failure into the run record.

The predicate belongs in the contract layer, not in the agent prompt: a prompt cannot make its own
output a post-condition, which is exactly how this slipped through. Keep the shape check deliberately
weak (structure, not content) so it cannot reject a legitimate short learnings entry, and route the
failure through the violation edge so the run reports it instead of committing narration.

### Plan

- [ ] Read the wrapup-pipeline `doc-sync` / `learnings-append` / `repair` states and the 0871 repair
  edge predicate; confirm where a shape predicate can sit without re-dispatching the stage.
- [ ] Implement the shape predicate and wire it to the violation/repair edge.
- [ ] Fixtures: a narration-only artifact (must not append; routes to the edge) and a well-formed
  artifact (appends once).
- [ ] Verify against a real wrap run on a `done` task and confirm the run log distinguishes the shape
  failure from an executor failure.
- [ ] Gate: `bun run spur-check` plus the workflow contract checks.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
