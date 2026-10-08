# raw-json-baseline — recapture contract

Byte fixtures for the 0697 AC3 raw-default identity tests in
`apps/cli/tests/output-envelope.test.ts` (`raw default byte-identity vs pre-change baseline`).
They pin the exact stdout bytes of two commands, so any envelope, key-order, or serialization
regression reddens the suite instead of diffing away silently:

- `rule run --json` — `rule-run.json` (empty temp project → zero findings)
- `rule validate --json --kind preset recommended-pre-check` — `rule-validate-preset.json`

## When to recapture

Only after an **intentional** change that legitimately alters these bytes — e.g. adding/removing
a rule category in `config/rules/`, changing the `recommended-pre-check` preset, or changing the
JSON envelope serialization. Recapture in the same commit as the intentional change and say so in
its message. Never recapture to force a red suite green.

## How to recapture

The harness must match the test exactly (`output-envelope.test.ts:289-307`): in-process CLI
`main()` with `captureSink()`, a fresh temp cwd, and the catalog pinned to the repo's tracked
rules — never the machine's global `~/.config/spur/rules` (a stale global preset silently
changes the `ruleCount`):

```ts
// apps/cli/tests (bun test context gives import.meta.dir)
import { main } from '../src/index'; // adjust to the test file's import
const out = captureSink();
await main(['rule', 'run', '--json'], {
    cwd: mkdtempSync(join(tmpdir(), 'spur-baseline-')),
    output: out,
    env: { ...getEnvVars(), SPUR_GLOBAL_RULES_DIR: REPO_RULES_DIR },
});
writeFileSync(join(fixtureDir, 'rule-run.json'), out.text);
```

Repeat for the `rule validate` argv, then run the two identity tests and expect green with the
new fixtures committed. Do not run the CLI as a subprocess to capture — process-level stdout
adds platform-specific noise the in-process sink does not have.
