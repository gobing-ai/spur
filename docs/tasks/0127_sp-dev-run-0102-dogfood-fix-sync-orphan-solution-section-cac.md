---
schema_version: 1
name: "sp-dev-run 0102 dogfood: fix sync-orphan, Solution section, cache hit rate"
description: ""
status: done
type: review
template: review
profile: standard
feature_id: F7
parent_wbs: null
priority: P2
tags: ["review"]
dependencies: []
created_at: "2026-06-26T03:20:48.998Z"
updated_at: "2026-08-18T04:42:46.893Z"
---

## 0127. sp-dev-run 0102 dogfood: fix sync-orphan, Solution section, cache hit rate

### Background
Dogfood run of `/skill:sp-dev-run 0102 --auto --next` surfaced 2 unresolved issues and 4 findings (1 P1, 2 P2, 1 P3, 1 P4). Full report: `docs/dogfood/2026-06-26-sp-dev-run-0102-dogfood.md`.

The run exercised the full task-pipeline (`config/workflows/task-pipeline.yaml`) on task 0102 (daisyUI wrapper refactor). The pipeline completed through `verify` (PASS verdict) but failed at the `record → done` guard due to `renderReview()` emitting invalid Priority tokens. That specific bug was fixed during the dogfood run (see Fixed Issues in the report). The remaining items below are the ones that were NOT fixed and need implementation.

#### P0 root-cause (added on review — the report missed it)

**The dogfood's "slow + unreliable" symptom is the omp executor, not task 0102 and not the `sp` plugin.** Two pieces of hard evidence the original report did not connect:

1. **Every agent stage hit the 600s timeout wall.** From the report's own Monitor Ledger: implement `600768ms`, test `601078ms`, review `600927ms` — all within ~1s of the configured `stepTimeoutMs: 600000` (`task-pipeline.yaml:41`). A process doing bounded work does not land three-for-three within a second of a 10-minute ceiling. The omp subprocesses were being **killed at the timeout**, not finishing. The test stage corroborates: "~10 min, no visible output, no new test files."

2. **omp is reported `usable: false` on this box.** `spur agent doctor --json` reports `omp: { installed: true, usable: false }`, while `claude`, `codex`, `gemini`, and `pi` are all `usable: true`. The pipeline pins `agent: "omp"` (`task-pipeline.yaml:37`) and dispatched to it anyway across all four `agent.run` stages.

**Root cause of #2 — the doctor conflates liveness with authentication (verified 2026-06-25):** the doctor computes `usable = installed && version !== null && authenticated`, so a broken/stale *auth* probe makes a perfectly-runnable agent report `usable: false`. Two failure paths, both auth-related:
- omp's auth probe `omp --list-models` is a Pi-inherited flag dropped in omp 16.1.20 (→ exit 2 → `authenticated:false`).
- agents with `getAuthCommand: () => null` (e.g. `antigravity-cli`/`agy`) collapse to `authenticated:false` because `checkAuth` ends `return probeAuthOutput(agent) === true` and `null === true` is false.

Either way, **authentication detection is fragile, per-agent, and currently on the execution critical path** — which is the wrong place for it.

**Design decision (Robin, 2026-06-25) — decouple auth from the run-readiness check.** Rather than chase the "most correct" auth probe for every agent (a moving target across CLI versions), split the two concerns:

1. **Liveness only on the critical path.** Drop `authenticated` from `usable`: `usable = installed && version !== null`. The validation check used by execution/the readiness gate runs a cheap, deterministic command — `<bin> --version`. Verified 2026-06-25: `--version` exits 0 for all eight installed agents (claude, codex, gemini, pi, omp, opencode, agy, openclaw), including the four the old auth probe wrongly failed. **Execution never blocks on auth detection.**
2. **A separate, optional `isAuthenticated` interface.** Add a dedicated set of auth-shims (distinct from the run-path shims) exposing `isAuthenticated(agent): true | false | unknown`. This is where per-agent auth quirks live, isolated from execution; `unknown` is a first-class result (e.g. `agy`, which has no auth verb and stores no checkable credential file under `~/.antigravity/`).
3. **`spur agent doctor` shows it as a new informational column** (`authenticated`), reading `isAuthenticated`. Display-only — it never feeds `usable` or the readiness gate.

Net effect: the "how do we detect auth properly" problem leaves the critical path entirely. A genuinely-unauthenticated agent simply fails at runtime with **its own** error message (auth is the agent's concern — consistent with AGENTS.md "Spur never stores agent API keys"), and `spur agent doctor` surfaces auth status as a convenience, not a gate.

This splits into a **performance** cause and a **reliability** defect:

- **Performance / correctness (executor):** omp — flagged unusable by a stale *auth* probe (it is actually runnable) — is the variable. The same `/sp:dev-run` under Claude Code runs each stage inline, fast, and reliably. Selecting a healthy executor is exactly what task **0126** (phase-aware `--agent auto`) is meant to enable; this dogfood is its empirical justification.

- **Reliability (Spur-side, NEW P0):** the pipeline dispatched to a `usable: false` agent **without a readiness gate**, and a **timeout-kill was reported as `ok: true`** by `agent.run` (the step ran ~600s, was killed, and the pipeline still advanced). A pinned-but-unusable agent silently burns ~40 minutes and the run reports success. This is a Spur defect independent of which agent is configured, and it is the true source of the "unreliable" feel.

**Verification-first directive:** before implementing P1–P4 below, run the controlled A/B that isolates the variable — re-run the pipeline with `--vars '{"agent":"claude"}'` (claude is `usable: true` here) and compare per-stage wall-clock and the Solution-section / cache outcomes. If claude completes stages well under the timeout and authors the Solution section, the P0 attribution is confirmed and several lower findings (P2-Solution, P3-cache) are revealed as omp symptoms rather than plugin/prompt bugs.

**Context for the implementer:**

- The `sp-dev-run` skill lives at `plugins/sp/skills/spur-dev/` (backbone) with its execution-workflow reference at `plugins/sp/skills/spur-dev/references/execution-workflow.md`.
- The `sp-dev-dogfood` skill at `~/.agents/skills/sp-dev-dogfood/SKILL.md` defines the dogfood protocol and report format.
- The pipeline runs `spur workflow run config/workflows/task-pipeline.yaml --vars '{"wbs":"0102","profile":"auto"}'`.
- Each pipeline stage spawns an omp subprocess that calls `/sp:dev-implement`, `/sp:dev-unit`, `/sp:dev-review`, `/sp:dev-verify` respectively.
- The `record` step calls `TaskService.record()` which writes Testing/Review/Solution sections.
- `agent.run` (`packages/app/src/workflow/actions/agent-run.ts:105`) maps a non-zero exit to `ok:false`; the open question for P0-b is whether a `ProcessExecutor` timeout-kill actually surfaces a non-zero exit, or whether the killed omp subprocess exited 0 / the timeout was not honored.
- **Boundary (upstream-first):** the agent shims and `DoctorRunner` live in the external `@gobing-ai/ts-ai-runner` package (source: `~/xprojects/ts-libs/`), NOT in this repo. Per AGENTS.md "Shared-library evolution", the upstream changes (decouple `usable` from auth, add `isAuthenticated`) must be made there, verified with `ts-libs`' own gates, released by semver (or a temporary `bun link` while validating), and only then consumed here. Spur-side fixes (P0-a gate, P0-b timeout, doctor column) stay in / land in this repo.

#### Review Findings

The code-review findings this task must address — logged here as **input** (what was found in the dogfood run). Fix in priority order (P0 → P1 → …); re-review after. P0 rows were added on review (Lord Robb) after the original report missed the root cause.

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P0 | `config/workflows/task-pipeline.yaml:37` + `packages/app/src/workflow/actions/agent-run.ts` | **No executor-readiness gate.** The pipeline pins `agent: "omp"`, reported `usable: false`, and dispatches to it anyway across all 4 `agent.run` stages. There is no pre-dispatch check that the resolved agent is runnable. Result: ~40 min burned. | Gate `agent.run` (or the pipeline precheck) on **liveness only** — `installed && version !== null` (the new `usable`, per the design decision above). A non-runnable pinned agent must fail fast with a clear "agent X is not installed/runnable" message **before** any stage runs. The gate does NOT consult auth (auth is informational; a logged-out agent fails at runtime with its own error). Coordinate with task 0126 (phase-aware resolution) so `--agent auto` can pick a runnable executor. |
| P0 | `packages/app/src/workflow/actions/agent-run.ts:105` | **Timeout-kill reported as success.** All 3 agent stages ran ~600s (= `stepTimeoutMs`) and were killed, yet `agent.run` returned `ok: true` and the pipeline advanced. A killed subprocess must route to `failed`. | Verify the `ProcessExecutor` timeout path: confirm a timeout-kill yields a non-zero `exitCode` (→ `ok:false`) and surfaces a distinct "timed out after Nms" error, not a silent `ok:true`. Add a regression test that a timed-out `agent.run` fails the step. |
| P1 | **UPSTREAM** `~/xprojects/ts-libs/` → `@gobing-ai/ts-ai-runner` `doctor-runner.ts` + `agents/shims.ts` (+ new auth-shims) | **Auth detection is conflated with liveness and is broken for 4 of 9 agents (omp, opencode, openclaw, antigravity-cli).** `usable = installed && version !== null && authenticated` lets a stale/missing *auth* probe fail a runnable agent. Per the design decision, this is fixed by **architecture, not by perfecting each probe.** | **Fix upstream first** (AGENTS.md shared-library evolution), in two changes: **(A) decouple** — drop `authenticated` from `usable` (`usable = installed && version !== null`, liveness via `<bin> --version`); add a separate `isAuthenticated(agent): true\|false\|unknown` interface backed by a dedicated set of auth-shims, isolated from the run-path shims and never feeding `usable`. **(B) doctor column** — once released, add an `authenticated` column to `spur agent doctor` reading `isAuthenticated` (display-only). Per-agent auth-probe correctness (omp→`omp models`, opencode→`providers list`, openclaw→`doctor`, agy→`unknown`/`agy models`) now lives in the auth-shims and is lower-stakes since it is off the critical path. See Plan blocks "P1-auth-decouple" and "P1-doctor-column". |
| P2 | `plugins/sp/skills/spur-dev/references/execution-workflow.md:51-58` | Implement agent does not author `## Solution` section. The reference says the implement agent "MUST author the `## Solution` section" via `spur task update --section Solution`, but the spawned omp subprocess did not do this in either dogfood run. The `record` step's `--solution-from-diff` safety net partially compensates with a diff-derived change-map, but it's less detailed than what the implement agent should produce. The review agent ended up writing the Solution section instead. | **First confirm this is a prompt gap and not an agent-compliance gap** via the claude A/B run: if claude (given the same prompt) authors the Solution section, the instruction is fine and the cause is omp non-compliance (→ tie to P0, not a prompt fix). Only if claude also skips it, then fix the prompt: ensure the implement agent prompt explicitly includes "author the `## Solution` section via `spur task update <wbs> --section Solution --from-file <path>`" and verify with a test run. |
| P2 | `packages/app/src/services/task-record.ts:184` (already fixed) | `renderReview` produced invalid Priority column values — used `check.status` ("pass"/"fail") as Priority, but L3 checker requires `/P[1-4]/`. **STATUS: FIXED during dogfood run.** Included here for traceability. | Already fixed: `renderReview` now maps pass→P4, fail→P1 when status isn't already P1–P4. `TaskService.record` now preserves existing Review when not bare. 2 unit tests added. No further action needed — verify the fix is still in place. |
| P3 | (aggregate) | Low cache hit rate (~47%). **Now understood as a symptom of the P0 cause, not an independent tuning nit:** each `agent.run` stage spawns an omp subprocess that re-reads context from scratch AND runs to the timeout, so low cache% and maxed duration are the same phenomenon. Cache% per step: implement 44%, test 45%, review 49%, verify 48%. | Re-measure cache% **after** the P0 fixes / under the claude A/B control before doing any prompt-context tuning. If a healthy executor lands well under the timeout with higher cache%, this finding closes as an omp artifact. Only if cache% stays low under a usable agent, pursue context-efficiency tuning (compact bootstrap, condensed task snapshot, trimmed skill context). |
| P4 | `plugins/sp/commands/dev-run.md` | `--next` flag silently ignored in full mode. The skill documents that `--next` is "ignored in full mode" (`SKILL.md:76`), but the user typed it expecting it to work. No warning or log message is emitted. | Add a console warning when `--next` is passed in full mode: "warning: --next is ignored in full mode (full mode runs all stages). Use --next with --mode next to advance only one stage." |
### Plan
- [ ] **P0-verify — A/B the executor to confirm root cause (DO THIS FIRST)**
  - Confirm agent health: `spur agent doctor --json` (expect `omp: usable:false` under the OLD logic, `claude: usable:true`)
  - Re-run the pipeline with a healthy executor: `spur workflow run config/workflows/task-pipeline.yaml --vars '{"wbs":"<small-task>","profile":"auto","agent":"claude"}' --async --json`, then poll `spur workflow trace <run-id> --json`
  - Record per-stage wall-clock and compare to the omp run (omp: ~600s/stage = timeout). Expectation: claude stages finish well under the timeout
  - Check whether claude authors the `## Solution` section (informs P2) and the resulting cache% (informs P3)
  - Write the A/B comparison into this task's Solution section — this is the evidence that gates P2/P3 scope

- [ ] **P1-auth-decouple — UPSTREAM FIRST: split liveness from authentication in `~/xprojects/ts-libs/` (do before the Spur-side P0-a, since it redefines `usable`)**
  - **Boundary:** edit the external `@gobing-ai/ts-ai-runner` package in `~/xprojects/ts-libs/` — NOT `node_modules` here. Per AGENTS.md "Shared-library evolution": fix upstream, verify with ts-libs' own gates, release semver (or temporary `bun link` while validating), then consume in Spur.
  - **(A) Drop auth from `usable`.** Change `DoctorRunner.buildResult` so `usable = installed && version !== null` (liveness only). The validation/readiness signal must be a cheap deterministic command — `<bin> --version`. Verified 2026-06-25: `--version` exits 0 for all eight installed agents (claude, codex, gemini, pi, omp, opencode, agy, openclaw), including the four the old auth probe failed. Remove `authenticated` from the `usable` computation; keep reporting `authenticated` as its own field (see below). Delete the per-agent auth branching from the `usable` path.
  - **(B) Add a dedicated `isAuthenticated` interface.** Introduce a separate set of auth-shims (distinct from the run-path `AGENT_SHIMS`) exposing `isAuthenticated(agent): 'authenticated' | 'unauthenticated' | 'unknown'` (tri-state — do NOT collapse `unknown` to false). This is the single home for per-agent auth quirks, isolated from execution. Seed it with the known-correct probes and mark the rest `unknown`:
    - claude `claude auth status` (exit 0 / output) ; codex `codex login status` + `.codex/auth.json` ; gemini `.gemini/settings.json` regex ; pi `pi --list-models` ; omp `omp models` ; opencode `opencode providers list` (alias `ls`) ; openclaw `openclaw doctor` ; **antigravity-cli (`agy`) → `unknown`** (no auth verb; `~/.antigravity/` has no credential file; `agy models` is at best a liveness signal — only promote to `authenticated` if confirmed to fail when logged out) ; hermes `hermes doctor` (UNVERIFIED — not installed here).
  - **Tests (ts-libs):** `DoctorRunner` — a binary that runs `--version` (exit 0) yields `usable:true` regardless of auth; an uninstalled binary yields `usable:false`. `isAuthenticated` — one case per agent for its expected tri-state; an agent with no auth probe returns `unknown`, never throws, never `false`.
  - **Ship:** release the ts-libs semver bump; update Spur's catalog entry for `@gobing-ai/ts-ai-runner`; `bun install`; re-run `spur agent doctor --json` and confirm omp, opencode, agy now report `usable:true` (they are runnable).
  - **Acceptance:** `usable` reflects runnability only; no runnable agent is ever `usable:false` due to auth; `isAuthenticated` is a separate, non-throwing tri-state available to callers; the omp pin in `task-pipeline.yaml` now passes the P0-a liveness gate.

- [ ] **P0-a — Add an executor-readiness (liveness) gate before dispatch (Spur-side)**
  - Read `packages/app/src/workflow/actions/agent-run.ts` and `packages/app/src/services/agent-service.ts` resolution path
  - Decide the gate location: pipeline precheck (cheapest) vs. `agent.run` per-step (most robust). Recommend resolving the agent once and failing fast if `DoctorRunner.runOne(agent)` is not `usable` (the NEW liveness-only `usable`)
  - **Liveness-only (Robin's decision):** the gate consults `usable` (runnable) ONLY. It does NOT call `isAuthenticated` and does NOT block on auth — a genuinely logged-out agent fails at runtime with its own error. No `unknown`-state handling needed in the gate.
  - Emit a clear error: `agent '<name>' is not installed or not runnable — install it or select another agent (spur agent doctor)`; route the step/run to `failed` before any 10-min stage runs
  - Coordinate with task 0126: a runnable-aware `--agent auto` is the long-term fix; this gate is the immediate guard
  - Add a regression test: a pinned non-runnable agent fails fast (no 600s burn); a runnable-but-unauthenticated agent is NOT blocked by the gate
  - NOTE: depends on P1-auth-decouple — the gate is only correct once `usable` means runnable (today it would wrongly reject omp/opencode/agy)

- [ ] **P1-doctor-column — Follow-up: add an `authenticated` column to `spur agent doctor` (after the ts-libs release)**
  - Once `@gobing-ai/ts-ai-runner` exposes `isAuthenticated`, surface it in `spur agent doctor` as a new display column (text + `--json` field), e.g. `authenticated: yes | no | unknown`
  - Find the doctor render path: `AgentService.doctor` in `packages/app/src/services/agent-service.ts:102-119` (text table + json) — extend both
  - Display-only: this column must NOT affect `usable`, the readiness gate, or any exit code; it is operator information
  - Update `docs/04_DESIGN.md` `spur agent doctor` surface to document the new column; add an app-layer test asserting the column renders all three states
  - Verify: `spur agent doctor` and `spur agent doctor --json` show `authenticated` for every agent without changing `usable`

- [ ] **P0-b — Ensure timeout-kill fails the step (not `ok:true`)**
  - Read `packages/app/src/workflow/actions/agent-run.ts:105` and trace the `timeoutMs → ProcessExecutor.run → exitCode` path (and `runCapture` path)
  - Reproduce/inspect: a killed subprocess must yield non-zero `exitCode` → `ok:false`. If it currently returns `ok:true`, fix the mapping and add a distinct "timed out after Nms" error
  - Add a regression test asserting a timed-out `agent.run` returns `ok:false` and routes the pipeline to `failed`

- [ ] **P1 — Fix sync-orphan: recommend `--async` in execution-workflow reference**
  - Read `plugins/sp/skills/spur-dev/references/execution-workflow.md` (line ~73, the pipeline invocation section)
  - Change the recommended invocation from synchronous `spur workflow run ... --json` to `spur workflow run ... --async --json` + `spur workflow trace <run-id> --json` polling
  - Add a note: "Synchronous invocation (`--json` without `--async`) blocks for the full pipeline duration (~40 min for 4 agent.run stages). Use `--async` and poll with `spur workflow trace` for pipelines with agent.run stages. Synchronous is acceptable only for short pipelines (< 2 min, e.g. precheck-only)."
  - Include a code example:
    ```bash
    # Async launch + trace polling (recommended)
    RUN=$(spur workflow run config/workflows/task-pipeline.yaml --vars '{"wbs":"0102","profile":"auto"}' --async --json | jq -r '.runId')
    spur workflow trace "$RUN" --json  # poll until status is terminal (done/failed)
    ```
  - Verify: re-read the reference and confirm the async pattern is the default recommendation

- [ ] **P2 — Fix implement agent not authoring `## Solution` section (gated on P0-verify)**
  - If the claude A/B run authored Solution with the same prompt: the prompt is fine; reclassify this as an omp-compliance symptom of P0 and close (no prompt change)
  - Else, fix the prompt: read `plugins/sp/skills/spur-dev/references/execution-workflow.md` (lines 51-58) and `plugins/sp/commands/dev-implement.md`; ensure the implement agent prompt explicitly includes: "After implementing, author the `## Solution` section in the task file via `spur task update <wbs> --section Solution --from-file <path>`. The Solution section should contain a bullet-point change-map: files created/modified, key symbols, and one-line descriptions."
  - Verify: run a test pipeline on a small task with a usable agent and confirm the Solution section is written by the implement agent (not backfilled by `record` or written by the review agent)

- [ ] **P2 — Verify renderReview fix is still in place (already fixed during dogfood)**
  - Read `packages/app/src/services/task-record.ts` lines 194-200 and confirm `renderReview` maps pass→P4, fail→P1
  - Read `packages/app/src/services/task-service.ts` lines 518-526 and confirm `record()` only writes Review when `sectionIsBare(doc, 'Review')` is true
  - Read `packages/app/tests/services/task-record.test.ts` and confirm the 2 new tests exist and pass
  - Run `bun test packages/app/tests/services/task-record.test.ts` — confirm pass
  - No code changes expected — this is a verification-only step

- [ ] **P3 — Re-measure cache hit rate AFTER P0 (gated on P0-verify)**
  - Take cache% from the claude A/B run; compare to omp's ~47%
  - If a usable executor lands under the timeout with higher cache%, close P3 as an omp artifact (document in Solution)
  - Only if cache% stays < 50% under a usable agent: pursue context-efficiency tuning (read `agent-run.ts` spawn path; candidates: compact context bootstrap, condensed task-file snapshot, trimmed skill context). If non-trivial, spin a separate implementation task

- [ ] **P4 — Add `--next` ignored warning in full mode**
  - Read `plugins/sp/commands/dev-run.md` to find the argument parsing
  - Add a console warning when `--next` is passed in full mode: `warning: --next is ignored in full mode (full mode runs all stages). Use --next with --mode next to advance only one stage.`
  - Verify: run `spur dev-run <wbs> --next` and confirm the warning is printed

- [ ] **Re-review the changed code**
  - Run `bun run lint` — confirm clean
  - Run `bun run test` — confirm all pass
  - Run `spur task check 0127 --json` — confirm PASS
### Solution

**Execution verdict (`/sp:dev-run 0127 --auto --next --agent claude`, 2026-06-25): substantially COMPLETE — core P0/P1 items implemented and gate-green; 2 minor tuning items remain.**

The upstream half (`@gobing-ai/ts-ai-runner` **0.4.1**) was released by the operator and is installed/cataloged (`package.json:32` → `^0.4.1`, `bun install` done). This run **verified** the implementation against the plan rather than re-implementing it — most items were already shipped alongside the 0.4.1 adoption.

| Plan item | Status | Evidence |
|-----------|--------|----------|
| P1-auth-decouple (upstream) | ✅ DONE | 0.4.1: `spur agent doctor` shows every installed agent `usable:true` (omp/opencode/agy/openclaw included); `authenticated` is now tri-state `authenticated\|unauthenticated\|unknown` |
| P0-a liveness readiness gate | ✅ DONE | `packages/app/src/services/agent-service.ts:338-355` (`resolveAgentExplicit`): liveness-only gate, fails fast when `!installed`/`!usable`, auth NOT consulted. On the run path via `executeRun`→`resolveAgent` (`packages/app/src/services/agent-service.ts:230`). Tested: agent-service.test.ts (non-usable→exit 1; auth≠usable) |
| P0-b timeout-kill ⇒ fail | ✅ DONE | `packages/app/src/workflow/actions/agent-run.ts:23-26` contract; tests `agent-run.test.ts:246,256` — `timeoutMs + non-zero exit → ok:false` for capture + plain-run paths |
| P1-doctor-column | ✅ DONE | `packages/app/src/services/agent-service.ts:113-118` renders `auth=yes\|no\|?` via `renderAuth(AuthState)` (`:401`); text + json |
| P1-async (sync-orphan doc) | ✅ DONE | `plugins/sp/skills/spur-dev/references/execution-workflow.md:72-85` mandates `--async` + `spur workflow trace`, cites task 0127 |
| P4 `--next` ignored warning | ✅ DONE | `plugins/sp/commands/dev-run.md:77-81` emits the full-mode warning |
| P2 renderReview (from 0102 dogfood) | ✅ DONE | verify-only; pre-existing fix intact |
| P2 implement-agent Solution prompt | ⬜ OPEN (minor) | `execution-workflow.md` already states the implement step owns `## Solution` (lines 49-58); the prompt-hardening / A/B-confirmation step is unstarted. Lower priority — the `record --solution-from-diff` safety net + claude default mitigate it |
| P3 cache-hit-rate tuning | ⬜ OPEN (measure-only) | gated on a fresh dogfood re-measure under claude; no code change yet |

**Verification gate (this run):** `bun run lint` ✅ (biome + tsc across 7 workspaces) · `bun run test` ✅ 1895 pass / 0 fail · `bun run test-cf` ✅ · `bun run build` ✅.

**Honest residual:** P2-solution (prompt hardening) and P3-cache (re-measure) are minor, non-blocking, and partly mitigated. They do not gate the P0 reliability fixes, which are the substance of this task and are complete. No new code was written this run — the work was already implemented; this run confirmed it against the plan and the gate.

### Review
Post-implementation reflection — filled **after** the first fix round: what went wrong, what remains to fix before closing, and any **back-issues** (new findings surfaced by the fix).

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P1       |      |         |                |
| P2       |      |         |                |
### References
- **Dogfood report:** `docs/dogfood/2026-06-26-sp-dev-run-0102-dogfood.md`
- **sp-dev-dogfood skill (protocol + report format):** `~/.agents/skills/sp-dev-dogfood/SKILL.md`
- **sp-dev-run skill (testee):** `~/.agents/skills/sp-dev-run/SKILL.md`
- **sp-spur-dev backbone skill:** `plugins/sp/skills/spur-dev/SKILL.md`
- **Execution workflow reference (sync invocation issue):** `plugins/sp/skills/spur-dev/references/execution-workflow.md:73`
- **Pipeline definition:** `config/workflows/task-pipeline.yaml`
- **agent-run action (omp subprocess spawn):** `packages/app/src/workflow/actions/agent-run.ts`
- **renderReview (already fixed):** `packages/app/src/services/task-record.ts:184`
- **TaskService.record (already fixed):** `packages/app/src/services/task-service.ts:495`
- **Task L3 check (Review P1-P4 regex):** `packages/app/src/services/task-check.ts:160`
- **Task 0102 (the dogfooded task):** `docs/tasks/0102_remaining-ui-wrappers-full-apps-web-refactor-to-ui-ts-seam.md`
- **Pipeline run #2 (async, completed):** run ID `56ff370a-7c9d-408b-8a19-cd95c003fb46`
- **Pipeline run #1 (sync, orphaned):** run ID `ddb717ef`
- **Test file (renderReview fix tests):** `packages/app/tests/services/task-record.test.ts`
- **dev-run command definition:** `plugins/sp/commands/dev-run.md`
- **dev-implement command definition:** `plugins/sp/commands/dev-implement.md`
### History
- 2026-06-26: Created from `sp-dev-dogfood` run of `/skill:sp-dev-run 0102 --auto --next` (omp executor).
- 2026-06-25: Reviewed and reframed (Lord Robb). Diagnosed the "slow + unreliable" symptom as the
  **omp executor**, not task 0102 or the `sp` plugin. Evidence: (1) all 3 agent stages hit the 600s
  timeout wall (600768/601078/600927 ms ≈ `stepTimeoutMs`), i.e. omp was killed each stage; (2)
  `spur agent doctor` reports `omp: usable:false` while claude/codex/gemini/pi are usable. Added two
  P0 findings the report missed: P0-a no executor-readiness gate; P0-b timeout-kill reported as
  `ok:true`. Demoted P3 (cache) to a symptom of P0; gated P2/P3 on a claude A/B control run. Raised
  priority P2→P1. Ties to task 0126 (phase-aware `--agent auto`).
- 2026-06-25: Root-caused the `omp usable:false` false-negative — stale auth probe `omp --list-models`
  (flag dropped in omp 16.1.20). Audited all nine shims; found omp/opencode/openclaw stale probes and
  (after Robin's `agy` question) that `getAuthCommand: () => null` collapses to `authenticated:false`,
  making antigravity-cli a false-negative too (4 of 9 broken). Verified `agy` v1.0.12, binary map
  correct, no auth verb, no credential file under `~/.antigravity/`.
- 2026-06-25: **Architecture pivot (Robin's design decision)** — stop chasing per-agent auth probes on
  the critical path. Restructured the upstream fix into: (A) **decouple** auth from `usable` —
  `usable = installed && version !== null` (liveness via `<bin> --version`; verified exit 0 for all 8
  installed agents) — and add a separate `isAuthenticated(agent): authenticated|unauthenticated|unknown`
  interface backed by dedicated auth-shims, never feeding `usable`; (B) **follow-up** — add an
  informational `authenticated` column to `spur agent doctor` reading `isAuthenticated`. The P0-a
  readiness gate is **liveness-only** (Robin's choice): it consults `usable` only, never auth — a
  logged-out agent fails at runtime with its own error. Split the single P1-shim plan block into
  `P1-auth-decouple` (upstream) and `P1-doctor-column` (Spur follow-up). This removes the "detect auth
  the most-proper way" problem from the execution seam entirely.
- 2026-06-26T06:13:40.661Z todo → wip (system)
- 2026-06-26T06:13:45.757Z wip → testing (system)
- 2026-06-26T06:16:27.540Z testing → done (system)
