/**
 * Worktree evidence persistence (WT-4) — the transport `spur workflow persist-out` /
 * `persist-check` call before teardown (task 1242 flattened them out of the deleted
 * `workflow inline` group; the capability and its semantics are unchanged).
 */
import { basename, join, resolve } from 'node:path';
import {
    listRunIdRows,
    MarkdownDocument,
    redirectRunStorageReferences,
    transferRunTables,
} from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { resolveDurableArtifactPath } from '../workflow/actions/run-path';
import { parseFeatureVerificationReceipt } from '../workflow/feature-verification-receipt';
import { reconcileExistingLifecycleRow, TASK_LIFECYCLE_PROFILE } from '../workflow/lifecycle-adapter';
import { asLiteralRunFileName, RUN_CITATION_RE, SAFE_RUN_ID_RE } from '../workflow/run-citation';
import { InvalidWorkflowRunIdError } from '../workflow/run-record';
import { isBookkeepingWorkflow } from '../workflow/terminal-reason';
import { openInlineRunProjectDb } from './inline-run-attribution';
import { ensureDurablePlaneIgnored, runStoragePaths } from './run-storage';
import { parseVerifyVerdict } from './verify-verdict';

const { existsSync, mkdirSync, readFileSync, writeFileSync } = process.getBuiltinModule('node:fs');
const { lstat, mkdir, readdir, readFile } = process.getBuiltinModule('node:fs/promises');

/** Input for {@link persistWorktreeRuns}. */
export interface PersistWorktreeRunsInput {
    /** Worktree (or any project dir) whose `.spur` run provenance is copied out. */
    readonly fromWorkdir: string;
    /** Invoking tree that receives the DB rows and run records. */
    readonly toWorkdir: string;
    /**
     * Merged task file paths (relative to `toWorkdir` or absolute) whose literal
     * `.spur/run/<file>` citations must resolve in the invoking tree (0984 R1/R2). The
     * worktree driver forwards one per merged task; the service owns citation selection,
     * safe-path validation and conflict behavior. Omitted = no citation pass (callers
     * keep the rows + two-file records contract).
     */
    readonly taskFiles?: readonly string[];
}

/** One durable-evidence file skipped because a forwarded task does not own it (1139 R5). */
export interface PersistWorktreeRunsEvidenceSkip {
    readonly name: string;
    readonly reason: 'foreign-divergent';
    readonly newer: 'invoking' | 'worktree';
}

/** Successful persist-out: inserted run-row count plus the collision / record skips. */
export interface PersistWorktreeRunsSuccess {
    readonly ok: true;
    /** Runs whose rows were inserted into the target DB. */
    readonly persisted: number;
    /**
     * Collision skips — DB reasons from the transfer, plus per-file `record-conflict:<file>`
     * (divergent invoking-tree record, never overwritten), `record-missing:<file>` (a known
     * bookkeeping lifecycle row with no record file; its row still counts in `persisted`,
     * 0984 R5) and `cited-directory:<name>` / `cited-symlink:<name>` / `cited-non-file:<name>`
     * (a citation resolving to anything but a regular file is not a file the copy set can own).
     */
    readonly skipped: ReadonlyArray<{ id: string; reason: string }>;
    readonly evidenceSkipped?: ReadonlyArray<PersistWorktreeRunsEvidenceSkip>;
}

/**
 * Cap on distinct literal `.spur/run/<file>` citations one persist-out copies/verifies for
 * the merged task files (0984 R3). A fixed bound keeps the copy set proportional to the
 * batch's corpus, not to whatever a hand-edited task file lists.
 */
export const MAX_CITED_RUN_FILES = 64;

async function readExistingRunFile(path: string): Promise<Buffer | undefined> {
    const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
    });
    if (stat === undefined) return undefined;
    if (!stat.isFile())
        throw new Error(`persist-out: destination ${path} is not a regular file — refusing to follow it`);
    return readFile(path);
}

/**
 * Persist a worktree's inline-run provenance into the invoking tree (task 0975 R1; citations
 * per 0984): transfer the `runs` row plus its `action_runs` / `phase_runs` /
 * `transition_runs` / `workflow_states` children with {@link transferRunTables}, then copy
 * each persisted run's two-file run record (`.spur/memory/runs/<id>.md` + `.state.json`). An
 * existing target record is left untouched — identical bytes are an idempotent no-op,
 * divergent bytes are reported as `skipped[{id, reason:'record-conflict:<file>'}]` rather
 * than overwritten.
 *
 * Cited evidence (0984 R1–R4): when the driver forwards merged task file paths via
 * `taskFiles`, every literal `.spur/run/<file>` citation in those files must resolve in the
 * invoking tree after this call. Files present in the worktree are copied (absent target),
 * treated as idempotent no-ops (byte-identical target), or refused (divergent target — a
 * conflict throws, blocking teardown, never overwriting). A citation missing in both trees,
 * an unreadable task file, or a citation set over {@link MAX_CITED_RUN_FILES} throws with
 * zero writes performed — the caller routes to WT-5 and the worktree is retained.
 *
 * Owned evidence (1012 R1/R2): with `taskFiles`, the worktree's `.spur/run/` direct children
 * named `<wbs>-…` (each forwarded task file's leading four-digit WBS) or `<runId>-…` (each
 * worktree run row, whichever task it ran) are copy obligations too, cited or not — same
 * pipeline, each owner bounded by its own {@link MAX_CITED_RUN_FILES} budget (1034 R1) while
 * the citation cap stays citations-only. An absent `.spur/run/` means nothing owned;
 * any other listing failure throws before the first invoking-tree write (1012 R4). Without
 * `taskFiles` (or with `[]`) nothing is enumerated.
 *
 * Record tolerance (0984 R5): a known bookkeeping lifecycle row (`task-lifecycle` /
 * `feature-lifecycle`, created by record-stage transitions) may have no two-file record at
 * all — its source ENOENT is reported as `skipped[{id, reason:'record-missing:<file>'}]`
 * while its inserted DB row still counts in {@link PersistWorktreeRunsSuccess.persisted}.
 * A missing task-pipeline record stays fatal, preserving the green-run evidence guarantee.
 *
 * Fail-closed records (1043 R1): all record bytes are pre-read BEFORE the target DB is
 * opened; a task-pipeline ENOENT or any non-ENOENT read error aborts with zero writes, so
 * inserted rows can never outrun their evidence. Replay repair (1043 R2): ids already
 * present in the target (`id-exists`) join the copy-if-missing record pass — a torn earlier
 * attempt (rows without files) is repaired by the next persist-out (`persisted:0` plus the
 * repaired records); divergent targets still refuse to overwrite (0984 R4).
 *
 * Any other persistence failure (unreadable worktree DB, unwritable target, or a source run
 * id that is not a safe filename component — rejected as {@link InvalidWorkflowRunIdError}
 * before any target write) throws — the caller routes to WT-5 and the worktree is retained,
 * so a green run can never destroy its own evidence.
 */
export async function persistWorktreeRuns(input: PersistWorktreeRunsInput): Promise<PersistWorktreeRunsSuccess> {
    const fromDir = resolve(input.fromWorkdir);
    const toDir = resolve(input.toWorkdir);
    // Fail closed before any side effect: with a bogus from-dir the source-DB open creates a
    // stray tree, and root-relative evidence discovery walks up to the INVOKING tree, so the
    // confinement probe later reports the wrong tree (`must resolve beneath …`).
    const fromStat = await lstat(fromDir).catch(() => undefined);
    if (fromStat === undefined || !fromStat.isDirectory()) {
        throw new Error(`persist-out: source worktree does not exist or is not a directory: ${input.fromWorkdir}`);
    }
    const fromRunDir = join(fromDir, '.spur', 'run');
    const toRunDir = join(toDir, '.spur', 'run');
    // 1026 R7: the durable run-record plane migrates alongside the scratch evidence.
    const fromRecordsDir = runStoragePaths(fromDir).recordsDir;
    const toRecordsDir = runStoragePaths(toDir).recordsDir;
    const fs = createNodeFileSystem();
    const fromEvidence = runStoragePaths(fromDir).evidenceDir;
    const toEvidence = runStoragePaths(toDir).evidenceDir;
    const evidenceCopies: Array<{ source: string; target: string; bytes: Buffer }> = [];
    const evidenceSkipped: PersistWorktreeRunsEvidenceSkip[] = [];

    // Ownership computation hoisted for R5 foreign-divergent detection.
    const forwardedWbs = new Set<string>();
    for (const taskFile of input.taskFiles ?? []) {
        const wbs = /^(\d{4})_/.exec(basename(taskFile))?.[1];
        if (wbs !== undefined) forwardedWbs.add(wbs);
    }
    const hasTaskFilter = input.taskFiles !== undefined;
    const worktreeRunIds = new Set<string>();
    const ownerDb = await openInlineRunProjectDb(fromDir);
    try {
        for (const row of await listRunIdRows(ownerDb.adapter)) {
            if (!SAFE_RUN_ID_RE.test(row.id)) throw new InvalidWorkflowRunIdError(row.id);
            worktreeRunIds.add(row.id);
        }
    } finally {
        ownerDb.close();
    }

    // Canonical verdicts and both receipt identities travel even without scratch citations.
    // Validate and snapshot the complete family before opening the destination database.
    await resolveDurableArtifactPath(fs, fromDir, join(fromEvidence, 'probe.json'), 'evidence');
    const evidenceNames = await readdir(fromEvidence).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [] as string[];
        throw error;
    });
    for (const name of evidenceNames.sort()) {
        const source = await resolveDurableArtifactPath(fs, fromDir, join(fromEvidence, name), 'evidence');
        const target = await resolveDurableArtifactPath(fs, toDir, join(toEvidence, name), 'evidence');
        const stat = await lstat(source);
        if (!stat.isFile()) throw new Error(`persist-out: durable evidence is not a regular file: ${name}`);
        const bytes = await readFile(source);
        const verdictWbs = /^(\d{4})-verdict\.json$/.exec(name)?.[1];
        let isOwned = false;
        if (verdictWbs !== undefined) {
            const parsed = parseVerifyVerdict(bytes.toString(), verdictWbs);
            const raw = JSON.parse(bytes.toString()) as { wbs?: unknown };
            if (!parsed || parsed.wbs !== verdictWbs || (raw.wbs !== undefined && raw.wbs !== verdictWbs)) {
                throw new Error(`persist-out: malformed durable verdict identity: ${name}`);
            }
            isOwned = hasTaskFilter ? forwardedWbs.has(verdictWbs) : true;
        } else if (name.endsWith('-feature-verification.json')) {
            const receipt = parseFeatureVerificationReceipt(bytes.toString());
            const owner = name.slice(0, -'-feature-verification.json'.length);
            if (owner !== receipt.runId && owner !== receipt.featureId) {
                throw new Error(`persist-out: malformed durable receipt identity: ${name}`);
            }
            isOwned = worktreeRunIds.has(receipt.runId);
        } else {
            throw new Error(`persist-out: unclassified durable evidence: ${name}`);
        }
        const existing = await readExistingRunFile(target);
        if (existing !== undefined && !existing.equals(bytes)) {
            if (isOwned) {
                throw new Error(`persist-out: durable evidence conflicts: ${name}`);
            }
            const targetStat = await lstat(target);
            const newer: 'invoking' | 'worktree' = targetStat.mtimeMs >= stat.mtimeMs ? 'invoking' : 'worktree';
            evidenceSkipped.push({ name, reason: 'foreign-divergent', newer });
            continue;
        }
        evidenceCopies.push({ source, target, bytes });
    }

    // 0984 R1–R3: citation selection and validation run BEFORE any DB or file write, so an
    // unresolved/unsafe/over-cap citation fails with zero side effects (the driver blocks
    // teardown on the non-zero exit and retains the worktree via WT-5).
    const citedNames = new Set<string>();
    const citedDirSkips = new Set<string>();
    for (const taskFile of input.taskFiles ?? []) {
        let content: string;
        try {
            content = await readFile(resolve(toDir, taskFile), 'utf8');
        } catch (error) {
            throw new Error(`persist-out: merged task file ${taskFile} is unreadable: ${String(error)}`);
        }
        for (const match of content.matchAll(RUN_CITATION_RE)) {
            const name = asLiteralRunFileName(match[1] ?? '');
            if (name === undefined) continue;
            // 1056 R1: a subpath citation (`.spur/run/<name>/<rest>`) is classified through
            // the 0984 R5 vocabulary, never obligated — the copy set owns direct-child files
            // only, and the subpath evidence must already exist in the invoking tree (same
            // contract as cited-non-file). Skip rows consume no MAX_CITED_RUN_FILES budget
            // (they add no copy work) and dedupe per directory: one row per extraction pass.
            if (match[2] !== undefined) {
                citedDirSkips.add(name);
                continue;
            }
            if (citedNames.has(name)) continue;
            if (citedNames.size >= MAX_CITED_RUN_FILES) {
                throw new Error(
                    `persist-out: merged task files cite more than ${MAX_CITED_RUN_FILES} distinct ` +
                        '.spur/run/ files — over the fixed citation cap (0984 R3); split the batch or prune the citations',
                );
            }
            citedNames.add(name);
        }
    }
    // 1012 R1/R2: evidence the forwarded tasks OWN — worktree `.spur/run/` direct children
    // named `<wbs>-…` (WBS = the task file's leading four digits) or `<runId>-…` (each
    // worktree run row) — joins the cited set, so it rides the same copy/no-op/refuse pipeline
    // below even when the task file never cites it. Runs before any invoking-tree write.
    if ((input.taskFiles ?? []).length > 0) {
        const prefixes = [...forwardedWbs].map((wbs) => `${wbs}-`);
        const recordNames = new Set<string>();
        for (const runId of worktreeRunIds) {
            prefixes.push(`${runId}-`);
            recordNames.add(`${runId}.md`).add(`${runId}.state.json`);
        }
        // 1012 R4: only an absent evidence dir means "nothing owned"; any other listing failure
        // (ENOTDIR, EACCES, …) propagates here, before the first invoking-tree write.
        const entries = await readdir(fromRunDir).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return [] as string[];
            throw error;
        });
        // 1034 R1: each owner (task WBS / run row) has its own MAX_CITED_RUN_FILES budget, so the
        // bound scales with the batch's row count instead of a single union cap that ~3+ tasks
        // outgrow; one runaway owner still refuses, naming itself, before any write (R2).
        const ownedCounts = new Map<string, number>();
        for (const name of entries.sort()) {
            if (recordNames.has(name)) continue;
            const owner = prefixes.find((prefix) => name.startsWith(prefix));
            if (owner === undefined) continue;
            const count = (ownedCounts.get(owner) ?? 0) + 1;
            if (count > MAX_CITED_RUN_FILES) {
                throw new Error(
                    `persist-out: owner ${owner} owns more than ${MAX_CITED_RUN_FILES} .spur/run/ files ` +
                        '— over the per-owner evidence cap (1012 R1, 1034 R1); split the batch or prune the evidence',
                );
            }
            ownedCounts.set(owner, count);
            citedNames.add(name);
        }
    }
    const citedCopies: Array<{ name: string; sourcePath: string; targetPath: string }> = [];
    const citedSkips: Array<{ id: string; reason: string }> = [];
    // 1056 R1: flush the extraction-time subpath classifications into the outcome's skip
    // vocabulary; the obligation pass below iterates citedNames only and never sees these.
    for (const name of citedDirSkips) citedSkips.push({ id: name, reason: `cited-directory:${name}` });
    for (const name of citedNames) {
        // 1026 R1: a citation may name a run record, which now lives in the durable plane.
        // The copy keeps its source plane — scratch evidence lands in the invoking scratch,
        // durable records in the invoking records dir — so every consumer resolves both
        // trees durable-first without a second engine.
        const scratchPath = join(fromRunDir, name);
        const durablePath = join(fromRecordsDir, name);
        const scratchStat = await lstat(scratchPath).catch(() => undefined);
        const sourceIsDurable = scratchStat === undefined;
        const sourcePath = sourceIsDurable ? durablePath : scratchPath;
        const targetPath = sourceIsDurable ? join(toRecordsDir, name) : join(toRunDir, name);
        const sourceStat = sourceIsDurable ? await lstat(durablePath).catch(() => undefined) : scratchStat;
        const targetBytes = await readExistingRunFile(targetPath);
        if (sourceStat === undefined) {
            // 1155: the source tree lacks the file, but the citation may still resolve in the OTHER
            // invoking-tree plane. A scratch artifact persisted by an earlier batch lives in the
            // invoking scratch (the planar rule above picks the target plane only when a source
            // actually needs copying), and probing just the inferred plane reported such a file as
            // "missing in both" — a false refusal that blocks teardown of a green run.
            const otherTarget = sourceIsDurable ? join(toRunDir, name) : join(toRecordsDir, name);
            if (targetBytes === undefined && (await readExistingRunFile(otherTarget)) === undefined) {
                throw new Error(
                    `persist-out: cited run evidence .spur/run/${name} is missing in both the worktree and ` +
                        'the invoking tree — resolve or drop the citation before teardown (0984 R1)',
                );
            }
            continue; // already resolves in the invoking tree — nothing to copy
        }
        if (!sourceStat.isFile()) {
            // A citation resolving to a directory (`.spur/run/<dir>/…` references capture their
            // first segment), a symlink (`lstat`, never followed) or another special file is not
            // a file the copy set can own; report it by its real kind and leave it in place.
            const kind = sourceStat.isDirectory() ? 'directory' : sourceStat.isSymbolicLink() ? 'symlink' : 'non-file';
            citedSkips.push({ id: name, reason: `cited-${kind}:${name}` });
            continue;
        }
        if (targetBytes !== undefined) {
            const sourceBytes = await readFile(sourcePath);
            if (!targetBytes.equals(sourceBytes)) {
                throw new Error(
                    `persist-out: cited run evidence .spur/run/${name} diverges from the invoking tree's ` +
                        'existing file — refusing to overwrite; reconcile the two copies by hand (0984 R4)',
                );
            }
            continue; // byte-identical — idempotent no-op
        }
        citedCopies.push({ name, sourcePath, targetPath });
    }

    const source = await openInlineRunProjectDb(fromDir);
    try {
        // Fail closed BEFORE the target DB is even opened: a hostile worktree row id must
        // never reach a `.spur/run/<id>` path, and rejection leaves zero partial state.
        const runRows = await listRunIdRows(source.adapter);
        for (const row of runRows) {
            if (!SAFE_RUN_ID_RE.test(row.id)) throw new InvalidWorkflowRunIdError(row.id);
        }
        // 1043 R1: pre-read every row's record bytes while nothing has been written yet — a
        // task-pipeline ENOENT or any non-ENOENT read error aborts BEFORE the target DB is
        // opened, so the transfer can never insert rows whose record pass would later fail
        // (extends the safe-id precheck above to the record plane). The bytes are cached for
        // the copy pass, which therefore writes exactly what was validated. Absence is legal
        // only for a known bookkeeping lifecycle row (0984 R5) — the record pass reports
        // `record-missing` for its un-cached files.
        const recordBytes = new Map<string, Buffer>();
        for (const row of runRows) {
            const bookkeeping =
                row.workflowName !== null && row.workflowName !== undefined && isBookkeepingWorkflow(row.workflowName);
            for (const fileName of [`${row.id}.md`, `${row.id}.state.json`]) {
                try {
                    recordBytes.set(fileName, await readFile(join(fromRecordsDir, fileName)));
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                        if (bookkeeping) continue;
                        throw new Error(
                            `persist-out: ${row.workflowName ?? 'unknown'} run ${row.id} is missing its run record ` +
                                `\`${fileName}\` in the worktree — failing closed before any row transfer ` +
                                '(green-run evidence guarantee, 0984 R5 / 1043 R1)',
                        );
                    }
                    throw error;
                }
            }
        }
        const target = await openInlineRunProjectDb(toDir);
        try {
            const { persistedIds, skipped } = await transferRunTables(source.adapter, target.adapter);
            // 1043 R2: a replay after a torn earlier attempt reports every row as `id-exists`
            // with an empty `persistedIds` — the record pass must cover those ids too, or the
            // missing records would never be repaired.
            const recordIds = [...persistedIds, ...skipped.filter((s) => s.reason === 'id-exists').map((s) => s.id)];
            const recordSkips: Array<{ id: string; reason: string }> = [];
            const referenceMoves: Array<{ source: string; target: string }> = [];
            if (evidenceCopies.length > 0) {
                ensureDurablePlaneIgnored(toDir);
                for (const copy of evidenceCopies) {
                    await mkdir(join(copy.target, '..'), { recursive: true });
                    const existing = await readExistingRunFile(copy.target);
                    if (existing !== undefined && !existing.equals(copy.bytes)) {
                        throw new Error(`persist-out: durable evidence conflicts: ${copy.target}`);
                    }
                    if (existing === undefined) writeFileSync(copy.target, copy.bytes, { flag: 'wx' });
                    referenceMoves.push({ source: copy.source, target: fs.realPath?.(copy.target) ?? copy.target });
                }
            }
            if (recordIds.length > 0 || citedCopies.length > 0) {
                mkdirSync(toRunDir, { recursive: true });
                mkdirSync(toRecordsDir, { recursive: true });
                // 1026: durable record copies must not shift the proof-input tree.
                ensureDurablePlaneIgnored(toDir);
                for (const id of recordIds) {
                    for (const fileName of [`${id}.md`, `${id}.state.json`]) {
                        const sourceBytes = recordBytes.get(fileName);
                        if (sourceBytes === undefined) {
                            // 0984 R5: pre-validation proved only a bookkeeping lifecycle row
                            // (record-stage transitions create rows with zero children) can be
                            // absent — its missing record is a reported skip, not a failure.
                            recordSkips.push({ id, reason: `record-missing:${fileName}` });
                            continue;
                        }
                        const targetPath = join(toRecordsDir, fileName);
                        const existing = await readExistingRunFile(targetPath);
                        if (existing !== undefined) {
                            if (existing.equals(sourceBytes)) continue; // idempotent re-persist
                            recordSkips.push({ id, reason: `record-conflict:${fileName}` });
                            continue; // never overwrite a divergent invoking-tree record
                        }
                        writeFileSync(targetPath, sourceBytes, { flag: 'wx' });
                    }
                }
                // 0984 R3/R4: copy the validated cited evidence. Re-check the target at write
                // time — the record copy above may have created an identical `<runId>.md` /
                // `.state.json` citation since the validation pass ran.
                for (const cited of citedCopies) {
                    const sourceBytes = await readFile(cited.sourcePath);
                    const existing = await readExistingRunFile(cited.targetPath);
                    if (existing !== undefined) {
                        if (!existing.equals(sourceBytes)) {
                            throw new Error(
                                `persist-out: cited run evidence .spur/run/${cited.name} diverges from the invoking ` +
                                    "tree's existing file — refusing to overwrite; reconcile the two copies by hand (0984 R4)",
                            );
                        }
                        continue; // byte-identical — idempotent no-op
                    }
                    writeFileSync(cited.targetPath, sourceBytes, { flag: 'wx' });
                }
                // 1026 R7: carry the durable per-run dirs (the record pair lives inside;
                // agent sessions and artifacts ride along) with record conflict=skip semantics.
                for (const id of recordIds) {
                    await carryRunRecordDir(fromRecordsDir, toRecordsDir, '', id, recordSkips, referenceMoves);
                }
            }
            await redirectRunStorageReferences(target.adapter, referenceMoves);
            return {
                ok: true,
                persisted: persistedIds.length,
                skipped: [...skipped, ...recordSkips, ...citedSkips],
                ...(evidenceSkipped.length > 0 ? { evidenceSkipped } : {}),
            };
        } finally {
            target.close();
        }
    } finally {
        source.close();
    }
}

/**
 * Resolve the workflow, then create-or-attach the authoritative run row.
 * Every refusal leaves the database untouched (the row under conflict is never mutated).
 */

async function carryRunRecordDir(
    srcRoot: string,
    destRoot: string,
    rel: string,
    runId: string,
    skips: Array<{ id: string; reason: string }>,
    moves: Array<{ source: string; target: string }>,
): Promise<void> {
    const fs = createNodeFileSystem();
    await resolveDurableArtifactPath(fs, resolve(srcRoot, '../../..'), join(srcRoot, rel, 'probe'), 'runs');
    await resolveDurableArtifactPath(fs, resolve(destRoot, '../../..'), join(destRoot, rel, 'probe'), 'runs');
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
        entries = await readdir(join(srcRoot, rel), { withFileTypes: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            // 1148 R2: the run's source directory is absent — name it instead of returning
            // silently, so "nothing to carry" and "carried nothing" do not look the same.
            // A missing per-ROW record (the directory exists, the pair does not) stays the
            // record-copy path's `record-missing:<file>` report (0984 R5).
            if (rel === '') skips.push({ id: runId, reason: 'source-missing' });
            return;
        }
        throw error;
    }
    for (const entry of entries) {
        if (rel === '' && ![runId, `${runId}.md`, `${runId}.state.json`, `${runId}.log`].includes(entry.name)) continue;
        const relNext = rel === '' ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
            await carryRunRecordDir(srcRoot, destRoot, relNext, runId, skips, moves);
            const target = join(destRoot, relNext);
            if (existsSync(target))
                moves.push({ source: join(srcRoot, relNext), target: fs.realPath?.(target) ?? target });
            continue;
        }
        const source = await resolveDurableArtifactPath(
            fs,
            resolve(srcRoot, '../../..'),
            join(srcRoot, relNext),
            'runs',
        );
        const dest = await resolveDurableArtifactPath(
            fs,
            resolve(destRoot, '../../..'),
            join(destRoot, relNext),
            'runs',
        );
        if (!(await lstat(source)).isFile())
            throw new Error(`persist-out: retained item is not a regular file: ${source}`);
        const sourceBytes = await readFile(source);
        const existing = await readExistingRunFile(dest);
        if (existing !== undefined) {
            if (!existing.equals(sourceBytes)) {
                if (rel !== '') throw new Error(`persist-out: retained data conflicts: ${relNext}`);
                skips.push({ id: `${runId}/${relNext}`, reason: `record-conflict:${relNext}` });
                continue;
            }
        } else {
            await mkdir(join(dest, '..'), { recursive: true });
            writeFileSync(dest, sourceBytes, { flag: 'wx' });
        }
        moves.push({ source, target: fs.realPath?.(dest) ?? dest });
        moves.push({ source: join(srcRoot, relNext), target: fs.realPath?.(dest) ?? dest });
        if (rel !== '')
            moves.push({
                source: join(srcRoot, rel),
                target: fs.realPath?.(join(destRoot, rel)) ?? join(destRoot, rel),
            });
    }
}

/** Input for {@link runPersistOut}. */
export interface PersistOutInput {
    /** The worktree (or any project dir) whose run provenance is copied out. */
    readonly from: string;
    /** Merged task files whose citations/owned evidence ride along (relative to the invoking tree). */
    readonly taskFiles: readonly string[];
    /** Invoking tree that receives the rows (default: the process cwd, which the CLI supplies). */
    readonly to?: string;
}

/**
 * `spur workflow persist-out` — copy the worktree's run rows and evidence into the invoking tree
 * and report the JSON result. Exit 0 persisted, 1 fail closed (the caller retains the worktree).
 */
/** Output the CLI writes: this layer computes bytes, it never touches process streams. */
export interface PersistOutResult {
    readonly exitCode: number;
    readonly stdout: readonly string[];
    readonly stderr: readonly string[];
}

/**
 * `spur workflow persist-out` — copy a worktree's run provenance and owned evidence into the
 * invoking tree before teardown, returning the lines the CLI prints (this layer writes no stream).
 * Exit 1 is fail-closed: an external-key or record conflict means the batch was NOT persisted, so
 * the caller must retain the worktree.
 */
export async function runPersistOut(input: PersistOutInput): Promise<PersistOutResult> {
    const out: string[] = [];
    const err: string[] = [];
    // One target for the whole pass: the CLI passes its cwd, a test passes a temp tree.
    const toWorkdir = input.to ?? process.cwd();
    try {
        const result = await persistWorktreeRuns({
            fromWorkdir: input.from,
            toWorkdir,
            ...(input.taskFiles.length > 0 ? { taskFiles: input.taskFiles } : {}),
        });
        // 1049: an `external-key-conflict` skip means the source run's provenance identity
        // (workflow_name, external_key) already belongs to a different receiving run — the
        // batch was NOT persisted, so automatic worktree teardown would orphan provenance.
        // Same fail-closed channel as record conflicts: exit 1, driver routes to WT-5.
        //
        // 1090 follow-up: only a source run that OWNS child rows can orphan anything. The
        // transfer grades a childless conflict as `external-key-conflict-bookkeeping` — a bare
        // bookkeeping row the pipeline precheck's auto-profile feature reopen created in the
        // execution tree while the invoking tree already owned that key. It is reported (so the
        // operator still sees it) but does not fail the pass, because teardown loses nothing.
        const keyConflicts = result.skipped.filter((skip) => skip.reason === 'external-key-conflict');
        if (keyConflicts.length > 0 || result.skipped.some((skip) => skip.reason.startsWith('record-conflict:'))) {
            // Name what DID land. The durable-evidence and cited/owned file copies run BEFORE the
            // run-row transfer, so by the time this refusal fires the evidence plane is usually
            // already in the invoking tree — the operator could not tell that from a bare "the
            // batch was NOT persisted" and had to verify plane by plane by hand (task 1090).
            const landed =
                `already persisted before this refusal: ${result.persisted} run row(s)` +
                `${result.skipped.length > 0 ? `, ${result.skipped.length} skipped` : ''};` +
                ' the durable evidence plane and every cited/owned .spur/run file were copied by the same pass';
            const error =
                keyConflicts.length > 0
                    ? `persist-out: external-key conflict for source runs ${keyConflicts.map((skip) => skip.id).join(', ')}; ${landed}. retain the source worktree and reconcile provenance before teardown`
                    : `persist-out: unresolved retained record conflicts; ${landed}. retain the worktree and reconcile copies before teardown`;
            out.push(JSON.stringify({ ...result, ok: false, error }));
            return { exitCode: 1, stdout: out, stderr: err };
        }
        const resultPayload = {
            ok: true,
            persisted: result.persisted,
            skipped: result.skipped,
            ...(result.evidenceSkipped ? { evidenceSkipped: result.evidenceSkipped } : {}),
        };
        try {
            const toRunDir = join(toWorkdir, '.spur', 'run');
            mkdirSync(toRunDir, { recursive: true });
            writeFileSync(join(toRunDir, 'persist-out.json'), JSON.stringify(resultPayload, null, 2));
        } catch {}
        // 1149 R3: reconcile the receiving lifecycle row for each forwarded task whose file is terminal
        if (input.taskFiles.length > 0) {
            try {
                const targetDb = await openInlineRunProjectDb(toWorkdir);
                try {
                    for (const taskFile of input.taskFiles) {
                        const wbs = /^(\d{4})_/.exec(basename(taskFile))?.[1];
                        if (!wbs) continue;
                        try {
                            const raw = readFileSync(resolve(toWorkdir, taskFile), 'utf8');
                            const status = MarkdownDocument.parse(raw, 'task').frontmatterData?.status;
                            if (typeof status === 'string' && (status === 'done' || status === 'cancelled')) {
                                await reconcileExistingLifecycleRow(
                                    async () => targetDb.adapter,
                                    TASK_LIFECYCLE_PROFILE,
                                    wbs,
                                    status,
                                );
                            }
                        } catch (error) {
                            err.push(
                                `persist-out: reconcile skipped for ${wbs}: ${error instanceof Error ? error.message : String(error)}`,
                            );
                        }
                    }
                } finally {
                    targetDb.close();
                }
            } catch (error) {
                // Best-effort (1149 R3): the persist already succeeded; name the miss so a stale row is visible.
                err.push(
                    `persist-out: lifecycle reconcile unavailable: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }
        out.push(JSON.stringify(resultPayload));
        return { exitCode: 0, stdout: out, stderr: err };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        out.push(JSON.stringify({ ok: false, error: message }));
        return { exitCode: 1, stdout: out, stderr: err };
    }
}
