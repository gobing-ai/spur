---
schema_version: 1
name: "Enhance sp:dev-review with architecture/deep-review capability"
description: ""
status: done
type: review
template: review
profile: standard
feature_id: H3
parent_wbs: null
priority: P2
tags: ["review"]
dependencies: []
created_at: "2026-06-29T00:28:36.096Z"
updated_at: 2026-06-29T00:54:22.817Z
---

## 0149. Enhance sp:dev-review with architecture/deep-review capability

### Background
Migration review found that `/sp:dev-review` covered the core SECU path through
`sp:code-verification`, but did not preserve the old `rd3:dev-review` architecture/deepening
capability backed by `rd3:code-improvement`.

Decision: do not migrate `rd3:code-improvement` as a separate `sp` skill for this slice. Instead,
make architecture a first-class fifth review dimension in `sp:code-verification`, yielding the
SECUA framework:

- **S**ecurity
- **E**fficiency
- **C**orrectness
- **U**sability
- **A**rchitecture

This keeps `/sp:dev-review` as one coherent review tool, lets `--focus architecture` work naturally,
and avoids a second review output path. Architecture review remains constrained to the current diff:
module depth, seam placement, coupling/locality, boundary drift, and test-surface damage. Larger
refactors should be reported as follow-up tasks rather than performed opportunistically.

#### Review Findings

The code-review findings this task must address — logged here as **input** (what was found
in the reviewed PR/commit/diff). Fix in priority order (P1 → P2 → …); re-review after.

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P2 | `plugins/sp/skills/code-verification/references/secu-review.md` | Review dimensions stop at SECU and omit architecture, so `/sp:dev-review --focus architecture` cannot be expressed. | Extend the reference to SECUA and add an Architecture dimension with concrete checks and severity guidance. |
| P2 | `plugins/sp/commands/dev-review.md` | The command surface advertises only Security/Efficiency/Correctness/Usability. | Update command description, focus values, and behavior text to SECUA. |
| P3 | `plugins/sp/commands/dev-verify.md` + `plugins/sp/skills/spur-dev/references/dev-operations.md` | Verify/operation docs still describe SECU only. | Sync the shared review contract so verify and review use the same SECUA dimensions. |
### Plan
- [x] Extend `plugins/sp/skills/code-verification/references/secu-review.md` from SECU to SECUA.
- [x] Add `architecture` to `--focus` parsing and document the checks: depth/deletion test, seam placement, coupling/locality, boundary drift, and test surface.
- [x] Update `/sp:dev-review` command docs to advertise SECUA and `--focus architecture`.
- [x] Update `/sp:dev-verify` and dev-operation docs so the shared review contract is consistent.
- [x] Keep architecture review diff-scoped: findings must cite changed files and recommend follow-up tasks for larger refactors.
- [ ] Dogfood `/sp:dev-review <wbs> --focus architecture --auto` on a non-trivial task when an appropriate candidate is available.
### Solution
Implemented the selected design: architecture is now part of the existing review skill rather than a
separate migrated skill.

| File | Change |
| ---- | ------ |
| `plugins/sp/skills/code-verification/references/secu-review.md:8` | Renamed the review lens to SECUA. |
| `plugins/sp/skills/code-verification/references/secu-review.md:19` | Added the Architecture dimension. |
| `plugins/sp/skills/code-verification/references/secu-review.md:23` | Added `architecture` to focus parsing. |
| `plugins/sp/skills/code-verification/references/secu-review.md:38` | Added architecture checks and severity guidance. |
| `plugins/sp/skills/code-verification/SKILL.md:117` | Updated verify/review procedure language to SECUA. |
| `plugins/sp/skills/code-verification/SKILL.md:179` | Updated the pipeline answer heading contract to `### SECUA Review`. |
| `plugins/sp/commands/dev-review.md:2` | Updated the user-facing review command contract to SECUA. |
| `plugins/sp/commands/dev-verify.md:29` | Synced verify command focus values to include `architecture`. |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:63` | Synced operation docs to SECUA. |
### Testing
Verified against the three Review-Findings requirements (R1/R2/R3). Docs/skill-contract change — no executable path; verification is a consistency proof over the contract surface.

Coverage: N/A — documentation/skill-contract change only, no executable code path changed.

| Req | Status | Evidence |
| --- | ------ | -------- |
| R1 (P2) — `secu-review.md` SECU→SECUA + Architecture dimension/checks/severity | MET | `secu-review.md:8,19,24,38-60` |
| R2 (P2) — `dev-review.md` command surface SECUA + `--focus architecture` + behavior | MET | `dev-review.md:2,11,14,20,28,34` |
| R3 (P3) — sync `dev-verify.md` + `dev-operations.md` to SECUA | MET | `dev-verify.md:12,29,37`; `dev-operations.md:21,63,64,66,74`; `SKILL.md:1,33,80,117,179,224` |

Checks:
- Residual bare-`SECU ` wording across the review-contract surface: NONE.
- `--focus` enumerations missing `architecture`: NONE (all include it).
- Answer-format heading contract `### SECUA Review`: consistent; no executable code matches the heading literal (`task-record.ts`/`task-service.ts` extract structurally) → safe rename.
- `bun run lint` (biome + per-workspace tsc): clean.
- `spur task check 0149`: pass.

Verdict: PASS
### Review
**SECUA Review** — docs/skill-contract change. No P1–P4 findings.

| Sev | Dim | Finding | Resolution |
| --- | --- | ------- | ---------- |
| P1 | - | None identified. | - |
| - | Security | N/A — no input/secret/injection surface. | - |
| - | Efficiency | N/A — no executable path. | - |
| - | Correctness | Zero residual bare-`SECU` wording; every `--focus` enumeration includes `architecture`. | Verified by consistency scan. |
| - | Usability | `--auto` added consistently to `dev-review.md` args and `dev-operations.md` arg-hint; SECUA documented uniformly across all four contract files. | - |
| - | Architecture | Sound: architecture is a fifth SECUA dimension inside `sp:code-verification` (one coherent review tool, one output path) rather than a separately-migrated skill. No code-level coupling to the renamed heading — the record step extracts structurally. No boundary drift. | - |

Open follow-up (tracked in Plan, not a requirement): live dogfood of `/sp:dev-review <wbs> --focus architecture --auto` on a non-trivial target.
### References
- `plugins/sp/commands/dev-review.md`
- `plugins/sp/skills/code-verification/SKILL.md`
- `plugins/sp/skills/code-verification/references/secu-review.md`
- `plugins/sp/skills/spur-dev/references/dev-operations.md`
- `/Users/robin/projects/cc-agents/plugins/rd3/commands/dev-review.md`
- `/Users/robin/projects/cc-agents/plugins/rd3/skills/code-review-common/SKILL.md`
- `/Users/robin/projects/cc-agents/plugins/rd3/skills/code-improvement/SKILL.md`
- `docs/features/H3_prompt-skill-moves.md`
### History
- 2026-06-29T00:37:06.513Z todo → wip (system)
- 2026-06-29T00:54:21.147Z wip → testing (system)
- 2026-06-29T00:54:22.817Z testing → done (system)
