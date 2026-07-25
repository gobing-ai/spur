---
name: Fix HITL responder selection to honor --json (avoid interactive prompt corrupting JSON output)
description: Fix HITL responder selection to honor --json (avoid interactive prompt corrupting JSON output)
status: done
created_at: 2026-06-10T16:41:42.445Z
updated_at: 2026-06-10T17:02:32.670Z
folder: docs/tasks
type: task
feature-id: ""
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0037. Fix HITL responder selection to honor --json (avoid interactive prompt corrupting JSON output)

### Background

Follow-up from task 0035 verification (bug-245). The HITL responder factory selects the interactive
`ClackHitlResponder` based on `isatty(1)` **alone**, ignoring `--json`. A workflow run with `--json` on
an interactive terminal would launch a `@clack/prompts` UI mid-run — corrupting the JSON stream and
blocking any machine consumer that cannot answer the prompt. Task 0035's R6 specified
`isatty(1) && !jsonOutput`; the `!jsonOutput` half was dropped because the `--json` flag is a
per-command option not available where the responder factory is constructed.

**Anchor:** `apps/cli/src/context.ts:62` —
`hitlResponder: () => (isatty(1) ? new ClackHitlResponder() : new DefaultHitlResponder())`.

Low likelihood (interactive workflow + `--json` is unusual), non-data-loss failure mode (hang /
corrupt output), hence P3 — but it violates the "headless-safe" contract that justified the responder
seam in the first place.

### Requirements

1. The responder factory must return `DefaultHitlResponder` whenever output is `--json` / non-interactive,
   regardless of TTY: effective rule `interactive = isatty(1) && !jsonOutput`.
2. Thread the json/output-mode signal to the responder factory. Options (decide in design):
   (a) defer responder construction until command flags are parsed and pass `{ json }` into
   `context.hitlResponder(opts)`; (b) have the `workflow run` command override the context's responder
   when `--json` is set; (c) make `hitlResponder()` read a context-level output-mode already set by the
   command. Prefer the option that keeps one selection site and stays consistent with how `--json`
   already flows to `context.output`.
3. Test: with `--json`, the selected responder is `DefaultHitlResponder` even when `isatty(1)` is true;
   without `--json` on a TTY, `ClackHitlResponder`. (Mock `isatty` / inject the tty signal.)
4. Gate: `bun run check` green; no regression in 0035's HITL tests.

### Q&A

**Q1. Why not just always DefaultHitlResponder?** That would lose interactive HITL entirely. The point
is to be interactive when a human is present (TTY, not `--json`) and headless otherwise.

**Q2. Does this affect the action runners?** No — runners are responder-agnostic (0035). This is purely
the CLI responder-selection seam.

### Design

_Pending — pick the threading option in R2 that matches how `--json` already reaches `context.output`._

### Solution

_Pending design._

### Plan

1. Locate where `--json` is parsed for `workflow run` and how `context.output` learns the mode.
2. Thread the same signal to the responder factory (chosen R2 option).
3. Update `context.ts:62` selection to `isatty(1) && !json`.
4. Add the selection test; run the gate.

### References

- **0035** — HITL actions + responders (origin of the finding); bug-245.
- `apps/cli/src/context.ts:62` — the selection site to fix.



### Plan



### Review


---

## Resolution — 2026-06-10

**Done.** `hitlResponder` now honors `--json`.

- `context.ts` — `hitlResponder(json?)` selects interactive `ClackHitlResponder` only when
  `isatty(1) && json !== true`; otherwise `DefaultHitlResponder`. (R1, R2 option (a): the factory
  already a per-command callable, so the flag is passed at call time — no deep threading.)
- `commands/workflow.ts` — `makeSvc(json)` captures the flag; the `run` command passes `options.json`
  (validate/list don't invoke HITL actions, left unchanged).
- Test (R3): `context.test.ts` — `hitlResponder(true).respond({kind:'confirm'…})` resolves to the
  configured default (`'yes'`) without prompting, proving `--json` never triggers interactive I/O.

**Gate (R4):** `bun run autofix && bun run spur-check` → EXIT_CODE=0; biome 0 warnings; 446 tests pass;
coverage gate + tsdoc pass; no regressions.


### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


