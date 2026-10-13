/**
 * Consumer-side counterpart of the stale-bundle guard (task 1185, feature A33).
 *
 * The 1120 guard (`plugins/sp/lib/inline-run-app.ts`, `resolveAppEntry`/`loadInlineApp`) names a
 * stale *bundle*: an installed `lib/*.generated.mjs` older than the plugin scripts that load it,
 * whose remedy is a reinstall. This is the reciprocal skew, one layer out — a *consumer* (typically
 * a project-rooted port that a project-layer workflow override invokes) requires an export the
 * shipped entry no longer provides. `openInlineRunProjectDb` and `ArtifactDao` were deliberately
 * retired (8f51a752d / efd78f058), so the entry's export contract moved and the consumer is behind;
 * a reinstall of the already-current entry is exactly the advice that cannot work.
 *
 * The consumer's own compat complaint is the only place those names exist, so recognition reads
 * them out of the failed child's output rather than modelling a consumer's imports or an
 * interpolated shell command (both rejected in the task's Design).
 *
 * Nothing here runs a workflow. The callers are the two failure boundaries that today collapse the
 * child's diagnosis into a bare "exited with N":
 *   - `lifecycle-adapter.LifecycleAdapter.runTargetEnterActions` (`State "<to>" onEnter shell failed`)
 *   - `actions/shell.StreamingShellActionRunner` (the nested-run failure composition)
 * Both only *widen the message*; fail-closed behaviour and every other failure's text are unchanged.
 */

import { isAbsolute, join, resolve, sep } from 'node:path';
import type { WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';

/** A consumer requiring entry exports the shipped inline-run entry does not provide. */
export interface ConsumerBundleSkew {
    /** The consumer module that demanded the names (the project-rooted port). */
    consumer: string;
    /** Export names the consumer requires that the entry does not provide. */
    missing: string[];
    /** The inline-run entry the consumer imported. */
    entry: string;
}

/**
 * The compat complaint shape every generated-bundle consumer emits:
 * `<module|entry|bundle> <path> is missing <label> (<name>, <name> …)`.
 */
const ENTRY_MISSING_EXPORTS_RE =
    /\b(?:module|entry|bundle)\s+(\S+\.(?:mjs|cjs|js|mts|ts))\s+is missing\b[^\n(]*\(([^()\n]+)\)/;

const EXPORT_NAME_RE = /^[A-Za-z_$][\w$]*$/;

const SCRIPT_SUFFIX_RE = /\.(?:mjs|cjs|js|mts|ts)$/;

/** Bound on names quoted from a child's complaint — a diagnosis, not an output dump. */
export const MAX_MISSING_EXPORTS = 8;

/**
 * The compat complaint in a failed consumer's output, or `null` when it carries none. `consumer`
 * names the script that complained; the caller resolves it (the failed module at the nested-run
 * boundary, the override's `onEnter` script at the lifecycle denial).
 */
export function consumerBundleSkew(output: string, consumer: string): ConsumerBundleSkew | null {
    const match = ENTRY_MISSING_EXPORTS_RE.exec(output);
    if (match === null) return null;
    const entry = match[1] ?? '';
    const missing = [...new Set((match[2] ?? '').split(/[,\s]+/).filter((name) => EXPORT_NAME_RE.test(name)))];
    if (entry === '' || missing.length === 0) return null;
    return { consumer, missing: missing.slice(0, MAX_MISSING_EXPORTS), entry };
}

/**
 * The operator-facing diagnosis: the named facts plus only the remedies that can work — remove the
 * project-layer override so the bundled definition applies, or migrate the consumer to the current
 * app-owned operation. Reinstalling/upgrading is deliberately never offered: the entry is the
 * shipped one and a reinstall cannot restore a retired export (task 1185 R2).
 */
export function staleConsumerDiagnosis(skew: ConsumerBundleSkew, override?: string): string {
    const remedy =
        override === undefined
            ? 'remove the project-layer override so the bundled definition applies, or migrate the consumer'
            : `remove the project-layer override ${override} so the bundled definition applies, or migrate ${skew.consumer}`;
    return (
        `the consumer ${skew.consumer} requires ${skew.missing.join(', ')} from the shipped inline-run entry ` +
        `${skew.entry}, which no longer provides ${skew.missing.length === 1 ? 'it' : 'them'} — ${remedy} to ` +
        'the current app-owned operation. Reinstalling or upgrading the entry does not add these names.'
    );
}

/** Shell-word tokens of a command, quotes stripped. The command is data here — nothing is expanded. */
function commandWords(command: string): string[] {
    return command
        .split(/\s+/)
        .map((token) => token.replace(/^['"]+|['"]+$/g, ''))
        .filter((token) => token !== '');
}

/**
 * The project-rooted consumer script a command invokes, or `null`. Project-rooted means a script
 * under `<workdir>/.spur/` — the tree the project owns (the observed port:
 * `.spur/scripts/feature-verify.mjs`). A plugin-shipped script lives in the distribution instead,
 * where a genuinely stale bundle IS the correct diagnosis (1120).
 *
 * shortcut: only `<workdir>/.spur/` counts as project-owned; widen when a second port location appears.
 */
export function projectConsumerScript(command: string, workdir: string): string | null {
    const owned = join(workdir, '.spur') + sep;
    for (const token of commandWords(command)) {
        if (!SCRIPT_SUFFIX_RE.test(token) || token.includes('$')) continue;
        const path = isAbsolute(token) ? token : resolve(workdir, token);
        if (path.startsWith(owned)) return path;
    }
    return null;
}

/**
 * The nested `workflow run <file>` target a shell command invokes, or `null`. The feature
 * lifecycle's `verifying` entry reaches the project-layer override through exactly this form, so
 * the denial report can resolve the override the same way name resolution selected it.
 */
export function nestedWorkflowRunTarget(command: string): string | null {
    const words = commandWords(command);
    const index = words.findIndex((word, i) => word === 'run' && words[i - 1] === 'workflow');
    const target = index === -1 ? undefined : words[index + 1];
    return target !== undefined && /^[\w./-]+\.ya?ml$/.test(target) ? target : null;
}

/**
 * The first project-rooted consumer script a definition's shell `onEnter` actions invoke, or
 * `null`. The resolved definition — not the child's prose — is authoritative for what a failing
 * nested run executed.
 */
export function definitionConsumerScript(workflow: WorkflowDef, workdir: string): string | null {
    if (!Array.isArray((workflow as { states?: unknown }).states)) return null;
    const states = (
        workflow as { states: readonly { onEnter?: readonly { kind: string; options?: Record<string, unknown> }[] }[] }
    ).states;
    for (const state of states) {
        for (const action of state.onEnter ?? []) {
            if (action.kind !== 'shell') continue;
            const command = action.options?.command;
            if (typeof command !== 'string') continue;
            const consumer = projectConsumerScript(command, workdir);
            if (consumer !== null) return consumer;
        }
    }
    return null;
}

/**
 * The diagnosis for a failed shell step that ran a project-rooted consumer requiring retired entry
 * exports, or `null` for every other failure (which therefore keeps its previous message).
 */
export function projectConsumerFailure(command: string, workdir: string, output: string): string | null {
    const consumer = projectConsumerScript(command, workdir);
    if (consumer === null) return null;
    const skew = consumerBundleSkew(output, consumer);
    return skew === null ? null : staleConsumerDiagnosis(skew);
}
