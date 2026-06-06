import type { Command } from '@commander-js/extra-typings';
import { WorkflowAppService } from '@gobing-ai/spur-app';
import type { CliContext } from '../context';
import { toJson } from '../output';

/** Register `spur workflow` commands. */
export function registerWorkflowCommand(program: Command, context: CliContext): void {
    const workflow = program.command('workflow').summary('validate and execute workflow YAML files');

    workflow
        .command('validate')
        .description('Validate a workflow definition.')
        .argument('<file>', 'Workflow YAML file')
        .option('--no-schema', 'Skip schema validation')
        .option('--json', 'Output machine-readable JSON where supported')
        .action(async (file, options) => {
            const svc = new WorkflowAppService({ cwd: context.cwd, getDb: () => context.getDb() });
            const result = await svc.validate(file, { validateSchema: options.schema });
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
        .option('--json', 'Output machine-readable JSON where supported')
        .action(async (file, options) => {
            const svc = new WorkflowAppService({ cwd: context.cwd, getDb: () => context.getDb() });
            const result = await svc.run(file, options.runId || undefined);
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
            const svc = new WorkflowAppService({ cwd: context.cwd, getDb: () => context.getDb() });
            const { runs } = await svc.list();
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
