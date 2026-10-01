/**
 * Run-storage layout and one-shot scratch migration (feature E71, task 1025).
 *
 * Layout: `.spur/run` remains the live scratch plane — pipeline writes keep
 * landing there. Durable evidence accumulates under `.spur/memory/evidence`
 * and closed run records under `.spur/memory/runs`. Consumers resolve reads
 * from the evidence dir first and fall back to scratch, so migration is a
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
 *   deleted. Legacy scratch files (run logs, check receipts, …) are preserved.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

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

    // Unknown/unowned scratch path (legacy run logs, check receipts, status files, …).
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
    return status === null || status === undefined || LIVE_RUN_STATUSES.has(status);
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

    let names: string[];
    try {
        names = readdirSync(dirs.scratchDir, { withFileTypes: true })
            .filter((item) => item.isFile())
            .map((item) => item.name);
    } catch {
        return result; // no scratch dir yet — nothing to migrate
    }
    const fileSet = new Set(names);

    // Logs-only scope excludes task/feature evidence — run records carry the run-log plane.
    const evidenceExcluded = logsOnly;

    for (const name of names) {
        const { unit, entry: standalone } = classify(name, dirs.scratchDir, fileSet);
        if (standalone !== undefined) {
            result.entries.push(standalone);
            if (standalone.outcome === 'failed') {
                result.failures.push({ source: standalone.source, reason: standalone.reason ?? 'failed' });
            }
            continue;
        }
        if (unit === undefined) continue;
        if (evidenceExcluded && unit.family !== 'run-record') continue;

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
        const targets = unit.files.map((file) => join(targetDir, basename(file)));
        // targets is derived 1:1 from unit.files, so every index below is defined.
        const targetFor = (index: number): string => targets[index] as string;

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

        // Preflight run-record pair targets: any digest-divergent existing target fails the
        // whole pair closed — no target is overwritten and no partial record is left behind.
        if (unit.files.length === 2) {
            const divergent = unit.files.some(
                (file, index) => existsSync(targetFor(index)) && fileDigest(targetFor(index)) !== fileDigest(file),
            );
            if (divergent) {
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
        }

        mkdirSync(targetDir, { recursive: true });

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
        const manifestEntries = result.entries.filter((entry) => entry.outcome !== 'preserved');
        const manifestFailure = writeManifest(dirs, manifestEntries, now);
        if (manifestFailure !== undefined) result.failures.push(manifestFailure);
    }
    return result;
}
