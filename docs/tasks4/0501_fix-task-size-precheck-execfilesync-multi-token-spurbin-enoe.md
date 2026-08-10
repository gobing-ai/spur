---
template: issue
schema_version: 1
name: "Fix task-size-precheck execFileSync multi-token spurBin ENOENT"
description: ""
status: todo
type: issue
profile: standard
feature_id: F
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-10T18:03:36.667Z"
updated_at: "2026-08-10T18:21:51.269Z"
---

## 0501. Fix task-size-precheck execFileSync multi-token spurBin ENOENT

### Background
**Forensic origin:** `sp-dev-find-issue` on the find-conflict dogfood sessions
(2026-08-09/10). Pipeline run `1d21cbbf` for task 0499 failed at precheck —
`task-size-precheck: FAIL — could not fetch task 0499 via /Users/robin/.proto/tools/bun/1.3.14/bun /Users/robin/xprojects/spur-new/apps/cli/src/index.ts`.

**Root cause:** `resolveSpurBin()` (`apps/cli/src/workflow/resolve-spur-bin.ts:38-44`) emits a
two-token invocation `<runtime> <mainModule>` whenever spur runs under the Bun/Node runtime —
correct for the shell `$spurBin` usage in workflow guards, and documented in that file's own
launch-mode table. `apps/cli/src/commands/workflow.ts:293` and `:339` inject that string into
every run as `vars.spurBin`, and `config/workflows/task-pipeline.yaml:209` forwards it as
`--spur-bin "$spurBin"`. `plugins/sp/scripts/task-size-precheck.ts` then hands the whole
string to `execFileSync(spurBin, [...])` at `:107` and `:124`. `execFileSync` treats its first
argument as one executable path, so a multi-token `spurBin` is ENOENT.

**Blast radius is production, not just dev.** Per the launch-mode table, `<runtime>
<mainModule>` is emitted for **both** `bun run apps/cli/src/index.ts` (dev) **and**
`bun install -g @gobing-ai/spur` (the normal end-user install — bun runtime + `spur.js`).
Only the compiled single-file binary yields a single token. Every registry user running
`task-pipeline.yaml` hits this.

**Two distinct symptoms, one cause:**

- `:124` (`task show`) — loud: the catch writes `FAIL` to
  `.spur/run/<wbs>-precheck-size.status`, the `precheck → implement` guard
  (`task-pipeline.yaml:455`) requires `= PASS`, and the run falls through the
  `precheck → failed` always-transition. The pipeline stops.
- `:107` (`agent doctor` capability tier) — **silent**: the catch returns `'standard'`, so
  every executor reads as sub-capable and a large task blocks with a
  "requires a capable executor" reason that is simply false. A wrong answer, not an error.

**Measured session cost (re-derived from the JSONL, 2026-08-10, not taken from the
post-mortem's estimate):** the cited session
(`…07-07-30-420Z_019fea7f…jsonl`, 546 tool calls) contains **3** `--force-done`
invocations and **2** `workflow run …task-pipeline` launches. Across all six dogfood session
files of 2026-08-09/10 (2700 tool calls): **18** `--force-done`, **7** pipeline launches, and
**15** log lines carrying `could not fetch task`. The first draft's "6 force-done + 6
relaunches" matches neither figure. Causal attribution of the force-done calls to this bug is
**not** established — the precheck failure does block the pipeline, and `--force-done` is one
observed workaround among several. Treat the cost as "blocks every pipeline run under a
runtime launch", which is severity enough; do not carry a fabricated waste total forward.
### Requirements
- [ ] R1. Split a multi-token `spurBin` into its executable and leading arguments before
  every `execFileSync` in `plugins/sp/scripts/task-size-precheck.ts`, so a
  `<runtime> <mainModule>` value resolves instead of raising ENOENT. Reuse the split already
  established in this repo — `runSpurJson` in `plugins/sp/scripts/feature-sync-bounded.ts:264-267`
  (`spurBin.split(/\s+/).filter(Boolean)` → `[cmd, ...args]`); do not invent a third helper
  shape.
- [ ] R2. Apply the fix at **both** call sites: `resolveCapabilityTier` (`:107`) and the
  `task show` fetch (`:124`). The tier site currently swallows the failure (`catch` returns
  `'standard'`), so it must be proven by its own test rather than assumed fixed alongside
  `:124`.
- [ ] R3. Preserve two existing invariants: the single-token case (compiled binary
  `spurBin`) keeps working, and the invocation stays `execFileSync` with an **argv array** —
  never a shell string assembled from `spurBin` or `--executor`. `plugins/sp/tests/task-size-precheck.test.ts:7`
  ("passes executor names as argv, not shell source") is the shell-injection guard this
  protects; a fix routed through `execSync`/`spawn(..., {shell:true})` regresses it.
- [ ] R4. Regression coverage in `plugins/sp/tests/task-size-precheck.test.ts` for
  multi-token and single-token `spurBin` across both call sites, using the existing fake-spur
  fixture pattern in that file (temp dir + `chmod 0755` stub script).
- [ ] R5. Under the real injected `spurBin`, a within-limits task yields
  `PASS` in `.spur/run/<wbs>-precheck-size.status`, so the `precheck → implement` guard
  (`config/workflows/task-pipeline.yaml:455`) evaluates true instead of routing to `failed`.
### Acceptance Criteria
```gherkin
Scenario: R1 — multi-token spurBin resolves on the task-fetch call site
  Given a runtime launch where spurBin = "<abs bun path> <abs path to apps/cli/src/index.ts>"
  # the same two-token form resolveSpurBin() emits for `bun install -g @gobing-ai/spur`
  When task-size-precheck runs for a within-limits task
  Then it fetches the task JSON without ENOENT
  And it writes PASS to .spur/run/<wbs>-precheck-size.status
  And stderr contains no "could not fetch task" line

Scenario: R2 — multi-token spurBin resolves on the capability-tier call site
  Given the same two-token spurBin and a fake spur whose `agent doctor --json`
    reports capabilityTier "capable-1"
  And a task above the large-task thresholds (>5 R-items or >8 Plan items) with raised --max-* caps
  When task-size-precheck runs with --executor <name>
  Then the run writes PASS
  # Pre-fix this wrote FAIL: the ENOENT catch silently downgraded the tier to "standard"

Scenario: R3 — single-token spurBin (compiled binary) still works
  Given spurBin = "/path/to/dist/cli" (a single executable)
  When task-size-precheck runs for a within-limits task
  Then it fetches the task JSON successfully and writes PASS

Scenario: R4 — regression suite covers both shapes and keeps the argv-not-shell guard
  Given plugins/sp/tests/task-size-precheck.test.ts
  When bun test plugins/sp/tests/task-size-precheck.test.ts runs
  Then it contains cases for multi-token and single-token spurBin on both call sites
  And the existing case at :7 passes unmodified — with --executor "standard; touch <sentinel>",
    <sentinel> does not exist
  And the regex-drift case at :48 still passes

Scenario: R5 — pipeline precheck transition passes
  Given a runnable within-limits task and an authenticated executor
  When task-pipeline.yaml runs the size-precheck step under a runtime-launched spur
  Then .spur/run/<wbs>-precheck-size.status is PASS
  And the precheck → implement guard (task-pipeline.yaml:455) evaluates true
  # `workflow run --dry-run` cannot certify this — it walks transitions WITHOUT
  # executing actions, so the precheck shell step never runs. Use a real run, or
  # invoke the script directly with the two-token spurBin (see Plan step 1).
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design
**Evidence (verified at HEAD 0.3.41):**

- `apps/cli/src/workflow/resolve-spur-bin.ts:38-44` — `resolveSpurBinFrom` returns
  `${launch.execPath} ${launch.mainModule}` for **both** runtime launch modes (dev and
  global npm install); only a compiled binary returns a single token.
- `apps/cli/src/commands/workflow.ts:293` and `:339` — `vars: { spurBin: resolveSpurBin(), … }`
  injects it into every workflow run.
- `config/workflows/task-pipeline.yaml:209` — forwards it as `--spur-bin "$spurBin"`.
- `plugins/sp/scripts/task-size-precheck.ts:107` —
  `execFileSync(spurBin, ['agent','doctor',executor,'--json'], …)`.
- `plugins/sp/scripts/task-size-precheck.ts:124` —
  `execFileSync(spurBin, ['task','show',wbs,'--json'], …)`.
- `config/workflows/task-pipeline.yaml:455` — the `precheck → implement` guard requires
  `= PASS`; `:456-461` routes to `failed` otherwise.
- `.spur/run/1d21cbbf-1c4f-4d15-915a-dbacc078ffb7.log` — `task-size-precheck: FAIL — could
  not fetch task 0499 via …bun …apps/cli/src/index.ts`; `↪ precheck → failed`.
- **Independently reproduced 2026-08-10** while reviewing task 0500:
  `bun plugins/sp/scripts/task-size-precheck.ts --wbs 0500 --spur-bin "bun run apps/cli/src/index.ts" …`
  → `task-size-precheck: FAIL — could not fetch task 0500 via bun run apps/cli/src/index.ts`.

**Blast radius — verified complete.** A sweep of every `execFileSync`/`spawnSync` consumer of
a resolved `spurBin` (`rg 'execFileSync\(|spawnSync\(' plugins/sp/scripts packages/app/src scripts`)
finds exactly two defective sites, both in `task-size-precheck.ts`. The other consumers are
already correct:

- `plugins/sp/scripts/feature-sync-bounded.ts:264-267` (`runSpurJson`) splits on `/\s+/`
  before spawning — **this is the reference implementation to mirror**.
- `apps/cli/src/commands/workflow.ts:270-271` splits with `.split(' ')` for the async worker.
- `packages/app/src/workflow/lifecycle-adapter.ts:227` and every `$spurBin …` in
  `task-pipeline.yaml` pass through a shell, where the two-token form is correct by design.

So this is a single-file fix, not a systemic one — no shared helper package is warranted.

**Fix design.** In `task-size-precheck.ts`, derive `[file, ...leadingArgs]` once from
`spurBin` and spread the leading args ahead of the static argv at both sites:

```text
const [file = 'spur', ...lead] = spurBin.split(/\s+/).filter(Boolean);
execFileSync(file, [...lead, 'task', 'show', wbs, '--json'], …)
execFileSync(file, [...lead, 'agent', 'doctor', executor, '--json'], …)
```

Single-token input degrades to `lead = []`, i.e. today's behavior. Stays on `execFileSync`
with an argv array — no shell — so the injection guard at
`plugins/sp/tests/task-size-precheck.test.ts:7` holds unchanged (R3).

**Constraint from the script's own header:** it "ships with the plugin to arbitrary projects,
so it stays node-builtin-only — no workspace imports". Keep the split inline in this file;
do not import from `packages/app` or add a shared module under `plugins/sp/scripts/`.

**Target:** `plugins/sp/scripts/task-size-precheck.ts` (both call sites) +
`plugins/sp/tests/task-size-precheck.test.ts` (regression coverage).

**Deliberately out of scope (noted, not fixed here):**

- The catch branch conflates *infrastructure failure* with *size verdict*: an unreachable
  spur writes `FAIL` to the same status file a genuinely oversized task does, so the operator
  is nudged to decompose the task or raise `--max-*` caps for a problem that is neither.
  A distinct status value (or a non-zero exit for fetch failure) is the real hardening; it
  changes the guard contract in `task-pipeline.yaml` and belongs in its own task.
- `resolveCapabilityTier`'s silent `catch → 'standard'` has the same shape. After this fix
  the ENOENT path is gone, but any other doctor failure still reads as `standard`.
- The duplicated counting regexes between `plugins/sp/scripts/task-size-precheck.ts:33,36`
  and `packages/app/src/services/task-size-precheck.ts` (a drift test at
  `plugins/sp/tests/task-size-precheck.test.ts:48` currently holds them aligned).
### Plan
1. **Reproduce** the failure before touching code:
   `bun plugins/sp/scripts/task-size-precheck.ts 0501 --spur-bin "$(which bun) $PWD/apps/cli/src/index.ts"`
   → expect `could not fetch task 0501` and `FAIL` in `.spur/run/0501-precheck-size.status`.
2. **Read** `plugins/sp/scripts/feature-sync-bounded.ts:264-267` (`runSpurJson`) — mirror that
   split shape rather than inventing a new one.
3. **Apply** the `[file, ...lead]` split at `:107` and `:124`, keeping `execFileSync` + argv
   array (no shell).
4. **Extend** `plugins/sp/tests/task-size-precheck.test.ts` with the AC1–AC3 cases, reusing
   the existing fake-spur fixture (temp dir + `chmod 0755` stub). For the multi-token case,
   build the spurBin as `"<bun> <path-to-stub.ts>"` or `"/bin/sh <stub.sh>"` so the split is
   genuinely exercised. Leave the AC4 injection test untouched.
5. **Verify** narrow first: `bun test plugins/sp/tests/task-size-precheck.test.ts`, then
   re-run step 1 and expect `PASS`.
6. **Smoke** the real transition: a non-dry `workflow run .spur/workflows/task-pipeline.yaml`
   for a runnable task, confirming `.spur/run/<wbs>-precheck-size.status` is `PASS` and the
   run advances past `precheck`. `--dry-run` is **not** a valid smoke here — it walks
   transitions without executing actions, so the precheck step never runs.
7. **Gates:** `bun run lint` and `bun run test` green; intentional `git status` only.
### Root Cause
**Isolated and reproduced 2026-08-10.** `resolveSpurBin()` deliberately emits a two-token
`<runtime> <mainModule>` invocation for every runtime launch
(`apps/cli/src/workflow/resolve-spur-bin.ts:38-44`), which is correct for the `$spurBin`
shell interpolations throughout `task-pipeline.yaml`. `plugins/sp/scripts/task-size-precheck.ts`
consumes the same value through `execFileSync`, whose first argument is a single executable
path — not a command line. The two tokens are therefore looked up as one filename and the
call raises ENOENT.

Reproduction (any runtime launch):

```bash
bun plugins/sp/scripts/task-size-precheck.ts 0501 \
  --spur-bin "$(which bun) $PWD/apps/cli/src/index.ts"
# → task-size-precheck: FAIL — could not fetch task 0501 via <bun> <…index.ts>
# → .spur/run/0501-precheck-size.status == FAIL
```

Control (single token) succeeds, which is why the bug never appears under a compiled binary
and never appeared in the existing test suite — `plugins/sp/tests/task-size-precheck.test.ts`
only ever passes a single-token fake spur.

The `FAIL` status then fails the `precheck → implement` guard
(`config/workflows/task-pipeline.yaml:455`, which requires literal `PASS`) and the run takes
the `precheck → failed` always-transition.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Session (cited in the post-mortem): `~/.omp/agent/sessions/-xprojects-spur-new/2026-08-10T07-07-30-420Z_019fea7f-78f4-7000-85b1-72ed73b73689.jsonl`
  (546 tool calls). Cost figures in Background were re-derived from this file plus the five
  sibling dogfood sessions of 2026-08-09/10 in the same directory.
- Run log: `.spur/run/1d21cbbf-1c4f-4d15-915a-dbacc078ffb7.log`
- Defect: `plugins/sp/scripts/task-size-precheck.ts:107,124`
- Source of the two-token value: `apps/cli/src/workflow/resolve-spur-bin.ts:38-44`
- Injection points: `apps/cli/src/commands/workflow.ts:293,339`;
  `config/workflows/task-pipeline.yaml:209`
- Consuming guard: `config/workflows/task-pipeline.yaml:455` (`= PASS` required),
  `:456-461` (`precheck → failed`)
- Reference implementation to mirror: `plugins/sp/scripts/feature-sync-bounded.ts:264-267`
  (`runSpurJson` — already splits `spurBin` correctly)
- Invariant to preserve: `plugins/sp/tests/task-size-precheck.test.ts:7`
  (argv-not-shell injection guard), `:48` (regex drift alignment with
  `packages/app/src/services/task-size-precheck.ts`)
- Skill: `sp-issue-finding` (B1, S0)
### History
- 2026-08-10T18:21:51.269Z backlog → todo (system)
