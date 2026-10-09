---
schema_version: 1
name: Assert the publish trigger after a ts-libs release tag push
status: todo
template: standard
created_at: 2026-10-09T16:51:45.274Z
updated_at: "2026-10-09T16:52:23.699Z"
feature_id: A33

ac_numbering: task-local
ac_altitude: task-local
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

### Requirements

- [ ] R1. The release procedure pushes the aggregate tag on its own (`git push origin <aggregate-tag>`), not as part of `git push --tags`, so unrelated already-existing tags cannot make the push report failure or mask the aggregate tag's ref update.
- [ ] R2. Immediately after the push, the procedure asserts that a `Publish` run exists for that tag and reports the run URL. When no run exists it fails loudly, naming the tag and the absent run, instead of continuing as if the release were in flight.
- [ ] R3. The atomic-writer path runs this assertion too, or refuses to report a completed release while the publish trigger is unverified. A release helper that cannot see the trigger reports the gap rather than success.
- [ ] R4. The check-only path is exercisable without publishing anything, so the assertion is verifiable on demand (a dry run over an existing tag suffices).
- [ ] R5. Idempotent re-entry: re-running the procedure for a tag whose packages are already published reports the existing run and the published versions rather than attempting a second publish.
- [ ] R6. Out of scope, stated so it is not re-litigated here: the npm trusted-publishing configuration, the workflow's trigger list, and the tag naming scheme. A confirmed trigger defect discovered while implementing may file its own task with the evidence.

### Acceptance Criteria

```gherkin
Scenario: AC1 — the aggregate tag is pushed alone (req: R1)
  Given a release that created the aggregate tag and other tags already exist on the remote
  When the release procedure pushes
  Then the push command names only the aggregate tag
  And the command's exit status reflects that tag's ref update

Scenario: AC2 — a missing publish run fails loudly (req: R2)
  Given a tag that was pushed but produced no Publish run
  When the assertion runs
  Then it exits non-zero with the tag name and the absence of a run

Scenario: AC3 — a successful trigger reports its run (req: R2)
  Given a pushed aggregate tag with a Publish run in progress
  When the assertion runs
  Then it reports the run URL and exits zero

Scenario: AC4 — the assertion is checkable without publishing (req: R4)
  Given an existing released tag
  When the check-only path runs
  Then it reports that tag's Publish run and status
  And it starts no new publish

Scenario: AC5 — re-entry is safe (req: R5)
  Given a tag whose packages are already published
  When the procedure runs again
  Then it reports the existing run and published versions
  And it does not attempt a second publish
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

### Design

**Where this belongs.** ts-libs owns the release mechanics: the bump tool, the tag set, and the
`Publish` workflow. The assertion belongs next to the bump tool so any caller benefits, and it
belongs in the documented release recipe so a driver does not improvise it. This is release-tooling
integrity, which is A33's surface.

**Shape.** After the push, query the workflow's runs for the tag ref (`gh run list --workflow Publish
--branch <tag>` / the API's ref filter), match on the tag, and fail with an explicit message when the
list is empty. A short bounded wait with polling covers GitHub's registration delay: the failure being
fixed is a permanent non-trigger, so a poll that times out after a stated interval is the right
sensitivity, not a single instant read.

**Why not just retry the tag push?** A retry hides the class. The 0.5.18 path worked and this one did
not, so the difference is in the invocation; pushing the aggregate tag alone removes the partially
rejected push from the picture and makes the outcome attributable.

**Standalone-tag push.** `git push origin --tags` is one command with N refs and one exit status;
GitHub receives the refs it accepts, but the caller has no per-ref result. Pushing the aggregate tag
alone makes the trigger's precondition unambiguous.

**Impacted surfaces.** ts-libs release tooling and its docs; the release recipe that the spur-side
1131-style tasks follow. No spur CLI or schema change. Confirming the trigger mechanism itself stays
out of scope (R6) so this task does not become a workflow investigation.

### Plan

1. Read the ts-libs bump tool's push path and the Publish workflow's trigger, and record the exact
   commands it emits today.
2. Reproduce the assertion's building block by hand: `gh run list` filtered to an existing released
   tag, and to a tag with no run (the 0.5.19 window before the manual dispatch).
3. Implement the standalone aggregate-tag push plus the post-push assertion with a bounded poll, and
   wire the release path to refuse a success report when the trigger is unverified.
4. Exercise the check-only path against an already-released tag, and the re-entry path against a
   published version.
5. Record the output of both paths, including the failure message for a tag with no run.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-09T16:52:23.699Z backlog → todo (system)

