import { dirname } from 'node:path';
import type { AgentSpec } from '@gobing-ai/ts-ai-runner';
import type { EventBus } from '@gobing-ai/ts-infra';
import {
    createNodeFileSystem,
    type PipeProcess,
    type PipeProcessOptions,
    type ProcessExecutor,
} from '@gobing-ai/ts-runtime';
import { FleetService } from './fleet-service';

// ── Types ──

/** Per-process ring buffer of framed output, bounded to a constant frame count. */
export interface ProcessFrame {
    stream: 'stdout' | 'stderr';
    ts: string;
    line: string;
    /**
     * Monotonic sequence stamped at push time. Ring-buffer overflow splices
     * old frames from the front, so an array index is not a stable cursor —
     * live tails must track the last seq they delivered instead.
     */
    seq: number;
}

/** Registry entry for a supervised process. */
export interface ProcessEntry {
    agentId: string;
    pid: number | null;
    status: 'running' | 'stopped' | 'exited' | 'errored';
    startedAt: string;
    exitCode?: number | null;
    /** Ring buffer of recent output frames (bounded, oldest-first). */
    ringBuffer: ProcessFrame[];
    /** Coding-agent type from the agent spec at start (0269 process event identity). */
    agentType?: string;
}

/** Payload for process lifecycle events. Metadata only — no output body. */
export interface ProcessEventPayload {
    agentId: string;
    pid: number | null;
    exitCode?: number | null;
    /** Coding-agent type from the agent spec when known. */
    agentType?: string;
    /** Producer-owned observability severity. */
    severity?: 'info' | 'warning' | 'error';
}

/**
 * Metadata-only payload for supervisor-emitted `agent.started|stopped` (0860 R2).
 * The retired member-scoped pair duplicated these names, so the supervisor now
 * emits the catalog's existing agent lifecycle events directly.
 */
export interface AgentLifecycleEventPayload {
    agentId: string;
    pid?: number | null;
    /** Coding-agent type from the agent spec when known. */
    agentType?: string;
    /** Producer-owned observability severity. */
    severity?: 'info' | 'warning' | 'error';
}

/** Bus shape for process + agent lifecycle events from SupervisorService. */
export type ProcessEventBus = EventBus<{
    'process.spawned': (event: ProcessEventPayload) => void;
    'process.exited': (event: ProcessEventPayload) => void;
    'process.stopped': (event: ProcessEventPayload) => void;
    'agent.started': (event: AgentLifecycleEventPayload) => void;
    'agent.stopped': (event: AgentLifecycleEventPayload) => void;
}>;

/** Construction options for {@link SupervisorService}. */
export interface SupervisorOptions {
    processExecutor: ProcessExecutor;
    eventBus: ProcessEventBus;
    /** Directory containing `.spur/agents/<id>.yaml` spec files. */
    configDir: string;
    /** Max frames in the per-process ring buffer. */
    ringBufferSize?: number;
    /** Pre-loaded specs — omit to load from configDir at first start. */
    agentSpecs?: AgentSpec[];
    /**
     * `spur serve` API base, injected as `SPUR_SERVE_URL` into supervised
     * processes (ADR-057 wave 1 R3). Omit when not launched by `spur serve`.
     */
    serveUrl?: string;
}

// ── Constants ──

const DEFAULT_RING_BUFFER_SIZE = 500;
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_BACKOFF_SCHEDULE = [1000, 2000, 4000, 8000, 16_000];
const MAX_RESTART_BACKOFF = 30_000;

// ── Default wrapper helper ──

/**
 * Build the default wrapper argv for agents without `command` (option c).
 * Spawns the persistent self-draining loop `spur agent loop --spec <id>` (0258 R6;
 * flag moved off `--agent` in 0542 R1):
 * the process stays alive, drains its inbox each iteration, and idle-sleeps when empty —
 * so a single successful drain does not end the member. Crash-restart stays with the
 * supervisor's exit handler (R7).
 */
function defaultWrapperArgv(agentId: string): { command: string; args: string[] } {
    return {
        command: process.execPath,
        args: [process.argv[1] ?? 'apps/cli/src/index.ts', 'agent', 'loop', '--spec', agentId],
    };
}

// ── SupervisorService ──

/**
 * Process supervisor (task 0195/0207).
 *
 * Manages supervised agent processes spawned from `.spur/agents/<id>.yaml` specs.
 * Supports option (c): a `config.command` (or legacy top-level `command`) wins when
 * present; absent → the spur-provided `agent loop` self-draining wrapper. Abnormal
 * exits are restarted with bounded backoff, then marked `errored` (0258 R7). Emits
 * `process.spawned|exited|stopped` lifecycle events.
 */
export class SupervisorService {
    private readonly processExecutor: ProcessExecutor;
    private readonly eventBus: ProcessEventBus;
    private readonly configDir: string;
    /** `spur serve` API base for `SPUR_SERVE_URL` injection (R3). */
    private readonly serveUrl?: string;
    /** Agent ids that already emitted `agent.stopped` via explicit stop(). */
    private readonly stopEmitted = new Set<string>();
    private readonly ringBufferSize: number;
    private readonly processes = new Map<string, { handle: PipeProcess; entry: ProcessEntry }>();
    private readonly ringBuffers = new Map<string, ProcessFrame[]>();
    private specsPromise?: Promise<AgentSpec[]>;
    private frameSeq = 0;
    private readonly restartAttempts = new Map<string, number>();
    private readonly restartTimers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(options: SupervisorOptions) {
        this.processExecutor = options.processExecutor;
        this.eventBus = options.eventBus;
        this.configDir = options.configDir;
        this.ringBufferSize = options.ringBufferSize ?? DEFAULT_RING_BUFFER_SIZE;
        this.serveUrl = options.serveUrl;
        if (options.agentSpecs) {
            this.specsPromise = Promise.resolve(options.agentSpecs);
        }
    }

    /** List all supervised processes (alive + exited-but-not-yet-removed). */
    list(): ProcessEntry[] {
        return Array.from(this.processes.values()).map((p) => p.entry);
    }

    /** Get a single process entry, or undefined. */
    get(agentId: string): ProcessEntry | undefined {
        return this.processes.get(agentId)?.entry;
    }

    /** Get the ring buffer for an agent (may be empty if not running). */
    getRingBuffer(agentId: string): ProcessFrame[] {
        return this.ringBuffers.get(agentId) ?? [];
    }

    /** Write a line to the supervised process's stdin (for POST /api/processes/:id/stdin). */
    writeStdin(agentId: string, line: string): void {
        const proc = this.processes.get(agentId);
        if (proc?.entry.status !== 'running') {
            throw new Error(`Agent "${agentId}" is not running`);
        }
        proc.handle.writeStdin(`${line}\n`);
    }

    /**
     * Spawn a supervised agent process. If the spec has `command: string[]`, spawn
     * it directly. Otherwise, use the default drain-loop wrapper.
     */
    async start(agentId: string): Promise<ProcessEntry> {
        const existing = this.processes.get(agentId);
        if (existing && existing.entry.status === 'running') {
            return existing.entry;
        }

        const specs = await this.loadSpecs();
        const spec = specs.find((s) => s.id === agentId);
        if (!spec) {
            throw new Error(`No agent spec found for "${agentId}"`);
        }

        if (spec.tags.some((tag) => tag.startsWith('fleet:'))) {
            await new FleetService({
                fs: createNodeFileSystem(dirname(dirname(this.configDir))),
            }).assertLaunchGroundTruth(spec.workspace);
        }
        const { command, args } = this.resolveCommand(spec);
        const frames: ProcessFrame[] = [];
        this.ringBuffers.set(agentId, frames);

        const pipeOpts: PipeProcessOptions = {
            command,
            args,
            cwd: spec.workspace,
            label: `agent:${agentId}`,
            // Tag for ProcessRegistry watch list (ts-runtime 0.4.10 / spur#0264).
            source: 'supervisor',
            agentId,
            env: {
                ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)),
                // Caller identity env (ADR-057 wave 1 R3): inject the spec id so the
                // supervised loop (and its `executeRun` calls) know their occupant.
                // SPUR_RUN_ID is the process-generation id; per-invoke runId is minted
                // separately by AgentService. SPUR_SERVE_URL is passed through only
                // when the supervisor itself was launched with it.
                SPUR_SPEC_ID: agentId,
                SPUR_RUN_ID: crypto.randomUUID(),
                ...((this.serveUrl ?? process.env.SPUR_SERVE_URL) !== undefined
                    ? { SPUR_SERVE_URL: (this.serveUrl ?? process.env.SPUR_SERVE_URL) as string }
                    : {}),
            } as Record<string, string>,
        };

        const handle = this.processExecutor.runStreaming(pipeOpts);
        const pid = handle.pid;

        const entry: ProcessEntry = {
            agentId,
            pid,
            status: 'running',
            startedAt: new Date().toISOString(),
            ringBuffer: frames,
            agentType: spec.type,
        };

        this.processes.set(agentId, { handle, entry });
        this.restartAttempts.delete(agentId);

        // Feed stdout/stderr frames into the ring buffer.
        this.pipeStream(handle.stdout, 'stdout', agentId, frames);
        this.pipeStream(handle.stderr, 'stderr', agentId, frames);

        // Spawn event — stamp agent identity for the Activity board (0269 P4).
        this.emit('process.spawned', {
            agentId,
            pid,
            agentType: spec.type,
        });
        // Agent lifecycle (task 0371 R2/R3; 0860 R2): the catalog's own
        // `agent.started` name, emitted by the supervisor on the serve path.
        this.emit('agent.started', {
            agentId,
            pid,
            ...(spec.type.length > 0 ? { agentType: spec.type } : {}),
        });

        // Watch for exit — restart on abnormal exit (0253 R3)
        void handle.exited.then(async (code) => {
            entry.exitCode = code;
            this.emit('process.exited', {
                agentId,
                pid,
                exitCode: code,
                ...(entry.agentType ? { agentType: entry.agentType } : {}),
            });
            // Agent lifecycle on natural exit/crash only. Explicit stop() already
            // emitted `agent.stopped` — avoid double rows (task 0371; 0860 R2).
            if (!this.stopEmitted.has(agentId)) {
                this.emit('agent.stopped', {
                    agentId,
                    pid,
                    ...(entry.agentType ? { agentType: entry.agentType } : {}),
                });
            } else {
                this.stopEmitted.delete(agentId);
            }

            // Normal exit (code 0) or stop-initiated: record and clean up.
            if (code === 0 || entry.status === 'stopped') {
                entry.status = 'exited';
                this.scheduleCleanup(agentId, entry);
                return;
            }

            // Abnormal exit — restart with backoff (R7)
            const attempts = (this.restartAttempts.get(agentId) ?? 0) + 1;
            this.restartAttempts.set(agentId, attempts);

            if (attempts > MAX_RESTART_ATTEMPTS) {
                entry.status = 'errored';
                this.scheduleCleanup(agentId, entry);
                return;
            }

            entry.status = 'errored';
            const delay =
                attempts >= RESTART_BACKOFF_SCHEDULE.length
                    ? MAX_RESTART_BACKOFF
                    : (RESTART_BACKOFF_SCHEDULE[attempts - 1] ?? 1000);
            this.restartTimers.set(
                agentId,
                setTimeout(() => {
                    this.restartTimers.delete(agentId);
                    void this.start(agentId).catch(() => {
                        // Restart failed — will be retried on next exit or marked errored.
                    });
                }, delay),
            );
        });

        return entry;
    }

    /** Stop a supervised process gracefully (SIGTERM → bounded wait → SIGKILL). */
    async stop(agentId: string): Promise<void> {
        const proc = this.processes.get(agentId);
        if (proc?.entry.status !== 'running') return;

        // Claim `agent.stopped` before kill so the exit handler does not
        // double-emit when the process exits (task 0371). Status stays `running`
        // until after the wait so final status semantics match prior behavior.
        this.stopEmitted.add(agentId);
        proc.handle.kill('SIGTERM');

        // Bounded graceful wait (3 s)
        let timedOut = false;
        const exitPromise = proc.handle.exited;
        const timeout = new Promise<void>((resolve) => {
            setTimeout(() => {
                timedOut = true;
                resolve();
            }, 3000);
        });
        await Promise.race([exitPromise, timeout]);

        if (timedOut) {
            proc.handle.kill('SIGKILL');
            await proc.handle.exited.catch(() => {});
        }

        proc.entry.status = 'stopped';
        const timer = this.restartTimers.get(agentId);
        if (timer) {
            clearTimeout(timer);
            this.restartTimers.delete(agentId);
        }
        this.restartAttempts.delete(agentId);
        this.emit('process.stopped', {
            agentId,
            pid: proc.entry.pid,
            ...(proc.entry.agentType ? { agentType: proc.entry.agentType } : {}),
        });
        this.emit('agent.stopped', {
            agentId,
            pid: proc.entry.pid,
            ...(proc.entry.agentType ? { agentType: proc.entry.agentType } : {}),
        });
    }

    /** Start every agent in the autostart list. */
    async startAutostart(ids: string[]): Promise<ProcessEntry[]> {
        const results: ProcessEntry[] = [];
        // Load specs first so a missing id fails loud before any spawn.
        const specs = await this.loadSpecs();
        const specIds = new Set(specs.map((s) => s.id));
        for (const id of ids) {
            if (!specIds.has(id)) {
                throw new Error(
                    `Autostart agent "${id}" not found — check .spur/agents/ and the agent.fleet declaration`,
                );
            }
        }
        for (const id of ids) {
            results.push(await this.start(id));
        }
        return results;
    }

    /** Stop all running supervised processes (shutdown). */
    async stopAll(): Promise<void> {
        const running = Array.from(this.processes.keys()).filter(
            (id) => this.processes.get(id)?.entry.status === 'running',
        );
        await Promise.all(running.map((id) => this.stop(id)));
    }

    /** Schedule removal of a process entry after a keep window. */
    private scheduleCleanup(agentId: string, entry: ProcessEntry): void {
        const keepForMs = 60_000;
        setTimeout(() => {
            if (this.processes.get(agentId)?.entry === entry) {
                this.processes.delete(agentId);
            }
        }, keepForMs);
    }

    // ── Private helpers ──

    private async loadSpecs(): Promise<AgentSpec[]> {
        this.specsPromise ??= import('@gobing-ai/ts-ai-runner').then((m) => m.loadAgentSpecs(this.configDir));
        return this.specsPromise;
    }

    private resolveCommand(spec: AgentSpec): { command: string; args: string[] } {
        if (spec.tags.some((tag) => tag.startsWith('fleet:'))) return defaultWrapperArgv(spec.id);
        // Prefer `config.command` — the field materializeTeam writes and that
        // saveAgentSpec/loadAgentSpecs round-trip (0258 R9). Fall back to a top-level
        // `command` for in-memory / legacy specs (serializeAgentSpec drops top-level).
        const configCommand = Array.isArray(spec.config?.command) ? (spec.config.command as string[]) : undefined;
        const topLevel = (spec as AgentSpec & { command?: string[] }).command;
        const raw = configCommand ?? topLevel;
        if (raw && raw.length > 0) {
            return { command: raw[0] ?? '', args: raw.slice(1) };
        }
        return defaultWrapperArgv(spec.id);
    }

    private pipeStream(
        stream: ReadableStream<Uint8Array> | null,
        name: 'stdout' | 'stderr',
        _agentId: string,
        frames: ProcessFrame[],
    ): void {
        if (!stream) return;
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let partial = '';
        const pump = (): void => {
            void reader
                .read()
                .then(({ done, value }) => {
                    if (done) return;
                    partial += decoder.decode(value, { stream: true });
                    const lines = partial.split('\n');
                    partial = lines.pop() ?? '';
                    for (const line of lines) {
                        this.pushFrame(frames, { stream: name, ts: new Date().toISOString(), line });
                    }
                    pump();
                })
                .catch((err) => {
                    const message = err instanceof Error ? err.message : String(err);
                    this.pushFrame(frames, {
                        stream: name,
                        ts: new Date().toISOString(),
                        line: `[stream error: ${message}]`,
                    });
                });
        };
        pump();
    }

    private pushFrame(frames: ProcessFrame[], frame: Omit<ProcessFrame, 'seq'>): void {
        frames.push({ ...frame, seq: this.frameSeq++ });
        if (frames.length > this.ringBufferSize) {
            frames.splice(0, frames.length - this.ringBufferSize);
        }
    }

    /**
     * Publish a process or agent lifecycle row. 0860 R2 folded the retired
     * member-scoped pair into the catalog's own `agent.started|stopped`, so both
     * families go through this one emitter (payloads carry no grouping id).
     */
    private emit(
        name: 'process.spawned' | 'process.exited' | 'process.stopped' | 'agent.started' | 'agent.stopped',
        payload: ProcessEventPayload | AgentLifecycleEventPayload,
    ): void {
        try {
            const exitCode = 'exitCode' in payload ? payload.exitCode : undefined;
            const severity =
                name === 'process.exited' && exitCode !== undefined && exitCode !== null && exitCode !== 0
                    ? 'warning'
                    : 'info';
            const next = { ...payload, severity };
            if (name === 'agent.started' || name === 'agent.stopped') {
                this.eventBus.emit(name, next as AgentLifecycleEventPayload);
                return;
            }
            this.eventBus.emit(name, next as ProcessEventPayload);
        } catch {
            // Bus failure must not break process management.
        }
    }
}
