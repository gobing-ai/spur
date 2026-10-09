---
schema_version: 1
name: Assert the publish trigger after a ts-libs release tag push
status: todo
template: standard
created_at: 2026-10-09T16:51:45.274Z
updated_at: "2026-10-09T18:14:45.845Z"
feature_id: A33

ac_numbering: task-local
ac_altitude: task-local
priority: P2
estimate_hours: 3
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

- [ ] R1. **The local-mode hint never recommends `--tags`.** In ts-libs `scripts/lib/release-commands.ts:269-272`, replace the `git push origin --tags` line. The new hint prints:
  - the branch push;
  - one `git push origin refs/tags/<tag>:refs/tags/<tag>` per package tag, with the aggregate tag last;
  - `bun scripts/builder.ts verify-publish <aggregateTag>`.

  It also states the three-tag GitHub limit in one line.
- [ ] R2. **A check-only publish verifier.** Add a `verify-publish <aggregate-tag> [--dispatch]` command to `scripts/builder.ts`. It runs the existing lookup from `ensurePublishWorkflowRun` without dispatching, prints the run id and URL, and exits 0 when a run exists. When none exists it exits 1, naming the tag and the absent run, and prints the recovery command. With `--dispatch` it performs the existing single dispatch and final lookup.
- [ ] R3. **No dispatch in the lookup-only path.** Split `ensurePublishWorkflowRun` into `findPublishRun(tag, spawn, sleep)` (bounded lookups) and the dispatch tail. `bumpVersion --push` keeps calling the combined behaviour unchanged.
- [ ] R4. **Tests (scripted `spawn`, no network).** Cover:
  - (a) the local-mode hint lists per-tag refspecs and contains no `--tags`;
  - (b) `verify-publish` with a matching run gives exit 0 and the URL;
  - (c) no run gives exit 1, zero `gh workflow run` calls, and the recovery text;
  - (d) `--dispatch` with no run makes exactly one dispatch;
  - (e) the existing `--push` tests at `scripts/tests/release-commands.test.ts:193-409` are unchanged.
- [ ] R5. **Docs.** `docs/PACKAGE_RELEASE.md` names `verify-publish` as the post-push check for a local-mode release. This task's Testing records `verify-publish @gobing-ai/ts-libs-v0.5.19` against the real repository (read-only; that release already has a run).

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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

