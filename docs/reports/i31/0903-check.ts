/**
 * 0903-check.ts — repeatable local checker for 0903-contract-adoption.json (R7/AC7).
 * Validates row IDs, source anchors, inventory coverage, dispositions, and scenario references.
 * Usage: bun run docs/reports/i31/0903-check.ts   (exit 0 = CHECK-PASS, exit 1 = CHECK-FAIL)
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const artifact = join(dirname(fileURLToPath(import.meta.url)), '0903-contract-adoption.json');
const errors: string[] = [];
const DISPOSITIONS = [
    'shipped-behavior',
    'stale-prose',
    'absent-adoption',
    'unverified-behavior',
    'already-owned-work',
];
const MODES = ['inline', 'pipeline', 'fleet'];

const doc = JSON.parse(readFileSync(artifact, 'utf8'));
for (const key of [
    'schemaVersion',
    'task',
    'sourceCommit',
    'capturedAt',
    'surfaces',
    'findings',
    'journeys',
    'scenarios',
    'unknowns',
]) {
    if (!(key in doc)) errors.push(`missing schema key: ${key}`);
}
if (doc.schemaVersion !== 1) errors.push(`schemaVersion must be 1, got ${doc.schemaVersion}`);
if (doc.task !== '0903') errors.push(`task must be "0903", got ${doc.task}`);

function uniqueIds(rows: { id?: string }[], label: string): Set<string> {
    const seen = new Set<string>();
    for (const row of rows) {
        if (!row.id) errors.push(`${label} row missing id`);
        else if (seen.has(row.id)) errors.push(`${label} duplicate id: ${row.id}`);
        else seen.add(row.id);
    }
    return seen;
}
const surfaceIds = uniqueIds(doc.surfaces ?? [], 'surfaces');
const findingIds = uniqueIds(doc.findings ?? [], 'findings');
uniqueIds(doc.journeys ?? [], 'journeys');
uniqueIds(doc.scenarios ?? [], 'scenarios');

// inventory coverage: every surface carries the contract fields
for (const s of doc.surfaces ?? []) {
    for (const f of ['path', 'kind', 'status', 'reason']) if (!s[f]) errors.push(`surface ${s.id} missing ${f}`);
}

// source anchors: evidence path exists in repo and line is within file bounds
let anchors = 0;
for (const f of doc.findings ?? []) {
    if (!DISPOSITIONS.includes(f.disposition))
        errors.push(`finding ${f.id} disposition '${f.disposition}' not in R5 vocabulary`);
    if (!f.owner) errors.push(`finding ${f.id} missing owner/unowned marker`);
    for (const e of f.evidence ?? []) {
        anchors++;
        const p = join(repoRoot, e.path);
        if (!existsSync(p)) {
            errors.push(`finding ${f.id} evidence path absent: ${e.path}`);
            continue;
        }
        const lines = readFileSync(p, 'utf8').split('\n').length;
        if (typeof e.line !== 'number' || e.line < 1 || e.line > lines)
            errors.push(`finding ${f.id} anchor ${e.path}:${e.line} out of bounds (file has ${lines} lines)`);
    }
}

// scenario references resolve; modes in vocabulary
const knownIds = new Set([...surfaceIds, ...findingIds]);
for (const sc of doc.scenarios ?? []) {
    if (!MODES.includes(sc.mode)) errors.push(`scenario ${sc.id} mode '${sc.mode}' not in inline|pipeline|fleet`);
    for (const ref of sc.findingIds ?? [])
        if (!knownIds.has(ref)) errors.push(`scenario ${sc.id} references unknown id ${ref}`);
}

if ((doc.unknowns ?? []).length === 0) errors.push('unknowns[] empty — report all unknowns explicitly');

if (errors.length) {
    console.log(`CHECK-FAIL: ${errors.length} problem(s)`);
    for (const e of errors) console.log(`  - ${e}`);
    process.exit(1);
}
console.log(
    `CHECK-PASS: ${doc.surfaces.length} surfaces, ${doc.findings.length} findings, ${doc.journeys.length} journeys, ${doc.scenarios.length} scenarios, ${doc.unknowns.length} unknowns; ${anchors} evidence anchors validated against ${repoRoot}`,
);
