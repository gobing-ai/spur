import { describe, expect, test } from 'bun:test';
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';

interface ActionOptions {
    command?: string;
    input?: string;
    answerFile?: string;
    expectFile?: string;
    path?: string;
    var?: string;
    message?: string;
    requireDiff?: boolean;
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

function expand(value: string, vars: Record<string, string>): string {
    return value.replace(/\$\{vars\.([A-Za-z0-9_]+)\}/g, (_match, key: string) => vars[key] ?? '');
}

function runShell(command: string, cwd: string, env: Record<string, string>): number {
    const result = Bun.spawnSync(['sh', '-c', command], {
        cwd,
        env: { ...process.env, ...env },
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
    printf '{"wbs":"%s","verdict":"%s","requirements":[],"checks":[]}\n' "$3" "\${VERDICT:-PASS}" > ".spur/run/$3-verdict.json" ;;
  task:show)
    printf '%s\n' '{"content":"ordinary implementation task","frontmatter":{"feature_id":null}}' ;;
  task:path)
    # 0751 R2: the fail-closed task lookup needs a resolvable spec. FIXTURE_TASK_SPEC
    # is seeded by runInlineSmoke; unset -> empty path -> the pipeline step must fail.
    printf '{"path":"%s"}\n' "$FIXTURE_TASK_SPEC" ;;
  task:update|task:record)
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

function runInlineSmoke(
    options: { verdict?: 'PASS' | 'FAIL'; failCheckAt?: number; unresolvableTask?: boolean } = {},
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
    const vars: Record<string, string> = {
        ...PIPELINE.vars,
        wbs: 'fixture-0503',
        profile: 'auto',
        spurBin,
        formatCmd: 'true',
        qualityGateCmd: 'true',
    };
    const env: Record<string, string> = {
        ...vars,
        CHECK_COUNTER: join(cwd, 'check-counter'),
        VERDICT: options.verdict ?? 'PASS',
        FAIL_CHECK_AT: options.failCheckAt === undefined ? '' : String(options.failCheckAt),
        FIXTURE_TASK_SPEC: options.unresolvableTask === true ? '' : taskSpecPath,
    };
    const runId = 'inline-smoke-run';
    const logPath = join(cwd, `.spur/run/${runId}.log`);
    mkdirSync(dirname(logPath), { recursive: true });
    const sessionId = resolveSessionId(cwd);
    expect(
        runShell('$spurBin task run-link "$wbs" --source inline-full --run-id "$RUN_ID" --json', cwd, {
            ...env,
            RUN_ID: runId,
        }),
    ).toBe(0);

    let current = PIPELINE.initialState;
    const hostStages: string[] = [];
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
                    writeFileSync(answerPath, `Verdict: ${options.verdict ?? 'PASS'}\n`);
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
            if (action.kind === 'hitl.confirm') throw new Error('auto profile must route around HITL');
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
            if (action.kind === 'shell') {
                let command = expand(action.options?.command ?? '', vars);
                if (command.includes('task-size-precheck.ts')) {
                    command = 'mkdir -p .spur/run && printf "PASS\\n" > ".spur/run/$wbs-precheck-size.status"';
                }
                // 0726 R2: evidence precheck ships with the plugin; the smoke simulates its
                // PASS outcome exactly like the size precheck above.
                if (command.includes('task-evidence-precheck.ts')) {
                    command = 'mkdir -p .spur/run && printf "PASS\\n" > ".spur/run/$wbs-precheck-evidence.status"';
                }
                // 0726 R3: lint semantics live in verify-answer-lint.test.ts; the smoke keeps
                // only the file-must-exist coupling of the gate step.
                if (command.includes('verify-answer-lint.ts')) {
                    command = 'test -f ".spur/run/$wbs-verify-answer.txt"';
                }
                command = command.replaceAll('sleep 2', 'sleep 0').replaceAll('sleep 10', 'sleep 0');
                expect(runShell(command, cwd, env), `${state.id}: ${command}`).toBe(0);
            }
        }

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

    const log = readFileSync(logPath, 'utf8');
    // 0727 R3: every appended line is ISO-8601 UTC-stamped; zero bare local-clock forms.
    const logLines = log.split('\n').filter((line) => line.length > 0);
    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) {
        expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z /);
    }
    expect(logLines.filter((line) => /^\[[a-z-]+ [0-9]{1,2}:[0-9]{2}\]/.test(line))).toEqual([]);

    return {
        terminal: current,
        hostStages,
        log,
        runLink: readFileSync(join(cwd, '.spur/run/fixture-0503-run-link.json'), 'utf8'),
    };
}

describe('0503 interactive inline pipeline driver smoke', () => {
    test('actual task-pipeline graph runs model stages in host session and preserves provenance/guards', () => {
        const result = runInlineSmoke();

        expect(result.terminal).toBe('done');
        expect(result.hostStages).toEqual(['implement', 'review', 'verify']);
        expect(result.log).toContain('stage implement executed inline in session codex-fixture-session');
        expect(result.log).toContain('stage review executed inline in session codex-fixture-session');
        expect(result.log).toContain('stage verify executed inline in session codex-fixture-session');
        expect(result.log).not.toContain('spur agent run');
        expect(JSON.parse(result.runLink)).toEqual({ source: 'inline-full', runId: 'inline-smoke-run' });
    });

    test('a non-PASS verdict follows the YAML guard to failed before record', () => {
        const result = runInlineSmoke({ verdict: 'FAIL' });

        expect(result.terminal).toBe('failed');
        // 0703 R4: a non-PASS verify verdict routes through the bounded verify→test-fix
        // edge. In this sandbox the recheck probe (`bun run lint`) is red, so each
        // test-fix hop re-enters a probe-skipped recheck (0587 R3) that fails again until
        // attempts exhaust `qualityGateMaxFixAttempts` — the catch-all then terminates at
        // `failed` without reaching `record`.
        expect(result.hostStages).toEqual(['implement', 'review', 'verify', 'test-fix', 'test-fix']);
        expect(result.log).not.toContain('Pipeline complete');
    });

    test('0751 R2 fail-closed: an unresolved task path fails the test-state lookup step', () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-0503-inline-failclosed-'));
        mkdirSync(join(cwd, '.spur/run'), { recursive: true });
        const spurBin = makeFakeSpur(cwd);
        const lookup = PIPELINE.states.find((state) => state.id === 'test')?.onEnter?.[0];
        expect(lookup?.kind).toBe('shell');
        const command = expand(lookup?.options?.command ?? '', { ...PIPELINE.vars, wbs: 'fixture-0503', spurBin });
        // No fixture task seeded (FIXTURE_TASK_SPEC empty) -> the lookup must fail the
        // step instead of degrading the proof to whole-tree-only.
        expect(runShell(command, cwd, { wbs: 'fixture-0503', spurBin, FIXTURE_TASK_SPEC: '' })).not.toBe(0);
        // The priority var is never materialized from a failed lookup.
        expect(Bun.file(join(cwd, '.spur/run/fixture-0503-priority.txt')).exists()).resolves.toBe(false);
    });

    test('the record-to-done task-check guard blocks a failed structural check', () => {
        const result = runInlineSmoke({ failCheckAt: 2 });

        expect(result.terminal).toBe('failed');
        expect(result.hostStages).toEqual(['implement', 'review', 'verify']);
        expect(result.log).not.toContain('Pipeline complete');
    });
});
