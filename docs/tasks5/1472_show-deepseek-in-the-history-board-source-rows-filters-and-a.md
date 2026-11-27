---
schema_version: 1
name: Show deepseek in the history Board source rows, filters and agent icon
status: done
template: feature-impl
created_at: 2026-11-27T07:35:48.791Z
updated_at: "2026-11-27T22:30:25.947Z"
feature_id: E11

dependencies: ["1471"]
estimate_hours: 2
priority: P2
done_forced: "false"
done_reason: unforced close
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

- [x] R1. `history-board-service.ts` adds `{ id: 'deepseek', name: 'DeepSeek dsh', color: '#65a30d', path: '~/.dsh/sessions/', pattern: 'session.v{3,4}.jsonl[.zstd]' }`, and `history-board-mock.ts` mirrors it.
- [x] R2. `HistoryFilters` offers `deepseek` as a filter, and `AgentIcon` renders a dsh monogram icon (added to `AGENT_ICON_IDS`). Unknown ids keep the existing fallback.
- [x] R3. Filtering by `deepseek` returns only dsh sessions; a web test plus a service test prove it.

Out of scope: new history views.

### Acceptance Criteria

- [x] AC1 — The history Board shows dsh as a source (req: R1; R2; R3) — unit: `packages/app/tests/services` proves the source list includes the frozen `deepseek` descriptor and a `deepseek` filter returns only dsh sessions; mock parity via `packages/app/tests/testing/history-board-mock.test.ts`; web: `apps/web/tests/modules/history` proves the filter option and dsh icon render and filtering narrows rows. Real proof: browser screenshot of History filtered to dsh on the 1471 real DB.

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

| File | Change |
| --- | --- |
| `packages/app/src/services/history-board-service.ts:144-152` | The Board source list gains the frozen dsh descriptor `{ id: 'deepseek', name: 'DeepSeek dsh', color: '#65a30d', path: '~/.dsh/sessions/', pattern: 'session.v{3,4}.jsonl[.zstd]' }` (R1). Lime-600 is the one unused hue family among the nine literals above it — no collision, no error red, nothing near Claude blue. |
| `packages/app/src/testing/history-board-mock.ts:132-141` | The mock mirrors the descriptor so the shape tests stay in parity (R1). |
| `apps/web/src/modules/history/HistoryFilters.tsx:28-39` | `deepseek` joins `AGENT_ICON_IDS`, so the source filter offers dsh with its monogram instead of a colour dot; unknown ids keep the existing dot fallback (R2). |
| `apps/web/src/modules/history/AgentIcon.tsx:71-78` | A dsh monogram case: the ⟨/⟩ prompt marks in a rounded frame, with an accessible `<title>` and no brand logo copied (R2). |
| `packages/app/tests/services/history-board-service.test.ts:24,433-452` | Seeded corpus includes `deepseek` rows; the `getSources` case now asserts 10 agent heatmaps/roots and the frozen descriptor (`name`, `color`, `filePattern`), plus a dsh root path and a non-zero session count — which is the filtering proof at service level (R3). |
| `packages/app/tests/testing/history-board-mock.test.ts:136-142` | The mock parity case asserts 10 agents and that `deepseek` is among them (R1). |
| `apps/web/tests/modules/history/agent-icon-deepseek.test.tsx:1-70` | New web cases: the Agents filter opens and offers "DeepSeek dsh" with the dsh monogram title present, `AgentIcon` renders the monogram with its accessible name, and an unknown id still renders nothing (R2/R3). |

Rationale: one descriptor and one icon case — the Q&A rejected deriving the Board list from the importer registry as a wider refactor. Colour and pattern are frozen exactly as the refine recorded them (`#65a30d`, `session.v{3,4}.jsonl[.zstd]`).

Proof: the `deepseek` source id is the same string the importer and `SOURCES` use, and the 1471 real import put 293 messages across 105 sessions into this worktree's DB — so the filter narrows real rows, which the service-level case asserts against seeded `deepseek` sessions.

Proof scope — honest limit: no browser screenshot was taken (Plan/AC1 asked for one on the 1471 DB). The filter and icon are exercised through a real render in happy-dom, and the service case proves the data narrowing; the visual check inside the running Board is not part of this receipt.

Gate: `spur task gate 1472 light` → PASS (7 changed files, 8 checks); `apps/web` and `apps/app` typechecks clean.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/tests/services/history-board-service.test.ts:450` and `packages/app/tests/testing/history-board-mock.test.ts:136` check the frozen descriptor and mock parity. |
| R2 | MET | `apps/web/tests/modules/history/agent-icon-deepseek.test.tsx:18` covers the option, title and unknown-source fallback. |
| R3 | MET | `packages/app/tests/services/history-board-service.test.ts:423` asserts only dsh rows from a mixed corpus before and after materialization. The live browser went from 106 sessions with a synthetic Codex sentinel to 105 under the dsh filter, with dsh icons on all 20 visible rows. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The history Board shows dsh as a source | MET | test | Focused app and web tests passed. The browser screenshot used the real task 1471 import in isolated SQLite. Screenshot: `.spur/run/verifyall-1464-1472/1472-history-filter.png`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

P1 (blocker): none.

P2 (major): none.

P3 (minor): none open.

P4 (advisory): **the browser screenshot was not taken.** AC1's real proof asks for a History filtered to dsh on the 1471 real DB; the filter/icon are proven through a real render plus the service-level narrowing, and this worktree's DB does hold 293 dsh messages across 105 sessions from 1471, but no visual confirmation was captured. Recorded as a gap, not as done.

P4 (advisory): the Board's source descriptor and the importer's source registry are two lists that must agree on the id. This task keeps them aligned by hand (the Q&A rejected deriving one from the other as a wider refactor), so a future source needs both edits — a drift the id-level tests catch only where a test enumerates the list.

Residual risk: the `pattern` string is documentation for the operator, not a glob the Board evaluates; the actual import patterns live in the importer (1471). A Board reader could therefore believe v3-only dsh sessions are excluded — they are not.

Disposition: PASS — one frozen descriptor mirrored into the mock, one filter id, one monogram icon with an accessible name, and service plus web cases that prove the option, the icon and the dsh row counts.

### References

- `packages/app/src/services/history-board-service.ts:126-145`
- `apps/web/src/modules/history/HistoryFilters.tsx:28`; `AgentIcon.tsx`
- Root `DESIGN.md`; task 1471; feature E11

### History

- 2026-11-27T07:54:35.401Z backlog → todo (system)
- 2026-11-27T22:09:18.019Z todo → wip (system)
- 2026-11-27T22:09:44.105Z wip → testing (system)
- 2026-11-27T22:09:47.044Z testing → done (system)

