/**
 * 0912-check.ts — repeatable checker for 0912-workflow-baseline.json (R7/AC7).
 * Validates duplicate IDs, count/denominator consistency, digest-map coverage, nonnegative
 * durations, null-vs-zero distinction, terminal/verified-success evidence under the evidence
 * base root, stale-row accounting, adoption identity flags, pilot-decision readiness, and
 * supported references. Sparse baselines must delimit conclusions.
 *
 * Usage:
 *   bun run docs/reports/i31/0912-check.ts             # validate the artifact (exit 0 = CHECK-PASS)
 *   bun run docs/reports/i31/0912-check.ts --self-test # run deliberately invalid in-memory
 *                                                      # mutations; each MUST be detected
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const ARTIFACT = join(dir, '0912-workflow-baseline.json');

interface Run {
    id: string;
    task?: string | null;
    mode: string;
    definitionDigest: string;
    startedAt?: string;
    dbCompletedAt?: string | null;
    durationSeconds?: number | null;
    durationBasis?: string | null;
    workflowTerminal: string;
    staleRow?: boolean;
    terminalEvidence?: { kind: string; refs: string[] } | null;
    verifiedSuccess?: boolean | null;
    verdictArtifact?: string | null;
    gateRepetitions?: number;
    repairAttempts?: number;
    notes?: string;
}
interface Doc {
    schemaVersion: number;
    task: string;
    sourceCommit: string;
    capturedAt: string;
    window: string;
    provenance: { evidenceBaseRoot: string; cliVersion: string };
    cohort: {
        counts: Record<string, unknown>;
        denominators: Record<string, unknown>;
        definitionDigests: Record<string, string[]>;
        exclusions: { id: string; reason: string }[];
    };
    runs: Run[];
    inFlightObservation: Record<string, unknown>;
    metrics: {
        costCoverage: Record<string, unknown>;
        sessionCoverage: Record<string, unknown>;
        [k: string]: unknown;
    };
    adoption: {
        definitionsToday: { name: string; registeredDigest: string; sharedDigest: string; identical: boolean }[];
        inlineDriverEmission: { inlineRunsObservedCohort: number; inlineRunsWithActionRows: number };
        modeAdoption: Record<string, unknown>;
        [k: string]: unknown;
    };
    findings: { rank: number; id: string; owner: string; [k: string]: unknown }[];
    pilotDecision: {
        decision: string;
        selected?: { name: string; [k: string]: unknown };
        benefitTargetFrozenBeforeImplementation?: string;
        deadline?: string;
        rollback?: string;
        regressionChecks?: string[];
        projectionLabel?: string;
        insufficientEvidence?: { area: string; smallestExperiment: string; owner: string }[];
    };
    nextAction: Record<string, unknown>;
    limitations: string[];
    sparseBaseline: { sparse: boolean; delimitation: string; missingEvidence: string[] };
    unknowns: string[];
}

function validate(doc: Doc, evidenceBaseRoot: string): string[] {
    const errors: string[] = [];

    // schema keys
    for (const key of [
        'schemaVersion',
        'task',
        'sourceCommit',
        'capturedAt',
        'window',
        'provenance',
        'cohort',
        'runs',
        'inFlightObservation',
        'metrics',
        'adoption',
        'findings',
        'pilotDecision',
        'nextAction',
        'limitations',
        'sparseBaseline',
        'unknowns',
    ]) {
        if (!(key in doc)) errors.push(`missing schema key: ${key}`);
    }
    if (!doc.provenance?.evidenceBaseRoot) errors.push('provenance.evidenceBaseRoot missing');

    // duplicate run ids + identity
    const seen = new Set<string>();
    for (const r of doc.runs ?? []) {
        if (seen.has(r.id)) errors.push(`duplicate run id ${r.id}`);
        seen.add(r.id);
    }

    // digest map coverage: union of mapped ids == run ids, counts consistent
    const mapped = new Set<string>();
    for (const [digest, ids] of Object.entries(doc.cohort?.definitionDigests ?? {})) {
        if (!digest.startsWith('sha256:')) errors.push(`digest key not sha256-prefixed: ${digest}`);
        for (const id of ids) {
            if (mapped.has(id)) errors.push(`run ${id} mapped to multiple digests`);
            mapped.add(id);
            if (!seen.has(id)) errors.push(`digest map lists unknown run ${id}`);
        }
    }
    for (const r of doc.runs ?? [])
        if (!mapped.has(r.id)) errors.push(`run ${r.id} missing from definitionDigests map`);

    // denominators: terminal counts vs actual rows.
    // DB-terminal rows are staleRow=false; stale rows carry out-of-DB terminal evidence (F1)
    // and are counted in runningAtFreeze, never in DB-terminal numerators.
    const done = (doc.runs ?? []).filter((r) => !r.staleRow && r.workflowTerminal === 'done').length;
    const failed = (doc.runs ?? []).filter((r) => !r.staleRow && r.workflowTerminal === 'failed').length;
    const running = (doc.runs ?? []).filter((r) => r.staleRow === true || r.workflowTerminal === 'unknown').length;
    const counts = doc.cohort?.counts ?? {};
    if (counts.terminal?.done !== done)
        errors.push(`terminal.done declared ${counts.terminal?.done} vs actual ${done}`);
    if (counts.terminal?.failed !== failed)
        errors.push(`terminal.failed declared ${counts.terminal?.failed} vs actual ${failed}`);
    if (counts.terminal?.total !== done + failed)
        errors.push(`terminal.total declared ${counts.terminal?.total} vs actual ${done + failed}`);
    if (counts.runningAtFreeze !== running)
        errors.push(`runningAtFreeze declared ${counts.runningAtFreeze} vs actual unknown-terminal rows ${running}`);
    if (counts.rows !== (doc.runs ?? []).length)
        errors.push(`rows declared ${counts.rows} vs actual ${(doc.runs ?? []).length}`);

    // mode separation must exist (AC1) and terminalByMode must sum to terminal total
    const modes = new Set((doc.runs ?? []).map((r) => r.mode));
    if (modes.size < 2) errors.push('execution modes are not separated (AC1)');
    const tSum = Object.values(counts.terminalByMode ?? {}).reduce((a: number, b) => a + Number(b), 0);
    if (tSum !== done + failed) errors.push(`terminalByMode sums ${tSum} vs terminal total ${done + failed}`);

    // durations: nonnegative; null requires a stated basis absence
    for (const r of doc.runs ?? []) {
        if (r.durationSeconds != null) {
            if (typeof r.durationSeconds !== 'number' || r.durationSeconds < 0)
                errors.push(`run ${r.id} bad duration ${r.durationSeconds}`);
            if (!r.durationBasis) errors.push(`run ${r.id} duration without basis`);
        } else if (r.workflowTerminal !== 'unknown' && !r.durationBasis) {
            errors.push(`run ${r.id} terminal without duration or explicit missing-basis`);
        }
    }

    // terminal/verified distinction + evidence
    for (const r of doc.runs ?? []) {
        if (r.workflowTerminal !== 'unknown' && !r.terminalEvidence)
            errors.push(`run ${r.id} terminal ${r.workflowTerminal} without terminalEvidence`);
        if (r.verifiedSuccess === true) {
            if (!r.verdictArtifact) errors.push(`run ${r.id} verifiedSuccess without verdict artifact`);
            else if (!existsSync(join(evidenceBaseRoot, r.verdictArtifact)))
                errors.push(`run ${r.id} verdict artifact absent under evidence root: ${r.verdictArtifact}`);
        }
        if (r.staleRow === true && r.workflowTerminal !== 'unknown') {
            if (r.terminalEvidence?.kind !== 'out-of-db')
                errors.push(
                    `run ${r.id} staleRow terminal claim requires out-of-db evidence kind, got ${r.terminalEvidence?.kind}`,
                );
        }
        if (
            r.staleRow === false &&
            r.workflowTerminal !== 'unknown' &&
            !(r.terminalEvidence?.kind ?? '').startsWith('db')
        )
            errors.push(`run ${r.id} DB-terminal claim requires db evidence kind, got ${r.terminalEvidence?.kind}`);
    }

    // null-vs-zero: cost values must be null with explicit denominators
    for (const k of ['tokens', 'usd']) {
        const c = doc.metrics?.costCoverage?.[k];
        if (!c) {
            errors.push(`costCoverage.${k} missing`);
            continue;
        }
        if (c.value === 0) errors.push(`costCoverage.${k} value is 0 — missing must be null, never zero`);
        if (c.value !== null && typeof c.value !== 'number') errors.push(`costCoverage.${k} bad type`);
        if (typeof c.denominator !== 'number') errors.push(`costCoverage.${k} missing denominator`);
    }
    if (doc.metrics?.costCoverage?.aggregate?.scope !== 'all-history')
        errors.push('aggregate scope must be labeled all-history (never 14-day)');

    // session coverage consistency with cost nulls
    const sc = doc.metrics?.sessionCoverage;
    if (sc && sc.runsWithSessionJoin === 0 && doc.metrics.costCoverage.tokens.value !== null)
        errors.push('0 session joins but tokens not null');

    // adoption identity flags
    for (const d of doc.adoption?.definitionsToday ?? []) {
        if (d.identical && d.registeredDigest !== d.sharedDigest)
            errors.push(`adoption ${d.name}: identical=true but digests differ`);
        if (!d.identical && d.registeredDigest === d.sharedDigest)
            errors.push(`adoption ${d.name}: digests equal but identical=false`);
    }
    const em = doc.adoption?.inlineDriverEmission;
    if (em && em.inlineRunsWithActionRows > em.inlineRunsObservedCohort)
        errors.push('inlineRunsWithActionRows exceeds observed inline runs');

    // pilot decision readiness
    const pd = doc.pilotDecision;
    if (!['SELECT', 'INSUFFICIENT_EVIDENCE'].includes(pd?.decision))
        errors.push(`pilotDecision.decision invalid: ${pd?.decision}`);
    if (pd?.decision === 'SELECT') {
        if (!pd.selected?.name) errors.push('pilot selected without target name');
        if (!pd.benefitTargetFrozenBeforeImplementation) errors.push('pilot selected without frozen benefit target');
        if (!pd.deadline || !/^\d{4}-\d{2}-\d{2}$/.test(pd.deadline))
            errors.push('pilot selected without calendar deadline (YYYY-MM-DD)');
        if (!(pd.regressionChecks ?? []).length) errors.push('pilot selected without regression checks');
        if (!pd.rollback) errors.push('pilot selected without rollback');
        if (!pd.projectionLabel) errors.push('pilot selected without projection/observed labeling');
    }
    for (const ie of pd?.insufficientEvidence ?? [])
        if (!ie.smallestExperiment || !ie.owner)
            errors.push(`insufficientEvidence entry for ${ie.area} lacks experiment or owner`);

    // exclusions, unknowns, sparse delimitation, next action
    for (const e of doc.cohort?.exclusions ?? []) if (!e.id || !e.reason) errors.push('exclusion missing id/reason');
    if ((doc.unknowns ?? []).length === 0) errors.push('unknowns[] empty');
    if (doc.sparseBaseline?.sparse) {
        if (!doc.sparseBaseline.delimitation) errors.push('sparse baseline missing delimitation');
        if ((doc.sparseBaseline.missingEvidence ?? []).length === 0)
            errors.push('sparse baseline missing missing-evidence list');
    }
    if (!doc.nextAction || Object.keys(doc.nextAction).length === 0)
        errors.push('nextAction missing (R7: one executable next action)');
    if ((doc.findings ?? []).length === 0) errors.push('findings[] empty');

    return errors;
}

// deliberately invalid in-memory mutations; each must be detected
const MUTATIONS: { name: string; apply: (d: Doc) => void }[] = [
    { name: 'duplicate run id', apply: (d) => d.runs.push({ ...d.runs[0] }) },
    {
        name: 'terminal count mismatch',
        apply: (d) => {
            d.cohort.counts.terminal.done += 1;
        },
    },
    {
        name: 'negative duration',
        apply: (d) => {
            d.runs[0].durationSeconds = -5;
        },
    },
    {
        name: 'zero-instead-of-null cost',
        apply: (d) => {
            d.metrics.costCoverage.tokens.value = 0;
        },
    },
    {
        name: 'verifiedSuccess without artifact',
        apply: (d) => {
            const r = d.runs.find((x: Run) => x.verifiedSuccess !== true);
            r.verifiedSuccess = true;
            r.verdictArtifact = null;
        },
    },
    {
        name: 'pilot without deadline',
        apply: (d) => {
            delete d.pilotDecision.deadline;
        },
    },
    {
        name: 'adoption identity lie',
        apply: (d) => {
            d.adoption.definitionsToday[0].sharedDigest = 'sha256:deadbeef';
        },
    },
    {
        name: 'digest map drops a run',
        apply: (d) => {
            delete d.cohort.definitionDigests[d.runs[d.runs.length - 1].definitionDigest];
        },
    },
    {
        name: 'empty unknowns',
        apply: (d) => {
            d.unknowns = [];
        },
    },
    {
        name: 'aggregate scope mislabeled',
        apply: (d) => {
            d.metrics.costCoverage.aggregate.scope = '14-day';
        },
    },
];

if (process.argv.includes('--self-test')) {
    const base = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
    let failures = 0;
    for (const m of MUTATIONS) {
        const mutated = JSON.parse(JSON.stringify(base));
        m.apply(mutated);
        const errs = validate(mutated, mutated.provenance.evidenceBaseRoot);
        if (errs.length === 0) {
            console.log(`SELF-TEST-FAIL: mutation "${m.name}" was NOT detected`);
            failures++;
        } else {
            console.log(`SELF-TEST-OK: ${m.name} -> detected (${errs.length} error(s))`);
        }
    }
    if (failures) {
        console.log(`SELF-TEST: ${failures} undetected mutation(s)`);
        process.exit(1);
    }
    console.log('SELF-PASS: all deliberate invalid cases detected');
    process.exit(0);
}

const doc: Doc = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
const errors = validate(doc, doc.provenance.evidenceBaseRoot);
if (errors.length) {
    console.log(`CHECK-FAIL: ${errors.length} problem(s)`);
    for (const e of errors) console.log(`  - ${e}`);
    process.exit(1);
}
const byTerminal = { done: 0, failed: 0, unknown: 0 };
for (const r of doc.runs)
    byTerminal[r.workflowTerminal === 'done' ? 'done' : r.workflowTerminal === 'failed' ? 'failed' : 'unknown']++;
console.log(
    `CHECK-PASS: ${doc.runs.length} runs (done:${byTerminal.done} failed:${byTerminal.failed} nonterminal:${byTerminal.unknown}), ` +
        `${Object.keys(doc.cohort.definitionDigests).length} digests, ${doc.findings.length} findings, ` +
        `pilot=${doc.pilotDecision.decision} (deadline ${doc.pilotDecision.deadline ?? 'n/a'}), ` +
        `${doc.unknowns.length} unknowns; denominators, nulls, identity, evidence refs, adoption flags, decision readiness validated`,
);
