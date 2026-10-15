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
 * artifact: rerun `bun run test:full` (see coverage-certification.ts). Each child writes
 * isolated LCOV; only a canonical publisher can replace the shared artifact. Certifying adds
 * no second suite execution — the digests come from the run this process already drove.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { getEnvVar, getEnvVars } from '@gobing-ai/spur-config';
import { certifyCanonicalRun, startCanonicalRun } from './coverage-certification';

// Internal launcher flag (task 1203): consumed BEFORE forwarding; never reaches Bun.
const publishCoverage = Bun.argv.includes('--publish-coverage');
const forwardedArgs = Bun.argv.slice(2).filter((arg) => arg !== '--publish-coverage');

interface TestConfig {
    test?: { coverageDir?: string; preload?: string[]; [key: string]: unknown };
    [key: string]: unknown;
}

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
    PATH: `${join(import.meta.dir, '..', '..', 'tests', 'shims')}${delimiter}${getEnvVar('PATH') ?? ''}`,
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
// state failures + cross-file happy-dom fetch pollution). The root test script caps workers at two
// to bound subprocess fan-out while retaining isolation; external contention can still require a quieter window.
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
let exitCode = 1;
try {
    const canonicalStart = publishCoverage ? await startCanonicalRun(process.cwd()) : undefined;
    const coverageDir = canonicalStart?.coverageDir ?? join(registryDir, 'coverage');
    let configPath = resolve('bunfig.toml');
    let explicitConfig = false;
    const suiteArgs: string[] = [];
    for (let i = 0; i < forwardedArgs.length; i++) {
        const arg = forwardedArgs[i] as string;
        if (arg === '--config' || arg === '-c' || arg.startsWith('--config=')) {
            const value = arg.startsWith('--config=') ? arg.slice('--config='.length) : forwardedArgs[++i];
            if (!value || value.startsWith('-')) throw new Error('run-tests: --config requires a file path');
            configPath = resolve(value);
            explicitConfig = true;
        } else if (arg === '--coverage-dir') i++;
        else if (!arg.startsWith('--coverage-dir=')) suiteArgs.push(arg);
    }
    if (explicitConfig && !existsSync(configPath)) throw new Error(`run-tests: config file not found: ${configPath}`);
    const config = (existsSync(configPath) ? Bun.TOML.parse(readFileSync(configPath, 'utf8')) : {}) as TestConfig;
    config.test ??= {};
    config.test.coverageDir = coverageDir;
    if (config.test.preload) {
        config.test.preload = config.test.preload.map((path) => resolve(dirname(configPath), path));
    }
    // Bun's configured coverageDir overrides its CLI flag; copy the config without changing its gates.
    const isolatedConfig = join(registryDir, 'bunfig.toml');
    writeFileSync(isolatedConfig, Bun.TOML.stringify(config));
    const result = Bun.spawnSync(['bun', `--config=${isolatedConfig}`, ...suiteArgs], {
        env,
        stdio: ['inherit', 'inherit', 'inherit'],
    });
    exitCode = result.exitCode ?? 1;

    if (canonicalStart !== undefined && exitCode === 0) {
        const certified = await certifyCanonicalRun(process.cwd(), canonicalStart);
        if (certified.ok) {
            rmSync(canonicalStart.coverageDir, { recursive: true, force: true });
        } else {
            process.stderr.write(`coverage-certification: refused (${certified.reason}) — ${certified.message}\n`);
            exitCode = 1;
        }
    }
} finally {
    rmSync(registryDir, { recursive: true, force: true });
}
process.exit(exitCode);
