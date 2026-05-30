import {
    createDefaultWorkflowEngineHost,
    DbWorkflowPersistenceAdapter,
    loadWorkflowDef,
    WorkflowService,
} from '@gobing-ai/ts-dual-workflow-engine';
import { booleanFlag, stringFlag } from '../args';
import type { CliContext } from '../context';
import { toJson } from '../output';

/** Execute workflow-domain commands. */
export async function runWorkflowCommand(
    subcommand: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
    positionals: readonly string[],
): Promise<number> {
    switch (subcommand) {
        case 'validate':
            return await validateWorkflow(context, flags, positionals);
        case 'run':
            return await runWorkflow(context, flags, positionals);
        case 'list':
            return await listWorkflowRuns(context, flags);
        default:
            context.output.error(
                'Usage: spur workflow validate|run <workflow.yaml> [--json] | spur workflow list [--json]',
            );
            return 1;
    }
}

async function validateWorkflow(
    context: CliContext,
    flags: Record<string, string | boolean>,
    positionals: readonly string[],
): Promise<number> {
    const file = requiredWorkflowFile(positionals);
    const workflow = await loadWorkflowDef(file);
    if (booleanFlag(flags, 'json')) {
        context.output.write(toJson({ ok: true, workflow }));
    } else {
        context.output.write(`workflow valid: ${workflow.name}`);
    }
    return 0;
}

async function runWorkflow(
    context: CliContext,
    flags: Record<string, string | boolean>,
    positionals: readonly string[],
): Promise<number> {
    const file = requiredWorkflowFile(positionals);
    const service = await createWorkflowService(context);
    const result = await service.runFile(file, {
        workdir: context.cwd,
        runId: stringFlag(flags, 'run-id', crypto.randomUUID()),
    });
    if (booleanFlag(flags, 'json')) {
        context.output.write(toJson(result));
    } else {
        context.output.write(`workflow ${result.status}: ${result.workflowName} -> ${result.finalState}`);
    }
    return result.status === 'done' ? 0 : 1;
}

async function listWorkflowRuns(context: CliContext, flags: Record<string, string | boolean>): Promise<number> {
    const service = await createWorkflowService(context);
    const runs = await service.listRuns();
    if (booleanFlag(flags, 'json')) {
        context.output.write(toJson({ runs }));
    } else {
        context.output.write(
            runs.length === 0
                ? 'No workflow runs.'
                : runs.map((run) => `${run.id} ${run.status} ${run.workflow_name}`).join('\n'),
        );
    }
    return 0;
}

async function createWorkflowService(context: CliContext): Promise<WorkflowService> {
    return new WorkflowService(
        createDefaultWorkflowEngineHost(),
        new DbWorkflowPersistenceAdapter(await context.getDb()),
    );
}

function requiredWorkflowFile(positionals: readonly string[]): string {
    const file = positionals[0];
    if (file === undefined) throw new Error('Workflow file path is required');
    return file;
}
