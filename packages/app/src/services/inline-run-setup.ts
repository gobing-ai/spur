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
const { lstat, mkdir, readdir, readFile } = await import('node:fs/promises');

import { basename, join, resolve } from 'node:path';
import type { SpurConfig } from '@gobing-ai/spur-config';
import type { DbAdapter, RunDefinitionSource } from '@gobing-ai/spur-domain';
import {
    createMigratedDb,
    listRunIdRows,
    normalizePersistedWorkflowLayer,
    RunDao,
    redirectRunStorageReferences,
    SystemEventDao,
    transferRunTables,
} from '@gobing-ai/spur-domain';
import {
    createDefaultWorkflowEngineHost,
    DbWorkflowPersistenceAdapter,
    WorkflowService as EngineWorkflowService,
} from '@gobing-ai/ts-dual-workflow-engine';
import { EventBus } from '@gobing-ai/ts-infra';
import { createNodeFileSystem, NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import { getDecisionService } from '../decision/decision-service';
import { createWorkflowActionTraceWriter } from '../workflow/action-trace';
import { DecideActionRunner, DecideOptionsSchema } from '../workflow/actions/decide';
import { resolveDurableArtifactPath } from '../workflow/actions/run-path';
import { parseFeatureVerificationReceipt } from '../workflow/feature-verification-receipt';
import type { WorkflowObservabilityBus } from '../workflow/observability';
import { computeProofInputFingerprint, readProofInputContents } from '../workflow/proof-input-fingerprint';
import { loadRunCorrelation } from '../workflow/run-correlation';
import { InvalidWorkflowRunIdError } from '../workflow/run-record';
import { splitLaunchCommand } from '../workflow/split-launch-command';
import { isBookkeepingWorkflow, isTerminalReason, TERMINAL_REASONS } from '../workflow/terminal-reason';
import { assertInventoryIdentity, parseWorkflowInventory } from '../workflow/workflow-inventory';
import {
    type ResolvedWorkflowDefinition,
    resolveWorkflowDefinition,
    type WorkflowLayerId,
} from '../workflow/workflow-resolver';
import { ensureDurablePlaneIgnored, runStoragePaths } from './run-storage';
import { registerSystemEventTap, type SystemEventBus, type SystemEventTap } from './system-event-tap';
import { parseVerifyVerdict } from './verify-verdict';
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

/** Input for {@link readInstalledInventory}. */
export interface ReadInstalledInventoryInput {
    /** Workflow definition file (or name) to resolve. */
    readonly file: string;
    /** PATH-independent Spur invocation; empty falls back to the caller's checkout entry or a bare `spur`. */
    readonly spurBin: string;
    /** Repo-checkout CLI entry the caller resolved from its own plugin layout (the `--spur-bin`-less fallback). */
    readonly localCli: string;
    /** Project root the installed CLI resolves layers against. Defaults to the process cwd. */
    readonly workdir?: string;
}

/**
 * Let the selected CLI own config and layer resolution, then revalidate its snapshot in the app
 * (ADR-113 project→registered→shared). Moved here from `plugins/sp/scripts/inline-run-setup.ts`
 * (ADR-130 glue budget, task 1070's `--estimated` flag exhausted it): the script keeps only the
 * paths it derives from its own module URL, and the spawn/envelope logic is app-layer. The spawn
 * goes through `NodeProcessExecutor`, the sanctioned process boundary for app sources (the
 * `no-direct-process-spawn` rule forbids `node:child_process`).
 */
export async function readInstalledInventory(input: ReadInstalledInventoryInput): Promise<unknown> {
    const launch = input.spurBin
        ? splitLaunchCommand(input.spurBin, 'inline-run-setup "spurBin"')
        : existsSync(input.localCli)
          ? { command: 'bun', leadingArgs: [input.localCli] }
          : { command: 'spur', leadingArgs: [] };
    if ('error' in launch) throw new Error(launch.error);
    const res = await new NodeProcessExecutor().run({
        command: launch.command,
        args: [...launch.leadingArgs, 'workflow', 'show', input.file, '--format', 'todo', '--json'],
        cwd: input.workdir ?? process.cwd(),
        forceBuffered: true,
        rejectOnError: false,
        timeout: 30_000,
    });
    if (res.exitCode !== 0) {
        const detail = res.stderr.trim() !== '' ? res.stderr.trim() : `exit ${res.exitCode ?? -1}`;
        throw new Error(`could not resolve the workflow definition with the installed CLI: ${detail}`);
    }
    const value: unknown = JSON.parse(res.stdout);
    // Honor the existing optional JSON envelope without inventing another projection format.
    if (value && typeof value === 'object' && 'ok' in value && 'data' in value && value.ok === true) return value.data;
    return value;
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
 * DB-sourced run ids become `.spur/memory/runs/<id>.md` / `.state.json` filenames in the invoking
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
 * followed by name characters, with an optional subpath continuation group. The charset
 * deliberately includes template metachars (`*`, `…`, `{`, `<`, `?`, `,`) so abbreviated and
 * glob references stay attached to one capture and are classified non-literal by
 * {@link asLiteralRunFileName}, instead of a truncated prefix (`fadca099-` out of
 * `fadca099-…-wrapup-learnings.md`) masquerading as a real filename. The leading alnum
 * requirement already refuses `<runId>-…` placeholders and `..` traversal outright. The
 * lookbehind keeps only repo-relative citations (`.spur/run/…`, `./.spur/run/…`): a
 * root-qualified path (`knowledge-kit/.spur/run/…`, `/abs/.spur/run/…`, `~/.spur/run/…`) is
 * another project's evidence, which this teardown neither owns nor can lose, so it must not
 * trip the missing-in-both refusal.
 *
 * 1056 R1 (skip, not resolve): when the name is followed by `/rest`, the citation addresses
 * a subpath of `.spur/run/<name>` — the copy set owns direct-child files only (0984 R5), so
 * the continuation is captured as group 2 and the extraction loop classifies the citation as
 * `cited-directory:<name>` instead of obligating `<name>`. A captured continuation — not a
 * negative lookahead on `/` — is required: the greedy name charset would backtrack to a
 * SHORTER capture to satisfy a lookahead, yielding a wrong name (`triage-1051-105`).
 */
const RUN_CITATION_RE = /(?<![\w~:-]|[\w~:-]\/)\.spur\/run\/([A-Za-z0-9][A-Za-z0-9._*?<>{}|,\u2026-]*)(\/[^\s`]*)?/g;

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
    const fromRunDir = join(fromDir, '.spur', 'run');
    const toRunDir = join(toDir, '.spur', 'run');
    // 1026 R7: the durable run-record plane migrates alongside the scratch evidence.
    const fromRecordsDir = runStoragePaths(fromDir).recordsDir;
    const toRecordsDir = runStoragePaths(toDir).recordsDir;
    const fs = createNodeFileSystem();
    const fromEvidence = runStoragePaths(fromDir).evidenceDir;
    const toEvidence = runStoragePaths(toDir).evidenceDir;
    const evidenceCopies: Array<{ source: string; target: string; bytes: Buffer }> = [];
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
        if (verdictWbs !== undefined) {
            const parsed = parseVerifyVerdict(bytes.toString(), verdictWbs);
            const raw = JSON.parse(bytes.toString()) as { wbs?: unknown };
            if (!parsed || parsed.wbs !== verdictWbs || (raw.wbs !== undefined && raw.wbs !== verdictWbs)) {
                throw new Error(`persist-out: malformed durable verdict identity: ${name}`);
            }
        } else if (name.endsWith('-feature-verification.json')) {
            const receipt = parseFeatureVerificationReceipt(bytes.toString());
            const owner = name.slice(0, -'-feature-verification.json'.length);
            if (owner !== receipt.runId && owner !== receipt.featureId) {
                throw new Error(`persist-out: malformed durable receipt identity: ${name}`);
            }
        } else {
            throw new Error(`persist-out: unclassified durable evidence: ${name}`);
        }
        const existing = await readExistingRunFile(target);
        if (existing !== undefined && !existing.equals(bytes)) {
            throw new Error(`persist-out: durable evidence conflicts: ${name}`);
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
     * Config-derived `workflows.decideDecisionMaker` switch, resolved at the composition
     * boundary (the plugin delegate) — app services never load Spur config (ADR-082).
     */
    readonly enabled: boolean;
    /** Real run id for decision-event correlation; defaults to the 0941 placeholder. */
    readonly runId?: string;
    /** Real node id for decision-event correlation; defaults to the 0941 placeholder. */
    readonly node?: string;
    /** Bus carrying cataloged `decision.*` events (task 1095); absent ⇒ no events. */
    readonly observabilityBus?: WorkflowObservabilityBus;
    /**
     * Task 1094 R5: the merged Spur config, threaded at the composition boundary (ADR-082),
     * backing the catalog-reference decide path through the shared decision service.
     */
    readonly spurConfig?: SpurConfig;
    /**
     * Task 1113 R3: correlation vars (`__workflowName`, `wbs`) resolved from the
     * run row + snapshot by the caller; passed as the action's run vars so
     * decide events carry full run correlation. Absent ⇒ `{}` (placeholder runs).
     */
    readonly correlationVars?: Record<string, string>;
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
 * boundary (plugin delegate) resolves `workflows.decideDecisionMaker` and threads it in
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
    const spurConfig = input.spurConfig;
    const runner = new DecideActionRunner(createNodeFileSystem(), {
        enabled: input.enabled,
        // Task 1094 R5: catalog-reference decide resolves through the shared service with
        // the config threaded from the driver boundary (ADR-082 — app services never load
        // Spur config themselves).
        ...(spurConfig !== undefined
            ? { decisionService: () => getDecisionService(spurConfig, resolve(input.workdir)) }
            : {}),
        ...(input.observabilityBus !== undefined ? { observabilityBus: input.observabilityBus } : {}),
    });
    const result = await runner.execute(raw as Record<string, unknown>, {
        runId: input.runId ?? 'inline-decide',
        stateOrNodeId: input.node ?? 'decide',
        workdir: resolve(input.workdir),
        vars: input.correlationVars ?? {},
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

/** Setup/driver outcome projected into the run-record state `.spur/memory/runs/<run-id>.state.json` (0927 R1). */
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
    moves: Array<{ source: string; target: string }>,
): Promise<void> {
    const fs = createNodeFileSystem();
    await resolveDurableArtifactPath(fs, resolve(srcRoot, '../../..'), join(srcRoot, rel, 'probe'), 'runs');
    await resolveDurableArtifactPath(fs, resolve(destRoot, '../../..'), join(destRoot, rel, 'probe'), 'runs');
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
        entries = await readdir(join(srcRoot, rel), { withFileTypes: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
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

/**
 * 1051 AC2: project the committed close status into the run-record state sidecar. The run row
 * is already terminal when this runs, so the projection must never undo the commit: it merges
 * into the existing state (setup identity/provenance and `startedAt` preserved, any stale
 * `error` dropped on success), replaces `status` with the committed one, and publishes
 * atomically (same-directory temp + rename, the 0925 R1 pattern). A prior sidecar with wrong
 * content — a stale `running` from an earlier lost write — is repaired by re-running the same
 * close. Unlike {@link writeInlineRunOutcome} (best-effort setup reporting), a failure is
 * RETURNED so the close path can report it loudly and be replayed to repair.
 *
 * @param context optional authoritative facts from the call site: `startedAt` is the committed
 *   run row's `started_at` (task 1053 R4), used as the fallback seed when no prior sidecar
 *   exists so a rebuild-from-nothing never fabricates the projection time as the start time.
 * @returns `undefined` on success, else a failure detail carrying replay guidance.
 */
export function projectInlineRunClose(
    runId: string,
    status: 'done' | 'failed' | 'paused',
    context?: { startedAt?: string },
): string | undefined {
    try {
        const runDir = runStoragePaths(process.cwd()).recordsDir;
        if (!existsSync(runDir)) mkdirSync(runDir, { recursive: true });
        const statePath = join(runDir, `${runId}.state.json`);
        let prior: Record<string, unknown> = {};
        try {
            const parsed: unknown = JSON.parse(readFileSync(statePath, 'utf8'));
            if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
                prior = parsed as Record<string, unknown>;
            }
        } catch {
            // Missing or unreadable prior state: rebuild from the committed close alone.
        }
        const at = new Date().toISOString();
        const state: Record<string, unknown> = {
            schemaVersion: 1 as const,
            ...prior,
            runId,
            status,
            // ok contract (0948 R7 lineage, settled by task 1053 F3): `ok` records the
            // sidecar projection's integrity — the state file was written — never the run
            // outcome. The run outcome lives in `status` (+ the DB `terminal_reason`), and
            // `error` is reserved for projection-write failures, which return without
            // writing; so a successfully written sidecar is always `ok: true` and never
            // carries an `error` (the invariant below). Pinned per terminal status by the
            // close-describe tests in inline-run-driver.test.ts.
            ok: true,
            // task 1053 F4: a missing prior sidecar rebuilds from the committed close; seed
            // the start time from the authoritative run row (threaded by closeRun) instead of
            // fabricating the projection time. The projection-time `at` stays as the last
            // bounded fallback for direct callers that pass no context.
            startedAt: typeof prior.startedAt === 'string' ? prior.startedAt : (context?.startedAt ?? at),
            updatedAt: at,
        };
        // task 1053 F1: a successful projection never carries a prior `error` — the doc
        // comment promises "any stale error dropped on success" (the same 0948 R7 rule
        // writeInlineRunOutcome applies at re-setup); the spread above would otherwise
        // keep it. `error` re-enters only through a projection-write failure, which does
        // not write a sidecar at all.
        delete state.error;
        const temp = `${statePath}.tmp`;
        try {
            writeFileSync(temp, `${JSON.stringify(state, null, 4)}\n`);
            renameSync(temp, statePath);
        } catch (error) {
            // task 1053 F2: never leave `.tmp` residue behind (0926 R1 parity with
            // writeInlineRunOutcome); the failing cleanup must not mask the replay-guidance
            // detail the outer catch returns.
            try {
                unlinkSync(temp);
            } catch {
                // Nothing to clean (temp was never created).
            }
            throw error;
        }
        return undefined;
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return `failed to project the committed ${status} status into the run-record state file for run ${runId}: ${detail} (the run row is committed; replay the same close to repair)`;
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
    /** Declared terminal reason (0937 R2). 1051 AC1: the closed enum is enforced at this
     * boundary — a failed close without a reason (or with a non-enum one) is refused by name
     * before any write; `done`/`paused` without a declared reason default to
     * `done`/`paused-operator`. */
    readonly reason?: string;
    /**
     * Trace status: the finalize vocabulary plus the close-only `paused` (`CLOSE_STATUSES`).
     * Both are assignable to the engine's `WorkflowStatus`.
     */
    readonly status: 'done' | 'failed' | 'paused';
    readonly ok: boolean;
    readonly durationMs: number;
    /**
     * True when the host driver did not time the action (1070 R1) — for example a duration it
     * reconstructed after a subagent returned. Stamped into `action_runs.result_json` so the
     * projection can label the row instead of presenting it as measured.
     */
    readonly estimated?: boolean;
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
    // 1051 AC1: the close-reason contract is enforced at the shared boundary so source and
    // installed plugin callers cannot diverge (0937 R2 held the argv layer; the app layer
    // trusted its caller). A failed close demands an explicit enum reason; every refusal
    // below happens BEFORE any write — no run-row mutation, no sidecar change, no log line.
    if (input.close) {
        const invalidReason = (error: string): number => {
            process.stdout.write(
                `${JSON.stringify({ ok: false, runId: input.runId, error, code: 'INVALID_CLOSE_REASON' })}\n`,
            );
            return 1;
        };
        if (input.reason !== undefined && !isTerminalReason(input.reason)) {
            return invalidReason(
                `close reason "${input.reason}" is not a terminal-reason enum value; pass one of: ${TERMINAL_REASONS.join(', ')}`,
            );
        }
        if (input.status === 'failed' && input.reason === undefined) {
            return invalidReason(
                `close status failed requires an explicit reason from the terminal-reason enum (0937 R2); pass one of: ${TERMINAL_REASONS.join(', ')}`,
            );
        }
    }
    // 1051 AC1: omitted reasons resolve their defaults at the same boundary — `done` → `done`,
    // `paused` → `paused-operator` (the writer's classifyTerminalReason is idempotent on both).
    // `failed` cannot reach the fallback: it is rejected above when the reason is omitted.
    const closeReason = input.close
        ? (input.reason ?? (input.status === 'paused' ? 'paused-operator' : 'done'))
        : undefined;
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
                ? await writer.closeRun(input.runId, input.status, undefined, closeReason)
                : await writer.recordAction({
                      runId: input.runId,
                      node: input.node,
                      kind: input.kind,
                      status: input.status,
                      ok: input.ok,
                      durationMs: input.durationMs,
                      result: { provenance: 'host-reported', estimated: input.estimated === true },
                  })
        ) as Record<string, unknown>;
        if (result.ok !== true && result.failure !== undefined) {
            // One stdout shape for emission failures (0868 finding #1): flatten the guard's
            // nested failure object to the same `{ok, runId, error}` the direct paths emit.
            const failure = result.failure as { error?: string };
            return fail(failure.error ?? 'unknown trace emission failure');
        }
        // 1051 AC2: the row is committed terminal — project the committed status into the
        // run-record state sidecar before reporting, so the pair record always agrees with
        // the database (including the zero-action done defect below, whose commit stands).
        // closeRun threaded the committed run row's started_at (task 1053 F4) as the
        // rebuild-from-nothing seed.
        const stateError = input.close
            ? projectInlineRunClose(input.runId, input.status, {
                  startedAt: typeof result.startedAt === 'string' ? result.startedAt : undefined,
              })
            : undefined;
        if (input.close && input.status === 'done' && result.actionRows === 0) {
            // A run finalized `done` with ZERO recorded action rows is a bookkeeping defect
            // (task 0975 R2): the row is already terminal — closeRun ran above — but the
            // driver must surface this instead of reporting a clean close, and must never
            // backfill rows. Exit 1 with the named code; the run record carries the finding.
            const error = `run ${input.runId} closed done with zero action_runs rows; emit --action/--actions-file during the run (no backfill); see inline-pipeline-driver.md#structured-trace-emission-adr-117-task-0868${
                stateError !== undefined ? `; run-record state projection also failed: ${stateError}` : ''
            }`;
            appendInlineRunLogLine(input.runId, `trace-close-failed run=${input.runId}: ${error}`);
            process.stdout.write(
                `${JSON.stringify({ ok: false, runId: input.runId, error, code: 'NO_ACTION_ROWS', actionRows: 0 })}\n`,
            );
            return 1;
        }
        if (input.close && stateError !== undefined) {
            // The committed write stands; only the sidecar projection failed. Report loudly
            // with a named code — replaying the same close repairs the sidecar (AC2).
            appendInlineRunLogLine(input.runId, `trace-close-failed run=${input.runId}: ${stateError}`);
            process.stdout.write(
                `${JSON.stringify({ ok: false, runId: input.runId, error: stateError, code: 'RUN_RECORD_STATE_FAILED' })}\n`,
            );
            return 1;
        }
        // The stdout close shape stays `{ok, runId, actionRows?}` (0868 finding #1): the
        // task-1053 startedAt thread-through is for the sidecar projection, not a stdout
        // field — strip it before reporting.
        const { startedAt: _threaded, ...stdoutResult } = result;
        process.stdout.write(`${JSON.stringify({ ...stdoutResult, runId: input.runId })}\n`);
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
    /** Same host-reported stamp as `--action` (1070 R1/R3); absent means measured. */
    readonly estimated?: boolean;
}

/** Input for `runInlineRunTraceBatch` (`--actions-file`, 1007 R5). */
export interface InlineRunTraceBatchInput {
    readonly runId: string;
    readonly actionsFile: string;
}

/**
 * Batch trace emission (1007 R5): read a JSON array of `{node,kind,status,ok,durationMs,estimated?}` rows
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
        return batchFailed('actions file must be a JSON array of {node,kind,status,ok,durationMs,estimated?}');
    }
    const entries: InlineRunActionEntry[] = [];
    const rowError = (index: number, error: string): string => `actions[${index}]: ${error}`;
    for (const [index, row] of rows.entries()) {
        if (row === null || typeof row !== 'object' || Array.isArray(row)) {
            return batchFailed(rowError(index, 'entry must be a JSON object'));
        }
        const record = row as Record<string, unknown>;
        const { node, kind, status, ok, durationMs, estimated } = record;
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
        if (estimated !== undefined && typeof estimated !== 'boolean') {
            return batchFailed(rowError(index, 'estimated must be a boolean'));
        }
        entries.push({ node, kind, status, ok, durationMs, ...(estimated === true ? { estimated: true } : {}) });
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
                result: { provenance: 'host-reported', estimated: entry.estimated === true },
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
    /** Task 1094 R5: merged config threaded by the delegate for the catalog-reference decide path. */
    readonly spurConfig?: SpurConfig;
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
    // Decision lifecycle events (task 1095): a local bus tapped into the project DB's
    // `system_events` ledger — the same pattern as the 0941 trace writer above, so inline
    // decide rows persist like engine-driven workflow rows. Closed in `finally`.
    let projectDb: InlineRunProjectDb | undefined;
    let tap: SystemEventTap | undefined;
    try {
        projectDb = await openInlineRunProjectDb(process.cwd());
        const bus: WorkflowObservabilityBus = new EventBus();
        // SAFETY: the same EventBus instance is bridged as the system-event tap (structurally
        // nominal types over one ts-infra EventBus; ADR-044 event bridge, as in the CLI).
        tap = registerSystemEventTap(bus as unknown as SystemEventBus, new SystemEventDao(projectDb.adapter), {
            warn: (msg: string, data?: Record<string, unknown>) => {
                appendInlineRunLogLine(
                    input.runId,
                    `decision-event-persist-failed run=${input.runId}: ${msg}${data === undefined ? '' : ` ${JSON.stringify(data)}`}`,
                );
            },
            debug: () => {},
        });
        let outcome: InlineDecideOutcome;
        try {
            outcome = await runDecideForInlineRun({
                workdir: process.cwd(),
                optionsFile: input.optionsFile,
                enabled: input.enabled,
                ...(input.spurConfig !== undefined ? { spurConfig: input.spurConfig } : {}),
                runId: input.runId,
                node: input.node,
                observabilityBus: bus,
                // Task 1113 R3: inline runs persist a workflow_runs row — load the
                // correlation the same way the gate does so decide events join the run.
                correlationVars: {
                    ...(await loadRunCorrelation(new DbWorkflowPersistenceAdapter(projectDb.adapter), input.runId)),
                },
            });
        } catch (error) {
            return decideFailed(error instanceof Error ? error.message : String(error));
        }
        if (!outcome.ok) return decideFailed(outcome.error ?? 'decide failed without an error message');
        await tap.flush();
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
    } finally {
        tap?.unsubscribe();
        projectDb?.close();
    }
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
            process.stdout.write(`${JSON.stringify({ ...result, ok: false, error })}\n`);
            return 1;
        }
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
