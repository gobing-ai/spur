---
schema_version: 1
name: "Decision-maker reliability and effectiveness: laya worker bundling, decide ledger gap, task-pipeline decision rework"
status: todo
template: issue
created_at: 2026-10-19T18:00:11.379Z
updated_at: "2026-10-19T18:01:40.871Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P1
---

## 1262. Decision-maker reliability and effectiveness: laya worker bundling, decide ledger gap, task-pipeline decision rework

### Background

Evidence-led audit (2026-10-19, ts-libs session) of how spur-new uses the ts-libs decision family
(`@gobing-ai/ts-ai-decision` hub + makers `typesafe`, `fm-local`, `laya-local`, `clef`). Data came
from `.spur/spur.db` (`system_events`, `event_name LIKE 'decision.%'`), the `.spur/run/*.decision`
result files, `~/.config/spur/config.yaml`, and the installed bundle
`/Users/robin/node_modules/@gobing-ai/spur/` (spur 0.4.15, single bundled `spur.js`).

Findings, by severity:

1. **`laya-local` is dead under the bundled CLI (P1, 100% failure).** `spur.js:70395` computes the
   ts-laya-mlx `packageRoot` as `join(import.meta.dir, '..')`. Once bundled, that lands on
   `node_modules/@gobing-ai/` and the worker resolves to `@gobing-ai/worker/laya_worker.py`, which
   does not exist. Every laya ask fails in ~100 ms with `reason: error`, and the ledger records no
   message. In knowledge-kit, `kk-item-quality` on laya-local was accepted 0/161 times. A direct
   probe from ts-libs source (unbundled) answers `ok` at 0.79, so model and Python env are fine.
   **Upstream fix already made in ts-libs (uncommitted, unreleased):**
   `packages/laya-mlx/src/worker-client.ts` now honours the `workerScript` option or
   `env.LAYA_WORKER_SCRIPT`. A missing script throws
   `DecisionConfigError(variable: 'LAYA_WORKER_SCRIPT')` at spawn time, and the hub maps that to
   the declared fallback with a readable message.
2. **Workflow `decide` steps are missing from the decision ledger (P1, observability).** No
   workflow-caller `decision.end` rows have appeared in spur-new's ledger since 2026-10-13. Over the
   same period `.spur/run/*.decision` files keep being written, e.g. `1259-*.decision` and
   `1260-*.decision` today with backend `clef`. knowledge-kit's task-pipeline decides are missing
   too. `spur decision run` calls (caller `cli`/`workflow` via subprocess) still record. Emission is
   gated on the bus: `packages/app/src/workflow/actions/decide.ts:227-228`
   (`if (this.deps.enabled && bus !== undefined && …)`). **Suspected, not confirmed:** some
   engine-construction path (host executor / `workflow continue` resume) builds `DecideActionRunner`
   without `observabilityBus`. Wiring sites to compare: `services/workflow-engine-factory.ts:58,102`
   and `workflow/builtins.ts`.
3. **`decision.failure` payloads have no error message (P2).** laya's root cause took a manual repro
   to find because the payload records only `reason: error`.
4. **Task-pipeline decisions mostly return the fallback (P2, effectiveness).** Ledger and
   `.decision` files since 2026-10-08 show:

   | Decision | Maker | Calls | Accepted | Confidence | Notes |
   |---|---|---|---|---|---|
   | `task-triage` | clef | 36 | 2 | 0.07–0.45 | A deterministic pre-guard (>400 lines / sensitive path → safety) already exists at `config/workflows/task-pipeline.yaml:440-450` |
   | `failure-class` | typesafe | 13 | 0 | ≤ 0.66 | Runs unconditionally (`task-pipeline.yaml:523-531`). On green runs the evidence is empty, e.g. `.spur/run/1260-test-gate.findings` is 0 bytes |
   | `review-failure-class` | fm-local | 15 | 15 | 1.0 | Always `fix`, which is also the fallback, so it adds no information (`task-pipeline.yaml:697-706`) |
   | `gate-evidence` | — | 0 | — | — | Never called; verify it is wired or retire it |

   The catalog `config/decisions/task-pipeline.yaml` has vague criteria and no `instructions`
   template, so the model sees mostly bare labels.
5. **Sampled-maker confidence is a unanimity vote.** `fm-local` (and the planned `llm-agent`,
   ts-libs task 0115) use `entropyConfidence = 1 − H(p)/ln(n)` over k samples. With two options,
   2-of-3 gives 0.08 and 4-of-5 gives 0.28, so at Spur's 0.8 floor an accept means "every sample
   agreed". That explains `review-failure-class`'s 15/15 at 1.0. See ts-libs
   `docs/design/llm-agent-decision-backend.md` § "Confidence granularity" and
   `packages/ai-decision/README.md` § fallback contract.
6. **Inconsistent call style.** `config/workflows/history-anatomy.yaml:259` shells out to
   `$spurBin decision run anatomy-validation-verdict` instead of a native `kind: decide` step. The
   target pattern is `config/workflows/idea-pipeline.yaml:120,138`. Shelling out costs a subprocess
   and loses the run-scoped ledger context.
7. **Maker vocabulary goes stale once ts-libs 0115 ships `llm-agent`.** The config comment for
   `decisions.maker` says "exactly four names".

Already fixed elsewhere (not in scope): knowledge-kit `.spur/config.yaml` no longer registers the
absolute bundled-catalog path (it shadowed the shared layer), and `kk-item-quality` was switched
from `laya-local` to `fm-local` until this task ships the worker.

### Requirements

- [ ] R1. Bundle `laya_worker.py` with the published spur package and pass its path to the ts-laya-mlx driver (`driverOptions['laya-local'].workerScript` or `env.LAYA_WORKER_SCRIPT`) so `laya-local` works from the bundled `spur.js`. Depends on the ts-libs release that carries the `workerScript` / `LAYA_WORKER_SCRIPT` override (ts-libs `packages/laya-mlx/src/worker-client.ts`, post-0.5.30).
- [ ] R2. Reproduce and fix the missing workflow `decide` ledger rows: every `kind: decide` step that is not `disabled` emits `decision.start` + `decision.end`/`decision.failure` into `.spur/spur.db` `system_events` on every engine-construction path (fresh `workflow run`, host executor, `workflow continue` resume).
- [ ] R3. `decision.failure` (and the `error`/`no-backend` reasons of `decision.end`) record the backend error class and message, truncated to a bounded length and secrets-safe.
- [ ] R4. Run `failure-class` only on a red test gate, with non-empty evidence (the failing gate log/findings); on a green gate skip the decide and record why.
- [ ] R5. Rework `task-triage`: keep the deterministic lane rules as the primary decision, and give the model one narrow semantic question (for example a noul "does the diff touch public API, schema, security or release paths?") with explicit `instructions` and concrete criteria. Retune `minConfidence` from recorded data instead of the blanket 0.8.
- [ ] R6. Rework or retire `review-failure-class`: either move it to a probability-native maker with evidence that includes the review verdict, or remove it, because a constant `fix` that equals the fallback carries no information.
- [ ] R7. Rewrite the `config/decisions/task-pipeline.yaml` criteria as observable descriptions and add an `instructions` template with `${params.instructions}` for every decision.
- [ ] R8. Convert `history-anatomy.yaml:259` from the shell `spur decision run` call to a native `kind: decide` step (pattern: `idea-pipeline.yaml:120`).
- [ ] R9. Verify `gate-evidence` is reachable from a pipeline path and covered by a test; retire it if it is unreachable.
- [ ] R10. After ts-libs 0115 releases `llm-agent`, accept it in the maker vocabulary and in config validation, update the "exactly four names" comment and docs, and document that sampled makers (`fm-local`, `llm-agent`) accept only on unanimity.

### Acceptance Criteria

```gherkin
Scenario: AC1 — laya-local answers from the bundled CLI (req: R1)
  Given spur is installed from the published bundle on an Apple-silicon host with laya-mlx installed
  When `spur decision run kk-item-quality` (or any decision routed to `laya-local`) runs
  Then the result has `maker: laya-local`, a non-fallback `reason`, and no worker-script error

Scenario: AC2 — a missing laya worker reports a readable failure (req: R1, R3)
  Given `LAYA_WORKER_SCRIPT` points at a nonexistent file
  When a decision routes to `laya-local`
  Then the declared fallback is returned and the ledger failure row names `LAYA_WORKER_SCRIPT` and the path

Scenario: AC3 — workflow decide steps reach the ledger on every path (req: R2)
  Given a task-pipeline run driven by the host executor and resumed with `spur workflow continue`
  When its `task-triage` decide step runs
  Then `system_events` holds a `decision.end` row for that run id and decision id

Scenario: AC4 — failure-class runs only on red gates (req: R4)
  Given a task-pipeline run whose test gate is green
  When the gate state completes
  Then no `failure-class` decision is made and no `.decision` file with empty evidence is written

Scenario: AC5 — triage keeps the deterministic floor and a narrow model question (req: R5, R7)
  Given a diff of 450 changed lines
  When triage runs
  Then the lane is `safety` without a model call, and smaller diffs consult only the semantic-risk question

Scenario: AC6 — history-anatomy uses a native decide step (req: R8)
  Given `history-anatomy.yaml`
  When it is validated with `spur workflow show`
  Then the anatomy verdict is a `kind: decide` step and no shell step invokes `decision run`
```

```gherkin
Scenario: AC7 — review-failure-class no longer returns a constant equal to its fallback (req: R6)
  Given the reworked review lane
  When it runs on a fixture review verdict asking for redesign
  Then the decision is either absent (retired) or returns a non-`fix` value from a probability-native maker

Scenario: AC8 — gate-evidence is reachable or retired (req: R9)
  Given the shipped decision catalogs and workflows
  When `spur decision status` and the workflow suite run
  Then `gate-evidence` is either exercised by a test that reaches it or no longer present

Scenario: AC9 — llm-agent is an accepted maker name (req: R10)
  Given ts-libs with the `llm-agent` built-in
  When `decisions.maker: llm-agent` is configured
  Then config validation accepts it and `spur decision status` lists it as a maker
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

**Principle: deterministic first, model for the residual.** Signals the pipeline can already compute
(gate exit code, diffstat, path globs, file emptiness) never go through a model. A decision
maker is used only for a judgment a rule cannot make, and only when the evidence is non-empty.

**Maker choice by question type** (ts-libs § confidence granularity):

| Need | Maker | Why |
|---|---|---|
| Graded confidence; the floor must discriminate | `typesafe`, `clef`, `laya-local` (once R1 lands) | Probability-native |
| Cheap local unanimity check | `fm-local` | Accepts only when all k samples agree; read 1.0 as unanimity |
| No decision model fits the job | `llm-agent` (ts-libs 0115) | Any coding agent as a sampled maker; slowest and most expensive |

**R1, laya bundling.** Copy `node_modules/@gobing-ai/ts-laya-mlx/worker/laya_worker.py` into the
spur package at build time (e.g. `dist/worker/laya_worker.py`, listed in `files`), and register
`laya-local` with `builtins.driverOptions['laya-local'] = { workerScript: <resolved path> }`. Do not
patch `import.meta.dir` in the bundle. Rejected: setting `LAYA_WORKER_SCRIPT` in the user's
environment, because it would be fragile and invisible.

**R2, ledger gap.** Start with a repro: a host-executor run with one decide step, then query
`system_events`. Compare how `DecideActionRunner` receives `observabilityBus` across
`services/workflow-engine-factory.ts:58,102` and `workflow/builtins.ts`. Fix the gap at the single
construction seam rather than adding a bus at each call site.

**R3, failure message.** Reuse the existing `emitDecision*` helpers and add
`errorClass` + `message` (cap ~500 chars). The ts-libs `Decision*Error` messages carry no secrets
by contract.

**R4–R7, task-pipeline catalog.**
- failure-class: guard the decide with `[ -s findings ]` plus a non-zero gate exit, and keep the
  existing deterministic routing when the guard skips it.
- triage: the deterministic pre-guard at `task-pipeline.yaml:440-450` stays authoritative. Replace
  the low/standard/high choice with a noul semantic-risk question. A false positive costs only a
  deeper review; a false negative is bounded by the deterministic floor.
- review-failure-class: the recommended option is to retire it (15/15 equal to the fallback). If
  kept, it must see the review verdict text and run on a probability-native maker.

**Better use: measure accuracy, not acceptance.**
- **Ground-truth join.** Record each decision's `value` next to the eventual outcome (lane chosen
  vs. review found P1/P2; failure-class vs. what the fix actually touched). A small ledger query or
  `spur decision report` reads the pairs, and per-decision `minConfidence` is tuned from that
  report.
- **Shadow mode.** Optionally run a second maker on the same question (e.g.
  `decisions.shadow: { task-triage: fm-local }`), record its answer without acting on it, and
  compare agreement and latency before switching the primary. This is cheap with local makers.
- **Rescue classifier for unknown executor failures.** `packages/app/src/services/failure-classification.ts`
  (`FAILURE_RULES`, regex-narrow by design, 0407 precision bias) has no answer for unmatched
  stderr. A catalog decision `executor-failure-class` (choice:
  `resource-exhaustion`/`auth`/`transient`/`task-defect`, fallback `task-defect`) could classify
  only the unmatched residue, keeping regex precision while improving recall. Relates to task 1260.

### Plan

1. R2 first, because observability gates the rest: write a failing E2E repro (host-executor run + one decide step → assert a `decision.end` row), fix the bus wiring seam, and re-run.
2. R3: add the error class and message to failure rows; the regression check is the AC2 scenario.
3. R1: after the ts-libs release with the `workerScript` override, bump the dependency, ship the worker file in the package, and wire `driverOptions['laya-local']`. Verify with AC1 on this host, then switch knowledge-kit `kk-item-quality` back to `laya-local`.
4. R4: add the failure-class guard and cover it with the AC4 E2E on a green fixture run.
5. R7 + R5: rewrite the catalog criteria and instructions, then rework triage. Replay the last 36 triage evidence files through the new question and compare against review outcomes before switching.
6. R6: retire `review-failure-class` (or move it per Design); update the pipeline transitions.
7. R8, R9: convert history-anatomy; verify or retire `gate-evidence`.
8. R10: once ts-libs 0115 releases, add `llm-agent` to the vocabulary and docs.
9. Gates: the project's full check suite plus a bundled-install smoke test (`spur decision status`, one decide per maker).

### Root Cause

- **laya (verified):** the bundled `spur.js:70395` resolves `packageRoot = join(import.meta.dir, '..')`, which points outside the ts-laya-mlx package once bundled, so `worker/laya_worker.py` is not found. Verified by a direct probe: the same model answers `ok` at 0.79 from the unbundled ts-libs source.
- **Ledger gap (unverified hypothesis):** emission is conditional on `observabilityBus` (`packages/app/src/workflow/actions/decide.ts:227-228`), and some engine-construction path appears not to pass it. Evidence: `.decision` files exist for runs that have no `decision.end` rows after 2026-10-13. Needs the R2 repro.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- ts-libs `packages/laya-mlx/src/worker-client.ts` (workerScript / LAYA_WORKER_SCRIPT override + spawn-time check), `packages/laya-mlx/README.md` § Host prerequisites item 3.
- ts-libs `docs/design/llm-agent-decision-backend.md` § Confidence granularity; `packages/ai-decision/README.md` § The fallback contract.
- ts-libs tasks 0114 / 0115 / 0116 (feature O1: sampled-driver core, `llm-agent` maker, TypeSafe relocation + SDK 0.7.0); ADR-038 / ADR-039.
- spur-new: `packages/app/src/workflow/actions/decide.ts:222-249`, `config/workflows/task-pipeline.yaml:399-470,523-531,697-706`, `config/workflows/history-anatomy.yaml:259`, `config/workflows/idea-pipeline.yaml:120,138`, `config/decisions/task-pipeline.yaml`, `packages/app/src/services/failure-classification.ts`, task 1260.
- Data: `.spur/spur.db` `system_events` (`event_name LIKE 'decision.%'`), `.spur/run/*.decision`, `~/.config/spur/config.yaml` (`decisions.*`, `workflows.decideDecisionMaker`).
- Companion task in knowledge-kit (decision-maker usage there).

### History
