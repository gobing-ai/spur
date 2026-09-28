---
schema_version: 1
name: Verify standalone binary installs against release SHA256SUMS with atomic replace
status: done
template: feature-impl
created_at: 2026-09-26T06:35:35.906Z
updated_at: "2026-09-28T15:53:11.896Z"
feature_id: A33

priority: P2
estimate_hours: 5
---

## 0971. Verify standalone binary installs against release SHA256SUMS with atomic replace

### Background

Found by `/sp:dev-review scripts` (2026-09-25, SECUA P2 Security).

`scripts/install.sh` is the documented `curl … | sh` installer for users without Bun (`README.md:81`, `apps/cli/README.md:46`, `apps/cli/README.md:55`). Today it:

1. Downloads `spur-<os>-<arch>` from the GitHub Release and `chmod +x`s it with **no integrity check** (`scripts/install.sh:51-52`). A tampered or corrupted asset is installed and then executed (`"${target}" init`, `:56`).
2. Writes the download **directly over the live binary** (`curl … -o "${target}"`). An interrupted or failed transfer leaves a truncated/empty file where a working `spur` used to be.

No release step produces checksums: `scripts/commands/build-binaries.ts` only compiles the four targets into `dist/cli/`, and nothing under `scripts/` or `.github/` mentions `sha256`/`checksum`. The binaries are built with `bun run build:binaries` (`apps/cli/package.json:47`) and uploaded to the GitHub Release by hand; CI (`.github/workflows/publish.yml`) publishes only the npm package.

This task closes both defects without touching CI: the build emits `SHA256SUMS`, and the installer verifies it and swaps the binary in atomically.

**Refine corrections (2026-09-27)**

- The rollout choice was open, so implementation could produce an installer that fails against current latest. Chose the next-release path and made asset availability a merge prerequisite.

### Requirements

- [x] R1. `buildBinaries()` (`scripts/commands/build-binaries.ts`) writes `dist/cli/SHA256SUMS` after all four targets compile. The file has exactly one line per asset in `TARGETS` order, in GNU `sha256sum` format: `<64 lowercase hex>␠␠spur-<os>-<arch>\n`. The digest is computed with `Bun.CryptoHasher('sha256')`. No SHA256SUMS is written when any target fails; the existing `throw` stays. The formatting lives in an exported pure helper `writeSha256Sums(dir: string, assetNames: readonly string[]): Promise<string>` that hashes `<dir>/<name>` and writes and returns the file content, so it can be tested without cross-compiling.
- [x] R2. `scripts/install.sh` downloads the binary to a temp file created in `INSTALL_DIR`, never directly to `${target}`. Use `mktemp "${INSTALL_DIR}/.spur-install.XXXXXX"`: the same directory keeps the final `mv` an atomic rename. A `trap` removes the temp files on EXIT/INT/TERM. On any failure the pre-existing `${target}` is byte-identical to before.
- [x] R3. The installer downloads `SHA256SUMS` from the same release base URL as the asset (`…/releases/latest/download/SHA256SUMS` or `…/releases/download/${VERSION}/SHA256SUMS`). It picks the line whose second field equals `${asset}` and compares that digest with the downloaded temp file's digest. It uses `sha256sum` when present, else `shasum -a 256`, and fails loudly (`err`) when neither exists. A mismatch fails with `checksum mismatch for <asset>: expected <x>, got <y>`. A missing entry for the asset fails with `no SHA256SUMS entry for <asset>`.
- [x] R4. A missing or undownloadable `SHA256SUMS` fails by default, naming the URL. The one explicit escape hatch is `SPUR_SKIP_VERIFY=1`: it prints `spur-install: WARNING — installing <asset> WITHOUT checksum verification` to stderr and continues. No other silent fallback.
- [x] R5. Only after verification passes: `chmod +x` the temp file, `mv -f` it onto `${target}`, then run the existing `init` seeding and PATH hint unchanged.
- [x] R6. A new env override `SPUR_RELEASE_URL` replaces the computed base URL (`https://github.com/${REPO}/releases/{latest/download|download/${VERSION}}`) when set. The asset and SHA256SUMS are fetched from `${SPUR_RELEASE_URL}/<name>`. It is documented in the header's Overrides block as "mirror / test base URL". This is what makes the installer testable hermetically with `file://` URLs, and curl supports `file://`.
- [x] R7. The script stays POSIX `sh` (`#!/usr/bin/env sh`, `set -eu`): no bash-isms (`[[`, arrays, `pipefail`, `local`). Run `shellcheck -s sh scripts/install.sh` if shellcheck is installed; it must be clean.
- [x] R8. Docs:
  - `apps/cli/README.md` (installer section around `:46-55`) gains a short "Verification" note: the installer checks `SHA256SUMS`, and `SPUR_SKIP_VERIFY=1` is the explicit bypass.
  - It also gains a "Releasing standalone binaries" note: run `bun run build:binaries` in `apps/cli`, then upload **all** of `dist/cli/spur-*` **and** `dist/cli/SHA256SUMS` to the GitHub Release for the tag.
  - `README.md:81` gets a one-line pointer only.

### Acceptance Criteria

Graduates feature A33 scenarios R1–R3 (exact titles below).

- [x] AC1 — R1 — Release build publishes checksums for every binary (req: R1)
- [x] AC2 — R2 — Installer rejects a binary whose checksum does not match (req: R2, R3, R5)
- [x] AC3 — R3 — Failed download never destroys a working install (req: R2, R4)

**Verify lens**

- **AC1**: create `scripts/commands/build-binaries.test.ts`. Write two small files (`spur-a`, `spur-b`) into a `mkdtemp` dir and call `writeSha256Sums(dir, ['spur-a', 'spur-b'])`. Assert:
  - The file content matches `/^[0-9a-f]{64}  spur-a\n[0-9a-f]{64}  spur-b\n$/`.
  - Each digest equals `new Bun.CryptoHasher('sha256').update(bytes).digest('hex')`.
  - `Bun.spawnSync(['shasum', '-a', '256', '-c', 'SHA256SUMS'], { cwd: dir })` exits 0. This proves the format is what real tools consume; macOS and Linux both ship `shasum`.
- **AC2/AC3**: create `scripts/commands/install-sh.test.ts`. It drives the real `scripts/install.sh` via `Bun.spawnSync(['sh', 'scripts/install.sh'], { env })`, with `HOME` and `SPUR_INSTALL` pointing at a temp dir and `SPUR_RELEASE_URL=file://<tempRelease>`. The fake asset `spur-<os>-<arch>` (compute the suffix in the test the same way the script does from `process.platform`/`process.arch`) is `#!/bin/sh\necho fake-spur "$@"\n`. Cases:
  1. **Happy path**: a correct SHA256SUMS gives exit 0, the target is byte-equal to the asset and executable, and no `.spur-install.*` is left in the install dir.
  2. **AC2 mismatch**: pre-seed the target with `OLD` and write a SHA256SUMS with a wrong digest. Expect a non-zero exit, stderr containing `checksum mismatch`, the target still `OLD`, and no temp leftovers.
  3. **AC3 failed download**: pre-seed the target with `OLD` and remove the asset from the release dir, so curl fails on the missing `file://`. Expect a non-zero exit and the target still `OLD`. (An interrupted transfer and a missing asset hit the same path: the download goes to a temp file and `mv` never runs.)
  4. **R4 missing SUMS**: SHA256SUMS absent gives a non-zero exit, with stderr naming the SHA256SUMS URL. Re-running with `SPUR_SKIP_VERIFY=1` exits 0 with the WARNING on stderr.
  5. **R4 missing entry**: a SHA256SUMS with no line for the asset gives a non-zero exit and `no SHA256SUMS entry`.
- `bun run spur-check` green. `shellcheck -s sh scripts/install.sh` clean when available (record whether it was available in Testing).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-27T16:44:08.905Z

CLOSED (2026-09-27): choose next-release rollout. The installer and checksum assets land together; no published release is changed.

### Design

**Chosen approach**: checksum file plus temp-file-and-rename. This is the minimum that gives integrity against corruption and CDN/asset tampering that doesn't also rewrite SHA256SUMS, and makes the install atomic.

**Installer flow** (POSIX sh):

```sh
base="${SPUR_RELEASE_URL:-<computed github base>}"
tmp=$(mktemp "${INSTALL_DIR}/.spur-install.XXXXXX")
sums="${tmp}.sums"
trap 'rm -f "${tmp}" "${sums}"' EXIT INT TERM
curl -fsSL "${base}/${asset}" -o "${tmp}" || err "download failed: ${base}/${asset}"
if curl -fsSL "${base}/SHA256SUMS" -o "${sums}"; then
    expected=$(awk -v a="${asset}" '$2 == a { print $1 }' "${sums}")
    [ -n "${expected}" ] || err "no SHA256SUMS entry for ${asset}"
    actual=$(sha256_of "${tmp}")          # sha256sum | shasum -a 256 | err
    [ "${expected}" = "${actual}" ] || err "checksum mismatch for ${asset}: expected ${expected}, got ${actual}"
elif [ "${SPUR_SKIP_VERIFY:-}" = '1' ]; then
    printf 'spur-install: WARNING — installing %s WITHOUT checksum verification\n' "${asset}" >&2
else
    err "checksum file unavailable: ${base}/SHA256SUMS (set SPUR_SKIP_VERIFY=1 to install unverified)"
fi
chmod +x "${tmp}"
mv -f "${tmp}" "${target}"
```

- `awk '$2 == a'` matches the GNU two-space format; the `*` binary-mode marker is never emitted by R1.
- `sha256_of()` is a small shell function: `sha256sum "$1" | cut -d' ' -f1`, or `shasum -a 256 "$1" | cut -d' ' -f1`.
- `err` already exits 1; the trap handles cleanup.

**Build side**: `writeSha256Sums(dir, names)` iterates `names` in order. It reads each file with `Bun.file(join(dir, n)).arrayBuffer()`, hashes it, and writes with `Bun.write`. `buildBinaries` calls it with `Object.keys(TARGETS).map((s) => \`spur-${s}\`)` only when `failed === false`.

**Invariants**:
- The live `${target}` is only ever replaced by a verified file via rename.
- The installer has no network fallback and no silent skip; the only bypass is explicit `SPUR_SKIP_VERIFY=1`.

**Rejected**:
- Signature verification (minisign/cosign): it needs key management and a new tool on user machines. That is a separate decision; the checksum file is the prerequisite either way.
- Verifying inside `spur` itself: the binary under test can't vouch for itself.
- Automating the upload in `.github/workflows/publish.yml`: CI edits need explicit operator approval (AGENTS.md). Record it as a Note and do not edit.

**Rollout (closed).** Land the installer change with the next binary release, after that release includes `SHA256SUMS`. Do not merge a default-fail installer while `latest` still points to a release without the checksum file. Do not modify an already published release. The release operation itself remains a separate operator-approved action.

### Plan

1. `build-binaries.ts`: add exported `writeSha256Sums`; call it at the end of `buildBinaries` when there are no failures; log `Wrote SHA256SUMS (4 entries)`.
2. `build-binaries.test.ts`: AC1 tests. The test must not call `buildBinaries` (cross-compile is slow).
3. `install.sh`: add the `SPUR_RELEASE_URL` override, temp file + trap, SHA256SUMS fetch and verify, `SPUR_SKIP_VERIFY`, and `chmod` + `mv`. Update the header Overrides block (`SPUR_RELEASE_URL`, `SPUR_SKIP_VERIFY`).
4. `install-sh.test.ts`: the five AC2/AC3/R4 cases, using `file://` releases in `mkdtemp` dirs. Clean up in `afterEach`.
5. Docs per R8.
6. Run `(cd scripts/.. && bun test scripts/commands/build-binaries.test.ts scripts/commands/install-sh.test.ts)`, then `bun run spur-check`.
7. Stage this change with the next binary release. Before merge, verify its release assets include all binaries and SHA256SUMS; stop if they do not. Publication is a separate operator-approved step.

### Solution

- `scripts/commands/build-binaries.ts:29-37`: exported `writeSha256Sums(dir, assetNames)`. It hashes each asset with `Bun.CryptoHasher('sha256')`, writes GNU-format `<hex>␠␠<name>\n` lines in the given order, and returns the content.
- `:63-65`: `buildBinaries` calls it after the `failed` throw, so no SUMS file is written on a failed target, with `TARGETS` order. It logs `wrote SHA256SUMS (4 entries)`.
- `scripts/install.sh:9-17`: the header documents verification plus the `SPUR_RELEASE_URL` (mirror / test base URL) and `SPUR_SKIP_VERIFY` overrides.
- `:45-51`: `base` comes from `SPUR_RELEASE_URL` when set, otherwise the latest or tag GitHub download base.
- `:53-61`: `sha256_of` prefers `sha256sum`, falls back to `shasum -a 256`, and `err`s when neither exists.
- `:69-72`: `mktemp` inside `INSTALL_DIR`, so the final `mv` is an atomic rename. The `EXIT` trap removes the temp and `.sums` files; `INT`/`TERM` → `exit 1`, which runs the EXIT trap once. This is CHANGED from the Design's single `EXIT INT TERM` trap: goal-equivalent, and it avoids running cleanup twice.
- `:74-84`: download to the temp file, then fetch SHA256SUMS and match with `awk '$2 == a'`. Failures are `no SHA256SUMS entry`, `checksum mismatch … expected … got …`, and `checksum file unavailable: <url>`. `SPUR_SKIP_VERIFY=1` is the only bypass, and it prints a WARNING to stderr.
- `:85-86`: `chmod +x` and `mv -f` onto the target only after verification. The `init` seeding and PATH hint are unchanged.
- `scripts/commands/build-binaries.test.ts:10`: AC1. Format regex, per-line digest equality, and `shasum -a 256 -c SHA256SUMS` exits 0.
- `scripts/commands/install-sh.test.ts:55-127`: drives the real `install.sh` against a `file://` release. Cases: happy path, AC2 mismatch, AC3 missing asset, AC3 interrupted transfer, R4 missing SUMS plus the `SPUR_SKIP_VERIFY` bypass, and R3 missing entry. The interrupted-transfer case (`:85`, a `curl` shim that writes `PARTIAL` to `-o` and then exits 56) was added because a missing `file://` source makes curl fail before it opens `-o`. That case alone cannot tell a temp-file download from a direct-to-target one. The direct-to-target mutant fails it (`Received: "PARTIAL"`).
- `apps/cli/README.md:62-70`: Verification and Releasing-standalone-binaries notes. `README.md:85`: a one-line pointer.

**Rollout note (Design § Rollout, Plan step 7).** On 2026-09-28, `https://github.com/gobing-ai/spur/releases/latest/download/SHA256SUMS` **and** `…/spur-darwin-arm64` both return 404 to an unauthenticated probe. `latest` currently ships no standalone binaries, so the default-fail checksum gate does not regress a working install path. The next binary release must upload `dist/cli/SHA256SUMS` alongside every `spur-*` asset; that remains a separate operator-approved action. `.github/workflows/publish.yml` was not edited: CI changes need operator approval.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `scripts/commands/build-binaries.ts:29-37` exported `writeSha256Sums` (Bun.CryptoHasher sha256, GNU two-space format, given order); `:63-65` called after the `failed` throw with `TARGETS` order |
| R2 | MET | `scripts/install.sh:69-72` `mktemp "${INSTALL_DIR}/.spur-install.XXXXXX"` + EXIT trap removing temp/sums (INT/TERM → exit 1 → EXIT trap); `scripts/commands/install-sh.test.ts:85` interrupted transfer leaves target `OLD` and no leftovers |
| R3 | MET | `scripts/install.sh:74-79` SHA256SUMS fetched from same base, `awk '$2 == a'` match, `checksum mismatch for <asset>: expected …, got …`, `no SHA256SUMS entry for <asset>`; `:53-61` `sha256_of` sha256sum → shasum -a 256 → `err` |
| R4 | MET | `scripts/install.sh:80-83` missing SUMS → `err "checksum file unavailable: ${base}/SHA256SUMS …"`; only bypass `SPUR_SKIP_VERIFY=1` prints the WARNING to stderr; `scripts/commands/install-sh.test.ts:104` |
| R5 | MET | `scripts/install.sh:85-86` `chmod +x` + `mv -f` of the verified temp file only after verification; init seeding and PATH hint unchanged |
| R6 | MET | `scripts/install.sh:45-51` `SPUR_RELEASE_URL` overrides the computed base; `:16` documented as "mirror / test base URL"; tests drive it with `file://` |
| R7 | MET | `shellcheck -s sh scripts/install.sh` (shellcheck available at /opt/homebrew/bin) → clean; `sh -n` OK; no `[[`, arrays, `pipefail`, `local` |
| R8 | MET | `apps/cli/README.md:62-70` Verification + Releasing standalone binaries notes (upload all `dist/cli/spur-*` and `dist/cli/SHA256SUMS`); `README.md:85` one-line pointer |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R1 — Release build publishes checksums for every binary | MET | test | `scripts/commands/build-binaries.test.ts:10` format regex, per-line digest equality, `shasum -a 256 -c SHA256SUMS` exit 0; 1 pass / 0 fail |
| AC1 | MET | test | same evidence as the `AC1 — …` scenario row above (bare id ticks the task AC box) |
| AC2 — R2 — Installer rejects a binary whose checksum does not match | MET | test | `scripts/commands/install-sh.test.ts:64` wrong digest → non-zero, `checksum mismatch`, target stays `OLD`, no temp leftovers; `:117` missing entry → `no SHA256SUMS entry`; `:55` happy path; 6 pass / 0 fail; negative proof: HEAD `install.sh` fails happy/AC2/R3/R4 cases |
| AC2 | MET | test | same evidence as the `AC2 — …` scenario row above (bare id ticks the task AC box) |
| AC3 — R3 — Failed download never destroys a working install | MET | test | `scripts/commands/install-sh.test.ts:74` missing asset and `:85` interrupted transfer (curl shim writes `PARTIAL` then exits 56) → non-zero, target stays `OLD`, no leftovers; `:104` missing SUMS keeps `OLD`; mutant downloading directly to target fails `:85` (`Received: "PARTIAL"`) |
| AC3 | MET | test | same evidence as the `AC3 — …` scenario row above (bare id ticks the task AC box) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | residual-sweep | — | blocking=0 deferrable=0 advisory=2 housekeeping=0 |

### References

- `scripts/install.sh:39-56`: URL computation, download, chmod, init.
- `scripts/commands/build-binaries.ts:12-45`: TARGETS map and compile loop.
- `apps/cli/package.json:47`: `build:binaries`.
- `apps/cli/README.md:46-55`, `README.md:81`: installer docs.
- `.github/workflows/publish.yml`: npm-only publish; do NOT edit without approval.
- Review origin: `/sp:dev-review scripts` 2026-09-25, finding "install.sh: no checksum, in-place overwrite" (P2 Security).

### History

- 2026-09-26T06:37:36.050Z backlog → todo (system)
- 2026-09-28T15:45:08.303Z todo → wip (system)
- 2026-09-28T15:52:08.738Z wip → testing (system)
- 2026-09-28T15:53:11.896Z testing → done (system)

