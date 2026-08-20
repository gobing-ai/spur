import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { FEATURE_STATUSES, TASK_STATUSES } from '../../src/planning/schema';

/**
 * Type mirror of the engine's state-machine definition shape — just enough
 * to extract states for drift comparison.
 */
interface StateMachineDef {
    kind?: string;
    name: string;
    initialState: string;
    terminalStates?: string[];
    states: { id: string }[];
    transitions: { from: string; to: string }[];
}

/** Repository root (packages/domain/tests/planning → ../../../..). */
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

/** Load and parse a state-machine workflow YAML. */
function loadLifecycleYaml(...segments: string[]): StateMachineDef {
    const fullPath = join(REPO_ROOT, ...segments);
    const text = readFileSync(fullPath, 'utf-8');
    return parseYaml(text) as StateMachineDef;
}

describe('lifecycle workflow drift prevention (task 0046 R3)', () => {
    describe('task-lifecycle.yaml', () => {
        const yaml = loadLifecycleYaml('config', 'workflows', 'task-lifecycle.yaml');

        test('is a state-machine', () => {
            expect(yaml.kind).toBe('state-machine');
        });

        test('state set matches TASK_STATUSES union exactly', () => {
            const yamlStates = yaml.states.map((s) => s.id).sort();
            const schemaStates = [...TASK_STATUSES].sort();
            expect(yamlStates).toEqual(schemaStates);
        });

        test('initialState is backlog', () => {
            expect(yaml.initialState).toBe('backlog');
        });

        test('terminalStates is [cancelled]', () => {
            expect(yaml.terminalStates).toEqual(['cancelled']);
        });

        test('cancelled has no outgoing transitions (truly terminal)', () => {
            const outbound = yaml.transitions.filter((t) => t.from === 'cancelled');
            expect(outbound).toEqual([]);
        });

        test('done is re-enterable (has outgoing transition to wip)', () => {
            const reopen = yaml.transitions.filter((t) => t.from === 'done' && t.to === 'wip');
            expect(reopen.length).toBe(1);
        });

        test('every transition endpoint is a declared state', () => {
            const stateIds = new Set(yaml.states.map((s) => s.id));
            for (const t of yaml.transitions) {
                expect(stateIds.has(t.from)).toBe(true);
                expect(stateIds.has(t.to)).toBe(true);
            }
        });
    });

    describe('feature-lifecycle.yaml', () => {
        const yaml = loadLifecycleYaml('config', 'workflows', 'feature-lifecycle.yaml');

        test('is a state-machine', () => {
            expect(yaml.kind).toBe('state-machine');
        });

        test('state set matches FEATURE_STATUSES union exactly', () => {
            const yamlStates = yaml.states.map((s) => s.id).sort();
            const schemaStates = [...FEATURE_STATUSES].sort();
            expect(yamlStates).toEqual(schemaStates);
        });

        test('initialState is backlog', () => {
            expect(yaml.initialState).toBe('backlog');
        });

        test('terminalStates is [cancelled]', () => {
            expect(yaml.terminalStates).toEqual(['cancelled']);
        });

        test('cancelled has no outgoing transitions (truly terminal)', () => {
            const outbound = yaml.transitions.filter((t) => t.from === 'cancelled');
            expect(outbound).toEqual([]);
        });

        test('includes the verifying status (DD-13)', () => {
            expect(yaml.states.some((s) => s.id === 'verifying')).toBe(true);
        });

        test('has active→verifying and verifying→done transitions', () => {
            const toVerifying = yaml.transitions.filter((t) => t.from === 'active' && t.to === 'verifying');
            const toDone = yaml.transitions.filter((t) => t.from === 'verifying' && t.to === 'done');
            expect(toVerifying.length).toBe(1);
            expect(toDone.length).toBe(1);
        });

        test('has verifying→active rework transition (DD-13)', () => {
            const rework = yaml.transitions.filter((t) => t.from === 'verifying' && t.to === 'active');
            expect(rework.length).toBe(1);
        });

        test('every transition endpoint is a declared state', () => {
            const stateIds = new Set(yaml.states.map((s) => s.id));
            for (const t of yaml.transitions) {
                expect(stateIds.has(t.from)).toBe(true);
                expect(stateIds.has(t.to)).toBe(true);
            }
        });
    });
});

/** Extended shape for the task-pipeline assertions (onEnter actions + guards). */
interface PipelineDef {
    kind?: string;
    name: string;
    initialState: string;
    terminalStates?: string[];
    vars?: Record<string, unknown>;
    states: { id: string; onEnter?: { kind: string; options?: Record<string, unknown> }[] }[];
    transitions: { from: string; to: string; guard?: { kind: string; options?: Record<string, unknown> } }[];
}

describe('task-pipeline.yaml structure (task 0062)', () => {
    const yaml = loadLifecycleYaml('config', 'workflows', 'task-pipeline.yaml') as unknown as PipelineDef;
    const stateIds = yaml.states.map((s) => s.id);

    test('R1: the design §6 pipeline states are present, vars.wbs declared', () => {
        for (const s of ['precheck', 'implement', 'test', 'review', 'approve', 'verify', 'record', 'done']) {
            expect(stateIds).toContain(s);
        }
        expect(yaml.vars).toHaveProperty('wbs');
        expect(yaml.initialState).toBe('precheck');
    });

    test('R1: precheck→implement is guarded by doctor status + `task check`, with fail-closed fall-through', () => {
        const toImpl = yaml.transitions.find((t) => t.from === 'precheck' && t.to === 'implement');
        expect(toImpl?.guard?.kind).toBe('shell');
        // Soft doctor status file + task check (fleet reliability: soft probe → status → branch).
        // Guard command must reference a task check — whether literal `spur` or
        // `${vars.spurBin}` (ADR-026 PATH-independent spur invocation).
        const passCmd = String(toImpl?.guard?.options?.command ?? '');
        expect(passCmd).toMatch(/task check/);
        expect(passCmd).toMatch(/precheck-doctor\.status/);
        // Declaration order: PASS first, then fail-closed `always` fall-through (soft probe
        // pattern — doctor FAIL and/or task check red both land on `failed` without inverted
        // shell guards that race set -e). `always` is safe only AFTER the PASS guard.
        const idxPass = yaml.transitions.findIndex((t) => t.from === 'precheck' && t.to === 'implement');
        const idxFail = yaml.transitions.findIndex((t) => t.from === 'precheck' && t.to === 'failed');
        expect(idxFail).toBeGreaterThan(idxPass);
        expect(yaml.transitions[idxFail]?.guard?.kind).toBe('always');
    });

    test('R2: record writes via `spur task record` + post-record feature sync (task 0328)', () => {
        const record = yaml.states.find((s) => s.id === 'record');
        const cmds = (record?.onEnter ?? []).map((a) => String(a.options?.command ?? ''));
        // Proof-state compare + record step + post-record feature sync (task 0328 / ADR-0322,
        // task 0612 / ADR-071).
        expect(record?.onEnter ?? []).toHaveLength(3);
        // The proof compare must be FIRST: it asserts no proof input changed since the verdict was
        // established, so it has to run before any record write. Ordering is the guarantee here —
        // a compare placed after `spur task record` would validate a tree the step just mutated.
        expect(record?.onEnter?.[0]?.kind).toBe('proof.fingerprint');
        expect(String(record?.onEnter?.[0]?.options?.expect ?? '')).toContain('proofDigest');
        expect(
            cmds.some(
                (c) =>
                    c.includes('task record') &&
                    c.includes('--solution-from-diff') &&
                    c.includes('--transition testing'),
            ),
        ).toBe(true);
        // The post-record hop must still sync feature status, but the mechanism is free: task 0411
        // routes it through `feature-sync-bounded.ts`, which wraps `spur feature sync --json` with
        // retry suppression. Assert the intent (a feature-sync hop exists), not one spelling.
        expect(cmds.some((c) => c.includes('feature sync') || c.includes('feature-sync-bounded'))).toBe(true);
    });

    test('R3: status transitions go through the normal verb (`spur task update <wbs> <status>`)', () => {
        const allCmds = yaml.states
            .flatMap((s) => s.onEnter ?? [])
            .filter((a) => a.kind === 'shell')
            .map((a) => String(a.options?.command ?? ''));
        // Variable spelling: task 0432/0434 exports workflow vars as process env, so shell
        // commands reference `wbs` by bare name (`$wbs`) instead of the engine's inline
        // `${vars.wbs}` template. Accept both spellings, quoted or unquoted — the invariant is the verb shape
        // (`task update <wbs> <status>` / `task record <wbs>`), not the variable syntax.
        const wbsRef = /(?:\$\{vars\.wbs\}|\$wbs)/;
        const wbsArg = `"?${wbsRef.source}"?`;
        expect(allCmds.some((c) => new RegExp(`task update ${wbsArg} wip`).test(c))).toBe(true);
        // The testing transition is now inside `task record --transition testing` (a single verb),
        // not a separate shell step. Record owns the transition; the gate guard still verifies.
        expect(
            allCmds.some((c) => new RegExp(`task record ${wbsArg}`).test(c) && c.includes('--transition testing')),
        ).toBe(true);
        expect(allCmds.some((c) => new RegExp(`task update ${wbsArg} done`).test(c))).toBe(true);
    });

    test('R4: approve is a HITL gate (hitl.confirm)', () => {
        const approve = yaml.states.find((s) => s.id === 'approve');
        expect((approve?.onEnter ?? []).some((a) => a.kind === 'hitl.confirm')).toBe(true);
    });

    test('uses the resolvable @gobing-ai/spur schema ref (not the dead engine ref)', () => {
        const text = require('node:fs').readFileSync(
            require('node:path').join(REPO_ROOT, 'config', 'workflows', 'task-pipeline.yaml'),
            'utf-8',
        ) as string;
        expect(text).toContain('@gobing-ai/spur/schemas/state-machine-workflow.schema.json');
        expect(text).not.toContain('@gobing-ai/ts-dual-workflow-engine/schemas');
    });

    test('R2 (task 0482): every `bun plugins/sp/scripts/...` step passes --spur-bin so spur resolves regardless of shell PATH', () => {
        // Regression for 0471's double precheck FAIL (`could not fetch task 0471 via spur`):
        // task-size-precheck.ts already honors `--spur-bin` / `SPUR_BIN`, but the workflow
        // invoked it without either, so the workflow shell (`/bin/sh -c`, no user PATH)
        // could not resolve bare `spur`. Sibling steps (doctor, feature-sync) already pass
        // `$spurBin`. Guard: any shell step that shells spur through a bundled script must
        // hand it the resolved binary.
        const allCmds = yaml.states
            .flatMap((s) => s.onEnter ?? [])
            .filter((a) => a.kind === 'shell')
            .map((a) => String(a.options?.command ?? ''));
        const spurShellingScripts = allCmds.filter((c) => c.includes('bun plugins/sp/scripts/'));
        expect(spurShellingScripts.length).toBeGreaterThan(0);
        for (const cmd of spurShellingScripts) {
            expect(cmd).toContain('--spur-bin');
        }
    });

    test('R3 (task 0482): the fix hop is handed the failing file:line anchors, not a discovery run', () => {
        // 0471 burned ~39 min (8m50s + a 30m timeout kill) on ONE anchored finding
        // (`raw-sql-only-in-domain … history-service.ts:360`) because the test-fix hop
        // dispatched an unscoped /sp:dev-fixall that re-derived the failure from scratch.
        // The contract is a closed loop: the gate hop must EXTRACT anchors to a digest file,
        // and the fix hop must READ that digest into a var and NAME it in the dispatch input.
        // Breaking any link silently restores the re-derivation cost, so all three are asserted.
        const shellCmds = (id: string) =>
            (yaml.states.find((s) => s.id === id)?.onEnter ?? [])
                .filter((a) => a.kind === 'shell')
                .map((a) => String(a.options?.command ?? ''));

        // 1. Both gate hops extract anchors into the digest file.
        for (const gateState of ['test', 'test-recheck']) {
            const cmds = shellCmds(gateState).join('\n');
            expect(cmds, `${gateState}: must capture the gate log`).toContain('-test-gate.log');
            expect(cmds, `${gateState}: must extract file:line anchors`).toContain('-test-gate.findings');
            expect(cmds, `${gateState}: anchors must be bounded`).toContain('head -20');
        }

        // 2. test-fix projects the digest into a var (a vars template cannot shell out).
        const fixSteps = yaml.states.find((s) => s.id === 'test-fix')?.onEnter ?? [];
        const readIdx = fixSteps.findIndex((a) => a.kind === 'file.read.into-var');
        expect(readIdx, 'test-fix must read the findings digest into a var').toBeGreaterThanOrEqual(0);
        const readStep = fixSteps[readIdx];
        expect(String(readStep?.options?.path ?? '')).toContain('-test-gate.findings');
        const varName = String(readStep?.options?.var ?? '');
        expect(varName).toBe('gateFindings');
        expect(yaml.vars, 'the var must be declared or the template throws at runtime').toHaveProperty(varName);

        // 3. The dispatch input NAMES the anchors — R3's measurable, not merely a log path.
        const dispatchIdx = fixSteps.findIndex((a) => a.kind === 'agent.run');
        const fixInput = String(fixSteps[dispatchIdx]?.options?.input ?? '');
        expect(fixInput).toContain('/sp:dev-fixall');
        expect(fixInput, 'input must name the extracted anchors').toContain(`--findings "\${vars.${varName}}"`);
        expect(fixInput, 'the full log stays available as the escape hatch').toContain('--gate-log');

        // 4. The read must precede the dispatch, or the var is still the empty default.
        expect(readIdx).toBeLessThan(dispatchIdx);
    });

    test('every transition endpoint is a declared state', () => {
        const ids = new Set(stateIds);
        for (const t of yaml.transitions) {
            expect(ids.has(t.from)).toBe(true);
            expect(ids.has(t.to)).toBe(true);
        }
    });
});
