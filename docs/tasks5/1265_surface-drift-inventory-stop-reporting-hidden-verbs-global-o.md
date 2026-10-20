---
schema_version: 1
name: "surface-drift-inventory: stop reporting hidden verbs, global options, nested-subcommand flags and prose tokens as confirmed mismatches"
status: todo
template: feature-impl
created_at: 2026-10-20T04:51:58.580Z
updated_at: "2026-10-20T05:01:03.435Z"
feature_id: I3

---

## 1265. surface-drift-inventory: stop reporting hidden verbs, global options, nested-subcommand flags and prose tokens as confirmed mismatches

### Background

Found by `/sp:dev-find-conflict --scope packages,apps,scripts --mode full` (2026-10-19, HEAD 57e1c0fd1).
`bun scripts/spur-dev.ts surface-drift-inventory` exits 1 (`process.exitCode = 1`,
`scripts/commands/surface-drift-inventory.ts:892`) with 14 rows under "Confirmed mismatches (R3
disposition)". **All 14 are checker false positives.** The live CLI and the `plugins/sp` prose
agree in every case; the inventory reports drift that does not exist. That trains operators to
ignore the gate, and it hides real drift behind noise. Do **not** "fix" these by editing the
plugin prose: each cited prose line is correct.

The live surface can only be read correctly from Commander's real behavior:

- `--help` **omits hidden commands** (`{ hidden: true }`).
- Root program options (`--no-logo`, `-v/--cli-verbose`) are **global**: `apps/cli/src/index.ts:66`
  strips them from argv before dispatch. They appear only in the root `spur --help` `Options:` block.
- A verb can itself be a command group (`spur agent dogfood gate|validate-report`), so its flags
  live one level deeper.

#### Root cause per confirmed row (verified 2026-10-19)

| # | Reported row | Citing prose (correct as written) | Live evidence | Root cause in checker |
| --- | --- | --- | --- | --- |
| 1 | `spur workflow show --no-logo` | `plugins/sp/commands/dev-idea.md:66`, `dev-plan.md:45`, `skills/spur-dev/references/execution-batch.md:311` | `spur --help` → `--no-logo  Suppress the startup ASCII banner`; `apps/cli/src/index.ts:69,100` `program.option('--no-logo')` | `checkNounVerbFlags` (L238) compares flags only with `surface([noun, verb]).flags`; root/global flags (`surface([]).flags`) are never accepted |
| 2 | `spur agent loop` | `skills/parallel-execution/references/dispatch-surface.md:167-168`, `skills/spur-cli/references/agent.md:93`, `skills/spur-doctor/SKILL.md:49` (a "Forbidden surface" negation) | `apps/cli/src/commands/agent/loop.ts:36` `.command('loop', { hidden: true })`; `spur agent loop --help` exits 0 | Verb-absent is decided from the `Commands:` block alone (L286-294); hidden verbs are invisible there |
| 3–7 | `spur agent dogfood --testee/--max-retry-present/--steps/--file/--json` | `skills/spur-cli/references/agent.md:33` (verb table row `dogfood <gate\|validate-report>`), `skills/dogfood-testing/references/report-template.md:339` | `spur agent dogfood --help` → `Commands: gate [options] [testee]`, `validate-report [options] [file]`; the flags live on those subcommands | The flag check (L298-305) stops at depth 2; it never descends into a verb's own `Commands:` block |
| 8 | `spur maintain` | `skills/spur-cli/references/self.md:11` (lists the five hidden root aliases) | `spur self --help` lists `maintain`; `spur maintain --help` exits 0 | `LEGACY_SELF_ALIASES` (L121) is `['init','migrate','serve','status']`, missing `maintain` |
| 9 | `spur exec` | `skills/spur-cli/references/self.md:16-17`: "there is no `spur exec` top-level alias (`spur exec <action>` is an unknown command)" | Correct: there is no root `exec`; `spur self exec` exists | The negation detector (L417) only recognizes the literal shape ``no `spur X` verb exists``; it misses "there is no `spur X` … alias" and "is an unknown command" |
| 10 | `spur exits` | `skills/spur-cli/references/self.md:50`: "spur exits with the child's exit code." | English prose, not an invocation | `lineInvocationSpans` bare regex (L183-188) accepts `^spur <word>` at line start in un-backticked prose |
| 11 | `spur task update -id` | `skills/spur-cli/references/tasks.md:43` (`--assignee <spec-id>`) | No such flag is claimed; `-id` is the tail of the placeholder `<spec-id>` | `flagNames` (L197) regex `-{1,2}[A-Za-z]…` has no left token boundary and does not strip placeholders |
| 12 | `spur task update -local` | `skills/spur-cli/references/tasks.md:43` (`--ac-numbering task-local`) | `-local` is the tail of the value `task-local` | Same as #11 |
| 13 | `spur task batch-plan -Z` | `skills/spur-cli/references/tasks.md:52` (`--letter <A-Z>`) | `-Z` is inside the placeholder `<A-Z>` | Same as #11 |
| 14 | `spur check` | `skills/spur-check/SKILL.md:103`: "A public `spur check` verb is out of scope without separate consent." | Correct: there is no `check` noun | Out-of-scope or negated prose is not recognized as asserting absence |

Note: the live root commands are `agent, builder, decision, feature, help, history, message,
projects, rule, self, task, workflow`. Hidden root aliases are `init, maintain, migrate, serve,
status`, all thin redirects to `spur self <verb>` (`self.md:10-14`).

### Requirements

- [ ] R1. — Global options. A flag listed in the root `spur --help` `Options:` block (`surface([])`)
  is `ok` on every command path, with actual `global option (root program)`. Do not hardcode
  `--no-logo`; read the flags from the root capture.
- [ ] R2. — Hidden verbs. Before recording `verb absent`, probe `spur <noun> <verb> --help` through
  the injectable runner. On exit 0 with Commander help, record `ok` with actual `hidden verb
  present (not listed in --help)`. Cache the result, and capture that verb's flags from the probe
  so later flag checks work for hidden verbs too.
- [ ] R3. — Nested command groups. When `spur <noun> <verb>` has its own non-empty `Commands:`
  block and a cited flag is absent at the verb level, check that verb's subcommands.
  Present on ≥1 subcommand → `unverified` with `nested shorthand — flag present on k/n
  subcommands (<names>)`, mirroring the existing noun-level shorthand (L313-323).
  Present on none → `mismatch`. Never `ok`, because the citation omits the subcommand.
- [ ] R4. — Flag tokens need a left boundary, and placeholders are stripped. `flagNames` (and
  `isFlagSpan`) only accept a flag at span start or after whitespace (`(?:^|\s)`, matching
  `parseCommanderHelp` in `plugins/sp/tests/helpers/cli-surface.ts`). Placeholder groups
  `<…>` and `[…]` are removed before matching. So `<spec-id>`, `task-local` and `<A-Z>` yield
  no flags, while `--assignee`, `--ac-numbering` and `--letter` are still extracted.
- [ ] R5. — Complete the legacy alias set. `LEGACY_SELF_ALIASES` matches `self.md:10-14`:
  `init, maintain, migrate, serve, status`. Better: derive it from `surface(['self']).commands`
  ∩ root-hidden probes, so the set cannot drift again. `exec` stays excluded because it has no
  root alias.
- [ ] R6. — Negated / absence prose. Widen the negation detector (L417) to these line forms:
  ``no `spur X` (verb|alias|noun|command)``, ``there is no `spur X` ``, ```spur X` is an unknown
  command``, ``Forbidden surface: `spur X` ``, ``public `spur X` (verb|noun) is out of scope``.
  - A negated noun-level claim (no verb) is confirmed against `surface([]).commands`.
  - Absent → `ok` with `documented absence confirmed against live surface`.
  - Present → `mismatch` (stale negation).
  - "Forbidden surface" is not an absence claim: the verb exists but is internal. Route it
    through R2, so a hidden verb records `ok`.
- [ ] R7. — Prose `spur <word>` is not an invocation. Bare (un-backticked) matches in
  `lineInvocationSpans` require shell context: a fence (already handled separately), a
  `$`/`=`/`(`/`;`/`&`/`|`/quote prefix, or a `bun run` prefix. A sentence that starts with
  `spur exits …` is not a claim.
- [ ] R8. — No regression on true drift. A seeded fake verb, a fake flag and a fake noun still
  produce `mismatch`, and the run still exits 1.
- [ ] R9. — Gate result on HEAD. After the fix, the inventory on the main tree reports **0 confirmed
  mismatches** and exits 0. Every one of the 14 rows above ends `ok` or `unverified`, with the
  actual text named in R1–R7.

### Acceptance Criteria

- [ ] AC1 — Root/global options are accepted on any command path (req: R1)
- [ ] AC2 — Hidden registered verbs are probed and reported present, with their flags captured (req: R2)
- [ ] AC3 — Flags cited against a command-group verb resolve through its subcommands as unverified shorthand, never ok (req: R3)
- [ ] AC4 — Placeholder and hyphenated-word fragments are not extracted as flags (req: R4)
- [ ] AC5 — The legacy self-alias set covers maintain and cannot silently drift from `spur self` (req: R5)
- [ ] AC6 — Negated, unknown-command, forbidden-surface and out-of-scope prose is classified as documented absence or internal surface (req: R6)
- [ ] AC7 — Un-backticked English prose beginning with "spur <word>" asserts nothing (req: R7)
- [ ] AC8 — Seeded true drift (fake noun, verb, flag) still yields mismatch and exit 1 (req: R8)
- [ ] AC9 — The inventory on HEAD exits 0 with zero confirmed mismatches; all 14 former rows resolve as specified (req: R9)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Single owned file plus its test: `scripts/commands/surface-drift-inventory.ts` and
`scripts/commands/surface-drift-inventory.test.ts`. **No change** to `plugins/sp/**` prose, to
`apps/cli`, or to `plugins/sp/tests/helpers/cli-surface.ts`'s frozen exports (`captureCliSurface`,
`parseCommanderHelp` are consumed by tasks 0516/0517). No new dependency.

| Change | Where | Shape |
| --- | --- | --- |
| Global flags | `checkNounVerbFlags` L238 | `const globalFlags = surface([]).flags;` and treat `f ∈ globalFlags` as `ok` before every `flags.includes(f)` test (self alias, verb, noun-level branches) |
| Hidden-verb probe | new `hiddenSurface(path)` next to `surface()` L78 | Run `runner([...path, '--help'])`; on exit 0, `parseCommanderHelp(out)` → cache in `surfaceCache` under the same key and mark `hidden: true`. Use it in the verb-absent branch (L286) before recording a mismatch. Keep the runner injectable (`CliRunner`, L90), because tests seed `surfaceCache` and must stay hermetic |
| Nested groups | verb branch L296-305 | If `vs.commands.length > 0` and `!vs.flags.includes(f)`: `withFlag = vs.commands.filter(c => surface([noun, verb, c]).flags.includes(f))` → `unverified` / `mismatch` as in R3 |
| Flag tokenizer | `flagNames` L197, `isFlagSpan` L192 | `span.replace(/<[^>]*>\|\[[^\]]*\]/g, ' ')`, then `/(?:^\|\s)(-{1,2}[A-Za-z][A-Za-z0-9-]*)/g` → group 1. `parseInvocation`'s token loop (L149) already tokenizes on whitespace and filters placeholders, so the fix lives in `flagNames`/`isFlagSpan` only |
| Alias set | L121 | Add `maintain`. Optionally replace the constant with a lazy `legacySelfAliases()` = `surface(['self']).commands` minus `help`, filtered to names whose `spur <name> --help` exits 0 (R2 probe). That excludes `exec` mechanically |
| Negation | `sweepPluginTrees` L417 | Replace the single regex with `NEGATION_PATTERNS: RegExp[]` plus a `kind: 'absent' \| 'internal'` tag. `absent` with no verbs → check `surface([]).commands`. `internal` → normal check (R2 makes hidden verbs ok) |
| Bare prose | `lineInvocationSpans` L181 | Drop the `^` alternative from the bare regex's prefix group, keeping `[`"'=;&\|(]` and the `bun run` form. Fenced lines go through the `inFence` branch (L478), which still uses `lineInvocationSpans`. Pass `{ fenced: true }` there so `^spur …` stays an invocation inside code fences |

Exit semantics stay unchanged: exit 1 iff any `mismatch` row remains (L892). `unverified` never fails.
The rendered `Check methods` table (L806) gains one line documenting the hidden-verb probe and
global-option rule.

Failure modes to guard (write these tests first; see the AGENTS testing rule):
1. A global flag that is also redefined locally must not mask a locally absent flag. Only
   flags present in the root capture are exempt.
2. If the hidden-verb probe gets a non-help output (Commander "unknown command" on stderr,
   exit 1), it records `mismatch`, never `ok`.
3. A probe timeout (exit 124) records `unverified`, never `ok` or `mismatch`.
4. Nested shorthand never returns `ok`.
5. Stripping placeholders must not drop a real flag adjacent to one (`--tasks <file> --letter <A-Z>`
   → `--tasks`, `--letter`).
6. Negation patterns must not swallow a positive claim on the same line. Evaluate per span:
   only the span inside the negated clause is inverted.
7. Removing the bare `^spur` match must not lose fenced-code invocations.

### Plan

- [ ] Write failing hermetic tests in `scripts/commands/surface-drift-inventory.test.ts`. Seed
  `surfaceCache` and an injected `CliRunner`, one test per root-cause row (1–14) plus the seven
  failure modes in Design
- [ ] R4 tokenizer fix (`flagNames`/`isFlagSpan`) → rows 11–13 pass
- [ ] R1 global options → row 1
- [ ] R5 alias set → row 8
- [ ] R2 hidden-verb probe with injectable runner → row 2 (the dispatch-surface and agent.md citations)
- [ ] R3 nested command groups → rows 3–7 become `unverified`
- [ ] R6 negation patterns → rows 9, 14 and the spur-doctor "Forbidden surface" line
- [ ] R7 bare-prose guard with fenced opt-in → row 10
- [ ] R8 seeded true-drift regression tests (fake noun/verb/flag still exit 1)
- [ ] Run `bun test scripts/commands/surface-drift-inventory.test.ts` from the repo root
  (root `bunfig.toml` owns `scripts/**`; preload `./tests/setup.ts`), then `bun scripts/spur-dev.ts surface-drift-inventory --out $TMPDIR/inv.md`.
  Expect exit 0 and "Confirmed mismatches" empty. Record row counts before/after in Testing
- [ ] `bun run spur-check` (lint/typecheck, tests, pre/post rules)

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `scripts/commands/surface-drift-inventory.ts`: L121 `LEGACY_SELF_ALIASES`, L181 `lineInvocationSpans`, L192 `isFlagSpan`, L197 `flagNames`, L238 `checkNounVerbFlags`, L400 `sweepPluginTrees` (negation L417, verb table L452-472, fence branch L478), L892 exit code
- `scripts/commands/surface-drift-inventory.test.ts`: existing hermetic suite (seeds `surfaceCache`)
- `plugins/sp/tests/helpers/cli-surface.ts`: `captureCliSurface` / `parseCommanderHelp` (frozen exports; read-only for this task)
- `apps/cli/src/index.ts:66-100`: root global options `--no-logo`, `-v/--cli-verbose`
- `apps/cli/src/commands/agent/loop.ts:36`: the hidden `agent loop` verb
- `apps/cli/src/commands/agent/dogfood.ts`: the `gate` / `validate-report` subcommands
- `plugins/sp/skills/spur-cli/references/self.md:10-17,50`: alias set, `exec` exception, prose "spur exits"
- Origin: task 0539 (inventory R1–R3), feature I3; audit run 2026-10-19 on HEAD 57e1c0fd1

### History

- 2026-10-20T05:01:03.435Z backlog → todo (system)

