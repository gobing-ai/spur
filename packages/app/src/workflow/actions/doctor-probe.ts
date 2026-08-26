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

/** Relay-managed agent families whose auth probe cannot see agent-owned credentials. */
const RELAY_FAMILY = /^(omp|pi)(-.*)?$/;

/** env-key probe misses are soft for relay families; explicit auth failures are hard. */
const ENV_MISS_PATTERN = /API key not found for provider|no probe registered/i;
const AUTH_FAIL_PATTERN = /invalid (API )?key|unauthori[sz]ed|forbidden|authentication failed|credential(s)? rejected/i;

type ProbeClass = 'env-miss' | 'auth-fail' | 'unknown';

/**
 * Classify a `spur agent doctor` modelStatus.detail string (task 0487 R2 / 0503 R2,
 * consolidated here from the task-pipeline precheck shell classifier).
 */
function classifyDoctorProbe(detail: string, agent: string): ProbeClass {
    if (RELAY_FAMILY.test(agent) && ENV_MISS_PATTERN.test(detail)) return 'env-miss';
    if (AUTH_FAIL_PATTERN.test(detail)) return 'auth-fail';
    return 'unknown';
}

/** Parse `.agents[0]` from `spur agent doctor <exe> --json`; anything unexpected stays unknown. */
function parseDoctorJson(stdout: string): { auth: string; detail: string; resolvedAgent: string } {
    try {
        const parsed = JSON.parse(stdout) as {
            agents?: Array<{ authenticated?: unknown; modelStatus?: { detail?: unknown }; agent?: unknown }>;
        };
        const first = parsed.agents?.[0];
        const auth = typeof first?.authenticated === 'string' ? first.authenticated : 'unknown';
        const detail = typeof first?.modelStatus?.detail === 'string' ? first.modelStatus.detail : '';
        // R1 (0622): `doctor <role>` resolves the role to its cheapest eligible executor and
        // the JSON row names that executor (`agent: omp`). The auth classification must use
        // THIS resolved name, not the selector the caller probed with — a role literal like
        // `coder` is not omp/pi-family, so testing the selector would turn a relay-owned
        // env-miss into a hard FAIL (fabricated "executor coder is unauthenticated").
        const resolvedAgent = typeof first?.agent === 'string' && first.agent.length > 0 ? first.agent : '';
        return { auth, detail, resolvedAgent };
    } catch {
        return { auth: 'unknown', detail: '', resolvedAgent: '' };
    }
}

/**
 * Workflow action runner for `doctor.probe` — the pre-launch executor doctor check.
 *
 * Replaces the task-pipeline precheck shell classifier (task 0608, feature D6 R4–R5): it
 * probes each resolved executor with `spur agent doctor <exe> --json`, classifies the auth
 * detail per agent family (omp/pi env-key misses are soft because the CLI process cannot see
 * relay-owned credentials; explicit non-omp auth failures are hard), writes PASS/FAIL to a
 * status file beneath `.spur/run/`, and always returns success — it is a soft probe whose
 * transition guards route on the status token, never a raw lifecycle abort.
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
        const agent = stringOption(options, 'agent');
        const implementAgent = stringOption(options, 'implementAgent', agent);

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

            const { auth, detail, resolvedAgent } = parseDoctorJson(res.stdout);
            // Classify against the executor the doctor row actually reports (resolved
            // from a role), falling back to the selector when the row names none.
            const classifyAgainst = resolvedAgent !== '' ? resolvedAgent : exe;
            const probe = classifyDoctorProbe(detail, classifyAgainst);
            // Show the resolved executor only when it differs from the selector (a
            // role was resolved); direct executors keep the terse original line.
            const resolvedSuffix = resolvedAgent !== '' && resolvedAgent !== exe ? ` (resolved ${resolvedAgent})` : '';
            const line = `precheck: ${exe}${resolvedSuffix} auth=${auth} probe=${probe} ${detail}`.replace(/\s+$/, '');
            lines.push(line);
            emit(line);

            if (auth === 'unauthenticated') {
                if (RELAY_FAMILY.test(classifyAgainst) && (probe === 'env-miss' || probe === 'unknown')) {
                    const soft = `precheck: SOFT - executor ${classifyAgainst} auth probe cannot see agent-owned credentials`;
                    lines.push(soft);
                    emit(soft);
                } else {
                    const hard = `precheck: FAIL - executor ${classifyAgainst} is unauthenticated; fix agent.default or pass --vars '{"agent":"<authenticated-executor>"}' (${spurBin} agent doctor ${classifyAgainst} --json); ${detail}`;
                    lines.push(hard);
                    emit(hard);
                    status = 'FAIL';
                }
            }
        }

        await this.fileSystem.writeFile(normalized, `${status}\n`);
        // Soft probe: always succeed so transition guards can route the recorded FAIL to a
        // `failed` terminal state instead of a raw lifecycle abort mid-enter.
        return { ok: true, data: { status, resultFile: normalized, output: lines } };
    }
}
