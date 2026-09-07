---
schema_version: 1
name: Dogfood J31 findings register — comma-list status filters, dogfood token-table drift, ADR-110 retention premise, and section-write semantics
status: done
template: issue
created_at: 2026-09-07T05:07:02.241Z
updated_at: "2026-09-07T19:53:04.387Z"

feature_id: J31
ac_altitude: task-local
---

## 0795. Dogfood J31 findings register — comma-list status filters, dogfood token-table drift, ADR-110 retention premise, and section-write semantics

### Background

Consolidated register of every actionable finding from the 2026-09-07 dogfood of
`/sp:dev-refineall --feature J31 --auto --depth ready --agent inline`
(run `20260907-040240-refineall-j31`; report
`docs/dogfood/2026-09-07-sp-dev-refineall-j31-dogfood.md`). The run itself passed — 6/6 steps, 0
fixed, 0 unresolved — so nothing here is a regression in `refineall`; these are latent defects the
run surfaced while exercising it. Each finding carries its evidence inline, so this task is
actionable without opening the dogfood report.

**Findings inventory.** IDs `F1`–`F5` are referenced consistently across Requirements, Root Cause,
Design, Plan, and Acceptance Criteria below.

| ID | Finding | Severity | Plane |
| --- | --- | --- | --- |
| F1 | `--status` silently returns 0 rows at exit 0 for any value outside the vocabulary, and the batch docs present a value the CLI never accepted | P2 | `apps/cli` + `packages/app` + `plugins/sp` docs |
| F2 | Dogfood `SKILL.md` documents 11 pipeline tokens; `PIPELINE_TOKENS` has 15 | P3 | `plugins/sp` |
| F3 | ADR-110 and the J31 design satellite both assert a retention fallback that does not exist | P3 | `docs/` authority |
| F4 | `spur task update --section "Q&A"` appends rather than replaces, and its `<!-- qa:replace -->` escape is documented nowhere | P3 | `apps/cli` help + `sp:spur-cli` references |
| F5 | `replaceSection` emits no blank line after the `###` heading; `insertSection` does — the same file ends up with both spellings | P4 | `packages/domain` |

**Why one task.** F1/F2/F4/F5 are harness-plane defects with no J31 content coupling; F3 is J31
authority-doc content. They are grouped because they share one evidence source and one review pass,
not because they share a seam. Each is independently landable — see the Plan's slice boundaries.

**Not carried forward.** The report's sixth finding (P3 cache-health, 24% aggregate) was filed
`[unverifiable]` with no in-run action: `--depth ready` premise verification reads source files
fresh by design, and separating that from driver waste needs per-step telemetry the driver cannot
read. It is a measurement-baseline question, not a defect, and is deliberately out of scope here.

**Traceability.** Deliberately created without a `feature_id`. Four of five findings belong to the
harness/CLI plane rather than J31 ("Observabilities module polish"); filing them under J31 would
record traceability that is not true. F3's J31 linkage is carried in References instead.

**Scope note (F1, operator ruling 2026-09-07).** The dogfood report proposed splitting `--status` on
comma so `backlog,todo` would resolve as a union. That half is **rejected**: no consumer in the repo
needs a list-valued `--status` (`execution-batch.md:108` already resolves multi-status membership
with per-status calls), and widening a public flag's semantics needs consent under
`docs/design/harness-surface-governance.md`. F1 here is the other half — the silent empty result —
plus the doc lines that invited the bad call. After the fix, `--status backlog,todo` exits 1 naming
the value.

### Requirements

- [x] R1. **(F1)** `spur task list --status <s>` (and its legacy `--phase <p>` alias) validates its
      argument against `TASK_STATUSES` before filtering. A value outside the vocabulary is a loud
      failure, not an empty result: exit code `1` and a message naming the offending value and the
      allowed set; under `--json` the failure travels the existing `writeJsonError` path so
      automation sees an error object, not `[]`. Validation goes through the existing
      `normalizeTaskStatus`, so case and legacy aliases (`--status TODO`, `--phase in-progress`) are
      accepted and resolve to their canonical status. `--status <one canonical status>` keeps its
      current result set byte-for-byte.
- [x] R2. **(F1)** `spur feature list --status <s>` gets the same treatment through
      `normalizeFeatureStatus`. Each noun validates against its own vocabulary — `active` is valid
      for features and invalid for tasks; `todo` is valid for tasks and invalid for features.
- [x] R3. **(F1)** The human (non-`--json`) task board collapses to the column for the *normalized*
      status, so `--status IN-PROGRESS` renders the `wip` column rather than falling through to the
      all-columns view. The silent all-columns fallback for an unrecognized value disappears —
      unrecognized values no longer reach the renderer.
- [x] R4. **(F1)** `plugins/sp/commands/dev-refineall.md:26,42` and
      `plugins/sp/skills/spur-dev/references/dev-operations.md:240,244` stop presenting
      `backlog,todo` as a single `--status` argument value. They state that the batch default is the
      two statuses `backlog` + `todo`, applied **in-agent** against the frozen set, and that
      `spur task list --status` takes exactly one canonical status per call — the resolution
      `plugins/sp/skills/spur-dev/references/execution-batch.md:108` already performs.
- [x] R5. **(F2)** The pipeline-token tables in `plugins/sp/skills/dogfood-testing/SKILL.md` list
      every entry of `PIPELINE_TOKENS` — all 15, including `dev-refineall`, `dev-verifyall`,
      `refineall`, `verifyall` — so an operator can predict from the docs alone which testees trip
      the `--max-retry` refuse gate.
- [x] R6. **(F2)** A contract test fails when the SKILL.md token list and the `PIPELINE_TOKENS`
      constant diverge in either direction. Doc drift is caught by CI, not by the next dogfood.
- [x] R7. **(F3)** `docs/00_ADR.md:2304` (ADR-110 Decision) and
      `docs/design/observabilities-module-polish.md:57-58` state the retention mechanism that is
      actually true — the quota list is extended with the uncataloged prefix at the persist site —
      and no longer claim uncataloged prefixes "resolve through the existing per-prefix quota
      fallback". Both restatements agree in mechanism with task 0794 Design D3c.
- [x] R8. **(F4)** `spur task update --help` and the `sp:spur-cli` task references
      (`references/tasks/verbs.md`, `references/tasks/section-editing.md`) state that `Q&A` appends
      a timestamped entry rather than replacing, and name the `<!-- qa:replace -->` first-line
      marker that forces a wholesale replace. The generic `--section <name>` description no longer
      reads as an unconditional "replace".
- [x] R9. **(F5)** `MarkdownDocument.replaceSection` produces the same spacing as `insertSection`:
      exactly one blank line between the `###` heading and the first body line, and a body trailer
      that leaves one blank line before the following heading. The normalisation is idempotent (no
      accumulating blank lines on re-write) and never rewrites content inside fenced code blocks.

**Non-goals.**

- **No comma-separated `--status` values.** `spur task list --status backlog,todo` must *fail*, not
  parse. Operator decision, 2026-09-07: a list-valued `--status` is unneeded surface — no in-repo
  consumer requires it (`execution-batch.md:108` already resolves multi-status membership as
  per-status calls unioned in-agent), and widening the semantics of a public flag needs consent
  under `docs/design/harness-surface-governance.md`. The defect is the silent empty result, and R1
  closes it. See Q3.
- No new `spur` noun, verb, or flag. F1 adds validation to an existing flag; it does not change what
  a valid value means.
- No normalisation of the *stored* side of the comparison. `list` keeps comparing against the raw
  `frontmatter.status`; a legacy alias sitting on disk is a corpus defect that `spur task migrate`
  owns, not a filter defect.
- No change to `PIPELINE_TOKENS` membership — F2 is a doc/test fix; the constant is already correct
  and already pinned by `pipeline-detect.test.ts:116`.
- No implementation of task 0794. F3 corrects the authority docs to agree with 0794's already-
  refined Design; 0794 stays the task that writes the code.
- No change to the Q&A append behaviour itself. F4 is documentation only — the append semantics are
  deliberate (task 0701 R7a).
- No corpus-wide reflow of existing task files to the new spacing. F5 fixes the writer; existing
  files converge as their sections are rewritten.

### Acceptance Criteria

```gherkin
Scenario: AC1 (R1) an unknown task status fails loudly instead of returning empty
  When I run "spur task list --status bogus"
  Then the exit code is 1
  And the message names "bogus" and lists the allowed task statuses
  And "spur task list --status bogus --json" emits a writeJsonError payload, not "[]"

Scenario: AC2 (R1) the original dogfood repro now fails instead of silently matching nothing
  When I run "spur task list --status backlog,todo --json"
  Then the exit code is 1
  And the message names "backlog,todo" as an unknown task status
  And the same holds for "spur task list --phase backlog,todo --json"

Scenario: AC3 (R1) valid values are unchanged and aliases resolve
  Given tasks exist in "todo"
  When I run "spur task list --status todo --json"
  Then the result is byte-identical to the pre-change behaviour for that command
  And "spur task list --status TODO --json" returns the same rows
  And "spur task list --phase in-progress --json" returns the same rows as "--status wip"

Scenario: AC4 (R2) each noun validates against its own vocabulary
  When I run "spur feature list --status active --json"
  Then the exit code is 0 and only active features are returned
  And "spur feature list --status todo --json" exits 1 because "todo" is not a feature status
  And "spur task list --status active --json" exits 1 because "active" is not a task status

Scenario: AC5 (R3) the human board collapses to the normalized column
  When I run "spur task list --status in-progress"
  Then the board renders exactly the "wip" column
  And no invocation renders the all-columns fallback for a value the vocabulary rejects

Scenario: AC6 (R4) the batch docs no longer present a comma string as a --status argument
  When I read plugins/sp/commands/dev-refineall.md and
       plugins/sp/skills/spur-dev/references/dev-operations.md at the --status entries
  Then the default is stated as the two statuses "backlog" + "todo" applied in-agent
  And neither document shows "backlog,todo" as a value passed to "spur task list --status"
  And execution-batch.md's per-status resolution is named as the mechanism, unchanged

Scenario: AC7 (R5, R6) documented pipeline tokens match the constant
  When the dogfood SKILL.md token inventories are compared with PIPELINE_TOKENS
  Then both inventories list all 15 tokens including dev-refineall and dev-verifyall
  And the parity test fails if a token is added to either side alone

Scenario: AC8 (R7) the authority docs state the retention mechanism that exists
  When I read docs/00_ADR.md ADR-110 Decision and docs/design/observabilities-module-polish.md R10
  Then neither claims uncataloged prefixes resolve through the existing per-prefix quota fallback
  And both describe binding the prefix at the persist site, agreeing with task 0794 Design D3c

Scenario: AC9 (R8) the Q&A write contract is discoverable from the CLI
  When I run "spur task update --help"
  Then it states that --section "Q&A" appends a timestamped entry rather than replacing
  And it names the "<!-- qa:replace -->" first-line marker that forces a wholesale replace
  And the sp:spur-cli task references carry the same exception

Scenario: AC10 (R9) rewritten and inserted sections share one spelling
  Given a task file whose sections were written by insertSection
  When a section body is rewritten through "spur task update --section <name> --from-file <path>"
  Then exactly one blank line separates the "###" heading from the first body line
  And exactly one blank line precedes the following section heading
  And repeating the identical write produces a byte-identical file
  And a fenced code block inside the body is unchanged
```

### Q&A

**Q1. One task for five unrelated findings, or five tasks?** — One. They share a single evidence
source (one dogfood run) and one review pass, and four of them are one- or two-file edits; five
tasks would cost more corpus overhead than they carry signal. The Plan makes them five independent
slices with their own gates so the grouping never forces a big-bang commit. *Deferred:* if slice 1
grows past its gate, split it out — it is the only one with real code behaviour.

**Q2. Why no `feature_id`?** — Four of five findings sit on the harness/CLI plane and have no J31
coupling. Filing them under J31 ("Observabilities module polish") would record traceability that is
not true, which is worse than none. F3 is genuinely J31 content and carries its linkage through
References instead. *Deferred:* if a harness-hardening feature is opened later, re-point this task
with `spur task update 0795 --feature <id>`.

**Q3. Should `--status` accept a comma-separated list?** — **No** (operator ruling, 2026-09-07;
overrides the dogfood report's suggested action). Three reasons, in order of weight:

1. *No consumer needs it.* `execution-batch.md:108` — the only in-repo place that resolves
   multi-status membership — already lists single statuses in its selector table and resolves
   `ready` as two `spur task list --status <one>` calls unioned by the driver. `refineall` itself
   resolves membership through `--feature`. The apparent demand was four doc lines, not a caller.
2. *It is public surface.* Changing what `--status` accepts is a semantic widening of a public flag
   and needs operator consent under `docs/design/harness-surface-governance.md`. Consent was asked
   for and declined.
3. *It does not fix the P2.* The defect is that a bad value is answered with exit 0 and `[]`.
   Parsing `backlog,todo` would make one bad value good and leave every other typo silent.

The correct fix is the inverse: make an invalid value impossible to pass unnoticed (R1–R3) and
correct the docs that suggested passing one (R4). `spur task list --status backlog,todo` then exits
1 with `Unknown task status: "backlog,todo" (allowed: backlog, todo, wip, testing, blocked, done,
cancelled)` — the caller learns immediately, instead of the shape being tolerated forever.
*Deferred:* if a real caller ever needs a union in one call, it arrives as a consent-gated surface
change with that caller as evidence.

**Q4. Where does the validation live — a new helper?** — No helper.
`normalizeTaskStatus` / `normalizeFeatureStatus` (`schema.ts:180,204`) already throw
`Unknown <noun> status: … (allowed: …)`, already tolerate case and legacy aliases (DD-01), and are
already used by every write path. F1 is calling them on the filter path. Rejected: a new
`parseStatusFilter` in `packages/domain` (a second validator and a second message family for the
same vocabulary); a check in `apps/cli/src/commands/shared-options.ts` (declared a pure
`[flags, description]` registry in its own header and enforced by
`apps/cli/tests/shared-option-parity.test.ts`); duplicating the check per call site (two places to
forget it).

**Q5. Amend ADR-110 in place, or supersede it?** — Amend. ADR-110 is `Proposed`, dated 2026-09-07,
and has no implementation depending on the wrong sentence. A superseding ADR is for reversing a
decision that shipped; this is a factual correction to a mechanism description inside a decision
that still stands. The decision — catalog-open ingestion — is unchanged.

**Q6. Should F4 change the Q&A append behaviour instead of documenting it?** — No. Append-only Q&A
is deliberate (task 0701 R7a): it is a decision log, and replacing it on every refinement would
destroy prior closures. The defect is that the contract is invisible — `--help` says "replace" and
the `<!-- qa:replace -->` escape appears in no document. Documentation is the whole fix.

**Q7. Should F5 also reflow the existing corpus?** — No. The writer fix converges files as their
sections are rewritten, and a corpus-wide sweep would produce a several-hundred-file diff whose
review value is zero while hiding any real change inside it. If a uniform corpus is wanted later it
is its own reviewable task.

**Q8. Why is the report's cache-health finding not here?** — It was filed `[unverifiable]` with no
in-run action. `--depth ready` premise verification reads source files fresh by design, so a 24%
aggregate is expected for that depth; separating it from genuine driver waste needs per-step
telemetry the driver cannot read. It is a measurement-baseline question, not a defect. *Deferred:*
if `ready`-depth and `standard`-depth cache rates are ever trended together, split the baselines
first.

**Q9. What proves F1 is really fixed, given the dogfood used a workaround?** — The original repro,
re-run against a rebuilt bundle (Plan step 4), now asserting the *opposite* outcome: exit 1 with the
value named. The dogfood resolved membership through `--feature` and filtered in-agent, so the batch
never exercised the broken path; acceptance evidence must come from the CLI directly, not from a
passing `refineall` run.

**Q10. Does R1 break any current caller that passes a value the vocabulary rejects?** — Any such
caller is already broken; it is receiving `[]` and treating it as "nothing matched". Turning that
into exit 1 surfaces the bug rather than creating one. The alias tolerance in `normalizeTaskStatus`
means the change is strictly widening for legitimate values: `--status TODO` and
`--phase in-progress` start working, and no previously-matching value stops working.

### Design

**Frozen names.** No new exported symbol. F1 reuses `normalizeTaskStatus` /
`normalizeFeatureStatus` (`packages/domain/src/planning/schema.ts:180,204`) — the throwing,
alias-tolerant normalizers that already own the `Unknown <noun> status: … (allowed: …)` message.
New doc-parity markers `<!-- pipeline-tokens:start -->` / `<!-- pipeline-tokens:end -->` (F2).
Reused unchanged: `TASK_STATUSES`, `FEATURE_STATUSES`, `TASK_CANONICAL_SECTIONS`,
`PIPELINE_TOKENS`, `writeJsonError`, `renderTaskBoard`, `MarkdownDocument.insertSection`,
`appendQaEntry`, `<!-- qa:replace -->`. **No** new flag, verb, helper, config key, DTO, or
migration.

**Files this task may touch.**

| File | Finding | Change |
| --- | --- | --- |
| `packages/app/src/services/task-service.ts` | F1 | normalize `status`/`phase` filters in `list()`; `:1699`,`:1702` |
| `apps/cli/src/commands/feature.ts` | F1 | normalize `options.status` before the filter at `:273` |
| `apps/cli/src/commands/task.ts` | F1, F4 | board columns `:851-856`; Q&A note in `addHelpText` `:418-430`, summary `:415` |
| `plugins/sp/commands/dev-refineall.md` | F1 | `:26`,`:42` state the default as two in-agent statuses |
| `plugins/sp/skills/spur-dev/references/dev-operations.md` | F1 | `:240`,`:244` same |
| `plugins/sp/skills/dogfood-testing/SKILL.md` | F2 | `:78-79`, `:338-339` complete + marker-wrapped |
| `plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts` | F2 | doc↔constant parity test |
| `docs/00_ADR.md` | F3 | `:2304` Decision mechanism |
| `docs/design/observabilities-module-polish.md` | F3 | `:57-58` R10 mechanism |
| `apps/cli/src/commands/shared-options.ts` | F4 | `:36` `--section` description |
| `plugins/sp/skills/spur-cli/references/tasks/verbs.md` | F4 | `:65`,`:88` Q&A exception |
| `plugins/sp/skills/spur-cli/references/tasks/section-editing.md` | F4 | `:48` Q&A exception |
| `packages/domain/src/planning/markdown-document.ts` | F5 | `replaceSection` `:387` spacing |

Not touched: `packages/domain/src/planning/schema.ts` (the normalizers already exist),
`plugins/sp/skills/spur-dev/references/execution-batch.md` (its per-status resolution is already
correct — it is the model the F1 doc fix points at), and the generated bundle copies under
`apps/cli/plugins/sp/**` (regenerated by `build:bundle`, never hand-edited).

**D1 — validate the filter with the normalizer that already exists (R1–R3).**

The vocabulary check, the error message, and the alias tolerance are all already written:

```ts
// packages/domain/src/planning/schema.ts:180
export function normalizeTaskStatus(raw: string): TaskStatus {
    const key = raw.trim().toLowerCase();
    const resolved = TASK_STATUS_ALIASES[key];
    if (resolved === undefined) {
        throw new Error(`Unknown task status: ${JSON.stringify(raw)} (allowed: ${TASK_STATUSES.join(', ')})`);
    }
    return resolved;
}
```

The whole of F1 is calling it on the filter path. Nothing new is exported, so there is no barrel
change, no parity-test surface, and no second message family for operators to learn. `task.ts:40`
already imports it.

**D1a — task path (R1).** In `TaskService.list()` (`task-service.ts:1679-1715`), normalize **before**
`readDir` so an invalid value fails without touching the filesystem:

```ts
const wantStatus = filters?.status === undefined ? undefined : normalizeTaskStatus(filters.status);
const wantPhase = filters?.phase === undefined ? undefined : normalizeTaskStatus(filters.phase);
```

`:1699` → `if (wantStatus !== undefined && wantStatus !== status) continue;` and `:1702` likewise
for `wantPhase`. `TaskListFilters` (`:348`) keeps `status?: string` — the CLI hands through one raw
string and the normalize happens at one seam. `--status` + `--phase` together keep today's
semantics (both filters apply), which is what the sequential `continue` pair already does. Add
`normalizeTaskStatus` to the existing `@gobing-ai/domain` import in this file.

**D1b — feature path (R2).** Inside the `try` opened at `feature.ts:270`, `:273` becomes:

```ts
const wantStatus = normalizeFeatureStatus(options.status);
features = features.filter((f) => f.status === wantStatus);
```

Import `normalizeFeatureStatus` from `@gobing-ai/domain` alongside the file's existing domain
imports. The feature filter deliberately stays in the CLI handler where it already lives; moving it
into `FeatureService.list()` is a refactor this task does not need.

**D1c — no new error plumbing (R1, R2).** Both handlers already wrap their work in
`try { … } catch (err) { writeJsonError(context.output, options, String(err)); context.setExitCode(1); }`
(`task.ts:858-860`, `feature.ts:288-290`). A thrown `Error` therefore yields exit `1` plus the
correct JSON error envelope for free. Do not add a bespoke validation branch in the action handler.

**D1d — board columns (R3).** `task.ts:851-856` today maps a canonical `requested` value to one
column and silently falls back to *all* columns for anything else — the rendering half of F1.
Replace with:

```ts
const requested = options.status ?? options.phase;
const columns = requested === undefined ? TASK_STATUSES : [normalizeTaskStatus(requested)];
```

The `includes` guard is no longer needed: an invalid value now throws in the service before
rendering is reached, and an alias resolves to its canonical column instead of expanding the board.
This call sits inside the same `try`, so a value that somehow reached here still exits 1 rather than
rendering a misleading board.

**D1e — correct the batch docs to describe what the CLI does (R4).** The `backlog,todo` string in
`dev-refineall.md:26,42` and `dev-operations.md:240,244` is a **slash-command** filter expression
applied in-agent to a frozen set — it was never a `spur task list` argument, and
`execution-batch.md:108` already spells out the real resolution (per-status calls, unioned by the
driver; `--feature` for the feature path). The docs read as if the string were passed through, which
is what sent the dogfood driver into the silent-empty trap. Restate the default as the two statuses
and name the boundary:

- `dev-refineall.md:26` (flag table) → default cell `` `backlog` + `todo` ``, description
  "Only refine tasks in these statuses (applied in-agent to the frozen set)."
- `dev-refineall.md:42` (prose) → `` `--status` (default `backlog` + `todo`) ``.
- `dev-operations.md:240` → "…default **`backlog` + `todo`** — planning-side fill candidates. The
  filter is applied in-agent against the frozen set; `spur task list --status` takes exactly one
  canonical status per call (see `execution-batch.md` Step 1)."
- `dev-operations.md:244` (Behavior step 2) → same parenthetical, replacing the bare
  `(default`backlog,todo`)`.

After R1 lands, an agent that ignores this and passes the string through gets exit 1 with the
allowed set — the doc fix and the validation close the trap from both ends.

**D2 — doc↔constant parity for the token tables (R5, R6).** Complete both SKILL.md inventories to
all 15 tokens and wrap each in `<!-- pipeline-tokens:start -->` / `<!-- pipeline-tokens:end -->`
(HTML comments, invisible when rendered). The new test in `pipeline-detect.test.ts` reads SKILL.md,
extracts every backticked span between each marker pair, and asserts the union equals
`new Set(PIPELINE_TOKENS)` — failing in both directions. Anchoring on markers rather than a regex
over the whole document keeps the test from breaking when unrelated prose gains a backtick.
Precedent: `apps/cli/tests/shared-option-parity.test.ts` is the same doc-vs-code parity shape.

**D3 — correct the retention mechanism in both authority docs (R7).** ADR-110 is `Proposed` and
dated today, so amend in place rather than superseding it; `docs/99` gives `00` content authority,
which is exactly why it must not keep asserting a mechanism the code does not implement.

`docs/design/observabilities-module-polish.md:57-58` →

```
- Retention: `resolveRetentionQuotas` enumerates catalog prefixes only, so an uncataloged prefix is
  unbounded until the persist site adds it. Bound it there — append
  `{ prefix, quota: config.default ?? DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA }` to the quota list when
  the prefix is absent, then prune scoped to that prefix. Still no new config shape (R10).
```

`docs/00_ADR.md:2304` — inside the Decision's parenthetical, replace
`per-prefix quota fallback` with
`per-prefix quota bound at the persist site (the resolver enumerates catalog prefixes only)`.
Leave the rest of the Decision, the Why, and the Detail unchanged.

**D4 — document the Q&A exception where it is true (R8).** `SHARED_OPTIONS.section` is consumed by
both `task update` (`task.ts:432`) and `feature update` (`feature.ts:92`), and features carry no
`Q&A` section (`FEATURE_CANONICAL_SECTIONS`, `markdown-document.ts:51-58`) — so the exception must
**not** go in the shared string. Two edits instead:

- `shared-options.ts:36` → `['--section <name>', 'Section name to write']`. Drops the false
  unconditional "replace" without asserting task-only behaviour on the feature surface. Updating the
  registry entry updates both call sites at once, which is what the parity test expects.
- `apps/cli/src/commands/task.ts` — add to the existing `addHelpText('after', …)` block
  (`:418-430`) two lines naming the exception and the escape hatch, e.g.
  `'Sections replace, with one exception:`--section "Q&A"`APPENDS a timestamped'` /
  `'`#### Q&A entry — <ISO>` block. Start the body with `<!-- qa:replace -->`to replace it wholesale.'`
  Also correct `.summary()` at `:415` from "replace a section" to "write a section".

Mirror the same two facts into `plugins/sp/skills/spur-cli/references/tasks/verbs.md:65,88` and
`.../section-editing.md:48`, which today list `Q&A` among replaceable sections with no exception.

**D5 — normalise spacing at the single writer (R9).** `markdown-document.ts:387` →

```ts
const trimmed = cleaned.trim();
section.modifiedText = trimmed.length > 0
    ? `${section.headingLine}\n\n${trimmed}\n\n`
    : `${section.headingLine}\n\n`;
```

This is byte-identical in shape to `insertSection:448`, so the two writers stop disagreeing.
Idempotency (R9) comes from `trim()`: a body that already carries surrounding blank lines collapses
to the same output. Fenced code blocks are safe — `trim()` only touches the ends of the whole body,
never interior lines. The empty-body branch preserves today's ability to blank a section without
fusing it into the next heading.

**Anti-patterns — do not implement.**

- Do **not** add comma-list parsing to `--status`, a `--statuses` flag, a repeated `--status`, or a
  sentinel value like `any`/`all`. The operator ruled list-valued status out (Q3); after R1 the
  comma string is a rejected value, which is the intended outcome, not a gap to close.
- Do **not** write a new `parseStatusFilter`-style helper. `normalizeTaskStatus` /
  `normalizeFeatureStatus` already throw with the right message; a second validator means two
  message families and a second place to forget.
- Do **not** widen `TaskListFilters.status` to `string[]` or add a `statuses` field.
- Do **not** downgrade the throw to a warning-and-skip. Silently dropping an unknown value
  reproduces F1 with extra steps.
- Do **not** normalize the stored side (`normalizeTaskStatusSafe(fm.status)`) in `list()`. Storage
  is canonical by contract (schema.ts header, DD-01) and `spur task migrate` owns any stale alias on
  disk; normalizing on read would hide a corpus defect behind the filter.
- Do **not** edit `PIPELINE_TOKENS` to match the prose. The constant is correct and pinned by
  `pipeline-detect.test.ts:116-136`; the doc is what drifted.
- Do **not** change the Q&A append semantics or remove `<!-- qa:replace -->`. F4 is a documentation
  defect; the behaviour is deliberate (task 0701 R7a).
- Do **not** put the Q&A wording in `SHARED_OPTIONS.section` — it would print on `feature update`,
  which has no `Q&A` section.
- Do **not** "fix" F5 by teaching `stripLeadingSectionHeader` (`task-service.ts:388-397`) to
  preserve the author's blank lines. That makes on-disk formatting depend on how each caller happens
  to format its temp file; normalise once at the writer instead.
- Do **not** reflow existing task files to the new spacing in this task. The writer converges them
  as sections are rewritten; a corpus-wide sweep is a separate, reviewable change.
- Do **not** hand-edit `apps/cli/plugins/sp/**`; it is regenerated by `build:bundle`.

### Plan

Five independent slices. Each ends green on its own gate, so they can land as separate commits in
any order — only the steps inside slice 1 are ordered.

**Slice 1 — F1 status-filter validation (R1–R4).** The only behaviour change; do it first.

- [x] 1. **(R1)** Import `normalizeTaskStatus` into `packages/app/src/services/task-service.ts` and
      normalize `filters.status` / `filters.phase` at the top of `list()` (`:1679`, before
      `readDir`), converting `:1699` / `:1702` to compare the normalized value. Extend
      `packages/app/tests/services/task-service.test.ts` beside the existing filter cases (`:373`,
      `:410`): unknown value throws with the allowed set in the message, `"backlog,todo"` throws,
      an uppercase/alias value returns the canonical rows, a canonical value is unchanged.
      `cd packages/app && bun test tests/services/task-service.test.ts`
- [x] 2. **(R2, R3)** Import `normalizeFeatureStatus` into `apps/cli/src/commands/feature.ts` and
      normalize `options.status` inside the existing `try` (`:270`) before the `:273` filter;
      replace the `requested`/`columns` block at `task.ts:851-856` with the D1d two-liner.
- [x] 3. **(R1–R3)** Add CLI-level coverage in `apps/cli/tests/commands/task.test.ts` and
      `apps/cli/tests/commands/feature.test.ts`: exit code 1 plus a JSON error payload for `bogus`
      and for `backlog,todo` (assert the payload is **not** `[]`), cross-vocabulary rejection
      (`task --status active`, `feature --status todo`), and the board rendering exactly the `wip`
      column for `--status in-progress`.
      `cd apps/cli && bun test tests/commands/task.test.ts tests/commands/feature.test.ts`
- [x] 4. **(R1, R4)** Rebuild (`cd apps/cli && bun link && bun run --filter @gobing-ai/spur
      build:bundle`) and re-run the original repro: `spur task list --status backlog,todo --json`
      now exits 1 naming the value, `spur task list --status todo --json` still returns its rows.
      Then apply the D1e wording to `plugins/sp/commands/dev-refineall.md:26,42` and
      `plugins/sp/skills/spur-dev/references/dev-operations.md:240,244`, leaving
      `execution-batch.md` untouched, and re-run `build:bundle` so the `apps/cli/plugins/sp/**`
      copies follow.

**Slice 2 — F2 dogfood token-table parity (R5, R6).**

- [x] 5. Complete both inventories in `plugins/sp/skills/dogfood-testing/SKILL.md` (`:78-79`,
      `:338-339`) to all 15 tokens and wrap each in
      `<!-- pipeline-tokens:start -->` / `<!-- pipeline-tokens:end -->`.
- [x] 6. Add the doc↔constant parity test to
      `plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts` (D2). Prove it fails by temporarily
      deleting one token from the doc, then restore.
      `bun test plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts`

**Slice 3 — F3 authority-doc retention premise (R7).** Docs only; no code.

- [x] 7. Apply the D3 replacements to `docs/design/observabilities-module-polish.md:57-58` and to
      the ADR-110 Decision parenthetical at `docs/00_ADR.md:2304`. Leave ADR-110's Status
      (`Proposed`), Why, and Detail untouched.
- [x] 8. Re-read task 0794 Design D3c and confirm both restatements agree with it in mechanism —
      the quota list is extended at the persist site, and `resolveRetentionQuotas`'s override
      typo-guard is unchanged.

**Slice 4 — F4 Q&A write contract (R8).** Help text and references only; no behaviour change.

- [x] 9. `shared-options.ts:36` → `['--section <name>', 'Section name to write']`; add the two Q&A
      lines to the `addHelpText('after', …)` block at `task.ts:418-430`; correct `.summary()` at
      `:415`. Verify with `spur task update --help`.
- [x] 10. Mirror the exception and the `<!-- qa:replace -->` marker into
      `plugins/sp/skills/spur-cli/references/tasks/verbs.md:65,88` and `.../section-editing.md:48`.
- [x] 11. Re-run the surface-parity suites that read those files:
      `cd apps/cli && bun test tests/shared-option-parity.test.ts tests/spur-cli-parity.test.ts`,
      then `bun test plugins/sp/tests/cli-surface-parity.test.ts`.

**Slice 5 — F5 section spacing (R9).** Smallest diff, widest blast radius — land last.

- [x] 12. Apply the D5 change at `markdown-document.ts:387`, then run
      `cd packages/domain && bun test tests/planning/markdown-document.test.ts` and
      `cd packages/app && bun test tests/services/planning-write-service.test.ts tests/services/task-service.test.ts`.
      Expect exact-string assertions to fail; repair each by updating the expected fixture, never by
      weakening the assertion.
- [x] 13. Add a `markdown-document.test.ts` case covering R9 directly: the heading→body gap, the
      gap before the next heading, idempotence on re-write, a fenced code block preserved verbatim,
      and the last section in a file (`History`) not accumulating blank lines at EOF.
- [x] 14. Round-trip a real file: run the same `spur task update <wbs> --section Notes --from-file`
      twice and diff — the second write must produce no change.

**Close-out.**

- [x] 15. `bun run autofix && bun run spur-check && bun run test && bun run build` green, then
      `spur task check 0795` → `pass: true`, and record the evidence in Testing.

### Root Cause

Each cause below was reproduced or read directly against the tree at HEAD `8963ab161`.

**F1 — a filter path that never checks its own vocabulary.**
The status vocabularies and a throwing, alias-tolerant normalizer for each of them already exist
(`packages/domain/src/planning/schema.ts:20,23,180,204`). Every *write* path uses them —
`planning-write-service.ts:621`, `corpus-migrator.ts:123`, `task.ts:91`. The *filter* path uses
none of them, in either layer:

- `packages/app/src/services/task-service.ts:1699` —
  `if (filters?.status !== undefined && filters.status !== status) continue;`
  Raw string equality against the on-disk value. Nothing consults `TASK_STATUSES`, so any value the
  vocabulary would reject simply matches no file. Line `:1702` repeats it for the `phase` alias.
- `apps/cli/src/commands/feature.ts:273` — `features.filter((f) => f.status === options.status)`.
  Same defect, different layer: features filter in the CLI, tasks filter in the service.

The renderer then hides the failure a second time. `apps/cli/src/commands/task.ts:851-856` picks the
board's columns with
`requested !== undefined && TASK_STATUSES.includes(requested) ? [requested] : TASK_STATUSES` — an
unrecognized value falls through to the *all-columns* view, so a typo prints a full, plausible board
with every column empty of the rows the operator expected.

Reproduced (2026-09-07, source-local CLI):

```
spur task list --status backlog,todo --json   → []      exit 0
spur task list --status bogus --json          → []      exit 0
spur task list --status todo --json           → 2 rows  exit 0
spur feature list --status backlog,todo --json→ []      exit 0
spur task list --status backlog,todo          → "(no tasks)"  exit 0
```

Exit 0 with an empty set is indistinguishable from "the filter matched nothing", which is why a
batch driver's `aborted (empty set after filter)` report carries no explanation of what went wrong.

**Why the comma string was passed at all — a doc defect, not a missing feature.**
`plugins/sp/commands/dev-refineall.md:26,42` and
`plugins/sp/skills/spur-dev/references/dev-operations.md:240,244` give `refineall`'s `--status`
default as the literal string `backlog,todo`. That flag is a **slash-command** filter applied
in-agent to an already-frozen set; it was never a `spur task list` argument. The real resolution is
spelled out at `plugins/sp/skills/spur-dev/references/execution-batch.md:108`, whose selector table
lists single statuses only (`todo | backlog | wip | blocked | testing`) and resolves `ready` as the
union of two separate `spur task list --status <one>` calls. So no consumer in the repo needs a
list-valued `--status` — but four doc lines read as if one existed, and an agent that trusts them
constructs a call the CLI answers with a silent empty set. Root cause is therefore two-sided: the
CLI accepts a value it should reject, and the docs describe a value the CLI never accepted.
**F2 — the doc table is hand-maintained; only the constant is tested.**
`plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:50-66` defines 15 tokens.
`plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts:116-136` pins all 15 by value, so the
constant cannot drift unnoticed. The prose tables at
`plugins/sp/skills/dogfood-testing/SKILL.md:78-79` (the refuse-gate bullet) and `:338-339` (the
word-boundary contract table) list 11 — the four `*refineall` / `*verifyall` entries are missing —
and nothing tests them. Tokens were added to the constant without a paired doc edit, and no gate
noticed. This run classified `pipelineDriving: true` for a reason no doc explains.

**F3 — a plausible-sounding mechanism that the resolver does not implement.**
`packages/app/src/services/system-event-retention.ts:34-43`:

```ts
export function resolveRetentionQuotas(
    config: SystemEventRetentionConfig = {},
    prefixes: readonly string[] = SYSTEM_EVENT_PREFIXES,
): SystemEventRetentionQuotas {
    …
    return prefixes.map((prefix) => ({ prefix, quota: overrides[prefix] ?? defaultQuota }));
}
```

The returned list is keyed by the *catalog* prefixes; its docstring says so explicitly ("Unknown
override keys (prefixes not in the catalog) are ignored"). `pruneQuotas`
(`packages/domain/src/dao/system-event-dao.ts:268`, called from
`packages/app/src/services/system-event-tap.ts:132` and
`packages/app/src/services/system-event-emitter.ts:80`) prunes only the prefixes in that list, so a
prefix absent from the catalog is never pruned — **unbounded**, which is the exact failure the
resolver exists to prevent. Yet `docs/design/observabilities-module-polish.md:57-58` asserts
"uncataloged prefixes resolve through the existing per-prefix quota fallback (documented default),
so no new config shape (R10)", and `docs/00_ADR.md:2304` carries the same claim inside ADR-110's
Decision as "per-prefix quota fallback". Task 0794 Design D3c already records the correction; the
authority docs did not get it, so the task and the ADR it derives from now disagree.

**F4 — a deliberate exception with no documentation, and an escape hatch nobody can find.**
`packages/app/src/services/planning-write-service.ts:587-597` (`appendQaEntry`): unless the body's
first non-whitespace token is `<!-- qa:replace -->`, the write appends
`#### Q&A entry — <ISO>` beneath whatever the section already holds. That is intentional (task 0701
R7a — Q&A is an append-only decision log), but:

- `apps/cli/src/commands/shared-options.ts:36` declares the flag as
  `['--section <name>', 'Section name to replace']`, which `spur task update --help` prints verbatim.
- `grep -rn "qa:replace"` across the repo matches **only** the three lines of its own
  implementation. The marker appears in no help text, no `sp:spur-cli` reference, no design doc.

The `sp:spur-cli` task references (`references/tasks/verbs.md:65,88`,
`references/tasks/section-editing.md:48`) list `Q&A` among the replaceable canonical sections with
no exception noted. A caller trusting the documented contract writes duplicate content and leaves
the section's placeholder comment stranded above it — which is what happened to tasks 0793/0794 in
this dogfood run.

**F5 — two writers, two spellings.**
`packages/domain/src/planning/markdown-document.ts`:

- `insertSection` (`:448`) builds `` `${headingLine}\n\n${body.trimEnd()}\n\n` `` — blank line after
  the heading, blank line before the next section.
- `replaceSection` (`:387`) builds `` `${section.headingLine}\n${withTrailer}` `` — neither.

`withTrailer` guarantees only a single terminating `\n`, so a rewritten section also loses the blank
line that separated it from the following heading. Compounding it,
`packages/app/src/services/task-service.ts:388-397` (`stripLeadingSectionHeader`) removes a leading
heading *and the blank lines after it* from `--from-file` bodies, so the body handed to
`replaceSection` starts at the first content line with nothing to restore the gap.

Observable in one file: in
`docs/tasks4/0793_align-observabilities-header-and-hoist-the-time-range-select.md`, the sections the
testee rewrote (`Background` `:15`, `Requirements` `:49`, `Design` `:130`, `Plan` `:173`,
`References` `:201`) have body on the line immediately after the heading, while the untouched
sections (`Acceptance Criteria` `:70`, `Q&A` `:98`, `Solution` `:189`, `Testing` `:193`,
`Review` `:197`) keep their blank line. Renders fine and passes `spur task check`; it is a
consistency defect, not a correctness one — hence P4.

### Solution

F1–F5 from the J31 refineall dogfood, landed as five independent slices. No new noun/verb/flag; `--status backlog,todo` is a rejected value, not a union.

**F1 (R1–R4) — loud `--status` validation.** `TaskService.list()` now calls `normalizeTaskStatus` on `status`/`phase` before `readDir`, so unknown values throw `Unknown task status: … (allowed: …)` instead of matching nothing. Feature list uses `normalizeFeatureStatus` at the existing CLI filter. The human board collapses to the *normalized* column (`in-progress` → `wip`); the all-columns fallback is gone. Batch docs state the default as two in-agent statuses, not a CLI comma-list.

- `packages/app/src/services/task-service.ts:18` — import `normalizeTaskStatus`
- `packages/app/src/services/task-service.ts:1681-1685` — normalize filters before `readDir`
- `packages/app/src/services/task-service.ts:1702,1705` — compare normalized want vs stored status
- `apps/cli/src/commands/feature.ts:10` — import `normalizeFeatureStatus`
- `apps/cli/src/commands/feature.ts:274-275` — validate then filter
- `apps/cli/src/commands/task.ts:851-853` — board columns from `normalizeTaskStatus`
- `plugins/sp/commands/dev-refineall.md:26,42` — default `backlog` + `todo`, applied in-agent
- `plugins/sp/skills/spur-dev/references/dev-operations.md:240,244` — same; points at `execution-batch.md` Step 1

**F2 (R5–R6) — pipeline-token inventories.** Both SKILL.md tables list all 15 `PIPELINE_TOKENS`, wrapped in `<!-- pipeline-tokens:start/end -->`. The contract test fails if either inventory or the constant drifts.

- `plugins/sp/skills/dogfood-testing/SKILL.md:78-81` — refuse-gate inventory, all 15 tokens incl. `dev-refineall`, `dev-verifyall`
- `plugins/sp/skills/dogfood-testing/SKILL.md:341-342` — word-boundary table Examples cells, `dev-runall` + `verifyall`
- `plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts:139-158` — doc↔constant parity

**F3 (R7) — retention premise.** ADR-110 Decision parenthetical and the J31 satellite now describe binding the uncataloged prefix at the persist site (resolver still enumerates catalog prefixes only), agreeing with task 0794 Design D3c. Status/Why/Detail untouched.

- `docs/00_ADR.md:2304` — Decision parenthetical
- `docs/design/observabilities-module-polish.md:57-60` — R10 mechanism

**F4 (R8) — Q&A write contract.** Shared `--section` no longer says unconditional "replace". `task update --help` names the append exception and `<!-- qa:replace -->`. Feature help is unchanged (no `Q&A` section).

- `apps/cli/src/commands/shared-options.ts:36` — "Section name to write"
- `apps/cli/src/commands/task.ts:415` — summary "write a section"
- `apps/cli/src/commands/task.ts:430-431` — Q&A append + replace marker
- `plugins/sp/skills/spur-cli/references/tasks/verbs.md:64-67,90` — Q&A exception
- `plugins/sp/skills/spur-cli/references/tasks/section-editing.md:43-48` — Q&A exception

**F5 (R9) — `replaceSection` spacing.** Same spelling as `insertSection`: one blank line after the `###` heading and a body trailer before the next heading. `trim()` keeps rewrites idempotent; fenced interiors are untouched.

- `packages/domain/src/planning/markdown-document.ts:382-387` — heading/body/trailer spelling

**Verify-run fix (P2, server read path).** R1's validation lives in the shared `TaskService.list()`, so the oRPC task-list handler inherited the throw: `taskListInputSchema.status` is a free-form string, so `?status=bogus` reached the service and surfaced as 500 INTERNAL_ERROR instead of the pre-change empty list. `toFilters` now normalizes the status and maps the failure to `HTTPException(400)` — the file's existing idiom — so aliases still resolve and the service receives the canonical value.

- `apps/server/src/modules/task/handlers.ts:3` — import `normalizeTaskStatus`
- `apps/server/src/modules/task/handlers.ts:10-24` — normalize in `toFilters`; unknown status → 400
- `apps/server/tests/modules/task/handlers.test.ts:105-136` — 400 regression + alias resolution

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/task-service.ts:1679-1686` normalizes `status`/`phase` through `normalizeTaskStatus` before `readDir` (re-read this run); `:1700-1706` compare canonical want vs stored status. Live this run: `bun apps/cli/src/index.ts task list --status bogus` → exit 1, stderr `Unknown task status: "bogus" (allowed: backlog, todo, wip, testing, blocked, done, cancelled)`; `--json` exit 1 with empty stdout (not `[]`); `--json --json-envelope` emits `{"ok":false,"error":{"code":"INTERNAL_ERROR",...}}`. Tests: `apps/cli/tests/commands/task.test.ts:753,764,775`, `packages/app/tests/services/task-service.test.ts:414-424` — suites green this run (CLI 232 pass / 0 fail; app 118 pass / 0 fail). |
| R2 | MET | `apps/cli/src/commands/feature.ts:273-276` validates through `normalizeFeatureStatus` then filters. Live this run: `feature list --status active --json` → exit 0, 8 rows; `feature list --status todo --json` → exit 1 `Unknown feature status: "todo" (allowed: backlog, active, verifying, blocked, done, cancelled)`; `task list --status active --json` → exit 1 `Unknown task status: "active"`. Test: `apps/cli/tests/commands/feature.test.ts:207-244` — green in the 232-pass CLI run. |
| R3 | MET | `apps/cli/src/commands/task.ts:851-853` — `columns = requested === undefined ? TASK_STATUSES : [normalizeTaskStatus(requested)]`; the all-columns fallback is gone (re-read this run). Live this run: `task list --status done` renders only the `✅ Done` column header (the "Testing" hit is task 0671's title, not a column); unfiltered `task list` renders all seven columns. Rejected values exit 1 before the renderer. Test: `apps/cli/tests/commands/task.test.ts:792` — green. |
| R4 | MET | `plugins/sp/commands/dev-refineall.md:26,42` state the default as `` `backlog` + `todo` `` applied in-agent (re-read this run); `plugins/sp/skills/spur-dev/references/dev-operations.md:240,244` state in-agent application + one canonical status per call, naming `execution-batch.md` Step 1. `rg --fixed-strings 'backlog,todo'` over both files → exit 1 (no matches, this run). `plugins/sp/skills/spur-dev/references/execution-batch.md:108` per-status resolution unchanged. |
| R5 | MET | `plugins/sp/skills/dogfood-testing/SKILL.md:78-81` refuse-gate inventory inside `<!-- pipeline-tokens:start/end -->` includes `dev-refineall`, `dev-verifyall`, `refineall`, `verifyall` (re-read this run); `:341-342` word-boundary Examples cells. `PIPELINE_TOKENS` constant has 15 entries (`plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:50-66`, counted this run). |
| R6 | MET | `plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts:139-158` asserts marker-block inventory equals `PIPELINE_TOKENS` in both directions. This run: `cd plugins/sp && bun test tests/dogfood-testing/pipeline-detect.test.ts tests/skill-structure.test.ts` → 127 pass / 0 fail. |
| R7 | MET | `docs/00_ADR.md:2326` (re-anchored from stale :2304 — line drift, content intact) ADR-110 Decision parenthetical reads `per-prefix quota bound at the persist site (the resolver enumerates catalog prefixes only)`. `docs/design/observabilities-module-polish.md:57-60` describes appending the quota row at the persist site then pruning scoped to that prefix (re-read this run). `rg --fixed-strings 'per-prefix quota fallback'` over both files → exit 1 (no matches, this run). Agrees with task 0794 Design D3c. |
| R8 | MET | `apps/cli/src/commands/shared-options.ts:36` — `Section name to write` (re-read). Live this run: `bun apps/cli/src/index.ts task update --help` line 14 `--section <name>  Section name to write`; lines 55-56 name the `Q&A` APPENDS exception and the `<!-- qa:replace -->` marker; `feature update --help` contains no `Q&A` (grep count 0). References: `plugins/sp/skills/spur-cli/references/tasks/verbs.md:64-67` (re-read) and `plugins/sp/skills/spur-cli/references/tasks/section-editing.md:49-50` (re-anchored from stale :47-49). Test: `apps/cli/tests/commands/task.test.ts:830` — green. |
| R9 | MET | `packages/domain/src/planning/markdown-document.ts:382-387` — `heading\n\n${trimmed}\n\n` spelling matching `insertSection`, `trim()` idempotence (re-read this run). This run: `cd packages/domain && bun test tests/planning/markdown-document.test.ts` → 74 pass / 0 fail (heading/body/trailer gap, byte-identical rewrite, fenced interior, History-at-EOF). CLI round trip `apps/cli/tests/commands/task.test.ts:658` — green in the 232-pass run. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 (R1) an unknown task status fails loudly instead of returning empty | MET | command | Live this run: `task list --status bogus` → exit 1, names `"bogus"` + allowed set; `--json` exit 1, stdout empty (not `[]`); `--json-envelope` → `{"ok":false,"error":{...}}`. Test `apps/cli/tests/commands/task.test.ts:753` green this run (232 pass / 0 fail). |
| AC2 (R1) the original dogfood repro now fails instead of silently matching nothing | MET | command | Live this run: `task list --status backlog,todo --json` → exit 1 naming `"backlog,todo"`; `--phase backlog,todo --json` → exit 1, same message. Tests `apps/cli/tests/commands/task.test.ts:764,775` green. |
| AC3 (R1) valid values are unchanged and aliases resolve | MET | command | Live this run: `--status TODO --json` byte-identical to `--status todo --json` (diff empty); `--phase in-progress --json` byte-identical to `--status wip --json` (diff empty). Tests `apps/cli/tests/commands/task.test.ts:808` + `packages/app/tests/services/task-service.test.ts:425` green. |
| AC4 (R2) each noun validates against its own vocabulary | MET | command | Live this run: `feature list --status active --json` → exit 0, 8 rows all active; `feature list --status todo --json` → exit 1; `task list --status active --json` → exit 1. Tests `apps/cli/tests/commands/feature.test.ts:207`, `apps/cli/tests/commands/task.test.ts:783` green. |
| AC5 (R3) the human board collapses to the normalized column | MET | command | Live this run: `task list --status done` renders only the `✅ Done` column header; unfiltered renders all seven. (Original `TESTING` evidence unobservable today — zero testing-status tasks; the collapse mechanism is what is asserted.) Code re-read: `apps/cli/src/commands/task.ts:851-853`. Test `apps/cli/tests/commands/task.test.ts:792` green. |
| AC6 (R4) the batch docs no longer present a comma string as a --status argument | MET | command | `rg --fixed-strings 'backlog,todo' plugins/sp/commands/dev-refineall.md plugins/sp/skills/spur-dev/references/dev-operations.md` → exit 1 this run. `plugins/sp/commands/dev-refineall.md:26,42` + `plugins/sp/skills/spur-dev/references/dev-operations.md:240,244` re-read; `plugins/sp/skills/spur-dev/references/execution-batch.md:108` unchanged. |
| AC7 (R5, R6) documented pipeline tokens match the constant | MET | test | `cd plugins/sp && bun test tests/dogfood-testing/pipeline-detect.test.ts tests/skill-structure.test.ts` → 127 pass / 0 fail this run, including the marker-block ↔ `PIPELINE_TOKENS` parity test (`plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts:139-158`). |
| AC8 (R7) the authority docs state the retention mechanism that exists | MET | command | `rg --fixed-strings 'per-prefix quota fallback' docs/00_ADR.md docs/design/observabilities-module-polish.md` → exit 1 this run. ADR-110 Decision re-read at `docs/00_ADR.md:2326`; satellite `:57-60` re-read; both agree with 0794 D3c. |
| AC9 (R8) the Q&A write contract is discoverable from the CLI | MET | command | Live this run: `task update --help` → `Section name to write` (line 14) + Q&A APPENDS + `<!-- qa:replace -->` (lines 55-56); `feature update --help` has no `Q&A`. References re-read: `plugins/sp/skills/spur-cli/references/tasks/verbs.md:64-67`, `plugins/sp/skills/spur-cli/references/tasks/section-editing.md:49-50`. Test `apps/cli/tests/commands/task.test.ts:830` green. |
| AC10 (R9) rewritten and inserted sections share one spelling | MET | test | `cd packages/domain && bun test tests/planning/markdown-document.test.ts` → 74 pass / 0 fail this run (single-blank-line spelling, idempotent rewrite, fenced verbatim, EOF History). CLI Notes double-write `apps/cli/tests/commands/task.test.ts:658` green. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Review verdict: PASS** — independent review of F1–F5 (status-filter validation, dogfood token-table parity, ADR-110 retention premise, Q&A write-contract docs, `replaceSection` spacing). Functional traceability 9/9 MET. Design claims D1–D5 DONE (anti-patterns honored: no comma-list `--status`, no new helper, no Q&A behavior change, no corpus reflow). No P1–P3. Two P4 residuals in derived/lead docs, neither blocking.

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | usability | `docs/help/cmd_task.md:116`, `docs/help/cmd_feature.md:108` | Derived help dumps still say `Section name to replace`. R8's named surfaces (`spur task update --help`, `shared-options.ts:36`, spur-cli refs) are correct; this dump was not in the Design file list. Follow-up: regen `docs/help/` when that generator next runs. |
| P4 | usability | `plugins/sp/skills/spur-cli/references/tasks/section-editing.md:10-13` | Recipe intro still says the named section "is replaced wholesale" before the Q&A exception at `:47-49`. Agents who stop at the intro can miss the append contract. Soften the lead or add a one-line forward pointer. |

**Functional Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/task-service.ts:1681-1682` normalizes `status`/`phase` via `normalizeTaskStatus` before `readDir`; `:1702,:1705` compare canonical want vs stored status. CLI catch `apps/cli/src/commands/task.ts:856-858` uses existing `writeJsonError` + exit 1. Tests: `packages/app/tests/services/task-service.test.ts` (unknown / `backlog,todo` throw); `apps/cli/tests/commands/task.test.ts` (`bogus`, comma-list, `--phase` comma-list, `--json` not `[]`). |
| R2 | MET | `apps/cli/src/commands/feature.ts:274-275` `normalizeFeatureStatus` then filter; catch `:290-292`. CLI test `apps/cli/tests/commands/feature.test.ts` (`--status active` ok; `--status todo` exit 1, not `[]`). Cross-vocab: task `--status active` rejected in `task.test.ts`. |
| R3 | MET | `apps/cli/src/commands/task.ts:851-853` `columns = requested === undefined ? TASK_STATUSES : [normalizeTaskStatus(requested)]` — all-columns fallback gone. Test: `--status in-progress` renders `WIP` only. |
| R4 | MET | `plugins/sp/commands/dev-refineall.md:26,42` default `` `backlog` + `todo` ``, in-agent; `plugins/sp/skills/spur-dev/references/dev-operations.md:240,244` same + `execution-batch.md` Step 1. No `backlog,todo` as a `spur task list --status` value. |
| R5 | MET | `plugins/sp/skills/dogfood-testing/SKILL.md:78-81` refuse-gate inventory (all 15, markers); `:341-342` word-boundary Examples (union of both cells = 15). |
| R6 | MET | `plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts:139-158` marker-block backtick union equals `PIPELINE_TOKENS` both directions. Necessary CI fixture: `plugins/sp/tests/skill-structure.test.ts:810-813` body-budget baseline 38800 → 39103. |
| R7 | MET | `docs/00_ADR.md:2304` Decision parenthetical: quota bound at persist site (resolver enumerates catalog prefixes only). `docs/design/observabilities-module-polish.md:57-60` matches 0794 Design D3c (append quota row, prune scoped to prefix). Status/Why/Detail untouched. |
| R8 | MET | `apps/cli/src/commands/shared-options.ts:36` "Section name to write"; `apps/cli/src/commands/task.ts:415,430-431` Q&A APPENDS + `<!-- qa:replace -->`; `plugins/sp/skills/spur-cli/references/tasks/verbs.md:64-67,90`; `.../section-editing.md:47-49`. Help test in `task.test.ts`. Feature help unchanged (no `Q&A`). |
| R9 | MET | `packages/domain/src/planning/markdown-document.ts:385-387` `heading\n\n${trimmed}\n\n` (empty → `heading\n\n`). Tests: heading/body/trailer gap, idempotence, fenced interior, last-section History; CLI Notes round-trip in `task.test.ts`. |

**Acceptance Criteria**

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 unknown task status fails loudly | MET | CLI test `list --status bogus --json` exit 1, names `"bogus"`, allowed set, stdout not `[]`. Same `writeJsonError` catch for human path. |
| AC2 dogfood repro `backlog,todo` fails | MET | CLI tests for `--status` and `--phase` `backlog,todo --json`. |
| AC3 valid values + aliases | MET | Service + CLI tests: canonical `todo`/`wip` unchanged; `TODO` and `--phase in-progress` resolve. |
| AC4 per-noun vocabulary | MET | Feature `--status active` / `--status todo`; task `--status active`. |
| AC5 board collapses to normalized column | MET | `--status in-progress` → `WIP` only (`task.ts:851-853` + CLI test). |
| AC6 batch docs | MET | `dev-refineall.md:26,42`; `dev-operations.md:240,244`. |
| AC7 token inventories = constant | MET | SKILL.md + `pipeline-detect.test.ts:139-158`. |
| AC8 retention mechanism | MET | ADR-110 `:2304`; satellite `:57-60` vs 0794 D3c. |
| AC9 Q&A write contract discoverable | MET | `task update --help` test; spur-cli refs. |
| AC10 replace/insert spacing | MET | domain tests + CLI Notes double-write. |

**Design conformance**

| Claim | Status | Notes |
| --- | --- | --- |
| D1a task `list()` normalize-before-`readDir` | DONE | `task-service.ts:1681-1682` outside the per-file `catch` (invalid filter cannot be swallowed as unparseable). |
| D1b feature filter in CLI | DONE | `feature.ts:274-275`; not moved into `FeatureService`. |
| D1c reuse `writeJsonError` | DONE | No bespoke validation branch. |
| D1d board columns | DONE | `task.ts:851-853`. |
| D1e batch docs | DONE | D1e wording landed. |
| D2 marker-wrapped inventories + parity test | DONE | Plus required `skill-structure.test.ts` ratchet (not in Design file list; keeps R5 CI-green). |
| D3 ADR-110 + satellite | DONE | Agrees with 0794 D3c; no 0794 code. |
| D4 Q&A docs; shared string not task-only | DONE | Exception in task `addHelpText`, not `SHARED_OPTIONS.section`. |
| D5 `replaceSection` spacing | DONE | Matches designed `trim()` spelling. |
| Anti-patterns | DONE | No comma-list parse, no new helper, stored status not normalized, `PIPELINE_TOKENS` membership unchanged, no Q&A behavior change, no corpus reflow. |

**SECUA**

- **S** — status compared after vocabulary check; error uses `JSON.stringify(raw)`; no secrets, no injection.
- **E** — invalid *task* status fails before `readDir`. Invalid *feature* status still lists then throws (D1b; cold path).
- **C** — type-fit: `normalizeTaskStatus`/`normalizeFeatureStatus` are the throwing alias-tolerant helpers (`schema.ts:180,205`). Filter compares canonical want vs raw stored status (non-goal: no stored-side normalize). Empty `replaceSection` does not fuse headings.
- **U** — loud `Unknown <noun> status: … (allowed: …)`; Q&A contract on `--help`. Residuals: P4 help-dump / lead-paragraph.
- **A** — no new export; validation at existing seams; spacing at the single writer (`MarkdownDocument`), not `stripLeadingSectionHeader`.

**Architecture depth**

No blocker/major candidates. F1 reuses the domain normalizers (deletion test: a new `parseStatusFilter` would have been the shallow extra module the Design forbade). Feature-vs-task filter locality is the pre-existing seam D1b kept. F5 locality is correct (writer, not caller). F2 test surface is a pure marker extract — no stack required.

**Out of scope (not scored):** working-tree `README.md` install-path/table-padding edits are unrelated to 0795 and were not in the implement file list.

**Residual risk.** (1) P4 derived-help drift until `docs/help/` regenerates. (2) F5 converges existing corpus only as sections are rewritten (Q7). (3) Feature invalid-status still pays a full `FeatureService.list()` before throw — accepted by D1b.

**Final disposition: APPROVE** — no P1/P2. Proceed. P4s are follow-up polish, not rework.

### References

**Evidence source**

- Dogfood report: `docs/dogfood/2026-09-07-sp-dev-refineall-j31-dogfood.md` (§6 Findings) —
  run `20260907-040240-refineall-j31`, protocol `sp:dogfood-testing@1.2`, verdict PASS, HEAD
  `8963ab161`.
- Live ledger: `.spur/run/dogfood/20260907-040240-refineall-j31.md`.

**F1 — status filter**

- `packages/app/src/services/task-service.ts:1699,1702` — task-side raw equality filter
- `apps/cli/src/commands/feature.ts:273` — feature-side raw equality filter
- `apps/cli/src/commands/task.ts:823,851-856,858-860` — flag registration, the all-columns fallback
  for an unrecognized value, and the existing catch → `writeJsonError` + `setExitCode(1)`
- `packages/domain/src/planning/schema.ts:20,23,180,204` — vocabularies and the throwing,
  alias-tolerant normalizers this task reuses on the filter path
- Write paths that already normalize (the precedent):
  `packages/app/src/services/planning-write-service.ts:621`,
  `packages/app/src/services/corpus-migrator.ts:123`, `apps/cli/src/commands/task.ts:91`
- Doc lines presenting `backlog,todo` as a `--status` argument:
  `plugins/sp/commands/dev-refineall.md:26,42`,
  `plugins/sp/skills/spur-dev/references/dev-operations.md:240,244`
- The correct resolution these docs should point at (unchanged by this task):
  `plugins/sp/skills/spur-dev/references/execution-batch.md:108` — per-status calls, unioned in-agent
- Consent rule behind the comma-list non-goal: `docs/design/harness-surface-governance.md`

**F2 — pipeline-token drift**

- `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:50-66` — `PIPELINE_TOKENS` (15)
- `plugins/sp/skills/dogfood-testing/SKILL.md:78-79,338-339` — documented inventories (11)
- `plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts:116-136` — constant pinned by value
- Parity-test precedent: `apps/cli/tests/shared-option-parity.test.ts`

**F3 — retention premise**

- `packages/app/src/services/system-event-retention.ts:34-43` — `resolveRetentionQuotas`
- `packages/app/src/services/system-event-tap.ts:66,132`,
  `packages/app/src/services/system-event-emitter.ts:56,80` — quota resolution and prune sites
- `packages/domain/src/dao/system-event-dao.ts:268` — `pruneQuotas`
- `docs/00_ADR.md:2301,2304` — ADR-110 (Status `Proposed`), Decision line
- `docs/design/observabilities-module-polish.md:57-58` — the R10 claim
- `docs/tasks4/0794_catalog-open-system-event-ingestion-with-generic-fallback-an.md` — Design D3c,
  the correction this task propagates to the authority docs; 0794 owns the code change

**F4 — Q&A write contract**

- `packages/app/src/services/planning-write-service.ts:587-597` — `appendQaEntry` and
  `<!-- qa:replace -->`, whose only three repo matches are its own implementation
- `apps/cli/src/commands/shared-options.ts:36` — the `--section` description printed by `--help`
- `apps/cli/src/commands/task.ts:415,418-430,432` — summary, help block, flag registration
- `plugins/sp/skills/spur-cli/references/tasks/verbs.md:65,88`,
  `plugins/sp/skills/spur-cli/references/tasks/section-editing.md:48` — references listing `Q&A`
  as replaceable
- Origin of the append behaviour: task 0701 R7a

**F5 — section spacing**

- `packages/domain/src/planning/markdown-document.ts:387` (`replaceSection`) vs `:448`
  (`insertSection`)
- `packages/app/src/services/task-service.ts:388-397` — `stripLeadingSectionHeader`
- Observable instance:
  `docs/tasks4/0793_align-observabilities-header-and-hoist-the-time-range-select.md` — rewritten
  sections `:15,49,130,173,201` vs untouched `:70,98,189,193,197`

**Prior art**

- `docs/tasks4/0713_verified-findings-from-the-2026-08-28-f95-dogfood-runall-swe.md` — self-contained
  dogfood findings register (F95)
- `docs/tasks4/0777_d61-batch-execution-findings-register-consolidated-fixes-for.md` — consolidated
  findings register with per-finding IDs carried across sections (D61)

**Governing docs**

- `docs/99_PROJECT_CONSTITUTION.md` — process authority; `00` wins content conflicts (F3)
- `docs/design/harness-surface-governance.md` — public-surface consent rule (Design non-goals)

### History

- 2026-09-07T06:09:45.002Z todo → wip (system)
- 2026-09-07T07:01:41.910Z wip → testing (system)
- 2026-09-07T16:22:58.845Z testing → done (system)
