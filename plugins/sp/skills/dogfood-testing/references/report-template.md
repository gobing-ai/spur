---
name: report-template
description: "The dogfood report section contract + dual-path always-on delivery + mandatory summary footer + the --task sink L3 rule. The report is assembled from the on-disk live ledger and is designed to be actionable — a reader should be able to fine-tune the testee from the report alone."
see_also:
  - dogfood-testing
  - monitor-ledger
protocol: sp:dogfood-testing@1.2
---

# Dogfood Report Template

The report is the deliverable. It is assembled from the **on-disk** live ledger (never reconstructed
from memory) and is designed so a reader can **fine-tune the testee from the report alone** — every
finding carries a location and a recommended action, not just an observation.

**Protocol version:** `sp:dogfood-testing@1.2` — dual-path always-on delivery, status model, Cost
block with multi-source honesty. Bump this field when the contract changes. **@1.2 changes:**
finalize hard structure (unique §1–§6 headings; Issues requires `#### Fixed` + `#### Unresolved`);
mandatory summary footer mirrored at the report end (footer missing ⇒ `status: complete` refused);
ledger cardinality (data rows == declared executed steps); protocol string normalized to the
colon form — the dash form `sp-dogfood-testing@…` is rejected in new runs.

## Always-on dual artifacts (delivery contract)

Every dogfood run **always** writes **two** files — with or without `--save`:

| Artifact | Path | Role |
| ---------- | ------ | ------ |
| **Live** | `.spur/run/dogfood/<run_id>.md` | Mid-run SSOT; opened in Phase 1; ledger rows appended on every step resolve |
| **Report** | `docs/dogfood/YYYY-MM-DD-<testee-slug>-dogfood.md` | Operator artifact; same content promoted on open + every step + finalize |

`--save` is **back-compat no-op** for delivery: it still documents/prints the report path but is
**not required** to create the file. A run that ends with no file under `docs/dogfood/` (and no live
file under `.spur/run/dogfood/`) has failed the dogfood delivery contract.

### Frontmatter (canonical — every artifact MUST open with this)

```yaml
---
run_id: <uuid-or-timestamp-slug>
status: running | aborted | complete
testee: "<exact invocation string>"
classification: slash-command | agent-skill | cli
mode: observe-only | fix
max_retry: <n>
testee_agent: omitted | <name>
started_at: <ISO-8601>
finished_at: <ISO-8601 or null while running>
live_path: .spur/run/dogfood/<run_id>.md
report_path: docs/dogfood/YYYY-MM-DD-<slug>-dogfood.md
protocol: sp:dogfood-testing@1.2
workspace_fingerprint:    ← optional — recorded in Phase 1 for fix-mode and mutating-`--fix` dogfoods
  head: <`git rev-parse HEAD`>
  porcelain_hash: <sha256 of `git status --porcelain`>
  taken_at: <ISO-8601>
---
```

### Status model (partial-OK)

| `status` | When |
| ---------- | ------ |
| `running` | Phase 1 opened; steps still in progress |
| `aborted` | Finalize-or-abort after mid-run stop / incomplete narrative |
| `complete` | Phase 4 finished a normal end-of-run report |

A mid-run death that left only a live file with `status: running` and ledger rows is still valid
partial evidence. On any intentional stop, the driver MUST run finalize-or-abort and set
`complete` or `aborted` — never leave a deliberate stop at `running`.

Unfinished narrative sections (What We Did / Issues / Findings) use:

```
⚠ incomplete — not reached
```

Never invent narrative for steps that did not run.

## Section contract

Emit these sections in order. Headings are fixed (machine-parseable); never rename or drop one.
Skeleton is written in Phase 1; filled as the run progresses; finalized in Phase 4.

### 1. Testee

```
## Dogfood Report — `<testee invocation>`

### 1. Testee

- **Command:** `<slash command or CLI invocation>`
- **Classification:** `slash command` | `agent skill` | `CLI invocation`
- **Exact invocation:** the underlying `Skill()` call or shell command
- **Repro:** `<exact string an operator can re-run>`
- **Testee agent:** `<value forwarded via --agent>` | `omitted (testee runs in current session)`
- **Mode:** `observe-only (--max-retry 0)` | `fix (--max-retry N)`
- **Task under test:** WBS + title (if applicable)
- **Run id:** `<run_id>` · **Live:** `<live_path>` · **Report:** `<report_path>`
```

When `status` is `aborted` or the report is partial, add under §1:

```
- **Delivery status:** aborted | partial  ⚠ incomplete run
```

### 2. Execution Summary

```
### 2. Execution Summary

- **Result:** PASS / PARTIAL / FAIL  `(N fixed, N unresolved, N findings)`
- **Wall-clock:** ~N min  `[~estimate]`
- **Steps:** N derived, N executed, N N/A
- **Fix attempts:** N (one brief label per fix)

#### Cost
- **Ledger estimate:** ~N total | ~N cached (~X% hit rate)  `[~estimate]`
- **Method:** chars/4 heuristic (monitor-ledger.md); confidence: LOW
- **Meter:** n/a
```

**Cost honesty rules:**

- Always include ledger-derived `~estimate` total / cached / cache% with a **Method** line and
  **confidence** (`LOW` when estimate-only; `MEDIUM` when a real meter is also present).
- Optional meters when available (never invent):
  - `ccusage` session/daily delta — label scope (`day` / `session`), **not** per-step
  - agent usage fields if present in tool results
- If no meter: print `Meter: n/a` explicitly.
- Never present an unsubstantiated precise integer as billed/metered cost.
- Aggregate cache% MUST equal the ledger formula (see §3); otherwise the report is invalid.
- **Chained-step segmentation (@1.2):** when a derived step is implement-heavy (the step runs a
  pipeline leg, writes code, or mutates more than its own arguments), its cost MUST be a separate
  ledger row tagged `chained:<step>` and kept out of the driver's row. If the chained leg ran in a
  subagent/session whose usage the driver cannot read, label the row `~unknown` and emit a P3 finding.
  See [SKILL.md §Cost segmentation for implement-heavy steps](../SKILL.md#cost-segmentation-for-implement-heavy-steps).

**Verdict rule** — `PASS` = every step ran and no unresolved issue; `PARTIAL` = ran to the end but
≥1 unresolved issue; `FAIL` = the run could not complete (a step blocked all downstream steps). A
finding alone never lowers the verdict — findings are improvements, not failures.

**The verdict grades the TESTEE, not the surrounding task.** If the testee is a
pipeline/command and it failed, the verdict is `FAIL` (or `PARTIAL` per the rule above) even
when the task was completed by other means; record the recovery under Issues/What-We-Did,
never in the verdict value. Only `PASS` / `PARTIAL` / `FAIL` are legal values.

### 3. Monitor Ledger

The report MUST include the live ledger table before the narrative. Do not summarize the ledger away:
it is the audit trail for step outcomes, fix attempts, findings, and cache math. Rows are written to
**disk** (both artifacts) when each step resolves — see [monitor-ledger.md](monitor-ledger.md).

```
### 3. Monitor Ledger

| Step | Attempts | Outcome | Fix Applied | Finding | Fresh Tokens | Cached Tokens | Cache % | Basis | Wall-clock |
|------|----------|---------|-------------|---------|--------------|---------------|---------|-------|------------|
| resolve | 1 | PASS | — | — | ~800 | ~300 | 27% | 1 command + reused task summary | ~3s |

**Cache calculation:** aggregate cache% = round((sum(Cached Tokens) / sum(Fresh Tokens + Cached Tokens)) * 100).
```

Ledger rules:

- Every executed step gets exactly one row, recorded when the step resolves (**on disk**, both files).
- `Fresh Tokens` and `Cached Tokens` must be numbers with `~` prefixes; `Cache %` must be computed
  from those two cells, not guessed.
- `Basis` is mandatory. It names the observable inputs used for the estimate: command output,
  previously-read file reused from context, generated report text, or similar.
- The aggregate cache line in `#### Cost` under §2 must equal the ledger formula above. If it
  does not, the report is invalid.
- **Cardinality (@1.2):** the number of ledger data rows MUST equal the `**Steps:** N derived, N executed`
  declared in §2. Steps marked N/A are documented explicitly as their own rows (`Outcome: N/A`);
  an unaccounted step or an extra row refuses `status: complete` at finalize.
- If the driver cannot make a defensible estimate for a row, write `~0` cached and explain the
  missing basis in `Basis`; do not invent a stable percentage.

### 4. What We Did

Narrative, one numbered entry per logical action (a step, a fix, a gate check). Include `path:line`
references. Someone should understand the run without reading the ledger.

```
### 4. What We Did

1. **Action label** — what happened, what was observed, the decision made.
2. **Action label** — …
```

If the run aborted before narrative was written: `⚠ incomplete — not reached`.

### 5. Issues

Always include both sub-headings, with `(none)` when empty — consistent structure matters for parsing.

```
### 5. Issues

#### Fixed

1. **Issue title** — description.
   - Root cause: why it happened.
   - Fix: `file:line` + one-line summary of the change.

#### Unresolved

- (none)  |  each with diagnosis + everything tried.
```

### 6. Findings

Findings are the **fine-tuning payload**. Each carries a severity, a `file:line`, and a concrete
**recommended action** — what to change, not just what's wrong. Default lists P1+P2; `--full` adds
P3+P4.

```
### 6. Findings

- **P1** — <what's wrong>. → **Action:** <concrete change>.  (`file:line`, ~effort)  `[feasible]`
- **P2** — …
```

Each finding MUST carry a **verification-feasibility tag** in brackets at the end of the line, so
downstream task creation does not inherit an unactionable acceptance criterion:

- `[feasible]` — the recommendation is verifiable (a test, a CLI check, an observable behavior).
  This is the default; most findings are feasible.
- `[stale]` — on re-check the finding no longer holds (the code already does the right thing, the
  condition was misread). Do **not** file as a task — close inline with evidence. Catching this at
  report time saves a no-op implementation task downstream.
- `[unverifiable]` — the recommendation cannot be confirmed with existing tooling (e.g. a
  cache-hit finding with no per-step telemetry; a perf claim with no measurement loop). If filed as
  a task, its acceptance criterion must be reframed to what *can* be verified (e.g. "ship the
  lever; measured proof deferred"), or the task should be deferred until the missing tooling exists.
  Do not let it become a normal implementation task — it will ship an unverifiable "improvement."

The tag is a prompt to whoever turns findings into tasks: `[stale]` → drop, `[unverifiable]` →
reframe or defer, `[feasible]` → proceed. A finding without a tag is treated as `[feasible]`.
Severity scale:

- **P1** — blocks correct use or causes drift/wrong output; fix before shipping the testee.
- **P2** — real friction or a latent correctness gap; fix soon. **Includes mandatory workspace-drift
  finding:** when a drift row (`drift:external`) is present in the ledger, a P2 finding naming the
  drifted paths is mandatory in the report (not optional). The finding states the run's evidence is
  degraded, not voided. See [SKILL.md §Workspace-drift guard](../SKILL.md#workspace-drift-guard-r2--task-0296).
- **P3** — efficiency / DX / observation (includes the cache-health rule below).
- **P4** — nice-to-have, cosmetic, or speculative.

**Cache-health rule** (from [monitor-ledger.md](monitor-ledger.md)): if aggregate cache% < 50% or any
step < 40%, emit a **P3** — "Low cache hit rate — candidate for context-window or prompt trimming"
with the offending step(s). Absolute token totals from the heuristic are trend-only (`[unverifiable]`
as billable cost proof is expected).

**Migration grep rule.** When dogfooding migrations or retired surfaces, distinguish intentional
legacy-term mentions in guidance from live routed surfaces. Pair any broad grep for old skill or
command names with a live-surface grep over the command and agent roots before filing a stale-routing
finding. A deliberate rejection note in a reference file is not a live surface.

## Phase 4 — finalize-or-abort (non-skippable terminal gate)

Before the skill may stop (success, partial, fail, observe-only end, or abort), the driver MUST:

1. Set frontmatter `status: complete` or `status: aborted` (and `finished_at`).
2. **Structure scrub (@1.2):** all six mandatory section headings exist **exactly once each**
   (`### 1.` … `### 6.` — a duplicated heading refuses `complete`); §5 Issues carries both
   `#### Fixed` and `#### Unresolved` (`(none)` when empty); unfinished narrative uses
   `⚠ incomplete — not reached`; no leftover "run in progress" markers survive finalization.
3. **Ledger cardinality (@1.2):** Monitor Ledger data rows == the `**Steps:** N derived, N executed` declared in
   §2 (N/A steps documented explicitly as rows; drift rows count separately, not toward executed
   steps — include `drift:external` rows in the table but subtract them from the executed count in
   §2). A mismatch refuses `complete`.
4. Write the Cost block (method + confidence + Meter).
5. **R2 drift check at finalize.** If a workspace fingerprint was recorded, re-take snapshot
   and diff against baseline minus run-touched files. Detected drift → append `drift:external`
   ledger row + mandatory P2 finding. See [SKILL.md §Workspace-drift guard](../SKILL.md#workspace-drift-guard-r2--task-0296).
6. Sync final content to **both** live and report paths.
7. **Footer mandatory (@1.2):** print the mandatory summary footer with **both** paths always,
   and mirror the footer block at the **end of the report file**. A report whose body lacks the
   footer cannot set `status: complete`.
8. **Self-validate (task 0278 R6):** run
   `node "$(superskill script path sp dogfood-testing/validate-report.mjs)" --file <report-path>` before
   claiming `status: complete`. Exit 2 → `status: aborted` + list error codes under
   `#### Unresolved` (never force complete on a non-@1.2 shape).
9. **Refusal rule (@1.2):** when any check above fails, set `status: aborted` and list every
   failed check under §5 `#### Unresolved` — never force `complete`.

Any early-exit path still runs this checklist. Stopping without it is a **driver contract violation**.

## Mandatory Summary Footer

Print **after every run, inline, always** — it is the last thing the user sees.

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

Rules:

- **Result** and **Tokens** lines are mandatory; always tag token numbers `[~estimate]`.
- List Fixed / Unresolved / Findings; print `(none)` when empty — never omit a sub-list.
- With `--full`, Findings include P3+P4.
- If PASS with zero issues and zero findings: collapse to one line `Result: PASS — no issues, no
  findings.` (still print the Tokens line).
- **`[Live:]` and `[Report:]` are always printed** after a normal stop (not gated on `--save`).
- Print `--task` WBS only when that sink ran.

## Task sink — the `task check` L3 contract

`--task` files findings as a `review`-template task:

```bash
spur task create "<testee> dogfood findings" --template review --json
```

Write the **Unresolved issues** and **Findings** into the task's `#### Review Findings` table — one
row per item: `Severity` (`P1`–`P4`), `File`, `Finding`, `Recommendation`. That heading is a
sub-section of `### Background`, so:

```bash
spur task update <wbs> --section "Background" --from-file <path>   # body starts with "#### Review Findings"
```

**Where the P-rows live, and how the L3 Review rule behaves.** The review template ships two tables:
`#### Review Findings` (under `### Background`) is the *input* you populate from the dogfood findings;
`### Review` is the *post-fix reflection* table, shipped as an **empty-cell scaffold**
(`| P1 | | | |`). `spur task check`'s L3 Review rule keys off `### Review`, not `#### Review Findings`:

- Write the dogfood findings into **`#### Review Findings`** (that is the `--task` sink target).
- Leave **`### Review`** as the shipped empty-cell scaffold. The hardened L3 rule tolerates the empty
  scaffold **wherever `### Review` is optional** (review variant: `backlog`/`todo` — the freshly
  created state) and only requires a *populated* P-table once `### Review` becomes **required**
  (`wip`+). So a freshly created `review` task at `backlog`/`todo` passes `task check` with the
  scaffold untouched — no hand-written P-row is needed, and a bare prose note in `### Review` is the
  thing that errors (it is neither the scaffold nor a populated table).

Always verify with `spur task check <wbs> --json` before handoff; the sink path below writes only
`#### Review Findings` and leaves `### Review` as the scaffold.
