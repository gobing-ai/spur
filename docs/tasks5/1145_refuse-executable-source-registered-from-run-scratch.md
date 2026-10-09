---
schema_version: 1
name: Refuse executable source registered from run scratch
status: todo
template: standard
created_at: 2026-10-09T16:51:46.326Z
updated_at: "2026-10-09T16:52:24.352Z"

ac_numbering: task-local
ac_altitude: task-local
---

## 1145. Refuse executable source registered from run scratch

### Background

ADR-131, as amended on 2026-10-09, states the consumer invariant for run scratch: `.spur/run/` may be
absent in any later run, so no tracked source file, document or task record relies on it, and
**executable source (hooks, scripts, libraries) never lives under `.spur/run/`**.

Found live in this repository on 2026-10-09: three TypeScript implementations sitting in run scratch —
`.spur/run/stop-hook-proposed-checkable.ts` (640 lines), `.spur/run/stop-hook-proposed.ts`, and
`.spur/run/stop-hook-original.ts` — together with their harness plumbing
(`.spur/run/stop-hook-proposal-check.ts`, `.spur/run/hook-stop-diagnose.ts`) and captured outputs
(`stop-hook-diagnosis.json`, `stop-hook-codex-claim.stdout.json`). The checkable variant executed
during this session and blocked a driver message with its own issue list.

Task 1141 R5 names this class as the one a corpus rule cannot cover: `.spur/run` is gitignored
(`.gitignore:133`), so the rule engine — which reads tracked files — cannot see it. The executable
source needs a runtime guard at registration instead.

### Requirements

- [ ] R1. A registration or resolution that points at executable source under `.spur/run/` is refused with a named error that states the path and the durable home for that kind of artifact. Run-scoped *data* under `.spur/run/` is unaffected, since scratch data is legitimate there.
- [ ] R2. The refusal happens at registration or resolution time, before the hook or script executes, so an operator learns about it without a side effect having run.
- [ ] R3. The guard covers every surface that can register executable source — hook configuration loading and plugin script resolution at minimum — rather than one call site, and it names the class (`hook`, `script`, `lib`) in the error.
- [ ] R4. Canonical locations keep working unchanged: tracked plugin paths under `plugins/sp`, the `.spur/plugins` symlink, and installed twins. The existing hook and script test suites stay green, which is the evidence for this requirement.
- [ ] R5. The existing out-of-scratch sources are relocated through their owning surface — a tracked location, chosen by the hook's owner, then registered from there — and their behavior is preserved. A bulk filesystem move is not the fix, because it would leave the registration pointing into scratch.
- [ ] R6. The guard's failure message tells the operator what to do next: move the source to a tracked owner for that artifact class and register it from there.

### Acceptance Criteria

```gherkin
Scenario: AC1 — executable source in scratch is refused at registration (req: R1, R2)
  Given a hook whose command resolves to a path under .spur/run
  When the hook configuration loads
  Then registration fails with a named error containing the path
  And the hook command never ran

Scenario: AC2 — scratch data stays legal (req: R1)
  Given a workflow stage that writes .spur/run/<wbs>-test-gate.status
  When it runs
  Then it succeeds unchanged
  And no guard fires on the data path

Scenario: AC3 — every registering surface is covered (req: R3)
  Given the hook loader and the plugin script resolver
  When each resolves a target under .spur/run
  Then both refuse and the error names the artifact class

Scenario: AC4 — canonical locations are unaffected (req: R4)
  Given the existing hook and script suites over tracked plugin paths, the .spur/plugins symlink and installed twins
  When they run
  Then they pass unchanged

Scenario: AC5 — the existing scratch sources are relocated, not moved (req: R5)
  Given the three stop-hook implementations currently under .spur/run
  Then they live in a tracked location owned by the hook's surface
  And their registration points at that location
  And their behavior is unchanged
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T16:52:04.782Z

- **Why a runtime guard when the amended ADR already forbids it?** A rule cannot see a gitignored
  directory (task 1141 R5 records that limitation), so without a runtime guard the prohibition has no
  enforcement on the one surface it most needs.
- **Why not just delete the scratch sources?** They are working material with no tracked
  registration. Deleting them discards work; the defect is their location, and the fix is relocation
  plus a guard that keeps the next one out.
- **Would this block a legitimate workflow that generates a script at run time?** That case does not
  exist today; if it appears, the owning surface can add an explicit, named allowance, which is
  preferable to leaving the class unguarded.
- **Deferred:** the operator decision on the stop hook's tracked home, and any hook-registration
  feature beyond the refusal.

### Design

**Where the guard goes.** At the resolution seam each surface already uses: the hook configuration
loader when it resolves a hook's command or file target, and the plugin script resolver when it maps a
script name to a path. One shared predicate ("is this executable target under the run-scratch root")
keeps the rule identical across surfaces; each caller adds its own artifact-class label and remedy
text.

**Why resolution and not execution.** Refusing at execution still runs the surrounding machinery and
may report the failure as an execution error, which reads like a broken hook rather than a misplaced
file. Resolution is the moment the path is known and nothing has happened yet.

**Data versus source.** The predicate keys on the artifact class being registered (hook, script,
lib), not on the directory alone. `.spur/run/` legitimately holds status files, decision files and
captured JSON, and a guard keyed on the path alone would break the pipeline it is meant to protect.
This is the same distinction task 1141 makes on the citation side.

**Relocation of the existing sources.** The three stop-hook files are the author's working material
for a hook that is not registered in any tracked configuration (no `config/hooks*` or `.pi/hooks*`
exists). Relocation therefore means: decide the owning tracked home with the operator, move the
implementation there, and point any registration at it. Until that decision, the guard's own
registration path is empty, which is why R5 is a requirement rather than an implicit step.

**Impacted surfaces.** Hook configuration loading, plugin script resolution, and the plugin's
standalone contract tests. No schema or CLI surface change.

### Plan

1. Locate the hook command/file resolution seam and the plugin script resolution seam; confirm both
   compute an absolute path before use.
2. Add the shared scratch-source predicate plus per-surface class labels and remedies.
3. Write the AC1-AC3 cases first against fixtures that register out-of-scratch targets; the
   refusals fail before the predicate exists.
4. Run the existing hook and plugin script suites to prove AC4 (canonical paths unaffected), then run
   a real pipeline stage writing `.spur/run/` data to prove AC2.
5. Take the relocation decision for the three stop-hook sources with the operator, move them, and
   register from the tracked location; record the before/after paths in Testing.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-09T16:52:24.352Z backlog → todo (system)

