---
schema_version: 1
name: codify chunked implement dispatch contract for cap limited worker models
status: done
template: issue
created_at: 2026-10-03T04:25:11.249Z
updated_at: "2026-10-05T18:22:32.270Z"

feature_id: B1
priority: P3
ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1066-verdict.json
---

## 1066. codify chunked implement dispatch contract for cap limited worker models

### Background

Surfaced 2026-10-02 during task 1059's implement stage (runall-D63-2ebbd97c, worker model glm-5.3-flash).

Four consecutive single-shot implement dispatches died with `stopReason=length`: the model's 16384-token output cap was consumed by one giant thinking block before any file action — three attempts saturated on open-ended reading, one on pure thinking blowout; one worker called `contact_supervisor` mid-death. Splitting the same scope into three small independent chunks (test cases / doc rewrite / task sections) plus an explicit worker contract — "keep every thinking block under ~150 words, act between thoughts, never plan the whole task in one block" — succeeded 3/3.

The countermeasure currently lives only in `.spur/context/learnings.md`, the D63 dogfood report, and pitfalls. The inline pipeline driver (plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md) has no dispatch-shaping contract, so the next cap-limited worker dispatch will rediscover this the expensive way.

### Requirements

- [x] R1. inline-pipeline-driver.md gains a dispatch-shaping contract for cap-limited worker models: split implement briefs into independent chunks ordered by dependency; instruct workers to keep thinking blocks under ~150 words and act between thoughts; never pack the whole task plan into one dispatch.
- [x] R2. The contract names the failure signature (`stopReason=length`, zero-output attempts, optional contact_supervisor-before-death) and the fallback ladder: re-chunk smaller → host-session inline execution.
- [x] R3. The contract is model-agnostic (triggered by observed cap behavior, not a hardcoded model list) and cites the 2026-10-02 D63 1059 evidence.
- [x] R4. Cross-references: pitfalls entry (done 2026-10-02) and the dogfood report link the contract; the implement stage's dispatch guidance links to it.

### Acceptance Criteria

- [x] AC1 — The dispatch-shaping contract exists in inline-pipeline-driver.md and is linked from the implement-stage guidance. (req: R1, R4)
- [x] AC2 — Failure signature and fallback ladder are documented verbatim enough to recognize in a live run. (req: R2)
- [x] AC3 — No model name is hardcoded as a trigger; the D63 evidence is cited as an example. (req: R3)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

Codified the chunked implement dispatch contract in the inline pipeline driver reference:

- **Contract section** `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:279` — new H2 codifying how the driver dispatches implement stages to cap-limited worker executors.
- **Failure signature and trigger** `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:283-286` — `stopReason=length` with zero output (no tool call, no file write), optional `contact_supervisor` mid-death; the trigger is the observed signature, never a model name.
- **Dispatch rules** `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:288-297` — chunk the brief by dependency, thinking blocks under ~150 words with act-between-thoughts, fallback ladder (re-chunk smaller once → host-inline + run-log record).
- **Evidence** `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:298-302` — dated 2026-10-02 task 1059 / runall-D63-2ebbd97c record: 4/4 single-shot dispatch deaths vs 3/3 chunked successes.
- **Cross-link from implement dispatch** `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:406` — one pointer paragraph ahead of the native-subagent eligibility list.
- **R4 cross-references** — `.spur/context/pitfalls.md` 2026-10-02 entry cites the contract; `.spur/memory/runs/runall-D63-2ebbd97c.md` gained a codification note. Substitution disclosed (see Review P4): the task-cited dogfood report file does not exist; the run log is the surviving evidence carrier.

Testing: `bun run spur-check` PASS (attempt 1, lint/typecheck/tests repo-wide); verification verdict PASS with command evidence (`.spur/run/1066-verify-answer.txt`); proof digest `sha256:0445a824…` bracket-verified across quality gate → review → verify.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:279-302 — "Chunked implement dispatch contract" section: dependency-ordered independent chunks (step 1), thinking blocks under ~150 words with act-between-thoughts (step 2), explicit "Never pack the whole task plan into one dispatch". |
| R2 | MET | Same section, lines 283-296: failure signature paragraph (`stopReason=length`, zero output — no tool call/no file write, optional `contact_supervisor` mid-death) and step 3 fallback ladder (re-chunk smaller once → host-inline fallback + run-log record). |
| R3 | MET | Line 286: "The trigger is the observed signature, never a model name: any executor that exhibits it is treated as cap-limited"; evidence paragraph (298-302) cites 2026-10-02 task 1059 / runall-D63-2ebbd97c (4/4 single-shot deaths vs 3/3 chunked successes). |
| R4 | MET | (a) Implement-stage dispatch guidance links the contract at inline-pipeline-driver.md:406-408 ("Before dispatching an `implement` stage … § Chunked implement dispatch contract"). (b) .spur/context/pitfalls.md 2026-10-02 entry cites the contract section. (c) .spur/memory/runs/runall-D63-2ebbd97c.md gained a "Contract codified (2026-10-03, task 1066)" note. Note: the task-cited docs/dogfood/2026-10-02-D63-*.md report does not exist (findings were filed as tasks 1065-1067, commit 781a2789); the run log is the substituted evidence carrier — disclosed in the task Review section. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | `rg -n "^## Chunked implement dispatch contract" plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` → `279:## Chunked implement dispatch contract (cap-limited worker models, task 1066)`; `rg -n "§ Chunked implement dispatch contract" <same>` → `407:dispatch contract (§ Chunked implement dispatch contract)` — section exists and is linked from the implement-stage dispatch guidance. (req: R1, R4) |
| AC2 | MET | command | `rg -n "stopReason=length |
| AC3 | MET | command | `sed -n '279,302p' <driver> \| rg -in "glm[- ]\|claude\|codex\|gemini\|opencode\|anthropic\|openai\|haiku\|sonnet"` → exit 1 (zero hits): no model name is a trigger; D63 evidence appears only as a dated example with run id (lines 298-302). (req: R3) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Three-dimensional review of run fbda1da0 diff (2 files, +34/−2):

- **Functional traceability: PASS.** R1 contract present (chunking, ~150-word thinking cap, act-between-thoughts, no whole-plan-in-one-dispatch). R2 failure signature (`stopReason=length`, zero-output attempts, optional `contact_supervisor`) and fallback ladder (re-chunk once → host-inline + run-log record) verbatim. R3 trigger is the observed signature, never a model name; D63/1059 evidence cited. R4 driver cross-link + pitfalls + D63 run-log links in place.
- **SECUA: PASS.** Doc-only; no security/correctness/efficiency surface.
- **Architecture: PASS.** Section placed at the dispatch seam (adjacent to per-call pin and native-subagent eligibility); no code touched; pre-existing duplicate heading left alone.

Findings table:

| Priority | Finding | Disposition |
| --- | --- | --- |
| P4 (resolved) | Stale citation: this task's References pointed at `docs/dogfood/2026-10-02-D63-runall-batch-wt4-dogfood.md`, which never existed — D63 findings were filed as tasks 1065-1067 (commit 781a2789) and the surviving evidence carrier is the run log. | Resolved 2026-10-03: References section corrected to the actual carriers (run log + tasks 1065-1067); contract cross-link from the run log already in place. |

No P1–P3 findings; no open P4. Residual risk: none material. Disposition: approved.

### References

- Driver doc: plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md (contract section at :279; dispatch-guidance link at :406).
- Evidence: 1059 implement dispatch log (4 failed attempts, 3 chunked successes), runall-D63-2ebbd97c run log (.spur/memory/runs/, main tree).
- Dogfood: none — no docs/dogfood report exists for D63; its findings were filed as tasks 1065-1067 (commit 781a2789). Evidence carrier: .spur/memory/runs/runall-D63-2ebbd97c.md.
- Pitfalls: .spur/context/pitfalls.md 2026-10-02 entry.

### History

- 2026-10-03T04:53:23.217Z todo → wip (system)
- 2026-10-03T05:04:40.955Z wip → testing (system)
- 2026-10-03T05:05:33.626Z testing → done (system)

