#!/usr/bin/env sh
# Spur standalone installer — for users without Bun on PATH.
#
# Downloads the compiled `spur` binary from a GitHub Release and installs it to a
# directory on PATH, then seeds the global config via `spur init`. Users who have
# Bun should prefer `npm i -g @gobing-ai/spur-cli` (smaller, auto-updates via npm).
#
#   curl -fsSL https://raw.githubusercontent.com/gobing-ai/spur/main/scripts/install.sh | sh
#
# Overrides:
#   SPUR_VERSION   release tag to install            (default: latest)
#   SPUR_INSTALL   target bin dir                     (default: ~/.local/bin)
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
    *) err "unsupported OS: ${os} (use 'npm i -g @gobing-ai/spur-cli' instead)" ;;
esac
case "${arch}" in
    arm64 | aarch64) arch='arm64' ;;
    x86_64 | amd64) arch='x64' ;;
    *) err "unsupported architecture: ${arch}" ;;
esac

asset="spur-${os}-${arch}"
if [ "${VERSION}" = 'latest' ]; then
    url="https://github.com/${REPO}/releases/latest/download/${asset}"
else
    url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
fi

command -v curl >/dev/null 2>&1 || err 'curl is required but not found'

mkdir -p "${INSTALL_DIR}"
target="${INSTALL_DIR}/spur"
printf 'Downloading %s -> %s\n' "${asset}" "${target}"
curl -fsSL "${url}" -o "${target}" || err "download failed: ${url}"
chmod +x "${target}"

# Seed global config (~/.config/spur/) on first install. `spur init` is idempotent
# and never overwrites existing files, so re-running the installer is safe.
"${target}" init >/dev/null 2>&1 || true

printf '\nInstalled spur to %s\n' "${target}"
case ":${PATH}:" in
    *":${INSTALL_DIR}:"*) printf 'Run: spur --help\n' ;;
    *) printf 'Add %s to PATH, then run: spur --help\n' "${INSTALL_DIR}" ;;
esac
