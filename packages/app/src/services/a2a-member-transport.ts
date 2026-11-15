import { randomUUID } from 'node:crypto';
import { getEnvVars } from '@gobing-ai/spur-config';
import { CoordinationRunDao, type DbAdapter, type InboxClaim } from '@gobing-ai/spur-domain';
import {
    createNodeFileSystem,
    type FileSystem,
    NodeProcessExecutor,
    type ProcessExecutor,
    type ProcessResult,
} from '@gobing-ai/ts-runtime';
import type { FleetDispatchRequest, FleetReceiptStatus } from './fleet-dispatcher';
import type { ResolvedFleetMember } from './fleet-service';
import { InboxService } from './inbox-service';

/** The declaration slice an A2A member needs. Only the credential variable NAME is ever read here. */
export interface A2aMemberRef {
    instanceId: string;
    a2a?: string;
    authEnv?: string;
}

/** One parsed A2A task projection; unknown CLI shapes fail in the CLI adapter, not here. */
export interface A2aTask {
    id: string;
    contextId: string;
    state: string;
    statusMessage?: string;
    artifactText?: string;
    remoteBranch?: string;
}

/** Every `a2a` process invocation is behind this seam (R2). */
export interface A2aCard {
    protocolVersion: string;
    capabilities?: { extensions?: Array<{ uri: string; description?: string }> };
}

/** Every `a2a` process invocation is behind this seam (R2). */
export interface A2aCli {
    version(): Promise<string>;
    card(member: A2aMemberRef): Promise<A2aCard>;
    send(member: A2aMemberRef, text: string, messageId: string): Promise<{ taskId: string; contextId: string }>;
    get(member: A2aMemberRef, taskId: string): Promise<A2aTask>;
    cancel(member: A2aMemberRef, taskId: string): Promise<void>;
}

/** A Spur member that fences its own working tree may accept write-shaped work (1337 R3). */
export const A2A_WRITE_FENCING_EXTENSION = 'urn:spur:write-fencing:v1';

/** Return whether the card declares Spur's write-fencing extension. */
export function a2aWriteFencingSupported(card: A2aCard | undefined): boolean {
    return card?.capabilities?.extensions?.some((extension) => extension.uri === A2A_WRITE_FENCING_EXTENSION) ?? false;
}

/** Work declarations that would require a write-fenced tree and are therefore refused for A2A (R7). */
export interface A2aWorkShape {
    expectFile?: string;
    expectFiles?: readonly string[];
    requireDiff?: boolean;
    ownedSections?: readonly string[];
}

/** Return the read-only admission failure, or null for work an A2A member may take. */
export function a2aMutationReason(work: A2aWorkShape | undefined, writeFenced = false): string | null {
    if (work === undefined || writeFenced) return null;
    const mutating =
        (work.expectFile !== undefined && work.expectFile !== '') ||
        (work.expectFiles?.length ?? 0) > 0 ||
        work.requireDiff === true ||
        (work.ownedSections?.length ?? 0) > 0;
    return mutating
        ? 'A2A members accept read-only work only: expectFile(s), requireDiff and owned sections are refused before any send'
        : null;
}

/** Result of one inbox request's A2A turn. */
export interface A2aTurnResult {
    status: FleetReceiptStatus;
    messageId: string;
    reason?: string;
    runId?: string;
    remoteTaskId?: string;
    output?: string;
    remoteBranch?: string;
}

/** Terminal-state mapping shared by polling and tests (design §4.2). */
export function a2aTaskToReceipt(
    task: A2aTask,
): { status: 'completed' | 'failed'; output?: string; reason?: string; cancel: boolean; remoteBranch?: string } | null {
    if (task.state === 'TASK_STATE_COMPLETED')
        return { status: 'completed', output: task.artifactText ?? '', cancel: false, remoteBranch: task.remoteBranch };
    if (task.state === 'TASK_STATE_FAILED' || task.state === 'TASK_STATE_REJECTED') {
        return { status: 'failed', reason: task.statusMessage ?? task.state, cancel: false };
    }
    if (task.state === 'TASK_STATE_CANCELED') return { status: 'failed', reason: 'canceled', cancel: false };
    if (task.state === 'TASK_STATE_INPUT_REQUIRED') return { status: 'failed', reason: 'needs-input', cancel: true };
    if (task.state === 'TASK_STATE_AUTH_REQUIRED') return { status: 'failed', reason: 'needs-auth', cancel: true };
    return null;
}

function textParts(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((part) =>
        part !== null && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
            ? [(part as { text: string }).text]
            : [],
    );
}

function errorText(error: unknown, secret?: string): string {
    const raw = error instanceof Error ? error.message : String(error);
    return secret !== undefined && secret !== '' ? raw.split(secret).join('[redacted]') : raw;
}

/** Production adapter for the operator-installed `a2a` binary (R2/R8). */
export class A2aCliService implements A2aCli {
    private readonly process: ProcessExecutor;
    private readonly fs: FileSystem;
    private readonly env: Record<string, string | undefined>;
    private readonly chmod: (path: string) => Promise<void>;

    constructor(options: {
        cwd: string;
        env?: Record<string, string | undefined>;
        process?: ProcessExecutor;
        fs?: FileSystem;
        chmod?: (path: string) => Promise<void>;
    }) {
        this.process = options.process ?? new NodeProcessExecutor();
        this.fs = options.fs ?? createNodeFileSystem(options.cwd);
        this.env = options.env ?? getEnvVars();
        this.chmod =
            options.chmod ??
            (async (path) => {
                const result = await this.process.run({
                    command: 'chmod',
                    args: ['700', path],
                    cwd: this.fs.getProjectRoot(),
                    timeout: 5_000,
                    rejectOnError: false,
                });
                if (result.exitCode !== 0) throw new Error(`chmod 700 ${path} failed (exit ${result.exitCode})`);
            });
    }

    private cardRef(member: A2aMemberRef): string {
        if (member.a2a === undefined || member.a2a === '') {
            throw new Error(`member "${member.instanceId}" has no a2a Agent Card declaration`);
        }
        return member.a2a;
    }

    private async credential(member: A2aMemberRef): Promise<{ args: string[]; env: Record<string, string> }> {
        if (member.authEnv === undefined) return { args: [], env: {} };
        const secret = this.env[member.authEnv];
        if (secret === undefined || secret === '') {
            throw new Error(`member "${member.instanceId}" auth environment variable "${member.authEnv}" is unset`);
        }
        // The helper contains only the variable NAME. The value enters through the child env and
        // travels helper→a2a over their private protocol pipe — never argv, a receipt or a log.
        const helper = this.fs.resolve('.spur/run/a2a-credential-helper');
        await this.fs.writeFile(
            helper,
            '#!/bin/sh\njq -n --arg value "$SPUR_A2A_AUTH_VALUE" \'{headers:{Authorization:[("Bearer " + $value)]}}\'\n',
        );
        await this.chmod(helper);
        return { args: ['--credential-helper', helper], env: { SPUR_A2A_AUTH_VALUE: secret } };
    }

    private async run(member: A2aMemberRef | undefined, args: string[]): Promise<string> {
        const credential = member === undefined ? { args: [], env: {} } : await this.credential(member);
        const fullArgs = member === undefined ? args : [...args, '-a', this.cardRef(member), ...credential.args];
        let result: ProcessResult;
        try {
            result = await this.process.run({
                command: 'a2a',
                args: fullArgs,
                cwd: this.fs.getProjectRoot(),
                env: credential.env,
                timeout: 30_000,
                maxOutput: 2 * 1024 * 1024,
                rejectOnError: false,
                forceBuffered: true,
            });
        } catch (error) {
            throw new Error(`a2a invocation failed: ${errorText(error, credential.env.SPUR_A2A_AUTH_VALUE)}`);
        }
        if (result.exitCode !== 0) {
            const output = `${result.stderr}\n${result.stdout}`.trim();
            throw new Error(
                `a2a ${args[0] ?? 'call'} failed (exit ${result.exitCode}): ${errorText(output, credential.env.SPUR_A2A_AUTH_VALUE)}`,
            );
        }
        return result.stdout;
    }

    async version(): Promise<string> {
        const output = await this.run(undefined, ['version']);
        const line = output
            .split('\n')
            .find((entry) => entry.trim().startsWith('a2a '))
            ?.trim();
        if (line === undefined) throw new Error(`a2a version returned an unknown shape: ${output.slice(0, 200)}`);
        return line;
    }

    async card(member: A2aMemberRef): Promise<A2aCard> {
        const raw = JSON.parse(await this.run(member, ['card', 'get', '-o', 'json'])) as {
            supportedInterfaces?: Array<{ protocolVersion?: unknown }>;
            capabilities?: { extensions?: Array<{ uri?: unknown; description?: unknown }> };
        };
        const protocolVersion = raw.supportedInterfaces?.find(
            (entry) => typeof entry.protocolVersion === 'string',
        )?.protocolVersion;
        if (typeof protocolVersion !== 'string') throw new Error('a2a card returned no supported protocol version');
        const extensions = (raw.capabilities?.extensions ?? []).flatMap((extension) =>
            typeof extension.uri === 'string'
                ? [
                      {
                          uri: extension.uri,
                          ...(typeof extension.description === 'string' ? { description: extension.description } : {}),
                      },
                  ]
                : [],
        );
        return { protocolVersion, capabilities: { extensions } };
    }

    async send(member: A2aMemberRef, text: string, messageId: string): Promise<{ taskId: string; contextId: string }> {
        const payload = JSON.stringify({
            message: { messageId, role: 'user', parts: [{ text }] },
            configuration: { returnImmediately: true },
        });
        const raw = JSON.parse(await this.run(member, ['send', '-o', 'json', '--request-payload', payload])) as {
            task?: { id?: unknown; contextId?: unknown };
        };
        if (typeof raw.task?.id !== 'string' || typeof raw.task.contextId !== 'string') {
            throw new Error('a2a send returned no task id/context id');
        }
        return { taskId: raw.task.id, contextId: raw.task.contextId };
    }

    async get(member: A2aMemberRef, taskId: string): Promise<A2aTask> {
        const raw = JSON.parse(await this.run(member, ['task', 'get', taskId, '-o', 'json'])) as {
            task?: {
                id?: unknown;
                contextId?: unknown;
                status?: { state?: unknown; message?: { parts?: unknown } };
                artifacts?: Array<{ parts?: unknown }>;
                metadata?: { remoteBranch?: unknown };
            };
        };
        const task = raw.task;
        if (
            task === undefined ||
            typeof task.id !== 'string' ||
            typeof task.contextId !== 'string' ||
            typeof task.status?.state !== 'string'
        ) {
            throw new Error('a2a task get returned an unknown task shape');
        }
        return {
            id: task.id,
            contextId: task.contextId,
            state: task.status.state,
            ...(task.status.message !== undefined
                ? { statusMessage: textParts(task.status.message.parts).join('\n') }
                : {}),
            artifactText: (task.artifacts ?? []).flatMap((artifact) => textParts(artifact.parts)).join('\n'),
            ...(typeof task.metadata?.remoteBranch === 'string' ? { remoteBranch: task.metadata.remoteBranch } : {}),
        };
    }

    async cancel(member: A2aMemberRef, taskId: string): Promise<void> {
        await this.run(member, ['task', 'cancel', taskId, '-o', 'json']);
    }
}

/** Injected seams for the member turn driver. */
export interface A2aMemberTransportDeps {
    cwd: string;
    getDb(): Promise<DbAdapter>;
    env?: Record<string, string | undefined>;
    cli?: A2aCli;
    fs?: FileSystem;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    pollIntervalMs?: number;
}

/** Options for an in-process dispatch from `spur agent run` or a workflow stage. */
export interface A2aDispatchOptions {
    dispatcher: Pick<import('./fleet-dispatcher').FleetDispatcher, 'enqueue'>;
    fromId: string;
    requestKey?: string;
    taskId?: string;
    parentRunId?: string;
    timeoutMs?: number;
    work?: A2aWorkShape;
}

/**
 * A2A is a member turn driver under the keyed inbox, never a fourth dispatch surface (ADR-148).
 * The durable request is the inbox row; remote identity is on coordination_runs before polling.
 */
export class A2aMemberTransport {
    private readonly cli: A2aCli;
    private readonly fs: FileSystem;
    private readonly env: Record<string, string | undefined>;
    private readonly now: () => number;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly pollIntervalMs: number;

    constructor(private readonly deps: A2aMemberTransportDeps) {
        this.cli =
            deps.cli ?? new A2aCliService({ cwd: deps.cwd, ...(deps.env !== undefined ? { env: deps.env } : {}) });
        this.fs = deps.fs ?? createNodeFileSystem(deps.cwd);
        this.env = deps.env ?? getEnvVars();
        this.now = deps.now ?? (() => Date.now());
        this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
        this.pollIntervalMs = deps.pollIntervalMs ?? 2_000;
    }

    /** Read a completed run's artifact text (the warm-path counterpart of runMessage's output). */
    async outputForRun(runId: string): Promise<string | undefined> {
        const row = await new CoordinationRunDao(await this.deps.getDb()).getByRunId(runId);
        if (row === null) return undefined;
        try {
            const refs = JSON.parse(row.artifact_refs_json) as Array<{ kind?: unknown; path?: unknown }>;
            const resultPath = refs.find((ref) => ref.kind === 'result' && typeof ref.path === 'string')?.path;
            if (typeof resultPath !== 'string' || !(await this.fs.exists(resultPath))) return undefined;
            return await this.fs.readFile(resultPath);
        } catch {
            return undefined;
        }
    }

    /** Doctor readiness: binary, card and protocol are observed independently (R10). */
    async supportsWriteFencing(member: ResolvedFleetMember): Promise<boolean> {
        return a2aWriteFencingSupported(await this.cli.card(member));
    }

    /** Doctor readiness: binary, card and protocol are observed independently (R10). */
    async doctor(member: ResolvedFleetMember): Promise<{
        binaryVersion: string;
        cardReachable: boolean;
        protocolVersion?: string;
        reason?: string;
    }> {
        let binaryVersion = 'unavailable';
        try {
            binaryVersion = await this.cli.version();
        } catch (error) {
            binaryVersion = `unavailable (${errorText(error)})`;
        }
        try {
            const card = await this.cli.card(member);
            return { binaryVersion, cardReachable: true, protocolVersion: card.protocolVersion };
        } catch (error) {
            const secret = member.authEnv === undefined ? undefined : this.env[member.authEnv];
            return { binaryVersion, cardReachable: false, reason: errorText(error, secret) };
        }
    }

    /** Enqueue one keyed request, then complete it in this process (the no-serve path, R3). */
    async dispatch(member: ResolvedFleetMember, prompt: string, options: A2aDispatchOptions): Promise<A2aTurnResult> {
        const request: FleetDispatchRequest = {
            member: member.instanceId,
            fromId: options.fromId,
            body: prompt,
            ...(options.requestKey !== undefined ? { requestKey: options.requestKey } : {}),
            ...(options.taskId !== undefined ? { taskId: options.taskId } : {}),
            ...(options.parentRunId !== undefined ? { parentRunId: options.parentRunId } : {}),
        };
        try {
            const { messageId } = await options.dispatcher.enqueue(request);
            try {
                return await this.runMessage(member, messageId, options);
            } catch (error) {
                // The request is durable already; an unexpected post-enqueue error is never proof
                // that no remote work started, so it cannot become a not-started retry (AC3).
                const secret = member.authEnv === undefined ? undefined : this.env[member.authEnv];
                return {
                    status: 'outcome-unknown',
                    messageId,
                    reason: `member "${member.instanceId}" A2A turn could not be read after enqueue: ${errorText(error, secret)}`,
                };
            }
        } catch (error) {
            const secret = member.authEnv === undefined ? undefined : this.env[member.authEnv];
            return {
                status: 'not-started',
                messageId: options.requestKey ?? '',
                reason: `member "${member.instanceId}" A2A dispatch could not enqueue: ${errorText(error, secret)}`,
            };
        }
    }

    /** Complete messages already claimed by a live member loop (R3). */
    async runClaimed(
        member: ResolvedFleetMember,
        claimed: readonly InboxClaim[],
        options: { timeoutMs?: number; work?: A2aWorkShape } = {},
    ): Promise<A2aTurnResult[]> {
        const results: A2aTurnResult[] = [];
        for (const claim of claimed)
            results.push(await this.runMessage(member, claim.id, { ...options, claimed: true }));
        return results;
    }

    /** Run or re-attach one durable inbox request. A stored task id always suppresses send (R4). */
    async runMessage(
        member: ResolvedFleetMember,
        messageId: string,
        options: { timeoutMs?: number; work?: A2aWorkShape; claimed?: boolean } = {},
    ): Promise<A2aTurnResult> {
        if (member.a2a === undefined) {
            return { status: 'failed', messageId, reason: `member "${member.instanceId}" has no a2a declaration` };
        }
        const inbox = new InboxService({ getDb: this.deps.getDb });
        const runs = new CoordinationRunDao(await this.deps.getDb());
        const existing = (await runs.listByMessageId(messageId)).find((row) => row.spec_id === member.instanceId);
        if (existing?.status === 'exited') {
            let remoteBranch: string | undefined;
            try {
                const refs = JSON.parse(existing.artifact_refs_json) as Array<{ remoteBranch?: unknown }>;
                remoteBranch = refs.find((ref) => typeof ref.remoteBranch === 'string')?.remoteBranch as
                    | string
                    | undefined;
            } catch {
                remoteBranch = undefined;
            }
            return {
                status: 'completed',
                messageId,
                runId: existing.run_id,
                ...(remoteBranch !== undefined ? { remoteBranch } : {}),
            };
        }
        if (existing?.status === 'errored') {
            return { status: 'failed', messageId, runId: existing.run_id, reason: existing.outcome };
        }
        const message = await inbox.get(messageId);
        if (message === null) return { status: 'failed', messageId, reason: 'inbox request not found' };
        const claim: InboxClaim | null =
            options.claimed === true && message.status === 'claimed'
                ? { id: message.id, attempts: message.attempts }
                : message.status === 'queued'
                  ? await inbox.claimById(message.id)
                  : null;
        let runId = existing?.run_id;
        let remoteTaskId = existing?.remote_task_id ?? undefined;
        let remoteContextId = existing?.remote_context_id ?? undefined;
        const secret = member.authEnv === undefined ? undefined : this.env[member.authEnv];
        try {
            const card = await this.cli.card(member);
            const mutation = a2aMutationReason(options.work, a2aWriteFencingSupported(card));
            if (mutation !== null) {
                if (claim !== null) await inbox.settle([claim], 'not-started', mutation);
                return { status: 'not-started', messageId, reason: `member "${member.instanceId}": ${mutation}` };
            }
            if (remoteTaskId === undefined || runId === undefined) {
                if (claim === null) {
                    return {
                        status: message.status === 'failed' ? 'not-started' : 'outcome-unknown',
                        messageId,
                        ...(message.error !== null ? { reason: message.error } : {}),
                    };
                }
                const sent = await this.cli.send(member, message.body, message.requestKey ?? message.id);
                remoteTaskId = sent.taskId;
                remoteContextId = sent.contextId;
                runId = randomUUID();
                const generation = ((await runs.maxGeneration(member.instanceId)) ?? 0) + 1;
                // Persistence deliberately precedes the first GetTask: a crash from here onward
                // re-attaches by message id and can never send the same work twice (R4).
                await runs.insertStart({
                    specId: member.instanceId,
                    agentKind: 'a2a',
                    processId: null,
                    runId,
                    generation,
                    startedAt: new Date(this.now()).toISOString(),
                    messageIds: [messageId],
                    ...(message.taskId !== null ? { taskId: message.taskId } : {}),
                    ...(message.parentRunId !== null ? { parentRunId: message.parentRunId } : {}),
                    remoteTaskId,
                    remoteContextId,
                });
            }
            const deadline = this.now() + (options.timeoutMs ?? 600_000);
            for (;;) {
                const task = await this.cli.get(member, remoteTaskId);
                const mapped = a2aTaskToReceipt(task);
                if (mapped !== null) {
                    let reason = mapped.reason;
                    if (mapped.cancel) {
                        try {
                            await this.cli.cancel(member, remoteTaskId);
                        } catch (error) {
                            reason = `${reason ?? 'interrupted'} (cancel failed: ${errorText(error, secret)})`;
                        }
                    }
                    let artifactRefs = '[]';
                    if (mapped.status === 'completed') {
                        const outputPath = this.fs.resolve('.spur/run', runId, 'a2a-result.md');
                        await this.fs.writeFile(outputPath, mapped.output ?? '');
                        artifactRefs = JSON.stringify([
                            {
                                kind: 'result',
                                path: outputPath,
                                mediaType: 'text/markdown',
                                ...(mapped.remoteBranch !== undefined ? { remoteBranch: mapped.remoteBranch } : {}),
                            },
                        ]);
                    }
                    await runs.updateExit(
                        runId,
                        mapped.status === 'completed' ? 'exited' : 'errored',
                        new Date(this.now()).toISOString(),
                        artifactRefs,
                        {
                            messageIds: [messageId],
                            ...(message.taskId !== null ? { taskId: message.taskId } : {}),
                            outcome: mapped.status === 'completed' ? 'run-exit-only' : 'errored',
                        },
                    );
                    if (claim !== null) await inbox.settle([claim], 'accepted');
                    if (mapped.status === 'completed')
                        await inbox.reply(messageId, member.instanceId, mapped.output ?? '');
                    return {
                        status: mapped.status,
                        messageId,
                        runId,
                        remoteTaskId,
                        ...(mapped.output !== undefined ? { output: mapped.output } : {}),
                        ...(mapped.remoteBranch !== undefined ? { remoteBranch: mapped.remoteBranch } : {}),
                        ...(reason !== undefined ? { reason } : {}),
                    };
                }
                if (this.now() >= deadline) {
                    if (claim !== null) await inbox.settle([claim], 'accepted');
                    return { status: 'outcome-unknown', messageId, runId, remoteTaskId };
                }
                await this.sleep(this.pollIntervalMs);
            }
        } catch (error) {
            const reason = `member "${member.instanceId}" A2A turn: ${errorText(error, secret)}`;
            if (remoteTaskId !== undefined && runId !== undefined) {
                // A task id exists: the remote may still be working. Keep the run row running and
                // never turn this into a definite failure or a second send (R5/AC3).
                if (claim !== null) await inbox.settle([claim], 'accepted');
                return { status: 'outcome-unknown', messageId, runId, remoteTaskId, reason };
            }
            if (claim !== null) await inbox.settle([claim], 'not-started', reason);
            return { status: 'not-started', messageId, reason };
        }
    }
}
