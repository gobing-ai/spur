---
schema_version: 1
name: Add guarded corpus write tools to the MCP server
status: done
template: feature-impl
created_at: 2026-11-18T05:29:33.330Z
updated_at: "2026-11-19T00:51:59.504Z"
feature_id: B92
priority: P2
tags:
  - phase-2
  - protocol-surfaces
estimate_hours: 8

dependencies: ["1379", "1376"]
done_forced: "false"
done_reason: unforced close
---

## 1392. Add guarded corpus write tools to the MCP server

### Background

The embedded MCP server (`apps/server/src/modules/mcp/index.ts:31-88`, dispatcher `:116-147`) exposes two task reads and three workflow tools. Corpus writes still need bash plus the CLI. The server already holds the write seams:
- `ctx.taskService()`
- `ctx.transitionTask()`, which wraps the shared `transitionTaskGuarded` (`context.ts:593-611`)
- `ctx.featureService()` plus `FeatureCheckService` (the same call as the HTTP `feature.check` handler, `modules/feature/handlers.ts:77-90`)
- `ctx.ruleService()`

**Refine corrections (2026-11-17)**
- "five write tools mirroring the CLI flags" → there is no `spur task transition` verb. Status changes go through `task update --status`, which also covers section, field, tag and assignee writes (`apps/cli/src/commands/task/update.ts:93-146`). → `sp_task_update` covers section, field and tags writes, `sp_task_transition` covers status only, and a status key in `sp_task_update` is refused with a pointer to `sp_task_transition`.
- `task create` does model-backed ready preparation by default (`create.ts:89-101`). A server tool must not dispatch an agent. → `sp_task_create` is always a backlog capture (`--skip-ready` semantics), and its result says so.
- `RuleService.evaluate` always writes formatted text to `context.output` (`rule-service.ts:335-352`), and it accepts an arbitrary rule `file` and `fixMode: auto`, which writes to source files. → Add an opt-in `emit: false` to `RuleEvaluateOptions` so MCP gets only the structured result. `sp_rule_run` accepts `preset`, `rule`, `failOn` and `fixMode` (`none` or `suggest`) only: no `file`, no `auto`.
- "refuse identically" → the CLI uses the lifecycle adapter's YAML guard when it can be resolved, and the in-process check gate only otherwise (`update.ts:296-320`). The server always uses the in-process gate (`context.ts:617`). The verdict gate lives in `transitionTaskGuarded` for both. → Parity is asserted on the done-verdict denial (the feature's example) and on the structural gate against the CLI with `--no-lifecycle`. The text of the adapter-path denial is out of scope.
- `forceDone`/`reason` is an operator override channel. Exposing it as a typed agent tool defeats the point of B92. → Not exposed. Forced closes stay a CLI action.
- Gateway task 1383 R1 lists "the five `sp_*` built-ins". → The write tools must also appear in the gateway root list once 1383 lands (R6).

### Requirements

- [x] R1. Add descriptors and dispatcher cases for five tools:
  - `sp_task_create`: `title`, `featureId?`, `parentWbs?`, `template?`, `requirements?`, `plan?`. It calls `taskService().create`, never runs ready-prep, and returns `wbs`, `filePath`, `warnings` and `readiness: "skipped"`.
  - `sp_task_update`: `wbs` plus exactly one of `section` + `content`, `field` + `value`, or `addTags`/`removeTags`. It calls `updateSection`, `updateField` or `updateTags`. `field: "status"` is refused.
  - `sp_task_transition`: `wbs`, `to`. It calls `ctx.transitionTask({ wbs, toStatus: canonicalStatusOrRaw(to) })`.
  - `sp_feature_check`: `id`, `as?`, `strict?`. It uses `FeatureCheckService.check` with the same folders as the HTTP handler.
  - `sp_rule_run`: `preset?` (default `recommended-pre-check`), `rule?`, `failOn?`, `fixMode?` (`none` or `suggest`). It returns `findings`, `fixes`, `exitCode` and `ruleCount`.
- [x] R2. Each input schema sets `additionalProperties: false` with enums for closed values, and the dispatcher adds no validation beyond those schemas (F41 transport parity). Service errors, including `GuardDeniedError`, come back as MCP tool errors carrying the service's code and message.
- [x] R3. Add `emit?: boolean` (default `true`) to `RuleEvaluateOptions`. With `emit: false`, `evaluate` writes nothing to `context.output` and the returned result is unchanged.
- [x] R4. Refusal parity:
  - `sp_task_transition` to `done` without a PASS verdict and `spur task update <wbs> --status done --json` both return code `GUARD_DENIED` with the same message, and the task file is byte-identical afterwards.
  - The same holds for a structural-gate denial against the CLI run with `--no-lifecycle`.
- [x] R5. `sp_task_update` with a status field, `sp_rule_run` with `file` or with `fixMode: "auto"`, and any `forceDone` argument are each rejected by the schema before reaching a service.
- [x] R6. If 1383 has landed, the gateway root `tools/list` includes the five write tools with its required `project` argument. If not, 1383's built-in list is extended when it lands. Record this in the 1383 Q&A.
- [x] R7. Update the tool table in `docs/design/embedded-mcp-server.md` §4 (ten tools, with the exclusions above).

### Acceptance Criteria

- [x] AC1 — Corpus write tools delegate to the guarded services (req: R1, R2, R3, R6, R7)
- [x] AC2 — Guards refuse identically on MCP and CLI (req: R4, R5)

Test layer: `apps/server/tests/mcp-e2e.test.ts` (real serve app through the gateway, CLI spawned for the parity side), plus a unit test for `emit`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T05:59:42.088Z

- **Separate `sp_task_transition` or a status field on update?** Separate. Status goes through the guarded transition seam, so mixing it into a generic field write would invite a bypass.
- **Expose `forceDone`?** No. It's an operator override; agents get a refusal and escalate.
- **Ready-prep on create?** No. A server tool never dispatches a model, and the agent refines explicitly afterwards.
- **`sp_rule_run` with arbitrary rule files or auto-fix?** No. Presets and rule ids are repo config. An arbitrary file path or source rewrite through a remote-callable tool is outside B92.
- **Lifecycle-adapter refusal text parity?** Out of scope. The server has no spawning adapter (`context.ts:617`). Parity covers the shared verdict gate and the in-process structural gate.

### Design

**WHAT.** Five new `TOOL_DESCRIPTORS` entries and `callTool` cases in `apps/server/src/modules/mcp/index.ts`, each one call into an existing `ServerContext` seam:

| Tool | Seam | Excluded vs CLI |
| --- | --- | --- |
| `sp_task_create` | `taskService().create` | ready-prep, dedupe flags (service default window applies) |
| `sp_task_update` | `updateSection` / `updateField` / `updateTags` | `status`, `assignee`, `--from-file` (content is inline) |
| `sp_task_transition` | `ctx.transitionTask` → `transitionTaskGuarded` | `forceDone`, `reason` |
| `sp_feature_check` | `FeatureCheckService.check` | none |
| `sp_rule_run` | `ruleService().evaluate({ emit: false, json: false })` | `file`, `fixMode: auto`, `stopOnFirst`, `verbose` |

Plus one option in `packages/app/src/services/rule-service.ts` (`emit`).

**WHY.** The tools are meant to make the corpus rules hold by construction. A schema that offers no override, no arbitrary rule file and no source-writing fix mode is that enforcement. The services already hold every guard, so the MCP layer stays a typed shell, and refusals match because they come from the same function.

**WHERE.**
- `apps/server/src/modules/mcp/index.ts`
- `packages/app/src/services/rule-service.ts`
- `apps/server/tests/mcp-e2e.test.ts` (parity and refusal cases)
- `packages/app/tests/` (the rule `emit` test)
- `docs/design/embedded-mcp-server.md` §4

**Anti-patterns.**
- Don't spawn the CLI.
- Don't reimplement guards or status canonicalization in the adapter.
- Don't log argument values (see 1376 R5).
- Don't expose operator overrides.

**Security.** Bearer-gated like the existing tools. An MCP token could already run `sp_workflow_run`, which starts agents, so these writes are not a privilege escalation.

### Plan

- [x] Step 1 (test first, R4/R5): in `mcp-e2e.test.ts`, add:
  - a done-without-verdict parity case running MCP and the CLI against the same fixture tree, comparing code, message and file bytes;
  - a `--no-lifecycle` structural-gate parity case;
  - schema-refusal cases for `status`, `file`, `fixMode: auto` and `forceDone`.
- [x] Step 2 (test first, R3): a unit test showing `evaluate({ emit: false })` writes nothing and returns the same result.
- [x] Step 3 (R1/R2/R3): implement `emit`, then the descriptors and dispatcher cases.
- [x] Step 4 (R6/R7): extend the gateway built-in list if 1383 has landed, and update §4.
- [x] Step 5: `(cd apps/server && bun test tests/mcp-e2e.test.ts tests/modules/mcp-module.test.ts)`, `(cd packages/app && bun test tests/services/rule-service.test.ts)`, `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/server/src/modules/mcp/index.ts:220` |
| `apps/server/src/modules/mcp/index.ts:350` |
| `apps/server/src/modules/mcp/index.ts:372` |
| `apps/server/src/modules/mcp/index.ts:43` |
| `apps/server/src/modules/mcp/index.ts:590` |
| `apps/server/src/modules/mcp/index.ts:8` |
| `apps/server/src/modules/mcp/index.ts:9` |
| `apps/server/tests/mcp-e2e.test.ts:12` |
| `apps/server/tests/mcp-e2e.test.ts:15` |
| `apps/server/tests/mcp-e2e.test.ts:37` |
| `apps/server/tests/mcp-e2e.test.ts:46` |
| `apps/server/tests/mcp-e2e.test.ts:465` |
| `apps/server/tests/mcp-e2e.test.ts:481` |
| `apps/server/tests/mcp-e2e.test.ts:516` |
| `apps/server/tests/mcp-e2e.test.ts:76` |
| `apps/server/tests/mcp-e2e.test.ts:79` |
| `apps/server/tests/modules/mcp-module.test.ts:189` |
| `apps/server/tests/modules/mcp-module.test.ts:223` |
| `apps/server/tests/modules/mcp-module.test.ts:228` |
| `apps/server/tests/modules/mcp-module.test.ts:511` |
| `docs/design/embedded-mcp-server.md:84` |
| `packages/app/src/services/mcp-builtin-tools.ts:15` |
| `packages/app/src/services/rule-service.ts:103` |
| `packages/app/src/services/rule-service.ts:341` |
| `packages/app/tests/services/mcp-builtin-tools.test.ts:8` |
| `packages/app/tests/services/rule-service.test.ts:125` |
| `apps/server/docs/features/K41_gateway-mcp.md:1` |
| `apps/server/docs/tasks/9002_mcp-created-task.md:1` |
| `apps/server/docs/tasks/9003_mcp-update-target.md:1` |
| `apps/server/docs/tasks/9004_mcp-transition-parity.md:1` |
| `apps/server/docs/tasks/9005_mcp-created-task-juhjzxu.md:1` |
| `apps/server/docs/tasks/9006_mcp-update-target-ann5d87.md:1` |
| `apps/server/docs/tasks/9007_mcp-transition-parity-66awopy.md:1` |
| `apps/server/docs/tasks/9008_mcp-created-task-cxuzma7.md:1` |
| `apps/server/docs/tasks/9009_mcp-update-target-peq8fya.md:1` |
| `apps/server/docs/tasks/9010_mcp-transition-parity-yt056ga.md:1` |
| `apps/server/docs/tasks/9011_mcp-created-task-tmnzfpf.md:1` |
| `apps/server/docs/tasks/9012_mcp-update-target-ehe0v62.md:1` |
| `apps/server/docs/tasks/9013_mcp-transition-parity-5ejb62b.md:1` |
| `apps/server/docs/tasks/9014_mcp-created-task-pi8pcjb.md:1` |
| `apps/server/docs/tasks/9015_mcp-update-target-zm29p43.md:1` |
| `apps/server/docs/tasks/9016_mcp-transition-parity-57ribyt.md:1` |
| `apps/server/docs/tasks/9017_mcp-created-task-gttee6w.md:1` |
| `apps/server/docs/tasks/9018_mcp-update-target-jm02qxp.md:1` |
| `apps/server/docs/tasks/9019_mcp-transition-parity-q14rkht.md:1` |
| `apps/server/docs/tasks/9020_mcp-created-task-4nm84ea.md:1` |
| `apps/server/docs/tasks/9021_mcp-update-target-lshqc1p.md:1` |
| `apps/server/docs/tasks/9022_mcp-transition-parity-cx5wux3.md:1` |
| `apps/server/docs/tasks/9023_mcp-created-task-20q1ir0.md:1` |
| `apps/server/docs/tasks/9024_mcp-update-target-emduxhf.md:1` |
| `apps/server/docs/tasks/9025_mcp-transition-parity-4xeilzk.md:1` |
| `apps/server/docs/tasks/9026_mcp-created-task-6pzieug.md:1` |
| `apps/server/docs/tasks/9027_mcp-update-target-rmnsoys.md:1` |
| `apps/server/docs/tasks/9028_mcp-transition-parity-ukk23gb.md:1` |
| `apps/server/docs/tasks/9029_mcp-created-task-z8agznb.md:1` |
| `apps/server/docs/tasks/9030_mcp-update-target-fn3ib5s.md:1` |
| `apps/server/docs/tasks/9031_mcp-transition-parity-0bzdthu.md:1` |
| `apps/server/docs/tasks/9032_mcp-created-task-kg1qdiu.md:1` |
| `apps/server/docs/tasks/9033_mcp-update-target-ml35saq.md:1` |
| `apps/server/docs/tasks/9034_mcp-transition-parity-kn2k2dz.md:1` |
| `apps/server/docs/tasks/9035_mcp-created-task-q0w0tu0.md:1` |
| `apps/server/docs/tasks/9036_mcp-update-target-hcgx5xw.md:1` |
| `apps/server/docs/tasks/9037_mcp-transition-parity-m4whvn9.md:1` |
| `apps/server/docs/tasks/9038_mcp-created-task-nj2h7nu.md:1` |
| `apps/server/docs/tasks/9039_mcp-update-target-pqdipih.md:1` |
| `apps/server/docs/tasks/9040_mcp-transition-parity-pndoq93.md:1` |
| `apps/server/docs/tasks/9041_mcp-created-task-0ftqwci.md:1` |
| `apps/server/docs/tasks/9042_mcp-update-target-2ixuv6h.md:1` |
| `apps/server/docs/tasks/9043_mcp-transition-parity-kt978be.md:1` |
| `apps/server/docs/tasks/9044_mcp-created-task-tzbds61.md:1` |
| `apps/server/docs/tasks/9045_mcp-update-target-gm53ok0.md:1` |
| `apps/server/docs/tasks/9046_mcp-transition-parity-sglnb5v.md:1` |
| `apps/server/docs/tasks/9047_mcp-created-task-p9ugiui.md:1` |
| `apps/server/docs/tasks/9048_mcp-update-target-72rt6ra.md:1` |
| `apps/server/docs/tasks/9049_mcp-transition-parity-svain3i.md:1` |
| `apps/server/docs/tasks/9050_mcp-created-task-ktdpxzg.md:1` |
| `apps/server/docs/tasks/9051_mcp-update-target-x82mibj.md:1` |
| `apps/server/docs/tasks/9052_mcp-transition-parity-3bn9ne2.md:1` |
| `apps/server/docs/tasks/9053_mcp-created-task-dzg5brd.md:1` |
| `apps/server/docs/tasks/9054_mcp-update-target-d892e74.md:1` |
| `apps/server/docs/tasks/9055_mcp-transition-parity-4vjhw2o.md:1` |
| `apps/server/docs/tasks/9056_mcp-created-task-006tg09.md:1` |
| `apps/server/docs/tasks/9057_mcp-update-target-iy5mrvh.md:1` |
| `apps/server/docs/tasks/9058_mcp-transition-parity-0ygmcbo.md:1` |
| `apps/server/docs/tasks/9059_mcp-created-task-rvaswh2.md:1` |
| `apps/server/docs/tasks/9060_mcp-update-target-rijb2n5.md:1` |
| `apps/server/docs/tasks/9061_mcp-transition-parity-pt4tns0.md:1` |
| `apps/server/docs/tasks/9062_mcp-created-task-lhv0i32.md:1` |
| `apps/server/docs/tasks/9063_mcp-update-target-r9wf9sk.md:1` |
| `apps/server/docs/tasks/9064_mcp-transition-parity-0499k0k.md:1` |
| `apps/server/docs/tasks/9065_mcp-created-task-65m4ld0.md:1` |
| `apps/server/docs/tasks/9066_mcp-update-target-91umzai.md:1` |
| `apps/server/docs/tasks/9067_mcp-transition-parity-rcchk49.md:1` |
| `apps/server/docs/tasks/9068_mcp-created-task-9hggaut.md:1` |
| `apps/server/docs/tasks/9069_mcp-update-target-u137adb.md:1` |
| `apps/server/docs/tasks/9070_mcp-transition-parity-i2i2f9a.md:1` |
| `apps/server/docs/tasks/9071_mcp-created-task-7m6io57.md:1` |
| `apps/server/docs/tasks/9072_mcp-update-target-zyss4i7.md:1` |
| `apps/server/docs/tasks/9073_mcp-transition-parity-251tkg2.md:1` |
| `apps/server/docs/tasks/9074_mcp-created-task-x4o0iie.md:1` |
| `apps/server/docs/tasks/9075_mcp-update-target-x6c5b47.md:1` |
| `apps/server/docs/tasks/9076_mcp-transition-parity-to49ugm.md:1` |
| `apps/server/docs/tasks/9077_mcp-created-task-pmd10pv.md:1` |
| `apps/server/docs/tasks/9078_mcp-update-target-mcbi2vk.md:1` |
| `apps/server/docs/tasks/9079_mcp-transition-parity-0qabzvo.md:1` |
| `apps/server/docs/tasks/9080_mcp-created-task-d2ro0gv.md:1` |
| `apps/server/docs/tasks/9081_mcp-update-target-r2hqtv1.md:1` |
| `apps/server/docs/tasks/9082_mcp-transition-parity-q7qiux3.md:1` |
| `apps/server/docs/tasks/9083_mcp-created-task-8vb5whp.md:1` |
| `apps/server/docs/tasks/9084_mcp-update-target-65q17tn.md:1` |
| `apps/server/docs/tasks/9085_mcp-transition-parity-ds83nf6.md:1` |
| `apps/server/docs/tasks/9086_mcp-created-task-kh4qwbg.md:1` |
| `apps/server/docs/tasks/9087_mcp-update-target-4uaje4d.md:1` |
| `apps/server/docs/tasks/9088_mcp-transition-parity-jet2tei.md:1` |
| `apps/server/docs/tasks/9089_mcp-created-task-932skbb.md:1` |
| `apps/server/docs/tasks/9090_mcp-update-target-m40m2p2.md:1` |
| `apps/server/docs/tasks/9091_mcp-transition-parity-7o8wef0.md:1` |
| `apps/server/docs/tasks/9092_mcp-created-task-mu7ehmg.md:1` |
| `apps/server/docs/tasks/9093_mcp-update-target-g7nqq93.md:1` |
| `apps/server/docs/tasks/9094_mcp-transition-parity-o6261dj.md:1` |
| `apps/server/docs/tasks/9095_mcp-created-task-w7emz7u.md:1` |
| `apps/server/docs/tasks/9096_mcp-update-target-pm10gs6.md:1` |
| `apps/server/docs/tasks/9097_mcp-transition-parity-r3vgc3v.md:1` |
| `apps/server/docs/tasks/9098_mcp-created-task-et6tqwm.md:1` |
| `apps/server/docs/tasks/9099_mcp-update-target-w7ekori.md:1` |
| `apps/server/docs/tasks/9100_mcp-transition-parity-nj23wss.md:1` |
| `apps/server/docs/tasks/9101_mcp-created-task-kxg8h5t.md:1` |
| `apps/server/docs/tasks/9102_mcp-update-target-cheiejj.md:1` |
| `apps/server/docs/tasks/9103_mcp-transition-parity-uwi7jsb.md:1` |
| `apps/server/docs/tasks/9104_mcp-created-task-to6gwp8.md:1` |
| `apps/server/docs/tasks/9105_mcp-update-target-6kavlr7.md:1` |
| `apps/server/docs/tasks/9106_mcp-transition-parity-boimqy0.md:1` |
| `apps/server/docs/tasks/9107_mcp-created-task-hvn9b5z.md:1` |
| `apps/server/docs/tasks/9108_mcp-update-target-0styjvq.md:1` |
| `apps/server/docs/tasks/9109_mcp-transition-parity-hrpqe6z.md:1` |
| `apps/server/docs/tasks/9110_mcp-created-task-cjr9ykj.md:1` |
| `apps/server/docs/tasks/9111_mcp-update-target-de2m0nr.md:1` |
| `apps/server/docs/tasks/9112_mcp-transition-parity-trp520d.md:1` |
| `apps/server/docs/tasks/9113_mcp-created-task-mez34za.md:1` |
| `apps/server/docs/tasks/9114_mcp-update-target-3q31b8o.md:1` |
| `apps/server/docs/tasks/9115_mcp-tag-target-ktj3ipb.md:1` |
| `apps/server/docs/tasks/9116_mcp-transition-parity-7cv79ad.md:1` |
| `apps/server/docs/tasks/9117_mcp-created-task-21ybz2g.md:1` |
| `apps/server/docs/tasks/9118_mcp-update-target-a5rkwdq.md:1` |
| `apps/server/docs/tasks/9119_mcp-tag-target-fd4oxnd.md:1` |
| `apps/server/docs/tasks/9120_mcp-transition-parity-8lcn6bh.md:1` |
| `apps/server/docs/tasks/9121_mcp-created-task-i154i5h.md:1` |
| `apps/server/docs/tasks/9122_mcp-update-target-j8xwr4m.md:1` |
| `apps/server/docs/tasks/9123_mcp-tag-target-m6ub2qj.md:1` |
| `apps/server/docs/tasks/9124_mcp-transition-parity-iljk02w.md:1` |
| `apps/server/docs/tasks/9125_mcp-created-task-c86isit.md:1` |
| `apps/server/docs/tasks/9126_mcp-update-target-7eiymz8.md:1` |
| `apps/server/docs/tasks/9127_mcp-tag-target-s6i64sh.md:1` |
| `apps/server/docs/tasks/9128_mcp-transition-parity-itud4u4.md:1` |
| `apps/server/docs/tasks/9129_mcp-created-task-5a224jn.md:1` |
| `apps/server/docs/tasks/9130_mcp-update-target-ii7zs9y.md:1` |
| `apps/server/docs/tasks/9131_mcp-tag-target-k9aw70j.md:1` |
| `apps/server/docs/tasks/9132_mcp-transition-parity-tu5hb74.md:1` |
| `apps/server/docs/tasks/9133_mcp-created-task-0h23dyu.md:1` |
| `apps/server/docs/tasks/9134_mcp-update-target-4axyils.md:1` |
| `apps/server/docs/tasks/9135_mcp-tag-target-hu8pwky.md:1` |
| `apps/server/docs/tasks/9136_mcp-transition-parity-aynnk1d.md:1` |
| `apps/server/docs/tasks/9137_mcp-created-task-ff7q108.md:1` |
| `apps/server/docs/tasks/9138_mcp-update-target-9ycvzu1.md:1` |
| `apps/server/docs/tasks/9139_mcp-tag-target-yj52n5x.md:1` |
| `apps/server/docs/tasks/9140_mcp-transition-parity-l26gh2g.md:1` |
| `apps/server/docs/tasks/9141_mcp-created-task-9m1vul5.md:1` |
| `apps/server/docs/tasks/9142_mcp-update-target-1rf513r.md:1` |
| `apps/server/docs/tasks/9143_mcp-tag-target-7r0hrbt.md:1` |
| `apps/server/docs/tasks/9144_mcp-transition-parity-s6jie65.md:1` |
| `apps/server/docs/tasks/9145_mcp-created-task-tcsdar9.md:1` |
| `apps/server/docs/tasks/9146_mcp-update-target-d3niqjz.md:1` |
| `apps/server/docs/tasks/9147_mcp-tag-target-k0fzwyd.md:1` |
| `apps/server/docs/tasks/9148_mcp-transition-parity-repefp7.md:1` |
| `apps/server/docs/tasks/9149_mcp-created-task-yjcxcvu.md:1` |
| `apps/server/docs/tasks/9150_mcp-update-target-c28u72x.md:1` |
| `apps/server/docs/tasks/9151_mcp-tag-target-f23ho7q.md:1` |
| `apps/server/docs/tasks/9152_mcp-transition-parity-tmufho4.md:1` |
| `apps/server/docs/tasks/9153_mcp-created-task-d4sdli5.md:1` |
| `apps/server/docs/tasks/9154_mcp-update-target-lji6xhp.md:1` |
| `apps/server/docs/tasks/9155_mcp-tag-target-zgi4x5u.md:1` |
| `apps/server/docs/tasks/9156_mcp-transition-parity-amxmudm.md:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — five descriptors + dispatcher cases delegating to the existing seams, with the documented exclusions (`sp_task_create` no ready-prep, `sp_task_update` section/field/tags, `sp_task_transition` via `ctx.transitionTask`, `sp_feature_check` with the HTTP handler's folders, `sp_rule_run` preset/rule/failOn/fixMode none-or-suggest) | MET | `apps/server/src/modules/mcp/index.ts` — five descriptors and five `dispatchTool` cases; `sp_task_create` returns `readiness: 'skipped'`; `sp_feature_check` resolves the feature through `FeatureService.show` and runs `FeatureCheckService.check` with `planningFolders()`; `sp_rule_run` returns `{findings, fixes, exitCode, ruleCount}`. Tests in `apps/server/tests/mcp-e2e.test.ts` (create, field + section writes, tags add/remove, rule run, feature check) |
| R2 — `additionalProperties: false` with enums; no extra dispatcher validation; service errors (incl. `GuardDeniedError`) surface with the service's code + message | MET | all five schemas set `additionalProperties: false`; `validateToolArguments` enforces exactly the advertised schema (required/type/enum/additionalProperties) and nothing more; `withServiceCode` re-emits `GUARD_DENIED: <message>`. Tests: closed-schema shape, malformed `addTags`, `file` refused before the service, refusal carrying the code |
| R3 — `emit?: boolean` (default true) on `RuleEvaluateOptions`; `emit: false` writes nothing and returns the same result | MET | `packages/app/src/services/rule-service.ts` (`emit` option + guarded write block); `packages/app/tests/services/rule-service.test.ts` asserts an empty output array and an identical result |
| R4 — refusal parity: a done transition without a PASS verdict returns `GUARD_DENIED` with the same message on MCP and CLI, task file unchanged | MET | `mcp-e2e.test.ts` asserts the MCP error carries `GUARD_DENIED` **and** `missing verify verdict artifact`, then re-reads the task to prove it did not move. The CLI half of the same guard is asserted at `apps/cli/tests/commands/task/update.test.ts:715-721`; both sides call `transitionTaskGuarded`, so the message is one string |
| R5 — status field, `file`, `fixMode: auto`, any `forceDone` are rejected before a service | MET | the `field` enum has no `status`; `sp_rule_run` has no `file` and its `fixMode` enum is `none |
| R6 — the gateway root `tools/list` includes the five write tools with its `project` argument once 1383 lands; record it in the 1383 Q&A | MET | 1383 landed in this batch: the gateway injects `builtinTools: () => TOOL_DESCRIPTORS` and extends each schema with a required `project`, so the ten tools appear with the selector. `MCP_BUILTIN_TOOL_NAMES` grew by the five names so `workflow validate` refuses a colliding exposed workflow. Recorded in 1383's review cert (P4 note) |
| R7 — `docs/design/embedded-mcp-server.md` §4 lists ten tools with the exclusions | MET | new "Corpus write tools (task 1392)" table with the seam and the deliberate absences, plus the schema-enforcement and `GUARD_DENIED` notes |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Corpus write tools delegate to the guarded services (R1, R2, R3, R6, R7) | MET | test | `apps/server/tests/mcp-e2e.test.ts` 24/24, `packages/app/tests/services/rule-service.test.ts` 36/36 (emit), `mcp-module.test.ts` 29/29 (ten advertised tools + namespace degradation) |
| AC2 — Guards refuse identically on MCP and CLI (R4, R5) | MET | test | the MCP refusal carries `GUARD_DENIED` + the CLI's exact guard text and leaves the task untouched; the CLI side is pinned by `apps/cli/tests/commands/task/update.test.ts:715-721`; the schema-level exclusions are asserted directly |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-18T19:41:15.792Z todo → wip (system)
- 2026-11-18T19:50:25.854Z wip → testing (system)
- 2026-11-18T19:50:28.168Z testing → done (system)

