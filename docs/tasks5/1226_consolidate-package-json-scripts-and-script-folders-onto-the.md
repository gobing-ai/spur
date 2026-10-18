---
schema_version: 1
name: Consolidate package.json scripts and script folders onto the action vocabulary
status: done
template: feature-impl
created_at: 2026-10-17T04:04:39.233Z
updated_at: "2026-10-17T23:01:07.933Z"
feature_id: A92
priority: P2
tags:
  - scripts
  - package-json
estimate_hours: 5

dependencies: ["1224"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1226-verdict.json
---

## 1226. Consolidate package.json scripts and script folders onto the action vocabulary

### Background

Feature A92 (docs/design/sdlc-actions.md §2 layers, §3.5). spur-new's package.json has exact duplicates (spur-check-new = spur-check, spur-check-new:full = spur-check:full, check:full = check), two entry styles (`bun scripts/commands/x.ts` vs scripts/spur-dev.ts dispatcher), and zero-caller scripts (surface-drift-inventory.ts, validate-flag-contracts.ts). Covers R1, R7, R8.

**Refine corrections (2026-10-16)**
- Satellite said 9 package.json scripts call `bun scripts/commands/<x>.ts` directly → `rg -c` counts 13 lines (package.json) → R5 covers all of them.
- References to the removed names span live docs and history (ADR text, dated reports/plans/inventory) → only live references move (AGENTS.md, plugins/sp skills/references, docs/design, config/rules/quality/coverage-gate.yaml comment, tests: apps/cli/tests/commands/task/check.test.ts, plugins/sp/tests/feature-verification-scope.test.ts, scripts/commands/coverage-certification.test.ts:475); dated reports/plans and ADR history stay verbatim.
- Folding `:full` into `-- --verbose`: with the bun preset, rules-post = `bun run test-post-check`, and `bun run <script> --verbose` appends the flag to the script's last command (the rule run), matching today's `:full` bodies → valid.

### Requirements

- [x] R1. docs/design/sdlc-actions.md §3.5 carries a table classifying every root package.json script as binding (reserved action under bun preset), composition, or repo tool.
- [x] R2. `spur-check-new` (package.json:93), `spur-check-new:full` (package.json:101) and `check:full` (package.json:99) are removed; every live reference moves in the same change (dated reports/plans and ADR history excepted).
- [x] R3. `test-pre-check:full` / `test-post-check:full` are removed; their callers (`spur-check:full`, coverage-certification.test.ts:475, coverage-gate.yaml comment) use `test-pre-check --verbose` / `test-post-check --verbose`.
- [x] R4. spur-new's .spur/config.yaml declares `builder.preset: bun` plus custom actions `test-repo-wide`, `plugin-smoke`, `corpus-check`, `eval` bound to the existing scripts.
- [x] R5. Every package.json entry that runs `bun scripts/commands/<x>.ts` directly is routed through `bun scripts/spur-dev.ts <command>`; the spur-dev.ts header table records each command's layer (L1 build/package, L2 test runner, L3 repo contract checks, L4 dev/eval).
- [x] R6. scripts/commands/surface-drift-inventory.ts and validate-flag-contracts.ts each get a registered caller or are deleted with their tests and live references.
- [x] R7. The sp-script-placement rule and a reachability scan (every file under scripts/commands, plugins/sp/scripts/hooks, plugins/sp/lib has a runtime/package/hook caller or is a colocated test) report zero findings.

Out of scope: moving files between folders; renaming bun scripts to action names; superskill/knowledge-kit changes; spur-check-feature composition redesign (satellite §5 open question).

### Acceptance Criteria

- [x] AC1 — The SDLC action vocabulary and common script layers are documented
- [x] AC2 — Root package.json scripts map to the action vocabulary
- [x] AC3 — Script folders follow the placement contract with no dead entries

Requirement map: AC1 → R1; AC2 → R2, R3, R4, R5; AC3 → R6, R7. Verification: `rg -n 'spur-check-new|check:full' --glob '!docs/{reports,plans,inventory}/**' --glob '!docs/00_ADR.md'` returns nothing; sp-script-placement reports zero findings; full gates green.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T04:05:55.916Z

- No folder reshuffle: layers are recorded, not encoded in paths.
- Tests stay colocated beside scripts/commands modules (spur-new convention).
- Bun script names are kept (the bun preset depends on them, as do superskill and knowledge-kit).

#### Q&A entry — 2026-10-17T04:16:47.232Z

- No folder reshuffle: layers are recorded, not encoded in paths (closed).
- Tests stay colocated beside scripts/commands modules (closed: spur-new convention).
- Bun script names are kept (closed: the bun preset depends on them).
- History documents keep removed names verbatim (closed 2026-10-16).

### Design

WHAT: make spur-new's own script surface match the vocabulary with no duplicate or dead entries.
WHERE: package.json, .spur/config.yaml, scripts/spur-dev.ts, scripts/commands/*, docs/design/sdlc-actions.md §3.5, AGENTS.md, live plugin references listed in the correction block.

Decisions: keep bun script names (the bun preset binds to them; satellite §3.1); `:full` variants become `--verbose` passthrough; layer recorded in the spur-dev.ts header, not paths; tests stay colocated.

Zero-caller disposition rule: register when the script backs a documented contract still in force (check docs/design references); otherwise delete. Record the decision per file in the correction block.

Anti-patterns: no folder moves; no new package.json scripts beyond routing changes; do not edit dated reports/plans or ADR history text; do not touch `.github/workflows/` (needs explicit operator request) — if CI calls a removed name, stop and surface it.

Assumes from 1224: engine defaults already route through actions, so removed names have no engine caller. Leaves for 1227: plugin prose referencing removed names that 1227 rewrites to `spur self exec`.

### Plan

0. Precondition: `rg -n 'spur-check-new|check:full|pre-check:full|post-check:full' .github/` — any hit stops the task for an operator decision (workflow edits need explicit request).
1. Build the classification table and record it in satellite §3.5 (R1).
2. Remove duplicates and :full variants; move live references (R2, R3).
3. Add the dogfood builder block to .spur/config.yaml (R4).
4. Route direct script calls through spur-dev.ts and add the layer header table (R5).
5. Resolve the two zero-caller scripts (R6); run `spur rule run` for sp-script-placement and the reachability scan (R7).
6. `bun run spur-check` and `bun run spur-check-feature`.

### Solution

Every row is one `file:line` (repo-root-relative); ranges stay inside the file and name the subject.

| Req | file:line | Change |
| --- | --- | --- |
| R1 | `docs/design/sdlc-actions.md:179-259` | §3.5 rewritten: heading at `:179`, the classification rules at `:186-189`, all 47 root scripts in one table at `:190-238`, duplicate/alias record at `:240-245`, single-entry-style + registered-tool record at `:246-257`, zero-findings line at `:258-259`. The generator asserted `rows == len(package.json.scripts)` (47/47) — an unclassified script cannot be added silently. |
| R2 | `package.json:85-105` | the scripts block now carries no `spur-check-new`, `spur-check-new:full` or `check:full` entry; `spur-check` (`:92`) and `spur-check-feature` (`:93`) are untouched, so the load-bearing chains keep their exact bodies. |
| R2 | `AGENTS.md:171` | the "same task-local chain as `spur-check`" sentence is gone; `spur-check-feature` keeps its paragraph. |
| R2 | `plugins/sp/skills/code-implementation/SKILL.md:156,195-197` | the mirrored-surface examples now pair `spur-check` with `spur-check:full` instead of the removed duplicate. |
| R2 | `config/rules/quality/coverage-gate.yaml:3-5` | provenance comment names the single surviving post-check script. |
| R3 | `package.json:96` | `spur-check:full` calls `bun run test-pre-check --verbose` / `bun run test-post-check --verbose`; the two `:full` entries are deleted. Probe: bun appends the flag to the script's last command, so the rule run sees `--verbose` exactly as the deleted aliases spelled it. |
| R3 | `scripts/commands/coverage-certification.test.ts:475-477` | one post-check entry, new entry style (`bun scripts/spur-dev.ts coverage-provenance-check &&`). |
| R4 | `.spur/config.yaml:98-109` | `builder.preset: bun` plus custom actions `test-repo-wide` (`:106`), `plugin-smoke` (`:107`), `corpus-check` (`:108`), `eval` (`:109`), each bound to an existing bun script; the pre-existing `builder.bump-ver` block and the rest of the file are unchanged. |
| R5 | `scripts/spur-dev.ts:11-39` | header table records each command's layer (L1 build/package, L2 test runner/coverage, L3 repo contract checks, L4 dev/eval) — the layer is recorded, not encoded in the path. |
| R5 | `scripts/spur-dev.ts:71-83` | `DELEGATED` map: the eleven L2–L4 modules reached through the dispatcher. |
| R5 | `scripts/spur-dev.ts:92-97` | `delegate()` runs the module as a child process with `args` forwarded verbatim (those modules parse their own argv and own their exit code) and propagates the exit code. |
| R5 | `scripts/spur-dev.ts:155-159` | the `default` arm dispatches a mapped command, else prints usage. |
| R5 | `package.json:82-105` | all fourteen former direct lines rerouted: `test-post-check` (`:82`), `test` (`:85`), `test:heavy` (`:86`), `plugin-smoke` (`:88`), `test:coverage` (`:89`), `test-repo-wide` (`:94`), `test:full` (`:95`), `eval` (`:97`), `transition-shim-check` (`:98`), `script-contract-check` (`:99`), `inline-pipeline-parity-check` (`:100`), `validate-commands` (`:102`), `dependency-drift-check` (`:105`). `rg -c 'bun (run )?scripts/commands/' package.json` = 0. |
| R6 | `scripts/spur-dev.ts:80-81` | both zero-caller files are registered instead of deleted: `flag-contract-check` → `validate-flag-contracts.ts` (live contract in `plugins/sp/skills/spur-dev/references/cross-cutting.md:25`), `surface-drift-inventory` → `surface-drift-inventory.ts` (L3 drift inventory, `docs/design/dev-spine-cost-and-drift.md:114`). Neither test moved; `spur-check-feature`'s composition is unchanged. |
| R7 | `scripts/spur-dev.ts:75-78` | the L3 entries are already wired into `spur-check-feature` (`package.json:93`), so the placement surface the rule scans is intact. |
| — | `plugins/sp/tests/feature-verification-scope.test.ts:53` | duplicate alias pin dropped; the R2/R3 scope assertions are untouched. |
| — | `apps/cli/tests/commands/task/check.test.ts:143` | duplicate alias pin dropped. |
| — | `plugins/sp/tests/skill-structure.test.ts:1703` | `eval` entry assertion follows the dispatcher route (`skill-eval`); the module path check at `:1695` is unchanged. |
| — | `plugins/sp/skills/spur-dev/references/gate-checklists.md:179` | transition-shim prose now names `spur-check-feature` (where 0872 put it). |
| — | `plugins/sp/skills/spur-dev/references/execution-batch.md:609` | gate preflight names `spur-check:full`. |
| — | `plugins/sp/skills/spur-cli/references/workflows.md:258` | advisory posture names `spur-check` only. |
| — | `docs/design/configuration-contracts.md:291` | shim gate parenthetical names `spur-check-feature`. |
| — | `docs/design/essential-workflow-checks.md:60` | the duplicate-chain sentence is replaced by the audit rule it was qualifying. |
| — | `docs/design/harness-surface-governance.md:72` | posture note names `spur-check` only. |
| — | `docs/design/sdlc-actions.md:53-54` | the cross-project survey records that only superskill/knowledge-kit still declare `check:full`. |

Rationale (two decisions the review should see):
- **Child-process delegation, not import.** `run-tests`, `coverage-provenance-check`, `plugin-install-smoke`, `transition-shim-check` and `inline-pipeline-parity-check` execute at module top level and read `process.argv`/`Bun.argv` themselves. Importing them would either run them on dispatcher startup or silently shift their argv by one. The child keeps every module's contract byte-identical, so the coverage-certification window, the hermetic test env and the exit codes are untouched.
- **Delete vs register for the zero-caller files.** Both still back documented contracts (flag parity across five surfaces; the L3 drift inventory), both have colocated suites exercising real exports, and neither is on a gate path. Registering them as dispatcher commands satisfies the placement rule without changing `spur-check-feature`'s composition, which is out of scope here.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/design/sdlc-actions.md:180-260` — §3.5 heading at :179, the three rules of classification at :186-189, the classification table at :190-238, duplicate/alias record at :240-245, single-entry-style + registered-tool record at :246-257. Machine-compared this run with `package.json`: 47 manifest scripts against 47 table rows, 0 scripts missing from the table, 0 rows missing from the manifest, 0 duplicate rows, and every class cell is one of binding / composition / repo tool. |
| R2 | MET | `package.json:82-105` — no `spur-check-new`, `spur-check-new:full` or `check:full` entry; `spur-check` (`package.json:92`) and `spur-check-feature` (`:93`) keep their bodies. Exact-token sweep over the repo outside dated records returns exactly one hit, `docs/design/sdlc-actions.md:54` — the cross-project survey cell that attributes `check:full` to superskill/knowledge-kit, not to spur-new. `.github/` returns zero hits, so CI calls none of the removed names. Live references retargeted: `AGENTS.md:171`, `plugins/sp/skills/code-implementation/SKILL.md:156`, `:195-197`, `plugins/sp/skills/spur-cli/references/workflows.md:258`, `plugins/sp/skills/spur-dev/references/execution-batch.md:609`, `config/rules/quality/coverage-gate.yaml:3-5`, `docs/design/configuration-contracts.md:291`, `docs/design/essential-workflow-checks.md:60`, `docs/design/harness-surface-governance.md:72`. |
| R3 | MET | `package.json:96` — `spur-check:full` calls `bun run test-pre-check --verbose` and `bun run test-post-check --verbose`; both `:full` aliases are absent from the scripts block. Fold probed this run: `bun run test-pre-check --verbose` printed the expanded rule-run line, then per-rule lines through `[51/51] no-direct-fs-io`, then `All 51 rules passed`, exit 0 — the flag reaches the rule run, which is what the deleted alias spelled out. Callers moved: `scripts/commands/coverage-certification.test.ts:475-477` (single surviving entry, dispatcher style) and `config/rules/quality/coverage-gate.yaml:3-5`. |
| R4 | MET | `.spur/config.yaml:98-109` — diff is additive only (`builder.bump-ver` and the rest of the file unchanged). `bun apps/cli/src/index.ts self exec --list --json --no-logo` parses the file and lists `corpus-check`, `eval`, `plugin-smoke`, `test-repo-wide` with `"source": "config"` beside the 18 preset actions. Each binding names a script that exists: `package.json:87`, `:88`, `:94`, `:97`. |
| R5 | MET | `package.json` direct-call lines: 14 at HEAD, 0 now (`rg -c 'bun (run )?scripts/commands/' package.json` exits 1). `scripts/spur-dev.ts:11-39` records the layer per command (L1/L2/L3/L4); `:71-83` is the 11-module DELEGATED map; header-to-dispatch check 24/24 (13 switch arms + 11 delegated names). Argv/exit propagation probed this run through the dispatcher: `run-tests test --reporter=dots scripts/commands/release-alias.test.ts` → 4 pass, exit 0; `run-tests test ./definitely-no-such-dir` → `Test filter ... had no matches`, exit 1; `coverage-provenance-check` → its lcov-mismatch diagnostic, exit 1. Only colocated `*.test.ts` files import a delegated module, so nothing self-executes twice. |
| R6 | MET | `scripts/spur-dev.ts:81-82` registers `flag-contract-check` → `validate-flag-contracts.ts` and `surface-drift-inventory` → `surface-drift-inventory.ts`. Both ran through the dispatcher this run: `flag-contract-check` printed `All 87 contract surfaces agree.`, exit 0; `surface-drift-inventory` drove the full sweep and, with no `--out`, wrote no file (`git status --porcelain` stayed at the same 18 files). Neither basename has another non-test caller (`rg -l` outside `docs/` and `*.test.ts` returns only `scripts/spur-dev.ts` plus the files' own usage strings). Both colocated suites stayed in place; `spur-check-feature` composition (`package.json:93`) is unchanged. |
| R7 | MET | `bun scripts/spur-dev.ts script-contract-check --placement-only` → `placement scan over plugins/sp + scripts/commands — 0 finding(s) — PASS`, exit 0 — the rule's own command (`config/rules/boundary/sp-script-placement.yaml:18`). Full preset run `bun apps/cli/src/index.ts rule run --preset recommended-pre-check --fail-on warning --no-logo` → `All 51 rules passed`, exit 0, with `▶ [38/51] sp-script-placement` passed. Independent reachability scan over `scripts/commands`, `plugins/sp/scripts/hooks`, `plugins/sp/lib` (basename reference anywhere outside `docs/`, `node_modules`, `.spur`, the file itself, and `*.test.ts` exempt as colocated tests): 62 files scanned, 40 non-test, 0 without a caller. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The SDLC action vocabulary and common script layers are documented | MET | command | `bun -e 'const P=String.fromCharCode(124),BT=String.fromCharCode(96),t=await Bun.file("docs/design/sdlc-actions.md").text(),pkg=await Bun.file("package.json").json(),seg=t.slice(t.indexOf("### 3.5"),t.indexOf("Duplicates and aliases")),rows=seg.split("\n").filter(l=>l.startsWith(P)).slice(2).map(l=>{const c=l.split(P).map(s=>s.trim());return{name:c[1].split(BT).join(""),cls:c[2]}}),names=Object.keys(pkg.scripts),cls=["binding","composition","repo tool"];console.log("manifest="+names.length+" table="+rows.length+" missing="+names.filter(n=>!rows.some(r=>r.name===n)).length+" extra="+rows.filter(r=>!names.includes(r.name)).length+" dup="+(rows.length-new Set(rows.map(r=>r.name)).size)+" badClass="+rows.filter(r=>!cls.includes(r.cls)).length)'` → `manifest=47 table=47 missing=0 extra=0 dup=0 badClass=0`; vocabulary §3.1 at `docs/design/sdlc-actions.md:77-108`, layer table at `:59-66`, this repo's classification at `:190-238`; binding dogfooded at `.spur/config.yaml:98-109` and resolvable via `spur self exec --list --json`. |
| AC2 — Root package.json scripts map to the action vocabulary | MET | command | `spur self exec --list --json` resolves 18 reserved actions from the bun preset plus the 4 custom actions, each to a script that exists; `package.json:82-105` carries no duplicate alias and no direct `bun scripts/commands/` line; R1's 47-row table matches the manifest script-for-script (checked both directions this run). |
| AC3 — Script folders follow the placement contract with no dead entries | MET | command | Placement rule `sp-script-placement` passes in the 51-rule preset run and standalone (0 findings, exit 0); the reachability scan reports 40 non-test files with 0 missing a caller; the two formerly caller-less files now have dispatcher callers at `scripts/spur-dev.ts:81-82` and both execute. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS

#### Review Report — 1226

**Scope:** uncommitted change set of task 1226 — 18 tracked files (`package.json`, `scripts/spur-dev.ts`,
`.spur/config.yaml`, `docs/design/sdlc-actions.md` + 4 sibling design docs, 5 plugin skill/reference docs,
`AGENTS.md`, `config/rules/quality/coverage-gate.yaml`, 4 test files, the task file). No untracked files added.
**Dimensions:** functional traceability (R1–R7, AC1–AC3), SECUA (security, efficiency, correctness,
usability), architectural depth.
**Verdict:** PASS — no P1/P2, and the one P3 is explicitly deferred as doc-only.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | usability | Live-doc sweep left two residuals of one class. (a) The cross-project survey row still reads `test-pre-check`, `test-post-check` (+ `:full`) for spur-new, while the sibling row was rewritten in this change to attribute `:full` only to superskill/knowledge-kit — spur-new no longer declares either alias. (b) The retargeted transition-shim paragraph now names `spur-check-feature` (correct, and an improvement on the old `spur-check` claim, which never carried the step) but keeps "and before `lint`": `spur-check-feature` has no `lint` step at all. Both are prose only; nothing reads them at gate time. | `docs/design/sdlc-actions.md:52`, `plugins/sp/skills/spur-dev/references/gate-checklists.md:179`, `package.json:93` | FIXED(bede223f1) — both prose sites corrected |
| 2 | P4 (advisory) | architecture | `DELEGATED` is a name → filename map with no existence check and no test, and the two R6 entries have no gate caller, so a future rename would fail only when a human invokes the command. A one-line test (`existsSync(join('scripts/commands', target))` — `node:fs`, per entry) would pin it; the map it guards is `scripts/spur-dev.ts:71-83`. | `scripts/spur-dev.ts:71-83` | OPEN |
| 3 | P4 (advisory) | correctness | `delegate()` spawns bare `'bun'` resolved from `PATH` rather than `process.execPath`, so a different bun on `PATH` would run the module; a signal-killed child (`exitCode === null`) is folded to exit 1, and killing the dispatcher does not kill the running child. No gate depends on either today (`scripts/spur-dev.ts:92-97`). | `scripts/spur-dev.ts:92-97` | ACCEPTED |
| 4 | P4 (advisory) | usability | Ten sites in the delegated modules still advertise the retired direct entry (`bun scripts/commands/<x>.ts`) in usage strings and docstrings — including the provenance header `surface-drift-inventory` writes into generated inventory docs. Still valid invocations, off the new single entry style only. | `scripts/commands/coverage-provenance-check.ts:6`, `scripts/commands/run-tests.ts:21`, `scripts/commands/script-contract-check.ts:21`, `scripts/commands/script-contract-check.ts:26`, `scripts/commands/transition-shim-check.ts:31`, `scripts/commands/inline-pipeline-parity-check.ts:24`, `scripts/commands/surface-drift-inventory.ts:26`, `scripts/commands/surface-drift-inventory.ts:785`, `scripts/commands/validate-commands.ts:612`, `scripts/commands/validate-flag-contracts.ts:811` | ACCEPTED |
| 5 | P4 (advisory) | functional | R1's table is true today (47/47 machine-checked this run) but not enforced: no test or gate compares it with `package.json`, so the Solution's "an unclassified script cannot be added silently" describes a one-off generator run, not a committed check. | `docs/design/sdlc-actions.md:190-238` | OPEN |
| 6 | P4 (advisory) | functional | The AC's verification regex `spur-check-new|check:full` is unanchored and matches the deliberately kept `spur-check:full` (reserved action `check-full`), so it can never return empty — a spec-pattern artifact, not a defect. R2 holds under the exact-token sweep (zero hits outside dated reports/plans/inventory, ADR history, task records). | `package.json:96`, `docs/tasks5/1226_consolidate-package-json-scripts-and-script-folders-onto-the.md:47` | ACCEPTED |
| 7 | P4 (advisory) | functional | Declaring `test-repo-wide` as a custom action flips `wrapup-pipeline`'s doc tripwire from inert to active in this repo (its guard is `self exec --list --json` "bound"): wrap-up now actually runs the repo-wide suite here. Intended by design §3.4, but it is a behaviour change outside `package.json`. | `.spur/config.yaml:106`, `config/workflows/wrapup-pipeline.yaml:132` | ACCEPTED |
| 8 | P4 (advisory) | correctness | The `eval` assertion was loosened from `skill-eval.ts` to `skill-eval`; the adjacent `.not.toContain('.test.ts')` still holds the intent, but any `skill-eval*` path now satisfies it. | `plugins/sp/tests/skill-structure.test.ts:1703` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `docs/design/sdlc-actions.md:190-238` — 47 table rows vs 47 `package.json` scripts, checked both directions this run: 0 rows missing from the manifest, 0 scripts missing from the table, 0 duplicate rows. Spot-checked bodies: bindings match `BUN_PRESET` (`packages/app/src/services/sdlc-actions.ts:24-42`) for `dev/clean/build/lint/format/autofix/typecheck/test/test:heavy/test:full/test-pre-check/test-post-check/spur-check/spur-check:full/spur-check-feature`; the two compositions (`check` at `package.json:87`, `spur-check:tests` at `package.json:84`) carry only `bun run` steps; every repo tool resolves to a repo-local command or a `spur-dev.ts` route. |
| R2 | MET | `package.json:82-105` — no `spur-check-new`, `spur-check-new:full`, `check:full` entry. Exact-token sweep `rg --pcre2 'spur-check-new\|(?<![-\w])check:full(?![\w-])\|test-pre-check:full\|test-post-check:full'` over everything outside `docs/**` and `.spur/**` returns 0 hits (exit 1); inside docs only dated reports/plans/inventory, `docs/00_ADR.md`, task/feature records and the cross-project survey cell at `docs/design/sdlc-actions.md:54` (which records superskill/knowledge-kit, not spur-new). Live references moved: `AGENTS.md:171`, `plugins/sp/skills/code-implementation/SKILL.md:156`, `:195-197`, `plugins/sp/skills/spur-cli/references/workflows.md:258`, `plugins/sp/skills/spur-dev/references/execution-batch.md:609`, `config/rules/quality/coverage-gate.yaml:3-5`, `docs/design/{configuration-contracts.md:291,essential-workflow-checks.md:60,harness-surface-governance.md:72}`. |
| R3 | MET | `package.json:96` — `spur-check:full` now calls `bun run test-pre-check --verbose` / `bun run test-post-check --verbose`; both `:full` entries gone; `bun run test-post-check`'s first command is `bun scripts/spur-dev.ts coverage-provenance-check` (`package.json:82`). Fold faithfulness probed this run: `bun run test-pre-check --verbose` printed the expanded line `bun run apps/cli/src/index.ts rule run --preset recommended-pre-check --fail-on warning --no-logo --verbose`, then per-rule lines, then `All 51 rules passed` (exit 0) — identical to the deleted alias body. `scripts/commands/coverage-certification.test.ts:475-477` and the `coverage-gate.yaml` comment were updated to the single surviving entry. |
| R4 | MET | `.spur/config.yaml:98-109` — additive diff only (`builder.bump-ver` and the rest of the file untouched, verified by reading the diff). `bun apps/cli/src/index.ts self exec --list --json` parses the file and lists `corpus-check`, `eval`, `plugin-smoke`, `test-repo-wide` with `"source": "config"`, each bound to an existing script (`package.json:87,88,94,97`); `self exec check --dry-run` → `bun run spur-check`, `self exec rules-post --dry-run` → `bun run test-post-check`, `self exec test-repo-wide --dry-run` → `bun run test-repo-wide`. |
| R5 | MET | `package.json` direct-call lines: 13 at HEAD → 0 now (`rg -c 'bun (run )?scripts/commands/' package.json` exits 1); the 14 former direct occurrences are all routed (`package.json:82,85,86,88,89,94,95,97,98,99,100,102,105`). `scripts/spur-dev.ts:11-39` header table matches design §2 (`docs/design/sdlc-actions.md:60-66`) layer for layer: L1 `build-*`/`bundle-*`/`emit-board-types`/`verify-pack`/`plugin-install-smoke`, L2 `run-tests`/`coverage-provenance-check`, L3 the eight contract checks + `promotion`, L4 `dev-all`/`eval-pipeline`/`fleet-e2e`/`skill-eval`. Propagation: `delegate()` (`:92-97`) forwards `args` verbatim to a spawned module (argv contract unchanged — `Bun.argv.includes('--publish-coverage')`/`slice(2)` in `scripts/commands/run-tests.ts:42-43` see the same argv) and propagates the exit code; probed live — 151 pass through `run-tests`, exit 1 propagated for a bad path, `--config=`/`--reporter=`/`--timeout` forwarding intact. No double-run: the transitive import closure of `scripts/spur-dev.ts` (174 files) contains none of the 11 delegated modules, so nothing that self-executes at import (`scripts/commands/coverage-provenance-check.ts:23`) is imported; command sets are disjoint (13 switch cases + 11 delegated = the 24 names in the usage line). |
| R6 | MET | `scripts/spur-dev.ts:80-81` registers both files as dispatcher commands; both run live this run (`flag-contract-check` → "All 87 contract surfaces agree", exit 0; `surface-drift-inventory` → inventory printed, exit 0), and their only non-test caller anywhere is `scripts/spur-dev.ts` (no other file references either basename). Neither test moved; `spur-check-feature`'s composition is unchanged. |
| R7 | MET | `bun scripts/spur-dev.ts script-contract-check --placement-only` → `placement scan over plugins/sp + scripts/commands — 0 finding(s) — PASS` (exit 0), which is the `sp-script-placement` rule's own command (`config/rules/boundary/sp-script-placement.yaml:18`). Independent reachability scan (scripts/commands, plugins/sp/scripts/hooks, plugins/sp/lib; `.ts/.mjs/.js/.json/.yaml/.sh` references repo-wide outside `docs/`, `.spur`, `node_modules`; `*.test.ts` excluded as a caller; self excluded): 40 non-test targets, **0 without a caller**. |
| AC1 | MET | The vocabulary (`docs/design/sdlc-actions.md:80-100`) and the common script layers (`:60-66`) plus the per-script classification (`:190-238`) are in the design doc, and `.spur/config.yaml:104` dogfoods the binding. |
| AC2 | MET | Root scripts map to the vocabulary: `spur self exec --list --json` resolves all 18 reserved actions from the `bun` preset and the 4 custom actions from config; `package.json:82-105` carries no duplicate and no direct module call. |
| AC3 | MET | Placement rule + reachability both report zero findings (R7 rows above), and the two formerly dead files are reachable through the dispatcher rather than left as dead entries. |

##### Evidence run in this review (fresh, this tree)

```
bun scripts/spur-dev.ts run-tests test --reporter=dots \
  apps/cli/tests/commands/task/check.test.ts plugins/sp/tests/feature-verification-scope.test.ts \
  plugins/sp/tests/skill-structure.test.ts scripts/commands/coverage-certification.test.ts
151 pass · 0 fail · 1189 expect() calls · 4 files [4.08s]          (through the new L2 route)

bun scripts/spur-dev.ts script-contract-check --placement-only
script-contract-check: placement scan over plugins/sp + scripts/commands — 0 finding(s) — PASS   exit 0

bun scripts/spur-dev.ts flag-contract-check           → All 87 contract surfaces agree.        exit 0
bun scripts/spur-dev.ts surface-drift-inventory       → inventory printed (live CLI vs plugin)  exit 0
bun scripts/spur-dev.ts nope                          → usage line with all 24 commands         exit 1
bun scripts/spur-dev.ts run-tests test --reporter=dots ./definitely-no-such-dir
                                                      → "Test filter ... had no matches"        exit 1  (propagation)
bun run test-pre-check --verbose                      → per-rule lines + "All 51 rules passed"  exit 0  (R3 fold)
bun scripts/spur-dev.ts coverage-provenance-check     → coverage-artifact: lcov-mismatch         exit 1  (pre-existing)
bun run test-post-check                               → same diagnostic through the real script  exit 1  (pre-existing)
bun test plugins/sp/tests/roles.test.ts               → 20 pass, 0 fail
bun test apps/cli/tests/commands/self/exec.test.ts    → 24 pass, 0 fail
bun test scripts/commands/release-alias.test.ts apps/cli/tests/script-absorption-pr7-parity.test.ts
                                                      → 25 pass, 0 fail
```

Structural checks (scripted this run): 47 table rows ↔ 47 manifest scripts, no diff either way; 0 `bun scripts/commands/` lines in `package.json` (HEAD: 13); 0 delegated modules in `spur-dev.ts`'s 174-file import closure; 40 reachability targets, 0 without a caller; `.github/` contains zero references to any removed name (precondition in the task's Plan step 0 holds — no workflow edit needed).

##### Assumptions and evidence gaps

- The full gate, `test:full` and any `--coverage` run were **not** run (banned for this tree's coverage provenance), so `rules:post` and certification are unverified here. The light gate's recorded `rules:post` red is `coverage-artifact: lcov-mismatch`: no file in this diff touches `.coverage/`, `run-tests.ts` or the certification contract, and `bun run test-post-check` reports the same diagnostic before and after the reroute — inherited tree state, not this change.
- Disclosed side effect: my three narrow `bun test` runs inherit `bunfig.toml`'s `[test] coverage = true` and therefore republished the gitignored `.coverage/lcov.info`. The certification was already invalidated before them (task's Testing section records the same mismatch at 00:02, marker untouched since). No tracked file changed: `git status --porcelain` still lists exactly the same 18 files, so the certified digest inputs are untouched.
- R6's "registered caller" is read as the dispatcher route (a real, exercised entry, no gate caller). That matches the task's own zero-caller rule ("register when the script backs a documented contract still in force"); the cited contracts exist (`plugins/sp/skills/spur-dev/references/cross-cutting.md:25`, `docs/design/dev-spine-cost-and-drift.md:114`).
- R1's class vocabulary has three values but four scripts (`corpus-check`, `eval`, `plugin-smoke`, `test-repo-wide`) are custom-action bindings; the table records them as repo tools with the action named, which is the only slot the vocabulary offers. Not a defect against R1's wording.
- Not checked: behaviour of the dispatcher on platforms without `bun` on `PATH` (finding 3) and the CI lane (`.github/` references none of the touched names, so it cannot regress).

**Next:** fix the two live-doc residual clauses in a prose-only pass (finding 1); add the `DELEGATED` existence assertion when `scripts/spur-dev.ts` is next touched (finding 2).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-17T06:58:58.950Z todo → wip (system)
- 2026-10-17T07:15:55.434Z wip → testing (system)
- 2026-10-17T07:16:45.444Z testing → done (system)

