---
schema_version: 1
name: "Doctor availability provenance: render owner, since, reason and usage-snapshot age, and mark stale snapshots"
status: todo
template: feature-impl
created_at: 2026-09-17T23:19:46.555Z
updated_at: "2026-09-18T01:07:57.911Z"
feature_id: B6
priority: P2
tags:
  - doctor
  - executor-availability
  - B6
estimate_hours: 3

dependencies: ["0892", "0889"]
---

## 0893. Doctor availability provenance: render owner, since, reason and usage-snapshot age, and mark stale snapshots

### Background

With tasks 3–5 availability carries ownership and a usage snapshot exists. `spur agent doctor` still renders a bare disabled flag. Authority: `docs/design/session-pinned-dispatch.md` §3.5, AC R8. `agent.usage.maxAgeMs` is a constant (6 h) unless the operator asks for a knob.

### Requirements

- [ ] R1. `spur agent doctor` table and `--json` show, per disabled executor, `owner`, `since`, `reason`; JSON keeps the normalized object even for bare-boolean config.
- [ ] R2. Doctor reads `~/.config/spur/agent-usage.json` when present and reports `usage.capturedAt` and `usage.age`; a snapshot older than the 6 h constant is rendered `stale` in the table and `stale: true` in JSON, and doctor never derives an enable from a stale snapshot.
- [ ] R3. A missing snapshot renders `usage: none` without a warning (the producer is optional).
- [ ] R4. Tests in `apps/cli/tests/commands/agent*` cover owner rendering for both config forms and the fresh/stale/missing snapshot cases; the spur-cli `agent.md` doctor rows are updated; `bun run spur-check` passes.

### Acceptance Criteria

Covers feature B6 scenarios R8.

- [ ] AC1 — Doctor renders availability ownership and age (req: R1)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Decision: doctor stays read-only — it reports provenance and snapshot age but never writes (docs/design/session-pinned-dispatch.md §3.5; the rejected ADR-051 shape). The staleness threshold is a constant because nothing in the design varies it; promote to config only when a second consumer needs a different value. Mutation policy: doctor rendering in `packages/app/src/services/agent-service.ts` and `apps/cli` output, tests, `agent.md`; no producer or updater changes.

### Plan

1. Read design §3.5 and the current doctor renderer + JSON shape (task 2 added `capabilities`).
2. Add provenance columns/fields from the task-3 normalizer; add snapshot read + age/stale computation.
3. Write the tests; update `agent.md`.
4. Run `cd apps/cli && bun test tests/commands/agent*` then `bun run spur-check`.
5. Record `## Solution` with a file:line map via `spur task update <wbs> --section Solution --from-file`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
