# Planning records and lifecycle contracts

Detailed non-UI contracts, indexed by [04 Design](../04_DESIGN.md).
Original section numbers remain stable; unqualified section references resolve through the 04 index.

## 7. Planning Layer Surface (reserved — ADR-020; filled by Roadmap §1.5 Stage D)

Planning commands, records and lifecycle contracts. The historical section title is retained
for existing references. Delivery state lives in the [feature index](../features/INDEX.md).

<a id="71-spur-task-commands"></a>

### 7.1 `spur task` commands

| Extension | Status |
| --- | --- |
| [Task creation and readiness](task-creation-readiness.md) | Shipped — F21 / ADR-109; tasks 0787–0788 |

The command table below continues to describe the current registrations.

Core CRUD and utility verbs. Every subcommand supports `--json` (ADR-010 invariant).
Source: delivery §1.1, design §10.

| Command                                | Flags                                                                                                                                    | Exit    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spur task`                            | — (noun help)                                                                                                                            | 0       | Lists subcommands if no subcommand given.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `spur task create <title>`             | `--feature <id>` `--parent <wbs>` `--template <variant>` `--dedupe-within <seconds>` `--allow-duplicate-name` `--folder <path>` `--json` | 0/1/2/3 | Race-safe WBS allocation; every create rejects an identical case-insensitive title in the same collision scope (same `--feature`, or no feature for unscoped creates) created within 300 seconds by default (exit 3, `duplicate-follow-up`); `--dedupe-within` accepts a positive-integer override; `--allow-duplicate-name` disables the guard. `--feature` enables B09 Goal→Background derivation; `--template` selects a section-matrix variant (`standard·feature-impl·issue·review·meta·brainstorm`; default `feature-impl` when `--feature`, else `standard`); unknown variant or invalid dedup window → exit 2. With `--json`, duplicate errors include `error.code`, `existingWbs`, `existingName`, and `attemptedName`; the success envelope carries additive top-level `wbs`/`filePath` mirrors of `ref.id`/`ref.filePath` so scripts projecting the `task list/show` key vocabulary never read nulls on success.                                                                                                                                                                                                                                                                        |
| `spur task show <wbs>` (alias `get`)   | `--folder <path>` `--json`                                                                                                               | 0/1     | Frontmatter is a top-level field in `--json` output. `get` is a registered alias (task 0534 R1): the lexical suggester cannot bridge `get`→`show`, so agents guessing `get` previously got a bare `unknown command`. One command, one help entry, one code path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `spur task update <wbs> <status>`      | `--section <name> --from-file <path>` `--feature <id>` `--priority <p>` `--ac-numbering <mode>` `--folder <path>` `--json`               | 0/1/2   | Status transition runs lifecycle guard; `--section` reads body from file; `--feature`/`--priority`/`--ac-numbering` set the scalar frontmatter field on an existing task (the only post-create path, allow-listed to `feature_id`/`parent_wbs`/`priority`/`ac_numbering`, plus `done_forced`/`done_reason` written by the verdict-guard override). `--force-done` waives the verify **verdict** only — the FSM path still applies, so from an earlier status walk the hops first: `todo` → `wip` → `testing` → `done`, each running the structural `spur task check` (task 0487 R7b). An explicit `--section Solution --from-file` body must carry at least one recognized `file:line` citation (backticked `` `path:line` ``, bare `path.ext:line`, or adjacent file/line table cells) — validated at the write seam with the same predicate as the L3 checker (task 0510 R1), so an invalid authored Solution exits 3 before any mutation instead of being rejected later by `task check`; placeholder creation via templates / `sections init` is unaffected. `--ac-numbering task-local` opts a pre-existing task into the L3 Requirements↔AC coverage check; new tasks receive the field from the task templates. **Authoring-time size warning (0575 R1):** a `--section Requirements` or `--section Plan` write re-evaluates the whole post-write task body via `evaluateTaskSize` against `DEFAULT_TASK_SIZE_LIMITS` (max 10 R-items / max 16 Plan items — the same caps the pipeline precheck enforces, sole owner of the thresholds) and appends any `Task has N …` reasons to the result's `warnings[]` — stderr in human mode, inside the JSON payload under `--json`. Advisory only: the write has already landed, the exit code stays 0, and no other section ever runs the evaluation. |
| `spur task deps <wbs> <op> [values...]` | `--folder <path>` `--json`                                                                                                                   | 0/1/2/3 | Mutate `dependencies[]` frontmatter. Ops: `set <wbs...>` replace / `add <wbs...>` append (deduped) / `remove <wbs...>` drop / `clear` empty. WBS format, existence, self-edge, duplicate, and cycle validation all run before any write (atomic). Exit 3 = validation error, 2 = unknown op. |
| `spur task sections <wbs> <op> [name]` | `--folder <path>` `--json`                                                                                                                 | 0/1/2/3 | Canonical section mutation (matrix-enforced). Ops: `init` add every required section for current status (idempotent); `add <name>` add one canonical section (rejects unknown/forbidden); `list` read-only matrix resolution (required/optional/forbidden + present/missing). Names validated against `TASK_CANONICAL_SECTIONS` + variant/status matrix; universal sections always allowed. Writes go through the planning-write-service `updateSection` pipeline (phantom-section guards, atomic writes, history). |
| `spur task list`                       | `--status <s>` `--phase <p>` `--parent <wbs>` `--feature <id>` `--folder <path>` `--json`                                                | 0/1     | `--phase` is a legacy alias for `--status`; `--feature` filters to tasks carrying that `feature_id` edge (exact match) — the enumeration primitive for feature-level execution loops. Filters combine (AND).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `spur task refresh`                    | `--folder <path>` `--json`                                                                                                               | 0/1     | Re-scan the task corpus and report counts. The generated `kanban.md` artifact was retired in the A17 cutover (task 0192) once the web task-kanban board (task 0191) became the daily driver — this verb no longer writes any file. `--json`: `{folders, tasks}`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `spur task refresh-roster <wbs>`       | `--folder <path>` `--json`                                                                                                               | 0/1     | Regenerate a parent's sub-task roster block inside its `## Plan` (the generator half of the 0121 roll-up gate, task 0123). Scans `parent_wbs` children, renders a WBS·title·status table between `refresh-roster` auto-gen markers, and writes it idempotently — inserting the block (preserving hand-written Plan content) when absent, rewriting it in place when present. Zero children → clean no-op (`written:false`); no `## Plan` → error. `--json`: `{wbs, childCount, written}`.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `spur task migrate`                    | `--dry-run` `--folder <path>` `--json`                                                                                                   | 0/1     | Run the A17 task corpus normalization pass over the active task folder or `--folder`. `--dry-run` computes the full per-file report with zero writes; apply writes through the corpus migrator's atomic write path. Idempotent: a second run over a migrated corpus is a no-op. The live `docs/tasks2/` corpus was migrated 2026-07-04 (task 0192).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `spur task migrate-anchors`            | `--dry-run` `--json`                                                                                                                      | 0/1     | Anchor-qualification pass (task 0583 R1–R3): rewrite every backticked evidence anchor whose basename resolves to exactly one tracked repo path into its repo-relative form, preserving the line spec byte-for-byte. Writes Testing/Solution bodies via `PlanningWriteService.updateSection` (the same path `spur task update --section` uses) — distinct from the `migrate` M-rules, which never touch bodies. Ambiguous basenames are reported with all candidates and left untouched (R2). `--dry-run` produces the full old→new report with zero writes; idempotent on a second apply. The tracked index comes from `git ls-files` at the repo root (`resolveRepoRoot`), so untracked/gitignored files (e.g. `.spur/run/**` external evidence, task 0584) are never a target. Rule `L4.anchor-subject-mismatch` (R4/R5; task 0688 / ADR-088; narrowed by task 0714 R1) fires when a live (non-terminal) record's citing row carries exactly one backticked anchor plus real subject tokens and the cited range does not name that subject. Subject tokens exclude every backticked anchor in the row. Default severity is warning; the 0583-R6 `tasks.severity` error override was removed after the matcher fix left 982 frozen-legacy residuals rather than a worked-down true-positive set. Bounds checking (`L4.stale-line-anchor`) always applies — including to terminal records — and still uses the **cited** range. Surface: `packages/app/src/services/anchor-qualifier.ts`, `task-check.ts`; finding code `packages/config/src/finding-codes.ts`. |
| `spur task batch-create --file <json>` | `--folder <path>` `--json`                                                                                                               | 0/1     | Create many tasks from validated JSON — all-or-nothing for child creation; validated against `apps/cli/schemas/task-batch.schema.json` (A08/C03). After children land, every distinct `parent_wbs` is wired best-effort: parent roster refresh + `todo→wip` lifecycle transition. `--json`: `{created, wbs, parentsWired:[{wbs, rostered, transitionedTo, errors[]}]}`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `spur task resolve <file-path>`        | `--folder <path>` `--json`                                                                                                               | 0/1     | Maps a path to owning task (WBS + file). Returns 1 if no match. Strategies: direct match, filename WBS parse, walk-up (A10).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `spur task path <wbs>`                 | `--folder <path>` `--json`                                                                                                               | 0/1     | Resolve a WBS to its absolute task file path across configured task folders. Exit 1 when not found. |
| `spur task check [<wbs>]`              | `--strict` `--strict-core` `--as <status>` `--fix` `--corpus` `--since <ref>` `--folder <path>` `--json`                                                         | 0/1/2   | Four-layer validation (§3). L4 traceability: `feature_id`/`parent_wbs`/`dependencies` edge resolution + **AC coverage** (DD-09: task scenarios must be a subset of the linked feature's AC by normalized title — advisory before completion; errors at effective done) + **parent↔child roll-up** (ADR-020 amendment 2026-06-25, task 0121: for a decomposition parent, block effective `done` when a child remains open or the required roster/dependency link is missing; warn when all children are closed but the parent is still open; inert for tasks with no children). Validates all tasks in the active folder when `<wbs>` is omitted; a WBS-targeted check (`<wbs>` present, no `--folder`) resolves the task across **all configured task folders** — the same resolution as `task show`/`task path`/`task update` — while an explicit `--folder <path>` is normalized to an absolute path and restricts lookup to that single directory, so relative and absolute spellings produce identical findings; unscoped checks and `task list` remain active-folder-only (task 0522); `--strict` elevates ALL warnings; `--as <status>` evaluates the task as if it were already in `<status>` (F92 R2 — the lifecycle guards pass the transition target so `testing→done` checks the `done` row and executes `done.gate:true`); `--strict-core` is retained as a temporary compatibility alias. `--as` is validated against canonical task statuses. **Explicit corpus audit (ADR-108):** `--corpus` checks active tasks and features with cross-folder reference/identity resolution; `--since <ref>` scopes the advisory fog comparison. No baseline or severity override suppresses findings; warnings alone pass. Legacy `baselined` counts are zero, `duplicateKeys` is empty, and `newErrors`/`newWarnings` contain all findings. Cannot combine with WBS, `--folder`, `--as`, `--fix`, or strict switches; invalid combinations exit 2. Routine gates never invoke the audit. Matrix loaded from `.spur/tasks/section-matrix.yaml` with the bundled matrix fallback. |
| `spur task verdict <wbs>`              | `--from-answer <path>` `--folder <path>` `--json`                                                                                        | 0/1     | Derive the PASS/PARTIAL/FAIL/UNKNOWN gate verdict from the verify-step answer file and write `.spur/run/<wbs>-verdict.json`. Parses requirement rows, AC rows, and checks rows; behavior-bearing CORE AC rows marked `MET` without `test`/`command` evidence are downgraded to `PARTIAL` and surfaced via `evidence-rule-failed`. A `MET` requirement/AC row whose evidence is absent, empty, or whitespace-only is hollow (0721): the row is retained, the aggregate is `PARTIAL` (never `PASS`), and one `hollow-met-evidence` major check names every hollow row — the shared aggregation rule (`aggregateVerifyVerdict`) is authoritative, so persisted artifacts, completion checks, record rendering, and the tracked-Testing fallback fail closed identically. Warns (stderr, non-fatal) when no requirement row matches any scenario in the task's linked feature — bare `R1`-style ids derive a verdict but credit no scenario at the feature done gate (dogfood 2026-08-15, I3). The deterministic replacement for grep-over-prose in the pipeline verify step (0109). Consumed by the completion gate and by `spur task record`.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `spur task record <wbs>`               | `--verdict-file <path>` `--solution-from-diff` `--transition <status>` `--folder <path>` `--json`                                        | 0/1     | Write Testing/Review from verify verdict; optional Solution backfill from `git diff` and status transition. Preserves `acceptanceCriteria[]` evidence rows in Testing when present. A `--transition done` with a **PASS** verdict auto-walks `wip → testing → done` through the FSM and auto-creates the `pipeline` run-link the provenance gate requires (task 0436 R4); a non-PASS verdict to `done` surfaces a single `GuardDeniedError` instead of a bookkeeping retry loop.                                                                                                                                                                                                                                                                                                                                                                                                                                              |

| `spur task verifyall-aggregate`        | `--from-file <path>` `--json`                                                                                                             | 0/1     | Read a JSON array of `{wbs, outcome[, reason]}` and emit the deterministic batch verdict; NOT-STARTED excluded from the rollup. Default input `.spur/run/verifyall-batch-input.json`. Replaces agent-discretion rollup prose (task 0341). |
| `spur task run-link <wbs>`             | `--source <src>` `--run-id <id>` `--json`                                                                                                | 0/1     | Record a pipeline provenance run-link for a task (used by `--next` auto chains to satisfy the testing→done guard). Idempotent: re-run prints already-exists and skips. `--source` default `chain`; `--run-id` auto-generated when omitted. Shared ensure helper with `task record` (task 0436). |

**Explicit audit diagnostics (0766, 2026-09-06).** The optional Git fog comparison reports its
evaluated range or an explicit `SKIPPED` reason on stderr (including non-Git/shallow checkouts and
unresolvable `--since` refs). This does not change audit severity, exit policy or the single JSON
document on stdout; required structural-check failures still fail the audit.

**D61 completion policy (0765 re-verification, 2026-09-06).** Normal task and feature checks
reject unresolved declared feature/parent/dependency references. At effective `done`, required
scenario, verdict, dogfood and roll-up findings are errors; severity overrides cannot suppress
them. Optional absent references and presentation warnings remain advisory. The shared summary
applies this policy before overrides, including checks invoked through lifecycle guards.

**Projection-content additions (tasks 0625, 0688; ADR-090 / task 0691; 0714 R1).** `spur task check`
emits `L4.testing-verdict-stub` for the record-generated hollow Testing row (error at effective
`done`, warning before completion). Anchor content
matching (task 0714 R1): every Testing/Solution citation still receives repository-relative path
existence and line-bounds validation (`L4.stale-line-anchor`) regardless of record status;
terminal (`done`/`cancelled`) records stop there — their evidence is historical (ADR-092) and no
subject/drift heuristic runs against it. A live record is subject-matched only when its citing row
carries exactly one parsed line anchor and yields real subject tokens (no filename-derived
subjects; no whole-file relocation scan); a failed exact-range comparison then reports
`L4.anchor-subject-mismatch`. The matcher reads exactly the cited line range and excludes every
backticked anchor in the row from subject tokens (0688 R1/R2; 0691 retired the
±`ANCHOR_WINDOW_LINES` window — cited-range only). `L3.testing-coverage` is retired (bunfig.toml
already enforces 90/90); `L3.status-claim-contradiction` is retired (ADR-090 F96 disposition
DELETE). Exact triggers and tokenization:
[`lifecycle-projection-integrity.md`](lifecycle-projection-integrity.md) §2.

**Exit codes:** 0 success, 1 error, 2 invalid usage. Follows the design §10 `api-response` envelope
for `--json` output (`{ ok, data? }`).

<a id="72-spur-feature-commands"></a>

### 7.2 `spur feature` commands

Core feature verbs over `PlanningWriteService` (same write path as tasks). Features use
position-encoding hierarchical IDs (DD-14): single-letter top-level groups, children append one
digit 1–9 per level; ID length = depth; parent = drop the last character; **no `parent_id` field**.
Every subcommand supports `--json` (ADR-010 invariant). Source: delivery §1.2, design §2.2/§2.4.

| Command                                | Flags                                                                                        | Exit  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spur feature`                         | — (noun help)                                                                                | 0     | Lists subcommands if no subcommand given.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `spur feature create <name>`           | `--parent <id>` `--folder <path>` `--json`                                                   | 0/1   | ID allocated under the create-lock (R1): `--parent` → next free child digit 1–9; no parent → next free group letter A–Z.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `spur feature show <id>` (alias `get`) | `--folder <path>` `--json`                                                                   | 0/1   | Returns the feature summary + content; 1 if not found. `get` is a registered alias (task 0534 R1) mirroring `spur task show` — the noun is symmetric (show by id), same discovery gap. One command, one help entry, one code path.                                                                                                                                                                                                                                                                                                                                                                                                             …
| `spur feature update <id> [status]`    | `--field <key> --value <v>` `--section <name> --from-file <path>` `--folder <path>` `--json` | 0/1/2 | `<status>` runs the lifecycle transition (guarded, §7.5); `--field/--value` sets a scalar frontmatter field; `--section/--from-file` replaces an existing feature section body using the same body-only contract as `spur task update --section`. Section, field, and status updates may be composed in one invocation and apply in that order. 2 if an option pair is incomplete.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `spur feature advance <id>`            | `--to <status>` `--folder <path>` `--json`                                                   | 0/1   | Walk a feature through the legal forward lifecycle path (`backlog→active→verifying→done`, default target `done`). Runs the same feature checks the old wrapup shell ladder used before guarded hops (`active→verifying` non-strict, `verifying→done` strict), verifies observed status after each transition, and returns `{id,status,hops}` in `--json`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `spur feature list`                    | `--status <s>` `--priority <p>` `--folder <path>` `--json`                                   | 0/1   | Lists features sorted by ID; optional status/priority filters.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `spur feature check [<id>]`            | `--strict` `--as <status>` `--fix` `--folder <path>` `--json`                                        | 0/1   | Four-layer validation (§3): L1 schema, L2 section-matrix, L3 BDD AC (shared 0043 module) + one-active-P0-goal over `active` (0418: `verifying` is terminal-bound and no longer counts as a goal; `--as <status>` evaluates the rule against the post-transition status so lifecycle guards never deny the exit they relieve) + ≤9-children (DD-14, corpus-derived), L4 incoming `feature_id` edges + orphan-scenario warnings + **AC coverage** (DD-09) + verdict-backed AC satisfaction from canonical `id` rows or the `scenario` compatibility alias + bounded malformed-artifact diagnostics + verifying-readiness (linked tasks not done/cancelled). Validates all features when `<id>` omitted; `--strict` elevates warnings. Details: [`feature-check-strict-ac-satisfaction.md`](feature-check-strict-ac-satisfaction.md). |
| `spur feature refresh`                 | `--feature <id>` `--all` `--folder <path>` `--json`                                          | 0/1/2 | Regenerate the deterministic global `INDEX.md`; exactly one of `--feature <id>` or `--all` is required. `--feature` rewrites only that feature's `## Tasks` marker region, while `--all` opts into every feature. Missing or conflicting breadth exits 2. Feature lifecycle status, non-marker feature content, and all task files are preserved (task 0625; ADR-051 consent).                                                                                                                                                                                                                                                                                                                                                         |
| `spur feature move <id> --parent <id>` | `--parent <id>` `--dry-run` `--folder <path>` `--json`                                       | 0/1   | Cascade-rename (DD-14): re-IDs the node + all descendants (ID encodes position), renames their files, rewrites each `id` frontmatter + appends a move History line, and updates every task `feature_id` edge. Validates the full old→new plan first (collision / ≤9 / not-into-own-subtree); applies atomically with best-effort rollback. `--dry-run` returns the old→new map + affected tasks with zero writes. Omit `--parent` to move to a top-level group.                                                                                                                                                                                                                                                                                                                                                                           |

L4 verdict-backed AC satisfaction reads coverage in a fixed order: the `<wbs>-verdict.json`
artifact when present (authoritative, never merged or tiebroken), else the task's tracked
`## Testing` section via `parseTesting` (F93/0671), else an `L4.evidence-not-recoverable` named
state for evidence that predates durable recording (F93/0672).

**Dogfood identity (task 0625).** For self-referential workflow work, `feature check` accepts a
report only when the feature ID appears as a non-alphanumeric-delimited filename segment; an
incidental substring does not satisfy `L4.dogfood-missing`. Exact shape:
[`lifecycle-projection-integrity.md`](lifecycle-projection-integrity.md) §3.

ID rules (DD-14): valid IDs match `^[A-Z][1-9]*$`. The `## Tasks` auto-gen markers are
`<!-- AUTO-GENERATED by spur feature refresh -->` … `<!-- END AUTO-GENERATED -->` (recognized by
`MarkdownDocument.replaceMarkerRegion`). The full `spur feature` surface
(create/show/update/advance/list/check/refresh/move/sync) is now live.

**Root-node discipline (ADR-063).** Because the ID encodes position, the single-letter root set is
the product's coarsest map and a new letter is effectively permanent. File new work under the
feature that already owns its primary object; **a new top-level node requires explicit operator
consent**, requested with the candidate parents considered and why each was rejected. The ≤9-children
cap is never a reason to add a root letter — a full parent means nest deeper or repick the parent.
Misplacement is cheap to correct: `spur feature move <id> --parent <id>` cascade-renames the subtree
and rewrites every task `feature_id` edge, with `--dry-run` to preview.

<a id="73-frontmatter-schemas"></a>

### 7.3 Frontmatter schemas

Task and feature files share a `schema_version: 1` strictness gate (DD-03) and are written only
through `PlanningWriteService` (§7.5). Canonical field tables below; authority is the Zod schemas
in `packages/domain/src/planning/schema.ts` (`taskFrontmatterSchema`, `featureFrontmatterSchema`).

<a id="731-task-frontmatter--taskfrontmatterschema"></a>

### 7.3.1 Task frontmatter — `taskFrontmatterSchema`

Mirrors `docs/design/rd3-migration-design.md` §2.1. Exported by
`@gobing-ai/spur-domain` from `packages/domain/src/planning/schema.ts`.

| Field            | Zod type                                                  | Req | Notes                                          |
| ---------------- | --------------------------------------------------------- | --- | ---------------------------------------------- |
| `schema_version` | `z.literal(1)`                                            | ✔   | Strictness gate; future evolution (DD-03).     |
| `name`           | `z.string().min(1)`                                       | ✔   | Title; used in slug.                           |
| `description`    | `z.string().optional()`                                   | —   | No `description == name` default (DD-10).      |
| `status`         | `z.enum(TASK_STATUSES)` (transform → lowercase)           | ✔   | See §7.3.3; aliases accepted on input only.    |
| `type`           | `z.enum(['task','brainstorm']).default('task')`           | —   | `brainstorm` retained for corpus compat.       |
| `profile`        | `z.enum(PROFILES).optional()`                             | —   | Single key (DD-02); legacy `preset` collapsed. |
| `feature_id`     | `z.string().regex(/^[A-Z][1-9]*$/).nullable().optional()` | —   | Single traceability edge (DD-07).              |
| `parent_wbs`     | `z.string().regex(/^\d{4}$/).nullable().optional()`       | —   | Single sub-task convention (X02).              |
| `priority`       | `z.enum(['P0','P1','P2','P3']).optional()`                | —   | Aligned with the feature priority scale.       |
| `tags`           | `z.array(z.string()).optional()`                          | —   | Free-form filtering.                           |
| `ac_altitude`    | `z.enum(['graduating','task-local']).optional()`          | —   | DD-09 altitude contract (ADR-062, task 0584): `task-local` skips the subset rule; absent/`graduating` enforces it. Field-only, never inferred (R4). |
| `dependencies`   | `z.array(z.string()).optional()`                          | —   | Soft WBS refs; `check` warns on dangling.      |
| `created_at`     | ISO 8601 string                                           | ✔   | Write-service-owned.                           |
| `updated_at`     | ISO 8601 string                                           | ✔   | Written **only** by the write service.         |

Removed from the legacy schema (A17): `impl_progress` (frozen-state problem), `folder` (derivable from
file location), `preset` (collapsed into `profile`).

**External-evidence citation form (ADR-062, task 0584).** Evidence that lives OUTSIDE `spur`'s working
tree uses a frozen non-anchor form — a named origin plus a backticked path with the line number
**outside** the backticks:

```
Evidence: @gobing-ai/ts-llm-jsonl-importer `src/mappers.ts` line 481 — omp call_id write
```

`checkLineAnchors` classifies it as external and never raises `L4.stale-line-anchor` for it (R1); a
citation whose basename resolves uniquely inside this repo is in-repo evidence and must use the
repo-relative backtick form `` `path:line` `` — the external form still reports there (R2).

<a id="732-feature-frontmatter--featurefrontmatterschema"></a>

### 7.3.2 Feature frontmatter — `featureFrontmatterSchema`

Mirrors `docs/design/rd3-migration-design.md` §2.2. No `parent_id` field (DD-14): the parent is derived
by dropping the last character of `id`.

| Field            | Zod type                                           | Req | Notes                                                                                                                                        |
| ---------------- | -------------------------------------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema_version` | `z.literal(1)`                                     | ✔   | Same evolution mechanism as tasks.                                                                                                           |
| `id`             | `z.string().regex(/^[A-Z][1-9]*$/)`                | ✔   | Position-encoding hierarchical ID (DD-14).                                                                                                   |
| `name`           | `z.string().min(1)`                                | ✔   |                                                                                                                                              |
| `status`         | `z.enum(FEATURE_STATUSES)` (transform → lowercase) | ✔   | See §7.3.3; `verifying` is canonical.                                                                                                        |
| `priority`       | `z.enum(['P0','P1','P2','P3']).optional()`         | —   | Optional for parity with tasks; consumers default a missing value to `P2`. The P0 feature in `active`/`verifying` is the project goal (B09). |
| `tags`           | `z.array(z.string()).optional()`                   | —   |                                                                                                                                              |
| `created_at`     | ISO 8601 string                                    | ✔   | Write-service-owned.                                                                                                                         |
| `updated_at`     | ISO 8601 string                                    | ✔   | Write-service-owned.                                                                                                                         |

<a id="733-canonical-status-vocabularies"></a>

### 7.3.3 Canonical status vocabularies

Lowercase canonical values (DD-01); display layers capitalize. Input is case-insensitive and
alias-tolerant. The legacy alias map is preserved as input normalization — never as storage.

| Domain          | Canonical values                                                    |
| --------------- | ------------------------------------------------------------------- |
| `TaskStatus`    | `backlog · todo · wip · testing · blocked · done · cancelled`       |
| `FeatureStatus` | `backlog · active · verifying · blocked · done · cancelled` (DD-13) |

Input normalization (excerpt, full map lives in `normalizeTaskStatus` / `normalizeFeatureStatus`):
`completed → done`, `in-progress / in_progress / in progress → wip (task) or active (feature)`,
`dropped / canceled / cancel → cancelled`, `review / in-review / in_review → verifying` (feature only),
`pending / new → backlog`, mixed case accepted via `.trim().toLowerCase()`. Storage is always the
lowercase canonical form; aliases never persist.

**Status icon SSOT (R1).** `TASK_STATUS_ICONS` and `FEATURE_STATUS_ICONS` in
`packages/domain/src/planning/schema.ts` map each canonical status to a presentation emoji.
Consumed by the board toggle group, swimlane headers, and CLI `spur task show`/`list` output.
Storage values stay lowercase canonical (DD-01); the icon is presentation-only and never persisted.

<a id="74-section-status-matrix--planning-event-catalog"></a>

### 7.4 Section-Status-Matrix + planning event catalog

**Section-Status-Matrix.** Source: `config/tasks/section-matrix.yaml` (schema:
`apps/cli/schemas/section-matrix.schema.json`). The YAML declares a root `$schema` ref and is loaded

- validated by the standard `loadStructuredConfig` path (`loadSpurConfig` in
  `apps/cli/src/config/loader.ts`, with the schema embedded for `--compile` binaries) — a typo'd section
  name or status key fails loud at load instead of becoming a dead rule. (The Zod `sectionMatrixSchema`
  in domain remains the typed contract + unit-test surface.) Each **template variant**
  (`standard·feature-impl·issue·review·meta·brainstorm` — the unified
  `TASK_VARIANTS` axis selected by a task's `template:` frontmatter, defaulting to `standard`) maps a
  status → { required, optional, forbidden } section lists, evaluated by `spur task check` /
  `spur feature check` (the L2 layer, design §3.2). `spur task check` resolves the variant from
  `fm.template ?? 'standard'` (not `type`). Ships permissive (warning-first); the hard-gate core is the
  `done` status (Solution + Testing + Review required, `gate: true`) plus the AC/Solution/Review format
  rules. `Root Cause` is optional for `meta` tasks because process/chore investigations may retain
  causal evidence without adopting the stricter `issue` template. Authority for matrix semantics:
  design §3 (the L2 layer), delivery §3.2.

**Matrix-aware L3 gating (0787).** Placeholder-only sections hard-fail only when the **effective
status requires them**: the L3 placeholder rules gate on `requiredAtStatus` — the effective
status's required set (`packages/app/src/services/task-check.ts:649-655`) — so guidance-scaffold
content in optional sections is advisory, not an error. In the shipped matrix
(`config/tasks/section-matrix.yaml`) Requirements is todo-**optional**: a placeholder-only
Requirements at `todo` no longer blocks (intentionally superseding task 0339's unconditional
Requirements-at-todo gate, which predated the matrix-driven L2/L3 split; decision recorded in the
0787 task-doc Review section).

**Matrix-driven creation (single producer).** The same matrix is the **sole semantic authority**
for which sections a *new* task file carries, **per variant** (F92 R1). `spur task create` /
`batch-create` always render the body via the canonical
`buildTaskSkeleton` (`packages/domain/src/planning/task-skeleton.ts`) from the matrix entry for the
chosen variant + creation status — there is no second, inline section list in `task-service.ts` (the
removed `DEFAULT_CREATION_SECTIONS`) and no template-as-skeleton rendering path (the templates supply
**bodies** only). Packaged/compiled execution loads a matrix data asset copied/generated from the
canonical `config/tasks/section-matrix.yaml` and **fails loudly with the attempted paths** if no
asset is reachable — the removed `FALLBACK_MATRIX` made the same task render differently by
installation layout and defeated the SSOT. Per-variant section **bodies** (e.g.
`review`'s `#### Review Findings` input table under Background) come from the scaffold template files
(`config/templates/task/<variant>.md`), extracted by `extractTemplateBodies` and merged under the
task-specific bodies (Background/Requirements) — so variant boilerplate is **data, never hardcoded**.

**Ready-by-default creation (0788, ADR-109).** `spur task create`/`batch-create` prepare the saved
content to ready depth through `prepareCreatedTaskReady`/`prepareBatchTaskReady`
(`packages/app/src/services/task-readiness.ts`) before reporting success: an executor applies the
ready checklist, the deterministic `task check` must pass as `todo`, and a backlog task is promoted
to `todo` (idempotent). `--skip-ready` captures caller content without model execution. Success JSON
carries `readiness:{status: ready|skipped, depth: ready}`; preparation failures emit
`preparation-failed` with the stage and the exact recovery command (`/sp:dev-refine … --depth ready`
or `/sp:dev-refineall … --depth ready`). In the idea pipeline, `batch-create-run` invokes
`batch-create --skip-ready` and the dedicated `ready-prepare` state has the planning owner prepare
each created task and write the run-scoped ready-evidence sidecar (`.spur/run/<runId>-idea-ready.json`);
`handoff-finalize` verifies row status, planning digest and checklist evidence before recommending
auto `runall` — missing or failing evidence degrades the recommendation to ready-depth `refineall`
and never fails the run.

**Target-aware lifecycle validation (F92 R2/R3).** `spur task check` accepts
`--as <status>` (a read-only `asStatus` projection). Frontmatter **schema** validation reads the real
document, while the lifecycle-dependent L2/L3/L4 policy evaluates
`effectiveStatus = asStatus ?? frontmatter.status`. The lifecycle guards pass the transition **target**:
`wip→testing` runs `--as testing` and `testing→done` runs `--as done`, so a testing task is checked
against the `done` row (`Solution + Testing + Review`, `gate: true`) — closing the defect where
`testing→done` evaluated the current `testing` row and never executed `done.gate:true`. The task file
is never mutated before the guard allows the transition. `--strict-core` is retained only as a
temporary compatibility alias for installed plugins/workflows; target-state selection supplies the
real done semantics.
Each remaining unfilled section gets an invisible HTML guidance comment (skipped by the L3 format
rules via `isPlaceholderBody`). **Creation status (§2.3 semantics, 0787 eligibility probe):**
creation renders the candidate AS `todo` and validates it against the matrix's `todo` row; a
complete spec (the required todo bodies — Background, Acceptance Criteria, Design, Plan — filled)
passes the probe and is created at **`todo`** ("ready to execute" — the HITL review gate), while a
capture lacking any required todo body (bare, requirements-only, or `--feature`-linked without a
full spec) is created at **`backlog`** ("still preparing" — Background only). `Solution` is the
implementation change-map and first appears at `wip`; the L3 `file:line` rule only fires once it
has real content.
`History`/`References`/`Notes` are universally allowed by the closed-world check (structural, present
throughout the lifecycle).

**Planning event catalog (X04).** The six planning events on `PlanningEventMap` + three engine-seam
events. All planning events are emitted by `PlanningWriteService` (design §7) and persisted to the
`planning_events` table (append-only ledger, rehydratable from `## History`). SSOT for the names is
the code: `packages/app/src/services/planning-write-service.ts` (`PlanningEventName` union) and
`packages/app/src/services/planning-events.ts` (`PlanningEventMap`). Document, never invent.

| Event                  | Fired when                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `task.created`         | A task file is created (including each item of a `batch-create`).                      |
| `task.updated`         | Any non-status write to a task (section edit, frontmatter change).                     |
| `task.transitioned`    | A task status change completes through the lifecycle workflow (includes cancellation). |
| `feature.created`      | A feature file is created.                                                             |
| `feature.updated`      | Any non-status write to a feature.                                                     |
| `feature.transitioned` | A feature status change completes (includes cancellation).                             |

Engine-seam events (from `ts-dual-workflow-engine`, per lifecycle/pipeline run — ADR-022):

| Event           | Fired when                                                                  |
| --------------- | --------------------------------------------------------------------------- |
| `on_transition` | A workflow run moves between states — the seam planning events derive from. |
| `on_guard_fail` | A guard (e.g. `spur task check` pre-gate) blocks a transition.              |
| `on_complete`   | A workflow run reaches its terminal state.                                  |
