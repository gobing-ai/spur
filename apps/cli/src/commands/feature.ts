import type { Command } from '@commander-js/extra-typings';
import {
    FEATURE_LIFECYCLE_PROFILE,
    FeatureCheckService,
    FeatureService,
    PlanningWriteService,
    resolvePlanningFolders,
    type WriteResult,
} from '@gobing-ai/spur-app';
import type { CliContext } from '../context';
import { toJson } from '../output';
import { makePlanningEmitter } from '../planning-emitter';
import { makeLifecycleAdapter } from '../workflow/make-lifecycle-adapter';
import { SHARED_OPTIONS } from './shared-options';

/** Register the `spur feature` command and its subcommands on the CLI program. */
export function registerFeatureCommand(program: Command, context: CliContext): void {
    const feature = program.command('feature').summary('manage features (hierarchical IDs)');

    // ── create ──
    feature
        .command('create')
        .summary('Create a feature; allocates a hierarchical ID (DD-14) under the create-lock.')
        .argument('<name>', 'Feature name')
        .option('--parent <id>', 'Parent feature ID (child gets the next free digit 1-9)')
        .option(...SHARED_OPTIONS.folderFeatures)
        .option(...SHARED_OPTIONS.json)
        .action(async (name, options) => {
            const svc = await makeService(context, options.folder);
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
        // `get` alias (0534 R1): mirrors `task show` — the noun is symmetric (show by id),
        // so the same discovery gap applies.
        .alias('get')
        .summary('Show a feature by ID.')
        .argument('<id>', 'Feature ID')
        .option(...SHARED_OPTIONS.folderFeatures)
        .option(...SHARED_OPTIONS.json)
        .action(async (id, options) => {
            const svc = await makeService(context, options.folder);
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
        .summary('Update a feature status, scalar frontmatter field, or section body.')
        .argument('<id>', 'Feature ID')
        .argument('[status]', 'New lifecycle status')
        .addHelpText(
            'after',
            [
                'Section names are validated against the closed-world canonical set; a rejected',
                '`--section` costs a failed write. List valid names first:',
                '`spur task sections <wbs> list`.',
            ].join('\n'),
        )
        .option('--field <key>', 'Frontmatter field to set (e.g. priority)')
        .option('--value <value>', 'New value for --field')
        .option(...SHARED_OPTIONS.section)
        .option(...SHARED_OPTIONS.fromFile)
        .option(...SHARED_OPTIONS.folderFeatures)
        .option(...SHARED_OPTIONS.json)
        .action(async (id, status, options) => {
            const svc = await makeService(context, options.folder);
            try {
                let result: WriteResult | undefined;
                if (options.section !== undefined) {
                    if (options.fromFile === undefined) {
                        context.output.error('--from-file is required with --section');
                        context.setExitCode(2);
                        return;
                    }
                    result = await svc.updateSection(id, options.section, options.fromFile);
                    if (!options.json) {
                        for (const warning of result.warnings ?? []) {
                            context.output.error(warning);
                        }
                        context.output.write(`Updated section '${options.section}' in feature ${result.ref.id}`);
                    }
                } else if (options.fromFile !== undefined) {
                    context.output.error('--section is required with --from-file');
                    context.setExitCode(2);
                    return;
                }
                if (options.field !== undefined) {
                    if (options.value === undefined) {
                        context.output.error('--value is required with --field');
                        context.setExitCode(2);
                        return;
                    }
                    result = await svc.update(id, options.field, options.value);
                    if (!options.json) {
                        context.output.write(`Updated ${options.field} on feature ${result.ref.id}`);
                    }
                } else if (options.value !== undefined) {
                    context.output.error('--field is required with --value');
                    context.setExitCode(2);
                    return;
                }
                if (status !== undefined) {
                    result = await svc.transition(id, status);
                    if (!options.json) {
                        context.output.write(`${result.ref.id}: ${result.fromStatus} → ${result.toStatus}`);
                    }
                }
                if (result === undefined) {
                    context.output.error('Either <status>, --field/--value, or --section/--from-file is required');
                    context.setExitCode(2);
                    return;
                }
                if (options.json) {
                    context.output.write(toJson(result));
                }
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });

    // ── advance ──
    feature
        .command('advance')
        .summary('Walk a feature through the legal forward lifecycle path.')
        .argument('<id>', 'Feature ID to advance')
        .option('--to <status>', "Target status (default: 'done')")
        .option(...SHARED_OPTIONS.folderFeatures)
        .option(...SHARED_OPTIONS.json)
        .action(async (id, options) => {
            const svc = await makeService(context, options.folder);
            const target = options.to ?? 'done';
            const forwardPath: Record<string, string> = {
                backlog: 'active',
                active: 'verifying',
                verifying: 'done',
            };
            const history: Array<{ from: string; to: string }> = [];
            try {
                const initial = await svc.show(id);
                if (initial === null) {
                    context.output.error(`Feature ${id} not found`);
                    context.setExitCode(1);
                    return;
                }
                let current = initial.status;
                if (current === target) {
                    if (options.json) {
                        context.output.write(toJson({ id, status: current, hops: history }));
                    } else {
                        context.output.write(`${id}: already at ${current}; no advance needed`);
                    }
                    return;
                }
                let next: string | undefined = forwardPath[current];
                while (next !== undefined) {
                    if (current === 'active') {
                        await assertFeatureCheckPass(context, id, options.folder, false, 'verifying');
                    } else if (current === 'verifying') {
                        await assertFeatureCheckPass(context, id, options.folder, true, 'done');
                    }

                    const result = await svc.transition(id, next);
                    history.push({ from: result.fromStatus ?? current, to: result.toStatus ?? next });
                    const observed = await svc.show(id);
                    current = observed?.status ?? result.toStatus ?? next;
                    if (current !== next) {
                        throw new Error(
                            `Feature ${id} expected status '${next}' after transition, observed '${current}'`,
                        );
                    }
                    if (current === target) break;
                    next = forwardPath[current];
                }
                if (current !== target) {
                    context.output.error(`${id}: cannot reach '${target}' from '${current}' along the forward path`);
                    context.setExitCode(1);
                    return;
                }
                if (options.json) {
                    context.output.write(toJson({ id, status: current, hops: history }));
                } else {
                    const trail = history.map((h) => `${h.from} → ${h.to}`).join(', ');
                    context.output.write(`${id}: advanced to ${current} (${trail})`);
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
        .option(...SHARED_OPTIONS.statusFilter)
        .option(...SHARED_OPTIONS.priorityFilter)
        .option(...SHARED_OPTIONS.folderFeatures)
        .option(...SHARED_OPTIONS.json)
        .action(async (options) => {
            const svc = await makeService(context, options.folder);
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
        .option(...SHARED_OPTIONS.dryRunFeatureMap)
        .option(...SHARED_OPTIONS.folderFeatures)
        .option(...SHARED_OPTIONS.json)
        .action(async (id, options) => {
            const svc = await makeService(context, options.folder);
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
    // Distinct from `sync`: refresh rewrites derived docs only (INDEX + ## Tasks).
    // It never changes feature lifecycle status or runs transition guards.
    feature
        .command('refresh')
        .summary('Rebuild INDEX.md and each feature ## Tasks table from task edges (docs only — no status change).')
        .description(
            [
                'Regenerate derived views so feature markdown matches the task graph:',
                '  • docs/features/INDEX.md (ID-encoded tree)',
                '  • each feature ## Tasks auto-gen region (WBS / title / status from feature_id edges)',
                '',
                'Does NOT change feature frontmatter status. For lifecycle alignment use `spur feature sync`.',
                'Use after task create/link/done when the ## Tasks table is stale.',
            ].join('\n'),
        )
        .option(...SHARED_OPTIONS.featureTasksRewrite)
        .option(...SHARED_OPTIONS.folderFeatures)
        .option(...SHARED_OPTIONS.json)
        .action(async (options) => {
            const svc = await makeService(context, options.folder);
            try {
                const result = await svc.refresh({ featureId: options.feature });
                if (options.json) {
                    const featuresDir = options.folder ?? (await resolvePlanningFolders(context.fs)).featuresDir;
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
        .option(...SHARED_OPTIONS.strictFeature)
        .option(...SHARED_OPTIONS.asFeature0418)
        .option(...SHARED_OPTIONS.folderFeatures)
        .option('--fix', 'repair structural findings in place (heading presence/level/order, R-item checkboxes)')
        .option(...SHARED_OPTIONS.json)
        .action(async (id, options) => {
            const resolved = await resolvePlanningFolders(context.fs);
            const featuresDir = options.folder ?? context.fs.resolve(resolved.featuresDir);
            const tasksDir = context.fs.resolve(resolved.tasksDir);
            // Scan every registered phase folder for feature_id edges (parity with feature sync).
            const tasksDirs = Object.keys(resolved.foldersConfig.folders).map((p) => context.fs.resolve(p));
            if (!tasksDirs.includes(tasksDir)) tasksDirs.unshift(tasksDir);
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
                        tasksDirs,
                        // Verdict SSOT is always <cwd>/.spur/run (not docs/.spur/run).
                        runDir: context.fs.resolve('.spur/run'),
                        severityOverrides: resolved.severityOverrides,
                        asStatus: options.as,
                        fix: options.fix === true,
                    });
                    results.push(result);
                    if (!json) {
                        if (result.repairs !== undefined && result.repairs.length > 0) {
                            for (const r of result.repairs) {
                                context.output.write(`  [FIX] ${r.kind} ${r.section}: ${r.detail}`);
                            }
                        }
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

    // ── sync ──
    feature
        // Distinct from `refresh`: sync proposes/applies real lifecycle transitions
        // (and their guards). It does not rewrite INDEX.md or ## Tasks tables.
        .command('sync')
        .summary('Align feature lifecycle status with linked task states (status only — runs transition guards).')
        .description(
            [
                'Derive a feature status proposal from linked task statuses and apply legal hops',
                '(e.g. all tasks done → advance toward done; reopened work → reopen the feature).',
                '',
                'Applies real lifecycle transitions — gates such as dogfood, one-active-goal, and',
                'L4 AC readiness may deny a hop. Preview with --dry-run first.',
                '',
                'Does NOT rewrite INDEX.md or ## Tasks tables. For stale rosters use `spur feature refresh`.',
            ].join('\n'),
        )
        .argument('[id]', 'Feature ID to sync (optional if --all is passed)')
        .option('--all', 'Sync all features with linked tasks')
        .option(...SHARED_OPTIONS.dryRunFeatureSync)
        .option(...SHARED_OPTIONS.forceFeatureReopen)
        .option(...SHARED_OPTIONS.folderFeatures)
        .option(...SHARED_OPTIONS.json)
        .action(async (id, options) => {
            const svc = await makeService(context, options.folder);
            try {
                if (!options.all && !id) {
                    context.output.error('Feature ID is required unless --all is passed');
                    context.setExitCode(2);
                    return;
                }

                if (options.all) {
                    const result = await svc.syncAllFeatures({
                        dryRun: options.dryRun,
                        forceConfirm: options.force,
                    });
                    if (options.json) {
                        context.output.write(toJson(result));
                    } else {
                        context.output.write(
                            `Evaluated ${result.evaluated}/${result.totalFeatures} features; updated ${result.updatedCount} feature(s).`,
                        );
                        for (const res of result.results) {
                            const tag = res.applied
                                ? 'UPDATED'
                                : res.goalConflict !== undefined
                                  ? 'GOAL-CONFLICT'
                                  : res.proposal.from === res.proposal.to
                                    ? 'NOOP'
                                    : 'SKIPPED';
                            context.output.write(
                                `  [${tag}] ${res.proposal.featureId}: ${res.proposal.from} -> ${res.proposal.to} (${res.proposal.reason})`,
                            );
                        }
                    }
                } else if (id) {
                    const result = await svc.syncFeature(id, {
                        dryRun: options.dryRun,
                        forceConfirm: options.force,
                    });
                    if (options.json) {
                        context.output.write(toJson(result));
                    } else {
                        const tag = result.applied
                            ? 'UPDATED'
                            : result.goalConflict !== undefined
                              ? 'GOAL-CONFLICT'
                              : result.proposal.from === result.proposal.to
                                ? 'NOOP'
                                : 'SKIPPED';
                        context.output.write(
                            `Feature ${id}: [${tag}] ${result.proposal.from} -> ${result.proposal.to} (${result.proposal.reason})`,
                        );
                    }
                }
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });
}

async function makeService(context: CliContext, folderOverride?: string): Promise<FeatureService> {
    // Derive feature/task folders from `.spur/config.yaml` (phase folders) — never hardcode.
    const resolved = await resolvePlanningFolders(context.fs);
    const featuresDir = folderOverride ?? context.fs.resolve(resolved.featuresDir);
    const tasksDir = context.fs.resolve(resolved.tasksDir);
    const lifecycle = makeLifecycleAdapter(context, FEATURE_LIFECYCLE_PROFILE);
    const writeService = new PlanningWriteService({
        fs: context.fs,
        ...(lifecycle ? { lifecycle } : {}),
        emitter: makePlanningEmitter(context),
    });
    // Pass foldersConfig so move/refresh scan every phase folder (tasks, tasks2, tasks3, …)
    // when rewriting task feature_id edges — not only the active tasksDir.
    return new FeatureService({
        fs: context.fs,
        writeService,
        featuresDir,
        tasksDir,
        foldersConfig: resolved.foldersConfig,
    });
}

async function assertFeatureCheckPass(
    context: CliContext,
    id: string,
    folderOverride: string | undefined,
    strict: boolean,
    asStatus?: string,
): Promise<void> {
    const resolved = await resolvePlanningFolders(context.fs);
    const featuresDir = folderOverride ?? context.fs.resolve(resolved.featuresDir);
    const tasksDir = context.fs.resolve(resolved.tasksDir);
    const tasksDirs = Object.keys(resolved.foldersConfig.folders).map((p) => context.fs.resolve(p));
    if (!tasksDirs.includes(tasksDir)) tasksDirs.unshift(tasksDir);
    const entries = await context.fs.readDir(featuresDir);
    const fileName = entries.find((name) => name.match(new RegExp(`^${id}_.+\\.md$`)));
    if (fileName === undefined) {
        throw new Error(`Feature ${id} not found`);
    }
    const result = await new FeatureCheckService(context.fs).check(`${featuresDir}/${fileName}`, id, {
        strict,
        featuresDir,
        tasksDir,
        tasksDirs,
        // 0418: the hop's target status so the one-active-goal rule sees the
        // post-transition state (same hint the FSM shell guard passes).
        asStatus,
    });
    if (!result.pass) {
        const details = result.findings.map((f) => `${f.layer} ${f.section}: ${f.message}`).join('; ');
        throw new Error(`Feature ${id} check failed before advance${strict ? ' (strict)' : ''}: ${details}`);
    }
}
