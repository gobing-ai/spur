---
name: sp-bot-bootstrap
description: "Bootstrap the sp toolchain (bun, spur, superskill, kk) on a Grok Bot computer or any fresh host: idempotent install skill that checks the PATH first, installs only what is missing, and is safe to re-run after a computer recreate. Triggers: \"bootstrap spur on Grok Bot\", \"install spur toolchain\", \"after computer recreate\"."
requires: [local-fs]
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  interactions:
    - environment-bootstrap
  operations:
    - check-toolchain
    - install-toolchain
---

# sp-bot-bootstrap

Bring a fresh host (typically a Grok Bot's cloud computer) to the minimum toolchain the sp
plugin needs: the `bun` runtime plus the three CLIs `spur`, `superskill` and `kk`. The skill
declares only `local-fs`: the fenced blocks resolve the tools on `PATH` and touch the official
bun installer, so the 0162 scanner derives no registry-driven CLI requirement from this body.

**Running it:**

1. Run the **check** block.
2. If check exits nonzero, run the **setup** block.
3. Run the **check** block again — it must exit 0. If it does not, stop and report the check
   output instead of retrying setup in a loop.

Each block is standalone POSIX `sh`; run them exactly as they appear here. They only prepend
`${BUN_INSTALL:-$HOME/.bun}/bin` to `PATH` inside the block, print one `missing: <tool>` line
per absent tool, install with the official bun installer and `bun add -g`, and echo the
`export PATH=…` line to append to the host environment. They never edit shell rc files, never
read or write secrets or tokens, and write nothing outside `~/.bun` (the package manager's own
cache aside).

```sh sp-bot-bootstrap:check
PATH="${BUN_INSTALL:-$HOME/.bun}/bin:$PATH"; export PATH; rc=0
for pair in bun:bun spur:@gobing-ai/spur superskill:@gobing-ai/superskill kk:@gobing-ai/knowledge-kit; do
  t=${pair%%:*}
  if command -v "$t" >/dev/null 2>&1 && "$t" --version >/dev/null 2>&1; then
    continue
  fi
  echo "missing: $t"
  rc=1
done
exit $rc
```

```sh sp-bot-bootstrap:setup
set -eu
PATH="${BUN_INSTALL:-$HOME/.bun}/bin:$PATH"; export PATH
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
fi
pkgs=""
for pair in spur:@gobing-ai/spur superskill:@gobing-ai/superskill kk:@gobing-ai/knowledge-kit; do
  t=${pair%%:*}
  if ! command -v "$t" >/dev/null 2>&1; then
    pkgs="$pkgs ${pair#*:}"
  fi
done
if [ -n "$pkgs" ]; then
  bun add -g $pkgs
fi
echo 'export PATH="${BUN_INSTALL:-$HOME/.bun}/bin:$PATH"'
```

**Team Setup Script variant:** to keep the toolchain present across computer recreates, an admin
can register the **setup** block above as a Grok Team Setup Script (configured through the
console; see https://docs.x.ai/grok-bot/private-networks — *unverified location*: confirm the
exact console path with a probe receipt before relying on this pointer). The variant is the same
block, unchanged, with the same idempotency: after a successful setup a rerun performs zero
installs.
