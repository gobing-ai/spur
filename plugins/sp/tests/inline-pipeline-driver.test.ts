import { describe, expect, test } from 'bun:test';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { getEnvVars } from '@gobing-ai/ts-utils';
import { parse } from 'yaml';

interface ActionOptions {
    id?: string;
    args?: string[];
    executable?: string;
    command?: string;
    input?: string;
    answerFile?: string;
    expectFile?: string;
    path?: string;
    var?: string;
    message?: string;
    requireDiff?: boolean;
    softFail?: boolean;
    // Keys of the engine-internal action kinds this smoke harness simulates:
    // decide (0943/0941), doctor.probe (0608), command.gate (1234).
    resultFile?: string;
    default?: string;
    // Catalog-reference decide (1115).
    decision?: string;
}

interface PipelineAction {
    kind: string;
    options?: ActionOptions;
}

interface PipelineState {
    id: string;
    onEnter?: PipelineAction[];
}

interface PipelineTransition {
    from: string;
    to: string;
    guard: { kind: string; options?: { command?: string } };
}

interface PipelineDefinition {
    iterationBound: number;
    initialState: string;
    terminalStates: string[];
    vars: Record<string, string>;
    states: PipelineState[];
    transitions: PipelineTransition[];
}

interface SmokeResult {
    terminal: string;
    hostStages: string[];
    log: string;
    runLink: string;
}

const ROOT = join(import.meta.dir, '..', '..', '..');
const PIPELINE = parse(
    readFileSync(join(ROOT, 'config', 'workflows', 'task-pipeline.yaml'), 'utf8'),
) as PipelineDefinition;

test('inline record guidance suppresses nested task lifecycle runs like the workflow', () => {
    const driver = readFileSync(join(ROOT, 'plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md'), 'utf8');
    expect(driver).toContain('spur task record <wbs> --solution-from-diff --transition testing --no-lifecycle');
    // D65 1239: the record write lives in `done`'s onEnter (the `record` state is gone).
    const done = PIPELINE.states.find((state) => state.id === 'done');
    const transition = done?.onEnter?.find(
        (action) => action.kind === 'command.gate' && action.options?.id === 'task-record-close',
    );
    expect(transition?.options?.args).toContain('--no-lifecycle');
});

// Catalog fallbacks (task 1115): the smoke's decide simulation writes the decisionMaker-off
// degraded row, whose value is the INLINE default pre-migration and the catalog `fallback`
// after — read it from the shipped catalog instead of duplicating it here.
const DECISIONS_CATALOG = parse(readFileSync(join(ROOT, 'config', 'decisions', 'task-pipeline.yaml'), 'utf8')) as {
    decisions: Record<string, { fallback: string }>;
};

function expand(value: string, vars: Record<string, string>): string {
    return value.replace(/\$\{vars\.([A-Za-z0-9_]+)\}/g, (_match, key: string) => vars[key] ?? '');
}

function runShell(command: string, cwd: string, env: Record<string, string>): number {
    const result = Bun.spawnSync(['sh', '-c', command], {
        cwd,
        env: { ...getEnvVars(), ...env },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return result.exitCode;
}

function makeFakeSpur(dir: string): string {
    const path = join(dir, 'spur-fake');
    writeFileSync(
        path,
        `#!/bin/sh
case "$1:$2" in
  agent:doctor)
    printf '%s\n' '{"agents":[{"authenticated":"unknown","modelStatus":{"detail":"no probe registered"}}]}' ;;
  task:run-link)
    mkdir -p .spur/run
    printf '{"source":"inline-full","runId":"%s"}\n' "$7" > ".spur/run/$3-run-link.json" ;;
  task:check)
    n=$(cat "$CHECK_COUNTER" 2>/dev/null || echo 0); n=$((n + 1)); printf '%s\n' "$n" > "$CHECK_COUNTER"
    if [ -n "$FAIL_CHECK_AT" ] && [ "$n" -ge "$FAIL_CHECK_AT" ]; then exit 1; fi ;;
  task:verdict)
    mkdir -p .spur/run
    printf '{"wbs":"%s","verdict":"%s","confidence":"%s","requirements":[],"checks":[]}\n' "$3" "\${VERDICT:-PASS}" "\${CONFIDENCE:-HIGH}" > ".spur/run/$3-verdict.json"
    [ "\${VERDICT:-PASS}" = PASS ] || exit 1 ;;
  task:show)
    printf '%s\n' '{"content":"ordinary implementation task","frontmatter":{"feature_id":null}}' ;;
  task:path)
    # 0751 R2: the fail-closed task lookup needs a resolvable spec. FIXTURE_TASK_SPEC
    # is seeded by runInlineSmoke; unset -> empty path -> the pipeline step must fail.
    printf '{"path":"%s"}\n' "$FIXTURE_TASK_SPEC" ;;
  task:update)
    [ "$4" = done ] && [ -n "$FAIL_DONE_TRANSITION" ] && exit 1; exit 0 ;;
  task:record)
    exit 0 ;;
esac
exit 0
`,
    );
    chmodSync(path, 0o755);
    return path;
}

function resolveSessionId(cwd: string): string {
    const raw = JSON.parse(readFileSync(join(cwd, '.spur/context/.session.json'), 'utf8')) as {
        session?: unknown;
        session_id?: unknown;
    };
    if (typeof raw.session === 'string' && raw.session !== '') return raw.session;
    if (typeof raw.session_id === 'string' && raw.session_id !== '') return raw.session_id;
    throw new Error('fixture session id missing');
}

// 0727 R3: the driver contract requires every hand-appended run-log line to carry an
// ISO-8601 UTC stamp prefix — bare local-clock forms are prohibited.
const isoStamp = (): string => `${new Date().toISOString()} `;

// 0785 R2/R3 → D65 1239: the smoke runs the real graph without the engine's built-ins. The
// proof digest it used to simulate is retired (ADR-140); the evidence the graph now reads is the
// gate's typed outcome (`.spur/run/<runId>-gate.status`) and the review verdict artifact
// (`.spur/run/<wbs>-verdict.json`), both produced by the stubs below.

function runInlineSmoke(
    options: {
        verdict?: 'PASS' | 'FAIL';
        failCheckAt?: number;
        unresolvableTask?: boolean;
        failDoneTransition?: boolean;
    } = {},
): SmokeResult {
    const cwd = mkdtempSync(join(tmpdir(), 'spur-0503-inline-'));
    mkdirSync(join(cwd, '.spur/context'), { recursive: true });
    writeFileSync(join(cwd, '.spur/context/.session.json'), '{"session_id":"codex-fixture-session"}\n');
    // 0751 R2: the task-path lookup is fail-closed, so the smoke must seed a resolvable
    // task spec (frontmatter mirrors a real task file, incl. the `priority:` line the
    // lookup extracts). `unresolvableTask` opts out to exercise the fail-closed path.
    const taskSpecPath = 'fixture-0503-task.md';
    if (options.unresolvableTask !== true) {
        writeFileSync(
            join(cwd, taskSpecPath),
            '---\nschema_version: 1\nwbs: fixture-0503\ntitle: "0503 inline smoke fixture task"\npriority: P1\n---\n# fixture task spec\n',
        );
    }
    const spurBin = makeFakeSpur(cwd);
    const runId = 'inline-smoke-run';
    const vars: Record<string, string> = {
        ...PIPELINE.vars,
        wbs: 'fixture-0503',
        profile: 'auto',
        spurBin,
        formatCmd: 'true',
        qualityGateCmd: 'true',
        // The real driver injects the run id on the __runId seam (workflow-service) and every
        // run-scoped artifact (review answer, proof digest) resolves through it.
        __runId: runId,
    };
    const env: Record<string, string> = {
        ...vars,
        CHECK_COUNTER: join(cwd, 'check-counter'),
        VERDICT: options.verdict ?? 'PASS',
        FAIL_CHECK_AT: options.failCheckAt === undefined ? '' : String(options.failCheckAt),
        FAIL_DONE_TRANSITION: options.failDoneTransition === true ? '1' : '',
        FIXTURE_TASK_SPEC: options.unresolvableTask === true ? '' : taskSpecPath,
    };
    // The driver doc (task 0927) appends host provenance lines to the run-record markdown.
    const logPath = join(cwd, `.spur/run/${runId}.md`);
    mkdirSync(dirname(logPath), { recursive: true });
    const sessionId = resolveSessionId(cwd);
    // The driver doc's run-link step creates the run's provenance record.
    expect(
        runShell('$spurBin task run-link "$wbs" --source inline-full --run-id "$RUN_ID" --json', cwd, {
            ...env,
            RUN_ID: runId,
        }),
    ).toBe(0);

    let current = PIPELINE.initialState;
    const hostStages: string[] = [];
    let hardFailure = false;
    for (let iteration = 0; iteration < PIPELINE.iterationBound; iteration += 1) {
        const state = PIPELINE.states.find((candidate) => candidate.id === current);
        if (state === undefined) throw new Error(`unknown state ${current}`);

        for (const action of state.onEnter ?? []) {
            if (action.kind === 'agent.run') {
                expect(action.options?.input).toBeDefined();
                hostStages.push(state.id);
                if (action.options?.requireDiff === true)
                    writeFileSync(join(cwd, 'implementation.diff'), 'fixture diff\n');
                // 0726 R3: verify switched from host-captured answerFile to verifier-owned
                // expectFile — the harness still materializes the file either way.
                const answerSpec = action.options?.answerFile ?? action.options?.expectFile;
                if (answerSpec !== undefined) {
                    const answerPath = join(cwd, expand(answerSpec, vars));
                    mkdirSync(dirname(answerPath), { recursive: true });
                    // Only `verify` carries the verdict under test; every other stage answers PASS,
                    // because the review routing reads `Verdict: PASS` from the reviewer's own
                    // answer (session finding after 1088) and a non-PASS review would divert the
                    // run before verify ever runs.
                    const stageVerdict = state.id === 'verify' ? (options.verdict ?? 'PASS') : 'PASS';
                    writeFileSync(answerPath, `Verdict: ${stageVerdict}\n`);
                }
                appendFileSync(logPath, `${isoStamp()}stage ${state.id} executed inline in session ${sessionId}\n`);
                continue;
            }
            if (action.kind === 'note') {
                appendFileSync(logPath, `${isoStamp()}${expand(action.options?.message ?? '', vars)}\n`);
                continue;
            }
            if (action.kind === 'file.read.into-var') {
                const key = action.options?.var;
                const path = action.options?.path;
                if (key !== undefined && path !== undefined)
                    vars[key] = readFileSync(join(cwd, expand(path, vars)), 'utf8');
                continue;
            }
            if (action.kind === 'hitl.confirm') {
                // 1236 / D65 1239 R10: a decision point, not a pause. Under `profile=auto` the
                // declared binding answers: with no maker configured the answer is `deferred` and
                // `__hitlAnswer` stays empty, which the review's approval fold reads as "no
                // objection". Nothing blocks, and no operator prompt is emitted.
                vars.approvalStatus = 'deferred';
                env.approvalStatus = 'deferred';
                continue;
            }
            if (action.kind === 'doctor.probe') {
                // doctor.probe built-in (task 0608 / D6): the smoke harness simulates the
                // probe outcome instead of importing the app runner — the fake spur's
                // `agent doctor` returns auth=unknown, which the built-in classifies as
                // PASS, so write PASS to the resolved resultFile.
                const resultFile = expand(action.options?.resultFile ?? '', vars);
                mkdirSync(dirname(join(cwd, resultFile)), { recursive: true });
                writeFileSync(join(cwd, resultFile), 'PASS\n');
                continue;
            }
            if (action.kind === 'decide') {
                // 0943/0941: the smoke simulates the decisionMaker-off contract — runDecide
                // always writes the schemaVersion-1 row with the degraded default value; the
                // driver script (`inline-run-setup --decide`) owns the real execution.
                // 1115: catalog-reference decide has no inline `default` — degrade to the
                // catalog fallback (config/decisions/task-pipeline.yaml).
                const resultFile = expand(action.options?.resultFile ?? '', vars);
                mkdirSync(dirname(join(cwd, resultFile)), { recursive: true });
                writeFileSync(
                    join(cwd, resultFile),
                    `${JSON.stringify({ schemaVersion: 1, value: action.options?.default ?? DECISIONS_CATALOG.decisions[action.options?.decision ?? '']?.fallback ?? '', degraded: true, reason: 'disabled' })}\n`,
                );
                continue;
            }
            if (action.kind === 'command.gate') {
                // 1234: the typed gate step. The real runner executes `executable` with `args` and
                // writes PASS | FAIL | BLOCKED to resultFile from the exit code alone; a
                // `softFail: false` step aborts the run on a non-zero exit. The two pipeline
                // gate ids wrap real verbs, so the smoke simulates each verb's contract instead
                // of spawning it (quality-gate.ts owns the gate; packages/app/tests own verdict).
                const resultFile = expand(action.options?.resultFile ?? '', vars);
                const executable = expand(action.options?.executable ?? '', vars);
                const args = (action.options?.args ?? []).map((arg) => expand(arg, vars));
                mkdirSync(dirname(join(cwd, resultFile)), { recursive: true });
                let exitCode: number;
                if (action.options?.id === 'quality-gate') {
                    // `spur task gate <wbs> <mode>`: a `run` visit resets the attempt counter and
                    // executes qualityGateCmd; a `recheck` visit probes first. Both always leave
                    // the gate's own status/findings/log for the transitions to read.
                    const mode = args[3] ?? '';
                    const finish =
                        'printf "%s\\n" "$s" > ".spur/run/$wbs-test-gate.status"; ' +
                        ': > ".spur/run/$wbs-test-gate.findings"; ' +
                        'printf "gate: %s\\n" "$s" > ".spur/run/$wbs-test-gate.log"';
                    const reset = mode === 'run' ? 'echo 0 > ".spur/run/$wbs-test-fix-attempt"; ' : '';
                    const body =
                        mode === 'recheck'
                            ? `${reset}if $gateProbeCmd; then s=PASS; else s=FAIL; fi; if [ "$s" = PASS ]; then if $qualityGateCmd; then s=PASS; else s=FAIL; fi; fi; ${finish}`
                            : `${reset}if $qualityGateCmd; then s=PASS; else s=FAIL; fi; ${finish}`;
                    expect(runShell(body, cwd, env), `quality-gate ${mode}`).toBe(0);
                    // The typed outcome must agree with the gate's own token so the PASS edge's
                    // two predicates never disagree in the smoke.
                    const gateToken = readFileSync(join(cwd, `.spur/run/${vars.wbs}-test-gate.status`), 'utf8').trim();
                    exitCode = gateToken === 'PASS' ? 0 : 1;
                } else {
                    exitCode = runShell(`"${executable}" ${args.join(' ')}`, cwd, env);
                }
                if (exitCode === 0) {
                    writeFileSync(join(cwd, resultFile), 'PASS\n');
                    continue;
                }
                writeFileSync(join(cwd, resultFile), exitCode === 1 ? 'FAIL\n' : 'BLOCKED\n');
                if (action.options?.softFail !== true) {
                    hardFailure = true;
                    break;
                }
                continue;
            }
            if (action.kind === 'shell') {
                let command = expand(action.options?.command ?? '', vars);
                // 1002 R4: the precheck→implement guard is `$spurBin task check $wbs --precheck`;
                // the fake spur handles `task check` (exit 0), so no status-file simulation remains.
                // 1132 R4: the guard first runs a repair pass (`task check $wbs --fix`), also
                // handled by the fake — it therefore consumes one CHECK_COUNTER slot.
                // D65 1239: the quality gate is no longer a shell — it is the `command.gate`
                // action simulated above, so no gate stub lives here anymore.
                // F96 (0950) / PR-3: the residual sweep is `spur task residual` like the gate — the
                // smoke simulates its clean-tree contract (empty residual list, soft terminal
                // actions); residual-scan-run.test.ts owns the sweep itself.
                // F96 (0950) / PR-3: the residual sweep is `spur task residual` like the gate — the
                // smoke simulates its clean-tree contract (empty residual list, soft terminal
                // actions); residual-scan-run.test.ts owns the sweep itself.
                if (command.includes('task residual "$wbs" fold')) {
                    command = 'mkdir -p .spur/run; printf "[]\\n" > ".spur/run/$wbs-residuals.json"';
                }
                if (
                    command.includes('task residual "$wbs" settle') ||
                    command.includes('task residual "$wbs" report')
                ) {
                    command = 'exit 0';
                }
                command = command.replaceAll('sleep 2', 'sleep 0').replaceAll('sleep 10', 'sleep 0');
                expect(runShell(command, cwd, env), `${state.id}: ${command}`).toBe(0);
            }
        }
        if (hardFailure) break;

        if (PIPELINE.terminalStates.includes(current)) break;
        const outgoing = PIPELINE.transitions.filter((transition) => transition.from === current);
        let next: string | undefined;
        for (const transition of outgoing) {
            const passed =
                transition.guard.kind === 'always' ||
                runShell(expand(transition.guard.options?.command ?? '', vars), cwd, env) === 0;
            if (passed) {
                next = transition.to;
                break;
            }
        }
        if (next === undefined) throw new Error(`no passing transition from ${current}`);
        current = next;
    }

    // A run that never dispatched a stage (precheck routed to `failed`) writes no run log.
    const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
    // 0727 R3: every appended line is ISO-8601 UTC-stamped; zero bare local-clock forms.
    const logLines = log.split('\n').filter((line) => line.length > 0);
    if (hostStages.length > 0) expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) {
        expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z /);
    }
    expect(logLines.filter((line) => /^\[[a-z-]+ [0-9]{1,2}:[0-9]{2}\]/.test(line))).toEqual([]);

    return {
        // A hard-failing action (`softFail: false`) aborts the engine run, so an exit inside a
        // state's onEnter is a failed run, not a reached terminal state.
        terminal: hardFailure ? 'failed' : current,
        hostStages,
        log,
        runLink: readFileSync(join(cwd, '.spur/run/fixture-0503-run-link.json'), 'utf8'),
    };
}

describe('0503 interactive inline pipeline driver smoke', () => {
    test('actual task-pipeline graph runs model stages in host session and preserves provenance/guards', () => {
        const result = runInlineSmoke();

        expect(result.terminal).toBe('done');
        // D65 1239: `verify` folded into `review`, so the graph has two model stages.
        expect(result.hostStages).toEqual(['implement', 'review']);
        expect(result.log).toContain('stage implement executed inline in session codex-fixture-session');
        expect(result.log).toContain('stage review executed inline in session codex-fixture-session');
        expect(result.log).not.toContain('spur agent run');
        expect(JSON.parse(result.runLink)).toEqual({ source: 'inline-full', runId: 'inline-smoke-run' });
    });

    test('a non-PASS verdict follows the YAML guard into bounded remediation before done', () => {
        const result = runInlineSmoke({ verdict: 'FAIL' });

        expect(result.terminal).toBe('failed');
        // D65 1239: the certification is `review`'s own verdict, so a non-PASS review routes
        // through the shared bounded repair hop (review-failure-class → remediate) and back
        // through `gate` (recheck visit) rather than through a `verify` → `test-fix` pair. The
        // shared attempt cap then terminates the run at `failed` without ever reaching `done`.
        expect(result.hostStages).toEqual(['implement', 'review', 'remediate', 'review', 'remediate', 'review']);
        expect(result.log).not.toContain('Pipeline complete');
    });

    test('0751 R2 fail-closed: an unresolved task path fails the gate-state lookup step', () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-0503-inline-failclosed-'));
        mkdirSync(join(cwd, '.spur/run'), { recursive: true });
        const spurBin = makeFakeSpur(cwd);
        // D65 1239: the fail-closed lookup entered with the gate state (the former `test`).
        const lookup = PIPELINE.states.find((state) => state.id === 'gate')?.onEnter?.[0];
        expect(lookup?.kind).toBe('shell');
        const command = expand(lookup?.options?.command ?? '', { ...PIPELINE.vars, wbs: 'fixture-0503', spurBin });
        // No fixture task seeded (FIXTURE_TASK_SPEC empty) -> the lookup must fail the
        // step instead of degrading the evidence to whole-tree-only.
        expect(runShell(command, cwd, { wbs: 'fixture-0503', spurBin, FIXTURE_TASK_SPEC: '' })).not.toBe(0);
        // The priority var is never materialized from a failed lookup.
        expect(Bun.file(join(cwd, '.spur/run/fixture-0503-priority.txt')).exists()).resolves.toBe(false);
    });

    test('a red structural check at precheck stops the run before implement', () => {
        // The graph-level structural check is the precheck guard (check #1 is the 1132 R4
        // repair pass, #2 is `--precheck`); a non-zero check follows the fail-closed edge.
        const result = runInlineSmoke({ failCheckAt: 2 });

        expect(result.terminal).toBe('failed');
        expect(result.hostStages).toEqual([]);
    });

    test('the completion verb rejecting the done target blocks the close', () => {
        // 1132 R4 added the auto-fix-first repair check to the precheck guard, so the
        // pipeline now issues check #1 (`--fix`) and #2 (`--precheck`) before `done`.
        // D65 1239: the completion gate is the `spur task update <wbs> done` verb's own
        // target-aware `task check --as done`, so the graph's observable is the hard
        // `command.gate` around it: a non-zero exit aborts the run instead of storing `done`.
        const result = runInlineSmoke({ failDoneTransition: true });

        expect(result.terminal).toBe('failed');
        expect(result.hostStages).toEqual(['implement', 'review']);
        expect(result.log).not.toContain('Pipeline complete');
    });
});
