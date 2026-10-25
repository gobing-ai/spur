# Pi warm work-item replay (1277)

`success-two-turns.jsonl` is the redacted live Pi 0.87.1 capture from ts-libs commit
`b2d707be`, `packages/ai-runner/tests/fixtures/turn-drivers/pi/success-two-turns.jsonl`.
The upstream driver shipped in `@gobing-ai/ts-ai-runner@0.6.3`.

The capture used the Spur repository dependency (`node_modules/.bin/pi`, 0.87.1),
not the separate host PATH installation (1.4.0). Host prompt/system text, session identifiers,
extension identifiers and usage numbers were redacted upstream; this copy preserves those shapes.

`replay.ts` checks the registered driver's prompt envelope, replaces the captured command ids
with the current turn id and writes the requested fixture artifact before `agent_settled`.
Those writes simulate the model's file tool; the real workflow action validates the artifact.
The runner 0.6.4 Pi driver emits output events without `finalText`, so these cases use `expectFile`.
They do not claim an `answerFile` capture or a real-model performance measurement.

Fault injection is separate from the captured transcript: `accepted-exit` exits before
`agent_settled` (after `agent_end`); `malformed` injects invalid JSON; `rejected` changes the
prompt response to `success: false`; `missing-artifact` omits the second file; `fragmented`
splits records across writes and interleaves captured extension noise. Both successful variants
serve two distinct keyed work items in one child with real action-contract validation.

The rejection case verifies runner 0.6.4's pre-acceptance `not-started` classification and
Spur's single fallback. The fallback receipt preserves that native outcome separately from
the fallback's validated result. The rejection line is synthetic fault injection; it is not
claimed as a live rejection capture from Pi 0.87.1.

Repeat from `packages/app`:

```sh
bun test tests/workflow/pi-warm-work-item.test.ts
```
