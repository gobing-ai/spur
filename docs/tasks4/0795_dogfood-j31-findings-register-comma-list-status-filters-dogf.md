---
schema_version: 1
name: Dogfood J31 findings register — comma-list status filters, dogfood token-table drift, ADR-110 retention premise, and section-write semantics
status: todo
template: issue
created_at: 2026-09-07T05:07:02.241Z
updated_at: "2026-09-07T05:13:55.448Z"

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
| F1 | `--status` takes one value and silently returns 0 rows for anything else — including the `backlog,todo` default the batch docs specify | P2 | `apps/cli` + `packages/app` + `packages/domain` |
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
### Requirements
- [ ] R1. **(F1)** `spur task list --status <s>` accepts a comma-separated list and matches any
      listed status (OR): `--status backlog,todo` returns the union. A single value keeps its
      current behaviour byte-for-byte, and the legacy `--phase <p>` alias parses identically (no new
      precedence rule when both are passed).
- [ ] R2. **(F1)** `spur feature list --status <s>` accepts the same comma-list syntax, validated
      against `FEATURE_STATUSES`. Each noun validates against its own vocabulary — `active` is valid
      for features and invalid for tasks.
- [ ] R3. **(F1)** A status value outside the noun's vocabulary is a loud failure, not an empty
      result: exit code `1` and a message naming the offending value and the allowed set; under
      `--json` the failure travels the existing `writeJsonError` path so automation sees an error
      object, not `[]`. Whitespace around commas is tolerated (`backlog, todo`); an empty element
      (`todo,`) is rejected.
- [ ] R4. **(F1)** The human (non-`--json`) task board renders one column per requested status in
      canonical `TASK_STATUSES` order, regardless of the order the operator typed them.
- [ ] R5. **(F1)** `plugins/sp/skills/spur-dev/references/execution-batch.md:108` no longer tells
      the batch driver to issue two `spur task list` calls and union them in-agent; the `ready`
      selector resolves membership with one `--status todo,backlog` invocation.
- [ ] R6. **(F2)** The pipeline-token tables in `plugins/sp/skills/dogfood-testing/SKILL.md` list
      every entry of `PIPELINE_TOKENS` — all 15, including `dev-refineall`, `dev-verifyall`,
      `refineall`, `verifyall` — so an operator can predict from the docs alone which testees trip
      the `--max-retry` refuse gate.
- [ ] R7. **(F2)** A contract test fails when the SKILL.md token list and the `PIPELINE_TOKENS`
      constant diverge in either direction. Doc drift is caught by CI, not by the next dogfood.
- [ ] R8. **(F3)** `docs/00_ADR.md:2304` (ADR-110 Decision) and
      `docs/design/observabilities-module-polish.md:57-58` state the retention mechanism that is
      actually true — the quota list is extended with the uncataloged prefix at the persist site —
      and no longer claim uncataloged prefixes "resolve through the existing per-prefix quota
      fallback". Both restatements agree in mechanism with task 0794 Design D3c.
- [ ] R9. **(F4)** `spur task update --help` and the `sp:spur-cli` task references
      (`references/tasks/verbs.md`, `references/tasks/section-editing.md`) state that `Q&A` appends
      a timestamped entry rather than replacing, and name the `<!-- qa:replace -->` first-line
      marker that forces a wholesale replace. The generic `--section <name>` description no longer
      reads as an unconditional "replace".
- [ ] R10. **(F5)** `MarkdownDocument.replaceSection` produces the same spacing as `insertSection`:
      exactly one blank line between the `###` heading and the first body line, and a body trailer
      that leaves one blank line before the following heading. The normalisation is idempotent (no
      accumulating blank lines on re-write) and never rewrites content inside fenced code blocks.

**Non-goals.**

- No new `spur` noun or verb (public-surface consent rule). F1 changes the parsing of an existing
  flag only.
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
Scenario: AC1 (R1) comma-separated task status filter returns the union
  Given tasks exist in both "backlog" and "todo"
  When I run "spur task list --status backlog,todo --json"
  Then the output contains every backlog task and every todo task
  And the exit code is 0

Scenario: AC2 (R1) a single status value is unchanged
  Given tasks exist in several statuses
  When I run "spur task list --status todo --json"
  Then the output is byte-identical to the pre-change behaviour for that command
  And the legacy alias "spur task list --phase backlog,todo --json" returns the same union as AC1

Scenario: AC3 (R2) feature status filters accept the same syntax against their own vocabulary
  When I run "spur feature list --status backlog,active --json"
  Then the output contains every backlog feature and every active feature
  And "spur feature list --status todo --json" exits 1 because "todo" is not a feature status
  And "spur task list --status active --json" exits 1 because "active" is not a task status

Scenario: AC4 (R3) an unknown status fails loudly instead of returning empty
  When I run "spur task list --status bogus"
  Then the exit code is 1
  And stderr names "bogus" and lists the allowed task statuses
  And "spur task list --status bogus --json" emits a writeJsonError payload, not "[]"

Scenario: AC5 (R3) whitespace is tolerated and empty elements are rejected
  When I run "spur task list --status 'backlog, todo' --json"
  Then the result equals the AC1 union and the exit code is 0
  When I run "spur task list --status 'todo,' --json"
  Then the exit code is 1 and the message names the empty element

Scenario: AC6 (R4) the human board shows the requested columns in canonical order
  When I run "spur task list --status done,backlog"
  Then the board renders exactly the "backlog" and "done" columns
  And "backlog" appears before "done" regardless of the order typed

Scenario: AC7 (R5) the batch driver resolves membership in one call
  When I read plugins/sp/skills/spur-dev/references/execution-batch.md at the "ready" selector
  Then it specifies a single "spur task list --status todo,backlog --json" invocation
  And it no longer instructs the driver to union two separate list calls in-agent

Scenario: AC8 (R6, R7) documented pipeline tokens match the constant
  When the dogfood SKILL.md token inventories are compared with PIPELINE_TOKENS
  Then both inventories list all 15 tokens including dev-refineall and dev-verifyall
  And the parity test fails if a token is added to either side alone

Scenario: AC9 (R8) the authority docs state the retention mechanism that exists
  When I read docs/00_ADR.md ADR-110 Decision and docs/design/observabilities-module-polish.md R10
  Then neither claims uncataloged prefixes resolve through the existing per-prefix quota fallback
  And both describe binding the prefix at the persist site, agreeing with task 0794 Design D3c

Scenario: AC10 (R9) the Q&A write contract is discoverable from the CLI
  When I run "spur task update --help"
  Then it states that --section "Q&A" appends a timestamped entry rather than replacing
  And it names the "<!-- qa:replace -->" first-line marker that forces a wholesale replace
  And the sp:spur-cli task references carry the same exception

Scenario: AC11 (R10) rewritten and inserted sections share one spelling
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

**Q3. For F1, fix the CLI or fix the docs?** — Fix the CLI. Comma-list status filtering is what four
independent surfaces already assume (`dev-refineall.md:26,42`,
`dev-operations.md:240,244`), and the batch driver already pays for its absence with a two-call
in-agent union (`execution-batch.md:108`). Changing the docs to single-value would make the batch
default less useful and leave the silent-empty-result trap in place, which is the actual P2.

**Q4. Where does `parseStatusFilter` live?** — `packages/domain/src/planning/schema.ts`, beside the
vocabularies it validates. Rejected: `apps/cli/src/commands/shared-options.ts` (declared a pure
`[flags, description]` registry in its own header and enforced by
`apps/cli/tests/shared-option-parity.test.ts`); a new `apps/cli` helper module (`packages/app`
filters tasks and may not import `apps/cli`); duplicating the parse per call site (two places to
forget R3's validation).

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
re-run against a rebuilt bundle (Plan step 5). The dogfood resolved membership through `--feature`
and filtered in-agent, so the batch never exercised the broken path; the acceptance evidence must
come from the CLI directly, not from a passing `refineall` run.
### Design
**Frozen names.** `parseStatusFilter(raw: string, allowed: readonly string[], label: string): string[]`
exported from `packages/domain/src/planning/schema.ts`. Doc-parity markers
`<!-- pipeline-tokens:start -->` / `<!-- pipeline-tokens:end -->`. Reused unchanged:
`TASK_STATUSES`, `FEATURE_STATUSES`, `TASK_CANONICAL_SECTIONS`, `PIPELINE_TOKENS`,
`writeJsonError`, `renderTaskBoard`, `MarkdownDocument.insertSection`, `appendQaEntry`,
`<!-- qa:replace -->`. **No** new flag, verb, config key, DTO, or migration.

**Files this task may touch.**

| File | Finding | Change |
| --- | --- | --- |
| `packages/domain/src/planning/schema.ts` | F1 | add `parseStatusFilter` |
| `packages/app/src/services/task-service.ts` | F1 | parse once in `list()`; set-membership at `:1699`,`:1702` |
| `apps/cli/src/commands/feature.ts` | F1 | set-membership at `:273` |
| `apps/cli/src/commands/task.ts` | F1, F4 | board columns `:851-856`; Q&A note in `addHelpText` `:418-430`, summary `:415` |
| `plugins/sp/skills/spur-dev/references/execution-batch.md` | F1 | `:108` single-call `ready` resolution |
| `plugins/sp/skills/dogfood-testing/SKILL.md` | F2 | `:78-79`, `:338-339` complete + marker-wrapped |
| `plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts` | F2 | doc↔constant parity test |
| `docs/00_ADR.md` | F3 | `:2304` Decision mechanism |
| `docs/design/observabilities-module-polish.md` | F3 | `:57-58` R10 mechanism |
| `plugins/sp/skills/spur-cli/references/tasks/verbs.md` | F4 | `:65`,`:88` Q&A exception |
| `plugins/sp/skills/spur-cli/references/tasks/section-editing.md` | F4 | `:48` Q&A exception |
| `packages/domain/src/planning/markdown-document.ts` | F5 | `replaceSection` `:387` spacing |

**D1 — one parser, in the domain, beside the vocabulary it validates (R1–R3).**

```ts
/** Parse a comma-separated `--status` filter into a validated, de-duplicated set. */
export function parseStatusFilter(raw: string, allowed: readonly string[], label: string): string[] {
    const parts = raw.split(',').map((p) => p.trim());
    for (const p of parts) {
        if (p === '' || !allowed.includes(p)) {
            throw new Error(`Unknown ${label} status: ${JSON.stringify(p)} (allowed: ${allowed.join(', ')})`);
        }
    }
    return [...new Set(parts)];
}
```

Message shape deliberately mirrors `schema.ts:184` / `:209` so operators meet one message family
whether the value failed on the parse path or the filter path.

*Why `packages/domain`.* `apps/cli/src/commands/shared-options.ts` is a pure `[flags, description]`
registry — its header says so and `apps/cli/tests/shared-option-parity.test.ts` enforces it, so a
function may not live there. Both consumers (`packages/app` for tasks, `apps/cli` for features)
already import the status vocabularies from `packages/domain`; it is the only workspace both may
depend on. `apps/cli/src/commands/task.ts:41` already imports `TASK_STATUSES` from there.

**D1a — task path.** Keep `TaskListFilters.status` and `.phase` as `string` — the CLI hands through
one raw string and the parse belongs at one seam. In `TaskService.list()`
(`task-service.ts:1680`), parse **before** the `readDir` so an invalid value fails without touching
the filesystem:

```ts
const wantStatus = filters?.status === undefined
    ? undefined
    : new Set(parseStatusFilter(filters.status, TASK_STATUSES, 'task'));
const wantPhase  = filters?.phase  === undefined
    ? undefined
    : new Set(parseStatusFilter(filters.phase,  TASK_STATUSES, 'task'));
```

`:1699` → `if (wantStatus !== undefined && !wantStatus.has(status)) continue;` and `:1702`
likewise for `wantPhase`. `--status` + `--phase` together keep today's semantics: both filters
apply (AND across flags, OR within each), which is what the current sequential `continue` pair
already does.

**D1b — feature path.** `feature.ts:273` becomes the same set test, built from
`parseStatusFilter(options.status, FEATURE_STATUSES, 'feature')`, placed inside the existing `try`
opened at `:270`.

**D1c — no new error plumbing (R3).** Both handlers already wrap their work in
`try { … } catch (err) { writeJsonError(context.output, options, String(err)); context.setExitCode(1); }`
(`task.ts:858-860`, `feature.ts:288-290`). A thrown `Error` therefore yields exit `1` plus the
correct JSON error envelope for free. Do not add a bespoke validation branch in the action handler.

**D1d — board columns (R4).** `task.ts:851-856` today maps a single `requested` value to one column
and falls back to all columns for a non-canonical value. Replace with:

```ts
const requested = options.status ?? options.phase;
const wanted = requested === undefined ? undefined : new Set(parseStatusFilter(requested, TASK_STATUSES, 'task'));
const columns = wanted === undefined ? TASK_STATUSES : TASK_STATUSES.filter((s) => wanted.has(s));
```

Canonical ordering falls out of filtering the canonical array — no sort is needed, and the operator's
typed order is intentionally ignored. The old non-canonical fallback disappears by construction:
an invalid value now throws in the service before rendering is reached.

**D2 — doc↔constant parity for the token tables (R6, R7).** Complete both SKILL.md inventories to
all 15 tokens and wrap each in `<!-- pipeline-tokens:start -->` / `<!-- pipeline-tokens:end -->`
(HTML comments, invisible when rendered). The new test in `pipeline-detect.test.ts` reads SKILL.md,
extracts every backticked span between each marker pair, and asserts the union equals
`new Set(PIPELINE_TOKENS)` — failing in both directions. Anchoring on markers rather than a regex
over the whole document keeps the test from breaking when unrelated prose gains a backtick.
Precedent: `apps/cli/tests/shared-option-parity.test.ts` is the same doc-vs-code parity shape.

**D3 — correct the retention mechanism in both authority docs (R8).** ADR-110 is `Proposed` and
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

**D4 — document the Q&A exception where it is true (R9).** `SHARED_OPTIONS.section` is consumed by
both `task update` (`task.ts:432`) and `feature update` (`feature.ts:92`), and features carry no
`Q&A` section (`FEATURE_CANONICAL_SECTIONS`, `markdown-document.ts:51-58`) — so the exception must
**not** go in the shared string. Two edits instead:

- `shared-options.ts:36` → `['--section <name>', 'Section name to write']`. Drops the false
  unconditional "replace" without asserting task-only behaviour on the feature surface. Updating the
  registry entry updates both call sites at once, which is what the parity test expects.
- `apps/cli/src/commands/task.ts` — add to the existing `addHelpText('after', …)` block
  (`:418-430`) two lines naming the exception and the escape hatch, e.g.
  `'Sections replace, with one exception: `--section "Q&A"` APPENDS a timestamped'` /
  `'`#### Q&A entry — <ISO>` block. Start the body with `<!-- qa:replace -->` to replace it wholesale.'`
  Also correct `.summary()` at `:415` from "replace a section" to "write a section".

Mirror the same two facts into `plugins/sp/skills/spur-cli/references/tasks/verbs.md:65,88` and
`.../section-editing.md:48`, which today list `Q&A` among replaceable sections with no exception.

**D5 — normalise spacing at the single writer (R10).** `markdown-document.ts:387` →

```ts
const trimmed = cleaned.trim();
section.modifiedText = trimmed.length > 0
    ? `${section.headingLine}\n\n${trimmed}\n\n`
    : `${section.headingLine}\n\n`;
```

This is byte-identical in shape to `insertSection:448`, so the two writers stop disagreeing.
Idempotency (R10) comes from `trim()`: a body that already carries surrounding blank lines collapses
to the same output. Fenced code blocks are safe — `trim()` only touches the ends of the whole body,
never interior lines. The empty-body branch preserves today's ability to blank a section without
fusing it into the next heading.

**Anti-patterns — do not implement.**

- Do **not** widen `TaskListFilters.status` to `string[]` or add a `statuses` field. The CLI hands
  through one raw string; a second shape means two parse seams and two places to forget validation.
- Do **not** add a `--statuses` flag, a new verb, or a `--status` value like `any`/`all`
  (public-surface consent rule).
- Do **not** make `parseStatusFilter` skip or warn on unknown values — silently dropping them
  reproduces F1 with extra steps. R3 is the whole point.
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
### Plan
Five independent slices. Each ends green on its own gate, so they can land as separate commits in
any order — only the steps inside slice 1 are ordered.

**Slice 1 — F1 status-filter vocabulary (R1–R5).** The only behaviour change; do it first.

- [ ] 1. Add `parseStatusFilter` to `packages/domain/src/planning/schema.ts` beside `TASK_STATUSES`
      / `FEATURE_STATUSES` with the D1 body, export it from the domain barrel alongside
      `TASK_STATUSES`, and unit-test it in `packages/domain/tests/planning/schema.test.ts`: single
      value, comma list, surrounding whitespace, duplicate elision, empty element, unknown-value
      message text. `cd packages/domain && bun test tests/planning/schema.test.ts`
- [ ] 2. **(R1)** Parse once at the top of `TaskService.list()` (`task-service.ts:1680`, before
      `readDir`) and convert `:1699` / `:1702` to set membership. Extend
      `packages/app/tests/services/task-service.test.ts` beside the existing filter cases (`:373`,
      `:410`): comma union, `--phase` comma union, unknown value throws.
      `cd packages/app && bun test tests/services/task-service.test.ts`
- [ ] 3. **(R2, R4)** Convert `feature.ts:273` to the same set test inside the existing `try`
      (`:270`), and replace the `requested`/`columns` block at `task.ts:851-856` with the D1d form.
- [ ] 4. **(R3, R4)** Add CLI-level coverage in `apps/cli/tests/commands/task.test.ts` and
      `apps/cli/tests/commands/feature.test.ts`: exit code 1 plus a JSON error payload on an unknown
      value (assert it is **not** `[]`), and the rendered board's column set and order.
- [ ] 5. **(R1–R5)** Rebuild (`cd apps/cli && bun link && bun run --filter @gobing-ai/spur
      build:bundle`) and re-run the original repro: `spur task list --status backlog,todo --json`
      returns the union, `spur task list --status bogus` exits 1, `spur feature list --status
      backlog,active --json` returns the union. Then rewrite the `ready` selector row at
      `execution-batch.md:108` to one `spur task list --status todo,backlog --json` call and delete
      the in-agent union instruction.

**Slice 2 — F2 dogfood token-table parity (R6, R7).**

- [ ] 6. Complete both inventories in `plugins/sp/skills/dogfood-testing/SKILL.md` (`:78-79`,
      `:338-339`) to all 15 tokens and wrap each in
      `<!-- pipeline-tokens:start -->` / `<!-- pipeline-tokens:end -->`.
- [ ] 7. Add the doc↔constant parity test to
      `plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts` (D2). Prove it fails by temporarily
      deleting one token from the doc, then restore.
      `bun test plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts`

**Slice 3 — F3 authority-doc retention premise (R8).** Docs only; no code.

- [ ] 8. Apply the D3 replacements to `docs/design/observabilities-module-polish.md:57-58` and to
      the ADR-110 Decision parenthetical at `docs/00_ADR.md:2304`. Leave ADR-110's Status
      (`Proposed`), Why, and Detail untouched.
- [ ] 9. Re-read task 0794 Design D3c and confirm both restatements agree with it in mechanism —
      the quota list is extended at the persist site, and `resolveRetentionQuotas`'s override
      typo-guard is unchanged.

**Slice 4 — F4 Q&A write contract (R9).** Help text and references only; no behaviour change.

- [ ] 10. `shared-options.ts:36` → `['--section <name>', 'Section name to write']`; add the two Q&A
      lines to the `addHelpText('after', …)` block at `task.ts:418-430`; correct `.summary()` at
      `:415`. Verify with `spur task update --help`.
- [ ] 11. Mirror the exception and the `<!-- qa:replace -->` marker into
      `plugins/sp/skills/spur-cli/references/tasks/verbs.md:65,88` and `.../section-editing.md:48`.
- [ ] 12. Re-run the surface-parity suites that read those files:
      `cd apps/cli && bun test tests/shared-option-parity.test.ts tests/spur-cli-parity.test.ts`,
      then `bun test plugins/sp/tests/cli-surface-parity.test.ts`.

**Slice 5 — F5 section spacing (R10).** Smallest diff, widest blast radius — land last.

- [ ] 13. Apply the D5 change at `markdown-document.ts:387`, then run
      `cd packages/domain && bun test tests/planning/markdown-document.test.ts` and
      `cd packages/app && bun test tests/services/planning-write-service.test.ts tests/services/task-service.test.ts`.
      Expect exact-string assertions to fail; repair each by updating the expected fixture, never by
      weakening the assertion.
- [ ] 14. Add a `markdown-document.test.ts` case covering R10 directly: the heading→body gap, the
      gap before the next heading, idempotence on re-write, a fenced code block preserved verbatim,
      and the last section in a file (`History`) not accumulating blank lines at EOF.
- [ ] 15. Round-trip a real file: run the same `spur task update <wbs> --section Notes --from-file`
      twice and diff — the second write must produce no change.

**Close-out.**

- [ ] 16. `bun run autofix && bun run spur-check && bun run test && bun run build` green, then
      `spur task check 0795` → `pass: true`, and record the evidence in Testing.
### Root Cause
Each cause below was reproduced or read directly against the tree at HEAD `8963ab161`.

**F1 — single-value equality, no vocabulary check, no error path.**
Three layers agree on "one status, silently":

- `packages/app/src/services/task-service.ts:1699` —
  `if (filters?.status !== undefined && filters.status !== status) continue;`
  Strict string equality. `"backlog,todo"` never equals `"backlog"`, so every task is skipped.
  Line `:1702` repeats it for the `phase` alias.
- `apps/cli/src/commands/feature.ts:273` — `features.filter((f) => f.status === options.status)`.
  Same defect, different layer: features filter in the CLI, tasks filter in the service.
- Nothing validates the value against `TASK_STATUSES` / `FEATURE_STATUSES`
  (`packages/domain/src/planning/schema.ts:20,23`). `schema.ts:184,209` already own the
  "Unknown task status: … (allowed: …)" message shape, but only on the *parse* path, never on the
  *filter* path.

Reproduced (2026-09-07, source-local CLI):

```
spur task list --status backlog,todo --json   → []      exit 0
spur task list --status bogus --json          → []      exit 0
spur task list --status todo --json           → 2 rows  exit 0
spur feature list --status backlog,todo --json→ []      exit 0
spur task list --status backlog,todo          → "(no tasks)"  exit 0
```

The empty result is indistinguishable from "the filter matched nothing", which is why the batch
driver's `aborted (empty set after filter)` report carries no explanation.

Blast radius is documented, not hypothetical: `plugins/sp/commands/dev-refineall.md:26,42` and
`plugins/sp/skills/spur-dev/references/dev-operations.md:240,244` all specify `backlog,todo` as the
`refineall` default filter — a string the CLI cannot express. The batch driver already works around
it: `plugins/sp/skills/spur-dev/references/execution-batch.md:108` instructs two separate
`spur task list` calls unioned in-agent. The workaround is the proof of the defect.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
**Evidence source**

- Dogfood report: `docs/dogfood/2026-09-07-sp-dev-refineall-j31-dogfood.md` (§6 Findings) —
  run `20260907-040240-refineall-j31`, protocol `sp:dogfood-testing@1.2`, verdict PASS, HEAD
  `8963ab161`.
- Live ledger: `.spur/run/dogfood/20260907-040240-refineall-j31.md`.

**F1 — status filter**

- `packages/app/src/services/task-service.ts:1699,1702` — task-side equality filter
- `apps/cli/src/commands/feature.ts:273` — feature-side equality filter
- `apps/cli/src/commands/task.ts:823,851-856,858-860` — flag registration, board columns, catch path
- `apps/cli/src/commands/shared-options.ts:38` — `statusFilter` declaration
- `packages/domain/src/planning/schema.ts:20,23,184,209` — vocabularies and the existing
  "Unknown … status" message shape
- Callers assuming comma lists: `plugins/sp/commands/dev-refineall.md:26,42`,
  `plugins/sp/skills/spur-dev/references/dev-operations.md:240,244`
- Existing workaround: `plugins/sp/skills/spur-dev/references/execution-batch.md:108`

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
