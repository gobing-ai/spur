---
schema_version: 1
name: "surface-drift-inventory: stop reporting hidden verbs, global options, nested-subcommand flags and prose tokens as confirmed mismatches"
status: done
template: feature-impl
created_at: 2026-10-20T04:51:58.580Z
updated_at: "2026-10-20T16:12:23.804Z"
feature_id: I3

ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1265-verdict.json
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

- [x] R1. — Global options. A flag listed in the root `spur --help` `Options:` block (`surface([])`)
  is `ok` on every command path, with actual `global option (root program)`. Do not hardcode
  `--no-logo`; read the flags from the root capture.
- [x] R2. — Hidden verbs. Before recording `verb absent`, probe `spur <noun> <verb> --help` through
  the injectable runner. On exit 0 with Commander help, record `ok` with actual `hidden verb
  present (not listed in --help)`. Cache the result, and capture that verb's flags from the probe
  so later flag checks work for hidden verbs too.
- [x] R3. — Nested command groups. When `spur <noun> <verb>` has its own non-empty `Commands:`
  block and a cited flag is absent at the verb level, check that verb's subcommands.
  Present on ≥1 subcommand → `unverified` with `nested shorthand — flag present on k/n
  subcommands (<names>)`, mirroring the existing noun-level shorthand (L313-323).
  Present on none → `mismatch`. Never `ok`, because the citation omits the subcommand.
- [x] R4. — Flag tokens need a left boundary, and placeholders are stripped. `flagNames` (and
  `isFlagSpan`) only accept a flag at span start or after whitespace (`(?:^|\s)`, matching
  `parseCommanderHelp` in `plugins/sp/tests/helpers/cli-surface.ts`). Placeholder groups
  `<…>` and `[…]` are removed before matching. So `<spec-id>`, `task-local` and `<A-Z>` yield
  no flags, while `--assignee`, `--ac-numbering` and `--letter` are still extracted.
- [x] R5. — Complete the legacy alias set. `LEGACY_SELF_ALIASES` matches `self.md:10-14`:
  `init, maintain, migrate, serve, status`. Better: derive it from `surface(['self']).commands`
  ∩ root-hidden probes, so the set cannot drift again. `exec` stays excluded because it has no
  root alias.
- [x] R6. — Negated / absence prose. Widen the negation detector (L417) to these line forms:
  ``no `spur X` (verb|alias|noun|command)``, ``there is no `spur X` ``, ```spur X` is an unknown
  command``, ``Forbidden surface: `spur X` ``, ``public `spur X` (verb|noun) is out of scope``.
  - A negated noun-level claim (no verb) is confirmed against `surface([]).commands`.
  - Absent → `ok` with `documented absence confirmed against live surface`.
  - Present → `mismatch` (stale negation).
  - "Forbidden surface" is not an absence claim: the verb exists but is internal. Route it
    through R2, so a hidden verb records `ok`.
- [x] R7. — Prose `spur <word>` is not an invocation. Bare (un-backticked) matches in
  `lineInvocationSpans` require shell context: a fence (already handled separately), a
  `$`/`=`/`(`/`;`/`&`/`|`/quote prefix, or a `bun run` prefix. A sentence that starts with
  `spur exits …` is not a claim.
- [x] R8. — No regression on true drift. A seeded fake verb, a fake flag and a fake noun still
  produce `mismatch`, and the run still exits 1.
- [x] R9. — Gate result on HEAD. After the fix, the inventory on the main tree reports **0 confirmed
  mismatches** and exits 0. Every one of the 14 rows above ends `ok` or `unverified`, with the
  actual text named in R1–R7.

### Acceptance Criteria

- [x] AC1 — Root/global options are accepted on any command path (req: R1)
- [x] AC2 — Hidden registered verbs are probed and reported present, with their flags captured (req: R2)
- [x] AC3 — Flags cited against a command-group verb resolve through its subcommands as unverified shorthand, never ok (req: R3)
- [x] AC4 — Placeholder and hyphenated-word fragments are not extracted as flags (req: R4)
- [x] AC5 — The legacy self-alias set covers maintain and cannot silently drift from `spur self` (req: R5)
- [x] AC6 — Negated, unknown-command, forbidden-surface and out-of-scope prose is classified as documented absence or internal surface (req: R6)
- [x] AC7 — Un-backticked English prose beginning with "spur <word>" asserts nothing (req: R7)
- [x] AC8 — Seeded true drift (fake noun, verb, flag) still yields mismatch and exit 1 (req: R8)
- [x] AC9 — The inventory on HEAD exits 0 with zero confirmed mismatches; all 14 former rows resolve as specified (req: R9)

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

- [x] Write failing hermetic tests in `scripts/commands/surface-drift-inventory.test.ts`. Seed
  `surfaceCache` and an injected `CliRunner`, one test per root-cause row (1–14) plus the seven
  failure modes in Design
- [x] R4 tokenizer fix (`flagNames`/`isFlagSpan`) → rows 11–13 pass
- [x] R1 global options → row 1
- [x] R5 alias set → row 8
- [x] R2 hidden-verb probe with injectable runner → row 2 (the dispatch-surface and agent.md citations)
- [x] R3 nested command groups → rows 3–7 become `unverified`
- [x] R6 negation patterns → rows 9, 14 and the spur-doctor "Forbidden surface" line
- [x] R7 bare-prose guard with fenced opt-in → row 10
- [x] R8 seeded true-drift regression tests (fake noun/verb/flag still exit 1)
- [x] Run `bun test scripts/commands/surface-drift-inventory.test.ts` from the repo root
  (root `bunfig.toml` owns `scripts/**`; preload `./tests/setup.ts`), then `bun scripts/spur-dev.ts surface-drift-inventory --out $TMPDIR/inv.md`.
  Expect exit 0 and "Confirmed mismatches" empty. Record row counts before/after in Testing
- [x] `bun run spur-check` (lint/typecheck, tests, pre/post rules)

### Solution

Single owned file plus its suite: the live surface read is now taken from what Commander actually
does (hidden commands, global root options, command groups) instead of from the parent `--help`
listing alone, and prose tokens stop being read as flags or invocations. No plugin prose, no
`apps/cli` change, no new dependency.

| Requirement | Change | Where |
| --- | --- | --- |
| R2 (hidden verbs) | `hiddenSurface()` probes `<path> --help` through the injectable runner, requires the `Usage:` line to name the probed path (Commander answers an unknown command with the PARENT's help and exit 0), caches the capture as `hidden: true`; `commandState()` unifies visible/hidden/absent/unverified for every consumer | `scripts/commands/surface-drift-inventory.ts:113` |
| R2 (probe transport) | `hiddenProbeRunner` + `setHiddenProbeRunner()` — the probe is injectable so the suite stays hermetic | `scripts/commands/surface-drift-inventory.ts:100` |
| R1 (global options) | `checkFlags()` tries the root program's flags before the command's own, so `--no-logo` is `ok` on every path with actual `global option (root program)`; root membership is the only exemption | `scripts/commands/surface-drift-inventory.ts:373` |
| R3 (nested groups) | same helper: when the verb is itself a group, an absent flag is searched on its subcommands and recorded `unverified` as nested shorthand | `scripts/commands/surface-drift-inventory.ts:397` |
| R5 (alias set) | `LEGACY_SELF_ALIASES` constant replaced by `legacySelfAliases()` — `spur self` commands ∩ a root-alias probe, falling back to the documented baseline when a probe cannot answer; `resetLegacySelfAliases()` is the test seam | `scripts/commands/surface-drift-inventory.ts:198` |
| R4 (flag tokens) | `flagNames()` requires a left token boundary and strips placeholder groups and backtick delimiters; `isFlagSpan()` judges the stripped span | `scripts/commands/surface-drift-inventory.ts:323` |
| R6 (absence prose) | `NEGATION_PATTERNS` (absent vs internal) replaces the single regex; `negationClaims()` returns the inverted clause per span and `recordAbsence()` confirms it against the live surface | `scripts/commands/surface-drift-inventory.ts:531` |
| R6 (absence altitude) | `recordAbsence()` judges the claim at the altitude it is written: a flag-scoped `there is no \`spur X --flag\`` claim is decided on the flag, not on the verb (review P2) | `scripts/commands/surface-drift-inventory.ts:595` |
| R6 (stale negation) | `recordAbsenceRow()` reports a present command or flag as a stale negation | `scripts/commands/surface-drift-inventory.ts:570` |
| R6 (per span) | `claimOwnsSpan()` compares the PARSED command path, so a short negated path cannot invert a longer correct citation beside it (review P3) | `scripts/commands/surface-drift-inventory.ts:558` |
| R6 (per span, wired) | `sweepPluginTrees` consults the owning clause before judging a span | `scripts/commands/surface-drift-inventory.ts:691` |
| R7 (no double extraction) | the bare pass runs on backtick-masked text, so `spur self exec` no longer also yields `spur self` | `scripts/commands/surface-drift-inventory.test.ts:148` |
| R7 (bare prose) | `lineInvocationSpans()` needs shell context (`$`, separator, `=`, `(`, quote) or a `bun`/`bunx` prefix; fenced code opts in via `{ fenced: true }`, which the fence branch passes | `scripts/commands/surface-drift-inventory.ts:285` |
| R9 (report) | the rendered `Check methods` table names the global-option rule and the hidden-verb probe next to `help-capture` | `scripts/commands/surface-drift-inventory.ts:1089` |
| R1–R8 (proof) | hermetic tests: one per resolved row class (global option, hidden verb + probe failure modes, nested group, tokenizer, derived alias set, every absence shape, per-span negation ownership + flag-scoped absence, bare-prose guard, seeded true drift) | `scripts/commands/surface-drift-inventory.test.ts:556` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `scripts/commands/surface-drift-inventory.ts:373`; test `scripts/commands/surface-drift-inventory.test.ts:559`; live row `spur workflow show --no-logo → ok · global option (root program)` at `.spur/run/1265-inventory-after.md` |
| R2 | MET | `scripts/commands/surface-drift-inventory.ts:113`, injectable probe `:100`; tests `scripts/commands/surface-drift-inventory.test.ts:593,606,614,626`; live row `spur agent loop → ok · hidden verb present` at `.spur/run/1265-inventory-after.md` |
| R3 | MET | `scripts/commands/surface-drift-inventory.ts:391-403`; test `scripts/commands/surface-drift-inventory.test.ts:643`; live rows `spur agent dogfood --testee/--steps/--json/--file/--max-retry-present → unverified · nested shorthand` at `.spur/run/1265-inventory-after.md` |
| R4 | MET | `scripts/commands/surface-drift-inventory.ts:323`; test `scripts/commands/surface-drift-inventory.test.ts:215`; inventory contains no `-id`, `-local` or `-Z` row |
| R5 | MET | `scripts/commands/surface-drift-inventory.ts:198`; test `scripts/commands/surface-drift-inventory.test.ts:671`; live row `spur maintain → ok · legacy alias; canonical self/maintain command is present` at `.spur/run/1265-inventory-after.md` |
| R6 | MET | `scripts/commands/surface-drift-inventory.ts:531,558,595`; tests `scripts/commands/surface-drift-inventory.test.ts:843,851,873`; live rows `spur exec`/`spur check` → `documented absence confirmed` at `.spur/run/1265-inventory-after.md` |
| R7 | MET | `scripts/commands/surface-drift-inventory.ts:285`; tests `scripts/commands/surface-drift-inventory.test.ts:143,163,170,857`; zero `spur exits` rows in `/tmp/1265-review-r3.md` |
| R8 | MET | test `scripts/commands/surface-drift-inventory.test.ts:839` (`spur task check --bogus-flag` → mismatch); exit mapping `scripts/commands/surface-drift-inventory.ts:1177-1182` |
| R9 | MET | `bun scripts/spur-dev.ts surface-drift-inventory --out /tmp/1265-review-r3.md` exit 0, `Totals: 424 ok · 0 mismatch · 15 unverified`; per-row resolution at `.spur/run/1265-inventory-after.md` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `scripts/commands/surface-drift-inventory.test.ts:559` (ok + actual `global option (root program)`), `:566` (verb-level miss stays mismatch), `:573` (noun level and legacy alias) |
| AC2 | MET | test | `scripts/commands/surface-drift-inventory.test.ts:593` (present + `--json` captured from the probe), `:606` `:614` `:626` (present only on the probed path, absent on parent help, timeout unverified) |
| AC3 | MET | test | `scripts/commands/surface-drift-inventory.test.ts:643` (`unverified` + `nested shorthand` + `1/2 subcommands` + `gate`), `:652`, `:657` |
| AC4 | MET | test | `scripts/commands/surface-drift-inventory.test.ts:215` (`--ac-numbering task-local`, `--assignee <spec-id>`, `--letter <A-Z>`), `:223` |
| AC5 | MET | test | `scripts/commands/surface-drift-inventory.test.ts:671` (`maintain` present, `exec` excluded by the root-alias probe, `spur maintain` ok), `:687` (baseline kept when the probe cannot answer) |
| AC6 | MET | test | `scripts/commands/surface-drift-inventory.test.ts:843` (absence shapes confirm), `:851` (forbidden surface → hidden verb present), `:873` (flag-scoped absence), `:861` (per-span ownership) |
| AC7 | MET | test | `scripts/commands/surface-drift-inventory.test.ts:163` (`spur exits with the child's exit code.` → `[]`), `:143` (no double extraction), `:170` (fenced/bun retains shell context), `:857` (no row for `spur exits`) |
| AC8 | MET | test | `scripts/commands/surface-drift-inventory.test.ts:839` (`spur task check --bogus-flag` and `spur fenced check` seeded in the fixture → `mismatch`, no new rule excusing them); mismatch→exit-1 mapping `scripts/commands/surface-drift-inventory.ts:1177-1182` |
| AC9 | MET | command | `bun scripts/spur-dev.ts surface-drift-inventory --out /tmp/1265-review-r3.md` → exit 0, `424 ok · 0 mismatch · 15 unverified`, "None — every mechanically-checked assertion matches the live surface"; rows 1 (`:410` ok global option), 2 (`:50` hidden verb), 3-7 (`:420-424` unverified shorthand), 8 (`:190` legacy alias), 9 (`:118` absence), 10 (no row), 11-13 (no `-id`/`-local`/`-Z` rows), 14 (`:103` absence) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1265 (third pass, narrow re-certification)
**Scope:** `scripts/commands/surface-drift-inventory.ts` + its suite (pass-3 delta: one assertion at `surface-drift-inventory.test.ts:862-871`)
**Dimensions:** correctness (re-certified), functional traceability, architecture (carried from pass 2)
**Verdict:** PASS

**Pass-3 delta, verified by diff against the pass-2 snapshot, not by trust:** `git diff` of the module is byte-identical to the pass-2 saved diff (`diff` of `/tmp/1265-script.diff` vs current: no output); the suite delta is confined to the failure-mode-6 test, where four assertions (`status ok` / `actual` not-contains / `spur task` mismatch / contains) were replaced by one row-set assertion. Tree restored byte-identical after every mutation (sha256 before/after matched both files); `git status --porcelain -uall` shows exactly the same three modified files and no untracked file.

##### Resolved findings (carried from pass 2)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 (major) | correctness | A flag-scoped absence claim (`there is no \`spur task update --tags\` flag`) was judged on the verb, so true prose was reported as drift | `scripts/commands/surface-drift-inventory.ts:595-620` | RESOLVED (pass 2; guard `scripts/commands/surface-drift-inventory.test.ts:873` passes) |
| 2 | P3 (minor) | correctness | Negation clause matching was a raw-text prefix test, so a short negated path (`spur task`) inverted a correct longer citation beside it — Design failure mode 6 | `scripts/commands/surface-drift-inventory.ts:558-568` | RESOLVED (pass 2; wiring `:726` now calls `claimOwnsSpan`) |
| 3 | P3 (minor) | correctness | The failure-mode-6 guard was decorative: under the old wiring both the pre-fix and post-fix code produced the tested row statuses, so the test could not fail | `scripts/commands/surface-drift-inventory.test.ts:862-871` | RESOLVED (pass 3 — mutation evidence below) |

**Mutation evidence for finding 3 (run this pass, in the review tree, then restored):** with the wiring at `surface-drift-inventory.ts:726` replaced by `span.trim().startsWith(n.asserted)`, the suite runs `100 pass / 1 fail` and the single failure is exactly this test:

```
error: expect(received).toEqual(expected)
  [ "spur zeta live", + "spur task check --json", "spur task" ]
  at surface-drift-inventory.test.ts:867:104
(fail) … > a negation does not swallow a positive claim on the same line (failure mode 6)
```

The mutant reproduces the swallow (an EXTRA stale-negation row for `spur task check --json`) and the new row-set assertion is the only thing that notices it — the retained `status === 'ok'` assertion at `:865` still passes under the mutant, which is precisely why the previous version could not fail. The guard is load-bearing.

##### Advisories (derived this pass)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 4 | P4 (advisory) | correctness | The mismatch → `process.exitCode = 1` branch is not unit-tested (`main()` is not exported and only runs under `import.meta.main`); AC8's "exit 1" half rests on a 4-line read plus the live run taking the 0-mismatch else-branch | `scripts/commands/surface-drift-inventory.ts:1177-1182` | ACCEPTED |
| 5 | P4 (advisory) | usability | `bun test scripts/commands/surface-drift-inventory.test.ts` reports `101 pass / 0 fail` yet exits 1: the repo's per-file coverage threshold (0.9/0.9, `bunfig.toml [test]`) is breached by `plugins/sp/tests/helpers/cli-surface.ts` at 46.15% funcs / 37.20% lines. Reproduced with the new assertion removed (identical exit 1 and identical coverage table), so it is pre-existing and not a pass-3 regression | `bunfig.toml:8-19` | ACCEPTED |
| 6 | P4 (advisory) | functional | 15 of 424 entries stay `unverified` (mutating commands, no mechanical check) — recorded, never passed; the zero-mismatch claim does not cover those cited surfaces | `/tmp/1265-review-r3.md:7` | ACCEPTED |

##### Fresh checks (this pass, current tree)

| Check | Command | Result |
| --- | --- | --- |
| Suite | `bun test scripts/commands/surface-drift-inventory.test.ts` | 101 pass · 0 fail · 215 expect() (process exit 1 = advisory 5) |
| Lint | `bunx biome check` on both files | exit 0 — "Checked 2 files. No fixes applied." |
| Types | `bunx tsc -p scripts/tsconfig.json --noEmit` | exit 0, zero output |
| Contract | `bun run script-contract-check` | exit 0 — "0 violation(s) — PASS" |
| Inventory | `bun scripts/spur-dev.ts surface-drift-inventory --out /tmp/1265-review-r3.md` | exit 0 — `Totals: 424 ok · 0 mismatch · 15 unverified`; "Confirmed mismatches (R3 disposition): None" |

##### Functional Traceability (re-confirmed on the current tree)

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `scripts/commands/surface-drift-inventory.ts:373` root-flags-first; live row `spur workflow show --no-logo → ok · global option (root program)` (`/tmp/1265-review-r3.md:410`); negative guard `…test.ts:566` (verb-level miss stays mismatch) |
| R2 | MET | `…:113` `hiddenSurface()` (Usage-line path check), injectable probe `…:100`; live `spur agent loop → ok · hidden verb present` (report `:50`); probe failure modes tested at `…test.ts:606,614,626` |
| R3 | MET | `…:391-403` nested-shorthand search; live rows `spur agent dogfood --testee/--steps/--json/--file/--max-retry-present → unverified · nested shorthand (… N/3 subcommands)` (report `:420-424`); tests `…test.ts:643,657` |
| R4 | MET | `…:323` left token boundary + placeholder stripping; tests `…test.ts:215,223`; report has no `-id` / `-local` / `-Z` rows |
| R5 | MET | `…:198` `legacySelfAliases()` derived from `spur self` ∩ root-alias probe; live `spur maintain → ok · legacy alias` (report `:190`); tests `…test.ts:671,687` |
| R6 | MET | `…:531,558,595`; live `spur exec` / `spur check` → `ok · documented absence confirmed` (report `:118,103`), `spur agent loop` (forbidden-surface) → `ok · hidden verb present`; tests `…test.ts:843,851,873` |
| R7 | MET | `…:285` shell-context requirement + backtick masking; no `spur exits` row in the report (grep count 0); tests `…test.ts:143,163,170,857` |
| R8 | MET | seeded `spur task check 0042 --bogus-flag` → mismatch (`…test.ts:839`); exit mapping `…:1177-1182` |
| R9 | MET | live run exit 0, 424 ok / 0 mismatch; report renders both new check methods (`…:1085-1095`, report `:14-18`); all 14 former rows resolve as specified |

**Residual risk.** (a) AC8's exit-code half is code-read only (advisory 4) — a future refactor of `main()` could break the exit contract with no test going red. (b) Anything the probe can reach only through a live CLI stays `unverified` by construction (advisory 6). (c) The exit-1-from-coverage signature (advisory 5) will keep confusing readers of a per-file `bun test` run; only a full-suite run exits 0.

**Disposition.** PASS. Every pass-2 finding is RESOLVED with reproduced evidence; the three remaining rows are ACCEPTED advisories carried as stated residual risk. Nothing was implemented by this review; the tree is byte-identical to the state handed over.

**Confidence:** MEDIUM

**Next:** close 1265 — the review contract has no open P1–P3 finding; carry advisories 4–6 as notes.

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
- 2026-10-20T05:48:19.424Z todo → wip (system)
- 2026-10-20T16:10:23.311Z wip → testing (system)
- 2026-10-20T16:12:23.788Z testing → done (system)

