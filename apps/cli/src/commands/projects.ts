import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import {
    defaultResolveOwnerPort,
    FleetService,
    type FleetServiceContext,
    isGatewayAnswering,
    isLocalHost,
    isPortLive,
    type OrchestratorBinding,
    ProjectRegistry,
    startRegisteredProject,
    stopRegisteredProject,
} from '@gobing-ai/spur-app';
import {
    buildConfigFromEnv,
    findRegistryFindings,
    findRegistrySuspects,
    getEnvVars,
    resolveProjectPrefix,
} from '@gobing-ai/spur-config';
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
        .option('--host <host>', 'Host for local or remote project (default: "localhost")')
        .option('--prefix <slug>', 'URL path prefix for a local project on the gateway (default: /<name slug>)')
        .option(...SHARED_OPTIONS.nameProjectDisplay)
        .option(...SHARED_OPTIONS.jsonProjectsResponse)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (pathArg, options) => {
            try {
                const host = options.host ?? 'localhost';
                const isLocal = isLocalHost(host);
                let absolutePath = pathArg;

                if (isLocal) {
                    absolutePath = resolve(context.cwd, pathArg);
                    if (!(await context.fs.exists(absolutePath))) {
                        throw new Error(`Directory does not exist: ${absolutePath}`);
                    }
                }
                const name = options.name ?? basename(absolutePath);
                const registry = new ProjectRegistry();
                const entry = await registry.upsert({ path: absolutePath, name, host, prefix: options.prefix });

                if (options.json) {
                    context.output.write(
                        toEnvelopeJson({ ok: true, project: entry }, { enveloped: options.jsonEnvelope }),
                    );
                } else {
                    const hostLabel = !isLocalHost(entry.host) ? ` on host ${entry.host}` : '';
                    const prefixLabel = entry.prefix ? ` (gateway /${entry.prefix.slice(1)})` : '';
                    context.output.write(
                        `Registered project "${entry.name}" at ${entry.path}${hostLabel}${prefixLabel}`,
                    );
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
        .option('--host <host>', 'Remove only the entry registered for this host (default: every match)')
        .option(...SHARED_OPTIONS.jsonProjectsResponse)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (target, options) => {
            try {
                const registry = new ProjectRegistry();
                const removed = await registry.remove(target, options.host);
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
        .command('clean')
        .alias('refresh')
        .description('purge missing project directories, report stale entries and terminate lingering processes')
        .option('--no-terminate-processes', 'Skip process termination on occupied ports')
        .option(
            '--remove-suspects',
            'Also remove entries whose directory exists but whose path is ephemeral or registered more than once',
        )
        .option(...SHARED_OPTIONS.jsonProjectsResponse)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            try {
                const registry = new ProjectRegistry();
                // Suspects first: `refreshProjects` only purges missing directories, so an entry whose
                // ephemeral root still exists survived every sweep (Q R7).
                const registered = await registry.peek().projects;
                // The owner claim is the only authority on which port a path actually serves; a
                // stored number that disagrees is reported, never used to remove the entry.
                const portOwners = new Map<string, number>();
                for (const project of registered) {
                    if (project.port <= 0 || !isLocalHost(project.host)) continue;
                    const owner = await defaultResolveOwnerPort(project.path);
                    if (owner !== null) portOwners.set(project.path, owner);
                }
                const suspects = findRegistrySuspects(registered, { tmpdir: tmpdir(), portOwners });
                const removedSuspects: string[] = [];
                if (options.removeSuspects === true) {
                    for (const suspect of suspects) {
                        // A port mismatch alone never justifies deleting a registration.
                        if (suspect.reasons.every((reason) => reason === 'foreign-port')) continue;
                        if (await registry.remove(suspect.path, suspect.host)) removedSuspects.push(suspect.name);
                    }
                }
                const result = await registry.refreshProjects({
                    terminateProcesses: options.terminateProcesses !== false,
                });

                if (options.json) {
                    context.output.write(
                        toEnvelopeJson(
                            {
                                ok: true,
                                purgedCount: result.purgedProjects.length,
                                purgedProjects: result.purgedProjects,
                                suspects,
                                ...(options.removeSuspects === true ? { removedSuspects } : {}),
                                terminatedProcesses: result.terminatedProcesses,
                                ...(result.resetPorts && result.resetPorts.length > 0
                                    ? { resetPorts: result.resetPorts }
                                    : {}),
                            },
                            { enveloped: options.jsonEnvelope },
                        ),
                    );
                } else if (
                    result.purgedProjects.length === 0 &&
                    (!result.resetPorts || result.resetPorts.length === 0) &&
                    suspects.length === 0
                ) {
                    context.output.write('Registry is clean. No stale project entries found.');
                } else {
                    if (suspects.length > 0) {
                        context.output.write(
                            `Found ${suspects.length} suspect project entr${suspects.length === 1 ? 'y' : 'ies'}:`,
                        );
                        for (const suspect of suspects) {
                            context.output.write(`- ${suspect.message}`);
                        }
                        context.output.write(
                            options.removeSuspects === true
                                ? `Removed ${removedSuspects.length} suspect entr${removedSuspects.length === 1 ? 'y' : 'ies'}.`
                                : 'Nothing removed; re-run with --remove-suspects to delete them.',
                        );
                    }
                    if (result.purgedProjects.length > 0) {
                        context.output.write(`Purged ${result.purgedProjects.length} stale project(s):`);
                        for (const project of result.purgedProjects) {
                            context.output.write(`- ${project.name} (${project.path})`);
                        }
                    }
                    if (result.terminatedProcesses.length > 0) {
                        context.output.write(`Terminated ${result.terminatedProcesses.length} lingering process(es):`);
                        for (const proc of result.terminatedProcesses) {
                            context.output.write(`- PID ${proc.pid} on port ${proc.port} (${proc.signal})`);
                        }
                    }
                    if (result.resetPorts && result.resetPorts.length > 0) {
                        context.output.write(`Reset ${result.resetPorts.length} closed port(s):`);
                        for (const project of result.resetPorts) {
                            const hostLabel = !isLocalHost(project.host) ? `${project.host}:` : '';
                            context.output.write(`- ${project.name} (${hostLabel}${project.port} -> 0)`);
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

                // K4 R7: the URL column reports the gateway URL when the gateway actually answers on
                // its fixed port, and the per-port URL otherwise. Listing never starts a gateway.
                const gatewayPort = buildConfigFromEnv(getEnvVars()).server.gateway.port;
                const gatewayLive = await isGatewayAnswering(gatewayPort);

                const projects = await Promise.all(
                    rawProjects.map(async (p) => {
                        const prefix = resolveProjectPrefix(p);
                        const host = p.host ?? 'localhost';
                        return {
                            ...p,
                            running: p.port > 0 ? await isPortLive(p.port, undefined, p.host) : false,
                            prefix,
                            url:
                                gatewayLive && prefix !== null
                                    ? `http://127.0.0.1:${gatewayPort}${prefix}/board`
                                    : `http://${host}:${p.port}/board`,
                        };
                    }),
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
                    // Derived findings are report-only at load (task 1357) — the same derivation the
                    // Board renders, so both surfaces name the same remedy (Q R6).
                    for (const finding of findRegistryFindings(rawProjects)) {
                        context.output.write(`Warning: ${finding.message}`);
                    }
                    context.output.write('Registered Projects:\n');
                    for (const [i, p] of projects.entries()) {
                        const hostLabel = !isLocalHost(p.host) ? ` (${p.host})` : '';
                        const status = p.running ? `[RUNNING: ${p.port}]` : '[STOPPED]';
                        context.output.write(`- ${p.name}${hostLabel} ${status} (${p.path})`);
                        // The route an operator needs is the prefix; a remote entry has none.
                        context.output.write(`    prefix: ${p.prefix ?? 'none (remote)'}`);
                        // A stopped project has no per-port URL, and a routed one is only reachable
                        // while the gateway answers — never print `http://localhost:0/board`.
                        if (p.running || (gatewayLive && p.prefix !== null)) {
                            context.output.write(`    url: ${p.url}`);
                        } else {
                            context.output.write(
                                `    url: none (stopped; start it with spur projects start ${p.name})`,
                            );
                        }
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

                // A remote entry is another machine's serve: this CLI cannot verify or
                // signal it, and probing locally read an absent local listener as "already
                // stopped", clearing the remote port while its serve kept listening.
                if (!isLocalHost(entry.host)) {
                    throw new Error(
                        `Refusing to stop "${entry.name}": it is a remote project on ${entry.host}` +
                            `${entry.port > 0 ? `:${entry.port}` : ''}. Stop that serve on ${entry.host}, or remove the entry with \`spur projects remove ${entry.name} --host ${entry.host}\`.`,
                    );
                }

                if (entry.port > 0) {
                    // 1156: the shared ownership-verified stop — a live listener is
                    // signaled only after it proves service:spur and this exact
                    // project path over loopback HTTP, with the PID rediscovered
                    // unchanged. A foreign/unverified listener is refused (exit 1,
                    // port preserved, never reported Stopped); an absent listener is
                    // an idempotent success that clears the stale port.
                    const result = await stopRegisteredProject(entry, {
                        processExecutor: new NodeProcessExecutor(),
                    });
                    if (!result.stopped) {
                        throw new Error(result.reason ?? `Refused to stop project "${entry.name}"`);
                    }
                    await registry.setPort(entry.path, 0, entry.host);
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
