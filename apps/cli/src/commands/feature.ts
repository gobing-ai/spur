import type { Command } from '@commander-js/extra-typings';
import { FeatureService, PlanningWriteService } from '@gobing-ai/spur-app';
import type { CliContext } from '../context';
import { toJson } from '../output';

/** Register the `spur feature` command and its subcommands on the CLI program. */
export function registerFeatureCommand(program: Command, context: CliContext): void {
    const feature = program.command('feature').summary('manage features (hierarchical IDs)');

    // ── create ──
    feature
        .command('create')
        .summary('Create a feature; allocates a hierarchical ID (DD-14) under the create-lock.')
        .argument('<name>', 'Feature name')
        .option('--parent <id>', 'Parent feature ID (child gets the next free digit 1-9)')
        .option('--folder <path>', 'Custom features folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (name, options) => {
            const svc = makeService(context, options.folder);
            try {
                const result = await svc.create(name, options.parent);
                if (options.json) {
                    context.output.write(toJson(result));
                } else {
                    context.output.write(`Created feature ${result.ref.id}: ${result.ref.filePath}`);
                }
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });

    // ── show ──
    feature
        .command('show')
        .summary('Show a feature by ID.')
        .argument('<id>', 'Feature ID')
        .option('--folder <path>', 'Custom features folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (id, options) => {
            const svc = makeService(context, options.folder);
            try {
                const result = await svc.show(id);
                if (result === null) {
                    context.output.error(`Feature ${id} not found`);
                    context.setExitCode(1);
                    return;
                }
                if (options.json) {
                    const { content, ...rest } = result;
                    context.output.write(toJson({ ...rest, content }));
                } else {
                    context.output.write(result.content);
                }
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });

    // ── update ──
    feature
        .command('update')
        .summary('Update a feature status (lifecycle) or a scalar frontmatter field.')
        .argument('<id>', 'Feature ID')
        .argument('[status]', 'New lifecycle status (omit when using --field/--value)')
        .option('--field <key>', 'Frontmatter field to set (e.g. priority)')
        .option('--value <value>', 'New value for --field')
        .option('--folder <path>', 'Custom features folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (id, status, options) => {
            const svc = makeService(context, options.folder);
            try {
                if (options.field !== undefined) {
                    if (options.value === undefined) {
                        context.output.error('--value is required with --field');
                        context.setExitCode(2);
                        return;
                    }
                    const result = await svc.update(id, options.field, options.value);
                    write(context, options.json, result, `Updated ${options.field} on feature ${result.ref.id}`);
                } else if (status !== undefined) {
                    const result = await svc.transition(id, status);
                    write(context, options.json, result, `${result.ref.id}: ${result.fromStatus} → ${result.toStatus}`);
                } else {
                    context.output.error('Either <status> or --field/--value is required');
                    context.setExitCode(2);
                }
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });

    // ── list ──
    feature
        .command('list')
        .summary('List features with optional status/priority filters.')
        .option('--status <s>', 'Filter by status')
        .option('--priority <p>', 'Filter by priority')
        .option('--folder <path>', 'Custom features folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (options) => {
            const svc = makeService(context, options.folder);
            try {
                let features = await svc.list();
                if (options.status !== undefined) {
                    features = features.filter((f) => f.status === options.status);
                }
                if (options.priority !== undefined) {
                    features = features.filter((f) => f.priority === options.priority);
                }
                features.sort((a, b) => a.id.localeCompare(b.id));
                if (options.json) {
                    context.output.write(toJson(features));
                } else if (features.length === 0) {
                    context.output.write('(no features)');
                } else {
                    for (const f of features) {
                        context.output.write(`${f.id.padEnd(4)}  ${f.status.padEnd(9)}  ${f.priority}  ${f.name}`);
                    }
                }
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });
}

/** Write a write-result either as JSON or a human line. */
function write(context: CliContext, json: boolean | undefined, result: unknown, humanLine: string): void {
    if (json) {
        context.output.write(toJson(result));
    } else {
        context.output.write(humanLine);
    }
}

function makeService(context: CliContext, folderOverride?: string): FeatureService {
    const featuresDir = folderOverride ?? context.fs.resolve('docs', 'features');
    const tasksDir = context.fs.resolve('docs', 'tasks');
    const writeService = new PlanningWriteService({ fs: context.fs });
    return new FeatureService({ fs: context.fs, writeService, featuresDir, tasksDir });
}
