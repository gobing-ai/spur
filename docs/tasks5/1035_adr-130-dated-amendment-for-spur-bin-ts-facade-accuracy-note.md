---
schema_version: 1
name: "ADR-130: dated amendment for spur-bin.ts facade accuracy note"
status: done
template: feature-impl
created_at: 2026-10-01T00:47:12.874Z
updated_at: "2026-10-01T01:32:25.897Z"
feature_id: A9

ac_numbering: task-local
ac_altitude: task-local
---

## 1035. ADR-130: dated amendment for spur-bin.ts facade accuracy note

### Background

Captured from the creation title: "ADR-130: dated amendment for spur-bin.ts facade accuracy note".

### Requirements

- [x] R1. `docs/00_ADR.md` ADR-130 gains a dated amendment recording that `plugins/sp/lib` also holds hand-written helpers shared by ≥2 glue files — today `spur-bin.ts` (`spurCommand`, the shared spur-CLI invocation split, introduced by task 1007 R9 and adopted by residual-scan in 1019). This widens the Decision's "`env.ts` and generated bundles" enumeration. It replaces the in-place ADR-130 edit from wrap fdf0a62b4, which merge 2b10712c9 dropped by resolving `00_ADR.md` as ours.
- [x] R2. ADR-130's historical lines (title, Status, Decision, Why, Alternatives, Consequence, Retains, Detail, and any already-committed amendment) stay byte-identical. Only the `version`/`updated_at` frontmatter changes, plus appended dated lines.
- [x] R3. `repo-wide-tests/adr-supersession.test.ts` (e) admits ADR-130 to its amended set (same precedent as 0911/ADR-123), and every other ADR stays frozen.

Out of scope: rewording the Decision line in place; `docs/design/harness-surface-governance.md:92`, which already carries the spur-bin.ts fact; any code change.

### Acceptance Criteria

- [x] AC1 — ADR-130 carries the dated spur-bin.ts amendment (req: R1)
  `rg -n "Amendment \(2026-09-30 · task 1035\)" docs/00_ADR.md` hits one line inside the ADR-130 block, naming `spur-bin.ts`.
- [x] AC2 — No historical ADR text is rewritten (req: R2, R3)
  `git diff --unified=0 HEAD -- docs/00_ADR.md` removes only `version:`/`updated_at:` lines; `bun test repo-wide-tests/adr-supersession.test.ts` exits 0 with the diff uncommitted.
- [x] AC3 — Feature gate stays green (req: R3)
  `bun run spur-check-feature` exits 0 (sandbox-blocked sub-checks reported separately).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Fact (verified 2026-09-30): `plugins/sp/lib/spur-bin.ts` is a hand-written plugin-glue helper. It exports `spurCommand`/`defaultSpurBin` and resolves `--spur-bin` > `SPUR_BIN` > the monorepo CLI entry > the PATH `spur`. It is **not** the binary facade: the `spur` bin is `apps/cli/package.json` → `spur.js`. The real drift is that ADR-130's Decision lists `plugins/sp/lib` contents as only `env.ts` plus generated bundles.

The constitution (99 §6.1) forbids rewriting historical ADR lines, so the fix is a dated `**Amendment (date · task):**` line appended inside ADR-130. Precedent format: `docs/00_ADR.md:1186`. Once committed, an amendment is itself frozen by adr-supersession (e), so later factual corrections append a `**Correction (…)**` line rather than editing it.

### Plan

Status: implemented. The amendment and test admission were committed in 2dc9841ed. The attribution correction line (`docs/00_ADR.md:2018`) is uncommitted.

1. Done: append the amendment at `docs/00_ADR.md:2017` and bump the version to 1.59.0.
2. Done: add 130 to the amended set at `repo-wide-tests/adr-supersession.test.ts:168`.
3. Done: append a correction line fixing the task attribution (1007 R9, not 1019). The test passes: 7/7.
4. Remaining: commit the correction, then run the gate (`bun run spur-check`) outside the sandbox. Then run inline verify → `task record --transition testing` → done.

### Solution

- `docs/00_ADR.md:2017`: a dated ADR-130 amendment says `plugins/sp/lib` holds hand-written shared helpers, today `spur-bin.ts` (`spurCommand`), beside `env.ts` and the generated bundles. It stays under the plugin standalone import rule.
- `docs/00_ADR.md:2018`: a dated correction attributes `spur-bin.ts` to task 1007 R9, with 1019 adopting it in residual-scan. It is appended because test (e) freezes the committed amendment.
- `repo-wide-tests/adr-supersession.test.ts:168`: the amended set is now `[42, 52, 57, 86, 116, 123, 130]`, and the failure message lists 130.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | ADR-130 dated amendment naming `plugins/sp/lib` hand-written shared helpers and `spur-bin.ts` (`docs/00_ADR.md:2017`), with the 1007 R9 / 1019 attribution correction (`docs/00_ADR.md:2018`). Re-read this run. |
| R2 | MET | `git show --unified=0 2dc9841ed 5ba34b162 -- docs/00_ADR.md` this run: only `version:` removed/added plus the two appended ADR-130 lines; no historical line rewritten. |
| R3 | MET | Amended set includes 130 (`repo-wide-tests/adr-supersession.test.ts:168`); `bun test repo-wide-tests/adr-supersession.test.ts` this run: 7 pass / 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | `rg -n "Amendment \(2026-09-30 · task 1035\)" docs/00_ADR.md` → one hit at `docs/00_ADR.md:2017`, inside ADR-130, naming `spur-bin.ts`. |
| AC2 | MET | test | Diff of 2dc9841ed+5ba34b162 removes only `version:`; `repo-wide-tests/adr-supersession.test.ts:168` admits 130 and the suite is 7/0 this run. |
| AC3 | MET | command | `bun run spur-check-feature` this run: exit 0 (link, shim, script-contract, parity, promotion, dependency-drift, importer-schema, history-freeze checks + repo-wide tests 7/0). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Review** (inline coordinator: functional, SECUA, architecture; scope = commits 2dc9841ed + 5ba34b162)

| Priority | Dimension | Location | Finding | Disposition |
|----------|-----------|----------|---------|-------------|
| P4 | Functional | `docs/00_ADR.md:2017` | The amendment correctly describes `spur-bin.ts` as a shared spur-CLI invocation helper, not a bin facade (the bin is `spur.js`). R1–R3 traced. | — |
| P3 | Correctness | `docs/00_ADR.md:2018` | The committed amendment credited `spur-bin.ts` to task 1019, but it was introduced by 1007 R9 (commit 04e3505d6). Corrected by an appended dated line because test (e) freezes committed amendment text. | FIXED (5ba34b162) |
| P4 | Architecture | `repo-wide-tests/adr-supersession.test.ts:168` | Admitting 130 to the amended set follows the 0911/ADR-123 precedent, and every other ADR stays frozen. `docs/design/harness-surface-governance.md:92` is consistent. | — |

### References

- `docs/00_ADR.md:2017-2018` (ADR-130 amendment and correction); format precedent `docs/00_ADR.md:1186`
- `plugins/sp/lib/spur-bin.ts` (helper; introduced by 1007 R9 in commit 04e3505d6); `apps/cli/package.json` (bin `spur.js`)
- `repo-wide-tests/adr-supersession.test.ts:168`
- Provenance: wrap fdf0a62b4 edited ADR-130 in place; merge 2b10712c9 resolved `00_ADR.md` as ours and dropped that edit
- Adjacent: `docs/design/harness-surface-governance.md:92` already states the fact

### History

- 2026-10-01T00:50:19.482Z backlog → todo (system)
- 2026-10-01T00:50:19.755Z todo → wip (system)
- 2026-10-01T01:32:05.869Z wip → testing (system)
- 2026-10-01T01:32:25.897Z testing → done (system)

