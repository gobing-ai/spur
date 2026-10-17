---
schema_version: 1
name: spur self exec verb with list, dry-run and exit-code propagation
status: wip
template: feature-impl
created_at: 2026-10-17T04:04:39.231Z
updated_at: "2026-10-17T05:32:24.936Z"
feature_id: A92
priority: P1
tags:
  - cli
  - self
estimate_hours: 4

dependencies: ["1222"]
---

## 1223. spur self exec verb with list, dry-run and exit-code propagation

### Background

Feature A92 (docs/design/sdlc-actions.md §3.3). Operator-named public verb `spur self exec <action>`; runs a bound action in the project root. Covers R3, R4.

**Refine corrections (2026-10-16)**
- Verbs under `self` are registered from apps/cli/src/index.ts:264 (`program.command('self')`), with each verb in its own file (maintain.ts:16) → exec.ts registers through the same selfCommand block; no other wiring point.

### Requirements

- [ ] R1. `spur self exec <action>` runs a resolved string action via `sh -c` in the project root, inherits **stdout/stderr** (stdin is not forwarded — the shared `ProcessExecutor` seam fixes `stdin: 'ignore'` by package policy), sets `SPUR_ACTION=<name>` for the child, and exits with the child's exit code.
- [ ] R2. `-- <args>` are shQuote'd and appended to a string action; a composite with extra args exits 2 with `composite action "<a>" does not accept arguments`.
- [ ] R3. A composite runs its steps in order, stops at the first non-zero exit (spur exits with that code), and prints `▶ <step>` per step on stderr.
- [ ] R4. `--dry-run` prints the resolved command (or one line per composite step) and runs nothing.
- [ ] R5. `--list` prints a table; `--list --json` prints an array of `{ name, reserved, source, command? , steps? }` for every reserved and declared action.
- [ ] R6. An unbound action exits 2 with `action "<a>" is not bound; add builder.actions.<a> to .spur/config.yaml`; a missing action argument without `--list` exits 2 with usage.
- [ ] R7. `--json` without `--list` prints a final `{ action, steps: [{ name, exitCode, durationMs }], exitCode }` after streaming.
- [ ] R8. The spur-cli self reference (plugins/sp/skills/spur-cli/references) and docs/design/sdlc-actions.md §3.3 document the verb and flags.

Out of scope: changing any workflow/engine default (1224); init (1225); parallel composites; env-var templating in commands.

### Acceptance Criteria

- [ ] AC1 — spur self exec runs a configured action and propagates its exit code
- [ ] AC2 — spur self exec lists actions with their source

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
| R1 — run via `sh -c` in the project root (`cwd: context.cwd`), `SPUR_ACTION` exported to the child, child exit code propagated | `apps/cli/src/commands/self/exec.ts:106` |
| R1 — stdout/stderr inherited, stdin not forwarded (shared `ProcessExecutor` seam policy), stated in the verb's `--help` | `apps/cli/src/commands/self/exec.ts:33` |
| R1 — `registerSelfCommand` composes `exec` beside the five legacy self verbs; wired from the composition root | `apps/cli/src/index.ts:266` |
| R1 — folder-noun registration (`exec` + the five legacy verb builders), named for `cli-register-pattern` | `apps/cli/src/commands/self/index.ts:15` |
| R2 — trailing `-- <args>` `shQuote`'d and appended to a string action; composite refuses them | `apps/cli/src/commands/self/exec.ts:130` |
| R3 — composite steps flattened through `resolveAction`, `▶ <step>` echoed on stderr, stop at the first non-zero exit | `apps/cli/src/commands/self/exec.ts:105` |
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

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

Verdict: FAIL

#### Review Report — 1223 (`spur self exec`), round 2

**Scope:** the uncommitted change set of task 1223 — `git diff HEAD` (10 modified files) plus untracked
`apps/cli/src/commands/self/{exec,index}.ts` and `apps/cli/tests/commands/self/exec.test.ts` (13 files), re-read fresh
at the current tree state (branch `sp/runall-a92-ae51`).
**Dimensions:** functional traceability (R1–R8, AC1, AC2), SECUA, architectural depth.
**Verdict:** FAIL — every requirement and both ACs are MET, and all three round-1 findings are verified closed in the
tree; the FAIL is one open **P3 (documentation)** item: the R8 reference still promises a legacy `spur exec` alias that
does not exist. No production behaviour needs rework.

##### Round-1 closures (re-verified in the tree, not taken on trust)

| Round-1 finding | State | Evidence |
|---|---|---|
| P2 — R1 "inherits stdio" held only for stdout/stderr | CLOSED | R1 reworded and the Q&A entry recorded (`docs/tasks5/1223_*.md` Requirements + Q&A 2026-10-17T05:22:10Z); the policy is stated on all four surfaces — `apps/cli/src/commands/self/exec.ts:32-33`, `docs/design/cli-contracts.md:113-114`, `plugins/sp/skills/spur-cli/references/self.md:46`, `docs/design/sdlc-actions.md:151-152`. The seam claim checks out: `stdin: 'ignore'` at @origin `node_modules/@gobing-ai/ts-runtime/src/process-executor.ts` line 802, while stream mode really does inherit stdout/stderr (line 806-807), so "stdout/stderr inherited" is accurate. Reproduced: `printf 'hello-world' \| spur self exec read-stdin` → empty stdout, exit 0. |
| P3 — `--dry-run --json` ignored `--json` | CLOSED | `apps/cli/src/commands/self/exec.ts:90-96`; live probe `spur self exec fail-mid --dry-run --json` → three `{ "name", "command" }` objects, exit 0, nothing executed; E2E asserts the same at `apps/cli/tests/commands/self/exec.test.ts:122-131`; documented at `docs/design/sdlc-actions.md:148`, `docs/design/cli-contracts.md:119`, `docs/help2/status.md:52-54`. |
| P3 — design §3.3 placement path stale | CLOSED | `docs/design/sdlc-actions.md:158-163` now names `apps/cli/src/commands/self/exec.ts` reached through `registerSelfCommand` (`apps/cli/src/commands/self/index.ts:15-24`). |

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | documentation | The R8 self reference still asserts that **every** `self` verb has a legacy top-level hidden alias — false for `exec`: `spur exec build` → `error: unknown command 'exec'`, exit 1 (verified live). The description sentence was edited by this change set to enumerate `exec` as a self verb while keeping the "each verb mounts the same command builder as its legacy top-level noun" quantifier, and the body preamble keeps the same claim. The three sibling surfaces this hop did sweep say it correctly ("Each of the five legacy verbs", "Five of them mount the same command builders"). Last surviving instance of the round-1 doc-parity class; fix is two lines — "Each of the five legacy verbs …". | `plugins/sp/skills/spur-cli/references/self.md:3`, `plugins/sp/skills/spur-cli/references/self.md:10-13` | OPEN |
| 2 | P4 (advisory) | documentation | `--list --json` rows are documented as always carrying `command` or `steps`, but an unbound row carries neither — verified under `preset: none`: `{ "name": "build", "reserved": true, "source": "unbound" }`, 15 such rows. R5's own text writes `command?`/`steps?`; the three doc sentences dropped the `?`. A consumer must branch on `source: 'unbound'`. | `docs/design/sdlc-actions.md:154`, `docs/design/cli-contracts.md:121`, `plugins/sp/skills/spur-cli/references/self.md:56` | ACCEPTED |
| 3 | P4 (advisory) | usability | "`--json` without `--list` prints a final summary" is literally false for `--dry-run --json` — that is `--json` without `--list`, and it prints `[{ name, command }]` (verified). The array shape is stated one sentence earlier on two of the three surfaces, so the paragraph resolves for a reader; "in a run" would close it, and `docs/help/cmd_status.md`'s "alone a final summary" reads the same way. | `docs/design/cli-contracts.md:121-123`, `plugins/sp/skills/spur-cli/references/self.md:58-59`, `docs/help/cmd_status.md:80` | ACCEPTED |
| 4 | P4 (advisory) | testing | Nothing pins the now-documented stdin policy: `rg stdin apps/cli/tests/commands/self/exec.test.ts` → no hits. A future seam change would silently falsify four doc surfaces. | `apps/cli/tests/commands/self/exec.test.ts:104-164` | ACCEPTED |
| 5 | P4 (advisory) | architecture | The help-doc flag-parity guard skips the entire `self` subtree on the rationale "container re-registering the five legacy nouns"; `exec` has no alias, so its `--list`/`--dry-run` doc rows sit outside the invariant that test exists to enforce (green today — 2 pass). | `apps/cli/tests/help-doc-parity.test.ts:51-53` | ACCEPTED |
| 6 | P4 (advisory) | documentation | `docs/help/index.md` still lists five `self` verbs. The page is broadly stale already (it says `task` has "18 verbs" where the matrix says 25), so this is page drift the task did not create — noted, not charged. | `docs/help/index.md:46` | ACCEPTED |
| 7 | P4 (advisory) | architecture | Carried from round 1, unchanged: composite flattening and `-- <args>` appending live in the verb and `sdlc-actions.ts` exports no `planAction`, so "no resolution logic in `apps/cli`" is still slightly overclaimed; nothing needs the export yet (1224 reads the same data through `self exec --json`). Scoped placeholders still run literal in a real run until 1224 renders them. | `apps/cli/src/commands/self/exec.ts:64-88`, `packages/app/src/services/sdlc-actions.ts:100-127` | ACCEPTED |
| 8 | P4 (advisory) | usability | Carried from round 1: an unknown option exits 1 (commander) while the verb's own refusals exit 2, so the Q&A's "exit 2 mirrors commander usage errors" does not hold. Consumers only need non-zero. | `apps/cli/src/commands/self/exec.ts:44-47` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `sh -c` in the resolved project root, `SPUR_ACTION` exported, child exit code propagated — `apps/cli/src/commands/self/exec.ts:106-120`; E2E `apps/cli/tests/commands/self/exec.test.ts:105-113` (exit 3; `env-write` reads back `SPUR_ACTION=env-write`); live probes `env-echo` → `action=env-echo`, composite step `spy-step` → `action=comp-spy`. stdout/stderr inherit+stream (`:99-101`); the stdin qualifier is now stated on all four surfaces (round-1 closure row) and matches @origin `node_modules/@gobing-ai/ts-runtime/src/process-executor.ts` line 802. |
| R2 | MET | `shQuote`'d append `apps/cli/src/commands/self/exec.ts:130-132`; composite refusal `:71-75`. Live: `args-echo -- --my-flag 'a b'` → `[--my-flag][a b]`; `fail-mid -- --verbose` → exit 2 with the required message; injection attempt `-- 'x; touch pwned'` printed literally with no file created (quoting rule `packages/app/src/services/shell-quote.ts:12-14`). |
| R3 | MET | `▶ <step>` on stderr, stop at the first non-zero exit `apps/cli/src/commands/self/exec.ts:104-118`; nesting flattened through `resolveAction` `:75-87`. Live `fail-mid` → exit 7, stderr `▶ ok-step`/`▶ fail-step`, no `▶ after-step`, `after` never printed; E2E `apps/cli/tests/commands/self/exec.test.ts:139-146` and nested case `:301-305`. |
| R4 | MET | `apps/cli/src/commands/self/exec.ts:90-96`. Live: text dry-run prints three raw lines, `--dry-run --json` prints the `{ name, command }` array, both exit 0 and leave `after-ran` uncreated. |
| R5 | MET | Table `apps/cli/src/commands/self/exec.ts:148-176`; JSON rows `:49-52` + `:134-140`. Live `--list` renders `NAME SOURCE COMMAND` with `(unbound)` and `a → b` cells; `--list --json` verified on a `preset: none` project; E2E asserts 25 rows, `source: 'default'` for `rules-pre`, composite `steps` (`apps/cli/tests/commands/self/exec.test.ts:70-100`). |
| R6 | MET | Unbound message `apps/cli/src/commands/self/exec.ts:124-127`, usage `:55-58`; both live → exit 2 with the exact required text. |
| R7 | MET | `apps/cli/src/commands/self/exec.ts:119`; live `fail-step --json` → `{ action, steps: [{ name, exitCode, durationMs }], exitCode }` with process exit 7; E2E `apps/cli/tests/commands/self/exec.test.ts:148-162`. |
| R8 | MET | Verb and flags documented on both required surfaces — `docs/design/sdlc-actions.md:145-163` and `plugins/sp/skills/spur-cli/references/self.md:20-59` — plus `docs/design/cli-contracts.md:104-124`, `docs/help/cmd_status.md:64-83`, `docs/help2/status.md:39-56`, matrix row and counts at `docs/help/spur-cli-matrix.md:42`, `:98`, `:120-121`. The verb's own section is accurate; one surrounding sentence is not (finding 1). |
| AC1 | MET | R1, R2, R3, R4, R6, R7 all MET; 24 green tests in `apps/cli/tests/commands/self/exec.test.ts` (real-CLI spawn suite plus an in-process branch block). |
| AC2 | MET | R5 + R8: inventory with `source` on both `--list` renderings, documented and observed live. |

##### Verification evidence (fresh, this review)

- `bun test apps/cli/tests/commands/self/exec.test.ts` → **24 pass / 0 fail / 77 expect() calls**; coverage
  `apps/cli/src/commands/self/exec.ts 100.00 | 100.00` and `apps/cli/src/commands/self/index.ts 100.00 | 100.00`.
- `bun test apps/cli/tests/help-doc-parity.test.ts` → **2 pass / 0 fail** (the change did not break the flag-parity
  guard; finding 5 records that it also does not cover `exec`).
- Live probes against a temp project (`preset: none`, 7 declared actions incl. a 3-step composite and a nested one):
  exit-code propagation (3 and 7), `SPUR_ACTION` for a string action and for a composite step, argv quoting plus an
  injection attempt, dry-run text and JSON, `--list` and `--list --json`, unbound → exit 2, missing action → exit 2,
  composite-with-args → exit 2, stdin not forwarded, and `spur exec build` → `unknown command 'exec'`, exit 1
  (finding 1's evidence).
- SECUA: no injection surface found — extra args pass through `shQuote`
  (`packages/app/src/services/shell-quote.ts:12-14`), action names never reach a shell, command bodies are project-owned
  config (the same trust boundary as a `package.json` script, recorded in `docs/design/sdlc-actions.md:174`), resolution
  stays in `packages/app/src/services/sdlc-actions.ts`, and composite cycles are rejected at load. The new module never
  spawns directly (`rg 'Bun\.spawn' apps/cli/src/commands/self` → 0 hits), so `no-direct-process-spawn` holds.
  Efficiency: one executor per invocation, one spawn per step, `timeout: null` so long actions are not cut, and the CLI
  reads only `exitCode`/`durationMs` — it buffers no child output itself (the seam inherits stdout/stderr and pipes for
  live chunks, @origin `node_modules/@gobing-ai/ts-runtime/src/process-executor.ts` line 806-807). A signal-killed step
  mapping to exit 1 is commented (`apps/cli/src/commands/self/exec.ts:114`).

##### Residual risk and assumptions

- Finding 1 is the only blocker and is prose-only: two lines in one file. Findings 2–3 are the same file, so one edit
  closes all three if the hop takes them together.
- `--list --json` rows for unbound actions omit `command`/`steps` by design; a consumer written only from the docs
  would need finding 2's clarification. Verified here on `preset: none` and (for the fallback) on a root with no
  `.spur/config.yaml`, where the bun preset resolves every reserved action.
- "Project root" means the directory spur resolves the project from, with no upward search: from a subdirectory
  `spur self exec echoer` reports unbound (exit 2). Consistent with every other `self` verb; 1224 must invoke from the
  project root, which it does.
- `SPUR_ACTION` for a composite is the operator-requested action name, not the step name (step `spy-step` saw
  `SPUR_ACTION=comp-spy`). Defensible, but the docs say only "for the child" — unstated, non-blocking.
- I ran only the two narrow test files plus read-only CLI probes: no formatter, no full gate, so the certified digest
  `sha256:bfb48437887ba240ee3ecb1e9d32f808dc5a48f4a7f1531d860a3605f153d406` is untouched.

**Next:** repair hop — two-line wording fix in `plugins/sp/skills/spur-cli/references/self.md` (description line 3 and
preamble lines 10-13: "Each verb" → "Each of the five legacy verbs"), and while that file is open add the
`command?`/`steps?` optionality and the "in a run" qualifier (findings 2–3); findings 4–8 are accepted advisories.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-17T04:56:12.163Z todo → wip (system)

