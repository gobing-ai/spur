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
 *
 * Layering: this helper lives app-side because both hook points do. The 1120 guard sits in
 * `plugins/sp/lib/inline-run-app.ts` and is reached through the generated node-builtin-only bundle,
 * which a published workspace package cannot relative-import across — the same boundary that sent
 * `history-anatomy`/`plan-projection` app-side (ADR-130). The two halves cross-reference each other
 * by comment.
 */

import { isAbsolute, resolve, sep } from 'node:path';
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
 * The complaint shape the retired-seam consumers emit:
 * `<module|entry|bundle> <path> is missing <label> (<name>, <name> …)`.
 *
 * Deliberately NOT matched: the 1120 guard's bundle-side wording (`inline application bundle <entry>
 * is older than its scripts — missing a, b`). That sentence reports the opposite skew — the *bundle*
 * is behind, not the consumer — and it already carries its own owner (`plugins/sp/lib/inline-run-app.ts`)
 * and its own remedy (reinstall). Classifying it here would attach the migrate/remove-override advice
 * to a failure where a reinstall is the fix, so it keeps today's message.
 */
const ENTRY_MISSING_EXPORTS_RE =
    /\b(?:module|entry|bundle)\s+(\S+\.(?:mjs|cjs|js|mts|ts))\s+is missing\b[^\n(]*\(([^()\n]+)\)/;

const EXPORT_NAME_RE = /^[A-Za-z_$][\w$]*$/;

const SCRIPT_SUFFIX_RE = /\.(?:mjs|cjs|js|mts|ts)$/;

/** Bound on names quoted from a child's complaint — a diagnosis, not an output dump. */
export const MAX_MISSING_EXPORTS = 8;

/**
 * Bound on the entry path quoted from a child's complaint. Only the export names were bounded
 * before, so one pathological line could embed an arbitrarily long path in the operator's denial.
 * An implausible capture fails open (no diagnosis) rather than printing a truncated, wrong path.
 */
export const MAX_ENTRY_CHARS = 256;

/** True for a captured entry path worth printing: printable, single-line, plausible length. */
function isPlausibleEntry(entry: string): boolean {
    if (entry === '' || entry.length > MAX_ENTRY_CHARS) return false;
    // `\S+` already excludes whitespace; this rejects the control characters it still allows.
    return ![...entry].some((char) => {
        const code = char.codePointAt(0) ?? 0;
        return code < 0x20 || code === 0x7f;
    });
}

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
    if (!isPlausibleEntry(entry)) return null;
    if (missing.length === 0) return null;
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
 * Shipped-distribution path segments. A script here is the plugin's own, so a stale bundle IS the
 * correct diagnosis (1120) and the project-side advice would be wrong.
 */
const DISTRIBUTION_SEGMENTS = [`${sep}plugins${sep}sp${sep}`, `${sep}node_modules${sep}@gobing-ai${sep}spur${sep}`];

/**
 * The project-owned consumer script a command invokes, or `null`. Project-owned means a script
 * anywhere under `<workdir>` that is not part of the shipped plugin distribution: the observed port
 * was `<workdir>/.spur/scripts/feature-verify.mjs`, but R1's antecedent is any project-layer
 * override script, so `<workdir>/scripts/verify.mjs` or `<workdir>/tools/port.mjs` count too.
 *
 * The bound is therefore "inside the project tree, outside the plugin distribution" rather than
 * "inside `.spur/`": an `.spur/`-only rule silently sent every other project-owned consumer back to
 * the bare `exited with N` message (1185 review P3).
 */
export function projectConsumerScript(command: string, workdir: string): string | null {
    const root = resolve(workdir);
    const owned = root.endsWith(sep) ? root : `${root}${sep}`;
    for (const token of commandWords(command)) {
        if (!SCRIPT_SUFFIX_RE.test(token) || token.includes('$')) continue;
        const path = isAbsolute(token) ? resolve(token) : resolve(root, token);
        if (!path.startsWith(owned)) continue;
        if (DISTRIBUTION_SEGMENTS.some((segment) => path.includes(segment))) continue;
        return path;
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
 * The project-rooted consumer script a definition's shell `onEnter` actions invoke, or `null`. The
 * resolved definition — not the child's prose — is authoritative for what a failing nested run
 * executed. Two or more distinct consumers yield `null`: the complaint does not say which one
 * failed, so naming either could blame the wrong file (fail open to the previous message).
 */
export function definitionConsumerScript(workflow: WorkflowDef, workdir: string): string | null {
    if (!Array.isArray((workflow as { states?: unknown }).states)) return null;
    const states = (
        workflow as { states: readonly { onEnter?: readonly { kind: string; options?: Record<string, unknown> }[] }[] }
    ).states;
    const consumers = new Set<string>();
    for (const state of states) {
        for (const action of state.onEnter ?? []) {
            if (action.kind !== 'shell') continue;
            const command = action.options?.command;
            if (typeof command !== 'string') continue;
            const consumer = projectConsumerScript(command, workdir);
            if (consumer !== null) consumers.add(consumer);
        }
    }
    const [only, ...rest] = consumers;
    return only !== undefined && rest.length === 0 ? only : null;
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
