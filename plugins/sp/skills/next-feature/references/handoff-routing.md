# Handoff routing — featurechange handoff, next-router seam, conditional dispatch

## The seam with `/sp:dev-next` (next-router)

- `/sp:dev-find-next` answers **"which X"**; `/sp:dev-next` answers **"what step for chosen X"**.
- next-router's routing-table §0 step 1c declares the target-omitted case out of v1 — this command
  fills exactly that hole and no more. Never re-implement within-target routing (TABLE A/B).
- When the operator picks a winner from the ranked report, the printed handoff line is:
  `/sp:dev-next <feature-id>`.

## The handoff to `/sp:dev-featurechange` (feature F31)

Defect proposals follow the 0495 Artifact C boundary, traced end to end:

| Step | Actor | Mutates `docs/features`? |
| --- | --- | --- |
| 1. Detect + emit proposal rows | this skill | No |
| 2. Handoff | printed inline in the report (report reading of OQ1) | No |
| 3. `--dry-run` | `/sp:dev-featurechange` | No |
| 4. Confirm | operator | — |
| 5. `--apply` (`spur feature move`) | `/sp:dev-featurechange` only | **Yes — sole writer** |

There is no path from this skill to a mutated tree that bypasses step 4. Proposal rows are printed
inline in the default report; writing them into `docs/plans/feature-tree-restructure-map.md` as new
rows is allowed (that file is the handoff artifact, not corpus) but never required.

## OQ1 — conditional dispatch (deferred, not implemented)

OQ1 (dispatch vs report) is an open operator question on map H12. **This skill ships the report
reading only.** The dispatch reading — a `--next` flag chaining into `/sp:dev-next` on the winner —
is documented here as the extension point and intentionally not built:

- Report reading (shipped): print the ranked frontier + gated list + proposals; stop.
- Dispatch reading (deferred): after the report, invoke `/sp:dev-next <winner>` — requires next-router
  argv shaping and chain semantics owned by `sp:next-router`. Do not hand-roll it here.

## Where outputs go

| Output | Destination |
| --- | --- |
| Ranked frontier + gated list | stdout report (markdown table; `--json` envelope if the flag is passed) |
| Defect proposals | stdout; optionally appended to `docs/plans/feature-tree-restructure-map.md` |
| "Sync first" block | top of report when the dry-run proposes frontier changes |
| Winner handoff | printed `/sp:dev-next <id>` hint — operator runs it |
