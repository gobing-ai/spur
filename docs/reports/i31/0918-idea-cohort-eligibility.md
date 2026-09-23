# 0918 — Idea-specific cohort eligibility (INSUFFICIENT_EVIDENCE)

Task: D63 0918 (Simplify idea authoring without weakening the planning handoff) · Date: 2026-09-23 · Worktree: `spur-new-runall-d63-767a`

## Decision

**INSUFFICIENT_EVIDENCE — idea-pipeline graph left unchanged; no candidate registered.**
This is the accepted no-change outcome defined by the task Design. D63 R5 remains
unverified and is reported as such to 0921.

## Cohort (frozen 2026-09-23, main project DB `.spur/spur.db`)

Currently selected definition: `idea-pipeline` digest
`sha256:e455eab1c6cfd3c85b1acf284000bb9f1f24b6051719d404b5797a4363d7360c`
(`spur workflow show idea-pipeline --json`, registered layer,
`@gobing-ai/spur/config/workflows/idea-pipeline.yaml`).

79 total `idea-pipeline` rows in the run store:

| Class | Count | Current digest | Other digests | No digest recorded |
| --- | --- | --- | --- | --- |
| done | 15 | 1 (synthetic) | 14 | — |
| failed | 57 | 0 | 21+12 (dry) | 24 |
| paused | 2 | 0 | 1 | 1 |
| running | 5 | 0 | 5 | — |

Notes: the single "done" row at the current digest
(`09edc382-e392-41aa-bab7-51b340ec5f45`) is synthetic fixture data — epoch
timestamps ≈ 2 s and canned round durations (`discovery 200ms`, `idea-eval
123000ms`) — not a real execution; excluded. Dry-run rows are excluded as
non-real. Rows with no `definitionDigest` in run metadata are unattributable
and excluded per the 0913 evidence rules.

## Eligibility floor evaluation

| Criterion (task Design) | Required | Observed | Result |
| --- | --- | --- | --- |
| Real terminal idea runs | ≥ 5 | 0 at current digest (1 synthetic done) | FAIL |
| Mapped action coverage | ≥ 80% | not evaluable (n = 0) | FAIL (moot) |
| Successful new-feature planning runs with feature-create and AC stages timed separately | ≥ 3 | 0 (stage timing exists only on older digests / unattributable rows) | FAIL |

Older-digest terminals are explicitly NOT pooled (refine Q&A 2026-09-23).

## Smallest real-run collection needed to re-evaluate

Run `idea-pipeline` end-to-end (inline or engine mode, recorded consistently) on
**at least 3 real new-feature intents** at the current digest, reaching terminal
`done` with `feature-create` and `ac-generate` stage durations captured, plus
**at least 1 further terminal run** of any class at the same digest (≥ 5 terminal
rows total, ≥ 80% mapped action coverage after 0913-style mapping). Then re-run
this floor check before any graph edit or D62 candidate registration.

## Disposition

- No edit to `config/workflows/idea-pipeline.yaml` (graph, artifacts, three-attempt cap, CLI write boundary and taste gates all unchanged).
- No candidate registered in the D62 registry; no deadline opened (registration precedes graph edit only for eligible cohorts).
- No standing parallel idea workflow exists or was created.
- Known unknowns: timing/tokens/cost benefit of the single-planner-call candidate remain unknown — never assumed zero or beneficial.
- 0921 consumes this disposition: D63 R5 (idea authoring consolidation) is **still unverified**.
