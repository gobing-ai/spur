# Anti-Hallucination Skill

Operational entry points for the rd3 anti-hallucination skill.

## When To Use Which Script

| Script | Use When | Input | Blocks Invalid Output |
|--------|----------|-------|-----------------------|
| `scripts/ah_guard.ts` | The platform supports hooks and you want stop-time enforcement | Hook `ARGUMENTS` payload | Yes |
| `scripts/validate_response.ts` | You already have a final answer and want to validate it directly | `RESPONSE_TEXT` or `STDIN` | Yes |
| `scripts/run_with_validation.ts` | You have a batch/headless command and want generic wrapper enforcement | Wrapped command output | Yes |
| `scripts/run_codex_with_validation.ts` | You are running Codex through `acpx` one-shot exec | Prompt text or `--file` | Yes |
| `scripts/run_opencode_with_validation.ts` | You are running OpenCode through `acpx` one-shot exec | Prompt text or `--file` | Yes |
| `scripts/run_openclaw_with_validation.ts` | You are running OpenClaw through `acpx` one-shot exec | Prompt text or `--file` | Yes |
| `scripts/run_pi_with_validation.ts` | You are running Pi through `acpx` one-shot exec | Prompt text or `--file` | Yes |

## Typical Choices

### Hook Platforms

Use `ah_guard.ts` with a `Stop` hook when the platform supports hooks.

Current rd3 Claude-style integration:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/skills/anti-hallucination/scripts/ah_guard.ts
```

### Non-Hook Platforms

If you already captured the answer text:

```bash
printf '%s\n' "$FINAL_ANSWER" | bun plugins/sp/skills/anti-hallucination/scripts/validate_response.ts
```

If you want to wrap a generic batch command:

```bash
bun plugins/sp/skills/anti-hallucination/scripts/run_with_validation.ts -- your-agent-cli ...
```

If you are using rd3 `acpx` with a supported agent:

```bash
bun plugins/sp/skills/anti-hallucination/scripts/run_codex_with_validation.ts "summarize this repo"
bun plugins/sp/skills/anti-hallucination/scripts/run_opencode_with_validation.ts "summarize this repo"
bun plugins/sp/skills/anti-hallucination/scripts/run_openclaw_with_validation.ts "summarize this repo"
bun plugins/sp/skills/anti-hallucination/scripts/run_pi_with_validation.ts "summarize this repo"
```

## ACP Wrappers

These concrete wrappers all run the same pattern:

```bash
acpx --format quiet <agent> exec "<prompt>"
```

Then they validate the returned final answer and only print it if validation passes.

Supported agents:

- `codex`
- `opencode`
- `openclaw`
- `pi`

## Files

- `SKILL.md` - Cross-platform policy and workflow
- `references/guard-implementation.md` - Hook-based integration
- `references/non-hook-enforcement.md` - Wrapper and validator patterns
- `references/tool-usage-guide.md` - Tool selection examples

## Rule Of Thumb

- Hooks available: use `ah_guard.ts`
- No hooks, but wrapper possible: use a wrapper script
- Answer already exists: use `validate_response.ts`
- Nothing enforceable available: follow the policy in `SKILL.md`, but treat it as weaker than code-based validation
