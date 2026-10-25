Codex App Server replay fixtures for the Spur keyed-work proof (task 1278).

These JSONL files are the redacted captures from ts-libs
`packages/ai-runner/tests/fixtures/turn-drivers/codex/`, taken live from `codex-cli 0.164.0`
on 2026-10-24. Host paths are already replaced; native thread and turn ids are as captured.

`replay.ts` serves them over a real child process. `plain` and `missing-artifact` use
`success-two-turns.jsonl`. `failed` uses `failed-turn.jsonl`. `interrupted` emits the native
`interrupted` completion immediately. `cancel` holds that completion until the parent sends
`turn/interrupt`. `exit-after-accept` exits after the `inProgress` acceptance frame.
