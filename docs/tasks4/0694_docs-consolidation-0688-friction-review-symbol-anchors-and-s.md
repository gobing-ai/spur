---
schema_version: 1
name: "Docs consolidation — 0688 friction review: symbol anchors and sweep-once discipline"
status: done
template: feature-impl
created_at: 2026-08-27T20:16:10.953Z
updated_at: "2026-08-28T03:14:26.259Z"
feature_id: F94
priority: P3
dependencies: ["0691"]
---

## 0694. Docs consolidation — 0688 friction review: symbol anchors and sweep-once discipline

### Background

Two documentation riders from the 0688 friction review (2026-08-27), consolidated into one docs pass landing in `docs/04_DESIGN.md` + the verification-gate docs:

- **Symbol-anchor convention:** prefer `path:symbol` over `path:line` — line anchors rot (0606 precedent: `eval-pipeline.ts:528` drifted to `:562`; PROMOTION_BAR_PROPOSAL move).
- **Sweep-once discipline:** iterate with single-task `spur task check <wbs>`; run the `task check --corpus` sweep once, at commit-prep — 17 sweeps × ~60s ≈ 17 min burned in the 0688 session.

Sequencing: the gate docs depend on the corpus gate & baseline simplification ADR outcome (dependency wired to that task), so this task starts after it.

### Requirements

- [x] R1. **Symbol-anchor citation convention** — document in the authoring guidance that owns
      citation forms: prefer `path:symbol` over `path:line` for new task citations and test
      evidence; state when a line anchor is still acceptable; include a dated corpus note
      recording the 0688-review decision.
- [x] R2. **Sweep-once discipline** — codify in the verification-gate docs: single-task check
      drives the iterate loop; one `--corpus` sweep before commit.
- [x] R3. **One pass** — land both in `docs/04_DESIGN.md` + the verification-gate docs in a
      single pass.

### Acceptance Criteria

```gherkin
Scenario: R5 — New citations prefer symbols over line numbers
  Given the symbol-anchor convention documented in `docs/04_DESIGN.md` §4 with its dated corpus note
  When a new author looks up the citation form
  Then the preferred `path:symbol` form, the reason, and the line-anchor exception are found
  And the dated decision note links back to this feature

Scenario: R6 — The corpus sweep runs once per commit
  Given the sweep-once discipline codified in the verification-gate docs (`docs/99_PROJECT_CONSTITUTION.md` + the derived `AGENTS.md` line)
  When an agent iterates on a task
  Then the docs state that single-task check drives the iterate loop and `spur task check --corpus` runs once before commit
  And both conventions land in one pass across `docs/04_DESIGN.md` + the verification-gate docs
```

### Q&A

- **Where are "the verification-gate docs"?** `AGENTS.md` §Verification gate (:315–360) — there is no
  `docs/*verification*` file (verified 2026-08-27). Because `AGENTS.md` is derived and `99` owns
  process, the rule is authored in `docs/99_PROJECT_CONSTITUTION.md` and `AGENTS.md` carries the
  derived line.
- **Is the sweep-once rule already documented?** Half of it. `AGENTS.md:321` already says to run the
  sweep before a corpus-touching commit. The missing half — "single-task check drives the iterate
  loop" — is the actual increment. R2 is a completion, not a net-new rule; scoped accordingly.
- **Where does the symbol-anchor convention live in `docs/04_DESIGN.md`?** A new subsection under
  §4 Output Conventions (:1480). No anchor/citation guidance exists there today; §0–§3 are surface
  specs and are the wrong host.
- **Is 0694 fully blocked on 0691?** No. Only the R2 gate-doc half. The R1 symbol-anchor half is
  independent and may land first — recorded so the dependency is not read as a total block.
- **Do we rewrite existing `path:line` citations?** No. The convention governs new citations only; a
  mass rewrite would mint the churn F94 exists to remove.
- **Deferred:** whether the convention ever gets enforced by a checker. Deferred to 0692's drift
  report outcome, on condition no new baselined finding class is minted while 0691 is undecided
  (owner: 0692's implementer).

### Design

**WHAT.** One docs pass landing two conventions from the 0688 friction review: the symbol-anchor
citation convention (R1) and the sweep-once discipline (R2).

**WHY.** Line anchors rot — 0606's `eval-pipeline.ts:528` drifted to `:562` after an unrelated
+34-line edit, and the drift was caught post-commit by a human. The corpus sweep costs ~60 s; the
0688 session ran 17 of them (~17 min) because nothing said "iterate with the single-task check".

**WHERE (verified against the tree, 2026-08-27).**

| R | Target | Current state |
| --- | --- | --- |
| R1 | `docs/04_DESIGN.md` — a new subsection under **§4 Output Conventions** (:1480) | No citation/anchor guidance exists anywhere in `docs/` or `AGENTS.md`; §4 already owns "how we write things down", so it is the host. §0–§3 are CLI/config/data-shape surfaces and are the wrong home |
| R1 note | `config/corpus-baseline.json` `note` field | The file's `note` is already the per-code diagnosis record — the established place for a dated decision note |
| R2 authority | `docs/99_PROJECT_CONSTITUTION.md` (process SSOT) | Owns process; the discipline is a process rule, so it lands here **first** |
| R2 derived | `AGENTS.md` §Verification gate (:315–360) | Already says "Run the sweep before a commit that touches the task/feature corpus" (:321) — the *sweep-once half is partly present*; the missing half is "single-task check drives the iterate loop". Mirror the shape of the existing "Targeted-test-first while iterating" note (:357) |

**"The verification-gate docs" resolves to `AGENTS.md`, not a `docs/` file** — there is no
`docs/*verification*` document. Per the constitution's conflict rule (lower number wins on content;
`99` owns process), the rule text is authored in `docs/99_PROJECT_CONSTITUTION.md` and `AGENTS.md`
carries the derived operational line. Do not write the rule only into `AGENTS.md`.

**Frozen content decisions.**

- Preferred citation form: `` `path:symbol` `` (e.g. `anchor-qualifier.ts:resolveRepoRoot`).
- Line anchors stay acceptable for: a specific line in a non-code file, a diff hunk under review, a
  quoted log line, or code with no enclosing named symbol. State the exception explicitly — a
  convention with no stated exception gets ignored wholesale.
- Sweep-once wording: single-task `spur task check <wbs>` drives the iterate loop; `spur task check
  --corpus` (`bun run corpus-check`) runs **once**, at commit-prep.

**Anti-patterns (do NOT implement).**

- Do **not** add a gate, lint rule, or finding code enforcing `path:symbol` — this task is
  documentation only. Enforcement, if ever, is 0692's drift *report* (R1), not a new checker.
- Do **not** rewrite existing `path:line` citations across the corpus. The convention governs **new**
  citations; a mass rewrite would mint exactly the churn F94 is closing.
- Do **not** duplicate the rule text in both `99` and `AGENTS.md`; authority states it, `AGENTS.md`
  points at it.

**Cross-task — dependency on 0691 is partial, and one hazard.** `dependencies: [0691]`. Only the
**R2 gate-doc half** is genuinely blocked: it must describe the gate as 0691's ADR decides it. The
**R1 symbol-anchor half is independent** and can land first. **Hazard:** R1's dated corpus note
targets `config/corpus-baseline.json`'s `note` field — 0691's option D would delete that file
entirely. If the approved option retires the baseline, relocate the dated note into the ADR entry or
`docs/04_DESIGN.md` §4 instead; do not author a note into a file 0691 is removing.

### Plan
- [x] 1. Confirm 0691's approved option before touching gate wording; if still unapproved, land the
      R1 half only and hold R2. → R2 sequencing.
- [x] 2. Add a citation-convention subsection under `docs/04_DESIGN.md` §4 Output Conventions:
      preferred `path:symbol` form, the rot rationale (0606 `:528` → `:562`), and the explicit
      line-anchor exception list. → R1, AC1.
- [x] 3. Add the dated decision note recording the 0688-review decision — into
      `config/corpus-baseline.json`'s `note` field, or into the 0691 ADR entry if that option
      retires the baseline (see Design hazard). → R1, AC1.
- [x] 4. Author the sweep-once rule in `docs/99_PROJECT_CONSTITUTION.md` (process authority):
      single-task check iterates; `--corpus` runs once at commit-prep. → R2, AC2.
- [x] 5. Update `AGENTS.md` §Verification gate (:315–360) with the derived operational line, mirroring
      the "Targeted-test-first while iterating" shape (:357); do not restate the full rule. → R2, AC2.
- [x] 6. Land steps 2–5 in one commit. → R3, AC3.
- [x] 7. Verify: a reader starting from `docs/04_DESIGN.md` §4 reaches the form, the reason, the
      exception, and the dated note; `AGENTS.md` reaches the constitution rule. Run
      `spur task check --corpus` once before the commit. → AC1, AC2, AC3.
### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/agent.ts:121` |
| `apps/cli/src/commands/agent.ts:141` |
| `apps/cli/src/commands/agent.ts:183` |
| `apps/cli/src/commands/agent.ts:20` |
| `apps/cli/src/commands/agent.ts:252` |
| `apps/cli/src/commands/agent.ts:260` |
| `apps/cli/src/commands/agent.ts:328` |
| `apps/cli/src/commands/agent.ts:334` |
| `apps/cli/src/commands/agent.ts:34` |
| `apps/cli/src/commands/agent.ts:424` |
| `apps/cli/src/commands/agent.ts:46` |
| `apps/cli/src/commands/agent.ts:714` |
| `apps/cli/src/commands/agent.ts:77` |
| `apps/cli/src/commands/agent.ts:795` |
| `apps/cli/src/commands/agent.ts:810` |
| `apps/cli/src/commands/agent.ts:816` |
| `apps/cli/src/commands/agent.ts:832` |
| `apps/cli/src/commands/agent.ts:839` |
| `apps/cli/src/commands/builder.ts:100` |
| `apps/cli/src/commands/builder.ts:28` |
| `apps/cli/src/commands/builder.ts:3` |
| `apps/cli/src/commands/builder.ts:39` |
| `apps/cli/src/commands/builder.ts:48` |
| `apps/cli/src/commands/builder.ts:80` |
| `apps/cli/src/commands/builder.ts:91` |
| `apps/cli/src/commands/feature.ts:11` |
| `apps/cli/src/commands/feature.ts:146` |
| `apps/cli/src/commands/feature.ts:149` |
| `apps/cli/src/commands/feature.ts:162` |
| `apps/cli/src/commands/feature.ts:182` |
| `apps/cli/src/commands/feature.ts:216` |
| `apps/cli/src/commands/feature.ts:224` |
| `apps/cli/src/commands/feature.ts:237` |
| `apps/cli/src/commands/feature.ts:250` |
| `apps/cli/src/commands/feature.ts:259` |
| `apps/cli/src/commands/feature.ts:273` |
| `apps/cli/src/commands/feature.ts:279` |
| `apps/cli/src/commands/feature.ts:28` |
| `apps/cli/src/commands/feature.ts:292` |
| `apps/cli/src/commands/feature.ts:321` |
| `apps/cli/src/commands/feature.ts:339` |
| `apps/cli/src/commands/feature.ts:34` |
| `apps/cli/src/commands/feature.ts:350` |
| `apps/cli/src/commands/feature.ts:365` |
| `apps/cli/src/commands/feature.ts:39` |
| `apps/cli/src/commands/feature.ts:418` |
| `apps/cli/src/commands/feature.ts:422` |
| `apps/cli/src/commands/feature.ts:450` |
| `apps/cli/src/commands/feature.ts:466` |
| `apps/cli/src/commands/feature.ts:490` |
| `apps/cli/src/commands/feature.ts:505` |
| `apps/cli/src/commands/feature.ts:54` |
| `apps/cli/src/commands/feature.ts:66` |
| `apps/cli/src/commands/feature.ts:71` |
| `apps/cli/src/commands/feature.ts:96` |
| `apps/cli/src/commands/history.ts:123` |
| `apps/cli/src/commands/history.ts:154` |
| `apps/cli/src/commands/history.ts:16` |
| `apps/cli/src/commands/history.ts:172` |
| `apps/cli/src/commands/history.ts:192` |
| `apps/cli/src/commands/history.ts:209` |
| `apps/cli/src/commands/history.ts:229` |
| `apps/cli/src/commands/history.ts:248` |
| `apps/cli/src/commands/history.ts:274` |
| `apps/cli/src/commands/history.ts:281` |
| `apps/cli/src/commands/history.ts:387` |
| `apps/cli/src/commands/history.ts:404` |
| `apps/cli/src/commands/history.ts:65` |
| `apps/cli/src/commands/history.ts:73` |
| `apps/cli/src/commands/history.ts:96` |
| `apps/cli/src/commands/init.ts:17` |
| `apps/cli/src/commands/init.ts:195` |
| `apps/cli/src/commands/init.ts:283` |
| `apps/cli/src/commands/init.ts:427` |
| `apps/cli/src/commands/message.ts:105` |
| `apps/cli/src/commands/message.ts:117` |
| `apps/cli/src/commands/message.ts:129` |
| `apps/cli/src/commands/message.ts:15` |
| `apps/cli/src/commands/message.ts:172` |
| `apps/cli/src/commands/message.ts:179` |
| `apps/cli/src/commands/message.ts:199` |
| `apps/cli/src/commands/message.ts:235` |
| `apps/cli/src/commands/message.ts:319` |
| `apps/cli/src/commands/message.ts:337` |
| `apps/cli/src/commands/message.ts:341` |
| `apps/cli/src/commands/message.ts:358` |
| `apps/cli/src/commands/message.ts:368` |
| `apps/cli/src/commands/message.ts:384` |
| `apps/cli/src/commands/message.ts:41` |
| `apps/cli/src/commands/message.ts:434` |
| `apps/cli/src/commands/message.ts:50` |
| `apps/cli/src/commands/message.ts:514` |
| `apps/cli/src/commands/message.ts:521` |
| `apps/cli/src/commands/message.ts:73` |
| `apps/cli/src/commands/migrate.ts:18` |
| `apps/cli/src/commands/migrate.ts:24` |
| `apps/cli/src/commands/migrate.ts:5` |
| `apps/cli/src/commands/projects.ts:108` |
| `apps/cli/src/commands/projects.ts:123` |
| `apps/cli/src/commands/projects.ts:141` |
| `apps/cli/src/commands/projects.ts:151` |
| `apps/cli/src/commands/projects.ts:163` |
| `apps/cli/src/commands/projects.ts:174` |
| `apps/cli/src/commands/projects.ts:191` |
| `apps/cli/src/commands/projects.ts:20` |
| `apps/cli/src/commands/projects.ts:236` |
| `apps/cli/src/commands/projects.ts:245` |
| `apps/cli/src/commands/projects.ts:33` |
| `apps/cli/src/commands/projects.ts:42` |
| `apps/cli/src/commands/projects.ts:59` |
| `apps/cli/src/commands/projects.ts:6` |
| `apps/cli/src/commands/projects.ts:69` |
| `apps/cli/src/commands/projects.ts:78` |
| `apps/cli/src/commands/projects.ts:94` |
| `apps/cli/src/commands/rule.ts:101` |
| `apps/cli/src/commands/rule.ts:116` |
| `apps/cli/src/commands/rule.ts:139` |
| `apps/cli/src/commands/rule.ts:14` |
| `apps/cli/src/commands/rule.ts:151` |
| `apps/cli/src/commands/rule.ts:159` |
| `apps/cli/src/commands/rule.ts:32` |
| `apps/cli/src/commands/rule.ts:74` |
| `apps/cli/src/commands/rule.ts:94` |
| `apps/cli/src/commands/serve.ts:24` |
| `apps/cli/src/commands/serve.ts:38` |
| `apps/cli/src/commands/serve.ts:6` |
| `apps/cli/src/commands/serve.ts:61` |
| `apps/cli/src/commands/shared-options.ts:31` |
| `apps/cli/src/commands/status.ts:15` |
| `apps/cli/src/commands/status.ts:22` |
| `apps/cli/src/commands/status.ts:31` |
| `apps/cli/src/commands/status.ts:52` |
| `apps/cli/src/commands/status.ts:6` |
| `apps/cli/src/commands/task.ts:1054` |
| `apps/cli/src/commands/task.ts:1061` |
| `apps/cli/src/commands/task.ts:1074` |
| `apps/cli/src/commands/task.ts:1094` |
| `apps/cli/src/commands/task.ts:1125` |
| `apps/cli/src/commands/task.ts:1186` |
| `apps/cli/src/commands/task.ts:1327` |
| `apps/cli/src/commands/task.ts:1333` |
| `apps/cli/src/commands/task.ts:1344` |
| `apps/cli/src/commands/task.ts:1351` |
| `apps/cli/src/commands/task.ts:1360` |
| `apps/cli/src/commands/task.ts:1371` |
| `apps/cli/src/commands/task.ts:1378` |
| `apps/cli/src/commands/task.ts:1387` |
| `apps/cli/src/commands/task.ts:1401` |
| `apps/cli/src/commands/task.ts:1417` |
| `apps/cli/src/commands/task.ts:1426` |
| `apps/cli/src/commands/task.ts:1438` |
| `apps/cli/src/commands/task.ts:1454` |
| `apps/cli/src/commands/task.ts:1464` |
| `apps/cli/src/commands/task.ts:157` |
| `apps/cli/src/commands/task.ts:192` |
| `apps/cli/src/commands/task.ts:205` |
| `apps/cli/src/commands/task.ts:229` |
| `apps/cli/src/commands/task.ts:238` |
| `apps/cli/src/commands/task.ts:249` |
| `apps/cli/src/commands/task.ts:269` |
| `apps/cli/src/commands/task.ts:285` |
| `apps/cli/src/commands/task.ts:292` |
| `apps/cli/src/commands/task.ts:299` |
| `apps/cli/src/commands/task.ts:350` |
| `apps/cli/src/commands/task.ts:362` |
| `apps/cli/src/commands/task.ts:387` |
| `apps/cli/src/commands/task.ts:45` |
| `apps/cli/src/commands/task.ts:469` |
| `apps/cli/src/commands/task.ts:518` |
| `apps/cli/src/commands/task.ts:553` |
| `apps/cli/src/commands/task.ts:577` |
| `apps/cli/src/commands/task.ts:590` |
| `apps/cli/src/commands/task.ts:601` |
| `apps/cli/src/commands/task.ts:632` |
| `apps/cli/src/commands/task.ts:655` |
| `apps/cli/src/commands/task.ts:677` |
| `apps/cli/src/commands/task.ts:692` |
| `apps/cli/src/commands/task.ts:703` |
| `apps/cli/src/commands/task.ts:722` |
| `apps/cli/src/commands/task.ts:731` |
| `apps/cli/src/commands/task.ts:737` |
| `apps/cli/src/commands/task.ts:742` |
| `apps/cli/src/commands/task.ts:753` |
| `apps/cli/src/commands/task.ts:763` |
| `apps/cli/src/commands/task.ts:770` |
| `apps/cli/src/commands/task.ts:780` |
| `apps/cli/src/commands/task.ts:805` |
| `apps/cli/src/commands/task.ts:837` |
| `apps/cli/src/commands/task.ts:848` |
| `apps/cli/src/commands/task.ts:854` |
| `apps/cli/src/commands/task.ts:861` |
| `apps/cli/src/commands/task.ts:872` |
| `apps/cli/src/commands/task.ts:879` |
| `apps/cli/src/commands/task.ts:903` |
| `apps/cli/src/commands/task.ts:927` |
| `apps/cli/src/commands/task.ts:934` |
| `apps/cli/src/commands/task.ts:949` |
| `apps/cli/src/commands/task.ts:959` |
| `apps/cli/src/commands/task.ts:969` |
| `apps/cli/src/commands/task.ts:981` |
| `apps/cli/src/commands/task.ts:990` |
| `apps/cli/src/commands/team.ts:104` |
| `apps/cli/src/commands/team.ts:126` |
| `apps/cli/src/commands/team.ts:13` |
| `apps/cli/src/commands/team.ts:158` |
| `apps/cli/src/commands/team.ts:233` |
| `apps/cli/src/commands/team.ts:253` |
| `apps/cli/src/commands/team.ts:269` |
| `apps/cli/src/commands/team.ts:279` |
| `apps/cli/src/commands/team.ts:299` |
| `apps/cli/src/commands/team.ts:315` |
| `apps/cli/src/commands/team.ts:332` |
| `apps/cli/src/commands/team.ts:337` |
| `apps/cli/src/commands/team.ts:371` |
| `apps/cli/src/commands/team.ts:383` |
| `apps/cli/src/commands/team.ts:392` |
| `apps/cli/src/commands/team.ts:408` |
| `apps/cli/src/commands/team.ts:426` |
| `apps/cli/src/commands/team.ts:435` |
| `apps/cli/src/commands/team.ts:447` |
| `apps/cli/src/commands/team.ts:54` |
| `apps/cli/src/commands/team.ts:70` |
| `apps/cli/src/commands/team.ts:82` |
| `apps/cli/src/commands/team.ts:93` |
| `apps/cli/src/commands/workflow.ts:263` |
| `apps/cli/src/commands/workflow.ts:267` |
| `apps/cli/src/commands/workflow.ts:313` |
| `apps/cli/src/commands/workflow.ts:40` |
| `apps/cli/src/commands/workflow.ts:400` |
| `apps/cli/src/commands/workflow.ts:424` |
| `apps/cli/src/commands/workflow.ts:434` |
| `apps/cli/src/commands/workflow.ts:615` |
| `apps/cli/src/commands/workflow.ts:639` |
| `apps/cli/src/commands/workflow.ts:691` |
| `apps/cli/src/commands/workflow.ts:700` |
| `apps/cli/src/commands/workflow.ts:721` |
| `apps/cli/src/commands/workflow.ts:737` |
| `apps/cli/src/commands/workflow.ts:778` |
| `apps/cli/src/commands/workflow.ts:782` |
| `apps/cli/src/commands/workflow.ts:802` |
| `apps/cli/src/commands/workflow.ts:807` |
| `apps/cli/src/commands/workflow.ts:853` |
| `apps/cli/src/commands/workflow.ts:910` |
| `apps/cli/src/output.ts:1` |
| `apps/cli/src/output.ts:31` |
| `apps/cli/src/output.ts:9` |
| `apps/cli/tests/commands/message.test.ts:775` |
| `apps/cli/tests/commands/task.test.ts:15` |
| `apps/cli/tests/commands/task.test.ts:2545` |
| `apps/cli/tests/commands/task.test.ts:388` |
| `apps/cli/tests/output-envelope.test.ts:1` |
| `apps/cli/tests/shared-option-parity.test.ts:30` |
| `packages/app/src/services/anchor-qualifier.ts:105` |
| `packages/app/src/services/anchor-qualifier.ts:107` |
| `packages/app/src/services/anchor-qualifier.ts:279` |
| `packages/app/src/services/anchor-qualifier.ts:98` |
| `packages/app/src/services/corpus-check.ts:172` |
| `packages/app/src/services/corpus-check.ts:184` |
| `packages/app/src/services/corpus-check.ts:566` |
| `packages/app/src/services/task-check.ts:1386` |
| `packages/app/src/services/task-record.ts:14` |
| `packages/app/src/services/task-record.ts:166` |
| `packages/app/src/services/task-service.ts:1161` |
| `packages/app/src/services/task-service.ts:36` |
| `packages/app/src/workflow/lifecycle-adapter.ts:22` |
| `packages/app/src/workflow/lifecycle-adapter.ts:222` |
| `packages/app/src/workflow/lifecycle-adapter.ts:226` |
| `packages/app/tests/services/anchor-qualifier.test.ts:2` |
| `packages/app/tests/services/anchor-qualifier.test.ts:91` |
| `packages/app/tests/services/task-check.test.ts:3406` |
| `packages/app/tests/services/task-record.test.ts:1090` |
| `packages/app/tests/services/task-record.test.ts:18` |
| `packages/app/tests/services/task-record.test.ts:21` |
| `packages/app/tests/services/task-record.test.ts:712` |
| `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:59` |
| `packages/app/tests/workflow/lifecycle-adapter.test.ts:55` |
| `packages/contracts/src/index.ts:39` |
| `scripts/commands/regen-corpus-baseline.ts:46` |
| `scripts/commands/regen-corpus-baseline.ts:51` |
| `scripts/commands/regen-corpus-baseline.ts:54` |
| `scripts/commands/regen-corpus-baseline.ts:60` |
| `scripts/commands/regen-corpus-baseline.ts:63` |
| `scripts/commands/regen-corpus-baseline.ts:65` |
| `scripts/commands/regen-corpus-baseline.ts:70` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — Symbol-anchor citation convention in `docs/04_DESIGN.md` §4.2 + dated corpus note | MET | static-ref + command |
| R2 — Sweep-once discipline in verification-gate docs (constitution T11 + derived AGENTS.md line) | MET | static-ref + command |
| R3 — One pass: both conventions land together; AGENTS.md reaches the constitution rule | MET | static-ref + command |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | proof-input-digest | — | sha256:781c7a3a5a7ea3744809112ec62ef3c5c9689dc9c6f7032e97e2fa2c0789b674 |
### References

- Parent feature: `docs/features/F94_pipeline-close-out-and-gate-friction-*.md` (R5, R6 rows)
- Dependency: task 0691 (corpus gate & baseline simplification) — gate-doc half waits on its ADR approval
- Sibling: task 0692 (close-out integrity) — owns the anchor-drift *report*; this task owns the citation *convention*
- `docs/04_DESIGN.md` §4 Output Conventions (:1480) — host for the citation-convention subsection
- `docs/99_PROJECT_CONSTITUTION.md` — process authority for the sweep-once rule
- `AGENTS.md` §Verification gate (:315–360), corpus sweep line (:321), "Targeted-test-first while iterating" (:357) — the derived surface and the shape to mirror
- `config/corpus-baseline.json` `note` — established home for dated decision notes (conditional; see Design hazard)
- Source session: task 0688 (2026-08-27); 0606 anchor-drift precedent (`eval-pipeline.ts:528` → `:562`)

### History
- 2026-08-28T02:18:48.457Z todo → wip (system)
- 2026-08-28T03:12:06.028Z wip → testing (system)
- 2026-08-28T03:12:34.919Z testing → done (system)
