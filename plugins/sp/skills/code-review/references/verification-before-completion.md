# Verification Before Completion

A behavioral guardrail for **any agent claiming work is done**. This is the universal honesty gate:
no "done", "passing", "fixed", or "works" claim without fresh, pasted verification evidence run
this turn.

## The Contract

Before reporting a task as complete, a test as passing, a bug as fixed, or a feature as working:

1. **Run the verification command.** Not last session's output. Not the implementer's summary. Run
   it now, this turn, and capture the output.
2. **Paste the evidence.** The raw tail output (last 20+ lines for high-stakes changes), not a
   one-line "green" summary. For doc-only changes, a one-liner is acceptable.
3. **No claim without evidence.** If you cannot run the verification (tool unavailable, environment
   missing), say so explicitly — do not claim success.
4. **No skipped checks.** A test suite with `.skip`/`xfail`/`#[ignore]` is not green. Past the
   raw output so the operator can see skips.

## Evidence Standard

| Claim | Required evidence |
|-------|-------------------|
| "Tests pass" | Raw `bun test` / `pytest` / `cargo test` tail showing 0 failures, 0 skips |
| "Lint clean" | Raw `biome check . --error-on-warnings` / `eslint` / `clippy` exit 0 output |
| "Build succeeds" | Raw `bun run build` / `cargo build` / `go build` exit 0 output |
| "Bug fixed" | The failing test now passing (raw output) + the root-cause explanation |
| "Feature works" | The specific test or manual scenario that exercises the feature, run this turn |
| "Doc-only change" | One-liner acceptable; no gate evidence needed |

## Anti-Patterns

- **Trust the summary:** "The implementer reported all tests pass — I'll trust it." The summary is a
  claim, not evidence. Re-run the gate.
- **Stale evidence:** Paste last session's output. Gates must be run this turn, after the last
  code change.
- **One-line green:** "All gates green ✓" without the raw output. Paste the tail; let the operator
  see the actual numbers.
- **Silent skips:** "Test suite passes" with 3 `.skip`'d tests. Skips are not passes. Surface them.
- **Premature done:** "Done" with a known failing check, planning to fix it later. Done means done —
  if a check fails, you are not done.

## Under the pipeline

`task-pipeline.yaml`'s `verify` step (Phase 8) and `record` step enforce this gate. The `verify`
step runs `sp:code-verification` verify mode, which produces a `VerifyVerdict` artifact; the
`record` step transcribes it to the task's `## Testing` section. A `done` transition requires a
PASS verdict.

Under manual execution (no pipeline), the agent must still run the gates and paste the evidence.
"Manual" is not an exemption — it just means the agent, not the pipeline, runs the commands.

## Relationship to `sp:code-verification` and `sp:functional-review`

Both review skills produce verdicts (PASS/PARTIAL/FAIL). A verdict is a completion claim — it
obeys this gate. The reviewer must have run the verification (read the code, run the tests, checked
the evidence) before emitting the verdict, not guess from the implementer's summary.

| Skill | Verdict artifact | This gate says |
|-------|-----------------|----------------|
| `sp:code-verification` | `VerifyVerdict` (SECUA + AC) | Run the SECUA review + AC check; paste evidence |
| `sp:functional-review` | `FunctionalVerdict` (requirements) | Map each R{n} to file:line evidence; no MET without a citation |
| `sp:code-improvement` | Candidate list (advisory) | Every candidate needs file:line evidence; no "looks shallow" without a location |

## The one sentence

If you cannot paste the raw output of the verification command you just ran, you cannot claim
"done".