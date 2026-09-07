/**
 * Task 0797 / ADR-111: safely flip one existing project executor's `disabled`
 * flag. Narrower than config loading by design — the updater mutates ONLY the
 * existing project entry via the yaml document model (comments, ordering,
 * unrelated values and file mode survive), never serializes merged config,
 * never creates paths or overrides, and never touches the global layer.
 */

import { chmod, lstat, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { isAlias, isMap, isScalar, isSeq, parseDocument, type YAMLMap } from 'yaml';
import { invalidateSpurConfig } from './loader';

/** Stable rejection codes for {@link ExecutorUpdateError}; callers branch on these, never on prose. */
export type ExecutorUpdateErrorCode = 'INVALID_CONFIG' | 'CONFIG_CONFLICT' | 'CONFIG_WRITE_FAILED';

/** Rejection reasons carry a stable code so callers can branch without parsing prose. */
export class ExecutorUpdateError extends Error {
    constructor(
        readonly code: ExecutorUpdateErrorCode,
        message: string,
    ) {
        super(message);
        this.name = 'ExecutorUpdateError';
    }
}

/** Outcome of {@link setProjectExecutorDisabled}: `updated`, or a structured no-op with the reason. */
export type SetProjectExecutorDisabledResult =
    | { status: 'updated' }
    | { status: 'unchanged'; reason: 'already-set' | 'missing-file' | 'missing-executors' | 'missing-executor' };

const LOCK_RETRY_MS = 50;
const LOCK_MAX_ATTEMPTS = 40;

/**
 * Flip `agent.executors[<exact name>].disabled` in `<projectRoot>/.spur/config.yaml`.
 *
 * Absent attribute is written explicitly (an absent flag inherits, stored false does
 * not); an already-matching explicit value is a byte-stable no-op. Missing targets
 * return a structured no-op — nothing is created. Errors: `INVALID_CONFIG` (malformed
 * / ambiguous YAML, symlinked config, broken effective config, bad arguments),
 * `CONFIG_CONFLICT` (the file changed underneath the read-modify-write),
 * `CONFIG_WRITE_FAILED` (lock or atomic write failure).
 */
export async function setProjectExecutorDisabled(
    projectRoot: string,
    executorName: string,
    disabled: boolean,
): Promise<SetProjectExecutorDisabledResult> {
    if (executorName.length === 0) {
        throw new ExecutorUpdateError('INVALID_CONFIG', 'executor name must be a non-empty string');
    }
    if (typeof disabled !== 'boolean') {
        throw new ExecutorUpdateError('INVALID_CONFIG', `disabled must be a boolean, received ${typeof disabled}`);
    }
    const configPath = join(projectRoot, '.spur', 'config.yaml');

    let original: Awaited<ReturnType<typeof stat>>;
    try {
        original = await stat(configPath);
    } catch {
        return { status: 'unchanged', reason: 'missing-file' };
    }
    const link = await lstat(configPath);
    if (link.isSymbolicLink()) {
        throw new ExecutorUpdateError(
            'INVALID_CONFIG',
            `project config is a symlink — refusing to edit through it: ${configPath}`,
        );
    }

    return withLock(`${configPath}.lock`, async () => {
        const content = await readFile(configPath, 'utf8');
        const baseline = await stat(configPath);

        const doc = parseDocument(content);
        if (doc.errors.length > 0) {
            throw new ExecutorUpdateError(
                'INVALID_CONFIG',
                `project config is not valid YAML: ${doc.errors[0]?.message ?? 'unknown parse error'}`,
            );
        }
        const agent = doc.get('agent');
        if (!isMap(agent)) return { status: 'unchanged', reason: 'missing-executors' };
        const executors = agent.get('executors');
        if (!isSeq(executors)) return { status: 'unchanged', reason: 'missing-executors' };

        let target: YAMLMap | undefined;
        const seen = new Map<string, YAMLMap>();
        for (const item of executors.items) {
            if (isAlias(item) || !isMap(item)) {
                throw new ExecutorUpdateError(
                    'INVALID_CONFIG',
                    'executor entries must be inline mappings — aliases and merge keys are not supported by the updater',
                );
            }
            for (const pair of item.items) {
                if (isScalar(pair.key) && String(pair.key.value) === '<<') {
                    throw new ExecutorUpdateError(
                        'INVALID_CONFIG',
                        'merge keys in executor entries are not supported by the updater — flatten the entry first',
                    );
                }
            }
            const nameNode = item.get('name', true);
            if (!isScalar(nameNode) || typeof nameNode.value !== 'string' || nameNode.value.length === 0) continue;
            const name = nameNode.value;
            const prior = seen.get(name);
            if (prior !== undefined) {
                throw new ExecutorUpdateError(
                    'INVALID_CONFIG',
                    `duplicate executor name "${name}" in project config — ambiguous update target`,
                );
            }
            seen.set(name, item);
            if (name === executorName) target = item;
        }
        if (target === undefined) return { status: 'unchanged', reason: 'missing-executor' };

        const current = target.get('disabled', true);
        if (current !== undefined && isScalar(current) && current.value === disabled) {
            return { status: 'unchanged', reason: 'already-set' };
        }
        target.set('disabled', disabled);

        // Validation lives at the document level (parse + entry shapes above): a
        // name-only project fragment is a legitimate update target (0797 R1), so a
        // full effective-config load must not gate the write. The write touches the
        // project document alone.

        const serialized = String(doc);
        const tmpPath = join(dirname(configPath), `.${basename(configPath)}.tmp-${process.pid}`);
        try {
            // External editors do not honor our lock — detect their changes before commit.
            const latest = await stat(configPath);
            if (latest.mtimeMs !== baseline.mtimeMs || latest.size !== baseline.size || latest.ino !== baseline.ino) {
                throw new ExecutorUpdateError(
                    'CONFIG_CONFLICT',
                    `project config changed on disk while the update was prepared — re-run to reapply: ${configPath}`,
                );
            }
            const tmp = await open(tmpPath, 'wx', original.mode & 0o777);
            try {
                await tmp.writeFile(serialized, 'utf8');
                await tmp.sync();
            } finally {
                await tmp.close();
            }
            await rename(tmpPath, configPath);
            await chmod(configPath, original.mode & 0o777);
        } catch (error) {
            try {
                await unlink(tmpPath);
            } catch {
                // temp cleanup is best-effort — never mask the primary failure
            }
            if (error instanceof ExecutorUpdateError) throw error;
            throw new ExecutorUpdateError(
                'CONFIG_WRITE_FAILED',
                `failed to commit project config update: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        invalidateSpurConfig(configPath);
        return { status: 'updated' };
    });
}

/** Exclusive per-path lock. Recovers a lock only when its owner is confirmed dead. */
async function withLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
    let holder: Awaited<ReturnType<typeof open>> | undefined;
    for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS && holder === undefined; attempt++) {
        try {
            holder = await open(lockPath, 'wx');
        } catch {
            const reclaimed = await reclaimIfDead(lockPath);
            if (!reclaimed) {
                if (attempt === LOCK_MAX_ATTEMPTS - 1) {
                    throw new ExecutorUpdateError(
                        'CONFIG_WRITE_FAILED',
                        `config update lock is held by a live process: ${lockPath}`,
                    );
                }
                await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
            }
        }
    }
    if (holder === undefined) {
        throw new ExecutorUpdateError('CONFIG_WRITE_FAILED', `could not acquire config update lock: ${lockPath}`);
    }
    try {
        await holder.writeFile(String(process.pid), 'utf8');
        return await fn();
    } finally {
        await holder.close();
        try {
            await unlink(lockPath);
        } catch {
            // lock release is best-effort — reclaimIfDead handles stale leftovers
        }
    }
}

async function reclaimIfDead(lockPath: string): Promise<boolean> {
    let pid: number;
    try {
        pid = Number.parseInt(await readFile(lockPath, 'utf8'), 10);
    } catch {
        return false; // unreadable lock — not confirmed dead, wait it out
    }
    if (!Number.isFinite(pid)) return false;
    try {
        process.kill(pid, 0);
        return false; // owner alive — never reclaim a live lock
    } catch {
        await unlink(lockPath).catch(() => {});
        return true; // ESRCH — owner confirmed dead
    }
}
