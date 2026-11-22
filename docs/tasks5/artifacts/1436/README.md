# 1436 — typesafe `Body already used` adoption proof

Repeatable proof that the bundled CLI built against `@gobing-ai/ts-ai-decision` 0.8.4 answers
`failure-class` through the hosted `typesafe` maker instead of falling back.

Reproduce from the repo root (requires `TYPESAFE_API_KEY` in the environment):

```bash
bun run --filter @gobing-ai/spur build:bundle      # apps/cli/spur.js
(cd apps/cli && bun link)                          # installed `spur` -> this bundle
grep -c streamBackedFetch apps/cli/spur.js         # >= 1: the 0.8.4 driver fix is in the bundle

export DATABASE_URL="$TMPDIR/t1436.db"             # never the project db
spur decision run failure-class --param wbs=1436 --maker typesafe --json   # -> ac1-installed-binary.json
sqlite3 "$DATABASE_URL" "select decision_id, maker_name, outcome, source, reason, error from decision_logs;"

TYPESAFE_DEFAULT_MODEL=jev-1.13.0 spur decision run failure-class --param wbs=1436 --maker typesafe --json
```

| File | Proves |
| --- | --- |
| `ac1-decision-run.json` | AC1 on the freshly built `apps/cli/spur.js`: `source: model`, `reason: accepted`, no `error` |
| `ac2-decision-logs.txt` | AC2: zero `Body already used` rows in the temp `decision_logs` |
| `ac1-installed-binary.json` | AC1 through the installed `spur` symlink after `bun link` |
| `ac1-installed-binary-logs.txt` | AC2 on that second temp database |
| `ac3-model-pin.json` | AC3: `TYPESAFE_DEFAULT_MODEL=jev-1.13.0` still accepts (confidence 0.96) |
| `ac3-decision-logs.txt` | AC3 log rows, still no error |
| `ac4-input-size.txt` | R7 evidence: 86 recorded `failure-class` calls, largest input 2085 B vs a 64k per-request limit |

Expected result shape: `{"source":"model","reason":"accepted","maker":"typesafe","value":"stop"}`
with exit 0. A regression shows `source: "fallback"` plus `error: "TypeError: Body already used"`.
