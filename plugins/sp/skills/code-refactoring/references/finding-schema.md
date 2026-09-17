# Refactor finding schema

Every finding produced by a taste lens is normalized into one shared object before the coordinator
merges, gates, or applies anything. The findings artifact is a **bare JSON array** of these objects
at `.spur/run/<run-id>-refactor-findings.json`, machine-checked by
[`refactor-finding.schema.json`](./refactor-finding.schema.json) (JSON Schema draft-07).

Authority: `docs/design/dev-refactor-command.md` §4 (fields) and §5 (severity map).

## Fields

| Field | Type | Values / notes |
| --- | --- | --- |
| `id` | string | `RF-<focus>-<nnn>` (e.g. `RF-api-001`) |
| `focus` | enum | `api` `architect` `tests` `ui` — the lens that produced the finding |
| `severity` | enum | `P1` `P2` `P3` `P4` (see the map below; `P0` does not exist in this schema) |
| `rung` | string | lens-native rung kept verbatim (`A0–A7`, `T0–T7`, api compatibility class, ui pass name) |
| `title` | string | one line |
| `evidence` | `{file, line}[]` | at least one `file:line` inside `--scope` |
| `preservation` | enum | `preserving` (behavior identical) · `cutting` (a user-visible feature/test/endpoint/control is removed) · `breaking` (contract or behavior changes for a consumer) |
| `fix_eligibility` | enum | `auto` (mechanical, behavior-preserving, checkable) · `confirm` (needs an operator answer) · `suggest` (report only) |
| `proposal` | string | what to change, imperative |
| `verify` | string | command or check that proves the fix (defaults to the `--check` command) |
| `status` | enum | `open` `applied` `reverted` `deferred` `rejected` |

Severity authority: `plugins/sp/agents/super-reviewer.md` (P1 blocker · P2 major · P3 minor ·
P4 advisory). The map below is the only place lens-native severities are translated.

## Lens-native → P1–P4 severity map

| Lens | Native scale | → P1 (blocker) | → P2 (major) | → P3 (minor) | → P4 (advisory) |
| --- | --- | --- | --- | --- | --- |
| tests | P0–P3 | P0 | P1 | P2 | P3 |
| ui | P0–P3 | P0 | P1 | P2 | P3 |
| architect | A-ladder + 7-axis scores | any axis ≤1 with a correctness/safety consequence | axis ≤2 or A5–A7 seam problems | A3–A4 | A0–A2, ADR candidates, deferred questions |
| api | compatibility class | `breaking` change already shipped or contract ambiguity that corrupts data | `risky` inconsistency across ≥2 endpoints | `additive` cleanups | naming/docs |

Rule (structural, enforced by the check below): a `cutting` or `breaking` finding is **never below
P2** and **never `fix_eligibility: auto`**.

## Structural check (no new dependency)

Run this documented `bun -e` snippet before writing the report — it asserts required keys and enum
membership and fails loudly on the two hard rules above (it must reject `severity: P0` and any
`cutting`/`breaking` finding marked `fix_eligibility: auto`):

```bash
bun -e '
const f = require("fs");
const FINDINGS = JSON.parse(f.readFileSync(process.argv[process.argv.length - 1], "utf8"));
const REQ = ["id", "focus", "severity", "rung", "title", "evidence", "preservation", "fix_eligibility", "proposal", "verify", "status"];
const ENUM = {
  focus: ["api", "architect", "tests", "ui"],
  severity: ["P1", "P2", "P3", "P4"],
  preservation: ["preserving", "cutting", "breaking"],
  fix_eligibility: ["auto", "confirm", "suggest"],
  status: ["open", "applied", "reverted", "deferred", "rejected"],
};
if (!Array.isArray(FINDINGS)) throw new Error("findings artifact must be a bare JSON array");
for (const x of FINDINGS) {
  const id = x.id ?? "(no id)";
  for (const k of REQ) if (!(k in x)) throw new Error(`${id}: missing required key ${k}`);
  for (const [k, vals] of Object.entries(ENUM)) if (!vals.includes(x[k])) throw new Error(`${id}: ${k}=${JSON.stringify(x[k])} not in ${vals.join("|")}`);
  if (!Array.isArray(x.evidence) || x.evidence.length < 1 || !x.evidence.every((e) => e && typeof e.file === "string" && e.file.length > 0 && Number.isInteger(e.line) && e.line >= 1)) throw new Error(`${id}: evidence must be a non-empty [{file, line}] array`);
  if ((x.preservation === "cutting" || x.preservation === "breaking") && x.severity !== "P1" && x.severity !== "P2") throw new Error(`${id}: cutting/breaking is never below P2`);
  if ((x.preservation === "cutting" || x.preservation === "breaking") && x.fix_eligibility === "auto") throw new Error(`${id}: cutting/breaking is never fix_eligibility auto`);
}
console.log(`refactor-findings: ${FINDINGS.length} finding(s) structurally valid`);
' .spur/run/<run-id>-refactor-findings.json
```

The coordinator runs this check after mapping and again after every status change, before the
report is written. A failed check is a hard stop — the artifact is not written and the run reports
the failure instead of applying anything.
