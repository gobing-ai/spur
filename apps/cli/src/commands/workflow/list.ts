import type { Command } from '@commander-js/extra-typings';
import type { WorkflowListResult } from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeWorkflowService, resolveWorkflowPaths } from './shared';

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<string, string> = {
    project: 'project layer',
    registered: 'registered layer',
    shared: 'shared layer',
};

function formatListHuman(result: WorkflowListResult): string {
    const lines: string[] = [];
    const layerLabels = result.layers.map((l) => `${l.id} (${l.path})`).join(', ');
    lines.push(`Sources: ${layerLabels} (layered mode)`);
    lines.push(`Total files: ${result.totalFiles}`);
    lines.push('');

    // Entries are pushed layer-by-layer in layer order, so each layer's entries are a
    // contiguous run with that layer's id — including multiple `registered` folders.
    // Every layer gets a header even when it has no workflows (0819 R2: the project
    // layer is listed even when the folder is missing or empty).
    let idx = 0;
    for (const layer of result.layers) {
        lines.push(`  ${layer.id}/`);
        let layerEntries = 0;
        while (idx < result.entries.length) {
            const entry = result.entries[idx];
            if (entry === undefined || entry.source !== layer.id) break;
            idx++;
            layerEntries++;
            if (entry.valid) {
                lines.push(
                    `    ✓ ${entry.name.padEnd(30)} ${entry.kind.padEnd(20)} ${entry.path}  [${SOURCE_LABELS[layer.id] ?? layer.id}]`,
                );
            } else {
                lines.push(
                    `    ❌ ${entry.name.padEnd(30)} ${entry.kind.padEnd(20)} ${entry.path}  [${SOURCE_LABELS[layer.id] ?? layer.id}] (${entry.error ?? 'unknown'})`,
                );
            }
        }
        if (layerEntries === 0) lines.push('    (no workflows)');
    }

    return lines.join('\n').trimEnd();
}

/** Register `spur workflow list`. */
export function registerWorkflowListCommand(workflow: Command, context: CliContext): void {
    workflow
        .command('list')
        .description('List available workflow YAML files.')
        .option(...SHARED_OPTIONS.jsonSupported)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            const paths = resolveWorkflowPaths(context.spurConfig ?? null);
            const result = await makeWorkflowService(context).list(paths);
            if (options.json) {
                context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
            } else {
                context.output.write(formatListHuman(result));
            }
        });
}
