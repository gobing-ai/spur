---
schema_version: 1
name: Use registered CLI routes for boot-free dispatch
status: done
template: issue
created_at: 2026-11-19T22:19:32.069Z
updated_at: "2026-11-20T03:21:30.333Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 3
done_forced: "false"
done_reason: unforced close
---

## 1407. Use registered CLI routes for boot-free dispatch

### Background

`apps/cli/src/index.ts` decides which invocations skip the full boot (DB adapter + `runNodeApplication`) by matching raw argv tokens against hand-kept lists, then hand-registers one command per branch on a throwaway program. The command tree in `buildProgram` is a second, independent copy of the same routes. Every new boot-free verb needs two edits that nothing cross-checks, and the two copies already disagree:

- `self serve` has its own earlier branch (`apps/cli/src/index.ts:68`).
- `migrationCheck`, `taskGate`, `statusReport`, `selfInstall`, `builderArtifact` (a six-verb string list) and `mcpBridge` sit in a second branch (`apps/cli/src/index.ts:96-176`). Workflow transports use their own list, `WORKFLOW_TRANSPORT_VERBS` (`apps/cli/src/workflow-transport-argv.ts:8`).
- `spur mcp` is mounted **only** on the boot-free path. `buildProgram` never registers it (`apps/cli/src/index.ts:290-322`), so the full tree, the help-parity test and the docs walker cannot see it.

Goal: one source of truth. A verb is boot-free because its **registered command** is marked that way, and `main()` resolves the marker from the same tree it is about to parse.

**Refine corrections (2026-11-19)**
- The task had only a title-derived stub. This refine adds Background, Root Cause, Design, Plan and ACs from a tree audit.
- **Concurrent in-progress work exists (uncommitted, not authored by this refine):** `apps/cli/src/boot-free-route.ts` (untracked), the `bootFree(...)` markers in 10 command modules, `RegisterServeOptions` threaded through `registerSelfCommand`, and a new test in `apps/cli/tests/self-noun-only.test.ts`. `index.ts` is **not** wired to it yet. `mcp` is not yet in `buildProgram`, so that new test currently fails. Those files also fail `biome check`: import order, and imports placed above the file doc comment in `commit-guard.ts` and `persist.ts`. The implementer must **adopt and finish** this WIP, not duplicate it. Confirm with the operator who owns it before editing (one writer per tree).
- R1/R2 are kept and made concrete (R1 → R1–R3, R2 → R4–R5). No issue was dropped.

### Requirements

- [x] R1. `main()` decides whether to boot-free dispatch by resolving argv against the registered command tree from `buildProgram`. Commands carry `bootFree(command, mode)` markers. No argv string list in `index.ts` (or `workflow-transport-argv.ts`) may decide dispatch.
- [x] R2. Every currently boot-free invocation stays boot-free, with the same per-mode pre-dispatch behaviour:
    - `self serve`: injected `startServer`, plus a lenient `loadProjectConfig` that returns null on error.
    - `self migrate --check`: only with `--check`. Without the flag it uses the full boot.
    - `task gate` (`config` mode): strict `loadSpurConfig(options.cwd)` before registration.
    - `self status` (`status` mode): a config failure exits 1. With `--json` it prints `{error:{code:'config',message}}`, otherwise it writes the message to stderr.
    - `self install`, the six `builder` artifact/build verbs, `mcp`, and the five `workflow` transport verbs (`bare`).
- [x] R3. A boot-free invocation creates no `.spur/spur.db` in the cwd. Config, DB and exit-code behaviour of every non-boot-free invocation is unchanged.
- [x] R4. Help visibility is unchanged. `mcp` joins the full tree as a **hidden** command, so root `spur --help` does not list it. `spur workflow --help` still lists the transport verbs. Hidden flags on `self` verbs keep their current values.
- [x] R5. Machine stdout is unchanged. No banner and no extra output for the workflow transports, `mcp`, `history timeline` or `--json` (`shouldRenderBanner`, `apps/cli/src/index.ts:359`, keeps its current outcomes). JSON-producing boot-free verbs still emit exactly one JSON document.

### Acceptance Criteria

```gherkin
Scenario: AC1 — boot-free routing comes from the registered tree (req: R1)
  Given `buildProgram` with a DB-less `createCliContext`
  When `bootFreeMode(program, argv)` is evaluated for each of: `self serve`, `self migrate --check`, `self migrate`, `task gate 1`, `self status`, `self install`, `builder bundle-config`, `builder build-cli`, `mcp --cwd x`, `workflow commit-guard-start --run r`, `workflow persist-check`, `task list`, `workflow run x`
  Then the first eleven return their declared mode (`self migrate` without `--check` → undefined) and `task list` / `workflow run x` return undefined
  And `rg "commandTokens\[" apps/cli/src/index.ts` finds no dispatch predicate

Scenario: AC2 — boot-free invocations create no project DB (req: R2, R3)
  Given an empty temp project dir
  When `main([...argv, '--no-logo'], { cwd })` runs for `self status --json`, `self migrate --check`, `workflow commit-guard-check --run r` and `mcp --help`
  Then `<cwd>/.spur/spur.db` does not exist afterwards
  And each exit code equals the one HEAD `3c39f9a2e` returns for the same argv

Scenario: AC3 — per-mode config contracts are preserved (req: R2)
  Given a temp project whose `.spur/config.yaml` is invalid
  When `main(['self','status','--json'])` runs
  Then it exits 1 and stdout parses as `{error:{code:'config'}}`
  And `main(['task','gate', ...])` fails loudly on the same config, as it does on HEAD

Scenario: AC4 — help and machine stdout unchanged (req: R4, R5)
  Given the full program
  Then `program.commands` contains `mcp`, `program.helpInformation()` does not contain the mcp summary text `stdio-to-HTTP`, and `spur workflow --help` lists `commit-guard-start`
  And `shouldRenderBanner` returns false for `workflow commit-guard-start`, `mcp`, `history timeline` and any `--json` argv
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

**Chosen approach: mark the leaf command and resolve it from the real tree.** This adopts the in-progress `apps/cli/src/boot-free-route.ts`.

1. **Marker (exists in WIP).** `bootFree(command, mode)` stores `mode ∈ {'bare','config','status','migration-check'}` in a module `WeakMap`, and `bootFreeMode(program, argv)` resolves it:
   - Strip the global tokens `--no-logo`, `--cli-verbose` and `-v`.
   - Match noun, then verb, by `name()` or `aliases()`.
   - If no verb matches, fall back to the noun. This is how `mcp` resolves as a leaf.
   - `migration-check` resolves to a mode only when argv contains `--check`.

   Keep this file. Fix its biome findings and move the imports in `commit-guard.ts` and `persist.ts` below the file doc comment.
2. **One tree.** `buildProgram(context, output, opts?)` gains an optional `{ serve?: RegisterServeOptions }`, passed through `registerSelfCommand` (WIP already adds that parameter). It also registers `registerMcpCommand(program, context)` as hidden (the WIP marks it `{ hidden: true }`). After that, `buildProgram` is the only place commands are mounted.
3. **Dispatch in `main()`.**
   - Build a probe program once with `buildProgram(createCliContext({cwd, env, output}), output)` and compute `mode = bootFreeMode(probe, argv)`.
   - When `mode` is set:
     - Build the context for that mode: `bare` → plain `createCliContext`; `config` → strict `loadSpurConfig(options.cwd)`; `status` → the guarded load with the existing `--json` error envelope.
     - Build `buildProgram(context, output, { serve: { startServer: options.startServer, loadProjectConfig: lenient } })` and parse.
     - Catch errors exactly as today: return `exitCode` when present; otherwise print the error and return 1.
   - When `mode` is undefined, fall through to the unchanged full-boot path.
   - Delete the hand-written branches at `apps/cli/src/index.ts:66-176`.
   - The probe and dispatch programs are separate because `CliContext.setExitCode` binds at construction. Registration is pure, cost is a few ms, and the imports are already static.
4. **Workflow transports.** Drop `isWorkflowTransportInvocation` from dispatch. `workflow-transport.ts`'s `registerWorkflowTransportCommands` becomes dead once `buildProgram` mounts the verbs (they are already mounted at `apps/cli/src/commands/workflow/index.ts:33-37`); delete it. Keep `WORKFLOW_TRANSPORT_VERBS` and `isWorkflowTransportInvocation` **only** for `shouldRenderBanner`, which runs before `main()` without a tree. Converting the banner policy is out of scope.

**Invariants**
- A boot-free action must never call `context.getDb()`. Today's code already satisfies this; AC2 guards it.
- `options.cwd` is passed verbatim (possibly undefined) to `loadSpurConfig`, per task 0817 R1.

**Rejected alternatives**
- Keep the argv lists and add a parity test: still two sources of truth.
- Commander `preAction` hooks to open the DB lazily: changes boot order for every command, so the blast radius is too large.
- Moving the boot-free policy into a static table keyed by `'noun verb'`: a third copy that duplicates registration.

**Out of scope.** Banner policy (`shouldRenderBanner`) refactor. New boot-free verbs. Any public noun/verb change (none here, since `mcp` already exists).

### Plan

0. Confirm with the operator that the uncommitted `apps/cli` 1407 WIP may be adopted. Start from that tree; do not reset it.
1. **Tests first:** extend `apps/cli/tests/self-noun-only.test.ts`, or add `apps/cli/tests/boot-free-route.test.ts`, covering AC1 (resolution table), AC2 (no `.spur/spur.db`, exit-code parity), AC3 (invalid-config contracts) and AC4 (help/banner). Run them and see AC1, AC2 and AC4 fail on the current tree.
2. Extend `buildProgram` with `opts.serve`, and register `mcp` hidden there.
3. Replace `apps/cli/src/index.ts:66-176` with the probe → mode → context → `buildProgram` → parse flow described in Design step 3.
4. Delete `registerWorkflowTransportCommands` and its dead imports. Keep `isWorkflowTransportInvocation` for the banner.
5. Fix the WIP biome issues (import order; imports below doc comments).
6. Focused tests: `(cd apps/cli && bun test tests/self-noun-only.test.ts tests/boot-free-route.test.ts tests/commands/mcp.test.ts tests/commands/self/serve.test.ts tests/workflow-transport.test.ts tests/workflow-transport-argv.test.ts tests/commands/init-status.test.ts)`.
7. `bun run spur-check`. After it passes, run `bun link` in `apps/cli` and `bun run --filter @gobing-ai/spur build:bundle`, then smoke `spur self status --json` and `spur workflow commit-guard-check --run x` in a temp dir and confirm no DB is created.
8. If `docs/03_ARCHITECTURE.md` §3 or `docs/design/harness-surface-governance.md` describe argv-based boot-free dispatch, update that text. Commit per task: `refactor(cli): resolve boot-free dispatch from registered routes (1407)`.

### Root Cause

Verified 2026-11-19 against HEAD `3c39f9a2e`:

- **Duplicate routing tables.** The boot-free predicates are argv string matches: `apps/cli/src/index.ts:66-68` (serve), `:96-111` (migrate `--check`, task gate, self status, self install, builder six-verb list, mcp) and `apps/cli/src/workflow-transport-argv.ts:8-20` (workflow transports). Each branch then calls a register function by hand (`apps/cli/src/index.ts:131-169`). The real tree is built separately in `buildProgram` (`apps/cli/src/index.ts:290`).
- **Observed drift.** `registerMcpCommand` is called only on the boot-free path, and `buildProgram` (`apps/cli/src/index.ts:310-322`) never mounts `mcp`. So the program used for docs and help parity is missing a real command.
- **Why the fix is safe.** `createCliContext` creates the DB **lazily**: `getDb` calls `createMigratedDbAdapter` only on first use (`apps/cli/src/context.ts:142-152`). Building the full tree with a DB-less context therefore opens nothing; `apps/cli/tests/self-noun-only.test.ts` already does exactly this. A boot-free verb stays boot-free as long as its action never calls `context.getDb()`, which matches today's contract.

### Solution

Boot-free policy is declared on each Commander command at registration. The CLI resolves argv against the registered tree, loads config only for the modes that need it and parses that same tree for boot-free commands. The workflow banner recognizer shares registered wire names, and MCP is registered once as hidden.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | The entry point resolves the command tree in `apps/cli/src/boot-free-route.ts`. Registered policies are exercised in `apps/cli/tests/boot-free-route.test.ts`. |
| R2 | MET | The new scratch-project tests cover task gate and self status config errors, migration check and workflow dispatch. The serve, builder and MCP tests exercise the existing entry points. |
| R3 | MET | The scratch-project test checks the DB remains absent. The full-boot branch retains its runner, lazy/eager adapter wiring and parsing. |
| R4 | MET | `apps/cli/tests/workflow-transport.test.ts`, `apps/cli/tests/boot-free-route.test.ts` and self-noun tests exercise visibility and aliases. |
| R5 | MET | The banner checks and MCP subprocess test verify machine stdout. Self status JSON parses as a single document. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `apps/cli/tests/boot-free-route.test.ts`, registered route cases |
| AC2 | MET | test | `apps/cli/tests/boot-free-route.test.ts` and `apps/cli/tests/commands/self/status.test.ts`, DB-free scratch projects and expected exit results |
| AC3 | MET | test | `apps/cli/tests/boot-free-route.test.ts`, malformed config fixture |
| AC4 | MET | test | `apps/cli/tests/boot-free-route.test.ts`, `apps/cli/tests/workflow-transport.test.ts`, and the CLI MCP subprocess in `apps/cli/tests/commands/mcp.test.ts` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

Compared with 3c39f9a2e in separate scratch projects, self status (1), migrate check (0), workflow commit guard (1) and MCP help (0) returned the same exit codes and created no project database.

### Review

| Priority | Finding | Location | Disposition |
| --- | --- | --- | --- |
| P4 (advisory) | Boot-free dispatch and root help share the Commander tree. The workflow banner uses the names at registration, and MCP stays hidden. | `apps/cli/src/index.ts`, `apps/cli/src/workflow-transport-argv.ts` | ACCEPTED |

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-11-20T03:20:44.225Z todo → wip (system)
- 2026-11-20T03:20:47.085Z wip → testing (system)
- 2026-11-20T03:21:01.535Z testing → done (system)

