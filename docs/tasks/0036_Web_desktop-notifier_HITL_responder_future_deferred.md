---
name: "Web/desktop-notifier HITL responder (desktop done, web deferred)"
description: "Web/desktop-notifier HITL responder (desktop done, web deferred)"
status: blocked
created_at: 2026-06-10T06:48:43.405Z
updated_at: 2026-06-10T20:00:00.000Z
folder: docs/tasks
type: task
feature-id: ""
impl_progress:
  planning: done
  design: partial
  implementation: partial
  review: pending
  testing: partial
---


### Background

Wave 3 of the HITL effort. Adds non-CLI `HitlResponder` implementations so
interactive workflows work beyond the terminal:
- **Desktop-notifier responder** ✅ implemented — macOS native `osascript` dialogs for
  confirm/select/input + `node-notifier` for note display. Falls back to configured defaults on
  non-macOS or when native commands fail. Available via explicit import.
- **Web responder** 🚫 deferred — answers HITL requests through the spur web UI / oRPC seam. Blocked
  on: (a) workflow suspend/resume engine capability (ts-libs task), or (b) decision to ship
  synchronous-only. See R3 below.

**Depends on:** ts-libs 0031 (HitlResponder contract) ✅ · spur 0035 (hitl.* actions + CLI/default
responders) ✅.

### Requirements

R1 ✅ `DesktopNotifierHitlResponder` — implement `HitlResponder` with native OS dialogs for
   confirm/select/input (macOS `osascript`) and `node-notifier` for `hitl.note` display. Fall back
   to configured defaults on non-macOS or when native commands fail.
R2 ✅ Expose `notify(title, message)` for fire-and-forget desktop notifications — not part of
   the `HitlResponder.respond()` contract, but available via direct method call.
R3 🚫 `WebHitlResponder` — answers `HitlRequest` via web app / oRPC seam. Blocked: needs
   workflow suspend/resume engine capability OR explicit decision to ship synchronous-only.
R4 🚫 Responder selection extended to config/flag — deferred with web responder.

### Design

`DesktopNotifierHitlResponder` (`apps/cli/src/workflow/hitl/desktop-notifier-responder.ts`):
- **Platform split**: `osascript` dialogs on macOS, configured defaults fallback elsewhere.
  Zero extra deps for prompts — `osascript` is built-in.
- **Notes**: `node-notifier` fire-and-forget via `notify(title, message)`. Silent on failure.
- **Selection**: NOT auto-selected by `CliContext.hitlResponder()` — imported explicitly.
  Future selection via config/flag deferred with web responder (R4).

### Solution

| Deliverable | File | Status |
|---|---|---|
| `DesktopNotifierHitlResponder` class | `apps/cli/src/workflow/hitl/desktop-notifier-responder.ts` | ✅ |
| Tests (5 tests, mac-safe) | `apps/cli/tests/workflow/hitl/desktop-notifier-responder.test.ts` | ✅ |
| `node-notifier` dependency | `apps/cli/package.json` | ✅ |
| JSDoc note in `CliContext` | `apps/cli/src/context.ts:29-30` | ✅ |
| `WebHitlResponder` | — | 🚫 deferred |
| Config/flag responder selection | — | 🚫 deferred |

### Plan

1. ✅ Install `node-notifier` in `apps/cli`
2. ✅ Create `DesktopNotifierHitlResponder` — macOS native for prompts, node-notifier for notes
3. ✅ Write tests (confirm/select/input/notify/structure)
4. ✅ Export + note in `CliContext` JSDoc
5. 🚫 `WebHitlResponder` — deferred; unblock when suspend/resume lands or sync-only scoped
6. 🚫 Config/flag responder selection — deferred with web responder

### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |
| Source | `apps/cli/src/workflow/hitl/desktop-notifier-responder.ts` | Lord Robb | 2026-06-10 |
| Test | `apps/cli/tests/workflow/hitl/desktop-notifier-responder.test.ts` | Lord Robb | 2026-06-10 |
| Dep | `apps/cli/package.json` (node-notifier) | Lord Robb | 2026-06-10 |
| Doc | `apps/cli/src/context.ts` (JSDoc note) | Lord Robb | 2026-06-10 |

### References

- **ts-libs 0031** — `HitlResponder` contract.
- **0035** — CLI + default responders + `hitl.*` actions (prerequisite).
- Potential future ts-libs task — workflow suspend/resume (prerequisite for true async web HITL).