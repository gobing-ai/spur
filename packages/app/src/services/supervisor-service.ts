import type { AgentSpec } from '@gobing-ai/ts-ai-runner';
import type { EventBus } from '@gobing-ai/ts-infra';
import type { PipeProcess, PipeProcessOptions, ProcessExecutor } from '@gobing-ai/ts-runtime';

// ── Types ──

/** Per-process ring buffer of framed output, bounded to a constant frame count. */
export interface ProcessFrame {
    stream: 'stdout' | 'stderr';
    ts: string;
    line: string;
}

/** Registry entry for a supervised process. */
export interface ProcessEntry {
    agentId: string;
    pid: number | null;
    status: 'running' | 'stopped' | 'exited';
    startedAt: string;
    exitCode?: number | null;
    /** Ring buffer of recent output frames (bounded, oldest-first). */
    ringBuffer: ProcessFrame[];
}

/** Payload for process lifecycle events. Metadata only — no output body. */
export interface ProcessEventPayload {
    agentId: string;
    pid: number | null;
    exitCode?: number | null;
}

/** Bus shape for process lifecycle events consumed by SupervisorService. */
export type ProcessEventBus = EventBus<
    Record<'process.spawned' | 'process.exited' | 'process.stopped', (event: ProcessEventPayload) => void>
>;

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
}

// ── Constants ──

const DEFAULT_RING_BUFFER_SIZE = 500;

// ── Default wrapper helper ──

/**
 * Build the default drain-loop wrapper argv for agents without `command` (option c).
 * Uses the current Bun runtime to run `spur agent run --agent <id> --drain --continue`.
 */
function defaultWrapperArgv(agentId: string): { command: string; args: string[] } {
    return {
        command: process.execPath,
        args: [process.argv[1] ?? 'apps/cli/src/index.ts', 'agent', 'run', '--agent', agentId, '--drain', '--continue'],
    };
}

// ── SupervisorService ──

/**
 * Process supervisor (task 0195/0207).
 *
 * Manages supervised agent processes spawned from `.spur/agents/<id>.yaml` specs.
 * Supports option (c): spec-declared `command` wins when present; absent → the
 * spur-provided drain-loop wrapper. No auto-restart in v1 — exits are recorded,
 * not retried. Emits `process.spawned|exited|stopped` lifecycle events.
 */
export class SupervisorService {
    private readonly processExecutor: ProcessExecutor;
    private readonly eventBus: ProcessEventBus;
    private readonly configDir: string;
    private readonly ringBufferSize: number;
    private readonly processes = new Map<string, { handle: PipeProcess; entry: ProcessEntry }>();
    private readonly ringBuffers = new Map<string, ProcessFrame[]>();
    private specsPromise?: Promise<AgentSpec[]>;

    constructor(options: SupervisorOptions) {
        this.processExecutor = options.processExecutor;
        this.eventBus = options.eventBus;
        this.configDir = options.configDir;
        this.ringBufferSize = options.ringBufferSize ?? DEFAULT_RING_BUFFER_SIZE;
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

        const { command, args } = this.resolveCommand(spec);
        const frames: ProcessFrame[] = [];
        this.ringBuffers.set(agentId, frames);

        const pipeOpts: PipeProcessOptions = {
            command,
            args,
            label: `agent:${agentId}`,
            env: Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<
                string,
                string
            >,
        };

        const handle = this.processExecutor.runStreaming(pipeOpts);
        const pid = handle.pid;

        const entry: ProcessEntry = {
            agentId,
            pid,
            status: 'running',
            startedAt: new Date().toISOString(),
            ringBuffer: frames,
        };

        this.processes.set(agentId, { handle, entry });

        // Feed stdout/stderr frames into the ring buffer.
        this.pipeStream(handle.stdout, 'stdout', agentId, frames);
        this.pipeStream(handle.stderr, 'stderr', agentId, frames);

        // Spawn event
        this.emit('process.spawned', { agentId, pid });

        // Watch for exit
        void handle.exited.then((code) => {
            entry.status = 'exited';
            entry.exitCode = code;
            const keepForMs = 60_000;
            setTimeout(() => {
                if (this.processes.get(agentId)?.entry === entry) {
                    this.processes.delete(agentId);
                }
            }, keepForMs);
            this.emit('process.exited', { agentId, pid, exitCode: code });
        });

        return entry;
    }

    /** Stop a supervised process gracefully (SIGTERM → bounded wait → SIGKILL). */
    async stop(agentId: string): Promise<void> {
        const proc = this.processes.get(agentId);
        if (proc?.entry.status !== 'running') return;

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
        this.emit('process.stopped', { agentId, pid: proc.entry.pid });
    }

    /** Start every agent in the autostart list. */
    async startAutostart(ids: string[]): Promise<ProcessEntry[]> {
        const results: ProcessEntry[] = [];
        // Load specs first so a missing id fails loud before any spawn.
        const specs = await this.loadSpecs();
        const specIds = new Set(specs.map((s) => s.id));
        for (const id of ids) {
            if (!specIds.has(id)) {
                throw new Error(`Autostart agent "${id}" not found — check .spur/agents/ and team.autostart config`);
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

    // ── Private helpers ──

    private async loadSpecs(): Promise<AgentSpec[]> {
        this.specsPromise ??= import('@gobing-ai/ts-ai-runner').then((m) => m.loadAgentSpecs(this.configDir));
        return this.specsPromise;
    }

    private resolveCommand(spec: AgentSpec): { command: string; args: string[] } {
        const raw = (spec as AgentSpec & { command?: string[] }).command;
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
            void reader.read().then(({ done, value }) => {
                if (done) return;
                partial += decoder.decode(value, { stream: true });
                const lines = partial.split('\n');
                partial = lines.pop() ?? '';
                for (const line of lines) {
                    this.pushFrame(frames, { stream: name, ts: new Date().toISOString(), line });
                }
                pump();
            });
        };
        pump();
    }

    private pushFrame(frames: ProcessFrame[], frame: ProcessFrame): void {
        frames.push(frame);
        if (frames.length > this.ringBufferSize) {
            frames.splice(0, frames.length - this.ringBufferSize);
        }
    }

    private emit(name: 'process.spawned' | 'process.exited' | 'process.stopped', payload: ProcessEventPayload): void {
        try {
            this.eventBus.emit(name, payload);
        } catch {
            // Bus failure must not break process management.
        }
    }
}
