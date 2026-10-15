import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    FEATURE_LIFECYCLE_PROFILE,
    FeatureService,
    loadSectionMatrix,
    PlanningWriteService,
    reconcileExistingLifecycleRow,
    resolvePlanningFolders,
    TASK_LIFECYCLE_PROFILE,
    TaskCheckService,
    TaskLocator,
    TaskService,
} from '@gobing-ai/spur-app';
import { bundledConfigRoot } from '@gobing-ai/spur-config/loader';
import { extractTemplateBodies, type TaskSection } from '@gobing-ai/spur-domain';
import { EMBEDDED_SPUR_SCHEMAS } from '../../config/embedded-schemas';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import { makePlanningEmitter } from '../../planning-emitter';
import { makeLifecycleAdapter } from '../../workflow/make-lifecycle-adapter';

/**
 * Emit ONE parseable error result for a failed task create/batch-create (or a
 * parent-guarded `update --feature`, 1132) under `--json` (F21 task 0787 R4):
 * raw mode gets the ADR-091 `ok:false` payload on STDOUT — `writeJsonError`'s raw mode writes plain prose to stderr and leaves
 * stdout empty, which automation reading stdout cannot parse — and enveloped
 * mode gets the canonical error envelope with the CLI-local code carried in
 * `details.cliCode`. Non-JSON invocations keep the stderr prose. Exit codes
 * stay the caller's responsibility.
 */
export function writeCreateJsonError(
    context: CliContext,
    options: { json?: boolean; jsonEnvelope?: boolean },
    code: string,
    message: string,
    extra?: Record<string, unknown>,
): void {
    const text = typeof message === 'string' ? message : String(message);
    if (options.json === true) {
        const bare = text.startsWith('Error: ') ? text.slice('Error: '.length) : text;
        context.output.write(
            toEnvelopeJson(
                { ok: false as const, error: { code, message: bare, ...(extra ?? {}) } },
                {
                    enveloped: options.jsonEnvelope,
                    error: { code: 'INTERNAL_ERROR', message: bare, details: { cliCode: code, ...(extra ?? {}) } },
                },
            ),
        );
    } else {
        context.output.error(text.startsWith('Error: ') ? text.slice('Error: '.length) : text);
    }
}

/**
 * Build the TaskService over the active planning folder (0839: exported for the
 * agent loop's idle-hold strategy reads — `list` only; no lifecycle writes).
 */
export async function makeService(
    context: CliContext,
    folderOverride?: string,
    noLifecycle = false,
    provenanceBypass = false,
): Promise<TaskService> {
    const resolved = await resolvePlanningFolders(context.fs);
    const foldersConfig = resolved.foldersConfig;
    // Normalize the override: relative and absolute spellings are the same folder (0522 R2).
    const tasksDir = context.fs.resolve(folderOverride ?? foldersConfig.active_folder);
    // 1132 P1: the features dir comes from config, never from a basename heuristic on
    // tasksDir — a phase folder (`docs/tasks5`) has a sibling `docs/features`, and the guard
    // that reads it (R2) must not go inert just because the folder is not literally `tasks`.
    const featuresDir = context.fs.resolve(resolved.featuresDir);
    const lifecycle = noLifecycle
        ? undefined
        : makeLifecycleAdapter(context, TASK_LIFECYCLE_PROFILE, { provenanceBypass });
    const writeService = new PlanningWriteService({
        fs: context.fs,
        ...(lifecycle ? { lifecycle } : {}),
        emitter: makePlanningEmitter(context),
        // 1047 R1/R2: after a committed terminal task transition, finalize the
        // EXISTING task-lifecycle bookkeeping row — including when `--no-lifecycle`
        // suppressed the adapter (suppression removes run CREATION, not the repair
        // of a row that already exists). Absent rows allocate nothing; a failure is
        // carried on the write result, reported by the transport, and replay-safe.
        onTransitionCommitted: async (ref, _from, to) => {
            await reconcileExistingLifecycleRow(() => context.getDb(), TASK_LIFECYCLE_PROFILE, ref.id, to);
        },
    });
    // 1132 R2: the parent-status guard reopens a `verifying` feature through the FEATURE
    // lifecycle profile. It must not borrow this task's write service: that one carries
    // `TASK_LIFECYCLE_PROFILE`, whose FSM declares no `verifying` state, so the transition
    // ended as `FSMError: Cannot reseed run … to undeclared state "verifying"`. One
    // FeatureService per makeService call, reusing the same resolved folders.
    const featureWriteService = new PlanningWriteService({
        fs: context.fs,
        lifecycle: makeLifecycleAdapter(context, FEATURE_LIFECYCLE_PROFILE),
        emitter: makePlanningEmitter(context),
    });
    const featureTransition = async (id: string, to: string) => {
        const svc = new FeatureService({
            fs: context.fs,
            writeService: featureWriteService,
            featuresDir,
            tasksDir,
            foldersConfig,
        });
        const wr = await svc.transition(id, to);
        return { fromStatus: wr.fromStatus, toStatus: wr.toStatus };
    };
    return new TaskService({
        fs: context.fs,
        tasksDir,
        featuresDir,
        featureTransition,
        writeService,
        getDb: () => context.getDb(),
        sectionMatrix: await loadSectionMatrix(context.cwd, { embeddedSchemas: EMBEDDED_SPUR_SCHEMAS }),
        resolveTemplateBodies: (variant: string) => loadTemplateBodies(context.cwd, variant),
        foldersConfig,
    });
}

/** Cache of per-variant template bodies (read once per process from bundled config). */
export const templateBodiesCache = new Map<string, Partial<Record<TaskSection, string>>>();

/**
 * Read a variant's scaffold template and extract its per-section bodies
 * (e.g. `review`'s P1–P4 table). Resolution order:
 *   1. `.spur/tasks/templates/<variant>.md` (project-local, seeded by `spur init`)
 *   2. bundled template fallback (`templates/task/<variant>.md`)
 * Returns `{}` when neither source is reachable — creation then falls back to
 * matrix + guidance only. Results are cached per process.
 */
export function loadTemplateBodies(projectRoot: string, variant: string): Partial<Record<TaskSection, string>> {
    const cached = templateBodiesCache.get(variant);
    if (cached !== undefined) return cached;
    let bodies: Partial<Record<TaskSection, string>> = {};

    // 1. Project-local: .spur/tasks/templates/<variant>.md
    const localPath = join(projectRoot, '.spur', 'tasks', 'templates', `${variant}.md`);
    if (existsSync(localPath)) {
        bodies = extractTemplateBodies(readFileSync(localPath, 'utf8'));
    } else {
        // 2. Bundled fallback: templates/task/<variant>.md
        const root = bundledConfigRoot();
        if (root !== null) {
            const templatePath = join(root, 'templates', 'task', `${variant}.md`);
            if (existsSync(templatePath)) {
                bodies = extractTemplateBodies(readFileSync(templatePath, 'utf8'));
            }
        }
    }

    templateBodiesCache.set(variant, bodies);
    return bodies;
}

/**
 * Locator over every registered task folder. The L4 edge checks (parent, deps,
 * child rollup) resolve related tasks through it, so a corpus spanning several
 * folders no longer reports cross-folder dependencies as missing.
 */
export async function makeTaskLocator(context: CliContext): Promise<TaskLocator> {
    const { foldersConfig } = await resolvePlanningFolders(context.fs);
    return new TaskLocator({
        fs: context.fs,
        tasksDir: context.fs.resolve(foldersConfig.active_folder),
        foldersConfig,
    });
}

/** 0839: exported for the agent loop's injected dependency gate (`firstBlockingPrerequisite`). */
export async function makeCheckService(context: CliContext): Promise<TaskCheckService> {
    return new TaskCheckService(
        context.fs,
        await loadSectionMatrix(context.cwd, { embeddedSchemas: EMBEDDED_SPUR_SCHEMAS }),
        await makeTaskLocator(context),
    );
}
