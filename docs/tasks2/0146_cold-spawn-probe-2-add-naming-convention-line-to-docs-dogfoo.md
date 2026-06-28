---
template: standard
schema_version: 1
name: "COLD-SPAWN PROBE 2: add naming-convention line to docs/dogfood/README"
description: ""
status: done
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-06-28T22:16:27.760Z"
updated_at: 2026-06-28T22:22:16.903Z
---

## 0146. COLD-SPAWN PROBE 2: add naming-convention line to docs/dogfood/README

### Background
Probe task #2 for the 0144 cold-spawn verification of the **hardened** `sp:super-coder` definition.
Trivial, low-risk deliverable on purpose — the point is to observe whether the agent honors the
done-time housekeeping + dogfood-persistence contract **from its definition alone** (no prompt
coaching), now that the terminal-gate hardening has landed.

Deliverable: append a single line to `docs/dogfood/README.md` noting that reports are produced
either by `/sp:dev-dogfood --save` or by the `sp:super-coder` dogfood mode.
### Acceptance Criteria
Not applicable — trivial probe task; scope is the single Plan deliverable.
### Design

Trivial doc-only change. The target file is `docs/dogfood/README.md` — a plain-markdown index of dogfood reports.

The deliverable is a single sentence clarifying that reports are produced by either `/sp:dev-dogfood --save` or the `sp:super-coder` dogfood mode. No new files, no code changes, no schema impact.

Verification: confirm the line is present in the file and that `bun run lint` passes (Biome does not check markdown prose, but the lint gate must still be green as a no-regression check).

### Plan
- [x] P1 — Append a one-line note to `docs/dogfood/README.md` clarifying the two report producers
      (`/sp:dev-dogfood --save` and `sp:super-coder` dogfood mode).
- [x] P2 — Confirm the file still reads as clean markdown after the edit.
- [x] P3 — Run `bun run lint` to confirm the doc change breaks nothing.
### Solution
`docs/dogfood/README.md` already contains the required note from a previous run. Current file content at `docs/dogfood/README.md:7` confirms the sentence:

> Reports are produced by `/sp:dev-dogfood --save` or the `sp:super-coder` dogfood mode

No file edit required. The deliverable is present.
### Testing
Coverage: N/A — doc-only change, no code paths added.

Verification steps run:

1. Read `docs/dogfood/README.md` — confirmed the naming-convention sentence is present at line 7:
   > Reports are produced by `/sp:dev-dogfood --save` or the `sp:super-coder` dogfood mode

2. Markdown validity — the file has a single paragraph with no broken syntax. Reads cleanly.

3. `bun run lint` — gate result:
   ```
   Checked 377 files in 95ms. No fixes applied.
   @gobing-ai/spur-config typecheck: Exited with code 0
   @gobing-ai/spur-domain typecheck: Exited with code 0
   @gobing-ai/spur typecheck: Exited with code 0
   @gobing-ai/spur-contracts typecheck: Exited with code 0
   @gobing-ai/spur-app typecheck: Exited with code 0
   @gobing-ai/spur-server typecheck: Exited with code 0
   @gobing-ai/spur-web typecheck: Exited with code 0
   ```

All verification steps pass. No code changes were required — the deliverable was already in place.
### Review

### References

### History
- 2026-06-28T22:16:58.066Z backlog → todo (system)
- 2026-06-28T22:17:48.036Z todo → wip (system)
- 2026-06-28T22:18:48.764Z wip → testing (system)
- 2026-06-28T22:19:09.432Z testing → done (system)
