/**
 * Heavy-lane launcher branch (task 1463 R1).
 *
 * Failure modes first — each would let `bun run test:heavy` go green while a proof never ran, or
 * break the isolation the serial lane exists for:
 *   - a serial file runs inside the concurrent phase (contends with the other heavy files)
 *   - a concurrent-phase failure skips the serial phase, or the overall exit reads as success
 *   - a manifest row naming a missing file is ignored (the gate silently runs fewer proofs)
 *   - a heavy file absent from the manifest is silently never run
 *   - a malformed `SPUR_TEST_HEAVY_PARALLEL` falls back instead of refusing
 *   - the `test-repo-wide` shape (heavy config, explicit path) gets laned or needs the manifest
 *   - an empty phase still spawns a child
 *
 * Each case drives the real launcher in a scratch project whose fixture tests append their own
 * name to a log, so phase membership and order are observed, not inferred from argv.
 */
import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';

const LAUNCHER = join(import.meta.dir, 'run-tests.ts');
const HEAVY_ARGS = ['--config=bunfig.heavy.toml', 'test', '--reporter=dots', '.heavy.test.'];

const scratch: string[] = [];
afterEach(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
    /** Heavy files under `scripts/`, by basename stem, with their lane and whether they fail. */
    heavy?: { name: string; lane?: 'concurrent' | 'serial'; fail?: boolean; unlisted?: boolean }[];
    /** Manifest rows naming files that do not exist. */
    ghosts?: string[];
    /** Omit `config/test-lanes.json` entirely. */
    noManifest?: boolean;
}

function project(fixture: Fixture): { dir: string; log: string } {
    const dir = mkdtempSync(join(tmpdir(), 'spur-heavy-lanes-'));
    scratch.push(dir);
    const log = join(dir, 'ran.log');
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, 'bunfig.heavy.toml'), '[test]\ncoverage = false\n');
    const rows: object[] = [];
    for (const file of fixture.heavy ?? []) {
        const path = `scripts/${file.name}.heavy.test.ts`;
        writeFileSync(join(dir, path), fixtureTest(file.name, file.fail === true, log));
        if (file.unlisted !== true) {
            rows.push({ path, lane: file.lane ?? 'concurrent', shares: [], reason: 'fixture' });
        }
    }
    for (const ghost of fixture.ghosts ?? []) {
        rows.push({ path: ghost, lane: 'concurrent', shares: [], reason: 'fixture' });
    }
    if (fixture.noManifest !== true) {
        writeFileSync(
            join(dir, 'config', 'test-lanes.json'),
            JSON.stringify({ version: 1, root: { subprocess: [] }, heavy: rows }),
        );
    }
    return { dir, log };
}

function fixtureTest(name: string, fail: boolean, log: string): string {
    return [
        "import { appendFileSync } from 'node:fs';",
        "import { expect, test } from 'bun:test';",
        `test('${name}', () => {`,
        `    appendFileSync(${JSON.stringify(log)}, '${name}\\n');`,
        `    expect(${fail}).toBe(false);`,
        '});',
        '',
    ].join('\n');
}

function launch(
    dir: string,
    log: string,
    args: string[] = HEAVY_ARGS,
    extraEnv: Record<string, string> = {},
): { code: number; stderr: string; ran: string[] } {
    const result = Bun.spawnSync([process.execPath, LAUNCHER, ...args], {
        cwd: dir,
        env: { ...getEnvVars(), SPUR_TEST_HEAVY_PARALLEL: '', ...extraEnv },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const ran = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
    return { code: result.exitCode ?? 1, stderr: result.stderr.toString(), ran };
}

const phaseLines = (stderr: string): string[] =>
    stderr
        .split('\n')
        .filter((line) => line.startsWith('run-tests: phase '))
        .map((line) => line.replace(/ wall=\S+$/, ''));

test('runs the concurrent lane first, then the serial lane alone (1463 R1)', () => {
    const { dir, log } = project({
        heavy: [{ name: 'serial-one', lane: 'serial' }, { name: 'alpha' }, { name: 'beta' }],
    });
    const result = launch(dir, log);
    expect(result.code).toBe(0);
    expect(phaseLines(result.stderr)).toEqual([
        'run-tests: phase concurrent files=2 exit=0',
        'run-tests: phase serial files=1 exit=0',
    ]);
    // Every file ran exactly once, and the serial file only after the whole concurrent phase.
    expect(result.ran.slice(0, 2).sort()).toEqual(['alpha', 'beta']);
    expect(result.ran.slice(2)).toEqual(['serial-one']);
}, 60_000);

test('a concurrent-phase failure still runs the serial phase and exits nonzero (1463 R1)', () => {
    const { dir, log } = project({
        heavy: [
            { name: 'broken', fail: true },
            { name: 'serial-one', lane: 'serial' },
        ],
    });
    const result = launch(dir, log);
    expect(result.code).not.toBe(0);
    const phases = phaseLines(result.stderr);
    expect(phases[0]).toMatch(/^run-tests: phase concurrent files=1 exit=[1-9]\d*$/);
    expect(phases[1]).toBe('run-tests: phase serial files=1 exit=0');
    expect(result.ran).toEqual(['broken', 'serial-one']);
}, 60_000);

test('a manifest row naming a missing file fails before any spawn (1463 R1)', () => {
    const { dir, log } = project({ heavy: [{ name: 'alpha' }], ghosts: ['scripts/gone.heavy.test.ts'] });
    const result = launch(dir, log);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('scripts/gone.heavy.test.ts');
    expect(phaseLines(result.stderr)).toEqual([]);
    expect(result.ran).toEqual([]);
}, 60_000);

test('a heavy file the manifest does not classify fails before any spawn (1463 R1)', () => {
    const { dir, log } = project({ heavy: [{ name: 'alpha' }, { name: 'stray', unlisted: true }] });
    const result = launch(dir, log);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('scripts/stray.heavy.test.ts');
    expect(result.ran).toEqual([]);
}, 60_000);

test('a malformed SPUR_TEST_HEAVY_PARALLEL refuses before any spawn (1463 R1)', () => {
    const { dir, log } = project({ heavy: [{ name: 'alpha' }] });
    for (const value of ['0', '-2', 'four', '1.5']) {
        const result = launch(dir, log, HEAVY_ARGS, { SPUR_TEST_HEAVY_PARALLEL: value });
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain('SPUR_TEST_HEAVY_PARALLEL');
        expect(result.ran).toEqual([]);
    }
}, 60_000);

test('an empty phase spawns no child (1463 R1)', () => {
    const { dir, log } = project({ heavy: [{ name: 'alpha' }, { name: 'beta' }] });
    const result = launch(dir, log);
    expect(result.code).toBe(0);
    expect(phaseLines(result.stderr)).toEqual(['run-tests: phase concurrent files=2 exit=0']);
    expect(result.ran.sort()).toEqual(['alpha', 'beta']);
}, 60_000);

test('the test-repo-wide shape is not laned and never reads the manifest (1463 R1)', () => {
    const { dir, log } = project({ noManifest: true });
    mkdirSync(join(dir, 'repo-wide-tests'));
    writeFileSync(join(dir, 'repo-wide-tests', 'wide.test.ts'), fixtureTest('wide', false, log));
    const result = launch(dir, log, ['--config=bunfig.heavy.toml', 'test', '--reporter=dots', './repo-wide-tests']);
    expect(result.code).toBe(0);
    expect(phaseLines(result.stderr)).toEqual([]);
    expect(result.ran).toEqual(['wide']);
}, 60_000);
