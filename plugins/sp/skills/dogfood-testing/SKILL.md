---
name: dogfood-testing
description: "Drive a testee (skill/command/CLI) end-to-end as a real user, fix within a bounded retry budget, monitor with a live ledger, emit a structured report. Triggers: \"dogfood this\", \"drive this command end-to-end\", \"test this skill as a user\", \"dogfood report\"."
license: Apache-2.0
metadata:
  author: spur
  version: "1.2"
  protocol: "sp:dogfood-testing@1.2"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  interactions:
    - pipeline
    - reviewer
  modes:
    - observe
    - fix
  phases:
    - plan
    - execute
    - monitor
    - report
  openclaw:
    emoji: "🐕"
---

# Dogfood Testing — The Backbone Skill

`sp:dogfood-testing` drives an agent skill, slash command, or CLI invocation **end-to-end** as a
real user would: run the testee step by step, fix what breaks (within a bounded retry budget),
monitor the whole run with a live ledger, and emit a structured report of what happened, what broke,
what was fixed, and what should improve.

This is the codification of the manual dogfooding loop run across tasks `0109`–`0114` and `0124`.
It backs the `/sp:dev-dogfood` thin-wrapper command — the command parameterizes the testee and
sinks; this skill owns the protocol.

## The 4-phase protocol at a glance

```
testee (a /sp:... command, Skill(...), or shell CLI invocation)
  → PLAN     classify + derive steps + open dual artifacts (live + docs/dogfood) with status:running
  → EXECUTE  run each step as a user; on failure, bounded diagnose→fix→re-run (or observe-only)
  → MONITOR  dual-write ledger row to disk on every step resolve — never reconstruct from memory
  → REPORT   finalize-or-abort (non-skippable): status complete|aborted, Cost block, both paths, footer
```

## Arguments

The command forwards these via `$ARGUMENTS`:

| Argument | Description | Default |
| ---------- | ------------- | --------- |
| `testee` | What to exercise — a slash command, agent skill, or CLI invocation (positional, required). Quote it if it contains flags. | (required) |
| `--agent <name\|auto>` | **Testee-scoped** agent: the agent the **testee** runs under, forwarded into the testee invocation. The driver (this skill) always runs in the current session. **Omit it** to forward nothing — the testee runs under its own default. See [§Testee-scoped agent](#testee-scoped-agent). | (omitted → forward nothing) |
| `--max-retry <n>` | Fix attempts per failed step. The **default is `2`** (fix mode): apply `Edit`/`Write` fixes to the working tree, up to 2 attempts per step. This flag is **mandatory** for two independent mutation sources: (a) pipeline-driving testees and (b) testees carrying a mutating `--fix` mode (`--fix all` / `--fix blockers-first`). Pass `--max-retry 0` for **observe-only**, or `--max-retry N` to acknowledge fix-mode mutation risk. For a mutating-`--fix` testee, `--max-retry 0` bounds the **driver only** — the testee still mutates the tree. | `2` unless the testee is pipeline-driving or carries a mutating `--fix` mode |
| `--save` | **Back-compat no-op for delivery.** Reports are always written to `docs/dogfood/…` and `.spur/run/dogfood/<run_id>.md`. The flag still documents/prints the report path. | always-on (flag optional) |
| `--task` | File findings as a review-template task via `spur task create --template review`. | off |
| `--chain-follow` | **Operator override for `--next` chains.** Permits the driver to follow the chain into named chained-leg artifacts (`.spur/run/<wbs>-verdict.json`, task-file section diffs, review tables) and attribute normally instead of stopping at the testing boundary. The flag licenses reading chained-leg evidence that already exists; it does NOT license the driver to execute the chained leg itself. Omit it to keep stop-at-testing as the default. See [§`--next` chain stop-at-testing](#next-chain-stop-at-testing) and [§Platform boundary (Claude Code)](#claude-code). | off |
| `--full` | Full report verbosity — emit all six sections even when a step set is sparse. Default omits empty narrative sections. | off |

> **Single-dash lenient parsing (R6b).** The argument parser accepts `-flag value` as equivalent to
> `--flag value` for `--max-retry`, `--agent`, `--save`, `--task`, `--full` (and their `--fix`/
> `--steps` siblings). This is intentional back-compat for terminal ergonomics, but it collides with
> the mutating-fix refuse-gate, which keys on `--max-retry` presence: an operator typing
> `-max-retry 3` on a pipeline-driving testee would bypass the refuse message if the gate ran on
> the raw string. It does not — the gate runs on the **normalized** token after parse. The driver
> MUST echo the normalized flag in its Phase-1 plan output (`Plan: testee invoked as …
> --max-retry 3 …`), not the operator's original spelling, so the operator sees which form was
> honored. A run that silently parsed `-max-retry 3` without echoing the normalized form is a P4
> finding (verify-0293) — the parsing is allowed, the silent treatment is not.

> ⚠️ **Repo-mutation warning.** The default is **fix mode (`--max-retry 2`)** — it applies
> `Edit`/`Write` fixes to the working tree as it finds breakages. For a non-mutating run, opt into
> **observe-only** with `--max-retry 0`: monitor and report, never touch files, full findings report
> still produced. Omission is ambiguous and MUST fail before planning when **either** of two
> independent mutation sources is present:
>
> - **Pipeline-driving testees** — tokens
>   [`--next`, `dev-runall`, `dev-wrapall`, `dev-run`, `dev-wrap`, `dev-idea`,
>   `runall`, `wrapall`, `run`, `wrap`, `idea`] matched as a **distinct hyphen-word**
>   (machine-checked by
>   [`detectPipelineDriving`](../../scripts/dogfood-testing/detect-pipeline-driving.ts);
>   see [§Pipeline-driving word-boundary contract](#pipeline-driving-word-boundary-contract))
>   → `⚠ pipeline-driving testee detected; pass --max-retry 0 (observe-only) or --max-retry N (fix mode, tree mutation acknowledged)`.
> - **Mutating `--fix` modes** — `--fix all` / `--fix blockers-first`, boundary-guarded via
>   [`hasMutatingFixMode`](../../scripts/dogfood-testing/detect-pipeline-driving.ts) (never matches
>   `--fix none` / `--focus all` / `--prefix all`). No pipeline token required: a verify/review leg
>   with `--fix all` mutates the tree on its own (0280 dogfood P2, task 0293). Honesty note:
>   `--max-retry 0` here bounds **the driver only** — the testee still mutates the tree — so the
>   refuse message is
   `⚠ mutating --fix mode detected (--fix all | --fix blockers-first); pass --max-retry 0 (observe-only for the driver; the testee still mutates the tree) or --max-retry N (fix mode, driver + testee both mutate)`.

## Phase 1 — Plan

0. **Refuse ambiguous mutation-source testees (live CLI gate — not prose-only).** Before deriving
   steps, run the machine-checked detector as a shell command (do **not** re-implement the matcher
   in-agent):

   ```bash
   node "$(superskill script path sp dogfood-testing/detect-pipeline-driving.mjs)" \
     --testee "<raw testee string>" \
     [--max-retry-present]
   ```

   - Exit **2** → print the stdout refuse line and **stop** (do not plan). The CLI refuses on either
     of two independent mutation sources (task 0293); print whichever refuse message it emits:
     - pipeline-driving: `⚠ pipeline-driving testee detected; pass --max-retry 0 (observe-only) or --max-retry N (fix mode, tree mutation acknowledged)`.
     - mutating `--fix`: `⚠ mutating --fix mode detected (--fix all | --fix blockers-first); pass --max-retry 0 (observe-only for the driver; the testee still mutates the tree) or --max-retry N (fix mode, driver + testee both mutate)`.
   - Exit **0** → proceed. Do not auto-substitute `--max-retry 0`.
   - The matcher contract is unit-checked by `tests/dogfood-testing/pipeline-detect.test.ts`.
     See [§Pipeline-driving word-boundary contract](#pipeline-driving-word-boundary-contract) and
     [§Mutating `--fix` mode contract](#mutating---fix-mode-contract).
1. **Resolve + classify** the testee: slash command (`/sp:...`), agent skill (`Skill(...)`), or shell
   CLI (`spur ...`, `bun run ...`). Everything before the first dogfood flag is the testee; if it
   carries its own flags, it must be quoted.
2. **Derive ordered steps** from the testee's own docstring / `argument-hint` / workflow. If no step
   list can be derived, treat the whole invocation as one step.
2b. **Implement-heavy advisory (W8 — emit at derivation time).** Immediately after step derivation,
    re-run the gate with the derived step labels:

    ```bash
    node "$(superskill script path sp dogfood-testing/detect-pipeline-driving.mjs)" \
      --testee "<raw testee string>" \
      --max-retry-present \
      --steps "step1 label||step2 label||..."
    ```

    When stdout prints
    `⚠ implement-heavy pipeline dogfood: prefer --max-retry 0 (observe-only) or step-split; operator --max-retry N overrides`,
    surface that line in the live report §1/§2 **and** continue only because the operator already
    passed an explicit `--max-retry`. Prefer observe-only or step-split on the next run. Record the
    advisory in the ledger `Finding` column for implement-heavy steps. See
    [§Cost segmentation for implement-heavy steps](#cost-segmentation-for-implement-heavy-steps).
3. **Open dual artifacts (always-on delivery — not gated on `--save`).**
   - Generate `run_id` (uuid or timestamp-slug).
   - `mkdir -p .spur/run/dogfood docs/dogfood`.
   - Write **both** files with identical YAML frontmatter (`status: running`, testee, mode,
     timestamps, paths, `protocol: sp:dogfood-testing@1.2`) + six section heading stubs + empty
     Monitor Ledger table:
     - Live: `.spur/run/dogfood/<run_id>.md`
     - Report: `docs/dogfood/YYYY-MM-DD-<testee-slug>-dogfood.md`
   - Canonical frontmatter and skeleton: [report-template.md](references/report-template.md).
   - Column contract + dual-write: [monitor-ledger.md](references/monitor-ledger.md).
   - **R2 workspace fingerprint (fix-mode and mutating-`--fix` dogfoods only).** When the run is
     fix-mode or a mutating-`--fix` testee, record a `workspace_fingerprint` block (git HEAD +
     `git status --porcelain` hash + timestamp) in the live ledger frontmatter. See
     [§Workspace-drift guard](#workspace-drift-guard-r2--task-0296).

## Phase 2 — Execute + bounded fix

For each step, in order:

1. **Run** the step as a user would — forwarding `--agent` into the testee invocation (§below).
2. **Success** → log the row, advance.
3. **Failure** →
   - `--max-retry 0` → log as an **Unresolved issue** with diagnosis, mutate nothing, advance.
   - else → diagnose root cause → apply the smallest `Edit`/`Write` fix → **re-run the same step**,
     up to `--max-retry` times, but **first re-take the workspace snapshot and check drift**
     (R2 — see [§Workspace-drift guard](#workspace-drift-guard-r2--task-0296)). If drift is detected,
     append a `drift:external` warning row and emit a P2 finding; never attribute drifted files to
     the run or claim them as the fix. Pass within budget → **Fixed issue** (record the fix); still
     failing → **Unresolved issue** (record everything tried). Either way, advance — partial signal
     is the point.

**Fix discipline.** Fix the testee or its real dependency. Never weaken the testee, stub the failure
away, or `--no-verify` past a gate to make a step "pass". A fix that hides the bug you are hunting is
a **finding**, not a fix.

**Implement-heavy derived steps.** Each derived step that itself chains into further pipeline work
multiplies the run's blast radius — when a step is implement-heavy (a `--next` chain to `dev-run`, a
derived `wrap`/`wrapall`, a verify/review leg carrying a mutating repair mode `--fix all` /
`--fix blockers-first` — `--fix none` stays observational — or any testee that mutates more than its
own arguments), surface this in
the ledger row's `Finding` column and prefer **observe-only** or **step-splitting** rather than
driving the chain under fix mode. See
[§Cost segmentation for implement-heavy steps](#cost-segmentation-for-implement-heavy-steps) and
[§`--next` chain stop-at-testing](#next-chain-stop-at-testing).

## Phase 3 — Monitor

The ledger is updated **live on disk** during Phase 2 and is the single source of truth for the
report — the report is assembled from the files, not from memory.

On **every** step resolve:

1. Append/update the ledger row on the **live** file first.
2. Mirror the same row to the **report** path under `docs/dogfood/`.
3. Do **not** batch rows until Phase 4.

The final report MUST include a `### 3. Monitor Ledger` section containing those rows, and the
ledger's data-row count MUST equal the `**Steps:** N derived, N executed` declared in §2 of the report (N/A steps
documented explicitly as rows) — the cardinality rule in
[monitor-ledger.md](references/monitor-ledger.md). Full
methodology, column contract, token/cache estimation, multi-source Cost honesty, the cache-health
finding rule, and the **cache-conservation discipline** live in
**[monitor-ledger.md](references/monitor-ledger.md)**. Apply the conservation discipline while
monitoring — low cache% is usually the driver re-fetching data it already holds.

## Phase 4 — Report (finalize-or-abort — non-skippable)

**Terminal gate.** Before this skill may stop (PASS / PARTIAL / FAIL / observe-only end / abort /
any early exit), the driver MUST run the finalize-or-abort checklist. Skipping it is a **driver
contract violation**.

1. Set frontmatter `status: complete` or `status: aborted` and `finished_at`.
2. **Structure scrub (@1.2).** All six mandatory section headings exist **exactly once each**
   (`### 1.` … `### 6.` — duplicates refuse `complete`). §5 Issues carries both `#### Fixed` and
   `#### Unresolved` (with `(none)` when empty). Unfinished narrative sections:
   `⚠ incomplete — not reached` — never invent What-We-Did / Issues / Findings fiction, and no
   leftover "run in progress" markers may survive finalization.
3. **Ledger cardinality (@1.2).** Monitor Ledger data rows MUST equal the `**Steps:** N derived, N executed`
   declared in §2 (N/A steps documented explicitly as rows). A mismatch refuses `complete`.
4. Write the **Cost** block under §2 (ledger `~estimate` + Method + confidence; `Meter: n/a` or
   optional ccusage/agent usage when real). For any `chained:<step>` ledger row whose meter is not
   observable, Fresh/Cached MUST be `~unknown` (or Cached `~0` with Basis `unobservable`) **and**
   emit finding `P3 — chained-step cost not observable` — never invent chained totals.
5. **R2 drift check at finalize.** If a workspace fingerprint was recorded in Phase 1, re-take
   the snapshot and diff against baseline minus the run's own touched files. If drift is detected,
   append a `drift:external` warning row to the ledger and emit a mandatory P2 report finding
   (under §6 Findings) stating the run's evidence is degraded, not voided. Never claim drifted
   files as run work. See [§Workspace-drift guard](#workspace-drift-guard-r2--task-0296).
6. Sync final content to **both** live and report paths (always — not gated on `--save`).
7. **Footer mandatory (@1.2).** Print the mandatory summary footer with **both** `[Live: …]` and
   `[Report: …]` always, **and mirror the footer block at the end of the report file**. A report
   without the footer cannot set `status: complete`.
8. **Self-validate (task 0278 R6 — non-skippable).** Run the machine checker on the report body
   **before** claiming `status: complete`:

   ```bash
   node "$(superskill script path sp dogfood-testing/validate-report.mjs)" --file <report-path>
   ```

   Exit **0** → proceed. Exit **2** → set `status: aborted`, list every error code under §5
   `#### Unresolved`, do **not** claim complete (closes non-@1.2 shapes like `## §1` without
   `### 1.`–`### 6.` / footer). Exit **1** → usage/IO failure; fix path and re-run.
9. **Refusal rule (@1.2).** If any check above fails, set `status: aborted` (never `complete`) and
   list each failed check under §5 `#### Unresolved`.

Full section contract, frontmatter, Cost shape, and footer:
**[report-template.md](references/report-template.md)**.

**Sinks** (composable):

- **Always-on report files** → live + `docs/dogfood/YYYY-MM-DD-<testee-slug>-dogfood.md` (see Phase 1).
- `--save` → no-op for delivery; still print/document the report path (back-compat).
- `--task` → file findings as a review task (`spur task create --template review`), writing the
  **Findings** into the task's `#### Review Findings` table under `### Background`. See
  [report-template.md → Task sink](references/report-template.md) for the `task check` L3 contract.

## Testee-scoped agent

`dogfood-testing` is a **driver** that runs *other* testees, so `--agent` here is different from the
standard `/sp:dev-*` semantics: it sets the agent the **testee** runs under, **not** the driver.

- The **driver** (this skill — planning, monitoring, reporting) always runs in the **current
  session**. `--agent` never changes that.
- The **testee** invocation receives the forwarded `--agent`. Concretely: append/splice `--agent
  <value>` into the testee's own flags before running it.

```
/sp:dev-dogfood "/sp:dev-run 0125 --auto" --agent codex
        ↓ driver = current session (monitors, reports)
        ↓ testee runs as:  /sp:dev-run 0125 --auto --agent codex
```

If the testee does not accept `--agent` (e.g. a pure-inline command), record that as a **finding**
("testee ignores `--agent`") rather than forcing the flag. **Omitting `--agent` (the default)
forwards nothing** — the testee runs under whatever it would default to (which, for a `spur agent
run`-backed testee, is `--agent auto` → the configured default executor). There is no `inherit` or
`current` token: "run under the current agent" is simply the default for an inline slash command
(it executes in this session) and is **not** expressible for the spawned `spur agent run` path,
which always launches a fresh agent subprocess.

## When to use

- Debugging or hardening an agent skill / slash command you are actively developing.
- Validating a command works end-to-end before shipping it.
- Producing a structured findings report (and optionally a fix task) from a real run.

Do **not** use this skill for:

- Requirements-traceability verdicts — use `sp:code-verification` (`/sp:dev-verify`).
- SECU code review of a diff — use `sp:code-verification` (`/sp:dev-review`).
- Running a task through the fix pipeline — use `sp:spur-dev` (`/sp:dev-run`).

## Gotchas

1. **Observe-only for unfamiliar testees.** The default is fix mode (`--max-retry 2`), which mutates
   the working tree. Against any testee you don't own or fully trust — or one that drives a long,
   mutating pipeline — pass `--max-retry 0` first and inspect the findings before letting it apply
   fixes.
2. **The ledger is live on disk, not reconstructed.** Honest fixed-vs-unresolved accounting depends
   on dual-writing each step *as it happens* to both artifacts. Reconstructing at the end produces
   fiction. Working-memory-only ledgers are a contract violation.
3. **A hiding fix is a finding.** If "fixing" a step would mask the bug, log it as a finding and
   leave the step unresolved.
4. **Token numbers are estimates, but cache math is not free-form.** A skill cannot read its own
   exact token meter, so label numbers `~estimate` and put Method + confidence in the Cost block;
   however, cache% must be recomputable from Monitor Ledger row sums. Never invent or reuse a fixed
   percentage. Optional meters (`ccusage`, agent usage) are session/day scope — never fake per-step.
5. **Testee-scoped `--agent`.** Don't confuse the driver agent (always current) with the testee
   agent (the forwarded value).
6. **Stale command snapshot.** Slash-command definitions are snapshotted at session start. If you
   just edited the testee command's own `.md` (or this command's), invoking it in the **same
   session** may run the **old** body. Verify in a fresh session, or invoke the backing skill
   directly, before trusting an in-session dogfood of a command you just changed. Note same-session
   edits under §1 Testee when relevant.
7. **Finalize-or-abort is non-skippable.** Ending a run without updating `status`, syncing both
   paths, and printing the footer with `[Live:]` + `[Report:]` fails the delivery contract — even if
   the testee itself passed.
8. **`--save` is not required for a file.** Dual artifacts are always-on. Do not skip writing
   `docs/dogfood/` because the operator omitted `--save`.
9. **Pipeline-driving + implement-heavy derived step ⇒ prefer observe-only or step-split.** When the
   Phase 1.2b CLI emits the implement-heavy advisory (pipeline-driving + implement-heavy step), the
   dogfood run is **recursive**: it tests a pipeline that mutates the repo while the driver may also
   be in fix mode. Two mutation sources make attribution impossible. The advisory is **emitted at
   derivation time** (not only as docs-time guidance). Operator's explicit `--max-retry N` proceeds;
   prefer `--max-retry 0` or step-split next time. See
   [§Cost segmentation for implement-heavy steps](#cost-segmentation-for-implement-heavy-steps).
10. **`--next` chain stop-at-testing when provenance is missing.** A `--next` chain (refine→run,
   run→verify, etc.) runs each leg as its own pipeline stage. If the dogfood driver cannot observe
   the chain's intermediate artifacts (task file sections, verify verdicts, review tables) — because
   the chain ran in a subagent, a different session, or the artifacts were never written — the driver
   MUST stop at the **testing boundary** of the chained step and report "chained-step provenance
   missing; cannot attribute outcome" rather than fabricating an outcome from the final state. Do not
   change the chained lifecycle's code (dev-run/dev-verify); this is a reporting discipline, not a
   lifecycle change. See [§`--next` chain stop-at-testing](#next-chain-stop-at-testing).

## Pipeline-driving word-boundary contract

Pipeline-driving detection is **word-boundary**, not leading-space substring. The live gate is:

```bash
node "$(superskill script path sp dogfood-testing/detect-pipeline-driving.mjs)" --testee "<testee>" [--max-retry-present] [--steps "…"] [--json]
```

| Token shape | Examples | Matches | Rejects |
|-------------|----------|---------|---------|
| Flag / complete | `--next`, `dev-run`, `dev-runall`, `dev-wrap`, `dev-wrapall`, `dev-idea` | `/sp:dev-run 0125`, bare `--next` | `--next-gen`, `dev-runner` |
| Bare noun | `run`, `runall`, `wrap`, `wrapall`, `idea` | `task run 0042` | `runaway`, `wrapper`, `idealist` |

`-` is a **word character** for boundaries: a token must be a distinct hyphen-word. Contract tests:
`plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts`. Helpers:
`detectPipelineDriving`, `isImplementHeavyStep`, `detectImplementHeavy`, `evaluateDogfoodGate` in
[`detect-pipeline-driving.ts`](../../scripts/dogfood-testing/detect-pipeline-driving.ts).

## Mutating `--fix` mode contract

Task 0293 extended the refuse gate to a **second, independent** mutation source: a testee carrying
a mutating `--fix` mode — `--fix all` or `--fix blockers-first`. Boundary-guarded via
`hasMutatingFixMode` so it never matches `--fix none`, `--focus all`, `--prefix all`, or substrings
inside other flags. No pipeline token required: a verify/review leg with `--fix all` mutates the
tree on its own (0280 dogfood P2 — the `--fix all` pass was the sole mutation source for 11 dataset
files, a workflow edit, and 2 corpus writes).

| Token shape | Matches | Rejects |
|-------------|---------|---------|
| `--fix all` / `--fix=all` / `--fix all` (case-insensitive) | `/sp:dev-verify 0299 --fix all`, `--fix=All`, `--fix BLOCKERS-FIRST` | `--fix none`, `--focus all`, `--prefix all`, `--fix-all-gen` |

Refuse message (R2 honesty — `--max-retry 0` bounds **the driver only**; the testee still mutates):

```
⚠ mutating --fix mode detected (--fix all | --fix blockers-first); pass --max-retry 0
(observe-only for the driver; the testee still mutates the tree) or --max-retry N (fix mode,
driver + testee both mutate)
```

This is **not** a new token in `PIPELINE_TOKENS` (R5/R6 — back-compat): pipeline-driving and
mutating-fix are checked by separate matchers, and pipeline-driving's refuse message wins when both
co-occur (its message is the superset — chain + tree mutation).

## Workspace-drift guard (R2 — task 0296)

A fix-mode dogfood (`--max-retry ≥ 1`) or a mutating-`--fix` testee writes to the **shared working
tree**. A concurrent external writer — formatter, another agent, the operator's editor — is then
indistinguishable from testee/driver mutation in the ledger and report. The guard detects drift,
attributes it to the external writer, and never claims drifted files as run work.

**Additive only** — protocol stays `sp:dogfood-testing@1.2`; the new ledger/report fields are
optional so existing reports remain valid. No gate refuses a run on drift; drift degrades the
evidence (a warning + finding), never voids it.

### Fingerprint (Phase 1)

Before the first testee step, record a **workspace fingerprint** in the live ledger frontmatter:

```yaml
workspace_fingerprint:
  head: <`git rev-parse HEAD`>
  porcelain_hash: <stable hash of `git status --porcelain` output>
  taken_at: <ISO-8601>
```

The hash is over the raw `git status --porcelain` bytes (e.g. `shasum -a 256`). Store the snapshot
string is NOT required — the hash is enough to detect a change; the live file already records what
the run itself touched via ledger rows.

### Drift check (before each fix application + once at Phase 4 finalize)

Re-take the snapshot and diff it against the baseline **minus files the run itself has touched**
(driver fixes + testee-attributed writes from the ledger `Fix Applied` column). Drift check points:

1. Immediately before each Phase 2 fix application (so a fix isn't credited to drift, and drift
   isn't credited to a fix).
2. Once at Phase 4 finalize (so the final report acknowledges any drift that happened mid-run).

**Not** after every testee step — observe-only runs (`--max-retry 0`) stay zero-overhead. A run with
no fix applications and a clean tree at finalize needs no drift row.

### What drift is — and is not

**Drift** = a tracked file changes that neither the driver nor the testee ledger row names.
**Explained** set = files named in ledger `Fix Applied` cells (driver fixes) plus files the testee
wrote that the driver recorded in the ledger (testee-attributed writes). Anything else in
`git status --porcelain` that is new or modified since baseline is drift.

### On detecting drift

- Append a **warning ledger row** tagged `drift:external` in the Step column: paths in `Fix Applied`,
  `Outcome: drift`, `Basis: <fingerprint diff>`. Do NOT mark the step PASSED/FIXED on account of
  drift; the row records the drift, it does not change a step's outcome.
- Emit a **mandatory report finding** under §6 Findings — `P2 — workspace drift detected during
  run; attribution to external writer` — naming the drifted paths and the snapshot delta. The report
  explicitly states the run's evidence is degraded, not voided.
- The driver **never** claims drifted files as its own or the testee's work. A fix ledger row's
  `Fix Applied` cites only the file:line the driver changed; drift rows cite the drifted paths
  separately.

### Worktree advisory (mutating dogfoods)

For fix-mode dogfoods of **pipeline-driving** or **mutating-`--fix`** testees (the two refuse-gate
cases above), the §Mutating `--fix` mode contract recommends running the dogfood in an **isolated
`git worktree`** so concurrent external writers cannot collide with the run. This is **advisory,
not a hard gate** — the refuse-gate semantics from task 0293 are unchanged. A worktree removes the
drift case entirely (no concurrent writer can reach the isolated checkout), which is why it is the
preferred setup for mutating dogfoods where the operator cares about clean attribution.

## Step-splitting recipe (implement-heavy pipeline dogfoods)

When the Phase 1.2b advisory fires (or you know the testee is implement-heavy), **prefer two or
more non-recursive dogfood runs** over one nested fix-mode chain. Worked recipe:

**Bad (recursive fix-mode):** dogfood the whole refine→run→verify chain under `--max-retry N` —
the driver mutates while the testee pipeline also mutates; attribution fails.

```bash
# Avoid unless you fully accept dual mutation:
/sp:dev-dogfood "/sp:dev-refine 0278 --auto --next" --max-retry 3 --full
```

**Good (step-split):**

```bash
# 1) Observe refine only (no tree mutation from the driver)
/sp:dev-dogfood "/sp:dev-refine 0278 --auto" --max-retry 0 --full

# 2) After refine is clean, dogfood implement/run alone
/sp:dev-dogfood "/sp:dev-run 0278 --auto --mode implement" --max-retry 2 --full

# 3) Dogfood verify as its own run (corpus gates only)
/sp:dev-dogfood "/sp:dev-verify 0278 --auto --next --force --focus all --fix all" --max-retry 2 --full
```

Rules: one mutation source per dogfood run; use `--max-retry 0` for unfamiliar pipeline legs; keep
dual artifacts / finalize for each run. Linked from the implement-heavy advisory
(`⚠ implement-heavy pipeline dogfood: prefer --max-retry 0 (observe-only) or step-split…`).

## Cost segmentation for implement-heavy steps

A dogfood run where a derived step is implement-heavy (the step itself writes code, runs a pipeline
leg, or otherwise mutates more than its own arguments) has **two cost sources** that MUST be
segregated in the Cost block and the ledger:

| Source | What it is | How to label in the ledger |
|--------|------------|----------------------------|
| Driver cost | Tokens the dogfood driver spent planning, monitoring, fixing, reporting | normal per-step `Fresh` / `Cached` columns |
| Chained-step cost | Tokens the testee's own pipeline leg spent (subagent invocations, file reads/writes inside `/sp:dev-run`, etc.) | a separate ledger row tagged `chained:<step>`; Fresh/Cached estimated from observed subagent output, or `~unknown` when not observable |

Rules:

1. Never fold chained-step cost into the driver's row. The whole point of dogfooding a
   pipeline-driving testee is to see what the *testee* costs to run, separately from what the driver
   costs to monitor it.
2. When the chained step ran in a subagent or session whose usage data the driver cannot read, label
   the chained row `~unknown` and emit a **P3** finding: "chained-step cost not observable — candidate
   for surfacing subagent usage in the driver context." Do not invent a number.
3. The chained row still counts toward the aggregate cache% — but mark it pessimistically
   (`Cached = ~0`) when the basis is missing, per the anti-fiction rule in
   [monitor-ledger.md](references/monitor-ledger.md).

## `--next` chain stop-at-testing

When a dogfood testee ends in `--next` (refine→run, run→verify, idea→plan→run), the chain runs
multiple lifecycle legs back-to-back. Each leg has its own testing boundary — the point past which the
dogfood driver cannot attribute an outcome to a specific leg's contract.

**Stop-at-testing rule.** If the driver cannot observe a chained leg's intermediate artifact (task
file section update, verify verdict, review table, pipeline transition), the driver STOPS at that
leg's testing boundary and reports:

```
chained-leg <name>: provenance missing — intermediate artifact not observable from driver context
```

Do NOT:

- Fabricate a PASS/FAIL for the chained leg from the repo's final state. The final state reflects
  every leg's effect combined; attributing it to one leg is fiction.
- Change the chained lifecycle's code (`dev-run`, `dev-verify`, `dev-refine`) to emit artifacts the
  dogfood driver can read. The chain's contract is owned by `sp:spur-dev`; this skill reports on it,
  it does not alter it. Surface the gap as a finding instead.
- Silently skip the chained leg in the ledger. Record the row with outcome `provenance-missing` and a
  P3 finding.

**`--chain-follow` (sanctioned override).** The operator passes `--chain-follow` to grant the
  driver permission to read the chained leg's named artifacts (`.spur/run/<wbs>-verdict.json`,
  task-file section diffs, review tables) after the leg completes and attribute normally. The flag
  licenses **reading** chained-leg evidence that already exists — it does NOT license the driver to
  execute the chained leg itself. The legacy "operator may direct" prose direction is still honored
  for back-compat; `--chain-follow` is the explicit, machine-recognizable form. Omitting the flag
  keeps stop-at-testing as the **default**. The flag is a driver attribute only — it does not change
  `detect-pipeline-driving` gate semantics (it is not a testee mutation source). See
  [§Arguments](#arguments).

## Additional Resources

- [references/report-template.md](references/report-template.md) — the report section contract +
  mandatory summary footer + task-sink L3 rule.
- [references/monitor-ledger.md](references/monitor-ledger.md) — the live-ledger column contract,
  token/cache estimation heuristic, and the cache-health finding rule.

## Platform Notes

### Claude Code

Native — `Skill()` delegation, argument substitution, and the `Edit`/`Write`/`Bash` toolset work
directly. The `/sp:dev-dogfood` command is the entry point.

**Platform boundary (R3 — task 0296).** On Claude Code, `Skill()` runs **inline** in the current
session — there is no subprocess boundary, so a chained `--next` leg (refine→run, run→verify)
dispatched from the driver runs in the **same session** and is not independently observable. A
`--next` dogfood forced to follow the chain would lose per-leg provenance. Therefore a `--next`
dogfood on Claude Code ends **stop-at-testing** at the chain's testing boundary unless the operator
overrides — either by passing `--chain-follow` (the sanctioned mechanism; see
[§Arguments](#arguments) and [§`--next` chain stop-at-testing](#next-chain-stop-at-testing)) or by
**running the chained leg as its own standalone invocation**, which is exactly how the 0281 pair
completed: the dev-run dogfood stopped at testing, and `/sp:dev-verify 0281 --auto --next --force
--focus all --fix all` was driven as its own dogfood (the verify dogfood report). This is a
reporting discipline, not a bug in the chain — the chain's contract is owned by `sp:spur-dev`.

### Codex / OpenClaw / OpenCode / Antigravity

Run the four-phase protocol via the Bash/CLI toolset; invoke this skill directly for the protocol
logic and the `spur` CLI for the `--task` sink. Parse `--json` where the testee supports it.

A session on these platforms never sees `Skill()` reference-file expansion, so the report contract
is restated here **verbatim** rather than by pointer — do not fall back to a looser ad hoc report
shape just because `report-template.md` wasn't auto-loaded.

**Always-on dual artifacts (not gated on `--save`).** Every run MUST open and maintain:

- Live: `.spur/run/dogfood/<run_id>.md`
- Report: `docs/dogfood/YYYY-MM-DD-<testee-slug>-dogfood.md`

Both start with YAML frontmatter including `status: running | aborted | complete`, `run_id`,
`protocol: sp:dogfood-testing@1.2`, and paths. Dual-write a ledger row to both files on every step
resolve. On stop, set `status` to `complete` or `aborted` (finalize-or-abort — non-skippable).

**The six mandatory section headings** (in order, each report MUST contain all six):

1. `### 1. Testee` (include **Repro:** line)
2. `### 2. Execution Summary` (include `#### Cost` with Method, confidence, Meter)
3. `### 3. Monitor Ledger`
4. `### 4. What We Did`
5. `### 5. Issues`
6. `### 6. Findings`

Unfinished narrative sections after abort: `⚠ incomplete — not reached` (never invent).

**The ledger requirement.** `### 3. Monitor Ledger` MUST contain the live per-step ledger table
populated on disk during Phase 2/3 as steps run, never reconstructed from memory at the end.

**Cost honesty.** Ledger totals are `~estimate` with Method + confidence LOW unless a real meter
(`ccusage` day/session, agent usage fields) is also present (then MEDIUM). If no meter:
`Meter: n/a`. Never invent billed precision.

**The footer requirement.** Every report MUST end by printing this exact block (verdict is strictly
`PASS` / `PARTIAL` / `FAIL`, grading the testee, not the surrounding task):

```
── Dogfood Summary ──
Result: PASS   (N fixed, N unresolved, N findings)
Tokens: ~N total  |  ~N cached (~X% hit rate)  [~estimate]

Fixed issues:
  • <label>   (or: (none))

Unresolved issues:
  • <label>   (or: (none))

Findings (P1+P2):
  • P? — <label>   (or: (none))

[Live: .spur/run/dogfood/<run_id>.md]
[Report: docs/dogfood/YYYY-MM-DD-<slug>-dogfood.md]
[Task: <wbs>]      ← only with --task
```

A report missing any of the six headings, the on-disk live ledger, dual paths, terminal `status`,
the Cost block, or this footer does not satisfy the dogfood contract on this platform, regardless
of `Skill()` availability.

## Engine-driven testees under a sandboxed session

A subprocess executor dies at startup, not at model time, when `.claude/settings.json` denies
it its state directory (`~/.pi`, `~/.grok`, `~/.gemini`, `~/.codex`, `~/.cache`) or local
socket binding. Signals: `EPERM: operation not permitted`, `FS_PERMISSION_DENIED`,
`bind: operation not permitted`. Two affordances must be granted and the session restarted:
`sandbox.filesystem.allowWrite` covering the executor home dirs, and
`sandbox.network.allowLocalBinding`. Caveat: `spur agent doctor` reports `usable: true` from
configuration alone — it never probes a real dispatch, so `usable` means *configured*, not
*proven runnable under this sandbox*.

Related operator-local trap (spur task 0689): adding a `permissions.allow` `write_file(**)` entry
to an executor's own settings (e.g. `~/.gemini/antigravity-cli/settings.json`) is an **operator-
local unblock, not the shipped fix**. It is per-machine and untracked, and it **masks shim
regressions in local end-to-end runs**: a broken headless dispatch looks green on the patched
machine while failing on every other machine and in CI. The fix belongs in the executor shim
(print-mode permission affordance); keep the allow entry, if at all, as a documented convenience
and never as the reason a run passes.
