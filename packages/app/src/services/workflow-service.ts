import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DbAdapter } from '@gobing-ai/spur-domain';
import {
    createDefaultWorkflowEngineHost,
    DbWorkflowPersistenceAdapter,
    WorkflowService as EngineWorkflowService,
    loadWorkflowDef,
} from '@gobing-ai/ts-dual-workflow-engine';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result of a workflow validate operation. */
export type WorkflowValidateResult =
    | { ok: true; valid: true; workflow: Awaited<ReturnType<typeof loadWorkflowDef>> }
    | { ok: false; valid: false; file: string; errors: string[] };

/** Result of a workflow run operation. */
export interface WorkflowRunResult {
    status: string;
    workflowName: string;
    finalState: string;
    [key: string]: unknown;
}

/** Result of a workflow list operation. */
export interface WorkflowListResult {
    runs: Awaited<ReturnType<InstanceType<typeof EngineWorkflowService>['listRuns']>>;
}

/** Context injected into WorkflowAppService. */
export interface WorkflowAppServiceContext {
    cwd: string;
    getDb(): Promise<DbAdapter>;
}

// ---------------------------------------------------------------------------
// WorkflowAppService
// ---------------------------------------------------------------------------

/**
 * Application-layer orchestration for `spur workflow` commands.
 * Named WorkflowAppService to avoid collision with WorkflowService from
 * @gobing-ai/ts-dual-workflow-engine (the engine's high-level service class).
 */
export class WorkflowAppService {
    private readonly ctx: WorkflowAppServiceContext;

    constructor(ctx: WorkflowAppServiceContext) {
        this.ctx = ctx;
    }

    /** Validate a workflow YAML file. Returns a structured result instead of throwing. */
    async validate(file: string, opts: { validateSchema?: boolean } = {}): Promise<WorkflowValidateResult> {
        const absolute = resolve(this.ctx.cwd, file);

        if (!(await fileExists(absolute))) {
            return { ok: false, valid: false, file, errors: [`File not found: ${absolute}`] };
        }

        try {
            const workflow = await loadWorkflowDef(absolute, {
                validateSchema: opts.validateSchema !== false,
            });
            return { ok: true, valid: true, workflow };
        } catch (error) {
            return {
                ok: false,
                valid: false,
                file,
                errors: [error instanceof Error ? error.message : String(error)],
            };
        }
    }

    /** Load and run a workflow file. Returns the engine run result. */
    async run(file: string, runId?: string): Promise<WorkflowRunResult> {
        const svc = await this.createEngineService();
        const result = await svc.runFile(file, {
            workdir: this.ctx.cwd,
            runId: runId ?? crypto.randomUUID(),
        });
        return result as unknown as WorkflowRunResult;
    }

    /** List persisted workflow runs. */
    async list(): Promise<WorkflowListResult> {
        const svc = await this.createEngineService();
        const runs = await svc.listRuns();
        return { runs };
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private async createEngineService(): Promise<EngineWorkflowService> {
        return new EngineWorkflowService(
            createDefaultWorkflowEngineHost(),
            new DbWorkflowPersistenceAdapter(await this.ctx.getDb()),
        );
    }
}

// ---------------------------------------------------------------------------
// Module-level helpers (not exported)
// ---------------------------------------------------------------------------

async function fileExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}
