# Non-Hook Enforcement Guide

Use this guide when the target coding platform does not support hook execution.

## Goal

Apply the same anti-hallucination verification rules without relying on a `Stop` hook.

The reusable adapter for this mode is:

```bash
bun plugins/sp/skills/anti-hallucination/scripts/validate_response.ts
```

It validates a final answer using the same `verifyAntiHallucinationProtocol` logic as `ah_guard.ts`.

For batch or headless agent invocations, use the wrapper adapter:

```bash
bun plugins/sp/skills/anti-hallucination/scripts/run_with_validation.ts -- <command> [args...]
```

This runs the wrapped command, captures its output, validates the final response text, and only prints the wrapped output if validation passes.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Validation passed |
| 1 | Validation failed |

## Input Modes

The validator accepts response text in either of these forms:

1. `RESPONSE_TEXT` environment variable
2. `STDIN`

## Usage Patterns

### Host-Side Validation

Validate a final answer produced by a non-hook agent workflow:

```bash
export RESPONSE_TEXT="According to the official documentation at https://api.example.com, the method is getUser(id: string): User. **Confidence**: HIGH. Source: https://api.example.com/docs"
bun plugins/sp/skills/anti-hallucination/scripts/validate_response.ts
```

### Pipe Final Output Through the Validator

```bash
printf '%s\n' "$FINAL_ANSWER" | bun plugins/sp/skills/anti-hallucination/scripts/validate_response.ts
```

### Wrapper Script Pattern

The recommended wrapper flow is:

1. Run the target agent CLI
2. Capture the proposed final answer
3. Validate it with `run_with_validation.ts` or `validate_response.ts`
4. Return the answer only if validation passes

Example shell shape:

```bash
bun plugins/sp/skills/anti-hallucination/scripts/run_with_validation.ts -- your-agent-cli ...
```

If validation exits `1`, the wrapper should block publication and request revision.

### ACP Agent Examples

For rd3 ACP agents, use the concrete one-shot wrappers:

```bash
bun plugins/sp/skills/anti-hallucination/scripts/run_codex_with_validation.ts "summarize this repo"
bun plugins/sp/skills/anti-hallucination/scripts/run_opencode_with_validation.ts "summarize this repo"
bun plugins/sp/skills/anti-hallucination/scripts/run_openclaw_with_validation.ts "summarize this repo"
bun plugins/sp/skills/anti-hallucination/scripts/run_pi_with_validation.ts "summarize this repo"
```

These run:

```bash
acpx --format quiet codex exec "summarize this repo"
acpx --format quiet opencode exec "summarize this repo"
acpx --format quiet openclaw exec "summarize this repo"
acpx --format quiet pi exec "summarize this repo"
```

and only print the final answer if the anti-hallucination validation passes.

### Response Source Selection

By default, `run_with_validation.ts` validates `stdout`. If the wrapped platform emits final answers elsewhere, use:

```bash
bun plugins/sp/skills/anti-hallucination/scripts/run_with_validation.ts --source stderr -- your-agent-cli ...
bun plugins/sp/skills/anti-hallucination/scripts/run_with_validation.ts --source combined -- your-agent-cli ...
```

This wrapper is intended for non-interactive or headless command execution, where the final answer can be captured reliably.

## Reviewer Workflow Pattern

If you cannot wrap the CLI directly, use a review step:

1. Draft the answer
2. Validate the draft with `validate_response.ts`
3. If validation fails, revise and re-run validation
4. Only publish when validation passes

## Structured Output Pattern

When the host platform can enforce schemas, require fields like:

```json
{
  "answer": "...",
  "sources": ["..."],
  "confidence": "HIGH",
  "verification_steps": ["ref_search_documentation ..."]
}
```

The host can then serialize the final `answer` block and validate it with `validate_response.ts` before display.

## Design Rule

Do not duplicate verification rules across platforms. Keep:

- `ah_guard.ts` for hook-based platforms
- `validate_response.ts` for direct answer validation
- `run_with_validation.ts` for wrapped non-hook execution
- `SKILL.md` as the shared protocol and policy source

## See Also

- `../SKILL.md`
- `guard-implementation.md`
- `tool-usage-guide.md`
