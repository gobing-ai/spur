---
schema_version: 1
name: "Docs consolidation — 0688 friction review: symbol anchors and sweep-once discipline"
status: todo
template: feature-impl
created_at: 2026-08-27T20:16:10.953Z
updated_at: "2026-08-27T21:41:27.070Z"
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

- [ ] R1. **Symbol-anchor citation convention** — document in the authoring guidance that owns
      citation forms: prefer `path:symbol` over `path:line` for new task citations and test
      evidence; state when a line anchor is still acceptable; include a dated corpus note
      recording the 0688-review decision.
- [ ] R2. **Sweep-once discipline** — codify in the verification-gate docs: single-task check
      drives the iterate loop; one `--corpus` sweep before commit.
- [ ] R3. **One pass** — land both in `docs/04_DESIGN.md` + the verification-gate docs in a
      single pass.

### Acceptance Criteria

- [ ] AC1. A new author finds the preferred `path:symbol` form, the reason, the line-anchor exception, and the dated decision note linking back to this feature.
- [ ] AC2. The verification-gate docs state the sweep-once discipline (single-task check iterates; `--corpus` runs once before commit).
- [ ] AC3. Both land in one pass across docs/04_DESIGN.md + the verification-gate docs.

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
- [ ] 1. Confirm 0691's approved option before touching gate wording; if still unapproved, land the
      R1 half only and hold R2. → R2 sequencing.
- [ ] 2. Add a citation-convention subsection under `docs/04_DESIGN.md` §4 Output Conventions:
      preferred `path:symbol` form, the rot rationale (0606 `:528` → `:562`), and the explicit
      line-anchor exception list. → R1, AC1.
- [ ] 3. Add the dated decision note recording the 0688-review decision — into
      `config/corpus-baseline.json`'s `note` field, or into the 0691 ADR entry if that option
      retires the baseline (see Design hazard). → R1, AC1.
- [ ] 4. Author the sweep-once rule in `docs/99_PROJECT_CONSTITUTION.md` (process authority):
      single-task check iterates; `--corpus` runs once at commit-prep. → R2, AC2.
- [ ] 5. Update `AGENTS.md` §Verification gate (:315–360) with the derived operational line, mirroring
      the "Targeted-test-first while iterating" shape (:357); do not restate the full rule. → R2, AC2.
- [ ] 6. Land steps 2–5 in one commit. → R3, AC3.
- [ ] 7. Verify: a reader starting from `docs/04_DESIGN.md` §4 reaches the form, the reason, the
      exception, and the dated note; `AGENTS.md` reaches the constitution rule. Run
      `spur task check --corpus` once before the commit. → AC1, AC2, AC3.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
