---
schema_version: 1
name: "history-anatomy enrich cannot reliably pass the structure gate: ledger anchors, placeholders, and section order fail nondeterministically"
status: done
template: issue
created_at: 2026-08-27T17:50:02.492Z
updated_at: "2026-08-27T23:17:26.672Z"
feature_id: B
---

## 0690. history-anatomy enrich cannot reliably pass the structure gate: ledger anchors, placeholders, and section order fail nondeterministically

### Background

Found during 0687 verification (2026-08-27), blocking AC4/AC9. The `history-anatomy.yaml` workflow's
enrich → structure-gate path fails nondeterministically across every run this session:

| Run | Executor | Gate failure(s) |
| --- | --- | --- |
| 4f3c5bcd (06:23) | pi-k3 | evidence-claim-without-anchor |
| 68c765bd (17:20) | pi-deepseek | evidence-claim-without-anchor |
| 99333080 (17:45) | pi-deepseek | placeholder-or-todo-present + section-missing-or-out-of-order:Report-only advisories + evidence-claim-without-anchor |

Root causes identified:

1. **Ledger-anchor format underspecified.** The structure gate's `evidence-claim-without-anchor`
   check matches `` `[^`]+\.(md|ts|json)` `` or `path:line` in each Evidence-ledger row, but
   report-contract.md only said "lists the artifact anchor(s)". Published reports (08-24/08-25)
   happened to use backticked paths; enrich models write `current #/...`, which never matches.
   FIXED 2026-08-27: report-contract.md § Evidence ledger now pins the backticked format with an
   example (commit in 0687's fix pass). This alone did NOT resolve it — the model ignored the
   requirement and emitted `current #/...` again.
2. **No correction loop for structure-gate FAIL.** The workflow only routes `validate FAIL →
   correct`; structure-gate FAIL goes straight to `failed`. A one-shot model-authored candidate
   cannot be repaired in-place, so every gate miss is terminal.
3. **No post-enrich deterministic repair.** The enrich model is asked to format-sensitive output
   (placeholder scan, section order, anchor regex) that a deterministic transformer could
   normalize cheaply.

Acceptance shape: `spur workflow run history-anatomy.yaml --vars '{"mode":"daily","date":"<today>","agent":"pi-deepseek"}'`
must reach `published` and write `docs/report/<date>-history-anatomy.md` (structure gate PASS, validate
Verdict: PASS). Choose: (a) structure-gate FAIL → correct (one bounded pass) like validate, (b)
deterministic post-enrich normalization, or (c) prompt+contract hardening with a regression test
that runs the gate against a fixture candidate. State the choice in the Design. This is the last
release-blocking half of 0687's AC4/AC9.

### Requirements

**R1 — `spur workflow run history-anatomy.yaml --vars '{"agent":"pi-deepseek"}'` reaches `published`** and writes `docs/report/<today>-history-anatomy.md` whose frontmatter carries the day's identity bounds, structure gate PASS, and validate `Verdict: PASS`.

**R2 — Structure-gate failures are no longer terminal-and-nondeterministic.** Implement one of: a bounded `correct`-style retry on structure-gate FAIL, a deterministic post-enrich repair of the three known gate classes (ledger-anchor format, placeholder/todo scan, section order), or prompt/contract hardening backed by a gate-vs-fixture regression test. State the choice in the Design and the failure-rate before/after.

**R3 — The Evidence-ledger format contract stays pinned.** report-contract.md's backticked-path requirement (0687 fix pass) must survive; the regression test covers the anchor regex directly.

### Acceptance Criteria

<!-- Given/When/Then regression scenario or checklist proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

**Choice: (a) structure-gate FAIL → correct (one bounded pass), like validate.**

Tradeoffs: (c) alone is proven insufficient — the 08-27 contract pin was ignored by the enrich model (Background RC1), so prompt hardening cannot carry R1/R2. (b) needs a new deterministic transformer per gate class (~3 normalizers, and placeholder/section-order repair risks content-mangling). (a) reuses the existing `correct` machinery, repairs all three classes uniformly, and stays bounded by the shared correction counter.

**Load-bearing sub-fix:** the 0660 `correct` state shipped with a counter-only onEnter and **no model dispatch** — even the validate-FAIL loop re-ran gate+validate on an unchanged candidate and burned its one pass deterministically. Giving `correct` its agent.run is the root-cause fix; the structure-gate FAIL edge then rides the same bounded pass.

Failure rate: before, every structure-gate/validate miss was terminal (3/3 observed runs failed ≥1 class, 0% in-loop recovery). After, a miss is terminal only if it (or a new class) also survives the single repair pass. R1's acceptance run exercises the repaired path end-to-end.

### Plan

1. `history-anatomy.yaml` transitions: reorder structure-gate exits — PASS→validate, FAIL+cap-exhausted→failed, FAIL→correct (shared correction-count bound).
2. `correct` state: add baseline capture + agent.run (repair candidate.md per gate findings / validation notes, backticked-anchor contract) + assert-clean.
3. Pin the new bounded edges in `plugins/sp/tests/skill-structure.test.ts` (publish/stamp invariants untouched).
4. R3 regression tests in `plugins/sp/tests/history-anatomy-cache.test.ts`: anchor regex directly (backticked passes, `current #/...` fails) + 99333080-replica fixture failing with exactly the three observed classes.
5. Sync surface docs (T3): `docs/design/history-anatomy.md` + `docs/04_DESIGN.md` workflow-shape line.
6. Targeted tests green (`bun test` on the two files); full gate deferred to the pipeline test hop.

### Root Cause

Reproduced by inspection against the 3 failing runs' gate classes (4f3c5bcd, 68c765bd, 99333080):

1. **Anchor gate vs model output.** `plugins/sp/scripts/history-anatomy-cache.mjs:330` — a ledger claim row passes only if it matches `` `path:123` ``, `` `path.ext` `` (md/ts/json), or bare `pkg/path:123`. Enrich models emit `current #/json-pointer` (per the skill's artifact vocabulary), which can never match. The 08-27 contract pin (RC1) changed the prose, not the model behavior.
2. **Placeholder scan.** `history-anatomy-cache.mjs:269` — `/TODO|PLACEHOLDER|FIXME|^\|\s*\|/im` fails on any TODO/FIXME token or empty-first-cell table row the model leaves behind.
3. **Section order.** `history-anatomy-cache.mjs:271-280` — the twelve canonical headers must appear as exact `^#{2,3} <name>$` matches in canonical order; a renamed/extra/misordered section (99333080: `Report-only advisories`) fails by name.
4. **No repair path.** `config/workflows/history-anatomy.yaml` — `structure-gate → failed` is guarded `always` (no FAIL detour), and the `correct` state's onEnter is a counter shell only (no `agent.run` since 0660 d9b7cc7cd): even validate-FAIL "correction" re-ran the pipeline on unchanged input, so one-shot gate misses were structurally unrecoverable.

Root cause: the workflow treats format-sensitive model output as one-shot and gives the bounded correction state no correcting action; any of the three deterministic gate classes therefore terminally fails nondeterministically-authored candidates.

### Solution
Design (a): structure-gate FAIL now detours into the same one bounded correction pass as validate FAIL, and `correct` finally got the model dispatch 0660 shipped without (it was a counter-only no-op, so even validate-FAIL "correction" re-ran on unchanged input). The counter stays shared: one repair pass per run across both gates. The repair prompt names the gate's `.md`/`.ts`/`.json` or `path:line` set (P3).

| `config/workflows/history-anatomy.yaml:13-18` | Shape comment: `structure-gate` FAIL → `correct` (max 1) → gate re-run; exhausted → failed. Same bound on validate FAIL. |
| `config/workflows/history-anatomy.yaml:231-262` | `correct` state: counter shell writes `correction-count`; baseline capture; repair `agent.run` (254 — re-anchors ledger rows to backticked `.md`/`.ts`/`.json` or `path:line`, strips placeholders/empty rows, restores canonical section order, overwrites only `candidate.md`); `assert-clean` (262). `vars.correctionCount` is the declared home; the file is the live bound. |
| `config/workflows/history-anatomy.yaml:376-387` | `structure-gate` → failed on FAIL+`correction-count` exhausted; `structure-gate` → `correct` under the cap (0690). Publish/stamp reachability untouched. |
| `plugins/sp/tests/skill-structure.test.ts:1000-1008` | Pins the bounded detour: `structure-gate->correct` + `structure-gate->failed` present, `structure-gate->publish`/`->stamp` absent; P3 prompt pin requires `.md`/`.ts`/`.json` or `path:line`. |
| `plugins/sp/tests/history-anatomy-cache.test.ts:495-524` | R3 regression: `current #/pointer` ledger row fails `evidence-claim-without-anchor`; backticked path + `path:line` anchors pass; a 99333080-replica candidate reproduces all three observed classes by name. |
| `docs/design/history-anatomy.md:131-135` | T3: FAIL at either `structure-gate` → the one correction pass → gate re-runs; second failure terminates. Anchor form named as backticked `.md`/`.ts`/`.json` or `path:line`. |

Rationale: (c)-style hardening was already tried and ignored by the model (Background RC1); (b) would need three new deterministic transformers with content-mangling risk on placeholder/section repair. The helper `history-anatomy-cache.{ts,mjs}` is deliberately untouched — the gate itself is correct; only the workflow's failure handling was broken.
### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | command this turn: `bun run apps/cli/src/index.ts workflow run config/workflows/history-anatomy.yaml --vars '{"agent":"pi-deepseek"}' --json` exit 0, status=done, finalState=published, runId=b3f0d3a6-baab-4979-a6db-e11487ff627b, durationMs=685129; structure-gate after correct PASS at `.spur/run/b3f0d3a6-baab-4979-a6db-e11487ff627b-structure-gate.txt` line 1; validation `Verdict: PASS` at `.spur/run/b3f0d3a6-baab-4979-a6db-e11487ff627b-validation.txt` line 1; published `docs/report/2026-08-27-history-anatomy.md` (41873 bytes) frontmatter identity mode=daily date=2026-08-27 timezone=America/Los_Angeles bounds 2026-08-27T00:00:00.000-07:00..23:59:59.999-07:00 |
| R2 | MET | Choice (a) live this run: enrich then structure-gate FAIL detoured to correct (log `structure-gate → correct`), correction-count=1, correct agent.run rewrote 12 ledger rows off `current #/`, re-gate PASS then validate PASS then published. Edges in `config/workflows/history-anatomy.yaml:374-386` (FAIL+cap-exhausted to failed; FAIL under cap to correct) and `config/workflows/history-anatomy.yaml:231-260` (correct onEnter: counter, baseline, agent.run, assert-clean). Shape comment `config/workflows/history-anatomy.yaml:17-18`. Pin `plugins/sp/tests/skill-structure.test.ts:1000-1005`. Test this turn: 135 pass / 0 fail. |
| R3 | MET | `plugins/sp/skills/history-anatomy/references/report-contract.md:178-184` still pins backticked `path.ext` / `path:line` (0690 diff did not touch the file; 0687 commit 8901a8b64 survives). Regex tests `plugins/sp/tests/history-anatomy-cache.test.ts:497` (`current #/pointer` fails evidence-claim-without-anchor), `plugins/sp/tests/history-anatomy-cache.test.ts:503` (backticked path + path:line pass), `plugins/sp/tests/history-anatomy-cache.test.ts:514` (99333080 replica reproduces all three classes by name). Published report this turn has 0 occurrences of `current #/`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| [docs-only] template-only AC placeholder | N/A | n/a | Task AC section is an HTML comment only; no checklist items or Gherkin scenarios. Requirements table is the acceptance surface. |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review
**SECU findings** (verify --force re-audit + leftover close-out)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P3 | Correctness | `config/workflows/history-anatomy.yaml:254` | **Fixed:** repair prompt now names the gate's `.md`/`.ts`/`.json` or `path:line` set (was a generic backticked `path`). Pinned in `plugins/sp/tests/skill-structure.test.ts:1006-1008`. |
| P4 | Usability | `config/workflows/history-anatomy.yaml:76` | `vars.correctionCount` stays the declared home (0674); the live bound is the `correction-count` file. Interpolating the var would freeze `"0"`. Documented on the `correct` state (231-240). |
| P4 | — | — | No remaining P1–P2 findings. |
### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-08-27T22:11:27.758Z todo → wip (system)
- 2026-08-27T22:33:01.482Z wip → testing (system)
- 2026-08-27T22:33:28.784Z testing → done (system)
