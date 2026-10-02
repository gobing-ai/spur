---
schema_version: 1
name: Make build:bundle byte-identical with the authoritative bundle-plugin-lib test bundler
status: done
template: feature-impl
created_at: 2026-10-01T21:54:16.882Z
updated_at: "2026-10-02T04:08:40.386Z"
feature_id: A33

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/run/1044-verdict.json
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

- [x] R1. `build:bundle` and `scripts/commands/bundle-plugin-lib.test.ts` produce byte-identical
  `plugins/sp/lib/inline-run.generated.mjs` for the same source tree, so a source change fails the
  determinism test at most zero times when build:bundle output is committed.
- [x] R2. The single generation path keeps the existing determinism guarantees (only runtime builtin
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

`apps/cli/package.json:55` now invokes the existing `scripts/commands/bundle-plugin-lib.ts:696` entry before the package build/staging chain. That entry already calls the exported bundleInlineRunLib owner used by `scripts/commands/bundle-plugin-lib.test.ts:188`; the different Bun.build sites target different libraries and did not need consolidation. `docs/design/configuration-contracts.md:166` records the generation order.

The dirty-source rehearsal changed a bundled error literal, ran the actual workspace build:bundle, confirmed the generated plugin carried the literal, ran the authoritative 16-test suite, and compared exact pre/post-test bytes. They were identical (sha256:37c3f4f77156ac6fc9eee7c5b52d50bd32cad26cb40338c2c9cf5a54fcfc3b1f). The source was restored in finally and rebuilt; the probe is absent. Receipt: `.spur/run/E71-1044-dirty-build.log`. No new generator, dependency, CLI surface or permanent test fixture was added.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/package.json:52`; dirty-source build and byte-identical authoritative regeneration (.spur/run/E71-1044-dirty-build.log) |
| R2 | MET | `scripts/commands/bundle-plugin-lib.ts:658`; `scripts/commands/bundle-plugin-lib.test.ts:188`; existing generator and standalone/cwd deterministic tests |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | Dirty bundled error literal → actual package build:bundle → 16 authoritative tests → unchanged exact bytes, sha256:37c3f4f77156ac6fc9eee7c5b52d50bd32cad26cb40338c2c9cf5a54fcfc3b1f; source restored and rebuilt |
| AC2 | MET | command | Final bun run spur-check includes the deterministic generator test; output needs no bundle fixup after package generation |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P4 | Functional / SECUA / Architecture | `apps/cli/package.json:55` | The existing generator now runs before packaging; a dirty-source rehearsal proves the authoritative test leaves package-generated bytes unchanged. No unresolved blocker or major finding. | RESOLVED |

#### Functional traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/cli/package.json:55`; actual dirty-literal build and exact byte equality before/after the 16-test deterministic suite |
| R2 | MET | `scripts/commands/bundle-plugin-lib.test.ts:188`; the shared owner, standalone runtime imports and cwd-independent generation checks remain |

#### SECUA and architecture

This is one build-entry composition change. It reuses the current generator, propagates its failure through the existing && chain and stages fresh output only afterward. No input-validation boundary, execution policy or installed adapter is hand-maintained. Different libraries keep their distinct build definitions; the inline artifact still has one owner. The extra generation is bounded release work. The owning configuration satellite records the order. No speculative abstraction is needed.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-01T21:57:41.142Z backlog → todo (system)
- 2026-10-02T00:38:48.889Z todo → wip (system)
- 2026-10-02T04:08:40.381Z wip → testing (system)
- 2026-10-02T04:08:40.384Z testing → done (system)

