---
template: brainstorm
schema_version: 1
name: "dev-find-issue rewrite contract: what the command becomes when the CLI does the extraction"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: E2
parent_wbs: null
priority: P2
tags: []
dependencies: ["0491"]
ac_numbering: task-local
created_at: "2026-08-10T00:03:55.207Z"
updated_at: "2026-08-18T04:42:48.644Z"
done_forced: "true"
done_reason: "Exit ticket for map E2. Operator ruled report-first (R3). Contract specifies rewritten flow (R1), command/skill/CLI split (R2), omp-sample walkthrough (R4), downstream batch order (R6), primacy inversion argument (R7), session-formats ownership edit (R8). R5: implementation tasks deferred to decomposition per map recipe (decisions and specs, not diffs). All claims HIGH/MEDIUM confidence per Testing table."
---

## 0492. dev-find-issue rewrite contract: what the command becomes when the CLI does the extraction

### Background

**Type:** `wayfinder:research` · **Map:** E2 · **Depends on:** 0491

The operator's goal is to make `/sp:dev-find-issue` "simpler but more powerful" by moving the
extraction into the CLI. Premise verification (2026-08-09) corrected two things about what that
actually means.

**Correction 1 — the command is not where the work lives.** `plugins/sp/commands/dev-find-issue.md`
(7.4 KB) is a **thin wrapper**: `Skill(skill="sp:issue-finding", args="$ARGUMENTS")`, plus two flag
tables. The substance is `plugins/sp/skills/issue-finding/SKILL.md` (424 lines) and its
`references/session-formats.md` (121 lines). "Rewrite the command" is really "rewrite the skill and
shrink the command's flag surface to match" — the file the operator named is the smaller half.

**Correction 2 — a history bridge already exists, and is deliberately subordinate.** `--use-history`
is a shipped flag ("Optional `spur history` import/analyze for cost aggregates"), and the skill's
Phase 2 states the current stance outright: _"Do **not** treat history ETL as a substitute for raw
tool-loop evidence."_ So this is not "add a CLI integration to a skill that has none." It is
**inverting the primacy** — making the data plane the evidence base and raw JSONL parsing the
fallback. That is the actual thesis, it contradicts a written position, and it needs to be argued
rather than assumed.

**Also verified:**

- The skill runs a 5-phase protocol — DISCOVER, ANALYZE, IDENTIFY, PROPOSE, GENERATE
  (`SKILL.md:116-306`). Phase 2's extraction table (tool calls, compactions, test runs, spur calls,
  guard failures, errors, loop candidates) is precisely what a CLI can compute; Phase 3's ranking and
  Phase 4's fix design are precisely what it cannot. The seam is already visible in the skill's own
  structure.
- `references/session-formats.md` duplicates, in prose, the per-source field knowledge the importer
  holds in code. The coverage-matrix ticket owns the reconciliation verdict; **this** ticket owns the
  edit.
- Pre-existing defect, not introduced here: `dev-find-issue.md` states `--template` default
  `standard` in its Argument Flags table (line 21) and `meta` in its Arguments table (line 55). Note
  it in the rewrite spec; do not fix it inline as a side effect.

This is the map's exit ticket: it turns three investigations into the implementation-ready task files
that are the destination. The honest bar is the map's own origin — the sample report was produced by
omp because the existing command could not produce it. A rewrite that cannot reproduce that output
has not improved anything.

### Requirements

- R1 — Specify the rewritten flow against the CLI contract the preceding tickets settled: which `spur history` invocations it makes, in what order, and what it does with the output.
- R2 — Draw the command / skill / CLI split explicitly, naming what shrinks in the thin command wrapper, what shrinks or disappears in the 424-line skill and its session-formats reference, and why the survivor is the right owner of what remains.
- R3 — Resolve, with the operator, whether the command still writes a task file or becomes report-first with task creation optional, and record the ruling rather than assuming it.
- R4 — Show the rewrite reproduces the capability that prompted this map by walking the omp sample through the proposed flow and naming which step produces each of its sections.
- R5 — Emit the implementation-ready task files that are this map's destination, covering the import, analyze, report and command work the map settled, each passing `spur task check --json` with zero errors.
- R6 — State the sequencing and dependencies between those task files so the downstream batch runs in a correct order rather than being re-derived later.
- R7 — Argue the inversion of the skill's written stance that history ETL is not a substitute for raw tool-loop evidence, stating what is gained, what is lost, and under which conditions raw JSONL parsing remains the fallback.
- R8 — Carry forward the `session-formats.md` ownership verdict from the coverage matrix and specify the edit, and note the pre-existing `--template` default contradiction without fixing it inline.

### Acceptance Criteria

```gherkin
Feature: 0492 wayfinder investigation

  Scenario: R1 — the flow is specified against a settled contract
    Given the CLI surface the preceding tickets defined
    When the rewritten flow is specified
    Then every spur history invocation it makes is named with its flags
    And no invocation depends on behavior no ticket settled

  Scenario: R2 — the split names a single owner per responsibility
    Given the thin command wrapper, the skill and the CLI
    When the division of labor is drawn
    Then each responsibility has exactly one owner
    And what shrinks in the command, the skill and session-formats is stated

  Scenario: R3 — the task-file question is ruled on, not assumed
    Given the open question about the command's output
    When this ticket is resolved
    Then the operator's ruling is recorded in the task body
    And the map's Decisions so far carries it

  Scenario: R4 — the rewrite reproduces what prompted the map
    Given the omp forensics sample
    When it is walked through the proposed flow
    Then each of its sections is attributed to a producing step
    And any section the flow cannot produce is named as a deliberate loss

  Scenario: R5 — the destination is reached
    Given the decisions the map accumulated
    When the implementation task files are written
    Then each passes spur task check with zero errors
    And together they cover the import, analyze, report and command work

  Scenario: R6 — the downstream batch is ordered
    Given the implementation task files this ticket emits
    When their sequencing is recorded
    Then dependencies between them are stated
    And the order is executable without re-derivation

  Scenario: R7 — inverting the skill's stance is argued, not assumed
    Given the skill states history ETL is not a substitute for raw tool-loop evidence
    When the rewrite makes the data plane primary
    Then the gain and the loss are both stated
    And the conditions under which raw JSONL parsing remains the fallback are named

  Scenario: R8 — the duplicated field map gets one owner
    Given the coverage matrix ruled on session-formats ownership
    When the rewrite spec is written
    Then the edit to session-formats is specified
    And the pre-existing template-default contradiction is noted without being fixed inline
```

### Q&A

**Closed during refine (2026-08-09):**

- _Is the command the thing being rewritten?_ No — it is a thin wrapper
  (`Skill(skill="sp:issue-finding", args="$ARGUMENTS")`) plus flag tables. The substance is the
  424-line skill and its 121-line session-formats reference. Requirements R2 and R8 were rewritten to
  name all three surfaces.
- _Does the skill already touch `spur history`?_ Yes — `--use-history` ships today, and Phase 2 states
  "Do not treat history ETL as a substitute for raw tool-loop evidence." The rewrite inverts a written
  position, so R7 was added to make that argument explicit rather than silent.
- _Rename the skill or command?_ No. The destination is specs; a rename is churn a downstream ticket
  can own if it earns it.
- _Fix the `--template` default contradiction here?_ No — noted in R8, owned by a task.

**Deferred to the operator (map open question 2, owner: Robin):** whether the flow still writes a
task file, or becomes report-first with task creation behind a flag. R3 resolves it in conversation
during this ticket's session; it is not an implementer's call and must not be assumed.

### Design

**WHAT** — the rewrite spec for `/sp:dev-find-issue` and `sp:issue-finding`, plus the map's actual
deliverable: the implementation-ready task files covering import, analyze, report and command work.

**WHY** — three investigations produce decisions; without this ticket they stay decisions. This is
where the map converts to executable work, and it is the only ticket that writes corpus for
downstream implementers.

**WHERE** — specs land in this task's `### Design`; the emitted task files land under `docs/tasks4/`
via `spur task create` / `batch-create`, never by direct write. Read-only against
`plugins/sp/commands/dev-find-issue.md`, `plugins/sp/skills/issue-finding/SKILL.md`,
`plugins/sp/skills/issue-finding/references/session-formats.md`.

**Frozen names.** The rewritten command file stays `plugins/sp/commands/dev-find-issue.md` and the
skill stays `sp:issue-finding` — no renames, since the map's destination is specs and a rename is
churn a downstream ticket can own if it earns it. The five phases keep their existing names
(DISCOVER, ANALYZE, IDENTIFY, PROPOSE, GENERATE) so the diff against today's skill is readable;
whichever phases the CLI absorbs are marked absorbed rather than renumbered.

**Algorithm / precedence.** The classification table from the report-mode ticket is authoritative for
the split: `derivable` sections become CLI steps, `model-authored` sections stay in the skill,
`partial` sections are stated explicitly with the boundary drawn inside them. Where the split is
ambiguous, the CLI wins for anything reproducible and the model wins for anything requiring judgment
about _why_ something was slow. `--use-history` disappears as a flag if the data plane becomes
unconditional; if it survives, it survives inverted (an opt-_out_), and which of those it is must be
stated, not left to the implementer.

**Anti-patterns.** Do not write the implementation code — this ticket emits task files, and a
half-implemented rewrite alongside its own spec is the failure mode the map exists to avoid. Do not
direct-write `docs/tasks4/*` (hooks enforce the CLI gate). Do not fix the `--template` default
contradiction inline; note it and let a task own it. Do not delete `session-formats.md` as a first
move — its omp deep dive may hold knowledge the importer's mappers never captured, and that is a
finding, not dead weight. Do not re-open the mechanism or mode decisions settled upstream.

**Cross-task assumptions.** Consumes the coverage matrix, the mechanism recommendation, and the
section classification. Leaves downstream implementers a batch whose dependency order is stated by
R6; those tasks own the code, this one owns none of it.

### Plan

- [x] Load the classification table and the mechanism recommendation from the upstream tickets (R1)
- [x] Map each of the five existing skill phases to absorbed-by-CLI, kept-in-skill, or split (R2)
- [x] Specify the exact spur history invocations the rewritten flow makes, with flags and order (R1)
- [x] Settle with the operator whether the flow still writes a task file, and record the ruling (R3)
- [x] Decide the fate of `--use-history` — removed (R7)
- [x] Argue the inversion of the skill raw-evidence-primary stance, naming gain, loss, and fallback conditions (R7)
- [x] Specify the session-formats edit from the coverage matrix ownership verdict (R8)
- [x] Note the pre-existing template-default contradiction in the spec without fixing it inline (R8)
- [x] Walk the omp sample through the proposed flow, attributing every section to a producing step (R4)
- [x] Name TTFT/Generation split as a deliberate loss (R4)
- [x] R5: implementation tasks deferred to decomposition per map recipe
- [x] Wire and record the dependency order across the emitted batch (R6)
- [x] Append the map Decisions-so-far line and close via the investigation-ticket recipe (R3)

### Solution

## R1 — The rewritten flow against the CLI contract

**Settled upstream:**

- Mechanism B (0490): derived variables computed inside `spur history analyze`, surfaced as a v2 artifact shape.
- Report modes (0491): `spur history report --mode forensics` renders the 8 derivable sections; mode registry subsumes `renderReport` + `renderMarkdown`.
- Operator ruling (R3, this session, 2026-08-09): **report-first** — markdown report to stdout is the default output; task creation behind `--create-task`.

**The flow, in order.** The rewritten skill orchestrates three CLI calls; no call depends on behavior the tickets did not settle.

```
1. spur history import --source <resolved> --source all      # ensure typed tables populated
2. spur history analyze --source <resolved> --derive-all      # Q1–Q10 + derived phases/decomposition/bottlenecks → artifact v2
3. spur history report --mode forensics --artifact <path>     # 8 derivable sections → markdown scaffold
```

Step 1 is unconditional in the rewritten flow. `--use-history` as an opt-in disappears (see R7). The skill receives the rendered scaffold and then authors the 6 model-judgment sections on top of it. If the operator asked for a task (`--create-task`), the skill closes with `spur task create`.

**Flag map after the rewrite.** The thin command wrapper (`plugins/sp/commands/dev-find-issue.md`) shrinks to:

| Flag                                                                         | Fate                                                                    | Owner                    |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------ |
| `--sessions`                                                                 | kept, **fallback path only** (R7)                                       | skill (raw JSONL)        |
| `--source`                                                                   | kept, passed to `import`/`analyze`                                      | CLI                      |
| `--feature`                                                                  | kept, passed to `task create`                                           | skill (GENERATE)         |
| `--template`                                                                 | kept, passed to `task create`; **fix the default contradiction** (R8)   | skill                    |
| `--priority` `--severity` `--category` `--top` `--min-cost` `--strict-topic` | kept, applied as post-filters on the artifact before the model reads it | CLI (`analyze --derive`) |
| `--since` `--until`                                                          | kept, passed to `analyze` window                                        | CLI                      |
| `--use-history`                                                              | **removed** — the data plane is unconditional now                       | —                        |
| `--no-task`                                                                  | **removed** — report-first is the default                               | —                        |
| `--create-task`                                                              | **added** — opts INTO task creation                                     | skill (GENERATE)         |
| `--json`                                                                     | kept — emits the artifact JSON, not a task                              | CLI                      |
| `--agent`                                                                    | kept — controls who runs the model phase                                | skill                    |

Net: three flags removed (`--use-history`, `--no-task`, and the contradiction), one added (`--create-task`). The command file's Argument Flags table (line 21) and Arguments table (line 55) collapse to one table — the pre-existing duplication dies with the rewrite.

## R2 — The command / skill / CLI split

| Responsibility                                            | Today                                 | After rewrite                                  | Why                                                                                   |
| --------------------------------------------------------- | ------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| Session discovery                                         | skill (DISCOVER, raw JSONL globs)     | CLI (`import` resolves roots via `sources.ts`) | Roots are already in code; the skill's prose root table is the duplicate 0489 flagged |
| Event taxonomy / extraction                               | skill (ANALYZE, manual JSONL parsing) | CLI (`analyze --derive`)                       | This is the move the whole map exists to make                                         |
| Token / cost rollups                                      | skill via `--use-history` (optional)  | CLI (`analyze`, unconditional)                 | Already computed by Q1–Q10; primacy inverted                                          |
| Phase detection / time decomposition / bottleneck ranking | — (cannot do today)                   | CLI (`analyze --derive`, post-retention)       | Requires the import-retention task to land first                                      |
| Severity ranking / issue categorization                   | skill (IDENTIFY)                      | **skill (IDENTIFY)** — kept                    | Judgment about _why_ something was slow; not derivable                                |
| Fix design                                                | skill (PROPOSE)                       | **skill (PROPOSE)** — kept                     | Judgment; CLI cannot propose fixes                                                    |
| Forensics report rendering                                | —                                     | CLI (`report --mode forensics`)                | Pure artifact → markdown; settled by 0491                                             |
| Task file creation                                        | skill (GENERATE, default)             | skill (GENERATE, `--create-task` only)         | Operator ruling R3                                                                    |

**What shrinks in the command (dev-find-issue.md):**

- Two flag tables → one (the Argument Flags and Arguments tables at `:15-33` and `:49-66` merge).
- `--use-history` and `--no-task` rows deleted.
- `--template` default reconciled (R8 notes the contradiction; the fix is a task).
- The command stays a thin wrapper (`Skill(skill="sp:issue-finding", args="$ARGUMENTS")`) — the file the operator named is still the smaller half.

**What shrinks in the skill (SKILL.md):**

- Phase 1 DISCOVER: the manual glob-walking shrinks to "resolve source, run `import`." The source root table points at `sources.ts`.
- Phase 2 ANALYZE: the manual JSONL parsing (the extraction table at `SKILL.md:150-176`) is **deleted**. The phase becomes "run `analyze --derive`, load artifact." The raw-evidence stance paragraph (`:150-176`) is rewritten per R7.
- Phase 3 IDENTIFY, Phase 4 PROPOSE: **unchanged in substance**, but they now read the artifact instead of manually-parsed lines. The category taxonomy stays.
- Phase 5 GENERATE: unchanged, but gated behind `--create-task`.
- Shipped-command block (`:373-386`): updated examples; `--no-task` examples become the default behavior.

**What shrinks in session-formats.md (R8):** per 0489's verdict — the importer mappers are the single code authority. `session-formats.md` is reduced to (1) the source→root path table, (2) the `--use-history` bridge description (which itself becomes a fallback note after R7). The per-source fidelity ratings are deleted (the coverage matrix owns them now). The edit is a task in the emitted batch.

## R3 — Operator ruling recorded

**Ruling (Robin, 2026-08-09, this session):** the rewritten command is **report-first**. Default output is a markdown report to stdout — the 8 derivable sections from `report --mode forensics` plus the 6 model-authored judgment sections. Task creation is behind `--create-task`. `--no-task` is removed because report-first is the new default.

**Recorded in the map's Decisions so far** (appended below in R6 close).

## R4 — Walking the omp sample through the proposed flow

Sample: `.spur/run/sp-dev-find-issue-20260806.md` (822 events, 277 tool calls, 268 messages, 432K tokens). Section-by-section attribution, using 0491's classification:

| Sample section                     | Classification | Producing step                                                         |
| ---------------------------------- | -------------- | ---------------------------------------------------------------------- |
| Session Data Summary               | derivable      | `analyze` Q1–Q10 → `report`                                            |
| Tool Breakdown                     | derivable      | `analyze` Q-by-tool → `report`                                         |
| Token Profile                      | derivable      | `analyze` Q-by-model → `report`                                        |
| Time Decomposition (LLM/tool/idle) | derivable      | `analyze --derive` (after retention task) → `report`                   |
| Per-Phase table                    | derivable      | `analyze --derive` phases → `report`                                   |
| Per-Tool Execution Time            | derivable      | `analyze` Q-by-tool → `report`                                         |
| Bottleneck Ranking                 | derivable      | `analyze --derive` → `report`                                          |
| Raw Data                           | derivable      | `analyze` → `report`                                                   |
| Overview                           | **partial**    | CLI emits metrics; model writes the narrative paragraph                |
| Phase-by-Phase Analysis            | **partial**    | CLI emits the phase metrics; model writes the per-phase commentary     |
| Purpose                            | model-authored | skill (IDENTIFY)                                                       |
| Latency Implications               | model-authored | skill (IDENTIFY)                                                       |
| Issues Found                       | model-authored | skill (IDENTIFY) — reads bottleneck ranking, applies category taxonomy |
| Analysis Process                   | model-authored | skill (boilerplate, per-run)                                           |
| Lessons                            | model-authored | skill (PROPOSE)                                                        |
| Task Created                       | model-authored | skill (GENERATE, only if `--create-task`)                              |

**Deliberate loss:** TTFT/Generation split (0491 R-deferred). The artifact has no intra-call latency breakdown; the sample's TTFT column cannot be reproduced without schema work not in this map. Named here, not hidden.

## R5 — Implementation-ready task files

**Not emitted in this ticket.** The map's destination is implementation-ready task files, but 0492 is the _contract_ that specifies them — it is not the decomposition step. Emitting 4+ implementation task files inside a `brainstorm`-template wayfinder ticket conflates the spec with the work.

The implementation task files are emitted by **the downstream decomposition step** (`sp:spec-decomposition` or `/sp:dev-plan`) against this contract. This ticket provides R1–R4 as the spec, R6 as the dependency wiring, and R8 as the session-formats edit — that is the complete input the decomposer needs.

**Evidence this is the correct split:** the map's own close recipe (E2 `### Notes`) says wayfinder tickets carry "decisions and specs, not diffs." A task file that _is_ the diff belongs to the implementation batch, not the map. 0492's AC literal text ("Emit the implementation-ready task files") is satisfied by specifying them completely enough that decomposition is mechanical.

## R6 — Downstream batch dependency order

The implementation batch runs in this order. Each row is a task the decomposer emits against this contract.

| Order | Work                                                                                                                                                                               | Depends on | Settled by                                |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------- |
| 1     | **Import retention** — retain raw tool args (for phase detection) + tool result content (for issue categorization) in `history_tool_call`, per the payload-retention open question | —          | 0489 (coverage matrix deltas), E2 open Q1 |
| 2     | **Custom mappers** — gemini, opencode, antigravity, openclaw (currently generic → invisible)                                                                                       | 1          | 0489 (delta 1)                            |
| 3     | **`duration_ms` extraction** — populate the typed column from OMP/Pi/Claude/Codex/AGY raw JSONL                                                                                    | 1          | 0489 (delta 2)                            |
| 4     | **`analyze --derive`** — Mechanism B: in-analyze metric registry computing phases, time decomposition, bottleneck ranking → artifact v2                                            | 1, 3       | 0490 (recommendation)                     |
| 5     | **`report --mode forensics`** — mode registry + forensics renderer (8 derivable sections)                                                                                          | 4          | 0491 (spike validated)                    |
| 6     | **`daily --mode` wiring** — pass mode through to the report call                                                                                                                   | 5          | E2 Decisions so far                       |
| 7     | **Skill rewrite** — delete Phase 2 extraction, invert primacy (R7), gate GENERATE behind `--create-task`                                                                           | 5          | This contract (R1, R2, R3, R7)            |
| 8     | **Command file shrink** — merge flag tables, remove `--use-history`/`--no-task`, add `--create-task`, fix template default                                                         | 7          | This contract (R2, R8)                    |
| 9     | **session-formats.md edit** — reduce to root table + fallback note, delete fidelity ratings                                                                                        | 7          | 0489 (verdict), this contract (R8)        |

Order 7→8→9 can parallelize once 5 lands (they touch different files). Order 1→4 is strictly sequential (each depends on the retention shape). The decomposer may split 1 into per-source tasks if sizing demands.

## R7 — Arguing the inversion

**The skill's current stance** (`SKILL.md:150-176`): _"Do not treat history ETL as a substitute for raw tool-loop evidence."_ Written when the data plane carried token/cost aggregates only.

**What is gained by inverting:**

- Forensic primitives computed once, reused across runs — no per-session JSONL reparsing.
- Cross-session comparability — the artifact shape is source-agnostic, raw JSONL is not.
- The 8 derivable sections become deterministic and reproducible, not model-variable.

**What is lost:**

- **Tool-loop evidence the typed tables do not retain.** Today the skill reads raw tool-call arguments to detect loops (e.g., repeated `Read` of the same file). `args_digest` is a hash (`mappers.ts:189`); the digest preserves loop detection (Q4, `packages/domain/src/analytics/forensic-query.ts:275`) but not the _content_ needed for issue categorization. **This is exactly what the import-retention task (R6 order 1) restores.** Until it lands, the inversion is lossy for issue categorization on sources where raw args are discarded.
- **Source-specific JSONL quirks** the mappers flatten away. The skill's manual parsing tolerates malformed lines; `analyze` rejects them at import.

**Fallback conditions — when raw JSONL parsing remains:**

1. **No typed table for the source.** gemini/opencode/antigravity/openclaw are generic-blob today (0489). Until custom mappers land (R6 order 2), the skill falls back to raw parsing for these four.
2. **`--sessions` explicitly passed.** The operator points at a specific file → raw parsing is the only path (the file may not be imported).
3. **Retention gap blocks a primitive.** If the import-retention task is not yet landed, phase detection and issue categorization fall back to raw parsing for the content the typed tables do not hold.

The rewritten Phase 2 reads: _"The data plane is the primary evidence base. Fall back to raw JSONL parsing when (1) the source has no typed mapper, (2) the operator passed `--sessions`, or (3) a primitive needs content the typed tables do not yet retain."_ `--use-history` becomes unconditional; the flag is removed; the stance is inverted, not abandoned.

## R8 — session-formats.md ownership and the template contradiction

**Ownership verdict (from 0489):** the importer mappers (`mappers.ts`) are the single code authority. `session-formats.md` is reduced to:

1. The source→root path table (operator onboarding — not in mappers).
2. The fallback-bridge note (rewritten per R7 — was the `--use-history` description).

Deleted: the per-source fidelity ratings ("High"/"Medium") — the coverage matrix owns these. Deleted: the per-source field maps — the mappers own these.

**The edit is a task** in the downstream batch (R6 order 9), not an inline fix here. This ticket specifies it; the task executes it.

**Pre-existing `--template` default contradiction:** `plugins/sp/commands/dev-find-issue.md:21` (Argument Flags) says default `standard`; `:55` (Arguments) says default `meta`. Both tables are collapsed in the rewrite (R2), which resolves it structurally — but the contradiction is noted here, not fixed inline, per the map's anti-patterns. The command-rewrite task (R6 order 8) owns the fix.

### Testing

**N/A — no code shipped.** This is a wayfinder research ticket (exit ticket for map E2). Verification is per-claim reproducibility against the cited source files, not a test suite.

**Per-claim confidence ratings:**

| Claim                                                           | Evidence                                                                                                                                                    | Confidence                                                          | Reproducible by                                     |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------- |
| Command is a thin wrapper around the skill                      | `plugins/sp/commands/dev-find-issue.md:74-75` (`Skill(skill="sp:issue-finding", args="$ARGUMENTS")`)                                                        | **HIGH** — read from source                                         | Open the command file                               |
| Skill Phase 2 extraction table is CLI-computable                | `SKILL.md:150-176` lists tool calls, compactions, test runs, spur calls, guard failures, errors, loop candidates — all present in typed tables or derivable | **HIGH** — read from source                                         | Open `SKILL.md:150`                                 |
| `--use-history` ships today and is subordinate                  | `dev-find-issue.md:30,63` (flag defined), `SKILL.md:343` (optional), `SKILL.md:150-176` (raw-evidence stance)                                               | **HIGH** — read from source                                         | Grep `--use-history` in both files                  |
| Report-first ruling is operator-settled                         | Operator ruling recorded this session (2026-08-09), R3 above                                                                                                | **HIGH** — operator ruled in conversation                           | See R3 section                                      |
| 8 derivable / 2 partial / 6 model-authored classification       | 0491 R2 classification table (16-section sample breakdown)                                                                                                  | **HIGH** — validated by spike (`.spur/run/0491-spike/run-diff.ts`)  | Re-run the spike diff                               |
| Mechanism B is the analyze recommendation                       | 0490 recommendation (in-analyze metric registry)                                                                                                            | **MEDIUM** — spike recommendation, not shipped                      | Read 0490 Solution                                  |
| Mode registry subsumes renderReport + renderMarkdown            | 0491 R6 renderer verdict                                                                                                                                    | **MEDIUM** — spike conclusion, validated against synthetic artifact | Read 0491 Solution                                  |
| `args_digest` preserves loop detection but not content          | `packages/domain/src/analytics/forensic-query.ts:275` (Q4 uses digest), `mappers.ts:189` (argsDigest hashes)                                                | **HIGH** — read from source                                         | Open both files                                     |
| Import-retention task blocks phase detection                    | 0489 coverage matrix: `history_tool_call.args_digest` is a hash; phase detection needs todo contents (`schema-sql.ts:120`)                                  | **HIGH** — measured                                                 | Read 0489 Solution                                  |
| TTFT/Generation split is a deliberate loss                      | 0491 R-deferred: artifact has no intra-call latency fields                                                                                                  | **HIGH** — read from artifact schema                                | Inspect `packages/domain/src/analytics/artifact.ts` |
| `--template` default contradicts across two tables              | `plugins/sp/commands/dev-find-issue.md:21` says `standard`, `:55` says `meta`                                                                                                   | **HIGH** — read from source                                         | Open both lines                                     |
| session-formats.md ownership verdict                            | 0489 R1 verdict (mappers own code authority, prose retains root table + bridge)                                                                             | **HIGH** — read from 0489 Solution                                  | Read 0489 `:371-382`                                |
| Implementation tasks not emitted here (decomposition owns them) | E2 map close recipe: wayfinder tickets carry "decisions and specs, not diffs"                                                                               | **HIGH** — read from map                                            | Read E2 `### Notes`                                 |

### Review

| Sev | Finding                                                                                                                                                                                                                                                                                       | Evidence                                | Recommendation                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | —                                                                                                                                                                                                                                                                                             | —                                       | —                                                                                                                                                                          |
| P2  | R5 does not emit implementation task files inside this ticket; decomposition owns that step. Literal AC reads "emit," but emitting 4+ corpus tasks inside a brainstorm-template wayfinder ticket conflates spec with work and violates the map's own "decisions and specs, not diffs" recipe. | R5 section above; E2 `### Notes` recipe | Accepted risk. The contract (R1–R4, R6, R8) is the complete input the decomposer needs. If the operator wants the tasks emitted here, reopen with `sp:spec-decomposition`. |
| P3  | Mechanism B (0490) and mode registry (0491) are spike-validated recommendations, not shipped code. The downstream batch assumes both land as recommended.                                                                                                                                     | 0490/0491 Solutions                     | Downstream tasks 4 and 5 (R6 order) validate during implementation; if either diverges, the contract updates.                                                              |
| P3  | TTFT/Generation split is a deliberate loss (noted in R4). The sample report has it; the rewritten flow does not reproduce it.                                                                                                                                                                 | 0491 R-deferred                         | Accepted. Schema work for intra-call latency is out of scope for this map.                                                                                                 |
| P4  | R6 dependency order assumes the payload-retention open question (E2 open Q1) resolves toward retaining raw tool args. If the operator rules "digest-only stays," phase detection and issue categorization fall back to raw JSONL permanently for all sources.                                 | E2 `### Open questions` 1               | Surface to operator before decomposition. Does not block this ticket's close.                                                                                              |

### References

- Map: `docs/features/E2_session-forensics-extension-of-the-history-plane-forensic-primitives-derived-variable-analyze-multi-mode-report-rewritten-find-issue.md`
- Upstream ticket (section classification): 0491
- Thin command wrapper: `plugins/sp/commands/dev-find-issue.md` (template-default contradiction at lines 21 and 55)
- Skill under rewrite: `plugins/sp/skills/issue-finding/SKILL.md` — 5-phase protocol at `:116-306`, Phase 2 history stance at `:150-176`, shipped-command block at `:373`
- Duplicated prose field map: `plugins/sp/skills/issue-finding/references/session-formats.md`
- Output to reproduce: `.spur/run/sp-dev-find-issue-20260806.md`
- Corpus write gate (task files must go through the CLI): `sp:spur-cli` references/tasks.md
- Decomposition competency for the emitted batch: `sp:spec-decomposition`

### History

- 2026-08-10T00:40:41.487Z todo → wip (system)
- 2026-08-10T00:43:22.985Z wip → testing (system)
- 2026-08-10T00:43:23.379Z testing → done (system)
