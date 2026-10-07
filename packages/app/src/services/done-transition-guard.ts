/**
 * Done-transition verdict guard (task 0292).
 *
 * The lifecycle FSM's `* → done` transition was verdict-blind: a task could
 * reach `done` regardless of what the verify leg produced, and `--no-lifecycle`
 * (used by `task-pipeline.yaml:182` and, until task 0866 retired it,
 * `docs-pipeline.yaml:70`; historically also by `wayfinder-resolution.yaml`)
 * bypassed even the section-status guard. This module backs the CLI-layer gate
 * that consults the verdict artifact before any `done` transition is allowed
 * through.
 *
 * Design (0292, tightened post–F81 dogfood):
 *   - The guard runs at the CLI layer (`apps/cli/src/commands/task.ts`), the
 *     single choke point above both `--no-lifecycle` and the lifecycle adapter.
 *     R8: `--no-lifecycle` skips the FSM, not this gate.
 *   - Missing artifact is a **deny** (not a silent allow). Docs-only / emergency
 *     closes use `--force-done --reason`. Pipelines certify via a measured
 *     verdict artifact produced by a verify hop (`task-pipeline.yaml`).
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
 *   - Confidence gate (task 1117): a PASS artifact must carry the verifier's
 *     stated confidence (`HIGH | MEDIUM | LOW`, task 1068) before the gate
 *     certifies it. `confidence` was previously read only by the pipeline's own
 *     completion guards (`task-pipeline.yaml`), so the same artifact could slide
 *     to `done` through a hand-driven `task update <wbs> done` with no level at
 *     all, or with a value outside the vocabulary. LOW stays *valid* here — the
 *     acknowledgement policy for LOW is the pipeline's decision, not this gate's.
 *   - Override (R3): `done_forced: true` + `done_reason: <text>` frontmatter
 *     fields. The CLI sets them via a transition-scoped write so the override
 *     is auditable in-file (no sidecar FS surface).
 */

import { dirname, join } from 'node:path';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import type { CheckSeverity } from './verify-verdict';
import { aggregateVerifyVerdict, checkRowName } from './verify-verdict';

// ─── Types ─────────────────────────────────────────────────────────────

/** Verdict values that may appear in the persisted artifact's aggregate field. */
export type VerdictAggregate = 'PASS' | 'PARTIAL' | 'FAIL' | 'UNKNOWN';

/** Row-level status (matches `VerdictRequirement.status` / AC `status`). */
export type VerdictRowStatus = 'MET' | 'PARTIAL' | 'UNMET';

/** Minimal shape this module reads from durable evidence or legacy scratch. */
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
    checks?: {
        name?: string;
        check?: string;
        id?: string;
        status: string;
        severity?: CheckSeverity;
        evidence?: string;
    }[];
    source?: string;
    /**
     * Verifier's stated confidence (task 1068). Typed `unknown` on purpose: the
     * artifact is `JSON.parse`d, not zod-validated, at this layer, so the gate
     * must be able to *see* an out-of-vocabulary value (task 1117) instead of
     * trusting a type that the JSON never enforced.
     */
    confidence?: unknown;
}

/** What the guard decided. */
export type GuardOutcome =
    | { kind: 'allow'; reason: 'pass' | 'forced' }
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
    /** 1042 R2: present when the artifact file exists but is unusable (parse failure, identity mismatch). */
    readError?: string;
    /** Selected evidence path, including durable-first resolution. */
    verdictPath?: string;
    /** Pre-loaded artifact, or `undefined` if no verdict file exists. */
    artifact?: VerdictArtifact;
}

// ─── Artifact loading ──────────────────────────────────────────────────

/** Result of reading one verdict location, with a missing marker for fallback routing. */
interface VerdictRead {
    artifact: VerdictArtifact | undefined;
    readError?: string;
    path: string;
    /** True when the file is absent (ENOENT/exists-false) — the caller may fall back. */
    missing: boolean;
}

/** Read + parse one verdict artifact location; absence is reported, not fatal. */
async function readVerdictFrom(fs: FileSystem, path: string, wbs: string): Promise<VerdictRead> {
    let exists: boolean;
    try {
        exists = await fs.exists(path);
    } catch {
        // `exists` not implemented on some minimal FS shims; fall through to
        // a guarded read and let the ENOENT path handle absence.
        exists = true;
    }
    if (!exists) {
        return { artifact: undefined, path, missing: true };
    }
    let raw: string;
    try {
        raw = await fs.readFile(path);
    } catch (err) {
        const message = (err as Error).message;
        if (message.includes('ENOENT')) {
            return { artifact: undefined, path, missing: true };
        }
        return { artifact: undefined, path, readError: `unreadable artifact: ${message}`, missing: false };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        return { artifact: undefined, path, readError: `malformed JSON: ${(err as Error).message}`, missing: false };
    }
    if (typeof parsed !== 'object' || parsed === null || !('verdict' in parsed)) {
        return { artifact: undefined, path, readError: 'missing required `verdict` field', missing: false };
    }
    // 1042 R1: bind the artifact's explicit identity to the requested WBS before
    // its rows can authorize anything. A present `wbs` must match exactly;
    // absent `wbs` keeps legacy compatibility. Foreign / empty / null /
    // non-string identity yields no usable artifact with a readError naming
    // path, expected and actual value. `missing` stays false — a foreign copy
    // fails closed on its own plane (mirroring the malformed-evidence rule:
    // no fallback to the other plane), and the caller surfaces the readError
    // as a deny. Never a silent allow.
    if ('wbs' in parsed) {
        const artifactWbs: unknown = parsed.wbs;
        const actual = typeof artifactWbs === 'string' ? JSON.stringify(artifactWbs) : String(artifactWbs);
        if (typeof artifactWbs !== 'string' || artifactWbs !== wbs) {
            return {
                artifact: undefined,
                path,
                readError: `artifact identity mismatch at ${path}: expected wbs '${wbs}', actual ${actual}`,
                missing: false,
            };
        }
    }
    return { artifact: parsed as VerdictArtifact, path, missing: false };
}

/**
 * Read and parse the verdict artifact for `wbs`. Reads resolve from the
 * durable-evidence dir (`.spur/memory/evidence`, sibling of the scratch run
 * dir — E71/1025) first, then fall back to the scratch plane
 * (`.spur/run/<wbs>-verdict.json`). An evidence copy that exists is
 * authoritative: malformed, unreadable, or foreign-identity (1042 R1) evidence
 * fails closed instead of falling back. Returns `undefined` artifact when no
 * usable copy exists anywhere — the guard **denies** the transition
 * (no-artifact is no longer a silent allow; dogfood F81 / 0349 class).
 * Operators override with `--force-done --reason`.
 */
export async function readVerdictArtifact(
    fs: FileSystem,
    runDir: string,
    wbs: string,
): Promise<{ artifact: VerdictArtifact | undefined; readError?: string; path: string }> {
    const evidenceDir = join(dirname(runDir), 'memory', 'evidence');
    const evidence = await readVerdictFrom(fs, `${evidenceDir}/${wbs}-verdict.json`, wbs);
    if (!evidence.missing) {
        const { missing: _missing, ...result } = evidence;
        return result;
    }
    const scratch = await readVerdictFrom(fs, `${runDir}/${wbs}-verdict.json`, wbs);
    const { missing: _scratchMissing, ...result } = scratch;
    return result;
}

// ─── Aggregation (R10) ─────────────────────────────────────────────────

/**
 * Recompute the aggregate verdict from the per-requirement and per-AC rows by
 * delegating to `aggregateVerifyVerdict` — the one shared policy `deriveVerdict`
 * also uses, so the guard cannot drift from derivation. Summary of that policy:
 *   - any UNMET (req or AC) → FAIL
 *   - else a non-pass blocker check → FAIL
 *   - else a non-pass major check → PARTIAL
 *   - else any PARTIAL (req or AC), or a MET row with hollow evidence (0721) → PARTIAL
 *   - else a failed independent task-check → PARTIAL
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
        // An empty PASS here is still caught by hardPassRecompute (see
        // evaluateDoneTransition), so a row-less artifact can never slide to done.
        return artifact.verdict;
    }

    // Task 0592 R2: delegate to the single shared aggregation policy. This adds
    // check-severity handling (blocker → FAIL, major → PARTIAL, minor/advisory
    // non-blocking; legacy fail/warn map FAIL/PARTIAL) and the rule that an
    // independent task-check failure can never yield PASS. The R10 cross-check
    // test pins this to `deriveVerdict` on every row shape.
    const taskCheck = (artifact.checks ?? []).find((c) => /task[ _-]?check/i.test(checkRowName(c)));
    const taskCheckPassed = taskCheck === undefined ? true : String(taskCheck.status).toLowerCase() !== 'fail';
    return aggregateVerifyVerdict({
        requirements: reqs,
        acceptanceCriteria: acs,
        checks: artifact.checks ?? [],
        taskCheckPassed,
    });
}

// ─── Confidence gate (task 1117) ───────────────────────────────────────

/**
 * The closed confidence vocabulary the verify answer contract fixes (task 1068).
 * Duplicated here deliberately, exactly like the aggregation rule above: this
 * leaf module must not pull the `verify-answer-lint` / `task-verdict` parser (and
 * its `AnswerText` dependency) in for a three-word enum.
 */
const CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const;

/** A confidence level in canonical (upper-case) form. */
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/** What the artifact's `confidence` field says, judged against the vocabulary. */
export type ConfidenceSignal =
    | { kind: 'level'; level: ConfidenceLevel }
    | { kind: 'missing' }
    | { kind: 'invalid'; raw: string };

/**
 * Read the artifact's `confidence` field. Missing and invalid both fail the done
 * gate; `LOW` is a valid *level* (the LOW acknowledgement policy belongs to the
 * pipeline's completion guard, not here). Matching is case-insensitive to stay
 * consistent with the answer-file lint (`/^(HIGH|MEDIUM|LOW)$/i`, task 1068).
 */
export function readConfidence(artifact: VerdictArtifact): ConfidenceSignal {
    const raw = artifact.confidence;
    if (raw === undefined || raw === null) return { kind: 'missing' };
    if (typeof raw === 'string') {
        const upper = raw.trim().toUpperCase();
        const level = CONFIDENCE_LEVELS.find((candidate) => candidate === upper);
        if (level !== undefined) return { kind: 'level', level };
    }
    return { kind: 'invalid', raw: typeof raw === 'string' ? raw : (JSON.stringify(raw) ?? String(raw)) };
}

/**
 * Build the actionable denial for a PASS artifact that cannot show a usable
 * confidence level. Names the task, the artifact path, what was found, the
 * expected line, and both remediations (re-verify, or the operator override).
 */
export function formatConfidenceDenial(args: {
    wbs: string;
    taskFilePath: string;
    verdictPath: string;
    signal: ConfidenceSignal;
}): string {
    const { wbs, taskFilePath, verdictPath, signal } = args;
    const found =
        signal.kind === 'missing'
            ? 'absent'
            : signal.kind === 'invalid'
              ? `invalid \`${signal.raw}\``
              : `level \`${signal.level}\``;
    return [
        `Cannot transition task ${wbs} to done: verdict artifact has no usable confidence level (${found}).`,
        `  task:     ${taskFilePath}`,
        `  verdict:  ${verdictPath}`,
        `  expected: a \`confidence\` field of HIGH | MEDIUM | LOW (task 1068) — the verifier's own`,
        `            statement of how strongly it stands behind the PASS.`,
        `  remediation: re-run \`/sp:dev-verify ${wbs}\` so the answer file carries a \`Confidence:\` line`,
        `               (the artifact is derived from it), or override with ` +
            `\`spur task update ${wbs} done --force-done --reason "<why>"\`.`,
    ].join('\n');
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
 *   2. Forced override → allow (R3) even when no artifact exists; caller
 *      records `done_forced=true`. A missing reason is still allowed (advisory).
 *   3. No artifact on disk → **deny** (require verify or --force-done). Closes
 *      the 0349 class of "done without verdict.json".
 *   4. Malformed/unreadable artifact → deny naming the read error (caller).
 *   5. R10 consistency: recompute aggregate; if it contradicts the stored
 *      `verdict`, treat as the harsher of the two and name the inconsistency.
 *   6. PASS → allow; anything else → deny with the actionable message. Only on
 *      the PASS branch is the confidence gate consulted (task 1117): a missing or
 *      out-of-vocabulary level denies here, while a non-PASS artifact already
 *      denies for the reason that actually matters.
 */
export function evaluateDoneTransition(input: GuardInput): GuardOutcome {
    const { wbs, taskFilePath, currentStatus, targetStatus, forced, reason, artifact, readError } = input;
    const verdictPath = input.verdictPath ?? `.spur/run/${wbs}-verdict.json`;

    // R9: same-status no-op short-circuits before any verdict read.
    if (targetStatus === currentStatus) {
        return { kind: 'noop', fromStatus: currentStatus, message: formatNoopMessage(wbs, currentStatus) };
    }

    // R3: explicit operator override — allow and record via the caller.
    // Applies before the no-artifact deny so docs-only / emergency closes work.
    if (forced) {
        return { kind: 'allow', reason: 'forced' };
    }

    // No verdict artifact → deny (no silent done without verify). When the
    // file exists but is unusable (1042 R2: parse failure, identity mismatch),
    // surface the reader's error instead of the misleading "missing" text.
    if (artifact === undefined) {
        if (readError) {
            return {
                kind: 'deny',
                verdict: 'UNKNOWN',
                message: [
                    `Cannot transition task ${wbs} to done: verdict artifact is unusable.`,
                    `  task:     ${taskFilePath}`,
                    `  verdict:  ${verdictPath} (present but rejected)`,
                    `  reason:   ${readError}`,
                    `  remediation: fix the artifact (re-run \`/sp:dev-verify ${wbs}\` until PASS), ` +
                        `or override with \`spur task update ${wbs} done --force-done --reason "<why>"\`.`,
                ].join('\n'),
            };
        }
        return {
            kind: 'deny',
            verdict: 'UNKNOWN',
            message: [
                `Cannot transition task ${wbs} to done: missing verify verdict artifact.`,
                `  task:    ${taskFilePath}`,
                `  verdict: ${verdictPath} (not found)`,
                `  remediation: re-run \`/sp:dev-verify ${wbs}\` until PASS (writes the artifact), ` +
                    `or override with \`spur task update ${wbs} done --force-done --reason "<why>"\`.`,
            ].join('\n'),
        };
    }

    // R10: recompute aggregate from rows; if it disagrees with the stored
    // `verdict`, use the harsher of the two and name the inconsistency in the
    // denial. PASS is only PASS if both stored and computed agree.
    const computed = computeAggregate(artifact);
    const reqs = artifact.requirements ?? [];
    const acs = artifact.acceptanceCriteria ?? [];
    // Task 0592 R3: PASS must be internally consistent — a stored PASS with zero
    // coverage rows (requirements AND AC empty) cannot clear done, because PASS
    // derivation always emits requirement rows. A row-less "PASS" is treated as
    // UNKNOWN (deny), closing the "vacuously PASS" softening at the done boundary.
    const internallyConsistentPass = artifact.verdict !== 'PASS' || reqs.length > 0 || acs.length > 0;
    const effective: VerdictAggregate = internallyConsistentPass ? harshnessMax(artifact.verdict, computed) : 'UNKNOWN';

    if (effective === 'PASS') {
        // Task 1117: a PASS is only certifiable when the artifact states the
        // verifier's confidence. `verdict: 'PASS'` is carried on the deny so the
        // CLI can report *why* a PASS artifact failed, instead of "verdict PASS".
        const signal = readConfidence(artifact);
        if (signal.kind !== 'level') {
            return {
                kind: 'deny',
                verdict: 'PASS',
                message: formatConfidenceDenial({ wbs, taskFilePath, verdictPath, signal }),
            };
        }
        return { kind: 'allow', reason: 'pass' };
    }

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
