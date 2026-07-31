# Done-Time Housekeeping

Shared done-time contract for sp plugin agents. Every agent that drives a task to completion -
whether manually or via pipeline - MUST honor the following obligations. A subagent spawns cold
(no session context); this reference makes the obligations explicit so the launch prompt need not
restate them.

Agents cite this reference by file path - never by cross-file section anchor (anchor links break
silently when a heading is renamed or a file body is replaced; a path citation to a dedicated file
breaks loudly if the target moves).

## F1 - Flip completed checklist boxes

When a Plan/Requirements/AC item is completed, flip `[ ]` -> `[x]` in the same `--section` update
that lands the section content. Never let a `done` task ship with unchecked boxes on completed
work - a reader cannot tell `done` from `abandoned` by the boxes alone.

Stray template-placeholder boxes (e.g. the standard template's `- [ ] Acceptance checklist item`
or `- [ ] Implementation step`) that you did **not** author as real work must either be replaced
with real items or removed - do not leave them as `[ ]` in a `done` task. "I only checked the real
ones" is not compliant; the invariant is **zero** `- [ ]` lines remain.

Invariant: zero `- [ ]` entries (real or placeholder) anywhere in a `done` task at transition time.

## F2 - Honest lifecycle transitions

Drive the real `task-pipeline.yaml` FSM where applicable:

```
spur workflow run .spur/workflows/task-pipeline.yaml --vars '{"wbs":"<wbs>"}'
```

If you hand-walk lifecycle statuses (manual `spur task update <wbs> <status>` without the
pipeline), you MUST state so explicitly in your final message and name the gate you verified:

```
Transitioned manually. Gate verified: spur task check <wbs> --strict-core -> PASS
```

Silent manual transitions are the anti-pattern to forbid. Either the pipeline ran (name the
run-id) or you walked it manually (name the gate you checked).

## F4 - Raw gate evidence for high-stakes tasks

Threshold is by **change type**, not priority: a task is high-stakes if it touches code, tests, or
shared infrastructure. Priority (P1/P2) is advisory - it does not by itself force raw paste on a
pure doc/markdown edit. For high-stakes tasks, paste the **raw tail output** of every verification
gate that applies - not a one-line "green" summary. Include:

- `bun run lint` tail (last 20 lines minimum)
- `bun run test` tail (last 20 lines minimum)
- `bun run test-cf` tail (last 20 lines minimum)
- `bun run build` tail (last 20 lines minimum)

A one-line "all gates green" summary is acceptable only for doc-only changes with no code impact.

## F5 - Clean staging files after landing sections

After `spur task update <wbs> --section <name> --from-file /tmp/<file>` succeeds, immediately
`rm /tmp/<file>`. Do not accumulate staging files in `/tmp`. Cross-reference: this is step 3 of
the section-editing workflow in `cross-cutting.md` - follow it without exception.

Invariant: no `--from-file` staging files left in `/tmp` after the task is done.

## Before you report done - terminal gate (run this every time)

This is the enforcement mechanism for the Definition of Done Housekeeping above. The sections
above describe the obligations; **this checklist makes you execute them at the moment of
completion.** Before you write your final message for ANY task you drove to `done`, run each
check below as an actual command and answer it explicitly **in your final message** - not silently.

You MUST run check #1 as the literal command and paste its numeric output. Do not eyeball the Plan
section and conclude "boxes checked" - the check is over the **whole task file**, including stray
template placeholders in sections you never used (`### Acceptance Criteria`, `### Design`). "I
checked the real ones" is the failure mode this gate exists to stop; the only passing answer is the
command printing `0`.

| # | Check | Command to run (literal - paste the output) | Pass condition |
|---|-------|----------------------------------------------|----------------|
| 1 | F1 - no unchecked boxes anywhere | `grep -c '^\s*- \[ \]' <task-file>` | output is exactly `0` (whole file, not just Plan) |
| 2 | F2 - honest transition | (state it) | named a pipeline run-id, OR "manual + `spur task check <wbs> --strict-core` PASS" |
| 3 | F4 - gate evidence | (recall change type) | raw gate tails pasted if code/test/infra touched; one-liner only if pure-doc |
| 4 | F5 - no `/tmp` residue | `ls /tmp/<wbs>-* 2>/dev/null \| wc -l` | output is `0` |
| 5 | Dogfood (only if in dogfood mode) | `rg -c '^### 3\. Monitor Ledger' <report> && rg -c '── Dogfood Summary ──' <report> && rg -c '^status: (complete\|aborted)' <report>` | all three counts are `>= 1` (report exists under `docs/dogfood/` AND carries the mandatory ledger section AND the mandatory summary footer AND terminal frontmatter status - not just any file matching the slug) |

If check #1 prints anything other than `0`, you are **not done**: find each `- [ ]` line and either
check it (real completed work), replace it with a real item, or remove it (stray placeholder in an
unused section). Re-run the grep until it prints `0`.

If any check fails, **fix it before reporting done** - do not report a task complete with a failed
terminal-gate line. In your final message, include a short "Terminal gate" block showing each check
**and its actual command output** (e.g. `F1: grep -> 0 ✓ · F5: ls -> 0 ✓ · dogfood: docs/dogfood/<file> ✓`).
A cold-spawned agent that skips this block, or reports a check passed without showing its output,
has not finished the task.
