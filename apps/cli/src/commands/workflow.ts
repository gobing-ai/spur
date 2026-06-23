import type { Command } from '@commander-js/extra-typings';
import {
    WorkflowAppService,
    type WorkflowListEntry,
    type WorkflowListResult,
    type WorkflowTraceListResult,
    type WorkflowTraceTimeline,
} from '@gobing-ai/spur-app';
import { loadSpurConfig } from '../config/loader';
import { resolveConfigFile } from '../config/resolver';
import { SpurAppConfigSchema } from '../config/schema';
import type { CliContext } from '../context';
import { toJson } from '../output';
import { resolveSpurBin } from '../workflow/resolve-spur-bin';

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

/** Read configured workflow search paths, defaulting to `['.spur/workflows/']`. */
async function resolveWorkflowPaths(cwd: string): Promise<string[]> {
    const configFile = resolveConfigFile(cwd);
    if (configFile === undefined) return ['.spur/workflows/'];
    try {
        const raw = await loadSpurConfig(configFile);
        const parsed = SpurAppConfigSchema.parse(raw);
        return parsed.workflows?.paths ?? ['.spur/workflows/'];
    } catch {
        return ['.spur/workflows/'];
    }
}

/** Register `spur workflow` commands. */
export function registerWorkflowCommand(program: Command, context: CliContext): void {
    // `json` selects the HITL responder: interactive prompts must never fire under --json
    // (they would corrupt the JSON stream). Only `run` invokes actions, so only it passes json=true.
    const makeSvc = (json?: boolean) =>
        new WorkflowAppService({
            cwd: context.cwd,
            getDb: () => context.getDb(),
            agentService: () => context.agentService(),
            ruleService: () => context.ruleService(),
            hitlResponder: () => context.hitlResponder(json),
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
        .option('--dry-run', 'Validate and walk transitions without executing actions')
        .option('--json', 'Output machine-readable JSON where supported')
        .action(async (file, options) => {
            // Inject a PATH-independent spur invocation so workflow shell guards
            // (e.g. `${vars.spurBin} task check ${vars.wbs}`) resolve the correct
            // binary inside the execa-spawned subprocess, whose env may lack PATH.
            // User-supplied --vars win on conflict (spread last is intentional here:
            // spurBin is a default, overridable only if a caller deliberately sets it).
            const vars = { spurBin: resolveSpurBin(), ...parseVars(options.vars) };
            const result = await makeSvc(options.json).run(file, {
                runId: options.runId || undefined,
                vars,
                dryRun: options.dryRun || undefined,
            });
            context.output.write(
                options.json
                    ? toJson(result)
                    : `workflow ${result.status}: ${result.workflowName} -> ${result.finalState}`,
            );
            context.setExitCode(result.status === 'done' ? 0 : 1);
        });

    workflow
        .command('continue')
        .description('Resume a paused (HITL) workflow run. Omit run-id to resume the most recent paused run.')
        .argument('[run-id]', 'Run ID to resume (default: the most recent paused run)')
        .option('--yes', 'Resume without prompting for confirmation')
        .option('--json', 'Output machine-readable JSON where supported')
        .action(async (runId, options) => {
            const json = options.json === true;
            const svc = makeSvc(json);
            try {
                let targetId = runId;
                if (targetId === undefined) {
                    // Discover the most recent paused run (E3).
                    const latest = await svc.latestPausedRun();
                    if (latest === null) {
                        context.output.error('No paused workflow run to continue.');
                        context.setExitCode(1);
                        return;
                    }
                    targetId = latest.runId;
                    // Confirm unless --yes (or a non-interactive responder auto-accepts).
                    if (options.yes !== true) {
                        const answer = await context.hitlResponder(json).respond({
                            kind: 'confirm',
                            prompt: `Resume paused run ${latest.runId} (${latest.workflowName})?`,
                            runId: latest.runId,
                            node: 'continue',
                        });
                        if (answer.value !== 'yes') {
                            context.output.error(`Aborted — run ${latest.runId} not resumed.`);
                            context.setExitCode(1);
                            return;
                        }
                    }
                }
                const result = await svc.continuePaused(targetId);
                context.output.write(
                    json ? toJson(result) : `workflow ${result.status}: ${result.workflowName} -> ${result.finalState}`,
                );
                context.setExitCode(result.status === 'done' ? 0 : 1);
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });

    workflow
        .command('list')
        .description('List available workflow YAML files.')
        .option('--json', 'Output machine-readable JSON where supported')
        .action(async (options) => {
            const paths = await resolveWorkflowPaths(context.cwd);
            const result = await makeSvc().list(paths);
            if (options.json) {
                context.output.write(toJson(result));
            } else {
                context.output.write(formatListHuman(result));
            }
        });

    workflow
        .command('trace')
        .description('Show persisted workflow run history.')
        .argument('[run-id]', 'Run ID for per-run timeline detail')
        .option('--workflow <name>', 'Filter by workflow name')
        .option('--status <status>', 'Filter by status: done, failed, running')
        .option('--since <iso-date>', 'Filter runs started on or after this date')
        .option('--last <n>', 'Limit results (default 20)', '20')
        .option('--json', 'Output machine-readable JSON where supported')
        .action(async (runId, options) => {
            const svc = makeSvc();
            const last = parseInt(options.last, 10);
            if (Number.isNaN(last) || last < 1) {
                context.output.error('--last must be a positive integer');
                context.setExitCode(1);
                return;
            }
            if (options.status !== undefined && !['done', 'failed', 'running'].includes(options.status)) {
                context.output.error('--status must be one of: done, failed, running');
                context.setExitCode(1);
                return;
            }
            const result = runId
                ? await svc.trace(runId)
                : await svc.trace({
                      workflow: options.workflow,
                      status: options.status,
                      since: options.since,
                      last,
                  });
            if (options.json) {
                context.output.write(toJson(result));
            } else if ('events' in result) {
                context.output.write(formatTraceTimeline(result));
            } else {
                context.output.write(formatTraceList(result));
            }
        });
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<string, string> = {
    project: 'project layer',
    global: 'user layer',
};

function formatListHuman(result: WorkflowListResult): string {
    if (result.totalFiles === 0) {
        return 'No workflows found.';
    }
    const lines: string[] = [];
    const layerLabels = result.layers.map((l) => `${l.id} (${l.path})`).join(', ');
    lines.push(`Sources: ${layerLabels} (layered mode)`);
    lines.push(`Total files: ${result.totalFiles}`);
    lines.push('');

    // Group entries by source layer
    const byLayer = new Map<string, WorkflowListEntry[]>();
    for (const entry of result.entries) {
        const list = byLayer.get(entry.source) ?? [];
        list.push(entry);
        byLayer.set(entry.source, list);
    }

    for (const [layerId, entries] of byLayer) {
        lines.push(`  ${layerId}/`);
        for (const entry of entries) {
            if (entry.valid) {
                lines.push(
                    `    ✓ ${entry.name.padEnd(30)} ${entry.kind.padEnd(20)} ${entry.path}  [${SOURCE_LABELS[layerId] ?? layerId}]`,
                );
            } else {
                lines.push(
                    `    ❌ ${entry.name.padEnd(30)} ${entry.kind.padEnd(20)} ${entry.path}  [${SOURCE_LABELS[layerId] ?? layerId}] (${entry.error ?? 'unknown'})`,
                );
            }
        }
    }

    return lines.join('\n').trimEnd();
}

function formatTraceList(result: WorkflowTraceListResult): string {
    if (result.entries.length === 0) {
        return 'No workflow runs.';
    }
    const lines = ['RUN ID    WORKFLOW             MODE           STATUS  STARTED               COMPLETED'];
    for (const entry of result.entries) {
        const dryLabel = entry.isDryRun ? ' [dry]' : '';
        lines.push(
            `${entry.runId.padEnd(10)} ${entry.workflowName.padEnd(22)} ${entry.mode.padEnd(15)} ${entry.status.padEnd(7)} ${entry.startedAt.padEnd(22)} ${(entry.completedAt ?? '-').padEnd(22)}${dryLabel}`,
        );
    }
    return lines.join('\n');
}

function formatTraceTimeline(result: WorkflowTraceTimeline): string {
    const { run, events } = result;
    const dryLabel = run.isDryRun ? ' [DRY RUN]' : '';
    const lines = [
        `Run: ${run.runId} — ${run.workflowName} (${run.mode}) — ${run.status}${dryLabel}`,
        `Started: ${run.startedAt}   Completed: ${run.completedAt ?? '-'}   Events: ${events.length}`,
        '',
    ];
    for (const event of events) {
        if (event.kind === 'phase') {
            const ts = event.startedAt ?? event.completedAt ?? '';
            lines.push(`  ${event.phase.padEnd(20)} ${event.status.padEnd(10)} ${ts}`);
        } else if (event.kind === 'transition') {
            const guard = event.trigger ? `  [${event.trigger}]` : '';
            lines.push(`    → ${event.to}${guard}`);
        } else {
            lines.push(`    ⚡ ${event.actionKind.padEnd(15)} ${event.duration.padEnd(6)}${event.label}`);
        }
    }
    return lines.join('\n').trimEnd();
}
