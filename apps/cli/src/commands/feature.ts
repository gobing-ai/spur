import type { Command } from '@commander-js/extra-typings';
import {
    FEATURE_LIFECYCLE_PROFILE,
    FeatureCheckService,
    FeatureService,
    PlanningWriteService,
} from '@gobing-ai/spur-app';
import type { CliContext } from '../context';
import { toJson } from '../output';
import { makeLifecycleAdapter } from '../workflow/make-lifecycle-adapter';

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

    // ── move ──
    feature
        .command('move')
        .summary('Move a feature to a new parent — cascade rename of the subtree (DD-14).')
        .argument('<id>', 'Feature ID to move')
        .option('--parent <id>', 'New parent feature ID (omit to move to a top-level group)')
        .option('--dry-run', 'Show the old→new ID map + affected tasks without writing')
        .option('--folder <path>', 'Custom features folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (id, options) => {
            const svc = makeService(context, options.folder);
            try {
                const result = await svc.move(id, options.parent ?? null, { dryRun: options.dryRun === true });
                if (options.json) {
                    context.output.write(toJson(result));
                } else if (result.dryRun) {
                    context.output.write(`Dry run — ${result.movedCount} feature(s) would be re-IDed:`);
                    for (const [oldId, newId] of Object.entries(result.mapping)) {
                        context.output.write(`  ${oldId} → ${newId}`);
                    }
                    context.output.write(`  ${result.tasksUpdated.length} task edge(s) would be updated`);
                } else {
                    context.output.write(
                        `Moved ${result.movedCount} feature(s); ${result.tasksUpdated.length} task edge(s) updated`,
                    );
                }
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });

    // ── refresh ──
    feature
        .command('refresh')
        .summary('Regenerate INDEX.md (ID-encoded tree) and repopulate each feature ## Tasks region.')
        .option('--folder <path>', 'Custom features folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (options) => {
            const svc = makeService(context, options.folder);
            try {
                const result = await svc.refresh();
                if (options.json) {
                    const featuresDir = options.folder ?? context.fs.resolve('docs', 'features');
                    context.output.write(
                        toJson({ index_path: `${featuresDir}/INDEX.md`, tasksUpdated: result.tasksUpdated }),
                    );
                } else {
                    context.output.write(
                        `INDEX.md regenerated (${result.index.split('\n').length} lines); ${result.tasksUpdated} feature Tasks region(s) updated`,
                    );
                }
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });

    // ── check ──
    feature
        .command('check')
        .summary('Validate feature file(s) through the four-layer check (design §3).')
        .argument('[id]', 'Feature ID (validates all features in the folder when omitted)')
        .option('--strict', 'Elevate warnings to failures')
        .option('--folder <path>', 'Custom features folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (id, options) => {
            const featuresDir = options.folder ?? context.fs.resolve('docs', 'features');
            const tasksDir = context.fs.resolve('docs', 'tasks');
            const svc = new FeatureCheckService(context.fs);
            const json = options.json === true;
            const strict = options.strict === true;
            try {
                const entries = await context.fs.readDir(featuresDir);
                const ids: string[] = id
                    ? [id]
                    : entries
                          .map((n) => n.match(/^([A-Z][1-9]*)_.+\.md$/)?.[1])
                          .filter((n): n is string => n !== undefined);

                const results = [];
                for (const fid of ids) {
                    const fileName = entries.find((n) => n.match(new RegExp(`^${fid}_.+\\.md$`)));
                    if (!fileName) {
                        context.output.error(`Feature ${fid} not found`);
                        context.setExitCode(1);
                        continue;
                    }
                    const result = await svc.check(`${featuresDir}/${fileName}`, fid, {
                        strict,
                        featuresDir,
                        tasksDir,
                    });
                    results.push(result);
                    if (!json) {
                        context.output.write(`\n${result.id} (${result.status}): ${result.pass ? 'PASS' : 'FAIL'}`);
                        for (const f of result.findings) {
                            const tag = f.severity === 'error' ? 'ERR' : 'WARN';
                            context.output.write(`  [${tag}] ${f.layer} ${f.section}: ${f.message}`);
                        }
                    }
                }
                if (json) {
                    context.output.write(toJson(results));
                }
                if (results.some((r) => !r.pass)) context.setExitCode(1);
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
    const lifecycle = makeLifecycleAdapter(context, FEATURE_LIFECYCLE_PROFILE);
    const writeService = new PlanningWriteService({
        fs: context.fs,
        ...(lifecycle ? { lifecycle } : {}),
    });
    return new FeatureService({ fs: context.fs, writeService, featuresDir, tasksDir });
}
