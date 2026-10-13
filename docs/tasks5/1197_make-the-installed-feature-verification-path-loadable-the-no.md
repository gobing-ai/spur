---
schema_version: 1
name: "Make the installed feature-verification path loadable: the Node twin cannot import the Bun-target inline bundle"
status: backlog
template: standard
created_at: 2026-10-13T19:44:53.347Z
updated_at: "2026-10-13T19:45:29.968Z"

---

## 1197. Make the installed feature-verification path loadable: the Node twin cannot import the Bun-target inline bundle

### Background

The installed feature-verification path cannot load its own bundle under the runtime the workflow selects for it. `config/workflows/feature-verification.yaml` chooses the verifier per resolution layer — `source-repo` runs `feature-verification-steps.ts` with **bun**, `installed` runs `feature-verification-steps.mjs` with **node** — while the generated inline bundle that script imports (`lib/inline-run.generated.mjs`, beside the script's `../lib/`) is built for Bun and imports `bun:sqlite` / `bun:ffi`.

Measured 2026-10-13, in a throwaway git project (`docs/features/T1_*.md`, `.spur/workflows/feature-verification.yaml`) against the global install that `script-root` resolves (`{"mode":"installed","source":"global","dir":"/Users/robin/.agents/scripts/sp"}`):

- `node ~/.agents/scripts/sp/feature-verification-steps.mjs verify --feature-id T1 --run-id probe-n` → `Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]: Only URLs with a scheme in: file, data, and node are supported by the default ESM loader. Received protocol 'bun:'`
- `bun  ~/.agents/scripts/sp/feature-verification-steps.mjs verify --feature-id T1 --run-id probe-b --cmd true` → module loads, the pass proceeds (it then fails only on a missing run row, which is expected outside the engine).
- The workflow reproduces it end to end: `spur workflow run .spur/workflows/feature-verification.yaml --vars '{"featureId":"T1","verificationCmd":"true"}'` ends `verify → failed`; with the same file's runner switched to bun for the probe it reaches `done` and writes the receipt.

So any project whose feature-verification resolves the **global install** (i.e. not a spur source checkout) fails the pass on module load, not on the checks. The Bun-target bundle predates this report: the copy saved before regeneration (`/tmp/inline-run.before.mjs`, the 12:04 build) already contained three `bun:` imports, and `grep -c 'bun:' plugins/sp/lib/inline-run.generated.mjs` is 3 today.

Two candidate remedies, for the owner to choose: (a) the plugin-lib build emits a Node-safe variant for installed mode (shimming or externalizing `bun:sqlite`/`bun:ffi`), or (b) the workflow selects the runtime from the bundle's actual target — bun for the current bundle, node only for a Node-built one — and the install refuses a mismatched pair instead of copying it silently.

### Requirements

- [ ] R1. Reproduce the mismatch from a clean state: after `superskill install sp` from a local checkout, `node <installed>/feature-verification-steps.mjs verify …` fails on module load while `bun …` proceeds, and the workflow's `verify → failed` names the cause rather than a bare failure.
- [ ] R2. Fix the pair so the runtime the workflow selects can load what it selects — either a Node-safe bundle for installed mode or a runtime chosen from the bundle's real target; the install must refuse (or regenerate) a mismatched pair instead of shipping it.
- [ ] R3. One regression check pins the decision: a test or check that fails when the selected runtime cannot import the selected bundle, so a future build-target change cannot silently break the installed path again.

### Acceptance Criteria

- [ ] AC1 — After an install from a local checkout, the verifier the workflow selects runs: the same `verify` invocation succeeds under whichever runtime the definition chose, in a scratch project with a run row. (req: R2)
- [ ] AC2 — The mismatch is detected before it ships: a test or check fails when the selected bundle's imports are not loadable by the selected runtime. (req: R1, R3)
- [ ] AC3 — The failure mode is actionable: a mismatched pair names the bundle, the runtime and the fix instead of surfacing a bare `ERR_UNSUPPORTED_ESM_URL_SCHEME`. (req: R1)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**WHAT.** Make the installed `feature-verification` pass loadable, and make a runtime/bundle mismatch impossible to ship silently. No behaviour change to the pass itself.

**WHERE.** `config/workflows/feature-verification.yaml` (the runner selection in the two `verify` shells: `RUNNER=bun` for the `.ts` twin, `RUNNER=node` for the `.mjs` twin), `scripts/bundle-plugin-lib.ts` (the bundle's target), and the install path that copies `plugins/sp/lib/*.generated.mjs` into `~/.agents/scripts/lib/`.

**Two candidate fixes, pick one and record why.**
- *(a) Emit a Node-safe bundle for installed mode* — externalize or shim `bun:sqlite` / `bun:ffi` behind the same ports the file system seam already uses, so `node <twin>.mjs` works. Cost: a second build target to keep honest; benefit: the documented `source-repo → bun / installed → node` contract keeps its meaning.
- *(b) Select the runtime from the bundle's real target* — detect the target at install (e.g. a marker written by the bundler) and have the definition use bun for a Bun-target bundle. Cost: the definition no longer implies a runtime; benefit: no second bundle, and the mismatch becomes impossible by construction if the install also refuses a pair it cannot classify.

**Anti-patterns.** Do not silently copy a mismatched pair, do not swallow the load error behind a generic "script not found", and do not make the checks optional to get a green pass.

**Evidence required.** In a scratch git project with a run row: the `verify` invocation succeeding under the chosen runtime, and a deliberate mismatch failing with the new named message. Record the commands and their output in `## Testing`.

### Plan

- [ ] R1: reproduce from a clean install (node twin + current bundle fails; bun twin + current bundle proceeds) and keep both outputs as the before-evidence.
- [ ] R2: apply the chosen fix at the build/definition boundary; re-install into the scratch location and re-run the same invocation.
- [ ] R3: add the pin (a check or test that fails on an unloadable pair) and prove it fails when the mismatch is reintroduced.
- [ ] Close out with the measured before/after outputs in `## Testing`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
