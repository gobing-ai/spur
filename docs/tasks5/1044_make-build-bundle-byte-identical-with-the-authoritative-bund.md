---
schema_version: 1
name: Make build:bundle byte-identical with the authoritative bundle-plugin-lib test bundler
status: todo
template: feature-impl
created_at: 2026-10-01T21:54:16.882Z
updated_at: "2026-10-01T21:57:41.142Z"
feature_id: A33

---

## 1044. Make build:bundle byte-identical with the authoritative bundle-plugin-lib test bundler

### Background

Session evidence (2026-10-01, E71 batch): the source-change → gate cycle failed on
`inline application bundle regenerates deterministically with only runtime builtin imports` twice
(pre-rebase and post-rebase), each costing a regen cycle plus a fixup commit (`309f17792` "fix(E71-1027): regenerate inline-run bundle in rebase resolution form"). Root cause (hypothesis with
confirming repro: change any bundled source, run `bun run spur-check`): `scripts/commands/
bundle-plugin-lib.test.ts` regenerates `plugins/sp/lib/inline-run.generated.mjs` with its own
Bun.build invocations and is authoritative, while the `build:bundle` path can emit different bytes
— bundle-plugin-lib.ts contains three separate Bun.build sites (:124, :265, :355) and a comment
(:30) noting Bun.build cwd-relative entrypoint comments already forced special handling. Two
bundlers for one artifact contradicts A33's single-source goal.

### Requirements

- R1. `build:bundle` and `scripts/commands/bundle-plugin-lib.test.ts` produce byte-identical
  `plugins/sp/lib/inline-run.generated.mjs` for the same source tree, so a source change fails the
  determinism test at most zero times when build:bundle output is committed.
- R2. The single generation path keeps the existing determinism guarantees (only runtime builtin
  imports, stable bytes across cwd).

### Acceptance Criteria

- AC1 [R1]: with a dirty bundled source, `build:bundle` output passes
  `scripts/commands/bundle-plugin-lib.test.ts` unchanged (no in-test regeneration needed).
- AC2 [R2]: `bun run spur-check` green with no fixup commit required for a bundled-source change.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Chosen direction: extract one shared generate function used by both the test and the build:bundle
entry, collapsing the divergent Bun.build invocations in bundle-plugin-lib.ts (:124, :265, :355)
into that path where they target the same artifact. The test keeps its write-back behavior.
Rejected alternatives: (a) delete build:bundle and keep only the test — build:bundle is wired into
the repo gate and release flow, removal is out of scope; (b) loosen the test to compare against
build output — the test is the authoritative committed-bytes guard per A33.

### Plan

1. Consolidate the Bun.build invocations behind one shared generator in
   scripts/commands/bundle-plugin-lib.ts; build:bundle and the test call it.
2. Reproduce: edit a bundled source trivially, run `bun run build:bundle` then
   `bun test scripts/commands/bundle-plugin-lib.test.ts` — must pass without regeneration.
3. Run `bun run build:bundle` + `bun run spur-check` once at the boundary.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-01T21:57:41.142Z backlog → todo (system)

