import { realpathSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { disposeDecisionServices, type InboxClaim, InboxService } from '@gobing-ai/spur-app';
import { getEnvVars, removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import type { CommandOutput } from '../src/output';

/** Captured command output for CLI tests. */
export interface CapturedOutput extends CommandOutput {
    messages: string[];
    errors: string[];
}

/** Create a temporary project directory with a package manifest. */
export async function createTempProject(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'spur-'));
    await Bun.write(join(dir, 'package.json'), `${JSON.stringify({ name: 'fixture', type: 'module' }, null, 2)}\n`);
    return dir;
}

/** Create a temporary project directory with only a .spur config (no package manifest). */
export async function createTempProjectStackNeutral(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'spur-'));
    // Intentionally NO package.json — Spur is stack-neutral.
    return dir;
}

/** Create an output sink that stores writes for assertions. */
export function createCapturedOutput(): CapturedOutput {
    return {
        messages: [],
        errors: [],
        write(message: string): void {
            this.messages.push(message);
        },
        error(message: string): void {
            this.errors.push(message);
        },
    };
}

/** Result of a subprocess CLI invocation. */
export interface CliResult {
    /** Process exit code. `null` when the process was killed by a signal. */
    code: number | null;
    /** stdout captured as a UTF-8 string. */
    stdout: string;
    /** stderr captured as a UTF-8 string. */
    stderr: string;
    /** Parsed JSON object when stdout is valid JSON, otherwise `undefined`. */
    json?: unknown;
}

/**
 * Run the Spur CLI as a subprocess (verb-level integration, R4).
 *
 * Spawns `bun run apps/cli/src/index.ts` so the test exercises the real entry
 * point, argument parsing, and process lifecycle. When `--json` is present in
 * `args` and stdout parses as JSON, the parsed object is returned as
 * `result.json`.
 *
 * For most command tests, prefer the in-process `main()` helper — it is
 * faster and already covers dispatch. Use `runCli` when subprocess isolation
 * or real process exit codes are required.
 */
export async function runCli(
    args: string[],
    cwd?: string,
    env?: Record<string, string | undefined>,
): Promise<CliResult> {
    const mergedEnv: Record<string, string | undefined> = { ...getEnvVars(), ...env };
    // tests/setup.ts sets SPUR_SKIP_PROJECT_CONFIG for in-process loads; a subprocess
    // CLI run against a fixture cwd is exactly where reading the project layer is the
    // behavior under test (config layering, early config failure), so the inherited
    // skip must not leak across the spawn boundary. An explicit caller value wins.
    if (env?.SPUR_SKIP_PROJECT_CONFIG === undefined) delete mergedEnv.SPUR_SKIP_PROJECT_CONFIG;
    const entryPath = join(import.meta.dir, '..', 'src', 'index.ts');
    const proc = Bun.spawn({
        cmd: ['bun', 'run', entryPath, ...args],
        cwd,
        env: mergedEnv,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    const result: CliResult = { code, stdout, stderr };
    if (args.includes('--json')) {
        try {
            result.json = JSON.parse(stdout);
        } catch {
            // stdout was not valid JSON despite --json — leave json undefined.
        }
    }
    return result;
}

/**
 * Run the Spur CLI in process (`main()`) instead of spawning a child (task 1475 R2).
 *
 * Equivalent to `runCli` whenever the test asserts only on the CLI's own output and exit code. It is
 * the lever that removes the lane's dominant cost: each spawn pays a fresh `bun` boot, the ts-db
 * graph and the migrations, which is a large multiple of the work most command tests do.
 *
 * The child's process state is emulated for the duration of the call — `getEnvVars()` becomes the
 * merged env and `process.cwd()` becomes `cwd`, both restored afterwards — because a few code paths
 * still read them directly rather than through the injected context. That emulation is also the
 * reason this helper is *not* a drop-in for every `runCli`: keep the spawn where the test asserts
 * process-level behaviour (signals, stdin, real `process.exit`, config layering across the boundary).
 *
 * @param args - CLI argv, as `runCli` receives it.
 * @param cwd - Project directory the CLI resolves against.
 * @param env - Environment overrides layered on the ambient test env.
 * @param options.replaceEnv - Use `env` as the *whole* environment instead of layering it (the golden
 *   harnesses pass a complete minimal env, exactly as `spawnSync(..., {env})` did).
 * @returns The same `CliResult` shape `runCli` returns (`code`, `stdout`, `stderr`, parsed `json`).
 */
export async function runMain(
    args: string[],
    cwd?: string,
    env?: Record<string, string | undefined>,
    options: { replaceEnv?: boolean } = {},
): Promise<CliResult> {
    const messages: string[] = [];
    const errors: string[] = [];
    // Two write surfaces reach the same arrays: the injected `CommandOutput` the commands take, and
    // ts-utils' default targets, which is where `echo`/`echoError` land when a diagnostic bypasses the
    // injected sink. A child process separated the two; in process they must be redirected explicitly.
    const line =
        (sink: string[]) =>
        (chunk: string): void => {
            sink.push(chunk.endsWith('\n') ? chunk.slice(0, -1) : chunk);
        };
    const output: CommandOutput = {
        write: (message: string) => messages.push(message),
        error: (message: string) => errors.push(message),
    };
    const mergedEnv: Record<string, string | undefined> =
        options.replaceEnv === true ? { ...env } : { ...getEnvVars(), ...env };
    if (options.replaceEnv !== true && env?.SPUR_SKIP_PROJECT_CONFIG === undefined) {
        delete mergedEnv.SPUR_SKIP_PROJECT_CONFIG;
    }
    // `getEnvVars()` is the live record, so seeding and restoring the child's environment goes
    // through the sanctioned gateway rather than reaching into the live env record directly.
    const liveEnv = getEnvVars();
    const savedEnv: Record<string, string | undefined> = { ...liveEnv };
    const savedCwd = process.cwd();
    for (const key of Object.keys(liveEnv)) if (!(key in mergedEnv)) removeEnvVar(key);
    for (const [key, value] of Object.entries(mergedEnv)) setEnvVar(key, value);
    // A child's `process.cwd()` is the resolved path (macOS `/var` → `/private/var`), so resolve here
    // too — otherwise a command that reports its project path diverges from the spawned run.
    const resolvedCwd = cwd === undefined ? undefined : realpathSync(cwd);
    if (resolvedCwd !== undefined) process.chdir(resolvedCwd);
    const rollbackTargets = setDefaultOutputTargets({
        stdout: { write: line(messages) },
        stderr: { write: line(errors) },
    });
    let code: number;
    try {
        // Loaded under the case env, not the test process's: a few modules read the env at import
        // time (the decision catalog does), and a child would have seen this env already.
        const { main } = await import('../src/index');
        code = await main(args, { cwd: resolvedCwd, env: mergedEnv, output });
    } finally {
        // The process entry releases the decision-service singletons after `main()`; in process the same
        // instances would otherwise carry one case's catalog state into the next.
        await disposeDecisionServices();
        rollbackTargets();
        process.chdir(savedCwd);
        for (const key of Object.keys(getEnvVars())) removeEnvVar(key);
        for (const [key, value] of Object.entries(savedEnv)) setEnvVar(key, value);
    }
    const result: CliResult = {
        code,
        stdout: messages.map((message) => `${message}\n`).join(''),
        stderr: errors.map((message) => `${message}\n`).join(''),
    };
    if (args.includes('--json')) {
        try {
            result.json = JSON.parse(result.stdout);
        } catch {
            // stdout was not valid JSON despite --json — leave json undefined.
        }
    }
    return result;
}

/**
 * Inbox fixture for CLI tests (G11 R2): the retired ts-db `InboxMessageDao` surface the CLI
 * tests seed through, backed by the app-layer `InboxService`.
 *
 * Seeds are `kind: 'request'` when keyed (a fleet dispatch) and chat otherwise, and carry the
 * `task_id` from a `fleet:task:<wbs>:<n>` key — the column that replaced the request-key parse.
 */
export function inboxFixture(db: import('@gobing-ai/spur-domain').DbAdapter) {
    const service = new InboxService({ getDb: async () => db });
    const claims = new Map<string, InboxClaim>();
    const claimed = (id: string): InboxClaim => {
        const claim = claims.get(id);
        if (claim === undefined) throw new Error(`fixture did not claim message ${id}`);
        return claim;
    };
    const taskIdOf = (requestKey: string) => /^fleet:task:([^:]+):/.exec(requestKey)?.[1];
    return {
        /** Seed a chat message; returns its id. */
        async enqueue(fromId: string | null, toId: string, body: string): Promise<string> {
            return (await service.send({ from: fromId ?? 'operator', to: toId, body })).message.id;
        },
        /** Seed an idempotent request (fleet dispatch / workflow request); returns id + replay flag. */
        async enqueueIdempotent(fromId: string | null, toId: string, body: string, requestKey: string) {
            const taskId = taskIdOf(requestKey);
            const { message, replayed } = await service.send({
                from: fromId ?? 'operator',
                to: toId,
                body,
                kind: 'request',
                requestKey,
                ...(taskId !== undefined ? { taskId } : {}),
            });
            return { id: message.id, replayed };
        },
        async drainPending(member: string) {
            const messages = await service.claim(member, 100);
            for (const message of messages) claims.set(message.id, message);
            return messages;
        },
        async release(ids: string[]) {
            return service.release(ids.map(claimed));
        },
        async markDelivered(id: string) {
            return service.settle([claimed(id)], 'accepted');
        },
        async markFailed(id: string, error: string) {
            return service.settle([claimed(id)], 'not-started', error);
        },
        async getById(id: string) {
            return service.get(id);
        },
        async inbox(member: string, limit = 100) {
            return (await service.list(member, 'in', { limit })).messages;
        },
        async countPending(member: string) {
            return service.countQueued(member);
        },
        service,
    };
}
