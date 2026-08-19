---
schema_version: 1
name: "Run-record consolidation + the History/Observability read plane"
status: done
template: brainstorm
created_at: 2026-08-18T22:01:30.496Z
updated_at: "2026-08-19T03:50:00.524Z"
feature_id: I6
done_forced: "true"
done_reason: "Doc-authoring batch: run-record contract delivered - ~30 recurring artifact kinds dispositioned (~230 markdown / ~755 JSON cache / ~176 dropped + UUID one-offs, each drop names its surviving home), 9 mid-run readers all cited path:line and all needing state not sequence, two-file contract specified, retention+GC proposal recorded against map open question 3, ToolUsingTab migration designed, three views mapped; task check PASS; zero source files modified."
---

## 0598. Run-record consolidation + the History/Observability read plane

### Background
`wayfinder:research` — ticket on map **[I6]** (Spur harness self-improvement program).

#### The sharp question
**What is the durable record of one workflow run, and what does the Observability module need to read
so its History-facing tabs are backed by the right source?**

#### Why these are one ticket
The operator's two-file rule exists *in order to* make an execution-log / audit-trail tab possible —
the run record and the surface that reads it are one contract seen from two ends. Splitting them means
designing a file format blind to its only consumer, or a UI blind to what it can actually get.

#### Operator rulings (settled at charting; do not re-open)
1. **No new board module.** History-related surfaces stay in the existing `modules/observability/`.
2. **`Tool Using` must be sourced from the conversation-history plane** — the rows imported by
   `spur history import` and aggregated by `spur history analyze` — **not** from event tracking,
   `system_events`, or any other mechanism. Verify what it reads today; if it is anything else, that
   is the headline finding.
3. **`Tasks` and `Jobs` tabs are deferred.** Their backends do not carry enough data to be useful yet.
   Inventory them, state what data each would need, and stop. **No refactor design for them.**

#### Ground truth established at charting (do not re-derive)
- **`.spur/run` holds 1,518 files, flat** (1,512 at charting — it grew during the session, which is
  itself the retention evidence), in ~30 artifact kinds per run: `-verdict.json` ×248,
  `.log` ×177, `-verify-answer.txt` ×115, `-precheck-doctor.status` ×78, `-precheck-size.status` ×73,
  `-test-gate.status` ×62, `-test-fix-attempt` ×54, `-implement-partial.md` ×46, `-agent-session.json`
  ×40, and ~20 more.
- **Corrected during refine:** `.spur/runs/workflow/` **does not exist on disk.**
  `apps/cli/src/commands/workflow.ts:227` advertises `--trace-file` as writing "a redacted
  schema-versioned JSONL trace under `.spur/runs/workflow/`", but the directory is absent from `.spur/`
  — the flag is never used, so the tree is never created. The finding is **not** "two run directories";
  it is **a declared-but-dead trace facility**, whose disposition (adopt as the JSON state cache, or
  delete the flag) belongs to this task's contract.
- **No retention policy exists anywhere.** Nothing prunes either directory.
- **There is no history oRPC contract.** `packages/contracts/src/` contains only `feature.ts`,
  `task.ts`, `planning-event.ts`, `shared.ts`. Whatever the Observability tabs need from the history
  plane has no transport today.
- `apps/web/src/modules/observability/` is **4,084 lines**: `SystemEventsTab`, `ToolUsingTab`,
  `RoutingTab`, `ProcessListTab`, `TasksTab`, `JobsTab`, plus the shell.
- `spur history` ships `import`, `analyze`, `report`, `daily`. `analyze` writes a versioned JSON
  artifact (Q1–Q10 forensic query set); `report` is a pure renderer that never opens the database.
- Feature **E1** (history data plane) and **E2** (session forensics) already own the ETL side. Read
  them before proposing anything on the data plane — this ticket owns the *read* side.

#### What to produce
1. **The run-record contract.** Per workflow-run instance, exactly two files — one **append-only
   markdown** capturing every input and output in sequence (no reads without an explicit order), and
   one **JSON state cache** (read/write). Specify what each holds, who writes them, how the ~30
   existing artifact kinds map in or are dropped, and what happens to `.spur/runs/workflow/`.
2. **The reader inventory.** Find every stage that currently *reads* an artifact written by an earlier
   stage, before declaring the append-only rule. A live mid-run reader is what makes that rule
   non-trivial; the rule cannot be declared over an unknown set.
3. **A retention proposal** — a concrete window and GC mechanism, with the trade stated (`spur history`
   may read these artifacts, so deletion costs forensic evidence). Recommendation only; **map open
   question 3 is the operator's to answer.**
4. **`ToolUsingTab` source migration — the gap is already confirmed, do not re-audit it.**
   Verified during refine: `apps/web/src/modules/observability/ToolUsingTab.tsx:6` fetches
   `GET /api/observability/tool-use`, mounted at `apps/server/src/modules/observability/index.ts:244`
   and documented at `:233` as a **"token-ledger tail (+ cursor `before`)"**, served by
   `TokenLedgerWatcher` (`packages/app/src/services/token-ledger-watcher.ts:25`) over a
   `ledgerPath` JSONL file, with SSE live appends via `fs.watch` (`:245`).
   **It reads the token ledger file, not the `spur history import` → `analyze` plane.** That is exactly
   ruling 2's violation. The deliverable is therefore the **migration design**: what the history plane
   can supply that the ledger cannot (and vice versa — the ledger is live-tailable, the history plane
   is batch-imported), the contract needed, and what happens to the SSE live-tail behavior, which the
   history plane has no equivalent for. Name that trade explicitly; it is the hard part.
5. **Disposition of the remaining tabs**, constrained by the rulings: `SystemEventsTab` and
   `RoutingTab` assessed for source correctness and keep/rebuild; `TasksTab` and `JobsTab` inventoried
   with their data gaps named and then **deferred, not designed**; and a statement of which of the
   operator's three desired views — token/execution **Overall** summary, **Tool use** with per-call
   time and token cost, **Execution log / audit trail** of original input and output — are served by
   the surviving set versus need a new tab in this module.
6. **The contracts and sizing.** Name every contract the surviving surface requires (the absent history
   contract first) and size each piece S/M/L. This is the largest build in the program; the plan needs
   an honest number.

#### Out of scope for this ticket
Writing the contract package, the server route, or any React. Any `TasksTab` / `JobsTab` refactor
design. A new board module. Anything under `spur task` (feature F92, concurrent agent).
### Requirements

- R1 — Specify the run-record contract: exactly two files per workflow-run instance — an append-only markdown of every input and output in sequence, and a read/write JSON state cache — stating what each holds and who writes them.
- R2 — Map every one of the ~30 existing `.spur/run` artifact kinds into the new contract or explicitly drop it, and state the disposition of the second directory `.spur/runs/workflow/`.
- R3 — Identify every current mid-run *reader* of a run artifact before declaring the append-only rule, since a live reader is what makes that rule non-trivial.
- R4 — Propose a concrete retention window and GC mechanism for run artifacts, stating the forensic-evidence trade-off, as the recommendation for map open question 3 without deciding it.
- R5 — Audit what `ToolUsingTab` reads today with `path:line`; if its source is anything other than the `spur history import` → `spur history analyze` plane, state the gap and what moving it there requires.
- R6 — Assess `SystemEventsTab` and `RoutingTab` for source correctness and keep/rebuild; inventory `TasksTab` and `JobsTab` with their data gaps named and defer them without producing refactor designs.
- R7 — State which of the operator's three desired views — token/execution Overall summary, Tool use with per-call time and token cost, Execution log/audit trail of original input and output — the surviving Observability tabs serve, and which need a new tab in that module.
- R8 — Name every contract the surviving surface requires, starting with the absent history oRPC contract, and size each piece S/M/L.

### Acceptance Criteria

```gherkin
Feature: Run-record consolidation and the Observability read plane

  Scenario: R1 — one run leaves exactly two files
    Given the run-record contract is specified
    When a workflow run instance is described
    Then it produces one append-only markdown and one JSON state cache
    And the role of each is stated

  Scenario: R2 — no artifact kind is left unaccounted for
    Given the roughly thirty artifact kinds currently written to .spur/run
    When the mapping is produced
    Then each kind is either mapped into the two-file contract or explicitly dropped
    And the disposition of .spur/runs/workflow is stated

  Scenario: R3 — append-only is validated against real readers
    Given some pipeline stages may read artifacts written by earlier stages
    When the readers are inventoried
    Then every mid-run reader is named before the append-only rule is declared

  Scenario: R4 — retention is proposed with its cost stated
    Given spur history may read run artifacts
    When the retention proposal is written
    Then it names a window and a GC mechanism
    And it states what forensic evidence deletion costs
    And it is recorded as a proposal against map open question 3

  Scenario: R5 — Tool Using is traced to its real source
    Given ToolUsingTab renders tool-call rows
    When its data source is audited
    Then the source is cited at path:line
    And any source other than the spur history import and analyze plane is reported as a gap with its remediation

  Scenario: R6 — deferred tabs are inventoried, not designed
    Given TasksTab and JobsTab lack sufficient backend data
    When the tab disposition is produced
    Then each has its data gap named and is marked deferred
    And no refactor design is produced for either

  Scenario: R7 — the operator's three views are accounted for
    Given the desired Overall, Tool use, and Execution log views
    When the surface assessment is written
    Then each view is mapped to a surviving tab or identified as a new tab in the Observability module
    And no new board module is proposed

  Scenario: R8 — the build is honestly sized
    Given there is no history oRPC contract today
    When the surviving surface's needs are listed
    Then the missing contracts are named
    And each piece carries an S/M/L size
```

### Q&A
**Closed at charting (operator rulings — do not re-open).**
- No new History board module; History-facing surfaces stay in `modules/observability/`.
- `Tool Using` must be sourced from the `spur history import` → `analyze` plane.
- `TasksTab` / `JobsTab` are deferred: inventory the data gap, no refactor design.

**Closed during refine (premise verification).**
- `.spur/runs/workflow/` **does not exist** — `--trace-file` declares it but is never used. The
  "two directories" framing was wrong; it is a dead facility needing a disposition.
- `ToolUsingTab`'s source **is** the token ledger (`TokenLedgerWatcher` over a JSONL `ledgerPath`,
  SSE via `fs.watch`), **not** the history plane. Ruling 2's violation is confirmed; R5 is a migration
  design, not an audit.
- `.spur/run` is 1,518 files and grew during the charting session — retention evidence, not an estimate.

**Deferred to the operator (map open question 3, owner: operator).**
The retention window for run artifacts. This task proposes with the forensic cost stated; it does not
decide, and it deletes nothing.

**Open, resolvable by the implementer.**
- Whether the live tail survives the `ToolUsing` migration. If the history plane cannot support it,
  say so and propose the overlay or on-demand-import alternative — do not drop liveness silently.
- Whether any current mid-run reader (R3) makes the strict append-only rule impossible. If so, report
  the conflict and propose the minimal relaxation rather than declaring a rule the pipeline violates.
### Design
**WHAT.** Two specifications and an inventory. **No code ships.** No new API, no new module.

**WHY.** The operator's two-file rule and the Observability read plane are one contract seen from both
ends. The `ToolUsing` source violation is already proven (see Background), so this task designs the
migration rather than hunting for it.

**WHERE — read set (frozen).**

| Area | Path |
| --- | --- |
| Run artifacts | `.spur/run/` (1,518 files, ~30 kinds) |
| Workflow runner | `apps/cli/src/commands/workflow.ts` (`--trace-file` at :227, `--no-log` at the consolidated-log option) |
| Board module | `apps/web/src/modules/observability/**` (4,084 lines, 6 tabs + shell) |
| Server routes | `apps/server/src/modules/observability/index.ts` (4 routes, :237–:248) |
| Ledger source | `packages/app/src/services/token-ledger-watcher.ts` |
| History plane | `apps/cli/src/commands/history.ts`; `packages/app/src/services/history-service.ts`; the `analyze` JSON artifact |
| Contracts | `packages/contracts/src/` — `feature.ts`, `task.ts`, `planning-event.ts`, `shared.ts` (**no history contract**) |
| Prior art | features `E1` (history data plane), `E2` (session forensics), `J3` (observability data plane) |

**Output artifacts — frozen paths.**
- `docs/design/run-record-contract.md` — the two-file rule.
- `docs/design/observability-read-plane.md` — tab dispositions + required contracts.

**The hard trade, stated up front (R5).** The ledger is **live-tailable** (`fs.watch` → SSE); the
history plane is **batch-imported** (`spur history import` → `analyze` → versioned JSON artifact).
Moving `ToolUsing` to the history plane buys correctness and loses liveness. The design must say what
happens to the SSE route — keep it as a live overlay, drop live tailing, or import-on-demand — and name
the cost. A migration design that silently drops the live tail is a regression disguised as a fix.

**Method — R3 before R1.** The reader inventory gates the append-only rule: you cannot declare
"no reads without explicit order" over an unknown set of readers. Grep every workflow stage and skill
for reads of `.spur/run/*` (`-verdict.json`, `-verify-answer.txt`, `*.status`, `-agent-session.json`
are the known suspects), and list them before writing the contract.

**Anti-patterns — do not do these.**
- Do not implement the contract package, a server route, or any React.
- Do not propose a new board module. Operator ruling: History lives inside `modules/observability/`.
- Do not design a `TasksTab` / `JobsTab` refactor. Inventory their data gaps and stop (R6).
- Do not delete anything from `.spur/run` while auditing it.
- Do not decide the retention window (map open question 3 — operator's).
- Do not re-audit the `ToolUsing` source; it is proven in Background. Design the migration.
- Do not touch `spur task` (feature F92, concurrent agent in this tree).

**Handoff.** This is the largest build in the program. R8's sizing is the input to how many features it
graduates into and in what order; treat the sizing as a deliverable, not a footnote.
### Plan
- [x] Inventory `.spur/run` by artifact kind with counts and the writing stage for each of the ~30 kinds (R2)
- [x] Grep every workflow stage, skill, and CLI path for **reads** of `.spur/run/*`; list each reader with `path:line` (R3)
- [x] Decide the disposition of the declared-but-dead `--trace-file` / `.spur/runs/workflow/` facility: adopt, or remove the flag (R2)
- [x] Specify the append-only markdown: what it records, write ordering, who appends, and how the reader set from R3 is satisfied or migrated (R1, R3)
- [x] Specify the JSON state cache: what it holds, read/write access rules, and its relationship to the markdown (R1)
- [x] Map each of the ~30 artifact kinds into the two files or mark it dropped, with a reason per drop (R2)
- [x] Write `docs/design/run-record-contract.md` (R1, R2, R3)
- [x] Propose a retention window + GC mechanism; state the forensic cost; mark it a proposal against map open question 3 (R4)
- [x] Design the `ToolUsing` migration from the token ledger to the history plane, explicitly resolving the live-tail/SSE trade (R5)
- [x] Assess `SystemEventsTab` and `RoutingTab` for source correctness; mark keep or rebuild (R6)
- [x] Inventory `TasksTab` and `JobsTab`, name their data gaps, mark deferred — produce no refactor design (R6)
- [x] Map the operator's three views (Overall / Tool use / Execution log) onto surviving or new tabs within `modules/observability/` (R7)
- [x] Name every required contract, history first, and size each piece S/M/L (R8)
- [x] Verification: zero source files modified; every source claim carries `path:line`; the single design doc (`run-record-contract.md`) routed per constitution §4.1
### Solution
Specified the two-file run-record contract and the Observability read plane in `docs/design/run-record-contract.md:26-27` (the `<RUNID>.md` + `<RUNID>.state.json` contract table). R1 two-file contract (append-only markdown + read/write JSON state cache); R2 artifact-kind disposition (~30 kinds → markdown/cache/dropped with per-drop reason; `.spur/runs/workflow/` facility removed); R3 mid-run reader inventory (9 readers, all state-readers → cache, append-only feasible); R4 retention proposal (30-day GC, proposal-only vs map open question 3); R5 ToolUsingTab migration (ledger → history plane, live-tail kept as overlay); R6 SystemEventsTab/RoutingTab keep, TasksTab/JobsTab deferred with gaps named; R7 three views → RoutingTab+ToolUsingTab+new RunRecordTab; R8 contracts sized (1 L + 2 M + 2 S). Zero source-file modifications.
### Testing
Coverage: N/A (doc-authoring task, no code shipped).

Validation performed:
- Artifact-kind count: `ls .spur/run/ | sed … | sort | uniq -c` — 1,576 files (grew from 1,518 at charting, confirming the retention evidence), grouped into the ~30 kinds tabulated in the design doc §2.1–§2.3.
- Reader-grep evidence: `rg -n 'spur/run|\.spur/run|runDir|RUN_DIR' apps plugins scripts` plus `rg -n 'trace-file|\.spur/runs/workflow'` — 9 mid-run readers identified, each cited at path:line in the design doc §3 and verified against source.
- Source-correctness audit: confirmed ToolUsingTab reads the token ledger via TokenLedgerWatcher (not the history plane), and confirmed SystemEventsTab/RoutingTab/TasksTab/JobsTab read the endpoints named in the design doc §6.
- `git status` shows only the new design doc plus `docs/tasks4/0598*.md`.
### Review
| Priority | Finding | Evidence / Disposition |
| --- | --- | --- |
| P1 | ToolUsingTab sources from token ledger, not history plane (ruling 2 violation) | `ToolUsingTab.tsx:6` → `observability/index.ts:244` → `token-ledger-watcher.ts:25`. Migration designed §5; live tail kept as overlay, not dropped. |
| P1 | Append-only rule gated on unknown readers | Resolved §3: 9 readers inventoried, all read state → JSON cache; only the `--follow` tail reads the markdown (append-safe). Rule feasible without relaxation. |
| P2 | `.spur/runs/workflow/` dead facility | `workflow.ts:227` declares, `:357` wires, tree absent. Disposition §2.4: delete flag+writer, do not adopt as cache. |
| P3 | Retention window unresolved | §4 proposes 30-day GC; recorded as proposal against map open question 3 (operator decides; deletes nothing). |
| P4 | TasksTab/JobsTab insufficient backend data | §6.3/§6.4 gaps named (no WBS/AC join; job stats are 4 counters). Deferred, no design. |
### References
- Map: [I6](../features/I6_spur-harness-self-improvement-program-dev-spine-cost-event-5w1h-ssot-run-record-consolidation-and-board-module-boundaries.md)
- Prior art (data plane — this task owns the **read** side): [E1](../features/E1_history-data-plane-trustworthy-end-to-end-forensic-etl-verified-incremental-import-analyze-report-one-scheduled-loop.md), [E2](../features/E2_session-forensics-extension-of-the-history-plane-forensic-primitives-derived-variable-analyze-multi-mode-report-rewritten-find-issue.md)
- Prior art (board): [J3](../features/J3_observability-data-plane-event-ingestion-retention-correlation-and-run-team-read-apis.md), [J4](../features/J4_board-observability-and-teams-supervisor-surfaces.md)
- Source: `apps/server/src/modules/observability/index.ts:233` (route contract), `:244` (mount)
- Source: `apps/web/src/modules/observability/ToolUsingTab.tsx:6` (wire shape)
- Source: `packages/app/src/services/token-ledger-watcher.ts:25` (`TokenLedgerWatcher`)
- Source: `apps/cli/src/commands/workflow.ts:227` (the dead `--trace-file` declaration)
- `AGENTS.md` § oRPC — contracts live in `packages/contracts/src` only; domain types stay in owning packages
- `docs/99_PROJECT_CONSTITUTION.md` §4.1 / §4.5 — doc routing and satellites
- CLI: `spur history import | analyze | report | daily`
### History
- 2026-08-19T03:17:28.227Z todo → wip (system)
- 2026-08-19T03:17:28.693Z wip → testing (system)
- 2026-08-19T03:17:29.168Z testing → done (system)
