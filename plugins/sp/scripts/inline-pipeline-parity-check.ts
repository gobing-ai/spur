#!/usr/bin/env bun
/**
 * inline-pipeline-parity-check — two-sided gate between the inline pipeline
 * driver's documented action/guard set and the resolved action/guard sets in
 * `.spur/workflows/task-pipeline.yaml` and `.spur/workflows/idea-pipeline.yaml`
 * (task 0755 R2/R3).
 *
 * The driver reference at `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`
 * documents the set of action and guard kinds it implements. The two runtime
 * pipelines are the only consumers the driver needs to keep in step with. The
 * check is a symmetric set diff: an element present in one and absent in the
 * other fails the check and names the element.
 *
 * The set is defined in {@link DOCUMENTED} below; the driver's markdown list is
 * the human mirror. Update both when the driver adds or drops a kind.
 *
 * Usage:
 *   bun plugins/sp/scripts/inline-pipeline-parity-check.ts
 *     [--root <path>]               default: repo root
 *
 * Exit code: 0 when the sets agree; 1 on any divergence. Violations are printed
 * to stderr; a summary to stdout.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

/** Documented action and guard set. Must stay in lockstep with the
 *  "Supported action and guard set (0755 R2 parity contract)" section in
 *  `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`. The
 *  driver supports a kind if ANY workflow in `.spur/workflows/*.yaml` uses
 *  it (the driver applies to any selected pipeline per its reference doc). */
const DOCUMENTED = {
    actions: new Set([
        'shell',
        'note',
        'doctor.probe',
        'file.read.into-var',
        'hitl.confirm',
        'agent.run',
        'proof.fingerprint',
        'run.artifact',
        'command.gate',
    ]),
    guards: new Set(['always', 'shell']),
} as const;

/** Directory of workflow definitions the driver is responsible for. */
const WORKFLOW_DIR = join('config', 'workflows');

/** Walk a state list and yield every `kind:` value found in `onEnter` action
 *  lists. Skips the top-level workflow `kind:` (e.g. `state-machine`). */
function collectActionKinds(states: unknown): Set<string> {
    const out = new Set<string>();
    if (!Array.isArray(states)) return out;
    for (const state of states) {
        if (typeof state !== 'object' || state === null) continue;
        const onEnter = (state as { onEnter?: unknown }).onEnter;
        if (!Array.isArray(onEnter)) continue;
        for (const action of onEnter) {
            if (typeof action !== 'object' || action === null) continue;
            const kind = (action as { kind?: unknown }).kind;
            if (typeof kind === 'string') out.add(kind);
        }
    }
    return out;
}

/** Walk a transition list and yield every `guard.kind` value. */
function collectGuardKinds(transitions: unknown): Set<string> {
    const out = new Set<string>();
    if (!Array.isArray(transitions)) return out;
    for (const transition of transitions) {
        if (typeof transition !== 'object' || transition === null) continue;
        const guard = (transition as { guard?: { kind?: unknown } }).guard;
        const kind = guard?.kind;
        if (typeof kind === 'string') out.add(kind);
    }
    return out;
}

/** Symmetric set diff. Returns elements in `a` but not in `b`, and vice versa. */
function diff<T>(a: Set<T>, b: Set<T>): { onlyInA: T[]; onlyInB: T[] } {
    const onlyInA: T[] = [];
    const onlyInB: T[] = [];
    for (const x of a) if (!b.has(x)) onlyInA.push(x);
    for (const x of b) if (!a.has(x)) onlyInB.push(x);
    return { onlyInA, onlyInB };
}

function parseArgs(argv: string[]): { root: string } {
    let root = resolve('.');
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--root' && i + 1 < argv.length) {
            root = resolve(argv[++i] ?? '.');
        } else if (arg === '--help' || arg === '-h') {
            process.stdout.write('Usage: bun inline-pipeline-parity-check.ts [--root <path>]\n');
            process.exit(0);
        }
    }
    return { root };
}

function listWorkflowFiles(dir: string): string[] {
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return [];
    }
    return entries.filter((e) => e.endsWith('.yaml')).map((e) => join(dir, e));
}

async function main(): Promise<number> {
    const { root } = parseArgs(process.argv.slice(2));
    const errors: string[] = [];

    const workflowDir = join(root, WORKFLOW_DIR);
    if (!statSync(workflowDir, { throwIfNoEntry: false })) {
        process.stderr.write(`inline-pipeline-parity-check: workflow directory not found: ${workflowDir}\n`);
        return 1;
    }

    const files = listWorkflowFiles(workflowDir);
    if (files.length === 0) {
        process.stderr.write(`inline-pipeline-parity-check: no .yaml workflows found in ${workflowDir}\n`);
        return 1;
    }

    const unionActions = new Set<string>();
    const unionGuards = new Set<string>();
    const perFileKinds: { path: string; actions: Set<string>; guards: Set<string> }[] = [];

    for (const path of files) {
        let parsed: unknown;
        try {
            parsed = parseYaml(readFileSync(path, 'utf8'));
        } catch (err) {
            errors.push(`${path}: failed to parse (${err instanceof Error ? err.message : String(err)})`);
            continue;
        }
        if (typeof parsed !== 'object' || parsed === null) {
            continue;
        }
        const def = parsed as { states?: unknown; transitions?: unknown };
        const actions = collectActionKinds(def.states);
        const guards = collectGuardKinds(def.transitions);
        perFileKinds.push({ path, actions, guards });
        for (const a of actions) unionActions.add(a);
        for (const g of guards) unionGuards.add(g);
    }

    const actionDiff = diff(unionActions, DOCUMENTED.actions);
    const guardDiff = diff(unionGuards, DOCUMENTED.guards);

    for (const x of actionDiff.onlyInA) {
        const usedIn = perFileKinds.filter((f) => f.actions.has(x)).map((f) => f.path);
        errors.push(`action kind "${x}" used in YAML (${usedIn.join(', ')}) but absent from inline-pipeline-driver.md`);
    }
    for (const x of actionDiff.onlyInB) {
        errors.push(`action kind "${x}" documented in inline-pipeline-driver.md but never used in any workflow`);
    }
    for (const x of guardDiff.onlyInA) {
        const usedIn = perFileKinds.filter((f) => f.guards.has(x)).map((f) => f.path);
        errors.push(`guard kind "${x}" used in YAML (${usedIn.join(', ')}) but absent from inline-pipeline-driver.md`);
    }
    for (const x of guardDiff.onlyInB) {
        errors.push(`guard kind "${x}" documented in inline-pipeline-driver.md but never used in any workflow`);
    }

    if (errors.length > 0) {
        process.stderr.write(`inline-pipeline-parity-check: ${errors.length} divergence(s)\n`);
        for (const e of errors) process.stderr.write(`  - ${e}\n`);
        return 1;
    }

    process.stdout.write(
        `inline-pipeline-parity-check: ok (${unionActions.size} actions, ${unionGuards.size} guards agree across ${files.length} workflows)\n`,
    );
    return 0;
}

process.exit(await main());
