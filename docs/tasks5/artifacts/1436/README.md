# 1436 — typesafe `Body already used` adoption proof

Repeatable proof that the bundled CLI built against `@gobing-ai/ts-ai-decision` 0.8.4 answers
`failure-class` through the hosted `typesafe` maker instead of falling back.

Reproduce from the repo root (requires `TYPESAFE_API_KEY` in the environment):

```bash
bun run --filter @gobing-ai/spur build:bundle
(cd apps/cli && bun link)
task1436_dir="$(mktemp -d "${TMPDIR:-/tmp}/spur-1436.XXXXXX")"
env -u TYPESAFE_DEFAULT_MODEL DATABASE_URL="$task1436_dir/proof.db" spur decision run failure-class --param wbs=1436 --maker typesafe --json
TYPESAFE_DEFAULT_MODEL=jev-1.13.0 DATABASE_URL="$task1436_dir/proof.db" spur decision run failure-class --param wbs=1436 --maker typesafe --json
sqlite3 -readonly "$task1436_dir/proof.db" "select decision_id,maker_name,source,reason,error from decision_logs;"
```

| File | Proves |
| --- | --- |
| `verification-receipt.json` | Current binary path/SHA-256, both actual command results, isolated database and its log rows |
| `ac1-decision-run.json`, `ac1-installed-binary.json` | Default SDK model path accepted through the rebuilt, installed bundle |
| `ac2-decision-logs.txt`, `ac1-installed-binary-logs.txt` | Both fresh calls accepted, zero `Body already used` errors in the isolated database |
| `ac3-model-pin.json`, `ac3-decision-logs.txt` | `TYPESAFE_DEFAULT_MODEL=jev-1.13.0` accepted; no per-call catalog model pin |
| `ac4-input-size.txt` | Read-only historical input-size observation, with characters/UTF-8 bytes distinguished from token limits |

The expected command result has `source: model`, `reason: accepted`, and no `error`; exit 0 alone
is insufficient because backend failures deliberately fall back. The proof database is temporary,
not the project's live database. Historical `Body already used` rows remain historical records.

Spec: [TypeSafe OpenAPI v0.2.0](https://api.typesafe.ai/openapi.json). Context limits are **tokens**:
[models and long context](https://docs.typesafe.ai/models#context-length) documents 64k per request
and 32k per question. Stored JSON byte counts are diagnostic, not exact wire-token measurements.
The live default and pinned calls accepted without adding a long-context header. Actual served-model
metadata logging remains the separately filed feature S; acceptance does not claim that metadata.
