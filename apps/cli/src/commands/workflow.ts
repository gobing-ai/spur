import { WorkflowAppService } from '@gobing-ai/spur-app';
import { booleanFlag, stringFlag } from '../args';
import type { CliContext } from '../context';
import { toJson } from '../output';

const USAGE = 'Usage: spur workflow validate|run <workflow.yaml> [--json] | spur workflow list [--json]';

/** Render detailed usage for `spur workflow`. */
export function helpText(): string {
    return [
        'spur workflow - validate and execute workflow YAML files',
        '',
        'Usage: spur workflow <command> [options]',
        '',
        'Commands:',
        '  validate <workflow.yaml> [--json]',
        '      Validate a workflow definition.',
        '  run <workflow.yaml> [--run-id <id>] [--json]',
        '      Execute a workflow definition.',
        '  list [--json]',
        '      List persisted workflow runs.',
        '  help',
        '      Show this help.',
        '',
        'Options:',
        '  --run-id <id>       Persisted run id for workflow run',
        '  --no-schema         Skip JSON-schema validation where supported',
        '  --json              Output machine-readable JSON where supported',
        '  -h, --help          Show this help',
        '',
        'Examples:',
        '  spur workflow validate .spur/workflows/basic.yaml',
        '  spur workflow run .spur/workflows/basic.yaml --run-id smoke',
        '  spur workflow list --json',
    ].join('\n');
}

function requiredWorkflowFile(positionals: readonly string[]): string {
    const file = positionals[0];
    if (file === undefined) throw new Error('Workflow file path is required');
    return file;
}
/** Execute workflow-domain commands. */
export async function runWorkflowCommand(
    subcommand: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
    positionals: readonly string[],
): Promise<number> {
    const svc = new WorkflowAppService({ cwd: context.cwd, getDb: () => context.getDb() });
    const json = booleanFlag(flags, 'json');

    switch (subcommand) {
        case 'validate': {
            const file = requiredWorkflowFile(positionals);
            const result = await svc.validate(file, { validateSchema: !booleanFlag(flags, 'no-schema') });
            if (json) {
                context.output.write(toJson(result));
            } else if (result.valid) {
                context.output.write(`workflow valid: ${result.workflow.name}`);
            } else
                context.output.error(
                    `workflow invalid: ${result.file}\n${result.errors.map((m) => `  - ${m}`).join('\n')}`,
                );
            return result.valid ? 0 : 1;
        }
        case 'run': {
            const file = requiredWorkflowFile(positionals);
            const result = await svc.run(file, stringFlag(flags, 'run-id', '') || undefined);
            context.output.write(
                json ? toJson(result) : `workflow ${result.status}: ${result.workflowName} -> ${result.finalState}`,
            );
            return result.status === 'done' ? 0 : 1;
        }
        case 'list': {
            const { runs } = await svc.list();
            if (json) {
                context.output.write(toJson({ runs }));
            } else
                context.output.write(
                    runs.length === 0
                        ? 'No workflow runs.'
                        : runs.map((run) => `${run.id} ${run.status} ${run.workflow_name}`).join('\n'),
                );
            return 0;
        }
        default:
            context.output.error(USAGE);
            return 1;
    }
}
