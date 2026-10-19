---
schema_version: 1
name: Decision outcome pairing and accuracy report for catalog decisions
status: todo
template: issue
created_at: 2026-10-19T18:27:32.374Z
updated_at: "2026-10-19T18:58:09.127Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P2
dependencies: ["1262"]
feature_id: P1
---

## 1263. Decision outcome pairing and accuracy report for catalog decisions

### Background

Spur measures decision makers by acceptance rate and confidence only
(`spur decision status --reliability`). Neither says whether a decision was right. The 2026-10-19
audit (task 1262 § Background) showed why that matters:

- `review-failure-class` (fm-local) was accepted 15/15 at confidence 1.0 and always answered its
  own fallback. A perfect acceptance rate carried no information.
- `task-triage` (clef) was accepted 2/36. Nothing records whether the 34 fallbacks cost anything.
- Sampled makers report unanimity, not calibration (ts-libs
  `docs/design/llm-agent-decision-backend.md` § Confidence granularity), so a confidence floor
  alone cannot be tuned against them.

Choosing a maker per decision, tuning `minConfidence`, and judging a shadow maker (ts-libs
ADR-040) all need (value, outcome) pairs. This task produces those pairs for the task-pipeline
decisions that remain after task 1262, and extends the existing reliability report with them.

Current state:
- Every catalog decision already gets an `invocationId` (`decision-events.ts:206`), and the same
  id keys its `decision_logs` row. The id is not returned to the caller, so the `.decision`
  result file cannot be joined to the ledger.
- `catalogRow` writes `evidenceDigest: null` (`decide.ts:326`); the real digest exists only on
  `decision.start`.
- Outcomes already exist in artifacts the pipeline writes but nothing links them: the task's
  `## Review` P1–P4 findings, `.spur/run/<wbs>-review.status`, and `.spur/run/<runId>-gate.status`
  on each gate visit. `.spur/run/<wbs>-verdict.json` has no findings or severity field, so it is
  not an outcome source.
- After task 1262 the task-pipeline decisions are `failure-class` and, if its evidence bar is met,
  `task-semantic-risk`. `review-failure-class` and `task-triage` are gone.

### Requirements

- [ ] R1. **Results carry their ledger key.** `DecisionInvocation` exposes `readonly invocationId: string`; `ServedDecision` gains `invocationId: string` and `evidenceDigest: string | null`. `catalogRow` (`decide.ts:300-329`) writes both (new field `invocationId`; `evidenceDigest` replaces the hard-coded `null`). Degraded rows that never opened an invocation (disabled, `no-evidence`, inline) write `invocationId: null`.
- [ ] R2. **Outcome event and verb.** Register `decision.outcome` in `packages/app/src/services/event-names.ts` (catalog entry beside `decision.end` at `:376`, presenter beside `:1693`). Payload `data`: `{ invocationId, decisionId, outcome, source }`; the row's `run_id` is copied from the matching `decision.end`. New verb `spur decision outcome <invocation-id> <outcome> [--source <text>] [--json]`, or `--review-severity <wbs>` in place of `<outcome>`. Unknown invocation id → exit 1. `outcome` must match `^[a-z0-9-]{1,32}$` → otherwise exit 2. First write wins: a second call for the same invocation id exits 0 and reports `recorded: false`.
- [ ] R3. **task-pipeline records outcomes deterministically.** (a) `failure-class`: on a gate visit whose mode is `recheck`, after `quality-gate` and before the new `failure-class` decide, record the previous row's outcome as `fixed` (gate status PASS) or `not-fixed` (otherwise); skip when its `invocationId` is null. (b) `task-semantic-risk`, only if task 1262 kept it: in `review.onEnter` after `review.status` is written, record `--review-severity <wbs>`. Both steps are shell actions that end in `exit 0`, so outcome recording never changes routing.
- [ ] R4. **The reliability report shows accuracy.** `decisionSummary` and `decisionReliability` join `decision.outcome` rows by `invocationId`. Each group gains `outcomes: Record<string, number>` (samples with a recorded outcome, by outcome), `accuracy: number | null` (accepted samples whose outcome is in the expected set for their value ÷ accepted samples that have an outcome) and `fallbackAccuracy: number | null` (the same over fallback samples). Null when there is no mapping or no outcome. Text output adds one line per group; `--json` carries the fields.
- [ ] R5. **Expected outcomes live in Spur config.** `DecisionsConfigSchema` (`packages/config/src/index.ts:846-851`) gains optional `outcomeMap: Record<decisionId, Record<valueAsString, string[]>>`. `config/config.global.yaml` ships defaults for `failure-class` (`fix` → `[fixed]`, `stop` → `[not-fixed]`) and `task-semantic-risk` (`"false"` → `[none, p4, p3]`, `"true"` → `[p1, p2]`).
- [ ] R6. **Docs.** `plugins/sp/skills/spur-cli/references/decision.md` and `docs/design/decision-observability-and-adoption.md` explain the outcome verb, the report fields, acceptance versus accuracy, that sampled-maker confidence means unanimity, and how to retune a decision's `minConfidence` from the report.

### Acceptance Criteria

```gherkin
Scenario: AC1 — a decision result joins its ledger rows (req: R1)
  Given a catalog decide step served by a maker double with the ledger attached
  When the step writes its result file
  Then the file's invocationId equals the decision.end payload invocationId and the decision_logs id, and its evidenceDigest equals the decision.start digest

Scenario: AC2 — the outcome verb records once and refuses unknown ids (req: R2)
  Given a ledger with one decision.end row
  When `spur decision outcome <id> fixed --json` runs twice and once with an unknown id
  Then the first call records one decision.outcome row with the run id, the second reports recorded false, and the unknown id exits 1

Scenario: AC3 — the review severity becomes the outcome (req: R2, R3)
  Given a task whose Review table has a FIXED P2 row and an open P4 row
  When `spur decision outcome <id> --review-severity <wbs>` runs
  Then the recorded outcome is p2

Scenario: AC4 — a recheck gate records the previous failure class outcome (req: R3)
  Given a task-pipeline fixture run whose first gate is red and whose recheck gate is green
  When the recheck gate visit runs
  Then the first failure-class decision has outcome fixed and routing is unchanged

Scenario: AC5 — the reliability report scores accuracy from the outcome map (req: R4, R5)
  Given recorded decisions with outcomes and the shipped outcomeMap
  When `spur decision status --reliability --json` runs
  Then each group carries outcome counts, accuracy and fallbackAccuracy, and a decision without a mapping reports null accuracy

Scenario: AC6 — the reading guide exists (req: R6)
  Given the decision CLI reference
  When a reader looks up the outcome verb and the reliability fields
  Then it explains acceptance versus accuracy, sampled-maker unanimity, and retuning minConfidence
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-19T18:58:08.024Z

- **Q: Feature?** A: P1. This extends scenario R9 ("A reliability report summarizes recorded decision outcomes per decision and maker") from acceptance to accuracy. Scenarios are task-specific, so `ac_altitude: task-local`.
- **Q: A new `spur decision report` command, as the first draft proposed?** A: no. Extend `--reliability`; one report, one reader.
- **Q: A new `decisionCallId` key?** A: no. `invocationId` already keys `decision.*` events and `decision_logs`; reuse it.
- **Q: Put `outcomes:` in the catalog?** A: no. The catalog schema belongs to ts-libs (ADR-033). The mapping is Spur's interpretation of Spur's artifacts, so it lives in Spur config.
- **Q: Why does the review-severity outcome ignore the disposition column?** A: the question is whether the diff was risky. A P2 the remediation later fixed was still there. Use `parseReviewFindings` (`packages/app/src/services/residual-scan.ts:123`) with an option that keeps FIXED/RESOLVED rows; do not change its default.
- **Q: Does this need a P1 evidence bar?** A: no. It adopts no new decision point; it only records outcomes of existing ones.
- **Q: How much data before the report is useful?** A: about 36 triage calls in 11 days, so expect weeks. Start recording as soon as this lands; do not wait to tune anything.
- **Q: Shadow makers (ts-libs task `0119`)?** A: out of scope. Once a shadow result carries its own `invocationId`, this report covers it unchanged.

### Design

**Frozen names**

| Item | Name |
|---|---|
| Event | `decision.outcome` (category `decision`, entity `decision`) |
| Verb | `spur decision outcome <invocation-id> [<outcome>] [--review-severity <wbs>] [--source <text>] [--json]` |
| JSON result | `{ invocationId, decisionId, outcome, recorded: boolean }` |
| Result-row field | `invocationId: string \| null` |
| Report fields | `outcomes`, `accuracy`, `fallbackAccuracy` on `DecisionReliabilityGroup` |
| Config | `decisions.outcomeMap` |
| Outcome vocabulary shipped | `fixed`, `not-fixed`, `none`, `p1`–`p4` |

**Flow.** decide step → result file with `invocationId` → a later shell step in the same run reads
it with `jq -r '.invocationId // empty'` → `$spurBin decision outcome "$id" …` → `decision.outcome`
row → `--reliability` joins outcome to `decision.end` by `$.data.invocationId`.

**Verb rules.** Look up the `decision.end` row by `json_extract(payload_json, '$.data.invocationId')`.
Read the first-write-wins check and the insert through `SystemEventDao`; do not add a table or
migration. Value matching for accuracy uses `String(value)`, so noul `true`/`false` match the
config keys `"true"`/`"false"`.

**Pipeline placement.** (a) The failure-class outcome step sits in `gate.onEnter` between the
`quality-gate` action (`task-pipeline.yaml:511-519`) and the `failure-class` decide (`:520-531`),
guarded by `[ "$gateMode" = recheck ]`, because on the first visit the `.decision` file may be
stale from an earlier run. (b) The severity step sits after the `review.status` write
(`task-pipeline.yaml:686-692`), runs only when `.spur/run/$wbs-semantic-risk.decision` exists, and
relies on first-write-wins so later review visits are no-ops.

**Anti-patterns**
- Do not let an outcome step fail the run: every command ends with `; exit 0`.
- Do not have a model judge another model's outcome.
- Do not infer outcomes from `verdict.json`; it has no severity field.
- Do not change `parseReviewFindings` default behaviour (residual-scan relies on dropping FIXED rows).
- Do not add a ts-libs catalog field or a new DB table.

### Plan

1. **R1.** Failing test (AC1) in `packages/app/tests/workflow/` with a maker double and an in-memory ledger. Expose `invocationId` on `DecisionInvocation` (`packages/app/src/decision/decision-events.ts:94-100,206`), return it and the digest from `DecisionService.decide` (`packages/app/src/decision/decision-service.ts:134,494-531`), and write both in `catalogRow` (`packages/app/src/workflow/actions/decide.ts:300-350`).
2. **R2.** Failing CLI E2E (AC2, AC3) in `apps/cli/tests/commands/decision.test.ts`. Add the event and presenter in `packages/app/src/services/event-names.ts`, a small app-layer function for record/lookup, the `--review-severity` path using `parseReviewFindings` with a keep-resolved option, and the verb in `apps/cli/src/commands/decision.ts` beside `status` (`:244`).
3. **R3.** Add the two shell steps to `config/workflows/task-pipeline.yaml`; fixture-run test (AC4) next to the existing task-pipeline workflow tests; `guard-parity.test.ts` must stay green (no guard or topology change).
4. **R5 then R4.** Schema field and defaults; then the join in `packages/domain/src/dao/system-event-dao.ts:582-600` and the group fields in `packages/app/src/decision/decision-reliability.ts`; extend `packages/app/tests/decision/decision-reliability.test.ts` (AC5).
5. **R6.** Docs; AC6 is the doc review.
6. Run `bun run spur-check` and `bun run build`; `git status` shows only this task's files.

### Root Cause

Missing capability, not a defect. The decision lifecycle ends at `decision.end`
(`packages/app/src/decision/decision-events.ts:200-260`), and the only consumer is the
acceptance-based summary (`packages/domain/src/dao/system-event-dao.ts:582-600`,
`packages/app/src/decision/decision-reliability.ts:36-70`). No event or table records what
happened after a decision, and the caller never learns the `invocationId` it could key one on
(`ServedDecision` at `packages/app/src/decision/decision-service.ts:134` is
`DecisionResult & { makerSource }`).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature P1 scenario R9; task 1262 (removes `review-failure-class`, replaces `task-triage`, adds `skipWhenEvidenceEmpty`).
- Code: `packages/app/src/decision/decision-events.ts:94-100,200-260`; `packages/app/src/decision/decision-service.ts:134,413-560`; `packages/app/src/workflow/actions/decide.ts:300-350`; `packages/app/src/decision/decision-reliability.ts:36-70`; `packages/domain/src/dao/system-event-dao.ts:265-293,582-600`; `packages/app/src/services/event-names.ts:373-376,1612-1700`; `packages/app/src/services/residual-scan.ts:111-140`; `packages/config/src/index.ts:846-851`; `apps/cli/src/commands/decision.ts:244-290`.
- Workflow: `config/workflows/task-pipeline.yaml:495-531,609-706`.
- ts-libs: ADR-040 (shadow makers, `DecisionResult.error`); `docs/design/llm-agent-decision-backend.md` § Confidence granularity.
- knowledge-kit task 0317 R4 (the same labels × selections idea there).

### History
