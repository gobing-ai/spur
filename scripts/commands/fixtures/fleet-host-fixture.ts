/**
 * Scripted fixture host for the G75 host-capability probe (task 1280, AC2).
 *
 * One real child process per executor, driving the installed `spur` CLI through the portable
 * guest loop with **no hooks installed**: join → `wait --inbox` → `message reply` → `leave`.
 * The parent harness sends the bounded request once the guest record appears, then reads the
 * result file this process writes. Nothing here talks to a model: the fixture is the session,
 * the CLI is the transport, and the durable inbox is the only coordination path.
 *
 * Env: SPUR_E2E_CLI (bun entry), SPUR_E2E_PROJECT (scratch project), SPUR_E2E_HOST_AGENT,
 * SPUR_E2E_GUEST_ID, SPUR_E2E_RESULT (result file path).
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { getEnvVar, getEnvVars } from '@gobing-ai/spur-config';

const cli = getEnvVar('SPUR_E2E_CLI') ?? '';
const project = getEnvVar('SPUR_E2E_PROJECT') ?? process.cwd();
const agent = getEnvVar('SPUR_E2E_HOST_AGENT') ?? 'unknown';
const guestId = getEnvVar('SPUR_E2E_GUEST_ID') ?? `probe-${agent}`;
const resultPath = getEnvVar('SPUR_E2E_RESULT') ?? `${project}/host-${agent}.json`;

interface Step {
    command: string;
    exitCode: number;
    detail: string;
}

const steps: Step[] = [];

/** Run the source-local CLI in the scratch project. */
function spur(args: string[]): { exitCode: number; stdout: string; stderr: string } {
    const proc = spawnSync(process.execPath, ['run', cli, ...args], {
        cwd: project,
        env: getEnvVars(),
        encoding: 'utf8',
    });
    return { exitCode: proc.status ?? 1, stdout: proc.stdout ?? '', stderr: proc.stderr ?? '' };
}

/** The CLI prints a banner before JSON; find the payload. */
function jsonOf<T>(stdout: string): T {
    const start = stdout.search(/[[{]/);
    if (start === -1) throw new Error(`no JSON in output: ${stdout.slice(0, 200)}`);
    return JSON.parse(stdout.slice(start)) as T;
}

function writeResult(ok: boolean, error?: string): void {
    writeFileSync(
        resultPath,
        `${JSON.stringify({ agent, guestId, ok, ...(error === undefined ? {} : { error }), steps }, null, 2)}\n`,
    );
}

try {
    const join = spur(['agent', 'join', '--role', 'reviewer', '--id', guestId, '--json']);
    steps.push({ command: `agent join --role reviewer --id ${guestId}`, exitCode: join.exitCode, detail: '' });
    if (join.exitCode !== 0) throw new Error(`join failed: ${join.stderr || join.stdout}`);

    const wait = spur(['agent', 'wait', '--inbox', guestId, '--timeout', '30000', '--json']);
    const pulled = wait.exitCode === 0 ? jsonOf<{ messages: Array<{ id: string; body: string }> }>(wait.stdout) : null;
    const request = pulled?.messages[0];
    steps.push({
        command: `agent wait --inbox ${guestId} --timeout 30000`,
        exitCode: wait.exitCode,
        detail: request === undefined ? 'no message' : `pulled ${request.id}`,
    });
    if (request === undefined) throw new Error('wait --inbox returned no message');

    const reply = spur(['message', 'reply', request.id, `${agent} fixture done`, '--json']);
    steps.push({ command: `message reply ${request.id}`, exitCode: reply.exitCode, detail: '' });
    if (reply.exitCode !== 0) throw new Error(`reply failed: ${reply.stderr || reply.stdout}`);

    const leave = spur(['agent', 'leave', guestId, '--json']);
    steps.push({ command: `agent leave ${guestId}`, exitCode: leave.exitCode, detail: '' });
    if (leave.exitCode !== 0) throw new Error(`leave failed: ${leave.stderr || leave.stdout}`);

    writeResult(true);
    process.exit(0);
} catch (error) {
    writeResult(false, error instanceof Error ? error.message : String(error));
    process.exit(1);
}
