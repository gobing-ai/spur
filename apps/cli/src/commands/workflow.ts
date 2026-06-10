import type { Command } from '@commander-js/extra-typings';
import { WorkflowAppService } from '@gobing-ai/spur-app';
import type { CliContext } from '../context';
import { toJson } from '../output';

/**
 * Parse the `--vars` flag into a string→string map, or `undefined` when absent.
 * Workflow vars are `Record<string, string>`; reject anything else loudly rather
 * than passing malformed values into the engine's template resolution.
 */
function parseVars(raw: string | undefined): Record<string, string> | undefined {
    if (raw === undefined) {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`--vars must be a valid JSON object: ${raw}`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('--vars must be a JSON object, e.g. \'{"taskId":"0042"}\'');
    }
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (typeof value !== 'string') {
            throw new Error(`--vars values must be strings; "${key}" is ${typeof value}`);
        }
        vars[key] = value;
    }
    return vars;
}

/** Register `spur workflow` commands. */
export function registerWorkflowCommand(program: Command, context: CliContext): void {
    const makeSvc = () =>
        new WorkflowAppService({
            cwd: context.cwd,
            getDb: () => context.getDb(),
            agentService: () => context.agentService(),
            ruleService: () => context.ruleService(),
        });

    const workflow = program.command('workflow').summary('validate and execute workflow YAML files');

    workflow
        .command('validate')
        .description('Validate a workflow definition.')
        .argument('<file>', 'Workflow YAML file')
        .option('--no-schema', 'Skip schema validation')
        .option('--json', 'Output machine-readable JSON where supported')
        .action(async (file, options) => {
            const result = await makeSvc().validate(file, { validateSchema: options.schema });
            if (options.json) {
                context.output.write(toJson(result));
            } else if (result.valid) {
                context.output.write(`workflow valid: ${result.workflow.name}`);
            } else {
                context.output.error(
                    `workflow invalid: ${result.file}\n${result.errors.map((m) => `  - ${m}`).join('\n')}`,
                );
            }
            context.setExitCode(result.valid ? 0 : 1);
        });

    workflow
        .command('run')
        .description('Execute a workflow definition.')
        .argument('<file>', 'Workflow YAML file')
        .option('--run-id <id>', 'Persisted run id for workflow run')
        .option('--vars <json>', 'Per-run variable overrides as a JSON object, e.g. \'{"taskId":"0042"}\'')
        .option('--json', 'Output machine-readable JSON where supported')
        .action(async (file, options) => {
            const vars = parseVars(options.vars);
            const result = await makeSvc().run(file, { runId: options.runId || undefined, vars });
            context.output.write(
                options.json
                    ? toJson(result)
                    : `workflow ${result.status}: ${result.workflowName} -> ${result.finalState}`,
            );
            context.setExitCode(result.status === 'done' ? 0 : 1);
        });

    workflow
        .command('list')
        .description('List persisted workflow runs.')
        .option('--json', 'Output machine-readable JSON where supported')
        .action(async (options) => {
            const { runs } = await makeSvc().list();
            if (options.json) {
                context.output.write(toJson({ runs }));
            } else {
                context.output.write(
                    runs.length === 0
                        ? 'No workflow runs.'
                        : runs.map((run) => `${run.id} ${run.status} ${run.workflow_name}`).join('\n'),
                );
            }
        });
}
