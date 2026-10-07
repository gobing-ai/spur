---
schema_version: 1
name: Ship verify-answer contract and implement briefs as spur-dev references
status: todo
template: feature-impl
created_at: 2026-10-07T07:29:49.913Z
updated_at: "2026-10-07T16:17:19.334Z"
feature_id: H15

priority: P3
estimate_hours: 2
---

## 1110. Ship verify-answer contract and implement briefs as spur-dev references

### Background

The batch's four consecutive first-attempt verify verdicts (1096–1099) came from two hand-authored briefs written into the gitignored driver tree: `.spur/run/verify-answer-contract.md` (how the verifier's answer must be shaped) and `.spur/run/implement-context.md` (repo-relative production anchors from the start, focused checks before reporting done). The pipeline already lints answers (`task verdict`, 1003 R2, `task-pipeline.yaml:718-764`) but nothing ships the shape guidance — every downstream session re-derives it or fails the lint.

**Refine corrections (2026-10-07)**

- The verify answer-shape contract **already ships**: `plugins/sp/skills/code-verification/SKILL.md` covers repo-relative anchors (`:143`, `:165`), scenario-title row keying (`:313-320`) and the Answer-File Schema Contract (`:340-370`, including the Confidence line from 1068 and evidence citations from 1070); `plugins/sp/skills/code-verification/references/verdict-schema.md` owns the `evidenceType` enum. A new `spur-dev/references/verify-answer-contract.md` would be a second source of truth — R1 is rewritten as a gap-fill into the existing skill.
- Conflict to resolve, not copy: the session brief said "bare AC<n>" ids, but SKILL.md says bare `AC1` fails `ac-identity` on Gherkin AC sections and rows key by the exact scenario title. SKILL.md is authoritative; the brief's twin-row practice (bare id row + verbatim scenario-title row) is checked against it during the diff.
- `implement-context.md` (session transcript line 409) was mostly P1-specific. Only its standing rules generalize: CLI pin, tests per workspace, requireDiff/escalation. "Repo-relative anchors from first write" and "focused checks before done" were **not** in it — they were driver habits. `sp:code-implementation` already requires backticked repo-root `path:line` Solution anchors (`plugins/sp/skills/code-implementation/SKILL.md:187`) and a targeted-tests table (`:129`); R2 only adds what is missing.
- "Four consecutive first-attempt PASS" is wrong (1096 needed an AC2 patch); the brief's effect is not measured. See 1107.
- Pipeline line refs re-verified: verify stage comment `config/workflows/task-pipeline.yaml:712-760`; implement step comment `:292-296`.

### Requirements

- [ ] R1. Diff the session verify brief (pi transcript JSONL line 407, `verify-answer-contract.md`) against `code-verification/SKILL.md` and `references/verdict-schema.md`. Each brief rule is classified `present` (cite `path:line`), `missing` (add it to the SKILL.md Answer-File Schema Contract, `:340-370`), or `conflicts` (SKILL.md wins; record why). No new reference file.
- [ ] R2. Same diff for the implement brief (line 409) plus the two driver habits — repo-relative anchors from the first Solution write (no basenames), focused per-workspace checks before reporting done — against `code-implementation/SKILL.md`; add only missing rules, in its existing sections.
- [ ] R3. The verify stage comment (`task-pipeline.yaml:712-760`) and the implement step comment (`:292-296`) each cite their skill by path, so the lint and the shape contract stay visibly paired. No prose contract is inlined into YAML.
- [ ] R4. Both skills still pass `superskill skill validate` and the plugin's skill-structure test.

### Acceptance Criteria

- [ ] AC1 — Verify and implement workers get answer-shape and anchor rules from the existing shipped skills (req: R1, R2, R3, R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T16:16:57.526Z

- **Q: New reference or extend existing skills?** A: Extend existing skills (2026-10-07 refine). The contract already lives in `code-verification`; a second file would drift.
- **Q: Bare AC ids vs scenario-title keying?** A: SKILL.md `:313-320` wins for Gherkin AC sections; the diff records whether the brief's twin-row practice adds anything.

### Design

**Approach:** gap-fill, not new files. The skills are already what pipeline workers load (`/sp:dev-run --mode implement` → `sp:code-implementation`, `dev-run.md:40`; verify → `sp:code-verification`).

**Frozen names**

- Targets: `plugins/sp/skills/code-verification/SKILL.md` (§ Answer-File Schema Contract), `plugins/sp/skills/code-verification/references/verdict-schema.md` (enum only, if missing a value), `plugins/sp/skills/code-implementation/SKILL.md` (existing sections; anti-pattern list near `:186-187`).
- Classification tokens in the Solution diff table: `present` | `missing` | `conflicts`.

**Generalization filter:** a brief rule is kept only if it holds for any task. P1-specific content (task ids, file lists, batch branch names) is dropped.

**Anti-patterns**

- Creating `spur-dev/references/verify-answer-contract.md` or any second copy of the schema.
- Copying "bare AC<n>" keying without resolving it against SKILL.md `:313-320`.
- Inlining contract prose into `task-pipeline.yaml`.
- Hand-editing generated per-platform skill adapters (Superskill owns them; these skills are plugin-bundled under `plugins/sp/skills`).

**Validation:** `superskill skill validate plugins/sp/skills/code-verification` and `.../code-implementation`; `(cd plugins/sp && bun test tests/skill-structure.test.ts)`.

**Dependency handoff:** 1109 is the automated safety net for basename anchors; this task states the rule at the source. 1107 records that the briefs' effect is unmeasured.

### Plan

1. Extract transcript lines 407 and 409 to a scratch file (`python3 -c` reading the JSONL; never paste into the repo).
2. Build the R1 table (brief rule → SKILL.md / verdict-schema `path:line` → classification).
3. Add `missing` rules to `code-verification/SKILL.md` § Answer-File Schema Contract; resolve `conflicts` in the table.
4. Build the R2 table against `code-implementation/SKILL.md`; add `missing` rules.
5. Point `task-pipeline.yaml:292-296` and `:712-760` comments at the skill paths; `bun run --filter @gobing-ai/spur build:bundle`.
6. `superskill skill validate` both skills; plugin skill-structure test; `bun run spur-check`.
7. Put both tables in `## Solution`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: H15
- `plugins/sp/skills/code-verification/SKILL.md:143`, `plugins/sp/skills/code-verification/SKILL.md:313-320`, `plugins/sp/skills/code-verification/SKILL.md:340-370`
- `plugins/sp/skills/code-verification/references/verdict-schema.md`
- `plugins/sp/skills/code-implementation/SKILL.md:129`, `plugins/sp/skills/code-implementation/SKILL.md:187`
- `config/workflows/task-pipeline.yaml:292-296`, `config/workflows/task-pipeline.yaml:712-760`
- Session briefs: `~/.pi/agent/sessions/--Users-robin-xprojects-spur-new--/2026-10-07T01-27-51-768Z_01a113f9-5cd7-7195-8e4d-b6e7c7643917.jsonl` lines 407, 409

### History

- 2026-10-07T07:34:14.227Z backlog → todo (system)

### Notes

Source content: gitignored `spur-new-wt-p1/.spur/run/verify-answer-contract.md` + `implement-context.md` (tree removed — recover from session transcript or commit 4f682cb96's era notes in `.spur/memory/sessions/109{5..9}-checkpoint.md`). Effect evidence to cite in the reference header: 1095 fix loop vs 1096–1099 first-attempt chain. Skill-file changes must follow `docs/99_PROJECT_CONSTITUTION.md` + superskill authoring gates if the skill is superskill-managed — check `superskill skill --help` surface before editing a managed skill.

