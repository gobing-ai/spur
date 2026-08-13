import type { AgentSpec } from '@gobing-ai/ts-ai-runner';
import type { EventBus } from '@gobing-ai/ts-infra';
import type { PipeProcess, PipeProcessOptions, ProcessExecutor } from '@gobing-ai/ts-runtime';

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
    /** Team the agent belongs to, resolved from spec.tags (`team:<id>`) at start (spur#0267). */
    teamId?: string | null;
    /** Coding-agent type from the agent spec at start (0269 process event identity). */
    agentType?: string;
}

/** Payload for process lifecycle events. Metadata only — no output body. */
export interface ProcessEventPayload {
    agentId: string;
    pid: number | null;
    exitCode?: number | null;
    /** Team id from `team:<id>` tag when known (0269 Activity identity). */
    teamId?: string | null;
    /** Coding-agent type from the agent spec when known. */
    agentType?: string;
    /** Producer-owned observability severity. */
    severity?: 'info' | 'warning' | 'error';
}

/**
 * Metadata-only payload for supervisor-emitted `team.member.started|stopped`
 * (task 0371 R2). Mirrors {@link ProcessEventPayload} identity fields so the
 * team.* family is attributable without reading process.* rows.
 */
export interface SupervisorTeamMemberEventPayload {
    teamId: string | null;
    memberId: string | null;
    agentType: string | null;
    outcome: string;
    /** Producer-owned observability severity. */
    severity?: 'info' | 'warning' | 'error';
}

/** Bus shape for process + team.member lifecycle events from SupervisorService. */
export type ProcessEventBus = EventBus<{
    'process.spawned': (event: ProcessEventPayload) => void;
    'process.exited': (event: ProcessEventPayload) => void;
    'process.stopped': (event: ProcessEventPayload) => void;
    'team.member.started': (event: SupervisorTeamMemberEventPayload) => void;
    'team.member.stopped': (event: SupervisorTeamMemberEventPayload) => void;
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
}

// ── Constants ──

const DEFAULT_RING_BUFFER_SIZE = 500;
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_BACKOFF_SCHEDULE = [1000, 2000, 4000, 8000, 16_000];
const MAX_RESTART_BACKOFF = 30_000;

// ── Default wrapper helper ──

/**
 * Build the default wrapper argv for agents without `command` (option c).
 * Spawns the persistent self-draining loop `spur agent loop --agent <id>` (0258 R6):
 * the process stays alive, drains its inbox each iteration, and idle-sleeps when empty —
 * so a single successful drain does not end the member. Crash-restart stays with the
 * supervisor's exit handler (R7).
 */
function defaultWrapperArgv(agentId: string): { command: string; args: string[] } {
    return {
        command: process.execPath,
        args: [process.argv[1] ?? 'apps/cli/src/index.ts', 'agent', 'loop', '--agent', agentId],
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
    /** Agent ids that already emitted `team.member.stopped` via explicit stop(). */
    private readonly teamMemberStopEmitted = new Set<string>();
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

    /** Write a line to the supervised process's stdin (for POST /api/team/processes/:id/stdin). */
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

        const { command, args } = this.resolveCommand(spec);
        // Resolve teamId from spec.tags (`team:<id>`) for registry grouping (spur#0267 R1).
        // If the agent belongs to multiple teams, the first `team:` tag wins.
        const teamTag = spec.tags.find((t) => t.startsWith('team:'));
        const teamId = teamTag ? teamTag.slice('team:'.length) : null;
        const frames: ProcessFrame[] = [];
        this.ringBuffers.set(agentId, frames);

        const pipeOpts: PipeProcessOptions = {
            command,
            args,
            label: `agent:${agentId}`,
            // Tag for ProcessRegistry watch list (ts-runtime 0.4.10 / spur#0264).
            source: 'supervisor',
            agentId,
            // Thread teamId into ProcessRegistry execution row (spur#0267 R1).
            ...(teamId ? { teamId } : {}),
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
            teamId,
            agentType: spec.type,
        };

        this.processes.set(agentId, { handle, entry });
        this.restartAttempts.delete(agentId);

        // Feed stdout/stderr frames into the ring buffer.
        this.pipeStream(handle.stdout, 'stdout', agentId, frames);
        this.pipeStream(handle.stderr, 'stderr', agentId, frames);

        // Spawn event — stamp team/agent identity for Activity board (0269 P4).
        this.emit('process.spawned', {
            agentId,
            pid,
            teamId,
            agentType: spec.type,
        });
        // Team member state (task 0371 R2/R3): cataloged team.member.started so
        // the Activity tab's `team.` filter has a real producer. Unknown team
        // tags yield null teamId — event still fires (R5).
        this.emitTeamMember('team.member.started', {
            teamId,
            memberId: agentId,
            agentType: spec.type ?? null,
            outcome: 'started',
        });

        // Watch for exit — restart on abnormal exit (0253 R3)
        void handle.exited.then(async (code) => {
            entry.exitCode = code;
            this.emit('process.exited', {
                agentId,
                pid,
                exitCode: code,
                teamId: entry.teamId ?? null,
                ...(entry.agentType ? { agentType: entry.agentType } : {}),
            });
            // Member state on natural exit/crash only. Explicit stop() already
            // emitted `team.member.stopped` — avoid double rows (task 0371).
            if (!this.teamMemberStopEmitted.has(agentId)) {
                this.emitTeamMember('team.member.stopped', {
                    teamId: entry.teamId ?? null,
                    memberId: agentId,
                    agentType: entry.agentType ?? null,
                    outcome: code === 0 ? 'exited' : 'errored',
                });
            } else {
                this.teamMemberStopEmitted.delete(agentId);
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

        // Claim team.member.stopped before kill so the exit handler does not
        // double-emit when the process exits (task 0371). Status stays `running`
        // until after the wait so final status semantics match prior behavior.
        this.teamMemberStopEmitted.add(agentId);
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
            teamId: proc.entry.teamId ?? null,
            ...(proc.entry.agentType ? { agentType: proc.entry.agentType } : {}),
        });
        this.emitTeamMember('team.member.stopped', {
            teamId: proc.entry.teamId ?? null,
            memberId: agentId,
            agentType: proc.entry.agentType ?? null,
            outcome: 'stopped',
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

    private emit(name: 'process.spawned' | 'process.exited' | 'process.stopped', payload: ProcessEventPayload): void {
        try {
            const exitCode = payload.exitCode;
            const severity =
                name === 'process.exited' && exitCode !== undefined && exitCode !== null && exitCode !== 0
                    ? 'warning'
                    : 'info';
            this.eventBus.emit(name, { ...payload, severity });
        } catch {
            // Bus failure must not break process management.
        }
    }

    private emitTeamMember(
        name: 'team.member.started' | 'team.member.stopped',
        payload: SupervisorTeamMemberEventPayload,
    ): void {
        try {
            this.eventBus.emit(name, { ...payload, severity: 'info' });
        } catch {
            // Bus failure must not break process management.
        }
    }
}
