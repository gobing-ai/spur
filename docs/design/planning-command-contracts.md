# Feature sync and agent command contracts

Detailed non-UI contracts, indexed by [04 Design](../04_DESIGN.md).
Original section numbers remain stable; unqualified section references resolve through the 04 index.

<a id="spur-feature-sync-id---all---dry-run---force---folder-path---json"></a>

#### `spur feature sync [id] [--all] [--dry-run] [--force] [--folder <path>] [--json]`

Sync feature status with linked task states via conservative forward-only derivation rules (ADR-0322).

- `[id]` — sync a single feature by ID.
- `--all` — evaluate and sync all features with linked tasks.
- `--dry-run` — report proposed status sync transitions without applying writes.
- `--force` — force applying reopen proposals (`done/cancelled -> active` when non-terminal tasks are linked) without confirmation.
- Applied-hop projection (task 0625): after one or more lifecycle hops, `syncFeature` calls
  `refresh({ featureId: id })` from `finally` before returning or rethrowing a later-hop guard
  failure, so the touched feature's `## Tasks` marker region reflects the task edges used to derive
  status. Dry-run, confirmation-refused, and no-op results do not refresh.
- `POST /features/{id}/sync` HTTP endpoint: `pull` direction delegates to `syncFeature` (`{ direction: 'pull', affectedTasks, applied, newStatus }` — `affectedTasks` = number of tasks linked to the feature, `applied` = whether a status transition was applied); `push` direction returns HTTP 501 structured error (not supported; use pull or CLI `spur feature sync`).
- Pipeline integration (task 0328; bounded by 0411, amended by 0625): `task-pipeline.yaml`'s
  post-record step syncs the linked feature or records an orphan proposal. `wrapup-pipeline.yaml`'s
  `feature-transition` step syncs `${vars.feature}`, captures the result and exit code, and runs
  trusted workflow var `featureGateCmd` (default `$spurBin feature check "$feature"` — the
  affected feature, not the corpus or code suite) when `applied` is true or
  sync exits non-zero after a possible partial transition. Both prefer `feature-sync-bounded.ts` and
  fall back to plain `spur feature sync` in a seeded project. The shells remain advisory (`exit 0`);
  the wrap-up gate emits explicit PASS/FAIL while leaving recovery to the operator. An empty wrap-up
  feature id fails loud with exit 1.
- Wrap-up validated inputs (task 0783; audit 0781 F-04): `task-resolve` validates `${vars.tasks}`
  exactly once into a deduplicated, first-seen-order list of canonical four-digit task ids at
  `.spur/run/<runId>-wrapup-tasks.json` — malformed JSON, non-array/non-string/whitespace entries,
  unresolvable or nonterminal tasks, and a missing `__runId` all record FAIL. Every
  post-resolution consumer (route writer, doc-sync prompt, metrics, operator notes, cleanup prompt,
  route guards) reads that capture instead of raw `vars.tasks`; a missing or corrupted capture
  refuses progression. Metrics revalidates the capture, requires well-shaped `task show` output,
  serializes rows with `jq`, and records PASS only after every append succeeds (a missing verdict
  is `UNKNOWN` telemetry). `feature-transition` classifies the sync result: PASS requires a valid
  proposal whose `featureId` matches `${vars.feature}` with no `gateBlocked`/`requiresConfirm`,
  where an applied sync is freshly observed at the proposal target, or an unapplied no-op is an
  observed `from == to`. Gate-blocked, confirmation-required, mismatched, partial (observed
  off-target), malformed-stdout, and non-zero results record FAIL; the affected-feature gate runs
  only diagnostically and cannot convert a failed sync into success. Dead raw-input re-parsing,
  the `RUN_ID="wrapup"` fallback, and soft-success comments are removed; route reason strings are
  unchanged.

Task frontmatter supports `feature_link_declined: true` to record explicit operator deferral.

Detailed shapes: [`lifecycle-projection-integrity.md`](lifecycle-projection-integrity.md).

<a id="spur-task-scaffold-tests-wbs---file-path---folder-path---json"></a>

#### `spur task scaffold-tests <wbs> [--file <path>] [--folder <path>] [--json]`

Scaffold BDD `test.todo` stubs from task Acceptance Criteria into `<workspace>/tests/tasks/<wbs>.test.ts` (or `--file <path>`). Each scenario produces one stub with Given/When/Then steps as AAA comments and a `// @ac:<normalizedTitle>` tag. Expands Scenario Outlines into 1 stub per Examples row. Merges idempotently with existing test files (preserves filled bodies, appends new scenarios, reports drifted scenarios). `--json` returns `{ wbs, targetFile, created, skipped, drifted, driftedScenarios, warnings }`.

<a id="12-supporting-utilities"></a>

### 1.2 Supporting utilities

| Command                                                                       | Behavior                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spur status [path] [--json]`                                                 | Project health: `ok`/exit 0 requires a valid `.spur/config.yaml`; `packageJson` is an independent optional fact. Also reports Git context, team agent spec ids under `.spur/agents/`, and optional path metadata (size, isFile, isDirectory). Hidden alias — canonical: `spur self status`. |
| `spur serve [--port <n>] [--host <addr>] [--no-open] [--cwd <path>] [--json]` | Start the web server (local fallback) and serve the Spur Board SPA when static assets resolve. Options: `--port` (env PORT, default 3000), `--host` (env HOST, default localhost), `--no-open` skip browser, `--json` print {port,url,pid}. `--cwd` selects ONE coherent project root (task 0805 R2): it is resolved against the invocation directory (a relative path is made absolute), must exist and be a directory (a missing/non-directory target fails before server startup with exit 1), and is passed through `StartServerOptions.cwd` so server config/bootstrap loading, filesystem/context, planning folders, DB defaults, quota updates and project-scoped scheduled/child work all use it. Through the CLI, commander defaults `--cwd` to the invocation directory, so the resolved root is always passed; a direct API/embedding call that omits `cwd` keeps the `process.cwd()` fallback. The `--json` probe validates `--cwd` first — a missing/non-directory `--cwd` fails with exit 1 before any JSON is printed (0808 R1). The default DB still scopes to the resolved root. Explicit `DATABASE_URL` retains precedence over the `--cwd` default DB. Board assets ship in the npm package as `web/` next to `spur.js` (`resolveWebDistPath`); without them `/board` returns JSON 404 and the server logs a warning. Hidden alias — canonical: `spur self serve`. |
| `spur projects [add                                                           | remove                                                                                                                                                                                                                                                                                                                                                                                                     | list | start | stop] [args] [--json]` | Multi-project registry management: `add <path>` registers project, `remove <target>` unregisters, `list` shows registered projects and health status, `start <target>` spawns server on allocated port, `stop <target>` stops server process. `--json` shapes for scripting. |
| `spur migrate [--json]`                                                       | Temporary helper: apply CLI-owned schema migrations; reports `{ ok, applied }`. Hidden alias — canonical: `spur self migrate`. |
| `spur maintain [--vacuum] [--json]`                                           | Run database maintenance: PRAGMA optimize, WAL truncation, optional VACUUM compaction. Hidden alias — canonical: `spur self maintain`. The `TRUNCATE` checkpoint is manual-path only; the periodic retention path checkpoints `PASSIVE` (task 0803 R2). |

| `spur --help` / `spur --version` | Commander-rendered usage / binary version (ADR-014). |

<a id="13-agent-command-surface--commands-as-ssot-feature-h5-was-o-adr-032"></a>

### 1.3 Agent command surface — commands as SSOT (feature H5 (was O), ADR-032)

The `plugins/sp` agent-facing command surface (33 `/sp:dev-*` wrappers; 39 command wrappers total) is
**hand-authored** — each `commands/<name>.md` is the authoritative, directly-editable source.
Per-platform adapters are **install-time output** owned by `superskill` (`superskill install sp`)
and never committed in plugin `sp` (ADR-032).

| Artifact                                    | Role                                                                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `plugins/sp/commands/<name>.md`             | Hand-editable SSOT — frontmatter + invocation syntax + delegation line only                                                        |
| `plugins/sp/scripts/validate-commands.ts`   | Thin-wrapper contract validator: (a) heading whitelist, (b) frontmatter schema, (c) target resolution, (d) allowed-tools coherence, (e) dev-command argument contract |
| `plugins/sp/tests/command-contract.test.ts` | Contract test — validates the same five gates against the live corpus + negative-path coverage                                     |

Invariants: wrappers carry invocation syntax + the delegation line only — lifecycle semantics live
in the dispatched skill/workflow/procedure (0283 R4). The thin-wrapper contract is enforced by
validation, not generation — commands are hand-editable; the validator catches drift. A fresh
session is required to trust an in-session dogfood of a just-edited wrapper (platforms snapshot
command bodies at session start). The command index is owned by `plugins/sp/README.md`.
Supersedes the 0308 generated-adapter approach (ADR-032 records the decision).

**H81 contract (task 0412).** Dev-command frontmatter carries syntax-only
`argument-hint`; each body adds `## Argument Flags` immediately before `## Usage`, with exact
`Flag | Description | Default` columns and one canonical glossary reference. The validator enforces
the ordered three-heading contract and five gates (a–e); parity tests derive coverage from all
dev commands. Full shapes:
[`dev-command-argument-contract.md`](dev-command-argument-contract.md).

<a id="131-spdev-find-conflict--authority-aware-conflict-audit-feature-h11-task-0486"></a>

#### 1.3.1 `/sp:dev-find-conflict` — authority-aware conflict audit (feature H11, task 0486)

Thin wrapper over the `sp:conflict-finding` skill. Standalone audit, not a spine pipeline stage.

```text
/sp:dev-find-conflict [<scope>]
    [--pillar <source|tasks|features|authority|all>]   # default all
    [--mode <adaptive|full>]                            # default adaptive
    [--resolve]                                         # default off
    [--agent <inline|auto|name>]                        # default omitted
    [--json]                                            # default off
```

Enum flags are validated at Step 1 (`--pillar` ∈ `source|tasks|features|authority|all`, `--mode` ∈
`adaptive|full`, `--agent` ∈ `inline|auto|name`); an out-of-domain value refuses the audit naming
the valid set — no silent coercion. `<scope>` remains free-form.

Behavior: audits the four pillars (source code, task files, feature files, project authority files)
for within-pillar and cross-pillar semantic conflicts. Authority is resolved per **subject + claim
type** — never by a global `docs > features > tasks > code` ranking; incomparable or missing
authority yields a `needs-authority-decision` item rather than a fabricated winner. Without
`--resolve` the run is read-only with respect to source, corpus, and numbered docs. With `--resolve`
the skill presents a repair set, requires explicit confirmation, revalidates evidence freshness, then
routes each approved repair through its owner surface (`spur task`/`spur feature`, `sp:doc-evolve`,
the Spur dev lifecycle, or the Superskill capability lifecycle).

Result envelope (identical content in Markdown and `--json`):

```text
schema_version, command, scope, mode, pillars, authority_map,
inventory, findings, unresolved, coverage, cost, remediation, errors
```

Each finding carries `id, subject, claim_type, conflict_type, pillars, artifacts,
normative_authority, observed_reality, precedence_reason, evidence, freshness, severity, confidence,
false_positive_check, proposed_repair, repair_owner, status`. `conflict_type` ∈ {`contradiction`,
`stale`, `duplicate`, `omission`, `orphan`, `ambiguous-authority`}; `status` ∈ {`open`,
`needs-authority-decision`, `confirmed`, `repairing`, `resolved`, `failed`}. `coverage.complete`
is `false` whenever a selected pillar was skipped or a preflight tool failed — "comprehensive" may
not be claimed against a false value. v1 adds no production analyzer, index/cache/database,
dependency, CLI noun, workflow, or dedicated subagent. SSOT:
`plugins/sp/skills/conflict-finding/SKILL.md` + its four references.

<a id="132-spdev-find-next--feature-frontier-prioritizer-feature-h12-tasks-0497-0498"></a>

#### 1.3.2 `/sp:dev-find-next` — feature frontier prioritizer (feature H12, tasks 0497, 0498)

Thin wrapper over the `sp:next-feature` skill. Standalone report, not a spine pipeline stage.
Answers "which feature should we work on now?" — the target-omitted case `sp:next-router`
declares out of v1 (routing-table §0 step 1c); within-target routing stays `/sp:dev-next`'s.

```text
/sp:dev-find-next
    [--task [<feature-id>]]                             # default omitted
    [--agent <inline|auto|name>]                        # default omitted
    [--auto]                                            # default off
    [--json]                                            # default off
```

Behavior: (0) sync-first precondition — `spur feature sync --all --dry-run --json`; material drift
leads the report with a "sync first" block and ranking uses the post-sync status view. (1) Assemble
the candidate set from `spur feature list --json` (containers and terminal features excluded; the
`group` tag is not a reliable container marker). (2) Gate on actionability — the frontier predicate
is **cited at runtime** from next-router's routing-table row B3, never restated; gated features are
reported with reasons, never ranked. (3) Derive the four measured signals (AC coverage, churn
exposure, dogfood proximity, authority pull) via `spur … --json`, `git`, and `rg`; a signal with a
degenerate spread is reported rejected-with-spread. (4) Rank in **ordinal tiers with per-candidate
evidence** — no numeric scores (the corpus carries no value/effort estimates; the `priority` field
is degenerate and never used as an ordering). (5) Defect pass — rank-distorting tree defects D1–D4
are emitted as proposals conforming to `docs/plans/feature-tree-restructure-map.md`'s schema, each
clearing the `sp:conflict-finding` evidence bar (`false_positive_check` mandatory); silence is a
valid outcome. (6) Report — the command performs no `spur feature move` and writes nothing under
`docs/features/**`; `/sp:dev-feature-change` (dry-run → confirm → apply) is the sole path from a
structure proposal to a changed tree. (7) **`--task` only (task 0498, resolving OQ1 toward the
planning half):** offer the rank-1 candidate (or the id passed to `--task`), then route on the tier
step 4 assigned — T3 with valid AC and zero tasks → `/sp:dev-plan --feature <id>` then
`/sp:dev-refineall --feature <id> --auto --depth ready`; T1 → refineall only (a live frontier already
exists; a second decomposition duplicates it); T3 with invalid AC → stop with next-router's B4 hop,
never inventing idea text; T2 (blocked) and T4 (stale-done) → refuse with the reason. The skill
**creates no tasks itself** — decomposition and the `task-batch.schema.json` gate belong to
`/sp:dev-plan`. Confirm is interactive by default; **`--auto` auto-accepts the offered target**
(rank-1 or the explicit `--task <id>`) as operator pre-consent to take the ranking's recommendation
and is forwarded to the dispatched children. T2/T4 refuse and invalid-AC stop still apply under
`--auto`. Without `--task`, `--auto` is a no-op. Adds no TypeScript, schema, frontmatter field, CLI
verb, or subagent. SSOT:
`plugins/sp/skills/next-feature/SKILL.md` + its four references
(`signal-derivation`, `ranking-rubric`, `proposal-contract`, `handoff-routing`).
