---
schema_version: 1
name: "antigravity-cli shim cannot satisfy expectFile stages: print mode auto-denies write_file without --dangerously-skip-permissions or a permissions.allow rule"
status: todo
template: issue
created_at: 2026-08-27T15:39:39.946Z
updated_at: "2026-08-27T17:27:02.692Z"
feature_id: B
---

## 0689. antigravity-cli shim cannot satisfy expectFile stages: print mode auto-denies write_file without --dangerously-skip-permissions or a permissions.allow rule

### Background
Root cause refined during 0687 verification (2026-08-27, third cycle). Two distinct defects were
found and FIXED in this pass; one reliability defect remains.

FIXED (validated via `bun link` against ts-libs, and in-repo for the action):
1. **Shim lacked a headless permission affordance** — `antigravityCliShim.getPromptCommand`
   (ts-libs `packages/ai-runner/src/agents/shims.ts`) now emits
   `--dangerously-skip-permissions` in print mode: agy auto-denies any tool that would prompt
   (verified: the allow-rule path in `~/.gemini/antigravity-cli/settings.json` is ineffective in
   1.1.22 — the rule loads but headless still auto-denies). Probe before/after: write denied →
   write succeeds.
2. **Headless agy re-roots relative file-tool paths to its scratch dir** regardless of process
   cwd — `--add-dir <workspace>` re-roots them (verified). Additionally
   `packages/app/src/workflow/actions/agent-run.ts` now appends the resolved ABSOLUTE path of
   `expectFile`/`answerFile` to the dispatched prompt, so even a scratch-rooted executor writes
   where the post-exit guard checks. Two regression tests added.

REMAINING (this task's core): **agy print-mode tool-call flakiness on multi-step prompts.** With
both fixes in place, 4 consecutive `spur workflow run history-anatomy.yaml --vars '{"agent":"inline"}'`
runs each exited 0 at resolve-scope having narrated "now let me write the selector" and then NOT
invoked the write tool (2 wrote to scratch pre-add-dir; post-fix 0 wrote anywhere). Simple
one-line probes write reliably; multi-step validation prompts do not. This is model/CLI
reliability, not flags — a real dispatch probe with a multi-step write prompt is the regression
test that must pass.

Also: `agy models` lists `claude-opus-4-6-thinking` (dashes); the operator's `agy-opus` executor
pinned `claude-opus-4.6-thinking` (dots) — stale pin, fixed in `~/.config/spur/config.yaml:163`
(backup `~/.config/spur/config.yaml.bak-0687`).
### Requirements
**R1 — Headless write permission for expectFile stages, cross-executor.** Verified during 0687
verify (2026-08-27): `claude -p` refuses `.spur/run/**` writes ("write blocked pending your
permission grant") and exits 0; `agy -p` auto-denies without `--dangerously-skip-permissions`
(fixed in the shim) and is additionally flaky at tool-calls on multi-step prompts; `pi -p`
writes fine. Design a uniform policy — per-shim headless flags (e.g. claude
`--dangerously-skip-permissions` or `--permission-mode acceptEdits --allowedTools Edit,Write`,
agy already done) or an operator-documented per-CLI permission grant — so EVERY executor's
headless dispatch can satisfy `expectFile`. State the trust tradeoff in the Design. This is the
release-blocking half of 0687's AC3/AC4/AC9.

**R2 — Real-dispatch regression probe.** The `agent doctor` version probe reports `usable: true`
for executors that then fail every expectFile stage. A doctor (or ai-runner) probe must exercise
a real multi-step write dispatch, not just `--version`, for any executor that declares write
capability. See `spur agent doctor` caveat already noted in sp:dogfood-testing (0687 R12).
### Acceptance Criteria
**Scenario 1 — every agy print-mode argv carries the permission affordance.**
- **Given** the `antigravity-cli` shim from `@gobing-ai/ts-ai-runner`
- **When** `getPromptCommand` is called on each of the four paths (fresh; `sessionDir` only;
  `sessionId` + `sessionDir`; `continue` only)
- **Then** every returned `args` array contains the chosen affordance
  (`--dangerously-skip-permissions`, or `--mode accept-edits` if Plan step 1 narrowed it)
- **And** each array matches the frozen argv table in `### Design` exactly, including flag position
- **And** `packages/ai-runner/tests/agents/shims.test.ts` fails if the affordance is removed.

**Scenario 2 — an expectFile stage driven by an agy executor now passes.**
- **Given** Spur resolving the published `@gobing-ai/ts-ai-runner` containing the fix (both root
  `package.json` pin blocks updated, `bun update` run)
- **And** `"write_file(**)"` absent from `~/.gemini/antigravity-cli/settings.json` `permissions.allow`
- **When** an agy-backed executor runs an `agent.run` stage carrying `expectFile` (e.g.
  `history-anatomy` at `resolve-scope`)
- **Then** the expected file exists after the dispatch and the stage reports `ok: true`
- **And** the run advances past that stage instead of failing with
  `agent.run (inline) exited 0 but expected file is absent: …`
- **And** the after-evidence is recorded in `### Testing` next to run
  `4f55c237-e808-457d-9cdf-5fb5be128906`'s failing `resolve-scope` row.

**Scenario 3 — the fix ships as a released dependency.**
- **Given** the shim change committed in `~/xprojects/ts-libs`
- **When** the lockstep version is bumped and published, and Spur's pins are moved
- **Then** `rg '"version"' node_modules/@gobing-ai/ts-ai-runner/package.json` in Spur reports the new
  version, with no `bun link` symlink in `node_modules/@gobing-ai/ts-ai-runner`
- **And** `CHANGELOG.md` carries a `### Fixed` bullet naming the symptom and the flag
- **And** the shim comment states the trust assumption and that this is the only shim granting
  blanket tool approval.

**Scenario 4 — the operator-local remedy is documented as not-the-fix.**
- **Given** `plugins/sp/skills/dogfood-testing/SKILL.md`
- **When** the "Engine-driven testees under a sandboxed session" section is read
- **Then** it states that a `permissions.allow` `write_file(**)` entry is an operator-local unblock
  rather than the shipped fix, and that it masks shim regressions in local end-to-end runs.

**Checklist — gates.**
- [ ] ts-libs `bun run check` green
- [ ] Spur `bun run autofix && bun run spur-check` green
- [ ] `git status` intentional only in both repos
### Q&A
**Q: Does (a) really "match how other CLI shims trust the dispatch sandbox", as R1 originally said?**
No — checked 2026-08-27. `rg 'dangerously|yolo|skip-permissions|autoApprove|approval'` over
`packages/ai-runner/src` returns zero hits; no shim passes a permission flag today. agy becomes the
first. The premise is corrected in `### Background` / `### Design`; (a) still wins, on portability
rather than precedent.

**Q: Why not remedy (b), the `permissions.allow` rule?** It is per-machine and untracked. It is
already applied on this machine (`write_file(**)`, added 2026-08-27T09:03, `settings.json.bak-0687`
sibling), which is exactly why a broken shim can look green here and fail on every other machine and
in CI. Kept as an operator convenience and documented as such (R4); not the fix.

**Q: Why is `--mode accept-edits` a probe rather than the decision?** It is narrower and would be
preferred if it works, but nothing verified that it suppresses the print-mode `write_file` denial —
agy could not be reached from the refine session (TLS verification failure against
`daily-cloudcode-pa.googleapis.com` behind the session proxy). Freezing a design on an unverified
premise is worse than freezing the broader flag with one cheap probe in front of it. Decision rule
is in `### Design`; the default when the probe cannot run is `--dangerously-skip-permissions`.

**Q: Why not pair the flag with agy's `--sandbox`?** `--sandbox` enables terminal restrictions and
would break dispatches that legitimately shell out (the pipeline's whole point). Rejected. Note that
agy's own `enableTerminalSandbox` setting already applies terminal restrictions independently of the
permission flag.

**Q: Do the other shims have the same gap?** Almost certainly — `claude -p`, `codex exec`, `pi`,
`omp`, `grok`, `hermes`, `opencode` all dispatch headless with no permission affordance, and any of
them backing an `expectFile` stage would fail the same way. Deliberately **not** fixed here (see
Out of scope). Worth a follow-up task once (a) is proven on agy; deferred, owner: Robin.

**Q: Should the flag be opt-in via config?** No. It would vary for no one — a knob for a constant.
Always on for this shim, off (untouched) for every other.
### Design
**Decision: remedy (a) — the shim emits a print-mode permission flag.** Frozen below. One bounded
probe (Plan step 1) may narrow the flag to `--mode accept-edits`; nothing else in this design is open.

**WHY (a), and why the task's original parenthetical was wrong.** R1's draft said (a) "matches how
other CLI shims trust the dispatch sandbox". Checked against the tree — it does not.
`rg 'dangerously|yolo|skip-permissions|autoApprove|approval' packages/ai-runner/src` returns **zero
hits**: no shim passes any permission flag today. agy will be the **first**. The real reasons for (a):

1. **(b) is not shippable.** It is per-machine, untracked, invisible to CI and to every other
   operator. It is already applied on this machine (`### Background`) — which is precisely how a
   broken shim can look green locally and fail everywhere else. That failure mode disqualifies it as
   *the* fix; it survives only as an operator convenience (R4).
2. **The shim is the only seam.** `AgentSpec` (`packages/ai-runner/src/agent-spec.ts:12-26`) has no
   argv field, and `buildAgentCommand` (`packages/ai-runner/src/ai-runner.ts:277`) is the single
   call site for both the one-shot and team-mode paths. Adding a passthrough would be new API for
   one flag — explicitly out of scope. **No new API surface.**
3. **agy names the remedies itself.** Its headless denial text offers exactly
   `--dangerously-skip-permissions` or a `permissions.allow` rule; (a) is the shippable half.

**Security tradeoff (state it, don't soften it).** `--dangerously-skip-permissions` auto-approves
*all* tool permission requests, not just `write_file` — so every `agy` dispatch (`spur agent run`,
workflow `agent.run`, team mode) runs with blanket tool approval. Bounding facts, not excuses: the
dispatch is operator-initiated, headless, and workspace-scoped (`cwd` = `context.workdir`); agy's own
`enableTerminalSandbox` setting applies terminal restrictions independently of this flag; and the
prompt is Spur-authored, not third-party. This is a genuine privilege widening and the shim comment
must say so.

**WHERE — frozen names and positions.**

`packages/ai-runner/src/agents/shims.ts`, `antigravityCliShim.getPromptCommand`, appended **last**,
after the `--model` push (argv order is asserted by exact `toEqual`, so position is part of the
contract):

```ts
if (options.model !== undefined) args.push('--model', options.model);
// Print mode cannot prompt for tool permissions, so agy auto-denies `write_file`
// and any expectFile stage fails with the agent exiting 0. Spur dispatches are
// operator-initiated, headless, and workspace-scoped — trust that boundary.
// This is the only shim that grants blanket tool approval (spur task 0689).
args.push('--dangerously-skip-permissions');
return { command: 'agy', args };
```

Resulting frozen argv (all four paths):

| path | argv |
| --- | --- |
| fresh | `['-p', '', '--dangerously-skip-permissions']` |
| sessionDir only | `['-p', '', '--dangerously-skip-permissions']` |
| sessionId + sessionDir | `['-p', '', '--conversation', 'abc123', '--dangerously-skip-permissions']` |
| continue only | `['-p', '', '--continue', '--dangerously-skip-permissions']` |

**Narrowing probe (the one open bit).** `agy --help` (verified locally 2026-08-27) also offers
`--mode accept-edits`, which would grant edit approval without blanket tool approval — strictly
better if it actually suppresses the print-mode `write_file` denial. That is unverified: agy could
not be reached from the refine session (its `daily-cloudcode-pa.googleapis.com` endpoint fails TLS
verification behind the session proxy). **Rule:** if Plan step 1's probe runs and `--mode
accept-edits` writes the file, substitute `args.push('--mode', 'accept-edits')` at the same position
and update the frozen argv table accordingly. If the probe cannot run, or fails, ship
`--dangerously-skip-permissions`. Do not invent a third option; do not add both.

**Anti-patterns — do not implement.**
- Do **not** add a `PromptOptions` / `AgentSpec` / config flag to make this opt-in. One flag, always
  on, for this shim. A knob for a value that never varies is the wrong shape here.
- Do **not** apply the flag to any other shim in this task (out of scope, R-list).
- Do **not** insert the flag before `--model` or between `-p` and the prompt — argv order is asserted.
- Do **not** pair it with `--sandbox`; that flag restricts terminal use and would break dispatches
  that legitimately shell out. Considered and rejected (`### Q&A`).
- Do **not** finish on `bun link`. R3 requires a published version and updated pins.
- Do **not** accept a green local end-to-end run while `write_file(**)` is in the local allow list.

**WHERE — the other three file targets.**

| file | change |
| --- | --- |
| `~/xprojects/ts-libs/packages/ai-runner/src/agents/shims.ts` | the argv push + comment above |
| `~/xprojects/ts-libs/packages/ai-runner/tests/agents/shims.test.ts` | argv assertions, below |
| `~/xprojects/ts-libs/CHANGELOG.md` | one bullet under `## [Unreleased]` → `### Fixed` |
| `plugins/sp/skills/dogfood-testing/SKILL.md` | R4 paragraph, in "Engine-driven testees under a sandboxed session" (currently ends ~line 621) |

**Test-file blast radius (exact `toEqual` — all of these break otherwise).**
- `tests/agents/shims.test.ts:164-175`, `antigravity-cli shim builds agy -p argv (tier 1)` — two
  `getPromptCommand` `toEqual` assertions.
- `tests/agents/shims.test.ts:302-308`, the session-matrix `antigravity-cli` case — all four arrays
  (`fresh`, `sessionDirOnly`, `sessionIdAndDir`, `continueOnly`), consumed by the four generated
  tests at 324-352.
- Add one new test: the affordance is present on all four paths, so a later edit cannot silently
  drop it. This is the R2 deterministic tier.
- `tests/agents/shims.test.ts:56` (`args).toBeArray()`) is order-agnostic — unaffected.

**Version pins (R3).** ts-libs versions in **lockstep**: `packages/ai-runner/package.json` is at
`0.4.44`, Spur resolves `0.4.43`. Bump via `bun run bump-ver` in ts-libs and publish; then in Spur's
root `package.json` move **both** pin blocks to the published version — `workspaces.catalog`
(line ~32, `"@gobing-ai/ts-ai-runner": "^0.4.43"`) and root `dependencies` (line ~97,
`"@gobing-ai/ts-ai-runner": "0.4.43"`). Because ts-libs is lockstep, move the sibling `ts-*` pins in
both blocks to the same version rather than leaving ai-runner alone at a higher one. Then `bun update`.

**Handoff.** No dependent WBS. The consequence — 0687's AC3/AC4/AC9 becoming re-verifiable — is
noted in `### References`, not owned here.
### Plan
1. **(R1, optional-narrowing) Probe whether `--mode accept-edits` suffices.** On a machine with
   working agy auth, with the local `write_file(**)` allow entry temporarily removed:
   `agy -p "Write exactly 'probe-ok' to /tmp/agy-probe-mode.txt, then stop." --model claude-opus-4-6-thinking --mode accept-edits`
   File present ⇒ use `--mode accept-edits`. File absent, or the probe cannot run ⇒ use
   `--dangerously-skip-permissions`. Record which branch was taken and why in `### Solution`.
2. **(R1) Edit the shim.** `packages/ai-runner/src/agents/shims.ts` — append the chosen affordance
   last in `antigravityCliShim.getPromptCommand`, with the trust-assumption comment verbatim from
   `### Design`. No other shim touched.
3. **(R2 deterministic) Update the argv assertions.** `packages/ai-runner/tests/agents/shims.test.ts`
   at 164-175 and the session-matrix case at 302-308, plus the new all-paths presence test. Iterate
   narrow first: `bun test packages/ai-runner/tests/agents/shims.test.ts`. Then ts-libs
   `bun run lint && bun run test`.
4. **(R3) Release.** CHANGELOG bullet under `## [Unreleased]` → `### Fixed` naming the symptom
   (expectFile stages fail with the agent exiting 0) and the flag. `bun run bump-ver`, publish.
5. **(R2 end-to-end) Prove it, honestly.** In Spur: update both root `package.json` pin blocks to
   the published version, `bun update`, confirm
   `rg '"version"' node_modules/@gobing-ai/ts-ai-runner/package.json` shows it. Then **remove
   `"write_file(**)"` from `~/.gemini/antigravity-cli/settings.json` `permissions.allow`** (keep a
   backup) and run an agy-executor `agent.run` stage carrying `expectFile` — either
   `spur workflow run history-anatomy.yaml` reaching `resolve-scope` → `resolve-paths`, or a
   one-shot `spur agent run` with a write instruction plus a file assertion. Capture the
   `action_runs` row (or exit + file listing) as after-evidence next to the 4f55c237 before-row.
   Restore the allow entry afterwards if the operator wants it back for interactive dogfooding.
6. **(R4) Document.** One paragraph in `plugins/sp/skills/dogfood-testing/SKILL.md`, "Engine-driven
   testees under a sandboxed session": the allow entry is an operator-local unblock, not the fix, and
   it masks shim regressions in local end-to-end runs.
7. **Gate.** `bun run autofix && bun run spur-check` in Spur; ts-libs `bun run check`. Record
   commands and outcomes in `### Testing`.
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Failing run (before-evidence): `4f55c237-e808-457d-9cdf-5fb5be128906` — `runs.workflow_name =
  history-anatomy`, `status = failed`; `action_runs` `node = resolve-scope`, `ok = 0`, error
  `agent.run (inline) exited 0 but expected file is absent: .spur/run/4f55c237-…-selector.json`.
  Query: `sqlite3 .spur/spur.db "select node,kind,ok,result_json from action_runs where run_id like '4f55c237%';"`
- Stage under test: `config/workflows/history-anatomy.yaml:93` (`resolve-scope`), `expectFile` at :105.
- `expectFile` contract: `packages/app/src/workflow/actions/agent-run.ts:66-70` (R6-S2a).
- Shim under change: `~/xprojects/ts-libs/packages/ai-runner/src/agents/shims.ts:197-219`;
  single call site `packages/ai-runner/src/ai-runner.ts:277` (`buildAgentCommand`).
- Argv assertions: `~/xprojects/ts-libs/packages/ai-runner/tests/agents/shims.test.ts:164-175`,
  `:302-308` (matrix case) and `:324-352` (generated tests).
- Executor definition: `~/.config/spur/config.yaml:161` — `agy-opus` / `antigravity-cli` /
  `claude-opus-4-6-thinking` / `capable-1`.
- Operator-local remedy currently in place: `~/.gemini/antigravity-cli/settings.json`
  `permissions.allow` contains `write_file(**)` (added 2026-08-27T09:03; delta captured in
  `settings.json.bak-0687`).
- `agy --help` (v-local, 2026-08-27) — confirms both `--dangerously-skip-permissions` and
  `--mode accept-edits` exist.
- Upstream: task 0687 (verdict PARTIAL; AC3/AC4/AC9 blocked by this shim) and its R12 sandbox
  affordances in `plugins/sp/skills/dogfood-testing/SKILL.md`.
### History
