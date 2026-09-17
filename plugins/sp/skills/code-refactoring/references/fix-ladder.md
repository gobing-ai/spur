# Fix ladder and eligibility

Authority: `docs/design/dev-refactor-command.md` §6. The ladder ranks what may be applied
mechanically versus what needs an operator answer. It reuses the repository severity meaning
(P1 blocker / P2 major — see [finding-schema.md](./finding-schema.md)) so `--fix blockers-first`
keeps the glossary sense.

## Rungs

| Rung | Example | `preservation` | `fix_eligibility` |
| --- | --- | --- | --- |
| Rename / move / dedupe / inline with identical behavior | A3 consolidate, T3 fixture cleanup, ui token normalization | preserving | `auto` |
| Add missing test, contract field, a11y attribute | T4, api additive, ui P3 | preserving | `auto` |
| Remove dead code with zero references | A1 direct removal proven dead | preserving | `auto` only when a reference search finds no caller; else `confirm` |
| Remove a test, endpoint, control, or code path with callers | T1, A1/A2 live, api removal, ui control removal | cutting | `confirm` |
| Change a contract or observable behavior | api breaking, A5–A7 seam moves | breaking | `confirm` (or `suggest` when multi-task) |
| Architectural migration plan | A6–A7, ADR candidates | — | `suggest` |

Hard rules:

- An `auto` fix **never deletes or weakens a test** (no skipped assertions, no loosened
  expectations, no deleted cases).
- `cutting` and `breaking` findings are **never `auto`** and **never below P2**.

## Apply policies (`--fix`)

| Policy | Meaning |
| --- | --- |
| `none` (default) | Write both artifacts, perform no edit. |
| `blockers-first` | Apply P1/P2 findings with `fix_eligibility: auto`. |
| `all` | Apply every `auto` finding, then queue every `confirm` finding for the taste gate. |

## Apply loop (mirrors `sp:code-simplification` / `dev-simplify`: test-after-each, revert on regression)

1. **Green baseline first.** Run the `--check` command before any edit. A red baseline is a hard
   stop: write the report, apply nothing.
2. **One finding at a time.** Apply a single finding (highest severity first: P1 → P4), limited to
   the finding's evidence files.
3. **Re-run `--check`.**
   - Passes → mark the finding `status: applied`, continue with the next.
   - Fails → revert **only that finding's own edits**: reverse-apply the exact hunks the finding
     introduced (keep the finding's diff; `git apply -R`, or re-edit the specific lines). Never
     `git checkout -- <file>` a whole evidence file — a later finding may share that file with an
     earlier **applied** finding, and a file-level checkout would revert that applied work too.
     Mark the finding `status: reverted`, continue with the next. Never revert another finding's
     work.
4. After the last finding: re-run the structural check on the findings artifact, then write the
   report (see `SKILL.md` phase 5).

`confirm` findings in the `all` policy follow the taste gate: applied only after an explicit
operator `yes` (see the gate matrix in `SKILL.md`). A declined finding is marked `status: rejected`
or `status: deferred` (headless) per the operator answer — never silently dropped.
