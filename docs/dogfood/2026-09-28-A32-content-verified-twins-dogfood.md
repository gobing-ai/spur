---
status: complete
testee: "A32 content-verified standard-script twins (`bun run script-contract-check` Rule 1)"
classification: gate-behavior
mode: observe-only
max_retry: 0
testee_agent: omitted
started_at: 2026-09-28
finished_at: 2026-09-28
report_path: docs/dogfood/2026-09-28-A32-content-verified-twins-dogfood.md
protocol: manual — driven inline during the 0970 re-verify / A32 shippable pass (not the sp:dogfood-testing protocol)
---

# Dogfood Report — A32 content-verified standard-script twins

### 1. Testee

- **Repro:** the real gate, `bun run script-contract-check`, run against the live working tree. The
  standard twin `plugins/sp/scripts/quality-gate.mjs` was perturbed and then restored byte-for-byte
  from a `$TMPDIR` backup.
- **Scope:** Rule 1 of `plugins/sp/scripts/script-contract-check.ts` (task 0970). Twins are compared
  against a fresh `superskill script convert`, and mtime is never consulted.
- **Sample coverage:** 17 standard scripts, 12 repo-only scripts, and 1 perturbed twin.

### 2. Execution Summary

- **Result:** PASS (0 fixed, 0 unresolved, 1 finding).
- **Steps:** 4 derived, 4 executed.
- **Fix attempts:** 0.

### 3. Monitor Ledger

| Step | Outcome | Evidence |
| --- | --- | --- |
| Baseline | PASS | "29 script(s) baselined (17 standard, 12 repo-only), 0 violation(s) — PASS" |
| Content drift, twin mtime set **older** than source (`touch -t 202001010000`) | PASS (gate FAILs as intended) | `FAIL (stale_twin) - standard script .mjs twin quality-gate.mjs does not match a fresh convert of quality-gate.ts`, exit 1 |
| mtime-only change: bytes identical, twin touched **newer** | PASS | 0 violations. mtime changes alone no longer produce false positives or negatives |
| Converter unavailable (`superskill` off PATH, unshimmed bun) | PASS (gate FAILs closed) | `FAIL (converter_unavailable) - could not regenerate batch-preflight.mjs … Executable not found in $PATH: "superskill"`. One violation, then it stops. Exit 1 |

### 4. What We Did

The old mtime-tolerance rule could not catch the case in step 2: a twin whose content drifted but
whose mtime looks fresh, which is what every clone and worktree has, because git stores no mtimes. The
gate now catches that case. Step 3 confirms the inverse: a touch with identical bytes is accepted.
Step 4 confirms the gate fails closed when the converter cannot run, never silently passing.

### 5. Issues

#### Fixed

- (none)

#### Unresolved

- (none)

### 6. Findings

- **P4: the proto bun shim re-injects `~/.bun/bin` into PATH.** Running `env PATH=/usr/bin:/bin bun …`
  through `~/.proto/shims/bun` still resolved `superskill`, so the converter-unavailable case first
  appeared to PASS. This is a harness artifact, not a gate defect: the unshimmed
  `~/.proto/tools/bun/<ver>/bun` reproduces the fail-closed path. Anyone reproducing R3 by hand must
  bypass the shim.

── Dogfood Summary ──
Result: PASS   (0 fixed, 0 unresolved, 1 finding)
