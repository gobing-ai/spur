# 0903 — Contract adoption and ownership audit (report artifact)

**Task:** 0903 (feature I31) · **Source commit:** `99562391f14d2118b80a189826fca0b8e2f25e4b` · **Captured:** 2026-09-20T06:51:00Z
**Provenance:** remediation artifact generated under verify `--fix all` re-verification. Content derives from the task's `### Solution` investigation (captured with source-local CLI, exit 0, all rows re-verified against fresh captures in the recorded Testing table) plus one fresh `feature sync --all --dry-run --json` capture this run. Machine-readable form: `0903-contract-adoption.json` (same directory). `mutationPolicy: none` honored — no source, plugin, workflow, adapter, config, or status mutations.

## Coverage accounting

- **Frozen surfaces (R1):** 11 rows (A1–A11) spanning `spur agent` verb set, `agent run --agent` semantics, `agent usage`, `agent doctor` JSON shape, `message send`, wait-family receipts, workflow layering, role routing, B7 session-policy pins (YAML), B7 plugin prose, installed Superskill adapters. 10 observed, 1 partial (A6 — runtime receipt behavior needs a live `spur serve` occupant; named, not invented). Installed-target coverage explicit: 83 `sp-*` dirs swept, 0/83 carry `role:` frontmatter.
- **Comparisons (R2):** selector semantics (A2/A8), quota ownership (A3/A4 vs B6 run-once producer), role pins (A8/A9), reuse/fresh sessions (A9 YAML pins vs A10 prose absence), capability fallback (A4 capabilities rows), receipt identity (A5/A6), mutation policy (task-pipeline.yaml:355 guard + resilience test). Findings F1–F7 + hypothesis H1, each citing current source and asserted guidance.
- **Sync capture (R3):** one `feature sync --all --dry-run --json`, exit 0, this run: 147 total, 138 evaluated, **0 applied** (dry-run). Proposals for covered features: D62→done, E6→done, B1→done, B3→done, G1→done, G4→done, G65→done, I4→done ("All linked tasks are terminal and L4 AC gate passed"); I31→active ("linked tasks contain active work"); I7 and P produced no proposal rows (zero linked tasks). Proposed statuses used only in this report; roster conclusions for D62 verified via `task show 0866|0874|0882` (all done). Zero status mutations.
- **Journeys (R4):** J1 inspect/select executor, J2 dispatch one task, J3 send/wait a request, J4 recover an interrupted member — all four mapped to existing commands, identity keys, receipts, and failure outcomes (see JSON `journeys[]`). Simplification dispositions: F2 help-string alignment and wait-vocabulary dedup recorded for demonstrated redundancy; J1/J2/J4 show no demonstrated redundant step — no removal proposed (compatibility stays open at U1).
- **Dispositions (R5):** every finding carries exactly one disposition + owner or unowned marker — F1 stale-prose (I7), F2 stale-prose (B1-candidate / U2 unowned), F3 absent-adoption (unowned, I31 program), F4 unverified-behavior (B3+I4), F5 shipped-behavior (no action), F6 unverified-behavior (0904), H1 unverified-behavior hypothesis (0904), F7 already-owned-work (D62). No new feature/task allocation; no existing delivery re-proposed.
- **Handoff (R6):** `scenarios[]` SC1–SC5 with modes inline|pipeline|fleet give 0905 a deterministic input set; every scenario references existing surface/finding IDs.

## Smallest follow-up per confirmed finding

| Finding | Smallest slice | Owner |
| --- | --- | --- |
| F1 | One-line recipe correction in wayfinder/SKILL.md:123 + I7 R2 semantic parity layer | I7 |
| F2 | Align `apps/cli/src/commands/agent.ts:290` wording with 0687 R3; add help-vs-behavior parity assertion. Public-surface-adjacent → owner decision first (U2) | B1-candidate |
| F3 | One paragraph in cross-cutting.md (role defaults, `session:` option, pin vars) + link to design §4 | unowned (I31) |
| F4 | Reproduce: invoke an installed-adapter command with `--agent auto`, inspect the `resolved` block | B3 + I4 |
| F6/H1 | Run-once `agent usage` capture + fixture populating `since`/`reason`; re-read doctor provenance | 0904 |
| F7 | Content diff registered vs shared workflow copies (U5); D62 closure evidence — no status change made here | D62 |

## Repeatable local check (R7)

```
bun run docs/reports/i31/0903-check.ts    # validates IDs, anchors, coverage, dispositions, scenario refs
```

Result this run: **CHECK-PASS** — see "Checker output" below. (Checker source lives at `docs/reports/i31/0903-check.ts`; re-run after any edit to the JSON.)

## Unknowns and execution constraints

- **U1–U5** carried verbatim in the JSON `unknowns[]` (compatibility tolerance, help-drift ownership, installed-adapter role consumers, doctor provenance reproduction, registered-vs-shared content diff).
- Constraints honored: 90-minute investigation bound, 60-second child-process deadlines, temp-dir-only disposable snippets, no network probes / paid runs / production mutations. A timeout or absent observation is recorded as unknown/partial, never success.

## Checker output

```
$ bun run docs/reports/i31/0903-check.ts
CHECK-PASS: 11 surfaces, 8 findings, 4 journeys, 5 scenarios, 5 unknowns; 10 evidence anchors validated against /Users/robin/xprojects/spur-new
exit=0
```
