import { join } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import { collectSelfStatus, type SelfStatusSection } from '@gobing-ai/spur-app';
import { CLI_CONFIG } from '../config';
import type { CliContext } from '../context';
import { CommandError } from '../errors';
import { gitContext } from '../git-context';
import { toEnvelopeJson, writeJsonError } from '../output';
import { readDaemonStatusOrNull } from './self/daemon';
import { SHARED_OPTIONS } from './shared-options';

/**
 * Register `spur status` / `spur self status` (optionally hidden from the top-level help listing).
 *
 * Since A93 1352 the aggregate is app-owned (`collectSelfStatus`) so the standalone command and the
 * consolidated one cannot disagree: this module only reads the optional path target and renders.
 * It also runs before the CLI's database boot — reporting readiness must never create the schema it
 * reports on.
 */
export function registerStatusCommand(program: Command, context: CliContext, options: { hidden?: boolean } = {}): void {
    program
        .command('status', { hidden: options.hidden === true })
        .summary('show project, Git, machine readiness and optional path status')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .argument('[path]', 'Optional file/dir path to check')
        .action(async (path, options) => {
            try {
                const code = await runStatusCore(path, options, context);
                context.setExitCode(code);
            } catch (err) {
                writeJsonError(context.output, options, err instanceof Error ? err.message : String(err));
                context.setExitCode(1);
            }
        });
}

/** Report consolidated read-only readiness, keeping the legacy fields and exit contract. */
async function runStatusCore(
    path: string | undefined,
    options: { json?: boolean; jsonEnvelope?: boolean },
    context: CliContext,
): Promise<number> {
    const target = path === undefined ? undefined : await readTargetStatus(context, path);
    const aggregate = await collectSelfStatus({
        cwd: context.cwd,
        env: context.env,
        config: context.spurConfig ?? null,
        git: await gitContext(context.cwd),
        version: CLI_CONFIG.binaryVersion,
    });
    // The gateway LaunchAgent is machine state, not project readiness: it is reported beside the
    // aggregate (never inside its nine sections) so `spur self status` answers "is the gateway
    // daemon on?" without a second command. Read-only; skipped off macOS where it cannot exist.
    const daemon = await readDaemonStatusOrNull();
    const status = {
        ...aggregate,
        ...(target === undefined ? {} : { target }),
        ...(daemon === null ? {} : { daemon }),
    };

    if (options.json === true) {
        context.output.write(toEnvelopeJson(status, { enveloped: options.jsonEnvelope }));
        return aggregate.ok ? 0 : 1;
    }

    const lines = [
        `Project: ${aggregate.spurConfig ? 'ok' : 'missing .spur/config.yaml'}`,
        `Package: ${aggregate.packageJson ? 'ok' : 'none'}`,
        `Agents: ${aggregate.agentSpecs.length === 0 ? 'none' : aggregate.agentSpecs.join(', ')}`,
        `Git: ${
            aggregate.git.root === null
                ? 'none'
                : `${aggregate.git.branch ?? 'detached'}${aggregate.git.dirty ? ' dirty' : ' clean'}`
        }`,
        `DecisionMaker: ${aggregate.decisionMaker.state}${aggregate.decisionMaker.credentialPresent ? ' (key present)' : ''}`,
        `Readiness: ${aggregate.overallState}`,
        ...Object.entries(aggregate.sections).flatMap(([name, section]) => {
            const line = `  ${name}: ${section.state}${section.message === '' ? '' : ` — ${section.message}`}`;
            return [
                line,
                ...(gatewayCountersLine(name, section) === null ? [] : [gatewayCountersLine(name, section) as string]),
            ];
        }),
        ...(daemon === null
            ? []
            : [
                  `Daemon: ${
                      daemon.installed
                          ? `installed${daemon.loaded ? ` (pid ${daemon.pid ?? 'unknown'})` : ' — not loaded'}`
                          : 'not installed'
                  }${
                      daemon.health === null
                          ? ''
                          : ` — gateway ${(daemon.health as { gateway?: boolean }).gateway === true ? 'on' : 'answered by a project serve'}`
                  }`,
              ]),
        ...(target === undefined ? [] : [`Path: ${target.path}\t${target.size} bytes`]),
    ];
    context.output.write(lines.join('\n'));
    return aggregate.ok ? 0 : 1;
}

/**
 * The one counters line `spur status` prints under a live gateway (1385 R3). Returns null for any
 * other section, or when the gateway section carries no counters — a probe that did not answer must
 * not be rendered as zeroes.
 */
export function gatewayCountersLine(name: string, section: SelfStatusSection): string | null {
    const counters = section.data?.counters as
        | {
              since?: string;
              requests?: number;
              status4xx?: number;
              status5xx?: number;
              upstreamRestarts?: Record<string, number>;
          }
        | undefined;
    if (name !== 'gateway' || counters === undefined) return null;
    const restarts = Object.values(counters.upstreamRestarts ?? {}).reduce((sum, count) => sum + count, 0);
    return `  gateway counters: requests=${counters.requests ?? 0} 4xx=${counters.status4xx ?? 0} 5xx=${counters.status5xx ?? 0} restarts=${restarts} since=${counters.since ?? 'unknown'}`;
}

async function readTargetStatus(
    context: CliContext,
    targetPath: string,
): Promise<{
    path: string;
    size: number;
    isFile: boolean;
    isDirectory: boolean;
}> {
    const resolved = join(context.cwd, targetPath);
    const stat = await context.fs.stat(resolved);
    if (stat === null) throw new CommandError(`status failed: path does not exist at ${resolved}`);
    return { path: targetPath, size: stat.size, isFile: stat.isFile(), isDirectory: stat.isDirectory() };
}
