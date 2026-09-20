/**
 * 0904-check.ts — repeatable checker for 0904-availability-fixtures.json (R7/AC7).
 * Validates case IDs, required fields, coverage groups, classification vocabulary,
 * source anchors (path exists + line in bounds), and redaction (no auth patterns).
 * Usage: bun run docs/reports/i31/0904-check.ts   (exit 0 = CHECK-PASS)
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '..', '..', '..');
const doc = JSON.parse(readFileSync(join(dir, '0904-availability-fixtures.json'), 'utf8'));
const errors: string[] = [];
const CLASSES = ['reproduced', 'ruled-out', 'blocked', 'observed'];
const GROUPS = ['ownership', 'signal', 'mapping', 'layer'];
const AUTH_PATTERNS = [
    /sk-[A-Za-z0-9]/,
    /authorization:/i,
    /bearer [A-Za-z0-9._-]{10,}/i,
    /api[_-]?key["']?\s*[:=]\s*["']?[A-Za-z0-9._-]{8,}/i,
];

for (const key of ['schemaVersion', 'task', 'sourceCommit', 'capturedAt', 'cases', 'timing', 'followUps', 'unknowns']) {
    if (!(key in doc)) errors.push(`missing schema key: ${key}`);
}
if (doc.task !== '0904') errors.push(`task must be "0904"`);

const ids = new Set<string>();
const groups = new Set<string>();
for (const c of doc.cases ?? []) {
    if (ids.has(c.id)) errors.push(`duplicate case id ${c.id}`);
    ids.add(c.id);
    groups.add(c.group);
    for (const f of [
        'group',
        'syntheticInput',
        'initialState',
        'expectedContract',
        'observationStatus',
        'dryRun',
        'apply',
        'fileState',
        'classification',
    ]) {
        if (!(f in c)) errors.push(`case ${c.id} missing field ${f}`);
    }
    if (!CLASSES.includes(c.classification))
        errors.push(`case ${c.id} classification '${c.classification}' not in ${CLASSES.join('|')}`);
    for (const a of c.sourceAnchors ?? []) {
        const p = join(repoRoot, a.path);
        if (!existsSync(p)) {
            errors.push(`case ${c.id} anchor path absent: ${a.path}`);
            continue;
        }
        const lines = readFileSync(p, 'utf8').split('\n').length;
        if (a.line < 1 || a.line > lines)
            errors.push(`case ${c.id} anchor ${a.path}:${a.line} out of bounds (${lines} lines)`);
    }
}
for (const g of GROUPS) if (!groups.has(g)) errors.push(`coverage group '${g}' absent`);
if ((doc.cases ?? []).length < 14) errors.push(`expected >= 14 case groups, got ${(doc.cases ?? []).length}`);

const raw = readFileSync(join(dir, '0904-availability-fixtures.json'), 'utf8');
for (const pat of AUTH_PATTERNS)
    if (pat.test(raw)) errors.push(`redaction failure: pattern ${pat} present in fixtures JSON`);

for (const f of doc.followUps ?? []) {
    if (!f.owner) errors.push(`followUp rank ${f.rank} missing owner`);
    if (f.anchor) {
        const [p, ln] = f.anchor.split(':');
        if (!existsSync(join(repoRoot, p))) errors.push(`followUp ${f.rank} anchor path absent: ${p}`);
    }
}
if ((doc.unknowns ?? []).length === 0) errors.push('unknowns[] empty');

if (errors.length) {
    console.log(`CHECK-FAIL: ${errors.length} problem(s)`);
    for (const e of errors) console.log(`  - ${e}`);
    process.exit(1);
}
console.log(
    `CHECK-PASS: ${doc.cases.length} cases (groups: ${[...groups].sort().join(',')}), ${doc.timing.length} timing rows, ${doc.followUps.length} follow-ups, ${doc.unknowns.length} unknowns; anchors + redaction validated`,
);
