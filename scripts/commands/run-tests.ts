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
 *
 * Canonical coverage certification (task 1203): the root `test` / `test:coverage` /
 * `test:full` scripts pass the internal `--publish-coverage` flag (consumed here,
 * before forwarding). With it, the launcher invalidates prior certification before
 * spawning and, only on an exit-zero run over an unchanged working tree, certifies
 * `.coverage/lcov.info` in `.coverage/coverage-certification.json`. Targeted `bun test`,
 * heavy/repo-wide gates and interrupted runs never publish. Recovery for a refused
 * artifact: rerun `bun run test:full` (see coverage-certification.ts). Certifying adds
 * no second suite execution — the digests come from the run this process already drove.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { getEnvVar, getEnvVars } from '@gobing-ai/spur-config';
import { certifyCanonicalRun, startCanonicalRun } from './coverage-certification';

// Internal launcher flag (task 1203): consumed BEFORE forwarding; never reaches Bun.
const publishCoverage = Bun.argv.includes('--publish-coverage');
const forwardedArgs = Bun.argv.slice(2).filter((arg) => arg !== '--publish-coverage');

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

// 1199 R4: a timeout-shaped failure on a contended host reads as a regression unless the run
// names the host load. Advisory only — one stderr line, printed before bun is spawned; it never
// touches the forwarded argv or this process's exit code. NOTE: dropping --parallel is NOT a
// viable mitigation — the suite drifted parallel-only after d6189d3ab (serial run: 7 shared-
// state failures + cross-file happy-dom fetch pollution). A contended host must wait for a
// quieter window instead.
const [load1 = 0, load5 = 0, load15 = 0] = loadavg();
const cores = availableParallelism();
if (Math.max(load1, load5, load15) > cores) {
    process.stderr.write(
        `run-tests: host load1=${load1.toFixed(2)} load5=${load5.toFixed(2)} load15=${load15.toFixed(2)} cores=${cores} — timeouts may be contention\n`,
    );
}

// Canonical coverage window (task 1203 R1): invalidate prior certification and capture
// the tested-tree fingerprint BEFORE launching, so the window is closed while the suite
// runs and any mid-run source change is caught at publish time.
const canonicalStart = publishCoverage ? await startCanonicalRun(process.cwd()) : undefined;

const result = Bun.spawnSync(['bun', ...forwardedArgs], {
    env,
    stdio: ['inherit', 'inherit', 'inherit'],
});
const exitCode = result.exitCode ?? 1;

if (canonicalStart !== undefined && exitCode === 0) {
    // Certify only the completed successful run (R1). A refused publish fails closed:
    // the suite passed, but the artifact cannot be certified (superseded or the tree
    // changed mid-run), so the post-check must not see green evidence (R4/AC4).
    const certified = await certifyCanonicalRun(process.cwd(), canonicalStart);
    if (!certified.ok) {
        rmSync(registryDir, { recursive: true, force: true });
        process.stderr.write(`coverage-certification: refused (${certified.reason}) — ${certified.message}\n`);
        process.exit(1);
    }
}

rmSync(registryDir, { recursive: true, force: true });
process.exit(exitCode);
