import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/ts-utils';
import { parse } from 'yaml';

interface PipelineAction {
    kind: string;
    options?: { command?: string; file?: string; var?: string; escalationFile?: string; prompt?: string };
}

interface PipelineState {
    id: string;
    onEnter?: PipelineAction[];
}

interface PipelineTransition {
    from: string;
    to: string;
    guard?: PipelineAction;
}

interface PipelineDefinition {
    states: PipelineState[];
    transitions?: PipelineTransition[];
    vars?: Record<string, string>;
}

const ROOT = join(import.meta.dir, '..', '..', '..');
const PIPELINE = parse(
    readFileSync(join(ROOT, 'config', 'workflows', 'task-pipeline.yaml'), 'utf8'),
) as PipelineDefinition;

function commandFor(stateId: string, shellIndex = 0): string {
    const commands =
        PIPELINE.states
            .find((state) => state.id === stateId)
            ?.onEnter?.filter((action) => action.kind === 'shell')
            .map((action) => action.options?.command ?? '') ?? [];
    const command = commands[shellIndex];
    if (command === undefined) throw new Error(`missing shell command ${shellIndex} for ${stateId}`);
    return command;
}

function executable(dir: string, name: string, body: string): string {
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
}

function initGitRepo(dir: string): void {
    for (const args of [
        ['git', 'init', '-q'],
        ['git', 'config', 'user.email', 'test@spur.local'],
        ['git', 'config', 'user.name', 'spur test'],
    ]) {
        Bun.spawnSync(args, { cwd: dir });
    }
    // Seed a tracked file under the corpus path so untracked corpus files are
    // listed individually — git collapses a fully-untracked directory into one
    // `?? docs/tasks4/` row, which would not name the file.
    mkdirSync(join(dir, 'docs', 'tasks4'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'tasks4', '.gitkeep'), '');
    Bun.spawnSync(['git', 'add', '.'], { cwd: dir });
    Bun.spawnSync(['git', 'commit', '-qm', 'init'], { cwd: dir });
}

function runShell(command: string, cwd: string, env: Record<string, string>): { exitCode: number; output: string } {
    const result = Bun.spawnSync(['sh', '-c', command], {
        cwd,
        env: { ...getEnvVars(), deferFeatureSync: 'false', ...env },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return {
        exitCode: result.exitCode,
        output: `${result.stdout.toString()}${result.stderr.toString()}`,
    };
}

describe('0503 task-pipeline resilience', () => {
    test('0777 mutation policy stops classification-only remediation before dispatch or source edits', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-mutation-policy-'));
        try {
            writeFileSync(join(dir, 'source.ts'), 'unchanged');
            const spurBin = executable(
                dir,
                'spur',
                'printf \'%s\\n\' \'{"content":"mutationPolicy: none\\n","frontmatter":{}}\'',
            );
            const action = commandFor('remediate');
            const result = runShell(action, dir, { spurBin, wbs: '0773', mutationPolicy: 'code' });
            expect(result.exitCode).not.toBe(0);
            expect(result.output).toContain('mutation policy');
            expect(readFileSync(join(dir, 'source.ts'), 'utf8')).toBe('unchanged');
            expect(PIPELINE.states.find((state) => state.id === 'remediate')?.onEnter?.[0]?.kind).toBe('shell');
            const allowed = executable(
                dir,
                'code-task',
                'printf \'%s\\n\' \'{"content":"ordinary task","frontmatter":{}}\'',
            );
            expect(runShell(action, dir, { spurBin: allowed, wbs: '0777', mutationPolicy: 'code' }).exitCode).toBe(0);
            expect(runShell(action, dir, { spurBin: allowed, wbs: '0777', mutationPolicy: 'none' }).exitCode).not.toBe(
                0,
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('precheck remains deterministic, doctor-free, and count-only (0723)', () => {
        const precheck = PIPELINE.states.find((state) => state.id === 'precheck');
        const commands = precheck?.onEnter?.map((action) => action.options?.command ?? '') ?? [];

        // 0723's doctor-free clause is superseded in a bounded way by 0894 R1: exactly ONE
        // soft role-resolution probe is allowed at precheck (roles coder+reviewer, resultFile
        // run-scoped, never aborting the run). Any other doctor.probe, and any `agent doctor`
        // shell invocation, stays forbidden — per-stage detection remains doctor-free.
        const probes = (precheck?.onEnter ?? []).filter((action) => action.kind === 'doctor.probe');
        expect(probes).toHaveLength(1);
        const probe = probes[0]?.options as { roles?: Record<string, string>; resultFile?: string } | undefined;
        expect(Object.keys(probe?.roles ?? {}).sort()).toEqual(['coder', 'reviewer']);
        expect(probe?.resultFile).toContain('.spur/run/');
        expect(commands.join('\n')).not.toContain('agent doctor');
        // 1002 R4: the size/evidence prechecks fold into the precheck→implement guard as one
        // `task check --precheck` call — no script invocation and no status-file reads remain.
        expect(commands.join('\n')).not.toContain('precheck-size');
        expect(commands.join('\n')).not.toContain('precheck-evidence');
        // Feature reactivation surfaces failure instead of swallowing it (no `|| true`).
        expect(commandFor('precheck', 1)).not.toContain('|| true');
    });

    // 1213: the 0960 run-start script-root probe is retired — no precheck shell may resolve or
    // execute plugins/sp/scripts machinery (run-start identity is now owned by the driver +
    // `spur workflow` itself); the base-sha capture and dirty-tree advisory remain.
    test('precheck carries no retired script probes and keeps its base-sha capture (1213)', () => {
        const commands = shellCommands('precheck');
        expect(commands.length).toBeGreaterThanOrEqual(2);
        for (const command of commands) {
            expect(command).not.toContain('script-root');
            expect(command).not.toContain('superskill script path');
            expect(command).not.toContain('plugins/sp/scripts');
        }
        expect(commands.some((c) => c.includes('-base.sha'))).toBe(true);
    });

    test('auto feature reactivation: single-shot on success, blocking on real failure (0723 R3)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0723-featsync-'));
        try {
            const calls = join(dir, 'sync-calls');
            const spur = executable(
                dir,
                'spur-fake',
                `case "$1:$2" in
  task:show) printf '%s\n' '{"feature_id":"F9"}' ;;
  feature:sync) echo x >> "${calls}"; exit "\${SYNC_RC:-0}" ;;
  feature:update) echo y >> "${calls}"; exit "\${UPDATE_RC:-0}" ;;
esac`,
            );
            const command = commandFor('precheck', 1);

            // Green path: one sync call, exit 0.
            const ok = runShell(command, dir, { profile: 'auto', wbs: '0723', spurBin: spur });
            expect(ok.exitCode).toBe(0);
            expect(readFileSync(calls, 'utf8').split('\n').filter(Boolean)).toEqual(['x']);

            // Sync fails, update rescue succeeds: still exit 0 (one sync + one update).
            const rescued = runShell(command, dir, {
                profile: 'auto',
                wbs: '0723',
                spurBin: spur,
                SYNC_RC: '1',
            });
            expect(rescued.exitCode).toBe(0);
            expect(readFileSync(calls, 'utf8').split('\n').filter(Boolean)).toEqual(['x', 'x', 'y']);

            // Both fail: the reactivation failure surfaces and blocks implementation.
            const blocked = runShell(command, dir, {
                profile: 'auto',
                wbs: '0723',
                spurBin: spur,
                SYNC_RC: '1',
                UPDATE_RC: '1',
            });
            expect(blocked.exitCode).not.toBe(0);
            expect(blocked.output).toContain('feature reactivation');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    // 0823 (c): the implement and close transitions are `command.gate` actions — the
    // classified transient retry (once, 2s delay, ENOENT/EBUSY/ENOTEMPTY + lock forms) lives
    // in the gate; retry behavior is covered by plugins/sp/tests/command-gate.test.ts.
    // D65 1239: the `record` state's transitions moved into `done`'s onEnter, so the verb
    // shapes are asserted there under their new ids.
    test('lifecycle transitions are command.gate actions with the classified transient retry (0823 c)', () => {
        const gateOf = (stateId: string, id?: string): Record<string, unknown> => {
            const gates = (PIPELINE.states.find((state) => state.id === stateId)?.onEnter ?? []).filter(
                (a) => a.kind === 'command.gate',
            );
            const action = id === undefined ? gates[0] : gates.find((a) => (a.options as { id?: string })?.id === id);
            expect(action).toBeDefined();
            return (action?.options ?? {}) as Record<string, unknown>;
        };
        for (const options of [
            gateOf('implement'),
            gateOf('done', 'task-record-close'),
            gateOf('done', 'task-done-transition'),
        ]) {
            expect(options.executable).toBe(`\${vars.spurBin}`); // escaped template: literal YAML text, not interpolation
            expect(options.softFail).toBe(false);
            const retry = options.retry as Record<string, unknown>;
            expect(retry.maxAttempts).toBe(2);
            expect(retry.delayMs).toBe(2000);
            for (const cls of ['sqlite-busy', 'ENOENT', 'EBUSY', 'ENOTEMPTY']) {
                expect(retry.on).toContain(cls);
            }
            expect(String(options.resultFile)).toContain(`.spur/run/\${vars.__runId}-`);
            expect(String(options.resultFile).endsWith('.status')).toBe(true);
        }
        const argsOf = (stateId: string, id: string): string => JSON.stringify(gateOf(stateId, id).args);
        expect(argsOf('implement', 'task-implement-transition')).toContain('--no-lifecycle');
        const recordArgs = argsOf('done', 'task-record-close');
        expect(recordArgs).toContain('--solution-from-diff');
        expect(recordArgs).toContain('testing');
        // 0980: the record stage's transition must not spawn a nested task-lifecycle run.
        expect(recordArgs).toContain('--no-lifecycle');
        expect(argsOf('done', 'task-done-transition')).toContain('--no-lifecycle');
    });

    // 0823 (d) → D65 1239 R2: the gate is ONE state and ONE typed `command.gate` over
    // `spur task gate`, which owns the tier, probe, findings cap, host-wide lock and the
    // tree-keyed receipt (behavioral coverage lives in
    // packages/app/tests/services/quality-gate*.test.ts and
    // packages/app/tests/workflow/actions/command-gate.test.ts). Here: the dispatch, the
    // mode-by-visit contract, and the fail-closed routing.
    test('the gate dispatches `spur task gate` as a typed command.gate and fails closed', () => {
        const gate = PIPELINE.states.find((state) => state.id === 'gate');
        const dispatches = (gate?.onEnter ?? []).filter((action) => action.kind === 'command.gate');
        expect(dispatches).toHaveLength(1);
        const options = (dispatches[0]?.options ?? {}) as Record<string, unknown>;
        expect(JSON.stringify(options.args)).toContain('"task","gate"');
        // 1111: the mode is selected per visit and projected into gateMode, so the opt-in
        // deferred tier needs no second dispatch line.
        expect(JSON.stringify(options.args)).toContain(['$' + '{vars.', 'gateMode', '}'].join(''));
        expect(PIPELINE.vars?.gateMode).toBe('');
        const shells = shellCommands('gate').join('\n');
        expect(shells).toContain('M=run');
        expect(shells).toContain('M=recheck');
        expect(shells).not.toContain('script-root.json');
        expect(shells).not.toContain('superskill script path');
        // Fail closed on a gate that could not decide: the typed outcome is BLOCKED (exit 2,
        // usage/lock) and only the typed PASS plus the verb's own full-tier token reaches
        // review — a blocked or crashed visit can never read as green.
        expect(options.softFail).toBe(true);
        expect(String(options.resultFile)).toContain('-gate.status');
        const toReview = (PIPELINE.transitions ?? []).filter((t) => t.from === 'gate' && t.to === 'review');
        for (const transition of toReview) {
            expect(transition.guard?.options?.command).toContain('-gate.status');
            expect(transition.guard?.options?.command).toContain('-test-gate.status');
        }
        const blocked = (PIPELINE.transitions ?? []).find((t) => t.from === 'gate' && t.to === 'failed');
        expect(blocked?.guard?.options?.command).toContain('= BLOCKED');
        // No shell may write the verb's own status token — the gate owns it (a shell-side
        // FAIL/PASS write would be a second opinion the transitions could read).
        expect(shells).not.toContain('test-gate.status');
        // The retired dispatch loop is gone: no inline classifier or gate command remains.
        expect(shells).not.toContain('qualityGateCmd');
        expect(shells).not.toContain('grep -Eq');
    });

    test('a gate that cannot run is a BLOCKED typed outcome, never a green review', () => {
        // The old shell wrote `FAIL` when spur could not launch the gate. That job is now split:
        // `command.gate` classifies the exit (0 → PASS, 1 → FAIL, anything else → BLOCKED) and
        // the graph routes BLOCKED to `failed`. Assert the routing the run actually takes, and
        // that neither artefact the PASS edge reads can be written without the gate running.
        const toReview = (PIPELINE.transitions ?? []).find(
            (t) => t.from === 'gate' && t.to === 'review' && t.guard?.options?.command?.includes('= PASS') === true,
        );
        expect(toReview).toBeDefined();
        // The BLOCKED edge is declared BEFORE the failure-class/cap edges, so an undecidable
        // gate can never be mislabeled as a red gate and sent into remediation.
        const transitions = PIPELINE.transitions ?? [];
        const idx = (predicate: (t: PipelineTransition) => boolean): number => transitions.findIndex(predicate);
        const blockedIdx = idx(
            (t) => t.from === 'gate' && t.to === 'failed' && t.guard?.options?.command?.includes('= BLOCKED') === true,
        );
        const failClassIdx = idx((t) => t.from === 'gate' && t.to === 'remediate');
        expect(blockedIdx).toBeGreaterThan(-1);
        expect(blockedIdx).toBeLessThan(failClassIdx);
        // The verb still writes the token the transitions read (`PASS|FAIL|DEFERRED`), so a gate
        // that never ran leaves no token at all — the last gate edge is the fail-closed defence.
        const gateEdges = transitions.filter((t) => t.from === 'gate');
        const defense = gateEdges[gateEdges.length - 1];
        expect(defense?.guard?.kind).toBe('always');
        expect(defense?.to).toBe('failed');
    });
    test('precheck dirty-tree action names task-corpus dirt without the non-corpus warning', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0511-corpus-dirty-'));
        initGitRepo(dir);
        writeFileSync(join(dir, 'docs', 'tasks4', 'uncommitted.md'), 'corpus edit');
        const command = commandFor('precheck', 0);
        const result = runShell(command, dir, {});

        expect(result.exitCode).toBe(0);
        expect(result.output).toContain('precheck: NOTE - task corpus has uncommitted changes');
        expect(result.output).toContain('?? docs/tasks4/uncommitted.md');
        expect(result.output).not.toContain('precheck: WARNING');
    });

    test('precheck dirty-tree action stays quiet on a clean task corpus', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0511-corpus-clean-'));
        initGitRepo(dir);
        const command = commandFor('precheck', 0);
        const result = runShell(command, dir, {});

        expect(result.exitCode).toBe(0);
        expect(result.output).not.toContain('precheck: NOTE');
        expect(result.output).not.toContain('precheck: WARNING');
    });

    // 0772 R1 (behavior moved into the gate core, 0823 d / PR-3): the bounded-summary contract —
    // green gates print a one-line status, red gates print at most the last 40 lines, and the
    // durable log keeps everything — is asserted in packages/app/tests/services/quality-gate.test.ts.

    function shellCommands(stateId: string): string[] {
        return (
            PIPELINE.states
                .find((state) => state.id === stateId)
                ?.onEnter?.filter((action) => action.kind === 'shell')
                .map((action) => action.options?.command ?? '') ?? []
        );
    }

    test('precheck captures base.sha only when absent (F96 R1 resume-safe)', () => {
        const cmd = shellCommands('precheck').find((c) => c.includes('-base.sha'));
        expect(cmd).toBeDefined();
        expect(cmd).toContain('rev-parse HEAD');
        expect(cmd).toMatch(/\[ -f "?\.spur\/run\/\$wbs-base\.sha"? \] \|\|/);
    });

    // D65 1239: `verify` merged into `review`, which derives its verdict from the reviewer's own
    // traceability.
    test('the verdict is derived from the reviewer answer (0983 R1)', () => {
        const cmds = shellCommands('review');
        const verdictGate = (PIPELINE.states.find((s) => s.id === 'review')?.onEnter ?? []).find(
            (a) => a.kind === 'command.gate' && (a.options as { id?: string })?.id === 'review-verdict',
        );
        const verdictArgs = JSON.stringify((verdictGate?.options as { args?: string[] })?.args ?? []);
        expect(verdictArgs).toContain('"verdict"');
        expect(verdictArgs).toContain('--from-answer');
        // The answer file the agent.run captured is the verdict input — the certification is the
        // reviewer's own evidence, not a re-captured digest. Since the G74 batch (2026-10-24) the
        // verdict reads the cert file the reviewer WRITES, which the pre-verdict shell seeds from
        // that same captured answer when the agent did not write one.
        const dispatch = (PIPELINE.states.find((s) => s.id === 'review')?.onEnter ?? []).find(
            (a) => a.kind === 'agent.run',
        );
        const answerFile = String((dispatch?.options as { answerFile?: string })?.answerFile ?? '');
        expect(answerFile).toContain('-review-answer.txt');
        expect(verdictArgs).toContain('-review-cert.md');
        expect(cmds.some((c) => c.includes('review-answer.txt') && c.includes('review-cert.md'))).toBe(true);
        expect(cmds.find((c) => c.includes('+ {proof:'))).toBeUndefined();
    });

    test('deferFeatureSync "true" skips the record-step feature sync and notes the deferral (0931 R5)', () => {
        expect(PIPELINE.vars?.deferFeatureSync).toBe('false');

        const sync = shellCommands('done').find((c) => c.includes('feature sync')) ?? '';
        expect(sync).toContain('[ "$deferFeatureSync" = "true" ]');
        expect(sync).toContain('feature sync deferred to batch integration');
        expect(sync).toContain('$spurBin feature sync "$FID" --json');
        // 1004 R4: no helper-script resolution — the shell is self-contained.
        expect(sync).not.toContain('-feature-sync');

        // Behavioral: with deferFeatureSync=true the (canary) spurBin is never invoked.
        const dir = mkdtempSync(join(tmpdir(), 'spur-0931-defer-'));
        try {
            mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
            const spurBin = executable(dir, 'spur-bin-canary', 'echo "CANARY INVOKED" >&2; exit 42');
            const result = runShell(sync, dir, {
                deferFeatureSync: 'true',
                wbs: '0931',
                spurBin,
            });

            expect(result.exitCode).toBe(0);
            expect(result.output).not.toContain('CANARY INVOKED');
            const report = readFileSync(join(dir, '.spur', 'run', '0931-report.txt'), 'utf8');
            expect(report).toContain('feature sync deferred to batch integration');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('deferFeatureSync default runs the bare feature sync for the linked feature (1004 R4)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0931-default-'));
        try {
            mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
            // Canary: `task show` yields a top-level feature_id -> the shell syncs it.
            const spurBin = executable(
                dir,
                'spur-bin-empty',
                'if [ "$1" = "task" ]; then echo \'{"feature_id":"F1"}\'; else echo "SYNC $*"; fi',
            );
            const result = runShell(shellCommands('done').find((c) => c.includes('feature sync')) ?? '', dir, {
                wbs: '0931',
                spurBin,
            });

            expect(result.exitCode).toBe(0);
            expect(result.output).not.toContain('deferred');
            expect(result.output).toContain('SYNC feature sync F1 --json');
            const reportPath = join(dir, '.spur', 'run', '0931-report.txt');
            if (existsSync(reportPath)) {
                expect(readFileSync(reportPath, 'utf8')).not.toContain('Orphan task 0931');
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('record-step sync reads a frontmatter feature_id and notes an orphan task (1004 R4)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-1004-sync-'));
        try {
            mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
            // Frontmatter-shaped feature_id (task show --json envelope).
            const linked = executable(
                dir,
                'spur-bin-linked',
                'if [ "$1" = "task" ]; then echo \'{"frontmatter":{"feature_id":"F9"}}\'; else echo "SYNC $*"; fi',
            );
            const sync = shellCommands('done').find((c) => c.includes('feature sync')) ?? '';
            const linkedRun = runShell(sync, dir, { wbs: '1004', spurBin: linked });
            expect(linkedRun.exitCode).toBe(0);
            expect(linkedRun.output).toContain('SYNC feature sync F9 --json');

            // No feature_id anywhere -> orphan proposal note, best-effort exit 0.
            const orphan = executable(dir, 'spur-bin-orphan', "echo '{}'");
            const orphanRun = runShell(sync, dir, { wbs: '1004', spurBin: orphan });
            expect(orphanRun.exitCode).toBe(0);
            const report = readFileSync(join(dir, '.spur', 'run', '1004-report.txt'), 'utf8');
            expect(report).toContain('Orphan task 1004 — no feature_id linked');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

// ---------------------------------------------------------------------------
// 0933 — operator-question escalation (implement → escalate → implement)
// ---------------------------------------------------------------------------

describe('0933 operator-question escalation', () => {
    const guardFor = (from: string, to: string): PipelineTransition['guard'] =>
        PIPELINE.transitions?.find((t) => t.from === from && t.to === to)?.guard;
    // Workflow template syntax, not a JS template literal — built by concatenation so the source
    // doesn't contain a `${` that Biome's noTemplateCurlyInString would (correctly) flag
    // (mirrors packages/app/tests/workflow/builtins.test.ts).
    const tpl = (name: string): string => ['$' + '{vars.', name, '}'].join('');

    test('escalate state: bounded counter, question surfacing, and hitl.input pause', () => {
        const escalate = PIPELINE.states.find((s) => s.id === 'escalate');
        expect(escalate).toBeDefined();
        const kinds = escalate?.onEnter?.map((a) => a.kind) ?? [];
        // Counter first, then the question read, then the pause.
        expect(kinds).toEqual(['shell', 'file.read.into-var', 'hitl.input']);
        const counter = commandFor('escalate', 0);
        expect(counter).toContain('.spur/run/$wbs-escalation-count');
        const read = escalate?.onEnter?.find((a) => a.kind === 'file.read.into-var');
        expect(read?.options?.file).toBe(`.spur/run/${tpl('wbs')}-question.md`);
        expect(read?.options?.var).toBe('escalationQuestion');
        const pause = escalate?.onEnter?.find((a) => a.kind === 'hitl.input');
        expect(pause?.options?.prompt).toBe(tpl('escalationQuestion'));
    });

    test('escalation edges are declared before the implement→gate always edge (bound first, then question)', () => {
        const transitions = PIPELINE.transitions ?? [];
        const idx = (from: string, to: string): number => {
            const i = transitions.findIndex((t) => t.from === from && t.to === to);
            if (i < 0) throw new Error(`missing transition ${from}→${to}`);
            return i;
        };
        const bound = idx('implement', 'failed');
        const ask = idx('implement', 'escalate');
        const body = idx('implement', 'gate');
        expect(bound).toBeLessThan(ask);
        expect(ask).toBeLessThan(body);
        // Bound guard requires the escalation count AND a fresh question file; the report
        // note lives in the failed state's onEnter (guards stay thin, ADR-115).
        const boundCmd = guardFor('implement', 'failed')?.options?.command ?? '';
        expect(boundCmd).toContain('-ge "$maxEscalations"');
        expect(boundCmd).toContain('-s .spur/run/$wbs-question.md');
        expect(boundCmd).not.toContain('$wbs-report.md');
        expect(guardFor('implement', 'escalate')?.options?.command).toContain('test -s .spur/run/$wbs-question.md');
        // The Q/A transcript append + question consumption live in implement's onEnter
        // first action, not in the escalate→implement guard.
        const implement = PIPELINE.states.find((s) => s.id === 'implement');
        const append = implement?.onEnter?.[0];
        expect(append?.kind).toBe('shell');
        const appendCmd = append?.options?.command ?? '';
        expect(appendCmd).toContain('.spur/run/$wbs-escalation.md');
        expect(appendCmd).toContain('rm -f .spur/run/$wbs-question.md');
        // The bound note is a conditional shell in the failed state's onEnter.
        expect(commandFor('failed', 0) ?? '').toContain('Escalation bound reached');
    });

    test('escalate routing: answered → implement; empty → failed (guards stay thin predicates)', () => {
        const resume = guardFor('escalate', 'implement')?.options?.command ?? '';
        expect(resume).toContain('test -n "$__hitlInput"');
        // Appending/consuming is implement onEnter's job, not the guard's.
        expect(resume).not.toContain('.spur/run/$wbs-escalation.md');
        expect(guardFor('escalate', 'failed')?.options?.command).toContain('test -z "$__hitlInput"');
    });

    test('implement agent.run declares the escalation contract and names the transcript in its input', () => {
        const implement = PIPELINE.states.find((s) => s.id === 'implement');
        const agentRun = implement?.onEnter?.find((a) => a.kind === 'agent.run');
        // The agent.run option names the QUESTION file (the pause signal, deleted
        // pre-dispatch for freshness); the transcript reaches the agent via --escalation-file.
        expect(agentRun?.options?.escalationFile).toBe(`.spur/run/${tpl('wbs')}-question.md`);
        const input = String((agentRun?.options as Record<string, unknown> | undefined)?.input ?? '');
        expect(input).toContain(`--escalation-file .spur/run/${tpl('wbs')}-escalation.md`);
        expect(PIPELINE.vars?.maxEscalations).toBe('2');
    });

    test('bound guard routes at bound + fresh question; the failed onEnter writes the report note', () => {
        const dir = mkdtempSync(join(tmpdir(), 'pipeline-esc-bound-'));
        try {
            mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
            const cmd = guardFor('implement', 'failed')?.options?.command ?? '';
            // Under bound with a fresh question → not a bound failure.
            writeFileSync(join(dir, '.spur/run/0933-escalation-count'), '1');
            writeFileSync(join(dir, '.spur/run/0933-question.md'), 'Q3: again?');
            expect(runShell(cmd, dir, { wbs: '0933', maxEscalations: '2' }).exitCode).toBe(1);
            // At bound but NO fresh question (completed implement) → not a bound failure.
            writeFileSync(join(dir, '.spur/run/0933-escalation-count'), '2');
            rmSync(join(dir, '.spur/run/0933-question.md'));
            expect(runShell(cmd, dir, { wbs: '0933', maxEscalations: '2' }).exitCode).toBe(1);
            // At bound WITH a fresh question → routes to failed (guard is a pure predicate).
            writeFileSync(join(dir, '.spur/run/0933-question.md'), 'Q3: again?');
            expect(runShell(cmd, dir, { wbs: '0933', maxEscalations: '2' }).exitCode).toBe(0);
            // The failed state's onEnter writes the report note (no-op on ordinary failures).
            // R2: the note lands in the task report (report.txt) and carries the question.
            const note = commandFor('failed', 0);
            expect(runShell(note, dir, { wbs: '0933', maxEscalations: '2' }).exitCode).toBe(0);
            const report = readFileSync(join(dir, '.spur/run/0933-report.txt'), 'utf8');
            expect(report).toContain('Escalation bound reached');
            expect(report).toContain('Q3: again?');
            // Ordinary failure (no pending question) → note stays a no-op.
            const plain = mkdtempSync(join(tmpdir(), 'pipeline-esc-plain-'));
            try {
                mkdirSync(join(plain, '.spur', 'run'), { recursive: true });
                runShell(note, plain, { wbs: '0933', maxEscalations: '2' });
                expect(existsSync(join(plain, '.spur/run/0933-report.txt'))).toBe(false);
            } finally {
                rmSync(plain, { recursive: true, force: true });
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('implement onEnter records the Q/A transcript and consumes the question on a resume entry', () => {
        const dir = mkdtempSync(join(tmpdir(), 'pipeline-esc-resume-'));
        try {
            mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
            // First entry (no pending question, empty answer) → no-op, no transcript.
            const cmd = commandFor('implement', 0);
            expect(runShell(cmd, dir, { wbs: '0933', __hitlInput: '' }).exitCode).toBe(0);
            expect(existsSync(join(dir, '.spur/run/0933-escalation.md'))).toBe(false);
            // Resume entry → guard already passed (non-empty answer + fresh question);
            // onEnter appends Q1/A1 and consumes the question file.
            writeFileSync(join(dir, '.spur/run/0933-question.md'), 'which auth scheme?');
            writeFileSync(join(dir, '.spur/run/0933-escalation-count'), '1');
            expect(guardFor('escalate', 'implement')?.options?.command).toContain('test -n "$__hitlInput"');
            expect(runShell(cmd, dir, { wbs: '0933', __hitlInput: 'oauth2 device flow' }).exitCode).toBe(0);
            const transcript = readFileSync(join(dir, '.spur/run/0933-escalation.md'), 'utf8');
            expect(transcript).toContain('## Q1');
            expect(transcript).toContain('which auth scheme?');
            expect(transcript).toContain('## A1');
            expect(transcript).toContain('oauth2 device flow');
            expect(existsSync(join(dir, '.spur/run/0933-question.md'))).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
