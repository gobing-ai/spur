---
schema_version: 1
name: superskill install sp does not refresh the installed lib/inline-run.generated.mjs
status: todo
template: feature-impl
created_at: 2026-10-07T20:52:31.358Z
updated_at: "2026-10-07T21:28:24.239Z"

feature_id: A33
priority: P2
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 1.5
---

## 1120. superskill install sp does not refresh the installed lib/inline-run.generated.mjs

### Background

Found 2026-10-07 (knowledge-kit batch), reproduced twice.

The installed inline-runner app bundle is stale and `superskill install sp` does not replace it:

- `/Users/robin/.agents/scripts/lib/inline-run.generated.mjs` — mtime Oct 2, 1,571,294 bytes, **lacks** `readInstalledInventory`.
- The spur checkout's own `plugins/sp/lib/inline-run.generated.mjs` — mtime Oct 6 23:55, 1,620,194 bytes, **has** it.

After `superskill install sp --marketplace …` the installed copy was byte-for-byte unchanged (same mtime and size), so the install does not copy or refresh `lib/` for this plugin. Every `inline-run-setup.mjs` invocation therefore fails with:

```
app.readInstalledInventory is not a function
```

Workaround used throughout the session: pass `--spur-bin "bun …/spur-new/apps/cli/src/index.ts"`, which makes `resolveAppEntry` load the *source* app instead of the stale bundle. That is also what the dispatch-payload contract asks for, so it is survivable — but it means the shipped bundle path is untested by real use and silently rots.

Note the marketplace source itself was moved by the install attempt (from `dir:…/spur-new` to the global node_modules symlink) and had to be restored; the install accomplishes the move even when it does not accomplish the refresh.

**Refine corrections (2026-10-07)**

- **Facts re-verified.** On this machine the installed bundle `~/.agents/scripts/lib/inline-run.generated.mjs` is still the Oct 2 build (1,571,294 bytes). The source `plugins/sp/lib/inline-run.generated.mjs` is newer (1,712,749 bytes, tracked in git). The installed `superskill` is 0.3.35.
- **R1–R3 are superskill-owned and already fixed in superskill source.** Superskill commit `b42961b` ("fix(install): stage plugin sibling lib/ into the shared scripts root", 2026-10-02) stages a plugin's sibling `lib/` into `.agents/scripts/lib` (`packages/core/src/mapper.ts`, `apps/cli/src/commands/install.ts`), with tests. It is **unreleased**: superskill's version is still 0.3.35 and no tag contains the commit. Remaining action, outside this repo: release superskill above 0.3.35 and reinstall `sp`. R1/R2 are removed from this task, and R3 becomes recording the ownership decision.
- **Spur-side work is R4 only.** Plus the R3 doc note. Six mode sites in `plugins/sp/scripts/inline-run-setup.ts` import the app entry and call exports directly (`:129`, `:138`, `:148`, `:167`, `:175`, `:216`). A stale portable bundle surfaces as `app.<fn> is not a function`.
- **Out of scope:** the install moving the marketplace source (`dir:` → global symlink) is superskill behavior; report it to superskill if it recurs on a release that contains b42961b.

### Requirements

- [ ] R1. Every app import in `plugins/sp/scripts/inline-run-setup.ts` goes through one loader that, after `import(entry)`, checks the exports that mode calls are functions. If any is missing, it throws before any call. The error names the bundle path, the missing export(s), the cause (installed sp `lib/` is older than its scripts) and both remedies: reinstall `sp` with a superskill release containing commit b42961b, or pass `--spur-bin <spur checkout>/apps/cli/src/index.ts`.
- [ ] R2. Modes that already report failures as a JSON outcome (`--decide`, setup) keep doing so, with the skew message as the `error`; no mode reaches an `is not a function` TypeError on a stale bundle.
- [ ] R3. The ownership decision is recorded in `plugins/sp/README.md`, next to the existing "install-time output owned by `superskill`" paragraph: superskill stages `lib/` (b42961b), and spur ships the bundle plus the skew guard.
- [ ] R4. The guard respects the plugin standalone contract: only `node:*`/`bun:*`/relative/`import type` imports, enforced by the `sp-plugin-standalone` rule and `bun run plugin-smoke`.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A stale installed bundle fails with a named version-skew error (req: R1, R2, R4)
  Given an installed-layout fixture whose `lib/inline-run.generated.mjs` lacks `readInstalledInventory`
  When `inline-run-setup` runs in setup mode without `--spur-bin`
  Then it exits non-zero, the error names the bundle path, `readInstalledInventory`, "older than its scripts" and both remedies, and no "is not a function" text appears

Scenario: AC2 — A current bundle and the source entry are unaffected (req: R1)
  Given the installed-layout fixture with the current `plugins/sp/lib/inline-run.generated.mjs`, and separately a `--spur-bin` source entry
  When the existing inline-run installed and setup tests run
  Then they pass unchanged

Scenario: AC3 — The install ownership decision is recorded beside the plugin's install docs (req: R3)
  Given `plugins/sp/README.md`
  When the install-time output paragraph is read
  Then it states that superskill stages the plugin `lib/` bundle (commit b42961b) and that the inline scripts fail with a named skew error when the installed bundle is older
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T21:28:09.341Z

- **Ownership:** the copy and refresh of `lib/` is superskill's install contract (Spur ships the bundle; superskill places it). It is fixed upstream in b42961b. Spur does not hand-copy into `~/.agents`, which AGENTS.md forbids ("never hand-maintain generated per-platform adapters").
- **Guard per mode, not a whole-bundle version stamp.** A version stamp would need a build-time manifest and a second source of truth. Checking the exact functions a mode is about to call is exact and costs nothing.
- **Remaining operator action (not a requirement here):** release superskill above 0.3.35 and run `superskill install sp`. Until then `--spur-bin` with the source CLI is the supported workaround, and the new error says so.

### Design

**Single file:** `plugins/sp/scripts/inline-run-setup.ts` (plus the README note).

```ts
/** Import the app entry and fail fast on a stale portable bundle (1120): name the skew, not a TypeError. */
async function loadInlineApp(spurBin: string, required: readonly (keyof InlineApp)[]): Promise<{ app: InlineApp; portable: boolean }> {
    const { entry, portable } = resolveAppEntry(spurBin);
    const app = (await import(entry)) as InlineApp;
    const missing = required.filter((name) => typeof app[name] !== 'function');
    if (missing.length > 0) {
        throw new Error(
            `inline application bundle ${entry} is older than its scripts — missing ${missing.join(', ')}. ` +
                'Reinstall sp with a superskill release that stages lib/ (commit b42961b), or pass ' +
                '--spur-bin <spur checkout>/apps/cli/src/index.ts.',
        );
    }
    return { app, portable };
}
```

Replace each `resolveAppEntry` + `import` pair with `loadInlineApp(spurBin, [...])`, listing exactly the exports that branch calls:
- fingerprint: `runInlineRunFingerprint`
- trace batch: `runInlineRunTraceBatch`
- decide: `runInlineRunDecide`
- persist-out: `runInlineRunPersistOut`
- action/close: `runInlineRunTrace`, `isInlineRunCloseStatus`, `isInlineRunActionStatus`
- setup: `readInstalledInventory`, `runInlineRunSetup`, `writeInlineRunOutcome`

The setup branch (`:216`) has no surrounding catch for the import. It throws to the top-level handler, which already prints the message and exits non-zero. `writeInlineRunOutcome` cannot be used there, because it may be one of the missing exports.

**Invariants:** `resolveAppEntry` is unchanged; source-entry behavior is unchanged (all exports present); no new imports.

### Plan

1. Add AC1 to `plugins/sp/tests/inline-run-installed.test.ts`: reuse its installed-layout fixture, write a stub `lib/inline-run.generated.mjs` exporting everything except `readInstalledInventory`, and assert the skew message. Confirm it fails today with "is not a function".
2. Add `loadInlineApp` and convert the six import sites.
3. Add the ownership paragraph to `plugins/sp/README.md` next to the ADR-032 install-time-output note.
4. Focused: `(cd plugins/sp && bun test tests/inline-run-installed.test.ts tests/inline-run-setup.test.ts)`; then `bun run plugin-smoke` and `spur rule run` for `sp-plugin-standalone`.
5. `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `plugins/sp/scripts/inline-run-setup.ts:45` — `resolveAppEntry`; import sites `:129`, `:138`, `:148`, `:167`, `:175`, `:216`.
- `plugins/sp/tests/inline-run-installed.test.ts` — installed-layout fixture.
- `plugins/sp/README.md` — ADR-032 install-time output owned by superskill.
- Superskill commit `b42961b` (unreleased as of 0.3.35) — stages plugin `lib/` into `.agents/scripts/lib`.
- Feature A33 (release-tooling integrity: verified installs and generated plugin-lib bindings).

### History

- 2026-10-07T21:28:16.277Z backlog → todo (system)

