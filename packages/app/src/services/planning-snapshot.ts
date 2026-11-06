import { MarkdownDocument, normalizeTaskStatus, type TaskStatus } from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { PlanningReadError } from '../errors';
import { taskMetadata } from './task-metadata';

/** One parsed task record owned by a single operation snapshot. */
export interface PlanningTaskRecord {
    wbs: string;
    name: string;
    status: TaskStatus;
    filePath: string;
    raw: string;
    document: MarkdownDocument;
    dependencies: string[];
    featureId: string | null;
    frontmatter: Record<string, unknown>;
}

/** One parsed feature record owned by a single operation snapshot. */
export interface PlanningFeatureRecord {
    id: string;
    name: string;
    status: string;
    priority: string;
    filePath: string;
    raw: string;
    document: MarkdownDocument;
    frontmatter: Record<string, unknown>;
}

/** A duplicate identifier retained as a diagnostic instead of a map overwrite. */
export interface PlanningDiagnostic {
    code: 'duplicate-wbs' | 'duplicate-feature-id';
    path: string;
    message: string;
}

/** Complete parsed inputs for one operation only; never retained on a service instance. */
export interface PlanningSnapshot {
    tasks: PlanningTaskRecord[];
    features: PlanningFeatureRecord[];
    tasksByWbs: Map<string, PlanningTaskRecord[]>;
    tasksByFeature: Map<string, PlanningTaskRecord[]>;
    dependenciesByWbs: Map<string, string[]>;
    diagnostics: PlanningDiagnostic[];
    complete: boolean;
}

/** Refuse lifecycle derivation when duplicate identifiers make the snapshot ambiguous. */
export function assertPlanningSnapshotComplete(snapshot: PlanningSnapshot): void {
    if (snapshot.complete) return;
    const first = snapshot.diagnostics[0];
    throw new PlanningReadError(
        first?.path ?? 'planning snapshot',
        new Error(first?.message ?? 'incomplete or ambiguous planning inputs'),
    );
}

const TASK_FILE_RE = /^(\d{4})_.+\.md$/;
const FEATURE_FILE_RE = /^([A-Z][1-9]*)_(.+)\.md$/;

async function readDirIfPresent(fs: FileSystem, dir: string): Promise<string[]> {
    try {
        return await fs.readDir(dir);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw new PlanningReadError(dir, error);
    }
}

/** Parse every selected file exactly once and retain duplicates explicitly, never as map overwrites. */
export async function readPlanningSnapshot(options: {
    fs: FileSystem;
    taskDirs: readonly string[];
    featuresDir?: string;
}): Promise<PlanningSnapshot> {
    const { fs, taskDirs, featuresDir } = options;
    const tasks: PlanningTaskRecord[] = [];
    const features: PlanningFeatureRecord[] = [];
    const tasksByWbs = new Map<string, PlanningTaskRecord[]>();
    const tasksByFeature = new Map<string, PlanningTaskRecord[]>();
    const dependenciesByWbs = new Map<string, string[]>();
    const diagnostics: PlanningDiagnostic[] = [];
    const seen = new Set<string>();

    for (const dir of taskDirs) {
        for (const name of await readDirIfPresent(fs, dir)) {
            const match = TASK_FILE_RE.exec(name);
            const wbs = match?.[1];
            if (!wbs) continue;
            const filePath = `${dir}/${name}`;
            if (seen.has(filePath)) continue;
            seen.add(filePath);
            let raw: string;
            let document: MarkdownDocument;
            try {
                raw = await fs.readFile(filePath);
                document = MarkdownDocument.parse(raw, 'task');
            } catch (error) {
                throw new PlanningReadError(filePath, error);
            }
            const frontmatter = (document.frontmatterData ?? {}) as Record<string, unknown>;
            const { status, featureId } = taskMetadata(frontmatter);
            const dependencies = Array.isArray(frontmatter.dependencies)
                ? frontmatter.dependencies.filter((dep): dep is string => typeof dep === 'string')
                : [];
            const record: PlanningTaskRecord = {
                wbs,
                name: (frontmatter.name as string | undefined) ?? name,
                status: normalizeTaskStatus(status),
                filePath,
                raw,
                document,
                dependencies,
                featureId: featureId ?? null,
                frontmatter,
            };
            tasks.push(record);
            tasksByWbs.set(wbs, [...(tasksByWbs.get(wbs) ?? []), record]);
            if (tasksByWbs.get(wbs)?.length === 2) {
                diagnostics.push({
                    code: 'duplicate-wbs',
                    path: filePath,
                    message: `duplicate WBS ${wbs} appears in more than one registered task folder`,
                });
            }
            dependenciesByWbs.set(wbs, [...new Set([...(dependenciesByWbs.get(wbs) ?? []), ...dependencies])]);
            if (featureId !== null) tasksByFeature.set(featureId, [...(tasksByFeature.get(featureId) ?? []), record]);
        }
    }

    if (featuresDir !== undefined) {
        for (const name of await readDirIfPresent(fs, featuresDir)) {
            const match = FEATURE_FILE_RE.exec(name);
            const id = match?.[1];
            if (!id) continue;
            const filePath = `${featuresDir}/${name}`;
            if (seen.has(filePath)) continue;
            seen.add(filePath);
            let raw: string;
            let document: MarkdownDocument;
            try {
                raw = await fs.readFile(filePath);
                document = MarkdownDocument.parse(raw, 'feature');
            } catch (error) {
                throw new PlanningReadError(filePath, error);
            }
            const frontmatter = (document.frontmatterData ?? {}) as Record<string, unknown>;
            const feature: PlanningFeatureRecord = {
                id,
                name: (frontmatter.name as string | undefined) ?? match[2] ?? id,
                status: (frontmatter.status as string | undefined) ?? 'backlog',
                priority: (frontmatter.priority as string | undefined) ?? 'P2',
                filePath,
                raw,
                document,
                frontmatter,
            };
            features.push(feature);
            const duplicates = features.filter((candidate) => candidate.id === id);
            if (duplicates.length === 2) {
                diagnostics.push({
                    code: 'duplicate-feature-id',
                    path: filePath,
                    message: `duplicate feature id ${id} appears in more than one feature file`,
                });
            }
        }
    }

    return {
        tasks,
        features,
        tasksByWbs,
        tasksByFeature,
        dependenciesByWbs,
        diagnostics,
        complete: diagnostics.length === 0,
    };
}
