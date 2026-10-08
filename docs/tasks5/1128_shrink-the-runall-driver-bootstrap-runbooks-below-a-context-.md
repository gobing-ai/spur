---
schema_version: 1
name: Shrink the runall driver bootstrap runbooks below a context budget
status: todo
template: feature-impl
created_at: 2026-10-08T18:13:58.693Z
updated_at: "2026-10-08T18:35:27.130Z"
feature_id: H1

ac_numbering: task-local
ac_altitude: task-local
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

- [ ] R1. Split by when each section is needed. Move these sections of the two runbooks into sibling on-demand files under `plugins/sp/skills/spur-dev/references/`, each loaded only when a trigger fires:
  - from `execution-batch.md`: worktree setup WT-1…WT-3b (lines 609–958), loaded with `--worktree` at batch start;
  - worktree landing WT-4/WT-5, the retained-worktree report and the conflict-merge recipe (lines 959–1388), loaded at batch end;
  - Parallel isolation (lines 1430–1552), loaded with `--mode parallel`;
  - the Batch Report template and Step 6 wrap (lines 466–608), loaded at Step 5;
  - Batch continuation (lines 1563–end), loaded with `--continue`;
  - from `inline-pipeline-driver.md`: Structured trace emission (lines 678–798), loaded when the first trace event is emitted.

  Each core keeps a one-line "Read X when Y" pointer per moved section. File names are the implementer's choice; the trigger rule is not.
- [ ] R2. Bootstrap manifest: `plugins/sp/skills/spur-dev/SKILL.md` gains a `## Bootstrap reads` section that lists, per mode (sequential-inline, `--worktree`, `--mode parallel`), the reference files a driver reads before its first dispatch. A test sums the listed files' bytes plus `SKILL.md` against these budgets, held in one constant with a comment citing this task:
  - sequential-inline: ≤ 90,000 B;
  - `--worktree`: ≤ 110,000 B;
  - `--mode parallel`: ≤ 110,000 B.
- [ ] R3. No contract loss: moved headings keep their exact text, so anchor slugs survive. Every inbound link resolves after you update the file part of each link in `plugins/sp/agents/super-planner.md`, `references/dev-operations.md`, `commands/dev-runall.md`, `references/execution-workflow.md`, `docs/design/planning-workflow-contracts.md`, `SKILL.md` and the tests. The "Supported action and guard set (0755 R2 parity contract)" section stays in the `inline-pipeline-driver.md` core.
- [ ] R4. Prune archaeology in the cores: rationale such as "(task 0701 R2b) …" or "dogfood 2026-08-21 …" shrinks to the rule plus a parenthetical task id. Multi-line incident narratives move to the on-demand file, or are deleted where they only restate the rule. No rule is dropped.
- [ ] R5. Post-compaction re-entry: each core opens with a ≤15-line "Driver state checklist". It lists the run id source, the current-state marker paths under `.spur/run/`, and which file to re-read for each state after a compaction. It replaces the 5–11 random-offset re-reads seen in the transcripts.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- **Evidence.** Session review 2026-10-08. Compaction counts by session: P1 `…01a11888-32cc…` 15, F91 `…01a1188a-c284…` 9, H15 `…01a1188a-36d8…` 7, batch `…01a1198d-e0d1…` 5. In H15 the first compaction landed 22:46–22:48 after a 22:44–22:45 start. `tokensBefore` was 108–115k throughout. The rows are queryable as `history_message.record_type='compaction'` in `.spur/spur.db`.
- **Files.** `plugins/sp/skills/spur-dev/SKILL.md:105,123,129-130`; `references/execution-batch.md` (section lines in Background); `references/inline-pipeline-driver.md:22` (parity section); `scripts/commands/inline-pipeline-parity-check.ts:8,36`; `plugins/sp/agents/super-planner.md`; `plugins/sp/commands/dev-runall.md`, `dev-run.md`.
- **Related.** 1127 (gate lock), 1129 (commit guard), 1131 (history fidelity).

### History

- 2026-10-08T18:35:27.130Z backlog → todo (system)

