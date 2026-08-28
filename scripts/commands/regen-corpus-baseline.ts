#!/usr/bin/env bun

/**
 * regen-corpus-baseline — regenerate `config/corpus-baseline.json` as a committed
 * snapshot of the current sweep's observed findings (ADR-090, option A+C).
 *
 * The gate (`spur task check --corpus`) is single-sided: a finding not in the
 * snapshot fails; a vanished snapshot entry does not. That makes regeneration
 * the acceptance surface — accepting a finding means regenerating the snapshot
 * and committing the diff, where a suppressed finding is visible as a count drop.
 *
 * Round-trip assertion (ADR-090 consequence 1): after writing, re-sweep and
 * verify the on-disk snapshot covers the observed key set exactly. A generation
 * bug that writes fewer/more entries than the sweep observed aborts the write.
 *
 * Usage: bun run scripts/commands/regen-corpus-baseline.ts [--since <git-ref>]
 */

import { resolve } from 'node:path';
import {
    type Baseline,
    type CorpusError,
    collectObservedFindings,
    reconcileBaseline,
} from '../../packages/app/src/services/corpus-check';

const root = resolve(import.meta.dir, '..', '..');
const sinceIdx = process.argv.indexOf('--since');
const since = sinceIdx !== -1 ? process.argv[sinceIdx + 1] : undefined;

const observed = await collectObservedFindings(root, since);

// Dedupe by key (kind:id:code) keeping the first occurrence; the snapshot is
// key-addressed, so duplicate entries would over-cover (see duplicateBaselineKeys).
const byKey = new Map<string, CorpusError>();
for (const f of observed) {
    const k = `${f.kind}:${f.id}:${f.code}`;
    if (!byKey.has(k)) byKey.set(k, f);
}

const entries = [...byKey.values()]
    .map((f) => ({ kind: f.kind, id: f.id, code: f.code, severity: f.severity }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id) || a.code.localeCompare(b.code));

const baseline: Baseline = {
    note: 'Machine-generated snapshot of observed corpus findings. Regenerate: bun run scripts/commands/regen-corpus-baseline.ts. Wave 2026-08-27 (ADR-090): single-sided gate; vanished entries retire via regeneration, not gate failure. Retires the ADR-083 per-entry reason/since annotations.',
    entries,
};

const file = `${root}/config/corpus-baseline.json`;
await Bun.write(file, `${JSON.stringify(baseline, null, 4)}\n`);

// Round-trip: re-sweep and reconcile against what we just wrote. The snapshot
// must cover the observed key set exactly — ok:true proves no observed finding
// is outside the snapshot and no duplicate keys were emitted.
const reobserved = await collectObservedFindings(root, since);
const reread = (await Bun.file(file).json()) as Baseline;
const result = reconcileBaseline(reobserved, reread);
if (!result.ok || reread.entries.length !== byKey.size) {
    console.error(
        `regen-corpus-baseline: round-trip FAILED (ok=${result.ok}, wrote ${byKey.size}, reread ${reread.entries.length}, new=${result.newErrors.length + result.newWarnings.length}, dupes=${result.duplicateKeys.length}) — config/corpus-baseline.json is unreliable; do not commit.`,
    );
    process.exit(1);
}

console.log(
    `regen-corpus-baseline: wrote ${reread.entries.length} entries (${result.observed} observed findings, deduped by kind:id:code). Round-trip verified.`,
);
