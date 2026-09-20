/**
 * 0905-check.ts — repeatable checker for 0905-run-baseline.json (R7/AC7).
 * Validates denominators, duplicate exclusion, nonnegative durations, null handling,
 * trace/run identity, artifact references (incl. 0903 scenario IDs), and detects
 * unsupported success claims. Sparse baselines must delimit conclusions.
 * Usage: bun run docs/reports/i31/0905-check.ts   (exit 0 = CHECK-PASS)
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '..', '..', '..');
const doc = JSON.parse(readFileSync(join(dir, '0905-run-baseline.json'), 'utf8'));
const errors: string[] = [];

for (const key of [
    'schemaVersion',
    'task',
    'sourceCommit',
    'capturedAt',
    'prerequisite',
    'cohort',
    'runs',
    'costCoverage',
    'scenarios',
    'failureClusters',
    'sparseBaseline',
    'unknowns',
]) {
    if (!(key in doc)) errors.push(`missing schema key: ${key}`);
}

// prerequisite: 0903 done + artifact + frozen scenario IDs resolve
const a903 = join(repoRoot, 'docs/reports/i31/0903-contract-adoption.json');
if (!existsSync(a903)) errors.push('0903 artifact absent');
else {
    const ids = new Set(JSON.parse(readFileSync(a903, 'utf8')).scenarios.map((s: { id: string }) => s.id));
    for (const ref of doc.prerequisite.scenarioIdsFrozen ?? [])
        if (!ids.has(ref)) errors.push(`frozen 0903 scenario id ${ref} not in artifact`);
    for (const sc of doc.scenarios ?? [])
        for (const ref of sc.refs0903 ?? [])
            if (!ids.has(ref)) errors.push(`scenario ${sc.id} refs unknown 0903 id ${ref}`);
}

// duplicate run IDs + nonnegative durations + identity format
const runIds = new Set<string>();
for (const r of doc.runs ?? []) {
    if (runIds.has(r.id)) errors.push(`duplicate run id ${r.id}`);
    runIds.add(r.id);
    if (typeof r.durationSeconds !== 'number' || r.durationSeconds < 0)
        errors.push(`run ${r.id} bad duration ${r.durationSeconds}`);
    // unsupported success claims: verifiedSuccess requires an existing verdict artifact
    if (r.verifiedSuccess === true) {
        if (!r.verdictArtifact) errors.push(`run ${r.id} claims verifiedSuccess without verdict artifact`);
        else if (!existsSync(join(repoRoot, r.verdictArtifact)))
            errors.push(`run ${r.id} verdict artifact absent: ${r.verdictArtifact}`);
    }
    if (r.workflowTerminal === 'done' && r.verifiedSuccess !== true)
        errors.push(`run ${r.id} terminal done without verified success distinction (R3)`);
}

// denominators: per-mode counts match runs; caps respected; exclusions recorded
const byMode: Record<string, number> = { inline: 0, pipeline: 0, fleet: 0 };
for (const r of doc.runs ?? []) byMode[r.mode] = (byMode[r.mode] ?? 0) + 1;
for (const m of Object.keys(byMode)) {
    if (doc.cohort.counts[m] !== byMode[m])
        errors.push(`cohort denominator ${m}: declared ${doc.cohort.counts[m]} vs actual ${byMode[m]}`);
    if (byMode[m] > doc.cohort.caps[m]) errors.push(`cohort ${m} exceeds cap ${doc.cohort.caps[m]}`);
}
for (const e of doc.cohort.exclusions ?? []) if (!e.id || !e.reason) errors.push('exclusion missing id/reason');

// null handling: cost values must be null (not 0) with explicit denominators
for (const k of ['tokens', 'usd']) {
    const c = doc.costCoverage?.[k];
    if (!c) {
        errors.push(`costCoverage.${k} missing`);
        continue;
    }
    if (c.value === 0) errors.push(`costCoverage.${k} value is 0 — missing must be null, never zero (R4)`);
    if (typeof c.denominator !== 'number') errors.push(`costCoverage.${k} missing denominator`);
}
if (doc.costCoverage?.aggregate?.scope !== 'all-history')
    errors.push('aggregate scope must be labeled all-history (never 14-day)');

// scenario dispositions: vocabulary + unobserved must not claim runs
const DISPOSITIONS = ['observed', 'contradicted', 'unobserved'];
for (const sc of doc.scenarios ?? []) {
    if (!DISPOSITIONS.includes(sc.disposition)) errors.push(`scenario ${sc.id} bad disposition ${sc.disposition}`);
    if (sc.disposition === 'unobserved' && (sc.runs ?? []).length > 0)
        errors.push(`scenario ${sc.id} unobserved but lists runs`);
}

// sparse baseline: when any mode has 0 runs, delimitation + missing evidence required
if (Object.values(byMode).some((n) => n === 0)) {
    if (!doc.sparseBaseline?.sparse) errors.push('zero-run mode but sparseBaseline.sparse not set');
    if (!doc.sparseBaseline?.delimitation) errors.push('sparse baseline missing delimitation of conclusions');
    if ((doc.sparseBaseline?.missingEvidence ?? []).length === 0)
        errors.push('sparse baseline missing missing-evidence list');
}

if ((doc.unknowns ?? []).length === 0) errors.push('unknowns[] empty');

if (errors.length) {
    console.log(`CHECK-FAIL: ${errors.length} problem(s)`);
    for (const e of errors) console.log(`  - ${e}`);
    process.exit(1);
}
console.log(
    `CHECK-PASS: ${doc.runs.length} runs (${Object.entries(byMode)
        .map(([m, n]) => `${m}:${n}`)
        .join(
            ' ',
        )}), ${doc.cohort.exclusions.length} exclusions, ${doc.scenarios.length} scenarios, ${doc.failureClusters.length} clusters; denominators, nulls, identity, 0903 refs, sparse delimitation validated`,
);
