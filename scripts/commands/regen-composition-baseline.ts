#!/usr/bin/env bun

/**
 * regen-composition-baseline — rewrite `config/workflow-composition-baseline.json`
 * from the live workflow definitions it tracks.
 *
 * The gate (`checkWorkflowComposition`, run inside `bun run test`) is two-sided:
 * an unlisted action fails AND a stale baseline record fails. That makes the
 * baseline a deliberate acceptance surface — every workflow edit that changes a
 * step's kind or its resolved `command` / `input` string must be re-accepted here,
 * and the diff is the review artifact. This script performs that re-acceptance
 * mechanically so the accepted content is never a hand-typed approximation of
 * what the YAML actually resolves to.
 *
 * Scope is deliberately narrow. It refreshes ONLY the compared facts —
 * `terminalStates`, `modelQueries`, and each action's `kind` / `invocation` —
 * and preserves `definition` plus any action-level `disposition` (the warn-only
 * ADR-069 ownership adjudication consumed by `spur workflow validate`, which is
 * a human decision this script must never invent or discard).
 *
 * It never ADDS or REMOVES a workflow entry: adding a workflow to the tracked set
 * is a decision, not a refresh. An untracked workflow file is reported and left
 * alone.
 *
 * Round-trip assertion: after writing, re-run the real gate. A generation bug that
 * writes something the checker still rejects aborts with the checker's own errors
 * rather than leaving a baseline that only this script agrees with.
 *
 * Usage: bun run scripts/commands/regen-composition-baseline.ts [--check]
 *   --check  report drift and exit 1 without writing (CI-style probe)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadWorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import {
    checkWorkflowComposition,
    extractResolvedWorkflowFacts,
    type WorkflowCompositionBaseline,
} from '../../packages/app/src/workflow/composition-baseline';

const root = resolve(import.meta.dir, '..', '..');
const baselinePath = resolve(root, 'config/workflow-composition-baseline.json');
const checkOnly = process.argv.includes('--check');

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as WorkflowCompositionBaseline;
const changes: string[] = [];

for (const [name, entry] of Object.entries(baseline.workflows)) {
    const def = await loadWorkflowDef(resolve(root, entry.definition), { validateSchema: false });
    const facts = extractResolvedWorkflowFacts(def);

    if (JSON.stringify(entry.terminalStates) !== JSON.stringify(facts.terminalStates)) {
        changes.push(`${name}: terminalStates`);
    }
    if (JSON.stringify(entry.modelQueries) !== JSON.stringify(facts.modelQueries)) {
        changes.push(`${name}: modelQueries`);
    }
    for (const key of Object.keys({ ...entry.actions, ...facts.actions })) {
        const before = entry.actions[key];
        const after = facts.actions[key];
        if (!after) changes.push(`${name}: ${key} removed`);
        else if (!before) changes.push(`${name}: ${key} added`);
        else if (before.kind !== after.kind || before.invocation !== after.invocation) {
            changes.push(`${name}: ${key}`);
        }
    }

    for (const key of Object.keys(entry)) {
        if (!['definition', 'terminalStates', 'modelQueries', 'actions'].includes(key)) {
            changes.push(`${name}: dropped inert "${key}"`);
        }
    }

    // Rebuild the action map from the live definition, carrying each surviving
    // action's adjudicated `disposition` across. A disposition on an action that
    // no longer exists is dropped with the action, which is correct.
    const actions = Object.fromEntries(
        Object.entries(facts.actions).map(([key, fact]) => {
            const disposition = entry.actions[key]?.disposition;
            return [key, { ...fact, ...(disposition !== undefined ? { disposition } : {}) }];
        }),
    );
    // Rebuild the ENTRY to exactly the compared fields, dropping any key the
    // checker does not compare. Descriptive classification belongs in
    // `docs/design/workflow-shell-ownership.md`; a fact recorded here but never
    // compared is documentation wearing a gate's clothes.
    baseline.workflows[name] = {
        definition: entry.definition,
        terminalStates: facts.terminalStates,
        modelQueries: facts.modelQueries,
        actions,
    };
}

// Same rule at the top level: schemaVersion + workflows are the whole schema.
baseline.schemaVersion = 1;
for (const key of Object.keys(baseline)) {
    if (key !== 'schemaVersion' && key !== 'workflows') {
        changes.push(`top-level: dropped inert "${key}"`);
        delete (baseline as unknown as Record<string, unknown>)[key];
    }
}

if (changes.length === 0) {
    console.log('regen-composition-baseline: baseline already matches the live definitions — no write.');
    process.exit(0);
}

if (checkOnly) {
    console.error(`regen-composition-baseline: ${changes.length} drifted fact(s) — baseline is stale:`);
    for (const c of changes) console.error(`  ${c}`);
    console.error("Run 'bun run regen-composition-baseline' and review the diff.");
    process.exit(1);
}

writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 4)}\n`);

const verdict = await checkWorkflowComposition({ projectRoot: root });
if (!verdict.pass) {
    console.error('regen-composition-baseline: FAIL - wrote a baseline the checker still rejects:');
    for (const e of verdict.errors) console.error(`  ${e}`);
    process.exit(1);
}

console.log(`regen-composition-baseline: re-accepted ${changes.length} fact(s) — review the diff before committing:`);
for (const c of changes) console.log(`  ${c}`);
