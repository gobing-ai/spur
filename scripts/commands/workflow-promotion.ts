/**
 * workflow-promotion — the ADR-076 amendment promotion gate (task 0873, feature D62).
 *
 * Usage: bun scripts/spur-dev.ts promotion <check|evaluate|resolve> [...]
 *
 * ADR-076 deleted `task-pipeline2.yaml` and retired the D5-N fixture promotion bar because the
 * old open-ended comparison of two standing parallel definitions paid live model quota twice and
 * never reached a verdict. Its 2026-09-16 amendment makes the reopening condition operable: a
 * candidate graph change is **shadow-run against recorded real-run inputs** and is **promoted
 * into the canonical definition or deleted** by a date named when it is created. The verdict
 * cites `agent.run` count and duration measured from run history, never a fixture bar. No
 * unreferenced parallel definition may remain in `config/workflows/` past its named date.
 *
 * A candidate is therefore a **record** (`config/workflow-candidates.json`) — a canonical target,
 * a named deadline, and the recorded real-run inputs the shadow-run replays — never a standing
 * `<name>2.yaml` parallel file. The shadow-run comparison is analytical: it replays the recorded
 * `action_runs` of real terminal runs (count + summed duration of `agent.run` per run) and compares
 * the candidate's projected `agent.run` count against the measured median, so the verdict is
 * evidence-backed without spending a single live model call.
 *
 * Subcommands:
 *   check                the catalogue check — exit 1 on an expired candidate, a parallel
 *                        definition, or a retired definition with real (non-dry) terminal
 *                        runs and no recorded retirement decision (0877 R8); runs in
 *                        `spur-check-feature`
 *   evaluate <id>        shadow-run the candidate against recorded run history and record its verdict
 *   resolve <id>         apply the decision: delete removes the candidate; promote verifies the
 *                        canonical definition now carries the candidate's agent.run count and then
 *                        removes it. Refusing to resolve leaves the candidate past its deadline for
 *                        `check` to fail.
 *
 * Repo-internal dev-script, NOT a new public `spur` noun/verb (ADR-051).
 */
import { Database } from 'bun:sqlite';
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parse } from 'yaml';
// Deep relative import (0775): the root node_modules has no @gobing-ai/spur-app workspace link
// for scripts/commands, so the §1.1 cross-workspace alias rule cannot resolve here.
import { extractResolvedWorkflowFacts } from '../../packages/app/src/workflow/composition-baseline';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const CANDIDATES_PATH = join(REPO_ROOT, 'config/workflow-candidates.json');
const WORKFLOWS_DIR = join(REPO_ROOT, 'config/workflows');
const DB_PATH = join(REPO_ROOT, '.spur/spur.db');

/** Engine vocabulary (0730 R2): terminal statuses that count as a real, settled run. */
const TERMINAL_RUN_STATUSES = ['done', 'failed', 'cancelled'];

// ── Candidate record ───────────────────────────────────────────────────────

/** The candidate's projected graph change, as a resolved-facts delta. */
export interface WorkflowCandidateDelta {
    /** The candidate's projected number of `agent.run` actions per run. */
    agentRunCount: number;
    /**
     * The incumbent's declared `agent.run` count at registration (0921). The ADR-076 bar compares
     * the projection against this baseline, so a candidate whose canonical change has already
     * landed (live count == projection) still evaluates against what it replaces. Absent, the
     * live canonical count stays the comparator (pre-0921 records).
     */
    baselineAgentRunCount?: number;
    note?: string;
}

/** Recorded real-run inputs the shadow-run replays. */
export interface WorkflowCandidateMeasurement {
    /** Workflow whose recorded runs are the replay inputs. */
    workflow: string;
    /** Optional recorded run ids to replay; absent = every terminal non-dry run. */
    runIds?: string[];
}

/** A summarized measured quantity (median etc.) over a run population. */
export interface AgentRunStat {
    /** Number of runs the statistic folds. */
    runs: number;
    mean: number | null;
    median: number | null;
    min: number | null;
    max: number | null;
}

/** The shadow-run verdict: cites `agent.run` count and duration measured from run history. */
export interface WorkflowCandidateVerdict {
    decision: 'promote' | 'delete';
    evaluatedAt: string;
    /** Measured per-run `agent.run` action count (from `action_runs`). */
    agentRunCount: AgentRunStat;
    /** Measured per-run summed `agent.run` duration in ms (from `action_runs`). */
    agentRunDurationMs: AgentRunStat;
    /** The candidate's projected `agent.run` count (the comparison surface). */
    candidateAgentRunCount: number;
    /** The canonical definition's declared `agent.run` action count (the ADR-076 bar). */
    canonicalAgentRunCount: number;
    reason: string;
}

export interface WorkflowCandidate {
    id: string;
    /** Canonical workflow name (basename without `.yaml`). */
    canonical: string;
    /** Named at creation — the candidate is promoted or deleted by this date (YYYY-MM-DD). */
    deadline: string;
    createdAt: string;
    rationale: string;
    measurement: WorkflowCandidateMeasurement;
    delta: WorkflowCandidateDelta;
    /** null = pending; filled by `evaluate`. */
    verdict: WorkflowCandidateVerdict | null;
}

export interface WorkflowCandidatesConfig {
    schemaVersion: 1;
    candidates: WorkflowCandidate[];
    /** Recorded retirement decisions; absent on pre-0882 configs (no retirements yet). */
    retirements?: WorkflowRetirementRecord[];
}

/** One catalogue-check failure, naming its candidate (when applicable) and the violation. */
export interface PromotionCheckFinding {
    kind: 'expired-candidate' | 'parallel-definition' | 'unrecorded-retirement';
    candidateId: string | null;
    detail: string;
}

/**
 * Recorded retirement decision for a definition removed from `config/workflows/`
 * (0877 R8, 0866 review finding 6): a definition with real (non-dry) terminal runs
 * may only be retired when a decision is recorded here. Schema mirrors the
 * candidate record's philosophy — evidence lives in config, not in a task table.
 */
export interface WorkflowRetirementRecord {
    /** Definition name (basename without `.yaml`). */
    name: string;
    /** Task/feature that made and recorded the decision (e.g. `0866`). */
    recordedBy: string;
    /** Decision date (YYYY-MM-DD). */
    date: string;
    rationale: string;
}

// ── Load / save ────────────────────────────────────────────────────────────

/** Validate a candidate record's required fields, returning the first error or null. */
export function validateCandidate(candidate: WorkflowCandidate): string | null {
    if (typeof candidate.id !== 'string' || candidate.id.trim() === '') return 'candidate missing id';
    if (typeof candidate.canonical !== 'string' || candidate.canonical.trim() === '') {
        return `candidate ${candidate.id}: missing canonical target`;
    }
    if (typeof candidate.deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.deadline)) {
        return `candidate ${candidate.id}: deadline must be an ISO date YYYY-MM-DD`;
    }
    if (typeof candidate.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.createdAt)) {
        return `candidate ${candidate.id}: createdAt must be an ISO date YYYY-MM-DD`;
    }
    if (typeof candidate.rationale !== 'string' || candidate.rationale.trim() === '') {
        return `candidate ${candidate.id}: missing rationale`;
    }
    if (
        typeof candidate.measurement !== 'object' ||
        candidate.measurement === null ||
        typeof candidate.measurement.workflow !== 'string' ||
        candidate.measurement.workflow.trim() === ''
    ) {
        return `candidate ${candidate.id}: measurement must name a workflow`;
    }
    if (
        typeof candidate.delta !== 'object' ||
        candidate.delta === null ||
        !Number.isInteger(candidate.delta.agentRunCount) ||
        (candidate.delta.agentRunCount as number) < 0
    ) {
        return `candidate ${candidate.id}: delta.agentRunCount must be a non-negative integer`;
    }
    if (
        candidate.delta.baselineAgentRunCount !== undefined &&
        (!Number.isInteger(candidate.delta.baselineAgentRunCount) ||
            (candidate.delta.baselineAgentRunCount as number) < 0)
    ) {
        return `candidate ${candidate.id}: delta.baselineAgentRunCount must be a non-negative integer`;
    }
    if (candidate.verdict !== null && typeof candidate.verdict !== 'object') {
        return `candidate ${candidate.id}: verdict must be null or an object`;
    }
    return null;
}

/** Load and validate the committed candidate record. Missing/unparseable → throws (must be valid). */
export async function loadWorkflowCandidates(path: string = CANDIDATES_PATH): Promise<WorkflowCandidatesConfig> {
    const config = JSON.parse(await readFile(path, 'utf-8')) as WorkflowCandidatesConfig;
    if (!Array.isArray(config.candidates)) throw new Error(`workflow-promotion: ${path} has no candidates array`);
    for (const candidate of config.candidates) {
        const error = validateCandidate(candidate);
        if (error !== null) throw new Error(`workflow-promotion: ${error}`);
    }
    return config;
}

/** Persist the candidate record (pretty-printed, trailing newline). */
export async function saveWorkflowCandidates(
    config: WorkflowCandidatesConfig,
    path: string = CANDIDATES_PATH,
): Promise<void> {
    await writeFile(path, `${JSON.stringify(config, null, 4)}\n`, 'utf-8');
}

// ── Deadline ───────────────────────────────────────────────────────────────

/** Whether the candidate's named deadline has passed (now is strictly after the deadline date). */
export function isPastDeadline(deadline: string, nowIso: string): boolean {
    return nowIso.slice(0, 10) > deadline;
}

// ── Measurement (shadow-run inputs) ────────────────────────────────────────

/** Per-run `agent.run` action count and summed duration over terminal non-dry runs. */
interface AgentRunPerRun {
    runId: string;
    count: number;
    durationMs: number | null;
}

/**
 * Read the recorded real-run inputs for a workflow: per terminal non-dry run, the number of
 * `agent.run` actions and their summed `duration_ms`, from the `action_runs`/`runs` history. A
 * run with no `agent.run` rows counts as zero actions with an unmeasured duration (null, never 0
 * — the 0284 invariant). `runIds` narrows the replay to specific recorded runs.
 */
export function readAgentRunHistory(dbPath: string, workflow: string, runIds?: string[]): AgentRunPerRun[] {
    const db = new Database(dbPath, { readonly: true });
    try {
        const inClause = runIds && runIds.length > 0 ? ` AND r.id IN (${runIds.map(() => '?').join(',')})` : '';
        const sql = `SELECT r.id AS runId,
                            COUNT(a.id) AS count,
                            SUM(a.duration_ms) AS durationMs
                       FROM runs r
                       LEFT JOIN action_runs a ON a.run_id = r.id AND a.kind = 'agent.run'
                      WHERE r.workflow_name = ?
                        AND r.status IN (${TERMINAL_RUN_STATUSES.map(() => '?').join(',')})
                        AND json_extract(r.metadata_json, '$.dryRun') IS NOT 1
                        AND r.started_at IS NOT NULL
                        AND r.completed_at IS NOT NULL
                        AND r.completed_at >= r.started_at${inClause}
                      GROUP BY r.id`;
        const params: (string | number)[] = [workflow, ...TERMINAL_RUN_STATUSES];
        if (runIds && runIds.length > 0) params.push(...runIds);
        const rows = db.query(sql).all(...params) as Array<{ runId: string; count: number; durationMs: number | null }>;
        return rows.map((r) => ({ runId: r.runId, count: r.count, durationMs: r.durationMs }));
    } finally {
        db.close();
    }
}

function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const lower = sorted[mid - 1] ?? sorted[mid] ?? 0;
    const upper = sorted[mid] ?? 0;
    return sorted.length % 2 === 0 ? (lower + upper) / 2 : upper;
}

function stat(values: number[], runs: number): AgentRunStat {
    if (values.length === 0) return { runs, mean: null, median: null, min: null, max: null };
    return {
        runs,
        mean: values.reduce((a, b) => a + b, 0) / values.length,
        median: median(values),
        min: Math.min(...values),
        max: Math.max(...values),
    };
}

/** Measured `agent.run` count and duration for a workflow, summarized over terminal non-dry runs. */
export interface AgentRunMeasurement {
    workflow: string;
    agentRunCount: AgentRunStat;
    agentRunDurationMs: AgentRunStat;
}

/**
 * Summarize the recorded `agent.run` count and duration over the workflow's terminal non-dry
 * runs. Count folds every such run (zero-`agent.run` runs included as 0); duration folds only
 * runs that recorded at least one `agent.run` action (unmeasured stays null).
 */
export function measureAgentRunHistory(dbPath: string, workflow: string, runIds?: string[]): AgentRunMeasurement {
    const rows = readAgentRunHistory(dbPath, workflow, runIds);
    const durations = rows.map((r) => r.durationMs).filter((d): d is number => d !== null);
    return {
        workflow,
        agentRunCount: stat(
            rows.map((r) => r.count),
            rows.length,
        ),
        agentRunDurationMs: stat(durations, durations.length),
    };
}

// ── Verdict (shadow-run comparison) ────────────────────────────────────────

/**
 * Emit the shadow-run verdict. The decision is the ADR-076 bar — a candidate is promoted only
 * when it projects strictly fewer `agent.run` actions than the canonical definition declares
 * ("measurably reduces model-query count"). The verdict *cites* the measured real-run `agent.run`
 * count and duration (from `action_runs`) as the evidence backing that comparison, never a
 * fixture bar. Duration is cited as measured context; it cannot decide promotion because a
 * candidate's duration is only knowable by running it, which the shadow-run deliberately does not.
 */
export function evaluateCandidate(
    candidate: WorkflowCandidate,
    measured: AgentRunMeasurement,
    canonicalAgentRunCount: number,
    nowIso: string,
): WorkflowCandidateVerdict {
    const candidateCount = candidate.delta.agentRunCount;
    // 0921: the incumbent baseline pins what the candidate replaces, so an already-applied change
    // (live count == projection) still compares against its origin. Absent, the live canonical
    // count is the comparator — exactly the pre-0921 rule the 0873 pins assert.
    const baseline = candidate.delta.baselineAgentRunCount ?? canonicalAgentRunCount;
    // ADR-076: the gate decides on the measured data it cites — zero recorded real runs cannot promote.
    const decision: 'promote' | 'delete' =
        measured.agentRunCount.runs > 0 && candidateCount < baseline ? 'promote' : 'delete';
    const measuredCitation =
        measured.agentRunCount.runs === 0
            ? 'no measured real-run history'
            : `${measured.agentRunCount.runs} real run(s), median ${measured.agentRunCount.median ?? 'n/a'} ` +
              `agent.run action(s)/run, median ${measured.agentRunDurationMs.median ?? 'n/a'} ms/run`;
    const countContext =
        baseline === canonicalAgentRunCount
            ? `the canonical ${candidate.canonical} count of ${canonicalAgentRunCount}`
            : `the incumbent baseline of ${baseline} (canonical ${candidate.canonical} now declares ${canonicalAgentRunCount})`;
    let reason: string;
    if (measured.agentRunCount.runs === 0) {
        reason =
            `candidate projects ${candidateCount} agent.run action(s) against ${countContext}, but with no measured ` +
            `real-run history the ADR-076 gate cannot promote unmeasured — ` +
            `decision falls to delete; re-evaluate after real runs`;
    } else if (decision === 'promote') {
        reason = `candidate projects ${candidateCount} agent.run action(s) against ${countContext} (${measuredCitation})`;
    } else {
        reason = `candidate projects ${candidateCount} agent.run action(s), not fewer than ${countContext} (${measuredCitation}) — ADR-076 rejected a graph adding a model hop`;
    }
    return {
        decision,
        evaluatedAt: nowIso,
        agentRunCount: measured.agentRunCount,
        agentRunDurationMs: measured.agentRunDurationMs,
        candidateAgentRunCount: candidateCount,
        canonicalAgentRunCount,
        reason,
    };
}

// ── Catalogue check ────────────────────────────────────────────────────────

/** Count the `agent.run` actions a resolved workflow definition declares. */
export function countAgentRunActions(workflow: unknown): number {
    const facts = extractResolvedWorkflowFacts(workflow as never);
    return Object.values(facts.actions).filter((a) => a.kind === 'agent.run').length;
}

/** Canonical workflow name → declared `agent.run` action count, from the live definitions. */
export function loadCanonicalAgentRunCounts(workflowsDir: string): Record<string, number> {
    const out: Record<string, number> = {};
    let entries: string[];
    try {
        entries = readdirSync(workflowsDir);
    } catch {
        return out;
    }
    for (const entry of entries) {
        const m = /^(.+)\.ya?ml$/.exec(entry);
        if (!m) continue;
        const name = m[1] ?? entry;
        try {
            const def = parse(readFileSync(join(workflowsDir, entry), 'utf-8'));
            out[name] = countAgentRunActions(def);
        } catch {
            out[name] = 0; // unparseable definition — treated as zero, surfaced elsewhere
        }
    }
    return out;
}

/**
 * Detect an unreferenced parallel definition: a `<name>2.yaml` / `<name>-2.yaml` (or any numeric
 * suffix) sitting beside its `<name>.yaml` canonical. Under the ADR-076 amendment a second
 * standing YAML is never a valid candidate — the shadow run is the comparison surface.
 */
export function findParallelDefinitions(workflowsDir: string): string[] {
    let entries: string[];
    try {
        entries = readdirSync(workflowsDir);
    } catch {
        return [];
    }
    const baseNames = new Set(entries.filter((e) => /\.ya?ml$/.test(e)).map((e) => e.replace(/\.ya?ml$/, '')));
    const parallel: string[] = [];
    for (const entry of entries) {
        if (!/\.ya?ml$/.test(entry)) continue;
        const m = /^(.+?)(?:-)?(\d+)\.ya?ml$/.exec(entry);
        if (!m) continue;
        const base = m[1] ?? '';
        if (base !== '' && baseNames.has(base)) parallel.push(entry);
    }
    return parallel.sort();
}

/**
 * The catalogue check (R3/R4): fails on (1) any candidate still present past its named deadline,
 * and (2) any unreferenced parallel definition in `config/workflows/`. A candidate resolves only
 * by being removed — `resolve` deletes it or verifies a promotion landed and then removes it — so
 * "still present past the deadline" is exactly "not promoted or deleted by the date named".
 */
export function checkWorkflowPromotion(
    config: WorkflowCandidatesConfig,
    workflowsDir: string,
    nowIso: string,
): PromotionCheckFinding[] {
    const findings: PromotionCheckFinding[] = [];
    for (const file of findParallelDefinitions(workflowsDir)) {
        findings.push({
            kind: 'parallel-definition',
            candidateId: null,
            detail: `unreferenced parallel definition ${file} remains in config/workflows/`,
        });
    }
    for (const candidate of config.candidates) {
        if (isPastDeadline(candidate.deadline, nowIso)) {
            findings.push({
                kind: 'expired-candidate',
                candidateId: candidate.id,
                detail: `candidate ${candidate.id} (${candidate.canonical}) passed its deadline ${candidate.deadline} without being promoted or deleted`,
            });
        }
    }
    return findings;
}

/**
 * Real (non-dry) terminal run counts per workflow name, from `runs ×
 * metadata_json.dryRun` — the column 0866's verdict table used. dryRun absent,
 * 0, or 'false' counts as real (0866: a `done` row carrying `dryRun: 1` is not a
 * real completion).
 */
export function countRealTerminalRuns(db: Database): Map<string, number> {
    const rows = db
        .query(
            `SELECT workflow_name, COUNT(*) AS n FROM runs
             WHERE status IN ('done', 'failed', 'cancelled')
               AND (json_extract(metadata_json, '$.dryRun') IS NULL
                    OR json_extract(metadata_json, '$.dryRun') IN (0, '0', 'false'))
             GROUP BY workflow_name`,
        )
        .all() as Array<{ workflow_name: string; n: number }>;
    return new Map(rows.map((r) => [r.workflow_name ?? '', r.n]).filter(([name]) => name !== ''));
}

/**
 * Definition names ever tracked under `config/workflows/` (git history) — the set
 * of names a retirement is possible for. Ad-hoc `workflow run` names that never
 * had a standing definition are excluded from the guard's scope.
 */
export function everTrackedDefinitionNames(repoRoot: string): Set<string> {
    try {
        const out = execSync('git log --name-only --pretty=format: -- config/workflows', {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return new Set(
            out
                .split('\n')
                .filter((p) => /config\/workflows\/.+\.ya?ml$/.test(p))
                .map((p) => basename(p).replace(/\.ya?ml$/, '')),
        );
    } catch {
        return new Set();
    }
}

/**
 * The retirement guard (0877 R8, 0866 review finding 6): a definition absent from
 * `config/workflows/` whose name still has real non-dry terminal runs is retired —
 * refuse unless a decision is recorded in `config.retirements[]`. Only names ever
 * tracked as definitions are in scope; definitions still present are untouched;
 * dry-only history does not block retirement.
 */
export function checkRetirementGuard(
    db: Database,
    config: WorkflowCandidatesConfig,
    workflowsDir: string,
    everTracked: Set<string> = everTrackedDefinitionNames(REPO_ROOT),
): PromotionCheckFinding[] {
    const findings: PromotionCheckFinding[] = [];
    let present: Set<string>;
    try {
        present = new Set(
            readdirSync(workflowsDir)
                .filter((e) => /\.ya?ml$/.test(e))
                .map((e) => e.replace(/\.ya?ml$/, '')),
        );
    } catch {
        return findings; // no workflows dir — nothing is retired
    }
    const recorded = new Set((config.retirements ?? []).map((r) => r.name));
    for (const [name, n] of countRealTerminalRuns(db)) {
        if (!everTracked.has(name) || present.has(name) || recorded.has(name)) continue;
        findings.push({
            kind: 'unrecorded-retirement',
            candidateId: null,
            detail: `definition ${name} is retired from config/workflows/ but has ${n} real (non-dry) terminal run(s) and no recorded retirement decision in workflow-candidates.json`,
        });
    }
    return findings;
}

/** Format one finding as a stable human line (mirrors pipeline-budgets' naming discipline). */
export function formatFinding(f: PromotionCheckFinding): string {
    return `[${f.kind}] ${f.detail}`;
}

interface ResolveArgs {
    decision: 'promote' | 'delete';
    workflowsDir: string;
    configPath: string;
}

function parseResolveArgs(argv: string[]): ResolveArgs {
    const args: ResolveArgs = {
        decision: 'delete',
        workflowsDir: WORKFLOWS_DIR,
        configPath: CANDIDATES_PATH,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = (): string => {
            const v = argv[++i];
            if (v === undefined) throw new Error(`workflow-promotion: ${a} requires a value`);
            return v;
        };
        if (a === '--decision') {
            const value = next();
            if (value !== 'promote' && value !== 'delete') {
                throw new Error(`workflow-promotion: --decision must be promote|delete, got ${value}`);
            }
            args.decision = value;
        } else if (a === '--workflows-dir') args.workflowsDir = next();
        else if (a === '--config') args.configPath = next();
        else throw new Error(`workflow-promotion: unknown argument ${a}`);
    }
    return args;
}

interface CheckArgs {
    workflowsDir: string;
    nowIso: string;
    configPath: string;
    dbPath: string;
}

function parseCheckArgs(argv: string[]): CheckArgs {
    const args: CheckArgs = {
        workflowsDir: WORKFLOWS_DIR,
        nowIso: new Date().toISOString(),
        configPath: CANDIDATES_PATH,
        dbPath: DB_PATH,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = (): string => {
            const v = argv[++i];
            if (v === undefined) throw new Error(`workflow-promotion: ${a} requires a value`);
            return v;
        };
        if (a === '--workflows-dir') args.workflowsDir = next();
        else if (a === '--now') args.nowIso = next();
        else if (a === '--config') args.configPath = next();
        else if (a === '--db') args.dbPath = next();
        else throw new Error(`workflow-promotion: unknown argument ${a}`);
    }
    return args;
}

/** CLI entry — `bun scripts/spur-dev.ts promotion <check|evaluate|resolve> ...`. */
export async function runWorkflowPromotion(argv: string[]): Promise<number> {
    const [subcommand, ...rest] = argv;

    if (subcommand === 'check') {
        const args = parseCheckArgs(rest);
        const config = await loadWorkflowCandidates(args.configPath);
        const findings = checkWorkflowPromotion(config, args.workflowsDir, args.nowIso);
        // Retirement guard (0882): only when a project DB exists (fixture roots skip).
        if (statSync(args.dbPath, { throwIfNoEntry: false })) {
            const db = new Database(args.dbPath, { readonly: true });
            try {
                findings.push(...checkRetirementGuard(db, config, args.workflowsDir));
            } finally {
                db.close();
            }
        }
        for (const f of findings) console.error(`PROMOTION GATE: ${formatFinding(f)}`);
        console.log(
            findings.length === 0
                ? `workflow-promotion: PASS (${config.candidates.length} candidate(s), no parallel definitions)`
                : `workflow-promotion: FAIL (${findings.length} finding(s))`,
        );
        return findings.length === 0 ? 0 : 1;
    }

    if (subcommand === 'evaluate') {
        const id = rest[0];
        if (!id) throw new Error('workflow-promotion: evaluate requires a candidate id');
        let dbPath = DB_PATH;
        let nowIso = new Date().toISOString();
        let configPath = CANDIDATES_PATH;
        let workflowsDir = WORKFLOWS_DIR;
        for (let i = 1; i < rest.length; i++) {
            const a = rest[i];
            const next = (): string => {
                const v = rest[++i];
                if (v === undefined) throw new Error(`workflow-promotion: ${a} requires a value`);
                return v;
            };
            if (a === '--db') dbPath = next();
            else if (a === '--now') nowIso = next();
            else if (a === '--config') configPath = next();
            else if (a === '--workflows-dir') workflowsDir = next();
            else throw new Error(`workflow-promotion: unknown argument ${a}`);
        }
        const config = await loadWorkflowCandidates(configPath);
        const candidate = config.candidates.find((c) => c.id === id);
        if (!candidate) throw new Error(`workflow-promotion: candidate ${id} not found`);
        const measured = measureAgentRunHistory(dbPath, candidate.measurement.workflow, candidate.measurement.runIds);
        const canonicalCounts = loadCanonicalAgentRunCounts(workflowsDir);
        const canonicalCount = canonicalCounts[candidate.canonical] ?? 0;
        // 0921: with a registered baseline, the live count must be either the baseline (change not
        // yet applied) or the projection (change already applied) — anything else is registry/live
        // drift and evaluating would pin a verdict against a definition nobody registered.
        const baseline = candidate.delta.baselineAgentRunCount;
        if (baseline !== undefined && canonicalCount !== baseline && canonicalCount !== candidate.delta.agentRunCount) {
            console.error(
                `workflow-promotion: evaluate refused — ${candidate.canonical} declares ${canonicalCount} ` +
                    `agent.run action(s), which is neither the recorded baseline ${baseline} nor the projected ` +
                    `${candidate.delta.agentRunCount}; the registry and the live definition have drifted. ` +
                    `Re-register the candidate against the current definition.`,
            );
            return 1;
        }
        candidate.verdict = evaluateCandidate(candidate, measured, canonicalCount, nowIso);
        await saveWorkflowCandidates(config, configPath);
        console.log(
            `verdict ${candidate.verdict.decision}: candidate ${id} projects ${candidate.verdict.candidateAgentRunCount} ` +
                `agent.run action(s) against canonical ${candidate.canonical}=${candidate.verdict.canonicalAgentRunCount}; ` +
                `measured n=${candidate.verdict.agentRunCount.runs} median=${candidate.verdict.agentRunCount.median ?? 'n/a'} ` +
                `duration_ms median=${candidate.verdict.agentRunDurationMs.median ?? 'n/a'} — ${candidate.verdict.reason}`,
        );
        return 0;
    }

    if (subcommand === 'resolve') {
        const id = rest[0];
        if (!id) throw new Error('workflow-promotion: resolve requires a candidate id');
        const args = parseResolveArgs(rest.slice(1));
        const config = await loadWorkflowCandidates(args.configPath);
        const index = config.candidates.findIndex((c) => c.id === id);
        if (index === -1) throw new Error(`workflow-promotion: candidate ${id} not found`);
        const candidate = config.candidates[index] as WorkflowCandidate;
        if (candidate.verdict && candidate.verdict.decision !== args.decision) {
            console.error(
                `workflow-promotion: resolve refused — candidate ${candidate.id}'s evaluated verdict is ` +
                    `${candidate.verdict.decision} (${candidate.verdict.evaluatedAt}); --decision ${args.decision} contradicts it. ` +
                    `Re-evaluate or hold the candidate.`,
            );
            return 1;
        }
        if (args.decision === 'promote') {
            const counts = loadCanonicalAgentRunCounts(args.workflowsDir);
            const actual = counts[candidate.canonical];
            if (actual !== candidate.delta.agentRunCount) {
                console.error(
                    `workflow-promotion: promote refused — ${candidate.canonical} declares ${actual ?? 'n/a'} ` +
                        `agent.run action(s), candidate ${candidate.id} delta requires ${candidate.delta.agentRunCount}; ` +
                        `apply the canonical change before resolving`,
                );
                return 1;
            }
        }
        config.candidates.splice(index, 1);
        await saveWorkflowCandidates(config, args.configPath);
        console.log(`resolved ${candidate.id} as ${args.decision}`);
        return 0;
    }

    throw new Error(`workflow-promotion: unknown subcommand "${subcommand}" (expected check|evaluate|resolve)`);
}

if (import.meta.main) {
    process.exit(await runWorkflowPromotion(process.argv.slice(2)));
}
