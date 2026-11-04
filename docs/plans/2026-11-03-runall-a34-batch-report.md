# Batch report — `/sp:dev-runall --feature A34 --auto --agent inline --next --worktree --wrap`

Date: 2026-11-03 · Worktree: `spur-new-dev-runall-a34-9f3a` (branch `sp/runall-a34-9f3a`, base `28a644a31`) · Executor: host inline, sequential (worktree-pinned order).

## Verdict: tasks complete, merged; feature verify blocked by pre-existing gate defect

All 5 tasks reached `done` and are FF-merged to `main`. The feature-level completion gate
(`spur feature verify A34`) currently records **FAIL** from `dependency-drift-check` — a
pre-existing checker/layout incompatibility (see Blocker). A34 frontmatter remains `verifying`
pending a real verify PASS; no receipt was forced.

## Tasks

| WBS | Title | Run | Terminal state | Close path |
| --- | --- | --- | --- | --- |
| 1285 | Hybrid search core (contracts, SearchService, ZgAdapter) | `b2928972…` | run terminal-failed (early pause/resume contract discovery) | manual close (`task record … --transition done --no-lifecycle`, 14/14 boxes) |
| 1286 | `spur self search` verb | `b391a7f6…` | done | pipeline (verdict PASS → approve → done) |
| 1287 | Board/server/web search module + mode tabs | `cabda5d6…` | done | pipeline + one remediate round (P4 citation) |
| 1288 | sp-skill semantic-first search guidance (R44 budget) | `16a8922a…` | run terminal-failed (stale-review answer pitfall) | manual close; status flip landed post-merge (`80905947a`) |
| 1289 | spur init zg readiness + `.zvec-grep/` gitignore | `6ebf3a5f…` | run terminal-failed (done-gate evidence paths) | done transition accepted after evidence-copy fix; task committed |

## Commits on `main` (FF-merged, post-rebase onto `a8946da4f`)

- `4f9ba1aad` feat(search): hybrid search core service, zg adapter, and spur self search verb (1285, 1286)
- `730dcd2d4` feat(search): mount search contract and add Board search module with mode tabs (1287)
- `e4c2ef165` docs(sp-skills): route concept questions to semantic-first search with rg fallback (1288)
- `3f6a00b0d` feat(init): report zg readiness and gitignore .zvec-grep/ (1289)
- `80905947a` chore(tasks): close 1288 at done after manual residual-clean close

## Verification evidence (per-task)

- Each task's in-run quality gate: green (full suite ~11.8k tests / 766 files, gateRuntimeMs ~320–331s), post-check rules 2/2.
- 1289: `init-search.test.ts` 7/7 (red-first), init neighbors 58 pass; E2E artifact: fresh temp repo, two init runs → exactly 1 `.zvec-grep/` + 1 `.spur/context/` entry, JSON `search` field, human `search:` line, PATH-stripped zg-absent → `index: 'unknown'` exit 0.
- Post-merge on `main`: web search/registry/project-switcher suites 30 pass; cli init suites 31 pass, 0 fail; `@gobing-ai/spur-app` typecheck clean; `task check 1288`/`1289` pass with 0 findings; residual folds `verdict=PASS residual-sweep=pass`.

## Blocker — `spur feature verify A34` FAIL (pre-existing, not A34-introduced)

`dependency-drift-check` (scripts/commands/dependency-drift-check.ts) fails identically on
`main` **and** in the untouched worktree, before and after a full `rm -rf node_modules && bun install`:

- For nested lock keys (`@gobing-ai/ts-db/zod` → locked 4.6.7), `findInstalledPkgJsonPath`
  checks `node_modules/@gobing-ai/ts-*/node_modules/<name>` (absent under bun's isolated
  linker), then the **hoisted** `node_modules/zod` — which is 4.4.3 (root workspace pin,
  package.json:57/142) — and never reaches its own `.bun` store fallback, which does hold the
  correct 4.6.7 resolution.
- Net effect: every nested `zod`/`yaml`/`@logtape` key false-positives against the hoisted
  version. This predates A34 (main `a8946da4f` fails the same way) and is not fixable by
  install hygiene.

Recommended follow-up (separate task, gate-infra scope): in `findInstalledPkgJsonPath`, for
nested lock keys prefer the `.bun` store resolution over the hoisted copy (or skip hoisted
when `parentKey !== null`). Then re-run `spur feature verify A34` to record PASS and flip A34
to `done`.

## Incidents & lessons (also appended to `.spur/context/learnings.md` in the worktree)

1. **Stale-review answer pitfall (1288 terminal fail):** the review `agent.run` dispatch deletes the
   stale `-review-answer.txt`; the verdict gate judges whatever answer exists at resume. A stale FAIL
   persists in `<wbs>-review.status` and later routes approve→failed.
2. **Residual scanner reads the task-file Review section**, not the cert: an empty template Review
   section blocks with "no Confidence line" even with a valid cert+answer pair (1289 round 1).
3. **Done-gate test-evidence resolution:** cited test paths must exist repo-root-relative **in the
   durable evidence copy** `.spur/memory/evidence/<wbs>-verdict.json`; the scratch
   `.spur/run/<wbs>-verdict.json` is only a fallback (1289 done-gate).
4. **bun:test overload strictness:** optional-chain args (`x?.y`) fail `toBe/toContain` typing; narrow
   with an explicit guard first.
5. **Verify commit success with `git log`** — lefthook can print success while the commit silently fails.

## Left in place (authorization boundary)

- Worktree `spur-new-dev-runall-a34-9f3a` and branch `sp/runall-a34-9f3a` are **not** deleted
  (branch/worktree removal needs explicit authorization). Cleanup when accepted:
  `git worktree remove spur-new-dev-runall-a34-9f3a && git branch -d sp/runall-a34-9f3a`.
- A34 frontmatter intentionally left at `verifying` (verify FAIL recorded, run
  `run_f954b7d3…`); no `--as done` receipt was forged.
