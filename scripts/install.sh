#!/usr/bin/env sh
# Spur standalone installer — for users without Bun on PATH.
#
# Downloads the compiled `spur` binary from a GitHub Release and installs it to a
# directory on PATH, then seeds the global config via `spur init`. Users who have
# Bun should prefer `npm i -g @gobing-ai/spur` (smaller, auto-updates via npm).
#
#   curl -fsSL https://raw.githubusercontent.com/gobing-ai/spur/main/scripts/install.sh | sh
#
# The binary is verified against the release's SHA256SUMS before it replaces an
# existing install; a failed download or mismatch leaves the old binary untouched.
# The checksum is a code-execution boundary, not just an integrity check: this
# script then runs the binary it downloaded (`spur init`), so keep
# SPUR_SKIP_VERIFY=1 exceptional.
#
# Overrides:
#   SPUR_VERSION      release tag to install          (default: latest)
#   SPUR_INSTALL      target bin dir                  (default: ~/.local/bin)
#   SPUR_RELEASE_URL  mirror / test base URL          (default: the GitHub release download URL)
#   SPUR_INSTALL_ZG   install zg when missing         (default: 1; set to 0 to skip)
#   SPUR_INSTALL_A2A  install a2a when missing        (default: 1; set to 0 to skip)
#   SPUR_SKIP_VERIFY  set to 1 to install WITHOUT checksum verification
set -eu

REPO='gobing-ai/spur'
VERSION="${SPUR_VERSION:-latest}"
INSTALL_DIR="${SPUR_INSTALL:-${HOME}/.local/bin}"

err() {
    printf 'spur-install: %s\n' "$1" >&2
    exit 1
}

# Map uname output to the release asset suffix. Compiled binaries are
# per-platform, so the asset name encodes os + arch.
os=$(uname -s)
arch=$(uname -m)
case "${os}" in
    Darwin) os='darwin' ;;
    Linux) os='linux' ;;
    *) err "unsupported OS: ${os} (use 'npm i -g @gobing-ai/spur' instead)" ;;
esac
case "${arch}" in
    arm64 | aarch64) arch='arm64' ;;
    x86_64 | amd64) arch='x64' ;;
    *) err "unsupported architecture: ${arch}" ;;
esac

asset="spur-${os}-${arch}"
if [ -n "${SPUR_RELEASE_URL:-}" ]; then
    base="${SPUR_RELEASE_URL}"
elif [ "${VERSION}" = 'latest' ]; then
    base="https://github.com/${REPO}/releases/latest/download"
else
    base="https://github.com/${REPO}/releases/download/${VERSION}"
fi

sha256_of() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | cut -d' ' -f1
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | cut -d' ' -f1
    else
        err 'sha256sum or shasum is required to verify the download'
    fi
}

command -v curl >/dev/null 2>&1 || err 'curl is required but not found'

# Optional external CLIs used by hybrid search (zg) and A2A fleet transport. Each is
# independent and best-effort: a missing package manager never undoes the verified Spur install.
install_zg() {
    [ "${SPUR_INSTALL_ZG:-1}" != '0' ] || {
        printf 'spur-install: skipping zg (SPUR_INSTALL_ZG=0)\n'
        return 0
    }
    if command -v zg >/dev/null 2>&1; then return 0; fi
    if command -v brew >/dev/null 2>&1; then
        brew install zvec-grep || printf 'spur-install: WARNING — zg install failed; install manually with: brew install zvec-grep\n' >&2
    elif command -v npm >/dev/null 2>&1; then
        npm install -g @zvec/zvec-grep --allow-scripts=@zvec/zvec-grep || printf 'spur-install: WARNING — zg install failed; install manually with: npm install -g @zvec/zvec-grep --allow-scripts=@zvec/zvec-grep\n' >&2
    else
        printf 'spur-install: WARNING — zg is optional but not installed; install with: brew install zvec-grep (or npm install -g @zvec/zvec-grep --allow-scripts=@zvec/zvec-grep)\n' >&2
    fi
}

install_a2a() {
    [ "${SPUR_INSTALL_A2A:-1}" != '0' ] || {
        printf 'spur-install: skipping a2a (SPUR_INSTALL_A2A=0)\n'
        return 0
    }
    if command -v a2a >/dev/null 2>&1; then return 0; fi
    if command -v brew >/dev/null 2>&1; then
        brew tap a2aproject/a2a-cli https://github.com/a2aproject/a2a-cli || printf 'spur-install: WARNING — a2a tap failed; install manually with: brew tap a2aproject/a2a-cli https://github.com/a2aproject/a2a-cli && brew install a2a\n' >&2
        brew install a2a || printf 'spur-install: WARNING — a2a install failed; install manually with: brew install a2a\n' >&2
    else
        a2a_script=$(mktemp "${INSTALL_DIR}/.a2a-install.XXXXXX")
        if curl -fsSL 'https://raw.githubusercontent.com/a2aproject/a2a-cli/main/install.sh' -o "${a2a_script}"; then
            A2A_INSTALL_DIR="${INSTALL_DIR}" bash "${a2a_script}" || printf 'spur-install: WARNING — a2a install failed; install manually with: curl -fsSL https://raw.githubusercontent.com/a2aproject/a2a-cli/main/install.sh | bash\n' >&2
        else
            printf 'spur-install: WARNING — a2a download failed; install manually with: curl -fsSL https://raw.githubusercontent.com/a2aproject/a2a-cli/main/install.sh | bash\n' >&2
        fi
    fi
}

mkdir -p "${INSTALL_DIR}"
target="${INSTALL_DIR}/spur"
# Download next to the target so the final mv is an atomic rename; the live
# binary is only ever replaced by a verified file.
tmp=$(mktemp "${INSTALL_DIR}/.spur-install.XXXXXX")
sums="${tmp}.sums"
a2a_script=''
trap 'rm -f "${tmp}" "${sums}" "${a2a_script}"' EXIT
trap 'exit 1' INT TERM
printf 'Downloading %s -> %s\n' "${asset}" "${target}"
curl -fsSL "${base}/${asset}" -o "${tmp}" || err "download failed: ${base}/${asset}"
if curl -fsSL "${base}/SHA256SUMS" -o "${sums}"; then
    expected=$(awk -v a="${asset}" '$2 == a { print $1 }' "${sums}")
    [ -n "${expected}" ] || err "no SHA256SUMS entry for ${asset}"
    actual=$(sha256_of "${tmp}")
    [ "${expected}" = "${actual}" ] || err "checksum mismatch for ${asset}: expected ${expected}, got ${actual}"
elif [ "${SPUR_SKIP_VERIFY:-}" = '1' ]; then
    printf 'spur-install: WARNING — installing %s WITHOUT checksum verification\n' "${asset}" >&2
else
    err "checksum file unavailable: ${base}/SHA256SUMS (set SPUR_SKIP_VERIFY=1 to install unverified)"
fi
chmod +x "${tmp}"
mv -f "${tmp}" "${target}"

# Seed global config (~/.config/spur/) on first install. `spur init` is idempotent
# and never overwrites existing files, so re-running the installer is safe.
"${target}" init >/dev/null 2>&1 || true

# Optional dependencies are installed only when absent; a failure here is a warning,
# never a rollback of the verified Spur binary above.
install_zg
install_a2a

printf '\nInstalled spur to %s\n' "${target}"
case ":${PATH}:" in
    *":${INSTALL_DIR}:"*) printf 'Run: spur --help\n' ;;
    *) printf 'Add %s to PATH, then run: spur --help\n' "${INSTALL_DIR}" ;;
esac
