import type { Command } from '@commander-js/extra-typings';
import {
    buildPhasedPlan,
    buildWorkflowSteps,
    parseWorkflowInventory,
    type ResolvedWorkflowDefinition,
    renderWorkflowTodo,
    resolveWorkflowDefinition,
} from '@gobing-ai/spur-app';
import { EMBEDDED_SPUR_SCHEMAS } from '../../config/embedded-schemas';
import type { CliContext } from '../../context';
import { toJson, writeJsonError } from '../../output';
import { renderWorkflowMermaid } from '../../workflow/mermaid-render';
import { SHARED_OPTIONS } from '../shared-options';
import { resolveWorkflowPaths } from './shared';

/** Register `spur workflow show`. */
export function registerWorkflowShowCommand(workflow: Command, context: CliContext): void {
    workflow
        .command('show')
        .description('Render a workflow definition: mermaid FSM diagram (default) or declared-step todo checklist.')
        .argument('<file>', 'Workflow YAML file')
        .option('--format <name>', 'Projection to render: mermaid (default) or todo', 'mermaid')
        .option(...SHARED_OPTIONS.jsonSupported)
        .action(async (file, options) => {
            // Validate the format before resolving the file so an unknown value fails fast (0695 R7).
            if (options.format !== 'mermaid' && options.format !== 'todo') {
                writeJsonError(
                    context.output,
                    options,
                    `workflow show: unknown --format '${options.format}' — expected mermaid or todo`,
                    'VALIDATION_FAILED',
                );
                context.setExitCode(1);
                return;
            }
            // 0768 R1: `show` resolves through the SAME shared resolver as run/resume,
            // so the displayed identity (digest + version) is exactly what a run of
            // this file would stamp. Error envelopes are preserved: file-not-found
            // stays NOT_FOUND; a read/parse/schema/version failure stays
            // VALIDATION_FAILED with the resolver's message.
            let resolvedDefinition: ResolvedWorkflowDefinition;
            try {
                resolvedDefinition = await resolveWorkflowDefinition(context.cwd, file, {
                    embeddedSchemas: EMBEDDED_SPUR_SCHEMAS,
                    registered: resolveWorkflowPaths(context.spurConfig ?? null),
                });
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                const missing = message.startsWith('Workflow not found:');
                writeJsonError(
                    context.output,
                    options,
                    missing
                        ? message.replace('Workflow not found:', 'workflow show: file not found:')
                        : `workflow show: cannot read or parse ${file} — ${message}`,
                    missing ? 'NOT_FOUND' : 'VALIDATION_FAILED',
                );
                context.setExitCode(1);
                return;
            }
            const def = resolvedDefinition.workflow;
            if (options.json) {
                if (options.format === 'todo') {
                    // 0814 R4: validate the projection before publishing. Fail closed on a
                    // malformed/unresolved projection (never publish a misleading plan); the
                    // public JSON schema is unchanged for a valid definition (unversioned
                    // `null` is a supported known-unversioned projection).
                    const projection = {
                        name: def.name,
                        kind: def.kind ?? 'state-machine',
                        format: 'todo',
                        // 0768 R1 identity: declared version literal or null
                        // (known-unversioned); canonical definition digest.
                        version: resolvedDefinition.workflow.version ?? null,
                        definitionDigest: resolvedDefinition.digest,
                        // 0819 R4: the layer the definition resolved from — the same
                        // vocabulary `workflow list --json` reports.
                        source: { layer: resolvedDefinition.layer, path: resolvedDefinition.path },
                        steps: buildWorkflowSteps(def),
                        // 1104 R4: additive phased plan projected from `display`
                        // annotations — null unless a state declares display, so the
                        // existing JSON schema (name/kind/format/version/digest/source/
                        // steps) is unchanged for unannotated definitions.
                        plan: buildPhasedPlan(def),
                    };
                    const parsed = parseWorkflowInventory(projection);
                    if (!parsed.ok) {
                        writeJsonError(
                            context.output,
                            options,
                            `workflow show: invalid todo projection — ${parsed.error}`,
                            'VALIDATION_FAILED',
                        );
                        context.setExitCode(1);
                        return;
                    }
                    context.output.write(toJson(projection));
                } else {
                    context.output.write(
                        toJson({
                            name: def.name,
                            kind: def.kind ?? 'state-machine',
                            format: 'mermaid',
                            version: resolvedDefinition.workflow.version ?? null,
                            definitionDigest: resolvedDefinition.digest,
                            // 0819 R4: resolution layer, same vocabulary as `workflow list --json`.
                            source: { layer: resolvedDefinition.layer, path: resolvedDefinition.path },
                            diagram: renderWorkflowMermaid(def),
                        }),
                    );
                }
                return;
            }
            context.output.write(options.format === 'todo' ? renderWorkflowTodo(def) : renderWorkflowMermaid(def));
        });
}
