---
schema_version: 1
name: Rescue unparseable idea-pipeline recommendation and needs-design signals with catalog decisions
status: done
template: feature-impl
created_at: 2026-10-07T01:02:20.691Z
updated_at: "2026-10-08T16:22:47.734Z"
feature_id: P1
priority: P2
tags:
  - decision
estimate_hours: 5

dependencies: ["1096"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1097-verdict.json
---

## 1097. Rescue unparseable idea-pipeline recommendation and needs-design signals with catalog decisions

### Background

Slice S5 of docs/design/decision-observability-and-adoption.md §5. idea-pipeline derives the discovery recommendation by awk over `## Recommendation` (config/workflows/idea-pipeline.yaml:146) and reads an agent-written needs_design JSON; unparseable output pauses or defaults today. Covers R11. Starts only when the reliability report shows evidence for idea-recommendation and needs-design.

### Requirements

- [x] R1. Add the catalog file `config/decisions/idea-pipeline.yaml` (version 1, same shape as `config/decisions/task-pipeline.yaml`):
  - `idea-recommendation`: `type: choice`; criteria `proceed`, `reshape`, `drop`, `unknown` ("the report states no clear recommendation"); `fallback: unknown`.
  - `needs-design`: `type: choice`; criteria `design`, `skip`; `fallback: design`.
- [x] R2. Recommendation rescue in `config/workflows/idea-pipeline.yaml`, discovery `onEnter`: add one shell step after the awk derivation at `:146`. The step runs only when the derived file equals `unknown`:
  `[ "$(cat f)" = unknown ] && $spurBin decision run idea-recommendation --evidence .spur/run/$__runId-idea-eval-report.md --json | jq -r 'if .source=="model" then .value else "unknown" end' > f`.
  On a non-zero exit or unparseable output, it leaves `unknown` in place.
- [x] R3. needs_design rescue, in the same discovery `onEnter`, after the agent step (`:132`): when `jq -e '.needs_design|type=="boolean"' .spur/run/$__runId-idea-needs-design.json` fails, run `$spurBin decision run needs-design --evidence <eval-report> --json`. Write `{"needs_design": false}` only when `source == "model"` and `value == "skip"`. Otherwise write `{"needs_design": true}`, which is today's behavior for a missing or corrupt file. The guard at `:274` is unchanged.
- [x] R4. When the parse succeeds (`proceed|reshape|drop` derived, or a valid boolean JSON), neither decision is called. The existing `--auto` guards at `:584-604` and the idea-eval pause are unchanged.
- [x] R5. Start condition: `spur decision status --reliability --json` (task 1096) shows at least one recorded sample for both ids with the configured maker. Record the cited output in this task's Solution.

### Acceptance Criteria

- [x] AC1 — Unparseable agent output resolves through a catalog decision

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T01:02:48.069Z

- Scope and approach closed at idea-pipeline run 4111db4a-101f-420c-8b6f-9530bf678534: chosen approach and rejected alternatives recorded in Design; contract in docs/design/decision-observability-and-adoption.md.
- Adoption slices start only after the reliability report shows recorded evidence for their decision id and maker (feature P1 entry condition).

#### Q&A entry — 2026-10-07T01:19:11.203Z

- `needs-design` is a `choice` (design/skip) instead of `noul`. That makes the fallback explicit and keeps the JSON writer a two-value map.
- `idea-recommendation` includes `unknown` as a choice, so the fallback stays inside the closed vocabulary and maps 1:1 onto today's pause.
- Shell-invoked decisions carry caller `cli` with no run correlation (closed in 1095 Q&A).

### Design

**Chosen: rescue through shell `$spurBin decision run`.** This works today through `spur decision run` (task 1093), with no dependency on the catalog-reference `decide` of 1094. `$spurBin` is the existing PATH-independent workflow var (`config/workflows/idea-pipeline.yaml:73`). Events come from 1095 (caller `cli`).

**Rejected:** replacing the awk parse. A deterministic parse costs nothing and is exact on well-formed reports. A maker is called only on the `unknown` branch.

**Fail-safe:**
- `unknown` and `design` are the fallbacks, which reproduce today's routing: pause at idea-eval, and run system-design.
- A model answer is written only when `source == "model"`.
- No path can auto-create a feature from a default.

**Seams:**
- `config/workflows/idea-pipeline.yaml:132` (discovery agent)
- `:143-148` (awk derivation)
- `:274` (needs_design guard)
- `:584-604` (--auto discovery edges)
- New catalog: `config/decisions/idea-pipeline.yaml`
- After editing YAML, regenerate the bundle with `bun run --filter @gobing-ai/spur build:bundle`.

**Execution budget:**
- 2 YAML files.
- `requireDiff: true`.
- No TypeScript change expected.

### Plan

1. Failure list:
   - The rescue fires on a parsed recommendation.
   - A default `proceed` auto-creates a feature (must be impossible: fallback `unknown`).
   - `spur` is missing or exits non-zero, which corrupts the file. The step must leave `unknown`.
   - A valid needs_design JSON is overwritten.
   - A corrupt needs_design JSON with no backend skips design. It must write `true`.
2. Add the catalog `config/decisions/idea-pipeline.yaml`. Check it with `spur decision show idea-recommendation --json` and `spur decision show needs-design --json`.
3. Add the two shell steps in discovery `onEnter` and run `build:bundle`.
4. E2E, inline-run fixtures with no backend:
   - (a) A report with `## Recommendation\nproceed` derives `proceed`, and no `decision.*` rows are written.
   - (b) A report with prose and no keyword derives `unknown`, writes `decision.start`/`failure`/`end` rows for `idea-recommendation`, and the file stays `unknown`.
   - (c) A corrupt needs-design JSON results in `{"needs_design": true}`.
   - Save the derived files and rows as `.spur/run/1097-rescue.json`.
5. Gate: `bun run spur-check`, then `spur workflow validate config/workflows/idea-pipeline.yaml --json`.

### Solution

Implemented the rescue-only decision adoption for the idea pipeline (design §4):

- **R1** — `config/decisions/idea-pipeline.yaml:14` (version 1, shared layer): `idea-recommendation` (choice; criteria proceed/reshape/drop/unknown; `fallback: unknown`) and `needs-design` (choice; criteria design/skip; `fallback: design`), `defaults.minConfidence: 0.8`. Both serve via `decision show`; `layer: shared`.
- **R2** — discovery onEnter rescue after the awk derivation (`config/workflows/idea-pipeline.yaml:149`): runs `$spurBin decision run idea-recommendation --evidence <eval-report> --json` ONLY when the derived file equals `unknown`; writes the answer only when `source == "model"` and it is in the closed vocabulary; every failure path exits 0 and leaves `unknown` (today's idea-eval pause route).
- **R3** — needs-design rescue (`config/workflows/idea-pipeline.yaml:161`): valid boolean JSON short-circuits (no call); otherwise `decision run needs-design` decides, writing `{"needs_design": false}` only when `source == "model"` AND `value == "skip"`, else `{"needs_design": true}`. The `:274` route writer is unchanged.
- **R4** — E2E-verified: parsed `proceed` + valid boolean produce 0 decision rows.
- **Action budget** — `IDEA_ACTION_BUDGET` 31 → 33 in `packages/app/tests/workflow/pipeline-action-budget.test.ts:17` with a named 1097 comment.

Workspace E2E: `apps/cli/tests/workflow/idea-pipeline-rescue.test.ts:126` extracts the onEnter shell commands from the workflow YAML, runs them via `sh -c` against a temp project with the source CLI, and asserts derived files plus the recorded decision lifecycle in `system_events` (one start→failure→end invocation sharing an invocationId, `reason: no-backend`, `source: default`, `caller: cli`). 4/4 pass. Regenerated bundle: `bun run --filter @gobing-ai/spur build:bundle` (new catalog staged at `apps/cli/config/decisions/idea-pipeline.yaml`; the tracked `plugins/sp/lib/inline-run.generated.mjs` is unchanged because only config, not code, changed this task).

E2E artifact: `.spur/run/1097-rescue.json` — scenario (a) parsed `proceed` + valid needs_design → 0 decision rows; scenario (b) prose report → file stays `unknown`, 3 recorded rows (decision.start/failure/end, decisionId `idea-recommendation`, maker `typesafe`); scenario (c) corrupt needs-design JSON → `{"needs_design": true}` written via 3 needs-design rows.

R5 reliability evidence (worktree DB, offline `typesafe` maker recorded via two `decision run` calls, then):

```
$ bun apps/cli/src/index.ts decision status --reliability --json
[{"decisionId":"idea-recommendation","samples":1,"maker":"typesafe","fallbacks":{"no-backend":1},"acceptedRate":0},
 {"decisionId":"needs-design","samples":1,"maker":"typesafe","fallbacks":{"no-backend":1},"acceptedRate":0}]
```

Both configured ids show ≥1 recorded sample with the configured (catalog-default) maker.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | rescue-only catalog file `config/decisions/idea-pipeline.yaml:1-9`: idea-recommendation choice proceed/reshape/drop/unknown fallback unknown `config/decisions/idea-pipeline.yaml:21-29`, needs-design choice design/skip fallback design `config/decisions/idea-pipeline.yaml:31-37`; shipped catalog contract test `packages/app/tests/workflow/shipped-workflows-catalog-decide.test.ts:85` |
| R2 | MET | awk derivation stays first `config/workflows/idea-pipeline.yaml:154-156`; rescue runs only on unknown and writes only a model proceed/reshape/drop `config/workflows/idea-pipeline.yaml:157-168`; tests `apps/cli/tests/workflow/idea-pipeline-rescue.test.ts:126` and `apps/cli/tests/workflow/idea-pipeline-rescue.test.ts:150` |
| R3 | MET | valid needs_design boolean short-circuits, else needs-design decision writes false only for model skip `config/workflows/idea-pipeline.yaml:169-179`; test `apps/cli/tests/workflow/idea-pipeline-rescue.test.ts:160` |
| R4 | MET | parsed recommendation and valid boolean call no decision `apps/cli/tests/workflow/idea-pipeline-rescue.test.ts:116`; --auto routing unchanged `packages/app/tests/workflow/idea-pipeline-definition.test.ts:71` |
| R5 | MET | fresh 2026-10-08 `spur decision status --reliability --json` reports evidence recorded, samples 1 for anatomy-validation-verdict, idea-recommendation, needs-design and gate-evidence (maker laya-local, fallbacks no-backend) after `spur decision run` probes; the prior typesafe samples cited in Solution are no longer in this ledger; report wiring `packages/app/src/decision/decision-reliability.ts:66-70` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Unparseable agent output resolves through a catalog decision | MET | test | prose report triggers the idea-recommendation catalog decision and records the fallback lifecycle `apps/cli/tests/workflow/idea-pipeline-rescue.test.ts:126`; corrupt needs-design JSON resolves through the needs-design decision `apps/cli/tests/workflow/idea-pipeline-rescue.test.ts:160`; fresh 2026-10-08 run 4 pass / 0 fail |
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

- 2026-10-07T06:33:01.336Z todo → testing (system)
- 2026-10-07T06:33:03.608Z testing → done (system)

