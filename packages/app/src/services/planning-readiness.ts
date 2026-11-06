import { basename, dirname } from 'node:path';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { PlanningReadError } from '../errors';
import { type PlanningSnapshot, readPlanningSnapshot } from './planning-snapshot';
import { RUN_STORE_WBS_MAX_LIMIT, type RunStoreService } from './run-store-service';
import { type SectionMatrix, type Severity, TaskCheckService } from './task-check';
import { TaskLocator } from './task-locator';

/** One machine-readable reason a task is not ready, with the related WBS when there is one. */
export interface PlanningReadinessReason {
    code: string;
    message: string;
    relatedWbs?: string;
}

/** One task row in the readiness projection. */
export interface PlanningReadinessTask {
    wbs: string;
    state: 'ready' | 'blocked' | 'not-startable';
    reasons: PlanningReadinessReason[];
    nextAction: null | { kind: 'run-task'; wbs: string; command: string };
}

/** Whole readiness payload: rows, paused runs and read diagnostics. */
export interface PlanningReadiness {
    tasks: PlanningReadinessTask[];
    pausedRuns: { runId: string; wbs: string }[];
    diagnostics: { path: string; message: string }[];
}

/** Inputs the projection reads; the server context supplies them. */
export interface PlanningReadinessContext {
    fs: FileSystem;
    taskDirs: readonly string[];
    featuresDir?: string;
    matrix?: SectionMatrix;
    severityOverrides?: Record<string, Severity | 'off'>;
    runStore: Pick<RunStoreService, 'listByWbs'>;
}

/** Pin corpus reads to this operation; evidence outside the corpus keeps the existing filesystem seam. */
function snapshotFileSystem(fs: FileSystem, snapshot: PlanningSnapshot, dirs: readonly string[]): FileSystem {
    const records = [...snapshot.tasks, ...snapshot.features];
    const files = new Map(records.map((record) => [record.filePath, record.raw]));
    const folders = new Map(
        dirs.map((dir) => [dir, records.filter((r) => dirname(r.filePath) === dir).map((r) => basename(r.filePath))]),
    );
    return {
        ...fs,
        async readFile(path) {
            return files.get(fs.resolve(path)) ?? fs.readFile(path);
        },
        async readDir(path) {
            return folders.get(fs.resolve(path)) ?? fs.readDir(path);
        },
    };
}

/** Read-only daily advice from the existing snapshot, structural checker and run store. No executor port. */
export class PlanningReadinessService {
    constructor(private readonly ctx: PlanningReadinessContext) {}

    async read(input: { folder?: string } = {}): Promise<PlanningReadiness> {
        const { fs, taskDirs, featuresDir, matrix, runStore } = this.ctx;
        const result: PlanningReadiness = { tasks: [], pausedRuns: [], diagnostics: [] };
        const selected = input.folder === undefined ? undefined : fs.resolve(input.folder);
        if (selected !== undefined && !taskDirs.includes(selected)) {
            result.diagnostics.push({
                path: input.folder ?? '',
                message: 'Task folder is not configured for this project',
            });
            return result;
        }
        let snapshot: PlanningSnapshot;
        try {
            // Resolve dependencies across every registered folder before applying the display filter.
            snapshot = await readPlanningSnapshot({ fs, taskDirs, featuresDir });
        } catch (error) {
            result.diagnostics.push({
                path: error instanceof PlanningReadError ? error.path : 'planning snapshot',
                message: 'Unable to read complete planning inputs; check task and feature files',
            });
            return result;
        }
        result.diagnostics.push(...snapshot.diagnostics.map(({ path, message }) => ({ path, message })));
        const viewFs = snapshotFileSystem(fs, snapshot, [...taskDirs, ...(featuresDir ? [featuresDir] : [])]);
        const checker = matrix
            ? new TaskCheckService(viewFs, matrix, TaskLocator.forDirs(viewFs, taskDirs))
            : undefined;
        // One pass of parsed records replaces the checker's per-row sibling scan: N checks on a
        // corpus of N must not cost N*N parses (review 2026-11-06 measured 360,600 at 600 tasks).
        const childIndex = new Map<string, Array<{ wbs: string; status: string }>>();
        for (const record of snapshot.tasks) {
            const parent = (record.frontmatter.parent_wbs ?? record.frontmatter['parent-wbs']) as string | undefined;
            if (typeof parent !== 'string' || parent.length === 0 || parent === record.wbs) continue;
            const bucket = childIndex.get(parent) ?? [];
            // Match TaskCheckService.findChildren's raw status policy; normalized display
            // aliases must not change which rollup findings the existing checker reports.
            bucket.push({ wbs: record.wbs, status: (record.frontmatter.status as string) ?? 'backlog' });
            childIndex.set(parent, bucket);
        }
        const tasks = snapshot.tasks
            .filter((task) => selected === undefined || dirname(task.filePath) === selected)
            .sort((a, b) => a.wbs.localeCompare(b.wbs) || a.filePath.localeCompare(b.filePath));
        const seen = new Set<string>();
        for (const task of tasks) {
            if (seen.has(task.wbs)) continue;
            seen.add(task.wbs);
            const reasons: PlanningReadinessReason[] = [];
            if (task.status !== 'todo')
                reasons.push({ code: `status-${task.status}`, message: `Task status is ${task.status}` });
            if (!snapshot.complete)
                reasons.push({
                    code: 'incomplete-snapshot',
                    message: 'Planning inputs are ambiguous; resolve diagnostics first',
                });
            for (const dependency of task.dependencies) {
                const matches = snapshot.tasksByWbs.get(dependency) ?? [];
                if (matches.length !== 1) {
                    reasons.push({
                        code: matches.length ? 'dependency-ambiguous' : 'dependency-missing',
                        message: matches.length
                            ? `Dependency ${dependency} has multiple records`
                            : `Dependency ${dependency} is missing in configured task folders`,
                        relatedWbs: dependency,
                    });
                } else if (matches[0]?.status !== 'done') {
                    reasons.push({
                        code: 'dependency-undone',
                        message: `Dependency ${dependency} is ${matches[0]?.status}; requires done`,
                        relatedWbs: dependency,
                    });
                }
            }
            if (task.status === 'todo') {
                if (!checker)
                    reasons.push({
                        code: 'policy-unavailable',
                        message: 'Task check policy is unavailable; load the section matrix',
                    });
                else {
                    try {
                        const checked = await checker.check(task.filePath, task.wbs, {
                            asStatus: 'todo',
                            severityOverrides: this.ctx.severityOverrides,
                            childIndex,
                        });
                        for (const finding of checked.findings) {
                            if (
                                finding.severity === 'error' ||
                                checked.missingSections.includes(finding.section ?? '')
                            ) {
                                reasons.push({ code: finding.code, message: finding.message });
                            }
                        }
                    } catch {
                        reasons.push({
                            code: 'check-unavailable',
                            message: 'Unable to check task inputs; inspect linked planning records',
                        });
                    }
                }
            }
            try {
                const { links } = await runStore.listByWbs(task.wbs, RUN_STORE_WBS_MAX_LIMIT);
                if (links.length >= RUN_STORE_WBS_MAX_LIMIT)
                    reasons.push({
                        code: 'run-links-incomplete',
                        message: 'Run link page is full; paused-run coverage is incomplete',
                    });
                for (const link of links) {
                    if (!link.run)
                        reasons.push({ code: 'run-missing', message: `Linked run ${link.runId} is unavailable` });
                    if (link.run?.status === 'paused') {
                        if (!result.pausedRuns.some((run) => run.wbs === task.wbs && run.runId === link.runId))
                            result.pausedRuns.push({ runId: link.runId, wbs: task.wbs });
                        reasons.push({
                            code: 'run-paused',
                            message: `Run ${link.runId} is paused; inspect the existing run before starting work`,
                        });
                    }
                }
            } catch {
                reasons.push({
                    code: 'runs-unavailable',
                    message: 'Unable to read linked runs; paused work cannot be ruled out',
                });
            }
            const unavailable = reasons.filter((reason) =>
                [
                    'policy-unavailable',
                    'check-unavailable',
                    'run-links-incomplete',
                    'run-missing',
                    'runs-unavailable',
                ].includes(reason.code),
            );
            result.diagnostics.push(...unavailable.map((reason) => ({ path: task.filePath, message: reason.message })));
            const state =
                task.status !== 'todo' && task.status !== 'blocked'
                    ? 'not-startable'
                    : reasons.length
                      ? 'blocked'
                      : 'ready';
            result.tasks.push({
                wbs: task.wbs,
                state,
                reasons: [...new Map(reasons.map((reason) => [`${reason.code}:${reason.message}`, reason])).values()],
                nextAction:
                    state === 'ready' ? { kind: 'run-task', wbs: task.wbs, command: `/sp:dev-run ${task.wbs}` } : null,
            });
        }
        // An incomplete read cannot certify any row's recommendation in this projection.
        if (result.diagnostics.length) {
            for (const task of result.tasks) {
                if (task.state !== 'ready') continue;
                task.state = 'blocked';
                task.nextAction = null;
                task.reasons.push({
                    code: 'incomplete-inputs',
                    message: 'Readiness inputs are incomplete; resolve diagnostics first',
                });
            }
        }
        result.pausedRuns.sort((a, b) => a.wbs.localeCompare(b.wbs) || a.runId.localeCompare(b.runId));
        return result;
    }
}
