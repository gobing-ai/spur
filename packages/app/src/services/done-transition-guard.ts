/**
 * Done-transition verdict guard (task 0292).
 *
 * The lifecycle FSM's `* → done` transition was verdict-blind: a task could
 * reach `done` regardless of what the verify leg produced, and `--no-lifecycle`
 * (used by `task-pipeline.yaml:182`, `docs-pipeline.yaml:70`, and historically
 * by `wayfinder-resolution.yaml`) bypassed even the section-status guard. This
 * module backs the CLI-layer gate that consults the verdict artifact before
 * any `done` transition is allowed through.
 *
 * Design (0292):
 *   - The guard runs at the CLI layer (`apps/cli/src/commands/task.ts`), the
 *     single choke point above both `--no-lifecycle` and the lifecycle adapter.
 *     R8: `--no-lifecycle` skips the FSM, not this gate.
 *   - R10 consistency: the aggregate `verdict` in the artifact is validated
 *     against the per-requirement / per-AC rows using the same aggregation rule
 *     as `deriveVerdict` (any UNMET → FAIL; any PARTIAL → PARTIAL). An
 *     inconsistent artifact is treated as non-PASS and the denial names the
 *     inconsistency. The aggregation rule is duplicated here intentionally —
 *     it is two boolean folds over a tiny enum and must not pull the whole
 *     `task-verdict` parser (and its `AnswerText` dependency) into this leaf
 *     module. `task-verdict.test.ts` unit-checks the rule itself; the
 *     cross-check is in `done-transition-guard.test.ts` ("R10 — agrees with
 *     deriveVerdict on every shape").
 *   - Override (R3): `done_forced: true` + `done_reason: <text>` frontmatter
 *     fields. The CLI sets them via a transition-scoped write so the override
 *     is auditable in-file (no sidecar FS surface).
 */

import type { FileSystem } from '@gobing-ai/ts-runtime';

// ─── Types ─────────────────────────────────────────────────────────────

/** Verdict values that may appear in the persisted artifact's aggregate field. */
export type VerdictAggregate = 'PASS' | 'PARTIAL' | 'FAIL' | 'UNKNOWN';

/** Row-level status (matches `VerdictRequirement.status` / AC `status`). */
export type VerdictRowStatus = 'MET' | 'PARTIAL' | 'UNMET';

/** Minimal shape this module reads from `.spur/run/<wbs>-verdict.json`. */
export interface VerdictArtifact {
    wbs?: string;
    verdict: VerdictAggregate;
    requirements?: { id?: string; status: VerdictRowStatus; evidence?: string }[];
    acceptanceCriteria?: {
        id?: string;
        status: VerdictRowStatus;
        evidenceType?: string;
        evidence?: string;
    }[];
    checks?: { name?: string; status: string; evidence?: string }[];
    source?: string;
}

/** What the guard decided. */
export type GuardOutcome =
    | { kind: 'allow'; reason: 'no-artifact' | 'pass' | 'forced' }
    | { kind: 'deny'; verdict: VerdictAggregate; message: string }
    | { kind: 'noop'; fromStatus: string; message: string };

/** Input to {@link evaluateDoneTransition}. */
export interface GuardInput {
    /** WBS of the task being transitioned. */
    wbs: string;
    /** Resolved absolute path to the task file (for the actionable message). */
    taskFilePath: string;
    /** Current (normalized) status of the task. */
    currentStatus: string;
    /** Target status — usually `'done'`. */
    targetStatus: string;
    /** True when the operator passed `--force-done`. */
    forced: boolean;
    /** Override reason text (required when `forced` is true; advisory otherwise). */
    reason?: string;
    /** Pre-loaded artifact, or `undefined` if no verdict file exists. */
    artifact?: VerdictArtifact;
}

// ─── Artifact loading ──────────────────────────────────────────────────

/**
 * Read and parse the verdict artifact at `.spur/run/<wbs>-verdict.json`.
 * Returns `undefined` when the file does not exist (R1 back-compat: treat as
 * "no verify leg ran" and allow the transition). A parse failure is surfaced
 * as a deny with the parse error named — never silently allowed through.
 */
export async function readVerdictArtifact(
    fs: FileSystem,
    runDir: string,
    wbs: string,
): Promise<{ artifact: VerdictArtifact | undefined; readError?: string; path: string }> {
    const path = `${runDir}/${wbs}-verdict.json`;
    let exists: boolean;
    try {
        exists = await fs.exists(path);
    } catch {
        // `exists` not implemented on some minimal FS shims; fall through to
        // a guarded read and let the ENOENT path handle absence.
        exists = true;
    }
    if (!exists) {
        return { artifact: undefined, path };
    }
    let raw: string;
    try {
        raw = await fs.readFile(path);
    } catch (err) {
        return { artifact: undefined, path, readError: `unreadable artifact: ${(err as Error).message}` };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        return { artifact: undefined, path, readError: `malformed JSON: ${(err as Error).message}` };
    }
    if (typeof parsed !== 'object' || parsed === null || !('verdict' in parsed)) {
        return { artifact: undefined, path, readError: 'missing required `verdict` field' };
    }
    return { artifact: parsed as VerdictArtifact, path };
}

// ─── Aggregation (R10) ─────────────────────────────────────────────────

/**
 * Recompute the aggregate verdict from the per-requirement and per-AC rows.
 * Mirrors the rule in `deriveVerdict` (task-verdict.ts:52-69):
 *   - any UNMET (req or AC) → FAIL
 *   - else any PARTIAL (req or AC) → PARTIAL
 *   - else PASS
 *
 * An artifact with zero rows is ambiguous — `deriveVerdict` returns UNKNOWN
 * there. The guard treats UNKNOWN as non-PASS (deny) so a misparsed artifact
 * can never silently slide to `done`.
 */
export function computeAggregate(artifact: VerdictArtifact): VerdictAggregate {
    const reqs = artifact.requirements ?? [];
    const acs = artifact.acceptanceCriteria ?? [];

    if (reqs.length === 0 && acs.length === 0) {
        // No rows means the verify leg never produced a real verdict — keep
        // the stored aggregate (typically UNKNOWN) rather than fabricating one.
        return artifact.verdict;
    }

    if (reqs.some((r) => r.status === 'UNMET') || acs.some((a) => a.status === 'UNMET')) {
        return 'FAIL';
    }
    if (reqs.some((r) => r.status === 'PARTIAL') || acs.some((a) => a.status === 'PARTIAL')) {
        return 'PARTIAL';
    }
    return 'PASS';
}

// ─── Denial message (R2) ───────────────────────────────────────────────

/**
 * Build an actionable denial message. Per R2 it MUST name the task (WBS +
 * file path), the verdict value found, the verdict file path, and the
 * remediation. Never a bare `GuardDeniedError`.
 *
 * R3b enrichment: when the effective verdict is `UNKNOWN` and the artifact's
 * `source` is `spur-task-verdict` (i.e. it was produced by `spur task verdict`
 * parsing a verify answer file), append a `source:` diagnostic explaining that
 * zero structured rows were parsed and pointing at the answer-file shape
 * documented in sp:spur-cli. The parser is intentionally strict (loosening it
 * would let malformed answers silently reach PASS); the fix is to author the
 * answer file with the documented table shape, not to widen acceptance.
 */
export function formatDenialMessage(args: {
    wbs: string;
    taskFilePath: string;
    verdictPath: string;
    verdict: VerdictAggregate;
    inconsistency?: { stored: VerdictAggregate; computed: VerdictAggregate };
    /** Original artifact — used only to drive the R3b UNKNOWN enrichment. */
    artifact?: VerdictArtifact;
}): string {
    const { wbs, taskFilePath, verdictPath, verdict, inconsistency, artifact } = args;
    const lines: string[] = [
        `Cannot transition task ${wbs} to done: verify verdict is ${verdict}.`,
        `  task:    ${taskFilePath}`,
        `  verdict: ${verdictPath}`,
    ];
    if (inconsistency) {
        lines.push(
            `  warning: artifact is self-inconsistent — stored aggregate ${inconsistency.stored} contradicts rows (computed ${inconsistency.computed}). Treated as non-PASS.`,
        );
    }
    // R3b: diagnose the UNKNOWN-from-sparse-artifact case explicitly.
    const reqCount = artifact?.requirements?.length ?? 0;
    const acCount = artifact?.acceptanceCriteria?.length ?? 0;
    const rowCount = reqCount + acCount;
    if (
        verdict === 'UNKNOWN' &&
        artifact !== undefined &&
        (artifact.source === 'spur-task-verdict' || rowCount === 0)
    ) {
        const source = artifact.source ?? 'unknown';
        lines.push(
            `  source:  ${source} artifact contains ${rowCount} structured row${rowCount === 1 ? '' : 's'} ` +
                `(${reqCount} requirement${reqCount === 1 ? '' : 's'}, ${acCount} AC${acCount === 1 ? '' : 's'}). ` +
                `UNKNOWN means the verify answer file carried no parseable markdown tables ` +
                `(\`| Req | Status | Evidence |\` and \`| AC | Status | Evidence Type | Evidence |\`).`,
        );
        lines.push(
            `           see sp:spur-cli \`tasks/verbs.md\` §Answer-file shape for the expected format. ` +
                `Re-run \`/sp:dev-verify ${wbs}\` so the skill authors the tables; do not loosen the parser.`,
        );
    }
    lines.push(
        '  remediation: re-run `/sp:dev-verify ' +
            wbs +
            '` until PASS, or override with `spur task update ' +
            wbs +
            ' done --force-done --reason "<why>"`.',
    );
    return lines.join('\n');
}

// ─── Same-status no-op (R9) ─────────────────────────────────────────────

/**
 * Returns a no-op outcome when the target equals the current status. The
 * message is honest about the no-op (`already <status> — no transition`),
 * never the prior `undefined → undefined` shape. Exits 0 at the CLI layer.
 */
export function formatNoopMessage(wbs: string, status: string): string {
    return `${wbs}: already ${status} — no transition`;
}

// ─── Top-level evaluation ──────────────────────────────────────────────

/**
 * Evaluate a `* → done` transition against the verdict artifact.
 *
 * Ordering (matches R7 — verdict logic runs only after status normalization):
 *   1. Same-status no-op short-circuits before any verdict read (R9).
 *   2. No artifact on disk → allow (R1 back-compat for tasks that never ran
 *      the verify leg).
 *   3. Malformed/unreadable artifact → deny naming the read error.
 *   4. Forced override → allow (R3); `done_forced=true` is recorded by the
 *      caller. A missing reason is still allowed (advisory only — the override
 *      is the explicit signal, not the prose).
 *   5. R10 consistency: recompute aggregate; if it contradicts the stored
 *      `verdict`, treat as the harsher of the two and name the inconsistency.
 *   6. PASS → allow; anything else → deny with the actionable message.
 */
export function evaluateDoneTransition(input: GuardInput): GuardOutcome {
    const { wbs, taskFilePath, currentStatus, targetStatus, forced, reason, artifact } = input;

    // R9: same-status no-op short-circuits before any verdict read.
    if (targetStatus === currentStatus) {
        return { kind: 'noop', fromStatus: currentStatus, message: formatNoopMessage(wbs, currentStatus) };
    }

    // R1: no verdict artifact → back-compat allow (no verify leg ran).
    if (artifact === undefined) {
        return { kind: 'allow', reason: 'no-artifact' };
    }

    // R3: explicit operator override — allow and record via the caller.
    if (forced) {
        return { kind: 'allow', reason: 'forced' };
    }

    // R10: recompute aggregate from rows; if it disagrees with the stored
    // `verdict`, use the harsher of the two and name the inconsistency in the
    // denial. PASS is only PASS if both stored and computed agree.
    const computed = computeAggregate(artifact);
    const effective: VerdictAggregate = harshnessMax(artifact.verdict, computed);

    if (effective === 'PASS') {
        return { kind: 'allow', reason: 'pass' };
    }

    const verdictPath = `.spur/run/${wbs}-verdict.json`;
    const inconsistency = artifact.verdict !== computed ? { stored: artifact.verdict, computed } : undefined;
    void reason; // advisory; recorded by the caller when forced
    return {
        kind: 'deny',
        verdict: effective,
        message: formatDenialMessage({
            wbs,
            taskFilePath,
            verdictPath,
            verdict: effective,
            inconsistency,
            artifact,
        }),
    };
}

/** Pick the harsher of two verdicts (FAIL > PARTIAL > UNKNOWN > PASS). */
function harshnessMax(a: VerdictAggregate, b: VerdictAggregate): VerdictAggregate {
    const rank: Record<VerdictAggregate, number> = { PASS: 0, UNKNOWN: 1, PARTIAL: 2, FAIL: 3 };
    return rank[a] >= rank[b] ? a : b;
}
