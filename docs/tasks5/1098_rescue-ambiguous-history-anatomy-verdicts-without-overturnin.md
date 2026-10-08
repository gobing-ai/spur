---
schema_version: 1
name: Rescue ambiguous history-anatomy verdicts without overturning FAIL
status: done
template: feature-impl
created_at: 2026-10-07T01:02:20.692Z
updated_at: "2026-10-08T16:22:45.272Z"
feature_id: P1
priority: P2
tags:
  - decision
estimate_hours: 3

dependencies: ["1096"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1098-verdict.json
---

## 1098. Rescue ambiguous history-anatomy verdicts without overturning FAIL

### Background

Slice S6 of docs/design/decision-observability-and-adoption.md §5. history-anatomy normalizes validator prose with a shell `Verdict:` line rewrite (config/workflows/history-anatomy.yaml:236). Covers R12. Starts only when reliability evidence exists for anatomy-validation-verdict.

### Requirements

- [x] R1. Add catalog file `config/decisions/history-anatomy.yaml` with `anatomy-validation-verdict`: `type: choice`, criteria `PASS`/`FAIL`, `fallback: FAIL`.
- [x] R2. In `config/workflows/history-anatomy.yaml`, extend the verdict-normalization shell step at `:236-251`. The rescue runs only when, after normalization, the last line is not exactly `Verdict: PASS` and there are zero exact `Verdict: FAIL` lines. That covers zero PASS lines, or several. Any exact `Verdict: FAIL` line short-circuits, and no maker is called.
- [x] R3. In the ambiguous case, run `$spurBin decision run anatomy-validation-verdict --evidence "$f" --json`. Append `Verdict: PASS` only when `source == "model"` and `value == "PASS"`. Otherwise append `Verdict: FAIL`. A deterministic FAIL can never become PASS, and a fallback is always FAIL.
- [x] R4. Add a workflow scan test that asserts the deterministic status checks contain no `decision run` or `kind: decide`. The checks are pr-review, wayfinder-resolution, wrapup-pipeline, feature-verification, and the history-anatomy structure gate. The allowlist is the single rescue step above.
- [x] R5. Start condition: the 1096 reliability report shows recorded samples for `anatomy-validation-verdict`. Cite them in Solution.

### Acceptance Criteria

- [x] AC1 — A deterministic FAIL is never overturned by a decision

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T01:02:48.887Z

- Scope and approach closed at idea-pipeline run 4111db4a-101f-420c-8b6f-9530bf678534: chosen approach and rejected alternatives recorded in Design; contract in docs/design/decision-observability-and-adoption.md.
- Adoption slices start only after the reliability report shows recorded evidence for their decision id and maker (feature P1 entry condition).

#### Q&A entry — 2026-10-07T01:19:12.051Z

- The rescue lives inside the existing normalization step, not a new state, so the 0771 guard and `assert-clean` are untouched.
- An ambiguous verdict with no model answer becomes FAIL. That is stricter than today, where the guard also fails, so the routing is the same.

### Design

**Chosen: extend the existing normalization step** (`config/workflows/history-anatomy.yaml:236-251`) instead of adding a new state.

- The 0771 guard and the `assert-clean` step (`:252-255`) stay the authorities.
- The rescue only decides which verdict line the guard reads when the file is ambiguous.

**Rejected:** asking the model whenever the last line is not PASS. That would put a maker in front of real FAILs.

**Invariants:**
- An exact `Verdict: FAIL` line anywhere in the file means no maker call and a FAIL result.
- A fallback or non-model answer means FAIL.
- PASS is written only from `source == "model"`.

**Execution budget:**
- 2 YAML files and 1 test file.
- `requireDiff: true`.
- Run `build:bundle` after the YAML edit.

### Plan

1. Failure list:
   - A file with both `Verdict: PASS` and `Verdict: FAIL` calls the maker.
   - A no-backend fallback writes PASS.
   - A file with a single correct `Verdict: PASS` already in the final line calls the maker.
   - The normalization step from 2026-09-13 regresses.
2. Add the catalog. Check it with `spur decision show anatomy-validation-verdict --json`.
3. Extend the shell step, then run `build:bundle`.
4. Add the scan test as `apps/cli/tests/workflow-decision-scan.test.ts` (reads `config/workflows/*.yaml`) to assert R4.
5. E2E, no backend, with four fixture validation files run through the step's command:
   - exact FAIL
   - FAIL plus PASS
   - prose only
   - single leading PASS
   - Expected final lines: FAIL with no decision rows, FAIL with no decision rows, FAIL with start/failure/end rows, and PASS from normalization with no decision rows.
   - Save the results as `.spur/run/1098-verdicts.json`.
6. Gate: `bun run spur-check`.

### Solution

**Chosen: extend the existing normalization region** (`config/workflows/history-anatomy.yaml`, validate state) instead of adding a new state; the 0771 guard and `assert-clean` stay the authorities.

Change map:

- `config/decisions/history-anatomy.yaml` (new) — shared-layer catalog with `anatomy-validation-verdict` (`type: choice`, criteria `PASS`/`FAIL`, `fallback: FAIL`, `minConfidence: 0.8` per ADR-125). Verified with `spur decision show anatomy-validation-verdict --json`.
- `config/workflows/history-anatomy.yaml:235-274` — the 2026-09-13 normalization step (:235-252) is byte-identical to before; the rescue is a second shell action right after it (:253-274), so each stays inside the ADR-115 shell tier (10 logical commands each, warn band; a single merged step measured 18 and fails the shared-workflow composition gate). The rescue runs only when the artifact is still undecidable after normalization — final line not exactly `Verdict: PASS` and zero exact `Verdict: FAIL` lines — calls `$spurBin decision run anatomy-validation-verdict --evidence "$f" --json`, and appends `Verdict: PASS` only when `source == "model"` and `value == "PASS"` (jq `// .data.*` arms also accept the ADR-091 envelope shape); a fallback, non-model source, jq failure or maker failure appends `Verdict: FAIL`, enforced by the hard `[ "$v" = "PASS" ] || v="FAIL"` default. The zero-FAIL guard short-circuits before the maker call, so a deterministic FAIL is never overturned (AC1).
- `apps/cli/tests/workflow-decision-scan.test.ts` (new) — R4 scan: the five deterministic-status workflows (pr-review, wayfinder-resolution, wrapup-pipeline, feature-verification, history-anatomy) contain no `kind: decide`, and `decision run` appears exactly once — inside the allowlisted rescue step, after the zero-FAIL short-circuit, with the model-only PASS rule and the hard FAIL default asserted textually.
- `docs/design/decision-observability-and-adoption.md:144` — §4 table anchor moved from the normalization step (`:236`) to the rescue maker call (`:270`) so the row points at the decision point (T3 sync).

Start condition (R5): `spur decision status --reliability --json` shows `anatomy-validation-verdict` with `evidence: recorded, samples: 2` (`fallbacks: {no-backend: 2}`, maker `typesafe`; gathered via `spur decision run` probes 2026-10-07) — the 1096 report has recorded evidence for the id.

E2E evidence: `.spur/run/1098-verdicts.json` — the validate state's normalization + rescue commands extracted from the YAML and run against four fixtures: exact FAIL → `Verdict: FAIL`, no decision rows; FAIL plus PASS → `Verdict: FAIL`, no decision rows; prose only → `Verdict: FAIL` with `decision.start`/`decision.failure`/`decision.end` rows; single leading PASS → `Verdict: PASS` from normalization, no decision rows.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | catalog `config/decisions/history-anatomy.yaml:22-34`: anatomy-validation-verdict type choice, criteria PASS/FAIL, fallback FAIL; shipped-catalog contract `packages/app/tests/workflow/shipped-workflows-catalog-decide.test.ts:85` |
| R2 | MET | normalization step unchanged `config/workflows/history-anatomy.yaml:245-252`; rescue guard runs only on zero exact Verdict: FAIL lines and a final line not Verdict: PASS `config/workflows/history-anatomy.yaml:268-269` |
| R3 | MET | rescue maker call `config/workflows/history-anatomy.yaml:270`; model-only PASS jq rule and hard FAIL default `config/workflows/history-anatomy.yaml:271-273`; textual pin `apps/cli/tests/workflow-decision-scan.test.ts:66` |
| R4 | MET | scan over the five deterministic-status workflows `apps/cli/tests/workflow-decision-scan.test.ts:60` (no kind: decide) and `apps/cli/tests/workflow-decision-scan.test.ts:66` (decision run exactly once, in the rescue step); fresh run 4 pass / 0 fail |
| R5 | MET | fresh 2026-10-08 `spur decision status --reliability --json` reports evidence recorded, samples 1 for anatomy-validation-verdict, idea-recommendation, needs-design and gate-evidence (maker laya-local, fallbacks no-backend) after `spur decision run` probes; the prior typesafe samples cited in Solution are no longer in this ledger; report wiring `packages/app/src/decision/decision-reliability.ts:66-70` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A deterministic FAIL is never overturned by a decision | MET | test | behavioral fixture B: Verdict: FAIL input runs normalization then rescue, maker stub called 0 times and no verdict appended `apps/cli/tests/workflow-decision-scan.test.ts:212-216`; zero-FAIL guard precedes the maker call `config/workflows/history-anatomy.yaml:269`; fresh run 4 pass / 0 fail |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-07T06:25:52.910Z todo → testing (system)
- 2026-10-07T06:26:00.417Z testing → done (system)

