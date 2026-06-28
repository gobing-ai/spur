---
schema_version: 1
name: "/sp:dev-refine 0129 --auto dogfood findings"
description: ""
status: done
type: review
template: review
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["review"]
dependencies: []
created_at: "2026-06-26T19:14:43.613Z"
updated_at: 2026-06-28T18:40:57.167Z
---

## 0131. /sp:dev-refine 0129 --auto dogfood findings

### Background
#### Review Findings (as captured)

| Severity | File | Finding | Recommendation |
|----------|------|---------|----------------|
| P1 | `ts-ai-runner` capture layer + `sp:spur-dev` refine op | `/sp:dev-refine --auto` depends on `spur agent run` capturing an agentic (tool-using) agent's output, but it is not surfaced: `omp` returns empty stdout on multi-step tool prompts (simple `--mode text` works), `claude` times out on cold-start (exit 143). Refine's core synthesis silently no-ops (exit 0, no section written, no skip-report) | (1) Surface the agentic/tool transcript in `spur agent run`; (2) treat empty synthesis output as a hard failure with a clear message; (3) document supported agents/modes for `--auto` |
| P2 | `sp:spur-dev` refine op | No feedback when synthesis produces nothing — planning-workflow.md:172 promises a report under `--auto`, but empty output yields no report; operator can't tell skip-from-broke | Emit a structured refine result (sections-considered / written / reason) even on no-op |
| P2 | `task check` L3 rule | "Plan should be ordered checklist" fires on `0129` though its Plan IS a checklist (`**Phase A — …:**` headers + `- [ ] A1.` items); checker doesn't recognize bold-phase-header + checkbox form | Teach the L3 Plan check to recognize `**<heading>**` phases containing `- [ ]` items as valid ordered form |
| P2 | `sp:spur-dev` refine op | No "already-well-specified → skip gracefully" branch: `0129` had operator-confirmed Design+Plan yet `--auto` still tried to synthesize | Add a pre-synthesis quality gate — if `task check` PASS and sections already meet L3 structure, emit SKIP with reason instead of invoking the agent |
| P3 | (context-window) | Low cache hit rate (~44% aggregate; synthesis steps ~25–27%); failed omp/claude invocations each resent full prompt scaffolding | Batch gap-analysis + synthesis prompt; reuse read-task context across retries |

Source: `docs/dogfood/2026-06-26-dev-refine-0129-auto-dogfood.md`

#### Finding disposition (verified 2026-06-28, post 0132/0133/0139)

The dogfood ran **before** 0132/0133/0139 landed. Re-verifying each finding against the current
tree shows three of five are dead or moot. Only the L3 Plan-checker false positive is a clean,
confirmed code defect; the skip-gate is a real but minor UX enhancement.

| Finding | Severity | Disposition | Evidence |
|---------|----------|-------------|----------|
| #1 — `spur agent run` agentic-transcript capture / silent no-op | P1 | 💤 **Superseded by 0132** (done) for the default path | 0132 made inline `--auto` synthesize **in-session** (`dev-refine.md:29,59-63`) — refine no longer shells out to `spur agent run`, so the capture bug cannot cause the silent no-op the dogfood hit. The capture layer only affects an explicit `--agent <name>` spawn, which is out of this task's scope. |
| #2 — no feedback on no-op synthesis | P2 | 💤 **Mostly moot via 0132** | In-session synthesis can't "silently no-op" the way the spawned path did. No separate fix carried here. |
| #3 — L3 Plan check false-positives on `**Phase**` + `- [ ]` | P2 | ✅ **LIVE — fixed here** | `packages/app/src/services/task-check.ts:188` tests only the first line after `trimStart()`; a bold-phase-header opener defeats the `^[-*]`/`^\d.` list regex. Reproducible. |
| #4 — no "already-well-specified → skip" gate | P2 | ✅ **LIVE — addressed here** | Orthogonal to 0132/0133. The refine op has no pre-synthesis skip branch. |
| #5 — low cache hit rate | P3 | ❌ **Dead — cancelled by 0139** | 0139 cancelled the equivalent F6: cache% is a self-reported estimate, unverifiable without per-step telemetry Spur does not have (0130 disposition table). No work carried. |

#### Constraints

**In-scope:** R1 (L3 Plan-checker fix in `packages/app/src/services/task-check.ts` + test), R2
(refine-op skip gate, doc + skill prose in `plugins/sp/skills/spur-dev/`).

**Out-of-scope (with reason):**
- Finding #1's `spur agent run` agentic-transcript capture (a `ts-ai-runner` investigation) — the
  default refine path no longer spawns after 0132, so the silent no-op the dogfood hit cannot recur;
  hardening the explicit-`--agent` spawn is a separate concern, not this task.
- Finding #5 cache-hit instrumentation — cancelled by 0139; Spur has no per-step token telemetry to
  verify a before/after, so the work is unverifiable by design.
- Redesigning the `task check` layering, the refine Q&A flow, or the dual-workflow FSM.

**Boundary:** changes land in `packages/app/src/services/task-check.ts` (+ its test) and
`plugins/sp/skills/spur-dev/**` (+ the refine command doc if the contract surface changes). No CLI
flag changes, no schema changes.

**Safety:** the L3 change is permissive-only (it can stop flagging valid forms, never start flagging
new ones) — verify existing `task-check` tests stay green so prose-only Plans still warn as before.
### Requirements
Scoped to the **live** findings only (see Background disposition table). #1/#2 are superseded by
0132, #5 is cancelled by 0139 — none carry implementation work here.

- [x] R1 (P2-#3) — The L3 Plan check recognizes a Plan that opens with a `**<phase heading>**`
      line and contains `- [ ]` checklist items anywhere in the body as a valid **ordered** form,
      and no longer emits the "should be ordered checklist or table" warning for it. The fix scans
      all lines for a list/table marker rather than only the first line after `trimStart()`. A
      regression test encodes the exact `0129`-shape Plan (bold-phase header + `- [ ]` children).
- [x] R2 (P2-#4) — The `sp:spur-dev` refine op gains a pre-synthesis skip gate: when `--auto` is
      set, `task check` is PASS, and the target sections already meet L3 structure, refine emits a
      structured **SKIP** result (sections-considered / reason) instead of invoking synthesis. The
      gate is documented in the refine operation reference so a fresh agent reads the same contract.
- [x] R3 — The verification gate stays green: `bun run lint` + `bun run test` + `bun run test-cf` +
      `bun run build`. No test skipped or commented out to pass.
### Plan
Two live work items (R1, R2). R1 first — it's a confirmed defect with a one-line fix and a
regression test; R2 is a doc/skill-prose enhancement.

**P1 — Fix the L3 Plan checker (R1).**
- [x] P1.1 — In `packages/app/src/services/task-check.ts:188`, replace the first-line-only test with
      an all-lines scan: the Plan counts as ordered if **any** line matches `^\s*[-*]\s` /
      `^\s*\d+\.\s` (per-line, multiline) OR the body contains a table (`|`). Bold-phase headers
      between list items no longer defeat the check. (Landed: `m` flag added, `trimStart()` removed.)
- [x] P1.2 — Add a regression test in `packages/app/tests/services/task-check.test.ts`: a Plan
      shaped like `0129`'s (`**Phase A — …:**` header + `- [ ]` A1.` items) produces **no** L3 Plan
      warning; a free-form prose Plan still **does** warn (guard the permissive change against
      over-matching). (Landed: `task-check.test.ts:592` + `:630`.)

**P2 — Refine pre-synthesis skip gate (R2).**
- [x] P2.1 — Add the skip-gate contract to the refine operation reference
      (`plugins/sp/skills/spur-dev/references/dev-operations.md` refine row +
      `planning-workflow.md` refine procedure): under `--auto`, if `task check` is PASS and the
      target sections already satisfy L3 structure, emit a structured SKIP
      (sections-considered / reason) instead of synthesizing.
- [x] P2.2 — Reflect the skip result shape in the refine command doc (`dev-refine.md`) so the
      operator sees the SKIP outcome documented alongside the normal flow.

**P3 — Verify + reflect.**
- [x] P3.1 — Gate: `bun run lint && bun run test && bun run test-cf && bun run build` green;
      `git status` shows only intentional changes.
- [x] P3.2 — Fill `### Review` with the post-fix disposition per finding and confirm the Background
      disposition table matches the final state.
### Solution
**R1 — L3 Plan checker fix**

- `packages/app/src/services/task-check.ts:188` — Changed `/.../. test(planBody.trimStart())` to `/.../m.test(planBody)`. Added the `m` flag so `^` matches the start of every line in the body; removed `trimStart()` so the full body is scanned. A Plan opening with bold-phase headers followed by `- [ ]` items on later lines now correctly detects as an ordered form.
- `packages/app/tests/services/task-check.test.ts:592` — Added regression test "Plan with bold-phase header followed by checkbox items produces no warning (0129-shape)": seeds the exact `0129` Plan shape, asserts zero L3 Plan warnings.
- `packages/app/tests/services/task-check.test.ts:630` — Added guard test "Plan as free-form prose still warns after permissive fix (guard against over-matching)": bold-phase headers with prose paragraphs (no list markers) still triggers the L3 warning.

**R2 — Pre-synthesis skip gate (doc/skill-prose)**

- `plugins/sp/skills/spur-dev/references/dev-operations.md` — Added "Pre-synthesis skip gate (under `--auto`)" bullet to §5 refine Behavior: gate logic (run `spur task check`, if PASS + no L3 section warnings → emit structured SKIP result, do not synthesize).
- `plugins/sp/skills/spur-dev/references/planning-workflow.md` — Added skip gate paragraph + SKIP result shape to Step 6, after the `--auto` argument table.
- `plugins/sp/commands/dev-refine.md` — Added skip-gate sub-bullet to Workflow step 4, with SKIP result shape and "SKIP is the normal outcome for a well-specified task" framing.
### Testing

**Gate: all four checks green**

- `bun run lint` — Biome + all workspace `tsc --noEmit`: PASS (0 errors, 0 warnings)
- `bun run test` — 1960 pass, 0 fail across 147 files (was 1958 before R1 tests added; 2 new tests land as pass)
- `bun run test-cf` — 1 pass, 0 fail
- `bun run build` — all workspaces succeed

**Traceability**

| Requirement | Test / Evidence |
|-------------|-----------------|
| R1 — L3 Plan check recognizes bold-phase + checkbox form | `task-check.test.ts:592` "Plan with bold-phase header followed by checkbox items produces no warning (0129-shape)" — PASS |
| R1 — free-form prose Plan still warns | `task-check.test.ts:630` "Plan as free-form prose still warns after permissive fix" — PASS |
| R1 — existing L3 tests unaffected | All 44 prior task-check tests remain PASS (permissive-only change) |
| R2 — skip gate in dev-operations.md | Pre-synthesis skip gate bullet added to §5 refine Behavior — present and accurate |
| R2 — skip gate in planning-workflow.md | Skip gate paragraph + SKIP result shape added to Step 6 — present and accurate |
| R2 — skip gate in dev-refine.md | Skip-gate sub-bullet added to Workflow step 4 — present and accurate |
| R3 — no tests skipped | `bun run test` output confirms 0 fail, no `.skip` |
| R3 — git status clean | Only intentional files modified (0142 and section-matrix are pre-existing changes, not part of this task) |

Coverage: N/A (no new coverage threshold risk — the changed line is in a code path already covered by the existing `task-check.test.ts` suite; the new tests directly exercise it).

### Review
Post-implementation reflection on the two live findings (background disposition table confirmed accurate).

| Priority | Status | Note |
|----------|--------|------|
| P1 | N/A | Finding #1 (spur agent run transcript) was superseded by 0132; no work here. |
| P2 (R1 — #3) | DONE | One-line fix in `task-check.ts:188`: `m` flag added, `trimStart()` removed. Scans all lines now. Permissive-only — existing prose-Plan tests still warn; new bold-phase+checkbox test passes. No back-issues. |
| P2 (R2 — #4) | DONE | Skip gate documented in three places: `dev-operations.md` §5 Behavior, `planning-workflow.md` Step 6, `dev-refine.md` Workflow step 4. Structured SKIP result shape is consistent. No back-issues. |
| P3 | N/A | Finding #5 (cache hit rate) cancelled by 0139; no work here. |

**Back-issues surfaced:** none. The fix is narrowly surgical.
### References

### History
- 2026-06-28T18:16:09.771Z backlog → todo (system)
- 2026-06-28T18:26:04.921Z todo → wip (system)
- 2026-06-28T18:27:41.826Z wip → testing (system)
- 2026-06-28T18:27:43.345Z testing → done (system)
