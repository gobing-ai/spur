---
schema_version: 1
name: Verify standalone binary installs against release SHA256SUMS with atomic replace
status: todo
template: feature-impl
created_at: 2026-09-26T06:35:35.906Z
updated_at: "2026-09-26T06:37:36.050Z"
feature_id: A33

---

## 0971. Verify standalone binary installs against release SHA256SUMS with atomic replace

### Background

Found by `/sp:dev-review scripts` (2026-09-25, SECUA P2 Security).

`scripts/install.sh` is the documented `curl … | sh` installer for users without Bun (`README.md:81`, `apps/cli/README.md:46`, `apps/cli/README.md:55`). Today it:

1. Downloads `spur-<os>-<arch>` from the GitHub Release and `chmod +x`s it with **no integrity check** (`scripts/install.sh:51-52`). A tampered or corrupted asset is installed and then executed (`"${target}" init`, `:56`).
2. Writes the download **directly over the live binary** (`curl … -o "${target}"`). An interrupted or failed transfer leaves a truncated/empty file where a working `spur` used to be.

No release step produces checksums: `scripts/commands/build-binaries.ts` only compiles the four targets into `dist/cli/`, and nothing under `scripts/` or `.github/` mentions `sha256`/`checksum`. The binaries are built with `bun run build:binaries` (`apps/cli/package.json:47`) and uploaded to the GitHub Release by hand; CI (`.github/workflows/publish.yml`) publishes only the npm package.

This task closes both defects without touching CI: the build emits `SHA256SUMS`, and the installer verifies it and swaps the binary in atomically.

### Requirements

- [ ] R1. `buildBinaries()` (`scripts/commands/build-binaries.ts`) writes `dist/cli/SHA256SUMS` after all four targets compile. The file has exactly one line per asset in `TARGETS` order, in GNU `sha256sum` format: `<64 lowercase hex>␠␠spur-<os>-<arch>\n`. The digest is computed with `Bun.CryptoHasher('sha256')`. No SHA256SUMS is written when any target fails; the existing `throw` stays. The formatting lives in an exported pure helper `writeSha256Sums(dir: string, assetNames: readonly string[]): Promise<string>` that hashes `<dir>/<name>` and writes and returns the file content, so it can be tested without cross-compiling.
- [ ] R2. `scripts/install.sh` downloads the binary to a temp file created in `INSTALL_DIR`, never directly to `${target}`. Use `mktemp "${INSTALL_DIR}/.spur-install.XXXXXX"`: the same directory keeps the final `mv` an atomic rename. A `trap` removes the temp files on EXIT/INT/TERM. On any failure the pre-existing `${target}` is byte-identical to before.
- [ ] R3. The installer downloads `SHA256SUMS` from the same release base URL as the asset (`…/releases/latest/download/SHA256SUMS` or `…/releases/download/${VERSION}/SHA256SUMS`). It picks the line whose second field equals `${asset}` and compares that digest with the downloaded temp file's digest. It uses `sha256sum` when present, else `shasum -a 256`, and fails loudly (`err`) when neither exists. A mismatch fails with `checksum mismatch for <asset>: expected <x>, got <y>`. A missing entry for the asset fails with `no SHA256SUMS entry for <asset>`.
- [ ] R4. A missing or undownloadable `SHA256SUMS` fails by default, naming the URL. The one explicit escape hatch is `SPUR_SKIP_VERIFY=1`: it prints `spur-install: WARNING — installing <asset> WITHOUT checksum verification` to stderr and continues. No other silent fallback.
- [ ] R5. Only after verification passes: `chmod +x` the temp file, `mv -f` it onto `${target}`, then run the existing `init` seeding and PATH hint unchanged.
- [ ] R6. A new env override `SPUR_RELEASE_URL` replaces the computed base URL (`https://github.com/${REPO}/releases/{latest/download|download/${VERSION}}`) when set. The asset and SHA256SUMS are fetched from `${SPUR_RELEASE_URL}/<name>`. It is documented in the header's Overrides block as "mirror / test base URL". This is what makes the installer testable hermetically with `file://` URLs, and curl supports `file://`.
- [ ] R7. The script stays POSIX `sh` (`#!/usr/bin/env sh`, `set -eu`): no bash-isms (`[[`, arrays, `pipefail`, `local`). Run `shellcheck -s sh scripts/install.sh` if shellcheck is installed; it must be clean.
- [ ] R8. Docs:
  - `apps/cli/README.md` (installer section around `:46-55`) gains a short "Verification" note: the installer checks `SHA256SUMS`, and `SPUR_SKIP_VERIFY=1` is the explicit bypass.
  - It also gains a "Releasing standalone binaries" note: run `bun run build:binaries` in `apps/cli`, then upload **all** of `dist/cli/spur-*` **and** `dist/cli/SHA256SUMS` to the GitHub Release for the tag.
  - `README.md:81` gets a one-line pointer only.

### Acceptance Criteria

Graduates feature A33 scenarios R1–R3 (exact titles below).

- [ ] AC1 — R1 — Release build publishes checksums for every binary (req: R1)
- [ ] AC2 — R2 — Installer rejects a binary whose checksum does not match (req: R2, R3, R5)
- [ ] AC3 — R3 — Failed download never destroys a working install (req: R2, R4)

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

**Rollout caveat (must handle)**: the currently published release has no `SHA256SUMS`, so the new installer fails by default against `latest` until a release carries one. Before merging, do one of the following (record which in Solution):
- (a) Generate SHA256SUMS for the current release's assets (`gh release download <tag> -p 'spur-*'`, then `shasum -a 256 spur-* > SHA256SUMS`) and `gh release upload <tag> SHA256SUMS`. This is an outward-facing action, so ask the operator first.
- (b) Land it together with the next binary release.

### Plan

1. `build-binaries.ts`: add exported `writeSha256Sums`; call it at the end of `buildBinaries` when there are no failures; log `Wrote SHA256SUMS (4 entries)`.
2. `build-binaries.test.ts`: AC1 tests. The test must not call `buildBinaries` (cross-compile is slow).
3. `install.sh`: add the `SPUR_RELEASE_URL` override, temp file + trap, SHA256SUMS fetch and verify, `SPUR_SKIP_VERIFY`, and `chmod` + `mv`. Update the header Overrides block (`SPUR_RELEASE_URL`, `SPUR_SKIP_VERIFY`).
4. `install-sh.test.ts`: the five AC2/AC3/R4 cases, using `file://` releases in `mkdtemp` dirs. Clean up in `afterEach`.
5. Docs per R8.
6. Run `(cd scripts/.. && bun test scripts/commands/build-binaries.test.ts scripts/commands/install-sh.test.ts)`, then `bun run spur-check`.
7. Handle the rollout caveat (Design): ask the operator (a) vs (b) before merge.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `scripts/install.sh:39-56`: URL computation, download, chmod, init.
- `scripts/commands/build-binaries.ts:12-45`: TARGETS map and compile loop.
- `apps/cli/package.json:47`: `build:binaries`.
- `apps/cli/README.md:46-55`, `README.md:81`: installer docs.
- `.github/workflows/publish.yml`: npm-only publish; do NOT edit without approval.
- Review origin: `/sp:dev-review scripts` 2026-09-25, finding "install.sh: no checksum, in-place overwrite" (P2 Security).

### History

- 2026-09-26T06:37:36.050Z backlog → todo (system)

