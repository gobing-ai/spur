/**
 * fleet-e2e — prove the inbox-only agent fleet end to end and leave a repeatable receipt
 * (task 1077, feature G71 R8; plan `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md` §1).
 *
 * Usage: bun scripts/spur-dev.ts fleet-e2e [--inject-failure <step>]
 *
 * One scratch project under `$TMPDIR` is scaffolded, driven through the source-local CLI
 * (`bun run apps/cli/src/index.ts`), and torn down; the run writes
 * `docs/reports/fleet-e2e-receipt.json` (stable name, overwritten each run). Every step row
 * records its command, exit code, observed evidence and the assertion it proves.
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
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEnvVar, getEnvVars } from '@gobing-ai/spur-config';
import { StrategyRuntime } from '../../packages/app/src/services/strategy-runtime';
import { readMemberSessions } from '../../packages/domain/src/dao/member-session';
// Deep relative imports (the precedent in `real-run-cost.ts`): the root node_modules has no
// workspace link for `scripts/commands`, so `@gobing-ai/spur-*` cannot resolve here.
import { ProjectClaimDao } from '../../packages/domain/src/dao/project-claim-dao';
import { createMigratedDb } from '../../packages/domain/src/db';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** The source-local CLI entry (this repo's own transport, never an installed binary). */
const CLI_ENTRY = join(REPO_ROOT, 'apps/cli/src/index.ts');
/** Stable receipt name — overwritten each run (1077 Q&A). */
const RECEIPT_PATH = join(REPO_ROOT, 'docs/reports/fleet-e2e-receipt.json');

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
function cli(args: string[], cwd: string, options: { input?: string } = {}): CliResult {
    const proc = Bun.spawnSync(['bun', 'run', CLI_ENTRY, ...args], {
        cwd,
        env: getEnvVars(),
        stdin: options.input === undefined ? 'ignore' : Buffer.from(options.input),
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return {
        exitCode: proc.exitCode ?? 1,
        stdout: proc.stdout.toString(),
        stderr: proc.stderr.toString(),
        command: `spur ${args.join(' ')}`,
    };
}

/** Same, but a non-zero exit is a harness failure (the step's assertion depends on it). */
function cliOk(args: string[], cwd: string, options: { input?: string } = {}): CliResult {
    const result = cli(args, cwd, options);
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

function jsonOk<T>(
    args: string[],
    cwd: string,
    options: { env?: Record<string, string | undefined>; input?: string } = {},
): T {
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
function spawnLoop(scratch: string, state: RunState, specId: string, suffix = ''): number {
    const logDir = join(scratch, '.spur/logs');
    mkdirSync(logDir, { recursive: true });
    const child = Bun.spawn(
        ['bun', 'run', CLI_ENTRY, 'agent', 'loop', '--spec', specId, '--poll', String(LOOP_POLL_MS)],
        {
            cwd: scratch,
            env: {
                ...getEnvVars(),
                PATH: `${state.binDir}:${getEnvVar('PATH') ?? ''}`,
                // The stub resolves its own inputs from the environment the LOOP passes on: without
                // these three the stub runs with an empty CLI path, its first `Bun.spawnSync` throws,
                // and the turn dies right after logging its prompt — which looked like a hang
                // (3 failed dispatches, no .cli rows, no run rows). G71 1077 R3.
                SPUR_E2E_CLI: CLI_ENTRY,
                SPUR_E2E_PROJECT: scratch,
                SPUR_E2E_STUB_LOG: state.stubLog,
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
import { appendFileSync } from 'node:fs';

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

appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), spec: specId, argv, stdin: stdinText, prompt, directives }) + '\\n');

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
if (dispatch !== null) {
    const wbs = dispatch[1];
    const directive = directives.find((entry) => entry.includes(wbs)) ?? '';
    const resumed = resumedTurn || directive.includes('--continue');
    // Gate diagnosis: one line per dispatch-branch entry, naming what the gate will read.
    appendFileSync(logPath + '.gate', JSON.stringify({ at: new Date().toISOString(), spec: specId, wbs, resumedTurn, resumed, tags, directives }) + '\\n');
    const show = cliRun(['task', 'show', wbs, '--json']);
    const task = readJson(show.stdout);
    const manifest = task.frontmatter ?? (task.task && task.task.frontmatter) ?? {};
    const tags = Array.isArray(manifest.tags) ? manifest.tags : [];
    // e2e:hang models a coder turn that must be killed mid-run: it blocks until the task is
    // resumed with --continue, which is the prompt that lets it finish.
    if (tags.includes(${JSON.stringify(HANG_TAG)}) && !resumed) {
        process.stderr.write('stub: hanging on task ' + wbs + ' until a --continue resume\\n');
        for (;;) await Bun.sleep(1000);
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

/** `agent.fleet` for the scratch project: a planner orchestrator and one stub-executor coder. */
function fleetConfigSection(): string {
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
        `      agent: ${AGENT_TYPE}`,
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
    "a coder loop killed mid-turn (run errored, message delivered) is restarted and the task is resumed through the real `spur message send <...> --continue` CLI path, with the stub's next directive for the wbs carrying --continue. NOT proven: strategy auto-retry of a drained turn (residual risk strategy-retry-unreachable)";
const STEP_SEVEN_ASSERTION =
    'a joined guest occupant (agent join --role) pulls a dispatched review request through agent wait --inbox and its reply lands in the operator inbox';
const STEP_EIGHT_ASSERTION =
    'spur agent trace resolves the execution record of the dispatched turn: an agent node whose durable stream exists with content, over a loop-free lineage';
const STEP_NINE_ASSERTION = 'loop pids are killed, the guest leaves, and the scratch dir under $TMPDIR is removed';

const RESIDUAL_RISKS: ResidualRisk[] = [
    {
        id: 'strategy-dispatch-has-no-lineage-parent',
        summary:
            'A strategy dispatch records no parent run edge, so its execution record is a single-node lineage: the dispatch → member-turn depth of 2 requires the workflow dispatcher.',
        rootCause:
            "drainIntoPrompt sets parentRunId only from a workflow request key of the shape `<runId>/<state>` (apps/cli/src/commands/agent.ts:1391-1394); the strategy's `fleet:task:<wbs>:<n>` key is deliberately excluded, so the member turn is a lineage root (packages/app/src/services/agent-service.ts:1322-1326).",
        evidence:
            'the traced dispatch run reports parentRunId=null and nodes.length=1; its stream and status are still readable, which is what the step asserts.',
    },
];

function writeReceipt(state: RunState, scratch: string): void {
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
        ids: state.ids,
        steps,
        residualRisks: RESIDUAL_RISKS,
    };
    mkdirSync(join(REPO_ROOT, 'docs/reports'), { recursive: true });
    writeFileSync(RECEIPT_PATH, `${JSON.stringify(receipt, null, 4)}\n`);
}

/** Parse `fleet-e2e` args. Unknown flags fail loudly rather than being ignored. */
function parseArgs(args: string[]): { injectFailure: StepName | null; keep: boolean } {
    let injectFailure: StepName | null = null;
    let keep = false;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
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
        throw new Error(`unknown argument "${arg}" (usage: fleet-e2e [--inject-failure <step>] [--keep])`);
    }
    return { injectFailure, keep };
}

/**
 * The E2E. Execution order is NOT the receipt's row order: the strategy wedge recorded under
 * `strategy-retry-unreachable` allows exactly ONE strategy dispatch per project, so the
 * kill/resume half of that single turn has to happen before `dispatch-to-done` can observe the
 * task closing. Rows are still reported in the design's order.
 */
export async function runFleetE2e(args: string[]): Promise<number> {
    const { injectFailure, keep } = parseArgs(args);
    // Canonical scratch root: on macOS `os.tmpdir()` is a symlinked path, and the fleet
    // normalizes project paths (`normalizeProjectPath`), so a raw `/var/...` path would never
    // match the claim/session rows the loops write under `/private/var/...`.
    const scratch = join(realpathSync(tmpdir()), `spur-fleet-e2e-${Date.now()}`);
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
            // (0) the hang leg needs a second, separately tagged task: tagging the done-task would
            // make its very first turn hang and `dispatch-to-done` could never close on its own.
            const hungTask = jsonOk<{ wbs: string }>(
                ['task', 'create', `${TASK_TITLE} (hang)`, '--skip-ready', '--json'],
                scratch,
            );
            cliOk(
                ['task', 'update', hungTask.wbs, '--add-tag', 'fleet:auto', '--add-tag', HANG_TAG, '--no-lifecycle'],
                scratch,
            );
            cliOk(['task', 'update', hungTask.wbs, 'todo', '--no-lifecycle'], scratch);
            const wbs = hungTask.wbs;
            // (a) the planner's keyed attempt must reach the coder and the stub must hang on it.
            const hung = await pollUntil(
                'the hung first turn',
                async () => {
                    const records = readStubPrompts(state).filter((record) => directiveFor(record, wbs) !== undefined);
                    return records.find((record) => !(directiveFor(record, wbs) ?? '').includes('--continue'));
                },
                BOUNDS.hang,
            );
            hungDirective = directiveFor(hung, wbs) ?? null;
            const inbox = jsonOk<{
                messages: Array<{ id: string; requestKey?: string | null; runId?: string | null }>;
            }>(['message', 'inbox', '--agent', state.coderId, '--json'], scratch);
            const keyed = inbox.messages.find((message) => (message.requestKey ?? '').startsWith(`fleet:task:${wbs}:`));
            if (keyed === undefined) throw new Error('no keyed fleet dispatch found in the coder inbox');
            state.dispatchMessageId = keyed.id;
            state.dispatchRunId = keyed.runId ?? null;
            state.ids.dispatchMessage = keyed.id;
            state.ids.dispatchRun = keyed.runId ?? null;
            // (b) kill the coder loop mid-turn: the run finalizes errored and the message stays delivered.
            const coderPid = state.loopPids[1];
            process.kill(coderPid ?? 0, 'SIGTERM');
            const terminalRun = await pollUntil(
                'the killed turn to reach a terminal receipt',
                async () => {
                    const rows = jsonOk<{ messages: Array<{ id: string; runStatus?: string | null }> }>(
                        ['message', 'inbox', '--agent', state.coderId, '--json'],
                        scratch,
                    ).messages;
                    const row = rows.find((message) => message.id === keyed.id);
                    return row !== undefined &&
                        row.runStatus !== null &&
                        row.runStatus !== undefined &&
                        row.runStatus !== 'running'
                        ? row
                        : undefined;
                },
                BOUNDS.kill,
            );
            if (terminalRun.runStatus === 'running') throw new Error('killed turn is still running');
            // (c) restart the coder loop and resume the task through the real operator path.
            const restartedPid = spawnLoop(scratch, state, state.coderId, '-restart');
            state.loopPids[1] = restartedPid;
            const promptsBefore = readStubPrompts(state).length;
            const resume = jsonOk<{ msgId: string }>(
                ['message', 'send', '--to', state.coderId, `/sp:dev-run ${wbs} --continue`, '--json'],
                scratch,
            );
            const resumed = await pollUntil(
                'the stub to receive the --continue resume',
                async () => {
                    const records = readStubPrompts(state).slice(promptsBefore);
                    return records.find((record) => (directiveFor(record, wbs) ?? '').includes('--continue'));
                },
                BOUNDS.resume,
            );
            resumedDirective = directiveFor(resumed, wbs) ?? null;
            // With the retry wedge fixed in this task, the killed attempt's DEFINITE terminal
            // receipt lets the planner re-dispatch on its own — the design's attempt-2 key.
            const retry = await pollUntil(
                'the planner to re-dispatch the killed attempt as attempt 2',
                async () => {
                    const rows = jsonOk<{ messages: Array<{ id: string; requestKey?: string | null }> }>(
                        ['message', 'inbox', '--agent', state.coderId, '--json'],
                        scratch,
                    ).messages;
                    return rows.find((message) => (message.requestKey ?? '') === `fleet:task:${wbs}:2`);
                },
                BOUNDS.kill,
            );
            pass(
                state,
                'kill-redispatch',
                `kill -TERM <coder loop>; spur message send --to ${state.coderId} "/sp:dev-run ${wbs} --continue" (${resume.msgId})`,
                STEP_SIX_ASSERTION,
                [
                    `killed run=${state.dispatchRunId ?? 'unknown'} status=${terminalRun.runStatus} message=${keyed.id} delivery=delivered`,
                    `hung directive=${hungDirective}`,
                    `resumed directive=${resumedDirective} (new pid=${restartedPid})`,
                    `strategy auto-retry: attempt-2 key=${retry.requestKey} message=${retry.id}`,
                ].join(' | '),
            );
        } catch (error) {
            fail(state, 'kill-redispatch', 'kill coder loop; spur message send --continue', STEP_SIX_ASSERTION, error);
        }

        // ── 4. dispatch-to-done (the done-task's own keyed dispatch closes it) ──────────
        try {
            const wbs = state.wbs;
            if (wbs === null) throw new Error('no task to close');
            const done = await pollUntil(
                `task ${wbs} to reach done`,
                async () => {
                    const row = jsonOk<{ status: string }>(['task', 'show', wbs, '--json'], scratch);
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
            if (state.dispatchRunId === null) state.dispatchRunId = keyed.runId ?? null;
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

        // ── 7. guest-join (task 1081 landed: `spur agent join|leave|wait --inbox` exist) ──
        try {
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
                async () => operatorInbox.messages.find((message) => message.inReplyTo === request.msgId) ?? undefined,
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
        writeReceipt(state, scratch);
    }

    const steps = RECEIPT_STEPS.map((name) => state.rows.get(name));
    const failed = steps.filter((row) => row?.status === 'failed');
    console.log(`fleet-e2e receipt: ${RECEIPT_PATH}`);
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
