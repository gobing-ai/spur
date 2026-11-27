---
schema_version: 1
name: Register the deepseek history source with a real-session full-fidelity decision
status: todo
template: feature-impl
created_at: 2026-11-27T07:35:48.306Z
updated_at: "2026-11-27T07:54:35.065Z"
feature_id: E11

estimate_hours: 2
---

## 1471. Register the deepseek history source with a real-session full-fidelity decision

### Background

Feature E11 R1: dsh sessions should import and refresh like other agents' sessions.

- **The importer already supports dsh.** `@gobing-ai/ts-llm-jsonl-importer` 0.8.5, the installed catalog version (`package.json:42`), defines source `deepseek` ("DeepSeek dsh", root `.dsh/sessions`, `dshSplit` mapper) in `src/sources.ts:220-230`, and `LlmJsonlSource` includes `'deepseek'` (`src/types.ts:17`). Torn final lines from dsh crash recovery are tolerated (`sources.ts:230`).
- **Spur never asks for it.** `packages/app/src/services/history-service.ts:447-458` `SOURCES` omits `deepseek`, and so does `FULL_FIDELITY_SOURCES` (`:464`), which feeds the coverage report at `:529`.

Refine correction: no ts-libs work is needed. This is a Spur-only enrolment plus a real-session receipt.

### Requirements

- [ ] R1. `'deepseek'` is added to `SOURCES` and `FULL_FIDELITY_SOURCES` in `history-service.ts`, so `spur history import`/refresh reads `~/.dsh/sessions` and the coverage report lists it as refreshed (or failed), never silently missing.
- [ ] R2. Tests with a fixture dsh session tree (temp root) prove:
  - import yields sessions, messages and tool calls attributed to agent `deepseek`;
  - a re-run is idempotent;
  - a torn final line imports the preceding records.
- [ ] R3. A real-session receipt: one import against Robin's local `~/.dsh/sessions` (session JSONL only, no credential files) records the counts per the history design's backup/dry-run contract.

Out of scope: Board presentation (task 1472); importer changes.

### Acceptance Criteria

- [ ] R1 — dsh sessions import and refresh like other agents

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-27T07:54:18.221Z

- **Q: Bump the importer?** A: No. 0.8.5 already ships `deepseek`, verified in the installed `node_modules` copy.
- **Q: Full-fidelity or deferred?** A: Full-fidelity. The feature requires refresh parity, and the mapper is complete.
- **Q: Real-data safety?** A: Follow the history design's backup + `--dry-run` first. Never read `~/.dsh` files outside `sessions/`.

### Design

- **Chosen:** two list entries plus fixture tests and one real receipt.
- **Rejected:** a Spur-side dsh parser, which would duplicate the importer.
- **Invariants:** `SOURCES` keys stay a subset of `LlmJsonlSource`; the coverage report enumerates every enrolled source.
- **Anti-patterns:** copying real session content into fixtures.
- **Handoff:** task 1472 surfaces it on the Board.

### Plan

1. Failure modes first: add a fixture tree and tests for import attribution, idempotent re-run, a torn line, and coverage-report inclusion. They fail before enrolment.
2. Add `deepseek` to both lists.
3. Run `(cd packages/app && bun test tests/services/history-service.test.ts)`.
4. Real proof: back up the history DB, run `spur history import --dry-run` from the source CLI with only the dsh source, then run it for real. Record the binary/importer provenance and counts in Solution.
5. Run `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `packages/app/src/services/history-service.ts:447-473,529`
- `@gobing-ai/ts-llm-jsonl-importer` `src/sources.ts:220-230`, `src/types.ts:17`
- Feature E11

### History

- 2026-11-27T07:54:35.065Z backlog → todo (system)

