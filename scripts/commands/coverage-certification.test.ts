import { afterAll, describe, expect, test } from 'bun:test';
import {
    chmodSync,
    closeSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readFileSync,
    rmSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { getEnvVar, getEnvVars } from '@gobing-ai/spur-config';
import type { ConstraintRule } from '@gobing-ai/ts-rule-engine';
import { RuleEngine } from '@gobing-ai/ts-rule-engine';
import {
    CANONICAL_RECOVERY,
    type CanonicalRunStart,
    CERT_RELATIVE_PATH,
    certifyCanonicalRun,
    LCOV_RELATIVE_PATH,
    startCanonicalRun,
    type ValidationResult,
    validateCoverageCertification,
} from './coverage-certification';

const PRODUCER = join(import.meta.dir, 'run-tests.ts');
const PRECONDITION = join(import.meta.dir, 'coverage-provenance-check.ts');

const fixtures: string[] = [];
function newFixture(): string {
    const dir = mkdtempSync(join(tmpdir(), 'cov-cert-'));
    fixtures.push(dir);
    return dir;
}
afterAll(() => {
    for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

/** Minimal git repo + bunfig so a bounded `bun test` run writes .coverage/lcov.info.
 *  The test imports a source file so the measured set is non-empty (an all-test
 *  run measures nothing and Bun emits no tracefile at all). */
function initFixtureRepo(testBody: string, sleepMs = 0): string {
    const dir = newFixture();
    writeFileSync(join(dir, '.gitignore'), '.coverage/\n');
    mkdirSync(join(dir, 'case'), { recursive: true });
    writeFileSync(
        join(dir, 'bunfig.toml'),
        '[test]\ncoverage = true\ncoverageReporter = ["lcov"]\ncoverageDir = ".coverage"\n',
    );
    writeFileSync(join(dir, 'case', 'tiny.ts'), 'export const answer = () => 1;\n');
    const prelude = "import { test, expect } from 'bun:test';\nimport { answer } from './tiny';\n";
    writeFileSync(
        join(dir, 'case', 'tiny.test.ts'),
        sleepMs > 0
            ? `${prelude}test('bounded', async () => { await new Promise((r) => setTimeout(r, ${sleepMs})); expect(answer()).toBe(1); });\n`
            : `${prelude}test('bounded', () => { expect(answer()).toBe(1); });\n`,
    );
    if (testBody !== '') {
        writeFileSync(join(dir, 'case', 'failing.test.ts'), testBody);
    }
    const git = (args: string[]) => Bun.spawnSync(['git', ...args], { cwd: dir, stdout: 'ignore', stderr: 'ignore' });
    git(['init', '-q', '-b', 'main']);
    git(['-c', 'user.email=f@f', '-c', 'user.name=f', 'add', '-A']);
    git(['-c', 'user.email=f@f', '-c', 'user.name=f', 'commit', '-qm', 'init']);
    return dir;
}

const PASSING = '';
const FAILING =
    "import { test, expect } from 'bun:test';\nimport { answer } from './tiny';\ntest('fails', () => { expect(answer()).toBe(2); });\n";
const FIXTURE_LCOV = 'SF:case/tiny.ts\nDA:1,1\nLF:1\nLH:1\nend_of_record\n';

/** Spawn the canonical producer via execPath (bypasses any PATH shim for the producer itself). */
function runProducer(fixture: string, extraEnv: Record<string, string> = {}): { exitCode: number; stderr: string } {
    const proc = Bun.spawnSync([process.execPath, PRODUCER, '--publish-coverage', 'test', join(fixture, 'case')], {
        cwd: fixture,
        env: { ...getEnvVars(), ...extraEnv },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return { exitCode: proc.exitCode ?? 1, stderr: proc.stderr.toString() };
}

function readMarker(fixture: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(fixture, CERT_RELATIVE_PATH), 'utf8'));
}

function writeMarker(fixture: string, marker: unknown): void {
    mkdirSync(join(fixture, '.coverage'), { recursive: true });
    writeFileSync(join(fixture, CERT_RELATIVE_PATH), JSON.stringify(marker));
}

function writeLcov(fixture: string, body: string): void {
    mkdirSync(join(fixture, '.coverage'), { recursive: true });
    writeFileSync(join(fixture, LCOV_RELATIVE_PATH), body);
}

function writeRunLcov(start: CanonicalRunStart, body: string): void {
    writeFileSync(join(start.coverageDir, 'lcov.info'), body);
}

async function refuseReason(fixture: string): Promise<Extract<ValidationResult, { ok: false }>['reason']> {
    const result = await validateCoverageCertification(fixture);
    expect(result.ok).toBe(false);
    return result.ok ? 'missing' : result.reason;
}

async function waitUntilExists(path: string, timeoutMs = 8000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            readFileSync(path);
            return;
        } catch {
            await new Promise((r) => setTimeout(r, 50));
        }
    }
    throw new Error(`timeout waiting for ${path}`);
}

describe('canonical certification producer (task 1203)', () => {
    test('an old canonical artifact cannot satisfy a run that produced no LCOV', async () => {
        const fixture = initFixtureRepo(PASSING);
        writeLcov(fixture, FIXTURE_LCOV);
        const start = await startCanonicalRun(fixture);
        const result = await certifyCanonicalRun(fixture, start);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe('missing-lcov');
    });

    test('a newly added source file invalidates the tested tree', async () => {
        const fixture = initFixtureRepo(PASSING);
        const start = await startCanonicalRun(fixture);
        writeRunLcov(start, FIXTURE_LCOV);
        writeFileSync(join(fixture, 'case', 'new-source.ts'), 'export const added = true;\n');
        const result = await certifyCanonicalRun(fixture, start);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe('stale-tree');
            // The refusal must NAME the drifted path — a bare digest mismatch is undiagnosable.
            expect(result.message).toContain('case/new-source.ts');
        }
    });

    test('a noncanonical launcher cannot overwrite certified full-suite coverage', async () => {
        const fixture = initFixtureRepo(PASSING);
        writeFileSync(join(fixture, 'case', 'extra.ts'), 'export const extra = () => 2;\n');
        writeFileSync(
            join(fixture, 'case', 'extra.test.ts'),
            "import {test,expect} from 'bun:test'; import {extra} from './extra'; test('extra',()=>expect(extra()).toBe(2));\n",
        );
        const canonical = runProducer(fixture);
        expect(canonical.exitCode, canonical.stderr).toBe(0);
        const before = readFileSync(join(fixture, LCOV_RELATIVE_PATH), 'utf8');
        const targeted = Bun.spawnSync([process.execPath, PRODUCER, 'test', join(fixture, 'case', 'tiny.test.ts')], {
            cwd: fixture,
            env: getEnvVars(),
            stdout: 'pipe',
            stderr: 'pipe',
        });
        expect(targeted.exitCode).toBe(0);
        expect(readFileSync(join(fixture, LCOV_RELATIVE_PATH), 'utf8')).toBe(before);
        expect((await validateCoverageCertification(fixture)).ok).toBe(true);
    }, 30000);

    test('publication and a new pending window require the same exclusive lock', async () => {
        const fixture = initFixtureRepo(PASSING);
        const start = await startCanonicalRun(fixture);
        writeRunLcov(start, FIXTURE_LCOV);
        const lockPath = join(fixture, '.coverage', 'publication.lock');
        const fd = openSync(lockPath, 'wx');
        try {
            const result = await certifyCanonicalRun(fixture, start);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.reason).toBe('publication-locked');
            await expect(startCanonicalRun(fixture)).rejects.toThrow();
            expect(readMarker(fixture).runId).toBe(start.runId);
            expect(readMarker(fixture).status).toBe('pending');
        } finally {
            closeSync(fd);
            unlinkSync(lockPath);
        }
        expect((await certifyCanonicalRun(fixture, start)).ok).toBe(true);
    });

    test('an explicit test config keeps preload, ignores and coverage-disabled behavior', () => {
        const fixture = initFixtureRepo(PASSING);
        writeFileSync(join(fixture, 'state.ts'), 'export const state = { loaded: false };\n');
        writeFileSync(join(fixture, 'preload.ts'), "import { state } from './state'; state.loaded = true;\n");
        writeFileSync(
            join(fixture, 'selected.toml'),
            '[test]\ncoverage = false\npreload = ["./preload.ts"]\npathIgnorePatterns = ["**/ignored.test.ts"]\n',
        );
        writeFileSync(
            join(fixture, 'case', 'tiny.test.ts'),
            "import {test,expect} from 'bun:test'; import {state} from '../state'; test('preload',()=>expect(state.loaded).toBe(true));\n",
        );
        writeFileSync(join(fixture, 'case', 'ignored.test.ts'), "throw new Error('ignored test must not load');\n");
        const result = Bun.spawnSync(
            [process.execPath, PRODUCER, '--config=selected.toml', 'test', join(fixture, 'case')],
            { cwd: fixture, env: getEnvVars(), stdout: 'pipe', stderr: 'pipe' },
        );
        expect(result.exitCode, result.stderr.toString()).toBe(0);
        expect(existsSync(join(fixture, LCOV_RELATIVE_PATH))).toBe(false);
        expect(existsSync(join(fixture, CERT_RELATIVE_PATH))).toBe(false);
        const missing = Bun.spawnSync([process.execPath, PRODUCER, '--config=missing.toml', 'test'], {
            cwd: fixture,
            env: getEnvVars(),
            stdout: 'pipe',
            stderr: 'pipe',
        });
        expect(missing.exitCode).not.toBe(0);
        expect(missing.stderr.toString()).toContain('config file not found');
    }, 30000);

    test('empty or incomplete run LCOV cannot be certified', async () => {
        for (const body of ['', 'SF:case/tiny.ts\nLF:1\nLH:1\n']) {
            const fixture = initFixtureRepo(PASSING);
            const start = await startCanonicalRun(fixture);
            writeRunLcov(start, body);
            const result = await certifyCanonicalRun(fixture, start);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.reason).toBe('malformed-lcov');
            expect(readMarker(fixture).status).toBe('pending');
        }
    });

    test('a passing canonical run certifies the artifact and launches exactly one suite child (AC4)', async () => {
        const fixture = initFixtureRepo(PASSING);
        // Counting shim: every suite child spawned through PATH logs one line.
        const shim = join(fixture, 'shim');
        const log = join(newFixture(), 'spawn.log');
        mkdirSync(shim, { recursive: true });
        const shimBin = join(shim, 'bun');
        writeFileSync(shimBin, `#!/bin/sh\necho child >> '${log}'\nexec '${process.execPath}' "$@"\n`);
        chmodSync(shimBin, 0o755);

        const { exitCode, stderr } = runProducer(fixture, { PATH: `${shim}${delimiter}${getEnvVar('PATH') ?? ''}` });
        expect(exitCode, stderr).toBe(0);
        const marker = readMarker(fixture);
        expect(marker.status).toBe('certified');
        expect(typeof marker.lcovDigest).toBe('string');
        expect(typeof marker.treeDigest).toBe('string');
        // Producer itself was spawned via execPath, so every logged line is one suite child.
        expect(readFileSync(log, 'utf8').trim().split('\n')).toHaveLength(1);
        const validation = await validateCoverageCertification(fixture);
        expect(validation.ok).toBe(true);
        if (validation.ok) {
            expect(validation.marker.status).toBe('certified');
            expect(validation.marker.runId).toBe(String(marker.runId));
        }
    }, 30000);

    test('a failing canonical run keeps its real exit code and leaves evidence pending (AC1)', async () => {
        const fixture = initFixtureRepo(FAILING);
        const { exitCode } = runProducer(fixture);
        expect(exitCode).not.toBe(0);
        expect(readMarker(fixture).status).toBe('pending');
        expect(await refuseReason(fixture)).toBe('pending');
    }, 30000);

    test('an interrupted canonical producer never certifies (AC1)', async () => {
        const fixture = initFixtureRepo(PASSING, 8000);
        const proc = Bun.spawn([process.execPath, PRODUCER, '--publish-coverage', 'test', join(fixture, 'case')], {
            cwd: fixture,
            stdout: 'ignore',
            stderr: 'ignore',
        });
        await waitUntilExists(join(fixture, CERT_RELATIVE_PATH));
        proc.kill(9);
        await proc.exited;
        expect(readMarker(fixture).status).toBe('pending');
        expect(await refuseReason(fixture)).toBe('pending');
    }, 30000);

    test('a source change during the run refuses publish and the window stays pending (AC3)', async () => {
        const fixture = initFixtureRepo(PASSING);
        const start = await startCanonicalRun(fixture);
        writeRunLcov(start, FIXTURE_LCOV);
        writeFileSync(
            join(fixture, 'case', 'tiny.test.ts'),
            `${readFileSync(join(fixture, 'case', 'tiny.test.ts'), 'utf8')}\n// drifted\n`,
        );
        const certified = await certifyCanonicalRun(fixture, start);
        expect(certified.ok).toBe(false);
        if (!certified.ok) {
            expect(certified.reason).toBe('stale-tree');
            expect(certified.message).toContain('case/tiny.test.ts');
        }
        expect(readMarker(fixture).status).toBe('pending');
        expect(await refuseReason(fixture)).toBe('pending');
    }, 30000);

    test('a corpus-only commit during the run does not invalidate coverage certification', async () => {
        const fixture = initFixtureRepo(PASSING);
        mkdirSync(join(fixture, 'docs/tasks5'), { recursive: true });
        const task = join(fixture, 'docs/tasks5/task.md');
        const commitCorpus = () => {
            for (const args of [
                ['add', 'docs'],
                ['-c', 'user.email=f@f', '-c', 'user.name=f', 'commit', '-qm', 'update corpus evidence'],
            ]) {
                const result = Bun.spawnSync(['git', ...args], { cwd: fixture, stdout: 'pipe', stderr: 'pipe' });
                expect(result.exitCode, result.stderr.toString()).toBe(0);
            }
        };
        writeFileSync(task, 'Testing: pending\n');
        commitCorpus();
        const start = await startCanonicalRun(fixture);
        writeRunLcov(start, FIXTURE_LCOV);
        writeFileSync(task, 'Testing: passed\n');
        commitCorpus();
        expect(await certifyCanonicalRun(fixture, start)).toEqual({ ok: true });
        expect((await validateCoverageCertification(fixture)).ok).toBe(true);
    });

    test('a CHANGELOG.md edit during the run does not invalidate coverage certification', async () => {
        const fixture = initFixtureRepo(PASSING);
        const start = await startCanonicalRun(fixture);
        writeRunLcov(start, FIXTURE_LCOV);
        writeFileSync(join(fixture, 'CHANGELOG.md'), '## 0.0.1\n- generated\n');
        expect(await certifyCanonicalRun(fixture, start)).toEqual({ ok: true });
        expect((await validateCoverageCertification(fixture)).ok).toBe(true);
    });

    test('a later canonical start supersedes the earlier run; the earlier publish is refused (AC4)', async () => {
        const fixture = initFixtureRepo(PASSING);
        const first = await startCanonicalRun(fixture);
        const second = await startCanonicalRun(fixture);
        const refused = await certifyCanonicalRun(fixture, first);
        expect(refused.ok).toBe(false);
        if (!refused.ok) {
            expect(refused.reason).toBe('superseded');
        }
        writeRunLcov(second, FIXTURE_LCOV);
        const certified = await certifyCanonicalRun(fixture, second);
        expect(certified.ok).toBe(true);
        expect(readMarker(fixture).status).toBe('certified');
        expect(await validateCoverageCertification(fixture).then((r) => r.ok)).toBe(true);
    }, 30000);

    test('a canonical run whose artifact is missing fails closed with exit 1 and a pending window (AC1/R4)', async () => {
        // Fixture with only a test file: Bun excludes test files from coverage by
        // default, so the measured set is empty and no lcov is emitted — the producer
        // must refuse to certify, exit nonzero, and leave the window pending.
        const dir = newFixture();
        writeFileSync(join(dir, '.gitignore'), '.coverage/\n');
        mkdirSync(join(dir, 'case'), { recursive: true });
        writeFileSync(
            join(dir, 'bunfig.toml'),
            '[test]\ncoverage = true\ncoverageReporter = ["lcov"]\ncoverageDir = ".coverage"\n',
        );
        writeFileSync(
            join(dir, 'case', 'tiny.test.ts'),
            "import { test, expect } from 'bun:test';\ntest('bounded', () => { expect(1).toBe(1); });\n",
        );
        const git = (args: string[]) =>
            Bun.spawnSync(['git', ...args], { cwd: dir, stdout: 'ignore', stderr: 'ignore' });
        git(['init', '-q', '-b', 'main']);
        git(['-c', 'user.email=f@f', '-c', 'user.name=f', 'add', '-A']);
        git(['-c', 'user.email=f@f', '-c', 'user.name=f', 'commit', '-qm', 'init']);
        const proc = Bun.spawnSync([process.execPath, PRODUCER, '--publish-coverage', 'test', join(dir, 'case')], {
            cwd: dir,
            env: getEnvVars(),
            stdout: 'pipe',
            stderr: 'pipe',
        });
        expect(proc.exitCode).toBe(1);
        expect(proc.stderr.toString()).toContain('coverage-certification: refused (missing-lcov)');
        expect(readMarker(dir).status).toBe('pending');
        expect(await refuseReason(dir)).toBe('pending');
    }, 30000);

    test('a targeted producer overwriting certified lcov bytes fails the post-check closed (AC1/AC3)', async () => {
        const fixture = initFixtureRepo(PASSING);
        const start = await startCanonicalRun(fixture);
        writeRunLcov(start, 'SF:case/tiny.test.ts\nDA:1,1\nLF:1\nLH:1\nend_of_record\n');
        expect((await certifyCanonicalRun(fixture, start)).ok).toBe(true);
        // Simulate `bun test <file>` rewriting the tracefile with partial data.
        writeLcov(fixture, 'SF:case/tiny.test.ts\nDA:1,1\nLF:4\nLH:1\nend_of_record\n');
        expect(await refuseReason(fixture)).toBe('lcov-mismatch');
    }, 30000);
});

describe('post-check provenance refusals are distinct (task 1203 R2)', () => {
    test('missing', async () => {
        const fixture = newFixture();
        expect(await refuseReason(fixture)).toBe('missing');
    });

    test('malformed json', async () => {
        const fixture = newFixture();
        writeMarker(fixture, '{ not json');
        expect(await refuseReason(fixture)).toBe('malformed');
    });

    test('malformed schema', async () => {
        const fixture = newFixture();
        writeMarker(fixture, { schemaVersion: 99, status: 'certified', runId: 'r', treeDigest: 'sha256:x' });
        expect(await refuseReason(fixture)).toBe('malformed');
    });

    test('pending without supersedes', async () => {
        const fixture = newFixture();
        writeMarker(fixture, { schemaVersion: 1, status: 'pending', runId: 'aaaaaaaa-bbbb', treeDigest: 'sha256:x' });
        expect(await refuseReason(fixture)).toBe('pending');
    });

    test('superseded', async () => {
        const fixture = newFixture();
        writeMarker(fixture, {
            schemaVersion: 1,
            status: 'pending',
            runId: 'aaaaaaaa-bbbb',
            treeDigest: 'sha256:x',
            supersedes: 'cccccccc-dddd',
        });
        expect(await refuseReason(fixture)).toBe('superseded');
    });

    test('missing lcov', async () => {
        const fixture = newFixture();
        writeMarker(fixture, {
            schemaVersion: 1,
            status: 'certified',
            runId: 'aaaaaaaa-bbbb',
            treeDigest: 'sha256:x',
            lcovDigest: 'sha256:y',
        });
        expect(await refuseReason(fixture)).toBe('missing-lcov');
    });

    test('stale tree', async () => {
        const fixture = initFixtureRepo(PASSING);
        const start = await startCanonicalRun(fixture);
        writeRunLcov(start, FIXTURE_LCOV);
        expect((await certifyCanonicalRun(fixture, start)).ok).toBe(true);
        writeFileSync(join(fixture, 'case', 'tiny.test.ts'), '// source changed after certification\n');
        expect(await refuseReason(fixture)).toBe('stale-tree');
        const result = await validateCoverageCertification(fixture);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.message).toContain('case/tiny.test.ts');
    }, 30000);

    test('a failed tree capture is a named provenance refusal', async () => {
        const fixture = initFixtureRepo(PASSING);
        const start = await startCanonicalRun(fixture);
        writeRunLcov(start, FIXTURE_LCOV);
        expect((await certifyCanonicalRun(fixture, start)).ok).toBe(true);
        rmSync(join(fixture, '.git'), { recursive: true, force: true });
        expect(await refuseReason(fixture)).toBe('tree-unavailable');
    });

    test('the precondition CLI exits nonzero with a coverage-artifact diagnostic and recovery hint (AC5)', async () => {
        const fixture = newFixture();
        const proc = Bun.spawnSync([process.execPath, PRECONDITION], { cwd: fixture, stdout: 'pipe', stderr: 'pipe' });
        expect(proc.exitCode).toBe(1);
        expect(proc.stderr.toString()).toContain('coverage-artifact:');
        expect(proc.stderr.toString()).toContain(CANONICAL_RECOVERY);
    }, 30000);
});

describe('certified evidence still reaches the real evaluator unchanged (task 1203 R3/AC2)', () => {
    const rule: ConstraintRule = {
        id: 'coverage-gate',
        description: 'fixture',
        enabled: true,
        severity: 'error',
        evaluator: {
            type: 'coverage-gate',
            config: { lcovPath: LCOV_RELATIVE_PATH, threshold: 90, include: ['**/src/**'] },
        },
    };

    test('an 89% production file keeps its below-threshold finding', async () => {
        const fixture = initFixtureRepo(PASSING);
        const start = await startCanonicalRun(fixture);
        writeRunLcov(
            start,
            'SF:src/low.ts\nDA:1,1\nLF:100\nLH:89\nend_of_record\nSF:src/ok.ts\nDA:1,1\nLF:10\nLH:10\nend_of_record\n',
        );
        expect((await certifyCanonicalRun(fixture, start)).ok).toBe(true);
        expect((await validateCoverageCertification(fixture)).ok).toBe(true);
        // RuleEngine's constructor registers builtin evaluators (host alone does not).
        const evaluator = new RuleEngine().host.evaluators.get('coverage-gate');
        const result = await evaluator.evaluate(rule, { workdir: fixture, rule });
        expect(result.findings).toHaveLength(1);
        expect(JSON.stringify(result.findings[0])).toContain('src/low.ts');
    });

    test('a 90% production file passes', async () => {
        const fixture = initFixtureRepo(PASSING);
        const start = await startCanonicalRun(fixture);
        writeRunLcov(start, 'SF:src/ok.ts\nDA:1,1\nLF:100\nLH:90\nend_of_record\n');
        expect((await certifyCanonicalRun(fixture, start)).ok).toBe(true);
        expect((await validateCoverageCertification(fixture)).ok).toBe(true);
        const evaluator = new RuleEngine().host.evaluators.get('coverage-gate');
        const result = await evaluator.evaluate(rule, { workdir: fixture, rule });
        expect(result.findings).toHaveLength(0);
    });
});

test('entrypoint wiring pins the canonical route and post-check provenance first (AC5)', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'package.json'), 'utf8'));
    for (const canonical of ['test', 'test:coverage', 'test:full']) {
        expect(pkg.scripts[canonical]).toContain('--publish-coverage');
    }
    for (const nonCanonical of ['test:heavy', 'test-repo-wide']) {
        expect(pkg.scripts[nonCanonical]).not.toContain('--publish-coverage');
    }
    const postCheck = pkg.scripts['test-post-check'];
    expect(postCheck.startsWith('bun scripts/spur-dev.ts coverage-provenance-check &&')).toBe(true);
    expect(postCheck).toContain('rule run');
});

describe('run-tests watchdog — a blocked child cannot hang the gate (task 1265 session finding)', () => {
    // 2026-10-20: one isolated suite worker sat at ~98% CPU for 9 h 28 m with no progress line.
    // A test that blocks in a synchronous spawn never returns, and Bun's per-test --timeout
    // cannot interrupt it — so the launcher itself must bound the child.
    const fixture = (): string => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-watchdog-'));
        mkdirSync(join(dir, 'case'), { recursive: true });
        writeFileSync(
            join(dir, 'case', 'blocked.test.ts'),
            "import { test } from 'bun:test';\ntest('blocks in a synchronous spawn', () => { Bun.spawnSync(['sleep', '30']); });\n",
        );
        return dir;
    };

    test('an expiry kills the child group and reports exit 124, never a fake test failure', () => {
        const dir = fixture();
        try {
            const proc = Bun.spawnSync([process.execPath, PRODUCER, 'test', join(dir, 'case')], {
                cwd: dir,
                env: { ...getEnvVars(), SPUR_TEST_WATCHDOG_MS: '1500' },
                stdout: 'pipe',
                stderr: 'pipe',
            });
            const stderr = proc.stderr.toString();
            expect(proc.exitCode).toBe(124);
            expect(stderr).toContain('run-tests: suite exceeded the');
            expect(stderr).toContain('watchdog — killing the child process group');
            expect(stderr).toContain('refused to report the killed suite as a test failure');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 20_000);

    test('a healthy run is untouched by the watchdog and keeps its exit code', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-watchdog-ok-'));
        try {
            mkdirSync(join(dir, 'case'), { recursive: true });
            writeFileSync(
                join(dir, 'case', 'fine.test.ts'),
                "import { test, expect } from 'bun:test';\ntest('passes', () => { expect(1).toBe(1); });\n",
            );
            const proc = Bun.spawnSync([process.execPath, PRODUCER, 'test', join(dir, 'case')], {
                cwd: dir,
                env: { ...getEnvVars(), SPUR_TEST_WATCHDOG_MS: '60000' },
                stdout: 'pipe',
                stderr: 'pipe',
            });
            expect(proc.exitCode).toBe(0);
            expect(proc.stderr.toString()).not.toContain('watchdog');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 20_000);
});
