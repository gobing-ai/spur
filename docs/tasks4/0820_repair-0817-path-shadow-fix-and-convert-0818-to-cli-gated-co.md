---
schema_version: 1
name: Repair 0817 PATH-shadow fix and convert 0818 to CLI-gated corpus
status: todo
template: issue
created_at: 2026-09-09T22:07:14.641Z
updated_at: "2026-09-09T22:07:26.605Z"

---

## 0820. Repair 0817 PATH-shadow fix and convert 0818 to CLI-gated corpus

### Background

Session-review (2026-09-09, `--triage`) filed two findings from the 7-commit 0815/0817 residual-closure sweep (commits 95a79418..6f04e0f0 on `main`). Both are post-commit defects the session did not surface at commit time.

**F1 — Missing scripts/test-shims/spur makes the 0817 PATH-shadow fix non-functional.** Commit `7f4cb94` ("pin bare spur to source-local shim") added a `process.env.PATH = ${scripts/test-shims}:${PATH}` prepend to `tests/setup.ts:71` and the buglog entry `.spur/context/buglog.md:6981-6992` records the closure. But `scripts/test-shims/` was never created and the spur shim inside it never written. `find /Users/robin/xprojects/spur-new -type d -name test-shims` is empty; the only spur binaries on disk are `dist/cli/spur` (built artifact) and `apps/cli/spur.js` (compiled). The 0815 parking-spot closure (`docs/tasks4/0815_*.md:352`), the 0819 R2 narrative (`docs/tasks4/0819_*.md:23`), and the agent-generated references in `.spur/run/0815-references-update.md:10` / `.spur/run/0819-requirements.md:5` all repeat the same `scripts/test-shims/spur` claim — the code's narrative outran the implementation. Bare `spur` invoked from inside `bun run test` still resolves to whatever is next on PATH (typically the stale global spur, the very 0817 buglog vector: global 0.3.78 stamping `importer_schema@0.4.60` over a 0.4.62 worktree DB). The importer-schema-check shadow-row regression test (`scripts/commands/importer-schema-check.test.ts:99+`) exercises the in-process `importerSchemaCheck` function, not a child CLI, so it cannot detect the missing shim.

**F2 — `docs/tasks4/0818_fix-harness-reliability-findings-from-0815-session-review.md` was direct-written, not CLI-gated.** The file conforms to `schema_version: 1` (passes frontmatter validation) and `spur task show 0818` resolves it, so the corpus index accepts it — but the creation bypassed `spur task create`, violating AGENTS.md ("Never direct-write task/feature corpus files"). In contrast, `0819_align-review-verify-contract-friction-and-close-subprocess-s.md` was created through `spur task create` (commit `112dd7dc5 docs(tasks): add new tasks` is the canonical CLI emission pattern; the hand-written 0818 was bundled into commit `6f04e0f0 docs: close 0815/0817 parking spots…`). No `History` block, no planning-write-service provenance, no `--ac-altitude task-local` opt-in. Two side effects: (a) future `task check` provenance will be blind to its creation context; (b) the rule was bypassed without an explicit override, weakening the AGENTS.md contract.

### Requirements

**R1 (P2 — Repair 0817 PATH-shadow fix).** The PATH prepend added by `tests/setup.ts:71` must resolve to a real source-local spur executable, OR be redirected to an existing source-local CLI path. Regression check: a fresh-worktree test asserts that bare `spur` invoked from a child process resolves to the worktree CLI, not the global spur. Direction is open — three plausible shapes (in order of preference per AGENTS.md "source-local CLI" guidance):

  - **R1a.** Add `scripts/test-shims/spur` as an executable shim that execs the source-local CLI (e.g., `exec bun run apps/cli/src/index.ts "$@"`), making the existing PATH prepend work as documented.
  - **R1b.** Redirect `tests/setup.ts:71` to an existing source-local CLI path (`apps/cli/spur.js` is the AGENTS.md-named binary) via a one-line env override (`SPUR_BIN` or PATH prepend to `apps/cli/`). Lowest diff, but requires a small helper if `apps/cli/spur.js` is not directly invokable as `spur`.
  - **R1c.** Add a structural env override that tests/setup.ts asserts and that the test uses directly (e.g., set `process.env.SPUR_BIN = apps/cli/spur.js`, delete the PATH prepend, update tests to invoke `$SPUR_BIN`).

The shipped outcome must also delete the misleading claim from `.spur/context/buglog.md:6981-6992` and the 0815 parking-spot closure (`docs/tasks4/0815_*.md:352`) — either by updating them to "fix attempted, see 0820 R1" or by replacing the narrative with the actual fix shape once chosen. Coordinate with task 0819 R2 (subagent-shell hermeticity) which already references the shim as a closed premise.

**R2 (P3 — Convert 0818 to CLI-gated corpus).** `docs/tasks4/0818_fix-harness-reliability-findings-from-0815-session-review.md` must round-trip through the corpus surface: remove the hand-written file, recreate via `spur task create "<same title>" --template issue`, restore the four Requirements / four AC entries (R1/R2/R3/R4 + AC1/AC2/AC3/AC4) via `spur task update 0818 --section <s> --from-file <path>`, then commit as the typical `docs(tasks): add new tasks` CLI-emission. After the round-trip, `spur task show 0818 --json` must report a populated `History` and consistent `created_at` / `updated_at`. Note: this retroactively fixes a governance violation; new tasks created during this triage must use the CLI path.

### Acceptance Criteria

- [ ] **AC1 (R1)** — bare `spur` invoked from inside `bun run test` in a fresh worktree (PATH containing the global spur and the source-local CLI) resolves to the source-local CLI; regression check green (new test or extension to `scripts/commands/importer-schema-check.test.ts`).
- [ ] **AC2 (R1)** — the buglog entry `.spur/context/buglog.md:6981-6992` and the 0815 parking-spot closure `docs/tasks4/0815_*.md:352` reflect the actual shipped fix shape (chosen R1a/R1b/R1c outcome), not the prior "scripts/test-shims/spur prepended" claim.
- [ ] **AC3 (R2)** — `docs/tasks4/0818_*.md` is produced by `spur task create` + `spur task update --section`; `spur task show 0818 --json` reports a populated `History`; the four R1–R4 requirements and AC1–AC4 entries are preserved verbatim; the commit message is `docs(tasks): add new tasks` (the canonical CLI emission).
- [ ] **AC4 (R2)** — `git log --follow --diff-filter=A docs/tasks4/0818_*.md` shows the file added in a `docs(tasks): add new tasks`-style commit, not bundled into a feature/closure commit.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-09T22:07:26.412Z

- **Q1 (R1).** Is `apps/cli/spur.js` directly invokable as `spur` (i.e., does it have a shebang or does Bun auto-resolve)? If yes, R1b is a one-line fix; if no, R1a (shim file) is the cleaner path. Default to R1a unless the shim is gratuitous.
- **Q2 (R1).** Should the regression test live in `scripts/commands/importer-schema-check.test.ts` (where the existing shadow-row case is) or a new `scripts/commands/spur-hermeticity.test.ts`? Default: extend the existing file; the failure mode is the same vector (global spur shadowing the worktree CLI).
- **Q3 (R2).** Does `spur task update <wbs> --section <name> --from-file <path>` accept the full section body (markdown including the section heading) or just the body without the heading? Affects whether the file format round-trips cleanly. Verify with the CLI before writing.

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Commit `7f4cb94` (this session) — added the non-functional PATH prepend and buglog entry
- Commit `6f04e0f0` (this session) — bundled 0818 into the docs closure commit
- `.spur/context/buglog.md:6981-6992` — 0817 PATH-shadow buglog entry (claim outran implementation)
- `docs/tasks4/0815_*.md:352` — 0815 parking-spot closure claim (also outran)
- `docs/tasks4/0819_*.md:23` — R2 (subagent-shell hermeticity) references the shim as closed premise; coordinate
- `.spur/run/0815-references-update.md:10` — agent-generated references file echoing the same claim
- `.spur/run/0819-requirements.md:5` — agent-generated 0819 requirements file (same)
- AGENTS.md: "Never direct-write task/feature corpus files" (governance rule violated by F2)
- AGENTS.md: "Real-data history validation must use the source-local CLI (`bun run apps/cli/src/index.ts …` or `apps/cli/spur.js`)" (target shape for R1)
- `scripts/commands/importer-schema-check.test.ts:99-141` — shadow-row regression test (in-process; does not catch missing shim)
- `tests/setup.ts:71` — the broken PATH prepend

### History
