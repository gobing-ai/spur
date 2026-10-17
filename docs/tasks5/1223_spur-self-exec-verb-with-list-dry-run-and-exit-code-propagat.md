---
schema_version: 1
name: spur self exec verb with list, dry-run and exit-code propagation
status: done
template: feature-impl
created_at: 2026-10-17T04:04:39.231Z
updated_at: "2026-10-17T05:58:20.931Z"
feature_id: A92
priority: P1
tags:
  - cli
  - self
estimate_hours: 4

dependencies: ["1222"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1223-verdict.json
---

## 1223. spur self exec verb with list, dry-run and exit-code propagation

### Background

Feature A92 (docs/design/sdlc-actions.md §3.3). Operator-named public verb `spur self exec <action>`; runs a bound action in the project root. Covers R3, R4.

**Refine corrections (2026-10-16)**
- Verbs under `self` are registered from apps/cli/src/index.ts:264 (`program.command('self')`), with each verb in its own file (maintain.ts:16) → exec.ts registers through the same selfCommand block; no other wiring point.

### Requirements

- [x] R1. `spur self exec <action>` runs a resolved string action via `sh -c` in the project root, inherits **stdout/stderr** (stdin is not forwarded — the shared `ProcessExecutor` seam fixes `stdin: 'ignore'` by package policy), sets `SPUR_ACTION=<name>` for the child, and exits with the child's exit code.
- [x] R2. `-- <args>` are shQuote'd and appended to a string action; a composite with extra args exits 2 with `composite action "<a>" does not accept arguments`.
- [x] R3. A composite runs its steps in order, stops at the first non-zero exit (spur exits with that code), and prints `▶ <step>` per step on stderr.
- [x] R4. `--dry-run` prints the resolved command (or one line per composite step) and runs nothing.
- [x] R5. `--list` prints a table; `--list --json` prints an array of `{ name, reserved, source, command? , steps? }` for every reserved and declared action.
- [x] R6. An unbound action exits 2 with `action "<a>" is not bound; add builder.actions.<a> to .spur/config.yaml`; a missing action argument without `--list` exits 2 with usage.
- [x] R7. `--json` without `--list` prints a final `{ action, steps: [{ name, exitCode, durationMs }], exitCode }` after streaming.
- [x] R8. The spur-cli self reference (plugins/sp/skills/spur-cli/references) and docs/design/sdlc-actions.md §3.3 document the verb and flags.

Out of scope: changing any workflow/engine default (1224); init (1225); parallel composites; env-var templating in commands.

### Acceptance Criteria

- [x] AC1 — spur self exec runs a configured action and propagates its exit code
- [x] AC2 — spur self exec lists actions with their source

Requirement map: AC1 → R1, R2, R3, R4, R6, R7; AC2 → R5, R8. Test layer: apps/cli/tests/commands/exec.test.ts spawning the real CLI (E2E).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T04:05:53.272Z

- Owner noun is `self`, not `builder`: `self` owns project-local operations; `builder` is release plumbing.
- The operator named the verb; the flag set (--list, --dry-run, --json, --) is recorded in docs/design/sdlc-actions.md §3.3 and the operator confirms it at this task's review.

#### Q&A entry — 2026-10-17T04:16:42.791Z

- Owner noun is `self`, not `builder` (closed: ADR-139).
- The operator named the verb; the flag set (--list, --dry-run, --json, --) is recorded in docs/design/sdlc-actions.md §3.3 and is confirmed by the operator at this task's review (deferred, owner: operator, at review of 1223).
- Exit 2 for usage/unbound mirrors commander usage errors (closed).

#### Q&A entry — 2026-10-17T05:22:10.000Z

- R1's "inherits stdio" is qualified to **stdout/stderr** (review finding, P2). The child's stdin is
  not forwarded because the shared seam `@gobing-ai/ts-runtime` `ProcessExecutor` fixes
  `stdin: 'ignore'` as documented package policy (`dist/process-executor.d.ts:12` — "stdout/stderr
  inherit and stdin ignored") and is a released dependency.
- Closed route: qualify the requirement and state the policy on every operator surface (verb
  `--help`, `docs/design/cli-contracts.md`, `docs/design/sdlc-actions.md` §3.3, the spur-cli `self`
  reference). Rejected: forking/bypassing the seam or adding `Bun.spawn`/`node:child_process`, which
  the `no-direct-process-spawn` rule forbids. Behaviour is unchanged and the public surface does not move.
- `--dry-run --json` now emits `[{ name, command }]` instead of silently ignoring `--json` (review
  finding, P3); plain `--dry-run` text output is unchanged.

### Design

WHAT: thin CLI transport over `packages/app/src/services/sdlc-actions.ts` (1222).
WHERE: new `apps/cli/src/commands/exec.ts` exporting `registerExecCommand(self: Command, context: CliContext, options?: { hidden?: boolean })`, wired in the `selfCommand` block at apps/cli/src/index.ts:264; tests under `apps/cli/tests/commands/exec.test.ts`.

Frozen surface: `spur self exec [action] [-- args...]` with `--list`, `--dry-run`, `--json`. Exit codes: child's code; 2 for unbound/usage/composite-args. Env: `SPUR_ACTION`. Project root = the CLI's resolved project root (same as other self verbs), not cwd.

Execution: `spawnSync('sh', ['-c', command], { cwd: root, stdio: 'inherit', env: { ...process.env, SPUR_ACTION } })` per step; composite steps recurse through `resolveAction` (cycles already rejected at load).

Why `self`: it owns project-local operations (init/status/migrate/serve/maintain); `builder` is release plumbing. The operator named the verb; the flag set is confirmed by the operator at this task's review (public-surface consent).

Anti-patterns: no in-CLI resolution logic (resolver only); no output capture/buffering (stream); do not swallow the child exit code into 1; no stack guessing when unbound.

Handoff: 1224 invokes `${spurBin:-spur} self exec <action>` from workflow vars and relies on R1/R3 exit semantics; 1227 cites this verb in plugin prose.

### Plan

1. List failure modes: unbound, composite with args, child non-zero, missing config file (bun preset still applies), no action and no --list.
2. Add exec.ts and register it under selfCommand (R1, R6).
3. Implement run / composite runner / dry-run / list / json paths (R2–R5, R7).
4. E2E in apps/cli/tests/commands/exec.test.ts: spawn the real CLI against a temp project fixture with `.spur/config.yaml` (exit-3 command, composite with a failing middle step, unbound, `--list --json`, `--dry-run`); persist captured stdout/stderr/exit codes under the test tmp dir as the artifact.
5. Update the spur-cli self reference and satellite §3.3 (R8); `bun run spur-check`.

### Solution

`spur self exec` is a thin transport over `packages/app/src/services/sdlc-actions.ts`: the CLI resolves
the binding, runs it in the project root through the sanctioned `ProcessExecutor` seam, streams the
child's output, and maps exit codes. No resolution logic lives in `apps/cli`. The verb lives in the
`commands/self/` folder noun (like `agent/`, `feature/`), so the surface scanners see one `self` noun
instead of an undocumented top-level `exec` noun.

| Change | Where |
| ------ | ----- |
| R1 — run via `sh -c` in the project root (`cwd: context.cwd`), `SPUR_ACTION` exported to the child, child exit code propagated | `apps/cli/src/commands/self/exec.ts:106-120` |
| R1 — stdout/stderr inherited, stdin not forwarded (shared `ProcessExecutor` seam policy), stated in the verb's `--help` | `apps/cli/src/commands/self/exec.ts:31-37` |
| R1 — `registerSelfCommand` composes `exec` beside the five legacy self verbs; wired from the composition root | `apps/cli/src/index.ts:266` |
| R1 — folder-noun registration (`exec` + the five legacy verb builders), named for `cli-register-pattern` | `apps/cli/src/commands/self/index.ts:10-20` |
| R2 — trailing `-- <args>` `shQuote`'d and appended to a string action; composite refuses them | `apps/cli/src/commands/self/exec.ts:130-132` |
| R3 — composite steps flattened through `resolveAction`, `▶ <step>` echoed on stderr, stop at the first non-zero exit | `apps/cli/src/commands/self/exec.ts:104-118` |
| R4 — `--dry-run` prints the resolved command (one line per composite step) and runs nothing | `apps/cli/src/commands/self/exec.ts:90` |
| R4 — `--dry-run --json` emits `[{ name, command }]` per resolved step instead of ignoring `--json` | `apps/cli/src/commands/self/exec.ts:93` |
| R5 — `--list` table and `--list --json` rows over `listActions` (`name`, `reserved`, `source`, `command` \| `steps`) | `apps/cli/src/commands/self/exec.ts:49` |
| R6 — unbound action and missing action both exit 2 with the actionable message / usage | `apps/cli/src/commands/self/exec.ts:125` |
| R7 — `--json` (non-list) prints the final `{ action, steps, exitCode }` after streaming | `apps/cli/src/commands/self/exec.ts:119` |
| R8 — command contract: the `self` noun lists `exec`, §1.1 carries the verb contract and the stdin policy | `docs/design/cli-contracts.md:104` |
| R8 — `exec` in the `self` verb map plus a verb section (flags, exit codes, `--json` shapes, stdin policy) | `plugins/sp/skills/spur-cli/references/self.md:20` |
| R8 — help tree: `spur self exec` documented on the `status` page in both trees (self's owning-page union) | `docs/help/cmd_status.md:64` |
| R8 — noun×verb matrix: `exec` row, `self` count 5→6, unique verbs 76, cells 103 | `docs/help/spur-cli-matrix.md:42` |
| Wiring — resolver + `shQuote` subpath exports the CLI imports | `packages/app/package.json:15` |
| Shared option registry — `--dry-run` text for this verb (no inline literal, 0618 parity) | `apps/cli/src/commands/shared-options.ts:107` |
| E2E + in-process evidence — real-CLI subprocess suite plus a dispatcher-driven block covering every branch (100% funcs/lines) | `apps/cli/tests/commands/self/exec.test.ts:65` |

`docs/design/sdlc-actions.md` §3.3 needed two corrections rather than none: the placement sentence
now names `apps/cli/src/commands/self/exec.ts` reached through `registerSelfCommand`, and the runtime
bullet states that only stdout/stderr are inherited (the shared seam never forwards stdin); it also
records the `--dry-run --json` shape. Those, the command contract, both help trees, and the matrix
carry the R8 documentation.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/commands/self/exec.ts:106-120` runs `sh` with `-c <command>`, `cwd: context.cwd` (the resolved project root, `apps/cli/src/context.ts:132`), `env: { SPUR_ACTION: action }`, then sets the process exit code from the child result (`:115`, `:120`); the executor built at `apps/cli/src/commands/self/exec.ts:101` uses stream + isTTY, so stdout/stderr are inherited, and stdin is not forwarded because the seam hard-codes `stdin: 'ignore'` (@origin `node_modules/@gobing-ai/ts-runtime/src/process-executor.ts` line 802) — stated in the verb help at `apps/cli/src/commands/self/exec.ts:31-37`. Test `apps/cli/tests/commands/self/exec.test.ts:105-114` asserts exit 3 propagation and `SPUR_ACTION=env-write` landing in the project root. Live probes: `spur self exec exit-3` → exit 3; `spur self exec env-write` → exit 0, `env.txt` contains `env-write`. |
| R2 | MET | `apps/cli/src/commands/self/exec.ts:130-132` appends each trailing argument through `shQuote` (`packages/app/src/services/shell-quote.ts:10-12`); a composite given arguments is refused at `apps/cli/src/commands/self/exec.ts:70-73`. Tests `apps/cli/tests/commands/self/exec.test.ts:133-137` (stdout `[--my-flag][a b]`) and `apps/cli/tests/commands/self/exec.test.ts:178-182` (exit 2 plus the exact refusal text). Live: `spur self exec echo-args -- --my-flag 'a b'` → `[--my-flag][a b]`, exit 0; `spur self exec fail-mid -- --verbose` → `composite action "fail-mid" does not accept arguments`, exit 2. |
| R3 | MET | `apps/cli/src/commands/self/exec.ts:104-118`: `▶ <step>` goes to stderr at `:105` for composite plans, the loop breaks on the first non-zero exit at `:117`, and that code is set at `:120`; nested composites flatten through the resolver at `:75-87`. Tests `apps/cli/tests/commands/self/exec.test.ts:139-146` (stderr carries `▶ ok-step` and `▶ fail-step`, not `▶ after-step`; exit 7; `after-ran` absent) and `apps/cli/tests/commands/self/exec.test.ts:301-311` (nesting and first-failure stop). Live composite probe: exit 7, two step lines, `after-ran` absent. |
| R4 | MET | `apps/cli/src/commands/self/exec.ts:90-97` returns before any executor exists: text output is one resolved command per line, `--json` emits `[{ name, command }]`. Tests `apps/cli/tests/commands/self/exec.test.ts:115-131` assert both renderings and that the would-be step artifact is never created. Live: `--dry-run` printed `exit 0`, `exit 7`, `touch after-ran`, exit 0, no `after-ran` file; `--dry-run --json` printed the three `{ name, command }` objects. |
| R5 | MET | List renderings at `apps/cli/src/commands/self/exec.ts:49-52`, row shape at `:135-140`, table at `:143-169`. Tests `apps/cli/tests/commands/self/exec.test.ts:70-91` assert 25 rows (18 reserved + 7 declared), `{ name, reserved, source }` on every row, `source` values `default`/`config`/`unbound`, and composite `steps`; `apps/cli/tests/commands/self/exec.test.ts:93-99` asserts the NAME/SOURCE/COMMAND table. Live `--list --json`: 25 rows, every row carries name/reserved/source, `rules-pre` → `default`, `exit-3` → `config` with its command, `fail-mid` → its step list. |
| R6 | MET | Missing action refused at `apps/cli/src/commands/self/exec.ts:55-58`; unbound action at `:60-63` with the exact message at `:125-127`; both route through `fail` → `setExitCode(2)` at `:44-47`. Tests `apps/cli/tests/commands/self/exec.test.ts:166-176`. Live: `spur self exec check` → exit 2, `action "check" is not bound; add builder.actions.check to .spur/config.yaml`; `spur self exec` → exit 2, `usage: spur self exec <action> ...`. |
| R7 | MET | `apps/cli/src/commands/self/exec.ts:119` writes `{ action, steps: [{ name, exitCode, durationMs }], exitCode }` after the streaming loop, then `:120` sets that exit code. Test `apps/cli/tests/commands/self/exec.test.ts:148-163` asserts the shape, per-step name/exitCode/durationMs, summary exitCode 3, and process exit 3. Live `spur self exec exit-3 --json`: identical JSON with `exitCode: 3`, exit 3. |
| R8 | MET | Both required surfaces document the verb and every flag: `docs/design/sdlc-actions.md:142-166` (surface block plus run/args/list/unbound/composite bullets, stdin policy, placement) and `plugins/sp/skills/spur-cli/references/self.md:20-62` (verb-map row, run/args/list/dry-run examples, exit table, stdin policy, `--json` shapes). Supporting surfaces: `docs/design/cli-contracts.md:104-124`, `docs/help/cmd_status.md:66-83`, `docs/help2/status.md:41-56`, `docs/help/spur-cli-matrix.md:42`. Fresh parity runs: `apps/cli/tests/help-doc-parity.test.ts` → 2 pass / 0 fail; `plugins/sp/tests/help-docs-parity.test.ts` + `plugins/sp/tests/cli-surface-parity.test.ts` → 25 pass / 0 fail, so the documented surface equals the registered CLI. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — spur self exec runs a configured action and propagates its exit code | MET | test | R1, R2, R3, R4, R6, R7 rows are MET. `apps/cli/tests/commands/self/exec.test.ts:105-182` covers exit-code propagation, `SPUR_ACTION`, arg append, composite stop-at-failure, dry-run, JSON summary, and all three exit-2 refusals; `(cd apps/cli && bun test apps/cli/tests/commands/self/exec.test.ts)` → 24 pass / 0 fail / 77 expect. Live probes against a throwaway project root: `exit-3` → exit 3, `fail-mid` → exit 7 with `▶` lines on stderr, `check` → exit 2 with the builder.actions remediation. |
| AC2 — spur self exec lists actions with their source | MET | test | R5 and R8 rows are MET. `apps/cli/tests/commands/self/exec.test.ts:70-99` asserts the `--list --json` inventory (25 rows, `source` on each, composite `steps`) and the `NAME`/`SOURCE`/`COMMAND` table; `plugins/sp/tests/help-docs-parity.test.ts` → 3 pass / 0 fail confirms documented cells and counts equal the live surface. Live `spur self exec --list --json` → 25 rows, each with `name`, `reserved`, `source`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS

#### Review Report — 1223 (`spur self exec`), round 3

**Scope:** the task's full change set, base `a0ee73abe` → working tree — `git diff a0ee73abe -- .` (13 files: 838+/24-)
= implementation commit `0424af573` plus the uncommitted round-3 doc fix `plugins/sp/skills/spur-cli/references/self.md`
(+5/−2). Code is byte-identical to `0424af573` (`git diff 0424af573 -- apps packages` → empty); no untracked files remain
under `apps/cli/src/commands/self/` or `apps/cli/tests/commands/self/` (both committed).
**Dimensions:** functional traceability (R1–R8, AC1, AC2), SECUA, architectural depth.
**Verdict:** PASS — R1–R8 and both ACs are MET, round 2's single open P3 is verified closed in the tree **and** live, and
no P1–P3 row remains open. Seven round-2 ACCEPTED advisories are carried plus one new P4 observation; all are `ACCEPTED`
and none blocks `done`.

##### Round-2 P3 closure (re-verified in the tree and live, not taken on trust)

| Round-2 finding | State | Evidence |
|---|---|---|
| P3 — the R8 self reference claimed **every** `self` verb has a legacy top-level hidden alias, false for `exec` | CLOSED | Description now enumerates the five legacy verbs and states the exception (`plugins/sp/skills/spur-cli/references/self.md:3`); the body preamble reads "Five of them are the canonical path …" (`:9-14`) and a new paragraph states "`exec` is the exception: it exists only as `spur self exec` — there is no `spur exec` top-level alias (`spur exec <action>` is an unknown command)" (`:16-17`). Both halves check out live: `spur exec build` → `error: unknown command 'exec'`, exit 1; the five aliases still work hidden (`spur init --help` exit 0, none of `init/maintain/migrate/serve/status` in `spur --help`, `spur self --help` lists six verbs incl. `exec`). |

**Class sweep for the round-2 finding.** Every surface that states the alias scope is now accurate: `docs/design/cli-contracts.md:51-57`
("Each of the five legacy verbs … `exec` … is the one self verb with no legacy alias"), `docs/help/spur-cli-matrix.md:9-12`
("Five of them mount the same command builders … `exec` runs the project's …"), `plugins/sp/skills/spur-cli/references/self.md:3,:9-17`,
and `plugins/sp/skills/spur-cli/SKILL.md:148-149` ("the five legacy top-level nouns remain hidden aliases"). No false alias
claim survives. The residue is three **incomplete** enumerations (they list five verbs, omit `exec` without asserting anything
false) — recorded as finding 1, P4.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | documentation | Three self-verb *enumerations* in the skill/help index layer omit `exec` (they still list only `init/maintain/migrate/serve/status`). No false statement — R8's named surfaces (`references/self.md`, `docs/design/sdlc-actions.md §3.3`) and both help trees document the verb — but an agent that only reads the skill index will not discover `spur self exec`. Same class and same call as round 2's index-drift advisory (`docs/help/index.md:46`, row 6): an index-page completeness gap, not a contract violation. | `plugins/sp/skills/spur-cli/SKILL.md:50`, `plugins/sp/skills/spur-cli/SKILL.md:148-149`, `docs/help/index.md:46` | ACCEPTED |
| 2 | P4 (advisory) | documentation | Carried from round 2, unchanged by this round's fix: `--list --json` rows are described as carrying `command` or `steps`, but an `unbound` row carries neither; a consumer must branch on `source`. | `plugins/sp/skills/spur-cli/references/self.md:59` (was `:56`) | ACCEPTED |
| 3 | P4 (advisory) | usability | Carried from round 2: "`--json` without `--list` prints a final summary" is literally false for `--dry-run --json`, which prints the `[{ name, command }]` array; the preceding sentence on two of the three surfaces resolves it for a reader. | `plugins/sp/skills/spur-cli/references/self.md:61-62` (was `:58-59`) | ACCEPTED |
| 4 | P4 (advisory) | testing | Carried from round 2: nothing pins the now-documented stdin policy (`rg stdin apps/cli/tests/commands/self/exec.test.ts` → no hits), so a future seam change would silently falsify four doc surfaces. | `apps/cli/tests/commands/self/exec.test.ts:104-164` | ACCEPTED |
| 5 | P4 (advisory) | architecture | Carried from round 2: the CLI flag-parity guard skips the whole `self` subtree ("container re-registering the five legacy nouns"), so `exec`'s `--list`/`--dry-run` rows sit outside that invariant (suite is green: 2 pass). | `apps/cli/tests/help-doc-parity.test.ts:44-47` (round-2 citation `:51-53` was approximate) | ACCEPTED |
| 6 | P4 (advisory) | documentation | Carried from round 2: `docs/help/index.md` lists five `self` verbs and is broadly stale beyond this task (says `task` has 18 verbs where the matrix says 25) — page drift the task did not create. | `docs/help/index.md:46` | ACCEPTED |
| 7 | P4 (advisory) | architecture | Carried from round 1/2: composite flattening and `-- <args>` appending live in the verb and `sdlc-actions.ts` exports no `planAction`, so "no resolution logic in `apps/cli`" is slightly overclaimed; nothing needs the export yet (1224 reads the same data through `self exec --json`). Scoped placeholders still run literal until 1224 renders them. | `apps/cli/src/commands/self/exec.ts:64-88`, `packages/app/src/services/sdlc-actions.ts:100-127` | ACCEPTED |
| 8 | P4 (advisory) | usability | Carried from round 1/2: an unknown option exits 1 (commander) while the verb's own refusals exit 2, so the Q&A's "exit 2 mirrors commander usage errors" does not hold; consumers only need non-zero. | `apps/cli/src/commands/self/exec.ts:44-47` | ACCEPTED |

##### Functional Traceability

Code is unchanged this round (`git diff 0424af573 -- apps packages` empty), so every MET verdict below stands on the same
evidence plus this round's fresh test runs.

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `sh -c` in the resolved project root, `SPUR_ACTION` exported, child exit code propagated — `apps/cli/src/commands/self/exec.ts:105-120`; stdout/stderr inherited + streamed, stdin not forwarded (documented in `--help`, verified live: `spur self exec --help` → "stdin is not forwarded by the shared process seam"); E2E in `apps/cli/tests/commands/self/exec.test.ts` (24 pass, exit-code propagation and `SPUR_ACTION` asserted); seam policy at @origin `node_modules/@gobing-ai/ts-runtime/src/process-executor.ts` line 802 (`stdin: 'ignore'`). |
| R2 | MET | `shQuote`'d append `apps/cli/src/commands/self/exec.ts:130-132`; composite refusal `:71-75`; quoting rule `packages/app/src/services/shell-quote.ts:12-14`; injection attempt covered by the E2E argv-quoting case. |
| R3 | MET | `▶ <step>` on stderr and stop at the first non-zero exit `apps/cli/src/commands/self/exec.ts:104-118`; nested composites flattened through `resolveAction` `:75-87`; E2E `apps/cli/tests/commands/self/exec.test.ts` (failing middle step + nested case). |
| R4 | MET | `apps/cli/src/commands/self/exec.ts:90-96` — text prints one line per resolved step, `--dry-run --json` prints `[{ name, command }]`, nothing executes; E2E `apps/cli/tests/commands/self/exec.test.ts:122-131`. |
| R5 | MET | Table `apps/cli/src/commands/self/exec.ts:148-176`; JSON rows `:49-52` + `:134-140`; E2E asserts row count, `source` values and composite `steps`. |
| R6 | MET | Unbound message `apps/cli/src/commands/self/exec.ts:124-127`, usage `:55-58`, both exit 2; E2E covers both. |
| R7 | MET | `apps/cli/src/commands/self/exec.ts:119` — final `{ action, steps: [{ name, exitCode, durationMs }], exitCode }` after streaming; E2E `apps/cli/tests/commands/self/exec.test.ts:148-162`. |
| R8 | MET | Both required surfaces document the verb and flags — `docs/design/sdlc-actions.md:145-163`, `plugins/sp/skills/spur-cli/references/self.md:20-62` — plus `docs/design/cli-contracts.md:51-57,104-124`, `docs/help/cmd_status.md:64-83`, `docs/help2/status.md:39-56`, matrix row and counts `docs/help/spur-cli-matrix.md:42,:103,:119`. Live drift is now only the finding-1 index omission; the false-alias sentence that failed round 2 is gone. |
| AC1 | MET | R1, R2, R3, R4, R6, R7 MET; `bun test apps/cli/tests/commands/self/exec.test.ts` → 24 pass / 0 fail / 77 expects, `apps/cli/src/commands/self/exec.ts` and `.../self/index.ts` at 100.00 funcs / 100.00 lines. |
| AC2 | MET | R5 + R8: inventory with `source` on both `--list` renderings, `plugins/sp/tests/help-docs-parity.test.ts` R3 confirms the matrix cells/counts equal the live surface. |

##### Verification evidence (fresh, this review; no formatter, no full gate)

- `bun test apps/cli/tests/commands/self/exec.test.ts` → **24 pass / 0 fail / 77 expect() calls**; coverage
  `apps/cli/src/commands/self/exec.ts 100.00 | 100.00`, `apps/cli/src/commands/self/index.ts 100.00 | 100.00`.
- `bun test apps/cli/tests/help-doc-parity.test.ts` → **2 pass / 0 fail**.
- `bun test plugins/sp/tests/help-docs-parity.test.ts` → **3 pass / 0 fail** (new in this round; R2 "every live verb and flag
  is documented in the owning pages of each tree" and R3 "matrix cells, verb counts, and summary equal the live surface" —
  the R8 help/matrix edits are live-accurate).
- `bun test plugins/sp/tests/cli-surface-parity.test.ts` → **22 pass / 0 fail**, including "B: self reference verbs/flags
  match live surface" — the fixed reference still parses and matches the real CLI.
- `bun test apps/cli/tests/spur-cli-parity.test.ts` → **10 pass / 0 fail** (spur-cli SKILL/reference contract).
- Live probes this round: `spur exec build` → `error: unknown command 'exec'`, exit 1; `spur --help` lists no legacy noun;
  `spur self --help` lists `exec init maintain migrate serve status`; `spur self exec --help` states the stdin policy.
- SECUA: unchanged code (`git diff 0424af573 -- apps packages` empty); no direct spawn in the new module
  (`rg 'Bun\.spawn|child_process' apps/cli/src/commands/self` → 0 hits), so `no-direct-process-spawn` holds; action names never
  reach a shell, extra args pass through `shQuote`, command bodies are project-owned config (same trust boundary as a
  `package.json` script).
- Certified digest `sha256:f4c0668cd53a8f63d09bdbdd10b1b3bf9e38bf9a3e564d333efbe8685d5c6561`: untouched — the only working-tree
  diff is one markdown file under `plugins/sp/skills/spur-cli/`, which biome excludes (`biome.json:14` `!**/spur-cli`; verified
  `bunx biome format plugins/sp/skills/spur-cli/references/self.md` → "No files were processed … ignored").

##### Residual risk and assumptions

- Finding 1 is the only new item and is discoverability-only: `spur self exec` is absent from the skill index three-way
  enumeration, so an agent navigating `sp:spur-cli`'s index rather than `references/self.md` will not learn the verb exists.
  Classified P4 to match round 2's identical call on `docs/help/index.md:46`; escalate if the operator wants the index to be a
  complete verb catalog.
- `SPUR_ACTION` for a composite is the operator-requested action name, not the step name — unstated in prose, round-2 noted,
  not re-charged.
- "Project root" means the directory spur resolves the project from, with no upward search (consistent with every other
  `self` verb); 1224 must invoke from the project root.
- Findings 2, 3 and 6 remain open *prose* gaps in files this hop did not touch: the round-3 fix deliberately stayed at the
  "two-line wording fix" scope. Taking them would be one edit each and could be folded into any later doc pass.

**Next:** none required — PASS; the remaining items are ACCEPTED P4 advisories, so the review gate has no open P1–P3 row.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-17T04:56:12.163Z todo → wip (system)
- 2026-10-17T05:57:57.360Z wip → testing (system)
- 2026-10-17T05:58:20.922Z testing → done (system)

