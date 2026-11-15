---
schema_version: 1
name: Add optional zg and a2a installation support
status: done
template: issue
created_at: 2026-11-15T22:22:05.169Z
updated_at: "2026-11-15T22:41:37.680Z"

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close
---

## 1340. Add optional zg and a2a installation support

### Background

Captured from the creation title: "Add optional zg and a2a installation support".

### Requirements

- [x] R1. `scripts/install.sh` must detect `zg` and `a2a` independently and skip already-installed CLIs without invoking a package manager.
- [x] R2. Missing CLIs use Homebrew when available, npm for zg otherwise, and the official a2a install script otherwise; all three fallbacks remain optional and do not alter the verified Spur binary path.
- [x] R3. Missing package managers or failed dependency installs emit actionable warnings with the exact manual commands and never abort the verified Spur installation; `SPUR_INSTALL_ZG=0` and `SPUR_INSTALL_A2A=0` explicitly disable each optional install.
- [x] R4. `scripts/commands/install-sh.test.ts` proves present/missing CLIs, Homebrew, npm, official-a2a fallback, missing-manager warning, and opt-out behavior; installer docs and ADR-147 describe the optional setup contract.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Existing CLIs are idempotent (req: R1)
Given `zg` and `a2a` already on PATH
When the installer runs
Then it does not invoke Homebrew, npm, or the official a2a installer.

Scenario: AC2 — Missing CLIs use the documented fallbacks (req: R2)
Given one or both CLIs are absent
When Homebrew, npm, or only curl is available
Then the installer uses Homebrew first, npm for zg otherwise, and the official a2a installer otherwise, then rechecks both commands.

Scenario: AC3 — Optional setup never blocks Spur (req: R3)
Given no usable package manager or an opt-out flag
When the installer runs
Then it warns with the exact manual remedy and still installs the verified Spur binary; `SPUR_INSTALL_ZG=0` and `SPUR_INSTALL_A2A=0` disable only their own dependency step.

Scenario: AC4 — Contract is documented (req: R4)
Given installer documentation and ADR-147
When the optional setup behavior is reviewed
Then they name the idempotent detection, fallback commands, opt-outs, and non-fatal warning contract.
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Keep the verified Spur download/replace flow unchanged. After it completes, independently detect `zg` and `a2a`. Prefer Homebrew for both; use npm only for zg when brew is absent, and the official a2a install script only for a2a when brew is absent. Dependency setup is best-effort: missing managers or failed installs warn with exact manual remedies and do not abort Spur. Opt-outs default on and can disable each dependency separately. Do not change the checksum gate, supported OS list, or init behavior.

### Plan

- [x] Add failing external-dependency installer regressions.
- [x] Implement optional idempotent zg/a2a setup and fallback warnings in `scripts/install.sh`.
- [x] Update installer docs and ADR-147; run focused installer tests and the required gate.

### Root Cause

`scripts/install.sh` only downloads and verifies the Spur binary and seeds global config. It has no detection or installation path for zg (`@zvec/zvec-grep`, used by hybrid search) or a2a (used by fleet transport), so users can finish installation without two external runtime prerequisites. Existing installer tests cover only the Spur binary/checksum path and give no regression coverage for external dependencies.

### Solution

| File | Change | Why |
| --- | --- | --- |
| `scripts/install.sh:20-21,70-137` | Added independent, idempotent zg/a2a detection and installation. Homebrew is preferred, npm is the zg fallback, and the official a2a installer is the a2a fallback. Missing managers or failed installs warn with exact manual remedies and do not abort Spur. `SPUR_INSTALL_ZG=0` and `SPUR_INSTALL_A2A=0` disable each optional step. | Makes the two external runtime dependencies available without changing the verified binary/checksum path. |
| `scripts/commands/install-sh.test.ts:134-254` | Added hermetic regressions for existing CLIs, Homebrew, npm + official-a2a fallback, missing-manager warnings, and independent opt-outs. | Proves every setup branch and non-fatal behavior without network or real package installs. |
| `apps/cli/README.md:73-78` | Documented optional external CLIs, fallback order, warnings, opt-outs, and idempotency. | Users can discover the setup contract and controls. |
| `README.md:83-85` | Added the optional zg/a2a setup pointer. | Keeps the top-level install guidance linked to the complete contract. |
| `docs/00_ADR.md:2813-2818` | Amended ADR-147 with the optional installer behavior. | Clarifies that setup assistance does not bundle zg or change runtime ownership. |
| `docs/design/hybrid-search.md:23-25` | Recorded that installer assistance does not make zg a bundled capability. | Keeps the search design's external-dependency boundary explicit. |

Probe: `sh -n scripts/install.sh` and `shellcheck -s sh scripts/install.sh` clean; `bun test scripts/commands/install-sh.test.ts` — 11/11 PASS, including all original checksum cases and five new dependency cases.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `scripts/install.sh:73-75,88-90`; `scripts/commands/install-sh.test.ts:134-146` proves no package-manager calls for existing CLIs. |
| R2 | MET | `scripts/install.sh:77-110`; `scripts/commands/install-sh.test.ts:148-213` covers Homebrew and npm + official-a2a fallbacks. |
| R3 | MET | `scripts/install.sh:73-75,88-90,94-96,101-110`; `scripts/commands/install-sh.test.ts:215-254` covers warnings and both opt-outs. |
| R4 | MET | `scripts/commands/install-sh.test.ts:134-254`; `apps/cli/README.md:73-78`; `docs/00_ADR.md:2813-2818`; `docs/design/hybrid-search.md:23-25`; `README.md:83-85`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `scripts/commands/install-sh.test.ts:134-146` proves existing zg/a2a are never reinstalled. |
| AC2 | MET | test | `scripts/commands/install-sh.test.ts:148-213` proves Homebrew, npm and official-a2a fallback installation. |
| AC3 | MET | test | `scripts/commands/install-sh.test.ts:215-254` proves warning-only degradation and independent opt-outs. |
| AC4 | MET | command | `sh -n scripts/install.sh` and `shellcheck -s sh scripts/install.sh` clean; docs anchors in R4. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| P4 (advisory) | Optional dependency setup intentionally degrades to warnings instead of blocking Spur installation when a package manager is unavailable. | ACCEPTED | `scripts/install.sh:70-137`; `scripts/commands/install-sh.test.ts:215-235` proves Spur still installs with manual-remedy warnings. |

| Check | Status | Evidence |
| --- | --- | --- |
| design-conformance | pass | 4/4 claims DONE: independent detection, fallback order, opt-outs/warnings, and documentation. |
| SECUA | pass | Checksum verification and atomic replacement are unchanged; only the official a2a installer is downloaded, which itself verifies release checksums. |
| architecture | pass | No new dependency is bundled or reimplemented; zg/a2a remain external CLIs behind their existing adapters. |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `scripts/install.sh:73-75,88-90`; `scripts/commands/install-sh.test.ts:134-146` proves no package-manager calls for existing CLIs. |
| R2 | MET | `scripts/install.sh:77-110`; `scripts/commands/install-sh.test.ts:148-213` covers Homebrew and npm + official-a2a fallbacks. |
| R3 | MET | `scripts/install.sh:73-75,88-90,94-96,101-110`; `scripts/commands/install-sh.test.ts:215-254` covers warnings and both opt-outs. |
| R4 | MET | `scripts/commands/install-sh.test.ts:134-254`; `apps/cli/README.md:73-78`; `docs/00_ADR.md:2813-2818`; `docs/design/hybrid-search.md:23-25`; `README.md:83-85`. |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 | MET | test | `scripts/commands/install-sh.test.ts:134-146` proves existing zg/a2a are never reinstalled. |
| AC2 | MET | test | `scripts/commands/install-sh.test.ts:148-213` proves Homebrew, npm and official-a2a fallback installation. |
| AC3 | MET | test | `scripts/commands/install-sh.test.ts:215-254` proves warning-only degradation and independent opt-outs. |
| AC4 | MET | command | `sh -n scripts/install.sh` and `shellcheck -s sh scripts/install.sh` clean; docs anchors in R4. |

| Verification | Result |
| --- | --- |
| `task gate 1340 run` | PASS — full-tier receipt `.spur/run/1340-check-receipt.json`. |
| `bun test scripts/commands/install-sh.test.ts` | 11/11 PASS: 6 checksum cases + 5 optional dependency cases. |
| `sh -n` and `shellcheck` | Both clean. |

Verdict: PASS

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-11-15T22:39:42.409Z todo → wip (system)
- 2026-11-15T22:41:36.778Z wip → testing (system)
- 2026-11-15T22:41:37.581Z testing → done (system)

