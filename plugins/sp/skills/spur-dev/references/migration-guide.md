---
name: downstream-migration
description: "Migrate an existing Spur project to the current CLI and plugin contract while preserving local config and planning history."
see_also:
  - spur-dev
  - spur-cli
---

# Downstream migration guide

Use this guide to upgrade an existing project to **Spur 0.4.34** and its matching `sp` plugin.
For a later release, use the same procedure and read that release's `CHANGELOG.md` entries for
additional required changes. Do not treat every release as requiring a corpus rewrite.

## 1. Preservation contract

- `.spur/config.yaml`, `docs/features/`, and `docs/tasks*/` are project-owned inputs. Never replace
  them with package examples or a fresh checkout.
- Task and feature Markdown is the planning SSOT. The SQLite database is derived; database
  migrations do not rewrite that Markdown. `docs/features/INDEX.md` and generated task rosters are
  outputs and must only be regenerated through `spur feature`.
- Do not run `spur self init --force`, bulk-copy the packaged default configuration or its
  workflow definitions, or edit generated feature regions directly. Existing project overrides need
  reconciliation, not replacement.
- Keep history. Retired commands and old evidence prose can remain in completed task records;
  they are not instructions to re-run. `spur task migrate-anchors` and `spur task residual` are
  removed and must not be called.
- Use CLI-gated writes. Feature acceptance criteria go through `spur feature update --section`;
  task sections go through `spur task update --section`. No direct corpus edits.

## 2. Preflight and backup

Work from the downstream project root, with a clean Git tree and a named backup ref:

```bash
cd /path/to/project
git status --short
git switch -c chore/spur-0.4.34-migration
spur --version
spur self status --json
spur self migrate --check --json
spur self exec --list --json
```

`self migrate --check` is read-only: exit 1 means importer-schema drift and requires the apply
step below; an absent database is allowed. Keep the current checkout or another backup ref so the
migration can be reverted. If `.spur/spur.db` exists, stop the project server and copy it to a
backup location before continuing. Do not back up or restore Markdown by deleting it first.

## 3. Install matching CLI and plugin

Install the CLI, then install the plugin from that same package rather than mixing versions:

```bash
bun add -g @gobing-ai/superskill @gobing-ai/spur@0.4.34
superskill install sp --marketplace $(dirname $(bun pm bin -g))/install/global/node_modules/@gobing-ai/spur
spur --version
spur agent doctor --json
```

Confirm the reported CLI version is the intended release. `agent doctor` checks executor usability;
it does not prove authentication or provider quota. The Electron shell is retired: use
`spur self serve` for the Board.

## 4. Migrate `.spur/config.yaml`

Preserve project-specific values and make only the applicable edits:

| Existing state | Required action |
| --- | --- |
| `.spur/config.json` still supplies project config | Move the project-owned values into `.spur/config.yaml`; do not keep a second config authority. |
| `version` is absent or an integer | Use the YAML string `version: "1.1"`. |
| `agent.team` or `.spur/fleet.json` declares a roster | Move it to **project-layer** `agent.fleet`. Keep executor profiles in the global layer, not in the fleet. A leftover old carrier fails loading by design. |
| `workflow.hitlDecisionMaker` | Rename the section to `workflows.hitlDecisionMaker`. |
| Bun project with no `builder` block | No change: `builder.preset: bun` supplies the existing commands. |
| Non-Bun project, or custom commands required | Set `builder.preset: none` and bind `builder.actions` (`lint`, `test`, `check`, and any required `*-changed` actions) to the project's real commands. |
| `tasks.folders` and `tasks.active` | Preserve folder names, labels, `baseCounter`, and the active folder. Archived folders remain readable history, not a bulk-migration target. |
| `features.dir` | Preserve the existing feature tree and hierarchical IDs; do not renumber features or scenario titles. |

Example non-Bun binding only (replace placeholders with real commands):

```yaml
builder:
  preset: none
  actions:
    lint: <project-lint-command>
    test: <project-test-command>
    check: [lint, test]
```

Validate resolution without running the actions:

```bash
spur self exec --list --json
spur self exec check --dry-run --json
spur self status --json
```

Do not copy `config/config.example.yaml` over the project file. That example documents available
keys; it is not a migration target.

## 5. Reconcile project workflow overrides

The bundled definitions are not drop-in replacements for project overrides. Compare with
`spur workflow list --json` and validate every project-owned definition with
`spur workflow validate <path>`.

For 0.4.34 specifically:

- Task execution is D65: `precheck → implement[⇄escalate] → gate[⇄remediate] → review → done`.
  There are no separate `test`/`test-recheck`, `approve`, `verify`, or `record` states. Completion
  evidence is a tree-hash gate receipt plus the reviewer verdict; the old proof-digest chain,
  answer lint, answer-confidence fields, residual sweep, and verdict replay are gone.
- `deferQualityGate: "true"` makes the incremental gate the per-task default. The full project
  gate runs once per feature or batch; do not remove that integrated-tree check.
- Feature verification is owned by `feature-lifecycle`: entering `verifying` runs
  `spur feature verify`. The separate `feature-verification.yaml` workflow is removed, and
  `wrapup-pipeline` no longer changes feature status.
- Planning uses `idea-pipeline`. `planning-pipeline.yaml`, `docs-pipeline.yaml`,
  `feature-dev.yaml`, `task-pipeline2.yaml`, `pr-review.yaml`, and `wayfinder-resolution.yaml`
  are removed. Route former callers to `idea-pipeline`, `task-pipeline`, `feature-lifecycle`,
  `spur builder pr-check|pr-open|pr-review|pr-status`, or the wayfinder skill as appropriate.
- Project-layer `task-lifecycle.yaml` and `feature-lifecycle.yaml` overrides must be re-synced for
  current guards and the non-terminal `deprecated` state. The status addition itself needs no
  corpus migration.

## 6. Migrate and validate the planning corpus

Run only the operations that apply to the project's actual state:

```bash
# A17 normalization only, not a general schema migrator — preview first.
spur task migrate --dry-run --json
# If the preview shows wanted A17 changes and no conflicts:
spur task migrate --json

# Structural checks and optional mechanical repairs; review their diffs afterward.
spur task check --fix --json
spur feature check --fix --json

# Required final validation (warnings are reported separately from errors).
spur task check --corpus --json
spur feature check --json
```

`task migrate` normalizes the active task folder (or an explicit `--folder`). It is not a
feature-migration or a reason to rewrite archived folders. `task check --fix` and
`feature check --fix` repair structure, not semantics or Gherkin conversion.

Feature acceptance criteria must use valid BDD with a `Feature:` declaration and `Scenario:`
blocks. Raw legacy bullets need a deliberate conversion through:

```bash
spur feature update <id> --section 'Acceptance Criteria' --from-file /tmp/<id>-ac.md
```

Preserve each scenario's R-number and meaning. Use `@deprecated` and a Notes entry for a scenario
that is historical rather than a current requirement. If validation exposes an old hook or
lifecycle claim, check the current ADR/design owner instead of editing it blindly.

Preview lifecycle derivation before applying it, then regenerate derived projections only after
the corpus checks are understood:

```bash
spur feature sync --all --dry-run --json
spur feature sync --all --json
spur feature refresh --all --json
```

A missing, stale, running, or failed feature-verification receipt is unfinished work, not something
to hide by forcing a transition. Run `spur feature verify <id>` after the applicable full project
gate passes. Ordinary warnings can remain visible; do not manufacture a clean report by editing
history or suppressing findings.

## 7. Final acceptance and rollback

Run the project gate and inspect the migration diff:

```bash
spur self exec check
spur self exec check-feature   # when closing a feature; full project gate
spur workflow list --json
spur task check --corpus --json
spur feature check --json
git diff --check
git status --short
```

`check-feature` is the full project gate for feature closure, not a replacement for the default
incremental task gate. If an action is unbound, fix `builder.actions` instead of substituting a
command from another repository.

Stop on the first material error. Restore from the backup ref rather than running init or
bulk-deleting files:

```bash
git diff <backup-ref> -- .spur/config.yaml docs/features docs/tasks*
git restore --source=<backup-ref> -- .spur/config.yaml docs/features docs/tasks*
git status --short
```

Review new untracked files separately; `git restore` does not remove them. Reinstall the previous
CLI/plugin version and restore the database backup only after stopping the server. Keep failure
logs and durable evidence under `.spur/memory/`; `.spur/run/` is disposable scratch, not a rollback
authority.

## Agent handoff

Give the downstream agent this boundary verbatim:

> Follow `plugins/sp/skills/spur-dev/references/migration-guide.md`. Preserve `.spur/config.yaml`,
> `docs/features/`, and `docs/tasks*/`. Use dry runs and CLI-gated writes. Do not run `init --force`,
> replace project workflows wholesale, rewrite historical corpus, or hide verification findings.
> Stop on the first material error and report it with its evidence.
