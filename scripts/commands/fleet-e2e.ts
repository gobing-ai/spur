/**
 * fleet-e2e — prove the inbox-only agent fleet end to end and leave a repeatable receipt
 * (task 1077, feature G71 R8; plan `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md` §1).
 *
 * Usage: bun scripts/spur-dev.ts fleet-e2e [--inject-failure <step>] [--guest-join-fixture] [--keep]
 *        bun scripts/spur-dev.ts fleet-e2e --matrix
 *        bun scripts/spur-dev.ts fleet-e2e --perf [--trials <n>] [--real-agents] [--agents <csv>] [--keep]
 *
 * `--matrix` runs the EXECUTOR MATRIX instead of the fleet E2E (task 1238 R2/R3, feature D65): the
 * tracked fixture `packages/app/tests/fixtures/1238/executor-matrix-fixture.yaml` — one `agent.run`
 * stage and one decision gate — under the host, subprocess and fleet executors, comparing the action
 * sequence and the receipt shape each run leaves behind. It writes
 * `docs/reports/executor-matrix-receipt.json`. The fleet column runs on the same scratch fleet this
 * harness scaffolds for the E2E (declared `agent.fleet`, stub model on `PATH`, a real member loop);
 * if that scaffolding fails the column is `blocked` and NAMES the precondition — a blocked column
 * never counts as a pass, and the matrix exits 2 rather than 0.
 *
 * One scratch project under `$TMPDIR` is scaffolded, driven through the source-local CLI
 * (`bun run apps/cli/src/index.ts`), and torn down; the run writes
 * `docs/reports/fleet-e2e-receipt.json` (stable name, overwritten each run). Every step row
 * records its command, exit code, observed evidence and the assertion it proves.
 *
 * `--guest-join-fixture` points the guest-join step's predicate at a generated pre-1081 fixture
 * CLI (a tree that does not register `join`), so the R4 skip arm is EXECUTED rather than merely
 * reachable; that run writes its own receipt, `docs/reports/fleet-e2e-receipt-skip-arm.json`,
 * leaving the default land-arm receipt a truthful 9/9.
 *
 * Only the MODEL is stubbed (R3): a scratch `bin/` holding a stub binary named after the
 * declared member's agent type is prepended to `PATH`, so the member loop's real spawn path
 * runs a fake agent. The fleet declaration, the inbox, the keyed dispatch, the
 * `coordination_runs` receipt and `spur agent trace` are all the real thing.
 *
 * `--inject-failure <step>` flips that step's row to `failed` and exits 1 — the harness
 * itself must be able to fail.
 *
 * Determinism: bounded polling of real state, no wall-clock assertions, no random ids in the
 * compared projection (`[.steps[] | {step,status,assertion}]`). The receipt's ids and
 * timestamps are volatile by design.
 */
import { createHash } from 'node:crypto';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InboxService, StrategyRuntime } from '@gobing-ai/spur-app';
import { getEnvVar, getEnvVars } from '@gobing-ai/spur-config';
import {
    CoordinationRunDao,
    createMigratedDb,
    ProjectClaimDao,
    readMemberSessions,
    SystemEventDao,
} from '@gobing-ai/spur-domain';
import {
    type AgentName,
    getAgentSessionCapability,
    getAgentShim,
    TURN_SESSION_DRIVERS,
    type TurnBinary,
    type TurnSessionDriver,
} from '@gobing-ai/ts-ai-runner';
import { type PerfMeasured, perfMeasured, runPairedTurnPerf, type TurnPerfComparison } from './fleet-e2e-turn-perf';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** The source-local CLI entry (this repo's own transport, never an installed binary). */
const CLI_ENTRY = join(REPO_ROOT, 'apps/cli/src/index.ts');
/** Stable receipt name — overwritten each run (1077 Q&A). */
const RECEIPT_PATH = join(REPO_ROOT, 'docs/reports/fleet-e2e-receipt.json');
/**
 * R4 skip-arm receipt (task 1077): the same harness with the guest-join leg's interrogated CLI
 * swapped for the generated pre-1081 fixture (`--guest-join-fixture`). A separate file so the
 * default land-arm receipt stays the truthful 9/9 it has always been.
 */
const SKIP_ARM_RECEIPT_PATH = join(REPO_ROOT, 'docs/reports/fleet-e2e-receipt-skip-arm.json');

/** The step list (§Design). Row order is the design's; see {@link runFleetE2e} for execution order. */
export const RECEIPT_STEPS = [
    'scaffold',
    'create-task',
    'start-loops',
    'dispatch-to-done',
    'orchestrator-reply',
    'kill-redispatch',
    'guest-join',
    'trace',
    'teardown',
] as const;
type StepName = (typeof RECEIPT_STEPS)[number];

/** The declared member's executor → agent type. The stub binary is named after the agent. */
const EXECUTOR_NAME = 'fast-lane';
const AGENT_TYPE = 'claude';
/**
 * The executor-matrix fixture (task 1238 R2/R3): a tracked definition, so the matrix proves the
 * dispatch contract from the repository rather than from a workflow the harness wrote for itself.
 */
export const MATRIX_FIXTURE_PATH = join(REPO_ROOT, 'packages/app/tests/fixtures/1238/executor-matrix-fixture.yaml');
/** Stable matrix receipt name — overwritten each run, like the fleet E2E receipt. */
export const MATRIX_RECEIPT_PATH = join(REPO_ROOT, 'docs/reports/executor-matrix-receipt.json');
/** The fixture's declared completion artifact (its `expectFile`). */
const MATRIX_TARGET_FILE = '.spur/run/executor-matrix-result.txt';
/** The marker the fixture's stage prompt carries, so the stub model knows it is a matrix turn. */
const MATRIX_STUB_PROMPT = 'EXECUTOR-MATRIX';
/**
 * The matrix's whole PATH: the scratch `bin/` first, then the OS defaults only. Agent resolution
 * therefore finds the stub model and NOT an agent installed on the operator's machine — the matrix
 * proves the dispatch contract, never a real model turn.
 */
function matrixPath(binDir: string): string {
    return [binDir, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
}
const PLANNER_LOCAL_ID = 'planner-1';
const CODER_LOCAL_ID = 'coder-1';
const TASK_TITLE = 'E2E inbox-only fleet task';
const HANG_TAG = 'e2e:hang';
const LOOP_POLL_MS = 1_000; // wake backstop: a prompt tick keeps dispatch latency far below the poll budgets below (G71 1077 R3).

/** Bounded waits. Generous enough for a cold `bun run` CLI start, never a wall-clock assertion. */
const BOUNDS = {
    loops: 90_000,
    dispatch: 120_000,
    done: 120_000,
    // The kill leg waits for a SECOND dispatch cycle after the done-task's turn has settled, so it
    // gets a wider budget than a single tick under load (G71 1077 R3).
    hang: 240_000,
    reply: 180_000,
    kill: 90_000,
    resume: 60_000,
    guest: 60_000,
    poll: 1_000,
} as const;

interface StepRow {
    step: string;
    command: string;
    exitCode: number | null;
    status: 'passed' | 'failed' | 'skipped';
    assertion: string;
    evidence: string;
}

/** One executed action as the run's trace reported it — the unit the matrix compares. */
export interface MatrixActionStep {
    node: string;
    actionKind: string;
    status: string;
}

/** Which executor ran the fixture (design `workflow-execution-foundation` §3.1). */
export type MatrixExecutor = 'host' | 'subprocess' | 'fleet';

/**
 * A column's verdict: `passed` (the run proved the contract), `failed` (it ran and broke it), or
 * `blocked` (it could not run because scaffolding was missing — never a pass).
 */
export type MatrixColumnStatus = 'passed' | 'failed' | 'blocked';

/** One executor's column in `docs/reports/executor-matrix-receipt.json`. */
export interface MatrixColumn {
    executor: MatrixExecutor;
    status: MatrixColumnStatus;
    runId: string | null;
    finalState: string | null;
    actions: MatrixActionStep[];
    /** Sorted receipt key names: the SHAPE the three executors must share (values are volatile). */
    receiptShape: string;
    /** The failed scaffolding precondition — set only with status `blocked`. */
    precondition: string | null;
    evidence: string;
}

/** What the host column observed. */
export interface MatrixHostProbe {
    pause: { runId: string; state: string; expectFiles: string[] } | null;
    /** Exit code of a `workflow continue` carrying a receipt for a DIFFERENT run. */
    mismatchedReceiptExitCode: number | null;
    finalState: string | null;
}

/** What a subprocess or fleet column observed. */
export interface MatrixRunProbe {
    finalState: string | null;
    receiptExecutor: string | null;
    /** Set when the column could not run at all — the scaffolding that failed. */
    precondition?: string | null;
}

/** A decided verdict with the reason the receipt records. */
export interface MatrixVerdict {
    status: MatrixColumnStatus;
    reason: string | null;
}

/** A gap the run could NOT close, recorded machine-readably instead of hidden in prose. */
interface ResidualRisk {
    id: string;
    summary: string;
    rootCause: string;
    evidence: string;
}

interface Receipt {
    schemaVersion: number;
    generatedAt: string;
    projectPath: string;
    /** Which CLI the guest-join step interrogated: the source-local transport or the pre-1081 fixture. */
    guestJoinCli: 'source-local' | 'pre-1081-fixture';
    /** Volatile: message/run ids are real but differ per run; only {step,status,assertion} is compared. */
    ids: Record<string, string | null>;
    steps: StepRow[];
    residualRisks: ResidualRisk[];
}

interface CliResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    command: string;
}

interface RunState {
    scratch: string;
    binDir: string;
    stubPath: string;
    stubLog: string;
    plannerId: string;
    coderId: string;
    featureId: string | null;
    wbs: string | null;
    dispatchMessageId: string | null;
    dispatchRunId: string | null;
    replyMessageId: string | null;
    guestId: string | null;
    /** The CLI the guest-join step interrogates: the source-local transport, or the pre-1081 fixture. */
    guestJoinCliEntry: string;
    guestJoinCliLabel: string;
    loopPids: Array<number>;
    rows: Map<StepName, StepRow>;
    ids: Record<string, string | null>;
}

function nowLabel(): string {
    return new Date().toISOString();
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Run the source-local CLI in the scratch project and capture its streams. */
function cli(args: string[], cwd: string, options: { input?: string; env?: Record<string, string> } = {}): CliResult {
    return cliAs(CLI_ENTRY, 'spur', args, cwd, options);
}

/**
 * Run any CLI entry and capture its streams; `label` names it in the receipt's `command` column.
 * The guest-join step's predicate and the `--guest-join-fixture` skip arm (R4) both go through here,
 * so one code path serves the source-local transport and the generated pre-1081 fixture alike.
 */
function cliAs(
    entry: string,
    label: string,
    args: string[],
    cwd: string,
    options: { input?: string; env?: Record<string, string> } = {},
): CliResult {
    // `process.execPath` (this bun), not the bare name: the matrix runs its children on a
    // controlled PATH whose first entry is the scratch `bin/`, so resolving `bun` there would
    // either find the shim we wrote or nothing at all.
    const proc = Bun.spawnSync([process.execPath, 'run', entry, ...args], {
        cwd,
        env: { ...getEnvVars(), ...options.env },
        stdin: options.input === undefined ? 'ignore' : Buffer.from(options.input),
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return {
        exitCode: proc.exitCode ?? 1,
        stdout: proc.stdout.toString(),
        stderr: proc.stderr.toString(),
        command: `${label} ${args.join(' ')}`,
    };
}

/** Same, but a non-zero exit is a harness failure (the step's assertion depends on it). */
function cliOk(args: string[], cwd: string, options: { input?: string; env?: Record<string, string> } = {}): CliResult {
    return cliOkAs(CLI_ENTRY, 'spur', args, cwd, options);
}

/** {@link cliOk} for a non-source-local entry (the pre-1081 fixture, `--guest-join-fixture`). */
function cliOkAs(
    entry: string,
    label: string,
    args: string[],
    cwd: string,
    options: { input?: string; env?: Record<string, string> } = {},
): CliResult {
    const result = cliAs(entry, label, args, cwd, options);
    if (result.exitCode !== 0) {
        throw new Error(`${result.command} exited ${result.exitCode}: ${trimmed(result.stderr || result.stdout)}`);
    }
    return result;
}

/** Parse the CLI's `--json` payload, tolerating a leading banner on stdout. */
function jsonOf<T>(result: CliResult): T {
    const start = result.stdout.search(/[[{]/);
    if (start === -1) throw new Error(`${result.command} printed no JSON: ${trimmed(result.stdout)}`);
    return JSON.parse(result.stdout.slice(start)) as T;
}

function jsonOk<T>(args: string[], cwd: string, options: { env?: Record<string, string>; input?: string } = {}): T {
    return jsonOf<T>(cliOk(args, cwd, options));
}

function trimmed(text: string, max = 400): string {
    const flat = text.trim().replace(/\s+/g, ' ');
    return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function sleep(ms: number): Promise<void> {
    return new Promise((done) => setTimeout(done, ms));
}

/**
 * Start one member loop as a background process with the scratch `bin/` first on PATH, so
 * the loop's real spawn path resolves the stub. Output goes to two files under
 * `.spur/logs/` (one stream each, so neither truncates the other).
 */
function spawnLoop(
    scratch: string,
    state: Pick<RunState, 'binDir' | 'stubLog'>,
    specId: string,
    suffix = '',
    env: Record<string, string> = {},
): number {
    const logDir = join(scratch, '.spur/logs');
    mkdirSync(logDir, { recursive: true });
    const child = Bun.spawn(
        [process.execPath, 'run', CLI_ENTRY, 'agent', 'loop', '--spec', specId, '--poll', String(LOOP_POLL_MS)],
        {
            cwd: scratch,
            env: {
                ...getEnvVars(),
                PATH: state.binDir === '' ? (getEnvVar('PATH') ?? '') : `${state.binDir}:${getEnvVar('PATH') ?? ''}`,
                // The stub resolves its own inputs from the environment the LOOP passes on: without
                // these three the stub runs with an empty CLI path, its first `Bun.spawnSync` throws,
                // and the turn dies right after logging its prompt — which looked like a hang
                // (3 failed dispatches, no .cli rows, no run rows). G71 1077 R3.
                SPUR_E2E_CLI: CLI_ENTRY,
                SPUR_E2E_PROJECT: scratch,
                SPUR_E2E_STUB_LOG: state.stubLog,
                ...env,
            },
            stdin: 'ignore',
            stdout: Bun.file(join(logDir, `loop-${specId}${suffix}.out.log`)),
            stderr: Bun.file(join(logDir, `loop-${specId}${suffix}.err.log`)),
        },
    );
    return child.pid;
}

/**
 * Bounded poll over REAL state. Returns the first non-undefined observation, or throws the
 * step's failure text — never a wall-clock assertion, only a deadline on an observable.
 */
async function pollUntil<T>(label: string, probe: () => Promise<T | undefined>, timeoutMs: number): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const observed = await probe();
        if (observed !== undefined) return observed;
        if (Date.now() >= deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
        await sleep(BOUNDS.poll);
    }
}

/** The stub's JSONL prompt log, one record per model invocation. */
interface StubPrompt {
    at: string;
    spec: string | null;
    /** The stub process id — teardown proves a SIGKILLed loop left no orphan behind (F7). */
    pid?: number;
    argv: string[];
    stdin: string;
    prompt: string;
    directives: string[];
}

function readStubPrompts(state: RunState): StubPrompt[] {
    if (!existsSync(state.stubLog)) return [];
    return readFileSync(state.stubLog, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as StubPrompt);
}

function directiveFor(record: StubPrompt, wbs: string): string | undefined {
    return record.directives.find((directive) => new RegExp(`/sp:dev-run\\s+${wbs}\\b`).test(directive));
}

/**
 * The stubbed model. Tolerance is deliberate: the prompt may ride argv (one-shot print
 * dispatch) or stdin (persistent-stdin framing), so every source is scanned and every id is
 * derived by regex — the stub never depends on one shim's exact flag form. Its side effects
 * (task transitions, inbox replies) all run through the source-local CLI.
 */
function stubSource(): string {
    return `#!/usr/bin/env bun
// Generated by scripts/commands/fleet-e2e.ts — the stubbed model of the fleet E2E.
// It logs every received prompt and drives real task/message transitions through the CLI.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);
if (argv.includes('--version')) {
    console.log('fleet-e2e-stub 1.0.0');
    process.exit(0);
}
if (argv.includes('--help')) {
    console.log('fleet-e2e-stub — the stubbed model for the inbox-only fleet E2E');
    process.exit(0);
}

const GATEWAY = ${JSON.stringify(join(REPO_ROOT, 'packages/config/src/index.ts'))};
const { getEnvVars } = await import(GATEWAY);
const env = getEnvVars();
const cli = env.SPUR_E2E_CLI ?? '';
const project = env.SPUR_E2E_PROJECT ?? process.cwd();
const logPath = env.SPUR_E2E_STUB_LOG ?? project + '/stub-prompts.jsonl';
const specId = env.SPUR_SPEC_ID ?? '';

let stdinText = '';
if (!process.stdin.isTTY) {
    await new Promise((done) => {
        const timer = setTimeout(done, 250);
        process.stdin.on('data', (chunk) => { stdinText += chunk.toString(); });
        process.stdin.on('end', () => { clearTimeout(timer); done(); });
        process.stdin.on('error', () => { clearTimeout(timer); done(); });
    });
}

const DIRECTIVE = /\\/sp:dev-run\\s+\\d{4}(?:\\s+--?[A-Za-z][\\w-]*)*/g;
// Directives are read from EVERY input shape (each argv slot, the stdin frame, and the joined text) because the shim may carry the prompt whole in one slot, split across slots, or on stdin (G71 1077 R3).
const sources = [...argv, stdinText, [...argv, stdinText].join(' ')];
const prompt = sources[sources.length - 1] ?? '';
const directives = sources.flatMap((source) => source.match(DIRECTIVE) ?? []);
// The hang gate asks the semantic question directly: this turn IS a resume.
const resumedTurn = prompt.includes('--continue');

appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), spec: specId, pid: process.pid, argv, stdin: stdinText, prompt, directives }) + '\\n');

function cliRun(args, input) {
    // The stub must never die on a bad invocation: an unspawnable CLI is recorded and returned as a
    // failed call, so a turn reports the real reason instead of vanishing (G71 1077 R3).
    let proc;
    try {
        proc = Bun.spawnSync(['bun', 'run', cli, ...args], {
            cwd: project,
            stdin: input === undefined ? 'ignore' : Buffer.from(input),
            stdout: 'pipe',
            stderr: 'pipe',
        });
    } catch (error) {
        const detail = 'stub: CLI invocation failed: ' + (error && error.message ? error.message : String(error)) + ' (cli=' + JSON.stringify(cli) + ')';
        try { appendFileSync(logPath + '.cli', JSON.stringify({ at: new Date().toISOString(), spec: specId, args, exit: -1, stdout: '', stderr: detail }) + '\\n'); } catch {}
        process.stderr.write(detail + '\\n');
        return { exitCode: -1, stdout: '', stderr: detail };
    }
    // Every stub CLI call is logged with its exit code: a refused transition is otherwise
    // invisible from the outside and looked exactly like a hang (G71 1077 R3 diagnosis).
    try {
        appendFileSync(
            logPath + '.cli',
            JSON.stringify({
                at: new Date().toISOString(),
                spec: specId,
                args,
                exit: proc.exitCode ?? 1,
                stdout: proc.stdout.toString().slice(0, 400),
                stderr: proc.stderr.toString().slice(0, 400),
            }) + '\\n',
        );
    } catch {}
    return { exitCode: proc.exitCode ?? 1, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

function readJson(text) {
    const start = text.search(/[[{]/);
    return JSON.parse(text.slice(start));
}

const dispatch = /\\/sp:dev-run\\s+(\\d{4})/.exec(sources.join(' '));
const artifact = /prompt artifact:\\s*(\\S+)/.exec(prompt)?.[1];
if (artifact?.startsWith(project + '/.spur/run/')) sources.push(readFileSync(artifact, 'utf8'));
// The EXECUTOR MATRIX's stub model (task 1238): the fixture's stage is one short command-shaped
// prompt, so this turn writes the stage's declared expectFile — the engine appends the absolute
// target to the prompt — and stops. Nothing else about the turn is faked.
if (sources.join(' ').includes(${JSON.stringify(MATRIX_STUB_PROMPT)})) {
    const target = /absolute path: (\\S+)/.exec(sources.join(' '));
    const path = target !== null ? target[1] : project + '/' + ${JSON.stringify(MATRIX_TARGET_FILE)};
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'executor-matrix stub result\\n');
    process.stdout.write('stub: wrote ' + path + '\\n');
    process.exit(0);
}
if (dispatch !== null) {
    const wbs = dispatch[1];
    const directive = directives.find((entry) => entry.includes(wbs)) ?? '';
    const resumed = resumedTurn || directive.includes('--continue');
    const show = cliRun(['task', 'show', wbs, '--json']);
    const task = readJson(show.stdout);
    const manifest = task.frontmatter ?? (task.task && task.task.frontmatter) ?? {};
    const tags = Array.isArray(manifest.tags) ? manifest.tags : [];
    // Gate diagnosis: one line per dispatch-branch entry, naming what the gate will read.
    appendFileSync(logPath + '.gate', JSON.stringify({ at: new Date().toISOString(), spec: specId, wbs, resumedTurn, resumed, tags, directives }) + '\\n');
    // e2e:hang models a coder turn that must be killed mid-run: it blocks until the task is
    // resumed with --continue, which is the prompt that lets it finish.
    if (tags.includes(${JSON.stringify(HANG_TAG)}) && !resumed) {
        process.stderr.write('stub: hanging on task ' + wbs + ' until a --continue resume\\n');
        // A SIGKILLed loop cannot clean up its child: exit as soon as the parent is gone, so an
        // orphaned hang stub can never outlive the run (F7).
        const parent = process.ppid;
        for (;;) {
            await Bun.sleep(500);
            if (process.ppid !== parent || process.ppid === 1) {
                process.stderr.write('stub: parent loop gone — exiting the hung turn\\n');
                process.exit(137);
            }
        }
    }
    cliRun(['task', 'update', wbs, 'wip', '--no-lifecycle']);
    cliRun(
        ['task', 'update', wbs, '--section', 'Solution', '--from-file', '/dev/stdin', '--no-lifecycle'],
        'scripts/commands/fleet-e2e.ts:1 — the fleet-e2e stub closed ' + wbs + ' through the source-local CLI.\\n',
    );
    cliRun(
        ['task', 'update', wbs, '--section', 'Testing', '--from-file', '/dev/stdin', '--no-lifecycle'],
        'The stub drove ' + wbs + ' through the source-local CLI (todo -> wip -> testing -> done).\\n',
    );
    cliRun(['task', 'update', wbs, 'testing', '--no-lifecycle']);
    const done = cliRun(['task', 'update', wbs, 'done', '--force-done', '--reason', 'fleet-e2e stub', '--no-lifecycle', '--json']);
    process.stdout.write(done.stdout);
    process.exit(done.exitCode);
}

if (prompt.includes('status?')) {
    const inbox = cliRun(['message', 'inbox', '--agent', specId, '--json']);
    const messages = readJson(inbox.stdout).messages ?? [];
    const pending = messages.find((message) => String(message.body).includes('status?') && message.status !== 'replied');
    if (pending === undefined) {
        process.stderr.write('stub: no pending status? message in ' + specId + '\\n');
        process.exit(1);
    }
    const reply = cliRun(['message', 'reply', pending.id, 'idle']);
    process.stdout.write('replied ' + pending.id + ' (exit ' + reply.exitCode + ')\\n');
    process.exit(reply.exitCode);
}

process.stdout.write('stub: no action for this prompt\\n');
process.exit(0);
`;
}

/**
 * The pre-1081 `spur agent --help` command set, reconstructed from this repo's own history — the
 * parent of `0411c912b` ("hook-reported agent lifecycle and guest fleet occupancy (1080, 1081)"),
 * which added `report|join|leave`. A frozen historical snapshot: the visible command column is
 * `list, status, usage, doctor, run, wait, trace, start, stop, help` and, crucially, no `join`.
 * The wrapped descriptions are flattened to one line each — the probe reads the command column, not
 * commander's terminal-width wrapping, and a fixture must not depend on the reader's COLUMNS.
 */
const PRE_1081_AGENT_HELP = [
    'Usage: spur agent [options] [command]',
    '',
    'Options:',
    '  -h, --help                 display help for command',
    '',
    'Commands:',
    '  list [options]             List detected coding agents, or agent specs with --specs.',
    '  status [options]           Show agent specs with live process status and member session (requires spur serve).',
    '  usage [options]            Run-once provider usage capture (codexbar) that refreshes quota-owned executor availability.',
    '  doctor [options] [agent]   Check agent readiness.',
    '  run [options] <prompt>     Execute a prompt or slash command via a coding agent.',
    '  wait [options] [specId]    Wait for a pinned occupant run to reach a lifecycle state. Address by spec id or --role.',
    '  trace [options] <runId>    Print one execution record: the run, its dispatch lineage, session ids and streams.',
    '  start [options] <spec-id>  Start a supervised agent process (requires spur serve).',
    '  stop [options] <spec-id>   Stop a supervised agent process (requires spur serve).',
    '  help [command]             display help for command',
    '',
].join('\n');

/**
 * The generated pre-1081 fixture CLI (`--guest-join-fixture`, R4). Its one job is to answer
 * `agent --help` with the pre-1081 command set above, so the guest-join predicate can be driven
 * against a CLI that does NOT register `join`. Hermetic: no machine path, no dependency on the
 * published bundle — a scratch file the harness writes and removes like the stub.
 */
function pre1081FixtureSource(): string {
    return `#!/usr/bin/env bun
// Generated by scripts/commands/fleet-e2e.ts — the pre-1081 fixture CLI (task 1077 R4).
const HELP = ${JSON.stringify(PRE_1081_AGENT_HELP)};
const argv = process.argv.slice(2);
if (argv[0] === 'agent' && (argv.includes('--help') || argv.includes('-h'))) {
    process.stdout.write(HELP + '\\n');
    process.exit(0);
}
process.stderr.write('fleet-e2e pre-1081 fixture: only agent --help is implemented\\n');
process.exit(1);
`;
}

/** `agent.fleet` for the scratch project: a planner orchestrator and one stub-executor coder. */
function fleetConfigSection(agent = AGENT_TYPE): string {
    return [
        '',
        'agent:',
        '  fleet:',
        '    enabled: true',
        '    strategy: gtd',
        `    orchestrator: ${PLANNER_LOCAL_ID}`,
        '    members:',
        `      - { id: ${PLANNER_LOCAL_ID}, role: planner, purpose: orchestrator, executor: ${EXECUTOR_NAME} }`,
        `      - { id: ${CODER_LOCAL_ID}, role: coder, executor: ${EXECUTOR_NAME} }`,
        '  executors:',
        `    - name: ${EXECUTOR_NAME}`,
        `      agent: ${agent}`,
        '      tier: standard',
        '      # fsWrite attestation: GTD only allocates a write-capable member (fleet-service.ts:512).',
        '      executionCapabilities:',
        '        version: 1',
        '        axes:',
        '          fsWrite:',
        '            state: available',
        '            provenance: native-known',
        '',
    ].join('\n');
}

function fail(state: RunState, step: StepName, command: string, assertion: string, error: unknown): void {
    state.rows.set(step, {
        step,
        command,
        exitCode: 1,
        status: 'failed',
        assertion,
        evidence: `error: ${errorMessage(error)}`,
    });
}

function pass(state: RunState, step: StepName, command: string, assertion: string, evidence: string): void {
    state.rows.set(step, { step, command, exitCode: 0, status: 'passed', assertion, evidence });
}

const STEP_ONE_ASSERTION =
    'a scratch project scaffolds with a declared agent.fleet (gtd, planner-1 orchestrator, coder-1 member), the project strategy row reconciled to gtd, and a PATH stub named after the member agent type';
const STEP_TWO_ASSERTION =
    'a fleet:auto task is created through the source-local CLI and promoted to todo with a passing `task check --as wip` readiness gate';
const STEP_THREE_ASSERTION =
    'the planner and coder loops attach: a live orchestrator claim and a recorded fleet member session, with the stub first on PATH';
const STEP_FOUR_ASSERTION =
    'one keyed dispatch fleet:task:<wbs>:1 reaches the coder member, the member process runs the turn, and the task ends done';
const STEP_FIVE_ASSERTION =
    "an operator 'status?' message to the orchestrator is drained by the orchestrator loop and answered in the operator inbox";
const STEP_SIX_ASSERTION =
    'an unkeyed stdin delivery with no run row never holds dispatch; the hang task is dispatched as fleet:task:<wbs>:1 by the strategy alone (no operator message, no planner nudge); the coder loop is SIGKILLed mid-turn; the restarted loop finalizes the orphaned run errored before its first drain; and the strategy re-dispatches fleet:task:<wbs>:2 on its own';
const STEP_SEVEN_ASSERTION =
    'a joined guest occupant (agent join --role) pulls a dispatched review request through agent wait --inbox and its reply lands in the operator inbox';
// The pre-1081 row asserts the skip itself: no guest ran, so it must not carry the leg's assertion.
const STEP_SEVEN_SKIP_ASSERTION =
    'task 1081 has not landed on this tree, so the guest-join leg does not run: the row records the reason and no guest is joined';
const STEP_EIGHT_ASSERTION =
    'spur agent trace resolves the execution record of the dispatched turn: an agent node whose durable stream exists with content, over a loop-free lineage';
const STEP_NINE_ASSERTION = 'loop pids are killed, the guest leaves, and the scratch dir under $TMPDIR is removed';

const RESIDUAL_RISKS: ResidualRisk[] = [
    {
        id: 'strategy-dispatch-has-no-lineage-parent',
        summary:
            'A strategy dispatch records no parent run edge, so its execution record is a single-node lineage: the dispatch → member-turn depth of 2 requires the workflow dispatcher.',
        rootCause:
            "drainIntoPrompt sets parentRunId only from a workflow request key of the shape `<runId>/<state>` (apps/cli/src/commands/agent/shared.ts:449); the strategy's `fleet:task:<wbs>:<n>` key is deliberately excluded, so the member turn is a lineage root (packages/app/src/services/agent-run-executor.ts:364).",
        evidence:
            'the traced dispatch run reports parentRunId=null and nodes.length=1; its stream and status are still readable, which is what the step asserts.',
    },
];

function writeReceipt(state: RunState, scratch: string, path: string, guestJoinCli: Receipt['guestJoinCli']): void {
    const steps = RECEIPT_STEPS.map(
        (name) =>
            state.rows.get(name) ?? {
                step: name,
                command: '',
                exitCode: null,
                status: 'skipped' as const,
                assertion: '',
                evidence: 'step was never reached (an earlier step failed)',
            },
    );
    const receipt: Receipt = {
        schemaVersion: 1,
        generatedAt: nowLabel(),
        projectPath: scratch,
        guestJoinCli,
        ids: state.ids,
        steps,
        residualRisks: RESIDUAL_RISKS,
    };
    mkdirSync(join(REPO_ROOT, 'docs/reports'), { recursive: true });
    writeFileSync(path, `${JSON.stringify(receipt, null, 4)}\n`);
}

/** Parse `fleet-e2e` args. Unknown flags fail loudly rather than being ignored. */
function parseArgs(args: string[]): {
    injectFailure: StepName | null;
    keep: boolean;
    guestJoinFixture: boolean;
    matrix: boolean;
    perf: boolean;
    trials: number;
    realAgents: boolean;
    hostProbe: boolean;
    realHosts: boolean;
    /**
     * `--agents <csv>` as written, or `undefined` when the flag was absent. Validation belongs to
     * the MODE that consumes it (`--perf` → PERF_AGENTS, `--host-probe` → HOST_PROBE_AGENTS):
     * the two lanes have disjoint agent sets, so a shared validator would reject the other mode's
     * legitimate columns (G74 perf lane + G75 probe lane, merged 2026-10-24).
     */
    agents: string[] | undefined;
} {
    let injectFailure: StepName | null = null;
    let keep = false;
    let guestJoinFixture = false;
    let matrix = false;
    let perf = false;
    let trials = 3;
    let realAgents = false;
    let hostProbe = false;
    let realHosts = false;
    let agents: string[] | undefined;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--matrix') {
            // Task 1238 R3: the executor matrix is a MODE of this harness, not a second script —
            // it reuses the scratch project, the stub model and the fleet scaffolding below.
            matrix = true;
            continue;
        }
        if (arg === '--perf') {
            // Task 1273: the KPI arm — paired cold/resume trials per target agent, phase marks
            // joined from the real system-events ledger, receipts in docs/reports/.
            perf = true;
            continue;
        }
        if (arg === '--real-agents') {
            // Task 1276 (1273 Q&A, CLOSED): the paid lane is OPT-IN. The deterministic lane stubs
            // the model on PATH; this flag stops shadowing it so the member runs the installed
            // binary and a warm turn can actually be measured.
            realAgents = true;
            continue;
        }
        if (arg === '--host-probe') {
            // Task 1280 R1/R2: probe installed hosts and prove the portable loop with hooks absent.
            hostProbe = true;
            continue;
        }
        if (arg === '--real-hosts') {
            // AC3: strictly opt-in. The default lane never launches a real host.
            realHosts = true;
            continue;
        }
        if (arg === '--agents') {
            const value = args[index + 1];
            const requested = (value ?? '')
                .split(',')
                .map((entry) => entry.trim())
                .filter((entry) => entry !== '');
            if (requested.length === 0) {
                const known = perf ? PERF_AGENTS.join(', ') : HOST_PROBE_AGENTS.join(', ');
                throw new Error(`--agents expects a csv of: ${known}`);
            }
            agents = requested;
            index++;
            continue;
        }
        if (arg === '--trials') {
            const value = args[index + 1];
            const parsed = value === undefined ? Number.NaN : Number.parseInt(value, 10);
            if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
                throw new Error('--trials expects an integer 1..10 (trials per agent per mode)');
            }
            trials = parsed;
            index++;
            continue;
        }
        if (arg === '--guest-join-fixture') {
            // R4 skip arm: point the guest-join predicate at the generated pre-1081 fixture CLI.
            guestJoinFixture = true;
            continue;
        }
        if (arg === '--keep') {
            // Diagnostics keep the scratch project after the run: teardown normally removes it,
            // which used to destroy the only evidence a failed step had (stub prompts, DB rows).
            keep = true;
            continue;
        }
        if (arg === '--inject-failure') {
            const value = args[index + 1];
            if (value === undefined || !(RECEIPT_STEPS as readonly string[]).includes(value)) {
                throw new Error(`--inject-failure expects one of: ${RECEIPT_STEPS.join(', ')}`);
            }
            injectFailure = value as StepName;
            index++;
            continue;
        }
        throw new Error(
            `unknown argument "${arg}" (usage: fleet-e2e [--inject-failure <step>] [--guest-join-fixture] [--keep] | --matrix | --perf [--trials <n>] [--real-agents] [--agents <csv>] | --host-probe [--real-hosts] [--agents <csv>])`,
        );
    }
    return { injectFailure, keep, guestJoinFixture, matrix, perf, trials, realAgents, hostProbe, realHosts, agents };
}

/**
 * The `--perf` argument surface alone (task 1276). `runFleetE2e` shares {@link parseArgs}; this
 * re-parse exists so the perf lane's defaults (`--agents` → every target, `--real-agents` off) are
 * pinned by a test without invoking the harness.
 */
export function parsePerfArgs(args: string[]): {
    trials: number;
    realAgents: boolean;
    agents: readonly string[];
    keep: boolean;
} {
    const parsed = parseArgs(args);
    // The perf lane's own contract (1273 R4): unknown columns fail loudly instead of measuring
    // nothing, and an absent `--agents` means every target. The generic parse cannot do either —
    // `--host-probe` runs the same flag against a different agent set.
    const agents = parsed.agents ?? PERF_AGENTS;
    const unknown = agents.filter((name) => !(PERF_AGENTS as readonly string[]).includes(name));
    if (unknown.length > 0) throw new Error(`--agents expects a csv of: ${PERF_AGENTS.join(', ')}`);
    return { trials: parsed.trials, realAgents: parsed.realAgents, agents, keep: parsed.keep };
}

interface AgentCommandProbe {
    verb: string;
    /** The interrogated CLI's `agent --help` command column contains `verb`. */
    listed: boolean;
    /** The probe invocation itself: recorded as the guest-join row's command/exitCode (R2). */
    help: CliResult;
}

/**
 * R4 (task 1081): `agent join|leave|wait --inbox` land with 1081, so the guest-join leg may run
 * only on a tree that registers them. `spur agent join --help` cannot answer that question:
 * commander falls through to the PARENT command for an unknown verb, so pre-1081
 * `agent join --help` exited 0 and printed the same `spur agent [options] [command]` help that
 * `agent bogus --help` prints today — verified on this tree, both exit 0. The parent help's
 * command list is the observable that differs: the `join [options]` line is listed only once
 * 1081 has landed. `cliEntry`/`cliLabel` are parameters so the SAME predicate can be driven against
 * the source-local transport AND the generated pre-1081 fixture (`--guest-join-fixture`); only ever
 * exercising the landed direction is how the exit-code probe passed review as a no-op.
 */
export function probeAgentCommand(
    scratch: string,
    verb: string,
    cliEntry: string = CLI_ENTRY,
    cliLabel = 'spur',
): AgentCommandProbe {
    const help = cliOkAs(cliEntry, cliLabel, ['agent', '--help'], scratch);
    // The command column is indented exactly two spaces; wrapped description lines are not.
    const listed = help.stdout.split('\n').some((line) => /^ {2}(\S+)/.exec(line)?.[1] === verb);
    return { verb, listed, help };
}

/** The guest-join predicate in boolean form (the observable the skip arm branches on). */
export function agentCommandListed(scratch: string, verb: string): boolean {
    return probeAgentCommand(scratch, verb).listed;
}

// ── executor matrix (task 1238 R2/R3) ───────────────────────────────────────────────────────────
//
// The matrix runs the tracked fixture under the three executors and compares what each run LEFT
// BEHIND — the action sequence in the trace and the receipt's key shape — instead of comparing what
// each executor printed. Every verdict below is a pure function of observations, so the decision
// contract is testable without a scratch fleet (fleet-e2e-matrix.test.ts pins the failure modes).

/** The action sequence a run's trace reported — the thing all three executors must share. */
export function matrixActionsOf(events: readonly Record<string, unknown>[]): MatrixActionStep[] {
    return events
        .filter((event) => event.kind === 'action')
        .map((event) => ({
            node: String(event.node ?? ''),
            actionKind: String(event.actionKind ?? ''),
            status: String(event.status ?? ''),
        }));
}

/**
 * The receipt's SHAPE: its sorted key names, joined. Values (run id, timestamps, executor) are
 * volatile; only which fields exist is the contract. A string, not an array, so the written
 * receipt stays one line per column and formats identically to the rest of `docs/reports/`.
 */
export function receiptShapeOf(receipt: Record<string, unknown>): string {
    return Object.keys(receipt).sort().join(',');
}

/**
 * The host column's verdict (design §3.2): the run must PAUSE at the stage with a work item, a
 * receipt naming another run must be REFUSED, and the real receipt must resume it to done.
 */
export function hostColumnVerdict(probe: MatrixHostProbe): MatrixVerdict {
    if (probe.pause === null) {
        return { status: 'failed', reason: 'the host run never paused with a work item at the agent.run stage' };
    }
    if (probe.mismatchedReceiptExitCode === null || probe.mismatchedReceiptExitCode === 0) {
        return {
            status: 'failed',
            reason: 'a receipt naming another run was not refused, so the resume is not bound to the paused run',
        };
    }
    if (probe.finalState !== 'done') {
        return {
            status: 'failed',
            reason: `the resumed run ended at '${probe.finalState ?? 'unknown'}', expected done`,
        };
    }
    return { status: 'passed', reason: null };
}

/**
 * A subprocess or fleet column's verdict: done plus a durable receipt naming THAT executor. A
 * column that could not run at all is `blocked` and names the scaffolding precondition — never a
 * pass, because a column that did not run proves nothing (task 1238 R3).
 */
export function runColumnVerdict(executor: MatrixExecutor, probe: MatrixRunProbe): MatrixVerdict {
    if (probe.precondition !== undefined && probe.precondition !== null && probe.precondition !== '') {
        return { status: 'blocked', reason: probe.precondition };
    }
    if (probe.finalState !== 'done') {
        return {
            status: 'failed',
            reason: `the ${executor} run ended at '${probe.finalState ?? 'unknown'}', expected done`,
        };
    }
    if (probe.receiptExecutor === null) {
        return { status: 'failed', reason: `the ${executor} run reached done without a durable receipt` };
    }
    if (probe.receiptExecutor !== executor) {
        return {
            status: 'failed',
            reason: `the ${executor} column's receipt names executor '${probe.receiptExecutor}'`,
        };
    }
    return { status: 'passed', reason: null };
}

/**
 * Compare the columns (1238 R2): every column that RAN must show the same action sequence and the
 * same receipt shape as the first one that ran. A blocked column is excluded from the comparison —
 * it has no run to compare — but a blocked column that does not name its precondition is itself a
 * mismatch, because that is the one way a block could hide.
 */
export function compareMatrixColumns(columns: readonly MatrixColumn[]): string[] {
    const mismatches: string[] = [];
    for (const column of columns) {
        if (column.status === 'blocked' && (column.precondition === null || column.precondition === '')) {
            mismatches.push(`${column.executor}: blocked without a named precondition`);
        }
    }
    const compared = columns.filter((column) => column.status !== 'blocked');
    const reference = compared[0];
    if (reference === undefined) return mismatches;
    for (const column of compared.slice(1)) {
        if (JSON.stringify(column.actions) !== JSON.stringify(reference.actions)) {
            mismatches.push(
                `${column.executor}: action sequence differs from ${reference.executor}'s ` +
                    `(${JSON.stringify(column.actions)} vs ${JSON.stringify(reference.actions)})`,
            );
        }
        if (column.receiptShape !== reference.receiptShape) {
            mismatches.push(
                `${column.executor}: receipt shape differs from ${reference.executor}'s ` +
                    `(${column.receiptShape} vs ${reference.receiptShape})`,
            );
        }
    }
    return mismatches;
}

/** 0 = every column passed; 1 = a column ran and broke the contract; 2 = a column was blocked. */
export function matrixExitCode(columns: readonly MatrixColumn[]): number {
    if (columns.some((column) => column.status === 'failed')) return 1;
    if (columns.some((column) => column.status === 'blocked')) return 2;
    return 0;
}

/** The matrix receipt (task 1238 R3) — the feature's repeatable E2E artifact. */
interface MatrixReceipt {
    schemaVersion: number;
    generatedAt: string;
    fixture: string;
    projectPath: string;
    columns: MatrixColumn[];
    comparison: {
        identical: boolean;
        /** How many columns actually ran — a two-column "identical" must never read as three. */
        compared: number;
        mismatches: string[];
    };
}

/** A workflow run's `--json` result, narrowed to what the matrix reads. */
interface MatrixRunResult {
    runId: string;
    status: string;
    finalState: string;
    reason?: string;
    pause?: { kind?: string; workItem?: { runId?: string; state?: string; expectFiles?: string[] } };
}

/**
 * Scaffold the matrix's own scratch project: a git repo, a project DB, the declared fleet (the
 * fleet column runs on the SAME scaffolding the fleet E2E uses) and a `bin/` holding the stub
 * model plus a `bun` shim, so the whole run resolves one fake agent and never touches an agent
 * installed on the operator's machine.
 */
async function scaffoldMatrixProject(scratch: string, binDir: string, env: Record<string, string>): Promise<string> {
    mkdirSync(binDir, { recursive: true });
    Bun.spawnSync(['git', 'init', '-q', '.'], { cwd: scratch });
    cliOk(['self', 'init', '--json'], scratch, { env });
    mkdirSync(join(scratch, 'docs/tasks'), { recursive: true });
    writeFileSync(
        join(scratch, '.spur/config.yaml'),
        `${readFileSync(join(scratch, '.spur/config.yaml'), 'utf8')}${fleetConfigSection()}`,
    );
    writeFileSync(join(binDir, AGENT_TYPE), stubSource());
    chmodSync(join(binDir, AGENT_TYPE), 0o755);
    // The stub's shebang is `#!/usr/bin/env bun`: without a bun on this controlled PATH the agent
    // is unspawnable and every column looks like a dispatch failure instead of a stub turn.
    writeFileSync(join(binDir, 'bun'), `#!/bin/sh\nexec ${process.execPath} "$@"\n`);
    chmodSync(join(binDir, 'bun'), 0o755);
    return scratch;
}

/** One workflow run of the fixture under one executor, and the artifacts it left. */
async function matrixColumn(
    scratch: string,
    executor: MatrixExecutor,
    run: MatrixRunResult,
    env: Record<string, string>,
): Promise<MatrixColumn> {
    const receiptFile = join(scratch, '.spur/run', run.runId, 'receipts', 'work.json');
    const receiptExecutor = existsSync(receiptFile)
        ? ((JSON.parse(readFileSync(receiptFile, 'utf8')) as { executor?: string }).executor ?? null)
        : null;
    const shape = existsSync(receiptFile)
        ? receiptShapeOf(JSON.parse(readFileSync(receiptFile, 'utf8')) as Record<string, unknown>)
        : '';
    const trace = jsonOk<{ events: Record<string, unknown>[] }>(['workflow', 'trace', run.runId, '--json'], scratch, {
        env,
    });
    const verdict = runColumnVerdict(executor, { finalState: run.finalState, receiptExecutor });
    return {
        executor,
        status: verdict.status,
        runId: run.runId,
        finalState: run.finalState,
        actions: matrixActionsOf(trace.events),
        receiptShape: shape,
        precondition: verdict.status === 'blocked' ? verdict.reason : null,
        evidence:
            verdict.reason ??
            `${executor}: ${run.status} -> ${run.finalState}; receipt=${receiptExecutor ?? 'none'}; actions=${matrixActionsOf(trace.events).length}`,
    };
}

/**
 * The stable name of a fleet column's failed precondition. The dispatch reason carries volatile
 * ids (the scratch member instance and the run), which would make the receipt differ on every
 * run; the CLASS is what the operator acts on. Anything unrecognized passes through unchanged —
 * an unnamed block is never silently generalized.
 */
export function matrixPrecondition(reason: string): string {
    const invalid = /Invalid agent id "([^"]+)"/.exec(reason);
    if (invalid !== null) {
        return (
            `fleet dispatch rejected the sender id '${(invalid[1] ?? '').replace(/[0-9a-f-]{36}/i, '<runId>')}' ` +
            '(validateAgentId: 2-64 chars, lowercase alphanumeric, "_" or "-") — the fleet surface cannot post ' +
            'a keyed message from a workflow run'
        );
    }
    return reason;
}

/** Token-minimal receipt for a column that could not run: `blocked` NAMES the precondition. */
function blockedColumn(executor: MatrixExecutor, precondition: string): MatrixColumn {
    return {
        executor,
        status: 'blocked',
        runId: null,
        finalState: null,
        actions: [],
        receiptShape: '',
        precondition,
        evidence: `blocked: ${precondition}`,
    };
}

export async function runExecutorMatrix(options: { keep?: boolean } = {}): Promise<number> {
    const scratch = join(realpathSync(tmpdir()), `spur-executor-matrix-${Date.now()}`);
    const binDir = join(scratch, 'bin');
    // The registry files live in the scratch dir: the matrix must not contend for (or write) the
    // operator's global project registry, which is what a sibling spur process's lock blocks.
    const env = {
        PATH: matrixPath(binDir),
        SPUR_HITL_AUTO_APPROVE: '1',
        SPUR_PROJECTS_FILE: join(scratch, 'projects.json'),
        SPUR_SLASH_COMMANDS_FILE: join(scratch, 'slash_commands.json'),
    };
    const columns: MatrixColumn[] = [];
    let db: Awaited<ReturnType<typeof createMigratedDb>> | undefined;
    const loopPids: number[] = [];

    try {
        await scaffoldMatrixProject(scratch, binDir, env);

        // ── host ────────────────────────────────────────────────────────────────
        try {
            // A host run PAUSES: `spur workflow run` exits 1 for any non-done status, so this reads
            // the JSON rather than treating the pause as a harness error.
            const run = jsonOf<MatrixRunResult>(
                cli(['workflow', 'run', MATRIX_FIXTURE_PATH, '--vars', '{"executor":"host"}', '--json'], scratch, {
                    env,
                }),
            );
            const workItem = run.pause?.workItem;
            const pause =
                run.status === 'paused' && workItem?.state === 'work' && workItem.runId === run.runId
                    ? { runId: run.runId, state: 'work', expectFiles: workItem.expectFiles ?? [] }
                    : null;
            // The mismatch probe: a receipt whose runId is NOT this run must be refused. It is
            // written beside the real one so the refusal is never served from a stale path.
            const mismatched = join(scratch, '.spur/run', run.runId, 'receipts', 'mismatched.json');
            mkdirSync(dirname(mismatched), { recursive: true });
            writeFileSync(
                mismatched,
                JSON.stringify(
                    {
                        runId: 'not-this-run',
                        state: 'work',
                        executor: 'host',
                        outcome: 'done',
                        startedAt: new Date().toISOString(),
                        finishedAt: null,
                        files: [],
                        reason: null,
                    },
                    null,
                    2,
                ),
            );
            const refused = cli(
                ['workflow', 'continue', run.runId, '--answer-text', mismatched, '--yes', '--json'],
                scratch,
                { env },
            );
            // The host's work: write the declared artifact, then its receipt (design §4.2).
            mkdirSync(join(scratch, '.spur/run'), { recursive: true });
            writeFileSync(join(scratch, MATRIX_TARGET_FILE), 'executor-matrix host result\n');
            const receiptFile = join(scratch, '.spur/run', run.runId, 'receipts', 'work.json');
            writeFileSync(
                receiptFile,
                JSON.stringify(
                    {
                        runId: run.runId,
                        state: 'work',
                        executor: 'host',
                        outcome: 'done',
                        startedAt: new Date().toISOString(),
                        finishedAt: new Date().toISOString(),
                        files: [MATRIX_TARGET_FILE],
                        reason: null,
                    },
                    null,
                    2,
                ),
            );
            const resumed = jsonOk<MatrixRunResult>(
                ['workflow', 'continue', run.runId, '--answer-text', receiptFile, '--yes', '--json'],
                scratch,
                { env },
            );
            const verdict = hostColumnVerdict({
                pause,
                mismatchedReceiptExitCode: refused.exitCode,
                finalState: resumed.finalState,
            });
            const trace = jsonOk<{ events: Record<string, unknown>[] }>(
                ['workflow', 'trace', run.runId, '--json'],
                scratch,
                { env },
            );
            columns.push({
                executor: 'host',
                status: verdict.status,
                runId: run.runId,
                finalState: resumed.finalState,
                actions: matrixActionsOf(trace.events),
                receiptShape: receiptShapeOf(JSON.parse(readFileSync(receiptFile, 'utf8')) as Record<string, unknown>),
                precondition: null,
                evidence:
                    verdict.reason ??
                    `paused at work with the work item; mismatched receipt refused (exit ${refused.exitCode}); resumed -> ${resumed.finalState}`,
            });
        } catch (error) {
            columns.push({
                executor: 'host',
                status: 'failed',
                runId: null,
                finalState: null,
                actions: [],
                receiptShape: '',
                precondition: null,
                evidence: `error: ${errorMessage(error)}`,
            });
        }

        // ── subprocess ──────────────────────────────────────────────────────────
        try {
            const run = jsonOk<MatrixRunResult>(['workflow', 'run', MATRIX_FIXTURE_PATH, '--json'], scratch, { env });
            columns.push(await matrixColumn(scratch, 'subprocess', run, env));
        } catch (error) {
            columns.push({
                executor: 'subprocess',
                status: 'failed',
                runId: null,
                finalState: null,
                actions: [],
                receiptShape: '',
                precondition: null,
                evidence: `error: ${errorMessage(error)}`,
            });
        }

        // ── fleet: the scratch fleet this harness scaffolds, or a named precondition ──
        let precondition: string | null = null;
        let coderId: string | null = null;
        try {
            const specs = jsonOk<{ specs: Array<{ id: string }> }>(['agent', 'list', '--specs', '--json'], scratch, {
                env,
            });
            coderId = specs.specs.map((spec) => spec.id).find((id) => id.endsWith(`-${CODER_LOCAL_ID}`)) ?? null;
            if (coderId === null) throw new Error(`the scratch fleet declared no ${CODER_LOCAL_ID} member`);
            db = await createMigratedDb({ url: join(scratch, '.spur/spur.db') });
            const openDb = db;
            // The loop inherits the matrix's whole env: its PATH (stub + shim) and the scratch
            // registry, so it neither resolves a real agent nor contends for the operator's
            // global `projects.json` lock.
            loopPids.push(spawnLoop(scratch, matrixRunState(scratch, binDir), coderId, '-matrix', env));
            await pollUntil(
                "the fleet coder's recorded member session",
                async () => {
                    const sessions = await readMemberSessions(openDb, [coderId ?? '']);
                    return sessions.size > 0 ? sessions : undefined;
                },
                BOUNDS.loops,
            );
        } catch (error) {
            precondition = `fleet scaffolding: ${errorMessage(error)}`;
        }
        if (precondition !== null) {
            columns.push(blockedColumn('fleet', precondition));
        } else {
            try {
                const result = cli(
                    ['workflow', 'run', MATRIX_FIXTURE_PATH, '--vars', '{"executor":"fleet"}', '--json'],
                    scratch,
                    { env },
                );
                const run = jsonOf<MatrixRunResult>(result);
                const column = await matrixColumn(scratch, 'fleet', run, env);
                // A fleet surface that is unavailable BEFORE dispatch is the scaffolding
                // precondition, not a contract failure: report it blocked and name it.
                if (column.status === 'failed' && /fleet executor unavailable/i.test(run.reason ?? '')) {
                    columns.push(
                        blockedColumn('fleet', matrixPrecondition(run.reason ?? 'fleet executor unavailable')),
                    );
                } else {
                    columns.push(column);
                }
            } catch (error) {
                columns.push({
                    executor: 'fleet',
                    status: 'failed',
                    runId: null,
                    finalState: null,
                    actions: [],
                    receiptShape: '',
                    precondition: null,
                    evidence: `error: ${errorMessage(error)}`,
                });
            }
        }
    } finally {
        for (const pid of loopPids) {
            try {
                process.kill(pid, 'SIGTERM');
            } catch {
                /* already gone */
            }
        }
        if (db !== undefined) {
            try {
                db.close();
            } catch {
                /* the scratch db is removed with the dir */
            }
        }
        const resolvedScratch = resolve(scratch);
        const resolvedTmp = realpathSync(tmpdir());
        // `--keep` keeps the scratch project for diagnosis (loop logs, DB rows, stub prompts);
        // a removed scratch destroys the only evidence a blocked column had.
        if (options.keep === true) {
            console.log(`executor matrix: scratch kept at ${resolvedScratch} (--keep)`);
        } else if (resolvedScratch.startsWith(`${resolvedTmp}/`)) {
            try {
                rmSync(resolvedScratch, { recursive: true, force: true });
            } catch {
                /* best effort: the receipt is already the evidence */
            }
        }
    }

    const mismatches = compareMatrixColumns(columns);
    const receipt: MatrixReceipt = {
        schemaVersion: 1,
        generatedAt: nowLabel(),
        fixture: 'packages/app/tests/fixtures/1238/executor-matrix-fixture.yaml',
        projectPath: scratch,
        columns,
        comparison: {
            identical: mismatches.length === 0,
            compared: columns.filter((column) => column.status !== 'blocked').length,
            mismatches,
        },
    };
    mkdirSync(dirname(MATRIX_RECEIPT_PATH), { recursive: true });
    writeFileSync(MATRIX_RECEIPT_PATH, `${JSON.stringify(receipt, null, 4)}\n`);

    console.log(`executor matrix receipt: ${MATRIX_RECEIPT_PATH}`);
    for (const column of columns) {
        const word = column.status === 'passed' ? 'ok  ' : column.status === 'blocked' ? 'BLOCK' : 'FAIL';
        console.log(`  ${word} ${column.executor}: ${trimmed(column.evidence, 160)}`);
    }
    for (const mismatch of mismatches) console.error(`executor matrix: ${mismatch}`);
    return matrixExitCode(columns);
}

/** The loop-side state the matrix's fleet column needs (the stub binary and its prompt log). */
function matrixRunState(scratch: string, binDir: string): RunState {
    return {
        scratch,
        binDir,
        stubPath: join(binDir, AGENT_TYPE),
        stubLog: join(scratch, 'stub-prompts.jsonl'),
        plannerId: '',
        coderId: '',
        featureId: null,
        wbs: null,
        dispatchMessageId: null,
        dispatchRunId: null,
        replyMessageId: null,
        guestId: null,
        guestJoinCliEntry: CLI_ENTRY,
        guestJoinCliLabel: 'spur',
        loopPids: [],
        rows: new Map(),
        ids: {},
    };
}

// ── Host capability probe (G75 R2, task 1280) ─────────────────────────────────────
//
// Reports what each host can PROVE on this machine, never what it might support: a wake value
// must cite the probe command and the observed output that produced it, and anything unproven is
// `pull-only` with an actionable reason. The default lane never launches a real host — it probes
// binaries and runs scripted fixture hosts through the durable inbox with hooks absent.

/** Where the capability report lands (the task's artifact, AC1). */
export const HOST_PROBE_REPORT_PATH = join(REPO_ROOT, 'docs/reports/fleet-host-capabilities.json');

/** Hosts the probe reports on: one row each per mode. */
export const HOST_PROBE_AGENTS = ['codex', 'claude', 'pi'] as const;

/** The two modes a host is probed in; they have different wake surfaces. */
export const HOST_PROBE_MODES = ['interactive', 'headless'] as const;

/** One fixture host, spawned as a real child process (hooks absent). */
const HOST_PROBE_FIXTURE = join(REPO_ROOT, 'scripts/commands/fixtures/fleet-host-fixture.ts');

/** How a host can be woken; `pull-only` is the always-supported fallback. */
export type HostWake = 'hook' | 'rpc' | 'app-server' | 'pull-only';

/** Host mode the row describes. */
export type HostMode = (typeof HOST_PROBE_MODES)[number];

/** One host×mode capability row. */
export interface HostCapabilityRow {
    agent: string;
    mode: HostMode;
    binary: { path: string; version: string } | 'absent';
    wake: HostWake;
    evidence: { command: string; output: string } | null;
    reason?: string;
    e2e?: { status: 'passed' | 'failed'; detail: string };
}

/** The tracked capability report (AC1). */
export interface HostCapabilityReport {
    schemaVersion: 1;
    generatedAt: string;
    hosts: HostCapabilityRow[];
}

/** Redact secrets and the operator's home prefix from verbatim probe output. */
export function redactProbeOutput(text: string): string {
    const home = getEnvVar('HOME');
    return text
        .replace(/(sk-|ghp_|gho_|xox[bp]-|AKIA)[A-Za-z0-9_-]{8,}/g, '[redacted]')
        .split(home !== undefined && home !== '' ? home : '\u0000')
        .join('~');
}

/**
 * Classify a host's wake channel from its installed `--help` surface. Headless mode never has a
 * host callback channel, so it is `pull-only` regardless of what the binary advertises.
 */
export function classifyHostWake(input: { mode: HostMode; helpText: string }): {
    wake: HostWake;
    reason?: string;
} {
    if (input.mode === 'headless') {
        return {
            wake: 'pull-only',
            reason: 'headless mode has no host callback channel — the durable inbox pull loop is the delivery path',
        };
    }
    const text = input.helpText.toLowerCase();
    // Precedence is specificity, not wording: a host that exposes a long-lived server endpoint can
    // be woken by a connection, which is a stronger channel than a flag that merely names hooks
    // (Codex advertises `--dangerously-bypass-hook-trust` while its wake channel is the App Server).
    if (/app[- ]server/.test(text)) return { wake: 'app-server' };
    if (/\bhooks?\b/.test(text)) return { wake: 'hook' };
    if (/\brpc\b/.test(text)) return { wake: 'rpc' };
    return {
        wake: 'pull-only',
        reason: 'installed help text names no hook, RPC or App Server surface',
    };
}

/**
 * Build one row. Two invariants live here rather than in prose: an absent binary can never claim a
 * wake channel, and a non-`pull-only` wake without recorded evidence is downgraded — an unprovable
 * capability is not a capability (R3).
 */
export function buildHostRow(input: {
    agent: string;
    mode: HostMode;
    binary: { path: string; version: string } | null;
    helpText: string;
    evidence: { command: string; output: string } | null;
    e2e?: { status: 'passed' | 'failed'; detail: string };
}): HostCapabilityRow {
    const e2e = input.e2e === undefined ? {} : { e2e: input.e2e };
    if (input.binary === null) {
        return {
            agent: input.agent,
            mode: input.mode,
            binary: 'absent',
            wake: 'pull-only',
            evidence: null,
            reason: `${input.agent} is not installed on PATH — pull-only until the binary is present`,
            ...e2e,
        };
    }
    const binary = { path: redactProbeOutput(input.binary.path), version: redactProbeOutput(input.binary.version) };
    const classified = classifyHostWake({ mode: input.mode, helpText: input.helpText });
    const evidence =
        input.evidence === null
            ? null
            : { command: redactProbeOutput(input.evidence.command), output: redactProbeOutput(input.evidence.output) };
    if (classified.wake !== 'pull-only' && evidence === null) {
        return {
            agent: input.agent,
            mode: input.mode,
            binary,
            wake: 'pull-only',
            evidence: null,
            reason: `help text suggests ${classified.wake} but no probe evidence was recorded — unproven, so pull-only`,
            ...e2e,
        };
    }
    return {
        agent: input.agent,
        mode: input.mode,
        binary,
        wake: classified.wake,
        evidence,
        ...(classified.reason === undefined ? {} : { reason: classified.reason }),
        ...e2e,
    };
}

/** Contract check over the whole report; returns the violations, empty when it holds. */
export function hostReportViolations(report: HostCapabilityReport): string[] {
    const violations: string[] = [];
    if (report.schemaVersion !== 1) violations.push('schemaVersion must be 1');
    const seen = new Set<string>();
    for (const row of report.hosts) {
        const key = `${row.agent}:${row.mode}`;
        if (seen.has(key)) violations.push(`duplicate row for ${key}`);
        seen.add(key);
        if (!(HOST_PROBE_AGENTS as readonly string[]).includes(row.agent))
            violations.push(`unknown agent "${row.agent}"`);
        if (!(HOST_PROBE_MODES as readonly string[]).includes(row.mode)) violations.push(`unknown mode "${row.mode}"`);
        if (row.wake !== 'pull-only' && row.evidence === null) {
            violations.push(`${key}: wake "${row.wake}" cites no probe evidence`);
        }
        if (row.binary === 'absent' && row.wake !== 'pull-only') {
            violations.push(`${key}: absent binary cannot advertise wake "${row.wake}"`);
        }
        if (row.binary === 'absent' && row.evidence !== null) {
            violations.push(`${key}: absent binary carries evidence`);
        }
        if (row.wake === 'pull-only' && row.binary !== 'absent' && row.reason === undefined) {
            violations.push(`${key}: pull-only needs an actionable reason`);
        }
    }
    for (const agent of HOST_PROBE_AGENTS) {
        for (const mode of HOST_PROBE_MODES) {
            if (!seen.has(`${agent}:${mode}`)) violations.push(`missing row for ${agent}:${mode}`);
        }
    }
    return violations;
}

/** Run one host binary with a bounded budget; a missing or failing binary reads as empty output. */
function runHostBinary(path: string, args: string[]): { exitCode: number; output: string } {
    try {
        const proc = Bun.spawnSync([path, ...args], { stdout: 'pipe', stderr: 'pipe', timeout: 20_000 });
        const stdout = proc.stdout?.toString() ?? '';
        const stderr = proc.stderr?.toString() ?? '';
        // Full text: the capability line can sit anywhere in a 200-line `--help`. The REPORT
        // records only the matched line, so this is not a size risk in the artifact.
        return { exitCode: proc.exitCode ?? 1, output: `${stdout}\n${stderr}` };
    } catch (error) {
        return { exitCode: 1, output: trimmed(errorMessage(error), 200) };
    }
}

/**
 * The `--help` line that proves a wake channel, or null. The report cites this one line — the
 * observation a reader can re-run — instead of a truncated help dump.
 */
export function wakeEvidenceLine(helpText: string, wake: HostWake): string | null {
    const pattern =
        wake === 'hook' ? /\bhooks?\b/i : wake === 'rpc' ? /\brpc\b/i : wake === 'app-server' ? /app[- ]server/i : null;
    if (pattern === null) return null;
    const matches = helpText.split('\n').filter((line) => pattern.test(line));
    // Prefer a line that documents the surface over one that disables or bypasses it — `--bare
    // Minimal mode: skip hooks` proves hooks exist but says nothing about a wake channel.
    const positive = matches.find((line) => !/skip|bypass|disable|without|no-?hooks/i.test(line));
    const chosen = positive ?? matches[0];
    return chosen === undefined ? null : trimmed(chosen, 300);
}

/** Probe one installed binary: path, version line, and the help text the wake class comes from. */
function probeHostBinary(agent: string): {
    binary: { path: string; version: string } | null;
    helpText: string;
    helpCommand: string;
} {
    const path = Bun.which(agent);
    if (path === null) return { binary: null, helpText: '', helpCommand: `${agent} --help` };
    const version = runHostBinary(path, ['--version']);
    const help = runHostBinary(path, ['--help']);
    const versionLine = version.output.split('\n')[0]?.trim() ?? '';
    return {
        binary: { path, version: versionLine === '' ? 'unknown' : versionLine },
        helpText: help.exitCode === 0 ? help.output : '',
        helpCommand: `${agent} --help`,
    };
}

/** Evidence for one host×mode row: the matched help line, or null when nothing proves a channel. */
function probeEvidence(
    probe: ReturnType<typeof probeHostBinary>,
    mode: HostMode,
): { command: string; output: string } | null {
    const { wake } = classifyHostWake({ mode, helpText: probe.helpText });
    const line = wakeEvidenceLine(probe.helpText, wake);
    return line === null ? null : { command: probe.helpCommand, output: line };
}

/**
 * Run one scripted fixture host through the portable loop with hooks absent (AC2): the child
 * process joins, the harness sends a bounded request, the child pulls it with `wait --inbox`,
 * replies and leaves, and the operator inbox must show the reply linked to that request.
 */
async function runFixtureHost(
    scratch: string,
    agent: string,
    env: Record<string, string>,
): Promise<{ status: 'passed' | 'failed'; detail: string }> {
    const guestId = `probe-${agent}`;
    const resultPath = join(scratch, `host-${agent}.json`);
    const child = Bun.spawn([process.execPath, 'run', HOST_PROBE_FIXTURE], {
        cwd: scratch,
        env: {
            ...getEnvVars(),
            ...env,
            SPUR_E2E_CLI: CLI_ENTRY,
            SPUR_E2E_PROJECT: scratch,
            SPUR_E2E_HOST_AGENT: agent,
            SPUR_E2E_GUEST_ID: guestId,
            SPUR_E2E_RESULT: resultPath,
        },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    try {
        // The request must arrive while the guest is waiting, so wait for the record it writes first.
        await pollUntil(
            `the ${agent} fixture guest record`,
            async () => (existsSync(join(scratch, '.spur/run/guests', `${guestId}.json`)) ? true : undefined),
            30_000,
        );
        const request = jsonOk<{ msgId: string }>(
            ['message', 'send', '--to', guestId, `host probe request: ${agent}`, '--json'],
            scratch,
            { env },
        );
        await child.exited;
        if (!existsSync(resultPath)) return { status: 'failed', detail: `fixture ${agent} wrote no result file` };
        const result = JSON.parse(readFileSync(resultPath, 'utf8')) as {
            ok?: boolean;
            error?: string;
            steps?: Array<{ command: string; exitCode: number }>;
        };
        if (result.ok !== true) {
            return { status: 'failed', detail: `fixture-lane: ${result.error ?? 'fixture failed'}` };
        }
        const inbox = jsonOk<{ messages: Array<{ id: string; inReplyTo: string | null }> }>(
            ['message', 'inbox', '--agent', 'operator', '--json'],
            scratch,
            { env },
        );
        const linked = inbox.messages.find((message) => message.inReplyTo === request.msgId);
        if (linked === undefined) {
            return { status: 'failed', detail: `fixture-lane: no reply linked to request ${request.msgId}` };
        }
        return {
            status: 'passed',
            detail: `fixture-lane (hooks absent): ${guestId} joined → wait --inbox pulled ${request.msgId} → replied ${linked.id} → left`,
        };
    } finally {
        child.kill();
    }
}

/** The prompt a real host receives in the opt-in `--real-hosts` lane. */
function realHostPrompt(guestId: string, agent: string): string {
    return [
        'You are joining a local agent fleet as a guest. Run these commands in order with this shell:',
        `1. spur agent join --role reviewer --id ${guestId} --json`,
        `2. spur agent wait --inbox ${guestId} --timeout 30000 --json`,
        '3. spur message reply <msgId> "<one line result>" --json',
        `4. spur agent leave ${guestId} --json`,
        `Then print the single word DONE. You are the ${agent} host; no hooks are installed.`,
    ].join('\n');
}

/** Non-interactive prompt flags per host, used only by the opt-in real-host lane. */
const REAL_HOST_ARGV: Record<string, (prompt: string) => string[]> = {
    claude: (prompt) => ['-p', prompt],
    codex: (prompt) => ['exec', prompt],
    pi: (prompt) => ['-p', prompt],
};

/**
 * The opt-in real-host lane (AC3): launch each installed host in its non-interactive mode and
 * record either the end-to-end result or the exact failure. Never reached without `--real-hosts`.
 */
async function runRealHost(
    scratch: string,
    agent: string,
    path: string,
    env: Record<string, string>,
): Promise<{ status: 'passed' | 'failed'; detail: string }> {
    const argv = REAL_HOST_ARGV[agent];
    if (argv === undefined) {
        return { status: 'failed', detail: `real-host: no non-interactive invocation is known for ${agent}` };
    }
    const guestId = `real-${agent}`;
    const child = Bun.spawn([path, ...argv(realHostPrompt(guestId, agent))], {
        cwd: scratch,
        env: { ...getEnvVars(), ...env },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    try {
        const joined = await pollUntil(
            `the ${agent} real-host guest record`,
            async () => (existsSync(join(scratch, '.spur/run/guests', `${guestId}.json`)) ? true : undefined),
            90_000,
        ).catch(() => undefined);
        if (joined === undefined) {
            const stderr = trimmed(await new Response(child.stderr as ReadableStream).text().catch(() => ''), 200);
            child.kill();
            return {
                status: 'failed',
                detail: `real-host: ${agent} never joined the fleet${stderr === '' ? '' : ` — ${stderr}`}`,
            };
        }
        const request = jsonOk<{ msgId: string }>(
            ['message', 'send', '--to', guestId, `real host probe: ${agent}`, '--json'],
            scratch,
            { env },
        );
        const inbox = await pollUntil(
            `the ${agent} real-host reply`,
            async () => {
                const rows = jsonOk<{ messages: Array<{ id: string; inReplyTo: string | null }> }>(
                    ['message', 'inbox', '--agent', 'operator', '--json'],
                    scratch,
                    { env },
                );
                return rows.messages.find((message) => message.inReplyTo === request.msgId);
            },
            120_000,
        );
        return {
            status: 'passed',
            detail: `real-host: ${agent} joined, pulled ${request.msgId} and replied ${inbox.id}`,
        };
    } catch (error) {
        return { status: 'failed', detail: `real-host: ${trimmed(errorMessage(error), 200)}` };
    } finally {
        child.kill();
    }
}

/**
 * `fleet-e2e --host-probe [--real-hosts] [--agents <csv>]` (task 1280).
 *
 * Writes `docs/reports/fleet-host-capabilities.json` — one row per host×mode — and proves the
 * portable loop with hooks absent through one scripted fixture host per executor. The real-host
 * lane is strictly opt-in and records the exact failure rather than manufacturing a pass.
 */
export async function runHostProbe(
    options: { realHosts?: boolean; agents?: string[]; keep?: boolean } = {},
): Promise<number> {
    const agents = options.agents ?? [...HOST_PROBE_AGENTS];
    const unknown = agents.filter((agent) => !(HOST_PROBE_AGENTS as readonly string[]).includes(agent));
    if (unknown.length > 0) {
        console.error(
            `fleet-e2e: unknown --agents entries: ${unknown.join(', ')} (known: ${HOST_PROBE_AGENTS.join(', ')})`,
        );
        return 2;
    }
    const scratch = join(realpathSync(tmpdir()), `spur-host-probe-${Date.now()}`);
    const env = {
        PATH: getEnvVar('PATH') ?? '',
        SPUR_PROJECTS_FILE: join(scratch, 'projects.json'),
        SPUR_SLASH_COMMANDS_FILE: join(scratch, 'slash_commands.json'),
    };
    const rows: HostCapabilityRow[] = [];
    try {
        rmSync(scratch, { recursive: true, force: true });
        mkdirSync(scratch, { recursive: true });
        Bun.spawnSync(['git', 'init', '-q', '.'], { cwd: scratch });
        cliOk(['self', 'init', '--json'], scratch, { env });

        const e2eByAgent = new Map<string, { status: 'passed' | 'failed'; detail: string }>();
        for (const agent of agents) {
            // Only the requested agents run e2e; the unrequested ones still get rows (AC1's
            // "one row per host×mode"), with the absence recorded rather than invented.
            if (options.realHosts === true) {
                const probe = probeHostBinary(agent);
                e2eByAgent.set(
                    agent,
                    probe.binary === null
                        ? { status: 'failed', detail: `real-host: ${agent} is not installed on PATH` }
                        : await runRealHost(scratch, agent, probe.binary.path, env),
                );
            } else {
                e2eByAgent.set(agent, await runFixtureHost(scratch, agent, env));
            }
        }

        for (const agent of HOST_PROBE_AGENTS) {
            const probe = probeHostBinary(agent);
            const e2e = e2eByAgent.get(agent);
            for (const mode of HOST_PROBE_MODES) {
                rows.push(
                    buildHostRow({
                        agent,
                        mode,
                        binary: probe.binary,
                        helpText: probe.helpText,
                        evidence: probeEvidence(probe, mode),
                        ...(e2e === undefined || mode !== 'interactive' ? {} : { e2e }),
                    }),
                );
            }
        }

        const report: HostCapabilityReport = {
            schemaVersion: 1,
            generatedAt: nowLabel(),
            hosts: rows,
        };
        const violations = hostReportViolations(report);
        if (violations.length > 0) {
            console.error(`fleet-e2e: host report violates its contract: ${violations.join('; ')}`);
            return 1;
        }
        mkdirSync(dirname(HOST_PROBE_REPORT_PATH), { recursive: true });
        writeFileSync(HOST_PROBE_REPORT_PATH, `${JSON.stringify(report, null, 4)}\n`);
        console.log(`fleet-e2e host probe: ${HOST_PROBE_REPORT_PATH}`);
        for (const row of report.hosts) {
            const binary = row.binary === 'absent' ? 'absent' : row.binary.version;
            console.log(`  ${row.agent}/${row.mode}: wake=${row.wake} binary=${trimmed(binary, 40)}`);
        }
        const failed = report.hosts.filter((row) => row.e2e?.status === 'failed');
        if (failed.length > 0) {
            for (const row of failed) console.error(`  FAIL ${row.agent}: ${row.e2e?.detail ?? ''}`);
            return 1;
        }
        return 0;
    } finally {
        if (options.keep !== true) rmSync(scratch, { recursive: true, force: true });
    }
}

/**
 * The E2E. Execution order is NOT the receipt's row order: the strategy wedge recorded under
 * `strategy-retry-unreachable` allows exactly ONE strategy dispatch per project, so the
 * kill/resume half of that single turn has to happen before `dispatch-to-done` can observe the
 * task closing. Rows are still reported in the design's order.
 */
// ══════════════════════════════ Perf mode (task 1273) ══════════════════════════════

/** Stable receipt names — overwritten each run, same policy as the E2E receipt (1077 Q&A). */
const PERF_RECEIPT_JSON = join(REPO_ROOT, 'docs/reports/fleet-perf-receipt.json');
const PERF_RECEIPT_MD = join(REPO_ROOT, 'docs/reports/fleet-perf-receipt.md');
/** The KPI target matrix (task Q&A): the agents the fleet measures. */
const PERF_AGENTS = ['claude', 'codex', 'pi'] as const;
/** One trial's deadline. The stub lane settles in seconds; this only bounds a genuinely hung turn. */
const PERF_TRIAL_TIMEOUT_MS = 90_000;
/** The fixed workload every trial runs — identical text, so the digest pins what was measured. */
const PERF_WORKLOAD = {
    title: 'Fleet perf trial task',
    ac: 'Scenario: AC1 - the fleet coder member closes this perf-trial task (req: R1)\n',
    design: 'The inbox-only GTD fleet dispatches this task to coder-1; the member process closes it.\n',
} as const;

export type PerfTrialStatus = 'validated' | 'failed' | 'timed-out' | 'cancelled';

/** One observed phase mark, joined from the system_events ledger (`fleet.phase.*`). */
export interface PerfPhaseMark {
    phase: string;
    at: string;
    /** In-process monotonic offset (ms) when the producer reported one. */
    monotonicMs?: number;
    /** Correlation id when the mark carries one (claim/turn marks). */
    executionId?: string;
}

export interface PerfTrial {
    agent: string;
    mode: 'cold' | 'resume' | 'warm';
    model: string;
    provider: string;
    reasoning: string;
    tokens: 'unavailable';
    resources: 'unavailable';
    status: PerfTrialStatus;
    /** enqueue → contract-validated, UTC wall clock on one host (same clock domain). */
    durationMs?: number;
    phases: PerfPhaseMark[];
    runId?: string;
    key?: string;
    /** The binary that executed the turn: the stub in this lane; host binaries stay provenance. */
    binary: { path: string; version: string | null } | null;
    /** The real host binary's `--version` — comparison context, not what ran. */
    hostBinaryVersion?: string;
    reason?: string;
}

export type { PerfMeasured } from './fleet-e2e-turn-perf';

/**
 * The warm-lane row (task 1276, G74 R1/AC1). Unlike `cold`/`resume` this row is QUALIFICATION
 * evidence, not a measurement: it names the installed binary, the version the driver was verified
 * against, and the driver's own verdict. It carries no latency — the lane's only trial modes are
 * `cold` and `resume`, so any number here would be a cold turn wearing a warm label, which is the
 * exact overclaim AC1 forbids.
 */
export interface PerfWarm {
    status: 'qualified' | 'unsupported';
    /** The driver's verdict, mirrored so a reader never has to re-derive it from `status`. */
    qualified: boolean;
    /** Probed binary; checkout-local paths are relative to the repository root. Null when absent. */
    binary: { path: string; version: string | null } | null;
    /** ts-ai-runner's registered driver for this agent (`null` = none registered yet). */
    driver: string | null;
    /** `AGENT_SESSION_CAPABILITY.<agent>.verifiedAgainst` — what the driver was verified against. */
    verifiedVersion: string | null;
    /** Pi's host PATH install and pinned repository dependency are distinct qualification inputs. */
    provenance?: PiProvenance;
    reason?: string;
}

interface PiProvenance {
    host: WarmProbe['binary'];
    repository: WarmProbe['binary'];
}

/** What {@link warmRow} needs: the registered driver plus the probed binary identity. */
export interface WarmProbe {
    driver: TurnSessionDriver | null;
    binary: { path: string; version: string | null } | null;
    verifiedVersion: string | null;
    provenance?: PiProvenance;
}

/**
 * Decide one agent's warm row (task 1276 R1). The driver's own `qualify()` is the ONLY verdict —
 * this function never second-guesses a version itself, so a new qualified release only needs the
 * driver to move. Every refusal keeps a name and still records the binary it refused (AC1: the
 * row says WHICH binary was qualified or refused).
 */
export function warmRow(agent: string, probe: WarmProbe): PerfWarm {
    // Persist local binary identities relative to the checkout; qualify the original probe below.
    const binary = receiptBinary(probe.binary);
    const base = {
        binary,
        driver: probe.driver?.agent ?? null,
        verifiedVersion: probe.verifiedVersion,
        ...(probe.provenance === undefined
            ? {}
            : {
                  provenance: {
                      host: receiptBinary(probe.provenance.host),
                      repository: receiptBinary(probe.provenance.repository),
                  },
              }),
    };
    if (probe.driver === null) {
        return {
            ...base,
            status: 'unsupported',
            qualified: false,
            reason: `no turn-session driver registered for agent '${agent}'`,
        };
    }
    if (probe.binary === null) {
        return { ...base, status: 'unsupported', qualified: false, reason: `${agent}: no installed binary resolved` };
    }
    if (probe.binary.version === null) {
        return {
            ...base,
            status: 'unsupported',
            qualified: false,
            reason: `${agent}: installed binary version could not be probed`,
        };
    }
    const qualification = probe.driver.qualify(probe.binary as TurnBinary);
    if (!qualification.qualified) {
        return { ...base, status: 'unsupported', qualified: false, reason: qualification.reason };
    }
    return { ...base, status: 'qualified', qualified: true };
}

function receiptBinary(binary: WarmProbe['binary']): WarmProbe['binary'] {
    if (binary === null) return null;
    return {
        ...binary,
        path: binary.path.startsWith(`${resolve(REPO_ROOT)}/`) ? relative(REPO_ROOT, binary.path) : binary.path,
    };
}

/** Bound every provenance probe too; a failed/hung version command supplies no qualified version. */
function probeVersion(command: { command: string; args: string[] }, timeoutMs: number): WarmProbe['binary'] {
    try {
        const proc = Bun.spawnSync([command.command, ...command.args], {
            stdout: 'pipe',
            stderr: 'pipe',
            timeout: timeoutMs,
            killSignal: 'SIGKILL',
        });
        return {
            path: Bun.which(command.command) ?? command.command,
            version:
                proc.exitCode === 0 ? (/[0-9]+\.[0-9]+\.[0-9]+[^\s]*/.exec(proc.stdout.toString())?.[0] ?? null) : null,
        };
    } catch {
        return null;
    }
}

/**
 * Probe the installed binary for the warm lane. Version parsing mirrors the runner's own
 * `resolveTurnBinary` (first `x.y.z` token on stdout), so the row qualifies exactly the binary a
 * real turn would spawn.
 */
export function probeWarm(agent: string, timeoutMs = 5_000): WarmProbe {
    const driver = TURN_SESSION_DRIVERS.get(agent as AgentName) ?? null;
    let verifiedVersion: string | null = null;
    try {
        verifiedVersion = getAgentSessionCapability(agent as AgentName).verifiedAgainst;
    } catch {
        // An agent ts-ai-runner does not know has no capability row; the driver lookup already
        // refused it, so this stays evidence-free rather than throwing out of the perf lane.
        verifiedVersion = null;
    }
    let binary: WarmProbe['binary'] = null;
    try {
        binary = probeVersion(getAgentShim(agent as AgentName).getVersionCommand(), timeoutMs);
    } catch {
        binary = null;
    }
    if (agent !== 'pi') return { driver, binary, verifiedVersion };
    // `bun run` prepends the repository bin directory. Remove only that directory to identify
    // the separate host installation; never substitute it for the executable actually selected.
    const repositoryBin = resolve(REPO_ROOT, 'node_modules/.bin');
    const hostPath = (getEnvVar('PATH') ?? '')
        .split(':')
        .filter((path) => resolve(path) !== repositoryBin)
        .join(':');
    const hostPi = Bun.which('pi', { PATH: hostPath });
    return {
        driver,
        binary,
        verifiedVersion,
        provenance: {
            host: hostPi === null ? null : probeVersion({ command: hostPi, args: ['--version'] }, timeoutMs),
            repository: probeVersion({ command: join(repositoryBin, 'pi'), args: ['--version'] }, timeoutMs),
        },
    };
}

export interface PerfReceipt {
    schemaVersion: 1;
    generatedAt: string;
    revision: string;
    repeatCommand: string;
    workloadDigest: string;
    targets: { provisional: true; note: string; agents: readonly string[] };
    trials: PerfTrial[];
    measured: Record<string, { cold: PerfMeasured; resume: PerfMeasured; warm: PerfWarm }>;
    turnComparison: TurnPerfComparison;
}

/** `--version` of the real host binary (probe targets), or null when absent. */
function hostBinaryVersion(bin: string): string | undefined {
    const proc = Bun.spawnSync([bin, '--version'], { stdout: 'pipe', stderr: 'pipe' });
    const text = proc.stdout.toString().trim().split('\n')[0] ?? '';
    return proc.exitCode === 0 && text !== '' ? text : undefined;
}

/** One agent column's scratch project: the E2E leg-1 scaffold, verbatim primitives. */
export async function scaffoldPerfProject(
    agent: string,
    options: { realAgents: boolean } = { realAgents: false },
): Promise<{
    scratch: string;
    binDir: string;
    stubPath: string;
    stubLog: string;
    plannerId: string;
    coderId: string;
    loopPids: number[];
    openDb(): Promise<Awaited<ReturnType<typeof createMigratedDb>>>;
}> {
    const scratch = join(realpathSync(tmpdir()), `spur-fleet-perf-${agent}-${Date.now()}`);
    const binDir = join(scratch, 'bin');
    const stubPath = join(binDir, AGENT_TYPE);
    const stubLog = join(scratch, 'stub-prompts.jsonl');
    rmSync(scratch, { recursive: true, force: true });
    mkdirSync(binDir, { recursive: true });
    Bun.spawnSync(['git', 'init', '-q', '.'], { cwd: scratch });
    cliOk(['self', 'init', '--json'], scratch);
    // The planner loop scans docs/tasks at startup — leg 1 creates the task before its loops
    // start, but the perf trials spawn loops first, so the dir must exist up front.
    mkdirSync(join(scratch, 'docs/tasks'), { recursive: true });
    writeFileSync(
        join(scratch, '.spur/config.yaml'),
        `${readFileSync(join(scratch, '.spur/config.yaml'), 'utf8')}${fleetConfigSection(options.realAgents ? agent : AGENT_TYPE)}`,
    );
    // The real-agent lane must NOT leave a fake binary named after the agent in the scratch tree:
    // the member resolves `claude` from PATH, and a stray stub would shadow the installed binary
    // for anyone reading the kept scratch project (task 1276 R1).
    if (!options.realAgents) {
        writeFileSync(stubPath, stubSource());
        chmodSync(stubPath, 0o755);
    }
    const db = await createMigratedDb({ url: join(scratch, '.spur/spur.db') });
    const runtime = new StrategyRuntime({ openDb: async () => db } as never);
    await runtime.reconcileStrategy(scratch, 'gtd');
    const ids = jsonOk<{ specs: Array<{ id: string }> }>(['agent', 'list', '--specs', '--json'], scratch).specs.map(
        (spec) => spec.id,
    );
    const localId = (suffix: string): string => {
        const found = ids.find((candidate) => candidate.endsWith(`-${suffix}`));
        if (found === undefined) throw new Error(`fleet did not resolve member ${suffix}: ${ids.join(', ')}`);
        return found;
    };
    return {
        scratch,
        binDir,
        stubPath,
        stubLog,
        plannerId: localId(PLANNER_LOCAL_ID),
        coderId: localId(CODER_LOCAL_ID),
        loopPids: [],
        openDb: async () => db,
    };
}

/** Create + prepare one perf-trial task (same readiness shape as the E2E done-task). */
function createPerfTask(scratch: string, hang: boolean): string {
    const feature = jsonOk<{ ref: { id: string } }>(
        ['feature', 'create', `Fleet perf ${Date.now()}`, '--json'],
        scratch,
    );
    const created = jsonOk<{ wbs: string }>(
        ['task', 'create', hang ? `${PERF_WORKLOAD.title} (hang)` : PERF_WORKLOAD.title, '--skip-ready', '--json'],
        scratch,
    );
    const wbs = created.wbs;
    cliOk(['task', 'update', wbs, '--ac-altitude', 'task-local', '--no-lifecycle'], scratch);
    cliOk(['task', 'update', wbs, '--ac-numbering', 'task-local', '--no-lifecycle'], scratch);
    cliOk(['task', 'update', wbs, '--feature', feature.ref.id, '--no-lifecycle'], scratch);
    cliOk(
        ['task', 'update', wbs, '--section', 'Acceptance Criteria', '--from-file', '/dev/stdin', '--no-lifecycle'],
        scratch,
        { input: PERF_WORKLOAD.ac },
    );
    cliOk(['task', 'update', wbs, '--section', 'Design', '--from-file', '/dev/stdin', '--no-lifecycle'], scratch, {
        input: PERF_WORKLOAD.design,
    });
    cliOk(
        [
            'task',
            'update',
            wbs,
            '--add-tag',
            'fleet:auto',
            ...(hang ? (['--add-tag', HANG_TAG] as const) : []),
            '--no-lifecycle',
        ],
        scratch,
    );
    cliOk(['task', 'update', wbs, 'todo', '--no-lifecycle'], scratch);
    return wbs;
}

interface PerfPhaseRowPayload {
    phase?: string;
    runId?: string;
    executionId?: string;
    taskId?: string;
    key?: string;
    ok?: boolean;
    monotonicMs?: number;
}

/** Every `fleet.phase.*` row in this scratch project, payload decoded. */
async function readPerfPhaseRows(
    dao: SystemEventDao,
): Promise<
    Array<{ name: string; at: string; sequence: number | null; runId: string | null; payload: PerfPhaseRowPayload }>
> {
    const rows = await dao.follow(0, 100_000);
    return rows
        .filter((row) => row.event_name.startsWith('fleet.phase.'))
        .map((row) => {
            // Task 1273: the ledger persists the v2 envelope {schemaVersion, data:{…}} —
            // read the bounded data block (fall back to a bare payload in tests).
            const parsed = row.payload_json === null ? {} : (JSON.parse(row.payload_json) as Record<string, unknown>);
            const data = (parsed.data ?? parsed) as PerfPhaseRowPayload;
            return {
                name: row.event_name.slice('fleet.phase.'.length),
                at: row.occurred_at,
                sequence: row.sequence,
                runId: row.run_id,
                payload: data,
            };
        });
}

// Biome format check is content-sensitive on JSON (short-array collapse at lineWidth 120), so
// hand-rolled stringify intermittently fails the repo gate; route the receipt through the repo's
// own formatter. shortcut: requires biome on PATH (repo devDependency); raw JSON if absent.
function writePerfReceipts(receipt: PerfReceipt, repeatCommand: string): void {
    const raw = `${JSON.stringify(receipt, null, 4)}\n`;
    const biome = Bun.which('biome') ?? `${import.meta.dir}/../../node_modules/.bin/biome`;
    const proc = Bun.spawnSync([biome, 'format', '--stdin-file-path', PERF_RECEIPT_JSON], {
        stdin: Buffer.from(raw),
        stdout: 'pipe',
        stderr: 'pipe',
    });
    writeFileSync(PERF_RECEIPT_JSON, proc.exitCode === 0 ? proc.stdout.toString() : raw);
    const lines: string[] = [
        '# Fleet performance receipt (task 1273)',
        '',
        `Generated: ${receipt.generatedAt}`,
        `Revision: ${receipt.revision}`,
        `Repeat: \`${repeatCommand}\``,
        `Workload digest: ${receipt.workloadDigest}`,
        'Executor settings: not applicable for deterministic stubs; real-agent defaults are unobserved. Token and resource usage: unavailable.',
        '',
        '> Provisional: the deterministic lane drives the SAME stub everywhere; host binaries are',
        '> provenance only. Deltas across agents mean nothing until the real-agent lane lands (1276–1278).',
        '',
        '## Trials',
        '',
        '| agent | mode | status | durationMs | phases observed | reason |',
        '| ----- | ---- | ------ | ---------- | --------------- | ------ |',
    ];
    for (const trial of receipt.trials) {
        lines.push(
            `| ${trial.agent} | ${trial.mode} | ${trial.status} | ${trial.durationMs ?? ''} | ${
                trial.phases.map((mark) => mark.phase).join('→') || 'none'
            } | ${trial.reason ?? ''} |`,
        );
    }
    lines.push('', '## Measured (p50/p95 of enqueue→validated, UTC wall clock, one host)', '');
    lines.push(
        '| agent | mode | p50Ms | p95Ms | completionRate | validatedPerHour |',
        '| ----- | ---- | ----- | ----- | -------------- | ---------------- |',
    );
    for (const [agent, modes] of Object.entries(receipt.measured)) {
        for (const [mode, m] of Object.entries(modes)) {
            if (mode === 'warm') {
                const warm = m as PerfWarm;
                lines.push(
                    warm.status === 'qualified'
                        ? `| ${agent} | ${mode} | — | — | — | — (qualified: ${warm.binary?.path ?? '?'} ${warm.binary?.version ?? '?'}, driver ${warm.driver ?? '?'}, verifiedAgainst ${warm.verifiedVersion ?? '?'}) |`
                        : `| ${agent} | ${mode} | — | — | — | — (${warm.reason ?? 'unsupported'}) |`,
                );
                continue;
            }
            const measuredRow = m as PerfMeasured;
            lines.push(
                measuredRow.status === 'unsupported'
                    ? `| ${agent} | ${mode} | — | — | — | — (${measuredRow.reason ?? 'unsupported'}) |`
                    : `| ${agent} | ${mode} | ${measuredRow.p50Ms ?? ''} | ${measuredRow.p95Ms ?? ''} | ${measuredRow.completionRate ?? ''} | ${measuredRow.validatedPerHour ?? ''} |`,
            );
        }
    }
    const piProvenance = receipt.measured.pi?.warm.provenance;
    if (piProvenance !== undefined) {
        lines.push(
            '',
            '## Pi executable provenance',
            '',
            '| install | path | version |',
            '| ------- | ---- | ------- |',
        );
        for (const [install, binary] of Object.entries(piProvenance)) {
            lines.push(`| ${install} | ${binary?.path ?? 'absent'} | ${binary?.version ?? 'unprobed'} |`);
        }
        lines.push('', 'The warm row qualifies the selected binary only; the other installation is provenance.');
    }
    lines.push(
        '',
        '## Paired keyed task-turn measurements (deterministic fixtures)',
        '',
        `Workload: ${receipt.turnComparison.workloadDigest}`,
        `Pinned settings: ${JSON.stringify(receipt.turnComparison.settings)}`,
        'Every mode uses the same bounded response and artifact contract. Pair order alternates.',
        'These measurements cover the real process/action-contract path with a local model fixture; they make no paid-model speed claim.',
        '',
        '| agent | mode | p50Ms | p95Ms | completionRate | validatedPerHour | child processes |',
        '| --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const [agent, modes] of Object.entries(receipt.turnComparison.measured)) {
        for (const [mode, row] of Object.entries(modes)) {
            lines.push(
                `| ${agent} | ${mode} | ${row.p50Ms ?? ''} | ${row.p95Ms ?? ''} | ${row.completionRate ?? 0} | ${row.validatedPerHour ?? ''} | ${receipt.turnComparison.processes[agent]?.[mode as PerfTrial['mode']] ?? ''} |`,
            );
        }
    }
    lines.push(
        '',
        'Notes: durations use UTC wall clock across processes (one host clock domain);',
        'per-phase `monotonicMs` stays in-process. `gates` has no observable in the stub lane',
        '(the stub closes tasks without running quality gates) and is recorded absent.',
        'Warm rows (tasks 1276-1278) record QUALIFICATION of the installed binary — driver verdict,',
        'binary path and version. The separate paired comparison measures cold/resume/warm task turns',
        'against one local fixture workload; its samples are not mixed with the fleet-task baseline.',
        'Repository-local binary paths are relative to the repository root; external paths stay absolute.',
        '',
    );
    writeFileSync(PERF_RECEIPT_MD, `${lines.join('\n')}\n`);
}

/**
 * `--perf` (task 1273): per target agent, scaffold a scratch fleet, drive `--trials` keyed
 * task turns (first = cold, rest = resume), join the `fleet.phase.*` marks from the real
 * ledger, and write paired-trial receipts. The stub lane never compares agent speed — it
 * proves the measurement pipeline and records baseline numbers with provenance.
 *
 * `--agents <csv>` narrows the measured columns; `--real-agents` (task 1276, opt-in) stops
 * shadowing the agent binary with the stub, so the member spawns the INSTALLED binary and a
 * correlated warm turn (task 1275 seam + a ts-ai-runner driver) can be measured for real. The
 * warm row is qualification evidence either way: it names the probed binary path and version and
 * the driver's own verdict, and carries a latency only when the real lane produced trials.
 */
export async function runFleetPerf(options: {
    trials: number;
    keep: boolean;
    injectFailure: StepName | null;
    realAgents: boolean;
    agents: readonly string[];
}): Promise<number> {
    const revision = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: REPO_ROOT });
    if (revision.exitCode !== 0) throw new Error('fleet-perf: cannot record the repository revision');
    const setting = options.realAgents ? 'unavailable (agent default)' : 'not-applicable (deterministic stub)';
    const trialContext = {
        model: setting,
        provider: setting,
        reasoning: setting,
        tokens: 'unavailable' as const,
        resources: 'unavailable' as const,
    };
    const targets = PERF_AGENTS.filter((agent) => options.agents.includes(agent));
    const warmProbes = new Map<string, WarmProbe>();
    for (const agent of targets) warmProbes.set(agent, probeWarm(agent));
    const repeatCommand = `bun run fleet-e2e --perf --trials ${options.trials}${options.realAgents ? ' --real-agents' : ''}${options.agents.length === PERF_AGENTS.length ? '' : ` --agents ${options.agents.join(',')}`}${options.injectFailure !== null ? ` --inject-failure ${options.injectFailure}` : ''}${options.keep ? ' --keep' : ''}`;
    const workloadDigest = `sha256:${createHash('sha256')
        .update(`${PERF_WORKLOAD.title}\n${PERF_WORKLOAD.ac}${PERF_WORKLOAD.design}`)
        .digest('hex')}`;
    const trials: PerfTrial[] = [];
    const failures: string[] = [];

    for (const agent of targets) {
        let project: Awaited<ReturnType<typeof scaffoldPerfProject>> | undefined;
        try {
            // `p` is the narrowed alias the async closures read; a captured `let` never narrows.
            const p = await scaffoldPerfProject(agent, { realAgents: options.realAgents });
            project = p;
            const hostVersion = hostBinaryVersion(agent);
            // The binary the row names: the stub in the deterministic lane, the installed binary
            // when the real-agent lane runs (task 1276 R1 — the row's provenance must be true).
            const binaryRow =
                (options.realAgents
                    ? (warmProbes.get(agent)?.binary ?? null)
                    : { path: p.stubPath, version: 'fleet-e2e-stub 1.0.0' }) ?? null;
            const dao = new SystemEventDao(await p.openDb());
            const runs = new CoordinationRunDao(await p.openDb());
            const inbox = new InboxService({ getDb: async () => await p.openDb() });
            for (const specId of [project.plannerId, project.coderId]) {
                p.loopPids.push(
                    spawnLoop(p.scratch, { binDir: options.realAgents ? '' : p.binDir, stubLog: p.stubLog }, specId),
                );
            }
            // Wait for the orchestrator claim so the first trial's dispatch has an owner.
            const claims = new ProjectClaimDao(await project.openDb());
            await pollUntil(
                `${agent}: the planner orchestrator claim`,
                async () => {
                    const claim = await claims.get(p.scratch, 'orchestrator');
                    return claim !== null && claim.expiresAt > Date.now() ? claim : undefined;
                },
                BOUNDS.loops,
            );

            const driveTrial = async (index: number, hang: boolean): Promise<void> => {
                const mode: 'cold' | 'resume' = index === 0 ? 'cold' : 'resume';
                const wbs = createPerfTask(p.scratch, hang);
                let runId: string | undefined;
                let key: string | undefined;
                try {
                    const settled = await pollUntil(
                        `${agent} trial ${index} (${mode}${hang ? ', hang-armed' : ''}) to settle`,
                        async () => {
                            const done = jsonOk<{ status: string }>(['task', 'show', wbs, '--json'], p.scratch);
                            if (hang) {
                                // A hang-armed trial never closes: its deadline below IS the trial's
                                // failure verdict. Any keyed attempt observed counts as settled enough
                                // to attribute phases.
                                const attempts = await inbox.taskAttempts(wbs);
                                if (attempts.length === 0) return undefined;
                                return true;
                            }
                            if (done.status !== 'done') return undefined;
                            const attemptRows = await inbox.taskAttempts(wbs);
                            const attempt = attemptRows[0]; // newest first
                            if (attempt === undefined) return undefined;
                            const runRows = await runs.listByMessageId(attempt.id);
                            const run = runRows[0];
                            if (run === undefined) return undefined;
                            runId = run.run_id;
                            key = attempt.requestKey ?? undefined;
                            return true;
                        },
                        PERF_TRIAL_TIMEOUT_MS,
                    );
                    void settled;
                    const allRows = await readPerfPhaseRows(dao);
                    const phases: PerfPhaseMark[] = allRows
                        .filter(
                            (row) =>
                                row.payload.taskId === wbs ||
                                (runId !== undefined && (row.runId === runId || row.payload.runId === runId)) ||
                                // Task 1273: the claim row is the only wbs-carrying row on the
                                // member side when the strategy row is missing (resumed scratch).
                                (key !== undefined && row.payload.key === key),
                        )
                        // Task 1273: order by wall clock — `sequence` is the emitting
                        // process's event counter, not a global insert order.
                        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
                        .map((row) => ({
                            phase: row.name,
                            at: row.at,
                            ...(row.payload.monotonicMs !== undefined ? { monotonicMs: row.payload.monotonicMs } : {}),
                            ...(typeof row.payload.executionId === 'string' && row.payload.executionId !== ''
                                ? { executionId: row.payload.executionId }
                                : {}),
                        }));
                    // Join identity: the keyed path's claim mark carries (runId, executionId)
                    // and its key names the task; a task turn terminal is the lifecycle
                    // `terminal` mark of THAT execution (svc.run lane — work-item envelopes
                    // don't exist here).
                    const claimRow = allRows.find(
                        (row) =>
                            row.name === 'claim' &&
                            (runId !== undefined
                                ? row.runId === runId || row.payload.runId === runId
                                : row.payload.key?.includes(wbs) === true),
                    );
                    const executionId =
                        typeof claimRow?.payload.executionId === 'string' ? claimRow.payload.executionId : undefined;
                    if (hang) {
                        trials.push({
                            ...trialContext,
                            agent,
                            mode,
                            status: 'timed-out',
                            phases,
                            ...(runId !== undefined ? { runId } : {}),
                            ...(key !== undefined ? { key } : {}),
                            binary: binaryRow,
                            ...(hostVersion !== undefined ? { hostBinaryVersion: hostVersion } : {}),
                            reason: `--inject-failure ${options.injectFailure}: synthetic timeout for a hang-tagged trial; stays in the denominator`,
                        });
                        return;
                    }
                    const enqueue = phases.find((mark) => mark.phase === 'enqueue');
                    // Workflow-lane contract completion when the envelope exists; otherwise the
                    // task turn's lifecycle terminal for THIS execution (svc.run lane — work-item
                    // envelopes don't exist for plain task dispatch).
                    const terminalAt = phases
                        .filter((mark) => mark.phase === 'terminal' && mark.executionId === executionId)
                        .at(-1)?.at;
                    const validatedAt = phases.find((mark) => mark.phase === 'contract-validated')?.at ?? terminalAt;
                    const done = jsonOk<{ status: string }>(['task', 'show', wbs, '--json'], p.scratch);
                    if (enqueue === undefined || validatedAt === undefined || done.status !== 'done') {
                        trials.push({
                            ...trialContext,
                            agent,
                            mode,
                            status: 'failed',
                            phases,
                            ...(runId !== undefined ? { runId } : {}),
                            ...(key !== undefined ? { key } : {}),
                            binary: binaryRow,
                            ...(hostVersion !== undefined ? { hostBinaryVersion: hostVersion } : {}),
                            reason: `missing ${enqueue === undefined ? 'enqueue' : executionId === undefined ? 'claim/executionId' : 'terminal'} phase or task status=${done.status}`,
                        });
                        failures.push(`${agent} trial ${index}: no validated terminal`);
                        return;
                    }
                    const durationMs = new Date(validatedAt).getTime() - new Date(enqueue.at).getTime();
                    trials.push({
                        ...trialContext,
                        agent,
                        mode,
                        status: 'validated',
                        durationMs,
                        phases,
                        ...(runId !== undefined ? { runId } : {}),
                        ...(key !== undefined ? { key } : {}),
                        binary: binaryRow,
                        ...(hostVersion !== undefined ? { hostBinaryVersion: hostVersion } : {}),
                    });
                } catch (error) {
                    // Deadline hit (hang arm) or an infrastructure error — the row records which.
                    const timedOut = errorMessage(error).includes('timed out');
                    trials.push({
                        ...trialContext,
                        agent,
                        mode,
                        status: hang ? 'timed-out' : timedOut ? 'timed-out' : 'failed',
                        phases: [],
                        binary: binaryRow,
                        ...(hostVersion !== undefined ? { hostBinaryVersion: hostVersion } : {}),
                        reason: errorMessage(error),
                    });
                    if (!hang) failures.push(`${agent} trial ${index}: ${errorMessage(error)}`);
                }
            };

            for (let index = 0; index < options.trials; index++) {
                await driveTrial(index, false);
                // Between trials: the coder must be fully quiet so the next task's turn is clean.
                if (index < options.trials - 1) {
                    await pollUntil(
                        `${agent}: the coder to be quiet between trials`,
                        async () => {
                            if (await runs.hasRunning(p.coderId)) return undefined;
                            const queued = (await inbox.list(p.coderId, 'in', { limit: 500 })).messages.filter(
                                (row) => row.status === 'queued' || row.status === 'claimed',
                            );
                            return queued.length === 0 ? true : undefined;
                        },
                        BOUNDS.done,
                    );
                }
            }
            // The armed failure runs LAST in the first agent's project only — a hung turn holds
            // the write slot and would block every later trial.
            if (options.injectFailure !== null && agent === PERF_AGENTS[0]) {
                await driveTrial(options.trials, true);
            }
        } catch (error) {
            failures.push(
                `${agent}: ${errorMessage(error)}\\n${error instanceof Error ? (error.stack ?? '').split('\n').slice(0, 6).join('\n') : ''}`,
            );
        } finally {
            const proj = project;
            if (proj !== undefined) {
                for (const pid of proj.loopPids) {
                    try {
                        process.kill(pid, 'SIGTERM');
                    } catch {
                        /* already gone */
                    }
                }
                await sleep(1_000);
                try {
                    (await proj.openDb()).close();
                } catch {
                    /* closed with the dir */
                }
                const resolvedScratch = resolve(proj.scratch);
                const resolvedTmp = realpathSync(tmpdir());
                if (resolvedScratch.startsWith(`${resolvedTmp}/`) && !options.keep) {
                    rmSync(resolvedScratch, { recursive: true, force: true });
                }
            }
        }
    }

    const measured: PerfReceipt['measured'] = {};
    for (const agent of targets) {
        const agentTrials = trials.filter((trial) => trial.agent === agent);
        const cold = perfMeasured(agentTrials, 'cold');
        const resume = perfMeasured(agentTrials, 'resume');
        measured[agent] = {
            cold,
            resume,
            warm: warmRow(agent, warmProbes.get(agent) ?? { driver: null, binary: null, verifiedVersion: null }),
        };
    }
    const turnComparison = await runPairedTurnPerf(targets, options.trials, options.injectFailure !== null);
    for (const trial of turnComparison.trials) {
        if (trial.status !== 'validated' && !trial.injected)
            failures.push(`${trial.agent} ${trial.mode}: ${trial.reason}`);
    }
    const receipt: PerfReceipt = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        revision: revision.stdout.toString().trim(),
        repeatCommand,
        workloadDigest,
        targets: {
            provisional: true,
            note: options.realAgents
                ? 'real-agent lane — the member ran the installed binary; deltas across agents compare different binaries'
                : 'deterministic stub lane — same binary everywhere; comparisons are provisional. Warm rows record qualification of the INSTALLED binary (tasks 1276-1278) and carry no latency',
            agents: targets,
        },
        trials,
        measured,
        turnComparison,
    };
    writePerfReceipts(receipt, repeatCommand);
    if (failures.length > 0) {
        process.stderr.write(
            `fleet-perf: ${failures.length} problem(s):\n${failures.map((f) => `  - ${f}`).join('\n')}\n`,
        );
        return 1;
    }
    process.stdout.write(
        `fleet-perf: ${trials.filter((t) => t.status === 'validated').length}/${trials.length} trials validated; receipts at ${PERF_RECEIPT_JSON} and ${PERF_RECEIPT_MD}\n`,
    );
    return 0;
}

export async function runFleetE2e(args: string[]): Promise<number> {
    const { injectFailure, keep, guestJoinFixture, matrix, perf, trials, realAgents, hostProbe, realHosts, agents } =
        parseArgs(args);
    if (hostProbe) {
        return await runHostProbe({ realHosts, keep, ...(agents === undefined ? {} : { agents }) });
    }
    if (matrix) return await runExecutorMatrix({ keep });
    // The perf lane owns its own default: absent `--agents` means every target (1273 R4).
    if (perf) return await runFleetPerf({ trials, keep, injectFailure, realAgents, agents: agents ?? PERF_AGENTS });
    // Canonical scratch root: on macOS `os.tmpdir()` is a symlinked path, and the fleet
    // normalizes project paths (`normalizeProjectPath`), so a raw `/var/...` path would never
    // match the claim/session rows the loops write under `/private/var/...`.
    const scratch = join(realpathSync(tmpdir()), `spur-fleet-e2e-${Date.now()}`);
    // R4 skip arm: the guest-join leg interrogates a generated pre-1081 fixture instead of the
    // source-local transport, and the run writes its own receipt so the land-arm one stays 9/9.
    const fixturePath = join(scratch, 'pre1081-fixture.ts');
    const receiptPath = guestJoinFixture ? SKIP_ARM_RECEIPT_PATH : RECEIPT_PATH;
    const guestJoinCli: Receipt['guestJoinCli'] = guestJoinFixture ? 'pre-1081-fixture' : 'source-local';
    const state: RunState = {
        scratch,
        binDir: join(scratch, 'bin'),
        stubPath: join(scratch, 'bin', AGENT_TYPE),
        stubLog: join(scratch, 'stub-prompts.jsonl'),
        plannerId: '',
        coderId: '',
        featureId: null,
        wbs: null,
        dispatchMessageId: null,
        dispatchRunId: null,
        replyMessageId: null,
        guestId: null,
        guestJoinCliEntry: guestJoinFixture ? fixturePath : CLI_ENTRY,
        guestJoinCliLabel: guestJoinFixture ? 'spur-pre1081' : 'spur',
        loopPids: [],
        rows: new Map(),
        ids: {},
    };
    let db: Awaited<ReturnType<typeof createMigratedDb>> | undefined;

    try {
        // ── 1. scaffold ────────────────────────────────────────────────────────────────
        let scaffoldEvidence = '';
        try {
            rmSync(scratch, { recursive: true, force: true });
            mkdirSync(state.binDir, { recursive: true });
            Bun.spawnSync(['git', 'init', '-q', '.'], { cwd: scratch });
            cliOk(['self', 'init', '--json'], scratch);
            writeFileSync(
                join(scratch, '.spur/config.yaml'),
                `${readFileSync(join(scratch, '.spur/config.yaml'), 'utf8')}${fleetConfigSection()}`,
            );
            writeFileSync(state.stubPath, stubSource());
            chmodSync(state.stubPath, 0o755);
            // R4 skip arm: lay down the pre-1081 fixture CLI the guest-join leg will interrogate.
            if (guestJoinFixture) writeFileSync(fixturePath, pre1081FixtureSource());
            db = await createMigratedDb({ url: join(scratch, '.spur/spur.db') });
            // The same reconciliation `spur serve` runs at start (apps/server/src/serve.ts:959-975):
            // the declared strategy reaches the persisted row before any loop resumes on it.
            const runtime = new StrategyRuntime({ openDb: async () => db } as never);
            await runtime.reconcileStrategy(scratch, 'gtd');
            const strategy = await runtime.getStrategy(scratch);
            if (strategy.name !== 'gtd') throw new Error(`strategy reconcile left ${strategy.name}, expected gtd`);
            const specs = jsonOk<{ specs: Array<{ id: string }> }>(
                ['agent', 'list', '--specs', '--json'],
                scratch,
            ).specs;
            const ids = specs.map((spec) => spec.id);
            // The instance id is `<projectSlug>-<memberLocalId>` (fleet-service.ts:470); read it
            // back from the CLI rather than predicting the slug.
            const localId = (suffix: string): string => {
                const found = ids.find((candidate) => candidate.endsWith(`-${suffix}`));
                if (found === undefined) throw new Error(`fleet did not resolve member ${suffix}: ${ids.join(', ')}`);
                return found;
            };
            state.plannerId = localId(PLANNER_LOCAL_ID);
            state.coderId = localId(CODER_LOCAL_ID);
            scaffoldEvidence = [
                `scratch=${scratch}`,
                `fleet=${ids.join(', ')}`,
                `strategy=${strategy.name} v${strategy.version}`,
                `stub=${state.stubPath} (PATH first)`,
            ].join(' | ');
            pass(
                state,
                'scaffold',
                'git init + spur self init + agent.fleet + PATH stub + strategy reconcile',
                STEP_ONE_ASSERTION,
                scaffoldEvidence,
            );
        } catch (error) {
            fail(state, 'scaffold', 'git init + spur self init + agent.fleet + PATH stub', STEP_ONE_ASSERTION, error);
        }
        state.ids = {
            planner: state.plannerId || null,
            coder: state.coderId || null,
            feature: null,
            wbs: null,
        };

        // ── 2. create-task ─────────────────────────────────────────────────────────────
        try {
            if (!existsSync(join(scratch, '.spur/spur.db'))) throw new Error('scaffold did not produce a project db');
            const feature = jsonOk<{ ref: { id: string } }>(['feature', 'create', 'Fleet e2e', '--json'], scratch);
            state.featureId = feature.ref.id;
            const created = jsonOk<{ wbs: string }>(['task', 'create', TASK_TITLE, '--skip-ready', '--json'], scratch);
            state.wbs = created.wbs;
            // The task-local AC/numbering pins keep the DD-09 feature-subset rule out of a
            // scratch task; the rest is what a real fleet:auto task looks like.
            cliOk(['task', 'update', state.wbs, '--ac-altitude', 'task-local', '--no-lifecycle'], scratch);
            cliOk(['task', 'update', state.wbs, '--ac-numbering', 'task-local', '--no-lifecycle'], scratch);
            cliOk(['task', 'update', state.wbs, '--feature', state.featureId, '--no-lifecycle'], scratch);
            const ac = `Scenario: AC1 - the fleet coder member closes this task (req: R1)\n`;
            const design = 'The inbox-only GTD fleet dispatches this task to coder-1; the member process closes it.\n';
            cliOk(
                [
                    'task',
                    'update',
                    state.wbs,
                    '--section',
                    'Acceptance Criteria',
                    '--from-file',
                    '/dev/stdin',
                    '--no-lifecycle',
                ],
                scratch,
                { input: ac },
            );
            cliOk(
                ['task', 'update', state.wbs, '--section', 'Design', '--from-file', '/dev/stdin', '--no-lifecycle'],
                scratch,
                { input: design },
            );
            cliOk(['task', 'update', state.wbs, '--add-tag', 'fleet:auto', '--no-lifecycle'], scratch);
            cliOk(['task', 'update', state.wbs, 'todo', '--no-lifecycle'], scratch);
            const shown = jsonOk<{ status: string; frontmatter: { tags?: string[] } }>(
                ['task', 'show', state.wbs, '--json'],
                scratch,
            );
            if (shown.status !== 'todo') throw new Error(`task status is ${shown.status}, expected todo`);
            if (!(shown.frontmatter.tags ?? []).includes('fleet:auto')) throw new Error('fleet:auto tag missing');
            state.ids.feature = state.featureId;
            state.ids.wbs = state.wbs;
            pass(
                state,
                'create-task',
                `spur task create + task update (${state.wbs}, tags fleet:auto)`,
                STEP_TWO_ASSERTION,
                `wbs=${state.wbs} status=todo tags=${(shown.frontmatter.tags ?? []).join(',')} feature=${state.featureId} readiness=task check --as wip PASS`,
            );
        } catch (error) {
            fail(state, 'create-task', 'spur task create + task update', STEP_TWO_ASSERTION, error);
        }

        // ── 3. start-loops ─────────────────────────────────────────────────────────────
        let loopsStarted = false;
        try {
            for (const id of [state.plannerId, state.coderId]) {
                state.loopPids.push(spawnLoop(scratch, state, id));
            }
            const openDb = db;
            if (openDb === undefined) throw new Error('no project db');
            const claimDao = new ProjectClaimDao(openDb);
            await pollUntil(
                'the planner orchestrator claim',
                async () => {
                    const claim = await claimDao.get(scratch, 'orchestrator');
                    return claim !== null && claim.expiresAt > Date.now() ? claim : undefined;
                },
                BOUNDS.loops,
            );
            await pollUntil(
                "the coder's recorded member session",
                async () => {
                    const sessions = await readMemberSessions(openDb, [state.coderId]);
                    return sessions.size > 0 ? sessions : undefined;
                },
                BOUNDS.loops,
            );
            loopsStarted = true;
            pass(
                state,
                'start-loops',
                `spur agent loop --spec ${state.plannerId} | --spec ${state.coderId}`,
                STEP_THREE_ASSERTION,
                `pids=${state.loopPids.join(',')} (stub first on PATH) orchestrator claim live member session recorded`,
            );
        } catch (error) {
            fail(
                state,
                'start-loops',
                'spur agent loop --spec planner-1 | --spec coder-1',
                STEP_THREE_ASSERTION,
                error,
            );
        }

        // ── 6. kill-redispatch: its OWN hang-tagged task, so the done-task above is never blocked ──
        let hungDirective: string | null = null;
        let resumedDirective: string | null = null;
        try {
            if (!loopsStarted || state.wbs === null)
                throw new Error('loops or task missing; no dispatch can be observed');
            const openDb = db;
            if (openDb === undefined) throw new Error('no project db');
            const runs = new CoordinationRunDao(openDb);
            const inboxRows = new InboxService({ getDb: async () => openDb });
            const keyedRows = (wbs: string) => inboxRows.taskAttempts(wbs);

            // (0) R1's E2E proof: ONE unkeyed conversational message to the persistent coder,
            // delivered through stdin with NO coordination run row — exactly the message class that
            // used to wedge GTD project-wide.
            //
            // It must be drained ALONE: `drainPending` claims every queued row into one batch, and a
            // batch carrying a `fleet:task:*` key runs through `svc.run`, whose receipt then names
            // this message id too (observed 2026-10-06 — the chat rode in 0001's keyed batch and
            // never produced the no-receipt state R1 is about). So wait for the coder to be quiet
            // first: the done task closed, no running turn, nothing queued.
            await pollUntil(
                'the coder to be quiet before the conversational message',
                async () => {
                    const done = jsonOk<{ status: string }>(['task', 'show', state.wbs ?? '', '--json'], scratch);
                    if (done.status !== 'done') return undefined;
                    if (await runs.hasRunning(state.coderId)) return undefined;
                    const queued = (await inboxRows.list(state.coderId, 'in', { limit: 500 })).messages.filter(
                        (row) => row.status === 'queued' || row.status === 'claimed',
                    );
                    return queued.length === 0 ? true : undefined;
                },
                BOUNDS.done,
            );
            const chat = jsonOk<{ msgId: string }>(
                ['message', 'send', '--to', state.coderId, 'status?', '--json'],
                scratch,
            );
            await pollUntil(
                'the unkeyed status? delivery (stdin accepted, no run row)',
                async () => {
                    const rows = jsonOk<{ messages: Array<{ id: string; status: string; runStatus?: string | null }> }>(
                        ['message', 'inbox', '--agent', state.coderId, '--json'],
                        scratch,
                    ).messages;
                    const row = rows.find((message) => message.id === chat.msgId);
                    // G11 renamed the consumed state `injected` → `claimed`: a chat row that a
                    // drain picked up is `claimed`, so only `queued` means "not delivered yet".
                    if (row === undefined || row.status === 'queued') return undefined;
                    // A run row here would make it a receipt-bearing delivery: this message must be
                    // delivered through stdin, alone, with no run row at all.
                    if ((await runs.listByMessageId(chat.msgId)).length > 0) {
                        throw new Error(
                            `the status? message ${chat.msgId} was claimed into a keyed run batch — it must be drained alone`,
                        );
                    }
                    return row;
                },
                BOUNDS.reply,
            );
            state.ids.chatMessage = chat.msgId;

            // (1) the hang leg needs a second, separately tagged task: tagging the done-task would
            // make its very first turn hang and `dispatch-to-done` could never close on its own.
            const hungTask = jsonOk<{ wbs: string }>(
                ['task', 'create', `${TASK_TITLE} (hang)`, '--skip-ready', '--json'],
                scratch,
            );
            // Same preparation as the done task: without real AC + Design the strategy's readiness
            // gate holds the hang task as not-ready — and without the feature link the strict
            // `--as wip` check fails L4.missing-feature-id, so the strategy would never dispatch it.
            cliOk(['task', 'update', hungTask.wbs, '--ac-altitude', 'task-local', '--no-lifecycle'], scratch);
            cliOk(['task', 'update', hungTask.wbs, '--ac-numbering', 'task-local', '--no-lifecycle'], scratch);
            if (state.featureId !== null) {
                cliOk(['task', 'update', hungTask.wbs, '--feature', state.featureId, '--no-lifecycle'], scratch);
            }
            cliOk(
                [
                    'task',
                    'update',
                    hungTask.wbs,
                    '--section',
                    'Acceptance Criteria',
                    '--from-file',
                    '/dev/stdin',
                    '--no-lifecycle',
                ],
                scratch,
                { input: 'Scenario: AC1 - the fleet coder member hangs on this task (req: R1)\n' },
            );
            cliOk(
                ['task', 'update', hungTask.wbs, '--section', 'Design', '--from-file', '/dev/stdin', '--no-lifecycle'],
                scratch,
                {
                    input: 'The inbox-only GTD fleet dispatches this task to coder-1; the stub blocks until a --continue resume.\n',
                },
            );
            cliOk(
                ['task', 'update', hungTask.wbs, '--add-tag', 'fleet:auto', '--add-tag', HANG_TAG, '--no-lifecycle'],
                scratch,
            );
            cliOk(['task', 'update', hungTask.wbs, 'todo', '--no-lifecycle'], scratch);
            const wbs = hungTask.wbs;
            // (a) the strategy dispatches the keyed attempt on its own. The orchestrator wakes on
            // `task.created`/`task.updated` (WAKE_EVENT_NAMES) and on the --poll backstop, so a task
            // created after the loops started IS followed — no operator dispatch message and no
            // planner nudge. The previous workaround did both and measured a receipt the unkeyed
            // path never writes.
            const attemptOne = await pollUntil(
                `the strategy to dispatch fleet:task:${wbs}:1`,
                async () => (await keyedRows(wbs)).find((row) => row.requestKey === `fleet:task:${wbs}:1`),
                BOUNDS.hang,
            );
            // The keyed turn writes its coordination row at invoke start; the stub then hangs.
            const runningRun = await pollUntil(
                'the hung keyed turn to start (run row running)',
                async () => (await runs.listByMessageId(attemptOne.id)).find((row) => row.status === 'running'),
                BOUNDS.kill,
            );
            const hung = await pollUntil(
                'the stub to receive the hung directive',
                async () =>
                    readStubPrompts(state).find(
                        (record) =>
                            directiveFor(record, wbs) !== undefined &&
                            !(directiveFor(record, wbs) ?? '').includes('--continue'),
                    ),
                BOUNDS.kill,
            );
            hungDirective = directiveFor(hung, wbs) ?? null;
            // (b) SIGKILL the coder loop mid-turn. SIGTERM already finalizes through
            // `AgentService.run`'s own handler, so only SIGKILL exercises R2's orphan.
            const coderPid = state.loopPids[1];
            process.kill(coderPid ?? 0, 'SIGKILL');
            // (c) restart the member. There is no harness-side recovery: the restarted loop reaps
            // its spec's orphaned `running` row before its first drain (R2), which gives the killed
            // attempt a definite receipt and wakes the orchestrator.
            const restartedPid = spawnLoop(scratch, state, state.coderId, '-restart');
            state.loopPids[1] = restartedPid;
            const terminalRun = await pollUntil(
                'the killed attempt to reach a terminal receipt',
                async () =>
                    (await runs.listByMessageId(attemptOne.id)).find(
                        (row) => row.status !== 'running' && row.completed_at !== null,
                    ),
                BOUNDS.kill,
            );
            // (d) the strategy re-dispatches under the next attempt key with no operator message.
            const attemptTwo = await pollUntil(
                `the strategy to re-dispatch fleet:task:${wbs}:2`,
                async () => (await keyedRows(wbs)).find((row) => row.requestKey === `fleet:task:${wbs}:2`),
                BOUNDS.dispatch,
            );
            const resumed = await pollUntil(
                'the stub to receive the resumed directive',
                async () => {
                    const records = readStubPrompts(state).filter((record) => directiveFor(record, wbs) !== undefined);
                    return records.find((record) => (directiveFor(record, wbs) ?? '').includes('--continue'));
                },
                BOUNDS.resume,
            );
            resumedDirective = directiveFor(resumed, wbs) ?? null;
            // The strategy must not have been held by that unkeyed delivery: no idle-hold row may
            // name it as a blocking (ambiguous) delivery (AC R1). A KEYED row in the crash window
            // between claim and `svc.run` may legitimately hold — that is the gate's remaining job.
            const keyedOnlyHolds = (await new SystemEventDao(openDb).query({ names: ['fleet.idle-hold'] })).filter(
                (row) => (row.payload_json ?? '').includes('unresolved-deliveries'),
            );
            const wedgeHolds = keyedOnlyHolds.filter((row) => (row.payload_json ?? '').includes(chat.msgId));
            if (wedgeHolds.length > 0) {
                throw new Error(
                    `the unkeyed delivery held dispatch: ${wedgeHolds.length} fleet.idle-hold row(s) name ${chat.msgId} as ambiguous`,
                );
            }
            pass(
                state,
                'kill-redispatch',
                `kill -KILL <coder loop>; restart spur agent loop --spec ${state.coderId} (no operator dispatch, no planner nudge)`,
                STEP_SIX_ASSERTION,
                [
                    `unkeyed delivered=${chat.msgId} status=delivered (stdin, no run row) — named by 0 of ${keyedOnlyHolds.length} unresolved-deliveries hold(s)`,
                    `attempt-1=${attemptOne.requestKey} run=${runningRun.run_id} hung directive=${hungDirective}`,
                    `killed → restarted pid=${restartedPid}; attempt-1 run=${terminalRun.run_id} status=${terminalRun.status} completed_at=${terminalRun.completed_at}`,
                    `attempt-2=${attemptTwo.requestKey} dispatched by the strategy; resumed directive=${resumedDirective}`,
                ].join(' | '),
            );
        } catch (error) {
            fail(
                state,
                'kill-redispatch',
                'kill -KILL <coder loop>; restart the coder loop (strategy-only re-dispatch)',
                STEP_SIX_ASSERTION,
                error,
            );
        }

        // ── 4. dispatch-to-done (the done-task's own keyed dispatch closes it) ──────────
        try {
            const wbs = state.wbs;
            if (wbs === null) throw new Error('no task to close');
            const done = await pollUntil(
                `task ${wbs} to reach done`,
                async () => {
                    const row = jsonOk<{ status: string }>(['task', 'show', wbs, '--json'], scratch);
                    if (row.status !== 'done') {
                        // Nudge the orchestrator through the real CLI so each poll is a prompt
                        // wake instead of waiting out its backstop poll: the loop ticks on every
                        // drain, and the deadline-bounded poll stays short (G71 1077 R3).
                        try {
                            cli(['message', 'send', '--to', state.plannerId, `tick for ${wbs}`, '--json'], scratch);
                        } catch {
                            /* the next poll retries */
                        }
                    }
                    return row.status === 'done' ? row : undefined;
                },
                BOUNDS.done,
            );
            const inbox = jsonOk<{
                messages: Array<{
                    id: string;
                    requestKey?: string | null;
                    runId?: string | null;
                    runStatus?: string | null;
                }>;
            }>(['message', 'inbox', '--agent', state.coderId, '--json'], scratch);
            const keyed = inbox.messages.find((message) => (message.requestKey ?? '').startsWith(`fleet:task:${wbs}:`));
            if (keyed === undefined) throw new Error(`no keyed fleet dispatch found for ${wbs}`);
            state.dispatchMessageId = keyed.id;
            // This leg runs AFTER kill-redispatch in source order, so the run id must come from this
            // task's own keyed row — never from shared state the hang leg could have written.
            state.dispatchRunId = keyed.runId ?? null;
            state.ids.dispatchMessage = keyed.id;
            pass(
                state,
                'dispatch-to-done',
                `spur task show ${wbs} --json (poll) + spur message inbox --agent ${state.coderId} --json`,
                STEP_FOUR_ASSERTION,
                `status=${done.status} keyed message=${keyed.id} requestKey=${keyed.requestKey ?? 'unknown'} run=${state.dispatchRunId ?? 'unknown'} closure=the member's own turn`,
            );
        } catch (error) {
            fail(
                state,
                'dispatch-to-done',
                `spur task show ${state.wbs ?? '<wbs>'} --json (poll)`,
                STEP_FOUR_ASSERTION,
                error,
            );
        }

        // ── 5. orchestrator-reply ──────────────────────────────────────────────────────
        try {
            const sent = jsonOk<{ msgId: string }>(
                ['message', 'send', '--to', state.plannerId, 'status?', '--json'],
                scratch,
            );
            state.replyMessageId = sent.msgId;
            state.ids.replyMessage = sent.msgId;
            const reply = await pollUntil(
                'the orchestrator reply in the operator inbox',
                async () => {
                    const inbox = jsonOk<{ messages: Array<{ id: string; body: string; inReplyTo: string | null }> }>(
                        ['message', 'inbox', '--agent', 'operator', '--json'],
                        scratch,
                    );
                    return inbox.messages.find((message) => message.inReplyTo === sent.msgId);
                },
                BOUNDS.reply,
            );
            pass(
                state,
                'orchestrator-reply',
                `spur message send --to ${state.plannerId} "status?" (${sent.msgId}) → spur message inbox --agent operator`,
                STEP_FIVE_ASSERTION,
                `sent=${sent.msgId} reply=${reply.id} body=${trimmed(reply.body, 80)} inReplyTo=${reply.inReplyTo}`,
            );
        } catch (error) {
            fail(state, 'orchestrator-reply', 'spur message send --to planner "status?"', STEP_FIVE_ASSERTION, error);
        }

        // ── 7. guest-join — R4: run only when task 1081 has landed; otherwise record `skipped`
        //    with the reason. The `agent join|leave|wait --inbox` verbs land with 1081, so probe
        //    for the verb before running the leg instead of recording a spurious failure.
        try {
            const probe = probeAgentCommand(scratch, 'join', state.guestJoinCliEntry, state.guestJoinCliLabel);
            if (!probe.listed) {
                // The row carries the probe invocation itself, so the skipped arm's command,
                // exit code and evidence are the real ones (R2), not a hand-written placeholder.
                state.rows.set('guest-join', {
                    step: 'guest-join',
                    command: probe.help.command,
                    exitCode: probe.help.exitCode,
                    status: 'skipped',
                    assertion: STEP_SEVEN_SKIP_ASSERTION,
                    evidence: `skipped: 1081 not landed (${probe.help.command} does not list the join command)`,
                });
            } else {
                const joined = jsonOk<{ guest: { id: string } }>(
                    ['agent', 'join', '--role', 'reviewer', '--id', 'reviewer-g', '--json'],
                    scratch,
                );
                state.guestId = joined.guest.id;
                const request = jsonOk<{ msgId: string }>(
                    ['message', 'send', '--to', state.guestId, `review request: ${state.wbs ?? 'task'}`, '--json'],
                    scratch,
                );
                // The harness plays the joined session: the real pull verb, then the (stubbed) model answer.
                const pull = jsonOk<{ id: string; pending: number }>(
                    ['agent', 'wait', '--inbox', state.guestId, '--timeout', '30000', '--json'],
                    scratch,
                );
                const inbox = jsonOk<{ messages: Array<{ id: string; body: string }> }>(
                    ['message', 'inbox', '--agent', state.guestId, '--json'],
                    scratch,
                );
                const pending = inbox.messages.find((message) => message.id === request.msgId);
                if (pending === undefined) throw new Error('the guest request was not in the guest inbox');
                cliOk(['message', 'reply', pending.id, 'lgtm: approved'], scratch);
                const operatorInbox = jsonOk<{ messages: Array<{ id: string; inReplyTo: string | null }> }>(
                    ['message', 'inbox', '--agent', 'operator', '--json'],
                    scratch,
                );
                const guestReply = await pollUntil(
                    "the guest's reply in the operator inbox",
                    async () =>
                        operatorInbox.messages.find((message) => message.inReplyTo === request.msgId) ?? undefined,
                    BOUNDS.guest,
                );
                const guestId = joined.guest.id;
                const left = jsonOk<{ guest?: { id: string } }>(['agent', 'leave', guestId, '--json'], scratch);
                state.guestId = null; // teardown must not leave a guest that already left
                pass(
                    state,
                    'guest-join',
                    `spur agent join --role reviewer --id ${guestId} → agent wait --inbox → message reply → agent leave`,
                    STEP_SEVEN_ASSERTION,
                    `guest=${guestId} request=${request.msgId} pending=${pull.pending} reply=${guestReply.id} left=${left.guest?.id ?? guestId}`,
                );
            }
        } catch (error) {
            fail(state, 'guest-join', 'spur agent join --role reviewer --id reviewer-g', STEP_SEVEN_ASSERTION, error);
        }

        // ── 8. trace ──────────────────────────────────────────────────────────────────
        try {
            let traceRoot = state.dispatchRunId;
            if (traceRoot === null) {
                // The strategy's keyed dispatch records no run correlation on the inbox row
                // (`residualRisks[strategy-dispatch-has-no-lineage-parent]`), so fall back to the
                // newest AGENT run record the coder's loop itself wrote — a durable artifact, not a
                // guess: the record header names the run.
                const runsDir = join(scratch, '.spur', 'memory', 'runs');
                const candidates = readdirSync(runsDir, { withFileTypes: true })
                    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
                    .map((entry) => entry.name)
                    .sort()
                    .reverse();
                for (const name of candidates) {
                    if (readFileSync(join(runsDir, name), 'utf8').startsWith('# spur agent run ')) {
                        traceRoot = name.replace(/\.md$/, '');
                        break;
                    }
                }
            }
            if (traceRoot === null) throw new Error('no dispatched run id to trace');
            const tree = jsonOk<{
                rootRunId: string;
                nodes: Array<{
                    runId: string;
                    kind: string;
                    status: string;
                    parentRunId: string | null;
                    sessionIds: string[];
                    logPath: string | null;
                }>;
            }>(['agent', 'trace', traceRoot, '--json'], scratch);
            const node = tree.nodes.find((entry) => entry.runId === traceRoot);
            if (node === undefined) throw new Error(`trace did not include the dispatched run ${traceRoot}`);
            if (node.kind !== 'agent') throw new Error(`trace node kind is ${node.kind}, expected agent`);
            if (node.logPath === null) throw new Error('the dispatched run has no durable stream');
            const stream = existsSync(node.logPath) ? readFileSync(node.logPath, 'utf8') : '';
            const lines = stream.split('\n').filter((line) => line.trim() !== '').length;
            if (lines === 0) throw new Error('the dispatched run stream is empty');
            if (!Array.isArray(node.sessionIds)) throw new Error('sessionIds is not an array');
            pass(
                state,
                'trace',
                `spur agent trace ${state.dispatchRunId} --json`,
                STEP_EIGHT_ASSERTION,
                `root=${tree.rootRunId} nodes=${tree.nodes.length} node=${node.kind}/${node.status} stream=${node.logPath} lines=${lines} sessionIds=[${node.sessionIds.join(',')}] parentRunId=${node.parentRunId ?? 'null'}`,
            );
        } catch (error) {
            fail(
                state,
                'trace',
                `spur agent trace ${state.dispatchRunId ?? '<run>'} --json`,
                STEP_EIGHT_ASSERTION,
                error,
            );
        }
    } catch (error) {
        // A harness-level failure (bad args, unmigratable scratch project) must still leave a receipt.
        state.rows.set('teardown', {
            step: 'teardown',
            command: '',
            exitCode: 1,
            status: 'failed',
            assertion: STEP_NINE_ASSERTION,
            evidence: `harness error: ${errorMessage(error)}`,
        });
    } finally {
        // ── 9. teardown ────────────────────────────────────────────────────────────────
        let teardownEvidence = '';
        const problems: string[] = [];
        try {
            for (const pid of state.loopPids) {
                try {
                    process.kill(pid, 'SIGTERM');
                } catch {
                    /* already gone */
                }
            }
            await sleep(1_000);
            // F7: the SIGKILLed loop could not clean up its hang stub. The stub exits when its
            // parent dies, so a pid still alive here is a real leak — named, not hidden.
            const liveStubPids = readStubPrompts(state)
                .map((record) => record.pid)
                .filter((pid): pid is number => pid !== undefined && !state.loopPids.includes(pid))
                .filter((pid, index, all) => all.indexOf(pid) === index)
                .filter((pid) => {
                    try {
                        process.kill(pid, 0);
                        return true;
                    } catch {
                        return false;
                    }
                });
            for (const pid of liveStubPids) {
                try {
                    process.kill(pid, 'SIGKILL');
                } catch {
                    /* exited between the probe and the kill */
                }
                problems.push(`stub pid ${pid} outlived the killed loop`);
            }
            if (state.guestId !== null) {
                const leave = cli(['agent', 'leave', state.guestId, '--json'], scratch);
                if (leave.exitCode !== 0) problems.push(`guest leave exited ${leave.exitCode}`);
            }
            if (db !== undefined) {
                try {
                    db.close();
                } catch {
                    /* the scratch db is removed with the dir */
                }
            }
            const resolvedScratch = resolve(scratch);
            const resolvedTmp = realpathSync(tmpdir());
            const insideTmp = resolvedScratch.startsWith(`${resolvedTmp}/`);
            if (!insideTmp) {
                problems.push(`refused to remove ${resolvedScratch}: outside ${resolvedTmp}`);
            } else if (!keep) {
                rmSync(resolvedScratch, { recursive: true, force: true });
            }
            teardownEvidence = [
                `killed pids=${state.loopPids.filter((pid) => pid !== undefined).join(',')}`,
                keep
                    ? `scratch kept at ${resolvedScratch} (--keep)`
                    : `scratch removed=${!existsSync(resolvedScratch)}`,
                problems.length > 0 ? `problems=${problems.join('; ')}` : 'problems=none',
            ].join(' | ');
            if (problems.length === 0) {
                pass(
                    state,
                    'teardown',
                    'kill loop pids + spur agent leave + rm -rf $TMPDIR/<scratch>',
                    STEP_NINE_ASSERTION,
                    teardownEvidence,
                );
            } else {
                // Reported, not thrown: a `throw` inside this `finally` would swallow the
                // harness's own failure and keep the receipt from being written.
                fail(
                    state,
                    'teardown',
                    'kill loop pids + spur agent leave + rm -rf $TMPDIR/<scratch>',
                    STEP_NINE_ASSERTION,
                    new Error(problems.join('; ')),
                );
            }
        } catch (error) {
            fail(
                state,
                'teardown',
                'kill loop pids + spur agent leave + rm -rf $TMPDIR/<scratch>',
                STEP_NINE_ASSERTION,
                error,
            );
        }
        // The receipt is written last, after teardown, so it reflects the whole run.
        if (injectFailure !== null) {
            const row = state.rows.get(injectFailure);
            if (row === undefined) {
                state.rows.set(injectFailure, {
                    step: injectFailure,
                    command: '',
                    exitCode: 1,
                    status: 'failed',
                    assertion: 'injected failure target',
                    evidence: `injected failure: --inject-failure ${injectFailure} (step was never reached)`,
                });
            } else {
                state.rows.set(injectFailure, {
                    ...row,
                    exitCode: 1,
                    status: 'failed',
                    evidence: `${row.evidence} | injected failure: --inject-failure ${injectFailure}`,
                });
            }
        }
        writeReceipt(state, scratch, receiptPath, guestJoinCli);
    }

    const steps = RECEIPT_STEPS.map((name) => state.rows.get(name));
    const failed = steps.filter((row) => row?.status === 'failed');
    console.log(`fleet-e2e receipt: ${receiptPath}`);
    for (const row of steps) {
        if (row === undefined) continue;
        console.log(
            `  ${row.status === 'passed' ? 'ok  ' : row.status === 'skipped' ? 'skip' : 'FAIL'} ${row.step}: ${trimmed(row.evidence, 160)}`,
        );
    }
    if (failed.length > 0) {
        console.error(`fleet-e2e: ${failed.length} step(s) failed: ${failed.map((row) => row?.step).join(', ')}`);
        return 1;
    }
    return 0;
}
