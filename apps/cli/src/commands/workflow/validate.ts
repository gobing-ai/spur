import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeWorkflowService } from './shared';

/**
 * Format a workflow definition's optional `version` field for the validate
 * command output (0756 R2). The literal is treated as opaque — not parsed,
 * ordered, or compared for compatibility. Absent field → `unversioned`;
 * present non-empty literal → `explicit(<literal>)`. The literal is
 * wrapped in parentheses verbatim so non-semver strings surface unchanged.
 */
export function formatWorkflowVersion(version: unknown): string {
    if (version === undefined || version === null) return 'unversioned';
    if (typeof version !== 'string') return 'unversioned';
    if (version === '') return 'unversioned';
    return `explicit(${version})`;
}

/** Register `spur workflow validate`. */
export function registerWorkflowValidateCommand(workflow: Command, context: CliContext): void {
    workflow
        .command('validate')
        .description('Validate a workflow definition.')
        .argument('<file>', 'Workflow YAML file')
        .option(...SHARED_OPTIONS.noSchema)
        .option(...SHARED_OPTIONS.jsonSupported)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (file, options) => {
            const result = await makeWorkflowService(context).validate(file, { validateSchema: options.schema });
            if (options.json) {
                context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
            } else if (result.valid) {
                context.output.write(
                    `workflow valid: ${result.workflow.name} (${formatWorkflowVersion(result.workflow.version)})`,
                );
                // 0822: every finding prints to stderr, prefixed with its level.
                for (const f of result.composition?.findings ?? []) {
                    const m =
                        f.measure.kind === 'shell-lines' || f.measure.kind === 'guard-lines'
                            ? `${f.measure.measured} logical commands (threshold ${f.measure.threshold})`
                            : f.measure.kind === 'shell-chars'
                              ? `${f.measure.measured} chars (threshold ${f.measure.threshold})`
                              : f.measure.kind === 'agent-run-chars'
                                ? `${f.measure.measured} prompt chars (severity ${f.measure.severity})`
                                : 'no output check';
                    context.output.error(`composition ${f.level}: ${f.actionKey} — ${m} — ${f.recommendation}`);
                }
            } else {
                context.output.error(
                    `workflow invalid: ${result.file}\n${result.errors.map((m) => `  - ${m}`).join('\n')}`,
                );
            }
            // 0822: any error-level composition finding fails validate, in human
            // and --json mode alike; warn-only findings keep exit 0. Run/dry-run/
            // continue never see composition findings at all.
            const hasError = result.valid && (result.composition?.findings ?? []).some((f) => f.level === 'error');
            context.setExitCode(!result.valid || hasError ? 1 : 0);
        });
}
