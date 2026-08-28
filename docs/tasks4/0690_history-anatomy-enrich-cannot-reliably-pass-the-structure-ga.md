---
schema_version: 1
name: "history-anatomy enrich cannot reliably pass the structure gate: ledger anchors, placeholders, and section order fail nondeterministically"
status: done
template: issue
created_at: 2026-08-27T17:50:02.492Z
updated_at: "2026-08-28T17:45:14.194Z"
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
**Choice: (a) structure-gate/validate FAIL → shared bounded `correct` loop, with two total repair passes.**

Tradeoffs: (c) alone is proven insufficient — the 08-27 contract pin was ignored by the enrich model. (b) needs deterministic content transformers for model-authored prose and risks content damage. (a) reuses the existing `correct` machinery for every failure class and remains hard-bounded by a single run-scoped counter.

**Load-bearing sub-fix:** the 0660 `correct` state shipped with a counter-only `onEnter` and no model dispatch, so retrying re-ran the gates on an unchanged candidate. The correction state must re-author `candidate.md`, then re-enter the deterministic structure gate before validation.

**Re-audit hardening:** one shared pass was insufficient when structure repair consumed the counter before independent validation produced semantic findings (runs `3f5a45ea…` and `58e47f80…`). Two total passes are the minimum deterministic budget that permits one structure-driven repair followed by one validation-driven repair. The repair rubric covers legal ledger anchors, placeholders/section order, the complete field set for problem and positive findings, and quantitative/current-baseline full-digest reconciliation. Publication remains reachable only after independent validation PASS.

Failure rate: before 0690, 3/3 observed malformed candidates terminated (0% recovery). The one-pass re-audit configuration published 0/2 runs this session. With the final two-pass budget and hardened rubric, the source-local acceptance run `a104d21b…` published successfully with structure-gate PASS and independent `Verdict: PASS` (1/1 final configuration).
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
Design (a) is retained: structure-gate and validation failures share the `correct` state, which now performs real model repair and re-enters the deterministic gate. Re-audit evidence changed the retry ceiling from one to two total repairs: a structure-driven pass can be followed by one validation-driven pass, while a failure after the second repair remains terminal.

| Evidence | Change |
| --- | --- |
| `config/workflows/history-anatomy.yaml:13-18` | Workflow shape documents the shared two-pass correction budget for both failure edges. |
| `config/workflows/history-anatomy.yaml:231-263` | `correct` owns the run-scoped counter, clean-tree baseline, bounded repair dispatch, full repair rubric, and candidate-only write assertion. |
| `config/workflows/history-anatomy.yaml:370-403` | Structure and validation retry guards use `< 2`; exhausted structure failures use `>= 2`; publication remains reachable only from validation PASS. |
| `plugins/sp/tests/skill-structure.test.ts:972-1017` | Pins publish/stamp reachability, both correction edges, the two-pass bounds, anchor grammar, complete positive/problem field set, quantitative checks, and full-digest matching. |
| `plugins/sp/tests/history-anatomy-cache.test.ts:495-524` | Directly covers legal ledger anchors and reproduces the three original structure-gate failure classes. |
| `docs/design/history-anatomy.md:120-137` | T3 surface documentation records the two-pass shared budget and complete repair responsibilities. |
| `docs/04_DESIGN.md:897-903` | Top-level workflow surface names the shared two-pass correction budget and validation-only publication boundary. |

Root cause remained the workflow failure policy, not `history-anatomy-cache.{ts,mjs}`: format-sensitive model output had no effective repair action, then the initial one-pass repair budget could be consumed before semantic validation. No new helper, dependency, or public CLI surface was added.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Exact source-local command `bun run apps/cli/src/index.ts workflow run history-anatomy.yaml --vars '{"agent":"pi-deepseek"}' --json` exited 0 this turn with runId `a104d21b-dc8e-4f23-a2c9-d6f3f2a7ef6b`, status=done, finalState=published, transitionsTaken=11. Structure gate PASS: `.spur/run/a104d21b-dc8e-4f23-a2c9-d6f3f2a7ef6b-structure-gate.txt` line 1. Independent validation PASS: `.spur/run/a104d21b-dc8e-4f23-a2c9-d6f3f2a7ef6b-validation.txt` lines 1-28. Published `docs/report/2026-08-28-history-anatomy.md` (45,186 bytes) with daily identity, America/Los_Angeles bounds, run id, artifact digests, cacheDisposition=miss, and zero `current #/` anchors. |
| R2 | MET | Choice (a) is implemented at `config/workflows/history-anatomy.yaml:231-263` and `config/workflows/history-anatomy.yaml:370-403`: both failure gates share a hard two-pass correction budget, correction re-authors only the candidate, and exhausted failures terminate. `plugins/sp/tests/skill-structure.test.ts:972-1017` pins both retry/exhaustion edges, `< 2`/`>= 2` bounds, validation-only publication, and the complete repair rubric. Live re-audit runs exercised `structure-gate -> correct -> structure-gate`; final configuration published 1/1. |
| R3 | MET | `plugins/sp/skills/history-anatomy/references/report-contract.md:178-184` pins backticked `.md`/`.ts`/`.json` or `path:line` anchors. `plugins/sp/tests/history-anatomy-cache.test.ts:495-524` proves `current #/pointer` fails, legal anchors pass, and the three original gate classes reproduce. Suite: 67 pass / 0 fail, 97.28% lines. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| [docs-only] template-only AC placeholder | N/A | n/a | The task AC section contains only its scaffold comment; R1-R3 are the executable acceptance surface. |
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
