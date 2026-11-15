# Fleet real-agent latency baseline — attempt and blocker record (task 1331)

**Status: no real-agent baseline obtained.** Three agents were attempted on 2026-11-15
07:29–08:06 UTC; zero trials reached a validated terminal. The blocking causes are recorded below
verbatim, together with the two perf-lane defects this attempt found and fixed.

Reproduce: `bun run fleet-e2e --perf --trials 5 --real-agents`

- Repository revision: `447604217993a1aa1fce413d37082abea947cc2d` (branch
  `sp/runall-1331-1334-1337-ed231`)
- Workload digest: `sha256:a851ae35a1798abecb2241aecd1442fa70acaf5f077c22a8f1d75703cf5239ea`
  (unchanged from `docs/reports/fleet-perf-receipt.md`; the lane pins one workload)
- Lane: `scripts/commands/fleet-e2e.ts` `runFleetPerf`, modes `supervised-cold`
- Binary provenance (probed from the host): `codex-cli 0.169.0`, `2.1.325 (Claude Code)`,
  `pi 1.5.2`

## Per-agent result

| agent | trials attempted | validated | observed terminal | blocker (verbatim) |
| ----- | ---------------- | --------- | ----------------- | ------------------ |
| pi    | 2 (one at the stub bound, one at the real bound) | 0 | `timed-out` | `429 {"type":"error","error":{"code":"AccountQuotaExceeded","message":"You have exceeded the monthly usage quota. It will reset at 2026-11-18 23:59:59 +0800 CST."}}` on model `volc/deepseek-v4-1-flash-261017`; the automatic escalation to `agy-gemini` never closed the trial within the 15-minute bound |
| claude | 1 | 0 | agent exited early | `You've hit your 5-hour limit · resets 12:20am (America/Los_Angeles)` |
| codex | 1 | 0 | pipeline `failed` at `remediate` | implement succeeded (0:37 total), `gate` passed (0:03), then `#0001 remains 'wip'. … the pipeline failed because coverage was absent and sandbox restrictions blocked Git receipt creation. Remediation then encountered a missing findings file.` (`.spur/run/0001-light-gate.log`) |

Failed trials are kept above rather than dropped: a trial that never reached `done` has no
enqueue→validated duration to report, and averaging it in would understate nothing and hide
everything.

## What was measured

Only the codex attempt produced a phase split before failing, and it is a *failed* pipeline, not a
validated turn. Reported so the next run has a comparison point, **not** as a baseline:

| phase (codex, single failed trial) | wall time |
| ---------------------------------- | --------- |
| implement → gate (whole pipeline run) | 37 s |
| gate (light, informational) | 3 s |
| remediate | 0 s (failed on a missing findings file) |

Unavailable for every agent, for the same reason (no validated trial): queue p50/p95, start p50/p95,
model time, tool time, gate time, and the dispatch-transport share of wall time (enqueue → agent
start). They are absent rather than estimated — the KPI contract in
`docs/plans/2026-10-21-fleet-performance-measurement.md` §2 requires that.

## Lane defects found and fixed here

Both were latent because the deterministic stub lane short-circuits the real member pipeline.

1. **A real trial could never satisfy the project gate: unborn HEAD.** `scaffoldPerfProject` ran
   `git init` but never committed, so the trial project's every file read as changed and the gate's
   tree capture failed closed (`light gate FAIL (91 changed files; … receipt: none (git tree capture
   failed))`). The real-agent lane now commits the scaffold (`scripts/commands/fleet-e2e.ts`,
   `scaffoldPerfProject`), so a trial's diff is the trial's own files. The stub lane is untouched.
2. **The stub's trial bound failed healthy real turns.** `PERF_TRIAL_TIMEOUT_MS` (90 s) bounds a
   stub turn measured in seconds; a real turn runs implement → gate → review. The real-agent lane
   now uses `PERF_REAL_TRIAL_TIMEOUT_MS` (15 min); the stub lane keeps 90 s.

Regression check: `bun test scripts/commands/fleet-e2e-perf.test.ts` — 24 pass, 0 fail
(`1331: a real-agent trial starts from a committed scaffold`).

## What the next run needs

1. A working executor quota: wait for the claude 5-hour window or the pi monthly reset
   (2026-11-18), or pin a funded model.
2. A real-agent gate that can pass in a scaffold: the codex attempt reached a green gate but died in
   `remediate` on a missing findings file. Either the trial project must ship a
   `coverage`-satisfiable check set, or the gate must be the perf lane's own trivially green command —
   a decision for the lane's owner, not a measurement question.
3. A 5-trial run per agent per mode (cold, resume, warm) as the measurement plan's §3 requires; at
   real-turn durations (37 s–6 min observed) that is a multi-hour, quota-sensitive run and needs an
   explicit operator go-ahead on cost.
