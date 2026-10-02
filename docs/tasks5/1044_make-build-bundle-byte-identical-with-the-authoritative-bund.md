---
schema_version: 1
name: Make build:bundle byte-identical with the authoritative bundle-plugin-lib test bundler
status: wip
template: feature-impl
created_at: 2026-10-01T21:54:16.882Z
updated_at: "2026-10-02T00:38:48.889Z"
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

- [ ] R1. `build:bundle` and `scripts/commands/bundle-plugin-lib.test.ts` produce byte-identical
  `plugins/sp/lib/inline-run.generated.mjs` for the same source tree, so a source change fails the
  determinism test at most zero times when build:bundle output is committed.
- [ ] R2. The single generation path keeps the existing determinism guarantees (only runtime builtin
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

**Root-cause correction (2026-10-02).** Inspection shows the build sites generate different libraries; the authoritative inline test already calls the exported bundleInlineRunLib owner. The CLI package build:bundle chain never invokes this generator before staging plugins, so changed app source leaves stale committed plugin bytes. Reuse scripts/commands/bundle-plugin-lib.ts directly in apps/cli/package.json before the existing package build/staging chain. No new generator or API is needed. Validate a dirty bundled error literal, compare bytes before/after the existing deterministic test, restore the literal and rebuild. Update the owning configuration contract; no public Spur noun/verb/flag changes.

### Plan

1. Reuse the existing plugin-library generator in apps/cli build:bundle before package staging.
2. Reproduce a changed bundled literal, build through the package entrypoint, and prove the authoritative test leaves bytes unchanged; restore the literal and rebuild.
3. Update the configuration owner, run focused checks and the project gate, then review/verify/record through the CLI.

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
- 2026-10-02T00:38:48.889Z todo → wip (system)

