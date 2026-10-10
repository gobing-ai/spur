/**
 * Verified-outcome derivation (feature A6, task 0712) — the app-layer evidence
 * gatherer feeding the pure domain fold (`deriveVerifiedOutcomeStat`).
 *
 * Sources, in authority order:
 * - `task_run_links` ⨝ `runs` — the population (tasks with a pipeline run-link
 *   inside the window) plus run terminal status (R7: window-bounded SQL, hard
 *   row cap).
 * - Task file corpus — frontmatter `done_forced` / `status`, `## History`
 *   transition lines (first wip, last done, reopen), and the `## Testing`
 *   section `Verdict:` line, via the shared locators/parsers.
 * - Durable verdict evidence, with legacy scratch fallback — the recorded verify verdict artifact, its
 *   proof digest (nested `proof.digest`, or the flat `proofDigest` older
 *   artifacts carry), and the run id the proof block binds it to.
 * - `run_sessions` ⨝ history cost columns — measured token cost per verified
 *   result, exact mappings only (reuse `attributeActionCost`; estimated
 *   mappings and dollar figures stay unread, R4).
 *
 * Absent planes (unmigrated DB, no corpus, no links) yield an empty population —
 * the fold returns a zero-denominator stat rather than throwing, matching the
 * best-effort analytics precedent.
 */

import {
    attributeActionCost,
    type DbAdapter,
    deriveVerifiedOutcomeStat,
    MarkdownDocument,
    parseHistoryLine,
    RunDao,
    TaskRunLinkDao,
    type VerifiedOutcomeStat,
    type VerifiedOutcomeTaskInput,
} from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { computeAggregate, readVerdictArtifact } from './done-transition-guard';
import { parseVerdictLine } from './task-record';
import { parseVerifyVerdict } from './verify-verdict';

/** Hard cap on tasks derived per analyze call (R7: bounded work, never unbounded). */
const MAX_TASKS = 1000;

/** Port over the task corpus — structurally satisfied by `TaskLocator`. */
export interface VerifiedOutcomeTaskLocator {
    findByWbs(wbs: string): Promise<{ filePath: string } | null>;
}

/** Deps for {@link deriveVerifiedOutcome} — all injectable for hermetic tests. */
export interface VerifiedOutcomeDeps {
    fs: FileSystem;
    db: DbAdapter;
    /** Project root used to resolve durable evidence and legacy scratch. */
    cwd: string;
    locator?: VerifiedOutcomeTaskLocator;
}

/** One linked-run projection used to classify a task. */
interface LinkedRun {
    runId: string;
    status: string | null;
    startedAt: string | null;
    completedAt: string | null;
    /** Effective definition digest for the run, including an approved resume, when present. */
    definitionDigest: string | null;
}

/** Window bounds (ISO strings or null sides), passed through to the fold. */
export interface VerifiedOutcomeWindow {
    since?: string | null;
    until?: string | null;
}

/** Extract the effective run definition digest, or null when absent/unparseable. */
function readRunDefinitionDigest(metadataJson: string): string | null {
    try {
        const meta = JSON.parse(metadataJson) as { definitionDigest?: unknown; resumeDefinitionDigest?: unknown };
        const digest =
            typeof meta.resumeDefinitionDigest === 'string' && meta.resumeDefinitionDigest !== ''
                ? meta.resumeDefinitionDigest
                : meta.definitionDigest;
        return typeof digest === 'string' && digest.length > 0 ? digest : null;
    } catch {
        return null;
    }
}

/**
 * Derive the verified-outcome stat over the window. Returns null when the DB
 * has no `task_run_links` table yet (unmigrated project) — the additive block
 * is simply absent from the artifact, like `pairings` before it.
 */
export async function deriveVerifiedOutcome(
    deps: VerifiedOutcomeDeps,
    window: VerifiedOutcomeWindow = {},
): Promise<VerifiedOutcomeStat | null> {
    let linkRows: Array<{
        wbs: string;
        run_id: string;
        status: string | null;
        started_at: string | null;
        completed_at: string | null;
        metadata_json: string;
    }>;
    try {
        // DAO plane (no raw SQL in app): window-bounded runs, then their task links.
        // `until` filters in memory — traceRows' `before` is a keyset cursor, not a bound,
        // and the row cap matches the SQL-era LIMIT semantics (R7: bounded work).
        const runs = await new RunDao(deps.db).traceRows({
            status: undefined,
            since: window.since ?? undefined,
            limit: MAX_TASKS * 20,
        });
        const linkDao = new TaskRunLinkDao(deps.db);
        linkRows = [];
        for (const run of runs) {
            if (window.until !== null && window.until !== undefined && (run.started_at ?? '') > window.until) continue;
            for (const link of await linkDao.listByRun(run.id, 100)) {
                linkRows.push({
                    wbs: link.wbs,
                    run_id: link.run_id,
                    status: run.status,
                    started_at: run.started_at,
                    completed_at: run.completed_at,
                    metadata_json: run.metadata_json,
                });
            }
        }
    } catch {
        return null; // ponytail: unmigrated DB (no task_run_links) — add a migration probe if analyze must distinguish
    }
    if (linkRows.length === 0) {
        return deriveVerifiedOutcomeStat([], { since: window.since ?? null, until: window.until ?? null });
    }

    // Group by wbs (dedupe to first occurrence — the fold re-dedupes defensively).
    const byWbs = new Map<string, LinkedRun[]>();
    for (const row of linkRows) {
        const runs = byWbs.get(row.wbs) ?? [];
        if (runs.length < 20) {
            runs.push({
                runId: row.run_id,
                status: row.status,
                startedAt: row.started_at,
                completedAt: row.completed_at,
                definitionDigest: readRunDefinitionDigest(row.metadata_json),
            });
        }
        byWbs.set(row.wbs, runs);
    }

    const inputs: VerifiedOutcomeTaskInput[] = [];
    for (const [wbs, linkedRuns] of byWbs) {
        inputs.push(await deriveTaskInput(deps, wbs, linkedRuns));
    }
    return deriveVerifiedOutcomeStat(inputs, { since: window.since ?? null, until: window.until ?? null });
}

/** Gather one task's evidence. Missing corpus planes read as conservative falses. */
async function deriveTaskInput(
    deps: VerifiedOutcomeDeps,
    wbs: string,
    linkedRuns: LinkedRun[],
): Promise<VerifiedOutcomeTaskInput> {
    // Engine vocabulary: runs finalize as 'done'/'failed' (lifecycle-adapter); legacy rows were
    // migrated 'completed'→'done' (0017). 'completed' kept for defensive parity with
    // progress-projection's normalization.
    const runCompleted = (r: LinkedRun) => r.status === 'done' || r.status === 'completed';

    let done = false;
    let forcedDone = false;
    let sectionVerdictPresent = false;
    let firstWipAt: string | null = null;
    let doneAt: string | null = null;
    let reopened = false;
    let reachedDone = false;

    const hit = deps.locator ? await deps.locator.findByWbs(wbs) : null;
    if (hit) {
        let raw: string | null = null;
        try {
            raw = await deps.fs.readFile(hit.filePath);
        } catch {
            raw = null;
        }
        if (raw !== null) {
            const frontmatter = MarkdownDocument.parse(raw, 'task').frontmatterData ?? {};
            forcedDone = frontmatter.done_forced === true;
            let historyStatus: string | undefined;
            sectionVerdictPresent = parseVerdictLine(raw.split('\n')) !== null;
            for (const line of raw.split('\n')) {
                const entry = parseHistoryLine(line, 'task', wbs);
                if (!entry) continue;
                historyStatus = entry.to;
                if (entry.to === 'wip' && firstWipAt === null) firstWipAt = entry.timestamp;
                if (entry.to === 'done') {
                    reachedDone = true;
                    doneAt = entry.timestamp;
                }
                if (reachedDone && entry.from === 'done') reopened = true;
            }
            done = String(frontmatter.status ?? historyStatus ?? '').toLowerCase() === 'done';
        }
    }

    let verdictPresent = false;
    let passVerdict = false;
    let proofDigestPresent = false;
    // The run the verdict names as its certifying run, when it names one (0730 §B.2).
    let boundRunId: string | null = null;
    // The workflow-definition digest the verdict binds to, when it names one (0759 R5).
    let boundDefinitionDigest: string | null = null;
    let measuredTokens: number | null = null;
    // E71/1027: the verify verdict is lasting acceptance evidence, not scratch — resolve it
    // through the shared durable-first seam (`.spur/memory/evidence`, then scratch fallback,
    // done-transition-guard precedence) so completed scratch disposal cannot change the
    // verified population. Absent everywhere → fold routes to missing/synthetic buckets.
    const verdictRead = await readVerdictArtifact(deps.fs, `${deps.cwd}/.spur/run`, wbs);
    const verdict = verdictRead.artifact as
        | {
              verdict?: unknown;
              proofDigest?: unknown;
              proof?: { digest?: unknown; runId?: unknown; definitionDigest?: unknown };
          }
        | undefined;
    if (verdict) {
        verdictPresent = typeof verdict.verdict === 'string';
        const parsed = parseVerifyVerdict(JSON.stringify(verdict), wbs);
        passVerdict =
            parsed.kind === 'valid' &&
            parsed.verdict.verdict === 'PASS' &&
            parsed.verdict.requirements.length + parsed.verdict.acceptanceCriteria.length > 0 &&
            verdictRead.artifact !== undefined &&
            computeAggregate(verdictRead.artifact) === 'PASS';
        // 0730 §B.1: the pipeline stamps `proof: {digest, runId, …}` (task-pipeline.yaml verify
        // hop); the flat `proofDigest` form is what older/hand-written artifacts carry. Reading
        // only the flat key made `proofDigestPresent` a constant false for every pipeline-shaped
        // verdict, which excluded every task from the verified population.
        const digest = typeof verdict.proof?.digest === 'string' ? verdict.proof.digest : verdict.proofDigest;
        proofDigestPresent = typeof digest === 'string' && digest.length > 0;
        if (typeof verdict.proof?.runId === 'string' && verdict.proof.runId.length > 0) {
            boundRunId = verdict.proof.runId;
        }
        if (typeof verdict.proof?.definitionDigest === 'string' && verdict.proof.definitionDigest.length > 0) {
            boundDefinitionDigest = verdict.proof.definitionDigest;
        }
    }

    // 0730 §B.2 + 0759 R5: when the verdict names its certifying run, that exact run must have
    // completed; when it also names a definition digest, the bound run must carry the SAME
    // digest — otherwise the proof could certify one workflow definition while the run executed
    // another (a stale-definition resume or a definition edited between run and record). Unbound
    // artifacts (no runId) keep the permissive reading; a runId-bound verdict without a
    // definitionDigest is not digest-checked (the pipeline only stamps the digest alongside the
    // runId, and older bound artifacts predate it).
    const certifyingRun =
        boundRunId !== null
            ? linkedRuns.find(
                  (r) =>
                      r.runId === boundRunId &&
                      runCompleted(r) &&
                      (boundDefinitionDigest === null ||
                          (r.definitionDigest !== null && r.definitionDigest === boundDefinitionDigest)),
              )
            : linkedRuns.find(runCompleted);
    const certifyingRunCompleted = certifyingRun !== undefined;
    const supersedingFailedRun = linkedRuns.some(
        (r) =>
            (r.status === 'failed' || r.status === 'cancelled') &&
            (certifyingRun === undefined ||
                Date.parse(r.startedAt ?? '') > Date.parse(certifyingRun.completedAt ?? '')),
    );

    if (passVerdict) {
        let tokens = 0;
        let any = false;
        for (const run of linkedRuns) {
            const attribution = await attributeActionCost(deps.db, run.runId, {
                id: run.runId,
                kind: 'pipeline',
                started_at: run.startedAt,
                completed_at: run.completedAt,
            });
            if (attribution.exact !== null) {
                tokens += attribution.exact.totals.inputTokens + attribution.exact.totals.outputTokens;
                any = true;
            }
        }
        if (any) measuredTokens = tokens;
    }

    return {
        wbs,
        done,
        forcedDone,
        verdictPresent,
        passVerdict,
        sectionVerdictPresent,
        proofDigestPresent,
        certifyingRunCompleted,
        reopened,
        supersedingFailedRun,
        firstWipAt,
        doneAt,
        measuredTokens,
    };
}
