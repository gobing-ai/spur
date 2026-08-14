import { homedir } from 'node:os';
import { basename, isAbsolute, resolve } from 'node:path';
import { type DbAdapter, type InsertRunSessionInput, RunSessionDao } from '@gobing-ai/spur-domain';
import type { AgentName } from '@gobing-ai/ts-ai-runner';
import { type LlmJsonlSource, SOURCE_DEFINITIONS } from '@gobing-ai/ts-llm-jsonl-importer';
import { createNodeFileSystem, walkDir } from '@gobing-ai/ts-runtime';

/**
 * Agent → importer-source mapping for session-root observation (feature E6).
 * Only agents whose CLI writes into a known importer session root can be
 * observed; the roots themselves are owned by `SOURCE_DEFINITIONS`
 * (`@gobing-ai/ts-llm-jsonl-importer`), which stays the authority. `hermes`
 * has no importer source and is skipped (nothing to observe).
 */
export const AGENT_SESSION_SOURCES: Partial<Record<AgentName, LlmJsonlSource>> = {
    pi: 'pi',
    claude: 'claude',
    codex: 'codex',
    omp: 'omp',
    grok: 'grok',
    gemini: 'gemini',
    opencode: 'opencode',
    openclaw: 'openclaw',
    'antigravity-cli': 'agy',
};

/** Shared per-process overlap state: concurrent same-root runs must not both claim a session. */
export interface RunSessionOverlapRegistry {
    /** In-flight watermark count per session root. */
    active: Map<string, number>;
    /** Roots where an overlap was observed; cleared when the active count returns to zero. */
    overlapped: Set<string>;
}

/** Options for constructing a {@link RunSessionObserver} (feature E6). */
export interface RunSessionObserverOptions {
    runId: string;
    getDb: () => Promise<DbAdapter>;
    /** Warning sink — resolution failure must never surface as a run failure. */
    output: { error: (message: string) => void };
    registry: RunSessionOverlapRegistry;
    /** Home anchor for agent session roots (test seam; default `os.homedir()`). */
    home?: string;
    /** Cwd anchor for a relative `sessionDir` (test seam; default `process.cwd()`). */
    cwd?: string;
    /** Suppress warnings in json output (matches the coordination warning pattern). */
    json?: boolean;
    /** Clock seam for the watermark timestamp (tests). */
    now?: () => number;
}

/** Timestamp watermark captured before dispatch (R1/R5: a cheap stat, nothing more). */
export interface RunSessionWatermark {
    source: string;
    root: string;
    /** Epoch ms captured before dispatch; files touched at/after it are candidates. */
    at: number;
}

/**
 * Observes the agent invoke boundary to record a run→session mapping
 * (feature E6 / task 0557).
 *
 * Watermark at start: resolve the agent's session root and capture a
 * timestamp — no directory walk, so observation cannot slow the invocation
 * (R5). Resolve at exit: walk the root for files written at/after the
 * watermark. Exactly one candidate is an exact `observed` mapping; zero or
 * many (or a concurrent same-root overlap, R3) degrade to an `unresolved`
 * row — never an exact row with a guessed session. A supplied `sessionId`
 * (R2) skips observation entirely and records an exact `supplied` mapping.
 * Resolution failure never throws (R5): the run outcome is already decided;
 * the observer logs and records `unresolved`.
 *
 * `ponytail: overlap detection is process-local` — concurrent runs in two
 * separate `spur` processes are not visible to each other's registry. Rare
 * under `--worktree` isolation (each tree owns its sessions); cross-process
 * detection would need a shared ledger, add when concurrent same-agent runs
 * are observed in production.
 */
export class RunSessionObserver {
    private watermark_?: RunSessionWatermark;
    private supplied_?: { source: string; sessionId: string };
    private readonly home: string;
    private readonly cwd: string;
    private readonly now: () => number;

    constructor(private readonly options: RunSessionObserverOptions) {
        this.home = options.home ?? homedir();
        this.cwd = options.cwd ?? process.cwd();
        this.now = options.now ?? Date.now;
    }

    /**
     * Capture the watermark for an agent's session root. Cheap: a root
     * resolution + timestamp + an active-count bump. Re-invoking with the
     * same root is a no-op (escalation dispatches); a different root
     * (escalation to another agent) replaces the prior watermark. Returns
     * `undefined` for agents with no observable session root.
     */
    async watermark(agent: AgentName, sessionDir?: string): Promise<RunSessionWatermark | undefined> {
        // R2: a supplied session id skips observation entirely — including the
        // dispatch-loop re-watermark, which would otherwise leak an active
        // registry entry and falsely flag the next same-root run as overlap.
        if (this.supplied_ !== undefined) return undefined;
        const source = AGENT_SESSION_SOURCES[agent];
        if (source === undefined) return undefined;
        const root = this.resolveRoot(source, sessionDir);
        if (this.watermark_ !== undefined && this.watermark_.root === root) return this.watermark_;
        if (this.watermark_ !== undefined) this.release(this.watermark_);
        const active = this.options.registry.active.get(root) ?? 0;
        this.options.registry.active.set(root, active + 1);
        if (active > 0) this.options.registry.overlapped.add(root);
        this.watermark_ = { source, root, at: this.now() };
        return this.watermark_;
    }

    /** R2: take the mapping from a supplied session id — no observation at all. */
    supply(agent: AgentName, sessionId: string): void {
        const source = AGENT_SESSION_SOURCES[agent];
        if (source === undefined) return;
        this.supplied_ = { source, sessionId };
    }

    /**
     * Resolve the produced session and record the mapping. Never throws —
     * every failure path records `unresolved` (or nothing for unobservable
     * agents) and logs, so resolution can never fail the run (R5).
     */
    async resolve(): Promise<void> {
        try {
            if (this.supplied_ !== undefined) {
                await this.write({
                    runId: this.options.runId,
                    source: this.supplied_.source,
                    sessionId: this.supplied_.sessionId,
                    exactness: 'exact',
                    mechanism: 'supplied',
                    resolvedAt: new Date().toISOString(),
                });
                return;
            }
            const wm = this.watermark_;
            if (wm === undefined) return;
            try {
                if (this.options.registry.overlapped.has(wm.root)) {
                    this.logAmbiguity(wm);
                    await this.writeUnresolved(wm.source);
                    return;
                }
                const candidates = await this.findCandidates(wm);
                if (candidates.length === 0) {
                    await this.writeUnresolved(wm.source);
                    return;
                }
                if (candidates.length > 1) {
                    this.logAmbiguity(wm, candidates.length);
                    await this.writeUnresolved(wm.source);
                    return;
                }
                const sessionId = await this.sessionIdFor(wm.source, candidates[0] as string);
                await this.write({
                    runId: this.options.runId,
                    source: wm.source,
                    sessionId,
                    exactness: 'exact',
                    mechanism: 'observed',
                    resolvedAt: new Date().toISOString(),
                });
            } catch (error) {
                // Missing/unreadable root, walk or parse failure (R5): the run
                // outcome is already decided — record unresolved, never throw.
                this.warn(
                    `run-session resolve failed for ${wm.source} (${wm.root}): ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
                await this.writeUnresolved(wm.source);
            } finally {
                this.release(wm);
            }
        } catch {
            // Belt-and-braces: even the unresolved-record path failing (DB
            // down) must not surface out of resolve().
        }
    }

    /** Files under the root written at/after the watermark — created or extended by the run. */
    private async findCandidates(wm: RunSessionWatermark): Promise<string[]> {
        const fs = createNodeFileSystem();
        const files = await walkDir(wm.root, fs);
        const candidates: string[] = [];
        for (const rel of files) {
            const full = resolve(wm.root, rel);
            const st = await fs.stat(full);
            if (st === null || !st.isFile()) continue;
            // A file touched during the window has mtime >= the watermark;
            // mtime skew can only drop a candidate (→ unresolved, safe), never
            // fabricate an exact mapping.
            if (st.mtimeMs >= wm.at) candidates.push(full);
        }
        return candidates.sort();
    }

    /**
     * Session id for a candidate file. Prefer the id the file itself records
     * (matches the importer's extraction — `history_message.session_id`, the
     * join key 0558/0559 use); fall back to the file stem. Codex session
     * files are `rollout-<ts>-<uuid>.jsonl` — the stem is *not* the session
     * id, only the first record (`session_meta.payload.id`) carries it.
     */
    private async sessionIdFor(source: string, filePath: string): Promise<string> {
        const stem = basename(filePath).replace(/\.[^.]+$/, '');
        try {
            const firstLine = (await createNodeFileSystem().readFile(filePath)).split('\n', 1)[0] ?? '';
            const raw = JSON.parse(firstLine) as Record<string, unknown>;
            if (source === 'claude') return firstString(raw.sessionId, raw.conversation_uuid) ?? stem;
            if (source === 'codex') {
                const payload = asRecord(raw.payload);
                return firstString(raw.session_id, payload?.id, raw.id) ?? stem;
            }
            if (source === 'pi') return firstString(raw.id, asRecord(raw.session)?.id) ?? stem;
        } catch {
            // Unparseable first record — the file stem is the fallback.
        }
        return stem;
    }

    private async writeUnresolved(source: string): Promise<void> {
        await this.write({
            runId: this.options.runId,
            source,
            sessionId: null,
            exactness: 'unresolved',
            mechanism: 'observed',
            resolvedAt: new Date().toISOString(),
        });
    }

    private async write(input: InsertRunSessionInput): Promise<void> {
        try {
            const dao = new RunSessionDao(await this.options.getDb());
            await dao.insert(input);
        } catch (error) {
            this.warn(`run-session mapping persist failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private release(wm: RunSessionWatermark): void {
        const active = (this.options.registry.active.get(wm.root) ?? 1) - 1;
        if (active <= 0) {
            this.options.registry.active.delete(wm.root);
            this.options.registry.overlapped.delete(wm.root);
        } else {
            this.options.registry.active.set(wm.root, active);
        }
        if (this.watermark_?.root === wm.root) this.watermark_ = undefined;
    }

    private logAmbiguity(wm: RunSessionWatermark, candidates?: number): void {
        this.warn(
            `run-session ambiguous for ${wm.source} (${wm.root}): ${
                candidates !== undefined
                    ? `${candidates} candidate session files written during the run`
                    : 'a concurrent run of the same agent overlapped the session root'
            }; no exact mapping recorded (task 0558 will correlate)`,
        );
    }

    private warn(message: string): void {
        if (this.options.json === true) return;
        this.options.output.error(`Warning: ${message}`);
    }

    private resolveRoot(source: LlmJsonlSource, sessionDir?: string): string {
        if (sessionDir !== undefined && sessionDir !== '') {
            return isAbsolute(sessionDir) ? sessionDir : resolve(this.cwd, sessionDir);
        }
        const roots = SOURCE_DEFINITIONS[source].defaultRoots;
        return resolve(this.home, roots[0] ?? '');
    }
}

function firstString(...values: unknown[]): string | undefined {
    for (const value of values) {
        if (typeof value === 'string' && value.length > 0) return value;
    }
    return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}
