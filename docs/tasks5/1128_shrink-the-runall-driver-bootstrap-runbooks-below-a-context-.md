---
schema_version: 1
name: Shrink the runall driver bootstrap runbooks below a context budget
status: done
template: feature-impl
created_at: 2026-10-08T18:13:58.693Z
updated_at: "2026-10-09T04:06:45.909Z"
feature_id: H1

ac_numbering: task-local
ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1128-verdict.json
---

## 1128. Shrink the runall driver bootstrap runbooks below a context budget

### Background

Every pi driver session in the 2026-10-07/08 fleet compacted within 2-4 minutes of starting: bootstrap reads `sp-spur-dev/SKILL.md` (20 KB), `references/execution-batch.md` (106 KB) and `references/inline-pipeline-driver.md` (61 KB) - roughly 45k tokens - on `zai/glm-5.3-flash` with a 128k window and compaction at ~108k (`tokensBefore` 108-115k in every compaction record). Measured: P1 session 15 compactions, F91 9, H15 7, 1117-1120 batch 5; each first compaction landed at 22:46-22:48 after a 22:44-22:45 start, followed by targeted re-reads of the same runbooks (`execution-batch.md` offsets 95/150/640/755/915, `inline-pipeline-driver.md` 55/78/340/415/510/610). Post-compaction drivers lost earlier protocol detail, which showed up as re-derived grammar (verify-answer rejected 2-6 times per task) and record-stage anchor repairs.

`dev-operations.md` (103 KB), `cross-cutting.md` (55 KB) and `flag-glossary.md` (35 KB) are also loaded on demand by the same flows.

**Measured section sizes (bytes, 2026-10-08 `main`).** The bootstrap today is `SKILL.md` 19,973 + `execution-batch.md` 106,487 + `inline-pipeline-driver.md` 61,503 = **187,963 B**, about 47k tokens. That is about 43% of the usable 108k context on glm-5.3-flash before the task, the diff or any tool output loads.

- **`execution-batch.md`:**
  - Worktree isolation (lines 609–1388), mostly WT-1…WT-5 shell blocks: about 60 KB. Splits into setup WT-1…WT-3b (lines 609–958) and merge/teardown WT-4/WT-5 plus "Worktree retained" plus the conflict-merge recipe (959–1388).
  - Parallel isolation (1430–1552): 7.9 KB.
  - Batch Report template (466–578): 8.9 KB.
  - Batch continuation (1563–end): 3.9 KB.
  - Step 6 wrap (579–608): 2.0 KB.
  - The remaining Steps 1–5, gate preflight, AC traceability and subagent disciplines total about 31 KB.
- **`inline-pipeline-driver.md`:**
  - Run setup (60–270): 16.4 KB.
  - YAML interpreter (380–677): 21.8 KB.
  - Structured trace emission (678–798): 8.1 KB.
  - Per-call tree pin (271–332): 4.1 KB.
  - Record & done (799–840): 3.4 KB.
  - Chunked implement (333–357): 1.6 KB.
  - Comprehensive-check retention (358–379): 1.7 KB.

**Inbound references that pin anchors.**
- `plugins/sp/agents/super-planner.md` (15 refs), `dev-operations.md` (13), `dev-runall.md` (7), `scripts/commands/inline-pipeline-parity-check.ts` (7; parses the "Supported action and guard set (0755 R2 parity contract)" section of `inline-pipeline-driver.md`), `plugins/sp/tests/skill-structure.test.ts` (6), `scripts/commands/inline-execution-contract.test.ts` (5), `execution-workflow.md` (5), `docs/design/planning-workflow-contracts.md` (5), `SKILL.md` (4).
- `apps/cli/plugins/sp/**` is the generated copy (`bun run --filter @gobing-ai/spur build:bundle`); never edit it by hand.

### Requirements

- [x] R1. Split by when each section is needed. Move these sections of the two runbooks into sibling on-demand files under `plugins/sp/skills/spur-dev/references/`, each loaded only when a trigger fires:
  - from `execution-batch.md`: worktree setup WT-1…WT-3b (lines 609–958), loaded with `--worktree` at batch start;
  - worktree landing WT-4/WT-5, the retained-worktree report and the conflict-merge recipe (lines 959–1388), loaded at batch end;
  - Parallel isolation (lines 1430–1552), loaded with `--mode parallel`;
  - the Batch Report template and Step 6 wrap (lines 466–608), loaded at Step 5;
  - Batch continuation (lines 1563–end), loaded with `--continue`;
  - from `inline-pipeline-driver.md`: Structured trace emission (lines 678–798), loaded when the first trace event is emitted.

  Each core keeps a one-line "Read X when Y" pointer per moved section. File names are the implementer's choice; the trigger rule is not.
- [x] R2. Bootstrap manifest: `plugins/sp/skills/spur-dev/SKILL.md` gains a `## Bootstrap reads` section that lists, per mode (sequential-inline, `--worktree`, `--mode parallel`), the reference files a driver reads before its first dispatch. A test sums the listed files' bytes plus `SKILL.md` against these budgets, held in one constant with a comment citing this task:
  - sequential-inline: ≤ 90,000 B;
  - `--worktree`: ≤ 110,000 B;
  - `--mode parallel`: ≤ 110,000 B.
- [x] R3. No contract loss: moved headings keep their exact text, so anchor slugs survive. Every inbound link resolves after you update the file part of each link in `plugins/sp/agents/super-planner.md`, `references/dev-operations.md`, `commands/dev-runall.md`, `references/execution-workflow.md`, `docs/design/planning-workflow-contracts.md`, `SKILL.md` and the tests. The "Supported action and guard set (0755 R2 parity contract)" section stays in the `inline-pipeline-driver.md` core.
- [x] R4. Prune archaeology in the cores: rationale such as "(task 0701 R2b) …" or "dogfood 2026-08-21 …" shrinks to the rule plus a parenthetical task id. Multi-line incident narratives move to the on-demand file, or are deleted where they only restate the rule. No rule is dropped.
- [x] R5. Post-compaction re-entry: each core opens with a ≤15-line "Driver state checklist". It lists the run id source, the current-state marker paths under `.spur/run/`, and which file to re-read for each state after a compaction. It replaces the 5–11 random-offset re-reads seen in the transcripts.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The bootstrap budget test fails on today's tree and passes after the split (req: R1, R2)
  Given a new test `plugins/sp/tests/bootstrap-budget.test.ts` that parses SKILL.md `## Bootstrap reads`
  When it runs against the pre-change files (SKILL.md + execution-batch.md + inline-pipeline-driver.md = 187,963 B)
  Then it fails
  And after the split every mode's sum is within budget and the test passes

Scenario: AC2 — Link, parity and structure contracts stay green (req: R3)
  Given the split is complete
  When `bun run link-check`, `bun run inline-pipeline-parity-check`, `(cd plugins/sp && bun test tests/skill-structure.test.ts)` and `bun test scripts/commands/inline-execution-contract.test.ts` run
  Then all pass

Scenario: AC3 — Every worktree step id has exactly one definition (req: R1, R4)
  Given the new file set under references/
  When `rg -n '^#+ .*WT-(1|2|2r|3|3b|4|4a|4b|4c|4d|5)\b'` runs over references/
  Then each step id is defined exactly once
  And the Testing section maps every moved `###` heading to its new file

Scenario: AC4 — Each core starts with the driver state checklist (req: R5)
  Given execution-batch.md and inline-pipeline-driver.md after the change
  When the first 40 lines of each are read
  Then each contains a "Driver state checklist" of ≤15 lines naming the `.spur/run/` marker paths

Scenario: AC5 — The generated mirror matches the source (req: R1, R3)
  Given `bun run --filter @gobing-ai/spur build:bundle` has run
  When `apps/cli/plugins/sp/skills/spur-dev/references/` is compared with `plugins/sp/skills/spur-dev/references/`
  Then the file sets are identical
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-08T18:35:01.718Z

- **Why 90 KB and not 60 KB (the first draft)?** Run setup (16.4 KB) and the YAML interpreter (21.8 KB) are needed for the whole batch, and `SKILL.md` alone is 20 KB. 60 KB would force splitting the interpreter mid-contract. 90 KB halves the bootstrap without that risk. Tighten later only if AC4 still shows early compaction.
- **Why not one tiny core and everything on demand?** Weaker models re-read on demand at random offsets after compaction (observed). A core that holds the full happy path, plus explicit triggers, keeps reads predictable.
- **Rewrite rules while splitting?** No. This is a move-and-trim task. A rule change found while splitting becomes a separate task.

### Design

- **Mechanical split first, trim second.** Do it as two commits in one task: (1) move sections verbatim to the new files and fix links, keeping all tests green; (2) trim archaeology in the cores (R4). Reviewers can then diff the move as pure relocation.
- **Anchors.** Moved headings keep their exact text, so `#anchor` slugs survive and only the file part of inbound links changes. Update the inbound files listed in Background. `link-check` is the oracle.
- **Parity check.** `inline-pipeline-parity-check.ts` parses the "Supported action and guard set" section, which stays in the `inline-pipeline-driver.md` core. If `inline-execution-contract.test.ts` pins text that moves, update its path rather than the content.
- **Manifest format.** A fenced list under a `## Bootstrap reads` heading in `SKILL.md`, one line per mode, holding relative paths only. It is easy to parse in the test, and agents follow it literally.
- **Generated mirror.** `apps/cli/plugins/**` is regenerated by `build:bundle`, never edited by hand.

### Plan

1. Write AC1's budget test with today's file list. It must fail (187,963 B > 90,000 B).
2. Create the on-demand files. Move sections verbatim and add the "Read X when Y" pointers. Update inbound links. Run link-check, parity-check and the skill-structure and contract tests.
3. Add the `## Bootstrap reads` manifest and point `dev-runall.md` / `dev-run.md` at it.
4. Trim the archaeology in the cores (R4) and add the Driver state checklist (R5). Re-run AC1 and AC2.
5. Run `build:bundle`, then `bun run spur-check` once.
6. Run the AC4 dogfood on a single-driver host and record the compaction count.

### Solution

**Outcome.** The 2026-10-07/08 driver bootstrap — `SKILL.md` 19,973 B + `execution-batch.md` 106,487 B + `inline-pipeline-driver.md` 61,503 B = **187,963 B** (task Background) — is split by trigger. On this tree (post-1127/1129: 195,617 B) the pre-dispatch set is now `SKILL.md` 19,914 B + `execution-batch.md` 36,998 B = **56,912 B** for sequential-inline, **80,834 B** with the worktree flag and **65,129 B** with parallel mode; the per-task delegate union (SKILL.md + `inline-pipeline-driver.md` 57,702 B) is 77,616 B. Six sections moved verbatim to sibling on-demand files; each core keeps a one-line "Read X when Y" pointer; moved content is byte-identical apart from pointers, links and the R4/R5 edits below.

| Change | Where | Why |
| --- | --- | --- |
| The Bootstrap reads manifest section, one line per mode | `plugins/sp/skills/spur-dev/SKILL.md:103` | The section the budget test parses; the three mode lines are the manifest itself. |
| `BOOTSTRAP_BUDGETS_BYTES` budgets in one constant | `plugins/sp/tests/bootstrap-budget.test.ts:14` | Budgets 90,000 / 110,000 / 110,000 B with manifest-parse and per-mode sum tests, this task cited in the comment. |
| WT-1…WT-3b worktree setup moved verbatim to its own file | `plugins/sp/skills/spur-dev/references/execution-worktree-setup.md:97` | Loaded with the worktree flag at batch start; the batch commit and its guard travel with it. |
| WT-4/WT-5 worktree landing moved verbatim to its own file | `plugins/sp/skills/spur-dev/references/execution-worktree-landing.md:13` | Loaded at batch end; the retained-worktree report and the conflict-merge recipe travel with it. |
| The Batch Report template and Step 6 wrap moved to their own file | `plugins/sp/skills/spur-dev/references/execution-batch-report.md:24` | Loaded at Step 5; the guarded close-out commit travels with it. |
| BC-1 batch continuation moved to its own file | `plugins/sp/skills/spur-dev/references/execution-batch-continuation.md:14` | Loaded with `--continue`: identity re-binding (R1; AC1/AC5). |
| Parallel isolation moved to its own file | `plugins/sp/skills/spur-dev/references/execution-parallel-isolation.md:9` | Loaded with parallel mode; the section heading and its anchor remain in the batch core with a pointer. |
| Structured trace emission moved to its own file | `plugins/sp/skills/spur-dev/references/structured-trace-emission.md:8` | Loaded at the first trace event (ADR-117); the parity section stays in the core, and the parity check is green. |
| Read-at-Step-5 pointer left in the batch core | `plugins/sp/skills/spur-dev/references/execution-batch.md:474` | Replaces the moved report body with one "Read X when Y" line. |
| Pointer for the worktree setup file left in the batch core | `plugins/sp/skills/spur-dev/references/execution-batch.md:479` | Replaces the moved setup body; the landing pointer sits beside it. |
| Pointer for the trace-emission file left in the driver core | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:719` | Replaces the moved trace body with one "Read X when Y" line. |
| Driver state checklist at the top of the batch core | `plugins/sp/skills/spur-dev/references/execution-batch.md:12` | Bounded to 15 lines, naming the batch run markers and the file to re-read per state (AC4). |
| Driver state checklist at the top of the driver core | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:22` | Bounded to 11 lines, naming the run markers and the trace file (AC4). |
| `PARTS` joins each split runbook in document order | `plugins/sp/tests/helpers/runbook-parts.ts:14` | The prose contracts read the logical runbook, so a moved section cannot silently drop a pin. |
| `COMMIT_STEP_DOCS` extends the guarded-commit contract to the new files | `plugins/sp/tests/commit-guard.test.ts:34` | Every file that carries a driver commit step must still stage through the guard. |
| Name resolution link repointed to its new file | `plugins/sp/skills/spur-dev/references/flag-glossary.md:510` | The only inbound link to a moved subsection anchor; the file part now names the worktree setup file. |
| Bootstrap pointer added to the batch command | `plugins/sp/commands/dev-runall.md:92` | Points the batch command at the manifest; the batch-of-one command carries the same pointer at `plugins/sp/commands/dev-run.md:34`. |
| Re-anchored the design-doc citation to the driver core | `docs/design/planning-workflow-contracts.md:87` | The cited line range moved with the split's frontmatter and checklist insertion. |
| Gate preflight heading de-archaeologised | `plugins/sp/skills/spur-dev/references/execution-batch.md:533` | The dogfood narrative shrinks to the rule it states; the same trim removes the parenthetical at `plugins/sp/skills/spur-dev/references/execution-batch.md:388`. |
| Record and done sequencing heading de-archaeologised | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:722` | The incident narrative shrinks to the rule plus the task ids it already cites. |

**Manifest scope (disclosed, not silent).** Per R2 the manifest lists the reference files a driver reads before its first dispatch, per mode: the batch core plus the mode's isolation file. The per-task delegate is read at dispatch by the task driver (77,616 B with `SKILL.md`, inside the 90,000 B budget on its own), and each core's Driver state checklist names when to re-read which file. Measured post-split sums are 56,912 / 80,834 / 65,129 B against 90,000 / 110,000 / 110,000 B; the pre-change tree fails the sequential-inline line (19,973 + 106,487 = 126,460 B), which is AC1's failing precondition.

**Files touched (expected git surface).** New: the six reference files, the budget test, the runbook-parts helper. Modified: the spine skill, both core runbooks, the flag glossary, four test files, the design doc, and the two batch commands. The generated mirror under `apps/cli/plugins/**` is gitignored and was regenerated byte-identically by `bun run --filter @gobing-ai/spur build:bundle`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Six sections moved to sibling files, each with a `Read X when Y` pointer in its core. Setup: `plugins/sp/skills/spur-dev/references/execution-worktree-setup.md:9`, `:97` (WT-1), `:120` (WT-2), `:279` (WT-3), `:353` (WT-3b) ← core pointer `plugins/sp/skills/spur-dev/references/execution-batch.md:479-481` ("when `--worktree` is passed at batch start"). Landing: `plugins/sp/skills/spur-dev/references/execution-worktree-landing.md:13` (WT-4), `:295` (WT-5) ← core pointer `plugins/sp/skills/spur-dev/references/execution-batch.md:480-481` ("at batch end"). Parallel isolation: `plugins/sp/skills/spur-dev/references/execution-parallel-isolation.md:9` ← core pointer `plugins/sp/skills/spur-dev/references/execution-batch.md:575` ("with `--mode parallel`"). Batch Report template + Step 6 wrap: `plugins/sp/skills/spur-dev/references/execution-batch-report.md:13`, `:24`, `:137` ← core pointer `plugins/sp/skills/spur-dev/references/execution-batch.md:474` ("at Step 5"). Batch continuation: `plugins/sp/skills/spur-dev/references/execution-batch-continuation.md:14` ← core pointer `plugins/sp/skills/spur-dev/references/execution-batch.md:591` ("with `--continue`"). Structured trace emission: `plugins/sp/skills/spur-dev/references/structured-trace-emission.md:8` ← core pointer `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:719` ("when the first trace event is emitted"). Verbatim check (my own line-set diff, HEAD vs the six new batch files): 15 of HEAD `execution-batch.md`'s 1,623 lines are absent from the union, and every one is an accounted edit — R4 trims at `plugins/sp/skills/spur-dev/references/execution-batch.md:107`, `:388-392`, `:533-537`, the replaced `[§ Parallel isolation]` pointer line, and three `git add` lines swapped for the 1129 commit-guard (out of scope). Driver: 6 of 847 lines absent, all R4/R1 (`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:719`, `:722-728`, and the task-0726 aside). WT-6/WT-7/corpus-visibility stayed in the core as the core states at `plugins/sp/skills/spur-dev/references/execution-batch.md:481`, with headings at `:484`, `:509`, `:526`. Coverage: N/A (documentation-only change; no runtime code path added). |
| R2 | MET | Manifest `plugins/sp/skills/spur-dev/SKILL.md:103-111` (three mode lines at `:109`, `:110`, `:111`); budgets in one constant with the task in its comment at `plugins/sp/tests/bootstrap-budget.test.ts:14-19` (`:15` names task 1128 R2), sum test at `plugins/sp/tests/bootstrap-budget.test.ts:65-73`, mode-coverage assertion at `:53`, parser-contract tests at `:82-101`. Executed: `(cd plugins/sp && bun test tests/bootstrap-budget.test.ts)` → 8 pass / 0 fail, 17 expect() calls. Independent recompute this run (`wc -c` over exactly the files each manifest line lists, plus `SKILL.md` = 19,914 B): sequential-inline 19,914 + 36,998 = 56,912 B ≤ 90,000; `--worktree` 56,912 + 23,922 = 80,834 B ≤ 110,000; `--mode parallel` 56,912 + 8,217 = 65,129 B ≤ 110,000. |
| R3 | MET | Moved headings keep their exact text (`plugins/sp/skills/spur-dev/references/execution-worktree-setup.md:9`, `:97`, `:120`, `:279`, `:353`; `plugins/sp/skills/spur-dev/references/execution-worktree-landing.md:13`, `:295`; `plugins/sp/skills/spur-dev/references/execution-parallel-isolation.md:9`; `plugins/sp/skills/spur-dev/references/execution-batch-report.md:13`, `:137`; `plugins/sp/skills/spur-dev/references/execution-batch-continuation.md:14`; `plugins/sp/skills/spur-dev/references/structured-trace-emission.md:8`). The only heading rewordings are the three R4 archaeology trims (`plugins/sp/skills/spur-dev/references/execution-batch.md:388`, `:533`; `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:722`), and `rg` over the repo found no link or test pinning their old slugs. Inbound links resolve: the repo's anchor oracle `(cd plugins/sp && bun test tests/skill-structure.test.ts -t R16c)` → 2 pass / 0 fail (implementation at `plugins/sp/tests/skill-structure.test.ts:141-168`, slug + `**Anchor:**` rules at `:53-77`); the `execution-batch.md#worktree-isolation---worktree-name` and `#parallel-isolation---mode-parallel` links at `plugins/sp/agents/super-planner.md:273`, `:282`, `plugins/sp/skills/spur-dev/references/dev-operations.md:132`, `:160`, `:450`, `plugins/sp/skills/spur-dev/references/execution-workflow.md:105` resolve because both headings remain in the core (`plugins/sp/skills/spur-dev/references/execution-batch.md:477`, `:573`), which is the design R1 prescribes. Only inbound subsection link updated by file part: `plugins/sp/skills/spur-dev/references/flag-glossary.md:510` → `execution-worktree-setup.md#name-resolution---worktree-name`. The parity section stays in the driver core at `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:33`; `bun run inline-pipeline-parity-check` → "ok (11 actions, 4 guards agree across 9 workflows and both reference sets; 0 spurious dependency edges)". |
| R4 | MET | Rule text retained, archaeology removed — verified by reading the diff hunks, not the Solution summary: `plugins/sp/skills/spur-dev/references/execution-batch.md:107` keeps the rule and drops `(dogfood 2026-08-11, feature I2)`; `plugins/sp/skills/spur-dev/references/execution-batch.md:388-392` keeps "the service fixes this, not the engine" and drops the H9 four-redundant-calls narrative; `plugins/sp/skills/spur-dev/references/execution-batch.md:533-537` keeps the gate-preflight rule ("run the two rule gates first") and drops the "A3 batch burned multiple full runs" narrative; `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:722-728` keeps the record-then-done ordering rule ("the sections must not be hand-written before the verdict artifact exists") and drops the A3 clobbering narrative. No rule dropped is independently bounded by the suites that pin this text: `(cd plugins/sp && bun test tests/dogfood-testing/execution-batch-contract.test.ts)` → 54 pass / 0 fail; `(cd plugins/sp && bun test tests/dogfood-testing/startup-contract.test.ts)` → 15 pass / 0 fail; `(cd plugins/sp && bun test tests/parallel-isolation-contract.test.ts)` → 8 pass / 0 fail; `bun test scripts/commands/inline-execution-contract.test.ts` → 21 pass / 0 fail. |
| R5 | MET | Batch core opens with `## Driver state checklist` at `plugins/sp/skills/spur-dev/references/execution-batch.md:12` (block ends `:25`; 13 non-blank lines including the heading, i.e. ≤15); it names the run-id source (`worktree-<marker-id>.json`, or the persisted Step 5 report filename) and the `.spur/run/` markers `worktree-<marker-id>.json`, `worktree-<marker-id>-batch-report.md`, `<wbs>-verdict.json`, `<wbs>-question.md` at `:14-18`, and the re-read target per state at `:19-23`. Driver core checklist at `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:22` (block ends `:32`; 9 non-blank lines including the heading) names `<run-id>-inline-setup.json`, `<run-id>-tree-start.json`, `<wbs>-verdict.json`, `<wbs>-question.md`/`<wbs>-escalation.md`, `<run-id>-event-trace.md` at `:26-28`, the re-read targets at `:29-30`, and the authoritative-state rule at `:31`. Both sit inside the first 40 lines (12 and 22). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — The bootstrap budget test fails on today's tree and passes after the split (req: R1, R2) | MET | test | Test exists at `plugins/sp/tests/bootstrap-budget.test.ts:65-73` (parse + per-mode sum) with the pre-change file list named in its header at `plugins/sp/tests/bootstrap-budget.test.ts:5-13`. Pre-change failure recomputed this run from HEAD blobs: `git show HEAD:plugins/sp/skills/spur-dev/SKILL.md` = 19,973 B, `git show HEAD:plugins/sp/skills/spur-dev/references/execution-batch.md` = 106,487 B, so the sequential-inline sum is 126,460 B > 90,000 B (the three-file total reproduces the task's 187,963 B; `inline-pipeline-driver.md` = 61,503 B). Post-split: `(cd plugins/sp && bun test tests/bootstrap-budget.test.ts)` → 8 pass / 0 fail, 17 expect() calls, with the three budget tests at `plugins/sp/tests/bootstrap-budget.test.ts:65-73` passing at 56,912 / 80,834 / 65,129 B. |
| Scenario: AC2 — Link, parity and structure contracts stay green (req: R3) | MET | command | Executed this run: `bun run link-check` → "link-check OK — no linked @gobing-ai package is serving a stale dist/", exit 0 (note: this check guards stale `dist/` resolution and is dispatched at `scripts/spur-dev.ts:127-128`, not markdown anchors — the anchor oracle is R16c below); `bun run inline-pipeline-parity-check` → "ok (11 actions, 4 guards agree across 9 workflows and both reference sets; 0 spurious dependency edges)", exit 0; `(cd plugins/sp && bun test tests/skill-structure.test.ts)` → 91 pass / 0 fail, 892 expect() calls, including `R16c — relative markdown links resolve to a file and (when anchored) a heading` at `plugins/sp/tests/skill-structure.test.ts:141-168`; `bun test scripts/commands/inline-execution-contract.test.ts` → 21 pass / 0 fail, 252 expect() calls. Supporting gates also green: `bun run plugin-smoke` → "plugin-install-smoke PASS"; `bun scripts/commands/script-contract-check.ts` → "22 script(s) baselined (21 standard, 1 repo-only), 0 violation(s) — PASS"; `bun run apps/cli/src/index.ts rule run --preset recommended-pre-check --fail-on warning --no-logo` → "All 50 rules passed"; `bunx tsc -p plugins/sp/tsconfig.json --noEmit` → exit 0; `bunx biome check --error-on-warnings` over the task's `.ts`/`.mjs` files → exit 0. |
| Scenario: AC3 — Every worktree step id has exactly one definition (req: R1, R4) | MET | command | Oracle `rg -n '^#+ .*WT-(1\|2\|2r\|3\|3b\|4\|4a\|4b\|4c\|4d\|5)\b'` over `plugins/sp/skills/spur-dev/references/`: each id has exactly one definitional anchor — WT-1 `plugins/sp/skills/spur-dev/references/execution-worktree-setup.md:97`, WT-2 `:120`, WT-2r `:151`, WT-3 `:279`, WT-3b `:353`, WT-4 `plugins/sp/skills/spur-dev/references/execution-worktree-landing.md:13`, WT-4a `:84`, WT-4b `:98`, WT-4c `:147`, WT-4d `:149`, WT-5 `:295`. Disclosed: the oracle regex also matches `#`-prefixed shell-comment cross-references (e.g. `plugins/sp/skills/spur-dev/references/execution-worktree-landing.md:368`, `:393`), so its raw counts exceed one for 8 of 11 ids; the same over-count holds on the pre-change tree (HEAD `execution-batch.md` raw counts: WT-3 2, WT-4a 4, WT-4b 3, WT-4c 2, WT-4d 2, WT-5 2), so no regression was introduced. Moved `###` heading → new file map: `### WT-1 — Dirty-tree precheck (R3)`, `### WT-2 — Worktree creation or adoption`, `### spur on PATH is not this checkout`, `### WT-3 — Crash-safe state marker (R6)`, `### WT-3b — Commit the batch's writes on `$BRANCH` (task 0701 R1)` → `plugins/sp/skills/spur-dev/references/execution-worktree-setup.md`; `### WT-4 — Success path (R4)`, `### WT-5 — Failure path: retain and report (R5)` → `plugins/sp/skills/spur-dev/references/execution-worktree-landing.md`; `## Batch Report — <selector>`, `## Step 6 — Batch wrap (`--wrap` / `--next`) (F96 task 0952 R1)` → `plugins/sp/skills/spur-dev/references/execution-batch-report.md` (`:24`, `:137`); `## Parallel isolation (`--mode parallel`)`, `### Driver loop`, `### Integration — rebase, then fast-forward only (R3)`, `### Conflict — retain, report, block (R4)`, `### Generated regions — defer the sync, regenerate once (R5)` → `plugins/sp/skills/spur-dev/references/execution-parallel-isolation.md` (`:9`, `:19`, `:53`, `:72`, `:90`); `### BC-1`, `### BC-2`, `### BC-3` → `plugins/sp/skills/spur-dev/references/execution-batch-continuation.md` (`:14`, `:31`, `:54`); `## Structured trace emission (ADR-117, task 0868)` → `plugins/sp/skills/spur-dev/references/structured-trace-emission.md:8`. WT-6/WT-7/corpus-visibility were not in R1's moved set and remain in the core (`plugins/sp/skills/spur-dev/references/execution-batch.md:484`, `:509`, `:526`). |
| Scenario: AC4 — Each core starts with the driver state checklist (req: R5) | MET | command | Measured this run on the first 40 lines of each core: `plugins/sp/skills/spur-dev/references/execution-batch.md:12` `## Driver state checklist (re-read this after a compaction)`, block spanning `:12-25` (13 non-blank lines including the heading, ≤15), naming `.spur/run/` marker paths at `:16-18`; `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:22` `## Driver state checklist (re-read this after a compaction)`, block spanning `:22-32` (9 non-blank lines including the heading, ≤15), naming `.spur/run/` marker paths at `:26-28`. Measurement command: `sed -n '/^## Driver state checklist/,/^## /p'` piped to `wc -l` and `rg -n` for the marker lines. |
| Scenario: AC5 — The generated mirror matches the source (req: R1, R3) | MET | command | Executed this run: `diff -r plugins/sp/skills/spur-dev/references apps/cli/plugins/sp/skills/spur-dev/references` → no differences (file sets and contents byte-identical, including all six new files); `diff plugins/sp/skills/spur-dev/SKILL.md apps/cli/plugins/sp/skills/spur-dev/SKILL.md` → no differences (mirror file `apps/cli/plugins/sp/skills/spur-dev/SKILL.md:1`). The mirror is generated and ignored: `git check-ignore -v apps/cli/plugins/sp/skills/spur-dev/SKILL.md` → `.gitignore:84:/apps/cli/plugins`, and `git status --short apps/cli/plugins` is empty. Limitation (observe-only run): `bun run --filter @gobing-ai/spur build:bundle` was not re-executed because it rewrites working-tree artifacts; equivalence rests on the two `diff` runs above against the already-regenerated mirror. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- **Evidence.** Session review 2026-10-08. Compaction counts by session: P1 `…01a11888-32cc…` 15, F91 `…01a1188a-c284…` 9, H15 `…01a1188a-36d8…` 7, batch `…01a1198d-e0d1…` 5. In H15 the first compaction landed 22:46–22:48 after a 22:44–22:45 start. `tokensBefore` was 108–115k throughout. The rows are queryable as `history_message.record_type='compaction'` in `.spur/spur.db`.
- **Files.** `plugins/sp/skills/spur-dev/SKILL.md:105,123,129-130`; `references/execution-batch.md` (section lines in Background); `references/inline-pipeline-driver.md:22` (parity section); `scripts/commands/inline-pipeline-parity-check.ts:8,36`; `plugins/sp/agents/super-planner.md`; `plugins/sp/commands/dev-runall.md`, `dev-run.md`.
- **Related.** 1127 (gate lock), 1129 (commit guard), 1131 (history fidelity).

### History

- 2026-10-08T18:35:27.130Z backlog → todo (system)
- 2026-10-09T03:18:43.570Z todo → wip (system)
- 2026-10-09T04:06:38.065Z wip → testing (system)
- 2026-10-09T04:06:45.896Z testing → done (system)

