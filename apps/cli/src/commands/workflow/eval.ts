/**
 * `spur workflow eval <pipeline>… [--fixture <name>]… [--runs <n>] [--label <s>] [--keep] [--dry-run]`
 * (A94 1413 R1) — the pipeline parity comparator as a shipped verb.
 *
 * Runs fixture tasks through each pipeline in a detached run-local worktree and emits one record per
 * fixture (`wbs, pipeline, verdict, gateOutcomes[], artifactsWritten[], tokenCost, wallClockMs,
 * exitCode`) plus `runCount`/variance, so a downstream project can compare its own pipelines.
 * Refuses to nest: an eval started from inside a pipeline run would fork unbounded work.
 */
import type { Command } from '@commander-js/extra-typings';
import { assertNotNested, EvalNestingError, evalPipeline, planEval } from '@gobing-ai/spur-app';
import { bootFree } from '../../boot-free-route';
import type { CliContext } from '../../context';
import { toEnvelopeJson, toJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';

/** Accumulate a repeatable option into an array. */
function collect(value: string, previous: string[]): string[] {
    return [...previous, value];
}

/** Register `spur workflow eval`. */
export function registerWorkflowEvalCommand(noun: Command, context: CliContext): void {
    bootFree(noun.command('eval'))
        .summary('compare pipelines over fixture tasks in an isolated worktree (verdict, gates, cost, wall clock)')
        .argument('[pipelines...]', 'pipeline YAML paths (default: the project task pipeline)')
        .option('--fixture <name>', 'fixture template to run (repeatable; default fixture-minimal)', collect, [])
        .option('--runs <n>', 'runs per pipeline for variance (1-20, default 1)')
        .option('--label <name>', 'label recorded on the report (default: run)')
        .option('--keep', 'retain the run worktree and report its path')
        .option(...SHARED_OPTIONS.dryRunWorkflowValidate)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (pipelines: string[], options) => {
            // Rebuild the operand list in the shape the parser owns, so flags and positionals keep
            // exactly one grammar.
            const argv: string[] = [...(pipelines ?? [])];
            for (const fixture of options.fixture ?? []) argv.push('--fixture', fixture);
            if (options.runs !== undefined) argv.push('--runs', options.runs);
            if (options.label !== undefined) argv.push('--label', options.label);
            if (options.keep === true) argv.push('--keep');
            if (options.dryRun === true) argv.push('--dry-run');

            const fail = (message: string, code: number): void => {
                if (options.json === true) {
                    context.output.write(toJson({ error: { code: 'usage', message } }));
                    context.setExitCode(code);
                    return;
                }
                context.output.error(message);
                context.setExitCode(code);
            };
            try {
                // The nesting refusal precedes every path, `--dry-run` included.
                assertNotNested();
                // Text mode prints the cheap plan; JSON mode always answers with the run payload (a dry
                // run has records with no pipeline spawn), so one contract covers both.
                if (options.dryRun === true && options.json !== true) {
                    const plan = planEval(argv, context.cwd);
                    if (options.json === true) {
                        context.output.write(
                            toEnvelopeJson({ ok: true, plan }, { enveloped: options.jsonEnvelope === true }),
                        );
                    } else {
                        context.output.write(`pipelines: ${plan.pipelines.join(', ')}`);
                        for (const fixture of plan.fixtures)
                            context.output.write(`fixture ${fixture.name}: ${fixture.path}`);
                        context.output.write(`runs: ${plan.runs}`);
                        context.output.write(`worktree root: ${plan.worktreeRoot}`);
                    }
                    return;
                }
                const outcome = await evalPipeline(argv, { projectRoot: context.cwd });
                if (options.json === true) {
                    context.output.write(
                        toEnvelopeJson(
                            {
                                ok: outcome.report.records.every((record) => record.exitCode === 0),
                                report: outcome.report,
                                reportPath: outcome.reportPath,
                                keptWorktrees: outcome.keptWorktrees,
                            },
                            { enveloped: options.jsonEnvelope === true },
                        ),
                    );
                } else {
                    for (const line of outcome.lines) context.output.write(line);
                    for (const worktree of outcome.keptWorktrees) context.output.write(`fixture run kept: ${worktree}`);
                }
                if (!outcome.report.records.every((record) => record.exitCode === 0)) context.setExitCode(1);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (error instanceof EvalNestingError) fail(message, 1);
                else if (/unknown fixture|--runs|unknown option/.test(message)) fail(message, 2);
                else fail(`eval: ${message}`, 1);
            }
        });
}
