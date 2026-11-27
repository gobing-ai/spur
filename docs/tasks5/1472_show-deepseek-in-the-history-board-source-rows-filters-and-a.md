---
schema_version: 1
name: Show deepseek in the history Board source rows, filters and agent icon
status: todo
template: feature-impl
created_at: 2026-11-27T07:35:48.791Z
updated_at: "2026-11-27T16:58:41.646Z"
feature_id: E11

dependencies: ["1471"]
estimate_hours: 2
priority: P2
---

## 1472. Show deepseek in the history Board source rows, filters and agent icon

### Background

Feature E11 R2: the history Board shows dsh as a source.

- `packages/app/src/services/history-board-service.ts:126-145` lists each source as `{ id, name, color, path, pattern }`, and `deepseek` is absent.
- `apps/web/src/modules/history/HistoryFilters.tsx:28` has `AGENT_ICON_IDS` without `deepseek`.
- `apps/web/src/modules/history/AgentIcon.tsx` has no dsh glyph.

Depends on task 1471, so that real rows exist.

**Refine corrections (2026-11-27)**

- R1 pattern "`session.v3.jsonl` / `session.v3.jsonl.zstd`" → the installed dsh 0.2.2-rc.1 writes `session.v4.jsonl.zstd` (see task 1471 correction; 1471 adds the v4 patterns upstream) → the Board pattern lists `session.v{3,4}.jsonl[.zstd]`.
- Q&A "an unused hue checked against the existing palette in DESIGN.md" → `DESIGN.md` defines no agent/source palette; the only agent colors are the literals at `history-board-service.ts:126-145` (`#3987e5 #d95926 #c98500 #10b981 #ec4899 #8b5cf6 #f59e0b #6366f1 #14b8a6`) → color frozen as `#65a30d` (lime-600; the one unused hue family, not error red, not near Claude blue).
- Mock seam missing → `packages/app/src/testing/history-board-mock.ts:55-70` mirrors the source list and is covered by `packages/app/tests/testing/history-board-mock.test.ts` and `history-response-shape.test.ts` → the mock gains the `deepseek` descriptor so the shape tests stay in parity.
- Verified: `AGENT_ICON_IDS` at `HistoryFilters.tsx:28`; `AgentIcon.tsx` switches per id (`case 'agy'` at `:20`) with no dsh case.
- AC row used the non-canonical `R2 —` form → rewritten as `AC1 — … (req: …)` with its test layers.

### Requirements

- [ ] R1. `history-board-service.ts` adds `{ id: 'deepseek', name: 'DeepSeek dsh', color: '#65a30d', path: '~/.dsh/sessions/', pattern: 'session.v{3,4}.jsonl[.zstd]' }`, and `history-board-mock.ts` mirrors it.
- [ ] R2. `HistoryFilters` offers `deepseek` as a filter, and `AgentIcon` renders a dsh monogram icon (added to `AGENT_ICON_IDS`). Unknown ids keep the existing fallback.
- [ ] R3. Filtering by `deepseek` returns only dsh sessions; a web test plus a service test prove it.

Out of scope: new history views.

### Acceptance Criteria

- [ ] AC1 — The history Board shows dsh as a source (req: R1; R2; R3) — unit: `packages/app/tests/services` proves the source list includes the frozen `deepseek` descriptor and a `deepseek` filter returns only dsh sessions; mock parity via `packages/app/tests/testing/history-board-mock.test.ts`; web: `apps/web/tests/modules/history` proves the filter option and dsh icon render and filtering narrows rows. Real proof: browser screenshot of History filtered to dsh on the 1471 real DB.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-27T07:54:21.295Z

- **Q: Which color?** A: An unused hue checked against the existing palette in DESIGN.md. It must not collide with any color in the list at `:126-145`.
- **Q: Which icon asset?** A: A simple monogram SVG consistent with the existing AgentIcon set. No brand logo is copied.

#### Q&A entry — 2026-11-27 (refine, depth=ready)

- **Q: Which color, given DESIGN.md has no agent palette?** A: `#65a30d` (lime-600), the unused hue family among the nine literals at `history-board-service.ts:126-145` (supersedes "checked against DESIGN.md").
- **Q: v3 or v4 pattern?** A: Both: `session.v{3,4}.jsonl[.zstd]`, matching task 1471's importer patterns.

### Design

- **Chosen:** one source descriptor, one filter id and one icon case.
- **Rejected:** deriving the Board list from the importer's source registry, a wider refactor that is not needed here.
- **Frozen names:** source id `deepseek`; label `DeepSeek dsh`.
- **Invariants:** source ids match `LlmJsonlSource`.
- **Anti-patterns:** brand logo assets.
- **Handoff:** none.

### Plan

1. Failure modes first: a service test that the source list includes `deepseek` (color `#65a30d`, v3+v4 pattern) and that a `deepseek` filter returns only dsh sessions; mock parity; a web test that the filter option and icon render and that filtering narrows rows.
2. Implement the descriptor (service + mock), filter id and icon.
3. Real proof: a browser check of History filtered to dsh on the real DB from 1471, with a screenshot receipt from an unsandboxed host.
4. Run `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `packages/app/src/services/history-board-service.ts:126-145`
- `apps/web/src/modules/history/HistoryFilters.tsx:28`; `AgentIcon.tsx`
- Root `DESIGN.md`; task 1471; feature E11

### History

- 2026-11-27T07:54:35.401Z backlog → todo (system)

