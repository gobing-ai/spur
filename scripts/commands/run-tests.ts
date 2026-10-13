#!/usr/bin/env bun
/**
 * Test entry — owns the environment every `bun test` run starts with, so that
 * test-spawned children are hermetic too.
 *
 * WHY a launcher and not just the `tests/setup.ts` preload: Bun seeds a spawned child's
 * environment from a snapshot taken when the *test process* started, so anything
 * `tests/setup.ts` assigns at preload time never reaches a child. The suite spawns
 * children in 279 places across 91 test files, and every one of them inherited the
 * operator's real environment — the registry, the credential pair, the bare `spur`
 * resolution, and the global config layers. `tests/setup.ts:53` already records that
 * symptom for the one variant it could fix (`--parallel` silently dropping its
 * top-level await); setting the environment here fixes the class, whatever the preload
 * does. It also covers every `--parallel --isolate` worker, which re-runs the preload
 * per worker and so made hermeticity depend on preload timing.
 *
 * The preload keeps its own assignments: a bare `bun test` or a workspace-level
 * `cd apps/cli && bun test` does not come through here, and the same-process reads
 * still need them.
 *
 * Usage: `bun scripts/commands/run-tests.ts <bun test args>` — everything after the
 * script path is forwarded verbatim, so `--config=…` must precede `test` exactly as it
 * would on a bare `bun … test` line. The child's exit code is this process's exit code.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { getEnvVar, getEnvVars } from '@gobing-ai/spur-config';

// One disposable registry for the whole run: registry paths must be visible to children,
// and a per-file path would drift between workers.
const registryDir = mkdtempSync(join(tmpdir(), 'spur-test-env-'));
const env: Record<string, string | undefined> = {
    ...getEnvVars(),
    // Config layers: never read the operator's ~/.config/spur or this checkout's live
    // .spur/config.yaml.
    SPUR_SKIP_GLOBAL_CONFIG: 'true',
    SPUR_SKIP_PROJECT_CONFIG: 'true',
    // Global files a mounted server writes (apps/server/src/serve.ts upserts the project
    // root; the slash-command catalog is generated alongside it).
    SPUR_PROJECTS_FILE: join(registryDir, 'projects.json'),
    SPUR_SLASH_COMMANDS_FILE: join(registryDir, 'slash_commands.json'),
    // Bare `spur` inside a test must resolve to this checkout's source-local CLI. A stale
    // global spur writes with its own older ts-db provisioning (buglog 2026-09-09: it
    // stamped a false importer_schema@ row into a worktree DB mid-gate).
    PATH: `${join(import.meta.dir, '..', 'test-shims')}${delimiter}${getEnvVar('PATH') ?? ''}`,
};

// A gate run is a child of the workflow process, so it inherits SPUR_WORKFLOW_RUN_ACTIVE;
// a test is a legitimate top-level process and must not trip the nested-run refusal
// (task 0610 R4 / 0753 R3 — the guard itself is unchanged).
delete env.SPUR_WORKFLOW_RUN_ACTIVE;
// "No backend" assertions must not reach the operator's live decision backend.
delete env.TYPESAFE_API_KEY;
delete env.TYPESAFE_BASE_URL;

const result = Bun.spawnSync(['bun', ...Bun.argv.slice(2)], {
    env,
    stdio: ['inherit', 'inherit', 'inherit'],
});
rmSync(registryDir, { recursive: true, force: true });
process.exit(result.exitCode ?? 1);
