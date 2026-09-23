/**
 * Feature-scoped verification split (task 0872, ADR-119, feature D62).
 *
 * Contract regression for the scope split the task introduces:
 *   R2 — the per-task gate (`bun run spur-check`, task-pipeline `qualityGateCmd`)
 *        no longer runs any repo-wide check;
 *   R3 — the repo-wide set lives in `bun run spur-check-feature`, owned by the
 *        `feature-verification` workflow (shell-only, no `agent.run`);
 *   R4 — `feature-lifecycle`'s verifying→done guard refuses to complete a
 *        feature until the pass records PASS;
 *   R5 — task-local checks (including the task-local `test` script) do not
 *        consult the feature pass or the relocated repo-wide test tree.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(import.meta.dir, '../../..');

/** The repo-wide check names relocated out of the per-task gate (task 0872 R2/R3). */
const REPO_WIDE_CHECKS = [
    'link-check',
    'transition-shim-check',
    'script-contract-check',
    'inline-pipeline-parity-check',
    'dependency-drift-check',
    'importer-schema-check',
    'history-surface-freeze-check',
] as const;

function readScripts(): Record<string, string> {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
    };
    return pkg.scripts;
}

function readWorkflow(name: string): Record<string, unknown> {
    return parseYaml(readFileSync(join(REPO_ROOT, 'config', 'workflows', name), 'utf8')) as Record<string, unknown>;
}

describe('feature-verification scope split (task 0872)', () => {
    test('R2: the per-task gate (spur-check) runs no repo-wide check and no feature pass', () => {
        const scripts = readScripts();
        const taskGate = scripts['spur-check'];
        for (const check of REPO_WIDE_CHECKS) {
            expect(taskGate, `spur-check must not run ${check}`).not.toContain(check);
        }
        expect(taskGate).not.toContain('test-repo-wide');
        expect(taskGate).not.toContain('spur-check-feature');
        // spur-check-new stays the identical task-local chain (its own census).
        expect(scripts['spur-check-new']).toBe(taskGate);
    });

    test('R3: the feature pass (spur-check-feature) owns every repo-wide check', () => {
        const scripts = readScripts();
        const featureGate = scripts['spur-check-feature'];
        for (const check of REPO_WIDE_CHECKS) {
            expect(featureGate, `spur-check-feature must run ${check}`).toContain(check);
        }
        expect(featureGate).toContain('test-repo-wide');
    });

    test('R5: the task-local test script excludes the relocated repo-wide test tree', () => {
        const scripts = readScripts();
        expect(scripts.test).not.toContain('repo-wide-tests');
        expect(scripts['test-repo-wide']).toContain('repo-wide-tests');
    });

    test('R3: feature-verification is a shell-only pass with no agent.run nodes', () => {
        const wf = readWorkflow('feature-verification.yaml');
        expect(wf.name).toBe('feature-verification');
        expect(wf.vars).toMatchObject({ verificationCmd: 'bun run spur-check-feature' });

        const actionKinds: unknown[] = [];
        for (const state of (wf.states as Array<{ onEnter?: Array<{ kind: unknown }> }>) ?? []) {
            for (const action of state.onEnter ?? []) actionKinds.push(action.kind);
        }
        expect(actionKinds).toEqual(['shell']);
        expect(actionKinds).not.toContain('agent.run');

        const guardKinds = new Set<unknown>();
        for (const t of (wf.transitions as Array<{ guard?: { kind: unknown } }>) ?? []) {
            if (t.guard) guardKinds.add(t.guard.kind);
        }
        expect([...guardKinds].sort()).toEqual(['always', 'shell']);
    });

    test('R4: feature-lifecycle verifying→done requires the strict done check (bound receipt, 0915)', () => {
        const wf = readWorkflow('feature-lifecycle.yaml');
        const edge = (
            wf.transitions as Array<{ from: string; to: string; guard?: { options?: { command?: string } } }>
        ).find((t) => t.from === 'verifying' && t.to === 'done');
        expect(edge).toBeDefined();
        // D63 task 0915: the old `.status`-only precondition collapsed into the
        // strict `feature check --as done`, whose L4 layer validates the bound
        // verification receipt (verdict, identity, contract, input digest).
        expect(edge?.guard?.options?.command ?? '').toContain('feature check');
        expect(edge?.guard?.options?.command ?? '').toContain('--as done');
    });

    test('R5 (0880): feature-lifecycle verifying entry invokes the feature-verification workflow', () => {
        const wf = readWorkflow('feature-lifecycle.yaml');
        const verifying = (
            wf.states as Array<{ id: string; onEnter?: Array<{ options?: { command?: string } }> }>
        ).find((s) => s.id === 'verifying');
        const commands = (verifying?.onEnter ?? []).map((a) => a.options?.command ?? '');
        expect(commands.some((c) => c.includes('workflow run feature-verification.yaml'))).toBe(true);
    });
});
