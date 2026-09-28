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
// import in application sources.
const { mkdirSync, writeFileSync } = await import('node:fs');
const { lstat, readFile } = await import('node:fs/promises');

import { join, resolve } from 'node:path';
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
import { DecideActionRunner, DecideOptionsSchema } from '../workflow/actions/decide';
import { InvalidWorkflowRunIdError } from '../workflow/run-record';
import { isBookkeepingWorkflow } from '../workflow/terminal-reason';
import { assertInventoryIdentity, parseWorkflowInventory } from '../workflow/workflow-inventory';
import {
    type ResolvedWorkflowDefinition,
    resolveWorkflowDefinition,
    type WorkflowLayerId,
} from '../workflow/workflow-resolver';
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
    const citedCopies: Array<{ name: string; sourcePath: string; targetPath: string }> = [];
    const citedSkips: Array<{ id: string; reason: string }> = [];
    for (const name of citedNames) {
        const sourcePath = join(fromRunDir, name);
        const targetPath = join(toRunDir, name);
        const sourceStat = await lstat(sourcePath).catch(() => undefined);
        const targetBytes = await readFile(targetPath).catch(() => undefined);
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
                for (const id of persistedIds) {
                    const workflowName = workflowNameById.get(id);
                    for (const fileName of [`${id}.md`, `${id}.state.json`]) {
                        let sourceBytes: Buffer;
                        try {
                            sourceBytes = await readFile(join(fromRunDir, fileName));
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
                        const targetPath = join(toRunDir, fileName);
                        let existing: Buffer | undefined;
                        try {
                            existing = await readFile(targetPath);
                        } catch {
                            existing = undefined; // absent target — copy below
                        }
                        if (existing !== undefined) {
                            if (existing.equals(sourceBytes)) continue; // idempotent re-persist
                            recordSkips.push({ id, reason: `record-conflict:${fileName}` });
                            continue; // never overwrite a divergent invoking-tree record
                        }
                        writeFileSync(targetPath, sourceBytes);
                    }
                }
                // 0984 R3/R4: copy the validated cited evidence. Re-check the target at write
                // time — the record copy above may have created an identical `<runId>.md` /
                // `.state.json` citation since the validation pass ran.
                for (const cited of citedCopies) {
                    const sourceBytes = await readFile(cited.sourcePath);
                    let existing: Buffer | undefined;
                    try {
                        existing = await readFile(cited.targetPath);
                    } catch {
                        existing = undefined;
                    }
                    if (existing !== undefined) {
                        if (!existing.equals(sourceBytes)) {
                            throw new Error(
                                `persist-out: cited run evidence .spur/run/${cited.name} diverges from the invoking ` +
                                    "tree's existing file — refusing to overwrite; reconcile the two copies by hand (0984 R4)",
                            );
                        }
                        continue; // byte-identical — idempotent no-op
                    }
                    writeFileSync(cited.targetPath, sourceBytes);
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
