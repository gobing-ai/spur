import type { GuardContext, GuardEvaluationResult, GuardRunner } from '@gobing-ai/ts-dual-workflow-engine';
import type { ProcessExecutor } from '@gobing-ai/ts-runtime';

const KIND = 'shell';

function stringOption(options: Record<string, unknown>, key: string, fallback?: string): string {
    const value = options[key];
    if (typeof value === 'string') return value;
    if (fallback !== undefined) return fallback;
    throw new Error(`Guard option "${key}" must be a string`);
}

function arrayOption(options: Record<string, unknown>, key: string): string[] {
    const value = options[key];
    if (value === undefined) return [];
    if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) return value as string[];
    throw new Error(`Guard option "${key}" must be a string array`);
}

/**
 * Env-var shell guard — spur's replacement for the engine's `ShellGuardRunner` (task 0435),
 * and the guard-side counterpart to {@link StreamingShellActionRunner}'s handoff (task 0432).
 *
 * The engine's guard runner spawns `/bin/sh -c <command>` with no `env`, so a workflow authored
 * as `test "${vars.profile}" = auto` has the *resolved value* embedded in the command string by
 * the engine's template pre-resolution before the guard ever sees it. A value carrying backticks
 * or `$(...)` is then parsed as shell code. That is the same injection class 0432 removed from
 * shell actions, and it is worse here: a guard's side effect fires while the comparison still
 * reports an ordinary boolean, so nothing in the run output signals that anything executed.
 *
 * This runner passes `context.vars` (merged over the inherited `process.env`) to the subprocess,
 * so guard commands reference vars by name (`$profile`) and a variable-expansion result is never
 * re-parsed for metacharacters — the value is data, not code.
 *
 * Registered in `registerSpurBuiltins` after `createDefaultWorkflowEngineHost`, which replaces the
 * engine's `shell` guard by kind (the host's guard registry is keyed by kind, same as actions).
 */
export class EnvShellGuardRunner implements GuardRunner {
    readonly kind = KIND;

    constructor(private readonly processExecutor: ProcessExecutor) {}

    async evaluate(options: Record<string, unknown>, context: GuardContext): Promise<GuardEvaluationResult> {
        const command = stringOption(options, 'command');
        const explicitArgs = arrayOption(options, 'args');
        // Mirror the engine's ShellGuardRunner spawn semantics exactly: with explicit args run
        // `command` as a program; with a bare command line run it via `/bin/sh -c`.
        const usesShell = explicitArgs.length === 0;
        const spawn = usesShell ? { command: '/bin/sh', args: ['-c', command] } : { command, args: explicitArgs };
        const cwd = options.cwd === undefined ? context.workdir : stringOption(options, 'cwd');
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries({ ...process.env, ...context.vars })) {
            if (value !== undefined) env[key] = String(value);
        }
        const result = await this.processExecutor.run({
            command: spawn.command,
            args: spawn.args,
            ...(cwd !== undefined ? { cwd } : {}),
            env,
            rejectOnError: false,
            forceBuffered: true,
        });
        return {
            passed: result.exitCode === 0,
            report: { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode },
        };
    }
}
