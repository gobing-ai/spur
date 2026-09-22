/**
 * Task 0797 / ADR-111: safely flip one existing executor's `disabled` flag.
 * Narrower than config loading by design — the updater mutates ONLY the existing
 * `agent.executors[<name>]` entry via the yaml document model (comments, ordering,
 * unrelated values and file mode survive), never serializes merged config,
 * never creates paths or overrides. Since 0891 it spans both layers: a `global`
 * write targets the layer that actually declares the executor (project fragment
 * wins); project writes stay project-scoped.
 */

import { chmod, lstat, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { isAlias, isMap, isScalar, isSeq, parseDocument, type YAMLMap } from 'yaml';
import { invalidateSpurConfig, resolveConfigLayers } from './loader';
import { isRfc3339Timestamp } from './rfc3339';

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

/** Result of {@link setExecutorAvailability} — `updated`, or a structured no-op with the reason. */
export type SetExecutorAvailabilityResult =
    | { status: 'updated' }
    | { status: 'unchanged'; reason: 'already-set' | 'missing-file' | 'missing-executors' | 'missing-executor' };

/** Config layer an availability write targets (B6 0891 R1). */
export type ExecutorConfigLayer = 'project' | 'global';

/** Request shape for {@link setExecutorAvailability}. */
export interface SetExecutorAvailabilityRequest {
    /** Requested layer; the actual target is where the executor is declared — a project fragment wins when both layers declare the name (B6 0891 R1). */
    layer: ExecutorConfigLayer;
    /** Project root used for project-path resolution and layer discovery. */
    projectRoot: string;
    /** Exact executor entry name — the updater never creates entries. */
    executor: string;
    /** `false` for a recovery, or an {@link ExecutorDisabledUpdate} object for an automatic disable. */
    disabled: boolean | ExecutorDisabledUpdate;
}

/**
 * Ownership object an AUTOMATIC caller writes for a disable (B6 0890 R2).
 * `operator` is human-only — bare booleans — and never valid here.
 */
export interface ExecutorDisabledUpdate {
    owner: 'quota' | 'probe';
    /** RFC 3339 timestamp carried from the observation. */
    since: string;
    /** Cause label, e.g. `agent.quota.exhausted <executor>`. */
    reason: string;
}

const LOCK_RETRY_MS = 50;
const LOCK_MAX_ATTEMPTS = 40;

/**
 * Flip `agent.executors[<exact name>].disabled` in the layer where the executor is
 * declared (B6 0891 R1): `layer: 'project'` targets the project fragment only;
 * `layer: 'global'` targets the global file (`~/.config/spur/config.yaml`, per the
 * loader's path resolution) unless a project fragment also declares the name —
 * the project layer wins when both declare it. Global writes ride the identical
 * backup/atomic-rename/conflict-detection path (B6 0891 R2); the untouched layer's
 * file is left byte-identical.
 *
 * Errors are the {@link ExecutorUpdateError} codes documented on
 * {@link applyExecutorAvailabilityAtPath}; a missing target is a structured no-op,
 * never a created file.
 */
export async function setExecutorAvailability(
    request: SetExecutorAvailabilityRequest,
): Promise<SetExecutorAvailabilityResult> {
    if (request.executor.length === 0) {
        throw new ExecutorUpdateError('INVALID_CONFIG', 'executor name must be a non-empty string');
    }
    assertDisabledArgument(request.disabled);
    const projectPath = join(request.projectRoot, '.spur', 'config.yaml');
    let targetPath: string;
    if (request.layer === 'project') {
        targetPath = projectPath;
    } else {
        // Explicit `cwd` keeps the project layer even under SPUR_SKIP_PROJECT_CONFIG
        // (0817); SPUR_SKIP_GLOBAL_CONFIG suppresses the global layer (hermetic tests).
        const layers = resolveConfigLayers(request.projectRoot);
        if (layers.project !== undefined && (await declaresExecutor(layers.project, request.executor))) {
            targetPath = layers.project;
        } else if (layers.global !== undefined) {
            targetPath = layers.global;
        } else if (layers.project !== undefined) {
            // Global suppressed/absent and the name is not declared in the project layer.
            return { status: 'unchanged', reason: 'missing-executor' };
        } else {
            return { status: 'unchanged', reason: 'missing-file' };
        }
    }
    return applyExecutorAvailabilityAtPath(targetPath, request.executor, request.disabled);
}

/**
 * Read all executor names declared under `agent.executors` in a config file.
 * Returns an empty set if the file does not exist, is invalid YAML, or lacks executors.
 */
export async function getDeclaredExecutorNames(configPath: string): Promise<Set<string>> {
    let content: string;
    try {
        content = await readFile(configPath, 'utf8');
    } catch {
        return new Set();
    }
    const doc = parseDocument(content);
    if (doc.errors.length > 0) return new Set();
    const executors = doc.get('agent');
    if (!isMap(executors)) return new Set();
    const seq = executors.get('executors');
    if (!isSeq(seq)) return new Set();
    const names = new Set<string>();
    for (const item of seq.items) {
        if (isAlias(item) || !isMap(item)) continue;
        const nameNode = item.get('name', true);
        if (isScalar(nameNode) && typeof nameNode.value === 'string' && nameNode.value.length > 0) {
            names.add(nameNode.value);
        }
    }
    return names;
}

/**
 * Cheap declaration probe: does this config file's `agent.executors` sequence name
 * `executorName`? Parse errors surface to the caller only when this layer becomes
 * the write target; a broken OTHER layer must not block a legitimate global write.
 */
export async function declaresExecutor(configPath: string, executorName: string): Promise<boolean> {
    const names = await getDeclaredExecutorNames(configPath);
    return names.has(executorName);
}

/**
 * Shared write core for both layers: mutate ONLY the existing
 * `agent.executors[<name>]` entry via the yaml document model (comments, ordering,
 * unrelated values and file mode survive), under a per-path lock with external-edit
 * conflict detection, committed by atomic rename, then cache-invalidated.
 *
 * Errors: `INVALID_CONFIG` (malformed / ambiguous YAML, symlinked config, bad
 * arguments), `CONFIG_CONFLICT` (the file changed underneath the read-modify-write),
 * `CONFIG_WRITE_FAILED` (lock or atomic write failure).
 */
async function applyExecutorAvailabilityAtPath(
    configPath: string,
    executorName: string,
    disabled: boolean | ExecutorDisabledUpdate,
): Promise<SetExecutorAvailabilityResult> {
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
            `config is a symlink — refusing to edit through it: ${configPath}`,
        );
    }

    return withLock(`${configPath}.lock`, async () => {
        const content = await readFile(configPath, 'utf8');
        const baseline = await stat(configPath);

        const doc = parseDocument(content);
        if (doc.errors.length > 0) {
            throw new ExecutorUpdateError(
                'INVALID_CONFIG',
                `config is not valid YAML: ${doc.errors[0]?.message ?? 'unknown parse error'}`,
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
                    `duplicate executor name "${name}" in config — ambiguous update target`,
                );
            }
            seen.set(name, item);
            if (name === executorName) target = item;
        }
        if (target === undefined) return { status: 'unchanged', reason: 'missing-executor' };

        const current = target.get('disabled', true);
        if (disabledMatches(current, disabled)) {
            return { status: 'unchanged', reason: 'already-set' };
        }
        target.set(
            'disabled',
            typeof disabled === 'boolean'
                ? disabled
                : { owner: disabled.owner, since: disabled.since, reason: disabled.reason },
        );

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
                    `config changed on disk while the update was prepared — re-run to reapply: ${configPath}`,
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
                `failed to commit config update: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        invalidateSpurConfig(configPath);
        return { status: 'updated' };
    });
}

/** Validate the `disabled` argument (B6 0890 R2): boolean, or quota/probe ownership object. */
function assertDisabledArgument(disabled: boolean | ExecutorDisabledUpdate): void {
    if (typeof disabled === 'boolean') return;
    if (disabled.owner !== 'quota' && disabled.owner !== 'probe') {
        throw new ExecutorUpdateError(
            'INVALID_CONFIG',
            `disabled.owner must be "quota" or "probe", received ${JSON.stringify(disabled.owner)}`,
        );
    }
    if (typeof disabled.since !== 'string' || !isRfc3339Timestamp(disabled.since)) {
        throw new ExecutorUpdateError('INVALID_CONFIG', 'disabled.since must be an RFC 3339 timestamp string');
    }
    if (typeof disabled.reason !== 'string' || disabled.reason.length === 0) {
        throw new ExecutorUpdateError('INVALID_CONFIG', 'disabled.reason must be a non-empty string');
    }
}

/** Byte-stable no-op test (B6 0890 R2): scalar equality for booleans, field equality for objects. */
function disabledMatches(current: unknown, desired: boolean | ExecutorDisabledUpdate): boolean {
    if (typeof desired === 'boolean') {
        return current !== undefined && isScalar(current) && current.value === desired;
    }
    if (current === undefined || !isMap(current)) return false;
    return (
        current.get('owner') === desired.owner &&
        current.get('since') === desired.since &&
        current.get('reason') === desired.reason
    );
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
