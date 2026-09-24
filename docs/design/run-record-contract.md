# Run record — two-file contract + the Observability read plane

**Area:** `.spur/run` artifact consolidation (two-file run record), mid-run reader inventory, retention proposal, and the History/Observability read plane (tab dispositions + required contracts).
**Status:** historical 0598 analysis plus the current E7 contract below. Sections 0–9 retain the original design evidence; where they differ from the current contract, the current contract governs.
**Authority:** elaborates `docs/04_DESIGN.md` §2.3 (run-artifact path model) and the E1/E2 history data plane. Cross-references `docs/design/event-tracking.md` (0597, event 5W1H SSOT) and `docs/design/dev-spine-cost-and-drift.md` (0594). On conflict, `04_DESIGN.md` wins (lower number wins on content, constitution §4.1).

---

## Current E7 contract (2026-09-22 rebaseline)

The original 0598 snapshot predates the History Board, its `historyContract.getToolSequence` API and Tool Using tab (E8/E81), and the removal of Observability's old Tool Using tab (J92). E7 must not build another history contract, tool-use feed, board module, or Tool Using tab. `packages/contracts/src/history.ts`, `apps/web/src/modules/history/ToolUsingTab.tsx`, and `apps/web/src/modules/observability/tabs.ts` are the current baseline. The old tab's source-migration proposal in §5 and the absent-contract claim in §8 are superseded.

E7's remaining outcome is a **workflow run record**: for a logging-enabled run, one append-only, redacted `.spur/run/<runId>.md` execution log and one schema-versioned `.spur/run/<runId>.state.json` machine-state file written by atomic replace. The pair is keyed by the authoritative workflow run ID across source, bundled, inline, subprocess and resume paths. `--no-log` remains an explicit compatibility exception; it must not be silently overridden or removed. Existing workflow DB trace/events, `.spur/workflow/` `--trace-file` output, task/feature verification evidence, and source-owned agent transcripts remain separately owned facts. The pair may refer to them but must not copy them merely to satisfy a file count. The historical ~30-kind table in §2 is a migration inventory, not a deletion list: re-inventory current readers and writers after D63 before moving any artifact.

The run record is read through the existing Observability server boundary and linked from an existing run-inspection surface. A new History module or duplicate Tool Using tab is outside E7. Read by run ID only, reject traversal and symlink escapes from the project run directory, distinguish absent/legacy/incomplete records, and return only bounded redacted content. Report `expired` only with persisted cleanup evidence; the current `.log` cleaner leaves no tombstone, so absence alone cannot prove expiration. Preserve the existing workflow trace and current-input proof as the authoritative completion/recovery evidence; the markdown log is human inspection, not a replacement for those gates. Resume appends new sections and updates state without duplicating a prior side effect or presenting an incomplete run as done.

Migration is additive first: old `.log` and sidecar consumers remain readable until the replacement reader/writer is proven on the canonical workflows and installed plugin. New runs should have no undeclared **run-record** sidecars at terminal state; independent task evidence and the explicit `--trace-file` projection do not count as run-record sidecars. Do not bulk-delete or rewrite historical artifacts. Retention for the new pair is a separate decision: `workflow.logRetentionDays` already defaults to 30 days for `.log` files, but extending that deletion policy to the pair requires operator ratification. Until then, the pair is not reclaimed. Once ratified, a dry run must report the same eligible pair set as an apply run; active/paused runs and independently owned proof artifacts are never reclaimed by pair GC.

The 0594 injected-file-list cost idea is independent instrumentation, not a prerequisite for the run record. It remains outside E7 unless a later measured cost proposal gives it an owner.

**0925 implementation baseline (2026-09-23).** `WorkflowRunLogSink` now writes the pair for newly logged source and bundled CLI runs (`workflow run` / `workflow continue`; `--no-log` still writes nothing): `.spur/run/<runId>.md` stays the append-only, size-bounded human log, and `.spur/run/<runId>.state.json` is a schema-`1` atomic replace (same-directory temp + rename) carrying only the minimal private fields — `schemaVersion`, `runId`, `workflowName`, `status`, `startedAt`/`updatedAt`, and `finalizedAt` once terminal. `status` maps `running` on start and copies the `workflow.run.finalized` trace status verbatim (`done`/`failed`/`paused`/`cancelled`) — state never claims stronger than the DB trace. Configured-secret redaction (`configuredSecretValues`) runs at this persistence boundary on every appended line and the state projection, on top of upstream `bounded()` redaction. Read projections follow the rename: `followRunLog` and `run.artifact` (`outputArtifactForRun`) prefer `.md` with the legacy `.log` as read-only fallback. `workflow clean --logs` still scans `.log` names only; the pair is not reclaimed until an operator retention policy exists (R4). The verdict/gate/retry state fields in §1.2 remain future work (0926 reader contract, 0927 inline/plugin drivers).

**0927 inline/plugin baseline (2026-09-24).** The inline/plugin driver seam now produces the same pair for inline-driven runs: `inline-run-setup` (source and bundled Node twin) writes `.spur/run/<runId>.state.json` (schema-`1` atomic replace, the same minimal identity fields — `workflowName`, `status: running`, `attached`, `workflowVersion`, `resolvedPath`, `layer`, `definitionDigest`) plus a one-line run-start header in `.spur/run/<runId>.md`; driver and trace failure lines append to the same `.md`. The `-inline-setup.json` sidecar and driver `<runId>.log` writes are retired; the legacy `.log` remains a read-only fallback for pre-0927 runs via `readWorkflowRunRecord`. `AgentService.resolveArtifactRefs` — the last declared `.log` reader — reads the seam: pair record → `.md` ref, legacy run → `.log` ref, no record → no ref, with ref paths staying project-relative. Workflow-declared YAML action outputs and WBS-keyed verdict/gate evidence stay run-scoped workflow data (§1.2 future work), untouched by this migration; the `-idea-*` idea-pipeline drivers follow in 0928.

**0928 remaining-catalog baseline (2026-09-24).** The audited classification of the remaining canonical workflows (`idea-pipeline`, `feature-verification`, `feature-lifecycle`, `task-lifecycle`, `wrapup-pipeline`, `history-anatomy`, `pr-review`, `wayfinder-resolution`) found **no record-owned site in any of them** — audited no-change across the board. Every `.spur/run` reference in those definitions is a declared workflow artifact: run-scoped signals, answers, retry counters, batch/handoff data (`<runId>-<name>`, including the `-idea-*` driver artifacts written by `idea-coverage-check.ts` and consumed by `idea-handoff.ts`), WBS/feature-keyed independent proof (`<wbs>-verdict.json`, the `feature-verification` receipts), history-anatomy outputs and its shared `history-anatomy-run.id` pointer, and `.spur/memory/*` route logs. None names the run record (`.md`/`.state.json`) or a legacy single-file `<runId>.log` state — the pair stays owned by the engine sink and the inline setup seam, so every workflow's guard, human decision, retry, and external-effect behavior is untouched. Attested by `plugins/sp/tests/run-record-catalog.test.ts` (catalog-wide record-name sweep + idea-pipeline owner spot-checks); the stale `<RUNID>.log` wording in the `spur-cli` workflow reference and the `spur-dev` execution-workflow reference was corrected to the pair-with-legacy-fallback contract.

**0948 retention disposition.** Two follow-ups from the E7 batch are now closed. (1) The catalog sweep recognised only the placeholder-stripped record spelling (`<runId>.md` → `.md`), so a literally hardcoded record name would have evaded it; the rule now classifies any non-artifact `.spur/run/<segment>` ending in a record suffix (`.md`, `.state.json`, `.log`) as a record reference, while run-id-suffixed artifacts (`-idea-handoff.md`) stay exempt — mutation-checked from both sides in `run-record-catalog.test.ts`. (2) `history-anatomy.yaml`'s `history-anatomy-run.id` is an explicit exemption from reclamation: it is a single fixed-name pointer overwritten on every run, so it does not accumulate and needs no retention path (unlike the pair and legacy `.log` files, which `spur workflow clean --logs` owns).

## 0. Historical 0598 rulings and snapshot

The following records the original 0598 decision context. The current E7 contract above supersedes
its Board placement, Tool Using, trace-file removal, artifact-deletion, and retention proposals.

1. **No new board module.** History surfaces stay in `apps/web/src/modules/observability/`.
2. **`Tool Using` must source from the `spur history import` → `analyze` plane**, not event tracking / `system_events` / token ledger.
3. **`Tasks` and `Jobs` tabs are deferred** — inventory data gaps, no refactor design.
4. Retention window is **map open question 3, owner: operator** — this doc proposes, does not decide, deletes nothing.

At 0598 charting, `.spur/run` was flat and held 1,576 files (1,518 at the earlier snapshot) across
about 30 artifact kinds. The `.spur/workflow/` absence was a historical observation, not a current
claim or permission to remove its live `--trace-file` surface.

---

## 1. R1 — The two-file run-record contract

Per workflow-run instance exactly **two files**, both keyed by the run id under `.spur/run/`:

| File | Mode | Holds | Writer | Readers |
| --- | --- | --- | --- | --- |
| `.spur/run/<RUNID>.md` | **append-only** | Every input and output **in sequence** — section headers stamped with stage + ordinal, then the verbatim input/output body | `WorkflowRunLogSink` + one append helper per pipeline stage (write-once, no in-place edit) | human `--follow` tail; forensic replay; `spur history import` (batch) |
| `.spur/run/<RUNID>.state.json` | **read/write** (atomic replace: temp + rename) | Machine state: `runId`, `wbs`/`featureId`, `status`, `startedAt`/`updatedAt`, last verdict, gate-status map, retry counters, run-id/`inline-run-id` pointers, agent-session ids, `fix-created` list, idea state | the same stages, but as a state update (read-modify-write) | **every mid-run reader** (see R3) |

### 1.1 The append-only markdown

- One section per stage boundary, in execution order. Section header = `## <stage> (<ordinal>) <wbs|runId>`; body is the exact input (prompt/AC/plan/section body) and output (agent result, verdict, diff summary) that stage produced or consumed.
- **Append-only means no truncation, no in-place rewrite, no reordering.** A stage that "revises" an earlier output appends a new section (`reverify-…`) rather than editing the prior one. This is already the de-facto convention (`reverify-solution.md`, `test-fix-partial.md` append attempts).
- Ordering is explicit because the ordinal is in the header: the file is a log, not a key-value store. Reads without an explicit order are disallowed *for this file* — any reader that needs random access goes to the JSON cache instead.

### 1.2 The JSON state cache

- Holds what a later stage needs to *branch on*: last verdict (`pass`/`fail` + exit code), gate statuses, retry counts, run-id pointers, and the `fix-created` / `agent-session` / `idea-*` machine facts.
- **Read/write, atomic replace.** Concurrent-safe because writers serialize on the temp+rename swap; readers never see a half-written file.
- This file is the target of **all** mid-run readers (R3). It is *not* append-only — the rule only governs the markdown.

### 1.3 Why this split is the whole point

The operator's two-file rule exists *so that* the execution-log/audit-trail tab can read one append-only file while the pipeline's own control flow reads a small, order-independent state file. R3 proves the split is feasible: **every** mid-run reader needs state, not sequence.

---

## 2. R2 — Artifact-kind disposition

Counts are a live `ls .spur/run/` grouping (1,576 files). The ~30 kinds fold into three buckets. "Markdown" = appended section of `<RUNID>.md`; "cache" = key in `<RUNID>.state.json`; "dropped" = no longer written (reason given).

### 2.1 Pipeline / task section outputs (→ **markdown**)

| Kind | Count | Disposition |
| --- | --- | --- |
| `-output.log`, `-wf.log`, `-batch.log`, `-batch-run.log`, `-spur-check-new.log`, `wrapup.log`, `-smoke-*.log` | ~40 | stdout/stderr streams → appended verbatim sections of the markdown |
| `-implement-partial.md` (51), `-testing.md` (26), `-solution.md` (15), `-requirements.md` (17), `-plan.md` (6), `-design.md` (4), `-ac.md` (9), `-bg.md` (5), `-background.md` (3), `-review.md` (6), `-qa.md` (2), `-acceptance.md` (2), `-root-cause.md`, `-discovery-partial.md` (3), `-verify-partial.md` (9), `-doc-sync-partial.md` (11), `-test-partial.md` (4), `-start-partial.md` (2), `-learning-capture-partial.md` (2), `-review-partial.md`/`-review-final.md`/`-testing-final.md`/`-solution-final.md`/`-reverify-*` (≈12) | ~190 | stage section bodies → one markdown section each, ordinal in header |

### 2.2 Verdicts / machine state (→ **cache**)

| Kind | Count | Disposition |
| --- | --- | --- |
| `-verdict.json` (250), `-fix-created.json` (17), `-agent-session.json` (44), `-idea-needs-design.json` (9), `-idea-task-batch.json` (4), `-worktree-*.json`, `-verifyall-*.json`, `-batch-input.json` | ~325 | machine facts → cache keys (verdict → `state.verdict`; session ids → `state.agentSessions[]`; batch inputs → `state.batchInput`) |
| `-precheck-doctor.status` (81), `-precheck-size.status` (76), `-test-gate.status` (64), `-idea-precheck-doctor.status` (8) | ~229 | gate results → `state.gates.<name> = {status, at}` |
| `-test-fix-attempt` (56, no ext), `-refine` (5), `-run-id`/`-inline-run-id` (7), `-idea-ac-retry-count` (5), `-idea-decompose-retry-count` (4), `-idea-design-reject-count` (2), `-latest-run-id`/`-last-run-id`/`-current-run` (3) | ~82 | retry counters + run-id pointers → cache scalars |
| `-verify-answer.txt` (117) + `-verify-answer.md`/`.err` (2) | ~119 | the answer body is a *sequence* item (markdown section); the verdict that consumed it is cache |

### 2.3 Ephemeral / derived / scratch (→ **dropped**)

| Kind | Count | Drop reason |
| --- | --- | --- |
| `-test-gate.findings` (28), `-test-gate.log` (45) | ~73 | findings/log are the stdout stream already captured in the markdown; no separate file |
| `-pre-action.snapshot` (3), `-implement-pre-snapshot.txt` (4), `-pre-implement-snapshot.txt` (3), `-snapshot` (3) | ~13 | pre-action snapshots are transient comparison baselines; derive from git + cache on demand |
| `-test-gate.log` dedup, `*.patch`, `*.err`, `*.bin`, `*.capnp`, `*.tsv`, `*.ts`, `*.test.ts`, `*.sh`, `*.toml`, `*.yaml`, `split`, `handoff`, `host-session-id`, `task-authoring-*`, `dogfood`, one-off UUID-named files | ~90 | scratch/debug artifacts; the durable facts (verdict, session, diff) are already in markdown+cache |

### 2.4 Run-independent shared state (→ **kept**)

| Kind | Count | Disposition |
| --- | --- | --- |
| `agent-doctor.json` (B4/0683) | new | Detection cache keyed by executor-set fingerprint, NOT by run id — the first `.spur/run` artifact that is shared warm state across invocations rather than a per-run record. Disposition: keep as-is (TTL 60 s, atomic rewrite, degrades to live run); excluded from the two-file run record and from History import. |

**Net:** every durable fact lands in one of the two files; the drops are all derived or transient. No artifact kind is silently lost — each drop names the surviving home of its durable content. Run-scoped artifacts and `agent-doctor.json` are disjoint: the cache never carries run linkage, so run-record consolidation ignores it.

### 2.4 Historical `.spur/workflow/` removal proposal — superseded

`apps/cli/src/commands/workflow.ts:227` declares `--trace-file` writing a "redacted schema-versioned JSONL trace under `.spur/workflow/`"; the flag is wired (`:282` async propagation, `:357` `WorkflowTraceWriter`) but **never exercised** — the tree does not exist on disk. The trace need is already covered twice over:

- the consolidated run log (`WorkflowRunLogSink`, `:374`), which this contract promotes to the append-only `<RUNID>.md`, and
- the `system_events` ledger (task 0370), which made the JSONL trace redundant for server-side visibility (`docs/tasks3/0370_…md` records server-side ingestion of these traces was declined).

**Historical disposition, no longer approved for E7:** the 0598 proposal was to delete the flag,
`WorkflowTraceWriter`, and `.spur/workflow/` references. The current contract preserves them as
an independent redacted trace projection. The run-record state cache is still co-located with its
markdown log under `.spur/run/`.

---

## 3. R3 — Mid-run reader inventory (before the append-only rule)

Every current reader of a `.spur/run/*` artifact, with `path:line`:

| Reader | `path:line` | Reads | Mid-run? | Compatible with split? |
| --- | --- | --- | --- | --- |
| `followRunLog` tail | `apps/cli/src/commands/workflow.ts:971` | `.spur/run/<RUNID>.log` (offset tail) | yes (live) | yes — read-only tail of the append-only markdown |
| `--output` follow | `apps/cli/src/commands/workflow.ts:678` | `.spur/run/<RUNID>.log` | yes | yes — same tail |
| `task verdict` | `apps/cli/src/commands/task.ts:394` | `.spur/run/<wbs>-verdict.json` | yes | yes → reads cache |
| `task check --from-answer` | `apps/cli/src/commands/task.ts:896` | `.spur/run/<wbs>-verify-answer.txt` | yes | yes → answer moves to markdown section, but the *consumer* reads the verdict from cache |
| `verifyall` | `apps/cli/src/commands/task.ts:966` | `.spur/run/verifyall-batch-input.json` | yes | yes → cache key |
| workflow shell guards | `apps/cli/tests/commands/workflow.test.ts:632` (canonical `test "$(cat …-gate.status …)" = PASS`) | `.spur/run/<RUNID>-gate.status` | yes (between steps) | yes → cache `state.gates` |
| feature-sync verdict mtime vector | `plugins/sp/scripts/feature-sync-bounded.ts:320` (`readVerdictMtimeVector`, called `:393`) | `-verdict.json` mtimes | yes (bounded loop) | yes → cache `state.verdict.updatedAt` |
| eval-pipeline snapshot | `scripts/commands/eval-pipeline.ts:370`/`:401` (`snapshotDir(run.runDir)`) | whole dir | yes | yes — snapshots the two files instead of N |
| `WorkflowRunLogSink` | `apps/cli/src/commands/workflow.ts:374` | (writes) `.spur/run/<RUNID>.log` | writer | n/a — becomes the markdown writer |

**Conclusion:** every mid-run reader needs *state*, not *sequence*. All of them move to the read/write JSON cache. The append-only markdown has exactly **one** mid-run consumer — the human `--follow` tail, which is read-only and offset-based, therefore append-safe. **The strict append-only rule is feasible**; no relaxation required.

---

## 4. R4 — Retention proposal (proposal only; operator decides)

**Proposal:** retain the two per-run files for **30 days**, then GC by mtime. Mechanism: extend the existing `workflow clean --logs` path (`docs/tasks3/0429_…md` already added `cleanRunLogs(retentionDays, dryRun)` in `packages/app/src/services/workflow-service.ts:536`), widening its scope from `.log` files to the `{runId}.md` + `{runId}.state.json` pair. GC is **best-effort with a `failures` report**, dry-run first, never touches files newer than the window.

**Forensic-evidence cost:** `spur history import` reads these artifacts to rebuild the execution log; deleting after 30 days forfeits audit-trail reconstruction for runs older than the window. The trade is *explicit*: retention > 0 keeps the audit tab whole for recent runs and bounds disk; retention = 0 (delete-on-success) is the other extreme and should be rejected because the entire point of the two-file rule is durable replay. **This is a recommendation against map open question 3, not a decision — the operator owns the window.**

---

## 5. R5 — ToolUsingTab source migration

**Verdict (already proven at charting, re-cited here):** `apps/web/src/modules/observability/ToolUsingTab.tsx:6` fetches `GET /api/observability/tool-use` (`apps/server/src/modules/observability/index.ts:244`, documented `:233` as a "token-ledger tail"). The server serves it from `TokenLedgerWatcher` (`packages/app/src/services/token-ledger-watcher.ts:25`) over `.spur/context/token-ledger.jsonl` (`:245` `fs.watch` → SSE). **It reads the token ledger, not the `spur history import` → `analyze` plane — ruling 2's violation.**

**The gap, and the hard trade:**

| Capability | Token ledger (today) | History plane (`import` → `analyze`) |
| --- | --- | --- |
| correctness of tool rows | partial — ledger rows are tool-*activity* hints, not the per-call time+token record the operator wants | correct — `analyze` writes the Q1–Q10 versioned JSON artifact (`apps/cli/src/commands/history.ts:129`) over imported `history_message` typed columns |
| liveness | **live-tailable** (`fs.watch` → SSE) | **batch-imported** — no live tail equivalent |
| per-call time + token cost | absent (ledger has no per-call duration/token fields) | present (task 0559 join, `workflow.ts` cost renderer) |

**Migration design:** point the tab at a new history oRPC contract (§8, the first contract). The `analyze` artifact (Q1–Q10) supplies the per-call time+token rows. **Live tail survives as an overlay, not a replacement:** keep `GET /api/observability/tool-use/stream` on the ledger for *liveness only* (appends since last import), while the paged/historical rows come from the history plane. This is the *import-on-demand + live overlay* alternative — the operator's open question ("whether the live tail survives") is answered: **yes, as a thin overlay**, because dropping liveness is a regression disguised as a fix and the ledger remains the only live source until E1 ships incremental import.

**Cost:** the overlay means two sources for one tab until E1's incremental import lands; a `union` keyed on `seq`/`ts` with de-dupe (already the pattern in `ToolUsingTab.tsx` `applyPage`). Named explicitly so it is not a silent regression.

---

## 6. R6 — Remaining tab dispositions

### 6.1 SystemEventsTab — **keep** (correct source)

`apps/web/src/modules/observability/SystemEventsTab.tsx:112` reads `/api/events/history`, with SSE from `/api/events/planning` (`:90`). Source is the `system_events` ledger — the correct read plane for events (task 0597's 5W1H SSOT governs the rows). **Keep as-is**; the only future work is the 0597 remediation (populate `field`/`data`), which is out of scope here.

### 6.2 RoutingTab — **keep** (correct source)

`apps/web/src/modules/observability/RoutingTab.tsx:236` reads `/api/observability/routing-summary` (routing aggregate + per-role token totals, tasks 0546/0547/0552). Source is the run/team store, not the token ledger or event plane. **Keep**; it already serves a slice of the operator's Overall view.

### 6.3 TasksTab — **deferred, data gap named, no design**

`apps/web/src/modules/observability/TasksTab.tsx:291` reads `/api/runs` (run list + phases/transitions/actions). **Gap:** run rows carry no per-task WBS/AC linkage — a task's section content and verdict live in `.spur/run` + task corpus, not in the `runs` table, so the tab cannot show *what a run did to which task* without a new join the backend does not have. **Deferred.**

### 6.4 JobsTab — **deferred, data gap named, no design**

`apps/web/src/modules/observability/JobsTab.tsx` reads `/jobs/stats` + `/api/events/history`. **Gap:** job stats are four counters (`pending/processing/completed/failed`) with no per-job duration, queue latency, or retry trail in the served shape — not enough to be useful. **Deferred.**

---

## 7. R7 — Operator's three views → tab mapping

| Operator view | Served by | Action |
| --- | --- | --- |
| **Overall** token/execution summary | `RoutingTab` (per-role token totals) + `ProcessListTab` | keep; extend with a history-plane aggregate once §8's contract lands |
| **Tool use** per-call time + token cost | `ToolUsingTab` **after migration** (§5) | migrate source from ledger → history plane; live overlay for tail |
| **Execution log / audit trail** of original input/output | **new tab** — no current tab reads the run record | add `RunRecordTab` (or extend `SystemEventsTab`) reading `<RUNID>.md` via a history oRPC route |

No new board module — all three land inside `apps/web/src/modules/observability/`.

---

## 8. R8 — Required contracts + sizing

Ordered by dependency; history contract first (currently absent — `packages/contracts/src/` holds only `feature.ts`, `task.ts`, `planning-event.ts`, `shared.ts`).

| # | Contract | Content | Size |
| --- | --- | --- | --- |
| 1 | **history oRPC contract** (`packages/contracts/src/history.ts`) | DTOs for the `analyze` artifact (Q1–Q10) + tool-use rows (per-call time/token) + run-record `{runId}.md` read | **L** — new contract package + server route + tab rewrite (the largest single build; graduates into its own feature) |
| 2 | run-record state schema (`{runId}.state.json`) | zod schema for the JSON cache (verdict, gates, counters, pointers) | **S** — one zod schema + writer/reader helpers |
| 3 | tool-use live overlay contract | ledger-tail DTO already exists; formalize `union` shape for ledger+history merge | **M** — server merge route + tab de-dupe |
| 4 | retention/GC config surface | `workflow.logRetentionDays` reuse (task 0429) widened to the two-file pair | **S** — extend `cleanRunLogs` scope |
| 5 | run-record read route | `GET /api/observability/run-record/:runId` serving `<RUNID>.md` + state | **M** — thin server route + `RunRecordTab` |

**Honest build number:** the full read plane is **one L (history contract + migration) + two M + two S**, graduation order: (1) history contract, (2) tool-use migration with live overlay, (3) run-record read route + state schema, (4) retention GC. Each is a feature, not a task; this doc is the sizing input for that graduation.

---

## 9. Out of scope (explicit)

Contract package code, server routes, React, `TasksTab`/`JobsTab` refactor design, a new board module, anything under `spur task` (F92), and the retention *decision* (map open question 3).
