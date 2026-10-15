import { join } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import {
    buildReportJson,
    type DbOpener,
    defaultDbOpener,
    parseSince,
    readStateMetrics,
    readWorkflowMetrics,
    renderStateLines,
    renderWorkflowLines,
    runBudgetGate,
    scopedWorkflows,
} from '@gobing-ai/spur-app/run-cost';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';

const collect = (value: string, previous: string[]): string[] => [...previous, value];

/** Seams for `spur workflow cost` (tests inject an in-memory DB opener). */
export interface WorkflowCostDeps {
    openDb?: DbOpener;
}

/**
 * Register `spur workflow cost` — real-run wall-clock/cost per workflow (absorbed from
 * `scripts/commands/real-run-cost.ts`) and, with `--budget <file>`, the per-pipeline budget
 * gate (absorbed from `scripts/commands/pipeline-budgets.ts`). Script-absorption PR-9.
 */
export function registerWorkflowCostCommand(workflow: Command, context: CliContext, deps: WorkflowCostDeps = {}): void {
    workflow
        .command('cost')
        .description(
            [
                'Report per-workflow wall-clock and cost from REAL (terminal, non-dry) runs in .spur/spur.db.',
                'The cohort defaults to every definition in .spur/workflows/ (bookkeeping workflows excluded).',
                '--json emits the byte-stable baseline payload (workflow + state rows, key-sorted).',
                '--budget <file> runs the per-pipeline budget gate instead (exit 1 on any over-budget,',
                'missing-budget, or silent-raise failure).',
            ].join('\n'),
        )
        .option('--workflow <name>', 'restrict to a workflow (repeatable)', collect, [] as string[])
        .option('--by-state', 'report per-state rows instead of per-workflow rows')
        .option('--include-bookkeeping', 'keep bookkeeping workflows in the default cohort')
        .option('--since <YYYY-MM-DD>', 'only runs created on/after this UTC date')
        .option('--budget <file>', 'run the pipeline budget gate against this budget file')
        .option('--measured-file <json>', 'with --budget: read measured values from this file instead of the DB')
        .option(...SHARED_OPTIONS.json)
        .action(async (options) => {
            const cwd = context.cwd;
            const dbPath = join(cwd, '.spur/spur.db');
            // Project workflow layer (ADR-113): runtime definitions live under .spur/, not the
            // build-time config/ tree (rule sp-runtime-path).
            const workflowsDir = join(cwd, '.spur', 'workflows');
            const openDb = deps.openDb ?? defaultDbOpener;
            try {
                if (options.budget !== undefined) {
                    const result = await runBudgetGate({
                        cwd,
                        budgetPath: options.budget,
                        workflowsDir,
                        dbPath,
                        filters: options.workflow,
                        ...(options.measuredFile !== undefined ? { measuredFile: options.measuredFile } : {}),
                        fs: context.fs,
                        openDb,
                    });
                    if (options.json === true) {
                        context.output.write(toEnvelopeJson({ ok: result.exitCode === 0, ...result }));
                    } else {
                        for (const line of result.errors) context.output.error(line);
                        for (const line of result.lines) context.output.write(line);
                    }
                    if (result.exitCode !== 0) context.setExitCode(1);
                    return;
                }
                if (options.measuredFile !== undefined) throw new Error('--measured-file requires --budget');
                const sinceMs = options.since !== undefined ? parseSince(options.since) : undefined;
                const opts = sinceMs !== undefined ? { sinceMs } : {};
                const targets = await scopedWorkflows(options.workflow, {
                    includeBookkeeping: options.includeBookkeeping === true,
                    workflowsDir,
                    fs: context.fs,
                });
                const db = await openDb(dbPath);
                try {
                    if (options.json === true) {
                        context.output.write(await buildReportJson(db, targets, opts));
                    } else if (options.byState === true) {
                        for (const line of renderStateLines(await readStateMetrics(db, targets, opts))) {
                            context.output.write(line);
                        }
                    } else {
                        for (const line of renderWorkflowLines(await readWorkflowMetrics(db, targets, opts))) {
                            context.output.write(line);
                        }
                    }
                } finally {
                    db.close();
                }
            } catch (err) {
                context.output.error(`spur workflow cost: ${err instanceof Error ? err.message : String(err)}`);
                context.setExitCode(1);
            }
        });
}
