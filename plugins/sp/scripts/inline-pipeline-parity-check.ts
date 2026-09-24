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
 * The set is defined in {@link DOCUMENTED} below. Task 0881 (0877 R7): the harness
 * enumerates state from BOTH reference sets — this constant and the driver
 * markdown's mirror list — plus the YAML union, as a three-way symmetric diff, so
 * removing a kind from either reference cannot escape parity. It also scans task
 * frontmatter `dependencies[]` for spurious edges: a referenced wbs with no task
 * file (post-0875, dependency edges no longer move the planning digest —
 * `packages/app/src/services/task-readiness.ts` — so over-declared edges would
 * otherwise be silently unbound).
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
        'hitl.input',
        'hitl.select',
        'agent.run',
        'proof.fingerprint',
        'run.artifact',
        'command.gate',
    ]),
    guards: new Set(['always', 'shell', 'action-ok', 'contract-violation']),
} as const;

/** Directory of workflow definitions the driver is responsible for. */
const WORKFLOW_DIR = join('config', 'workflows');

/** The driver reference doc — the second reference set (0881). */
const DRIVER_REF = join('plugins', 'sp', 'skills', 'spur-dev', 'references', 'inline-pipeline-driver.md');

/** Task corpus dirs scanned for spurious `dependencies[]` edges (0881). */
const TASK_DIRS = ['docs/tasks', 'docs/tasks5'];

/**
 * Parse the driver reference's mirrored kind lists (`**Actions:** … · `kind` …`) into
 * reference sets. Returns null when the doc is absent (fixture roots).
 */
function collectMarkdownReferenceKinds(root: string): { actions: Set<string>; guards: Set<string> } | null {
    let md: string;
    try {
        md = readFileSync(join(root, DRIVER_REF), 'utf8');
    } catch {
        return null;
    }
    const read = (label: RegExp): Set<string> => {
        const line = md.split('\n').find((l) => label.test(l));
        const out = new Set<string>();
        if (!line) return out;
        for (const m of line.matchAll(/`([^`]+)`/g)) out.add(m[1] ?? '');
        out.delete('');
        return out;
    };
    return { actions: read(/^\*\*Actions:/), guards: read(/^\*\*Guards/) };
}

/**
 * Scan task frontmatter `dependencies[]` for spurious edges: a referenced wbs that
 * resolves to no task file in the corpus (0881 — post-0875 these edges no longer
 * move the planning digest, so over-declared ones are otherwise silently unbound).
 */
function checkTaskDependencyEdges(root: string, errors: string[]): number {
    const wbss = new Set<string>();
    const depFiles: { path: string; deps: string[] }[] = [];
    for (const dir of TASK_DIRS) {
        const abs = join(root, dir);
        let entries: string[] = [];
        try {
            entries = readdirSync(abs);
        } catch {
            continue;
        }
        for (const e of entries) {
            const m = /^(\d+)_.*\.md$/.exec(e);
            if (!m?.[1]) continue;
            wbss.add(m[1]);
            const raw = readFileSync(join(abs, e), 'utf8');
            const fm = /^---\n([\s\S]*?)\n---/.exec(raw);
            if (!fm?.[1]) continue;
            const deps: string[] = [];
            const inline = /^dependencies:\s*\[(.*)\]/m.exec(fm[1]);
            if (inline?.[1]) {
                for (const part of inline[1].split(',')) {
                    const w = part.trim().replace(/["']/g, '');
                    if (w !== '') deps.push(w);
                }
            } else {
                const block = /^dependencies:\s*$/m.exec(fm[1]);
                if (block) {
                    for (const line of fm[1].split('\n')) {
                        const item = /^\s*-\s*["']?(\d+)["']?\s*$/.exec(line);
                        if (item?.[1]) deps.push(item[1]);
                    }
                }
            }
            if (deps.length > 0) depFiles.push({ path: join(dir, e), deps });
        }
    }
    let count = 0;
    for (const { path, deps } of depFiles) {
        for (const dep of deps) {
            // Only wbs-shaped values are machine dependency edges; prose refs in the
            // legacy corpus are descriptive text, never consumed as edges.
            if (!/^\d{3,4}$/.test(dep)) continue;
            if (!wbss.has(dep)) {
                errors.push(`spurious dependency edge: ${path} depends on ${dep} but no task with wbs ${dep} exists`);
                count += 1;
            }
        }
    }
    return count;
}

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

    // Three-way parity with the markdown mirror (0881): a kind dropped from either
    // reference set — constant or doc — is caught, not just YAML drift.
    const ref = collectMarkdownReferenceKinds(root);
    if (ref !== null) {
        for (const x of diff(ref.actions, DOCUMENTED.actions).onlyInA)
            errors.push(`action kind "${x}" in the driver markdown but absent from the DOCUMENTED set`);
        for (const x of diff(ref.actions, DOCUMENTED.actions).onlyInB)
            errors.push(`action kind "${x}" in DOCUMENTED but deleted from the driver markdown reference`);
        for (const x of diff(ref.guards, DOCUMENTED.guards).onlyInA)
            errors.push(`guard kind "${x}" in the driver markdown but absent from the DOCUMENTED set`);
        for (const x of diff(ref.guards, DOCUMENTED.guards).onlyInB)
            errors.push(`guard kind "${x}" in DOCUMENTED but deleted from the driver markdown reference`);
        for (const x of diff(ref.actions, unionActions).onlyInB)
            errors.push(`action kind "${x}" in the references but never used in any workflow`);
        for (const x of diff(ref.guards, unionGuards).onlyInB)
            errors.push(`guard kind "${x}" in the references but never used in any workflow`);
    }

    const spuriousEdges = checkTaskDependencyEdges(root, errors);

    if (errors.length > 0) {
        process.stderr.write(`inline-pipeline-parity-check: ${errors.length} divergence(s)\n`);
        for (const e of errors) process.stderr.write(`  - ${e}\n`);
        return 1;
    }

    process.stdout.write(
        `inline-pipeline-parity-check: ok (${unionActions.size} actions, ${unionGuards.size} guards agree across ${files.length} workflows and both reference sets; ${spuriousEdges} spurious dependency edges)\n`,
    );
    return 0;
}

process.exit(await main());
