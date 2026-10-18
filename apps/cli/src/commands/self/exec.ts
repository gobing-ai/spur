import type { Command } from '@commander-js/extra-typings';
import { listActions, type ResolvedAction, resolveAction } from '@gobing-ai/spur-app/sdlc-actions';
import { shQuote } from '@gobing-ai/spur-app/shell-quote';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import type { CliContext } from '../../context';
import { toJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';

/** One command the verb will execute: the action (or composite step) name plus its resolved shell command. */
interface PlanStep {
    name: string;
    command: string;
}

/** One executed step, as reported by the `--json` summary (R7). */
interface StepResult {
    name: string;
    exitCode: number;
    durationMs: number;
}

/**
 * Register `spur self exec` (feature A92, design `docs/design/sdlc-actions.md` §3.3).
 *
 * Thin transport: every resolution decision comes from `sdlc-actions.ts`; this module only
 * resolves the binding, runs the command in the project root, streams, and maps exit codes.
 */
export function registerExecCommand(self: Command, context: CliContext, options: { hidden?: boolean } = {}): void {
    self.command('exec', { hidden: options.hidden === true })
        .summary('run or list the project SDLC actions bound in builder config')
        .description(
            'Run a reserved or declared SDLC action in the project root via sh -c, inheriting ' +
                'stdout/stderr (stdin is not forwarded by the shared process seam) and setting ' +
                'SPUR_ACTION for the child; spur exits with the child exit code. Resolution order: ' +
                'builder.actions.<action> → builder.preset → stack-neutral default.',
        )
        .argument('[action]', 'reserved or declared action name')
        .argument('[args...]', 'extra arguments appended to a string action (pass after --)')
        .option('--list', 'List every reserved and declared action with its resolved command and source')
        .option(...SHARED_OPTIONS.execDryRun)
        .option(...SHARED_OPTIONS.json)
        .action(async (action, args, opts) => {
            const builder = context.spurConfig?.builder;
            const fail = (message: string): void => {
                context.output.error(message);
                context.setExitCode(2);
            };

            if (opts.list === true) {
                const rows = listActions(builder);
                context.output.write(opts.json === true ? toJson(rows.map(listRow)) : formatActionList(rows));
                return;
            }

            if (action === undefined) {
                fail('usage: spur self exec <action> [-- <args...>] (spur self exec --list shows the actions)');
                return;
            }

            const resolved = resolveAction(builder, action);
            if (resolved.kind === 'unbound') {
                fail(unboundMessage(action));
                return;
            }

            let plan: PlanStep[];
            if (resolved.kind === 'command') {
                plan = [{ name: action, command: appendArgs(resolved.command, args) }];
            } else {
                if (args.length > 0) {
                    fail(`composite action "${action}" does not accept arguments`);
                    return;
                }
                const steps: PlanStep[] = [];
                const collect = (name: string): boolean => {
                    const step = resolveAction(builder, name);
                    if (step.kind === 'command') {
                        steps.push({ name, command: step.command });
                        return true;
                    }
                    if (step.kind === 'composite') return step.steps.every(collect);
                    // Unreachable for a load-validated config (composite steps must resolve).
                    fail(unboundMessage(name));
                    return false;
                };
                if (!resolved.steps.every(collect)) return;
                plan = steps;
            }

            if (opts.dryRun === true) {
                context.output.write(
                    opts.json === true
                        ? toJson(plan.map((step) => ({ name: step.name, command: step.command })))
                        : plan.map((step) => step.command).join('\n'),
                );
                return;
            }

            // Scoped values come only from the light-gate planner; a literal `{files}` must never reach the shell.
            for (const step of plan) {
                const placeholder = /\{(?:files|paths|workspace)\}/.exec(step.command)?.[0];
                if (placeholder === undefined) continue;
                fail(
                    `action "${step.name}" needs ${placeholder} from the light-gate planner; it cannot run via self exec`,
                );
                return;
            }

            // `isTTY: true` pins stream-inherit even when spur's own stdout is piped, so a
            // `--json` consumer still sees the child's live output ahead of the summary.
            const executor = new NodeProcessExecutor({ output: { mode: 'stream', isTTY: true } });
            const results: StepResult[] = [];
            let exitCode = 0;
            for (const step of plan) {
                if (resolved.kind === 'composite') context.output.error(`▶ ${step.name}`);
                const result = await executor.run({
                    command: 'sh',
                    args: ['-c', step.command],
                    cwd: context.cwd,
                    env: { SPUR_ACTION: action },
                    timeout: null,
                    label: `self exec ${step.name}`,
                });
                // A signal-killed step has no exit code; report it as a plain failure.
                exitCode = result.exitCode ?? 1;
                results.push({ name: step.name, exitCode, durationMs: result.durationMs });
                if (exitCode !== 0) break;
            }
            if (opts.json === true) context.output.write(toJson({ action, steps: results, exitCode }));
            context.setExitCode(exitCode);
        });
}

/** Resolved-action message for an unbound name (R6). */
function unboundMessage(action: string): string {
    return `action "${action}" is not bound; add builder.actions.${action} to .spur/config.yaml`;
}

/** Append `shQuote`'d extra arguments to a string action (R2). */
function appendArgs(command: string, args: readonly string[]): string {
    return args.length === 0 ? command : `${command} ${args.map(shQuote).join(' ')}`;
}

/** One `--list --json` row: name, reserved, source, and the command or the composite steps. */
function listRow(action: ResolvedAction): Record<string, unknown> {
    const base = { name: action.name, reserved: action.reserved, source: action.source };
    if (action.kind === 'command') return { ...base, command: action.command };
    if (action.kind === 'composite') return { ...base, steps: action.steps };
    return base;
}

/** Human-readable action table for `--list` (R5). */
export function formatActionList(rows: readonly ResolvedAction[]): string {
    const body = rows.map((row) => ({
        name: row.name,
        source: row.source,
        command: (row.kind === 'command'
            ? row.command
            : row.kind === 'composite'
              ? row.steps.join(' → ')
              : '(unbound)'
        ).replace(/\n/g, '\\n'),
    }));
    const width = (pick: (cell: (typeof body)[number]) => string): number =>
        Math.max(...body.map((cell) => pick(cell).length));
    const nameWidth = Math.max(
        'NAME'.length,
        width((cell) => cell.name),
    );
    const sourceWidth = Math.max(
        'SOURCE'.length,
        width((cell) => cell.source),
    );
    const line = (name: string, source: string, command: string): string =>
        `${name.padEnd(nameWidth)}  ${source.padEnd(sourceWidth)}  ${command}`.trimEnd();
    return [line('NAME', 'SOURCE', 'COMMAND'), ...body.map((cell) => line(cell.name, cell.source, cell.command))].join(
        '\n',
    );
}
