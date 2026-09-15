import { basename, dirname, join, resolve } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import {
    FleetService,
    type FleetServiceContext,
    isPortLive,
    type OrchestratorBinding,
    ProjectRegistry,
    startRegisteredProject,
} from '@gobing-ai/spur-app';
import { createMigratedDb, type DbAdapter, type ProjectStrategy, ProjectStrategyDao } from '@gobing-ai/spur-domain';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import type { CliContext } from '../context';
import { toEnvelopeJson } from '../output';
import { SHARED_OPTIONS } from './shared-options';

/**
 * Registers the `spur projects` CLI command group (add, remove, list, start, stop).
 */
export function registerProjectsCommand(program: Command, context: CliContext): void {
    const projectsCmd = program.command('projects').summary('manage the Spur multi-project registry');

    projectsCmd
        .command('add')
        .argument('<path>', 'Project root directory path')
        .option(...SHARED_OPTIONS.nameProjectDisplay)
        .option(...SHARED_OPTIONS.jsonProjectsResponse)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (pathArg, options) => {
            try {
                const absolutePath = resolve(context.cwd, pathArg);

                if (!(await context.fs.exists(absolutePath))) {
                    throw new Error(`Directory does not exist: ${absolutePath}`);
                }
                const name = options.name ?? basename(absolutePath);
                const registry = new ProjectRegistry();
                const entry = await registry.upsert({ path: absolutePath, name, port: 0 });

                if (options.json) {
                    context.output.write(
                        toEnvelopeJson({ ok: true, project: entry }, { enveloped: options.jsonEnvelope }),
                    );
                } else {
                    context.output.write(`Registered project "${entry.name}" at ${entry.path}`);
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (options.json) {
                    context.output.write(
                        toEnvelopeJson(
                            { ok: false, error: message },
                            { enveloped: options.jsonEnvelope, error: { code: 'INTERNAL_ERROR', message: message } },
                        ),
                    );
                } else {
                    context.output.error(`Error: ${message}`);
                }
                context.setExitCode(1);
            }
        });

    projectsCmd
        .command('remove')
        .argument('<target>', 'Project display name or directory path')
        .option(...SHARED_OPTIONS.jsonProjectsResponse)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (target, options) => {
            try {
                const registry = new ProjectRegistry();
                const removed = await registry.remove(target);
                if (!removed) {
                    throw new Error(`Project not found in registry: "${target}"`);
                }

                if (options.json) {
                    context.output.write(
                        toEnvelopeJson({ ok: true, removed: target }, { enveloped: options.jsonEnvelope }),
                    );
                } else {
                    context.output.write(`Removed project "${target}" from registry`);
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (options.json) {
                    context.output.write(
                        toEnvelopeJson(
                            { ok: false, error: message },
                            { enveloped: options.jsonEnvelope, error: { code: 'INTERNAL_ERROR', message } },
                        ),
                    );
                } else {
                    context.output.error(`Error: ${message}`);
                }
                context.setExitCode(1);
            }
        });

    projectsCmd
        .command('list')
        .option(...SHARED_OPTIONS.jsonProjectsArray)
        .option(
            '--fleet',
            "Also resolve each project's agent.fleet declaration and orchestrator binding (0835/0836/0858)",
        )
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            try {
                const registry = new ProjectRegistry();
                const rawProjects = await registry.list();

                const projects = await Promise.all(
                    rawProjects.map(async (p) => ({
                        ...p,
                        running: p.port > 0 ? await isPortLive(p.port) : false,
                    })),
                );

                // --fleet (0835/0836/0858): resolve each project's agent.fleet section
                // and orchestrator binding under the existing verb (no new noun —
                // public-surface rule). Per-project config is re-layered so
                // executor/capability resolution reads THAT project's config, not the
                // caller's; a project that fails resolution reports the error instead of
                // failing the whole listing.
                //
                // 0836: orchestrator state reads `project_claims` from the PROJECT's own
                // db, opened lazily through `openDb` — only projects whose pointer
                // actually resolves touch SQLite; missing/unresolvable states never do.
                // The adapter is process-transient (the CLI exits after listing), so it
                // is not closed here.
                const openProjectDb = async (projectPath: string): Promise<DbAdapter> => {
                    const url = join(projectPath, '.spur', 'spur.db');
                    await context.fs.ensureDir(dirname(url));
                    return createMigratedDb({ url });
                };
                const fleets = options.fleet
                    ? await Promise.all(
                          projects.map(async (p) => {
                              // Built inside each try: the project's config load is the first
                              // step, so a sibling project with an invalid (or retired-source)
                              // config reports `fleet: unavailable` naming the loader's message
                              // instead of aborting the whole listing (0858 R2/R5).
                              const loadStrict = context.loadAgentConfigStrict ?? context.loadAgentConfig;
                              const fleetCtx = async (): Promise<FleetServiceContext> => ({
                                  spurConfig: (await loadStrict(p.path)) ?? undefined,
                                  roles: context.agentRoles,
                                  fs: context.fs,
                                  openDb: openProjectDb,
                              });
                              let fleet: Awaited<ReturnType<FleetService['resolve']>> | null = null;
                              let error: string | undefined;
                              try {
                                  fleet = await new FleetService(await fleetCtx()).resolve(p.path);
                              } catch (err) {
                                  error = err instanceof Error ? err.message : String(err);
                              }
                              let orchestrator: OrchestratorBinding | null = null;
                              let orchestratorError: string | undefined;
                              try {
                                  orchestrator = await new FleetService(await fleetCtx()).resolveOrchestrator(p.path);
                              } catch (err) {
                                  orchestratorError = err instanceof Error ? err.message : String(err);
                              }
                              // 0838: the persisted strategy (R1) — read-only here; a
                              // project with no row reports the `rest` default and never
                              // writes one (the Board/runtime owns persistence).
                              let strategy: ProjectStrategy | null = null;
                              let strategyError: string | undefined;
                              try {
                                  strategy = await new ProjectStrategyDao(await openProjectDb(p.path)).get(p.path);
                              } catch (err) {
                                  strategyError = err instanceof Error ? err.message : String(err);
                              }
                              return {
                                  path: p.path,
                                  fleet,
                                  ...(error !== undefined ? { error } : {}),
                                  orchestrator,
                                  ...(orchestratorError !== undefined ? { orchestratorError } : {}),
                                  strategy,
                                  ...(strategyError !== undefined ? { strategyError } : {}),
                              };
                          }),
                      )
                    : null;

                if (options.json) {
                    context.output.write(
                        toEnvelopeJson(
                            {
                                projects: fleets
                                    ? projects.map((p, i) => {
                                          const f = fleets[i];
                                          return {
                                              ...p,
                                              fleet: f?.fleet ?? null,
                                              ...(f?.error !== undefined ? { fleetError: f.error } : {}),
                                              orchestrator: f?.orchestrator ?? null,
                                              ...(f?.orchestratorError !== undefined
                                                  ? { orchestratorError: f.orchestratorError }
                                                  : {}),
                                              strategy: f?.strategy ?? null,
                                              ...(f?.strategyError !== undefined
                                                  ? { strategyError: f.strategyError }
                                                  : {}),
                                          };
                                      })
                                    : projects,
                            },
                            { enveloped: options.jsonEnvelope },
                        ),
                    );
                } else {
                    if (projects.length === 0) {
                        context.output.write('No projects registered.');
                        return;
                    }
                    context.output.write('Registered Projects:\n');
                    for (const [i, p] of projects.entries()) {
                        const status = p.running ? `[RUNNING: ${p.port}]` : '[STOPPED]';
                        context.output.write(`- ${p.name} ${status} (${p.path})`);
                        const f = fleets?.[i];
                        if (f === undefined) continue;
                        if (f.fleet === null) {
                            context.output.write(`    fleet: unavailable (${f.error})`);
                            continue;
                        }
                        if (f.fleet.missing.includes('no-declaration')) {
                            context.output.write('    fleet: no declaration (agent.fleet)');
                            continue;
                        }
                        // 0858 R5: the off switch is named, not implied by an empty roster.
                        // The roster still prints — a disabled fleet is a resolved state.
                        if (f.fleet.missing.includes('fleet-disabled')) {
                            context.output.write('    fleet: disabled (agent.fleet.enabled: false)');
                        }
                        for (const m of f.fleet.members) {
                            const flag = m.enabled ? '' : ' [disabled]';
                            const role = m.role ?? '-';
                            context.output.write(
                                `    - ${m.instanceId}${flag} role=${role} executor=${m.executor} fsWrite=${m.capabilityState} write=${m.writeCapable}`,
                            );
                        }
                        if (f.fleet.missing.includes('no-enabled-members')) {
                            context.output.write('    fleet: no enabled members');
                        }
                        // 0836 R4: `missing` (nothing bound) and `bound-offline` (bound,
                        // no live claim) are different lines with different next actions.
                        const o = f.orchestrator;
                        if (o !== null) {
                            switch (o.state) {
                                case 'bound-online':
                                    context.output.write(
                                        `    orchestrator: bound-online ${o.instanceId} (holder ${o.holderId})`,
                                    );
                                    break;
                                case 'bound-offline':
                                    context.output.write(
                                        `    orchestrator: bound-offline ${o.instanceId} (no live claim)`,
                                    );
                                    break;
                                case 'missing':
                                    context.output.write(`    orchestrator: missing (${o.reason})`);
                                    break;
                                case 'unresolvable':
                                    context.output.write(`    orchestrator: unresolvable (${o.reason})`);
                                    break;
                            }
                        } else if (f.orchestratorError !== undefined) {
                            context.output.write(`    orchestrator: unavailable (${f.orchestratorError})`);
                        }
                        // 0838 R1: the persisted strategy, or the `rest` default (never written by a read).
                        if (f.strategy !== null) {
                            context.output.write(
                                `    strategy: ${f.strategy.strategy} (v${f.strategy.strategyVersion})`,
                            );
                        } else if (f.strategyError !== undefined) {
                            context.output.write(`    strategy: unavailable (${f.strategyError})`);
                        } else {
                            context.output.write('    strategy: rest (default)');
                        }
                    }
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (options.json) {
                    context.output.write(
                        toEnvelopeJson(
                            { ok: false, error: message },
                            { enveloped: options.jsonEnvelope, error: { code: 'INTERNAL_ERROR', message } },
                        ),
                    );
                } else {
                    context.output.error(`Error: ${message}`);
                }
                context.setExitCode(1);
            }
        });

    projectsCmd
        .command('start')
        .argument('<target>', 'Project display name or path')
        .option(...SHARED_OPTIONS.portProjects, parseInt)
        .option(...SHARED_OPTIONS.jsonProjectsResponse)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (target, options) => {
            try {
                const registry = new ProjectRegistry();
                const result = await startRegisteredProject(registry, target, {
                    port: typeof options.port === 'number' && !Number.isNaN(options.port) ? options.port : undefined,
                });

                if (options.json) {
                    context.output.write(
                        toEnvelopeJson(
                            {
                                ok: true,
                                project: {
                                    name: result.name,
                                    path: result.path,
                                    port: result.port,
                                },
                                running: true,
                                alreadyRunning: result.alreadyRunning,
                                url: result.url,
                            },
                            { enveloped: options.jsonEnvelope },
                        ),
                    );
                } else if (result.alreadyRunning) {
                    context.output.write(`Project "${result.name}" is already running at ${result.url}`);
                } else {
                    context.output.write(`Started project "${result.name}" on ${result.url}`);
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (options.json) {
                    context.output.write(
                        toEnvelopeJson(
                            { ok: false, error: message },
                            { enveloped: options.jsonEnvelope, error: { code: 'INTERNAL_ERROR', message } },
                        ),
                    );
                } else {
                    context.output.error(`Error: ${message}`);
                }
                context.setExitCode(1);
            }
        });

    projectsCmd
        .command('stop')
        .argument('<target>', 'Project display name or path')
        .option(...SHARED_OPTIONS.jsonProjectsResponse)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (target, options) => {
            try {
                const registry = new ProjectRegistry();
                const entry = (await registry.getByName(target)) ?? (await registry.getByPath(target));
                if (!entry) {
                    throw new Error(`Project not found: "${target}"`);
                }

                if (entry.port > 0) {
                    // Signal process(es) bound to the port. Best-effort: never
                    // SIGTERM ourselves (or our parent) — tests and in-process
                    // listeners share the port with the CLI, and Linux `fuser`
                    // correctly returns the host PID, which would suicide the
                    // suite (CI exit 143). Use ProcessExecutor (not Bun.spawn).
                    try {
                        const result = await new NodeProcessExecutor().run({
                            command: 'fuser',
                            args: [`${entry.port}/tcp`],
                            forceBuffered: true,
                            rejectOnError: false,
                        });
                        const outputStr = `${result.stdout}\n${result.stderr}`;
                        const pids = outputStr
                            .trim()
                            .split(/\s+/)
                            .map(Number)
                            .filter((n) => Number.isInteger(n) && n > 1);
                        const self = process.pid;
                        const parent = process.ppid;
                        for (const pid of pids) {
                            if (pid === self || pid === parent) continue;
                            try {
                                process.kill(pid, 'SIGTERM');
                            } catch {
                                // ESRCH / EPERM — ignore per-pid
                            }
                        }
                    } catch {
                        // Best-effort process kill (fuser missing, etc.)
                    }
                    await registry.setPort(entry.path, 0);
                }

                if (options.json) {
                    context.output.write(
                        toEnvelopeJson({ ok: true, stopped: entry.name }, { enveloped: options.jsonEnvelope }),
                    );
                } else {
                    context.output.write(`Stopped project "${entry.name}"`);
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (options.json) {
                    context.output.write(
                        toEnvelopeJson(
                            { ok: false, error: message },
                            { enveloped: options.jsonEnvelope, error: { code: 'INTERNAL_ERROR', message } },
                        ),
                    );
                } else {
                    context.output.error(`Error: ${message}`);
                }
                context.setExitCode(1);
            }
        });
}
