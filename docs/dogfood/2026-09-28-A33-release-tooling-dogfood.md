---
status: complete
testee: "A33 repo-release tooling — `scripts/install.sh` (0971) and `scripts/commands/bundle-plugin-lib.ts` (0972)"
classification: gate-behavior
mode: observe-only
max_retry: 0
testee_agent: omitted
started_at: 2026-09-28
finished_at: 2026-09-28
report_path: docs/dogfood/2026-09-28-A33-release-tooling-dogfood.md
protocol: manual — driven inline during the A33 shippable pass (not the sp:dogfood-testing protocol)
---

# Dogfood Report — A33 repo-release tooling integrity

### 1. Testee

- **Repro:** the real installer, `sh scripts/install.sh`, driven end-to-end against a local
  `file://` release directory with an isolated `HOME` and `SPUR_INSTALL`; plus the real generator,
  `bun run build:plugin-lib`, against the live working tree.
- **Scope:** the two A33 tasks — 0971 (verify standalone binary installs against release
  `SHA256SUMS` with atomic replace) and 0972 (derive the inline-run plugin-lib exports and
  declarations from one table).
- **Sample coverage:** 5 installer scenarios (fresh install, upgrade, tampered asset, missing
  checksum file, explicit bypass) and all 3 generated plugin-lib pairs (artifact-digest,
  idea-handoff, inline-run).

### 2. Execution Summary

- **Result:** PASS (0 fixed, 0 unresolved, 2 findings).
- **Steps:** 6 derived, 6 executed.
- **Fix attempts:** 0.

### 3. Monitor Ledger

| Step | Outcome | Evidence |
| --- | --- | --- |
| Plugin-lib regenerated from the table | PASS | `bun run build:plugin-lib` → `git status` shows no change to any `plugins/sp/lib/*.generated.{mjs,d.mts}`: the committed artifacts are exactly reproducible from `INLINE_RUN_EXPORTS` |
| Fresh install from a local release | PASS | exit 0; `spur` = `v1-payload`; executable bit set |
| Upgrade v1 → v2 | PASS | exit 0; `spur` = `v2-payload` — the temp-file + `mv` path replaces the live binary |
| Tampered asset, checksums unchanged | PASS (gate FAILs as intended) | exit 1; `checksum mismatch for spur-darwin-arm64: expected 7943…f368, got 92e7…be29f`; live binary **still** `v2-payload` |
| `SHA256SUMS` absent | PASS (gate FAILs closed) | exit 1; `checksum file unavailable: file://…/SHA256SUMS (set SPUR_SKIP_VERIFY=1 to install unverified)`; live binary still `v2-payload` |
| `SHA256SUMS` absent + `SPUR_SKIP_VERIFY=1` | PASS (documented bypass) | exit 0; `spur` = `v3-payload`; stderr carries `WARNING — installing spur-darwin-arm64 WITHOUT checksum verification` |

### 4. What We Did

Exercised both A33 surfaces through their real entry points rather than their unit seams. The
installer was driven with `SPUR_RELEASE_URL` pointed at a local `file://` release so a verified,
tampered and checksum-less asset could each be presented in turn, with the previous install left in
place to observe whether a failure disturbs it. The plugin-lib generator was run against the live
tree and its output compared with the committed artifacts.

The installer held in every direction: it installs and upgrades a verified asset, refuses a tampered
one and a checksum-less release **without touching the existing install**, and its single bypass
path is explicit and loud. The generator is reproducible — a fresh build of all three pairs is
byte-identical to what is committed, which is the property that makes the one-table refactor safe.

### 5. Issues

#### Fixed

- (none)

#### Unresolved

- (none)

### 6. Findings

- **P3: the installer executes the asset it just verified.** `scripts/install.sh` ends with
  `"${target}" init`, so the downloaded binary runs in the same process tree as the installer. The
  checksum gate is therefore load-bearing for code execution, not just for install correctness — a
  release whose `SHA256SUMS` is wrong fails closed (step 4), which is the right behavior, but it
  also means the `SPUR_SKIP_VERIFY=1` bypass should stay exceptional. Worth stating in the README
  rather than only in the script header.
- **P4: `file://` releases are slow under `timeout`.** A checksum-less `file://` install took ~4 min
  in one run and 25 s in another with an identical tree; the variance is the harness, not the
  installer. Anyone reproducing this by hand should not read the wall time as an installer property.

── Dogfood Summary ──
Result: PASS   (0 fixed, 0 unresolved, 2 findings)
