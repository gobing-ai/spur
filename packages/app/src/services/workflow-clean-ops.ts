import { realpathSync, statSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { ArtifactDao, RunDao, redirectRunStorageReferences } from '@gobing-ai/spur-domain';
import {
    createDefaultWorkflowEngineHost,
    DbWorkflowPersistenceAdapter,
    WorkflowService as EngineWorkflowService,
} from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    type CheckpointMetadata,
    isTerminalCheckpointStatus,
    parseCheckpointMetadata,
} from '../workflow/checkpoint-contract';
import type {
    CheckpointReclamationResult,
    ReclaimedCheckpoint,
    ReclaimedRunLog,
    RunLogReclamationResult,
    ScratchReclamationResult,
    SkippedCheckpoint,
} from '../workflow/run-record';
import { migrateRunStorage, type RunStorageMigrationResult, runStoragePaths } from './run-storage';
import { newestMtime } from './workflow-catalog-scan';
import type { WorkflowAppServiceContext, WorkflowCleanResult } from './workflow-service';

/**
 * `workflow clean` for {@link WorkflowAppService}: stale-run cleanup, run-storage migration and the
 * run-log / scratch / checkpoint reclamation passes.
 */
export class WorkflowCleanOps {
    constructor(private readonly ctx: WorkflowAppServiceContext) {}

    /** Implementation of {@link WorkflowAppService.clean} (see its doc comment for the contract). */
    async clean(olderThanMinutes = 30, dryRun = false): Promise<WorkflowCleanResult> {
        const db = await this.ctx.getDb();
        const dao = new RunDao(db);
        const cutoffIso = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
        const stale = await dao.listStaleRuns(cutoffIso);
        if (!dryRun) {
            // 0901 R2: a stale claimed run is an owner the engine lost — mark it
            // `interrupted` (rerun-resumable) rather than `failed` (wedged).
            // Rows the engine cannot interrupt (pending / pre-0.5.0) keep the
            // legacy finalize-to-failed path.
            const engine = new EngineWorkflowService(
                createDefaultWorkflowEngineHost({}),
                new DbWorkflowPersistenceAdapter(db),
            );
            for (const run of stale) {
                const interrupted =
                    run.status === 'running'
                        ? await engine.interruptRun(
                              run.id,
                              // 0937 review: the engine mirrors this reason into the closed-enum
                              // runs.terminal_reason, so pass the declared value — the human detail
                              // lands in metadata_json below under finalizeStale's key.
                              'interrupted',
                          )
                        : undefined;
                if (interrupted === undefined) {
                    await dao.finalizeStale(run.id, `stale: non-terminal > ${olderThanMinutes}m (spur workflow clean)`);
                } else {
                    await dao.mergeMetadata(run.id, {
                        staleReason: `stale: owner lost > ${olderThanMinutes}m (spur workflow clean)`,
                    });
                }
            }
        }
        return {
            olderThanMinutes,
            dryRun,
            cleaned: stale.map((r) => ({ runId: r.id, startedAt: r.started_at })),
        };
    }

    /** Implementation of {@link WorkflowAppService.migrateRunStorage} (see its doc comment for the contract). */
    async migrateRunStorage(opts: { dryRun?: boolean; logsOnly?: boolean } = {}): Promise<RunStorageMigrationResult> {
        const paths = runStoragePaths(this.ctx.cwd);
        const db = await this.ctx.getDb();
        const runDao = new RunDao(db);
        return migrateRunStorage({
            dirs: paths,
            readRunStatus: async (runId) => (await runDao.traceRowById(runId))?.status ?? null,
            registeredArtifacts: await new ArtifactDao(db).storageReferences(),
            redirectReferences: async (entries) => {
                const moves = new Map<string, string>();
                for (const entry of entries) {
                    if (entry.target === null) continue;
                    const canonicalTarget = realpathSync(entry.target);
                    moves.set(entry.source, canonicalTarget);
                    moves.set(realpathSync(entry.source), canonicalTarget);
                    moves.set(relative(paths.projectRoot, entry.source), canonicalTarget);
                    for (
                        let source = dirname(entry.source), target = dirname(canonicalTarget);
                        source.startsWith(paths.scratchDir + sep);
                        source = dirname(source), target = dirname(target)
                    ) {
                        moves.set(source, target);
                        moves.set(realpathSync(source), target);
                        moves.set(relative(paths.projectRoot, source), target);
                    }
                }
                await redirectRunStorageReferences(
                    db,
                    Array.from(moves, ([source, target]) => {
                        const stat = statSync(target);
                        return {
                            source,
                            target,
                            ...(stat.isFile()
                                ? {
                                      sourceSize: stat.size,
                                      sourceMtimeMs: stat.mtimeMs,
                                  }
                                : {}),
                        };
                    }),
                );
            },
            dryRun: opts.dryRun === true,
            logsOnly: opts.logsOnly === true,
        });
    }

    /** Implementation of {@link WorkflowAppService.cleanRunLogs} (see its doc comment for the contract). */
    async cleanRunLogs(retentionDays = 30, dryRun = false): Promise<RunLogReclamationResult> {
        const fs = createNodeFileSystem();
        const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
        const reclaimed: ReclaimedRunLog[] = [];
        const failures: RunLogReclamationResult['failures'] = [];

        const liveIds = new Set<string>();
        try {
            for (const row of await new RunDao(await this.ctx.getDb()).listActiveRuns()) {
                liveIds.add(row.id);
            }
        } catch (err) {
            failures.push({ path: runStoragePaths(this.ctx.cwd).recordsDir, error: String(err) });
            return { retentionDays, dryRun, reclaimed, failures };
        }

        const runDirs = [runStoragePaths(this.ctx.cwd).recordsDir, join(this.ctx.cwd, '.spur', 'run')];
        const seen = new Set<string>();
        for (const runDir of runDirs) {
            let entries: string[];
            try {
                entries = (await fs.readDir(runDir)).filter((name) => name.endsWith('.log'));
            } catch {
                // Absent root — nothing to reclaim there.
                continue;
            }
            for (const name of entries) {
                if (seen.has(name)) continue;
                const path = join(runDir, name);
                if (liveIds.has(name.slice(0, -'.log'.length))) continue;
                const stat = await fs.stat(path);
                if (stat === null || !stat.isFile() || stat.mtimeMs >= cutoffMs) continue;
                const entry = {
                    runId: name.slice(0, -'.log'.length),
                    path,
                    mtime: new Date(stat.mtimeMs).toISOString(),
                };
                seen.add(name);
                if (dryRun) {
                    reclaimed.push(entry);
                    continue;
                }
                try {
                    await fs.deleteFile(path);
                    reclaimed.push(entry);
                } catch (err) {
                    failures.push({ path, error: String(err) });
                }
            }
        }
        return { retentionDays, dryRun, reclaimed, failures };
    }

    /** Implementation of {@link WorkflowAppService.cleanScratch} (see its doc comment for the contract). */
    async cleanScratch(retentionDays = 30, dryRun = false): Promise<ScratchReclamationResult> {
        const scratchDir = runStoragePaths(this.ctx.cwd).scratchDir;
        const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
        const result: ScratchReclamationResult = { retentionDays, dryRun, reclaimed: [], failures: [] };

        let liveIds: string[];
        try {
            liveIds = (await new RunDao(await this.ctx.getDb()).listActiveRuns()).map((row) => row.id);
        } catch (err) {
            result.failures.push({ path: scratchDir, error: String(err) });
            return result;
        }

        let names: string[];
        try {
            names = await readdir(scratchDir);
        } catch {
            return result; // Absent scratch root — nothing to reclaim.
        }
        for (const name of names) {
            if (name.endsWith('.log') || name === 'guests' || liveIds.some((id) => name.startsWith(id))) continue;
            const path = join(scratchDir, name);
            try {
                const newest = await newestMtime(path);
                if (newest === null || newest >= cutoffMs) continue;
                const entry = { name, path, mtime: new Date(newest).toISOString() };
                if (!dryRun) await rm(path, { recursive: true, force: true });
                result.reclaimed.push(entry);
            } catch (err) {
                result.failures.push({ path, error: String(err) });
            }
        }
        return result;
    }

    /** Implementation of {@link WorkflowAppService.cleanCheckpoints} (see its doc comment for the contract). */
    async cleanCheckpoints(retentionDays = 30, dryRun = false): Promise<CheckpointReclamationResult> {
        const sessionsDir = join(this.ctx.cwd, '.spur', 'memory', 'sessions');
        const fs = createNodeFileSystem();
        let sessionsReal: string;
        try {
            sessionsReal = realpathSync(sessionsDir);
        } catch {
            sessionsReal = resolve(sessionsDir);
        }
        const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
        const reclaimed: ReclaimedCheckpoint[] = [];
        const skipped: SkippedCheckpoint[] = [];
        const failures: CheckpointReclamationResult['failures'] = [];

        let entries: string[];
        try {
            entries = (await fs.readDir(sessionsDir)).filter((name) => name.endsWith('.md'));
        } catch {
            // No sessions dir yet — nothing to reclaim.
            return { retentionDays, dryRun, reclaimed, skipped, failures };
        }

        const activeRunIds = new Set((await new RunDao(await this.ctx.getDb()).listActiveRuns()).map((r) => r.id));

        for (const name of entries) {
            const path = join(sessionsDir, name);
            // Confinement guard (0711 R5): the candidate must resolve back into the sessions dir.
            // `realpath` (not `resolve`) — `resolve` never follows symlinks, so a link escaping
            // the dir would pass a plain-normalize check and get deleted through the link.
            let resolved: string;
            try {
                resolved = realpathSync(path);
            } catch {
                resolved = resolve(path);
            }
            if (!resolved.startsWith(sessionsReal + sep)) {
                skipped.push({ name, reason: 'path-confinement: resolved outside .spur/memory/sessions' });
                continue;
            }
            let meta: CheckpointMetadata | null = null;
            let mtimeMs = 0;
            try {
                meta = parseCheckpointMetadata(await fs.readFile(path));
                const stat = await fs.stat(path);
                mtimeMs = stat?.mtimeMs ?? 0;
            } catch (err) {
                skipped.push({ name, reason: `unreadable: ${String(err)}` });
                continue;
            }
            if (meta === null) {
                skipped.push({ name, reason: 'malformed: not canonical checkpoint metadata (0711 R3/R6)' });
                continue;
            }
            if (!isTerminalCheckpointStatus(meta.status)) {
                skipped.push({ name, reason: `non-terminal: status=${meta.status || 'unset'}` });
                continue;
            }
            if (meta.runId !== '' && activeRunIds.has(meta.runId)) {
                skipped.push({ name, reason: `active-run reference: ${meta.runId}` });
                continue;
            }
            const ageMs = Number.isFinite(Date.parse(meta.updatedAt)) ? Date.parse(meta.updatedAt) : mtimeMs;
            if (ageMs >= cutoffMs) {
                skipped.push({ name, reason: 'not expired: within retention window' });
                continue;
            }
            const entry: ReclaimedCheckpoint = {
                name,
                path,
                age: new Date(ageMs).toISOString(),
            };
            if (dryRun) {
                reclaimed.push(entry);
                continue;
            }
            try {
                await fs.deleteFile(path);
                reclaimed.push(entry);
            } catch (err) {
                failures.push({ path, error: String(err) });
            }
        }
        return { retentionDays, dryRun, reclaimed, skipped, failures };
    }
}
