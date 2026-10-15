import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { SHARED_OPTIONS } from '../shared-options';
import { makeService } from './shared';
import { writeStepText } from './step-output';

const OPERATIONS = ['run', 'refine', 'verify'] as const;

/** Corpus facts the preflight reads when the caller did not pass them as flags. */
interface CorpusFacts {
    status: string | null;
    deps: string[];
    depStatuses: Record<string, string>;
}

async function readCorpusFacts(
    context: CliContext,
    folder: string | undefined,
    wbs: string,
    needDeps: boolean,
    knownDepStatuses: Record<string, string>,
): Promise<CorpusFacts> {
    const svc = await makeService(context, folder);
    const shown = await svc.show(wbs);
    const rawDeps = (shown.frontmatter as { dependencies?: unknown } | undefined)?.dependencies;
    const deps = needDeps && Array.isArray(rawDeps) ? rawDeps.map(String) : [];
    const depStatuses: Record<string, string> = {};
    for (const dep of deps) {
        if (knownDepStatuses[dep] !== undefined) continue;
        try {
            depStatuses[dep] = (await svc.show(dep)).status;
        } catch {
            // An unresolvable dependency stays unknown, which the admission policy treats as unmet.
        }
    }
    return { status: shown.status, deps, depStatuses };
}

/**
 * Register `spur task preflight [wbs]` — TABLE A STOP preflight, quick command-aware readiness,
 * one-shot recovery hints and feature-finding classification (script-absorption PR-5; replaces
 * the plugin script `batch-preflight`).
 *
 * With a WBS and no `--status`, status and dependencies (and their statuses) are read from the task
 * corpus; `--status`, `--deps` and `--dep-status` override those reads.
 */
export function registerTaskPreflightCommand(task: Command, context: CliContext): void {
    task.command('preflight')
        .summary('Batch preflight for one task: TABLE A STOP check, quick readiness, recovery hint.')
        .description(
            [
                'Read-only admission decision for one task (the batch driver runs it before a launch).',
                'Status and dependencies come from the task corpus unless --status / --deps / --dep-status are given.',
                '  spur task preflight 0101                       TABLE A STOP evaluation (run | skip <code>)',
                '  spur task preflight 0101 --operation verify    quick command-aware readiness',
                '  spur task preflight 0101 --recovery            one-shot /sp:dev-* recovery hop',
                "  spur task preflight --classify-feature '<json>' split feature findings into aborting / non-aborting",
                'Exit: 0 = run (or recovery hint printed); 2 = skip; 1 = usage or an aborting classification.',
            ].join('\n'),
        )
        .argument('[wbs]', 'Task WBS number')
        .option('--status <status>', 'task status (default: read from the task file)')
        .option('--deps <list>', 'comma-separated dependency WBS list (default: the task frontmatter)')
        .option('--dep-status <map>', 'dependency statuses, e.g. 0275:done,0276:todo (default: read per dependency)')
        .option('--operation <op>', `quick-readiness operation: ${OPERATIONS.join(' | ')}`)
        .option('--filtered-count <n>', 'status-filtered candidate set size (0 = empty set)')
        .option('--required-sections <list>', 'required planning sections (comma-separated)')
        .option('--present-sections <list>', 'planning sections present in the task (comma-separated)')
        .option(...SHARED_OPTIONS.forceTaskPreflight)
        .option('--recovery', 'print the one-shot recovery hop for the status instead of a decision')
        .option('--classify-feature <json>', 'classify feature findings JSON (1132 R4) and exit')
        .option(...SHARED_OPTIONS.folderTasks)
        .option(...SHARED_OPTIONS.json)
        .action(async (wbs, options) => {
            const { parseCommaList, parseDepStatuses, runPreflight } = await import(
                '@gobing-ai/spur-app/pipeline-steps'
            );
            const operation = (OPERATIONS as readonly string[]).includes(options.operation ?? '')
                ? (options.operation as (typeof OPERATIONS)[number])
                : null;
            const filtered = options.filteredCount === undefined ? Number.NaN : Number(options.filteredCount);
            let status = options.status ?? null;
            let deps = parseCommaList(options.deps);
            const depStatuses = parseDepStatuses(options.depStatus);
            if (options.classifyFeature === undefined && status === null && wbs !== undefined) {
                try {
                    const facts = await readCorpusFacts(
                        context,
                        options.folder,
                        wbs,
                        options.deps === undefined,
                        depStatuses,
                    );
                    status = facts.status;
                    if (options.deps === undefined) deps = facts.deps;
                    Object.assign(depStatuses, { ...facts.depStatuses, ...depStatuses });
                } catch (err) {
                    context.output.error(`task preflight: cannot read task ${wbs} — ${String(err)}`);
                    context.setExitCode(1);
                    return;
                }
            }
            const outcome = runPreflight({
                wbs: wbs ?? '0000',
                status,
                deps,
                depStatuses,
                recovery: options.recovery === true,
                json: options.json === true,
                operation,
                force: options.force === true,
                filteredCount: Number.isFinite(filtered) ? filtered : null,
                requiredSections: parseCommaList(options.requiredSections),
                presentSections: parseCommaList(options.presentSections),
                classifyFeature: options.classifyFeature ?? null,
            });
            writeStepText(context.output, 'stdout', outcome.stdout);
            writeStepText(context.output, 'stderr', outcome.stderr);
            context.setExitCode(outcome.exitCode);
        });
}
