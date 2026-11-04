import {
    createFeatureReceiptRunPort,
    FEATURE_LIFECYCLE_PROFILE,
    type FeatureReceiptRunPort,
    FeatureService,
    PlanningWriteService,
    resolvePlanningFolders,
} from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { makePlanningEmitter } from '../../planning-emitter';
import { makeLifecycleAdapter } from '../../workflow/make-lifecycle-adapter';

/**
 * Read-only run-store ports for receipt validation (0915): the recording run's
 * terminal status, its persisted definition digest (resume digest wins) and
 * artifact registration. The project DB opens lazily; a missing row or absent
 * registration surfaces as a fail-closed `run` rejection at the completion
 * boundary. Shared with the server's guarded `feature.transition`
 * ({@link createFeatureReceiptRunPort}) so both surfaces validate identically.
 */
export async function makeReceiptRunPort(context: CliContext): Promise<FeatureReceiptRunPort> {
    return createFeatureReceiptRunPort(await context.getDb(), context.fs);
}

export async function makeService(context: CliContext, folderOverride?: string): Promise<FeatureService> {
    // Derive feature/task folders from `.spur/config.yaml` (phase folders) — never hardcode.
    const resolved = await resolvePlanningFolders(context.fs);
    const featuresDir = folderOverride ?? context.fs.resolve(resolved.featuresDir);
    const tasksDir = context.fs.resolve(resolved.tasksDir);
    const lifecycle = makeLifecycleAdapter(context, FEATURE_LIFECYCLE_PROFILE);
    const writeService = new PlanningWriteService({
        fs: context.fs,
        ...(lifecycle ? { lifecycle } : {}),
        emitter: makePlanningEmitter(context),
    });
    // Pass foldersConfig so move/refresh scan every phase folder (tasks, tasks2, tasks3, …)
    // when rewriting task feature_id edges — not only the active tasksDir.
    return new FeatureService({
        fs: context.fs,
        writeService,
        featuresDir,
        tasksDir,
        foldersConfig: resolved.foldersConfig,
    });
}
