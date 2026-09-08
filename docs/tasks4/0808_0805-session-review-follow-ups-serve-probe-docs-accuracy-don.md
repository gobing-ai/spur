---
schema_version: 1
name: "0805 session-review follow-ups: serve probe docs accuracy, done-guard diagnostics, inline record artifact surface"
status: done
template: issue
created_at: 2026-09-08T18:49:16.458Z
updated_at: "2026-09-08T19:15:46.621Z"

---

## 0808. 0805 session-review follow-ups: serve probe docs accuracy, done-guard diagnostics, inline record artifact surface

### Background

Follow-ups from the 2026-09-08 0805 dev-run session review (`--triage`). Four advisory-grade
findings remain; a fifth (R2 serve test env restore + temp-dir hygiene) was already fixed inline in
commit `328d5d056` and is intentionally excluded here.

1. **Serve `--json` probe fail-fast undocumented/untested (0805 review P4a).** Since 0805 R2,
   `resolveServeCwd` throws before the `--json` probe returns when `--cwd` is missing or not a
   directory (`apps/cli/src/commands/serve.ts:66-68`), so `serve --json --cwd <missing>` is now
   exit 1 instead of a JSON probe response. Defensible, but no doc carve-out for the probe path and
   no `--json`+`--cwd` test exist.
2. **"Omitted `--cwd` passes nothing" is not the real mechanism (0805 review P4b).**
   `apps/cli/src/commands/serve.ts:59,69-73` plus the docs row and the "omitted --cwd" test describe
   a pass-nothing branch that never executes through the real CLI: commander defaults
   `context.cwd`, so `options.cwd` is never `undefined` (the test calls the action directly,
   bypassing commander). Observable behavior is correct; the described mechanism is not.
3. **Done-transition guard diagnostics are misleading.** During the 0805 run,
   `task update 0805 done` failed with "`spur task check 0805` failed" while both the plain and
   `--strict-core` checks passed. The guard actually evaluates `task check --as done`
   (target-status projection) and the failure was `L3.unchecked-checklist` — invisible in the
   error. Operators must re-derive the probe by hand.
4. **Inline driver record stage has no run.artifact surface.** In inline mode
   (`dev-run --agent inline`), the workflow `run.artifact` engine action has no inline execution
   surface; the record stage logged a manually validated registration-equivalent to the run log
   (`.spur/run/230F50E02690.log`). Verify→record guard conditions were all pre-validated, so
   evidence integrity held, but the equivalence is a convention, not a surface.

### Requirements

- [x] R1 — Document the `--json` probe's fail-fast on missing/non-directory `--cwd` in the serve docs row, and add a CLI test covering `serve --json --cwd <missing>` (exit 1, error before JSON output).
- [x] R2 — Align the serve comment, `docs/04_DESIGN.md` row, and the "omitted --cwd" test description with the real mechanism (commander-default `context.cwd`); keep observable behavior unchanged.
- [x] R3 — Make the lifecycle done-transition failure message name the target-status probe (`--as done`) and list its error findings (e.g. `L3.unchecked-checklist`), so a passing plain check does not read as a contradiction.
- [x] R4 — Provide an inline execution surface for the record-stage `run.artifact` registration (or document the registration-equivalent convention in the inline-pipeline-driver reference), so inline runs do not rely on ad-hoc log lines for artifact provenance.

### Acceptance Criteria

- [x] AC1 (R1): `docs/04_DESIGN.md` serve row documents the `--json` probe fail-fast on invalid `--cwd`, and a CLI test proves `serve --json --cwd <missing>` exits 1 with no probe payload emitted.
- [x] AC2 (R2): The serve comment, docs row, and direct-action test title describe the commander-default mechanism; all existing serve behavior tests still pass unchanged.
- [x] AC3 (R3): A failing `wip→testing`/`testing→done` backstop denial message contains `--as <status>` and the check's `L3.` error findings; a backstop regression test asserts both.
- [x] AC4 (R4): `inline-pipeline-driver.md` documents the `run.artifact` registration-equivalent convention (validation conditions + run-log provenance line), and the inline parity check stays green.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

- [x] Locate the serve probe docs row and the `--json`+`--cwd` gap; add the carve-out and CLI test (R1).
- [x] Rewrite the omitted-`--cwd` comment/docs/test description to the commander-default mechanism; run focused serve CLI tests (R2).
- [x] Find the lifecycle guard error construction for task transitions; include `--as <target>` findings in the message; add/adjust a guard test (R3).
- [x] Decide surface vs documented convention for inline run.artifact registration; implement or reference-document it; update the inline-pipeline-driver reference (R4).
- [x] Run focused tests plus `bun run spur-check` once; keep changes within the four findings.

### Root Cause

- R1/R2: commander spreads `context.cwd` as the `--cwd` default (`apps/cli/src/commands/serve.ts:59`), so the documented "omitted passes nothing" branch never executes through the real CLI; and `resolveServeCwd` runs before the `--json` probe return (`apps/cli/src/commands/serve.ts:77,84`), making the probe fail-fast on invalid `--cwd` undocumented and untested.
- R3: the inline lifecycle-gate backstop (`apps/cli/src/commands/task.ts`) evaluates `TaskCheckService` with `asStatus: <target>` but reported only `` `spur task check <wbs>` failed `` — neither the `--as done` probe nor its error findings (e.g. `L3.unchecked-checklist`) appeared in the denial, so a passing plain check read as a contradiction.
- R4: the inline pipeline driver lists `run.artifact` as a supported kind (`inline-pipeline-driver.md:26`) but the engine's ledger registration (`packages/app/src/workflow/actions/run-artifact.ts`) has no inline execution surface; the 0805 inline run substituted a manually validated registration-equivalent logged to `.spur/run/230F50E02690.log` — a convention, undocumented until now.

### Solution

| File | Change | What / why |
| --- | --- | --- |
| `apps/cli/src/commands/serve.ts:69-76` | Omitted-`--cwd` comment rewritten | Documents the real mechanism: commander defaults `--cwd` to `context.cwd`, so the resolved root is always passed through the CLI; the `undefined` branch covers direct action invocation only (R2). Observable behavior unchanged. |
| `docs/04_DESIGN.md:1334` | Serve row corrected + probe carve-out | Commander-default mechanism replaces the inaccurate "omitted passes nothing" prose (R2); `--json` probe fail-fast on missing/non-directory `--cwd` (exit 1 before any JSON) documented (R1). Same commit as the surface (T3). |
| `apps/cli/tests/commands/serve.test.ts:253` | `--json --cwd <missing>` test | Exit 1, server never launched, resolution error surfaced, probe payload `{port,url,pid,running}` never emitted (R1). |
| `apps/cli/tests/commands/serve.test.ts:213` | Test title aligned | "omitted --cwd passes no cwd" → names the direct-action invocation path and the commander default it bypasses (R2). |
| `apps/cli/src/commands/task.ts:543-566` | Done-guard denial message | Names the target-status probe `` `spur task check <wbs> --as <status>` `` and appends the check's error findings (`code [section]: message`) so a passing plain check no longer reads as a contradiction (R3). |
| `apps/cli/src/commands/task.ts:1709-1731` | `runDoneGateCheck` returns findings | Return type `boolean` → `{ pass, findings }` so the denial message can list error findings (R3); missing-task path returns empty findings, behavior unchanged. |
| `apps/cli/tests/commands/task.test.ts:2705-2710` | Backstop test asserts probe + findings | wip→testing denial message must contain `--as testing` and an `L3.` finding code (R3 regression). |
| `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:104-113` | `run.artifact` inline convention documented | Engine ledger registration has no inline surface; the host validates the same refusal conditions (artifact canonical PASS, current proof binding, review marker) and logs a registration-equivalent provenance line before `spur task record` (R4 — documentation path chosen over a new engine surface). |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Probe carve-out in serve row `docs/04_DESIGN.md:1334` ("The `--json` probe validates `--cwd` first — a missing/non-directory `--cwd` fails with exit 1 before any JSON is printed"); CLI test `apps/cli/tests/commands/serve.test.ts:253` ("--json --cwd <missing> fails with exit 1 before the probe emits (0808 R1)") — serve suite 16/16 green this session |
| R2 | MET | Comment rewritten to the commander-default mechanism `apps/cli/src/commands/serve.ts:69-76`; docs row corrected `docs/04_DESIGN.md:1334` ("commander defaults `--cwd` to the invocation directory, so the resolved root is always passed"); test title aligned `apps/cli/tests/commands/serve.test.ts:213`; observable behavior unchanged — full gate 7834 pass / 0 fail this session |
| R3 | MET | Denial message names probe + findings `apps/cli/src/commands/task.ts:555` ("`spur task check ${wbs} --as ${status}` failed — <code [section]: message>"); `runDoneGateCheck` returns `{ pass, findings }` `apps/cli/src/commands/task.ts:1709-1731`; regression assertion `apps/cli/tests/commands/task.test.ts:2705-2710` (message contains `--as testing` + `L3.`) — backstop tests 3/3 green this session |
| R4 | MET | Registration-equivalent convention documented `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:104-113` (validation conditions, run-log provenance line, failure contract; documentation path chosen over a new engine surface); supported-kind set unchanged so the inline parity check stays green (full `bun run spur-check` PASS this session) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 (R1) | MET | test | `apps/cli/tests/commands/serve.test.ts:253` green (16/16 suite) + docs carve-out `docs/04_DESIGN.md:1334` |
| AC2 (R2) | MET | test | serve suite 16/16 green with the corrected comment/title; behavior tests unchanged and passing |
| AC3 (R3) | MET | test | `apps/cli/tests/commands/task.test.ts:2705-2710` asserts `--as testing` + `L3.` in the denial; 3/3 no-lifecycle backstop tests green |
| AC4 (R4) | MET | command | `bun run spur-check` (includes the inline parity check) PASS — 7834 tests, 0 fail, rules clean, this session |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-09-08T19:15:45.619Z todo → wip (system)
- 2026-09-08T19:15:46.131Z wip → testing (system)
- 2026-09-08T19:15:46.621Z testing → done (system)

