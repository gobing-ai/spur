import { normalize, resolve } from 'node:path';
import type { ActionResult, ActionRunContext, ActionRunner } from '@gobing-ai/ts-dual-workflow-engine';
import {
    createNodeFileSystem,
    type FileSystem,
    NodeProcessExecutor,
    type ProcessExecutor,
} from '@gobing-ai/ts-runtime';
import { splitLaunchCommand } from '../split-launch-command';
import { childProcessEnv } from './child-env';

const KIND = 'command.gate';

/**
 * Retry policy options for command-gate action executions.
 */
export interface CommandGateRetryOptions {
    /** Maximum number of execution attempts before returning failure. */
    maxAttempts?: number;
    /** Delay in milliseconds between retry attempts. */
    delayMs?: number;
    /** Output match classifications that trigger a retry (e.g. `sqlite-busy`). */
    on?: string[];
}

/**
 * Options configuring a deterministic command-gate action runner.
 */
export interface CommandGateOptions {
    /** Unique identifier for the gate within the workflow state. */
    id: string;
    /** Literal executable name on PATH without shell expansion. */
    executable: string;
    /** Explicit argument array passed directly to the process executor. */
    args?: string[];
    /** Timeout limit in milliseconds. */
    timeoutMs?: number;
    /** Retry configuration for classified transient failures. */
    retry?: CommandGateRetryOptions;
    /** Target status file path relative to repository root beneath `.spur/run/`. */
    resultFile: string;
    /**
     * Treat a non-zero exit as a recorded outcome rather than an action failure.
     *
     * The shipped action schema has no `onError`, so a hard-failing action aborts the run
     * before any transition guard can read the result file. Soft probes — the precheck and
     * quality-gate hops whose FAIL must route through the graph to a `failed` state rather
     * than kill the run — set this to keep the engine going while still recording `FAIL`.
     */
    softFail?: boolean;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchesRetryCondition(output: string, condition: string): boolean {
    const lower = condition.toLowerCase();
    if (lower === 'sqlite-busy' || lower === 'sqlite-locked') {
        return /database is locked|sqlite_busy|sqliteerror:\s*database is locked/i.test(output);
    }
    return output.toLowerCase().includes(lower);
}

/**
 * Workflow action runner for `command.gate` execution.
 * Enforces explicit executable and argument vectors, bans shell command strings,
 * confines result status files beneath `.spur/run/`, and handles classified retries.
 */
export class CommandGateActionRunner implements ActionRunner {
    readonly kind = KIND;

    constructor(
        private readonly processExecutor: ProcessExecutor = new NodeProcessExecutor(),
        private readonly fileSystem: FileSystem = createNodeFileSystem(),
    ) {}

    async execute(options: Record<string, unknown>, context: ActionRunContext): Promise<ActionResult> {
        if ('command' in options && typeof options.command === 'string') {
            return {
                ok: false,
                error: 'command.gate rejects "command" option; use literal "executable" and "args" instead.',
            };
        }

        const executable = options.executable;
        if (typeof executable !== 'string' || executable.trim() === '') {
            return {
                ok: false,
                error: 'Action option "executable" must be a non-empty string',
            };
        }

        let args: string[] = [];
        if (options.args !== undefined) {
            if (!Array.isArray(options.args) || !options.args.every((a) => typeof a === 'string')) {
                return {
                    ok: false,
                    error: 'Action option "args" must be an array of strings',
                };
            }
            args = options.args as string[];
        }

        const resultFileRaw = options.resultFile;
        if (typeof resultFileRaw !== 'string' || resultFileRaw.trim() === '') {
            return {
                ok: false,
                error: 'Action option "resultFile" must be a non-empty string resolving under .spur/run/',
            };
        }

        const workdir = context.workdir ?? process.cwd();
        const allowedDir = resolve(workdir, '.spur', 'run');
        const resolvedResultFile = resolve(workdir, resultFileRaw);
        const normalized = normalize(resolvedResultFile);

        if (!normalized.startsWith(allowedDir)) {
            return {
                ok: false,
                error: `resultFile must resolve beneath .spur/run/ (got ${resultFileRaw})`,
            };
        }

        const split = splitLaunchCommand(executable, 'command.gate "executable"');
        if ('error' in split) {
            return { ok: false, error: split.error };
        }

        const softFail = options.softFail === true;
        const retry = (options.retry as CommandGateRetryOptions | undefined) ?? {};
        const maxAttempts = Math.max(1, typeof retry.maxAttempts === 'number' ? retry.maxAttempts : 1);
        const delayMs = Math.max(0, typeof retry.delayMs === 'number' ? retry.delayMs : 1000);
        const retryOn = Array.isArray(retry.on) ? retry.on : [];
        const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : undefined;

        const env = childProcessEnv(context.vars);

        await this.fileSystem.ensureDir(allowedDir);

        let lastStdout = '';
        let lastStderr = '';
        let lastExitCode = -1;
        let attemptsRun = 0;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            attemptsRun = attempt;
            const res = await this.processExecutor.run({
                command: split.command,
                args: [...split.leadingArgs, ...args],
                cwd: workdir,
                env,
                forceBuffered: true,
                rejectOnError: false,
                ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
            });

            lastStdout = res.stdout;
            lastStderr = res.stderr;
            lastExitCode = res.exitCode ?? -1;

            if (res.exitCode === 0) {
                await this.fileSystem.writeFile(normalized, 'PASS\n');
                return {
                    ok: true,
                    data: {
                        status: 'PASS',
                        exitCode: 0,
                        attempts: attemptsRun,
                        stdout: lastStdout,
                        stderr: lastStderr,
                        resultFile: normalized,
                    },
                };
            }

            const combinedOutput = `${lastStdout}\n${lastStderr}`;
            const shouldRetry =
                attempt < maxAttempts &&
                retryOn.length > 0 &&
                retryOn.some((cond) => matchesRetryCondition(combinedOutput, cond));

            if (shouldRetry) {
                if (delayMs > 0) {
                    await sleep(delayMs);
                }
                continue;
            }

            break;
        }

        await this.fileSystem.writeFile(normalized, 'FAIL\n');
        const failureData = {
            status: 'FAIL',
            exitCode: lastExitCode,
            attempts: attemptsRun,
            stdout: lastStdout,
            stderr: lastStderr,
            resultFile: normalized,
        };
        // Soft probes record FAIL and hand routing to the transition guards; the run only
        // aborts here when the caller wants the gate to be fatal.
        if (softFail) {
            return { ok: true, data: failureData };
        }
        return {
            ok: false,
            error: `command.gate failed (exit code ${lastExitCode}) after ${attemptsRun} attempt(s)`,
            data: failureData,
        };
    }
}
