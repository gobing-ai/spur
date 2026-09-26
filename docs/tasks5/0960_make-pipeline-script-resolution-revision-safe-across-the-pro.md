---
schema_version: 1
name: Make pipeline script resolution revision-safe across the project copy and the installed twin
status: backlog
template: issue
created_at: 2026-09-26T00:36:38.726Z
updated_at: "2026-09-26T00:37:29.824Z"
feature_id: I

ac_altitude: task-local
---

## 0960. Make pipeline script resolution revision-safe across the project copy and the installed twin

### Background

Each pipeline step resolves its own script with a two-branch probe — project copy first, installed twin
second, fail closed third. Verified in `config/workflows/task-pipeline.yaml` (`test` entry):

```sh
if [ -f plugins/sp/scripts/quality-gate.ts ]; then bun plugins/sp/scripts/quality-gate.ts run;
elif Q="$(superskill script path sp quality-gate.mjs)" && [ -f "$Q" ]; then node "$Q" run;
else echo "quality gate failed closed — quality-gate script not found — run 'superskill install sp'" >&2;
     printf 'FAIL\n' > ".spur/run/$wbs-test-gate.status"; fi
```

and in `config/workflows/wrapup-pipeline.yaml` for `wrapup-steps.ts` `metrics` and `feature-transition`.
The same shape is repeated across the pipeline surface.

Because a project's vendored set can be **incomplete and drifted at the same time**, one run executes a
**mix of revisions**: a step whose script is vendored runs the project's revision; a step whose script is
absent runs the installed plugin's revision. Nothing compares the two, and nothing warns.

Measured on knowledge-kit (inventory in 0959), the absent scripts and how widely they are referenced:

```
  residual-scan                 9 files
  inline-run-setup             11 files
  feature-verification-steps    5 files
  idea-coverage-check           5 files
  record-feature-sync           4 files
```

So `residual-scan`, `record-feature-sync` and `feature-verification-steps` steps run the **installed**
revision while `quality-gate`, `task-size-precheck`, `task-evidence-precheck` and `wrapup-steps` run the
**project's** vendored revision — in the same run, on the same evidence chain. Those scripts are precisely
the ones that write and read the pipeline's cross-step artifacts (status files, verdict artifacts, proof
digests), which is where a revision skew is most damaging and least visible: the run does not fail, it
produces a result that no single revision produced.

Additional fragility: the twin branch depends on `superskill script path sp <name>.mjs` resolving. In
knowledge-kit `superskill install sp` reports `Plugin 'sp' not found`, so the twin branch's availability is
unverified there; when both branches miss, the step writes a per-step `FAIL` status (fail-closed — correct)
but the run continues to the next step rather than aborting the run.

### Requirements

- [ ] R1. A run resolves all sp-plugin scripts from a single root, or fails loudly before executing any step when it cannot.
- [ ] R2. When the project copy and the installed twin disagree in content or revision, the run warns or fails with the drifted-file list — it never silently mixes revisions.
- [ ] R3. The resolution root and the resolved plugin revision are recorded in the run's evidence, so a run's artifacts name the revision that produced them.
- [ ] R4. Fail-closed behaviour is preserved: a missing script never silently skips a step.
- [ ] R5. A project with no vendored scripts at all still runs (resolving entirely from the installed twin) and records that fact — the change must not require a full re-vendor to be safe.
- [ ] R6. The consistency check is bounded: a run-start resolution pass, not a per-step content hash of every script.

### Acceptance Criteria

- [ ] AC1 — A run with a partial or mismatched vendored set warns or fails naming the affected files (req: R2)
- [ ] AC2 — A run with a consistent set proceeds and records the resolution root and revision (req: R1, R3)
- [ ] AC3 — A missing script still produces the per-step fail-closed status (req: R4)
- [ ] AC4 — A project with no vendored scripts resolves entirely from the installed twin and records that root (req: R5)
- [ ] AC5 — The check adds one bounded resolution pass at run start, with no per-step hashing (req: R6)
- [ ] AC6 — The failure message points at the sync remedy (0959) by name (req: R1)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-26T00:37:19.957Z

- **CLOSED — fail-closed per step is correct and stays.** The defect is *silence*, not the fallback. A
  missing script must keep producing a loud per-step failure; this task adds agreement, it does not relax
  the guard.
- **CLOSED — this task does not implement the sync.** 0959 provides the mechanism to make a project
  current; 0960 makes resolution safe *whether or not* the sync has run. They are independent and can land
  in either order; neither is a prerequisite for the other.
- **CLOSED — the check must stay cheap.** The pipeline already pays many shell hops per run; a per-step
  content hash of every script would add cost to the hot path. One resolution pass at run start, comparing
  the project set against the resolved source once, is the budget.
- **CLOSED — do not abort on a per-step missing script.** Aborting the run when one optional script is
  absent would turn a partial install into a total outage. The run-level concern is *revision agreement*;
  the step-level concern stays *fail closed*.
- **OPEN — warn vs fail on mismatch (blocks ready).** Warning keeps existing runs working while a project is
  mid-vendor; failing enforces agreement but breaks any project with a partially vendored set until it is
  synced. Suggested default: **warn with the file list, plus a strict mode** that fails, so the gate can be
  tightened per project. Operator decision required.

### Design

**Direction A (recommended) — one resolution pass at run start, threaded to the steps.**

- A single run-start action resolves the script root: the project's `plugins/sp/scripts` when present,
  else the installed twin root, else fail loudly naming the resolver.
- The same pass compares the project set against the resolved source once (via 0959's manifest when
  available, falling back to a content comparison of the files that exist on both sides) and emits the
  drift condition as a run-scoped status file.
- Steps stop probing independently and call `$SCRIPT_ROOT/<name>`; the per-step shell keeps only its
  fail-closed branch for a genuinely missing file.
- The resolved root + plugin revision are written into the run's evidence (run-scoped artifact + the run
  log line), so "which revision produced this?" is answerable from the run alone.

**Direction B — keep per-step resolution, add a run-start preflight.** Lower blast radius (no step-shell
rewrite), but leaves the two-branch probe duplicated across ~30 step shells and therefore leaves the same
defect reachable by any future step that forgets the preflight. Acceptable as a first increment if the
step-shell rewrite in Direction A is judged too wide; the preflight logic is identical either way.

**Migration path.** With R5/AC4, a project that has never vendored scripts resolves entirely from the
installed twin and records that root — so the change is safe to land before any project syncs. The strict
mode (open question) is what a project opts into once 0959 has made it current.

**Out of scope:** emitting scripts into a project (0959), and any change to what the scripts do.

### Plan

- [ ] 1. Decide warn-vs-fail (open Q&A question) and record the decision here.
- [ ] 2. Choose Direction A or B and record the rationale.
- [ ] 3. Implement the run-start resolution + consistency pass (reusing 0959's manifest when present).
- [ ] 4. Thread the resolved root and revision into the step shells; remove the duplicated probe where the
      chosen direction allows.
- [ ] 5. Record the resolution root + plugin revision in run evidence.
- [ ] 6. Tests: consistent set (proceed + record), partial set (drift reported), content mismatch (drift
      reported), no vendored set (twin root recorded), missing script (per-step fail-closed preserved).
- [ ] 7. Point the failure message at 0959's sync verb.

### Root Cause

Script resolution is **decentralized into every step's shell**, each with its own project-first /
installed-twin probe, and **nothing asserts that the two branches describe the same plugin revision**.
Combined with a vendored set that is simultaneously incomplete and drifted (7 scripts absent, 23 drifted),
a run silently becomes a multi-revision execution whose cross-step artifacts are written and read by
different code revisions.

The missing version anchor is what makes the condition undetectable: without a recorded revision, "these
two files are from different plugin versions" is not a question the pipeline can ask.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: `docs/features/I_sp-plugin.md` ("sp plugin")
- Sibling task: **0959** — the supported sync mechanism (this task makes resolution safe regardless of whether the sync has run)
- Resolution evidence: `config/workflows/task-pipeline.yaml` (`test` entry), `config/workflows/wrapup-pipeline.yaml` (`metrics`, `feature-transition`)
- Inventory and reference counts: 0959 Background (measured 2026-09-25, knowledge-kit vs installed plugin 0.3.92)
- Consumer evidence: knowledge-kit `/sp:dev-runall --feature D6` batch run (2026-09-25) — the run whose record/residual steps would have resolved from the installed twin while its gate steps resolved from the project copy

### History

- 2026-09-26T00:37:29.824Z todo → backlog (system)

