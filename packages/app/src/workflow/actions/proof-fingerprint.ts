import { join } from 'node:path';
import type { ActionResult, ActionRunContext, ActionRunner } from '@gobing-ai/ts-dual-workflow-engine';
import { type FileSystem, NodeProcessExecutor, type ProcessExecutor } from '@gobing-ai/ts-runtime';
import { appendInlineRunLogLine } from '../../services/inline-run-setup';
import type { WorkflowObservabilityBus, WorkflowTripwireFiredEvent } from '../observability';
import {
    computeProofInputFingerprint,
    DEFAULT_EXCLUDE_GLOBS,
    readProofInputContents,
} from '../proof-input-fingerprint';
import { evaluateTripWires } from '../tripwire';

const KIND = 'proof.fingerprint';
const VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The action's accepted option keys (1052 R1). Deliberately separate from `ComputeProofInputOptions`:
 * this validates the ACTION option map, whose only inputs are the four keys below — legacy
 * tree-capture options (`gitDiffSummary`, `gitLogHashObject`) and misspelled spec keys must fail
 * here instead of being silently ignored into a tree-only digest. The shared `readProofInputContents`
 * reader stays lenient because proof-bound `run.artifact` passes it a larger legitimate map.
 */
const ACCEPTED_OPTION_KEYS = ['expect', 'featureFile', 'taskFile', 'var'] as const;

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
 *   content, not only the working tree. Since 0785 R1 an explicitly supplied nonempty path must
 *   resolve to a readable regular file under the workflow workdir or the action fails with a named
 *   error BEFORE any digest is produced — a missing spec can no longer silently degrade the proof
 *   to tree-only. `undefined`/`''` stay optional: a task without a linked feature is normal, and
 *   the pipeline supplies an empty `featureSpecPath` var in that case.
 * - Invalid option types (non-string `taskFile`/`featureFile`) are rejected by name.
 * - Since 1052 R1/R2 the option map is validated up front: unknown keys fail with an error naming
 *   the unexpected and accepted keys, and a supplied non-string `expect` fails instead of
 *   silently degrading the comparison to capture-only. Both rejections run BEFORE any spec read
 *   or Git capture.
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
/**
 * Task 1135 R5: Diff the current non-corpus tree state against the gate snapshot
 * (`.spur/run/<run-id>-gate-paths.txt`) to name the drifted paths on a digest mismatch.
 */
async function computeDriftedPaths(
    workdir: string,
    runId: string,
    fileSystem: FileSystem,
    processExecutor?: ProcessExecutor,
): Promise<string[]> {
    const snapshotFile = join(workdir, '.spur', 'run', `${runId}-gate-paths.txt`);
    if (!(await fileSystem.exists(snapshotFile))) return [];
    let snapshotContent = '';
    try {
        snapshotContent = await fileSystem.readFile(snapshotFile);
    } catch {
        return [];
    }
    const snapshotLines = new Set(
        snapshotContent
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean),
    );

    const executor = processExecutor ?? new NodeProcessExecutor();
    const excludes = DEFAULT_EXCLUDE_GLOBS.map((g) => `:(exclude)${g}`);
    const currentLines = new Set<string>();

    try {
        const statusRes = await executor.run({
            command: 'git',
            args: ['status', '--porcelain=v1', '-uall', ...excludes],
            cwd: workdir,
            forceBuffered: true,
            rejectOnError: false,
        });
        if (statusRes.exitCode === 0 && statusRes.stdout) {
            for (const line of statusRes.stdout.split('\n')) {
                const trimmed = line.trim();
                if (trimmed) currentLines.add(trimmed);
            }
        }
        const diffRes = await executor.run({
            command: 'git',
            args: ['diff', '--name-only', 'HEAD', ...excludes],
            cwd: workdir,
            forceBuffered: true,
            rejectOnError: false,
        });
        if (diffRes.exitCode === 0 && diffRes.stdout) {
            for (const line of diffRes.stdout.split('\n')) {
                const trimmed = line.trim();
                if (trimmed) currentLines.add(trimmed);
            }
        }

        const extractPath = (line: string): string => {
            const m = line.match(/^(?:[?!MADRCU\s]{1,3})\s+(.+)$/);
            const captured = m?.[1];
            return captured === undefined ? line : captured.trim();
        };

        const drifted: string[] = [];
        for (const line of currentLines) {
            if (!snapshotLines.has(line)) {
                const p = extractPath(line);
                if (!drifted.includes(p)) drifted.push(p);
            }
        }
        for (const line of snapshotLines) {
            if (!currentLines.has(line)) {
                const p = extractPath(line);
                if (!drifted.includes(p)) drifted.push(p);
            }
        }
        return drifted;
    } catch {
        return [];
    }
}

/**
 * `proof.fingerprint` — capture the proof-input digest into a workflow var, optionally asserting it
 * is unchanged (see the option contract above). On a mismatch it names the drifted paths (task 1135
 * R5), emits the canonical `workflow.tripwire.fired` event and fails the action.
 */
export class ProofFingerprintActionRunner implements ActionRunner {
    readonly kind = KIND;

    constructor(
        private readonly fileSystem: FileSystem,
        private readonly processExecutor?: ProcessExecutor,
        // 0708 R4: when composed with the observability bus, a fingerprint
        // mismatch emits the canonical `workflow.tripwire.fired` event
        // (policy proof-invalidated) at this proof safe boundary before the
        // existing failure semantics run.
        private readonly observabilityBus?: WorkflowObservabilityBus,
    ) {}

    async execute(options: Record<string, unknown>, context: ActionRunContext): Promise<ActionResult> {
        // 1052 R1: reject unknown keys before any proof input work — a silently ignored option
        // (legacy capture keys, a misspelled taskFile) would weaken the proof without notice.
        const accepted: readonly string[] = ACCEPTED_OPTION_KEYS;
        const unexpected = Object.keys(options)
            .filter((key) => !accepted.includes(key))
            .sort();
        if (unexpected.length > 0) {
            return {
                ok: false,
                error:
                    `${KIND}: unexpected option(s): ${unexpected.join(', ')} — accepted keys: ` +
                    `${[...accepted].sort().join(', ')}`,
            };
        }

        const varName = options.var;
        if (typeof varName !== 'string' || varName === '') {
            return { ok: false, error: `${KIND}: var is required` };
        }
        if (!VAR_NAME_RE.test(varName)) {
            return { ok: false, error: `${KIND}: var name must match ${VAR_NAME_RE}, got "${varName}"` };
        }

        // 1052 R2: a supplied non-string expect previously fell through to capture-only, silently
        // disabling the comparison this action exists to enforce. Absent/empty/blank (after the
        // type check, a real string) stays capture-only.
        if (options.expect !== undefined && typeof options.expect !== 'string') {
            return {
                ok: false,
                error: `${KIND}: expect must be a string when supplied (got ${typeof options.expect})`,
            };
        }

        const inputs = await readProofInputContents(this.fileSystem, context.workdir ?? '.', options);
        if (!inputs.ok) {
            return { ok: false, error: `${KIND}: ${inputs.error}` };
        }

        let digest: string;
        try {
            digest = await computeProofInputFingerprint({
                cwd: context.workdir ?? '.',
                ...(inputs.taskContent !== undefined ? { taskContent: inputs.taskContent } : {}),
                ...(inputs.featureContent !== undefined ? { featureContent: inputs.featureContent } : {}),
                ...(this.processExecutor !== undefined ? { processExecutor: this.processExecutor } : {}),
                fileSystem: this.fileSystem,
            });
        } catch (error) {
            return { ok: false, error: `${KIND}: could not compute digest: ${(error as Error).message}` };
        }

        const expected = typeof options.expect === 'string' ? options.expect.trim() : '';
        if (expected !== '' && expected !== digest) {
            const workdir = context.workdir ?? '.';
            const driftedPaths = await computeDriftedPaths(
                workdir,
                context.runId,
                this.fileSystem,
                this.processExecutor,
            );
            const pathInfo = driftedPaths.length > 0 ? `; drifted paths: ${driftedPaths.join(', ')}` : '';
            // 0708 R2/R4: proof-state invalidation is a closed-catalog trip
            // wire — emit the bounded canonical event, then fail through the
            // existing action-failure semantics (the mismatch return below).
            const taskWbs = String(context.vars.wbs ?? '');
            const observedText = `proof inputs changed after the verdict was established: expected ${expected}, got ${digest}${pathInfo}`;
            const tripwire = evaluateTripWires([
                {
                    policy: 'proof-invalidated',
                    observed: observedText,
                    threshold: `expected ${expected}`,
                    evidenceRef: `proof.fingerprint var=${varName}`,
                },
            ]);
            if (tripwire.fired && this.observabilityBus !== undefined) {
                const tripwireEvent: WorkflowTripwireFiredEvent = {
                    schemaVersion: 1,
                    eventId: crypto.randomUUID(),
                    runId: context.runId,
                    at: new Date().toISOString(),
                    severity: 'warning',
                    node: context.stateOrNodeId,
                    kind: KIND,
                    policy: { id: tripwire.policy?.id ?? 'unknown', version: tripwire.policy?.version ?? 0 },
                    response: tripwire.policy?.response ?? 'fail',
                    observed: tripwire.observed ?? '',
                    ...(tripwire.threshold !== undefined ? { threshold: tripwire.threshold } : {}),
                    actionId: context.actionId ?? `${context.runId}:${context.stateOrNodeId}`,
                    ...(taskWbs !== '' ? { task: taskWbs } : {}),
                    evidenceRefs: tripwire.evidenceRef !== undefined ? [tripwire.evidenceRef] : [],
                    nextDecision: tripwire.policy?.nextDecision ?? 'operator review required',
                };
                void this.observabilityBus.emit('workflow.tripwire.fired', tripwireEvent);
            }
            appendInlineRunLogLine(
                context.runId,
                `proof-compare-failed node=${context.stateOrNodeId} expected=${expected} actual=${digest}${pathInfo}`,
                workdir,
            );
            return {
                ok: false,
                error:
                    `${KIND}: proof inputs changed after the verdict was established — ` +
                    `expected ${expected}, got ${digest}${pathInfo}. A tree or spec mutation between verify and record ` +
                    `invalidates the proof the verdict certifies (ADR-071).`,
                data: {
                    var: varName,
                    expected,
                    actual: digest,
                    matched: false,
                    ...(driftedPaths.length > 0 ? { driftedPaths } : {}),
                },
            };
        }

        return {
            ok: true,
            data: { var: varName, digest, ...(expected !== '' ? { expected, matched: true } : {}) },
            setVars: { [varName]: digest },
        };
    }
}
