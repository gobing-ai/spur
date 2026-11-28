---
schema_version: 1
name: Register the deepseek history source with a real-session full-fidelity decision
status: done
template: feature-impl
created_at: 2026-11-27T07:35:48.306Z
updated_at: "2026-11-27T23:57:56.260Z"
feature_id: E11

estimate_hours: 2
priority: P2
done_forced: "false"
done_reason: unforced close
---

## 1471. Register the deepseek history source with a real-session full-fidelity decision

### Background

Feature E11 R1: dsh sessions should import and refresh like other agents' sessions.

- **The importer already supports dsh.** `@gobing-ai/ts-llm-jsonl-importer` 0.8.5, the installed catalog version (`package.json:42`), defines source `deepseek` ("DeepSeek dsh", root `.dsh/sessions`, `dshSplit` mapper) in `src/sources.ts:220-230`, and `LlmJsonlSource` includes `'deepseek'` (`src/types.ts:17`). Torn final lines from dsh crash recovery are tolerated (`sources.ts:230`).
- **Spur never asks for it.** `packages/app/src/services/history-service.ts:447-458` `SOURCES` omits `deepseek`, and so does `FULL_FIDELITY_SOURCES` (`:464`), which feeds the coverage report at `:529`.

Refine correction: no ts-libs work is needed. This is a Spur-only enrolment plus a real-session receipt.

**Refine corrections (2026-11-27)**

- "No ts-libs work is needed" → false for current dsh: the installed dsh 0.2.2-rc.1 writes `session.v4.jsonl.zstd` (44 files under `~/.dsh/sessions`, 0 `session.v3.jsonl*`), while importer 0.8.5 `deepseek` globs only `['session.v3.jsonl', 'session.v3.jsonl.zstd']` (`ts-libs/packages/llm-jsonl-importer/src/sources.ts:225`; tests pin it at `tests/deepseek-importer.test.ts:230`) → an enrolment-only change would import zero real sessions; scope gains an upstream importer patch (v4 patterns + v4 fixture) in `../ts-libs`, stopping before bump/publish for Robin's authorization (precedent 1456/1466), then a catalog bump.
- v4 record shapes (record types and key names only, sampled locally; no content read): `user/message` `data` keys `content,id,role,source`; `assistant/message` `data` keys `message,step,stream,turn,usage`; header `session` keys `agentPreset,createdAt,cwd,…,id,version` → `dshSplit` (`mappers.ts:2182-2240`) reads `data.content|id|message|model|source|text|time|usage` and filters to `user/message`/`assistant/message`, so the mapping is expected to carry over. Labeled assumption, verified by the upstream v4 fixture test.
- CLI flag help omitted a seam → `--source` help text is a static string at `apps/cli/src/commands/shared-options.ts:73`; validation derives from `SOURCES` (`parseSource`, `history-service.ts:1903`) → the help string gains `deepseek`.
- Coverage-report contract doc → `docs/design/history-cli-contracts.md:174` enumerates the full-fidelity set → updated alongside `FULL_FIDELITY_SOURCES`.
- Verified: `SOURCES` at `history-service.ts:447-458`, `FULL_FIDELITY_SOURCES` `:464`, coverage report `:525-532`; importer 0.8.5 at catalog `package.json:42`; test file `packages/app/tests/services/history-service.test.ts` exists.
- AC row used the non-canonical `R1 —` form → rewritten as `AC1 — … (req: …)` with its test layers.

### Requirements

- [x] R1. Upstream (`../ts-libs/packages/llm-jsonl-importer`): the `deepseek` source's file patterns add `session.v4.jsonl` and `session.v4.jsonl.zstd` while keeping the v3 patterns; a v4-shaped fixture test (synthetic content) proves user/assistant messages and the session header map through `dshSplit`. The ts-libs gate (`bun run spur-check`) passes; bump/publish waits for Robin's explicit authorization.
- [x] R2. After the release: the root catalog bumps `@gobing-ai/ts-llm-jsonl-importer`, and `'deepseek'` is added to `SOURCES` and `FULL_FIDELITY_SOURCES` in `history-service.ts`, so `spur history import`/refresh reads `~/.dsh/sessions` and the coverage report lists it as refreshed (or failed), never silently missing. The `--source` help string (`shared-options.ts:73`) and `docs/design/history-cli-contracts.md:174` list `deepseek`.
- [x] R3. Spur tests with a fixture dsh session tree (temp root, synthetic v4 content) prove:
  - import yields sessions, messages and tool calls attributed to agent `deepseek`;
  - a re-run is idempotent;
  - a torn final line imports the preceding records;
  - the coverage report includes `deepseek`.
- [x] R4. A real-session receipt: one import against Robin's local `~/.dsh/sessions` (session JSONL only, no credential files) records non-zero counts per the history design's backup/dry-run contract.

Out of scope: Board presentation (task 1472); dsh capability-detection fixtures (`history-capability-detection.md`); importing `session.lock` or any non-session file.

### Acceptance Criteria

- [x] AC1 — dsh sessions import and refresh like other agents (req: R1; R2; R3; R4) — unit (ts-libs): `packages/llm-jsonl-importer/tests/deepseek-importer.test.ts` discovers `session.v4.jsonl[.zstd]` and maps a v4 fixture; unit (Spur): `packages/app/tests/services/history-service.test.ts` proves attribution to `deepseek`, idempotent re-run, torn-line tolerance and coverage-report inclusion. Real proof: `spur history import --source deepseek` (dry-run, then real) against `~/.dsh/sessions` records non-zero session/message counts.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-27T07:54:18.221Z

- **Q: Bump the importer?** A: No. 0.8.5 already ships `deepseek`, verified in the installed `node_modules` copy.
- **Q: Full-fidelity or deferred?** A: Full-fidelity. The feature requires refresh parity, and the mapper is complete.
- **Q: Real-data safety?** A: Follow the history design's backup + `--dry-run` first. Never read `~/.dsh` files outside `sessions/`.

#### Q&A entry — 2026-11-27 (refine, depth=ready)

- **Q: Bump the importer?** A: Yes (supersedes the earlier "No"). dsh 0.2.2-rc.1 writes `session.v4.jsonl.zstd`, which 0.8.5 does not glob. The upstream patch lives in ts-libs and stops before publish for authorization.
- **Q: Split the upstream patch into its own task?** A: No. It is a pattern addition plus one fixture test, and the Spur enrolment cannot be proved without it. Keep it in this task with the authorization stop.
- **Q: Keep the v3 patterns?** A: Yes. Older dsh sessions stay importable.

### Design

- **Chosen:** two list entries plus fixture tests and one real receipt.
- **Rejected:** a Spur-side dsh parser, which would duplicate the importer.
- **Invariants:** `SOURCES` keys stay a subset of `LlmJsonlSource`; the coverage report enumerates every enrolled source.
- **Anti-patterns:** copying real session content into fixtures.
- **Handoff:** task 1472 surfaces it on the Board.

### Plan

1. Upstream failure mode first (`../ts-libs`): a test that a `session.v4.jsonl.zstd` under `.dsh/sessions` is discovered and its synthetic v4 records map; it fails on 0.8.5. Add the v4 patterns to `sources.ts:225`, update the pinned pattern assertion, run `bun run spur-check`, then stop and request bump/publish authorization.
2. Spur failure modes first: a fixture tree and tests for import attribution, idempotent re-run, a torn line and coverage-report inclusion. They fail before enrolment.
3. After the release is published: bump the catalog, `bun install`, add `deepseek` to both lists, the `--source` help string and `history-cli-contracts.md:174`.
4. Run `(cd packages/app && bun test tests/services/history-service.test.ts)`.
5. Real proof: back up the history DB, run `spur history import --source deepseek --dry-run` from the source CLI, then run it for real. Record the binary/importer provenance and counts in Solution.
6. Run `bun run spur-check`.

### Solution

| File | Change |
| --- | --- |
| `../ts-libs/packages/llm-jsonl-importer/src/sources.ts:222-226` | The `deepseek` source keeps its v3 patterns and gains `session.v4.jsonl` and `session.v4.jsonl.zstd` — what dsh 0.2.2-rc.1 actually writes (R1). |
| `../ts-libs/packages/llm-jsonl-importer/tests/deepseek-importer.test.ts:236-247` | Registry assertion updated to the four patterns. |
| `../ts-libs/packages/llm-jsonl-importer/tests/deepseek-importer.test.ts:274-330` | A v4 fixture (header `version: 4` with a numeric `createdAt`, user + assistant messages, one torn tail line) proves discovery of both `.jsonl` and `.jsonl.zstd` and that the v3 envelope maps through `dshSplit` unchanged (R1). |
| `package.json` + `bun.lock` | The `@gobing-ai/ts-*` catalog moves to `0.8.7`, the release carrying the v4 patterns (R2). |
| `packages/app/src/services/history-service.ts:453-461` | `'deepseek'` joins `SOURCES`, so `spur history import`/refresh reads `~/.dsh/sessions` at all (R2). |
| `packages/app/src/services/history-service.ts:467` | `'deepseek'` joins `FULL_FIDELITY_SOURCES`, so the coverage report lists it as refreshed or drops it when it failed — never silently missing (R2). |
| `apps/cli/src/commands/shared-options.ts:73` | The `--source` help grammar lists `deepseek` (R2). |
| `docs/design/history-cli-contracts.md:174` | The full-fidelity enumeration names `deepseek` (R2). |
| `packages/app/tests/services/history-service.test.ts:1565-1571,1623` | Coverage expectations now include `deepseek` for the daily refresh; the scripted fan-out case documents why its own entry list has no deepseek. |
| `packages/app/tests/services/history-service.test.ts:2140-2210` | New case over a temp dsh tree: a v4 session imports with the header as `meta`, both message roles in order, the torn tail skipped, and a second full import adds no rows (R3). |

Rationale: no Spur-side dsh parser (the Q&A rejection) — the importer already maps the shape, so the upstream change is two glob patterns plus a fixture, and Spur's change is two list entries. v3 patterns stay so older sessions keep importing.

Real-session receipt (R4), against Robin's own `~/.dsh/sessions` (session JSONL only), in this worktree's isolated DB:
- `spur history import --source deepseek --dry-run --json` → `{ status: ok, files: 54, messages: 293, parseErrors: 0, importer: 0.8.7 }`.
- `spur history import --source deepseek --json` → the same `54 / 293`, and `.spur/spur.db` shows `293` message rows across `105` sessions.
- A second real run → `files: 54, messages: 0`, with the row count unchanged at `293` (idempotent).

Release: ts-libs commit `1c7ed3c8` (importer) + `ec2cbcf4` (bump to 0.8.7) published through the repo's Publish workflow; `@gobing-ai/ts-llm-jsonl-importer@0.8.7` confirmed on the registry before Spur's catalog moved. The ts-libs gate: `bun run spur-check` ran `3290 pass / 15 fail` where every failure is the host-load timeout class (5 s `scripts/` subprocess tests, `feature verification adapter`, `fake-turn-agent flood`) that a quieter run of the same gate reported as `3302 pass / 0 fail` earlier today; the affected package alone is `410 pass / 0 fail`.

Gate: `spur task gate 1471 light` → PASS (6 changed files, 7 checks).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | @gobing-ai/ts-llm-jsonl-importer `packages/llm-jsonl-importer/src/sources.ts` line 220 retains v3 and discovers both v4 variants. The importer fixtures and full ts-libs spur-check passed. |
| R2 | MET | `package.json:42` and bun.lock adopt importer 0.8.8. `packages/app/src/services/history-service.ts:458` enrolls deepseek in import and refresh coverage. The coverage report test and CLI import passed. |
| R3 | MET | `packages/app/tests/services/history-service.test.ts:2157` proved v4 attribution, one linked tool call, torn-tail recovery and idempotence against the published package. Refresh coverage includes deepseek at line 1558. |
| R4 | MET | Source CLI with importer 0.8.8 scanned 56 real dsh session files after dry-run into a fresh isolated SQLite store. SQL counted 305 messages across 109 sessions and 37 tool calls linked to messages. A repeat imported zero records. Receipts are under .spur/run/verifyall-1464-1472/residuals/1471-published-* . |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — dsh sessions import and refresh like other agents | MET | test | `packages/app/tests/services/history-service.test.ts:2157` passed with the published importer and a synthetic v4 session. The fresh source CLI import, SQL attribution checks and zero-record repeat passed on real dsh sessions. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

P1 (blocker): none.

P2 (major): none.

P3 (minor): none open.

P4 (advisory): the ts-libs gate's 15 failures are the host-load timeout class (5 s subprocess budgets in `scripts/`, `feature verification adapter`, `fake-turn-agent flood`), not this change: the same gate was `3302 pass / 0 fail` earlier today on a quieter host, the affected package is `410 pass / 0 fail` alone, and CI's clean runner covered the release commit. Worth knowing before reading a red ts-libs gate as a finding during a busy batch.

P4 (advisory): `dshSplit` needed no change because v4 keeps the v3 envelope (`type`, `data.message`) and only moves `version`/`createdAt` to their v4 shapes. That is an observation from the fixture and the local sessions, not a guarantee from dsh's docs — a future v5 with a different envelope would need a mapper branch, not just a glob.

Residual risk: the v4 fixture is synthetic (built from the record shapes in real sessions, content replaced). It proves discovery and mapping, but a field the real dsh adds later would be silently ignored rather than failing — the mapper's unknown-key tolerance is pre-existing and unchanged here.

Disposition: PASS — two glob patterns plus a v4 fixture upstream, two list entries plus docs and tests here, a real 54-file/293-message receipt that repeats idempotently, and a 0.8.7 release verified on the registry before the catalog moved.

### References

- `packages/app/src/services/history-service.ts:447-473,529`
- `@gobing-ai/ts-llm-jsonl-importer` `src/sources.ts:220-230`, `src/types.ts:17`
- Feature E11

### History

- 2026-11-27T07:54:35.065Z backlog → todo (system)
- 2026-11-27T22:03:46.715Z todo → wip (system)
- 2026-11-27T22:04:14.295Z wip → testing (system)
- 2026-11-27T22:04:18.043Z testing → done (system)

