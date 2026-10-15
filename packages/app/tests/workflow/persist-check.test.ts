import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
    compareTrees,
    defaultInvokeRoot,
    listObligations,
    PERSIST_CHECK_USAGE,
    type PersistCheckInput,
    runPersistCheck,
    wbsOfTaskFile,
} from '../../src/workflow/persist-check';

/**
 * 1067 R1/R4: the WT-4 pre-removal assertion (`spur workflow inline persist-check`). A landing
 * without persist-out must surface a named warning/block before `git worktree remove`; fixtures
 * stand in for the trees. Ported from `plugins/sp/tests/persist-out-check.test.ts` when the
 * script moved into the CLI (script-absorption PR-4).
 */

let fixtureCount = 0;

/** Run the check with `invokeRoot` as the default root (what the old `main(argv, invokeRoot)` seam did). */
function runMain(
    input: Omit<PersistCheckInput, 'cwd'>,
    invokeRoot: string,
): { code: number; out: string; err: string } {
    const report = runPersistCheck({ root: invokeRoot, ...input, cwd: invokeRoot });
    return { code: report.exitCode, out: report.stdout.join('\n'), err: report.stderr.join('\n') };
}

function makeTrees(): { wt: string; invoke: string } {
    const base = mkdtempSync(join(tmpdir(), `persist-out-check-${fixtureCount++}-`));
    const wt = join(base, 'wt');
    const invoke = join(base, 'invoke');
    mkdirSync(join(wt, '.spur', 'run'), { recursive: true });
    mkdirSync(join(wt, '.spur', 'memory', 'evidence', 'runs'), { recursive: true });
    mkdirSync(join(invoke, '.spur', 'run'), { recursive: true });
    return { wt, invoke };
}

describe('persist-out-check', () => {
    test('wbsOfTaskFile takes leading digits before underscore', () => {
        expect(wbsOfTaskFile('/x/1065_fold-freshness.md')).toBe('1065');
        expect(wbsOfTaskFile('/x/not-a-task.md')).toBeNull();
    });

    test('landing without persist-out is blocked, naming the abandoned evidence (AC1)', () => {
        const { wt, invoke } = makeTrees();
        writeFileSync(join(wt, '.spur', 'memory', 'evidence', 'runs', '1058-verdict.json'), 'v1');
        writeFileSync(join(wt, '.spur', 'run', '1058-test-gate.log'), 'PASS\n');
        const files = listObligations(wt, ['1058'], []);
        expect(files).not.toBeNull();
        const { missing } = compareTrees(wt, invoke, files?.files ?? []);
        expect(missing).toContain(join('.spur', 'memory', 'evidence', 'runs', '1058-verdict.json'));
        expect(missing).toContain(join('.spur', 'run', '1058-test-gate.log'));
        const run = runMain({ from: wt, taskFiles: ['/merged/docs/tasks5/1058_x.md'] }, invoke);
        expect(run.code).toBe(1);
        expect(run.out).toContain('MISSING .spur');
        expect(run.err).toContain('BLOCKED 2 missing');
    });

    test('after persist-out copies byte-identical evidence the check passes', () => {
        const { wt, invoke } = makeTrees();
        writeFileSync(join(wt, '.spur', 'memory', 'evidence', 'd63-receipt.md'), 'receipt');
        writeFileSync(join(wt, '.spur', 'run', '1058-verdict.json'), 'v1');
        mkdirSync(join(invoke, '.spur', 'memory', 'evidence'), { recursive: true });
        writeFileSync(join(invoke, '.spur', 'memory', 'evidence', 'd63-receipt.md'), 'receipt');
        writeFileSync(join(invoke, '.spur', 'run', '1058-verdict.json'), 'v1');
        expect(runMain({ from: wt, taskFiles: ['/t/1058_a.md'] }, invoke).code).toBe(0);
    });

    test('divergent evidence blocks (persist-out never overwrites)', () => {
        const { wt, invoke } = makeTrees();
        writeFileSync(join(wt, '.spur', 'run', '1058-verdict.json'), 'wt-copy');
        writeFileSync(join(invoke, '.spur', 'run', '1058-verdict.json'), 'invoke-copy');
        expect(runMain({ from: wt, taskFiles: ['/t/1058_a.md'] }, invoke).code).toBe(1);
    });

    test('AC1 — large worktree evidence tree does not block an owned-evidence check (1148 R1)', () => {
        const { wt, invoke } = makeTrees();
        const evDir = join(wt, '.spur', 'memory', 'evidence');
        const invEvDir = join(invoke, '.spur', 'memory', 'evidence');
        mkdirSync(invEvDir, { recursive: true });
        // 367 evidence files, of which 13 carry forwarded prefix 1058-, all persisted
        for (let i = 0; i < 354; i++) writeFileSync(join(evDir, `unowned-${i}.txt`), 'u');
        for (let i = 0; i < 13; i++) {
            writeFileSync(join(evDir, `1058-f${i}.json`), 'v');
            writeFileSync(join(invEvDir, `1058-f${i}.json`), 'v');
        }
        const obligations = listObligations(wt, ['1058'], []);
        expect(obligations).not.toBeNull();
        expect(obligations?.files).toHaveLength(13);
        expect(obligations?.unowned).toBe(354);

        const run = runMain({ from: wt, taskFiles: ['/t/1058_a.md'] }, invoke);
        expect(run.code).toBe(0);
        expect(run.out).toContain('13 evidence file(s) persisted, unowned: 354, nothing abandoned');

        // Missing forwarded file still blocks
        rmSync(join(invEvDir, '1058-f0.json'));
        const failRun = runMain({ from: wt, taskFiles: ['/t/1058_a.md'] }, invoke);
        expect(failRun.code).toBe(1);
        expect(failRun.out).toContain('MISSING .spur/memory/evidence/1058-f0.json');

        // Running with no forwarded prefix exits 2
        expect(runMain({ from: wt }, invoke).code).toBe(2);
    });

    test('AC2 — skipped run-record items are printed and nothing abandoned omitted (1148 R2)', () => {
        const { wt, invoke } = makeTrees();
        mkdirSync(join(invoke, '.spur', 'memory', 'evidence'), { recursive: true });
        writeFileSync(join(wt, '.spur', 'memory', 'evidence', '1058-v.json'), 'v');
        writeFileSync(join(invoke, '.spur', 'memory', 'evidence', '1058-v.json'), 'v');

        const successJson = join(invoke, 'persist-out.json');
        writeFileSync(
            successJson,
            JSON.stringify({
                ok: true,
                persisted: 1,
                skipped: [{ id: 'run_absent', reason: 'source-missing' }],
            }),
        );

        const run = runMain({ from: wt, taskFiles: ['/t/1058_a.md'], successJson }, invoke);
        expect(run.code).toBe(0);
        expect(run.out).toContain('SKIP run_absent: source-missing');
        expect(run.out).toContain('1 skipped');
        expect(run.out).not.toContain('nothing abandoned');
    });

    test('prefix collision does not match shorter prefix', () => {
        const { wt } = makeTrees();
        writeFileSync(join(wt, '.spur', 'memory', 'evidence', '1130-verdict.json'), 'v');
        const obligations = listObligations(wt, ['113'], []);
        expect(obligations?.files).toHaveLength(0);
        expect(obligations?.unowned).toBe(1);
    });

    test('missing --from is a usage error naming the CLI', () => {
        const run = runMain({ from: '' }, '/tmp');
        expect(run.code).toBe(2);
        expect(run.err.split('\n')[0]).toBe(PERSIST_CHECK_USAGE);
    });

    test('usage errors: absent --from path, non-directory --from', () => {
        const { wt } = makeTrees();
        writeFileSync(join(wt, '.spur', 'run', '1058-verdict.json'), 'v');
        expect(runMain({ from: join(dirname(wt), 'nope') }, '/tmp').code).toBe(2);
        expect(runMain({ from: join(wt, '.spur', 'run', '1058-verdict.json') }, '/tmp').code).toBe(2);
    });

    test('run-id cap (65 same-prefix run files) refuses; unnumbered task-file args exit 2 (1148 R1)', () => {
        const { wt, invoke } = makeTrees();
        for (let i = 0; i < 65; i++) writeFileSync(join(wt, '.spur', 'run', `1058-f${i}.log`), 'x');
        expect(listObligations(wt, [], ['1058'])).toBeNull();
        expect(runMain({ from: wt, taskFiles: ['/t/no-digits.md'] }, invoke).code).toBe(2); // nothing owned
    });

    test('finding lists are capped at 32 named files plus a +N more line', () => {
        const { wt, invoke } = makeTrees();
        for (let i = 0; i < 40; i++) writeFileSync(join(wt, '.spur', 'run', `1058-f${i}.log`), `v${i}`);
        const run = runMain({ from: wt, taskFiles: ['/t/1058_a.md'] }, invoke);
        expect(run.code).toBe(1);
        expect(run.out.split('\n').filter((l) => l.startsWith('MISSING '))).toHaveLength(32);
        expect(run.out).toContain('+8 more');
        expect(run.err).toContain('BLOCKED 40 missing');
    });

    test('--root honored over the default; empty run ids ignored', () => {
        const { wt, invoke } = makeTrees();
        expect(runMain({ from: wt, taskFiles: ['/t/1058_a.md'], runIds: [''] }, invoke).code).toBe(0);
        // --root overrides the git-derived default: pointing at a tree without the evidence blocks.
        writeFileSync(join(wt, '.spur', 'memory', 'evidence', '1058-note.md'), 'n');
        expect(runMain({ from: wt, taskFiles: ['/t/1058_a.md'], root: '/tmp' }, wt).code).toBe(1);
    });

    test('without --root the invoking tree is derived from the cwd (git common dir)', () => {
        const { wt } = makeTrees();
        const report = runPersistCheck({ from: wt, taskFiles: ['/t/1058_a.md'], cwd: wt });
        expect(report.exitCode).toBe(0); // nothing owned yet, the non-repo cwd is its own root
    });

    test('foreign-divergent evidence recorded in persist-out.json passes check (1139/R5)', () => {
        const { wt, invoke } = makeTrees();
        mkdirSync(join(invoke, '.spur', 'memory', 'evidence'), { recursive: true });
        writeFileSync(join(wt, '.spur', 'memory', 'evidence', '1139-verdict.json'), 'wt-diff');
        writeFileSync(join(invoke, '.spur', 'memory', 'evidence', '1139-verdict.json'), 'inv-diff');

        // Without persist-out.json it blocks as divergent
        expect(runMain({ from: wt, taskFiles: ['/t/1139_a.md'] }, invoke).code).toBe(1);

        // With persist-out.json recording foreign-divergent skip it passes
        const persistOutPath = join(invoke, '.spur', 'run', 'persist-out.json');
        writeFileSync(
            persistOutPath,
            JSON.stringify({
                ok: true,
                persisted: 1,
                skipped: [],
                evidenceSkipped: [{ name: '1139-verdict.json', reason: 'foreign-divergent', newer: 'invoking' }],
            }),
        );
        expect(runMain({ from: wt, taskFiles: ['/t/1139_a.md'] }, invoke).code).toBe(0);

        // Also test with explicit --success-json flag
        const customSuccessPath = join(invoke, 'custom-success.json');
        writeFileSync(
            customSuccessPath,
            JSON.stringify({
                ok: true,
                evidenceSkipped: [{ name: '1139-verdict.json', reason: 'foreign-divergent', newer: 'worktree' }],
            }),
        );
        expect(runMain({ from: wt, taskFiles: ['/t/1139_a.md'], successJson: customSuccessPath }, invoke).code).toBe(0);
    });

    test('default invoke root is the MAIN repo, never the worktree cwd (vacuous-pass guard)', () => {
        const repo = makeTrees();
        // Promote the fixture pair to a real git repo + linked worktree.
        const git = (args: string[], cwd: string): void => {
            const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
            if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`);
        };
        git(['init', '-q'], repo.wt);
        git(['config', 'user.email', 't@e.st'], repo.wt);
        git(['config', 'user.name', 't'], repo.wt);
        writeFileSync(join(repo.wt, 'seed.txt'), 'seed');
        git(['add', '.'], repo.wt);
        git(['commit', '-qm', 'seed'], repo.wt);
        git(['worktree', 'add', join(dirname(repo.wt), 'linked'), 'HEAD'], repo.wt);
        const mainTree = realpathSync(repo.wt);
        expect(realpathSync(defaultInvokeRoot(repo.wt))).toBe(mainTree); // inside main tree → itself
        expect(realpathSync(defaultInvokeRoot(join(dirname(repo.wt), 'linked')))).toBe(mainTree); // linked worktree → main tree
        rmSync(dirname(repo.wt), { recursive: true, force: true });
    });

    test('run-plane subdirectories are scanned — artifacts under .spur/run/<run-id>/ are obligations', () => {
        const { wt } = makeTrees();
        mkdirSync(join(wt, '.spur', 'run', 'run_abc'), { recursive: true });
        writeFileSync(join(wt, '.spur', 'run', 'run_abc', '1209-verdict.json'), 'v');
        const files = listObligations(wt, ['1209'], []);
        expect(files?.files).toContain(join('.spur', 'run', 'run_abc', '1209-verdict.json'));
    });

    test('unforwarded durable-verdict family blocks the teardown (batch-run-id-only forwarding)', () => {
        const { wt, invoke } = makeTrees();
        // The session incident: only the batch run id was forwarded, so the driver's
        // wbs-named verdicts matched no prefix and the check passed vacuously with 0
        // obligations while the worktree still held them.
        writeFileSync(join(wt, '.spur', 'run', '1209-verdict.json'), 'v');
        writeFileSync(join(wt, '.spur', 'run', 'scratch-notes.txt'), 'noise');
        const run = runMain({ from: wt, runIds: ['runall-1208-1209-bdcd'] }, invoke);
        expect(run.code).toBe(1);
        expect(run.out).toContain('UNFORWARDED .spur/run/1209-verdict.json');
        expect(run.out).not.toContain('scratch-notes.txt'); // unowned non-family scratch still never blocks (1148 R1)
        expect(run.err).toContain('unforwarded durable');
    });
});
