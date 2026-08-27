---
schema_version: 1
name: "Simplify --agent to one honest selector: inline default, subagent-first, remove the headless rejection, restore agent telemetry"
status: todo
template: issue
created_at: 2026-08-27T04:45:22.880Z
updated_at: "2026-08-27T04:49:02.685Z"
feature_id: B
---

## 0687. Simplify --agent to one honest selector: inline default, subagent-first, remove the headless rejection, restore agent telemetry

### Background
On 2026-08-26 the operator ran, as a real user would:

```
/sp:dev-dogfood "/sp:dev-find-issue --date 2026-08-26 --agent inline" --save --full --max-retry 3 --agent inline
```

**No history-anatomy diagnostic report was produced.** The only artifact was the dogfood
report itself (`docs/dogfood/2026-08-26-sp-dev-find-issue-agent-inline-dogfood.md`). Three
independent defects stacked to produce that outcome, and a fourth was found while
diagnosing them.

**1. The selector the operator passed is refused by contract.** `--agent inline` is
rejected fail-loud at the first `agent.run` stage:

```
✗ resolve-scope/agent.run (0s) · agent.run: --agent inline requires a host session:
  this surface is headless and never dispatches inline runs (no fallback to agent.default).
  Use 'auto', a role, or an executor name.
```

The rejection is working exactly as designed — ADR-047's G5 amendment (2026-08-15, task
0565) made explicit `inline` a hard error on every headless surface. The operator's ruling
is that the design itself is wrong: a selector that the wrapper advertises
(`plugins/sp/commands/dev-find-issue.md:28`) and the operator explicitly typed must not be
refused. The G5 debugging-trap concern (an `inline` request silently executing in another
session) is legitimate; refusing the request is the wrong remedy — signalling is.

**2. Every sanctioned fallback executor is blocked by this session's sandbox.** After the
rejection, the dogfood retried `--agent auto` (tier-resolved to `agy-opus`), then `grok`,
then `pi-k3`. All three died at executor startup with OS-level permission errors — not
quota, not auth:

| Executor | Failure |
| --- | --- |
| `agy-opus` (antigravity-cli) | `listen tcp 127.0.0.1:0: bind: operation not permitted`; also `open ~/.gemini/antigravity-cli/log/...: operation not permitted` |
| `grok` | `Couldn't create session: Permission denied. {"code":"FS_PERMISSION_DENIED","detail":"Operation not permitted (os error 1)"}` |
| `pi-k3` (pi) | `EPERM: operation not permitted, mkdir '~/.pi/agent/settings.json.lock'`; `Credential store read failed for kimi: EPERM ... auth.json.lock` |

Reproduced directly: `touch ~/.grok/.probe` → `Operation not permitted`; a Python
`socket.bind(('127.0.0.1',0))` → `PermissionError: [Errno 1]`. Root cause is
`.claude/settings.json` (`sandbox.enabled: true`, `allowUnsandboxedCommands: false`),
whose `sandbox.filesystem.allowWrite` list covers `~/.omp` but not the state directories
of the other agent CLIs, and which never enables `sandbox.network.allowLocalBinding`.
This is environment, not product — but the product amplified it (see 3).

**3. An OS permission failure was misclassified as quota exhaustion and escalated.** The
pi-k3 dispatch produced:

```
Stage escalation: stage=verify signal=resource-exhaustion from=pi-k3 to tier=capable-2
```

An `EPERM` at CLI startup is not resource exhaustion. `classifyDispatch`
(`packages/app/src/services/failure-classification.ts:78-92`) iterates **every** rule in
`FAILURE_RULES` and never consults `rule.provider` — the field is declared on the type
(`:6`) and set on all seven rules, but no code path reads it. Any executor's stderr is
therefore matched against every other provider's quota patterns; e.g. the `ollama` rule's
`/context[_ -]?(?:length|window)/i` matches the literal `contextWindow` in a bundled JS
crash dump, and the `gemini` rule matches any occurrence of `quota`. The consequence is a
wasted escalation to a more expensive tier and a failure report that names the wrong
cause.

**4. Agent-dispatch telemetry has been dark since 2026-08-20.** Queried on the live
ledger:

```sql
select event_name,count(*),max(occurred_at) from system_events
 where event_name like 'agent%' group by event_name;
-- agent.invoke.exit  |152| 2026-08-20T04:04:45.069Z
-- agent.invoke.start |156| 2026-08-20T04:04:31.714Z
select count(*) from system_events where event_name like 'workflow.agent%';
-- 0
```

`workflow.*` events land normally (215 `workflow.action.start` rows since 2026-08-20,
including today's runs), so the ledger tap is attached. The gap is deliberate-but-
incomplete: `apps/cli/src/commands/workflow.ts:225-231` intentionally withholds the events
bus from `AgentService` ("Wiring AiRunner.events here would dual-emit `agent.invoke.*` for
the same execution", citing 0365 R9 / 0370 R4) on the premise that the workflow-dispatched
agent lifecycle is carried by a single `workflow.agent` series — **but that series has
zero rows in the ledger**. Meanwhile every agent analytic reads the suppressed series:
`pairingSummary` (`packages/domain/src/analytics/pairings.ts:187,202`), `roleTokenSummary`
(`role-tokens.ts:163,207`) and `retroCorrelation` (`retro-correlation.ts:94`) all key on
`agent.invoke.start`/`.exit`.

Measured effect on the report this task exists to unblock: a bounded daily analyze
artifact carries `pairings: 0` while the same analyze unbounded carries 5 (all older than
2026-08-20). `sp:history-anatomy`'s `enrich` rubric
(`plugins/sp/skills/history-anatomy/references/operations.md:48-50`) sources Performance
analysis from the pairing fold, so the section can only ever render `not available` for a
recent window — the report's own run-cost dimension is structurally dead.

**Already fixed in the dogfood run (not part of this task):** the analyze stage sourcing a
nonexistent `paths.env` (`config/workflows/history-anatomy.yaml:134,139`, now `paths.txt`);
`resolvePaths` resolving a bogus skill dir on the superskill-installed layout
(`plugins/sp/scripts/history-anatomy-cache.ts:566`); and the misleading
"timed-out-implement runbook" hint attached to plain non-zero exits
(`packages/app/src/workflow/actions/agent-run.ts:393-402`).
### Requirements
The operator's ruling defines the whole selector. Everything below derives from it; where
an existing contract contradicts it, the existing contract loses.

> - if not specified, the default agent is `inline`.
> - if it's `inline`, then we will try to use a subagent if available, otherwise fallback
>   to the host session;
> - if it's `auto`, then we will apply the tier-based agent role and agent executor
>   mechanism to figure out the most proper agent to execute the request.
> - if it's others which specified by the user, we will use them as-is.

**R1 — `--agent` defaults to `inline` on every surface.** Replace the current
`stringFlag(flags, 'agent', 'auto')` default (`packages/app/src/services/agent-service.ts:1326`)
with `inline`, and align every wrapper/doc that currently describes omission as "forwards
nothing → `agent.default`". Omission and explicit `inline` MUST resolve identically —
after this task there is no observable difference between them, which retires the entire
"omit vs explicit inline" distinction from ADR-047's 0508 amendment and from
`cross-cutting.md` (its value table at `:50-55` collapses from four rows to three).

**R2 — `inline` means subagent-first, host-session fallback; it never fails.** On a surface
that has a host session, `inline` dispatches to a native subagent when one is available
with shared-worktree read/write/shell capability, and otherwise executes in the host
session. Any eligibility failure falls back to host execution — it is never an error. This
generalizes the existing 0508 eligibility test from omit-only to all inline resolution.

**R3 — Delete the headless `inline` rejection.** Remove `AGENT_INLINE_HEADLESS_MESSAGE` and
every branch that returns it:
- `packages/app/src/services/agent-service.ts:61-62` (the constant) and `:1334-1336` (the
  `{ ok:false, exitCode:2 }` return in `resolveAgent`)
- `apps/cli/src/commands/agent.ts:222` (`validateAgentSelector` early return)
- `packages/app/src/workflow/actions/agent-run.ts:139` (the wrapped `agent.run:` error)
- the re-export at `packages/app/src/index.ts:51`

On a genuinely headless surface (`spur workflow run` from a bare shell, `spur agent run`,
serve-side dispatch) `inline` MUST resolve — not refuse — by falling back to the tier-based
resolution `auto` would have produced, and MUST emit one warning line naming the
substitution and why, e.g.
`--agent inline requested on a headless surface (no host session); resolved <executor> via <role>/<tier>`.
The G5 debugging-trap concern is satisfied by that signal, not by refusal. The warning goes
to the run log and the `agent.invoke.*` payload; it never changes the exit code.

**R4 — `auto` and named selectors keep their current behavior.** `auto` continues to
tier-resolve through role → tier → cheapest usable executor, and a named executor/role is
used as-is with the escalation ladder intact. No change beyond what R1/R3 force. This
requirement exists to bound the blast radius: do not "simplify" the tier machinery in the
same task.

**R5 — `/sp:dev-find-issue --agent inline` produces a published report.** The command's
target is engine-driven (`config/workflows/history-anatomy.yaml`), whose `resolve-scope`,
`enrich` and `validate` stages are `agent.run`. Under R1/R2/R3 the invocation must run to
`published` and write `docs/report/<date>-history-anatomy.md`. Choose ONE mechanism and
state the choice in `### Design`:
- (a) an inline driver for this workflow, mirroring
  `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` (how `dev-run` already
  honors inline against `task-pipeline.yaml`), so the host session interprets the three
  `agent.run` stages; or
- (b) the R3 headless fallback alone, i.e. `inline` degrades to tier resolution with a
  warning.
(a) is the honest reading of the operator's rule and makes `dev-find-issue` consistent with
`dev-run`; (b) is the smaller diff. If (b) is chosen, `dev-find-issue.md` must say so
plainly rather than advertising a host-session guarantee it does not provide.

**R6 — Purge the stale contract prose.** The rejection is documented across many surfaces;
all must land in the same commit as the code (constitution T3). Known surfaces:
- `plugins/sp/commands/dev-find-issue.md:28`, `plugins/sp/commands/dev-wrap.md`,
  `plugins/sp/commands/dev-wrapall.md`
- `plugins/sp/skills/spur-dev/references/cross-cutting.md:43-69, 84-90, 119-137, 153-157`
  (the "hard host-session guarantee" block, the four-row value table, the executor
  precedence chain's headless sentence)
- `plugins/sp/skills/spur-dev/references/flag-glossary.md:38-53`
- `plugins/sp/skills/spur-dev/references/dev-operations.md`,
  `execution-workflow.md`, `inline-pipeline-driver.md`,
  `plugins/sp/skills/next-router/SKILL.md`
- `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md §7.8`,
  `docs/design/agent-inline-host-session.md`,
  `docs/design/dev-agent-flag-and-dogfood-skill.md`,
  `docs/design/e2e-workflow-for-system-development.md`
Run `rg -n "requires a host session|zero-dispatch|hard host-session guarantee"` over
`docs/` and `plugins/` and close every live hit. Dogfood reports under `docs/dogfood/` are
historical records — do not rewrite them.

**R7 — Record the decision in ADR-047.** Add a dated amendment superseding the 2026-08-15
G5 amendment (`docs/00_ADR.md:401-416`): explicit `inline` is no longer a hard error on
headless surfaces; the unified table is inline (default) / auto / name; the debugging-trap
risk is mitigated by a mandatory substitution warning. State plainly that ADR-046's
workflow-specific rejection and the G5 amendment are both retired, so a future reader does
not resurrect them.

**R8 — Provider-scope the failure classifier.** `classifyDispatch`
(`packages/app/src/services/failure-classification.ts:78-92`) must only apply a rule whose
`provider` matches the dispatching executor's agent/provider. Thread the executor identity
(agent name and/or model provider prefix) from the call site
(`classifyObjectiveFailure`, `packages/app/src/services/agent-service.ts:2622`) into the
classifier. A dispatch whose provider matches no rule returns `undefined` (no escalation),
which is the existing precision-biased default. Add a regression test proving a `pi` crash
dump containing `contextWindow` and a `codex` stderr containing `quota` are NOT classified
as `resource-exhaustion` under a non-matching provider.

**R9 — Classify OS permission failures as their own signal, never as resource
exhaustion.** Add an `EPERM`/`operation not permitted`/`FS_PERMISSION_DENIED`/`bind:
operation not permitted` pattern that resolves to a non-escalating outcome (either a new
`environment` signal in `ObjectiveEscalationSignal`, or `undefined` with an explicit
comment). Escalating to a costlier tier cannot fix a sandbox denial — it burns budget and
buries the cause. The failure message must name the permission error verbatim.

**R10 — Restore agent-dispatch telemetry for workflow-driven runs.** Close the gap between
the emitted series and the queried series. Either:
- (a) thread the ledger bus into the workflow path —
  `apps/cli/src/commands/workflow.ts:231` becomes `context.agentService({ events: bus })`,
  matching `apps/cli/src/commands/agent.ts:425` — and prove the 0365 R9 / 0370 R4
  dual-emit fear does not materialize (assert exactly one `agent.invoke.start` per
  dispatch in a workflow run); or
- (b) actually emit the `workflow.agent` series that `workflow.ts:225-229` claims exists,
  and migrate `pairings.ts:187,202`, `role-tokens.ts:163,207` and
  `retro-correlation.ts:94` to read it (with a UNION over the legacy name so pre-08-20
  history keeps resolving).
(a) is strongly preferred: the analytics, the Board, and `spur history analyze` all already
speak `agent.invoke.*`, and (b) requires a read-side migration for every consumer. State
the choice and the dual-emit evidence in `### Design`.

**R11 — Prove the telemetry fix on real data.** After R10, a workflow run that dispatches
at least one `agent.run` stage must produce `agent.invoke.start` + `agent.invoke.exit` rows
carrying the routing block (executor, role, tier, source), and a bounded
`spur history analyze --since <today> --until <today>` must return a non-empty `pairings`
array. Record the before/after row counts in `### Testing`.

**R12 — Document the sandbox requirement for engine-driven work.** The environment fix is
the operator's to apply (`.claude/settings.json` is outside agent write scope), but the
requirement must be discoverable. Add a short "running engine-driven commands under a
sandboxed session" note to `plugins/sp/skills/dogfood-testing/SKILL.md` (or
`references/`), naming the two sandbox affordances subprocess executors need — write access
to the agent CLIs' state directories and `sandbox.network.allowLocalBinding` — and pointing
at the exact settings block in `### References`. Additionally, `spur agent doctor` reports
every executor as `usable` while all of them fail at startup under the sandbox: extend the
doctor probe, or note the known limitation, so `usable: true` is not read as "will run
here".
### Acceptance Criteria
**AC1 (R1, R2) — omission and `inline` are indistinguishable.**
Given any `/sp:dev-*` command or `spur agent run`,
When it is invoked with no `--agent` and again with `--agent inline`,
Then both resolve through the same code path, and neither emits an error, a rejection, or a
different resolved executor.

**AC2 (R3) — the rejection string is gone from the repo.**
Given the working tree after this task,
When `rg -n "requires a host session|AGENT_INLINE_HEADLESS_MESSAGE" apps packages plugins docs`
is run,
Then the only hits are historical dogfood reports under `docs/dogfood/` and the ADR-047
amendment text describing the retirement — no live code path, no command doc, no skill
reference.

**AC3 (R3) — headless `inline` resolves with a warning instead of failing.**
Given a bare shell with no host session,
When `spur workflow run history-anatomy.yaml --vars '{"mode":"daily","date":"<today>","agent":"inline"}'`
is run,
Then the run does NOT fail at `resolve-scope`; the run log contains one warning naming the
substituted executor and the reason (no host session); and the workflow proceeds through
its normal states.

**AC4 (R5) — the operator's original invocation produces a report.**
Given an unsandboxed session (or a sandbox configured per R12),
When `/sp:dev-find-issue --date <today> --agent inline` is run,
Then `docs/report/<today>-history-anatomy.md` exists, its frontmatter carries
`identity.bounds.since`/`until` for that local day, the structure gate recorded `PASS`, and
the independent validate leg recorded `Verdict: PASS`.

**AC5 (R8) — cross-provider quota patterns no longer fire.**
Given a failed dispatch on executor `pi-k3` whose stderr contains the substring
`contextWindow`, and a second on `codex-sol` whose stderr contains `quota`,
When `classifyDispatch` runs with each executor's provider identity,
Then neither returns `resource-exhaustion`, and no stage escalation is triggered.

**AC6 (R9) — permission failures are named, not escalated.**
Given a dispatch that exits non-zero with `EPERM: operation not permitted` or
`FS_PERMISSION_DENIED` in stderr,
When the failure is classified,
Then the result is not `resource-exhaustion`, no tier escalation occurs, and the surfaced
`agent.run` error text contains the permission error verbatim.

**AC7 (R10, R11) — workflow-driven dispatches land in the ledger.**
Given a workflow run containing at least one `agent.run` stage,
When the run completes,
Then `select count(*) from system_events where event_name='agent.invoke.start' and occurred_at >= <run start>`
is exactly the number of dispatches (one per dispatch, no dual-emit), each row's payload
carries the routing block with `executor`, `role`, and `tier`, and a matching
`agent.invoke.exit` row exists per dispatch.

**AC8 (R11) — pairing analytics come back to life.**
Given AC7 has produced rows for today,
When `spur history analyze --since <today-00:00 local> --until <today-23:59 local> --json`
is run,
Then the artifact's `pairings` array is non-empty and at least one entry carries a non-null
`executor` and `role`.

**AC9 (R5, R11) — the report's run-cost dimension is no longer structurally dead.**
Given AC8,
When the history-anatomy report for that day is generated,
Then its Performance analysis section reports the run's chained `agent.run` cost from the
pairing fold rather than rendering `not available` for every pairing.

**AC10 (R6, R7) — docs and ADR land in the same commit as the code.**
Given the commit implementing this task,
When its diff is inspected,
Then it contains the ADR-047 amendment, every command/skill/reference surface listed in R6,
and `bun run spur-check` passes (link-check, transition-shim-check, script-contract-check,
lint, test).

**AC11 (R12) — the sandbox requirement is discoverable.**
Given a reader of `sp:dogfood-testing`,
When they look for why an engine-driven testee fails at every executor,
Then they find the note naming the two required sandbox affordances (agent-CLI state
directory writes; `sandbox.network.allowLocalBinding`) and the settings block that grants
them.
### Q&A
**Q: Does removing the headless rejection re-open the G5 debugging trap (an `inline`
request silently running in another session)?**
A: No — R3 replaces silence with a mandatory warning naming the substituted executor and
the reason. G5's actual complaint (`docs/00_ADR.md:411-412`) was "with zero signal", not
"with a fallback". The signal is the fix; the refusal was over-correction.

**Q: `--max-retry 0` / observe-only dogfoods still can't run engine-driven testees under
the sandbox. Is R12 enough?**
A: R12 only makes the constraint discoverable; the sandbox patch in `### References` is the
actual unblock and is the operator's to apply. Both are needed.

**Q: Why not fix `spur agent doctor` to probe a real dispatch?**
A: Out of scope here beyond the R12 note — a real-dispatch probe costs a model call per
executor and needs its own design (caching, timeout, cost budget). Filed as a note, not a
requirement.

**Q: Should the `history-anatomy.yaml` `agent: "claude"` literal (`:71`) change?**
A: Not in this task. Once the selector defaults to `inline`, that literal is the last-resort
rung of the precedence chain and only fires when nothing else supplies an executor. Revisit
after R5 lands.

**Q: What about the six `history.daily.failed` events (last 2026-08-24) showing
`pi: failed; claude: failed; agy: degraded` import sources?**
A: Separate concern — import-source health, not dispatch. Today's coverage block reports
`ok` for claude/codex, so imports are currently working. Not folded into this task.
### Design
**Shape of the change: delete a rule, don't add machinery.** The selector today carries four
values (`omit`, `inline`, `auto`, `<name>`) and three special cases (omit-vs-inline
subagent eligibility, headless rejection, `agent.default` fallback). After this task it
carries three values and one rule per value. The diff should be net-negative in
`cross-cutting.md` and `flag-glossary.md`.

**Resolution order (the whole contract).**

| Selector | Host session present | No host session (headless) |
| --- | --- | --- |
| omitted → `inline` | native subagent if eligible, else host session | tier-resolve as `auto` + warn once |
| `inline` | identical to omitted | identical to omitted |
| `auto` | role → tier → cheapest usable executor | same |
| `<name>`/role | that executor, escalation ladder intact | same |

The only new behavior is the headless `inline` warning. It replaces a refusal with a
signal, which is the smallest change that satisfies both the operator's rule and the
original G5 concern.

**R5 mechanism — recommendation: (a) inline driver.** `dev-run` already honors inline
against `task-pipeline.yaml` through
`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`; `dev-find-issue` is the
only remaining lifecycle command whose model stages are unconditionally subprocessed. Giving
`history-anatomy.yaml` the same treatment makes the two consistent and is what the operator
means by "try a subagent, otherwise the host session". The three stages are already
skill-shaped and stateless (`resolve-scope`, `enrich`, `validate` each read named files and
write one named file), so the driver has to interpret three `agent.run` inputs and preserve
the shell actions and guards around them — no new state machine. Fall back to (b) only if
the driver cannot preserve the `expectFile` + `assert-clean` contracts, and say so in
`### Solution`.

**R10 mechanism — recommendation: (a) thread the bus.** The suppression at
`workflow.ts:225-231` is guarding against a dual-emit that the ledger shows never happens:
the replacement series has zero rows, so the "single series" the comment protects is
empty. Threading `{ events: bus }` (one line, mirroring `agent.ts:425`) restores the series
every consumer already reads. The dual-emit fear must be discharged with a test, not an
assumption — assert exactly one `agent.invoke.start` per dispatch inside a workflow run
(AC7). If that assertion fails, the correct response is to de-duplicate at the bridge, not
to reinstate the blackout.

**R8/R9 — keep the precision bias.** The classifier's existing design goal ("biased toward
precision … everything else returns `undefined`", `agent-service.ts:2609-2616`) is right;
it was simply undermined by the missing provider scope. Threading the provider makes the
existing narrow patterns behave as documented. Do not broaden any pattern in this task.
For R9, prefer returning `undefined` (no escalation) over inventing a new
`ObjectiveEscalationSignal` member unless the escalation ladder needs to branch on it —
adding a vocabulary member touches the domain type, the stage registry, and the Board.

**Sequencing.** R8/R9 and R10/R11 are independent of R1-R7 and can land first; they are
what make the resulting report trustworthy. R1-R3 are one change (the selector), R5-R7 are
its consequences. Suggested order: R8+R9 → R10+R11 → R1+R2+R3+R4 → R5 → R6+R7 → R12.

**Out of scope (explicitly).** Do not touch the tier ladder, role→tier map, executor
registry, or `agent doctor`'s tier logic beyond the R12 note. Do not migrate historical
`agent.invoke.*` rows. Do not rewrite dogfood reports.
### Plan
1. **R8 — provider-scope the classifier.** Thread executor provider identity from
   `classifyObjectiveFailure` (`agent-service.ts:2622`) into `classifyDispatch`
   (`failure-classification.ts:78`); filter `FAILURE_RULES` by `rule.provider`. Add the
   cross-provider regression tests (AC5) to
   `packages/app/tests/services/failure-classification.test.ts`.
2. **R9 — permission-failure classification.** Add the `EPERM` / `operation not permitted` /
   `FS_PERMISSION_DENIED` recognition, assert no escalation, and surface the verbatim
   permission text in the `agent.run` error (AC6).
3. **R10 — restore telemetry.** Change `apps/cli/src/commands/workflow.ts:231` to
   `context.agentService({ events: bus })`, remove the now-false comment at `:225-229`, and
   add the single-emit-per-dispatch test (AC7).
4. **R11 — prove it on real data.** Run one workflow with an `agent.run` stage; record
   before/after `agent.invoke.start` counts and the non-empty `pairings` array from a
   bounded `spur history analyze` (AC8). Confirm the report's Performance analysis stops
   rendering `not available` (AC9).
5. **R1-R4 — the selector.** Flip the default to `inline`
   (`agent-service.ts:1326`); generalize 0508 subagent eligibility to all inline
   resolution; delete `AGENT_INLINE_HEADLESS_MESSAGE` and its four call sites plus the
   `index.ts:51` re-export; add the headless substitution warning. Update the four test
   files that assert the rejection (`apps/cli/tests/commands/agent.test.ts:972,993`;
   `packages/app/tests/services/agent-service.test.ts:2189`;
   `packages/app/tests/workflow/actions/agent-run.test.ts:2003`) to assert the new
   resolve-with-warning behavior.
6. **R5 — make `/sp:dev-find-issue --agent inline` work.** Implement the chosen mechanism;
   run the operator's exact invocation end-to-end and confirm a published report (AC4).
7. **R6 — purge stale prose.** Sweep with
   `rg -n "requires a host session|zero-dispatch|hard host-session guarantee" docs plugins`
   and close every live hit; leave `docs/dogfood/` alone.
8. **R7 — ADR-047 amendment.** Dated entry retiring the G5 amendment and ADR-046's
   rejection.
9. **R12 — sandbox note.** Add the engine-driven/sandbox note to `sp:dogfood-testing`, and
   the `agent doctor` caveat.
10. **Gate.** `bun run autofix && bun run spur-check`; `bun run test-cf`; `bun run build`;
    `spur task check --corpus` if the corpus changed (AC10).
### Root Cause
Four verified causes, each reproduced during the 2026-08-26 dogfood.

**RC1 — the rejection is a deliberate design decision, not a bug.**
`packages/app/src/services/agent-service.ts:1334-1336` returns
`{ ok:false, exitCode:2, message: AGENT_INLINE_HEADLESS_MESSAGE }` for `raw === 'inline'`
before any resolution is attempted. It is wrapped for the workflow surface at
`packages/app/src/workflow/actions/agent-run.ts:139` and pre-checked at the CLI at
`apps/cli/src/commands/agent.ts:222`. The decision record is `docs/00_ADR.md:401-416`
(ADR-047 amendment 2026-08-15, feature G5 / task 0565): "Explicit `--agent inline` is a
hard host-session guarantee … headless surfaces … reject `inline` with the stable special
error". Its stated motive (`:411-412`) is that `inline` used to be silently equivalent to
`agent.default` on headless surfaces, so an inline request could execute in another session
with zero signal. The motive is sound; the chosen remedy — refuse the operator's explicit
request — is what this task retires. Note the surface inconsistency it also introduced: the
CLI returns exit 2 (`agent-service.ts:1335`), while the workflow surface maps the same
condition to a stage failure and exits **1**, so `dev-find-issue.md:28`'s promise of
"(exit 2)" is already wrong for the surface it documents.

**RC2 — the sandbox denies what every subprocess executor needs at startup.**
`.claude/settings.json` sets `sandbox.enabled: true`, `allowUnsandboxedCommands: false`,
`failIfUnavailable: true`, with a `sandbox.filesystem.allowWrite` list of
`.git/hooks`, `~/xprojects/ts-libs`, `~/.omp`, `~/tools/dot_files/config/omp`,
`.spur/workflows/`. Agent CLIs write session/credential state under their own home
directories (`~/.grok`, `~/.pi/agent`, `~/.gemini`, `~/.codex`) and antigravity-cli binds a
localhost port for its language server. Neither affordance is granted. Verified in-session:
`touch ~/.grok/.probe` → `Operation not permitted`; `socket.bind(('127.0.0.1',0))` →
`PermissionError: [Errno 1] Operation not permitted`. `spur agent doctor --json`
nonetheless reports all 14 executors `usable: true`, because the probe does not exercise a
real dispatch — which is why the dogfood believed it had three working fallbacks.

**RC3 — `classifyDispatch` ignores the `provider` field it declares.**
`packages/app/src/services/failure-classification.ts:78-92`:

```ts
for (const rule of FAILURE_RULES) {
    const statusMatch = rule.statusCodes?.some((code) => statusCodes.has(code)) ?? false;
    const patternMatch = rule.patterns.length > 0 && rule.patterns.every((p) => p.test(text));
    if (statusMatch || patternMatch) return rule.signal;
}
```

`rule.provider` (declared at `:6`, set on all seven rules) is never read; the caller
`classifyObjectiveFailure` (`agent-service.ts:2622`) passes only the `AgentRunResult`, which
carries no provider identity. `rg "\.provider" packages/app/src/services/failure-classification.ts
packages/app/src/services/agent-service.ts` returns nothing. So one executor's stderr is
matched against every provider's quota vocabulary. The `ollama` rule's
`/context[_ -]?(?:length|window)/i` matches `contextWindow` (the optional separator makes
the camelCase form match under `/i`), and the `gemini` rule matches a bare `quota`.

**Confidence split — read this before implementing.** The structural defect (`provider`
declared, never read; every rule applied to every executor) is CONFIRMED by source
inspection. The *specific* token that fired on 2026-08-26 is NOT confirmed: the observed
fact is the log line
`Stage escalation: stage=verify signal=resource-exhaustion from=pi-k3 to tier=capable-2`
emitted against a dispatch whose only real failure was `EPERM`, and the captured console
artifact (6.4 KB, truncated by the workflow's own stderr bounding) contains none of
`quota`, `contextWindow`, `context window`, `usage limit`, `overloaded`, `resource
exhausted`, `token limit`, `maximum context`, or `rate limit`. The full stderr the
classifier saw was not retained. Treat "the ollama or gemini rule matched a foreign
executor's crash dump" as a **hypothesis**; confirm it while implementing R8 by logging the
matched rule (provider + pattern) at classification time, then reproducing the pi-k3
dispatch under the sandbox. If no rule matched, the escalation came from a different seam
and R8's fix is still correct but its motive changes — say so in `### Solution`.

**RC4 — the emitted agent event series and the queried agent event series are different
series, and one of them does not exist.**
`apps/cli/src/commands/workflow.ts:225-231` deliberately constructs the workflow's
`AgentService` without an events bus:

```ts
// Intentionally leave AgentService without a server-style events bus: the
// workflow-dispatched agent lifecycle is the single `workflow.agent` series
// (0365 R9 / 0370 R4). Wiring AiRunner.events here would dual-emit
// `agent.invoke.*` for the same execution.
agentService: () => context.agentService(),
```

Compare `apps/cli/src/commands/agent.ts:425`, the direct-dispatch path, which does pass
`{ events: bus }`. In `AgentService` the bridge is conditional on that bus
(`agent-service.ts:866`: `this.ctx.events !== undefined ? bridgeEventBus(...) : undefined`),
so a workflow-driven dispatch emits no `agent.invoke.*`. The premise of the suppression —
that a `workflow.agent` series carries the lifecycle instead — is false on this ledger:

```
select count(*) from system_events where event_name like 'workflow.agent%';  -- 0
```

and no `agent.*` event of any name has been recorded since `2026-08-20T04:04:45Z`, while
215 `workflow.action.start` rows landed in the same period. Because `pairings.ts:187,202`,
`role-tokens.ts:163,207` and `retro-correlation.ts:94` all read `agent.invoke.start`/`.exit`,
every agent analytic silently returns empty for any window after 2026-08-20. Measured:
a bounded analyze for 2026-08-26 yields `pairings: 0` (30,849 records, 57 sessions);
the same analyze unbounded yields `pairings: 5`, all pre-08-20.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
**The run that produced this task**
- Dogfood report: `docs/dogfood/2026-08-26-sp-dev-find-issue-agent-inline-dogfood.md`
  (verdict PARTIAL; 2 fixed, 1 unresolved, 8 findings)
- Live ledger: `.spur/run/dogfood/20260827T034245Z-sp-dev-find-issue-agent-inline.md`
- Prior runs reproducing the same family: `docs/dogfood/2026-08-25-sp-dev-find-issue-agent-inline-dogfood.md`,
  `docs/dogfood/2026-08-25-sp-dev-find-issue-date-dogfood.md`

**Code seams**
- `packages/app/src/services/agent-service.ts:61-62` (`AGENT_INLINE_HEADLESS_MESSAGE`),
  `:866` (invoke bridge gate), `:1326` (selector default), `:1334-1336` (rejection),
  `:2609-2626` (classifier caller + precision-bias doc)
- `apps/cli/src/commands/agent.ts:222` (pre-check), `:421-425` (bus threading — the pattern to copy)
- `apps/cli/src/commands/workflow.ts:225-231` (deliberate suppression), `:448,645` (ledger attach)
- `packages/app/src/services/workflow-service.ts:1160` (`this.ctx.agentService()` — no events)
- `packages/app/src/workflow/actions/agent-run.ts:139` (wrapped rejection), `:393-402` (failure text)
- `packages/app/src/services/failure-classification.ts:6` (unused `provider`), `:78-92` (`classifyDispatch`)
- `packages/domain/src/analytics/pairings.ts:187,202`; `role-tokens.ts:163,207`;
  `retro-correlation.ts:94` (the queried series)
- `packages/app/src/index.ts:51` (re-export to delete)

**Tests that pin the retired behavior**
- `apps/cli/tests/commands/agent.test.ts:972,993`
- `packages/app/tests/services/agent-service.test.ts:2189`
- `packages/app/tests/workflow/actions/agent-run.test.ts:2003`
- `packages/app/tests/services/failure-classification.test.ts` (extend for AC5/AC6)

**Contract surfaces**
- `docs/00_ADR.md:332` (ADR H82 selector), `:364-380` (ADR-046 → ADR-047), `:401-416`
  (the G5 amendment to retire)
- `plugins/sp/skills/spur-dev/references/cross-cutting.md:43-69,84-90,119-137,153-157`
- `plugins/sp/skills/spur-dev/references/flag-glossary.md:38-53`
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` (the `dev-run` precedent)
- `plugins/sp/commands/dev-find-issue.md:28`; `dev-wrap.md`; `dev-wrapall.md`
- `config/workflows/history-anatomy.yaml:71` (`agent: "claude"` literal), `:99-106`
  (`resolve-scope` agent.run), `:183-190` (`enrich`), `:217-224` (`validate`)
- `plugins/sp/skills/history-anatomy/references/operations.md:48-50` (run-cost note that
  depends on the pairing fold)

**Environment fix (operator-applied — outside agent write scope)**
`.claude/settings.json` currently denies every agent CLI its state directory and any local
socket bind. The sandbox schema exposes `sandbox.network.allowLocalBinding` and
`sandbox.filesystem.allowWrite` (keys confirmed against the installed
`claude-code@2.1.246` binary). Minimal patch:

```json
{
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true,
    "allowUnsandboxedCommands": false,
    "failIfUnavailable": true,
    "network": { "allowLocalBinding": true },
    "filesystem": {
      "allowWrite": [
        ".git/hooks",
        "~/xprojects/ts-libs",
        "~/.omp",
        "~/tools/dot_files/config/omp",
        ".spur/workflows/",
        "~/.pi",
        "~/.grok",
        "~/.gemini",
        "~/.codex",
        "~/.cache"
      ]
    }
  }
}
```

Verification after applying (restart the session so the sandbox profile reloads):

```bash
touch ~/.grok/.probe && rm ~/.grok/.probe          # must succeed
python3 -c "import socket;s=socket.socket();s.bind(('127.0.0.1',0));print('bind ok')"
spur workflow run history-anatomy.yaml --vars '{"mode":"daily","date":"<today>","agent":"pi-k3"}'
```

`allowUnsandboxedCommands: true` would also unblock the run by permitting an explicit
sandbox opt-out per command, but it is the coarser instrument — prefer the two targeted
affordances above.

**Evidence queries**

```bash
sqlite3 .spur/spur.db "select event_name,count(*),max(occurred_at) from system_events \
  where event_name like 'agent%' group by event_name;"
sqlite3 .spur/spur.db "select count(*) from system_events where event_name like 'workflow.agent%';"
```
### History
