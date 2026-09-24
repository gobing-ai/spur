---
status: proposed-design
feature: F96
adr: ADR-071, ADR-076
updated_at: 2026-09-24
---

# Task residual sweep

Feature F96. Leftovers a task run leaves behind become verification evidence, so
`/sp:dev-refine` → `/sp:dev-run` (or `/sp:dev-runall`) → `/sp:dev-wrap` needs no manual
"anything remained?" prompt.

## Why this shape

Task 0596 once added a post-PASS `residual-sweep` state in `task-pipeline2.yaml`. ADR-076 deleted
it because it added a model query to every run. `workflow-composition-contract.md` left the
alternative open: read-only detection or bounded remediation followed by the full proof chain.
This design takes that path:

- **No new pipeline state and no new model query on the clean path.** The scan is a
  deterministic script. A clean scan costs only a file read and a `git diff`.
- **Detection is observe-only (ADR-071).** The scan writes only under `.spur/run/`. It runs inside
  `verify` after the digest bracket, so it never invalidates proof.
- **Remediation reuses the existing loop.** A blocking residual downgrades PASS to PARTIAL. The
  existing `verify → test-fix` transition, bounded by `qualityGateMaxFixAttempts`, repairs it and
  re-enters `test-recheck → review → verify` on a fresh digest.
- **Mutations happen after proof.** Follow-up filing and staging cleanup run on `done` entry.
  `record` cannot host them: its first action (`run.artifact`) registers `<wbs>-verdict.json`,
  and creating a task file before the done transition would change the tree the proof covers.

## Pipeline flow

```text
precheck ─(+ write .spur/run/<wbs>-base.sha)→ implement → test → review → verify
verify:  agent answer → answer-lint → task verdict → residual-scan fold → proof bind (jq)
         ├─ PASS (no blocking)          → record → done (settle: file follow-ups, clean /tmp/<wbs>-*)
         ├─ PARTIAL, attempts < max     → test-fix (residuals in findings + gate log) → recheck → review → verify
         └─ PARTIAL, attempts exhausted → failed (+ residual-report.md, recovery line); task stays wip
```

## Scanner

`plugins/sp/scripts/residual-scan.ts`, with an `.mjs` twin resolved through
`superskill script path sp residual-scan.mjs`. It follows the plugin standalone contract
(`node:`/`bun:` imports only).

| Mode | Caller | Effect |
| --- | --- | --- |
| `scan <wbs>` | pipeline `verify`, `/sp:dev-verify`, `/sp:dev-verifyall` | Writes `.spur/run/<wbs>-residuals.json` |
| `fold <wbs>` | same, after `spur task verdict` | Downgrades PASS→PARTIAL in `<wbs>-verdict.json` when blocking > 0; adds a `residual-sweep` check; appends blocking anchors to `<wbs>-test-gate.findings` |
| `settle <wbs>` | pipeline `done` entry, `/sp:dev-verify --next` after its done transition | Files one follow-up task for deferrables (`spur task create --feature <f> --skip-ready`, dedup guard) and removes `/tmp/<wbs>-*` files |
| `report <wbs>` | `failed` state entry | No-op unless the verdict carries a failing `residual-sweep` check; otherwise writes `.spur/run/<wbs>-residual-report.md` and prints the recovery line |

### Categories and classification

| Category | Source | Default class |
| --- | --- | --- |
| `review-finding` | Rows of any `### Review` table whose header has a `Priority` column, priority cell matching `^P[1-4]` and a finding other than `none`/`—` (the current Review; `review` rewrites it on every pass) | P1/P2/P3 `blocking`; P4 `advisory` |
| `diff-marker` | `TODO\|FIXME\|XXX\|HACK` on lines **added** in `git diff $(cat <wbs>-base.sha)` (committed and uncommitted), excluding `docs/tasks*/` | `blocking` |
| `unchecked-box` | `- [ ]` lines in the task file | `blocking` |
| `staging-residue` | files matching `/tmp/<wbs>-*` | `housekeeping` |

Deferral: the `test-fix` hop (`/sp:dev-fixall`) may write
`.spur/run/<wbs>-residual-deferrals.json` entries `{id, reason}` for items it judges outside the
task's reach, such as a post-merge regeneration. The scanner re-classifies a covered item as
`deferrable` **only** when it is a P3 `review-finding` or a `diff-marker`, and the reason is
non-empty. P1/P2 findings and unchecked boxes are never deferrable. Under `--auto` nothing else
waives a blocking item.

A missing `base.sha` (standalone verify outside a pipeline run) marks `diff-marker` as
`not-scanned` in the artifact. The scanner does not guess a base.

### Artifact

```json
{
  "wbs": "0947",
  "base": "70fe0a953",
  "scanned": { "review-finding": true, "diff-marker": true, "unchecked-box": true, "staging-residue": true },
  "items": [
    { "id": "review-finding:3f9c2a1b", "category": "review-finding", "class": "blocking", "priority": "P3",
      "location": "plugins/sp/lib/idea-handoff.generated.mjs", "text": "Generated-bundle determinism…" }
  ],
  "counts": { "blocking": 1, "deferrable": 0, "advisory": 4, "housekeeping": 0 }
}
```

Item id = `<category>:<first 8 hex of sha256(location + normalized text)>`, so an id survives
re-scans while unrelated items get fixed, and a deferral entry written by the fix hop still
matches on the next scan.

Classes: `blocking` downgrades PASS; `deferrable` becomes a follow-up task at `record`;
`advisory` (P4) appears only in the verdict's `residual-sweep` check evidence, with no task and no
downgrade; `housekeeping` is cleaned on `done` entry.

`settle` is idempotent. It records the follow-up WBS as `followUp` in `<wbs>-residuals.json`.
The follow-up's Background names the source task and every deferred item with its reason. The
source side is covered by the verdict's `residual-sweep` evidence, which lists the deferred ids
before registration. `settle` failures are printed with a re-run command (`residual-scan settle
<wbs>`); they never demote a certified `done`.

## Terminal path for unfixable leftovers

| Outcome | Task status | Artifacts | Next step |
| --- | --- | --- | --- |
| Clean or deferrable-only | `done` | deferred ids in the verdict's `residual-sweep` check; follow-up WBS in `<wbs>-residuals.json` | `/sp:dev-wrap <wbs>` |
| Blocking after budget | `wip` (run `failed`) | `<wbs>-residual-report.md`, verdict with failing `residual-sweep` check | Fix the listed items, then `/sp:dev-run <wbs>` (fresh budget: `quality-gate.ts run` resets the counter) |

Next-router row **C6** (A4/A5 when `<wbs>-verdict.json` carries a failing `residual-sweep`
check): HITL STOP that prints the report and the recovery command. It never starts another
automatic fix loop, because the bounded loop has already failed twice.

`/sp:dev-wrap` still refuses tasks that are not `done`. That refusal is correct and stays.
`/sp:dev-runall --wrap` passes only the `done` subset to one batch wrap and lists each excluded
task with its status and recovery command. If the subset is empty, it skips the wrap with a
reason instead of failing.

## Surfaces changed

| Surface | Change |
| --- | --- |
| `config/workflows/task-pipeline.yaml` | precheck writes `base.sha`; verify adds `scan`+`fold` before the jq proof bind; `done` entry adds `settle`; `failed` entry adds `report` |
| `plugins/sp/commands/dev-verify.md`, `dev-verifyall.md` | Residual scan + fold under every `--fix` mode; `settle` only on the `--next` done transition |
| `plugins/sp/commands/dev-fixall.md` | Residual findings as fix targets; the deferral-file contract |
| `plugins/sp/commands/dev-runall.md` | Done-subset batch wrap; remove the per-task `--wrap` contradiction |
| `plugins/sp/skills/next-router/references/routing-table.md` | Row C6 |
| `docs/help/how_to_use_dev_slash_commands_for_daily_software_development.md` | Residual behaviour in the per-task and batch sections |
| `docs/00_ADR.md` | ADR-071 note: residual scan is observe-only evidence; no ADR-076 cost regression |

No public `spur` noun or verb changes. Follow-up filing uses the existing
`spur task create --feature --skip-ready`.
