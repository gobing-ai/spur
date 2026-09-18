import { normalize, resolve, sep } from 'node:path';
import { getAgentSessionCapability } from '@gobing-ai/ts-ai-runner';
import type { ActionResult, ActionRunContext, ActionRunner } from '@gobing-ai/ts-dual-workflow-engine';
import {
    createNodeFileSystem,
    type FileSystem,
    NodeProcessExecutor,
    type ProcessExecutor,
} from '@gobing-ai/ts-runtime';
import type { AgentService } from '../../services/agent-service';
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
        // B7 R1 (task 0894): injected so role-map mode can resolve pins in-process
        // through the SAME resolveRole walk dispatch uses.
        private readonly agentService?: AgentService,
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
        // B7 R1 (0894): role-map mode — `roles` is a role → agent-selector map.
        // In this mode the single-probe agent/role options are not required.
        const rolesOption = options.roles;
        const rolesMode = rolesOption !== undefined && typeof rolesOption === 'object' && !Array.isArray(rolesOption);
        const requestedAgent = rolesMode ? stringOption(options, 'agent', '') : stringOption(options, 'agent');
        const role = stringOption(options, 'role', '');
        const agent = requestedAgent === 'inline' || requestedAgent === 'auto' ? role : requestedAgent;
        if (agent === '' && !rolesMode) {
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

        // B7 R1 (task 0894): role-map mode resolves every declared role ONCE and
        // writes `__executor.<role>` pins; the per-stage path then dispatches
        // without its own doctor call.
        if (rolesMode) {
            return this.resolvePins(
                rolesOption as Record<string, unknown>,
                normalized,
                stringOption(options, 'resolvedAgentVar', ''),
                emit,
            );
        }

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

    /**
     * B7 R1 (task 0894): resolve every declared role once and write
     * `__executor.<role> = { name, agent, model, tier, capabilities }` run vars.
     * Each entry resolves through the SAME resolveRole walk dispatch uses (an
     * explicit selector pins; 'auto'/'inline'/'' route by role), so the pin and
     * any unpinned fallback agree. Failures mark the status file FAIL (soft
     * probe): the affected stages degrade to their own per-stage resolution.
     */
    private async resolvePins(
        roles: Record<string, unknown>,
        resultFile: string,
        resolvedAgentVar: string,
        emit: (chunk: string) => void,
    ): Promise<ActionResult> {
        const lines: string[] = [];
        let failed = false;
        const setVars: Record<string, string> = {};
        let firstElected = '';
        for (const [roleName, selectorRaw] of Object.entries(roles)) {
            const role = roleName.trim();
            if (role === '') continue;
            const selector = typeof selectorRaw === 'string' ? selectorRaw.trim() : '';
            const resolveFlags: Record<string, string | boolean> = { role };
            if (selector !== '' && selector !== 'auto' && selector !== 'inline') resolveFlags.agent = selector;
            const resolved = await this.agentService?.resolve(resolveFlags);
            if (resolved === undefined || !resolved.ok) {
                const reason = resolved !== undefined ? resolved.message : 'no agent service for pin resolution';
                const line = `precheck: FAIL - role ${role} pin resolution failed: ${reason}`;
                lines.push(line);
                emit(line);
                failed = true;
                continue;
            }
            const executor = resolved.executor ?? resolved.agent;
            const capabilities = getAgentSessionCapability(resolved.agent);
            const pin = {
                name: executor,
                agent: resolved.agent,
                ...(resolved.model !== undefined ? { model: resolved.model } : {}),
                ...(resolved.tier !== undefined ? { tier: resolved.tier } : {}),
                ...(capabilities !== undefined ? { capabilities } : {}),
            };
            setVars[`__executor.${role}`] = JSON.stringify(pin);
            if (firstElected === '') firstElected = executor;
            const modelSuffix = resolved.model !== undefined ? ` (${resolved.model})` : '';
            const line = `precheck: role ${role} pinned to ${executor}${modelSuffix}`;
            lines.push(line);
            emit(line);
        }
        const status = failed ? 'FAIL' : 'PASS';
        await this.fileSystem.writeFile(resultFile, `${status}\n`);
        // Soft probe: always succeed; the status token routes, never a lifecycle abort.
        return {
            ok: true,
            data: { status, resultFile, output: lines },
            setVars: {
                ...setVars,
                ...(resolvedAgentVar !== '' && firstElected !== '' ? { [resolvedAgentVar]: firstElected } : {}),
            },
        };
    }
}
