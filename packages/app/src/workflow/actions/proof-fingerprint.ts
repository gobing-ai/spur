import type { ActionResult, ActionRunContext, ActionRunner } from '@gobing-ai/ts-dual-workflow-engine';
import type { FileSystem, ProcessExecutor } from '@gobing-ai/ts-runtime';
import { computeProofInputFingerprint } from '../proof-input-fingerprint';

const KIND = 'proof.fingerprint';
const VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Resolve a task/feature file's content, or `undefined` when it cannot be read. */
async function readOptional(fileSystem: FileSystem, path: string | undefined): Promise<string | undefined> {
    if (path === undefined || path === '') return undefined;
    const stat = await fileSystem.stat(path);
    if (stat === null) return undefined;
    return await fileSystem.readFile(path);
}

/**
 * Compute the `ProofInputFingerprint` digest into a workflow var, optionally asserting it is unchanged.
 *
 * Options:
 * - `var` (string, required): destination var name, validated against `/^[A-Za-z_][A-Za-z0-9_]*$/`
 *   to match the engine's `vars` schema. The digest (`sha256:<hex>`) is written to `setVars[var]`.
 * - `expect` (string, optional): when present and non-empty, the freshly computed digest must equal
 *   it. On inequality the action fails with **both** digests named, and the state's default `fail`
 *   policy routes the run to `failed`. Absent or empty means capture-only — one action kind serves
 *   both edges of the bracket rather than two.
 * - `taskFile` / `featureFile` (string, optional): specs folded into the digest so it covers spec
 *   content, not only the working tree. Unreadable paths are skipped rather than failing the action:
 *   a task without a feature is normal, and a missing spec must not manufacture a proof violation.
 *
 * Why this action exists (task 0612, ADR-071): `computeProofInputFingerprint` shipped with task 0603
 * and had **zero runtime call sites**, so "only `verified(D)` may cross the completion boundary" was
 * documented but never enforced. This is the least-privilege home for the wiring — a built-in reaches
 * the capability directly and needs no public `spur` noun, verb, or flag (ADR-051).
 *
 * Bracket placement is load-bearing: capture at verify-exit (after the verdict artifact exists), not
 * before `verify`. `/sp:dev-verify --fix all` writes to the tree by design when it repairs a row, so a
 * capture taken earlier would fire on verify's own legitimate repairs instead of on a violation.
 */
export class ProofFingerprintActionRunner implements ActionRunner {
    readonly kind = KIND;

    constructor(
        private readonly fileSystem: FileSystem,
        private readonly processExecutor?: ProcessExecutor,
    ) {}

    async execute(options: Record<string, unknown>, context: ActionRunContext): Promise<ActionResult> {
        const varName = options.var;
        if (typeof varName !== 'string' || varName === '') {
            return { ok: false, error: `${KIND}: var is required` };
        }
        if (!VAR_NAME_RE.test(varName)) {
            return { ok: false, error: `${KIND}: var name must match ${VAR_NAME_RE}, got "${varName}"` };
        }

        const taskContent = await readOptional(this.fileSystem, options.taskFile as string | undefined);
        const featureContent = await readOptional(this.fileSystem, options.featureFile as string | undefined);

        let digest: string;
        try {
            digest = await computeProofInputFingerprint({
                cwd: context.workdir ?? '.',
                ...(taskContent !== undefined ? { taskContent } : {}),
                ...(featureContent !== undefined ? { featureContent } : {}),
                ...(this.processExecutor !== undefined ? { processExecutor: this.processExecutor } : {}),
                fileSystem: this.fileSystem,
            });
        } catch (error) {
            return { ok: false, error: `${KIND}: could not compute digest: ${(error as Error).message}` };
        }

        const expected = typeof options.expect === 'string' ? options.expect.trim() : '';
        if (expected !== '' && expected !== digest) {
            return {
                ok: false,
                error:
                    `${KIND}: proof inputs changed after the verdict was established — ` +
                    `expected ${expected}, got ${digest}. A tree or spec mutation between verify and record ` +
                    `invalidates the proof the verdict certifies (ADR-071).`,
                data: { var: varName, expected, actual: digest, matched: false },
            };
        }

        return {
            ok: true,
            data: { var: varName, digest, ...(expected !== '' ? { expected, matched: true } : {}) },
            setVars: { [varName]: digest },
        };
    }
}
