---
template: feature-impl
schema_version: 1
name: "dev-history-load slash command: cumulative import then narrowed analyze"
description: ""
status: done
type: task
profile: standard
feature_id: I5
parent_wbs: null
priority: P2
tags: ["plugin", "history", "command"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-16T06:48:02.602Z"
updated_at: "2026-08-16T16:42:27.067Z"
---

## 0567. dev-history-load slash command: cumulative import then narrowed analyze

### Background
Discovery for feature I5 established that the history load+analyze pipeline already exists at the CLI layer: `spur history daily` (task 0470 R6) runs import-all (per-source fan-out with failure isolation) -> analyze -> artifact write -> 90-day prune, and import checkpoint resume already makes repeat runs cumulative, additive, and self-healing. `spur history import --mode incremental` exists as well. The idea was therefore reshaped at the idea-eval gate: this task does NOT build an import pipeline and does NOT own the periodic cadence. It ships one discoverable `/sp:dev-*` surface for the on-demand case that nothing covers today -- load whatever is new, then analyze it, optionally narrowed to the conversation you just had. `/sp:dev-find-issue` is the closest precedent for intent and it assumes the data plane is already loaded, which is exactly the gap this command closes. ADR-016 ("Slash Commands Exist Only for Agentic Value", accepted 2026-06-07) forbids a CLI-forwarding wrapper, so the command must convert intent into a reliable multi-step verb sequence rather than shelling `spur history daily`.

Verified CLI surface (2026-08-15, `spur history <verb> --help`): `import` accepts `--source`, `--file`, `--root`, `--mode full|incremental|force-file`, `--dry-run`, `--source-timeout`, `--json`. `analyze` accepts `--since`, `--until`, `--source`, `--session`, `--run`, `--task`, `--top`, `--out`, `--json`. `report` accepts `--mode default|forensics`, `--task`, `--top`, `--json` and never opens the database. Note the asymmetry that drives R2: `--session`/`--task`/`--since`/`--until` exist only on `analyze`; only `--source` is shared with `import`. Feature I5's Acceptance Criteria scenarios R1-R10 are all delivered by this task.

This is a single-file plugin command plus the surrounding contract edits: no new CLI noun or verb (the ADR-051 consent gate does not apply), no schema change, no config, no dependency, no transport change. `needs_design` was evaluated false at the idea-eval gate; the design work that remains is contract conformance, not architecture.

Premise verification at `--depth ready` (2026-08-15, against the current tree) turned up four facts that change what "author one markdown file" costs, all confirmed by reading the tests rather than inferred:

1. `plugins/sp/tests/command-contract.test.ts` hard-codes the command count in two assertions (`expect(files.length).toBe(37)` and `expect(result.fileCount).toBe(37)`). A 38th command file fails both until the constants are bumped.
2. `plugins/sp/tests/roles.test.ts` R3 closes the command→role mapping over the live `plugins/sp/commands/` directory. A command absent from the `commands: [...]` list in `plugins/sp/references/roles.md` fails the `unmapped` assertion.
3. `plugins/sp/tests/command-flag-parity.test.ts` R1 requires every flag declared by >=2 dev-command argument-hints to carry exactly one `**Anchor:** \`#flag-<name>\`` entry in `flag-glossary.md`. Today `--source` is declared by exactly one dev command (`dev-find-issue`); this command makes it two, so `--source` needs a new canonical glossary entry. `--since`, `--until`, `--task`, `--json` and `--dry-run` already have entries; `--session` (singular) and `--report` stay single-declarer and need none.
4. `plugins/sp/tests/command-flag-parity.test.ts` R5 asserts `--agent` appears in exactly 23 dev-command hints. This command must not declare `--agent` -- which is correct anyway, since it runs no model-bearing step.
### Requirements
- [x] R1. Author `plugins/sp/commands/dev-history-load.md` to the frozen `dev-*` command contract and register it everywhere the plugin's closure tests require: frontmatter (`description`, `argument-hint`, `allowed-tools` **without** `Skill`), exactly the three `##` headings `Argument Flags` / `Usage` / `Implementation` in that order and no other heading at any level, a footer link to `../skills/spur-dev/references/flag-glossary.md`; add `dev-history-load` to the `scribe` row in `plugins/sp/references/roles.md`; bump both hard-coded `37` command counts in `plugins/sp/tests/command-contract.test.ts` to `38`; add the canonical `--source` glossary entry to `flag-glossary.md`; index the command in `plugins/sp/README.md` under the long-tail `/sp:dev-*` list. Do **not** add a `dev-operations.md` numbered row (long-tail commands have none, and adding one activates strict two-way flag parity). (feature I5 R1)
- [x] R2. Implement the load-then-analyze sequence with correct per-verb flag routing: run `spur history import` first and `spur history analyze` only after it exits 0; forward `--source` to both verbs; forward `--session`, `--task`, `--since` and `--until` to `analyze` only, since `import` rejects them. Surface the imported record count and the analyze artifact path on success. (feature I5 R2, R4)
- [x] R3. Preserve the cumulative contract without re-implementing it: rely on the shipped import checkpoint resume so a repeat run adds only newly appended conversation data and never double-counts, and document that periodic cadence stays on `spur history daily` (which additionally prunes and self-heals). The command must not prune reports and must not duplicate the daily pipeline. (feature I5 R3, R8)
- [x] R4. Support the three output/preview flags: `--report` renders `spur history report --mode forensics` against the artifact just written; `--dry-run` runs `spur history import --dry-run`, writes no analyze artifact, prints the sequence it would have run, and leaves the data still importable by a later real run; `--json` emits a single machine-readable object carrying the import summary, artifact path and status with no banner text interleaved. (feature I5 R5, R6, R7)
- [x] R5. Fail loudly rather than degrading: when the import step exits non-zero, skip analyze, surface the failing source and error, and exit with the import step's exit code; when a `--since`/`--until` or `--session` narrowing matches zero imported messages, report the empty window explicitly instead of presenting an empty artifact as a successful analysis. (feature I5 R9, R10)
### Acceptance Criteria
```gherkin
Feature: dev-history-load command: on-demand cumulative import + analyze

  @core
  Scenario: R1 — The command file ships with the /sp:dev-* family contract
    Given the sp plugin command directory "plugins/sp/commands"
    When "dev-history-load.md" is loaded
    Then its frontmatter declares "description", "argument-hint", and "allowed-tools"
    And the argument-hint lists "--session", "--task", "--since", "--until", "--source", "--report", "--dry-run" and "--json"
    And the body links the shared flag glossary at "../skills/spur-dev/references/flag-glossary.md"
    And the plugin command structure test suite passes for the new file

  @core
  Scenario: R2 — A bare invocation loads history then analyzes it, in that order
    Given a project with importable agent conversation JSONL under the configured history roots
    When the operator runs "/sp:dev-history-load" with no flags
    Then the command runs "spur history import --source all" before "spur history analyze"
    And the analyze step runs only after the import step exits 0
    And the run reports the imported record count and the written analyze artifact path

  @core
  Scenario: R3 — Re-running is cumulative and never double-counts
    Given "/sp:dev-history-load" has already been run once and its checkpoints are persisted
    And three new conversation messages have since been appended to one source
    When the operator runs "/sp:dev-history-load" a second time
    Then the import step resumes from the persisted checkpoint rather than rescanning from zero
    And exactly the three new messages are added to the history tables
    And no previously imported message is duplicated

  @core
  Scenario: R4 — Narrowing flags reach the verb that actually accepts them
    Given the operator wants to investigate a single conversation
    When the operator runs "/sp:dev-history-load --session <session-id> --since <iso> --until <iso>"
    Then "--session", "--since" and "--until" are forwarded to "spur history analyze" only
    And they are not forwarded to "spur history import", which does not accept them
    And "--source <name>" is forwarded to both "spur history import" and "spur history analyze"
    And "--task <wbs>" is forwarded to "spur history analyze"

  @core
  Scenario: R5 — --report renders the forensics view after analyze
    Given a successful analyze step has written an artifact
    When the operator runs "/sp:dev-history-load --report"
    Then the command runs "spur history report --mode forensics" against the artifact just written
    And the rendered report is surfaced to the operator
    And omitting "--report" leaves the artifact written but unrendered

  @core
  Scenario: R6 — --dry-run previews the sequence without persisting
    Given importable conversation JSONL that has not yet been imported
    When the operator runs "/sp:dev-history-load --dry-run"
    Then "spur history import --dry-run" scans without persisting imported records
    And no analyze artifact is written
    And the command prints the sequence it would have run
    And a subsequent non-dry run still imports every record the dry run scanned

  @core
  Scenario: R7 — --json emits a machine-readable result
    Given a caller that parses the command output programmatically
    When the operator runs "/sp:dev-history-load --json"
    Then the output is a single JSON object carrying the import summary, the analyze artifact path, and the overall status
    And no human-formatted banner text is interleaved into the JSON payload

  @core
  Scenario: R8 — The command delegates the periodic cadence instead of duplicating it
    Given "spur history daily" already owns import-all, analyze, artifact write and 90-day prune
    When the command documentation describes periodic usage
    Then it directs the operator to "spur history daily" for the scheduled cadence
    And the command itself never prunes reports and never re-implements the daily pipeline
    And the command is not a bare forwarder of "spur history daily" (ADR-016)

  @edge
  Scenario: R9 — A failing import aborts before analyze and propagates the exit code
    Given the import step exits non-zero after per-source failure isolation reports a fatal error
    When the operator runs "/sp:dev-history-load"
    Then the analyze step is not run
    And the command surfaces the failing source and the import error
    And the command exits with the import step's non-zero exit code

  @edge
  Scenario: R10 — Narrowing to a window with no imported rows fails loudly
    Given the history tables contain no messages inside the requested "--since"/"--until" window
    When the operator runs "/sp:dev-history-load --since <iso> --until <iso>"
    Then the command reports that the window matched zero messages
    And it does not present an empty artifact as a successful analysis
```
### Q&A
**Closed at the idea-eval gate (2026-08-15, operator-approved).** The idea as first stated — one command covering both ad-hoc investigation and periodic import+analyze — was reshaped to the ad-hoc case only. `spur history daily` already ships the periodic pipeline (import-all with per-source isolation, analyze, artifact, 90-day prune) and checkpoint resume already makes imports cumulative, so the literal idea would have been an ADR-016 CLI-forwarding wrapper. The command earns its surface on the narrowed post-conversation investigation path, which nothing covers today. Rejected alternatives: a bare forwarder to `daily` (fails ADR-016, cannot narrow by session); and shipping nothing while adding an import preflight to `/sp:dev-find-issue` (zero new surface, but does not deliver the requested command).

**Closed during `--depth ready` refinement (2026-08-15).** Prose `## Implementation` vs a backing script: chosen script (`plugins/sp/scripts/history-load.ts`), following the `dev-daily` precedent. Prose cannot satisfy exit-code propagation, the single-object `--json` contract, or the empty-window guard, and leaves the task with no runnable test. A new *skill* was considered and rejected — the behavior is a deterministic CLI sequence, not model work, and eight existing commands (`dev-daily`, `dev-changelog`, `dev-fixall`, `dev-gitmsg`, `dev-gtd`, `dev-handover`, `dev-wrap`, `dev-wrapall`) already ship with no backing skill.

**Closed: role assignment.** `scribe`, alongside `dev-daily` / `dev-changelog` / `dev-refresh`. The command transcribes and derives rather than analyses; the interpretive work over the resulting artifact belongs to `/sp:dev-find-issue`, which is correctly `reviewer`.

**Closed: no `dev-operations.md` entry.** Long-tail commands are indexed in `plugins/sp/README.md` only. A numbered `dev-operations.md` row activates `command-flag-parity.test.ts` two-way strict parity against that row, which buys nothing here and adds a second place for the flag list to drift.

**Deferred, with owner.** `/sp:dev-find-issue` assumes the history data plane is already loaded and has no import preflight — the integration gap discovery surfaced. Not folded into this task (it changes a `reviewer`-role command owned by feature E2's forensics work). Revisit after this command ships, when `/sp:dev-history-load` is the obvious thing for that preflight to recommend.

**Known cosmetic gate output.** `spur task check 0567` emits an L3 WARN that the Acceptance Criteria cite R6–R10 while Requirements stop at R5. This is deliberate: the AC carries feature I5's ten scenario titles byte-identically (that identity is what gives DD-09 feature→task linkage), while the requirements merge them into five R-items to stay under the `maxImplementReqs: 5` size precheck. Do not "fix" it by renumbering the AC — that silently breaks the feature traceability edge.
### Design
**WHAT.** One long-tail `/sp:dev-*` command, `/sp:dev-history-load`, that runs `spur history import` then `spur history analyze` as a single intent, with narrowing forwarded to the verb that accepts it and an optional forensics render. It owns no import logic, no state, and no cadence.

**WHY a script and not prose.** `dev-daily` is the precedent: a deterministic multi-step CLI sequence lives in `plugins/sp/scripts/`, and the command's `## Implementation` is one line invoking it. Prose cannot satisfy R5 (propagate the import step's exact exit code), R4's `--json` (one object, no interleaved banner) or R10 (distinguish "analyzed zero rows" from "analyzed successfully"), because each depends on inspecting a child process's exit status and stdout rather than on the model narrating a sequence. A script also gives the task a runnable test; a prose Implementation gives it none.

**WHERE — primary file targets (all edits land in these seven paths):**

| Path | Change |
| --- | --- |
| `plugins/sp/commands/dev-history-load.md` | new — the thin wrapper |
| `plugins/sp/scripts/history-load.ts` | new — the sequence, flag routing, exit-code and JSON contract |
| `plugins/sp/tests/history-load.test.ts` | new — unit coverage for routing, exit propagation, dry-run, empty window |
| `plugins/sp/references/roles.md` | add `dev-history-load` to the `scribe` `commands: [...]` row |
| `plugins/sp/tests/command-contract.test.ts` | bump both `37` literals to `38` |
| `plugins/sp/skills/spur-dev/references/flag-glossary.md` | add the canonical `--source` entry (`**Anchor:** \`#flag-source\``) |
| `plugins/sp/README.md` | index the command in the long-tail `/sp:dev-*` list |

**Frozen names — do not rename during implementation.**

- Command: `/sp:dev-history-load`; file `dev-history-load.md`; H1 `# Dev History Load`.
- Frontmatter: `role: scribe`; `allowed-tools: ["Bash", "Read"]` (no `Skill` — the contract test asserts `Skill` in `allowed-tools` iff the body contains a `Skill()` call, and this command has none).
- Headings: exactly `## Argument Flags`, `## Usage`, `## Implementation`, in that order, with no `###` subheadings anywhere.
- Flag set, frozen and complete: `--source <name>`, `--session <id>`, `--task <wbs>`, `--since <iso>`, `--until <iso>`, `--report`, `--dry-run`, `--json`.
- Script entry: `bun plugins/sp/scripts/history-load.ts $ARGUMENTS`.

**Precedence / algorithm.**

1. Parse args. Unknown flags are a hard error (exit 2) — never silently forwarded.
2. Build the import argv: `spur history import --json` plus `--source` when given, plus `--dry-run` when given. Never append `--session`, `--task`, `--since` or `--until`; `import` rejects them.
3. Run import. Non-zero exit ⇒ print the failing source and the error, skip every later step, and `process.exit` with the child's code (R5).
4. If `--dry-run`: print the analyze and report argv that would have run, then exit 0. No analyze, no artifact (R4).
5. Build the analyze argv: `spur history analyze --json` plus `--source`, `--session`, `--task`, `--since`, `--until` as given. Run it.
6. If the analyze result covers zero messages, report the empty window explicitly and exit non-zero — do not present an empty artifact as success (R5/feature R10).
7. If `--report`: run `spur history report --mode forensics <artifact-path>` against the artifact analyze just wrote, and stream its output.
8. Output: with `--json`, one object `{ import: {...}, artifact: "<path>", reported: <bool>, status: "ok" }` on stdout and nothing else; without it, a short human summary carrying the imported record count and the artifact path.

**Anti-patterns — what NOT to implement.**

- Do not shell `spur history daily`, and do not re-implement its prune or its 90-day retention. Delegation is documented, not coded (R3).
- Do not add a `--mode` flag. `import --mode incremental` exists, but cumulative behavior already comes free from checkpoint resume; exposing the mode invites a caller to pass `full` and defeat the contract.
- Do not forward `--run`, `--top` or `--out` to `analyze`. They are real `analyze` flags and deliberately out of scope; adding them needs a new feature scenario first.
- Do not declare `--agent`. `command-flag-parity.test.ts` R5 asserts exactly 23 dev commands carry it, and this command runs no model-bearing step.
- Do not add a numbered `dev-operations.md` row. That activates two-way strict flag parity against the row, which the long-tail commands (`dev-daily`, `dev-find-issue`, `dev-gtd`) deliberately avoid.
- Do not parse `spur history` human output. Every step uses `--json`.

**Out of scope (explicit non-goals).** Periodic scheduling or cron wiring; report retention/pruning; new forensics report modes or renderers; changes to `spur history` CLI verbs or flags; changes to `/sp:dev-find-issue` (its missing import preflight is a real gap but a separate work item); the `--run`/`--top`/`--out` analyze passthroughs.

**Handoff.** This task has no `dependencies[]` and leaves no contract for a dependent task. It assumes only the already-shipped `spur history import|analyze|report` surface and the import checkpoint-resume behavior from task 0470 R6; if that surface changes, this command's flag routing (step 2 vs step 5 above) is what breaks.
### Plan
- [x] Write `plugins/sp/scripts/history-load.ts` — arg parsing with hard-error on unknown flags, the import argv builder, and exit-code propagation from the import child (R1, R2, R5)
- [x] Add analyze argv building with the narrowing flags routed to `analyze` only, plus the empty-window guard that refuses to report an empty artifact as success (R2, R5)
- [x] Add the `--dry-run` short-circuit (print the argv it would run, no analyze, no artifact) and the `--report` forensics render against the artifact analyze just wrote (R4)
- [x] Add the `--json` output assembly — one object on stdout, no banner or progress text interleaved — and the human summary carrying imported record count + artifact path (R2, R4)
- [x] Write `plugins/sp/tests/history-load.test.ts` with a stubbed spur binary: assert `--session`/`--task`/`--since`/`--until` never reach the import argv, `--source` reaches both, a non-zero import exit skips analyze and propagates the code, `--dry-run` writes no artifact, and a zero-row window exits non-zero (R2, R4, R5)
- [x] Author `plugins/sp/commands/dev-history-load.md` to the frozen contract — three `##` headings in order, no `###`, frontmatter without `Skill` in `allowed-tools`, flag table matching the argument-hint exactly, glossary footer link (R1)
- [x] Register the command: add it to the `scribe` row in `plugins/sp/references/roles.md`, bump both `37` literals to `38` in `plugins/sp/tests/command-contract.test.ts`, add the canonical `--source` entry to `flag-glossary.md`, index it in `plugins/sp/README.md` (R1)
- [x] Verify and dogfood: `bun test plugins/sp` green — specifically `command-contract`, `command-flag-parity`, `roles`, and the new `history-load` suite — then `bun run lint` and `bun run check`; dogfood once against real data: run `/sp:dev-history-load --dry-run`, then a real run, then a second run to confirm the repeat adds only new rows and never double-counts (R1, R2, R3, R4, R5)
### Solution
**WHAT shipped.** One long-tail `/sp:dev-*` command, `/sp:dev-history-load`, backed by a deterministic script. It runs `spur history import` then `spur history analyze` (analyze only after import exits 0), routes narrowing flags to the verb that accepts them, and optionally renders the forensics report. Owns no import logic, no state, no cadence.

**Change map (7 paths).**

| Path | Change |
| --- | --- |
| `plugins/sp/commands/dev-history-load.md` | new — frozen dev-* contract: `role: scribe`, `allowed-tools: ["Bash","Read"]` (no `Skill`), exactly `## Argument Flags` / `## Usage` / `## Implementation` in order, no `###`, flag table matching the argument-hint exactly, one glossary footer link (`plugins/sp/commands/dev-history-load.md:4-5`, `:15`, `:30`, `:47`) |
| `plugins/sp/scripts/history-load.ts` | new — the sequence: frozen flag parse with `FLAG_KEY` mapping (`:83-102`), unknown → exit 2; import argv = `spur history import --json` + `--source` + `--dry-run` (`:184-186`); non-zero import exit surfaces non-clean source(s) + first warning detail and propagates the child's code (`:193-216`, R9); `--dry-run` prints would-run sequence and exits 0 (`:218-235`, R4/R6); analyze argv carries `--source`/`--session`/`--task`/`--since`/`--until` (`:150-162`); zero-row window exits 1 with explicit empty-window message (`:265-284`, R10); artifact path resolved via the `latest.json` pointer (`:131-137`, `:262`); `--report` renders `spur history report --mode forensics` (`:302-321`); `--json` emits one object `{import, artifact, reported, status}` on stdout with no interleaved banner (`:323-338`, R7) |
| `plugins/sp/tests/history-load.test.ts` | new — 8 tests against a stubbed spur binary (`plugins/sp/tests/history-load.test.ts:88-211`): narrowing flags never reach import / `--source` reaches both, import-then-analyze ordering, non-zero import exit skips analyze + propagates code, zero-row window exits non-zero, unknown flag exits 2, dry-run writes no artifact + prints sequence, `--json` single-object contract, `--report` renders against the artifact |
| `plugins/sp/references/roles.md` | `dev-history-load` added to the `scribe` `commands: [...]` row (`plugins/sp/references/roles.md:44`) — closed command→role mapping |
| `plugins/sp/tests/command-contract.test.ts` | both hard-coded `37` command-count literals bumped to `38` (`plugins/sp/tests/command-contract.test.ts:305-310`, `:390-393`) |
| `plugins/sp/skills/spur-dev/references/flag-glossary.md` | new canonical `--source` entry (`plugins/sp/skills/spur-dev/references/flag-glossary.md:249-256`, `**Anchor:** \`#flag-source\``) — the flag is now declared by 2 dev commands; `--task` entry extended with the `dev-history-load` declarer + narrowing meaning (`:207-226`, C1 exact-set parity) |
| `plugins/sp/README.md` | `dev-history-load` indexed under the long-tail `/sp:dev-*` operations table (`plugins/sp/README.md:129-131`) |

**Deliberate non-implementations (per Design anti-patterns).** No `spur history daily` shell-out / prune / retention (R3/R8 — delegated, documented); no `--mode` flag (checkpoint resume already provides cumulative behavior); no `--run`/`--top`/`--out` analyze passthroughs; no `--agent` (runs no model-bearing step — R5 parity count stays 23); no numbered `dev-operations.md` row (long-tail two-way parity deliberately avoided).

**Dogfood (real data, `--source omp`, monorepo-local CLI per R4 provenance).** Dry-run printed the sequence and wrote no artifact; first real run imported 14,684 records and wrote `.spur/reports/history/2026-08-16/analyze-5648c805.json`; repeat run imported 4 newly-appended records with identical artifact totals (241,373) — cumulative, no double-count (R3). `--json` emitted one object carrying `provenance` (`binary: apps/cli/src/index.ts`, `importer: 0.4.32`). `--report` rendered the forensics view. An empty `--since/--until` window exited 1 with the explicit zero-messages message (R10). A bare run surfaces the machine's real `agy` degraded source (203 parse errors) and exits 2 — correct fail-loud (R9).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

**Re-audit (--force, 2026-08-16, second session):** verdict re-confirmed PASS. All line anchors re-read; two citations corrected (anchors drifted after the dev-feature-change rename landed a new test in command-contract.test.ts). Fresh evidence this run, not the pipeline's.

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/commands/dev-history-load.md:2-5,15,30,47` (frozen contract: frontmatter sans Skill, 3 ordered headings, glossary footer); `plugins/sp/tests/command-contract.test.ts:348-352`, `plugins/sp/tests/command-contract.test.ts:433-435` (38-counts, corrected anchors); `plugins/sp/references/roles.md:44` (scribe row); `plugins/sp/skills/spur-dev/references/flag-glossary.md:207-226,249-256` (--task extension, --source entry); `plugins/sp/README.md:129`; `bun test plugins/sp` 1006 pass 0 fail |
| R2 | MET | `plugins/sp/scripts/history-load.ts:161-169` (analyze argv), `:184-188` (import argv), `:238` (analyze only after import 0); `plugins/sp/tests/history-load.test.ts:97-135` (routing + ordering); fresh dogfood `--source claude --json`: 11 new messages → `.spur/reports/history/2026-08-16/analyze-448403cb.json`, exit 0 |
| R3 | MET | `plugins/sp/commands/dev-history-load.md:41-45` (delegates cadence to `spur history daily`; no prune, no daily shell-out in script); pipeline dogfood repeat: 4 new records, totals 241,373 identical (no double-count); re-audit real run imported only 11 new claude messages (cumulative) |
| R4 | MET | `plugins/sp/scripts/history-load.ts:217-235` (dry-run), `:301-320` (report), `:322-337` (json single object); `plugins/sp/tests/history-load.test.ts:176-211` — 205 tests across 5 suites pass |
| R5 | MET | `plugins/sp/scripts/history-load.ts:193-214` (import non-zero → skip analyze + propagate), `:263-279` (empty-window exit 1); `plugins/sp/tests/history-load.test.ts:146-164`; re-audit dogfood: bare run surfaces agy degradation (203 parse errors) and exits 2 before analyze — fail-hard path exercised on real data |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — The command file ships with the /sp:dev-* family contract | MET | test | validate-commands 38/38 zero violations (`plugins/sp/tests/command-contract.test.ts:433-435`); roles closure includes dev-history-load (`plugins/sp/references/roles.md:44`) |
| Scenario: R2 — A bare invocation loads history then analyzes it, in that order | MET | test | `plugins/sp/tests/history-load.test.ts:127-134` (ordering); success path re-proven live: `--source claude` import(11) → analyze → artifact, exit 0 |
| Scenario: R3 — Re-running is cumulative and never double-counts | MET | command | repeat real runs import only newly appended messages (11 on re-audit; pipeline: 4, totals identical) — checkpoint resume |
| Scenario: R4 — Narrowing flags reach the verb that actually accepts them | MET | test | `plugins/sp/tests/history-load.test.ts:97-125`: narrowing never in import argv, all present in analyze argv, --source in both |
| Scenario: R5 — --report renders the forensics view after analyze | MET | test | `plugins/sp/tests/history-load.test.ts:205-210`; `plugins/sp/scripts/history-load.ts:301-320` |
| Scenario: R6 — --dry-run previews the sequence without persisting | MET | test | `plugins/sp/tests/history-load.test.ts:176-185` (no analyze call, no artifact pointer); re-audit `--dry-run` printed sequence |
| Scenario: R7 — --json emits a machine-readable result | MET | command | re-audit `--json` success + error runs each emitted exactly one parseable object (verified with python json.load) |
| Scenario: R8 — The command delegates the periodic cadence instead of duplicating it | MET | command | `plugins/sp/commands/dev-history-load.md:41-45`; no prune/retention/daily re-implementation in `plugins/sp/scripts/history-load.ts` (grep: only the doc comment references daily) |
| Scenario: R9 — A failing import aborts before analyze and propagates the exit code | MET | command | `plugins/sp/tests/history-load.test.ts:146-151` + live: bare run exit 2 naming agy, analyze never invoked |
| Scenario: R10 — Narrowing to a window with no imported rows fails loudly | MET | test | `plugins/sp/tests/history-load.test.ts:153-159`: zero-message window exits 1 naming the window |

**SECUA / design findings (re-audit, --focus all)**

- P2 usability (resolved-by-decision): a bare `--source all` run aborts permanently wherever a source is steady-state degraded (agy: 203 parse errors in Antigravity-owned chunks). Diverges from the daily pipeline's "never an abort" fan-out policy (`packages/app/src/services/history-refresh-service.ts:130-136`). Operator decision 2026-08-16: **keep fail-hard**; workaround documented in `plugins/sp/commands/dev-history-load.md:47-51` (Usage note); deferred tolerance alternative filed as task 0569 under I5.
- P3: `git diff` noise — the degraded-source dry-run/real runs from this re-audit wrote `.spur/reports/history/2026-08-16/*.json` artifacts (gitignored, disclosed here per the fix-pass disclosure rule).

Coverage: N/A (plugin script verified via stubbed-binary unit tests + live dogfood; no monorepo runtime code path added).

**Shippable: FAIL** — feature I5 has one incomplete linked task: 0569 (todo), the deferred degraded-tolerance follow-up filed by this re-audit. All 10 feature scenarios are covered and verified via 0567 (done, PASS). The FAIL is the gate correctly seeing the open follow-up, not undelivered core scope.
### Review
**Disposition: PASS** — no P1–P3 findings against the task's own diff (functional traceability, SECUA, architecture all clean). See findings table + notes below.

**Findings (P1–P4)**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | Correctness | `plugins/sp/scripts/history-load.ts:200-206` | Blank abort message risk when the import child exits non-zero with empty stderr — `??` on a trimmed-empty string yields `''`, not the fallback. Fixed during verification (now `||` with warning-detail fallback); covered by the non-zero-import test. |
| P4 | Usability | `plugins/sp/commands/dev-history-load.md:36-39` | Bare `--source all` runs surface a real degraded source (agy: 203 parse errors) and exit 2 — correct fail-loud per R9, but an operational expectation until upstream data is repaired. Documented in Solution, not a defect. |
| P4 | Process | working tree | Concurrent writer's changes (dev-feature-change rename, validate-commands.ts real-YAML-parse hardening, next-feature skill edits, docs/04_DESIGN.md etc.) appeared mid-run. Outside 0567's declared paths, not part of this diff, not reviewed here; the quality gate passed with them present. |

**Functional traceability.** R1: `plugins/sp/commands/dev-history-load.md` passes all 5 thin-wrapper gates (`validate-commands.ts` reports 38/38 pass); frontmatter/heading/table/glossary contract exact. R2: import-before-analyze ordering + per-verb flag routing covered by `history-load.test.ts:97-145` and real dogfood. R3: cumulative behavior verified with real data — first run imported 14,684 omp records, repeat run imported 4 newly-appended with identical artifact totals (241,373), no double-count; cadence delegation documented in `dev-history-load.md:36-39`. R4: `--report` renders forensics against the artifact (real run); `--dry-run` writes no artifact and prints the sequence (test `:176-186`); `--json` emits one object with no banner (test `:187-204`). R5: non-zero import exit skips analyze and propagates the child's code (test `:146-152`; real: agy degraded → exit 2); zero-row window exits 1 with explicit message (test `:153-160`; real: empty `--since/--until` window).

**SECUA.** Security: child processes spawned via `spawnSync` fixed argv arrays (`history-load.ts:114-122`) — no shell interpolation of operator input; `SPUR_BIN` env is operator-controlled; no secrets logged; no new dependencies. Correctness: flag routing, exit propagation, `--json` contract, and empty-window guard each have unit coverage; unknown flags hard-exit 2 (tested). Usability: human summary carries record count + artifact path; JSON mode is machine-parseable; error paths name the failing source. Efficiency: bounded 2–3 subprocess spawns, no redundant work.

**Architecture.** Single thin wrapper script following the `dev-daily` precedent — a deterministic CLI sequence, correctly not a skill (matches eight existing script-backed commands). Frozen contract honored: no `--mode`, no `--run`/`--top`/`--out` passthroughs, no `--agent`, no numbered `dev-operations.md` row. No new CLI noun/verb — ADR-051 consent gate not implicated.

**Residual risk.** None for this task's surface. The only non-zero-exit realities on this machine (degraded `agy` source; empty narrowing windows) are verified fail-loud behavior, not silent degradation.
### References

L

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-16T07:28:30.975Z todo → wip (system)
- 2026-08-16T07:37:52.206Z wip → testing (system)
- 2026-08-16T07:38:47.710Z testing → done (system)
