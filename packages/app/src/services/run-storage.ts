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

import { createHash, randomUUID } from 'node:crypto';
import {
    appendFileSync,
    existsSync,
    linkSync,
    lstatSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { resolveDurableArtifactPath, resolveRunArtifactPath } from '../workflow/actions/run-path';
import {
    type FeatureVerificationReceipt,
    parseFeatureVerificationReceipt,
} from '../workflow/feature-verification-receipt';
import { InvalidWorkflowRunIdError } from '../workflow/run-record';
import { parseVerifyVerdict } from './verify-verdict';

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

/**
 * Nearest ancestor of `cwd` with a `.spur` dir or `package.json`; `cwd` itself is the fallback.
 * The shared OS temp dirs (tmpdir(), `/tmp`) are never candidates: a stray `<tmpdir>/.spur` (left by any tool run
 * with a bare-tmp cwd; on Linux CI `tmpdir()` is `/tmp`, the parent of every temp project)
 * would re-root all unmarked temp projects beneath it and misdirect their durable writes.
 */
function resolveRunStorageRoot(cwd: string): string {
    const start = resolve(cwd);
    // `/tmp` too: a nested TMPDIR (`/tmp/claude-501`) puts the walk through `/tmp` after tmpdir().
    const sharedTmp = new Set([resolve(tmpdir()), '/tmp', '/private/tmp']);
    let current = start;
    for (;;) {
        if (
            !sharedTmp.has(current) &&
            (existsSync(join(current, '.spur')) || existsSync(join(current, 'package.json')))
        ) {
            return current;
        }
        const parent = resolve(current, '..');
        if (parent === current) return start;
        current = parent;
    }
}

// ─── Migration ─────────────────────────────────────────────────────────

/** Evidence families carried by the migration. */
export type RunStorageFamily = 'task-verdict' | 'feature-receipt' | 'run-record';

/** Per-unit migration outcome. */
export type RunStorageOutcome =
    | 'would-migrate'
    | 'migrated'
    | 'already-present'
    | 'preserved'
    | 'failed'
    | 'superseded';

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
    remedy?: string;
}

/** Standard remedy recommendation for a migration failure reason. */
export function failureRemedy(reason: string): string {
    if (reason.startsWith('write-failed')) return 'check permissions/disk';
    if (reason.startsWith('copy-mismatch')) return 'check target disk integrity and retry';
    if (reason.startsWith('confinement')) return 'path escapes plane';
    if (reason.startsWith('target-mismatch')) return 'repair the durable file by hand';
    if (reason.startsWith('missing-required-item')) return 're-record the run';
    return 'inspect source file and durable storage';
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
    /** Existing DB/history owners redirect copied artifact, session and checkpoint references. */
    redirectReferences?: (entries: readonly RunStorageMigrationEntry[]) => Promise<void>;
    registeredArtifacts?: readonly { path: string; runId: string | null }[];
}

/** Run statuses whose scratch files must be preserved (owner still live or rerun-resumable). */
const LIVE_RUN_STATUSES = new Set(['running', 'pending', 'paused', 'interrupted']);

/** sha-256 hex digest of one file's bytes. */
function fileDigest(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Atomic byte copy: write the temp sibling, rename, then reread and verify the digest. */
function defaultAtomicCopy(source: string, target: string, snapshot?: Uint8Array): void {
    const bytes = snapshot ?? readFileSync(source);
    const tmp = `${target}.${randomUUID()}.tmp`;
    writeFileSync(tmp, bytes, { flag: 'wx' });
    try {
        try {
            linkSync(tmp, target);
        } catch (error) {
            if ((error as { code?: string }).code !== 'EEXIST') throw error;
        }
        if (fileDigest(target) !== createHash('sha256').update(bytes).digest('hex')) {
            throw new Error('copy-mismatch: published target digest differs from the source');
        }
    } finally {
        unlinkSync(tmp);
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
    requiresReferenceRedirect?: boolean;
    registeredArtifact?: boolean;
}

interface Classified {
    unit?: ScratchUnit;
    entry?: RunStorageMigrationEntry;
}

/** Parse a JSON scratch file; null when unparseable or not a plain object. */
function parseJsonObject(path: string, raw?: string): Record<string, unknown> | null {
    try {
        const parsed: unknown = JSON.parse(raw ?? readFileSync(path, 'utf8'));
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
                requiresJsonParse: false,
                requiresReferenceRedirect: true,
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
        let receipt: FeatureVerificationReceipt | null = null;
        if (parsed !== null) {
            try {
                receipt = parseFeatureVerificationReceipt(readFileSync(source, 'utf8'));
                assertRunId(receipt.runId);
                assertRunId(receipt.featureId);
                if (prefix !== receipt.runId && prefix !== receipt.featureId) receipt = null;
            } catch {
                receipt = null;
            }
        }
        const identity = receipt?.featureId ?? prefix;
        const ownerRunId = receipt?.runId;
        return {
            unit: {
                family: 'feature-receipt',
                identity,
                files: [source],
                requiresJsonParse: true,
                ...(ownerRunId ? { ownerRunId } : {}),
            },
        };
    }

    if (name.endsWith('-verdict.json')) {
        const identity = name.slice(0, -'-verdict.json'.length);
        const parsed = parseJsonObject(source);
        const proof = parsed?.proof;
        const ownerRunId =
            proof !== null && typeof proof === 'object' && !Array.isArray(proof)
                ? (proof as Record<string, unknown>).runId
                : parsed?.pipelineRunId;
        return {
            unit: {
                family: 'task-verdict',
                identity,
                files: [source],
                requiresJsonParse: true,
                ...(typeof ownerRunId === 'string' ? { ownerRunId } : {}),
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
    failures: readonly RunStorageFailure[],
): RunStorageFailure | undefined {
    const manifestPath = join(dirs.projectRoot, '.spur', 'memory', 'run-storage-migration.json');
    try {
        mkdirSync(join(dirs.projectRoot, '.spur', 'memory'), { recursive: true });
        const body = `${JSON.stringify(
            {
                version: 1,
                updatedAt: now(),
                entries,
                failures,
                complete:
                    failures.length === 0 &&
                    !entries.some(
                        (entry) =>
                            entry.family !== null &&
                            entry.outcome === 'preserved' &&
                            !entry.reason?.startsWith('unclassified'),
                    ),
            },
            null,
            4,
        )}\n`;
        const tmp = `${manifestPath}.tmp`;
        writeFileSync(tmp, body);
        renameSync(tmp, manifestPath);
        return undefined;
    } catch (err) {
        return { source: manifestPath, reason: `manifest-write: ${(err as Error).message}` };
    }
}

/** True when a durable target is present and valid for its family. */
function isDurableTargetValid(family: RunStorageFamily, identity: string, targets: string[]): boolean {
    if (targets.length === 0 || targets.some((t) => !existsSync(t))) return false;
    if (family === 'task-verdict') {
        const target = targets[0];
        if (!target) return false;
        try {
            const content = readFileSync(target, 'utf8');
            const parsed = parseVerifyVerdict(content, identity);
            return parsed.kind === 'valid' && parsed.verdict.wbs === identity;
        } catch {
            return false;
        }
    }
    if (family === 'feature-receipt') {
        const target = targets[0];
        if (!target) return false;
        try {
            const content = readFileSync(target, 'utf8');
            const receipt = parseFeatureVerificationReceipt(content);
            return receipt.featureId === identity || receipt.runId === identity;
        } catch {
            return false;
        }
    }
    if (family === 'run-record') {
        for (const target of targets) {
            if (target.endsWith('.state.json')) {
                const state = parseJsonObject(target);
                if (state === null || ('runId' in state && state.runId !== identity)) return false;
            }
        }
        return true;
    }
    return false;
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
            for (const family of ['agent-sessions', 'artifacts']) {
                const owned = join(subtree, family);
                if (!existsSync(owned)) continue;
                if (lstatSync(owned).isSymbolicLink()) {
                    result.entries.push({
                        source: owned,
                        target: null,
                        family: 'run-record',
                        identity: item.name,
                        contentDigest: '',
                        outcome: 'preserved',
                        reason: 'symlink-owned-subtree',
                    });
                } else if (statSync(owned).isDirectory()) walk(owned);
            }
        }
    } catch (error) {
        if ((error as { code?: string }).code !== 'ENOENT') {
            result.failures.push({ source: dirs.scratchDir, reason: String(error) });
        }
        return result;
    }
    const fileSet = new Set(names);
    const registered = new Map(
        (input.registeredArtifacts ?? []).map((artifact) => [resolve(dirs.projectRoot, artifact.path), artifact]),
    );

    // 1026: durable copies must not shift the proof-input tree — exclude the plane repo-locally first.
    if (!dryRun) ensureDurablePlaneIgnored(dirs.projectRoot);
    for (const name of names) {
        // Logs-only never touches verdicts, receipts, record pairs, sessions or artifacts.
        if (logsOnly && (name.includes(sep) || !name.endsWith('.log'))) continue;
        const sourcePath = join(dirs.scratchDir, name);
        try {
            await resolveRunArtifactPath(fs, dirs.projectRoot, sourcePath);
        } catch (error) {
            const reason = `confinement: ${String(error)}`;
            result.entries.push({
                source: sourcePath,
                target: null,
                family: null,
                identity: null,
                contentDigest: '',
                outcome: 'failed',
                reason,
            });
            result.failures.push({ source: sourcePath, reason, remedy: failureRemedy(reason) });
            continue;
        }
        const artifact = registered.get(sourcePath) ?? registered.get(fs.realPath?.(sourcePath) ?? sourcePath);
        const classification =
            artifact?.runId && !name.endsWith('-verdict.json') && !name.endsWith('-feature-verification.json')
                ? {
                      unit: {
                          family: 'run-record' as const,
                          identity: artifact.runId,
                          ownerRunId: artifact.runId,
                          files: [sourcePath],
                          requiresJsonParse: false,
                          requiresReferenceRedirect: true,
                          registeredArtifact: true,
                      },
                  }
                : classify(name, dirs.scratchDir, fileSet);
        const { unit, entry: standalone } = classification;
        if (standalone !== undefined) {
            result.entries.push(standalone);
            if (standalone.outcome === 'failed') {
                const reason = standalone.reason ?? 'failed';
                result.failures.push({ source: standalone.source, reason, remedy: failureRemedy(reason) });
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

        const targetDir = unit.family === 'run-record' ? dirs.recordsDir : dirs.evidenceDir;
        const unitRoot = join(dirs.scratchDir, unit.identity);
        // Subtree files keep their scratch subpath under the durable run dir;
        // top-level files map by basename (record pair, log, evidence).
        const targets = unit.files.map((file) =>
            unit.registeredArtifact
                ? join(dirs.recordsDir, unit.identity, 'artifacts', basename(file))
                : file.startsWith(`${unitRoot}${sep}`)
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
            result.failures.push({ source, reason, remedy: failureRemedy(reason) });
            continue;
        }

        const snapshots = new Map(unit.files.map((file) => [file, readFileSync(file)]));
        const sourceText = snapshots.get(source)?.toString('utf8') ?? '';
        const snapshotDigest = (file: string) =>
            createHash('sha256')
                .update(snapshots.get(file) as Uint8Array)
                .digest('hex');

        // R3(a): A unit whose every target already exists byte-identical is already-present before any family validation runs.
        const allTargetsIdentical = unit.files.every(
            (file, index) => existsSync(targetFor(index)) && fileDigest(targetFor(index)) === snapshotDigest(file),
        );
        if (allTargetsIdentical) {
            for (const [index, file] of unit.files.entries()) {
                result.entries.push({
                    ...baseEntry,
                    source: file,
                    target: targetFor(index),
                    contentDigest: snapshotDigest(file),
                    outcome: 'already-present',
                });
            }
            continue;
        }

        if (unit.ownerRunId !== undefined) {
            try {
                assertRunId(unit.ownerRunId);
            } catch (error) {
                if (isDurableTargetValid(unit.family, unit.identity, targets)) {
                    for (const [index, file] of unit.files.entries()) {
                        result.entries.push({
                            ...baseEntry,
                            source: file,
                            target: targetFor(index),
                            contentDigest: snapshotDigest(file),
                            outcome: 'superseded',
                            reason: 'durable canonical',
                        });
                    }
                    continue;
                }
                const reason = `owner identity: ${String(error)}`;
                result.entries.push({
                    ...baseEntry,
                    source,
                    contentDigest: fileDigest(source),
                    outcome: 'failed',
                    reason,
                });
                result.failures.push({ source, reason, remedy: failureRemedy(reason) });
                continue;
            }
        }

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

        // R3(d): A run-record unit whose missing sibling exists with the full pair under .spur/memory/runs/<id>.* is already-present.
        if (unit.missingRequiredItem !== undefined) {
            const mdDurable = join(dirs.recordsDir, `${unit.identity}.md`);
            const stateDurable = join(dirs.recordsDir, `${unit.identity}.state.json`);
            if (existsSync(mdDurable) && existsSync(stateDurable)) {
                result.entries.push({
                    ...baseEntry,
                    source,
                    target: join(dirs.recordsDir, basename(source)),
                    contentDigest: fileDigest(source),
                    outcome: 'already-present',
                });
                continue;
            }
            const reason = `missing-required-item: ${unit.missingRequiredItem}`;
            result.entries.push({ ...baseEntry, source, contentDigest: fileDigest(source), outcome: 'failed', reason });
            result.failures.push({ source, reason, remedy: failureRemedy(reason) });
            continue;
        }

        // JSON families must parse before anything is written.
        let shapeInvalid: string | undefined;
        let identityInvalid: string | undefined;

        if (unit.requiresJsonParse && parseJsonObject(source, sourceText) === null) {
            shapeInvalid = 'malformed';
        }
        if (shapeInvalid === undefined && unit.family === 'task-verdict') {
            const parsed = parseVerifyVerdict(sourceText, unit.identity);
            if (parsed.kind !== 'valid') {
                shapeInvalid = 'verdict identity or shape';
            } else {
                const raw = parseJsonObject(source, sourceText);
                if (raw !== null && 'wbs' in raw && raw.wbs !== unit.identity) {
                    identityInvalid = 'verdict identity';
                } else if (raw?.proof !== undefined) {
                    const proof = raw.proof;
                    if (
                        proof === null ||
                        typeof proof !== 'object' ||
                        Array.isArray(proof) ||
                        typeof (proof as Record<string, unknown>).runId !== 'string' ||
                        (proof as Record<string, unknown>).runId !== unit.ownerRunId
                    ) {
                        identityInvalid = 'proof owner binding';
                    }
                }
            }
        }
        if (shapeInvalid === undefined && identityInvalid === undefined && unit.family === 'feature-receipt') {
            try {
                const receipt = parseFeatureVerificationReceipt(sourceText);
                if (receipt.featureId !== unit.identity && receipt.runId !== unit.identity) {
                    identityInvalid = 'receipt identity';
                } else if (unit.ownerRunId && receipt.runId !== unit.ownerRunId) {
                    identityInvalid = 'receipt identity';
                }
            } catch (err) {
                shapeInvalid = `receipt shape: ${String(err)}`;
            }
        }
        if (shapeInvalid === undefined && identityInvalid === undefined) {
            for (const file of unit.files.filter((file) => file.endsWith('.state.json'))) {
                const state = parseJsonObject(file, snapshots.get(file)?.toString('utf8'));
                if (state === null) {
                    shapeInvalid = 'malformed';
                } else if ('runId' in state && state.runId !== unit.identity) {
                    identityInvalid = 'run-state identity or shape';
                }
            }
        }
        if (shapeInvalid === undefined && identityInvalid === undefined) {
            if (unit.requiresReferenceRedirect && input.redirectReferences === undefined) {
                identityInvalid = 'reference owner unavailable';
            }
        }

        if (shapeInvalid !== undefined) {
            // R3(b): Consult durable target. If valid, it is superseded.
            if (isDurableTargetValid(unit.family, unit.identity, targets)) {
                for (const [index, file] of unit.files.entries()) {
                    result.entries.push({
                        ...baseEntry,
                        source: file,
                        target: targetFor(index),
                        contentDigest: snapshotDigest(file),
                        outcome: 'superseded',
                        reason: 'durable canonical',
                    });
                }
                continue;
            }
            // If durable target exists but is invalid:
            const anyTargetExists = targets.some((t) => existsSync(t));
            if (anyTargetExists) {
                for (const [index, file] of unit.files.entries()) {
                    result.entries.push({
                        ...baseEntry,
                        source: file,
                        target: targetFor(index),
                        contentDigest: snapshotDigest(file),
                        outcome: 'failed',
                        reason: 'target-mismatch',
                    });
                    result.failures.push({
                        source: file,
                        reason: 'target-mismatch',
                        remedy: failureRemedy('target-mismatch'),
                    });
                }
                continue;
            }
            // R3(c): No durable counterpart -> preserved unclassified.
            for (const file of unit.files) {
                result.entries.push({
                    ...baseEntry,
                    source: file,
                    target: null,
                    contentDigest: snapshotDigest(file),
                    outcome: 'preserved',
                    reason: `unclassified: ${shapeInvalid}`,
                });
            }
            continue;
        }

        if (identityInvalid !== undefined) {
            // R3(b): Consult durable target. If valid, it is superseded.
            if (isDurableTargetValid(unit.family, unit.identity, targets)) {
                for (const [index, file] of unit.files.entries()) {
                    result.entries.push({
                        ...baseEntry,
                        source: file,
                        target: targetFor(index),
                        contentDigest: snapshotDigest(file),
                        outcome: 'superseded',
                        reason: 'durable canonical',
                    });
                }
                continue;
            }
            const reason = `malformed: ${identityInvalid}`;
            for (const file of unit.files) {
                result.entries.push({
                    ...baseEntry,
                    source: file,
                    contentDigest: fileDigest(file),
                    outcome: 'failed',
                    reason,
                });
                result.failures.push({ source: file, reason, remedy: failureRemedy(reason) });
            }
            continue;
        }

        // Preview uses the same conflict check as apply, including single-file units.
        const conflicts = unit.files.filter(
            (file, index) => existsSync(targetFor(index)) && fileDigest(targetFor(index)) !== snapshotDigest(file),
        );
        if (conflicts.length > 0) {
            // R3(b): Consult durable target. If valid, it is superseded.
            if (isDurableTargetValid(unit.family, unit.identity, targets)) {
                for (const [index, file] of unit.files.entries()) {
                    result.entries.push({
                        ...baseEntry,
                        source: file,
                        target: targetFor(index),
                        contentDigest: snapshotDigest(file),
                        outcome: 'superseded',
                        reason: 'durable canonical',
                    });
                }
                continue;
            }
            for (const [index, file] of unit.files.entries()) {
                result.entries.push({
                    ...baseEntry,
                    source: file,
                    target: targetFor(index),
                    contentDigest: snapshotDigest(file),
                    outcome: 'failed',
                    reason: 'target-mismatch',
                });
                result.failures.push({
                    source: file,
                    reason: 'target-mismatch',
                    remedy: failureRemedy('target-mismatch'),
                });
            }
            continue;
        }

        if (dryRun) {
            for (const [index, file] of unit.files.entries()) {
                result.entries.push({
                    ...baseEntry,
                    source: file,
                    target: targetFor(index),
                    contentDigest: snapshotDigest(file),
                    outcome: 'would-migrate',
                });
            }
            continue;
        }

        for (const [index, file] of unit.files.entries()) {
            const target = targetFor(index);
            if (target === undefined) {
                result.failures.push({
                    source: file,
                    reason: 'internal: no target mapped for file',
                    remedy: failureRemedy('internal'),
                });
                continue;
            }
            const fileEntry = { ...baseEntry, source: file, target, contentDigest: snapshotDigest(file) };
            if (existsSync(target)) {
                if (fileDigest(target) === fileEntry.contentDigest) {
                    result.entries.push({ ...fileEntry, outcome: 'already-present' });
                } else {
                    result.entries.push({ ...fileEntry, outcome: 'failed', reason: 'target-mismatch' });
                    result.failures.push({
                        source: file,
                        reason: 'target-mismatch',
                        remedy: failureRemedy('target-mismatch'),
                    });
                }
                continue;
            }
            try {
                mkdirSync(dirname(target), { recursive: true });
                if (input.atomicCopy) input.atomicCopy(file, target);
                else defaultAtomicCopy(file, target, snapshots.get(file));
                result.entries.push({ ...fileEntry, outcome: 'migrated' });
            } catch (err) {
                const reason = (err as Error).message.startsWith('copy-mismatch:') ? 'copy-mismatch' : 'write-failed';
                result.entries.push({ ...fileEntry, outcome: 'failed', reason });
                result.failures.push({ source: file, reason, remedy: failureRemedy(reason) });
            }
        }
    }

    if (!dryRun) {
        const copied = result.entries.filter(
            (entry) => entry.outcome === 'migrated' || entry.outcome === 'already-present',
        );
        try {
            if (copied.length > 0) await input.redirectReferences?.(copied);
        } catch (error) {
            const reason = `reference-redirect: ${String(error)}`;
            result.failures.push({ source: dirs.scratchDir, reason, remedy: failureRemedy(reason) });
        }
        try {
            await resolveDurableArtifactPath(
                fs,
                dirs.projectRoot,
                join(dirs.projectRoot, '.spur', 'memory', 'run-storage-migration.json'),
                'memory',
            );
        } catch (error) {
            const reason = `manifest-confinement: ${String(error)}`;
            result.failures.push({ source: dirs.projectRoot, reason, remedy: failureRemedy(reason) });
            return result;
        }
        const manifestFailure = writeManifest(dirs, result.entries, now, result.failures);
        if (manifestFailure !== undefined) {
            result.failures.push({ ...manifestFailure, remedy: failureRemedy(manifestFailure.reason) });
        }
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
