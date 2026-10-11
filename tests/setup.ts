import { afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import util from 'node:util';
import { setLoggerMuted } from '@gobing-ai/ts-infra';
import { configure, reset } from '@logtape/logtape';

type UtilTypesWithEventTarget = typeof util.types & {
    isEventTarget?: (target: unknown) => boolean;
};

// Fix Bun 1.3.14 on Linux where node:util types.isEventTarget(signal) returns false for AbortSignal,
// causing node:events setMaxListeners(n, controller.signal) in execa 9.6+ to throw ERR_INVALID_ARG_TYPE.
const utilTypes = util?.types as UtilTypesWithEventTarget | undefined;
if (utilTypes && typeof utilTypes.isEventTarget === 'function') {
    const origIsEventTarget = utilTypes.isEventTarget.bind(utilTypes);
    utilTypes.isEventTarget = (target: unknown): boolean => {
        if (
            target != null &&
            (target instanceof AbortSignal ||
                (target as { constructor?: { name?: string } }).constructor?.name === 'AbortSignal')
        ) {
            return true;
        }
        return origIsEventTarget(target);
    };
}

if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.prototype === 'object' && AbortSignal.prototype !== null) {
    try {
        const noopSetMaxListeners = (_n?: number): void => {};
        Object.defineProperty(AbortSignal.prototype, 'setMaxListeners', {
            value: noopSetMaxListeners,
            writable: true,
            configurable: true,
        });
        noopSetMaxListeners(0);
    } catch {
        // Fallback for environments where prototype is frozen
    }
}

// Gate the ts-infra logger adapter (per-instance).
setLoggerMuted(true);

// Configure LogTape engine directly — no sinks, fatal-only root level.
// This silences ALL log output regardless of which ts-infra instance
// created the LogTapeLogger adapter (four duplicate ts-infra@0.3.5
// instances exist in Bun's store, each with its own `muted` flag).
await reset();
await configure({
    sinks: {},
    loggers: [
        { category: ['app'], lowestLevel: 'fatal', sinks: [] },
        { category: ['logtape', 'meta'], lowestLevel: 'fatal', sinks: [] },
    ],
});

// Prevent tests from resolving the global ~/.config/spur/config.yaml fallback,
// ensuring they hit the direct (no-config) code path.
process.env.SPUR_SKIP_GLOBAL_CONFIG = 'true';

// Task 0817 R1: same hermeticity for the project layer — a test that omits `cwd`
// must not bind the CLI to this repository's own live `.spur/config.yaml` through
// `process.cwd()`. The loader honours this only for unpinned calls; fixture tests
// that pass an explicit `cwd` are unaffected.
process.env.SPUR_SKIP_PROJECT_CONFIG = 'true';

// Registry hermeticity: `spur serve` upserts its project root into
// `getProjectsFilePath()` at startup (apps/server/src/serve.ts). Tests that start a
// server without overriding SPUR_PROJECTS_FILE — the ~38 unisolated `startServer`
// calls in apps/server/tests/serve.test.ts — appended their throwaway temp roots to
// the operator's real ~/.config/spur/projects.json. `refreshProjects` cannot purge
// them afterwards: the directory still exists, because Bun's test runner never fires
// `process.on('exit')`, so serve.test.ts's own cleanup handler is dead code. Point
// every test process at a disposable registry instead.
const testRegistryDir = mkdtempSync(join(tmpdir(), 'spur-test-projects-'));
const testRegistryFile = join(testRegistryDir, 'projects.json');
process.env.SPUR_PROJECTS_FILE = testRegistryFile;
// 1089 R5: the same hermeticity for the second global file a mounted server writes.
// `apps/server/src/modules/commands` generates the slash-command catalog through
// `getSlashCommandsFilePath()`, which honours `SPUR_SLASH_COMMANDS_FILE`
// (`packages/config/src/slash-commands.ts`). Without this the isolated registry above
// was still accompanied by a real `~/.config/spur/slash_commands.json`, so
// `HOME=$(mktemp -d) cd apps/server && bun test` left a `.config/spur/` directory behind.
const testSlashCommandsFile = join(testRegistryDir, 'slash_commands.json');
process.env.SPUR_SLASH_COMMANDS_FILE = testSlashCommandsFile;
// Re-assert before every test. Suites that own a registry (apps/cli projects,
// health.test, project-registry.test) call `removeEnvVar('SPUR_PROJECTS_FILE')` in
// `afterEach` and never restore it; because Bun runs test files in one process, that
// stranded later files on the operator's real registry. Their own beforeEach runs
// after this one, so an explicit per-suite path still wins.
beforeEach(() => {
    process.env.SPUR_PROJECTS_FILE = testRegistryFile;
    process.env.SPUR_SLASH_COMMANDS_FILE = testSlashCommandsFile;
});
afterAll(() => {
    rmSync(testRegistryDir, { recursive: true, force: true });
});

// 0817 residual (buglog 2026-09-09): pin bare `spur` resolution for any test-spawned
// child to this checkout's source-local CLI. A stale global `spur` on PATH is
// reachable from inside the suite and writes with its own (older) ts-db provisioning
// — observed stamping a false importer_schema@ row into a worktree DB mid-gate.
// Prepended (not replaced) so every other tool keeps resolving normally.
//
// 0818 R1: `fileURLToPath`, not `URL.pathname` — a checkout whose path contains
// a space percent-encodes to `/my%20checkout/scripts/test-shims`, a directory
// that does not exist, so the prepend silently protected nothing.
process.env.PATH = `${fileURLToPath(new URL('../scripts/test-shims', import.meta.url))}:${process.env.PATH ?? ''}`;

// A pipeline's `test`/`test-recheck` gate runs as a child of the workflow run process,
// inheriting its SPUR_WORKFLOW_RUN_ACTIVE=1 marker (task 0610 R4 nested-run refusal).
// Tests are legitimate top-level processes, not nested pipelines, so drop the leaked
// marker here. The refusal test in apps/cli/tests/commands/workflow.test.ts sets it
// explicitly itself, so the guard stays fully covered (0753 R3: never relax the guard).
delete process.env.SPUR_WORKFLOW_RUN_ACTIVE;

// Decision-backend hermeticity: the default `typesafe` maker resolves whenever the host
// exports TYPESAFE_API_KEY, so "no backend" tests (decision-events 1095) made a live call
// and saw reason `error` instead of `no-backend`. Tests that need a backend pass the key
// explicitly (inline-run-setup, status.test), so drop the operator's credentials here.
delete process.env.TYPESAFE_API_KEY;
delete process.env.TYPESAFE_BASE_URL;
