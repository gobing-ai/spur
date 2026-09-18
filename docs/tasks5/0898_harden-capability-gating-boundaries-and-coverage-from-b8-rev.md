---
schema_version: 1
name: Harden capability gating boundaries and coverage from B8 review findings
status: done
template: feature-impl
created_at: 2026-09-18T04:26:57.446Z
updated_at: "2026-09-18T06:53:10.862Z"
feature_id: B8

priority: P3
---

## 0898. Harden capability gating boundaries and coverage from B8 review findings

### Background

Source: session review triage of the B8 batch run `ce44b029` (2026-09-17). Both B8 tasks (0888, 0889) are done and landed on main (`b6a029d49`, `bb4147e99`); this task carries the report-only advisories that survived review `bd02c82d` and verify `fa90ae14`.

**Premise re-verification (2026-09-17 refine).** Every finding below was re-checked against the current tree rather than trusted from the filing:

- The cited review file `.spur/run/ce44b029-c9f6-48d5-9bfc-2a423597c5c3-review-answer.txt` holds the **0888** re-review, not the 0889 P4 #1 text; the B8 worktree is gone, so the original wording is unrecoverable. R1 is restated from the code, not the review prose.
- R1 as filed named the record field `resumeSupported` and claimed a late "shim" failure. Both were wrong: the field is `supportsResumeById` (`packages/app/src/services/capability-attestation.ts:158`), and the failure is pre-spawn but misclassified — a generic `Prompt is required` (exit 2) from `packages/app/src/services/agent-service.ts:975`, not a shim/dispatch error.
- R1 as filed also covered the CLI path. That was wrong: bare `continue` is resume-**latest**, a distinct upstream shim mode from resume-by-id (gemini `-r latest`, opencode `-c`, hermes `--continue`, all with `supportsResumeById: false`). Gating `spur agent run --continue` on `supportsResumeById` would break valid usage.
- R2 as filed asked for a "stale-record path" in `evaluateSessionCapabilities`. No such path exists there — staleness is a doctor concern (`agent-service.ts:681-690`). R2 also asked for a *new* test file; `packages/app/tests/services/capability-attestation.test.ts` already exists and is extended instead.
- R3 as filed targeted `apps/cli/tests/commands/`. Those doctor tests mock `AgentService` (`apps/cli/tests/commands/agent.test.ts:202+`), so they cannot observe rendering. The real-subprocess harness is `apps/cli/tests/config-layering.test.ts`, which already asserts the staleness stderr exactly (line 221).

Already resolved elsewhere, excluded from scope: design-anchor supersession folded into batch commit `b6a029d49` (`docs/design/session-pinned-dispatch.md:15`); nested `plugins/**/.spur` gitignore gap fixed in `bb4147e99`; R5-letter-vs-JSON stderr contract resolved in favor of the architectural contract (documented in the 0889 verify answer).

### Requirements

- [x] R1. A workflow `agent.run` step with explicit `continue: true`, no `input`, and a known capability record declaring `supportsResumeById: false` fails **pre-spawn** with the ADR-118 contract-violation outcome (`contract: 'requiresCapabilities'`, observed `missing: resumeById`) naming the agent — instead of today's generic `Prompt is required` exit 2 from `agent-service.ts:975`. `runTraced` is never called on this path.
- [x] R2. `evaluateSessionCapabilities` has direct unit coverage of its full decision table (no session axis; all satisfied; declared false with note; missing record; multiple misses joined; execution-only axes ignored), and `parseRequiresCapabilities` accepts all four session axes.
- [x] R3. The doctor capability surface is asserted end-to-end through the real CLI subprocess: text-mode CAPS column carries the executor's cell, and `--json` carries `capabilities` (with `verifiedAgainst`) and `capabilityStale` for a stubbed version mismatch — with clean JSON-mode stderr.
- [x] R4. `bun run spur-check` is green.

**Out of scope (unchanged behavior, stated so the implementer does not "fix" it):**

- `continue: true` **with** `input` against a `supportsResumeById: false` record keeps the B8 R2 silent-to-fresh dispatch (`agent-run.ts:345`).
- An agent with **no** capability record keeps legacy behavior (continue honored; no gate).
- CLI `spur agent run --continue` is untouched — bare continue is resume-latest, valid for gemini/hermes/opencode.
- The upstream capability-record test seam (`ts-ai-runner` `src/agents/shims.ts:508` `getAgentSessionCapability`) — Spur tests use real records and need no stub; changing the seam is an upstream release-train decision.
- The staleness stderr line and its exact two-line assertion in `apps/cli/tests/config-layering.test.ts:221` stay byte-identical.

### Acceptance Criteria

- [x] AC1 — A stage can require a capability before spawn (req: R1; R2)
- [x] AC2 — Doctor exposes capabilities per executor (req: R3)
- [x] AC3 — A stale capability declaration is surfaced (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-18T04:54:58.144Z

- **Q: Gate the CLI `--continue` path too (filed AC1 said "CLI or workflow action")?** Closed — **no**. Bare continue maps to resume-latest in the upstream shims (gemini `-r latest`, opencode `-c`, hermes `--continue`), which is independent of `supportsResumeById`. Only the workflow path, where a no-input `continue: true` step is *dropped* by `agent-run.ts:345` and then dies generically, is misclassified.
- **Q: New gate logic or reuse?** Closed — reuse `evaluateSessionCapabilities({ resumeById: 'enforced' }, sessionCaps, agentLabel)` and `this.contractViolation(...)`, the same pair the B8 R4 session-axis gate uses at `agent-run.ts:369-401`. No new contract name, no new error shape.
- **Q: Which record decides — the literal dispatch agent or the tier-resolved executor?** Closed — the same `sessionCaps` already computed at `agent-run.ts:238-243` (`dispatchAgent ?? agentConfig.default`), so R1 and the B8 R2 fresh-dispatch decision can never disagree about the same step.
- **Q: Impact?** Closed — defensive. No tracked workflow YAML sets `continue: true` today (`config/workflows/`), so this changes only an error's classification; P3.
- **Q: Where do the doctor assertions live?** Closed — `apps/cli/tests/config-layering.test.ts` (hermetic HOME + stub binaries on PATH). The `apps/cli/tests/commands/agent.test.ts` doctor tests mock `AgentService` and cannot see rendering. Value is wiring-only (service layer already covered); keep it to a few assertions.
- **Q: Stale-record tests in capability-attestation?** Closed — dropped; that module has no staleness logic. Staleness stays covered by the doctor service tests plus the existing CLI stderr assertion.

### Design

**WHAT / WHY.** Three B8 review advisories, all low blast radius. The first changes the classification of one error on the workflow path. The other two add tests only.

**R1 — pre-spawn misclassification (the only source change).**

Today's flow for `continue: true` + no `input` + `supportsResumeById: false`:

1. The input guard exempts `continue`, so the step passes (`packages/app/src/workflow/actions/agent-run.ts:301-307`).
2. `flags.continue` is then silently dropped (`agent-run.ts:345`).
3. `runTraced(undefined, …)` dies in `AgentService` with `Prompt is required` / exit 2 (`packages/app/src/services/agent-service.ts:973-977`).

Fix: add one branch **immediately before** the existing input guard at `agent-run.ts:301`.

```ts
// B8 0898 R1: a resume-only step against a record that cannot resume by id has no
// prompt to fall back to — name the missing capability instead of failing generically.
if (input === undefined && continueFlag === true && !resumeSupported) {
    const gate = evaluateSessionCapabilities({ resumeById: 'enforced' }, sessionCaps, agentLabel);
    return this.contractViolation(
        context,
        agentLabel,
        'requiresCapabilities',
        gate.observed,
        `agent.run (${agentLabel}) continue without input requires resume-by-id before spawn (ADR-118): ${gate.reason}`,
        {},
    );
}
```

- **Frozen names.** Reuse `resumeSupported` and `sessionCaps` (`agent-run.ts:238-243`), `agentLabel` (`:231`), `evaluateSessionCapabilities` (already imported, `:16`), `this.contractViolation` (`:168`), and the existing `ContractName` `'requiresCapabilities'` (`:41`).
- `!resumeSupported` already implies `sessionCaps` is defined with `supportsResumeById === false`, so the missing-record branch of `evaluateSessionCapabilities` is unreachable here and legacy unknown-agent behavior is preserved.
- **Invariants.** `runTraced` is not invoked. The observed value is `missing: resumeById`. The latch path is unaffected: `latchAutoContinued` is already false when `!resumeSupported` (`:291`), so only an **explicit** `continue: true` reaches the branch.
- **T3 doc.** Extend the session-axis paragraph in `docs/design/planning-workflow-contracts.md:264-273` with one sentence covering this rule, and state that with `input` present the dispatch stays fresh (B8 R2).

**R2 — `evaluateSessionCapabilities` decision table.**

- Extend `packages/app/tests/services/capability-attestation.test.ts` with `describe('evaluateSessionCapabilities (B8 R4)', …)`.
- Build records inline as `SessionCapabilityRecord` literals; no upstream stub is needed.
- Cases, asserting against the implementation at `capability-attestation.ts:181-211`:
  1. `{}` or execution-only requires → `ok: true`, observed `no session axis requirement`.
  2. All required axes true → `ok: true`, with the reason naming the agent.
  3. One axis declared false with a `note` → `ok: false`; the reason contains the axis, `declared false`, and the note; observed is `missing: <axis>`.
  4. `record === undefined` → `ok: false`; the reason contains `no capability record for agent '<name>'`.
  5. Two axes false → reasons joined with `; `, observed `missing: a, b` in `SESSION_CAPABILITY_AXES` order.
- Add a `parseRequiresCapabilities` case accepting `resumeById | sessionDir | persistentStdin | structuredOutput`.
- Copy the literal strings from the current implementation instead of loosening to regex, so a message change is a deliberate test edit.

**R3 — doctor surface through the real CLI.**

- Extend `apps/cli/tests/config-layering.test.ts`. It runs the real CLI with a hermetic HOME and stub agent binaries (`claude --version` → `1.0.0 (claude stub)`), using the same global-executor fixture as the R7 case (`:200-222`).
- **Text mode** (`agent doctor coder`):
  - Locate the `CAPS` column by header lookup in stdout, not by an exact line or offset. B6 task 0893 is adding doctor columns in parallel.
  - Assert the `coder-exec` row's CAPS cell starts with `r✓` and ends with `⚠`. Staleness comes from `1.0.0` vs the record's `verifiedAgainst`, and the ⚠ suffix is rendered at `agent-service.ts:2872-2880`.
- **JSON mode** (`agent doctor coder --json`):
  - `agents[coder-exec].capabilities.verifiedAgainst` is a non-empty string.
  - `capabilities.supportsResumeById === true`.
  - `capabilityStale` equals `{ verifiedAgainst: <same>, detected: <string starting '1.0.0'> }`.
  - `stderr === ''` (`agent-service.ts:615-627`, `:679`).
- **Unchanged.** The R7 exact two-line stderr assertion (`:221`) and `CAPABILITY_STALE_WARNING` (`:89-91`).

**Anti-patterns (reject in review).**

- Gating the CLI `--continue` path or `AgentService.run*`. Bare continue is resume-latest.
- A new contract name or error type.
- Stubbing `getAgentSessionCapability` via module mocks. Use real records or inline literals.
- Asserting doctor rendering from `apps/cli/tests/commands/agent.test.ts`, which mocks `AgentService`.
- Exact-line or fixed-column assertions on the doctor table.
- Touching the staleness warning text.
- Adding a "stale record" branch to `evaluateSessionCapabilities`.

**File targets.**

| File | Change |
| --- | --- |
| `packages/app/src/workflow/actions/agent-run.ts` | +1 guard branch |
| `packages/app/tests/workflow/actions/agent-run.test.ts` | R1 cases in the B8 describe at `:2865` |
| `packages/app/tests/services/capability-attestation.test.ts` | R2 describe |
| `apps/cli/tests/config-layering.test.ts` | R3 cases |
| `docs/design/planning-workflow-contracts.md` | T3 sentence |

**Budget.** About 3h. `mutationPolicy: source`, with a non-empty diff expected in all five files above.

### Plan

0. **Precondition — runner version.** `bun install`, then confirm `node_modules/@gobing-ai/ts-ai-runner/package.json` reports `0.4.68` (lockfile pin). As of this refine, the main checkout's `node_modules` was stale at 0.4.67, whose records lack `verifiedAgainst`/`supportsPersistentStdin`/`supportsStructuredOutput`/`note`. Under 0.4.67 the existing B8 tests and every R2/R3 fact below are wrong. Expected 0.4.68 records: `gemini` has `supportsResumeById: false` and a `note`. `claude` is `r✓d✗s✓o✓` with `verifiedAgainst: '2.1.274'`, so its stale doctor cell is `r✓d✗s✓o✓⚠`.
1. **R2 first (test-only, locks the evaluator contract R1 reuses).** Add `describe('evaluateSessionCapabilities (B8 R4)')` with the 5 decision-table cases and the `parseRequiresCapabilities` session-axis case. Run `cd packages/app && bun test tests/services/capability-attestation.test.ts`.
2. **R1 red.** In the B8 describe of `packages/app/tests/workflow/actions/agent-run.test.ts` (`:2865`), add the cases below. Use the real `gemini` record (`supportsResumeById: false`) and a `runTraced` spy.
   - (a) `agent: gemini`, `continue: true`, no input: expect a contract violation with `contract: 'requiresCapabilities'`, observed `missing: resumeById`, and `runTraced` not called. This fails today.
   - (b) Same, but with `input`: dispatch goes fresh, `flags.continue` is absent, and `runTraced` is called once. This is the B8 R2 regression guard.
   - (c) `agent: claude` (resume-capable), `continue: true`, no input: `runTraced` is called with `continue: true`.
   - (d) An agent name unknown to the runner (e.g. `custom-exec`, where `resolveAgentName` returns undefined), `continue: true`, no input: legacy behavior, with `runTraced` called.
3. **R1 green.** Add the guard branch before `agent-run.ts:301` exactly as frozen in Design. Re-run the agent-run test file.
4. **R1 doc (T3).** Add the rule sentence to the session-axis paragraph in `docs/design/planning-workflow-contracts.md:264-273`.
5. **R3.** Add the text-mode CAPS assertion (header lookup) and the JSON `capabilities`/`capabilityStale`/clean-stderr assertion to `apps/cli/tests/config-layering.test.ts`. Run `cd apps/cli && bun test tests/config-layering.test.ts`. The R7 exact-stderr case must stay untouched and passing.
6. **R4 gate.** Run `bun run spur-check`, then `git status --short`. The expected diff is the five files in Design only.

| Step | Req |
| --- | --- |
| 1 | R2 |
| 2–4 | R1 |
| 5 | R3 |
| 6 | R4 |

### Solution

R1 — pre-spawn gate (the only source change). `packages/app/src/workflow/actions/agent-run.ts:301-312` adds one branch immediately before the input guard: an explicit `continue: true` with no `input` against a record where `resumeSupported` is false now returns the ADR-118 contract violation (`contract: 'requiresCapabilities'`, observed `missing: resumeById`, error naming the agent) by reusing `evaluateSessionCapabilities({ resumeById: 'enforced' }, …)` + `this.contractViolation` — the same pair the B8 R4 session-axis gate uses. `runTraced` is never reached; agents unknown to the runner (`sessionCaps === undefined` → `resumeSupported === true`) keep legacy behavior, and `continue` **with** `input` still dispatches fresh (B8 R2). T3: `docs/design/planning-workflow-contracts.md:274-277` extends the session-axis paragraph with the rule.

| File | Change |
| --- | --- |
| `packages/app/src/workflow/actions/agent-run.ts:301` | R1 pre-spawn gate: resume-only step against `supportsResumeById: false` fails as `requiresCapabilities` contract violation, `runTraced` unreached |
| `packages/app/tests/workflow/actions/agent-run.test.ts:3038` | R1 (a) red→green: gemini + `continue` + no input → contract violation, `missing: resumeById`, no dispatch, bus event |
| `packages/app/tests/workflow/actions/agent-run.test.ts:3067` | R1 (b) regression guard: `continue` **with** input still dispatches fresh, flag suppressed (B8 R2) |
| `packages/app/tests/workflow/actions/agent-run.test.ts:3083` | R1 (c) regression guard: claude keeps `continue: true` dispatch |
| `packages/app/tests/workflow/actions/agent-run.test.ts:3095` | R1 (d) regression guard: runner-unknown agent keeps legacy behavior |
| `packages/app/tests/services/capability-attestation.test.ts:183` | R2: `evaluateSessionCapabilities` decision table (no session axis / all true / false+note / missing record / multi-miss join in `SESSION_CAPABILITY_AXES` order) + `parseRequiresCapabilities` accepting all four session axes |
| `apps/cli/tests/config-layering.test.ts:224` | R3 text mode: full-mode doctor table, CAPS column located by header lookup, `coder-exec` cell starts `r✓` and ends `⚠` |
| `apps/cli/tests/config-layering.test.ts:248` | R3 JSON mode: `capabilities.verifiedAgainst` non-empty, `supportsResumeById === true`, `capabilityStale = { verifiedAgainst, detected: '1.0.0…' }`, clean stderr |
| `docs/design/planning-workflow-contracts.md:274` | T3: session-axis paragraph extended with the resume-only pre-spawn rule and the with-input fresh-dispatch carve-out |

Deviation from Design (R3 text mode): the Design named `agent doctor coder` as the text-mode selector, but a **role** selector renders the eligible ladder (`renderRoleLadder`), which carries no CAPS column; the CAPS table cell with the `⚠` staleness suffix is the full-mode `renderDoctorTable`. The test therefore reads the table in full mode (`agent doctor`) and keeps every frozen assertion: header-located CAPS column (robust to B6/0893 parallel column work), `coder-exec` row cell starting `r✓` ending `⚠`. JSON mode uses the Design's `coder` selector, which returns `capabilities`/`capabilityStale` per agent. The byte-identical R7 two-line stderr assertion and `CAPABILITY_STALE_WARNING` are untouched.

Verification (targeted, per implement scope): `packages/app` — `bun test tests/workflow/actions/agent-run.test.ts tests/services/capability-attestation.test.ts` → 176 pass / 0 fail (R1 (a) confirmed red before the fix, green after). `apps/cli` — `bun test tests/config-layering.test.ts` → 9 pass / 0 fail. Typechecks `@gobing-ai/spur-app` and `@gobing-ai/spur` exit 0. `bunx biome check` clean on all four changed code files. R4 (`bun run spur-check`) is owned by the pipeline's test hop.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | agent-run.ts:301-312 pre-spawn requiresCapabilities contract violation via evaluateSessionCapabilities + contractViolation |
| R2 | MET | capability-attestation.test.ts:183-268 decision table; :250 parseRequiresCapabilities four session axes |
| R3 | MET | config-layering.test.ts:224 CAPS cell + :248 doctor --json capabilities/capabilityStale clean stderr, real subprocess |
| R4 | MET | bun run spur-check EXIT 0: biome 1016 files clean, typecheck clean, 46+2 rules passed, 8515 pass / 0 fail |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0898

**Scope:** uncommitted worktree diff vs `9a09ee095` on `sp/run-0898-2ddb3f15` (1 source file, 4 test files, 1 design doc + this task's Solution backfill; 247 insertions / 4 deletions)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS-with-findings (both findings P4 advisory; no blocker/major/minor — gate passes)

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P4 (advisory) | correctness | R3 text-mode cell extraction slices the data row at the header's CAPS index and splits on 2+ spaces — correct only while columns are left-aligned fixed-width (`padEnd`). Robust to new columns inserted before CAPS (the 0893 parallel-work risk), but a future right-aligned or variable-width column would break extraction with a confusing failure. Documented in-test, deterministic in the hermetic fixture; accept as-is. | `apps/cli/tests/config-layering.test.ts:236-241` |
| 2 | P4 (advisory) | usability | Design R2 case 2 prose said the pass `reason` names the agent, but the implementation returns `reason: ''` with the agent named in `observed`; the test asserts the implementation literals per the Design's own copy-literal-strings rule. Design-wording drift, correctly resolved toward the implementation; no code impact. | `packages/app/tests/services/capability-attestation.test.ts:213` vs `packages/app/src/services/capability-attestation.ts:193` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Pre-spawn gate at `packages/app/src/workflow/actions/agent-run.ts:301-313` fires only on an explicit `continue: true` (the session latch requires `resumeSupported` at `:291`, so it can never reach the branch), returns the ADR-118 contract violation with `contract: 'requiresCapabilities'` / `observed: 'missing: resumeById'` and an error naming the agent; `runTraced` unreached. Asserted at `packages/app/tests/workflow/actions/agent-run.test.ts:3038` incl. the `workflow.agent.contract-violation` bus event; regression guards: continue-with-input stays fresh `:3067`, resume-capable claude keeps the flag `:3083`, runner-unknown agent keeps legacy `:3095`. |
| R2 | MET | Full decision table (no session axis / execution-only; all true; declared false + note; missing record; multi-miss joined with `; ` in `SESSION_CAPABILITY_AXES` order) plus `parseRequiresCapabilities` accepting all four session axes at `packages/app/tests/services/capability-attestation.test.ts:183-268`, with literals byte-matching the implementation at `packages/app/src/services/capability-attestation.ts:181-211`. |
| R3 | MET | Real-CLI subprocess harness: text-mode CAPS cell (`coder-exec` starts `r✓`, ends `⚠`) located by header lookup at `apps/cli/tests/config-layering.test.ts:224-246`; JSON mode asserts `capabilities.verifiedAgainst` non-empty, `supportsResumeById === true`, `capabilityStale = { verifiedAgainst, detected: '1.0.0…' }`, and empty stderr at `:248-269`. Staleness rendering source (read-only reference): `packages/app/src/services/agent-service.ts:2881-2884`. |
| R4 | MET | Fresh `bun run spur-check` re-run during this review: lint + 8460 pass / 0 fail across 477 files, post-check rules "All 2 rules passed". Reviewer-verified, not inherited from the implementer. |

| AC | Status | Evidence |
|-----|--------|----------|
| AC1 | MET | R1 gate + R2 evaluator coverage (above) — a stage requirement is enforced before spawn with the shared contract outcome. |
| AC2 | MET | R3 JSON test: per-agent `capabilities` object on the doctor surface. |
| AC3 | MET | R3 text `⚠` suffix and JSON `capabilityStale` for the 1.0.0-vs-2.1.274 stub mismatch. |

##### Constraint checks

- **R3 must not touch `agent-service.ts` (parallel B6/0893 owns it): CLEAN** — `git diff HEAD --name-only` has 0 matches for the file; the only source change is `agent-run.ts`.
- Frozen invariants held: R7 two-line stderr assertion byte-identical (diff adds lines only, no removals in `config-layering.test.ts`); no new `ContractName` (reuses `'requiresCapabilities'` from `agent-run.ts:41`); no `getAgentSessionCapability` module stubbing (tests use real runner records; pin 0.4.68 confirmed); CLI `--continue` path untouched (no `apps/cli` source changes); both out-of-scope behaviors (`continue` with input → fresh dispatch; unknown agent → no gate) carry explicit regression guards.

##### Dimension verdicts

- **Security:** PASS — gate fails closed pre-spawn (no subprocess, `runTraced` unreached); no new injection surface (`agentLabel` / `gate.reason` are config/record-bounded); unknown-agent fail-open is the documented design invariant, unchanged.
- **Efficiency:** PASS — the guard is one pure function call on an already-failing path; zero happy-path cost.
- **Correctness:** PASS — guard precedes both the input guard and the `flags.continue` suppression; strict `continueFlag === true` excludes explicit `continue: false`; test literals byte-match the implementation.
- **Usability:** PASS — error names the agent, cites ADR-118, and carries the record's `note` via `gate.reason` (e.g. gemini's "resume flags target latest session, not a session id"); bus event names contract + observed for the run log.
- **Architecture:** PASS — reuses the B8 R4 pair (`evaluateSessionCapabilities` + `contractViolation`) instead of a new contract name or error shape; gating stays in the action runner (boundary integrity — service untouched); the R3 full-mode-selector deviation from Design is justified (`renderRoleLadder` has no CAPS column) and documented in the Solution.

##### Verification evidence (fresh, this review session)

- `packages/app`: `bun test tests/workflow/actions/agent-run.test.ts tests/services/capability-attestation.test.ts` → **176 pass / 0 fail**, 490 expects.
- `apps/cli`: `bun test tests/config-layering.test.ts` → **9 pass / 0 fail**, 34 expects.
- `bun run spur-check` → **8460 pass / 0 fail** across 477 files; post-check: "All 2 rules passed — no violations found".
- Runner pin: `@gobing-ai/ts-ai-runner` **0.4.68** (Plan step-0 precondition holds).

**Residual risk:** Low. Both advisories are test-brittleness / wording notes with no behavioral impact; the parallel 0893 rebase risk in `config-layering.test.ts` is bounded by the header-lookup approach.

**Next:** No code action required — advisories accepted as-is; proceed to the pipeline approve(HITL) gate.

### References

- Parent feature: `B8` — `docs/features/B8_runner-capability-matrix-per-agent-session-and-stdin-capabilities-declared-upstream-and-consumed-by-spur.md` (scenarios: *A stage can require a capability before spawn*, *Doctor exposes capabilities per executor*, *A stale capability declaration is surfaced*).
- Predecessors (done): 0888 (upstream record consumption), 0889 (session gating + doctor surface) — commit `b6a029d49`.
- ADR-118 contract-violation outcome; ADR-121 (B8 capability matrix).
- Design satellites: `docs/design/planning-workflow-contracts.md:264-273` (session-axis gate), `docs/design/session-pinned-dispatch.md`.
- Upstream shim semantics: `@gobing-ai/ts-ai-runner` 0.4.68 `src/agents/shims.ts` — `getAgentSessionCapability` `:508`; bare-continue vs resume-by-id per agent.
- **Parallel-work caveat:** B6 task 0893 (active worktree `/Users/robin/xprojects/spur-new-runall-feat-b6-476DF9EF`) edits doctor rendering in `packages/app/src/services/agent-service.ts`. This task does **not** touch that file; R3 locates CAPS by header so a new column does not break it. Expect a trivial rebase at most in `config-layering.test.ts`.

### History

- 2026-09-18T04:55:53.310Z backlog → todo (system)
- 2026-09-18T05:26:01.202Z todo → wip (system)
- 2026-09-18T06:00:48.426Z wip → testing (system)
- 2026-09-18T06:01:20.884Z testing → done (system)

