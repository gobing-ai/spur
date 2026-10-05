# Codex guest-parity spike (G73 R2, task 1081)

Decision note for the two Codex questions in task 1081 R1. Recorded 2026-10-05 in worktree
`spur-new-runall-g73-cde6` (run `1081-816ec9b1`).

## (a) Can a Codex `Stop` hook block/continue a turn?

**Conditional go** — the contract exists and is documented, the delivery is not.

Evidence, strongest first:

1. **Live experiment (this machine):** `codex-cli 0.160.0`, scratch project `/tmp/codex-guest-spike`
   with `.codex/hooks.json` registering a `Stop` hook that prints
   `{"decision":"block","reason":"SPIKE-PING: reply with ack only"}` on its first fire
   (`stop_hook_active` guard). Invocation:
   `codex exec --cd /tmp/codex-guest-spike --skip-git-repo-check --dangerously-bypass-hook-trust -s read-only "<trivial prompt>"`.
   Observed in the transcript: `hook: SessionStart` (fired), `hook: UserPromptSubmit` (fired),
   turn completed normally — **`Stop` never fired**, and the hook's own marker file was never
   written. So in non-interactive `codex exec` on 0.160.0 a `Stop` hook cannot be relied on to
   deliver anything, let alone block.
2. **Official reference** (https://developers.openai.com/codex/hooks): a `Stop` hook that exits 0
   with `{"decision":"block","reason":"<non-empty>"}` on stdout tells Codex to continue, and the
   reason becomes the next user prompt; exit 2 with the reason on stderr is the alternative;
   `stop_hook_active` marks a turn already continued by `Stop`; `continue: false` from any matching
   hook wins; hook trust is hash-recorded and untrusted hooks are skipped (bypass:
   `--dangerously-bypass-hook-trust`).
3. **Source**: `codex-rs/hooks/src/events/stop.rs` and `codex-rs/hooks/src/engine/output_parser.rs`
   implement the block/continue parse, which is what makes the documented contract credible rather
   than aspirational. An open issue (openai/codex#17532) reports hooks not firing in some
   versions/modes — consistent with observation 1.
4. **Deployed evidence**: the operator's `~/.codex/config.toml` already carries `hooks = true`,
   `plugin_hooks = true` and trusted-hash `[hooks.state]` rows including `…/.codex/hooks.json:stop:0:0`,
   so `Stop` is a recognized Codex event even though `exec` did not deliver it.

**Consequence for Spur:** guest delivery must be the host-agnostic `spur agent wait --inbox <id>`
loop (task 1081 R4). The `Stop` hook is registered as an opportunistic accelerant for hosts that do
deliver it (Claude Code does; Codex interactive may), and no requirement may depend on it.

## (b) Can `codex app-server` serve as a persistent `MemberSession` mode?

**Go (decision only — the mode itself is follow-up work, not this task).**

- `codex app-server` exists in 0.160.0 (`daemon`, `proxy`, `generate-ts`, `generate-json-schema`).
- `codex app-server generate-json-schema --out <dir>` emits the protocol bundle locally; the
  generated schemas contain `turn/completed` / `TurnCompleted`, i.e. a turn-completion event a
  receipt can be built on — the property this spike had to establish.
- A persistent mode would therefore be an app-server client (initialize → conversation → user turn
  → await `turn/completed`) rather than a PTY owner, which keeps ADR-057 (no keystroke injection,
  no PTY ownership) intact.

Follow-up (not implemented in 1081): file a task for an `app-server` `MemberSession` mode with the
generated schema as its contract source.

## Reproduction

```bash
# (a)
mkdir -p /tmp/codex-guest-spike/.codex && cat > /tmp/codex-guest-spike/.codex/hooks.json <<'JSON'
{ "hooks": { "Stop": [ { "hooks": [ { "type": "command",
  "command": "/tmp/codex-guest-spike/.codex/stop-probe.sh", "timeout": 15 } ] } ] } }
JSON
# stop-probe.sh prints {"decision":"block","reason":"…"} once, guarded by stop_hook_active
codex exec --cd /tmp/codex-guest-spike --skip-git-repo-check --dangerously-bypass-hook-trust \
  -s read-only "Reply with exactly: INITIAL-TURN-OK" < /dev/null
# (b)
mkdir -p /tmp/codex-schema && codex app-server generate-json-schema --out /tmp/codex-schema
grep -rl "TurnCompleted" /tmp/codex-schema | head
```

Note for the reproduction of (a): redirect stdin (`< /dev/null`). Without it `codex exec` blocks
reading additional input and no turn runs — the first attempt of this spike did exactly that.
