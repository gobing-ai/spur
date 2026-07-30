import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import { isPortLive, ProjectRegistry, startRegisteredProject } from '@gobing-ai/spur-app';
import type { CliContext } from '../context';
import { toJson } from '../output';

/**
 * Registers the `spur projects` CLI command group (add, remove, list, start, stop).
 */
export function registerProjectsCommand(program: Command, context: CliContext): void {
    const projectsCmd = program.command('projects').summary('manage the Spur multi-project registry');

    projectsCmd
        .command('add')
        .argument('<path>', 'Project root directory path')
        .option('--name <name>', 'Display name for the project')
        .option('--json', 'Output JSON response')
        .action(async (pathArg, options) => {
            try {
                const absolutePath = resolve(context.cwd, pathArg);

                if (!existsSync(absolutePath)) {
                    throw new Error(`Directory does not exist: ${absolutePath}`);
                }
                const name = options.name ?? basename(absolutePath);
                const registry = new ProjectRegistry();
                const entry = await registry.upsert({ path: absolutePath, name, port: 0 });

                if (options.json) {
                    context.output.write(toJson({ ok: true, project: entry }));
                } else {
                    context.output.write(`Registered project "${entry.name}" at ${entry.path}`);
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (options.json) {
                    context.output.write(toJson({ ok: false, error: message }));
                } else {
                    context.output.error(`Error: ${message}`);
                }
                context.setExitCode(1);
            }
        });

    projectsCmd
        .command('remove')
        .argument('<target>', 'Project display name or directory path')
        .option('--json', 'Output JSON response')
        .action(async (target, options) => {
            try {
                const registry = new ProjectRegistry();
                const removed = await registry.remove(target);
                if (!removed) {
                    throw new Error(`Project not found in registry: "${target}"`);
                }

                if (options.json) {
                    context.output.write(toJson({ ok: true, removed: target }));
                } else {
                    context.output.write(`Removed project "${target}" from registry`);
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (options.json) {
                    context.output.write(toJson({ ok: false, error: message }));
                } else {
                    context.output.error(`Error: ${message}`);
                }
                context.setExitCode(1);
            }
        });

    projectsCmd
        .command('list')
        .option('--json', 'Output JSON array of projects')
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

                if (options.json) {
                    context.output.write(toJson({ projects }));
                } else {
                    if (projects.length === 0) {
                        context.output.write('No projects registered.');
                        return;
                    }
                    context.output.write('Registered Projects:\n');
                    for (const p of projects) {
                        const status = p.running ? `[RUNNING: ${p.port}]` : '[STOPPED]';
                        context.output.write(`- ${p.name} ${status} (${p.path})`);
                    }
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (options.json) {
                    context.output.write(toJson({ ok: false, error: message }));
                } else {
                    context.output.error(`Error: ${message}`);
                }
                context.setExitCode(1);
            }
        });

    projectsCmd
        .command('start')
        .argument('<target>', 'Project display name or path')
        .option('--port <n>', 'Explicit port to bind', parseInt)
        .option('--json', 'Output JSON response')
        .action(async (target, options) => {
            try {
                const registry = new ProjectRegistry();
                const result = await startRegisteredProject(registry, target, {
                    port: typeof options.port === 'number' && !Number.isNaN(options.port) ? options.port : undefined,
                });

                if (options.json) {
                    context.output.write(
                        toJson({
                            ok: true,
                            project: {
                                name: result.name,
                                path: result.path,
                                port: result.port,
                            },
                            running: true,
                            alreadyRunning: result.alreadyRunning,
                            url: result.url,
                        }),
                    );
                } else if (result.alreadyRunning) {
                    context.output.write(`Project "${result.name}" is already running at ${result.url}`);
                } else {
                    context.output.write(`Started project "${result.name}" on ${result.url}`);
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (options.json) {
                    context.output.write(toJson({ ok: false, error: message }));
                } else {
                    context.output.error(`Error: ${message}`);
                }
                context.setExitCode(1);
            }
        });

    projectsCmd
        .command('stop')
        .argument('<target>', 'Project display name or path')
        .option('--json', 'Output JSON response')
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
                    // suite (CI exit 143).
                    try {
                        const ps = Bun.spawn(['fuser', `${entry.port}/tcp`], {
                            stdout: 'pipe',
                            stderr: 'ignore',
                        });
                        const outputStr = await new Response(ps.stdout).text();
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
                    context.output.write(toJson({ ok: true, stopped: entry.name }));
                } else {
                    context.output.write(`Stopped project "${entry.name}"`);
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (options.json) {
                    context.output.write(toJson({ ok: false, error: message }));
                } else {
                    context.output.error(`Error: ${message}`);
                }
                context.setExitCode(1);
            }
        });
}
