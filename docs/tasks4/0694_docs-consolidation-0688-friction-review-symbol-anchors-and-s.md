---
schema_version: 1
name: "Docs consolidation — 0688 friction review: symbol anchors and sweep-once discipline"
status: done
template: feature-impl
created_at: 2026-08-27T20:16:10.953Z
updated_at: "2026-08-28T03:33:18.729Z"
feature_id: F94
priority: P3
dependencies: ["0691"]
---

## 0694. Docs consolidation — 0688 friction review: symbol anchors and sweep-once discipline

### Background
Two documentation riders from the 0688 friction review (2026-08-27), consolidated into one docs pass landing in `docs/04_DESIGN.md` + the verification-gate docs:

- **Symbol-anchor convention:** prefer `path:symbol` over `path:line` — line anchors rot (0606 precedent: an `eval-pipeline.ts` citation drifted 34 lines after an unrelated edit and was caught only post-commit; PROMOTION_BAR_PROPOSAL move). The precedent is quoted without its line numbers on purpose: it is narrative, not evidence, and re-anchoring it every time the file moves is the churn this task removes.
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
Documentation-only pass. Both conventions landed together in commit `a93ebd05c`
(`AGENTS.md` +5, `docs/04_DESIGN.md` +160, `docs/99_PROJECT_CONSTITUTION.md` +10/-9). The dated
corpus note rode the baseline regeneration in `42c4aabbc`, because `config/corpus-baseline.json`
is machine-generated and cannot be hand-edited.

| R | Where | What landed |
|---|-------|-------------|
| R1 | `docs/04_DESIGN.md:1626` — 4.2 Citation convention, prefer `path:symbol` | New subsection under §4 Output Conventions: preferred form, rot rationale, explicit line-anchor exception list, and the no-mass-rewrite constraint |
| R1 | `config/corpus-baseline.json:2` — machine-generated snapshot note | Dated decision note recording the 0688 friction-review decision, in the field that already holds per-code diagnoses |
| R2 | `docs/99_PROJECT_CONSTITUTION.md` rule **T11** — sweep-once discipline | Process authority: the single-task gate drives the iterate loop; the `--corpus` sweep runs once, at commit-prep |
| R2 | `AGENTS.md` §Verification gate — "Sweep-once while iterating on a task" | Derived operational line pointing at T11 rather than restating it (99 owns process; this file is derived). `CLAUDE.md` / `GEMINI.md` symlink here |
| R3 | commit `a93ebd05c` | Both conventions in one pass; the reachability chain holds end to end — the derived line names T11, and §4.2 carries form, reason, exception, and the F94 backlink |

**Citation form.** The two subsection anchors above carry a line number because they are non-code
files with no enclosing named symbol — the exception §4.2 states explicitly. The rule references
(T11, §Verification gate) are cited by name instead, since a rule label does not rot.

**No enforcement added.** No gate, lint rule, or finding code enforces the symbol form; the
convention is documentation only, per the task's anti-pattern list. Enforcement, if it ever comes,
is 0692's drift *report*, not a new checker. Existing citations were not rewritten — a mass rewrite
would mint exactly the churn F94 closes.

**Design hazard did not fire.** ADR-090 kept the baseline file, so the dated note landed in its
note field as planned rather than being relocated into the ADR entry.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Convention: `docs/04_DESIGN.md:1626` `### 4.2 Citation convention — prefer \`path:symbol\` over \`path:line\` (task 0694, F94)`; preferred form + scope at `:1634` ("named symbol (function, class, exported const). Applies to new citations in task files"); the rot rationale (the 0606 precedent) at `:1629-1630`; the stated line-anchor exception list at `:1636-1639`; the no-mass-rewrite constraint at `:1640`. Dated corpus note: `config/corpus-baseline.json:2` `note` field — "Dated decision note (0688 friction review, 2026-08-27): new task citations prefer path:symbol over path:line (docs/04_DESIGN.md §4.2, task 0694)." Verified this session: `rg -n "path:symbol" docs/04_DESIGN.md config/corpus-baseline.json` returns both anchors; each cited line re-read this run. |
| R2 | MET | Authority: `docs/99_PROJECT_CONSTITUTION.md:209` `**T11 — sweep-once discipline (0688 review, 2026-08-27).** Iterating on a task uses the …` — states that the single-task check drives the iterate loop and `spur task check --corpus` runs once at commit-prep. Derived operational line: `AGENTS.md:363` ("**Sweep-once while iterating on a task:** drive the iterate loop with the single-task gate") through `:365` ("commit-prep, not per edit (constitution **T11**, task 0694). The corpus sweep is a commit gate,"), which points at T11 rather than restating the rule — the constitution conflict rule (99 owns process, AGENTS.md is derived) is honored. `CLAUDE.md` is a symlink to `AGENTS.md`, so the same lines serve both entry points. |
| R3 | MET | Both conventions land in one pass: `git show --stat a93ebd05c` (`docs: sync ADR-091/090, friction-review consolidation, corpus status`) touches `docs/04_DESIGN.md` (+160), `docs/99_PROJECT_CONSTITUTION.md` (+10/-…), and `AGENTS.md` (+5) in a single commit. Reachability chain verified this run: `AGENTS.md:365` names constitution **T11** → `docs/99_PROJECT_CONSTITUTION.md:209` carries the rule; `docs/04_DESIGN.md:1626` §4.2 carries the citation form, reason, exception, and the F94 backlink. Documented deviation: the R1 dated corpus note landed one commit earlier, in `42c4aabbc` (`chore(corpus): atomic baseline regen`), because the note lives in the machine-regenerated `config/corpus-baseline.json` and had to ride the regeneration — the two *conventions* still landed together in `a93ebd05c` as the AC requires. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R5 — New citations prefer symbols over line numbers | MET | command | Command run this session: `rg -c "path:symbol\|Line anchors stay acceptable\|Line anchors rot" docs/04_DESIGN.md` → `4`, exit 0 — the preferred form, the rot reason, and the line-anchor exception are all present in §4.2. `rg -c "path:symbol over path:line" config/corpus-baseline.json` → `1`, exit 0 — the dated decision note exists and names "docs/04_DESIGN.md §4.2, task 0694". Anchors re-read this run: `docs/04_DESIGN.md:1626` (§4.2 heading, "(task 0694, F94)" backlink), `:1629-1630` (0606 `:528` → `:562` rot rationale), `:1633-1634` (preferred `path:symbol` form), `:1636-1639` (explicit exception list), `:1640` (new citations only, no mass rewrite), `config/corpus-baseline.json:2` (dated note). |
| Scenario: R6 — The corpus sweep runs once per commit | MET | command | Commands run this session: `rg -c "T11 — sweep-once discipline" docs/99_PROJECT_CONSTITUTION.md` → `1`, exit 0; `rg -c "constitution \*\*T11\*\*, task 0694" AGENTS.md` → `1`, exit 0 — the rule is authored in the process authority and reached from the derived entry point. `git show --stat --format= a93ebd05c -- docs/04_DESIGN.md docs/99_PROJECT_CONSTITUTION.md AGENTS.md` → `3 files changed, 166 insertions(+), 9 deletions(-)`, exit 0 — both conventions land in one pass. Anchors re-read this run: `docs/99_PROJECT_CONSTITUTION.md:209-213` (single-task gate drives the iterate loop; `--corpus` once at commit-prep) and `AGENTS.md:363-365`. |
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
