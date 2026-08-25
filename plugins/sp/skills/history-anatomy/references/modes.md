# Mode contract — `sp:history-anatomy` (HA-S1, 0658)

The skill resolves exactly two modes. Everything else fails loud. This matrix is the enforcement
surface the workflow (0660) and the skill share; keep the vocabulary frozen.

## Mode vocabulary (frozen)

- Modes: `daily` | `ad-hoc`.
- Unsupported value literal: `not available`.

## Resolution rule

`--mode <value>` selects the mode. If `--mode` is omitted, the resolved mode is **`daily`** and the
resolved window is the **current local calendar day**.

## `--mode daily` (default)

| Allowed | Behavior |
| --- | --- |
| (none) | Default window = the current local calendar day. |
| `--date <YYYY-MM-DD>` | Selects that local calendar day as the window. |

Rejected arguments (each fails loud, naming the offending argument):

| Argument | Why rejected |
| --- | --- |
| focus text (positional) | Daily mode has no focus string. |
| `--since` / `--until` | Daily always uses the calendar-day window. |
| `--output` | Daily always writes to the run directory (see 0660). |

A daily invocation must print the normalized **inclusive ISO bounds** and the timezone used, so the
wall-clock window is auditable.

## `--mode ad-hoc`

Requires a **non-empty focus** and **two ordered inclusive bounds**.

| Argument | Rule |
| --- | --- |
| focus (positional) | Required; a missing or empty focus fails loud. |
| `--since <iso>` | Required; the inclusive lower bound. |
| `--until <iso>` | Required; must be present with `--since`; must not be earlier than `--since`. |
| `--output <path>` | Optional; when present, writes to that explicit path. When absent, writes to the run directory. |

Rejected arguments (each fails loud, naming the offending argument):

| Argument | Why rejected |
| --- | --- |
| `--date` | Ad-hoc windows are explicit bounds, not a single date. |
| `--recompute` | Ad-hoc never recomputes a cache (0660 owns the cache branch). |

## Bounds normalization

Normalize both bounds to inclusive ISO-8601 instants. The report prints the normalized bounds and
the timezone used.

## DST-aware calendar-day rule

`--date <YYYY-MM-DD>` must span the **full local calendar day including any DST shift** — it is
never a fixed 24-hour offset from local midnight.

- Resolve the local timezone (the operator's configured zone; state it in the report).
- The interval runs from the day's first local instant to the day's last local instant.
- On a 23-hour or 25-hour daylight-saving day, the interval is that actual length, not 24 hours.
- The bounds are NOT computed as `midnight + 24h`.

This is what makes a daily report's window reproducible across DST transitions.

## Fail-loud message shape

Every rejection names the offending argument and the rule it violated, e.g.:

```
--mode daily rejects "focus text" (daily mode has no focus string)
--mode ad-hoc requires a non-empty focus
--mode ad-hoc: --until is missing --since
--mode ad-hoc: --until (2026-08-01T00:00:00Z) is earlier than --since (2026-08-02T00:00:00Z)
--mode ad-hoc rejects --date (ad-hoc uses explicit --since/--until bounds)
```

A combined conflict (e.g. `--mode daily --since X`) reports **each** offending argument it can
attribute; at minimum it names the first conflicting one.
