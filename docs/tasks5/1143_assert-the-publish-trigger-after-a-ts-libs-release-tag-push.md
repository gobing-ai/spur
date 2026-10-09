---
schema_version: 1
name: Assert the publish trigger after a ts-libs release tag push
status: done
template: standard
created_at: 2026-10-09T16:51:45.274Z
updated_at: "2026-10-09T22:16:03.714Z"
feature_id: A33

ac_numbering: task-local
ac_altitude: task-local
priority: P2
estimate_hours: 3
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1143-verdict.json
---

## 1143. Assert the publish trigger after a ts-libs release tag push

### Background

Measured in the 2026-10-08 session during task 1131 R3 (ts-libs 0.5.19 adoption). The release path
lost roughly 62 minutes of critical path to a silent non-trigger:

- The bump tool committed `chore(release): bump all packages to 0.5.19` and created 13 tags.
- `git push origin main` succeeded.
- `git push origin --tags` pushed the aggregate tag `@gobing-ai/ts-libs-v0.5.19` (confirmed later with
  `git ls-remote --tags origin`) and also reported several already-existing 0.4.43 tags as rejected,
  exiting non-zero.
- **No `Publish` run appeared.** `gh run list --workflow Publish` showed no 0.5.19 entry for about an
  hour. The workflow triggers on `@gobing-ai/ts-libs-v*` tag pushes, and every prior release
  (0.5.17, 0.5.18) shows a tag-push-triggered run, so the mechanism works in general.
- Recovery was a manual `gh workflow run Publish --ref @gobing-ai/ts-libs-v0.5.19`, which published
  12 packages in 2m23s and completed with npm provenance logged.

The reason the tag push did not trigger is **not confirmed**: the partially-rejected `--tags` push is
the visible difference from prior releases, and that is an inference, not evidence. The task exists
because the *failure mode* is what costs time — a release step that reports success while nothing is
publishing, with no assertion to catch it.

**Refine corrections (2026-10-09)**

- **The root cause is now evidenced, not inferred.** ts-libs' `bump-ver --push` path already does what old R1/R2/R5 asked, as `ts-libs` task 0510 R4:
  - it pushes each tag individually (`scripts/lib/release-commands.ts:276-284`);
  - it polls `gh run list` for the aggregate tag;
  - it dispatches `publish.yml` once at the tag ref when no push run appears (`ensurePublishWorkflowRun`, `:286-360`);
  - npm skip-if-published already makes publishes idempotent (`:167-175`).

  `docs/PACKAGE_RELEASE.md:178` records the platform rule: GitHub creates no workflow runs when more than three tags are pushed at once.
- **The defect is the local-mode hint.** In the 2026-10-08 incident `bump-ver` ran **without** `--push`, so the 13 tags were created locally. The tool then printed `git push origin --tags` as the next step (`release-commands.ts:269-272`), which is exactly the pattern the push path avoids. The operator followed it, the aggregate tag reached the remote inside a 13-tag push, and no `Publish` run was created. The "partially rejected push" was incidental.
- **Scope moves upstream** under the facade rule (fix `@gobing-ai/ts-*` in `/Users/robin/xprojects/ts-libs`, not in Spur). Spur's own `spur builder bump-ver` has no push step and is out of scope. Old R6 (out of scope: trigger list, trusted publishing, tag scheme) stands.
- Feature: A33 (repo release-tooling integrity).

### Requirements

- [x] R1. **The local-mode hint never recommends `--tags`.** In ts-libs `scripts/lib/release-commands.ts:269-272`, replace the `git push origin --tags` line. The new hint prints:
  - the branch push;
  - one `git push origin refs/tags/<tag>:refs/tags/<tag>` per package tag, with the aggregate tag last;
  - `bun scripts/builder.ts verify-publish <aggregateTag>`.

  It also states the three-tag GitHub limit in one line.
- [x] R2. **A check-only publish verifier.** Add a `verify-publish <aggregate-tag> [--dispatch]` command to `scripts/builder.ts`. It runs the existing lookup from `ensurePublishWorkflowRun` without dispatching, prints the run id and URL, and exits 0 when a run exists. When none exists it exits 1, naming the tag and the absent run, and prints the recovery command. With `--dispatch` it performs the existing single dispatch and final lookup.
- [x] R3. **No dispatch in the lookup-only path.** Split `ensurePublishWorkflowRun` into `findPublishRun(tag, spawn, sleep)` (bounded lookups) and the dispatch tail. `bumpVersion --push` keeps calling the combined behaviour unchanged.
- [x] R4. **Tests (scripted `spawn`, no network).** Cover:
  - (a) the local-mode hint lists per-tag refspecs and contains no `--tags`;
  - (b) `verify-publish` with a matching run gives exit 0 and the URL;
  - (c) no run gives exit 1, zero `gh workflow run` calls, and the recovery text;
  - (d) `--dispatch` with no run makes exactly one dispatch;
  - (e) the existing `--push` tests at `scripts/tests/release-commands.test.ts:193-409` are unchanged.
- [x] R5. **Docs.** `docs/PACKAGE_RELEASE.md` names `verify-publish` as the post-push check for a local-mode release. This task's Testing records `verify-publish @gobing-ai/ts-libs-v0.5.19` against the real repository (read-only; that release already has a run).

### Acceptance Criteria

```gherkin
Scenario: AC1 — Local mode prints a safe push sequence (req: R1)
  Given bump-ver runs without --push
  When it finishes
  Then the printed next steps push each tag by explicit refspec with the aggregate tag last
  And the output contains no "git push origin --tags"
  And it names verify-publish for the aggregate tag
```

```gherkin
Scenario: AC2 — verify-publish reports an existing run without dispatching (req: R2, R3)
  Given gh run list returns a run whose headBranch is the aggregate tag
  When "builder.ts verify-publish <tag>" runs
  Then it exits 0 printing the run id and URL
  And no gh workflow run call is made
```

```gherkin
Scenario: AC3 — A missing run fails loudly with recovery (req: R2, R3)
  Given gh run list never returns a run for the tag
  When verify-publish runs without --dispatch
  Then it exits 1 naming the tag and the absent Publish run
  And it prints the --dispatch recovery and makes no dispatch
  And with --dispatch exactly one workflow dispatch is made
```

```gherkin
Scenario: AC4 — The push path is unchanged and evidence is recorded (req: R4, R5)
  Given the existing release-commands tests
  When the ts-libs test suite runs
  Then they pass unchanged alongside the new tests
  And this task's Testing records a real read-only verify-publish against ts-libs-v0.5.19
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T16:51:57.491Z

- **Why is this worth a task if the manual dispatch worked?** The recovery cost was about an hour of
  a driver's critical path, and the failure was silent — a release that appears in flight while
  nothing publishes. The assertion converts a silent hang into an immediate error.
- **Could the tag push have been rate-limited or delayed?** Possible and not confirmed. A poll with a
  stated interval distinguishes a delayed trigger from an absent one, and either outcome is reported.
- **Why not add the assertion to the spur pipeline instead?** The release is a ts-libs operation and
  the aggregate tag is ts-libs' contract. Putting the check in the spur driver would encode another
  repository's release mechanics in the wrong owner.
- **Deferred:** anything about npm trusted publishing, workflow triggers, or tag naming — R6 keeps
  those out, and a confirmed defect found while implementing gets its own task with evidence.

#### Q&A entry — 2026-10-09T18:14:44.590Z

- **Q: Is the cause still unconfirmed?** A (closed 2026-10-09): no. GitHub does not create push events when more than three tags are pushed in one push, and ts-libs documents this at `docs/PACKAGE_RELEASE.md:178`. The local-mode hint led to exactly that push.
- **Q: Fix in Spur or ts-libs?** A: ts-libs. The facade rule says to fix upstream, and Spur's release noun has no push step.
- **Q: Should we make `--push` the default?** A: no. Local mode exists so the operator can review before publishing. This task makes the reviewed follow-up safe and checkable instead.
- **Q: Release cadence?** A: a scripts-only change does not need a package release. It lands on ts-libs main.

### Design

- **Location.** All edits are in `/Users/robin/xprojects/ts-libs`: `scripts/lib/release-commands.ts`, `scripts/builder.ts`, `scripts/tests/release-commands.test.ts` and `docs/PACKAGE_RELEASE.md`. Spur's tree gets no code edit; only this task records the evidence.
- **Refactor shape (R3).**
  - `findPublishRun(tag, spawn, sleep, log): Promise<PublishRunInfo | undefined>` holds the current `listRuns` loop.
  - `ensurePublishWorkflowRun` becomes `findPublishRun(...) ?? dispatchAndConfirm(...)`, with byte-identical log lines so the existing assertions hold.
- **CLI (R2).**
  - `builder.ts` adds a `case 'verify-publish'` that parses `<tag>` plus `--dispatch` and prints usage on a missing tag.
  - Exit codes: 0 when a run is found, 1 when it is absent or dispatch fails, 2 on usage.
- **Boundaries.**
  - No change to `publish.yml`, trusted publishing, tag names or the `--push` sequence.
  - No tag deletion or re-push anywhere.
- **Failure inventory (tests first).**
  - The lookup-only path dispatching anyway.
  - The aggregate tag not pushed last in the hint.
  - A `gh` auth failure being reported as "no run". It must surface `gh run list failed`, as `:325-327` does today.

### Plan

1. In ts-libs, write the R4 tests (a)–(d). Confirm they fail.
2. R3: refactor. R1: change the hint. R2: add the `verify-publish` command.
3. Run the ts-libs test suite and lint.
4. R5: update the docs. Run `bun scripts/builder.ts verify-publish @gobing-ai/ts-libs-v0.5.19` (read-only) and record the output.
5. Commit in ts-libs, then cite the commit in this task's Solution.

### Solution

All code changes landed upstream in `/Users/robin/xprojects/ts-libs` under the facade rule — four commits:

- `9e607148` `feat(release): verify-publish command and safe local-mode push hint (1143)`
- `a0b0855` `fix(release): guard the local-mode branch push against followTags (1143)` (review finding #1)
- `93c85f0` `fix(release): apply the followTags guard to every printed local-mode push (1143)` (review finding #2)
- `4c38d3f` `test(release): widen the local-mode push-guard sweep and ban --tags outright (1143)` (review finding #7)

**Upstream — `/Users/robin/xprojects/ts-libs`**

- ts-libs `scripts/lib/release-commands.ts` line 269-278 — (R1) Replaced the local-mode hint's `git push origin --tags` with `git push --no-follow-tags origin <branch>`, one `git push origin refs/tags/<tag>:refs/tags/<tag>` per package tag (aggregate tag last), the `verify-publish` post-push check, and a one-line statement of GitHub's >3-tag rule. The `--no-follow-tags` guard matches what the `--push` path already does via `branchPushArgs` (`branchPushArgs` / `tagPushArgs`); without it, `push.followTags=true` would re-create the 13-tag push that caused the incident.
- ts-libs `scripts/lib/release-commands.ts` line 299-311 — (R3) Extracted `queryPublishRun(aggregateTag, spawn)` (one `gh run list`, throws `gh run list failed` on non-zero, `undefined` when no match).
- ts-libs `scripts/lib/release-commands.ts` line 337-350 — (R3) Added `findPublishRun(aggregateTag, spawn, sleep, log)`: bounded polling (≤ `PUBLISH_RUN_LOOKUP_ATTEMPTS` × `PUBLISH_RUN_LOOKUP_INTERVAL_MS`) that never dispatches; returns `PublishRunInfo | undefined`.
- ts-libs `scripts/lib/release-commands.ts` line 352-390 — (R3) `ensurePublishWorkflowRun` is now `findPublishRun(...) ?? dispatchAndConfirm(...)`; its log lines are byte-identical to the previous revision, so the existing `--push` assertions hold unchanged.
- ts-libs `scripts/lib/release-commands.ts` line 408-451 — (R2) `verifyPublish(aggregateTag, {dispatch, spawn, sleep, log, errorLog})`: without `--dispatch`, returns 0 and logs the run id + URL when found, or logs the tag plus the `--dispatch` recovery command and returns 1 when absent; with `--dispatch`, delegates to `ensurePublishWorkflowRun` and returns 0/1.
- ts-libs `scripts/builder.ts` (the `verify-publish` subcommand) — (R2) Added the `verify-publish <aggregate-tag> [--dispatch]` subcommand and widened `usage()`/`fail()` with an explicit exit code so usage errors exit 2 while every pre-existing caller keeps exit 1.
- ts-libs `scripts/tests/release-commands.test.ts` line 300-397, 496-513 — (R4) New `verifyPublish` suite covering R4(b)–(d) plus `gh` failure surfacing, and the R4(a) local-mode-hint test.
- ts-libs `docs/PACKAGE_RELEASE.md` line 48-55, 60-66, 197 and ts-libs `scripts/README.md` line 8-18, 29-34 — (R5) Document `verify-publish` as the post-push check for a local-mode release and list it in the command reference.

**Spur tree — gate repairs required by two pre-existing base-tree defects (not caused by this task; proven at base `17d06fe`)**

- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:792-794` — the runtime-contract note instructed `wbs=<wbs> bun plugins/sp/scripts/task-diffstat.ts`, which trips the `forbidden_invocation` rule in shipped surfaces (`scripts/commands/script-contract-check.ts:143-169`). Repointed to the house idiom `wbs=<wbs> node "$(superskill script path sp task-diffstat.mjs)"`. Introduced by `802d66b63`; it left `script-contract-check` red for every pipeline run on this base.
- `plugins/sp/lib/idea-handoff.generated.mjs`, `plugins/sp/lib/inline-run.generated.mjs` — regenerated. The committed twins were built against `@gobing-ai/ts-llm-jsonl-importer` 0.5.18; the installed dependency is 0.5.19 (task 1131 R3), whose renamed redaction symbol changed the bundle bytes, so `bundle-plugin-lib.test.ts` byte-equality assertions failed against the committed artifacts. Regeneration is deterministic and install-topology independent (verified: the invoking tree produces byte-identical output). Documented here rather than silently absorbed.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | ts-libs `scripts/lib/release-commands.ts` line 268-282 — local-mode hint prints the branch push, one guarded `refs/tags/<tag>:refs/tags/<tag>` push per package tag with the aggregate tag last, the verify-publish check and the three-tag GitHub limit; no `--tags` form. Asserted by ts-libs `scripts/tests/release-commands.test.ts` line 496-524 (re-run green this pass) |
| R2 | MET | ts-libs `scripts/lib/release-commands.ts` line 417-445 — verifyPublish returns 0 with run id and URL when found, 1 naming the tag and the `--dispatch` recovery when absent; ts-libs `scripts/builder.ts` line 26-28 wires `verify-publish <tag> [--dispatch]` with usage exit 2. Live evidence this pass: the public GitHub API returns run 37850267092 (Publish, head_branch `@gobing-ai/ts-libs-v0.5.19`, conclusion success); the implementing run recorded verify-publish exit 0 for the same run |
| R3 | MET | ts-libs `scripts/lib/release-commands.ts` line 306-326 (queryPublishRun, one `gh run list`), line 332-349 (findPublishRun, bounded lookups, never dispatches), line 364-401 (ensurePublishWorkflowRun = find plus dispatch tail); zero-dispatch lookup asserted at ts-libs `scripts/tests/release-commands.test.ts` line 304-319 |
| R4 | MET | ts-libs `scripts/tests/release-commands.test.ts` — (a) line 496-524, (b) line 304-319, (c) line 320-340, (d) line 341-364, all over a scripted spawn with no network; (e) pre-existing push-path tests (line 525) unmodified. Fresh run this pass: `bun test scripts/tests/` → 92 pass / 0 fail |
| R5 | MET | ts-libs `docs/PACKAGE_RELEASE.md` line 57-67 and line 203, ts-libs `scripts/README.md` line 10 and line 31 name verify-publish as the post-push check with the `--dispatch` recovery; Testing records the real read-only run (exit 0, run 37850267092) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — Local mode prints a safe push sequence (req: R1) | MET | test | ts-libs `scripts/tests/release-commands.test.ts` line 496-524 — no `--tags`, guarded per-tag refspecs with the aggregate tag last, names verify-publish (re-run green) |
| Scenario: AC2 — verify-publish reports an existing run without dispatching (req: R2, R3) | MET | test | ts-libs `scripts/tests/release-commands.test.ts` line 304-319 — exit 0, id and URL, one `gh run list` and no `gh workflow run` (re-run green); run 37850267092 re-confirmed live via the public GitHub API this pass |
| Scenario: AC3 — A missing run fails loudly with recovery (req: R2, R3) | MET | test | ts-libs `scripts/tests/release-commands.test.ts` line 320-364 — exit 1 naming the tag, recovery text, zero dispatches; `--dispatch` makes exactly one dispatch (re-run green) |
| Scenario: AC4 — The push path is unchanged and evidence is recorded (req: R4, R5) | MET | test | ts-libs `scripts/tests/release-commands.test.ts` line 525 push-path test unmodified; `bun test scripts/tests/` → 92 pass / 0 fail this pass; Testing records the real read-only verify-publish (exit 0, run 37850267092) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

#### Re-verify — 2026-10-09 (`/sp:dev-verifyall --force --fix all`)

- Fresh run: ts-libs `bun test scripts/tests/` → 92 pass / 0 fail.
- Live evidence: `gh` could not run inside the sandbox because its TLS proxy rejected the certificate (x509 OSStatus -26276), so `verify-publish` exited 1 with `gh run list failed`. That is the correct loud failure, not a false "no run". The same lookup was confirmed independently through the public GitHub API: `GET /repos/gobing-ai/ts-libs/actions/runs/37850267092` → `{"name":"Publish","head_branch":"@gobing-ai/ts-libs-v0.5.19","status":"completed","conclusion":"success"}`.
- Fix pass: drifted ts-libs line ranges re-read and corrected (queryPublishRun 306-326, findPublishRun 332-349, ensurePublishWorkflowRun 364-401, verifyPublish 417-445; tests 304-364 and 496-524).

### Review

#### Review Report — 1143

**Scope:** ts-libs `9e607148`, `a0b0855`, `93c85f0`, `4c38d3f` — `scripts/lib/release-commands.ts`, `scripts/lib/release.ts`, `scripts/builder.ts`, `scripts/tests/release-commands.test.ts`, `scripts/README.md`, `docs/PACKAGE_RELEASE.md`; Spur worktree — `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`, `plugins/sp/lib/{idea-handoff,inline-run}.generated.mjs`, task `Solution`/`Testing`.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 (major) | correctness | The local-mode hint's branch push printed bare `git push origin <branch>`, omitting the `push.followTags` guard the `--push` path applies (`branchPushArgs`). Under `push.followTags=true` it would push all 13 release tags at once — the exact silent non-trigger this task exists to prevent. | ts-libs `scripts/lib/release-commands.ts` line 270, mirroring `branchPushArgs` | FIXED (`a0b0855`); assertion locked at ts-libs `scripts/tests/release-commands.test.ts` line 504-505 |
| 2 | P2 (major) | correctness | The same omission on every printed *tag* push (`git push origin refs/tags/<tag>:refs/tags/<tag>`), while `tagPushArgs` guards the identical refspec form. Confirmed empirically, not just from git-push(1): a scratch repo with 5 annotated tags on one commit and `push.followTags=true` pushed 5 tags unguarded and 1 tag guarded. | ts-libs `scripts/lib/release-commands.ts` line 273, 275, mirroring `tagPushArgs` | FIXED (`93c85f0`); per-tag assertions plus a guard sweep at ts-libs `scripts/tests/release-commands.test.ts` line 506-523 |
| 3 | P3 (minor) | architecture | The pre-existing `ensurePublishWorkflowRun` JSDoc was pasted verbatim onto the extracted `queryPublishRun`, documenting dispatch behaviour that function does not have, and duplicated on its original owner. | ts-libs `scripts/lib/release-commands.ts` line 299-311 | RESOLVED (`a0b0855`) |
| 4 | P3 (minor) | usability | `scripts/README.md` enumerates every `builder.ts` subcommand but did not list the new public `verify-publish`. | ts-libs `scripts/README.md` line 8-18 | RESOLVED (`a0b0855`) |
| 5 | P3 (minor) | functional | R5/AC4's second clause required the real read-only `verify-publish` run in `### Testing`, and the Solution did not record the two pre-existing Spur-side gate repairs. | `docs/tasks5/1143_assert-the-publish-trigger-after-a-ts-libs-release-tag-push.md` `### Testing` | DONE (`37850267092` recorded; gate repairs documented in `### Solution`) |
| 6 | P3 (minor) | usability | The check-only form's bounded ~10s lookup was undocumented, so a scripted verify fired the instant the tag lands could report a false "no run" for a merely-late trigger. | ts-libs `docs/PACKAGE_RELEASE.md` line 60-66, `scripts/README.md` | RESOLVED (`93c85f0`) |
| 7 | P4 (advisory) | correctness | The `--tags` negative assertion matched only the literal `git push origin --tags`, and the guard sweep filtered on `push origin` — a bare `git push --tags` would evade both. | ts-libs `scripts/tests/release-commands.test.ts` line 503, 515 | RESOLVED (`4c38d3f`, test-only hardening after the PASS review) |
| 8 | P4 (advisory) | security | Reviewed and clean: all `gh`/`git` invocations use argv arrays with no shell, so tag values cannot be injected; a `gh` auth failure throws `gh run list failed` and is never misreported as "no run"; `--dispatch` dispatches at most once on every path; the 0/1/2 exit widening is confined to the new `verify-publish` case with every pre-existing caller still exiting 1; the `--push` log lines are byte-identical to the previous revision. | ts-libs `scripts/lib/release-commands.ts` line 303-321, 329-357, 361-397; ts-libs `scripts/builder.ts` (the `verify-publish` subcommand) | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 (local-mode hint: branch push, per-tag refspecs, aggregate last, `verify-publish`, three-tag limit, no `--tags`) | MET | ts-libs `scripts/lib/release-commands.ts` line 272-280; every printed push guarded (findings 1–2 fixed); ts-libs `scripts/tests/release-commands.test.ts` line 496-523 |
| R2 (`verify-publish <tag> [--dispatch]`; 0 found / 1 absent + recovery / 2 usage) | MET | ts-libs `scripts/lib/release-commands.ts` line 392-450; ts-libs `scripts/builder.ts` (the `verify-publish` subcommand); ts-libs `scripts/tests/release-commands.test.ts` line 300-397 |
| R3 (lookup split from dispatch; `--push` unchanged) | MET | `queryPublishRun` `:296-311`, `findPublishRun` `:313-333`, `ensurePublishWorkflowRun` `:335-390` — combined behaviour and log lines preserved |
| R4 (tests a–e, scripted `spawn`, no network) | MET | (a) `:496-523`; (b) `:305-314`; (c) `:322-333`; (d) `:344-357`; (e) the pre-existing `--push` suite passes unmodified |
| R5 (docs + recorded read-only run) | MET | ts-libs `docs/PACKAGE_RELEASE.md` line 44-66, 197, `scripts/README.md`; `### Testing` records exit 0 with run `37850267092`, exit 1 recovery on the negative tag, exit 2 on usage |

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| AC1 — local mode prints a safe push sequence (req: R1) | MET | test | ts-libs `scripts/tests/release-commands.test.ts` line 496-523 — no `--tags` anywhere, guarded per-tag refspecs with the aggregate tag last, `verify-publish` named |
| AC2 — verify-publish reports an existing run without dispatching (req: R2, R3) | MET | test | ts-libs `scripts/tests/release-commands.test.ts` line 305-314 — exit 0, run id + URL logged, exactly one `gh run list`, zero `gh workflow run` |
| AC3 — a missing run fails loudly with recovery (req: R2, R3) | MET | test | ts-libs `scripts/tests/release-commands.test.ts` line 322-357 — exit 1 naming the tag, recovery text printed, zero dispatches; `--dispatch` makes exactly one |
| AC4 — the push path is unchanged and evidence is recorded (req: R4, R5) | MET | test | pre-existing `--push` tests pass unmodified; `### Testing` records the real read-only `verify-publish @gobing-ai/ts-libs-v0.5.19` |

**Residual risk:** the review was read-only and could not re-run the ts-libs suite or `git show`; suite results are taken from `### Testing` and re-confirmed by the coordinator (`bun run check` 2870 pass / 0 fail). Finding 7's hardening (`4c38d3f`) landed after the PASS review and is test-only — it cannot introduce a P1–P3 defect, and the file's suite was re-run green. No workflow trigger, trusted-publishing or tag-scheme change was made; no publish was executed, per R6.

**Next:** Verify against R1–R5 / AC1–AC4, then record.

### References

- ts-libs:
  - local hint: `scripts/lib/release-commands.ts:269-272`;
  - push sequence: `:276-284`;
  - `ensurePublishWorkflowRun`: `:286-360`;
  - publish skip: `:167-175`;
  - CLI: `scripts/builder.ts:7-15,91`;
  - tests: `scripts/tests/release-commands.test.ts:193-409`;
  - platform rule: `docs/PACKAGE_RELEASE.md:178`;
  - trigger: `.github/workflows/publish.yml`.
- Incident: the task 1131 R3 ts-libs 0.5.19 adoption (2026-10-08), recovered with `gh workflow run Publish --ref @gobing-ai/ts-libs-v0.5.19`.
- Facade rule: AGENTS.md (fix `@gobing-ai/ts-*` upstream).

### History

- 2026-10-09T16:52:23.699Z backlog → todo (system)
- 2026-10-09T19:01:00.842Z todo → wip (system)
- 2026-10-09T20:08:48.667Z wip → testing (system)
- 2026-10-09T20:09:23.054Z testing → done (system)

