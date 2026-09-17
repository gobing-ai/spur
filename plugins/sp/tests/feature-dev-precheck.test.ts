import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar, getEnvVars } from '@gobing-ai/ts-utils';
import { parse as parseYaml } from 'yaml';
import {
    FEATURE_DEV_PRECHECK_USAGE,
    featureIdentityMatches,
    freezeTodoList,
    hasBlockingStatus,
    identityRc,
    main,
    rosterContractHolds,
    rosterIsNonEmptyArray,
    runFeatureDevPrecheck,
    spurCommand,
} from '../scripts/feature-dev-precheck';

const SCRIPT = join(import.meta.dir, '..', 'scripts', 'feature-dev-precheck.ts');
const TWIN = join(import.meta.dir, '..', 'scripts', 'feature-dev-precheck.mjs');
// 'config' segment split to comply with the sp-runtime-path rule (config/{workflows|...} literal ban).
const FEATURE_DEV_YAML = join(import.meta.dir, '..', '..', '..', 'config', 'workflows', 'feature-dev.yaml');

interface SpawnOutcome {
    code: number;
    stdout: string;
    stderr: string;
}

function scratch(prefix: string): { dir: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const SPUR_STUB = `#!/bin/bash
# Stub CLI: serves canned feature/roster fixtures from STUB_DIR, like the pipeline harness.
case "$1 $2" in
  "feature show")
    if [ -f "$STUB_DIR/feature.json" ]; then cat "$STUB_DIR/feature.json"; else echo "stub: unknown feature" >&2; exit 1; fi ;;
  "task list")
    if [ -f "$STUB_DIR/roster.json" ]; then cat "$STUB_DIR/roster.json"; else echo "[]" ; fi ;;
  *) echo "stub spur: unsupported: $*" >&2; exit 64 ;;
esac
`;

function installStub(dir: string): string {
    const stub = join(dir, 'spur-stub');
    writeFileSync(stub, SPUR_STUB, { mode: 0o755 });
    return stub;
}

/** Spawn the script (bun source or node twin) in `dir` with the stub spurBin. */
function spawnScript(dir: string, script: string, env: Record<string, string>, args: string[] = []): SpawnOutcome {
    const proc = Bun.spawnSync(['bun', script, ...args], {
        cwd: dir,
        env: { ...getEnvVars(), ...env, spurBin: env.spurBin ?? join(dir, 'spur-stub'), STUB_DIR: dir },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return {
        code: proc.exitCode ?? 1,
        stdout: proc.stdout?.toString() ?? '',
        stderr: proc.stderr?.toString() ?? '',
    };
}

function seed(dir: string, feature: unknown, roster: unknown): void {
    writeFileSync(join(dir, 'feature.json'), typeof feature === 'string' ? feature : JSON.stringify(feature));
    writeFileSync(join(dir, 'roster.json'), typeof roster === 'string' ? roster : JSON.stringify(roster));
}

/** Capture `fail()` stderr around a synchronous run for in-process assertions (0823 pattern). */
function captureStderr<T>(run: () => T): { stderr: string; result: T } {
    const writes: string[] = [];
    const original = process.stderr.write;
    process.stderr.write = ((chunk: Uint8Array | string): boolean => {
        writes.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
        return true;
    }) as typeof process.stderr.write;
    try {
        const result = run();
        return { stderr: writes.join(''), result };
    } finally {
        process.stderr.write = original;
    }
}

const RUN_ID = 'run-0825';
const ENV = { featureId: 'F1', __runId: RUN_ID };

const MIXED_ROSTER = [
    { wbs: '0782', status: 'todo' },
    { wbs: '0723', status: 'done' },
    { wbs: '0781', status: 'todo' },
    { wbs: '0609', status: 'cancelled' },
];

describe('feature-dev-precheck script (0825 d)', () => {
    test('happy path: frozen todo list, PASS status, all four artifacts, exit 0', () => {
        const { dir, cleanup } = scratch('spur-fdp-happy-');
        try {
            installStub(dir);
            seed(dir, { id: 'F1', name: 'stub' }, MIXED_ROSTER);
            const out = spawnScript(dir, SCRIPT, ENV);
            expect(out.code).toBe(0);
            expect(out.stderr).toBe('');
            expect(readFileSync(join(dir, '.spur/run/run-0825-feature-dev-tasks.txt'), 'utf8')).toBe('0781,0782');
            expect(readFileSync(join(dir, '.spur/run/run-0825-feature-dev-precheck.status'), 'utf8')).toBe('PASS\n');
            expect(readFileSync(join(dir, '.spur/run/run-0825-feature-dev-feature.json'), 'utf8')).toContain(
                '"id":"F1"',
            );
            expect(readFileSync(join(dir, '.spur/run/run-0825-feature-dev-roster.json'), 'utf8')).toContain('0782');
        } finally {
            cleanup();
        }
    });

    test('the registered node twin behaves identically on the happy path', () => {
        const { dir, cleanup } = scratch('spur-fdp-twin-');
        try {
            installStub(dir);
            seed(dir, { id: 'F1' }, MIXED_ROSTER);
            const proc = Bun.spawnSync(['node', TWIN], {
                cwd: dir,
                env: { ...getEnvVars(), ...ENV, spurBin: join(dir, 'spur-stub'), STUB_DIR: dir },
                stdout: 'pipe',
                stderr: 'pipe',
            });
            expect(proc.exitCode).toBe(0);
            expect(readFileSync(join(dir, '.spur/run/run-0825-feature-dev-tasks.txt'), 'utf8')).toBe('0781,0782');
            expect(readFileSync(join(dir, '.spur/run/run-0825-feature-dev-precheck.status'), 'utf8')).toBe('PASS\n');
        } finally {
            cleanup();
        }
    });

    test('unknown feature: message 1 carries the rc triple and records FAIL', () => {
        const { dir, cleanup } = scratch('spur-fdp-unknown-');
        try {
            installStub(dir);
            const out = spawnScript(dir, SCRIPT, ENV);
            expect(out.code).toBe(0);
            expect(out.stderr).toContain(
                "feature-dev precheck: missing featureId/runId, unknown feature 'F1', or unreadable roster (rc 0/1/1)",
            );
            expect(out.stderr).toContain('nothing was auto-created or re-planned');
            expect(readFileSync(join(dir, '.spur/run/run-0825-feature-dev-precheck.status'), 'utf8')).toBe('FAIL\n');
            expect(existsSync(join(dir, '.spur/run/run-0825-feature-dev-tasks.txt'))).toBe(false);
        } finally {
            cleanup();
        }
    });

    test('missing identity: message 1 with rc 1/1/1 and no status retry residue', () => {
        const { dir, cleanup } = scratch('spur-fdp-noid-');
        try {
            installStub(dir);
            writeFileSync(join(dir, '.spur/run/run-0825-feature-dev-precheck.status'), 'PASS\n');
            const out = spawnScript(dir, SCRIPT, { __runId: RUN_ID });
            expect(out.code).toBe(0);
            expect(out.stderr).toContain("unknown feature ''");
            expect(out.stderr).toContain('(rc 1/1/1)');
            expect(readFileSync(join(dir, '.spur/run/run-0825-feature-dev-precheck.status'), 'utf8')).toBe('FAIL\n');
        } finally {
            cleanup();
        }
    });

    test('empty roster: message 2 refuses to run an empty batch', () => {
        const { dir, cleanup } = scratch('spur-fdp-empty-');
        try {
            installStub(dir);
            seed(dir, { id: 'F1' }, []);
            const out = spawnScript(dir, SCRIPT, ENV);
            expect(out.code).toBe(0);
            expect(out.stderr).toContain(
                'roster at .spur/run/run-0825-feature-dev-roster.json is malformed, not an array, or empty',
            );
            expect(out.stderr).toContain('refusing to replan or run an empty batch');
            expect(readFileSync(join(dir, '.spur/run/run-0825-feature-dev-precheck.status'), 'utf8')).toBe('FAIL\n');
        } finally {
            cleanup();
        }
    });

    test('malformed (non-array) roster: message 2', () => {
        const { dir, cleanup } = scratch('spur-fdp-malformed-');
        try {
            installStub(dir);
            seed(dir, { id: 'F1' }, 'not json at all');
            const out = spawnScript(dir, SCRIPT, ENV);
            expect(out.code).toBe(0);
            expect(out.stderr).toContain('is malformed, not an array, or empty');
            expect(readFileSync(join(dir, '.spur/run/run-0825-feature-dev-precheck.status'), 'utf8')).toBe('FAIL\n');
        } finally {
            cleanup();
        }
    });

    test('duplicate WBS identities: message 3', () => {
        const { dir, cleanup } = scratch('spur-fdp-dup-');
        try {
            installStub(dir);
            seed(dir, { id: 'F1' }, [
                { wbs: '0782', status: 'todo' },
                { wbs: '0782', status: 'todo' },
            ]);
            const out = spawnScript(dir, SCRIPT, ENV);
            expect(out.code).toBe(0);
            expect(out.stderr).toContain('empty/duplicate/mismatched WBS identities or unknown statuses');
            expect(out.stderr).toContain('refusing to batch a broken roster');
            expect(readFileSync(join(dir, '.spur/run/run-0825-feature-dev-precheck.status'), 'utf8')).toBe('FAIL\n');
        } finally {
            cleanup();
        }
    });

    test('null roster member records FAIL instead of crashing without a status', () => {
        const { dir, cleanup } = scratch('spur-fdp-null-');
        try {
            installStub(dir);
            seed(dir, { id: 'F1' }, [null]);
            const out = spawnScript(dir, SCRIPT, ENV);
            expect(out.code).toBe(0);
            expect(out.stderr).toContain('refusing to batch a broken roster');
            expect(readFileSync(join(dir, '.spur/run/run-0825-feature-dev-precheck.status'), 'utf8')).toBe('FAIL\n');
        } finally {
            cleanup();
        }
    });

    test('unknown row status: message 3', () => {
        const { dir, cleanup } = scratch('spur-fdp-status-');
        try {
            installStub(dir);
            seed(dir, { id: 'F1' }, [{ wbs: '0782', status: 'shipping' }]);
            const out = spawnScript(dir, SCRIPT, ENV);
            expect(out.code).toBe(0);
            expect(out.stderr).toContain('empty/duplicate/mismatched WBS identities or unknown statuses');
        } finally {
            cleanup();
        }
    });

    test('blocking status: message 4 with the refine/resume handoff', () => {
        const { dir, cleanup } = scratch('spur-fdp-blocking-');
        try {
            installStub(dir);
            seed(dir, { id: 'F1' }, [
                { wbs: '0782', status: 'todo' },
                { wbs: '0608', status: 'wip' },
            ]);
            const out = spawnScript(dir, SCRIPT, ENV);
            expect(out.code).toBe(0);
            expect(out.stderr).toContain('linked task(s) are backlog/wip/testing/blocked');
            expect(out.stderr).toContain('refusing to launch overlapping work');
            expect(readFileSync(join(dir, '.spur/run/run-0825-feature-dev-precheck.status'), 'utf8')).toBe('FAIL\n');
        } finally {
            cleanup();
        }
    });

    test('empty wbs identity: message 3', () => {
        const { dir, cleanup } = scratch('spur-fdp-emptywbs-');
        try {
            installStub(dir);
            seed(dir, { id: 'F1' }, [{ wbs: '', status: 'todo' }]);
            const out = spawnScript(dir, SCRIPT, ENV);
            expect(out.stderr).toContain('empty/duplicate/mismatched WBS identities');
        } finally {
            cleanup();
        }
    });

    test('a stale status file is removed before the run (rm -f port)', () => {
        const { dir, cleanup } = scratch('spur-fdp-stale-');
        try {
            installStub(dir);
            seed(dir, { id: 'F1' }, MIXED_ROSTER);
            writeFileSync(join(dir, '.spur/run/run-0825-feature-dev-precheck.status'), 'FAIL\n');
            const result = runFeatureDevPrecheck(
                { ...ENV, spurBin: join(dir, 'spur-stub') },
                { cwd: dir, env: { STUB_DIR: dir } },
            );
            expect(result.status).toBe('PASS');
        } finally {
            cleanup();
        }
    });

    test('wrapper fail-closed: no plugins/ dir and a failing superskill records FAIL, exits 0', () => {
        const { dir, cleanup } = scratch('spur-fdp-wrapper-');
        try {
            const def = parseYaml(readFileSync(FEATURE_DEV_YAML, 'utf8')) as {
                states: { id: string; onEnter?: { kind: string; options?: { command?: string } }[] }[];
            };
            const precheck = def.states.find((s) => s.id === 'precheck');
            const command = String(precheck?.onEnter?.find((a) => a.kind === 'shell')?.options?.command ?? '');
            expect(command).toContain('feature-dev-precheck');
            const bin = join(dir, 'bin');
            mkdirSync(bin, { recursive: true });
            const badSuperskill = join(bin, 'superskill');
            writeFileSync(badSuperskill, '#!/bin/sh\nexit 64\n', { mode: 0o755 });
            const proc = Bun.spawnSync(['bash', '-c', command], {
                cwd: dir,
                env: { ...getEnvVars(), __runId: RUN_ID, featureId: 'F1', PATH: `${bin}:${getEnvVar('PATH') ?? ''}` },
                stdout: 'pipe',
                stderr: 'pipe',
            });
            expect(proc.exitCode).toBe(0);
            expect(proc.stderr?.toString()).toContain('failed closed');
            expect(proc.stderr?.toString()).toContain('superskill install sp');
            expect(readFileSync(join(dir, '.spur/run/run-0825-feature-dev-precheck.status'), 'utf8')).toBe('FAIL\n');
        } finally {
            cleanup();
        }
    });

    test('usage: argv arguments are refused with exit 2; no-argv exits 0 in a scoped cwd', () => {
        // main() tees its usage/status lines to the real stdio; capture to keep the reporter clean.
        const stderrWrite = process.stderr.write;
        process.stderr.write = () => true;
        try {
            expect(main(['unexpected'])).toBe(2);
        } finally {
            process.stderr.write = stderrWrite;
        }
        expect(FEATURE_DEV_PRECHECK_USAGE).toContain('featureId');
        // The no-argv path must never run against the repo cwd (it would write .spur/run
        // artifacts and invoke the real spur CLI), so it is spawned in a scratch dir.
        const { dir, cleanup } = scratch('spur-fdp-usage-');
        try {
            const out = spawnScript(dir, SCRIPT, ENV);
            expect(out.code).toBe(0);
        } finally {
            cleanup();
        }
    });
});

// The spawned-child tests above drive the fail ladder in a separate bun process, which
// `bun test --coverage` does not instrument; these in-process twins run runFeatureDevPrecheck
// and main directly with cwd (and STUB_DIR) pinned to a scratch dir so the error branches count.
describe('feature-dev-precheck in-process error paths (0825 d)', () => {
    test('rung 1 via spawn failure: a missing spurBin records the exec loss with rc 0/127/1', () => {
        const { dir, cleanup } = scratch('spur-fdp-spawnfail-');
        try {
            const { stderr, result } = captureStderr(() =>
                runFeatureDevPrecheck({ ...ENV, spurBin: join(dir, 'no-such-spur') }, { cwd: dir }),
            );
            expect(result.status).toBe('FAIL');
            expect(result.tasks).toBe('');
            expect(stderr).toContain('(rc 0/127/1)');
            expect(stderr).toContain('nothing was auto-created or re-planned');
            expect(readFileSync(join(dir, '.spur/run/run-0825-feature-dev-feature.json'), 'utf8')).toContain(
                'spawn failed: ',
            );
            expect(readFileSync(join(dir, '.spur/run/run-0825-feature-dev-feature.json'), 'utf8')).toContain('ENOENT');
            expect(readFileSync(join(dir, '.spur/run/run-0825-feature-dev-precheck.status'), 'utf8')).toBe('FAIL\n');
        } finally {
            cleanup();
        }
    });

    test('rung 1 via identity mismatch: feature file id ≠ featureId blocks the roster read (rc 0/0/1)', () => {
        const { dir, cleanup } = scratch('spur-fdp-mismatch-');
        try {
            installStub(dir);
            seed(dir, { id: 'F2' }, MIXED_ROSTER);
            const { stderr, result } = captureStderr(() =>
                runFeatureDevPrecheck(
                    { ...ENV, spurBin: join(dir, 'spur-stub') },
                    { cwd: dir, env: { STUB_DIR: dir } },
                ),
            );
            expect(result.status).toBe('FAIL');
            expect(stderr).toContain('(rc 0/0/1)');
            expect(existsSync(join(dir, '.spur/run/run-0825-feature-dev-roster.json'))).toBe(false);
        } finally {
            cleanup();
        }
    });

    test('rung 2 in-process: an empty roster refuses to run an empty batch (message 2)', () => {
        const { dir, cleanup } = scratch('spur-fdp-ipempty-');
        try {
            installStub(dir);
            seed(dir, { id: 'F1' }, []);
            const { stderr, result } = captureStderr(() =>
                runFeatureDevPrecheck(
                    { ...ENV, spurBin: join(dir, 'spur-stub') },
                    { cwd: dir, env: { STUB_DIR: dir } },
                ),
            );
            expect(result.status).toBe('FAIL');
            expect(stderr).toContain('is malformed, not an array, or empty');
            expect(stderr).toContain('refusing to replan or run an empty batch');
            expect(readFileSync(join(dir, '.spur/run/run-0825-feature-dev-precheck.status'), 'utf8')).toBe('FAIL\n');
        } finally {
            cleanup();
        }
    });

    test('rung 3 in-process: duplicate WBS identities refuse to batch a broken roster (message 3)', () => {
        const { dir, cleanup } = scratch('spur-fdp-ipdup-');
        try {
            installStub(dir);
            seed(dir, { id: 'F1' }, [
                { wbs: '0782', status: 'todo' },
                { wbs: '0782', status: 'todo' },
            ]);
            const { stderr, result } = captureStderr(() =>
                runFeatureDevPrecheck(
                    { ...ENV, spurBin: join(dir, 'spur-stub') },
                    { cwd: dir, env: { STUB_DIR: dir } },
                ),
            );
            expect(result.status).toBe('FAIL');
            expect(stderr).toContain('empty/duplicate/mismatched WBS identities or unknown statuses');
        } finally {
            cleanup();
        }
    });

    test('rung 4 in-process: a blocking status refuses overlapping work (message 4)', () => {
        const { dir, cleanup } = scratch('spur-fdp-ipblock-');
        try {
            installStub(dir);
            seed(dir, { id: 'F1' }, [
                { wbs: '0782', status: 'todo' },
                { wbs: '0608', status: 'blocked' },
            ]);
            const { stderr, result } = captureStderr(() =>
                runFeatureDevPrecheck(
                    { ...ENV, spurBin: join(dir, 'spur-stub') },
                    { cwd: dir, env: { STUB_DIR: dir } },
                ),
            );
            expect(result.status).toBe('FAIL');
            expect(stderr).toContain('linked task(s) are backlog/wip/testing/blocked');
            expect(stderr).toContain('refusing to launch overlapping work');
        } finally {
            cleanup();
        }
    });

    test('main with no argv: precheck runs against the caller cwd and still exits 0 (soft-fail)', () => {
        const { dir, cleanup } = scratch('spur-fdp-main-');
        try {
            // Baked-path stub variant: getEnvVars() mutations do not reach spawned children under
            // Bun, so the STUB_DIR indirection is replaced with absolute fixture paths.
            const stub = join(dir, 'spur-stub-baked');
            writeFileSync(stub, SPUR_STUB.split('$STUB_DIR').join(dir), { mode: 0o755 });
            seed(dir, { id: 'F1' }, MIXED_ROSTER);
            const previousCwd = process.cwd();
            process.chdir(dir);
            const writes = [process.stdout.write, process.stderr.write];
            process.stdout.write = () => true;
            process.stderr.write = () => true;
            try {
                expect(main([], { featureId: 'F1', __runId: RUN_ID, spurBin: stub })).toBe(0);
            } finally {
                process.chdir(previousCwd);
                process.stdout.write = writes[0];
                process.stderr.write = writes[1];
            }
            expect(readFileSync(join(dir, '.spur/run/run-0825-feature-dev-precheck.status'), 'utf8')).toBe('PASS\n');
            expect(readFileSync(join(dir, '.spur/run/run-0825-feature-dev-tasks.txt'), 'utf8')).toBe('0781,0782');
        } finally {
            cleanup();
        }
    });
});

describe('feature-dev-precheck pure helpers', () => {
    test('identityRc mirrors the test -n conjunction', () => {
        expect(identityRc('F1', 'run')).toBe(0);
        expect(identityRc('', 'run')).toBe(1);
        expect(identityRc('F1', undefined)).toBe(1);
        expect(identityRc(undefined, undefined)).toBe(1);
    });

    test('featureIdentityMatches ports the jq identity predicate', () => {
        expect(featureIdentityMatches('{"id":"F1","name":"x"}', 'F1')).toBe(true);
        expect(featureIdentityMatches('{"id":"F2"}', 'F1')).toBe(false);
        expect(featureIdentityMatches('["F1"]', 'F1')).toBe(false);
        expect(featureIdentityMatches('garbage{', 'F1')).toBe(false);
        expect(featureIdentityMatches('', 'F1')).toBe(false);
    });

    test('rosterIsNonEmptyArray ports the jq shape probe', () => {
        expect(rosterIsNonEmptyArray('[{"wbs":"0782"}]')).toBe(true);
        expect(rosterIsNonEmptyArray('[]')).toBe(false);
        expect(rosterIsNonEmptyArray('{"wbs":"0782"}')).toBe(false);
        expect(rosterIsNonEmptyArray('nope')).toBe(false);
    });

    test('rosterContractHolds enforces non-empty unique string WBS + known statuses', () => {
        expect(rosterContractHolds([{ wbs: '0782', status: 'todo' }])).toBe(true);
        expect(
            rosterContractHolds([
                { wbs: '0782', status: 'done' },
                { wbs: '0781', status: 'cancelled' },
            ]),
        ).toBe(true);
        expect(rosterContractHolds([{ wbs: '', status: 'todo' }])).toBe(false);
        expect(rosterContractHolds([{ wbs: 42, status: 'todo' }])).toBe(false);
        expect(
            rosterContractHolds([
                { wbs: '0782', status: 'todo' },
                { wbs: '0782', status: 'done' },
            ]),
        ).toBe(false);
        expect(rosterContractHolds([{ wbs: '0782', status: 'shipping' }])).toBe(false);
        expect(rosterContractHolds([{ wbs: '0782', status: undefined }])).toBe(false);
    });

    test('hasBlockingStatus detects exactly the four blocking statuses', () => {
        expect(hasBlockingStatus([{ wbs: '1', status: 'todo' }])).toBe(false);
        expect(hasBlockingStatus([{ wbs: '1', status: 'backlog' }])).toBe(true);
        expect(hasBlockingStatus([{ wbs: '1', status: 'wip' }])).toBe(true);
        expect(hasBlockingStatus([{ wbs: '1', status: 'testing' }])).toBe(true);
        expect(hasBlockingStatus([{ wbs: '1', status: 'blocked' }])).toBe(true);
    });

    test('freezeTodoList sorts and comma-joins the todo subset without a newline', () => {
        expect(freezeTodoList(MIXED_ROSTER)).toBe('0781,0782');
        expect(freezeTodoList([])).toBe('');
        expect(freezeTodoList([{ wbs: '0723', status: 'done' }])).toBe('');
    });

    test('spurCommand splits on whitespace into command + prefix args', () => {
        expect(spurCommand('spur')).toEqual({ cmd: 'spur', prefix: [] });
        expect(spurCommand('bun run apps/cli/src/index.ts')).toEqual({
            cmd: 'bun',
            prefix: ['run', 'apps/cli/src/index.ts'],
        });
        expect(spurCommand(undefined)).toEqual({ cmd: 'spur', prefix: [] });
        expect(spurCommand('   ')).toEqual({ cmd: 'spur', prefix: [] });
    });
});
