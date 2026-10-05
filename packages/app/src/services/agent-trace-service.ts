import { join } from 'node:path';
import { CoordinationRunDao, type DbAdapter, RunDao, RunSessionDao } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';

/**
 * ADR-132's execution record, readable as one lineage (1076 R4).
 *
 * Every execution is a run: a workflow run row lives in `runs`, an agent run in
 * `coordination_runs`, and the dispatch edge is `coordination_runs.parent_run_id`.
 * The trace walks that edge UP to the root and then DOWN to the leaves, so an
 * operator asking "what happened in this fleet turn" gets the dispatch, the turn,
 * its agent session ids, and each run's stream in one view.
 */
export interface TraceNode {
    runId: string;
    kind: 'workflow' | 'agent';
    status: string;
    parentRunId: string | null;
    /** Agent session ids this run produced (exact `history_run_session` rows). */
    sessionIds: string[];
    /** The durable stream's path, when the run wrote one. */
    logPath: string | null;
}

/** Root-first, depth-first lineage. `nodes[0]` is always the root. */
export interface TraceTree {
    rootRunId: string;
    nodes: TraceNode[];
}

/** Injected seams for {@link AgentTraceService}: the project whose runs are read and its DB factory. */
export interface AgentTraceDeps {
    /** The project whose runs are being read. */
    projectPath: string;
    openDb(projectPath: string): Promise<DbAdapter>;
    /** `.spur/memory/runs` — where this run's durable stream lives (defaults under `projectPath`). */
    logDir?: string;
}

/** Terminal statuses across both row families. Anything else means "still running". */
const TERMINAL = new Set(['exited', 'errored', 'done', 'failed', 'cancelled', 'interrupted', 'paused']);

/**
 * Reads ADR-132's execution record as one lineage (1076 R4).
 *
 * `trace` resolves the root by walking `parent_run_id` up and then builds the tree down, so any id in
 * a dispatch chain yields the whole picture; `follow` polls until every node is terminal with a
 * caller budget, mirroring `spur workflow trace --follow`. Pure reads over `runs` and
 * `coordination_runs` plus the durable streams — it never writes and never mutates a run.
 */
export class AgentTraceService {
    constructor(private readonly deps: AgentTraceDeps) {}

    private get logDir(): string {
        return this.deps.logDir ?? join(this.deps.projectPath, '.spur', 'memory', 'runs');
    }

    /**
     * Resolve the root by walking `parent_run_id` up, then build the tree down. A cycle
     * (which a corrupted row could express) stops the walk rather than looping.
     */
    async trace(runId: string): Promise<TraceTree> {
        const db = await this.deps.openDb(this.deps.projectPath);
        const coordination = new CoordinationRunDao(db);

        let rootRunId = runId;
        // The upward walk needs its own visited set: adding ancestors to the DFS's set would
        // make the descent skip the very node we started from (it IS a legitimate descendant).
        const ancestors = new Set<string>([runId]);
        for (;;) {
            const row = await coordination.getByRunId(rootRunId);
            const parent = row?.parent_run_id ?? null;
            if (parent === null || ancestors.has(parent)) break;
            ancestors.add(parent);
            rootRunId = parent;
        }

        const nodes: TraceNode[] = [];
        const visited = new Set<string>();
        const visit = async (id: string): Promise<void> => {
            if (visited.has(id)) return; // cycle guard on the descent only
            visited.add(id);
            nodes.push(await this.node(db, id));
            for (const child of await coordination.listByParentRunId(id)) {
                await visit(child.run_id);
            }
        };
        await visit(rootRunId);
        return { rootRunId, nodes };
    }

    /** One node: coordination row first (an agent run), then a workflow run row. */
    private async node(db: DbAdapter, runId: string): Promise<TraceNode> {
        const coordination = await new CoordinationRunDao(db).getByRunId(runId);
        if (coordination !== null) {
            return {
                runId,
                kind: 'agent',
                status: coordination.status,
                parentRunId: coordination.parent_run_id,
                sessionIds: await this.sessionIds(db, runId),
                logPath: await this.existingLog(runId),
            };
        }
        const workflow = await new RunDao(db).findById(runId);
        return {
            runId,
            kind: 'workflow',
            status: workflow?.status ?? 'unknown',
            // A workflow run's own parent is another workflow's id; the engine does not
            // dispatch nested workflow runs today, so the edge is reported as absent.
            parentRunId: null,
            sessionIds: await this.sessionIds(db, runId),
            logPath: await this.existingLog(runId),
        };
    }

    /** Exact run→session rows only (a `.md`-derived guess is not this report's business). */
    private async sessionIds(db: DbAdapter, runId: string): Promise<string[]> {
        const rows = await new RunSessionDao(db).getByRunId(runId);
        return rows.map((row) => row.session_id).filter((id): id is string => id !== null && id !== '');
    }

    /**
     * The run's durable stream, when it has one. Read through the project's FileSystem
     * abstraction (the `no-direct-fs-io` rule owns raw `node:fs` in app services), and
     * best-effort: an unreadable path reports "no stream", never a thrown trace.
     */
    private async existingLog(runId: string): Promise<string | null> {
        const path = join(this.logDir, `${runId}.md`);
        try {
            return (await createNodeFileSystem(this.deps.projectPath).exists(path)) ? path : null;
        } catch {
            return null;
        }
    }

    /**
     * Poll the lineage until every node is terminal (1076 R4). Bounded by `timeoutMs`,
     * mirroring `spur workflow trace --follow`: on expiry the caller prints one checkpoint
     * line and exits 1 while the runs continue.
     */
    async follow(
        runId: string,
        options: {
            timeoutMs: number;
            signal?: AbortSignal;
            onTick?: (tree: TraceTree) => void;
            sleep?: (ms: number) => Promise<void>;
            now?: () => number;
            pollMs?: number;
        },
    ): Promise<{ tree: TraceTree; timedOut: boolean }> {
        const now = options.now ?? (() => Date.now());
        const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
        const pollMs = options.pollMs ?? 250;
        const deadline = now() + options.timeoutMs;
        for (;;) {
            const tree = await this.trace(runId);
            options.onTick?.(tree);
            const live = tree.nodes.some((node) => !TERMINAL.has(node.status));
            if (!live) return { tree, timedOut: false };
            if (options.signal?.aborted === true || now() >= deadline) return { tree, timedOut: true };
            await sleep(pollMs);
        }
    }
}
