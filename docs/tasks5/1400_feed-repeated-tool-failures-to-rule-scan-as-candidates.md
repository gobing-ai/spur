---
schema_version: 1
name: Feed repeated tool failures to rule-scan as candidates
status: done
template: feature-impl
created_at: 2026-11-18T05:29:36.439Z
updated_at: "2026-11-18T22:35:52.327Z"
feature_id: I61
priority: P2
tags:
  - phase-2
  - protocol-surfaces
estimate_hours: 2

dependencies: ["1398"]
done_forced: "false"
done_reason: unforced close
---

## 1400. Feed repeated tool failures to rule-scan as candidates

### Background

`rule-scan` is an agent procedure, not a CLI verb, and it surveys code for recurring patterns (`plugins/sp/skills/spur-cli/references/rules/operations.md` § scan). Its output contract is `{ concern, evidence, evaluator, route: add|extend|covered }`. The doctor's reflection map already sends automatable findings to "rule candidate" (`spur-doctor/SKILL.md:171`).

**Refine corrections (2026-11-17)**
- "Detect repeated tool/error-code pairs" → 1376's payload carries `tool` and `errorCode` on `mcp.tool.failed`, and `system_events.id` provides citable ids. → Add `failureClusters[]` to 1398's `protocolUsage`, so there is no second query path.
- "Emit rule-scan candidates" → scan has no input channel besides code. Spur rules evaluate the working tree, so many tool-failure clusters are not file rules at all (they are guidance or input-validation fixes). → Scan gains an event-evidence hunt source that reads the artifact. Each cluster is routed through the existing placement rule, and adds a `not-a-rule` route that hands off as a task with the finding key.
- "Never activate rules automatically" → already guaranteed, because scan is propose-only and `add` needs confirmation. → Kept as an assertion in the doc, not new code.

### Requirements

- [x] R1. `protocolUsage.failureClusters[]`: `{ tool, errorCode, count, firstAt, lastAt, sampleEventIds (max 5) }` for `(tool, errorCode)` pairs with `count >= 3` in the window, sorted by count descending.
- [x] R2. Anatomy finding key `repetition:mcp-tool:<tool>:<errorCode>` per cluster, citing `sampleEventIds` as its evidence anchor.
- [x] R3. The rule-scan procedure adds an event-evidence source. It reads `spur history analyze --since <30d> --json` → `protocolUsage.failureClusters`, and maps each cluster to a candidate with `evidence: count + sample event ids`. The route list gains `not-a-rule` (→ task carrying the finding key).
- [x] R4. The scan doc restates that candidates are proposals and rules are written only by `add` on confirmation.

### Acceptance Criteria

- [x] AC1 — Repeated tool failures become rule candidates (req: R1, R2, R3, R4)

Test layer: domain analytics test on in-memory SQLite, plus the scan procedure documentation (the agent procedure has no executable surface).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T06:09:02.230Z

- **New `spur rule scan` verb?** No. That would be a public-surface change; scan stays an agent procedure reading the artifact.
- **Cluster threshold?** A constant of 3 (the feature says "repeatedly"), the same constant style as 1399.

### Design

**WHAT.** One more fold in 1398's module, one finding key, and a documentation step in the scan procedure. No new verb or table.

**WHY.** It reuses the evidence plane and the propose-only contract already in place. `not-a-rule` stops the scan from forcing a file rule onto a runtime failure.

**WHERE.**
- `packages/domain/src/analytics/protocol-usage.ts`
- `plugins/sp/skills/history-anatomy/references/report-contract.md`
- `plugins/sp/skills/spur-cli/references/rules/operations.md` § scan

**Anti-patterns.**
- No error-message text in clusters (`errorCode` only; `error` is redacted).
- No automatic `add`.
- Don't cluster on argument values.

### Plan

- [ ] Step 1 (test first, R1): extend the 1398 domain test with 3× the same `(tool, errorCode)`, 2× another pair (not clustered) and the window boundary.
- [ ] Step 2: implement the fold.
- [ ] Step 3 (R2-R4): contract key and scan procedure step.
- [ ] Step 4: `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/tests/services/history-anatomy.test.ts:627` |
| `packages/domain/src/analytics/artifact-digest.ts:74` |
| `packages/domain/src/analytics/protocol-usage.ts:107` |
| `packages/domain/src/analytics/protocol-usage.ts:118` |
| `packages/domain/src/analytics/protocol-usage.ts:147` |
| `packages/domain/src/analytics/protocol-usage.ts:155` |
| `packages/domain/src/analytics/protocol-usage.ts:163` |
| `packages/domain/src/analytics/protocol-usage.ts:171` |
| `packages/domain/src/analytics/protocol-usage.ts:211` |
| `packages/domain/src/analytics/protocol-usage.ts:288` |
| `packages/domain/src/analytics/protocol-usage.ts:58` |
| `packages/domain/src/analytics/protocol-usage.ts:93` |
| `packages/domain/tests/analytics/protocol-usage.test.ts:139` |
| `packages/domain/tests/analytics/protocol-usage.test.ts:200` |
| `packages/domain/tests/analytics/protocol-usage.test.ts:207` |
| `packages/domain/tests/analytics/render-forensics.test.ts:550` |
| `plugins/sp/skills/history-anatomy/references/report-contract.md:62` |
| `plugins/sp/skills/spur-cli/references/rules/operations.md:204` |
| `plugins/sp/skills/spur-cli/references/rules/operations.md:217` |
| `plugins/sp/skills/spur-cli/references/rules/operations.md:222` |
| `packages/domain/coverage/lcov.info:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — `protocolUsage.failureClusters[]`: `{tool, errorCode, count, firstAt, lastAt, sampleEventIds (max 5)}` for pairs with `count >= 3`, count-descending | MET | `packages/domain/src/analytics/protocol-usage.ts:74,77` (constants), `:213-233` (fold), `:288-296` (filter + order); `packages/domain/tests/analytics/protocol-usage.test.ts` 7/7 — cluster threshold with a pair under it and an out-of-window row that must not lift it, the 5-id cap, `firstAt`/`lastAt`, and count-descending order over two clusters |
| R2 — finding key `repetition:mcp-tool:<tool>:<errorCode>` per cluster citing `sampleEventIds` | MET | `plugins/sp/skills/history-anatomy/references/report-contract.md` new row in the surface-findings table (anchored on `protocolUsage.failureClusters[]`, `count >= 3`, anchored on `sampleEventIds`); structure-gate fixture in `packages/app/tests/services/history-anatomy.test.ts` proves the key passes the closed-category gate (69/69) |
| R3 — rule-scan procedure reads `spur history analyze --since <30d> --json` → `protocolUsage.failureClusters`, maps each cluster to a candidate with `evidence: count + sample event ids`, and the route list gains `not-a-rule` (→ task carrying the finding key) | MET | `plugins/sp/skills/spur-cli/references/rules/operations.md` § scan step 2 (event-evidence paragraph naming the command, the cluster fields and the key) and step 5 route list (`add |
| R4 — the scan doc restates that candidates are proposals and rules are written only by `add` on confirmation | MET | same file, output-contract paragraph: "The list is a **proposal set**: no candidate is applied by the scan, and a rule file is written only by `add` after the operator confirms it (R4)"; the pre-existing propose-only preamble is retained |
| Anti-patterns — no error-message text, no automatic `add`, no argument-value clustering | MET | clusters carry `errorCode` only (`packages/domain/src/analytics/protocol-usage.ts:213`, `:221`); a test asserts the cluster JSON never contains the message text; the doc forbids authoring in scan |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Repeated tool failures become rule candidates (R1,R2,R3,R4) | MET | test | `packages/domain/tests/analytics/protocol-usage.test.ts` 7/7 (domain proof of the cluster semantics), `packages/app/tests/services/history-anatomy.test.ts` 69/69 (key passes the gate); the procedure itself is documentation — no executable surface exists, as the task states |
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

- 2026-11-18T08:47:25.651Z todo → wip (system)
- 2026-11-18T08:48:06.630Z wip → testing (system)
- 2026-11-18T08:48:08.032Z testing → done (system)

