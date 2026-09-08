/**
 * Inline full-pipeline run setup — authoritative workflow run identity (task 0804 R1).
 *
 * The interactive inline driver (inline-pipeline-driver.md) allocates a run id and a task
 * link but, unlike the subprocess path (`spur workflow run`), never persisted an
 * authoritative `runs` row — so bound `run.artifact` registration (0785 R3) correctly
 * refused every inline record. This module is the setup operation the driver now runs at
 * Run setup: resolve the SAME two-tier project-or-bundled definition the engine would
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

import { resolve } from 'node:path';
import type { DbAdapter, RunDefinitionSource } from '@gobing-ai/spur-domain';
import { createMigratedDb, RunDao } from '@gobing-ai/spur-domain';
import {
    createDefaultWorkflowEngineHost,
    DbWorkflowPersistenceAdapter,
    WorkflowService as EngineWorkflowService,
} from '@gobing-ai/ts-dual-workflow-engine';
import { type ResolvedWorkflowDefinition, resolveWorkflowDefinition } from '../workflow/workflow-resolver';
import { workflowVersionLiteral } from './workflow-service';

/** Input for {@link createOrAttachInlineRun}. */
export interface InlineRunSetupInput {
    /** Absolute project working directory the inline pipeline executes in. */
    readonly workdir: string;
    /** Lazily resolves the project DB adapter (the same DB the engine persists to). */
    readonly getDb: () => Promise<DbAdapter>;
    /** Workflow file path or name, exactly as the driver selected it (two-tier resolved). */
    readonly file: string;
    /** Collision-resistant run id allocated by the driver's Run setup. */
    readonly runId: string;
    /** Embedded `$schema` map for composition-root parity; optional. */
    readonly embeddedSchemas?: ReadonlyMap<string, string>;
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
    readonly layer: 'project' | 'bundled';
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
    const { join, resolve } = await import('node:path');
    const { mkdirSync } = await import('node:fs');
    const url = join(resolve(workdir), '.spur', 'spur.db');
    mkdirSync(join(url, '..'), { recursive: true });
    const adapter = await createMigratedDb({ url });
    return { adapter, close: () => adapter.close() };
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
        resolved = await resolveWorkflowDefinition(workdir, input.file, {
            validateSchema: true,
            ...(input.embeddedSchemas !== undefined ? { embeddedSchemas: input.embeddedSchemas } : {}),
        });
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
    // traceRowById's type says `undefined`, but the underlying queryFirst surfaces a SQL
    // NULL row as `null`; treat both as "no existing row".
    const existing = (await runDao.traceRowById(runId)) ?? undefined;

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
            existingSource.layer === resolved.layer &&
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
    // for state-machine runs (`running`, never a synthetic terminal status), then stamp the
    // same identity the subprocess engine stamps at creation (0768/0784). Persistence is
    // not best-effort: a failed insert or identity stamp fails the setup fail-closed.
    const engine = new EngineWorkflowService(createDefaultWorkflowEngineHost(), new DbWorkflowPersistenceAdapter(db));
    await engine.createOrAttachRun({
        id: runId,
        workflow_name: resolved.workflow.name,
        mode: 'state-machine',
        status: 'running',
        started_at: new Date().toISOString(),
        completed_at: null,
        metadata_json: '{}',
    });
    await runDao.stampRunIdentity(runId, digest, version, source);

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
