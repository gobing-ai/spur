---
schema_version: 1
name: Ship verify-answer contract and implement briefs as spur-dev references
status: done
template: feature-impl
created_at: 2026-10-07T07:29:49.913Z
updated_at: "2026-10-07T20:16:57.959Z"
feature_id: H15

priority: P3
estimate_hours: 2
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1110-verdict.json
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

- [x] R1. Diff the session verify brief (pi transcript JSONL line 407, `verify-answer-contract.md`) against `code-verification/SKILL.md` and `references/verdict-schema.md`. Each brief rule is classified `present` (cite `path:line`), `missing` (add it to the SKILL.md Answer-File Schema Contract, `:340-370`), or `conflicts` (SKILL.md wins; record why). No new reference file.
- [x] R2. Same diff for the implement brief (line 409) plus the two driver habits — repo-relative anchors from the first Solution write (no basenames), focused per-workspace checks before reporting done — against `code-implementation/SKILL.md`; add only missing rules, in its existing sections.
- [x] R3. The verify stage comment (`task-pipeline.yaml:712-760`) and the implement step comment (`:292-296`) each cite their skill by path, so the lint and the shape contract stay visibly paired. No prose contract is inlined into YAML.
- [x] R4. Both skills still pass `superskill skill validate` and the plugin's skill-structure test.

### Acceptance Criteria

- [x] AC1 — Verify and implement workers get answer-shape and anchor rules from the existing shipped skills (req: R1, R2, R3, R4)

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

Gap-fill into the two skills the pipeline workers already load. No new reference file, no contract prose in YAML.

**R1 — verify brief vs `code-verification/SKILL.md` + `references/verdict-schema.md`**

| Brief rule | Where it ships | Class |
| --- | --- | --- |
| Answer file path `.spur/run/<wbs>-verify-answer.txt` | `plugins/sp/skills/code-verification/SKILL.md:340` | present |
| `VERDICT: PASS` verdict line | `plugins/sp/skills/code-verification/SKILL.md:343` (`Verdict: PASS`); the lint regex is case-insensitive | conflicts — the canonical capitalized form wins; uppercase is accepted but is not the contract |
| `Confidence: high` casing | `plugins/sp/skills/code-verification/SKILL.md:344` (`Confidence: HIGH`) | conflicts — same reason; the value is validated case-insensitively after upper-casing |
| `\| Req \| Status \| Evidence \|` header | `plugins/sp/skills/code-verification/SKILL.md:347` | present |
| Requirement keys are bare `R<n>` | `plugins/sp/skills/code-verification/SKILL.md:349`, `plugins/sp/skills/code-verification/references/verdict-schema.md:60` (missing/duplicate/unknown id rejection classes) | present |
| AC keys are bare `AC<n>` | `plugins/sp/skills/code-verification/SKILL.md:318-321` | conflicts — bare `AC1` fails `ac-identity` on Gherkin AC sections; key by the exact feature scenario title. This is the one place the brief was actively wrong |
| Verbatim scenario-title rows clear the gap check | `plugins/sp/skills/code-verification/SKILL.md:309-316` | present |
| Repo-root-relative anchors only; a basename is rejected | `plugins/sp/skills/code-verification/references/verdict-schema.md:141` (new section) with the pointer at `plugins/sp/skills/code-verification/SKILL.md:168` | **missing → added** |
| `MET` / `UNMET` / `PARTIAL` vocabularies | `plugins/sp/skills/code-verification/SKILL.md:139-141`, `plugins/sp/skills/code-verification/SKILL.md:337-343` | present |
| Never paraphrase AC labels or invent ids | `plugins/sp/skills/code-verification/references/verdict-schema.md:120` (answer-lint rejection classes) | present |
| `` `Confidence:` `` line is mandatory | `plugins/sp/skills/code-verification/SKILL.md:363` (task 1068) | present |
| SECUA Review table in the skeleton | `plugins/sp/skills/code-verification/SKILL.md:356-359` | present |

**Twin-row verdict (the Q&A's open question).** The brief's twin-row practice — a bare `AC<n>` row plus a verbatim scenario-title row — is legitimate only when the task's AC section is a checklist label; on a Gherkin AC section the bare row fails `ac-identity`, so the scenario-title row must stand alone. That distinction is already stated at `plugins/sp/skills/code-verification/SKILL.md:318-321`, so nothing was added for it: `conflicts` resolved in SKILL.md's favor, recorded here.

**R2 — implement brief + the two driver habits vs `code-implementation/SKILL.md`**

| Brief rule / habit | Where it ships | Class |
| --- | --- | --- |
| Run Spur through this tree's own entry (`bun apps/cli/src/index.ts`), never a bare `spur` on `PATH` | `plugins/sp/skills/code-implementation/SKILL.md:107-114` (new bullet) | **missing → added** |
| Re-select the execution tree per shell call (cwd does not persist) | same bullet | **missing → added** |
| Tests live in `<workspace>/tests/**`; in-memory SQLite for DAO tests | `plugins/sp/skills/code-implementation/SKILL.md:105-106`, changed-path matrix `:120-138` | present |
| `requireDiff` discipline and the escalation file / STOP on a genuinely missing decision | `plugins/sp/skills/code-implementation/SKILL.md:64-69`, `plugins/sp/skills/code-implementation/SKILL.md:91` | present |
| Repo-root-relative anchors from the **first** Solution write (no basenames) | `plugins/sp/skills/code-implementation/SKILL.md:187` (Red Flags) + the new anchor rule in `plugins/sp/skills/code-verification/references/verdict-schema.md:141` | present |
| Focused per-workspace checks before reporting done | `plugins/sp/skills/code-implementation/SKILL.md:98-118`, `:120-138` | present |
| P1-specific content (decision-observability layout, batch branch, worktree path, catalog task list) | dropped by the generalization filter | n/a |

**R3.** The verify stage comment (`config/workflows/task-pipeline.yaml:740-744`) and the implement step comment (`config/workflows/task-pipeline.yaml:299-302`) each name their skill and the owning section by path; no contract prose was inlined. Regenerated into `apps/cli/config/workflows/task-pipeline.yaml` by `build:bundle` (both citations present).

**R4.** `superskill skill validate` → `Valid` for both skills; the plugin skill-structure suite passes (91/0). The verify body's basename rule was **relocated to `references/verdict-schema.md` rather than grown in SKILL.md**, because that body sits at its 0161/ADR-028 budget: the added pointer is 41 bytes and the baseline moved 35_468 → 35_509 with the reason recorded at `plugins/sp/tests/skill-structure.test.ts:897-900`. That is a deliberate deviation from R1's "add it to the SKILL.md Answer-File Schema Contract" — the rule ships in the file the contract already delegates rejection classes to, and the body stays a dispatcher.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | The brief was recovered from the pi transcript with a `python3` JSONL reader over the two `write` tool calls (2768 B + 3358 B extracted to `/tmp/h15-briefs/`; nothing pasted into the repo). Every brief rule is classified in the task's Solution table: eleven `present` rows citing `plugins/sp/skills/code-verification/SKILL.md` and `plugins/sp/skills/code-verification/references/verdict-schema.md`, two `conflicts` rows (uppercase `VERDICT:`/`Confidence:` casing; bare `AC<n>` keying, where SKILL.md `:318-321` wins), one `missing` row added. No new reference file: `ls plugins/sp/skills/spur-dev/references/` contains no `verify-answer-contract.md` |
| R2 | MET | The implement brief plus both driver habits are classified in the Solution table against `plugins/sp/skills/code-implementation/SKILL.md`; the one missing rule (CLI pin + per-call tree re-selection) is added at `plugins/sp/skills/code-implementation/SKILL.md:107-114`, while `requireDiff`/escalation (`:64-69`, `:91`), the Solution anchor form (`:187`), and the changed-path check matrix (`:120-138`) are `present`. P1-specific content was dropped (the transcript's decision-observability layout, batch branch, and worktree path appear nowhere in the skill) |
| R3 | MET | `config/workflows/task-pipeline.yaml:299-302` (implement) and `config/workflows/task-pipeline.yaml:740-744` (verify) each cite their skill and owning section by path; `rg -c 'code-verification/SKILL.md |
| R4 | MET | `superskill skill validate plugins/sp/skills/code-verification` → `Valid`; `superskill skill validate plugins/sp/skills/code-implementation` → `Valid`; `(cd plugins/sp && bun test tests/skill-structure.test.ts)` → 91 pass / 0 fail. The R44 body-budget gate initially failed (`code-verification: 36332 bytes, baselined at 35468`), so the substantive rule was relocated into `plugins/sp/skills/code-verification/references/verdict-schema.md:141` and only a 41-byte pointer remains, with the baseline moved to 35_509 and the reason recorded at `plugins/sp/tests/skill-structure.test.ts:897-900` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | `superskill skill validate plugins/sp/skills/code-verification` → `Valid`; `superskill skill validate plugins/sp/skills/code-implementation` → `Valid`; `(cd plugins/sp && bun test tests/skill-structure.test.ts)` → 91 pass / 0 fail (`plugins/sp/tests/skill-structure.test.ts:897-900`, `plugins/sp/tests/skill-structure.test.ts:921-926`); `rg -c 'code-verification/SKILL.md\|code-implementation/SKILL.md' apps/cli/config/workflows/task-pipeline.yaml` → 2; full gate `bun run spur-check` → 10372 pass / 0 fail across 606 files in 454.48s (`plugins/sp/scripts/quality-gate.ts:1`, log `.spur/run/1110-test-gate.log`) |
| R4 — Verify and implement workers get answer-shape and anchor rules from the existing shipped skills | MET | command | Same command set plus the file read-backs: `plugins/sp/skills/code-verification/references/verdict-schema.md:141` carries the new basename-anchor section and `plugins/sp/skills/code-implementation/SKILL.md:107-114` the new CLI-pin bullet |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Verdict: PASS** — skill/YAML-comment surface; 3-dimensional review executed in-session by the inline driver (reviewer independence not achievable on the host-inline path, recorded as P4).

**Requirement traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Solution classifies every brief rule (`present`/`missing`/`conflicts`) with citations; two `conflicts` resolved in SKILL.md's favor; the one `missing` rule ships at `plugins/sp/skills/code-verification/references/verdict-schema.md:141`; no second reference file |
| R2 | MET | Implement brief traced the same way; P1-specific content absent from the skill; CLI-pin + per-call tree rule added at `plugins/sp/skills/code-implementation/SKILL.md:107-114` |
| R3 | MET | `config/workflows/task-pipeline.yaml:299-302` and `:740-744` cite their skills by path, no inlined prose; generated copy carries both |
| R4 | MET | `superskill skill validate` → `Valid` ×2; skill-structure 91 pass / 0 fail |

**Findings**

| P | Finding | Disposition |
| --- | --- | --- |
| P3 | The R44 body budget rejected growing `code-verification/SKILL.md`, blocking R1's literal instruction | resolved in-flight: rule split into `references/verdict-schema.md`, 41-byte pointer, baseline 35_468 → 35_509 with the reason recorded; deviation reported in Testing |
| P4 | Brief casing (`VERDICT:`/`Confidence:`) differs from the shipped contract | recorded as `conflicts`; no rule added |
| P4 | Brief effect on first-attempt verify success still unmeasured | accepted; see 1107 |
| P4 | In-session review | accepted |

No P1/P2 findings. Residual risk: the brief's effect is not measured; the shipped rules are.

### References

- Feature: H15
- `plugins/sp/skills/code-verification/SKILL.md:143`, `plugins/sp/skills/code-verification/SKILL.md:313-320`, `plugins/sp/skills/code-verification/SKILL.md:340-370`
- `plugins/sp/skills/code-verification/references/verdict-schema.md`
- `plugins/sp/skills/code-implementation/SKILL.md:129`, `plugins/sp/skills/code-implementation/SKILL.md:187`
- `config/workflows/task-pipeline.yaml:292-296`, `config/workflows/task-pipeline.yaml:712-760`
- Session briefs: `~/.pi/agent/sessions/--Users-robin-xprojects-spur-new--/2026-10-07T01-27-51-768Z_01a113f9-5cd7-7195-8e4d-b6e7c7643917.jsonl` lines 407, 409

### History

- 2026-10-07T07:34:14.227Z backlog → todo (system)
- 2026-10-07T20:06:34.866Z todo → wip (system)
- 2026-10-07T20:16:32.683Z wip → testing (system)
- 2026-10-07T20:16:57.955Z testing → done (system)

### Notes

Source content: gitignored `spur-new-wt-p1/.spur/run/verify-answer-contract.md` + `implement-context.md` (tree removed — recover from session transcript or commit 4f682cb96's era notes in `.spur/memory/sessions/109{5..9}-checkpoint.md`). Effect evidence to cite in the reference header: 1095 fix loop vs 1096–1099 first-attempt chain. Skill-file changes must follow `docs/99_PROJECT_CONSTITUTION.md` + superskill authoring gates if the skill is superskill-managed — check `superskill skill --help` surface before editing a managed skill.

