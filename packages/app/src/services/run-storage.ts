/**
 * Run-storage layout and one-shot scratch migration (feature E71, task 1025).
 *
 * Layout: `.spur/run` remains the live scratch plane — session sidecar latches,
 * check receipts and other recomputable scratch keep landing there. Closed-run
 * records, agent sessions, run artifacts and durable evidence accumulate under
 * `.spur/memory/` (`runs/`, `evidence/`; task 1026 R1–R4). Consumers resolve
 * reads from the durable plane first and fall back to scratch, so migration is a
 * byte copy: sources are NEVER removed (a migrated source is "preserved
 * after copy"). Everything here is plain functions over node:fs — no config,
 * no classes, no pluggable backends.
 *
 * Migration semantics (fail-closed):
 * - dry-run ⇒ zero writes; every processable unit reports `would-migrate`.
 * - applied ⇒ atomic byte copy (temp sibling + rename), reread + digest
 *   compare, then the entry is recorded in the manifest.
 * - an existing identical target ⇒ `already-present` (idempotent, no rewrite).
 * - an existing target with a different digest ⇒ `failed`/`target-mismatch`;
 *   the target is never overwritten.
 * - unparseable JSON sources ⇒ `failed`/`malformed`.
 * - a run-record pair missing its required sibling file ⇒ `failed`/
 *   `missing-required-item` (and lands in `failures[]`).
 * - units owned by an active/paused/interrupted-recoverable run, and
 *   unknown/unowned scratch paths, are `preserved` — never migrated, never
 *   deleted. Closed runs' records, logs, sessions and artifacts migrate (1026
 *   R4); other legacy scratch files (check receipts, …) are preserved.
 */

import { createHash } from 'node:crypto';
import {
    appendFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { resolveDurableArtifactPath, resolveRunArtifactPath } from '../workflow/actions/run-path';
import { InvalidWorkflowRunIdError } from '../workflow/run-record';

/** Resolved run-storage layout for one project root. */
export interface RunStoragePaths {
    /** Nearest ancestor of `cwd` holding `.spur` or `package.json`. */
    projectRoot: string;
    /** Live scratch plane: `<projectRoot>/.spur/run`. */
    scratchDir: string;
    /** Durable task-verdict / feature-receipt evidence: `<projectRoot>/.spur/memory/evidence`. */
    evidenceDir: string;
    /** Durable closed-run records: `<projectRoot>/.spur/memory/runs`. */
    recordsDir: string;
}

/** Resolve the run-storage layout against the nearest project root. */
export function runStoragePaths(cwd: string): RunStoragePaths {
    const projectRoot = resolveRunStorageRoot(cwd);
    return {
        projectRoot,
        scratchDir: join(projectRoot, '.spur', 'run'),
        evidenceDir: join(projectRoot, '.spur', 'memory', 'evidence'),
        recordsDir: join(projectRoot, '.spur', 'memory', 'runs'),
    };
}

/** Nearest ancestor of `cwd` with a `.spur` dir or `package.json`; `cwd` itself is the fallback. */
function resolveRunStorageRoot(cwd: string): string {
    let current = resolve(cwd);
    for (;;) {
        if (existsSync(join(current, '.spur')) || existsSync(join(current, 'package.json'))) {
            return current;
        }
        const parent = resolve(current, '..');
        if (parent === current) return resolve(cwd);
        current = parent;
    }
}

// ─── Migration ─────────────────────────────────────────────────────────

/** Evidence families carried by the migration. */
export type RunStorageFamily = 'task-verdict' | 'feature-receipt' | 'run-record';

/** Per-unit migration outcome. */
export type RunStorageOutcome = 'would-migrate' | 'migrated' | 'already-present' | 'preserved' | 'failed';

/** One migrated (or explicitly preserved/failed) scratch unit. */
export interface RunStorageMigrationEntry {
    source: string;
    /** Intended absolute target; null for unknown/unowned scratch paths. */
    target: string | null;
    /** Evidence family; null for unknown/unowned scratch paths. */
    family: RunStorageFamily | null;
    /** Owning id (wbs / featureId / runId) when known. */
    identity: string | null;
    /** sha-256 of the source bytes. */
    contentDigest: string;
    outcome: RunStorageOutcome;
    reason?: string;
}

/** Hard failure that blocks the destructive-housekeeping contract. */
export interface RunStorageFailure {
    source: string;
    reason: string;
}

/** Result of {@link migrateRunStorage}. */
export interface RunStorageMigrationResult {
    dryRun: boolean;
    logsOnly: boolean;
    entries: RunStorageMigrationEntry[];
    failures: RunStorageFailure[];
}

/** Migration inputs. `readRunStatus` returns a run row status, or null when the run is unknown. */
export interface MigrateRunStorageInput {
    dirs: RunStoragePaths;
    readRunStatus: (runId: string) => Promise<string | null>;
    dryRun?: boolean;
    logsOnly?: boolean;
    /** Test seam: replaces the atomic byte copy. Throw to simulate a write failure. */
    atomicCopy?: (source: string, target: string) => void;
    /** Test seam: manifest timestamp. */
    now?: () => string;
}

/** Run statuses whose scratch files must be preserved (owner still live or rerun-resumable). */
const LIVE_RUN_STATUSES = new Set(['running', 'pending', 'paused', 'interrupted']);

/** sha-256 hex digest of one file's bytes. */
function fileDigest(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Atomic byte copy: write the temp sibling, rename, then reread and verify the digest. */
function defaultAtomicCopy(source: string, target: string): void {
    const bytes = readFileSync(source);
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, target);
    if (fileDigest(target) !== createHash('sha256').update(bytes).digest('hex')) {
        throw new Error('copy-mismatch: renamed target digest differs from the source');
    }
}

/** One classified scratch unit: a verdict, a receipt copy, or a run-record pair. */
interface ScratchUnit {
    family: RunStorageFamily;
    identity: string;
    files: string[];
    /** JSON families must parse as objects before anything may be written. */
    requiresJsonParse: boolean;
    /** When set, the unit is preserved unless this run exists and is terminal. */
    ownerRunId?: string;
    /** Absolute path of the missing `.md`/`.state.json` sibling, for incomplete run records. */
    missingRequiredItem?: string;
}

interface Classified {
    unit?: ScratchUnit;
    entry?: RunStorageMigrationEntry;
}

/** Parse a JSON scratch file; null when unparseable or not a plain object. */
function parseJsonObject(path: string): Record<string, unknown> | null {
    try {
        const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        return parsed as Record<string, unknown>;
    } catch {
        return null;
    }
}

/** Run-record unit; a missing `.md`/`.state.json` sibling is only fatal when the run row exists. */
function runRecordUnit(recordId: string, files: string[], missing?: string): ScratchUnit {
    return {
        family: 'run-record',
        identity: recordId,
        files,
        requiresJsonParse: false,
        ownerRunId: recordId,
        ...(missing === undefined ? {} : { missingRequiredItem: missing }),
    };
}

/** Classify one scratch file into a unit, a standalone preserved/failed entry, or a skip. */
function classify(name: string, scratchDir: string, files: Set<string>): Classified {
    const source = join(scratchDir, name);

    // 1026 R4: a file under a run's scratch subtree (`<runId>/agent-sessions/**`,
    // `<runId>/artifacts/**`) migrates under its subpath with owner protection.
    if (name.includes(sep)) {
        const identity = name.slice(0, name.indexOf(sep));
        return {
            unit: {
                family: 'run-record',
                identity,
                files: [source],
                requiresJsonParse: name.endsWith('.json'),
                ...(identity !== '' ? { ownerRunId: identity } : {}),
            },
        };
    }

    // Feature receipts — run-scoped `<runId>-feature-verification.json` and feature-latest
    // `<featureId>-feature-verification.json`. Checked before the verdict suffix so the
    // longer name never misparses as `<wbs>-verdict.json`.
    if (name.endsWith('-feature-verification.json')) {
        const prefix = name.slice(0, -'-feature-verification.json'.length);
        const parsed = parseJsonObject(source);
        if (parsed === null) {
            return {
                entry: {
                    source,
                    target: null,
                    family: 'feature-receipt',
                    identity: prefix,
                    contentDigest: fileDigest(source),
                    outcome: 'failed',
                    reason: 'malformed',
                },
            };
        }
        const runId = typeof parsed.runId === 'string' ? parsed.runId : '';
        const runScoped = runId !== '' && runId === prefix;
        const featureId = typeof parsed.featureId === 'string' && parsed.featureId !== '' ? parsed.featureId : prefix;
        return {
            unit: {
                family: 'feature-receipt',
                identity: featureId,
                files: [source],
                requiresJsonParse: true,
                ...(runScoped ? { ownerRunId: runId } : {}),
            },
        };
    }

    if (name.endsWith('-verdict.json')) {
        return {
            unit: {
                family: 'task-verdict',
                identity: name.slice(0, -'-verdict.json'.length),
                files: [source],
                requiresJsonParse: true,
            },
        };
    }

    // Two-file run record (`<runId>.md` + `<runId>.state.json`), processed from the `.md` side.
    if (name.endsWith('.state.json')) {
        const recordId = name.slice(0, -'.state.json'.length);
        if (files.has(`${recordId}.md`)) return {}; // handled together with its `.md` sibling
        return {
            unit: runRecordUnit(recordId, [source], join(scratchDir, `${recordId}.md`)),
        };
    }
    if (name.endsWith('.md')) {
        const recordId = name.slice(0, -'.md'.length);
        if (files.has(`${recordId}.state.json`)) {
            return {
                unit: runRecordUnit(recordId, [source, join(scratchDir, `${recordId}.state.json`)]),
            };
        }
        return { unit: runRecordUnit(recordId, [source], join(scratchDir, `${recordId}.state.json`)) };
    }

    // Legacy retained run log `<runId>.log` (1026 R4): migrates like a record file,
    // with owner protection; unknown-owner logs stay preserved via the owner gate.
    if (name.endsWith('.log')) {
        const recordId = name.slice(0, -'.log'.length);
        return {
            unit: {
                family: 'run-record',
                identity: recordId,
                files: [source],
                requiresJsonParse: false,
                ...(recordId !== '' ? { ownerRunId: recordId } : {}),
            },
        };
    }

    // Unknown/unowned scratch path (check receipts, status files, …).
    return {
        entry: {
            source,
            target: null,
            family: null,
            identity: null,
            contentDigest: fileDigest(source),
            outcome: 'preserved',
        },
    };
}

/** True when the owner run is live/paused/interrupted-recoverable or the row is unknown. */
async function ownerPreserved(readRunStatus: MigrateRunStorageInput['readRunStatus'], runId: string): Promise<boolean> {
    const status = await readRunStatus(runId);
    return (
        status === null ||
        status === undefined ||
        LIVE_RUN_STATUSES.has(status) ||
        !['done', 'failed', 'cancelled'].includes(status)
    );
}

/** Manifest for applied runs only: `<projectRoot>/.spur/memory/run-storage-migration.json`. */
function writeManifest(
    dirs: RunStoragePaths,
    entries: RunStorageMigrationEntry[],
    now: () => string,
): RunStorageFailure | undefined {
    const manifestPath = join(dirs.projectRoot, '.spur', 'memory', 'run-storage-migration.json');
    try {
        mkdirSync(join(dirs.projectRoot, '.spur', 'memory'), { recursive: true });
        const body = `${JSON.stringify({ version: 1, updatedAt: now(), entries }, null, 4)}\n`;
        const tmp = `${manifestPath}.tmp`;
        writeFileSync(tmp, body);
        renameSync(tmp, manifestPath);
        return undefined;
    } catch (err) {
        return { source: manifestPath, reason: `manifest-write: ${(err as Error).message}` };
    }
}

/**
 * Migrate durable evidence out of the scratch plane. Dry-run writes nothing;
 * applied runs byte-copy units into the fixed evidence/records dirs, never
 * delete anything, and record applied outcomes in the manifest. Every `failed`
 * entry also lands in `failures[]` so callers can exit nonzero.
 */
export async function migrateRunStorage(input: MigrateRunStorageInput): Promise<RunStorageMigrationResult> {
    const { dirs, readRunStatus } = input;
    const dryRun = input.dryRun === true;
    const logsOnly = input.logsOnly === true;
    const atomicCopy = input.atomicCopy ?? defaultAtomicCopy;
    const now = input.now ?? (() => new Date().toISOString());
    const result: RunStorageMigrationResult = { dryRun, logsOnly, entries: [], failures: [] };
    const fs = createNodeFileSystem(dirs.projectRoot);

    let names: string[];
    try {
        await resolveRunArtifactPath(fs, dirs.projectRoot, join(dirs.scratchDir, 'migration-probe'));
        const dirents = readdirSync(dirs.scratchDir, { withFileTypes: true });
        names = dirents.filter((item) => item.isFile()).map((item) => item.name);
        // 1026 R4: run subtrees (`<runId>/agent-sessions/**`, `<runId>/artifacts/**`)
        // join the plan as per-file units; other scratch subdirectories stay unowned.
        for (const item of dirents) {
            if (!item.isDirectory()) continue;
            const subtree = join(dirs.scratchDir, item.name);
            if (!existsSync(join(subtree, 'agent-sessions')) && !existsSync(join(subtree, 'artifacts'))) continue;
            const walk = (dir: string): void => {
                for (const entry of readdirSync(dir, { withFileTypes: true })) {
                    if (entry.isDirectory()) walk(join(dir, entry.name));
                    else if (entry.isFile()) names.push(relative(dirs.scratchDir, join(dir, entry.name)));
                }
            };
            walk(subtree);
        }
    } catch (error) {
        if ((error as { code?: string }).code !== 'ENOENT') {
            result.failures.push({ source: dirs.scratchDir, reason: String(error) });
        }
        return result;
    }
    const fileSet = new Set(names);

    // 1026: durable copies must not shift the proof-input tree — exclude the plane repo-locally first.
    if (!dryRun) ensureDurablePlaneIgnored(dirs.projectRoot);
    for (const name of names) {
        // Logs-only never touches verdicts, receipts, record pairs, sessions or artifacts.
        if (logsOnly && (name.includes(sep) || !name.endsWith('.log'))) continue;
        const { unit, entry: standalone } = classify(name, dirs.scratchDir, fileSet);
        if (standalone !== undefined) {
            result.entries.push(standalone);
            if (standalone.outcome === 'failed') {
                result.failures.push({ source: standalone.source, reason: standalone.reason ?? 'failed' });
            }
            continue;
        }
        if (unit === undefined) continue;

        const source = unit.files[0];
        if (source === undefined) continue; // units are always constructed with at least one file
        const baseEntry = {
            target: null as string | null,
            family: unit.family,
            identity: unit.identity,
        };

        // Owner gate: active/paused/interrupted-recoverable or unknown runs are preserved.
        if (unit.ownerRunId !== undefined && (await ownerPreserved(readRunStatus, unit.ownerRunId))) {
            for (const file of unit.files) {
                result.entries.push({
                    ...baseEntry,
                    source: file,
                    contentDigest: fileDigest(file),
                    outcome: 'preserved',
                });
            }
            continue;
        }

        // A run-record pair missing its required lasting item fails closed (housekeeping skipped).
        if (unit.missingRequiredItem !== undefined) {
            const reason = `missing-required-item: ${unit.missingRequiredItem}`;
            result.entries.push({ ...baseEntry, source, contentDigest: fileDigest(source), outcome: 'failed', reason });
            result.failures.push({ source, reason });
            continue;
        }

        // JSON families must parse before anything is written.
        if (unit.requiresJsonParse && parseJsonObject(source) === null) {
            result.entries.push({
                ...baseEntry,
                source,
                contentDigest: fileDigest(source),
                outcome: 'failed',
                reason: 'malformed',
            });
            result.failures.push({ source, reason: 'malformed' });
            continue;
        }

        const targetDir = unit.family === 'run-record' ? dirs.recordsDir : dirs.evidenceDir;
        const unitRoot = join(dirs.scratchDir, unit.identity);
        // Subtree files keep their scratch subpath under the durable run dir;
        // top-level files map by basename (record pair, log, evidence).
        const targets = unit.files.map((file) =>
            file.startsWith(`${unitRoot}${sep}`)
                ? join(targetDir, unit.identity, relative(unitRoot, file))
                : join(targetDir, basename(file)),
        );
        // targets is derived 1:1 from unit.files, so every index below is defined.
        const targetFor = (index: number): string => targets[index] as string;

        try {
            for (const [index, file] of unit.files.entries()) {
                await resolveRunArtifactPath(fs, dirs.projectRoot, file);
                await resolveDurableArtifactPath(
                    fs,
                    dirs.projectRoot,
                    targetFor(index),
                    unit.family === 'run-record' ? 'runs' : 'evidence',
                );
            }
        } catch (error) {
            const reason = `confinement: ${String(error)}`;
            result.entries.push({ ...baseEntry, source, contentDigest: fileDigest(source), outcome: 'failed', reason });
            result.failures.push({ source, reason });
            continue;
        }

        // Preview uses the same conflict check as apply, including single-file units.
        const conflicts = unit.files.filter(
            (file, index) => existsSync(targetFor(index)) && fileDigest(targetFor(index)) !== fileDigest(file),
        );
        if (conflicts.length > 0) {
            for (const [index, file] of unit.files.entries()) {
                result.entries.push({
                    ...baseEntry,
                    source: file,
                    target: targetFor(index),
                    contentDigest: fileDigest(file),
                    outcome: 'failed',
                    reason: 'target-mismatch',
                });
                result.failures.push({ source: file, reason: 'target-mismatch' });
            }
            continue;
        }

        if (dryRun) {
            for (const [index, file] of unit.files.entries()) {
                result.entries.push({
                    ...baseEntry,
                    source: file,
                    target: targetFor(index),
                    contentDigest: fileDigest(file),
                    outcome: 'would-migrate',
                });
            }
            continue;
        }

        for (const [index, file] of unit.files.entries()) {
            const target = targetFor(index);
            if (target === undefined) {
                result.failures.push({ source: file, reason: 'internal: no target mapped for file' });
                continue;
            }
            const fileEntry = { ...baseEntry, source: file, target, contentDigest: fileDigest(file) };
            if (existsSync(target)) {
                if (fileDigest(target) === fileEntry.contentDigest) {
                    result.entries.push({ ...fileEntry, outcome: 'already-present' });
                } else {
                    result.entries.push({ ...fileEntry, outcome: 'failed', reason: 'target-mismatch' });
                    result.failures.push({ source: file, reason: 'target-mismatch' });
                }
                continue;
            }
            try {
                mkdirSync(dirname(target), { recursive: true });
                atomicCopy(file, target);
                result.entries.push({ ...fileEntry, outcome: 'migrated' });
            } catch (err) {
                const reason = (err as Error).message.startsWith('copy-mismatch:') ? 'copy-mismatch' : 'write-failed';
                result.entries.push({ ...fileEntry, outcome: 'failed', reason });
                result.failures.push({ source: file, reason });
            }
        }
    }

    if (!dryRun) {
        try {
            await resolveDurableArtifactPath(
                fs,
                dirs.projectRoot,
                join(dirs.projectRoot, '.spur', 'memory', 'run-storage-migration.json'),
                'memory',
            );
        } catch (error) {
            result.failures.push({ source: dirs.projectRoot, reason: `manifest-confinement: ${String(error)}` });
            return result;
        }
        const manifestEntries = result.entries.filter((entry) => entry.outcome !== 'preserved');
        const manifestFailure = writeManifest(dirs, manifestEntries, now);
        if (manifestFailure !== undefined) result.failures.push(manifestFailure);
    }
    return result;
}

/** Durable per-run session dir: `<projectRoot>/.spur/memory/runs/<runId>/agent-sessions` (1026 R3). */
export function runSessionsDir(cwd: string, runId: string): string {
    assertRunId(runId);
    return join(runStoragePaths(cwd).recordsDir, runId, 'agent-sessions');
}

/** Durable per-run artifact dir: `<projectRoot>/.spur/memory/runs/<runId>/artifacts` (1026 R3). */
export function runArtifactsDir(cwd: string, runId: string): string {
    assertRunId(runId);
    return join(runStoragePaths(cwd).recordsDir, runId, 'artifacts');
}

function assertRunId(runId: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId) || runId.includes('..')) {
        throw new InvalidWorkflowRunIdError(runId);
    }
}

/** Repo-local ignore entry that keeps the durable run-record plane out of the git tree. */
const DURABLE_PLANE_EXCLUDE = '.spur/memory/';

/**
 * 1026: durable run-record writes must never move the proof-input git tree —
 * `computeProofInputFingerprint` runs `git add -A`, so an untracked record under
 * `.spur/memory/` would shift every subsequent fresh capture mid-run. The plane is
 * therefore excluded via the repo-local `.git/info/exclude` (no tracked `.gitignore`
 * edit, idempotent, once per repo). Best-effort by contract: outside a normal
 * checkout (`.git` is a worktree pointer file) the plain join path is unusable, so the
 * real gitdir is parsed from the pointer line and the common exclude file used —
 * without this, managed-worktree receipts stale instantly and deadlock verifying→done
 * gates. If the layout is unexpected the exclusion cannot be installed and durable
 * files stay tree-visible — the run proceeds; only fingerprint stability is degraded.
 */
export function ensureDurablePlaneIgnored(workdir: string): void {
    try {
        const gitPath = join(workdir, '.git');
        if (!existsSync(gitPath)) return; // not a git checkout — nothing to exclude from
        let excludePath = join(gitPath, 'info', 'exclude');
        try {
            if (statSync(gitPath).isFile()) {
                // Managed worktrees carry `.git` as a `gitdir: <path>` pointer file.
                const gitdir = readFileSync(gitPath, 'utf8')
                    .split(/\r?\n/)
                    .find((line) => line.startsWith('gitdir:'))
                    ?.slice('gitdir:'.length)
                    .trim();
                if (gitdir) {
                    const resolved = isAbsolute(gitdir) ? gitdir : resolve(workdir, gitdir);
                    // Standard linked-worktree layout: <common>/.git/worktrees/<name>
                    // shares the common excludes; otherwise use the resolved gitdir's own.
                    const common = /[/\\]worktrees[/\\][^/\\]+$/.test(resolved)
                        ? resolve(resolved, '..', '..')
                        : resolved;
                    excludePath = join(common, 'info', 'exclude');
                }
            }
        } catch {
            // keep the plain-join fallback for normal checkouts or unreadable pointers
        }
        let current = '';
        try {
            current = readFileSync(excludePath, 'utf8');
        } catch {
            current = ''; // first install in this repo
        }
        if (current.includes(DURABLE_PLANE_EXCLUDE)) return; // idempotent
        mkdirSync(dirname(excludePath), { recursive: true });
        const sep = current === '' || current.endsWith('\n') ? '' : '\n';
        appendFileSync(
            excludePath,
            `${sep}# spur durable run-record plane (E71/1026): must stay proof-fingerprint-inert\n${DURABLE_PLANE_EXCLUDE}\n`,
            'utf8',
        );
    } catch {
        // best-effort: an unwritable info dir leaves durable files untracked-visible; never fail a run
    }
}

/**
 * Read-side record resolution (1026 R1): the durable records dir when any of
 * the run's record files already live there, else the legacy scratch dir.
 * Invalid run ids resolve to scratch and fail later in the record readers.
 */
export function resolveRunRecordDir(cwd: string, runId: string): string {
    const dirs = runStoragePaths(cwd);
    if (runId === '' || runId !== basename(runId) || runId.startsWith('.')) return dirs.scratchDir;
    const durable = [`${runId}.md`, `${runId}.state.json`, `${runId}.log`].some((name) =>
        existsSync(join(dirs.recordsDir, name)),
    );
    return durable ? dirs.recordsDir : dirs.scratchDir;
}
