---
schema_version: 1
name: Give consuming projects a supported way to sync the sp plugin pipeline scripts (vendoring drifts)
status: backlog
template: issue
created_at: 2026-09-26T00:36:38.467Z
updated_at: "2026-09-26T00:37:29.635Z"
feature_id: I

ac_altitude: task-local
---

## 0959. Give consuming projects a supported way to sync the sp plugin pipeline scripts (vendoring drifts)

### Background

The sp plugin's pipeline scripts are **executed from the consuming project's working tree**, not from the
plugin. Every pipeline step that needs one resolves it project-first with an installed-twin fallback:

```sh
if [ -f plugins/sp/scripts/quality-gate.ts ]; then bun plugins/sp/scripts/quality-gate.ts run;
elif Q="$(superskill script path sp quality-gate.mjs)" && [ -f "$Q" ]; then node "$Q" run;
else echo "quality gate failed closed — quality-gate script not found — run 'superskill install sp'" >&2;
     printf 'FAIL\n' > ".spur/run/$wbs-test-gate.status"; fi
```

(`config/workflows/task-pipeline.yaml`, `test` entry; the same shape appears in
`config/workflows/wrapup-pipeline.yaml` for `wrapup-steps.ts` `metrics` / `feature-transition`.)

So a consuming project must carry a copy of these scripts. **There is no supported way to obtain or
refresh that copy:**

- `spur --help` exposes no plugin / sync / vendor / install noun. `spur self` offers only
  `init`, `maintain`, `migrate`, `serve`, `status`, `help`.
- `superskill install sp` does not resolve in the consuming project:
  `Error: Plugin 'sp' not found. Available: kk`.

Consequence: projects vendor by hand. knowledge-kit has done it **five times** —

| commit | message |
| --- | --- |
| `3e32e642` | chore(sp): vendor pipeline gate/precheck scripts from spur-new plugins/sp |
| `f1744081` | (rebuild vendored bundles) |
| `11605024` | (install feature-verification workflow/steps/bundle) |
| `f3d51034` | chore(sp): re-vendor wrapup step scripts — add route-reason + drift-probe for wrapup-pipeline v5 |
| `e8b07e70` | chore(sp): re-vendor sp pipeline scripts from installed plugin |

— each a manual copy, from **different sources** (first the spur-new dev tree, later "the installed
plugin"), with **no recorded version** and no drift detection. Two of those commits landed twelve minutes
apart, chasing the drift file-group by file-group.

#### The failure this caused (reproduction)

The inline-pipeline driver reference documents proof capture as:

```
bun "$SETUP_SCRIPT" --fingerprint --task-file <task> --feature-file <feature>
```

The project's vendored `plugins/sp/scripts/inline-run-setup.ts` had **zero occurrences of `fingerprint`**
(an older revision). A `/sp:dev-runall --feature D6` batch run therefore had to hand-roll a digest runner
against the engine's `computeProofInputFingerprint`. The documented command did not exist in the
environment the documentation targets, and nothing surfaced that — the run just worked around it.

#### Measured drift

#### Measured inventory (knowledge-kit vs installed plugin 0.3.92, 2026-09-25)

Project-only files (present in the project, absent from the plugin):

```
  feature-dev-precheck.mjs
  feature-dev-precheck.ts
  wrapup-drift-probe.mjs
  wrapup-drift-probe.ts
```

Plugin files absent from the project (7):

```
  feature-verification-steps.mjs
  idea-coverage-check.ts
  inline-run-setup.mjs
  record-feature-sync.mjs
  record-feature-sync.ts
  residual-scan.mjs
  residual-scan.ts
```

Content drift (both sides are files; diff line count):

```
  history-anatomy-cache.mjs                  1738
  pr-reviewing.mjs                           1326
  wrapup-steps.mjs                           759
  batch-preflight.mjs                        645
  workflow-step-profile.mjs                  564
  feature-sync-bounded.mjs                   511
  quality-gate.mjs                           365
  inline-run-setup.ts                        156
  history-anatomy-cache.ts                   156
  inline-pipeline-parity-check.ts            130
  wrapup-steps.ts                            101
  task-size-precheck.ts                      101
  surface-drift-inventory.ts                 99
  quality-gate.ts                            79
  script-contract-check.ts                   60
  idea-handoff.mjs                           49
  verify-answer-lint.ts                      28
  task-evidence-precheck.ts                  20
  validate-flag-contracts.ts                 8
  idea-handoff.ts                            8
  workflow-step-profile.ts                   6
  pr-reviewing.ts                            6
  feature-sync-bounded.ts                    6
```

Reference counts for the absent scripts across `config/workflows/` + `plugins/sp/`:

```
  record-feature-sync              4 files
  residual-scan                    9 files
  feature-verification-steps       5 files
  idea-coverage-check              5 files
  inline-run-setup                 11 files
```

### Requirements

- [ ] R1. A consuming project can obtain and refresh the sp plugin's pipeline scripts with one supported command, resolved from a defined source (the installed plugin), with no manual copying.
- [ ] R2. The command is idempotent and reports per-file outcomes — added / updated / unchanged / project-only-kept. Project-only files are never deleted.
- [ ] R3. The sync records the source revision (plugin version + per-file hash) in a project-visible manifest, and a check mode detects and reports drift against the currently installed plugin.
- [ ] R4. Running the command on an already-current project is a no-op that exits 0.
- [ ] R5. Documentation that instructs an inline host to run `plugins/sp/scripts/inline-run-setup.ts --fingerprint …` either matches what the sync installs or names the sync as its prerequisite.
- [ ] R6. The failure mode when the source cannot be resolved is loud and actionable (naming the resolver that failed), never a silent skip.

### Acceptance Criteria

- [ ] AC1 — One command brings a drifted project to parity with the installed plugin (req: R1)
- [ ] AC2 — The report names every added, updated, unchanged and project-only-kept file (req: R2)
- [ ] AC3 — Project-only files are reported and preserved; the command never deletes them (req: R2)
- [ ] AC4 — The check mode exits non-zero on drift and names the drifted files (req: R3)
- [ ] AC5 — Re-running on a current project is a no-op with exit 0 (req: R4)
- [ ] AC6 — After sync, the documented inline-driver command `inline-run-setup.ts --fingerprint --task-file … --feature-file …` runs successfully (req: R5)
- [ ] AC7 — An unresolvable source fails with a message naming the resolver and the expected plugin (req: R6)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-26T00:37:18.485Z

- **CLOSED — "stop vendoring" is not an option here.** The scripts are executed from the project tree by
  design (project-first resolution in every step shell). Removing the vendored copy without changing the
  pipeline's resolution would move every step onto the installed twin and make the plugin a hard runtime
  dependency of the pipeline. This task provides the sync; **0960** addresses resolution safety.
- **CLOSED — the sync must not prune project-only files.** The project legitimately carries local scripts
  that the plugin does not ship (`feature-dev-precheck.{ts,mjs}`, `wrapup-drift-probe.{ts,mjs}` in
  knowledge-kit). A sync that prunes unknown files would be destructive and would have deleted them.
- **CLOSED — a manifest is required, not optional.** Without a recorded source revision, "drift" is
  undefined (drift against which source, at which version?). The manifest is the anchor for both the report
  and the check mode; it is also what makes the "which revision produced this run?" question answerable.
- **OPEN — the authoritative source (blocks ready).** Installed plugin
  (`node_modules/@gobing-ai/spur/plugins/sp`, 0.3.92) **or** the spur-new dev tree (`plugins/sp`, no version
  field)? The project's own re-vendor history contradicts itself: `e8b07e70` says "from installed plugin",
  but its result matches **spur-new** ( `inline-run-setup.ts` diff = 0 vs spur-new, 156 vs installed).
  Operator decision required before implementation; the answer also determines whether a dev-tree source
  needs a version/revision identifier at all.
- **OPEN — ownership plane (blocks ready).** A `superskill` verb (e.g. `superskill install sp --scripts`,
  or an `emit` verb) or a `spur self` verb (e.g. `spur self sync-plugin-scripts`)? Evidence for
  superskill: it already resolves plugin scripts for the pipeline (`superskill script path sp <name>.mjs`),
  so the emission surface and the resolver would live in one place. Evidence for spur: the pipeline YAML
  that consumes these scripts is Spur's, and `spur self` already owns install-level operations
  (`init` / `migrate`).

### Design

**Direction A (recommended) — a superskill verb reusing the existing resolver.**

```
superskill install sp --scripts [--target <project>] [--check] [--dry-run]
```

- Resolves the source through the *same* path the pipeline already uses (`superskill script path sp …`),
  so there is exactly one source-of-truth resolver in the system rather than a second one that can drift
  from it.
- Writes into `<project>/plugins/sp/scripts/`, printing a per-file report
  (`added` / `updated` / `unchanged` / `project-only-kept`).
- Never deletes a file it does not own; project-only files are reported as kept.
- Writes `plugins/sp/.vendor-manifest.json`: `{ pluginVersion, sourcePath, files: { <name>: <sha256> } }`.
- `--check` compares the manifest and the on-disk files against the resolved source, exits non-zero with
  the drifted-file list — suitable for a project gate or CI step.
- `--dry-run` prints the report without writing.

**Direction B — a `spur self` verb (`spur self sync-plugin-scripts`).** Rejected as primary: it would
duplicate the script resolver that superskill already owns, and two resolvers can disagree — which is the
class of defect this task is fixing. Acceptable only if the ownership decision (open question) puts plugin
emission in Spur.

**Why the manifest, and why hashes.** Version equality alone is too coarse (a dev-tree source has no
version), and mtime is unreliable (a `git checkout` rewrites it). Per-file sha256 against a recorded
source revision is the minimum that makes "is this project current?" a decidable question.

**Out of scope:** changing the pipeline's resolution logic (that is 0960), and re-vendoring any specific
project (a downstream action once the mechanism exists).

### Plan

- [ ] 1. Resolve the two open Q&A decisions (authoritative source; ownership plane) and record them in this task.
- [ ] 2. Implement the sync verb with the per-file report and project-only preservation.
- [ ] 3. Write the vendor manifest (plugin version + source path + per-file sha256) on sync.
- [ ] 4. Implement `--check` (drift detection: non-zero exit + drifted-file list) and `--dry-run`.
- [ ] 5. Tests: fresh sync, idempotent re-run (no-op, exit 0), project-only preservation, drift detection,
      unresolvable source (loud failure), and — end to end — the documented inline-driver command working
      in a synced project.
- [ ] 6. Update the inline-pipeline driver reference so the proof-capture command and the sync prerequisite
      agree.
- [ ] 7. Document the sync in the sp plugin README (`plugins/sp/README.md`).

### Root Cause

The pipeline **executes** plugin scripts from the consuming project's tree, but the plugin provides **no
supported surface to emit them into that tree**, and no version anchor for what was emitted. Vendoring is
therefore manual, opportunistic (whichever tree the operator had at hand), unversioned and unchecked.

Everything measured above follows from that: five hand-vendor commits from two different sources, 23 files
drifted from the installed plugin, 7 plugin scripts absent, and a documented driver command
(`inline-run-setup.ts --fingerprint`) missing from the environment the documentation targets. The missing
flag is a symptom; the absent sync surface is the cause.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: `docs/features/I_sp-plugin.md` ("sp plugin")
- Related feature: `docs/features/I3_harness-surface-reconciliation-plugins-sp-and-workflow-yaml-against-the-live-spur-cli.md` (done — reconciled the CLI surface, not script distribution)
- Sibling task: **0960** — pipeline script resolution must be revision-safe (this task supplies the sync; 0960 removes the silent mixed-revision execution)
- Resolution evidence: `config/workflows/task-pipeline.yaml` (`test` entry, quality-gate branch), `config/workflows/wrapup-pipeline.yaml` (`metrics`, `feature-transition`)
- Consumer evidence: knowledge-kit commits `3e32e642`, `f1744081`, `11605024`, `f3d51034`, `e8b07e70`
- Reproduction: the `/sp:dev-runall --feature D6` batch run (knowledge-kit, 2026-09-25) — hand-rolled proof digest because the vendored `inline-run-setup.ts` lacked `--fingerprint`

### History

- 2026-09-26T00:37:29.635Z todo → backlog (system)

