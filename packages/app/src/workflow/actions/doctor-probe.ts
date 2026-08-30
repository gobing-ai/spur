import { normalize, resolve, sep } from 'node:path';
import type { ActionResult, ActionRunContext, ActionRunner } from '@gobing-ai/ts-dual-workflow-engine';
import {
    createNodeFileSystem,
    type FileSystem,
    NodeProcessExecutor,
    type ProcessExecutor,
} from '@gobing-ai/ts-runtime';
import { bounded, type WorkflowActionOutputEvent, type WorkflowObservabilityBus } from '../observability';
import { splitLaunchCommand } from '../split-launch-command';

const KIND = 'doctor.probe';

function stringOption(options: Record<string, unknown>, key: string, fallback?: string): string {
    const value = options[key];
    if (typeof value === 'string') return value;
    if (fallback !== undefined) return fallback;
    throw new Error(`Action option "${key}" must be a string`);
}

/**
 * Parse `.agents[0]` from `spur agent doctor <exe> --json`; anything unexpected
 * stays unknown — usable defaults to true so a parse failure can never stop the
 * pipeline (soft-probe contract, B4/0682 R4).
 */
function parseDoctorJson(stdout: string): { usable: boolean; resolvedAgent: string } {
    try {
        const parsed = JSON.parse(stdout) as {
            agents?: Array<{ usable?: unknown; agent?: unknown }>;
        };
        const first = parsed.agents?.[0];
        const usable = typeof first?.usable === 'boolean' ? first.usable : true;
        // The row names the executor a role selector resolved to; direct executor
        // probes echo their own name. Used only for the log line.
        const resolvedAgent = typeof first?.agent === 'string' && first.agent.length > 0 ? first.agent : '';
        return { usable, resolvedAgent };
    } catch {
        return { usable: true, resolvedAgent: '' };
    }
}

/**
 * Workflow action runner for `doctor.probe` — the pre-launch executor doctor check.
 *
 * Replaces the task-pipeline precheck shell classifier (task 0608, feature D6 R4–R5): it
 * probes each resolved executor with `spur agent doctor <exe> --json`, classifies the row on
 * USABILITY alone (B4/0682 collapsed the auth-aware classifier — the CLI process cannot see
 * an agent-owned credential store, so authentication never decided an outcome), writes
 * PASS/FAIL to a status file beneath `.spur/run/`, and always returns success — it is a soft
 * probe whose transition guards route on the status token, never a raw lifecycle abort.
 */
export class DoctorProbeActionRunner implements ActionRunner {
    readonly kind = KIND;

    constructor(
        private readonly processExecutor: ProcessExecutor = new NodeProcessExecutor(),
        private readonly fileSystem: FileSystem = createNodeFileSystem(),
        private readonly observabilityBus?: WorkflowObservabilityBus,
    ) {}

    async execute(options: Record<string, unknown>, context: ActionRunContext): Promise<ActionResult> {
        const resultFileRaw = options.resultFile;
        if (typeof resultFileRaw !== 'string' || resultFileRaw.trim() === '') {
            return {
                ok: false,
                error: 'Action option "resultFile" must be a non-empty string resolving under .spur/run/',
            };
        }
        const spurBin = stringOption(options, 'spurBin', 'spur');
        const requestedAgent = stringOption(options, 'agent');
        const role = stringOption(options, 'role', '');
        const agent = requestedAgent === 'inline' || requestedAgent === 'auto' ? role : requestedAgent;
        if (agent === '') {
            return { ok: false, error: 'doctor.probe: reserved agent selectors require a declared role' };
        }
        const implementAgent = stringOption(options, 'implementAgent', agent);
        const resolvedAgentVar = stringOption(options, 'resolvedAgentVar', '');

        const workdir = context.workdir ?? process.cwd();
        const allowedDir = resolve(workdir, '.spur', 'run');
        const normalized = normalize(resolve(workdir, resultFileRaw));
        // Boundary compare: a raw prefix check would let `.spur/run-evil/x` and
        // `.spur/run2/x` pass — the target must sit inside `.spur/run/`, not merely
        // start with its string (verify P3, doctor-probe.ts).
        const withinAllowed = normalized === allowedDir || normalized.startsWith(allowedDir + sep);
        if (!withinAllowed) {
            return {
                ok: false,
                error: `resultFile must resolve beneath .spur/run/ (got ${resultFileRaw})`,
            };
        }

        const split = splitLaunchCommand(spurBin, 'doctor.probe "spurBin"');
        if ('error' in split) {
            return { ok: false, error: split.error };
        }

        const emit = (chunk: string): void => {
            if (this.observabilityBus === undefined) return;
            const event: WorkflowActionOutputEvent = {
                schemaVersion: 1,
                eventId: crypto.randomUUID(),
                sequence: 0,
                runId: context.runId,
                at: new Date().toISOString(),
                kind: KIND,
                node: context.stateOrNodeId,
                stream: 'stdout',
                chunk: bounded(chunk),
                severity: 'info',
            };
            this.observabilityBus.emit('workflow.action.output', event);
        };

        await this.fileSystem.ensureDir(allowedDir);

        let status = 'PASS';
        const lines: string[] = [];
        let electedAgent = '';
        // Divergence line: probing both executors is legitimate when only implementAgent is
        // pinned, but it must be visible in the log (task 0487 R4).
        const execs = implementAgent !== '' && implementAgent !== agent ? [agent, implementAgent] : [agent];
        if (execs.length === 2) {
            const line = `precheck: agent=${agent} implementAgent=${implementAgent} (executors diverge)`;
            lines.push(line);
            emit(line);
        }

        for (const exe of execs) {
            const res = await this.processExecutor.run({
                command: split.command,
                args: [...split.leadingArgs, 'agent', 'doctor', exe, '--json'],
                cwd: workdir,
                forceBuffered: true,
                rejectOnError: false,
            });

            if (res.exitCode !== 0) {
                const line = `precheck: FAIL - doctor exited non-zero for ${exe}`;
                lines.push(line);
                emit(line);
                const body = `${res.stdout}\n${res.stderr}`.trim();
                if (body !== '') {
                    lines.push(body);
                    emit(body);
                }
                status = 'FAIL';
                continue;
            }

            const { usable, resolvedAgent } = parseDoctorJson(res.stdout);
            if (electedAgent === '') electedAgent = resolvedAgent || exe;
            // Show the resolved executor only when it differs from the selector (a
            // role was resolved); direct executors keep the terse original line.
            const resolvedSuffix = resolvedAgent !== '' && resolvedAgent !== exe ? ` (resolved ${resolvedAgent})` : '';
            const line = `precheck: ${exe}${resolvedSuffix} usable=${usable}`.replace(/\s+$/, '');
            lines.push(line);
            emit(line);

            if (!usable) {
                const fail = `precheck: FAIL - executor ${exe} is not usable per doctor; run ${spurBin} agent doctor ${exe} --json or pass --vars '{"agent":"<usable-executor>"}'`;
                lines.push(fail);
                emit(fail);
                status = 'FAIL';
            }
        }

        await this.fileSystem.writeFile(normalized, `${status}\n`);
        // Soft probe: always succeed so transition guards can route the recorded FAIL to a
        // `failed` terminal state instead of a raw lifecycle abort mid-enter.
        return {
            ok: true,
            data: { status, resultFile: normalized, output: lines },
            setVars: resolvedAgentVar !== '' && electedAgent !== '' ? { [resolvedAgentVar]: electedAgent } : undefined,
        };
    }
}
