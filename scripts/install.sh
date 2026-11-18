#!/usr/bin/env sh
# Spur standalone installer — for users without Bun on PATH.
#
# Downloads the compiled `spur` binary from a GitHub Release and installs it to a
# directory on PATH, then delegates ALL machine setup to the installed binary
# (`spur self install`). Users who have Bun should prefer `npm i -g @gobing-ai/spur`
# (smaller, auto-updates via npm).
#
# A93 (task 1353): this script owns exactly the acquisition boundary — OS/arch choice,
# download, checksum verification, atomic replace. It cannot delegate that part because
# the CLI does not exist yet. Seeding, optional tools and adapter convergence are the
# installed binary's job, so there is one implementation of each.
#
#   curl -fsSL https://raw.githubusercontent.com/gobing-ai/spur/main/scripts/install.sh | sh
#
# The binary is verified against the release's SHA256SUMS before it replaces an
# existing install; a failed download or mismatch leaves the old binary untouched.
# The checksum is a code-execution boundary, not just an integrity check: this
# script then runs the binary it downloaded (`spur self init`), so keep
# SPUR_SKIP_VERIFY=1 exceptional.
#
# Overrides:
#   SPUR_VERSION      release tag to install          (default: latest)
#   SPUR_INSTALL      target bin dir                  (default: ~/.local/bin)
#   SPUR_RELEASE_URL  mirror / test base URL          (default: the GitHub release download URL)
#   SPUR_INSTALL_ZG   request zg setup                 (default: 1; set to 0 to skip)
#   SPUR_INSTALL_A2A  request a2a setup                (default: 1; set to 0 to skip)
# Preserved shell compatibility: these two legacy defaults are translated into explicit
# `--with` requests for the installed binary. A direct `spur self install` stays opt-in.
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

# Optional external CLIs used by hybrid search (zg) and A2A fleet transport. The shell
# only decides WHICH tools the operator asked for; installing them is the CLI's job.
setup_tools=''
if [ "${SPUR_INSTALL_ZG:-1}" != '0' ]; then
    setup_tools="${setup_tools} --with zg"
else
    printf 'spur-install: skipping zg (SPUR_INSTALL_ZG=0)\n'
fi
if [ "${SPUR_INSTALL_A2A:-1}" != '0' ]; then
    setup_tools="${setup_tools} --with a2a"
else
    printf 'spur-install: skipping a2a (SPUR_INSTALL_A2A=0)\n'
fi

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

# Machine setup belongs to the installed binary (seeds + the requested optional tools).
# The verified binary stays installed when a step fails; the exit code is the CLI's, so a
# required failure is visible instead of being swallowed, and a rerun retries only what failed.
setup_status=0
# shellcheck disable=SC2086 # setup_tools is an intentional word list of --with requests
"${target}" self install ${setup_tools} || setup_status=$?
if [ "${setup_status}" -ne 0 ]; then
    printf 'spur-install: the binary is installed at %s, but machine setup reported a failure (exit %s).\n' "${target}" "${setup_status}" >&2
    printf 'spur-install: re-run `spur self install%s` to retry only the unfinished steps.\n' "${setup_tools}" >&2
    exit "${setup_status}"
fi

printf '\nInstalled spur to %s\n' "${target}"
case ":${PATH}:" in
    *":${INSTALL_DIR}:"*) printf 'Run: spur --help\n' ;;
    *) printf 'Add %s to PATH, then run: spur --help\n' "${INSTALL_DIR}" ;;
esac
