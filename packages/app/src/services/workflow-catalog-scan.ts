import { lstat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createNodeFileSystem, parseYamlObject } from '@gobing-ai/ts-runtime';
import type { WorkflowLayerId } from '../workflow/workflow-resolver';
import type { WorkflowListEntry } from './workflow-service';

/**
 * Walk a directory (following symlinks) for .yaml/.yml files and extract name + kind.
 * Gracefully skips unparseable files (adds them with valid=false + error message).
 */
/**
 * Per-file identity payload for `list`, produced by the shared resolver (0768 R1).
 */
export type WorkflowListEntryIdentity = Pick<WorkflowListEntry, 'name' | 'kind' | 'valid' | 'description'> &
    Partial<Pick<WorkflowListEntry, 'error' | 'version' | 'definitionDigest'>>;

/**
 * Newest file mtime in a subtree (symlinks not followed; an empty dir uses its own mtime);
 * `null` when it contains a git worktree (`.git`).
 */
export async function newestMtime(path: string): Promise<number | null> {
    const st = await lstat(path);
    if (!st.isDirectory()) return st.mtimeMs;
    const names = await readdir(path);
    let newest = names.length === 0 ? st.mtimeMs : 0;
    for (const name of names) {
        if (name === '.git') return null;
        const child = await newestMtime(join(path, name));
        if (child === null) return null;
        newest = Math.max(newest, child);
    }
    return newest;
}

/** Recursively collect workflow definition files under `rootPath` for the catalog. */
export async function scanWorkflowFiles(
    rootPath: string,
    source: WorkflowLayerId,
    loadEntry: (filePath: string) => Promise<WorkflowListEntryIdentity>,
): Promise<WorkflowListEntry[]> {
    const entries: WorkflowListEntry[] = [];
    const fs = createNodeFileSystem();

    const rootStat = await fs.stat(rootPath);
    if (!rootStat?.isDirectory()) {
        return entries;
    }

    const realPath = fs.realPath ? await fs.realPath(rootPath) : rootPath;

    async function walk(dirPath: string): Promise<void> {
        const names = await fs.readDir(dirPath);
        for (const name of names) {
            const fullPath = resolve(dirPath, name);
            const st = await fs.stat(fullPath);
            if (!st) continue;
            if (st.isDirectory()) {
                await walk(fullPath);
            } else if (st.isFile() && (name.endsWith('.yaml') || name.endsWith('.yml'))) {
                const displayPath = fullPath.startsWith(rootPath) ? fullPath.slice(rootPath.length + 1) : fullPath;
                const entry = await loadEntry(fullPath);
                entries.push({ ...entry, path: displayPath, source });
            }
        }
    }

    await walk(realPath);
    return entries;
}

/** Parse a workflow YAML file to extract name and kind. Returns partial entry on failure. */
export async function extractWorkflowMeta(
    filePath: string,
): Promise<Pick<WorkflowListEntry, 'name' | 'kind' | 'valid' | 'error' | 'description'>> {
    try {
        const fs = createNodeFileSystem();
        const text = await fs.readFile(filePath);
        const parsed = parseYamlObject(text);
        if (typeof parsed !== 'object' || parsed === null) {
            return {
                name: '<unparseable>',
                kind: 'unknown',
                valid: false,
                error: 'Top-level value is not an object',
                description: null,
            };
        }
        const obj = parsed as Record<string, unknown>;
        const wfName = obj.name;
        const wfKind = obj.kind;
        if (typeof wfName !== 'string' || wfName.length === 0) {
            return {
                name: '<unnamed>',
                kind: typeof wfKind === 'string' ? wfKind : 'state-machine',
                valid: false,
                error: 'Missing or empty "name" field',
                description: null,
            };
        }
        return {
            name: wfName,
            kind: typeof wfKind === 'string' ? wfKind : 'state-machine',
            valid: true,
            description: null,
        };
    } catch (err) {
        return {
            name: '<unparseable>',
            kind: 'unknown',
            valid: false,
            error: err instanceof Error ? err.message : String(err),
            description: null,
        };
    }
}
