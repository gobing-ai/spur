# Claude warm-work replay (task 1276, review F1)

`success-two-turns.jsonl` is copied unchanged from ts-libs commit `a6a185f0`,
`packages/ai-runner/tests/fixtures/turn-drivers/claude/success-two-turns.jsonl`.
Its upstream provenance records a capture on 2026-10-22 from Claude Code 2.1.308 using
`claude -p --input-format stream-json --output-format stream-json --verbose`.
Session ids are redacted to `<uuid>`, cwd to `/tmp/spur-claude-fixture`, and reset timestamps to zero.
The upstream README describes incidental arrays as trimmed; record ordering and `is_error` are preserved.

`replay.ts` emits the captured startup hook records once and one captured turn group per encoded
user frame. It stays alive until the session closes. It synthesizes no terminal or session ids.

Repeat from `packages/app`:

```sh
bun test tests/workflow/claude-warm-work-item.test.ts
```

The test runs the real member work-item contract, AgentService, warm dispatcher and registered
Claude driver, substituting only the process command with this replay child. It verifies two
distinct request/turn identities sharing one process and native session, persisted answers and
receipts, and a missing-artifact rejection despite a successful native terminal. Claude supplies
no native turn id; the test checks distinct facade turn ids without claiming native turn ids exist.
