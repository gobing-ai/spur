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
 * Usage: `bun scripts/spur-dev.ts run-tests <bun test args>` — everything after the
 * script path is forwarded verbatim, so `--config=…` must precede `test` exactly as it
 * would on a bare `bun … test` line. The child's exit code is this process's exit code.
 *
 * Canonical coverage certification (task 1203): the root `test` / `test:coverage` /
 * `test:full` scripts pass the internal `--publish-coverage` flag (consumed here,
 * before forwarding). With it, the launcher invalidates prior certification before
 * spawning and, only on an exit-zero run over an unchanged working tree, certifies
 * `.coverage/lcov.info` in `.coverage/coverage-certification.json`. Targeted `bun test`,
 * heavy/repo-wide gates and interrupted runs never publish. Recovery for a refused
 * artifact: rerun `bun run test:full` (see packages/app/src/rules/coverage-certification.ts). Each child writes
 * isolated LCOV; only a canonical publisher can replace the shared artifact. Certifying adds
 * no second suite execution — the digests come from the run this process already drove.
 *
 * Heavy lanes (task 1463): the exact `test:heavy` shape (`--config=bunfig.heavy.toml test … .heavy.test.`)
 * runs as two sequential children — the manifest's concurrent files at `--parallel=min(4, cores)`
 * (`SPUR_TEST_HEAVY_PARALLEL` overrides), then its serial files at `--parallel=1` — sharing one
 * registry and so one Board seed. `config/test-lanes.json` `heavy` must match the tree first.
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve, sep } from 'node:path';
import {
    certifyCanonicalRun,
    diffHeavyLanes,
    type HeavyLaneEntry,
    readLaneManifest,
    startCanonicalRun,
} from '@gobing-ai/spur-app';
import { getEnvVar, getEnvVars } from '@gobing-ai/spur-config';
import { heavyFiles, LANE_MANIFEST_PATH } from './test-lanes';
import { windowsTestSuiteTermination } from './test-suite-termination';

// Internal launcher flag (task 1203): consumed BEFORE forwarding; never reaches Bun.
const publishCoverage = Bun.argv.includes('--publish-coverage');
const forwardedArgs = Bun.argv.slice(2).filter((arg) => arg !== '--publish-coverage');

interface TestConfig {
    test?: { coverageDir?: string; preload?: string[]; [key: string]: unknown };
    [key: string]: unknown;
}

/**
 * The suite must never take its scratch inside the repository under test. Every `mkdtemp()`
 * project would then sit in the git work tree, so walk-up project-root and git detection latch
 * onto this checkout instead of the scratch project — 46 tests that assert "outside a
 * repository" behaviour went red on 2026-11-06 under `TMPDIR=<repo>/.spur/tmp`.
 * The operator's TMPDIR survives untouched whenever it already lies outside the repository.
 */
function repositoryRoot(): string | undefined {
    let dir = resolve(process.cwd());
    while (!existsSync(join(dir, '.git'))) {
        const parent = dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
    return dir;
}

function testTempRoot(): string {
    const repo = repositoryRoot();
    if (repo === undefined) return tmpdir();
    // macOS reaches the same directory as /tmp or /private/tmp, and a linked worktree can be the
    // real path while the operator typed the symlinked one.
    const roots = new Set([resolve(repo), realpathSync(repo)]);
    const insideRepo = (candidate: string): boolean => {
        const absolute = resolve(candidate);
        return [...roots].some((root) => absolute === root || absolute.startsWith(`${root}${sep}`));
    };
    const ambient = tmpdir();
    if (!insideRepo(ambient) && !insideRepo(realpathSync(ambient))) return ambient;
    const fallback = ['/tmp', '/var/tmp'].find(
        (candidate) => existsSync(candidate) && !insideRepo(candidate) && !insideRepo(realpathSync(candidate)),
    );
    // Failing loudly beats a red suite that reads as a code regression.
    if (fallback === undefined) {
        throw new Error(
            `run-tests: TMPDIR (${ambient}) is inside the repository under test and no OS temp root is available`,
        );
    }
    return fallback;
}

const tempRoot = testTempRoot();

// One disposable registry for the whole run: registry paths must be visible to children,
// and a per-file path would drift between workers.
const registryDir = mkdtempSync(join(tempRoot, 'spur-test-env-'));
const env: Record<string, string | undefined> = {
    ...getEnvVars(),
    TMPDIR: tempRoot,
    // Config layers: never read the operator's ~/.config/spur or this checkout's live
    // .spur/config.yaml.
    SPUR_SKIP_GLOBAL_CONFIG: 'true',
    SPUR_SKIP_PROJECT_CONFIG: 'true',
    // One Board build per run (task 1462 R1): the web heavy files hand every caller a copy of a
    // single seeded build instead of paying ~9 s of `astro build` each. The directory is created
    // lazily by the first builder, so a run that never builds the Board creates nothing.
    SPUR_TEST_BOARD_SEED_DIR: join(registryDir, 'board-seed'),
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
// Same class: the dispatching pipeline's effective role leaks in as SPUR_ROLE, and agent
// resolution then reads it as an inherited role — with an empty `agentConfig` that is
// "No executors configured to serve role 'coder'", so a test that asserts inline
// substitution fails on the caller's role instead of on its own fixture. Tests that need an
// inherited role set SPUR_ROLE themselves.
delete env.SPUR_ROLE;
// "No backend" assertions must not reach the operator's live decision backend.
delete env.TYPESAFE_API_KEY;
delete env.TYPESAFE_BASE_URL;

// 1199 R4: a timeout-shaped failure on a contended host reads as a regression unless the run
// names the host load. Advisory only — one stderr line, printed before bun is spawned; it never
// touches the forwarded argv or this process's exit code. The root test script caps workers at two
// to bound subprocess fan-out; external contention can still require a quieter window.
// `bun run test:full` is the canonical coverage recovery; DOM tests must restore their globals.
const [load1 = 0, load5 = 0, load15 = 0] = loadavg();
const cores = availableParallelism();
if (Math.max(load1, load5, load15) > cores) {
    process.stderr.write(
        `run-tests: host load1=${load1.toFixed(2)} load5=${load5.toFixed(2)} load15=${load15.toFixed(2)} cores=${cores} — timeouts may be contention\n`,
    );
}

/**
 * Wall-clock bound for the suite child (task 1265 session finding).
 *
 * A suite child that blocks in `spawnSync` — a test shelling out to a CLI that waits on a
 * database lock, a child reading stdin, a wedged `git` — never returns, and Bun's per-test
 * `--timeout` cannot interrupt it: the wait is synchronous, so the timer never fires. Observed
 * on 2026-10-20: one isolated worker sat at ~98% CPU for 9 h 28 m with no progress line and no
 * file name, and the gate that launched it held the whole pipeline run. The bound converts
 * that silent total loss into a named failure that retains the log.
 *
 * 60 minutes clears the measured 3-6 minute suite by an order of magnitude while still
 * bounding a wedged run; `SPUR_TEST_WATCHDOG_MS` overrides it (0 disables the kill).
 * The heartbeat is opt-in (`SPUR_TEST_HEARTBEAT_MS`, default off): in a normal run the
 * reporter's own dots already show life, and a per-minute line reads as output leak.
 */
const WATCHDOG_MS = (() => {
    const raw = Number.parseInt(getEnvVar('SPUR_TEST_WATCHDOG_MS') ?? '', 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : 60 * 60_000;
})();

/** Heartbeat cadence; 0 (default) means silent — set SPUR_TEST_HEARTBEAT_MS to see life signs. */
const HEARTBEAT_MS = (() => {
    const raw = Number.parseInt(getEnvVar('SPUR_TEST_HEARTBEAT_MS') ?? '', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
})();

const clock = (ms: number): string => {
    const total = Math.round(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`;
};

/**
 * Spawn the suite and wait for it under a heartbeat + watchdog, instead of an unbounded
 * `spawnSync`. The child runs in its own process group so an expiry kills the whole tree
 * (Bun's isolated test workers included) rather than orphaning them.
 */
async function runSuiteChild(argv: string[]): Promise<number> {
    const startedAt = Date.now();
    const child = Bun.spawn(argv, { env, stdio: ['inherit', 'inherit', 'inherit'], detached: true });
    const heartbeat =
        HEARTBEAT_MS > 0
            ? setInterval(() => {
                  process.stderr.write(
                      `\nrun-tests: suite running ${clock(Date.now() - startedAt)} (watchdog ${WATCHDOG_MS > 0 ? clock(WATCHDOG_MS) : 'off'})\n`,
                  );
              }, HEARTBEAT_MS)
            : undefined;
    heartbeat?.unref?.();
    let expired = false;
    let childSettled = false;
    let windowsKiller: ReturnType<typeof Bun.spawn> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer =
        WATCHDOG_MS > 0
            ? setTimeout(() => {
                  if (childSettled || child.exitCode !== null || child.signalCode !== null) return;
                  expired = true;
                  process.stderr.write(
                      `\nrun-tests: suite exceeded the ${clock(WATCHDOG_MS)} watchdog — killing the child process group. ` +
                          'A blocked child cannot be interrupted by --timeout; raise SPUR_TEST_WATCHDOG_MS if the suite legitimately needs longer\n',
                  );
                  try {
                      if (process.platform === 'win32') {
                          windowsKiller = Bun.spawn(windowsTestSuiteTermination(child.pid));
                      } else {
                          process.kill(-child.pid, 'SIGTERM');
                      }
                  } catch {
                      // Missing taskkill still has the independently armed owned-child fallback below.
                  }
                  // A TERM-resistant suite never resolves child.exited, so escalation cannot wait for finally.
                  killTimer = setTimeout(() => {
                      if (childSettled || child.exitCode !== null || child.signalCode !== null) return;
                      try {
                          if (process.platform === 'win32') child.kill('SIGKILL');
                          else process.kill(-child.pid, 'SIGKILL');
                      } catch {
                          // The group already exited.
                      }
                  }, 1000);
                  killTimer.unref?.();
              }, WATCHDOG_MS)
            : undefined;
    timer?.unref?.();
    try {
        const code = await child.exited;
        if (expired) {
            process.stderr.write(
                'run-tests: refused to report the killed suite as a test failure — exit 124 (timeout)\n',
            );
            return 124;
        }
        return code ?? 1;
    } finally {
        childSettled = true;
        if (heartbeat !== undefined) clearInterval(heartbeat);
        if (timer !== undefined) clearTimeout(timer);
        if (killTimer !== undefined) clearTimeout(killTimer);
        if (windowsKiller !== undefined) {
            // Let the already-started tree cleanup finish; its own timeout bounds this wait.
            await windowsKiller.exited;
        } else if (process.platform !== 'win32') {
            try {
                process.kill(-child.pid, 'SIGKILL');
            } catch {
                // the child already exited; nothing to reap
            }
        }
    }
}

/** Heavy-gate shape the launcher lanes (task 1463 R1): this config plus the bare heavy filter. */
const HEAVY_CONFIG_BASENAME = 'bunfig.heavy.toml';
const HEAVY_FILTER = '.heavy.test.';

/** One sequential heavy phase: its files run as explicit paths under a fixed worker count. */
interface HeavyPhase {
    name: 'concurrent' | 'serial';
    parallel: number;
    files: string[];
}

/**
 * Splits the heavy gate into a concurrent phase and a serial phase, or returns `undefined` for any
 * other run. Laning keys on the exact `test:heavy` positionals (`test` + the filter): a separated flag
 * value (`--timeout 20000`) reads as a positional, so such a run stays one unlaned child. Every
 * refusal happens here, before a child is spawned — a manifest that names a missing file or misses a
 * present one would otherwise let the gate pass while a proof never ran.
 */
function planHeavyPhases(configPath: string, suiteArgs: string[]): HeavyPhase[] | undefined {
    const positionals = suiteArgs.filter((arg) => !arg.startsWith('-'));
    if (basename(configPath) !== HEAVY_CONFIG_BASENAME || positionals.join(' ') !== `test ${HEAVY_FILTER}`) {
        return undefined;
    }
    const rawParallel = getEnvVar('SPUR_TEST_HEAVY_PARALLEL') ?? '';
    if (rawParallel !== '' && !/^[1-9]\d*$/.test(rawParallel)) {
        throw new Error(`run-tests: SPUR_TEST_HEAVY_PARALLEL must be a positive integer, got '${rawParallel}'`);
    }
    const parallel = rawParallel === '' ? Math.min(4, cores) : Number(rawParallel);
    const manifestPath = resolve(LANE_MANIFEST_PATH);
    if (!existsSync(manifestPath)) throw new Error(`run-tests: heavy lane manifest not found: ${manifestPath}`);
    const manifest = readLaneManifest(readFileSync(manifestPath, 'utf8'));
    const drift = diffHeavyLanes(heavyFiles(process.cwd()), manifest);
    if (drift.length > 0) {
        const rows = drift.map((row) => `  ${row.kind} ${row.path} — ${row.detail}`).join('\n');
        throw new Error(`run-tests: ${LANE_MANIFEST_PATH} \`heavy\` disagrees with the tree:\n${rows}`);
    }
    const heavy = Array.isArray(manifest.heavy) ? (manifest.heavy as HeavyLaneEntry[]) : [];
    const lane = (name: HeavyPhase['name']) => heavy.filter((row) => row.lane === name).map((row) => `./${row.path}`);
    return [
        { name: 'concurrent', parallel, files: lane('concurrent') },
        { name: 'serial', parallel: 1, files: lane('serial') },
    ];
}

/**
 * Runs the phases in order under one `registryDir` (so one Board seed). The serial phase runs even
 * when the concurrent phase fails — a later proof's result is still evidence — and the exit code is
 * the first nonzero phase code. An empty phase spawns nothing.
 */
async function runHeavyPhases(isolatedConfig: string, suiteArgs: string[], phases: HeavyPhase[]): Promise<number> {
    const flags = suiteArgs.filter((arg) => arg.startsWith('-'));
    let firstFailure = 0;
    for (const phase of phases) {
        if (phase.files.length === 0) continue;
        const startedAt = Date.now();
        const code = await runSuiteChild([
            'bun',
            `--config=${isolatedConfig}`,
            'test',
            ...flags,
            `--parallel=${phase.parallel}`,
            ...phase.files,
        ]);
        process.stderr.write(
            `run-tests: phase ${phase.name} files=${phase.files.length} exit=${code} wall=${clock(Date.now() - startedAt)}\n`,
        );
        if (firstFailure === 0) firstFailure = code;
    }
    return firstFailure;
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
    const heavyPhases = planHeavyPhases(configPath, suiteArgs);
    const config = (existsSync(configPath) ? Bun.TOML.parse(readFileSync(configPath, 'utf8')) : {}) as TestConfig;
    config.test ??= {};
    config.test.coverageDir = coverageDir;
    if (config.test.preload) {
        config.test.preload = config.test.preload.map((path) => resolve(dirname(configPath), path));
    }
    // Bun's configured coverageDir overrides its CLI flag; copy the config without changing its gates.
    const isolatedConfig = join(registryDir, 'bunfig.toml');
    writeFileSync(isolatedConfig, Bun.TOML.stringify(config));
    exitCode =
        heavyPhases === undefined
            ? await runSuiteChild(['bun', `--config=${isolatedConfig}`, ...suiteArgs])
            : await runHeavyPhases(isolatedConfig, suiteArgs, heavyPhases);

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
