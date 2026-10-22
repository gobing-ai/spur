import { join } from 'node:path';
import { CoordinationRunDao, type DbAdapter } from '@gobing-ai/spur-domain';
import type { ActionResult } from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import type { AgentRunDeps } from '../services/agent-service';
import type { WorkflowAgentService } from './actions/agent-run';

interface FleetWorkItem {
    options: Record<string, unknown>;
    vars: Record<string, string>;
    excludeGlobs?: string[];
}

function paths(cwd: string, key: string): { input: string; result: string; state: string } | null {
    const match = /^([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/.exec(key);
    if (match === null) return null;
    const base = join(cwd, '.spur/run', match[1] as string, 'prompts', match[2] as string);
    return { input: `${base}.execution.json`, result: `${base}.result.json`, state: match[2] as string };
}

/** Read a flag value as a string id, or undefined when absent/empty. */
function stringOrUndefined(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function bindingVars(vars: Record<string, unknown>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(vars).filter(
            ([key, value]) =>
                typeof value === 'string' &&
                (['wbs', 'spurBin', 'implementScopeGuard', 'sessionAffinity'].includes(key) ||
                    key.startsWith('__agentSession') ||
                    key.startsWith('__session.') ||
                    key.startsWith('__agentRouting_')),
        ),
    ) as Record<string, string>;
}

/** Persist a stage contract and discard any result from an earlier attempt. */
export async function writeFleetWorkItem(
    cwd: string,
    runId: string,
    state: string,
    options: Record<string, unknown>,
    vars: Record<string, unknown>,
    excludeGlobs?: string[],
): Promise<void> {
    const file = paths(cwd, `${runId}/${state}`);
    if (file === null) throw new Error('Invalid fleet work-item identity');
    const fs = createNodeFileSystem(cwd);
    if (await fs.exists(file.result)) await fs.deleteFile(file.result);
    await fs.writeFile(file.input, JSON.stringify({ options, vars: bindingVars(vars), excludeGlobs }));
}

/** Read the member's completed contract result; missing or malformed results fail closed. */
export async function readFleetWorkItemResult(cwd: string, runId: string, state: string): Promise<ActionResult | null> {
    const file = paths(cwd, `${runId}/${state}`);
    if (file === null) return null;
    try {
        const result = JSON.parse(await createNodeFileSystem(cwd).readFile(file.result)) as ActionResult;
        return typeof result?.ok === 'boolean' ? result : null;
    } catch {
        return null;
    }
}

/** Fleet phase-mark emitter (task 1273): a boundary name plus bounded identity payload. */
export type FleetPhaseEmit = (phase: string, payload: Record<string, unknown>) => void;

/** Build a phase payload with the correlation ids a keyed run owns. */
function phasePayload(
    phase: string,
    ids: { runId?: string; executionId?: string },
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        phase,
        ...(ids.runId !== undefined ? { runId: ids.runId } : {}),
        ...(ids.executionId !== undefined ? { executionId: ids.executionId } : {}),
        at: new Date().toISOString(),
        ...extra,
    };
}

/** The member runs the shared action contract before publishing its completion receipt. */
export async function runFleetWorkItem(input: {
    cwd: string;
    recipient: string;
    key: string;
    messageId: string;
    flags: Record<string, string | boolean>;
    service: WorkflowAgentService;
    runDeps?: AgentRunDeps;
    getDb(): Promise<DbAdapter>;
    /** Phase marks (task 1273); absent where no bus is wired. */
    emitPhase?: FleetPhaseEmit;
}): Promise<ActionResult | null> {
    const file = paths(input.cwd, input.key);
    const fs = createNodeFileSystem(input.cwd);
    if (file === null || !(await fs.exists(file.input))) return null;
    input.emitPhase?.(
        'preflight',
        phasePayload(
            'preflight',
            { runId: stringOrUndefined(input.flags['run-id']) },
            { key: input.key, messageId: input.messageId, member: input.recipient },
        ),
    );
    const work = JSON.parse(await fs.readFile(file.input)) as FleetWorkItem;
    if (
        work === null ||
        typeof work.options !== 'object' ||
        work.options === null ||
        Array.isArray(work.options) ||
        typeof work.vars !== 'object' ||
        work.vars === null ||
        Array.isArray(work.vars)
    ) {
        throw new Error(`Invalid fleet work-item envelope: ${file.input}`);
    }
    const { AgentRunActionRunner } = await import('./actions/agent-run');
    const flags = { ...input.flags };
    delete flags.requestMessage;
    delete flags['request-message'];
    const runId = String(flags['run-id'] ?? crypto.randomUUID());
    const ids = { runId, executionId: stringOrUndefined(flags['execution-id']) };
    input.emitPhase?.(
        'accepted',
        phasePayload('accepted', ids, { key: input.key, messageId: input.messageId, member: input.recipient }),
    );
    const runner = new AgentRunActionRunner(input.service, undefined, undefined, { excludeGlobs: work.excludeGlobs });
    const result = await runner.execute(
        { ...work.options, agent: flags.agent, cwd: input.cwd },
        {
            runId,
            stateOrNodeId: file.state,
            workdir: input.cwd,
            vars: bindingVars(work.vars),
            env: {},
        },
        { flags, deps: input.runDeps },
    );
    input.emitPhase?.('contract-validated', phasePayload('contract-validated', ids, { ok: result.ok }));
    // Answers stay in their declared artifact; the transport receipt carries only contract metadata.
    const projected: ActionResult = {
        ok: result.ok,
        ...(result.ok ? {} : { error: `Fleet work-item contract failed; inspect member run ${runId}` }),
        ...(result.setVars ? { setVars: bindingVars(result.setVars) } : {}),
        data: Object.fromEntries(
            Object.entries(result.data ?? {}).filter(([key]) =>
                ['outcome', 'contract', 'observed', 'escalated'].includes(key),
            ),
        ),
    };
    await fs.writeFile(file.result, JSON.stringify(projected));
    const runs = new CoordinationRunDao(await input.getDb());
    let row = await runs.getByRunId(runId);
    if (row === null) {
        await runs.insertStart({
            specId: input.recipient,
            agentKind: String(flags.agent ?? 'unknown'),
            processId: null,
            runId,
            generation: ((await runs.maxGeneration(input.recipient)) ?? 0) + 1,
            startedAt: new Date().toISOString(),
            parentRunId: input.key.split('/')[0],
        });
        row = await runs.getByRunId(runId);
    }
    await runs.updateExit(
        runId,
        result.ok ? 'exited' : 'errored',
        new Date().toISOString(),
        row?.artifact_refs_json ?? '[]',
        {
            messageIds: [input.messageId],
            ...(work.vars.wbs ? { taskId: work.vars.wbs } : {}),
            outcome: result.ok ? 'run-exit-only' : 'errored',
        },
    );
    return projected;
}
