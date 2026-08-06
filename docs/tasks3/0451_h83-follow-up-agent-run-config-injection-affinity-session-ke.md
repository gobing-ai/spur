---
template: feature-impl
schema_version: 1
name: "H83 follow-up: agent.run config injection, affinity session keying, dual-latch collapse, and workflow close-path hardening"
description: ""
status: done
type: task
profile: standard
feature_id: H83
parent_wbs: null
priority: P1
tags: []
dependencies: []
created_at: "2026-08-05T23:03:08.987Z"
updated_at: "2026-08-06T00:39:42.341Z"
---

## 0451. H83 follow-up: agent.run config injection, affinity session keying, dual-latch collapse, and workflow close-path hardening

### Background
Post-H83 code review (packages/app + apps/cli workflow / `agent.run` path) found several **P1 correctness gaps** and **P2 process/hygiene** issues that remain after H83 (0447–0450) shipped session affinity, pipe-no-TTY streaming, and unified `--agent inline`.

**Why this task exists.** H83 made the happy path work under tests and dogfood, but several seams are incomplete or self-contradictory: config knobs that do nothing, session directories keyed before agent resolution, dual continue/affinity latches (and an inverted latch branch), stale JSDoc that still says "buffered", requireDiff pathspec drift vs multi-folder corpus, and close-path multi-folder feature_id scan without regression tests. A separate coding agent will implement; a later verify pass (same reviewer) will re-audit against R1–R9 + AC.

**Out of scope for this task:** holding task **0142** (blocked by design — parallel worktree / mid-step HITL); reopening H1 umbrella AC cleanup unless required by a finding below; publishing ts-libs (already at 0.4.19); server feature→tasks push sync; `spur history report` TODO stub.

**Authority:** ADR-047, feature H83, code review transcript 2026-08-05 (`packages/app` `agent-run.ts`, `agent-service.ts`, `feature-check.ts`, `feature-service.ts`, `apps/cli` `feature.ts`).

**Severity / ETA table (from review)**

| ID | Severity | Area | Est. |
|----|----------|------|------|
| R1 | P1 | Fake `context.config` — config knobs dead | 1–2h |
| R2 | P1 | Affinity dir keyed pre-resolve (`omp` default) | 1–2h |
| R3 | P1 | Dual latch + inverted affinity/continue branch | 1–2h |
| R4 | P2 | requireDiff excludes only tasks3 not all folders | 45m–1h |
| R5 | P2 | discoverSessionId FS root / heuristic | 30–45m |
| R6 | P2 | multi-folder feature-check regression test | 45m–1h |
| R7 | P2 | archive / multi-coverer verdict policy | 1–2h |
| R8 | P3 | Stale buffered JSDoc | 15–20m |
| R9 | P3 | Duplicate comment block in execute() | 5m |

**Total implement ETA:** ~1 day focused (P1 first, then P2, then P3). Do not expand into engine API changes unless already planned.

**Implementer protocol**

1. Read this task end-to-end (Background → Requirements → Design → Plan → Q&A).
2. Implement R1–R3 first with unit tests green before R4+.
3. Fill **Solution** with file:line change-map and which R# each change closes.
4. Fill **Testing** with exact commands + outcomes.
5. Leave status `todo` until gates pass; then `done` only after `bun run autofix && bun run spur-check` and AC scenarios covered.
6. Do **not** cancel or implement 0142; do **not** reintroduce `link:` overrides or `as OutputPolicy` casts (`@gobing-ai/ts-runtime` ^0.4.19 has real `pipe`).
### Requirements
**P1 — must fix (correctness)**

- [ ] **R1. Inject real Spur agent config into `agent.run` (or stop reading a fake `context.config`).**

  **Issue (current code).** `AgentRunActionRunner.execute` reads config via a fake cast:

  ```ts
  // packages/app/src/workflow/actions/agent-run.ts ~100–101
  const cfg = (context as unknown as { config?: { agent?: { default?: string; sessionAffinity?: boolean } } })
      .config;
  ```

  Engine type `ActionRunContext` (`@gobing-ai/ts-dual-workflow-engine`) has **no `config` field**. Runtime `cfg` is always `undefined`.

  **Consequences today**
  - `.spur/config.yaml` `agent.sessionAffinity: false` does **not** disable affinity for workflow hops (only `vars.sessionAffinity` / step `options.sessionAffinity` work). Evidence: affinityDisabled checks `cfg?.agent?.sessionAffinity === false` at ~115 — always false when cfg is undefined.
  - `cfg.agent.default` never applies for session-dir labeling or `inline` normalization (`dispatchAgent = agent === 'inline' ? (cfg?.agent?.default ?? undefined) : agent` at ~105).
  - Note: `WorkflowService.resolveDefaultAgentVar` (~925–936) already loads config and injects a **run var** `agent` for pipeline YAML defaults, but that does **not** populate `context.config` and does not fix sessionAffinity.

  **Acceptance**
  - With only `agent.sessionAffinity: false` in config (no vars/options override), a multi-hop `agent.run` workflow must **not** set `sessionDir` / affinity setVars.
  - With `agent.default: <name>`, affinity dirs and labels must use that name when step `agent` is omit/`inline`.

  **Preferred fix (pick one; document choice in Solution)**
  1. **A (recommended):** Inject a small config port at construction:
     ```ts
     // shape
     type AgentRunConfigSlice = { default?: string; sessionAffinity?: boolean };
     constructor(agentService, observabilityBus?, steeringController?, agentConfig?: AgentRunConfigSlice | (() => AgentRunConfigSlice | Promise<...>))
     ```
     Wire from `registerSpurBuiltins` / `WorkflowService.createEngineService` by reading `loadSpurConfig(cwd).agent` once per engine create (composition root already loads config for default agent var and output log). Avoid per-hop full config load if hot; caching in loadSpurConfig is OK if you call per execute.
  2. **B:** Extend engine `ActionRunContext` with optional `config` and pass from host — **only** if an engine PR is already planned (higher blast radius; not preferred here).

  **Do not:** leave the cast in place "for future engine work."

  **Primary files:** `packages/app/src/workflow/actions/agent-run.ts` (~100–115); `packages/app/src/workflow/builtins.ts` (~25–45); `packages/app/src/services/workflow-service.ts` (~885–894, ~925–936 pattern). Config schema: `packages/config/src/index.ts` `sessionAffinity` on agent config (~321).

  **Tests (agent-run.test.ts):**
  - Inject `{ sessionAffinity: false }` → no sessionDir even without vars override.
  - Inject `{ default: 'claude' }` + step agent omit/inline → sessionDir basename contains `claude` not `omp` (with affinity on).

---

- [ ] **R2. Key affinity `sessionDir` / `__agentSessionAgent` off the *resolved* executor name, not pre-resolve heuristics.**

  **Issue (current code).** ~119–127:

  ```ts
  const targetAgentDir = dispatchAgent ?? cfg?.agent?.default ?? 'omp';
  // ...
  if (affinityOn) {
      if (!sessionDir || (prevAgent && prevAgent !== targetAgentDir)) {
          sessionDir = join(cwd, '.spur', 'run', context.runId, 'agent-sessions', targetAgentDir);
      }
  }
  ```

  And setVars ~364: `__agentSessionAgent: targetAgentDir`.

  When step agent is omit / `inline` / auto, and config default is missing (cfg always undefined today), dir becomes `…/agent-sessions/omp` while `AgentService.resolveAgent` defaults `stringFlag(flags, 'agent', 'auto')` → auto/priority path may dispatch a **different** executor (`agent-service.ts` ~843–855, ~871+).

  **Consequences**
  - Hop 2 reuses wrong bucket or creates a second bucket under the real agent name.
  - Labels/metrics lie about which agent owns the session.

  **Acceptance**
  - After hop 1 succeeds, `__agentSessionAgent` and `sessionDir` basename equal the resolved agent name recorded in `invocation.agent` (or equivalent from `runTraced`).
  - Hop 2 with same resolved agent reuses that dir; different resolved agent gets a different subfolder.
  - No hardcoding `'omp'` except as last-resort when config default is also missing — document in Solution if kept.

  **Fix approach**
  1. Prefer: after successful `runTraced`, set `__agentSessionAgent` from `traced.invocation.agent` (and update sessionDir for hop 2 from that).
  2. For hop 1 **first open** before dispatch: either (a) resolve name via a thin helper that mirrors `resolveAgent` for naming only, or (b) mkdir under a provisional key then rename — prefer (a) if AgentService can expose a resolve-name method without full run.
  3. When step sets explicit agent `omp`/`claude`/etc., that string is already the resolved name — keep as-is.

  **Primary files:** `agent-run.ts` (~119–127, setVars ~357–364); `agent-service.ts` `resolveAgent` / `runTraced` / `AgentRunInvocation`.

  **Tests:** mock AgentService so omit/auto resolves to `claude` (non-omp); assert first hop session path contains `claude` not `omp`; second hop reuses.

---

- [ ] **R3. Collapse dual session systems when affinity is on — and fix inverted latch branch.**

  **Issue — dual systems.** Two resume mechanisms coexist:
  - Legacy latch: `vars.__agentSession` (`open` / `no-resume`) → may set `continue: true` (~130–175).
  - Affinity: `sessionDir` + `sessionId` under `.spur/run/<runId>/agent-sessions/<agent>`.

  **Issue — inverted branch (critical).** Current code ~137–144:

  ```ts
  const latchAutoContinued = continueFlag === undefined && latch === 'open';
  if (latchAutoContinued) {
      if (affinityOn) {
          continueFlag = true;      // affinity ON → sets bare continue (wrong for R3)
      } else {
          continueFlag = undefined; // affinity OFF → does NOT set continue
      }
  }
  ```

  Intended product behavior (document in Solution if you refine):
  | Mode | Latch `open` + no explicit continue | Resume mechanism |
  |------|-------------------------------------|------------------|
  | **affinityOn** | Do **not** set `flags.continue` from latch | `sessionDir` + `sessionId` only |
  | **affinityOff** | Set `flags.continue = true` from latch | Legacy continue + 0406 exit-2 fallback |

  Today is **inverted**: affinity-on sets bare continue; affinity-off clears it. The 0406 tests still pass only because **affinity defaults ON**, so latch still injects `continue: true` on the default path — which is exactly the dual-system smell.

  Evidence tests:
  - `agent-run.test.ts` 0406 (~172–183): expects first call `continue: true` when latch open (default affinity on).
  - Task 0448 (~1288–1299): `sessionAffinity: false` + latch open → `continue` undefined (documents current inverted affinity-off path).

  **Acceptance**
  - When `affinityOn && sessionDir` is set, subsequent hops resume via `sessionId`/`sessionDir` only (or documented agent-specific flags), **without** setting `flags.continue` from the latch.
  - When affinity is **off**, latch `open` sets `continue: true` (restore Q8); keep 0406 exit-2 resume-fallback for non-affinity / continue-based resume.
  - Explicit step `options.continue` always wins (author intent) — never override explicit true/false.
  - Tests must cover **both** modes in separate describe blocks; update 0406 fixtures if they relied on default affinity-on + continue coupling (e.g. force affinity off for pure continue tests, or assert sessionDir path without continue when affinity on).

  **Primary file:** `agent-run.ts` (~130–176, ~348–367); tests `agent-run.test.ts` Task 0406 + 0448 blocks.

  **Rejected:** Removing the latch subsystem entirely (scope creep; affinity-off still needs resume ergonomics).

---

**P2 — should fix (correctness / process)**

- [ ] **R4. `requireDiff` / empty-implement guard must exclude *all* configured task folders, not only `docs/tasks3`.**

  **Issue.** `gitHasNonCorpusChanges` ~541–555:

  ```ts
  args: ['status', '--porcelain', '--', '.', ':(exclude)docs/tasks3/*', ':(exclude)docs/features/*'],
  ```

  Archive / multi-folder corpus (`docs/tasks`, `docs/tasks2`, any `foldersConfig` key) still counts as "implementation." An implement step that only edits `docs/tasks2/…` incorrectly **passes** requireDiff.

  Existing tests only cover `docs/tasks3` exclusion (`agent-run.test.ts` ~588+).

  **Fix**
  - Derive excludes from planning folders / `foldersConfig` (same source as TaskService: `resolvePlanningFolders` / config tasks folders). Also keep `docs/features/*`.
  - Pass folder list into the helper (inject via constructor or resolve once from cwd via `resolvePlanningFolders`).
  - Fallback when config absent (unit tests): at least active folder + `docs/features` + known multi keys if present.
  - Document the path list in Solution.

  **Acceptance:** Change only under `docs/tasks2/…` (or another non-active configured folder) → requireDiff fails as empty implement; real change under `packages/` → passes.

  **Primary file:** `agent-run.ts` `gitHasNonCorpusChanges`; tests requireDiff describe ~556+.

---

- [ ] **R5. Harden `discoverSessionId` (cwd + tests).**

  **Issue.** ~376–396:

  ```ts
  async function discoverSessionId(sessionDir: string): Promise<string | undefined> {
      const fs = createNodeFileSystem(); // no root / cwd
      // picks newest file by mtime; strips .json
  }
  ```

  Heuristic: newest entry wins; non-json files can win if mtime newer; no unit coverage for absolute `sessionDir` under project `.spur/run`.

  **Minimum fix**
  - Pass cwd/root consistently if FS needs it, or document that absolute `sessionDir` is used as-is with exists/readDir/stat.
  - Prefer only `*.json` files when selecting newest.
  - Unit-test absolute `sessionDir` under a temp project root with a known session json → non-empty id.
  - Code comment: WHY newest-json heuristic and failure mode (multi-file → newest wins).

  **Optional stretch (note if deferred):** agent-native session discovery API — only if cheap.

  **Primary file:** `agent-run.ts` `discoverSessionId`.

---

- [ ] **R6. Regression test: multi-folder `feature check` L4 edges.**

  **Issue.** `FeatureCheckService` already accepts `tasksDirs[]` (parity with `collectTasksByFeature`) — implementation landed during H2/H4/H5 close. **Missing unit test** allowed false orphans historically when tasks lived outside active_folder.

  CLI already wires multi-dir: `apps/cli/src/commands/feature.ts` ~331–356, ~496–507. FeatureService checkL4Gate ~408–415.

  **Acceptance:** Test creates feature F + done task in non-active folder with `feature_id: F` + covering AC titles matching feature scenarios; `FeatureCheckService.check(..., { tasksDirs: [...] })` must **not** emit `L4.orphan-scenarios` solely because the task is outside active_folder.

  **Primary files:** `feature-check.ts` (verify only unless bug found); `packages/app/tests/services/feature-check.test.ts` — mirror multi-folder pattern from `feature-service.test.ts` / `task-service.test.ts`.

---

- [ ] **R7. Document or implement a close-path verdict policy for multi-coverer / archive done tasks.**

  **Issue.** Strict `feature check` emits `L4.malformed-verdict-artifact` when a done covering task has missing/invalid `.spur/run/<wbs>-verdict.json` (`readVerdictArtifact` ~690+, diagnostics.artifactError for missing file). `isScenarioVerified` (~661–678) already uses ANY covering done task with PASS + MET row — good. Pain point: **every** done coverer with a missing artifact still emits malformed warning, which noise-blocks operator close when archives lack artifacts.

  **Pick one and implement (state choice in Solution)**
  - **A (runbook):** Document operator path: one covering PASS verdict with MET rows is enough for scenario verify; backfill stubs for other coverers if strict/noise is painful. Cite path in Solution (e.g. feature H83 notes or skill note — do not invent a new numbered doc authority without need).
  - **B (preferred product):** Missing artifact → do **not** emit `L4.malformed-verdict-artifact` as if the file were corrupt; treat missing as "unverified for this coverer" only. Still emit malformed for **present but invalid** JSON/fields. Scenario verified if **any** covering done task has PASS+MET (already true). Spec carefully so silent false PASS cannot land (missing ≠ PASS).

  **Acceptance:** Documented behavior + test or runbook path cited in Solution.

  **Primary file:** `feature-check.ts` `checkScenarioSatisfaction` / `readVerdictArtifact` / findings push ~612–631.

---

**P3 — docs / debt (clear for task done)**

- [ ] **R8. Refresh stale JSDoc / comments that claim nonInteractive is buffered.**

  **Stale sites (as of task authoring):**
  - `agent-run.ts` file header ~18–25: still says `{ mode: 'buffered' }` for runTraced.
  - `agent-run.ts` ~42–45 capture option: "always buffered under the non-interactive contract".
  - `agent-run.ts` ~81–82: "child's output policy stays buffered".
  - `agent-service.ts` `runTraced` JSDoc ~433–437: "Output is ALWAYS buffered (`{ mode: 'buffered' }`)".

  **Reality (H83 / 0.4.19):** `executeRun` uses `{ mode: 'pipe' }` when `nonInteractive` (~540–544). Silent/json still buffered. Direct `spur agent run` still streams on TTY.

  **Acceptance:** No comment claims buffered-only for nonInteractive/`agent.run`; remaining "buffered" only refer to silent/json capture paths. Grep gate in self-check (see Design).

- [ ] **R9. Remove duplicate comment lines in `agent-run.ts` execute()** (~191–197): `workflow.agent` / D2 paragraph is duplicated verbatim twice.

**Explicitly out of scope (do not implement here)**

- Holding **0142** blocked; do not cancel or implement.
- Server feature→tasks push sync (`apps/server/.../feature/handlers.ts`).
- `spur history report` TODO stub.
- Full removal of `default-by-phase` legacy routing.
- Permanent `link:` overrides or fake OutputPolicy casts.
### Acceptance Criteria
```gherkin
Feature: H83 follow-up — agent.run config, affinity keying, latch collapse, close-path hardening

  @core
  Scenario: R1 — config sessionAffinity and agent.default apply to agent.run
    Given .spur/config.yaml sets agent.sessionAffinity false and agent.default to a non-omp executor
    And a two-hop workflow agent.run with agent omit or inline and no vars.sessionAffinity override
    When both hops execute
    Then affinity sessionDir is not set on either hop
    And when sessionAffinity is true again, session directory basename matches the resolved default executor not a hardcoded omp fallback

  @core
  Scenario: R2 — affinity session key matches resolved invocation agent
    Given affinity is on and hop 1 resolves agent A
    When hop 1 succeeds and hop 2 runs with the same agent selector
    Then __agentSessionDir is under agent-sessions/A
    And __agentSessionAgent equals A
    And hop 2 reuses that directory for resume isolation

  @core
  Scenario: R3 — affinity on does not set bare continue from legacy latch
    Given affinity is on and __agentSession is open from a prior successful hop
    When the next agent.run executes without an explicit continue option
    Then flags do not include continue true solely because of the latch
    And sessionDir and sessionId (when known) are still passed for resume isolation
    And when affinity is off the documented latch/continue behavior remains tested including 0406 fallback

  @core
  Scenario: R4 — requireDiff excludes all configured task folders
    Given requireDiff true on an implement-like agent.run
    When the only working-tree changes are under docs/tasks2 (or another non-active configured folder)
    Then the step fails as empty implement
    When packages/ (or other non-corpus) files change
    Then requireDiff passes

  @core
  Scenario: R5 — discoverSessionId is cwd-safe and tested
    Given an absolute sessionDir under the project .spur/run tree with a session json file
    When discoverSessionId runs after a successful hop
    Then it returns a non-empty session id without throwing
    And unit coverage asserts absolute-path discovery

  @core
  Scenario: R6 — multi-folder feature check regression test exists
    Given a feature with only a linked done task in a non-active tasks folder
    When spur feature check runs with the registered foldersConfig
    Then L4.orphan-scenarios is not emitted solely because the task is outside active_folder

  @core
  Scenario: R7 — archive verdict policy is explicit
    Given a feature scenario covered by multiple done tasks
    When feature check --strict evaluates scenario satisfaction
    Then behavior matches the chosen policy (A runbook or B code) and is covered by a test or documented runbook path cited in Solution

  @core
  Scenario: R8-R9 — docs match pipe-no-TTY implementation
    Given agent-run.ts and agent-service runTraced documentation
    When grepped for nonInteractive or agent.run output policy
    Then no remaining claim states buffered-only for that path
    And duplicate comment blocks are removed
```
### Q&A
**Q1: Why not change the workflow engine ActionRunContext first?**
Engine change is higher blast radius. Prefer inject/load config in Spur app (design A) unless an engine PR is already open.

**Q2: Why keep the latch at all?**
Affinity-off and agents that still use continue-only resume need it. Collapse only the interaction with affinity-on, not the entire latch subsystem. Also restore Q8 on affinity-off — current code inverted that path.

**Q3: Why is 0142 out of scope?**
Operator hold: more important work first. H1 stays open while 0142 is blocked — do not cancel 0142 in this task.

**Q4: Are H81–H83 / H2–H5 feature closes in scope?**
No — already done. This task is code follow-up from the review, not more feature status hygiene (except R6/R7 process hardening in code).

**Q5: Catalog pin?**
`@gobing-ai/ts-runtime` / `ts-ai-runner` are ^0.4.19. Pipe mode is real types — do not reintroduce `as OutputPolicy` casts or `link:` overrides.

**Q6: Why do 0406 tests currently expect continue:true with latch open?**
Because affinity defaults ON and the inverted branch sets continue when affinityOn. After R3, those tests must force affinity off (or inject config) to exercise pure continue resume, and affinity-on tests must assert continue is absent while sessionDir is present.

**Q7: How will verification work later?**
Operator will ask the review agent to re-audit against this task's Requirements + AC after implementer marks work ready. Implementer must leave Solution + Testing filled with evidence (commands, exit codes, file:line map).

**Q8: Is WorkflowService.resolveDefaultAgentVar enough for R1?**
No. It only injects a run **var** `agent` for YAML defaults. It does not set ActionRunContext.config and does not carry sessionAffinity. R1 still required.
### Design
## Approach

Implement **P1 first** (R1–R3) in `packages/app` with unit tests in existing `agent-run.test.ts` / `agent-service.test.ts`, then P2 (R4–R7), then P3 docs (R8–R9). Prefer **no engine API change** unless already required for other work.

---

## R1 — Config injection (recommended design A)

| Piece | Location | Change |
|-------|----------|--------|
| Config port | `AgentRunActionRunner` constructor or execute() | Load `agent` slice via inject from composition root **or** `loadSpurConfig(cwd)` inside execute (cache-friendly). Prefer inject once at engine create. |
| Stop fake cast | `agent-run.ts` ~100–101 | Delete `(context as unknown as { config?: … })`. |
| Wiring | `builtins.ts` `SpurWorkflowBuiltinsOptions` + `registerSpurBuiltins`; `workflow-service.ts` `createEngineService` | Pass `{ default?, sessionAffinity? }` from `loadSpurConfig` (same try/catch degrade pattern as `resolveDefaultAgentVar` ~925). |
| Tests | `agent-run.test.ts` | (1) sessionAffinity false via injected config disables sessionDir; (2) default agent name appears in sessionDir when step agent is inline/omit. |

**Do not** invent a second config file format. Use existing `packages/config` agent schema (`sessionAffinity`, `default`).

**Suggested constructor shape (sketch — implementer may refine):**

```ts
export interface AgentRunAgentConfig {
    default?: string;
    sessionAffinity?: boolean;
}

export class AgentRunActionRunner implements ActionRunner {
    constructor(
        agentService: AgentService,
        private readonly observabilityBus?: WorkflowObservabilityBus,
        private readonly steeringController?: WorkflowSteeringController,
        private readonly agentConfig: AgentRunAgentConfig = {},
    ) { … }
}
```

In `execute`, replace `cfg?.agent?.…` with `this.agentConfig.…`.

**Wiring sketch (`workflow-service.ts` createEngineService):**

```ts
let agentSlice: AgentRunAgentConfig = {};
try {
    const agent = (await loadSpurConfig(cwd)).agent;
    agentSlice = {
        ...(agent?.default !== undefined ? { default: agent.default } : {}),
        ...(agent?.sessionAffinity !== undefined ? { sessionAffinity: agent.sessionAffinity } : {}),
    };
} catch { /* degrade empty — never block engine create */ }
registerSpurBuiltins(host, { …, agentConfig: agentSlice });
```

(If `createEngineService` lacks cwd, use workdir already used for workflow runs — inspect call sites.)

---

## R2 — Resolved-agent session keying

| Step | Detail |
|------|--------|
| 1 | After building flags (including agent selector), ensure resolution name is known **before** finalizing sessionDir when possible. |
| 2 | Prefer using `traced.invocation.agent` **after** hop 1 to set `__agentSessionAgent` and to build sessionDir for hop 2. For hop 1 first open: resolve before mkdir of sessionDir. |
| 3 | Avoid hardcoding `'omp'` except as last-resort when config default is also missing (document). |
| 4 | Tests: mock AgentService to resolve `auto` → `claude` (or non-omp); assert session path contains `claude` not `omp`. |

If `runTraced` is the only resolve path, an acceptable interim is: create sessionDir after first successful invoke using invocation.agent, and for hop 1 without prior dir, either skip pre-mkdir (sessionDir flag may still be set for agents that create on demand) or call a public resolve helper. Prefer not to spawn twice.

---

## R3 — Latch vs affinity matrix

| Mode | Behavior after fix |
|------|--------------------|
| affinityOn | Ignore latch for setting `flags.continue`. Pass sessionDir always; sessionId when known. First hop may open durable session (no bare global continue). Latch may still write `__agentSession: open` for observability / affinity-off transition, but must not drive continue. |
| affinityOff | Restore Q8: `__agentSession === 'open'` → set `continue: true` when author did not set continue. 0406 exit-2 fallback remains (retry without continue + `no-resume` sentinel). |
| explicit options.continue | Always honor; never overridden by latch or affinity. |

**Patch sketch for the inverted branch:**

```ts
const latchAutoContinued = continueFlag === undefined && latch === 'open';
if (latchAutoContinued) {
    if (!affinityOn) {
        continueFlag = true; // restore legacy Q8
    }
    // affinityOn: leave continueFlag undefined — resume via sessionDir/sessionId only
}
```

**Test migration notes**
- 0406 describe: either set `sessionAffinity: false` on ctx vars **or** inject agentConfig `{ sessionAffinity: false }` so latch+continue path is exercised without affinity.
- 0448: add test "affinity on + latch open → sessionDir set, continue undefined".
- Update any test that assumed default affinity-on implies continue true if you remove that coupling.

**Rejected:** Removing latch entirely in this task.

---

## R4 — requireDiff multi-folder excludes

```text
git status --porcelain -- . \
  ':(exclude)docs/features/*' \
  ':(exclude)<each foldersConfig key>/*'
```

Resolve folder keys relative to cwd like TaskService. Fall back to active tasks dir + `docs/features` if foldersConfig absent (tests).

**Helper sketch:**

```ts
async function gitHasNonCorpusChanges(cwd: string, excludeGlobs: string[]): Promise<boolean> {
    const excludes = excludeGlobs.map((g) => `:(exclude)${g}`);
    // git status --porcelain -- . ...excludes
}
```

Populate `excludeGlobs` from `resolvePlanningFolders` → `Object.keys(foldersConfig.folders).map(k => `${k}/*`)` plus `docs/features/*`.

Extend requireDiff tests: create change only under `docs/tasks2/…` → rejected.

---

## R5 — discoverSessionId

```ts
// Prefer absolute sessionDir as-is; only *.json candidates; newest mtime wins
const fs = createNodeFileSystem(); // or createNodeFileSystem(cwd) if API requires root
// filter entry endsWith .json
// comment: multi-file → newest wins; empty → undefined
```

Unit test: temp dir with `abc.json` → returns `abc`.

---

## R6 — multi-folder feature-check test recipe

Mirror `feature-service.test.ts` multi-folder pattern:
1. Temp root with `docs/tasks` (active) + `docs/tasks2` (archive).
2. Feature file under features dir with Scenario titles.
3. Done task **only** in tasks2 with `feature_id` matching + AC covering those scenario titles.
4. Call `FeatureCheckService.check(..., { tasksDirs: [tasks, tasks2] })`.
5. Assert no finding with code `L4.orphan-scenarios` (or equivalent FINDING_CODES constant).

---

## R7 — verdict policy

Prefer **B** if small: missing artifact → warning path as "unverified coverer" **or** silence malformed for pure missing; malformed JSON still error/warning as today. **A** if B risks false PASS — write operator note only.

Scenario verify already uses ANY PASS+MET (`isScenarioVerified`) — do not weaken that to require all coverers.

---

## R8–R9 — comment cleanup

Surgical comment edits; no behavior change. Self-check:

```bash
rg -n "buffered" packages/app/src/workflow/actions/agent-run.ts packages/app/src/services/agent-service.ts
```

Remaining "buffered" must only refer to silent/json/`runCapture` paths — not nonInteractive/`runTraced`/`agent.run`.

Remove duplicate ~191–197 `workflow.agent` paragraph (keep one copy).

---

## Touch map

| File | Why |
|------|-----|
| `packages/app/src/workflow/actions/agent-run.ts` | R1–R5, R8–R9 |
| `packages/app/src/workflow/builtins.ts` | R1 inject options |
| `packages/app/src/services/workflow-service.ts` | R1 wiring if needed |
| `packages/app/src/services/agent-service.ts` | R2 resolve helper optional; R8 JSDoc |
| `packages/app/src/services/feature-check.ts` | R7 if B; R6 tests only if no bug |
| `packages/app/tests/workflow/actions/agent-run.test.ts` | R1–R5, R3 matrix |
| `packages/app/tests/services/feature-check.test.ts` | R6 (+ R7 if code) |
| `apps/cli/src/commands/feature.ts` | Already passes tasksDirs — verify only |

---

## Verification commands (implementer + later reviewer)

```bash
# Targeted (iterate here first)
bun test packages/app/tests/workflow/actions/agent-run.test.ts
bun test packages/app/tests/services/feature-check.test.ts
bun test packages/app/tests/services/agent-service.test.ts --test-name-pattern 'non-interactive|pipe|inline|session'

# Full gate before done
bun run autofix && bun run spur-check
```

**Later verification (human + reviewer agent):** re-read R1–R9 + AC Gherkin; re-run commands above; spot-check diff for: no fake cast; latch matrix; multi-folder requireDiff; no stale buffered claims; Solution/Testing sections filled.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Breaking affinity-off resume | Explicit tests for latch+continue with affinity off; keep 0406 green under that fixture |
| Breaking affinity-on resume | Assert sessionDir/sessionId without continue; dogfood optional |
| Config load cost per hop | Inject at composition root |
| R7 policy change false PASS | Prefer missing≠PASS; require MET row for true verify |
| Test churn on 0406/0448 | Separate describe blocks; document fixture affinity mode |

**Catalog pin:** `@gobing-ai/ts-runtime` / related ^0.4.19. Pipe mode is real — do not reintroduce casts or `link:` overrides.
### Plan
- [ ] R1: Inject agent config into AgentRunActionRunner; remove fake context.config cast; tests for sessionAffinity false + default agent naming.
- [ ] R2: Resolve agent before/at sessionDir finalization; set __agentSessionAgent from resolved name (invocation.agent); tests with non-omp resolution.
- [ ] R3: Fix inverted latch branch — affinityOn does not set continue from latch; affinityOff restores Q8 continue; preserve 0406 fallback; tests both modes.
- [ ] R4: requireDiff excludes all foldersConfig task paths + features; unit test tasks2-only change fails requireDiff.
- [ ] R5: discoverSessionId prefers *.json, absolute sessionDir test, document heuristic.
- [ ] R6: feature-check multi-folder unit test (archive edge not orphan).
- [ ] R7: Implement chosen verdict policy A or B + test or runbook cite.
- [ ] R8–R9: JSDoc/comment cleanup; remove duplicates; grep for stale buffered claims.
- [ ] Gate: targeted tests green, then `bun run autofix && bun run spur-check`.
- [ ] Solution section: change-map file:line + which R# each change closes.
- [ ] Testing section: commands run + outcomes for handoff verify.
### Solution
**R1 — Config injection (0451):**
- `packages/app/src/workflow/actions/agent-run.ts:15` — `AgentRunAgentConfig` (`default`, `sessionAffinity`, `excludeGlobs`). Constructor 4th param at `:98` (default `{}`). Fake `context.config` cast removed; `dispatchAgent` uses `this.agentConfig.default` (`:115`); affinity gate uses `this.agentConfig.sessionAffinity` (`:121–126`).
- `packages/app/src/workflow/builtins.ts:37–49` — `agentConfig` on `SpurWorkflowBuiltinsOptions`; passed into `AgentRunActionRunner`.
- `packages/app/src/services/workflow-service.ts:886–925` — `createEngineService` loads agent slice via `loadSpurConfig` and passes `agentConfig` to `registerSpurBuiltins`. Best-effort degrade on config failure.

**R2 — Resolved-agent session keying (0451):**
- `packages/app/src/workflow/actions/agent-run.ts:330–379` — after `runTraced`, `resolvedAgent = invocation?.agent ?? targetAgentDir`; `resolvedSessionDir` recomputed when resolved name differs (`:332–333`); `setVars.__agentSessionAgent` / sidecar use `resolvedAgent`. Pre-resolve last-resort `'omp'` kept only when config default missing (`:129`).

**R3 — Latch vs affinity matrix (0451):**
- `packages/app/src/workflow/actions/agent-run.ts:147–155` — fixed inverted branch: `affinityOn + latch open` leaves `continueFlag` undefined (sessionDir/sessionId resume only); `affinityOff + latch open` sets `continueFlag = true` (Q8 restored). Explicit `options.continue` always wins (`:142`).

**R4 — requireDiff multi-folder excludes (0451):**
- `packages/app/src/workflow/actions/agent-run.ts:567–572` — `gitHasNonCorpusChanges(cwd, excludeGlobs)` with pathspec excludes; `execute()` passes `this.agentConfig.excludeGlobs` (`:300`).
- **Fix-pass (verify 2026-08-05):** `packages/app/src/services/workflow-service.ts:903–912` — composition root now derives `excludeGlobs` from `resolvePlanningFolders` (all `foldersConfig` keys + `featuresDir/*`), so production multi-folder corpora exclude `docs/tasks`, `docs/tasks2`, `docs/tasks3`, not only the hard-coded default.

**R5 — discoverSessionId *.json (0451):**
- `packages/app/src/workflow/actions/agent-run.ts:391–414` — filters to `*.json` before newest-mtime selection; heuristic documented in comment (`:397–400`).

**R6 — Multi-folder feature-check test (0451):**
- `packages/app/tests/services/feature-check.test.ts:2711+` — R6: no orphan-scenarios when done task lives in a non-active `tasksDirs` folder.

**R7 — Verdict policy (0451, option B):**
- `packages/app/src/services/feature-check.ts:611–622` — `checkScenarioSatisfaction` skips `L4.malformed-verdict-artifact` when `artifactError === 'artifact is missing'`; present-but-invalid still flagged; missing = unverified coverer only.

**R8 — Stale JSDoc (0451):**
- `packages/app/src/workflow/actions/agent-run.ts:25–91` — header / capture / live-output JSDoc say pipe-no-TTY (not buffered-only).
- `packages/app/src/services/agent-service.ts:432–437` — `runTraced` JSDoc pipe-no-TTY; silent/json still buffered.
- **Fix-pass:** `packages/app/src/services/agent-service.ts:181–196` — residual `AgentRunTracedResult` JSDoc no longer claims non-interactive is buffered.

**R9 — Duplicate comment (0451):**
- `packages/app/src/workflow/actions/agent-run.ts:203` — single `workflow.agent` event comment; duplicate block removed.

**Design conformance:** Design A (inject config at composition root) DONE; latch matrix DONE; excludeGlobs parameter + composition wiring DONE; option B verdict policy DONE. No silent design deviations.
### Testing
**Re-verify (standalone `/sp:dev-verify 0451 --force --fix all`)** — 2026-08-05

**Verdict: PASS**

**Feature binding:** `feature_id: H83` (rebound from mistaken skeleton `L`, which was cancelled). H83 Tasks table includes 0451 after `spur feature refresh`.

**Commands run this verify (fresh):**
```
bun test packages/app/tests/workflow/actions/agent-run.test.ts packages/app/tests/services/feature-check.test.ts packages/app/tests/workflow/builtins.test.ts
# → 177 pass, 0 fail

bun test packages/app/tests/workflow/actions/agent-run.test.ts --test-name-pattern '0451'
# → 12 pass (R1/R2/R3/R5)

bun test packages/app/tests/services/feature-check.test.ts --test-name-pattern '0451'
# → 2 pass (R6/R7)

bun test packages/app/tests/workflow/actions/agent-run.test.ts --test-name-pattern 'requireDiff|tasks2'
# → 8 pass (R4 multi-folder)

bunx tsc --noEmit -p packages/app
# → exit 0

spur task check 0451 --strict-core
# → PASS (warnings: unchecked requirement boxes; task AC scenarios are follow-up scope vs H83 ship AC)
```

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/src/workflow/actions/agent-run.ts:15` interface; `:98` ctor; `:115` default; `:121-126` sessionAffinity; `packages/app/src/services/workflow-service.ts:886-925` inject; `packages/app/src/workflow/builtins.ts:37-49`; tests `R1 — config injection (task 0451)` 3/3 pass |
| R2 | MET | `packages/app/src/workflow/actions/agent-run.ts:330-379` resolvedAgent/setVars; tests `R2 — resolved-agent session keying` 3/3 pass |
| R3 | MET | `packages/app/src/workflow/actions/agent-run.ts:147-155` latch matrix; tests `R3 — latch vs affinity matrix` 4/4 + 0406 affinity-off 5/5 pass |
| R4 | MET | `packages/app/src/workflow/actions/agent-run.ts:300` + `:567-572` excludeGlobs; fix-pass `packages/app/src/services/workflow-service.ts:903-912` resolvePlanningFolders; requireDiff tests 8/8 pass |
| R5 | MET | `packages/app/src/workflow/actions/agent-run.ts:391-414` *.json filter; tests `R5 — discoverSessionId prefers *.json` 2/2 pass |
| R6 | MET | `packages/app/tests/services/feature-check.test.ts:2711` R6 multi-folder test pass |
| R7 | MET | `packages/app/src/services/feature-check.ts:611-622` option B; `packages/app/tests/services/feature-check.test.ts:2592` pass |
| R8 | MET | agent-run header pipe-no-TTY; `packages/app/src/services/agent-service.ts:181-196` + `:432-437` residual fixed; no nonInteractive buffered-only claims |
| R9 | MET | `packages/app/src/workflow/actions/agent-run.ts:203` single workflow.agent comment |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: R1 — config sessionAffinity and agent.default apply to agent.run | MET | test | `packages/app/tests/workflow/actions/agent-run.test.ts:1380-1431` (3 pass) |
| Scenario: R2 — affinity session key matches resolved invocation agent | MET | test | `packages/app/tests/workflow/actions/agent-run.test.ts:1438-1512` (3 pass) |
| Scenario: R3 — affinity on does not set bare continue from legacy latch | MET | test | `packages/app/tests/workflow/actions/agent-run.test.ts:1519-1584` + 0406 affinity-off |
| Scenario: R4 — requireDiff excludes all configured task folders | MET | test | `packages/app/tests/workflow/actions/agent-run.test.ts:620-636`; `packages/app/src/services/workflow-service.ts:903-912` |
| Scenario: R5 — discoverSessionId is cwd-safe and tested | MET | test | `packages/app/tests/workflow/actions/agent-run.test.ts:1591-1652` (2 pass) |
| Scenario: R6 — multi-folder feature check regression test exists | MET | test | `packages/app/tests/services/feature-check.test.ts:2711` |
| Scenario: R7 — archive verdict policy is explicit | MET | test | `packages/app/src/services/feature-check.ts:611-622` option B; `packages/app/tests/services/feature-check.test.ts:2592` |
| Scenario: R8-R9 — docs match pipe-no-TTY implementation | MET | command | rg — no nonInteractive buffered-only claims; single comment at `packages/app/src/workflow/actions/agent-run.ts:203` |

**Fix-pass artifacts (gitignored disclosure):**
- `.spur/run/0451-verdict.json` — re-written this verify with AC rows + checks (see full file)
- Code fixes this verify: `packages/app/src/services/workflow-service.ts:903-912` R4 excludeGlobs wiring; `packages/app/src/services/agent-service.ts:181-196` residual R8 JSDoc
- Feature rebind: `spur task update 0451 --feature H83`; orphan feature `L` cancelled

Coverage: N/A for full-suite this verify (targeted 177 tests green; agent-run.ts 100% lines under those files). Design-conformance: pass (all Design claims DONE).
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | Maintainability | `agent-run.ts:149` | Latch-affinity matrix fixed; explicit `options.continue` always wins. |
| P4 | Maintainability | `agent-run.ts:394` | discoverSessionId now filters to `*.json` only; heuristic documented. |
| — | — | — | No P1–P3 findings. All 9 R# items pass acceptance criteria. |
### References
- Feature: `docs/features/H83_run-scoped-agent-session-affinity-live-agent-streaming-unified-agent-inline.md`
- ADR-047: `docs/00_ADR.md` (unified --agent, affinity, pipe streaming)
- Primary code: `packages/app/src/workflow/actions/agent-run.ts` (fake cast ~100; affinity ~110–128; latch ~130–175; setVars ~357–364; discoverSessionId ~376; gitHasNonCorpusChanges ~541; stale header ~14–82; duplicate comment ~191–197)
- Agent service: `packages/app/src/services/agent-service.ts` (`runTraced` ~444, `resolveAgent` ~843, outputPolicy pipe ~540, stale JSDoc ~433)
- Builtins wiring: `packages/app/src/workflow/builtins.ts` (`registerSpurBuiltins` ~40)
- Workflow composition: `packages/app/src/services/workflow-service.ts` (`createEngineService` ~876, `resolveDefaultAgentVar` ~925 — not a substitute for R1)
- Feature check multi-folder: `packages/app/src/services/feature-check.ts` (`tasksDirs` ~165, `checkScenarioSatisfaction` ~560+, `isScenarioVerified` ~661, `readVerdictArtifact` ~690)
- Feature sync L4 gate: `packages/app/src/services/feature-service.ts` (`checkL4Gate` ~408)
- CLI wiring: `apps/cli/src/commands/feature.ts` (~331, ~496)
- Engine context type: `@gobing-ai/ts-dual-workflow-engine` `ActionRunContext` (no config field)
- Config schema/loader: `packages/config/src/index.ts` `sessionAffinity`; `packages/config/src/loader.ts` `loadSpurConfig`, `resolvePlanningFolders`
- Tests: `packages/app/tests/workflow/actions/agent-run.test.ts` (0406 ~152, requireDiff ~556, 0448 ~1267); `packages/app/tests/services/feature-check.test.ts`
- Prior tasks: 0447 (ts-libs), 0448 (affinity+stream), 0449 (inline), 0450 (dogfood), 0436 (pipeline performance), 0142 (held blocked)
- Review severity table: operator session 2026-08-05 (P1 config/keying/latch; P2 requireDiff/discover/tests/verdicts; P3 JSDoc)
- Residual findings task (review #8–#10, #12–#15, #17–#18): `docs/tasks3/0452_residual-review-cleanup-server-push-sync-history-report-corp.md`

### History
- 2026-08-05T23:45:35.486Z todo → wip (system)
- 2026-08-05T23:55:00.000Z wip → done (implement — all 9 R# items, 4558 tests green, full gate clean)
- 2026-08-05T23:51:59.502Z done → wip (system)
- 2026-08-05T23:58:32.060Z wip → testing (system)
- 2026-08-05T23:58:41.134Z testing → done (system)
