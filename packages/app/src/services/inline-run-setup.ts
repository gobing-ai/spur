/**
 * Inline full-pipeline run setup — authoritative workflow run identity (task 0804 R1).
 *
 * The interactive inline driver (inline-pipeline-driver.md) allocates a run id and a task
 * link but, unlike the subprocess path (`spur workflow run`), never persisted an
 * authoritative `runs` row — so bound `run.artifact` registration (0785 R3) correctly
 * refused every inline record. This module is the setup operation the driver now runs at
 * Run setup: resolve the SAME project/registered/shared definition the engine would
 * launch, compute the canonical definition digest with the exported hash machinery, and
 * create-or-attach the run row through the existing engine persistence adapter — no raw
 * SQL, no second hasher, no synthetic lifecycle outcome (a fresh row is `running`, never
 * a fabricated `done`).
 *
 * Attach is identity-checked, never blind: an existing row attaches only when its
 * workflow name, effective definition digest (resume digest wins over launch digest, the
 * same precedence `run.artifact` enforces) and recorded definition source
 * (path/layer/workdir) all match the freshly resolved definition. Conflicting
 * project/definition identity is refused with an actionable error; a changed definition
 * must go through the existing explicit resume rules (workflow-service resume stamps
 * `resumeDefinitionDigest`). Identical resume is idempotent.
 *
 * The result carries the authoritative id/digest so the driver can seed the inline var
 * overlay (`__runId`, `__definitionDigest`) that proof capture and bound registration
 * verify against.
 */

// Hoisted to module scope per task 0809 R5 ("replace the shadowed dynamic path/fs imports
// with module-level imports"): the binding lives at module scope, not inside
// `openInlineRunProjectDb`. The top-level-await dynamic form is deliberate — the standing
// runtime-boundaries fs rule (recommended pre-check preset) forbids a static node:fs
// import in application sources. Task 1006 R3 widens the destructure for the driver
// bookkeeping moved here from plugins/sp/scripts/inline-run-setup.ts (run-record pair
// writes, run-log appends).
const {
    appendFileSync,
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    unlinkSync,
    writeFileSync,
    writeSync,
} = await import('node:fs');
const { copyFile, lstat, mkdir, readdir, readFile } = await import('node:fs/promises');

import { basename, join, resolve } from 'node:path';
import type { DbAdapter, RunDefinitionSource } from '@gobing-ai/spur-domain';
import {
    createMigratedDb,
    listRunIdRows,
    normalizePersistedWorkflowLayer,
    RunDao,
    transferRunTables,
} from '@gobing-ai/spur-domain';
import {
    createDefaultWorkflowEngineHost,
    DbWorkflowPersistenceAdapter,
    WorkflowService as EngineWorkflowService,
} from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { createWorkflowActionTraceWriter } from '../workflow/action-trace';
import { DecideActionRunner, DecideOptionsSchema } from '../workflow/actions/decide';
import { computeProofInputFingerprint, readProofInputContents } from '../workflow/proof-input-fingerprint';
import { InvalidWorkflowRunIdError } from '../workflow/run-record';
import { isBookkeepingWorkflow } from '../workflow/terminal-reason';
import { assertInventoryIdentity, parseWorkflowInventory } from '../workflow/workflow-inventory';
import {
    type ResolvedWorkflowDefinition,
    resolveWorkflowDefinition,
    type WorkflowLayerId,
} from '../workflow/workflow-resolver';
import { ensureDurablePlaneIgnored, runStoragePaths } from './run-storage';
import { workflowVersionLiteral } from './workflow-service';

/** Input for {@link createOrAttachInlineRun}. */
export interface InlineRunSetupInput {
    /** Absolute project working directory the inline pipeline executes in. */
    readonly workdir: string;
    /** Lazily resolves the project DB adapter (the same DB the engine persists to). */
    readonly getDb: () => Promise<DbAdapter>;
    /** Workflow file path or name, exactly as the driver selected it. */
    readonly file: string;
    /** Collision-resistant run id allocated by the driver's Run setup. */
    readonly runId: string;
    /** Embedded `$schema` map for composition-root parity; optional. */
    readonly embeddedSchemas?: ReadonlyMap<string, string>;
    /** CLI-selected definition for a detached plugin install; revalidated before any run write. */
    readonly inventory?: unknown;
    /** Registered paths supplied by the caller's already-loaded configuration. */
    readonly registered?: readonly string[];
}

/** Successful setup: authoritative identity for the inline var overlay and the run log. */
export interface InlineRunSetupSuccess {
    readonly ok: true;
    /** True when an identity-matching row already existed (identical resume). */
    readonly attached: boolean;
    readonly runId: string;
    readonly workflowName: string;
    /** Canonical definition digest — seeds the inline `__definitionDigest` var. */
    readonly definitionDigest: string;
    readonly workflowVersion: string | null;
    readonly resolvedPath: string;
    readonly layer: WorkflowLayerId;
    readonly workdir: string;
    /** Lifecycle status of the attached/created row (`running` for a fresh row). */
    readonly status: string;
}

/** Failed setup: fail closed — the driver must stop rather than run unbound. */
export interface InlineRunSetupFailure {
    readonly ok: false;
    readonly error: string;
}

/** Result of {@link createOrAttachInlineRun}: an attached/created row, or a fail-closed refusal. */
export type InlineRunSetupOutcome = InlineRunSetupSuccess | InlineRunSetupFailure;

/**
 * Row metadata identity the engine and this setup stamp (`RunDao.stampRunIdentity`).
 * The source block is optional only for rows that predate 0784 and carry no digest at
 * all; such a row can never prove its identity, so setup refuses it.
 */
interface RunIdentityMetadata {
    definitionDigest?: unknown;
    resumeDefinitionDigest?: unknown;
    workflowVersion?: unknown;
    definitionSource?: unknown;
}

function parseIdentityMetadata(raw: string): RunIdentityMetadata | null {
    if (raw.trim() === '') return {};
    try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        return parsed as RunIdentityMetadata;
    } catch {
        return null;
    }
}

/** The project DB handle handed to {@link createOrAttachInlineRun} by {@link openInlineRunProjectDb}. */
export interface InlineRunProjectDb {
    readonly adapter: DbAdapter;
    readonly close: () => void;
}

/**
 * Open the canonical project database (`.spur/spur.db`, migrated, 30s busy timeout) for
 * inline run setup — the same URL/migrations/busy-timeout posture the CLI composition
 * root uses (apps/cli/src/context.ts `createMigratedDbAdapter`). Exposed so the internal
 * plugin-script delegate can construct the {@link InlineRunSetupInput.getDb} seam without
 * reimplementing any persistence policy.
 */
export async function openInlineRunProjectDb(workdir: string): Promise<InlineRunProjectDb> {
    const url = join(resolve(workdir), '.spur', 'spur.db');
    mkdirSync(join(url, '..'), { recursive: true });
    const adapter = await createMigratedDb({ url });
    return { adapter, close: () => adapter.close() };
}

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
}

/**
 * DB-sourced run ids become `.spur/run/<id>.md` / `.state.json` filenames in the invoking
 * tree, so every id read from the worktree DB must be a single safe filename component —
 * the same charset the script's `SAFE_RUN_ID_RE` arg guard (task 0804 R8) enforces for
 * driver-supplied ids. The script keeps its own copy (portable twin); this persistence
 * seam re-checks because its ids come from the worktree DB, not the driver.
 */
const SAFE_RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Cap on distinct literal `.spur/run/<file>` citations one persist-out copies/verifies for
 * the merged task files (0984 R3). A fixed bound keeps the copy set proportional to the
 * batch's corpus, not to whatever a hand-edited task file lists.
 */
export const MAX_CITED_RUN_FILES = 64;

/**
 * A cited run-evidence reference extracted from a merged task file (0984 R3): `.spur/run/`
 * followed by name characters. The charset deliberately includes template metachars
 * (`*`, `…`, `{`, `<`, `?`, `,`) so abbreviated and glob references stay attached to one
 * capture and are classified non-literal by {@link asLiteralRunFileName}, instead of a
 * truncated prefix (`fadca099-` out of `fadca099-…-wrapup-learnings.md`) masquerading as a
 * real filename. The leading alnum requirement already refuses `<runId>-…` placeholders and
 * `..` traversal outright. The lookbehind keeps only repo-relative citations (`.spur/run/…`,
 * `./.spur/run/…`): a root-qualified path (`knowledge-kit/.spur/run/…`, `/abs/.spur/run/…`,
 * `~/.spur/run/…`) is another project's evidence, which this teardown neither owns nor can
 * lose, so it must not trip the missing-in-both refusal.
 */
const RUN_CITATION_RE = /(?<![\w~:-]|[\w~:-]\/)\.spur\/run\/([A-Za-z0-9][A-Za-z0-9._*?<>{}|,\u2026-]*)/g;

/**
 * Reduce one captured reference to a literal direct-child file name, or `undefined` when it
 * is not one (0984 R3): template/abbreviated references (`fadca099-…`, `run-*-ac87.log`,
 * `{batch-report.md,…}`) and `..` runs are not literal files, so they carry no copy
 * obligation and never fail the pass. A surviving name is a single safe component — joining
 * it under `.spur/run/` cannot escape the directory. Trailing sentence punctuation is prose,
 * not name: `… .spur/run/x.json.` must not become a phantom `x.json.` (fatal, blocks
 * teardown) and `… .spur/run/x.json, …` must not drop the citation as non-literal.
 */
function asLiteralRunFileName(citation: string): string | undefined {
    const name = citation.replace(/[.,]+$/, '');
    if (!SAFE_RUN_ID_RE.test(name) || name.includes('..')) return undefined;
    return name;
}

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
 * each persisted run's two-file run record (`.spur/run/<id>.md` + `.state.json`). An
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
 * Any other persistence failure (unreadable worktree DB, unwritable target, or a source run
 * id that is not a safe filename component — rejected as {@link InvalidWorkflowRunIdError}
 * before any target write) throws — the caller routes to WT-5 and the worktree is retained,
 * so a green run can never destroy its own evidence.
 */
export async function persistWorktreeRuns(input: PersistWorktreeRunsInput): Promise<PersistWorktreeRunsSuccess> {
    const fromDir = resolve(input.fromWorkdir);
    const toDir = resolve(input.toWorkdir);
    const fromRunDir = join(fromDir, '.spur', 'run');
    const toRunDir = join(toDir, '.spur', 'run');
    // 1026 R7: the durable run-record plane migrates alongside the scratch evidence.
    const fromRecordsDir = runStoragePaths(fromDir).recordsDir;
    const toRecordsDir = runStoragePaths(toDir).recordsDir;

    // 0984 R1–R3: citation selection and validation run BEFORE any DB or file write, so an
    // unresolved/unsafe/over-cap citation fails with zero side effects (the driver blocks
    // teardown on the non-zero exit and retains the worktree via WT-5).
    const citedNames = new Set<string>();
    for (const taskFile of input.taskFiles ?? []) {
        let content: string;
        try {
            content = await readFile(resolve(toDir, taskFile), 'utf8');
        } catch (error) {
            throw new Error(`persist-out: merged task file ${taskFile} is unreadable: ${String(error)}`);
        }
        for (const match of content.matchAll(RUN_CITATION_RE)) {
            const name = asLiteralRunFileName(match[1] ?? '');
            if (name === undefined || citedNames.has(name)) continue;
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
        const prefixes = (input.taskFiles ?? []).flatMap((taskFile) => {
            const wbs = /^(\d{4})_/.exec(basename(taskFile))?.[1];
            return wbs === undefined ? [] : [`${wbs}-`];
        });
        const recordNames = new Set<string>();
        const owner = await openInlineRunProjectDb(fromDir);
        try {
            for (const row of await listRunIdRows(owner.adapter)) {
                if (!SAFE_RUN_ID_RE.test(row.id)) throw new InvalidWorkflowRunIdError(row.id);
                prefixes.push(`${row.id}-`);
                // The two-file run record is the record copy's job (conflict = skip, not throw).
                recordNames.add(`${row.id}.md`).add(`${row.id}.state.json`);
            }
        } finally {
            owner.close();
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
            if (targetBytes === undefined) {
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
        const target = await openInlineRunProjectDb(toDir);
        try {
            const { persistedIds, skipped } = await transferRunTables(source.adapter, target.adapter);
            const workflowNameById = new Map(runRows.map((row) => [row.id, row.workflowName]));
            const recordSkips: Array<{ id: string; reason: string }> = [];
            if (persistedIds.length > 0 || citedCopies.length > 0) {
                mkdirSync(toRunDir, { recursive: true });
                mkdirSync(toRecordsDir, { recursive: true });
                // 1026: durable record copies must not shift the proof-input tree.
                ensureDurablePlaneIgnored(toDir);
                for (const id of persistedIds) {
                    const workflowName = workflowNameById.get(id);
                    for (const fileName of [`${id}.md`, `${id}.state.json`]) {
                        let sourceBytes: Buffer;
                        try {
                            sourceBytes = await readFile(join(fromRecordsDir, fileName));
                        } catch (error) {
                            // 0984 R5: a known bookkeeping lifecycle row may have no two-file
                            // record at all (record-stage transitions create rows with zero
                            // children) — its source ENOENT is a reported skip, not an aborted
                            // transfer; the inserted row still counts in `persisted`. Every
                            // other workflow (task-pipeline runs above all) keeps the fatal
                            // green-run evidence guarantee, and non-ENOENT read errors stay fatal.
                            if (
                                workflowName !== null &&
                                workflowName !== undefined &&
                                isBookkeepingWorkflow(workflowName) &&
                                (error as NodeJS.ErrnoException).code === 'ENOENT'
                            ) {
                                recordSkips.push({ id, reason: `record-missing:${fileName}` });
                                continue;
                            }
                            throw error;
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
                for (const id of persistedIds) {
                    await carryRunRecordDir(fromRecordsDir, toRecordsDir, '', id, recordSkips);
                }
            }
            return {
                ok: true,
                persisted: persistedIds.length,
                skipped: [...skipped, ...recordSkips, ...citedSkips],
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
export async function createOrAttachInlineRun(input: InlineRunSetupInput): Promise<InlineRunSetupOutcome> {
    const runId = input.runId.trim();
    if (runId === '') {
        return { ok: false, error: 'inline run setup requires a non-empty runId (driver Run setup step 2)' };
    }
    const workdir = resolve(input.workdir);

    let resolved: ResolvedWorkflowDefinition;
    try {
        const projection = input.inventory === undefined ? undefined : parseWorkflowInventory(input.inventory);
        if (projection && !projection.ok) return projection;
        const inventory = projection?.ok ? projection.inventory : undefined;
        if (inventory && (!inventory.source || inventory.kind !== 'state-machine')) {
            return { ok: false, error: 'inline run setup requires a state-machine inventory with definition source' };
        }
        resolved = await resolveWorkflowDefinition(workdir, inventory?.source?.path ?? input.file, {
            validateSchema: true,
            ...(input.embeddedSchemas !== undefined ? { embeddedSchemas: input.embeddedSchemas } : {}),
            ...(!inventory ? { registered: input.registered } : {}),
        });
        if ((resolved.workflow.kind ?? 'state-machine') !== 'state-machine') {
            return { ok: false, error: 'inline run setup requires a state-machine definition' };
        }
        if (inventory?.source) {
            const identity = assertInventoryIdentity(inventory, resolved.digest);
            if (!identity.ok) return identity;
            if (inventory.name !== resolved.workflow.name) {
                return { ok: false, error: 'inline run setup: inventory workflow name does not match its definition' };
            }
            // The selected CLI owns layer resolution; explicit-path revalidation must not relabel it.
            resolved = { ...resolved, layer: inventory.source.layer };
        }
    } catch (error) {
        return {
            ok: false,
            error: `inline run setup could not resolve the workflow definition: ${(error as Error).message}`,
        };
    }

    const digest = resolved.digest;
    const version = workflowVersionLiteral(resolved.workflow);
    const source: RunDefinitionSource = { path: resolved.path, layer: resolved.layer, workdir };

    const db = await input.getDb();
    const runDao = new RunDao(db);
    const existing = await runDao.traceRowById(runId);

    if (existing !== undefined) {
        const metadata = parseIdentityMetadata(existing.metadata_json);
        if (metadata === null) {
            return {
                ok: false,
                error:
                    `inline run setup refuses run ${runId}: its existing row has malformed metadata_json, ` +
                    'so its identity cannot be verified — delete the stale run row or allocate a new run id',
            };
        }
        // Same precedence run.artifact enforces: an explicit resume digest wins.
        const resumeDigest =
            typeof metadata.resumeDefinitionDigest === 'string' ? metadata.resumeDefinitionDigest : undefined;
        const launchDigest = typeof metadata.definitionDigest === 'string' ? metadata.definitionDigest : undefined;
        const effectiveDigest = resumeDigest ?? launchDigest;
        if (effectiveDigest === undefined) {
            return {
                ok: false,
                error:
                    `inline run setup refuses run ${runId}: its existing row carries no definition digest ` +
                    '(pre-identity legacy row) — allocate a new run id instead of attaching an unverifiable identity',
            };
        }
        if (effectiveDigest !== digest) {
            return {
                ok: false,
                error:
                    `inline run setup refuses run ${runId}: the resolved definition digest (${digest}) does not match ` +
                    `the run's recorded ${resumeDigest !== undefined ? 'resume' : ''} digest (${effectiveDigest}) — ` +
                    'a changed definition must resume through the explicit resume rules, not silently re-attach',
            };
        }
        if (existing.workflow_name !== resolved.workflow.name) {
            return {
                ok: false,
                error:
                    `inline run setup refuses run ${runId}: the run row records workflow "${existing.workflow_name}" ` +
                    `but the resolved definition is "${resolved.workflow.name}" — conflicting run identity`,
            };
        }
        if (
            typeof metadata.definitionSource !== 'object' ||
            metadata.definitionSource === null ||
            Array.isArray(metadata.definitionSource)
        ) {
            return {
                ok: false,
                error:
                    `inline run setup refuses run ${runId}: its existing row carries no definition source ` +
                    '(path/layer/workdir) — allocate a new run id instead of attaching an unverifiable launch source',
            };
        }
        const existingSource = metadata.definitionSource as Partial<RunDefinitionSource>;
        const sourceMatches =
            typeof existingSource.path === 'string' &&
            resolve(existingSource.path) === resolved.path &&
            // ADR-113: a pre-rename row persisted `bundled`; it reads as `shared`.
            normalizePersistedWorkflowLayer(existingSource.layer) === resolved.layer &&
            typeof existingSource.workdir === 'string' &&
            resolve(existingSource.workdir) === workdir;
        if (!sourceMatches) {
            return {
                ok: false,
                error:
                    `inline run setup refuses run ${runId}: the recorded definition source ` +
                    `(${JSON.stringify(existingSource)}) does not match the resolved launch source ` +
                    `(${JSON.stringify(source)}) — conflicting project/workdir identity`,
            };
        }
        return {
            ok: true,
            attached: true,
            runId,
            workflowName: resolved.workflow.name,
            definitionDigest: digest,
            workflowVersion: version,
            resolvedPath: resolved.path,
            layer: resolved.layer,
            workdir,
            status: existing.status,
        };
    }

    // Create the row with the exact record shape the engine's RunLifecycle.runRecord uses
    // for state-machine runs (`running`, never a synthetic terminal status). The full launch
    // identity — canonical definition digest, workflow version (explicit null when the
    // definition is unversioned) and the resolved definition source — is persisted in THIS
    // initial insert (0809 R1), the same identity the engine stamps at creation (0768/0784):
    // an interruption right after the insert leaves a fully identified row, never an
    // empty-metadata window. Persistence is not best-effort: a failed insert fails the setup
    // fail-closed with no row; the call passes no external_key, so the engine rejects a
    // colliding id instead of adopting a foreign row.
    const engine = new EngineWorkflowService(createDefaultWorkflowEngineHost(), new DbWorkflowPersistenceAdapter(db));
    await engine.createOrAttachRun({
        id: runId,
        workflow_name: resolved.workflow.name,
        mode: 'state-machine',
        status: 'running',
        started_at: new Date().toISOString(),
        completed_at: null,
        metadata_json: JSON.stringify({
            definitionDigest: digest,
            workflowVersion: version,
            definitionSource: source,
        }),
    });

    return {
        ok: true,
        attached: false,
        runId,
        workflowName: resolved.workflow.name,
        definitionDigest: digest,
        workflowVersion: version,
        resolvedPath: resolved.path,
        layer: resolved.layer,
        workdir,
        status: 'running',
    };
}

/** Input for the inline driver's `--decide` mode (0941 R5). */
export interface InlineDecideInput {
    /** Absolute project working directory (options paths and the resultFile resolve here). */
    readonly workdir: string;
    /** Options JSON file path (relative to the workdir or absolute). */
    readonly optionsFile: string;
    /**
     * Config-derived `workflow.decideDecisionMaker` switch, resolved at the composition
     * boundary (the plugin delegate) — app services never load Spur config (ADR-082).
     */
    readonly enabled: boolean;
}

/** Result of {@link runDecideForInlineRun}: the decision row plus the resultFile it was written to. */
export interface InlineDecideOutcome {
    readonly ok: boolean;
    readonly error?: string;
    readonly value?: string;
    readonly degraded?: boolean;
    readonly reason?: string;
    /** Decision provenance (0976 R2): `model` = accepted backend answer; `default` = declared fallback. */
    readonly source?: 'model' | 'default';
    readonly backend?: string | null;
    readonly confidence?: number | null;
    readonly resultFile?: string;
    readonly durationMs?: number;
}

/**
 * Inline-driver decide execution (0941 R5): executes the SAME {@link DecideActionRunner} the
 * engine composition registers and writes the same resultFile row — no second decide
 * implementation. The decide-enabled switch is an explicit parameter: the composition
 * boundary (plugin delegate) resolves `workflow.decideDecisionMaker` and threads it in
 * (ADR-082). The caller (plugin script) owns the trace row through the shared
 * WorkflowActionTraceWriter.
 */
export async function runDecideForInlineRun(input: InlineDecideInput): Promise<InlineDecideOutcome> {
    const optionsFile = join(resolve(input.workdir), input.optionsFile);
    let raw: unknown;
    try {
        raw = JSON.parse(await readFile(optionsFile, 'utf8'));
    } catch (error) {
        return { ok: false, error: `decide: unreadable options file ${input.optionsFile}: ${String(error)}` };
    }
    const parsed = DecideOptionsSchema.safeParse(raw);
    if (!parsed.success) {
        return {
            ok: false,
            error: `decide: invalid options — ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        };
    }
    const runner = new DecideActionRunner(createNodeFileSystem(), { enabled: input.enabled });
    const result = await runner.execute(raw as Record<string, unknown>, {
        runId: 'inline-decide',
        stateOrNodeId: 'decide',
        workdir: resolve(input.workdir),
        vars: {},
        env: {},
    });
    if (!result.ok || result.data === undefined) {
        return { ok: false, error: result.error ?? 'decide: action failed without an error message' };
    }
    const decision = result.data.decision as {
        value: string;
        degraded: boolean;
        reason: string;
        source: 'model' | 'default';
        backend: string | null;
        confidence: number | null;
        durationMs: number;
    };
    return {
        ok: true,
        value: decision.value,
        degraded: decision.degraded,
        reason: decision.reason,
        source: decision.source,
        backend: decision.backend,
        confidence: decision.confidence,
        resultFile: join(resolve(input.workdir), parsed.data.resultFile),
        durationMs: decision.durationMs,
    };
}

// ─── Inline driver bookkeeping (task 1006 R3) ────────────────────────────────
// Moved verbatim from plugins/sp/scripts/inline-run-setup.ts: the run-record outcome
// writer, the close/action status vocabularies, the run-record log path/append and the
// ADR-117 trace emission. The plugin script is the argv/env delegate; these are the
// operations it delegates to through the generated twin (INLINE_RUN_EXPORTS).

/** Setup/driver outcome projected into the run-record state `.spur/run/<run-id>.state.json` (0927 R1). */
export interface InlineRunStateOutcome {
    readonly ok: boolean;
    readonly runId?: string;
    readonly attached?: boolean;
    readonly definitionDigest?: string;
    readonly workflowName?: string;
    readonly workflowVersion?: string | null;
    readonly resolvedPath?: string;
    readonly layer?: string;
    readonly workdir?: string;
    readonly status?: string;
    readonly error?: string;
}

/**
 * 1026 R7: carry one durable per-run dir (`.spur/memory/runs/<runId>/` — the record pair,
 * agent sessions and artifacts) from the worktree into the invoking tree with the records'
 * conflict semantics: an identical existing file is an idempotent no-op; a divergent one is
 * reported as `record-conflict:<rel>` and left untouched. Missing source → nothing to carry.
 */
async function carryRunRecordDir(
    srcRoot: string,
    destRoot: string,
    rel: string,
    runId: string,
    skips: Array<{ id: string; reason: string }>,
): Promise<void> {
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
        entries = await readdir(join(srcRoot, rel), { withFileTypes: true });
    } catch {
        return; // ENOENT/ENOTDIR — nothing durable to carry
    }
    for (const entry of entries) {
        const relNext = rel === '' ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
            await carryRunRecordDir(srcRoot, destRoot, relNext, runId, skips);
            continue;
        }
        const sourceBytes = await readFile(join(srcRoot, relNext)).catch(() => undefined);
        if (sourceBytes === undefined) continue;
        const dest = join(destRoot, relNext);
        const existing = await readFile(dest).catch(() => undefined);
        if (existing !== undefined) {
            if (!existing.equals(sourceBytes)) {
                skips.push({ id: `${runId}/${relNext}`, reason: `record-conflict:${relNext}` });
            }
            continue; // identical — idempotent no-op
        }
        await mkdir(join(dest, '..'), { recursive: true });
        await copyFile(join(srcRoot, relNext), dest);
    }
}

/**
 * Project the setup/driver outcome into the two-file run record (task 0927 R1): the machine
 * state merges into the durable `<run-id>.state.json` (atomic same-directory temp + rename, the
 * 0925 R1 pattern) and the durable `<run-id>.md` receives its run-start header exactly once.
 * 1026 R1: both files live under `.spur/memory/runs/`, outside scratch. A re-setup of the
 * same run id rewrites the state from the current outcome but keeps the prior `startedAt`.
 * Identity/provenance fields only — never prompt bodies (0927 AC2).
 */
export function writeInlineRunOutcome(runId: string, outcome: InlineRunStateOutcome): void {
    const runDir = runStoragePaths(process.cwd()).recordsDir;
    if (!existsSync(runDir)) mkdirSync(runDir, { recursive: true });
    const statePath = join(runDir, `${runId}.state.json`);
    const markdownPath = join(runDir, `${runId}.md`);
    let prior: Record<string, unknown> = {};
    try {
        const parsed: unknown = JSON.parse(readFileSync(statePath, 'utf8'));
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            prior = parsed as Record<string, unknown>;
        }
    } catch {
        // No prior state (new run) or unreadable file — the outcome alone defines the state.
    }
    const at = new Date().toISOString();
    const state = {
        schemaVersion: 1 as const,
        runId,
        ...(outcome.workflowName !== undefined ? { workflowName: outcome.workflowName } : {}),
        ...(outcome.status !== undefined ? { status: outcome.status } : {}),
        startedAt: typeof prior.startedAt === 'string' ? prior.startedAt : at,
        updatedAt: at,
        ...(outcome.attached !== undefined ? { attached: outcome.attached } : {}),
        ...(outcome.definitionDigest !== undefined ? { definitionDigest: outcome.definitionDigest } : {}),
        ...(outcome.workflowVersion !== undefined ? { workflowVersion: outcome.workflowVersion } : {}),
        ...(outcome.resolvedPath !== undefined ? { resolvedPath: outcome.resolvedPath } : {}),
        ...(outcome.layer !== undefined ? { layer: outcome.layer } : {}),
        ...(outcome.workdir !== undefined ? { workdir: outcome.workdir } : {}),
        // 0948 R7: project the setup outcome itself, so the retired `-inline-setup.json`
        // sidecar's `ok` is still readable from the pair, and a SUCCESSFUL re-setup
        // explicitly drops any prior `error` — a stale failure message must not outlive
        // the failure it described (the state object is rebuilt, never merged with `prior`).
        ok: outcome.ok,
        ...(outcome.ok === false && outcome.error !== undefined ? { error: outcome.error } : {}),
    };
    const temp = `${statePath}.tmp`;
    try {
        writeFileSync(temp, `${JSON.stringify(state, null, 4)}\n`);
        renameSync(temp, statePath);
    } catch {
        // Best-effort: a failing record write must not wedge setup reporting — and never
        // leaves `.tmp` residue behind (0926 R1).
        try {
            unlinkSync(temp);
        } catch {
            // Nothing to clean (temp was never created).
        }
    }
    // 0948 R7: create the header with `wx` (O_EXCL) instead of `existsSync` → `appendFileSync`.
    // The check-then-append pair could append a SECOND header when two setups raced, and it
    // kept "header present" as a separate fact from the identity write. One exclusive create
    // makes exactly-one-header atomic; EEXIST just means it is already there.
    let headerFd: number | undefined;
    try {
        headerFd = openSync(markdownPath, 'wx');
        writeSync(
            headerFd,
            `# spur inline run ${runId} — ${outcome.workflowName ?? 'unknown workflow'} — setup ${at}\n`,
        );
    } catch {
        // EEXIST (already written) or an unwritable path — the human header is not the setup
        // identity, so this stays best-effort exactly like the state write above.
    } finally {
        if (headerFd !== undefined) closeSync(headerFd);
    }
}

/** Terminal statuses the inline driver may declare when closing its run row. */
const CLOSE_STATUSES: ReadonlySet<string> = new Set<'done' | 'failed' | 'paused'>(['done', 'failed', 'paused']);

/** Narrow an argv `--status` to the close vocabulary (`CLOSE_STATUSES`). */
export function isInlineRunCloseStatus(status: string): status is 'done' | 'failed' | 'paused' {
    return CLOSE_STATUSES.has(status);
}

/** Finalize statuses — a finish emission is terminal, so only done|failed are valid (0868 #4). */
const ACTION_STATUSES: ReadonlySet<string> = new Set<'done' | 'failed'>(['done', 'failed']);

/** Narrow an argv `--status` to the finalize vocabulary (`ACTION_STATUSES`). */
export function isInlineRunActionStatus(status: string): status is 'done' | 'failed' {
    return ACTION_STATUSES.has(status);
}

/** Input for the ADR-117 emission modes (`--action` / `--close`); the plugin delegate builds it from argv. */
export interface InlineRunTraceInput {
    readonly runId: string;
    readonly close: boolean;
    readonly node: string;
    readonly kind: string;
    /** Declared terminal reason (0937 R2) — validated against the closed enum before this point. */
    readonly reason?: string;
    /**
     * Trace status: the finalize vocabulary plus the close-only `paused` (`CLOSE_STATUSES`).
     * Both are assignable to the engine's `WorkflowStatus`.
     */
    readonly status: 'done' | 'failed' | 'paused';
    readonly ok: boolean;
    readonly durationMs: number;
}

/**
 * The run-record file for appended driver lines (task 0927 R1): the durable `<run-id>.md`
 * under `.spur/memory/runs/` for pair-based runs. A legacy run that predates the pair keeps
 * appending to its declared legacy `<run-id>.log` — the same precedence as
 * `readWorkflowRunRecord` (the pair wins, legacy stays readable in place).
 */
export function inlineRunRecordLogPath(runDir: string, runId: string): string {
    const markdownPath = join(runDir, `${runId}.md`);
    const legacyLogPath = join(runDir, `${runId}.log`);
    if (existsSync(legacyLogPath) && !existsSync(markdownPath)) return legacyLogPath;
    return markdownPath;
}

/**
 * Append one emission-failure/provenance line to the run record — the durable
 * `.spur/memory/runs/<run-id>.md` (1026 R1), the run log the inline driver already
 * owns. Best-effort and synchronous (the process may
 * exit immediately after), and never throws: an unwritable log must not wedge the run
 * (ADR-117 R3).
 */
export function appendInlineRunLogLine(runId: string, detail: string): void {
    try {
        const runDir = runStoragePaths(process.cwd()).recordsDir;
        if (!existsSync(runDir)) mkdirSync(runDir, { recursive: true });
        const safeRunId = runId.replace(/[^A-Za-z0-9._-]/g, '_');
        const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
        appendFileSync(inlineRunRecordLogPath(runDir, safeRunId), `[${stamp}] ${detail}\n`);
    } catch {
        // Best-effort (R3): the run continues even when the failure cannot be recorded.
    }
}

/**
 * Emit one trace write through the SHARED `WorkflowActionTraceWriter` (task 0868 R5/R7).
 * `--action` is best-effort: an emission failure is recorded to the run log and reported
 * on stdout as `{"ok":false}`, and the caller exits 0 so the run still reaches its declared
 * terminal state (R3/R12). `--close` is bookkeeping, so a missing run row or a persistence
 * failure fails loudly with exit 1 (review findings #1/#4). Callable once per action — the
 * inline driver loops it across the run's action boundaries (task 1007 handoff).
 */
export async function runInlineRunTrace(input: InlineRunTraceInput): Promise<number> {
    const operation = input.close ? 'run.close' : 'action.finish';
    const fail = (error: string): number => {
        appendInlineRunLogLine(
            input.runId,
            `trace-emission-failed operation=${operation} run=${input.runId}` +
                `${input.node === '' ? '' : ` node=${input.node}`}${input.kind === '' ? '' : ` kind=${input.kind}`}: ${error}`,
        );
        process.stdout.write(`${JSON.stringify({ ok: false, runId: input.runId, error })}\n`);
        // The action boundary is best-effort (exit 0); the run-row closure fails loudly (exit 1).
        return input.close ? 1 : 0;
    };

    let projectDb: { adapter: DbAdapter; close: () => void } | undefined;
    try {
        projectDb = await openInlineRunProjectDb(process.cwd());
        const writer = createWorkflowActionTraceWriter(projectDb.adapter, (failure: unknown) => {
            const detail = failure as { operation?: string; error?: string };
            appendInlineRunLogLine(
                input.runId,
                `trace-emission-failed operation=${detail.operation ?? operation} run=${input.runId}: ${detail.error ?? 'unknown error'}`,
            );
        });
        const result = (
            input.close
                ? await writer.closeRun(input.runId, input.status, undefined, input.reason)
                : await writer.recordAction({
                      runId: input.runId,
                      node: input.node,
                      kind: input.kind,
                      status: input.status,
                      ok: input.ok,
                      durationMs: input.durationMs,
                  })
        ) as Record<string, unknown>;
        if (result.ok !== true && result.failure !== undefined) {
            // One stdout shape for emission failures (0868 finding #1): flatten the guard's
            // nested failure object to the same `{ok, runId, error}` the direct paths emit.
            const failure = result.failure as { error?: string };
            return fail(failure.error ?? 'unknown trace emission failure');
        }
        if (input.close && input.status === 'done' && result.actionRows === 0) {
            // A run finalized `done` with ZERO recorded action rows is a bookkeeping defect
            // (task 0975 R2): the row is already terminal — closeRun ran above — but the
            // driver must surface this instead of reporting a clean close, and must never
            // backfill rows. Exit 1 with the named code; the run record carries the finding.
            const error = `run ${input.runId} closed done with zero action_runs rows`;
            appendInlineRunLogLine(input.runId, `trace-close-failed run=${input.runId}: ${error}`);
            process.stdout.write(
                `${JSON.stringify({ ok: false, runId: input.runId, error, code: 'NO_ACTION_ROWS', actionRows: 0 })}\n`,
            );
            return 1;
        }
        process.stdout.write(`${JSON.stringify({ ...result, runId: input.runId })}\n`);
        return 0;
    } catch (error) {
        if (input.close && (error as { name?: string }).name === 'RunRowNotFoundError') {
            // The run row must exist before --close can mark it terminal (R6); a missing row
            // is a loud correctness failure, not a best-effort emission failure (finding #4).
            const message = error instanceof Error ? error.message : String(error);
            appendInlineRunLogLine(input.runId, `trace-close-failed run=${input.runId}: ${message}`);
            process.stdout.write(
                `${JSON.stringify({ ok: false, runId: input.runId, error: message, code: 'RUN_NOT_FOUND' })}\n`,
            );
            return 1;
        }
        return fail(error instanceof Error ? error.message : String(error));
    } finally {
        projectDb?.close();
    }
}

/** One `--actions-file` batch row (1007 R5): the `--action` argv shape as JSON. */
export interface InlineRunActionEntry {
    readonly node: string;
    readonly kind: string;
    /** Finalize vocabulary only — a batch row never pauses or closes (0868 #4). */
    readonly status: 'done' | 'failed';
    readonly ok: boolean;
    readonly durationMs: number;
}

/** Input for `runInlineRunTraceBatch` (`--actions-file`, 1007 R5). */
export interface InlineRunTraceBatchInput {
    readonly runId: string;
    readonly actionsFile: string;
}

/**
 * Batch trace emission (1007 R5): read a JSON array of `{node,kind,status,ok,durationMs}` rows
 * and record one `action_runs` row per entry through the SAME `WorkflowActionTraceWriter` as
 * `--action`. The whole file is parsed and validated BEFORE the database opens, so an
 * unreadable file, invalid JSON, or a malformed row exits 1 with no partial writes. Accepted
 * rows then emit best-effort (the `--action` contract): the first emission failure is logged
 * to the run record, reported as `{ok:false,runId,recorded,error}`, and the driver exits 0 so
 * the run still reaches its declared terminal state. Success: one stdout summary
 * `{ok:true,runId,recorded}` exit 0.
 */
export async function runInlineRunTraceBatch(input: InlineRunTraceBatchInput): Promise<number> {
    const batchFailed = (error: string): number => {
        process.stdout.write(`${JSON.stringify({ ok: false, runId: input.runId, error })}\n`);
        return 1;
    };
    let rows: unknown;
    try {
        rows = JSON.parse(readFileSync(input.actionsFile, 'utf8'));
    } catch (error) {
        return batchFailed(
            `cannot read actions file ${input.actionsFile}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    if (!Array.isArray(rows)) {
        return batchFailed('actions file must be a JSON array of {node,kind,status,ok,durationMs}');
    }
    const entries: InlineRunActionEntry[] = [];
    const rowError = (index: number, error: string): string => `actions[${index}]: ${error}`;
    for (const [index, row] of rows.entries()) {
        if (row === null || typeof row !== 'object' || Array.isArray(row)) {
            return batchFailed(rowError(index, 'entry must be a JSON object'));
        }
        const record = row as Record<string, unknown>;
        const { node, kind, status, ok, durationMs } = record;
        if (typeof node !== 'string' || node.trim() === '') {
            return batchFailed(rowError(index, 'node must be a non-empty string'));
        }
        if (typeof kind !== 'string' || kind.trim() === '') {
            return batchFailed(rowError(index, 'kind must be a non-empty string'));
        }
        if (typeof status !== 'string' || !isInlineRunActionStatus(status)) {
            return batchFailed(rowError(index, 'status must be "done" or "failed"'));
        }
        if (typeof ok !== 'boolean') return batchFailed(rowError(index, 'ok must be a boolean'));
        if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
            return batchFailed(rowError(index, 'durationMs must be a finite non-negative number'));
        }
        entries.push({ node, kind, status, ok, durationMs });
    }
    let projectDb: InlineRunProjectDb | undefined;
    let recorded = 0;
    const reportEmissionFailure = (node: string, kind: string, error: string): void => {
        appendInlineRunLogLine(
            input.runId,
            `trace-emission-failed operation=action.finish run=${input.runId} node=${node} kind=${kind}: ${error}`,
        );
        process.stdout.write(`${JSON.stringify({ ok: false, runId: input.runId, recorded, error })}\n`);
    };
    try {
        projectDb = await openInlineRunProjectDb(process.cwd());
        const writer = createWorkflowActionTraceWriter(projectDb.adapter, (failure: unknown) => {
            const detail = failure as { operation?: string; error?: string };
            appendInlineRunLogLine(
                input.runId,
                `trace-emission-failed operation=${detail.operation ?? 'action.finish'} run=${input.runId}: ${detail.error ?? 'unknown error'}`,
            );
        });
        for (const entry of entries) {
            const result = (await writer.recordAction({
                runId: input.runId,
                node: entry.node,
                kind: entry.kind,
                status: entry.status,
                ok: entry.ok,
                durationMs: entry.durationMs,
            })) as Record<string, unknown>;
            if (result.ok === true) {
                recorded += 1;
                continue;
            }
            const failure = result.failure as { error?: string } | undefined;
            reportEmissionFailure(entry.node, entry.kind, failure?.error ?? 'unknown trace emission failure');
            return 0;
        }
        process.stdout.write(`${JSON.stringify({ ok: true, runId: input.runId, recorded })}\n`);
        return 0;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendInlineRunLogLine(input.runId, `trace-emission-failed run=${input.runId}: ${message}`);
        process.stdout.write(`${JSON.stringify({ ok: false, runId: input.runId, recorded, error: message })}\n`);
        return 0;
    } finally {
        projectDb?.close();
    }
}

// ─── Driver mode runners (task 1006 R3) ──────────────────────────────────────
// The per-mode bodies moved from plugins/sp/scripts/inline-run-setup.ts so the plugin script
// stays within its ADR-130 glue budget (argv/env + entry resolution + dispatch). Each runner
// preserves the script's stdout/exit-code contract byte-for-byte; the decide-enabled switch is
// still resolved at the driver boundary and passed in as an explicit parameter (ADR-082).

/** Input for `runInlineRunFingerprint` (`--fingerprint`, 0862 R5). */
export interface InlineRunFingerprintInput {
    readonly taskFile: string;
    readonly featureFile?: string;
}

/** Print the engine's proof-input digest for the given spec files; create nothing. Exit code: 0 printed, 1 read/resolve failure. */
export async function runInlineRunFingerprint(input: InlineRunFingerprintInput): Promise<number> {
    const workdir = process.cwd();
    // `undefined` fs takes readProofInputContents' node-filesystem default — the same default its
    // sibling createGitAlternateTree applies, and the same Node FS the CLI's runner injects.
    const contents = await readProofInputContents(undefined, workdir, {
        taskFile: input.taskFile,
        ...(input.featureFile !== undefined && input.featureFile.trim() !== ''
            ? { featureFile: input.featureFile }
            : {}),
    });
    if (!contents.ok) {
        console.error(`inline-run-setup: FAIL — ${contents.error}`);
        return 1;
    }
    const digest = await computeProofInputFingerprint({
        cwd: workdir,
        ...(contents.taskContent !== undefined ? { taskContent: contents.taskContent } : {}),
        ...(contents.featureContent !== undefined ? { featureContent: contents.featureContent } : {}),
    });
    process.stdout.write(`${digest}\n`);
    return 0;
}

/** Input for `runInlineRunDecide` (`--decide`, 0941 R5); `enabled` is resolved at the driver boundary (ADR-082). */
export interface InlineRunDecideInput {
    readonly runId: string;
    readonly node: string;
    readonly optionsFile: string;
    readonly enabled: boolean;
}

/**
 * Execute the non-pausing decide action through the same app runner the engine registers, then
 * record the `action_runs` trace row (best-effort). Degraded outcomes are normal (`ok: true`,
 * exit 0); a failed outcome or a throw is `{"ok":false}` + exit 1 (fail closed).
 */
export async function runInlineRunDecide(input: InlineRunDecideInput): Promise<number> {
    const decideFailed = (error: string): number => {
        process.stdout.write(`${JSON.stringify({ ok: false, runId: input.runId, error })}\n`);
        return 1;
    };
    let outcome: InlineDecideOutcome;
    try {
        outcome = await runDecideForInlineRun({
            workdir: process.cwd(),
            optionsFile: input.optionsFile,
            enabled: input.enabled,
        });
    } catch (error) {
        return decideFailed(error instanceof Error ? error.message : String(error));
    }
    if (!outcome.ok) return decideFailed(outcome.error ?? 'decide failed without an error message');
    process.stdout.write(`${JSON.stringify({ runId: input.runId, node: input.node, ...outcome, ok: true })}\n`);
    // 0976 R2: the run log names the decision's provenance, so a declared-default fallback is
    // never read as a model decision. Best-effort through the same run-log appender.
    appendInlineRunLogLine(
        input.runId,
        `decide node=${input.node} value=${outcome.value ?? ''} source=${outcome.source ?? 'default'} reason=${outcome.reason ?? ''}`,
    );
    // Trace row is best-effort, exactly like --action: an emission failure never wedges the run.
    return runInlineRunTrace({
        runId: input.runId,
        close: false,
        node: input.node,
        kind: 'decide',
        status: 'done',
        ok: true,
        durationMs: outcome.durationMs ?? 0,
    });
}

/** Input for `runInlineRunPersistOut` (`--persist-out`, 0975 R1). */
export interface InlineRunPersistOutInput {
    readonly from: string;
    readonly taskFiles: readonly string[];
}

/** Copy the worktree's inline-run provenance into THIS tree; exit 1 on failure (driver routes to WT-5). */
export async function runInlineRunPersistOut(input: InlineRunPersistOutInput): Promise<number> {
    try {
        const result = await persistWorktreeRuns({
            fromWorkdir: input.from,
            toWorkdir: process.cwd(),
            ...(input.taskFiles.length > 0 ? { taskFiles: input.taskFiles } : {}),
        });
        process.stdout.write(`${JSON.stringify({ ok: true, persisted: result.persisted, skipped: result.skipped })}\n`);
        return 0;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
        return 1;
    }
}

/** Input for `runInlineRunSetup` (setup mode); `embeddedSchemas` rides along only in the portable layout. */
export interface InlineRunSetupDriverInput {
    readonly runId: string;
    readonly file: string;
    readonly inventory: unknown;
    readonly embeddedSchemas?: ReadonlyMap<string, string>;
}

/**
 * Create-or-attach the authoritative run row and project the outcome into the two-file run
 * record. Exit 0 = identity ready (created or idempotently attached); 1 = fail closed — the
 * driver must stop.
 */
export async function runInlineRunSetup(input: InlineRunSetupDriverInput): Promise<number> {
    const workdir = process.cwd();
    const projectDb = await openInlineRunProjectDb(workdir);
    let exitCode = 0;
    try {
        const result = await createOrAttachInlineRun({
            workdir,
            getDb: async () => projectDb.adapter,
            file: input.file,
            runId: input.runId,
            inventory: input.inventory,
            ...(input.embeddedSchemas !== undefined ? { embeddedSchemas: input.embeddedSchemas } : {}),
        });
        writeInlineRunOutcome(input.runId, result);
        if (!result.ok) {
            console.error(`inline-run-setup: FAIL for run ${input.runId}`);
            console.error(`  ${result.error}`);
            exitCode = 1;
        } else {
            console.error(
                `inline-run-setup: ${result.attached ? 'attached' : 'created'} run ${input.runId} ` +
                    `(${result.workflowName}, layer ${result.layer}, digest ${result.definitionDigest}, status ${result.status})`,
            );
        }
    } finally {
        projectDb.close();
    }
    return exitCode;
}
