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

        // ── ADR-137: deprecated is a non-terminal frozen state ──────────────────
        test('deprecated is a declared state and is NOT terminal', () => {
            expect(yaml.states.some((s) => s.id === 'deprecated')).toBe(true);
            expect(yaml.terminalStates).toEqual(['cancelled']);
            expect(yaml.terminalStates).not.toContain('deprecated');
        });

        test('deprecated is accepted as a target from every listed source (one edge each)', () => {
            for (const from of ['backlog', 'todo', 'wip', 'testing', 'blocked', 'done']) {
                const edges = yaml.transitions.filter((t) => t.from === from && t.to === 'deprecated');
                expect(edges.length, `${from} → deprecated must be declared exactly once`).toBe(1);
            }
        });

        test('deprecated exits only to todo (un-deprecate) and cancelled (removal)', () => {
            const outbound = yaml.transitions.filter((t) => t.from === 'deprecated').map((t) => t.to);
            expect([...outbound].sort()).toEqual(['cancelled', 'todo']);
        });

        test('any target other than todo/cancelled is refused from deprecated (undeclared edge)', () => {
            // The adapter derives the refusal's legal-path list from exactly the declared
            // outbound edges, so "refused naming the legal edges" reduces to this graph
            // invariant: no other target is declared, and the legal set is exactly these two.
            const outbound = yaml.transitions.filter((t) => t.from === 'deprecated').map((t) => t.to);
            const legal = ['cancelled', 'todo'];
            expect([...outbound].sort()).toEqual(legal);
            for (const refused of ['backlog', 'wip', 'testing', 'blocked', 'done', 'deprecated']) {
                expect(
                    yaml.transitions.some((t) => t.from === 'deprecated' && t.to === refused),
                    `deprecated → ${refused} must stay undeclared`,
                ).toBe(false);
            }
        });

        test('exactly one transition per (from, to) pair (externally-driven FSM [CRITICAL] note)', () => {
            const seen = new Set<string>();
            for (const t of yaml.transitions) {
                const key = `${t.from}→${t.to}`;
                expect(seen.has(key), `duplicate transition pair ${key}`).toBe(false);
                seen.add(key);
            }
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

/** Workflow template syntax, not a JS template literal — assembled so Biome's noTemplateCurlyInString stays quiet. */
const tpl = (name: string): string => ['$' + '{vars.', name, '}'].join('');

describe('task-pipeline.yaml structure (task 0062)', () => {
    const yaml = loadLifecycleYaml('config', 'workflows', 'task-pipeline.yaml') as unknown as PipelineDef;
    const stateIds = yaml.states.map((s) => s.id);

    test('R1: the design §6 pipeline states are present, vars.wbs declared', () => {
        // D65 1239 / ADR-140: six working states + two terminals. The former
        // test/test-recheck pair is one `gate`, `verify` merged into `review`, `approve`
        // became a decision point inside `review`, and `record` became `done`'s onEnter.
        for (const s of ['precheck', 'implement', 'escalate', 'gate', 'remediate', 'review', 'done', 'failed']) {
            expect(stateIds).toContain(s);
        }
        // The four retired states stay retired: a re-introduced one would re-open the
        // shape the rewrite contracted away.
        for (const gone of ['test', 'test-recheck', 'verify', 'record', 'approve']) {
            expect(stateIds).not.toContain(gone);
        }
        // The intents the retired states carried are still in the graph, relocated:
        // a quality gate step, operator approval, certification, and the deterministic close.
        expect(yaml.states.find((s) => s.id === 'gate')?.onEnter?.some((a) => a.kind === 'command.gate')).toBe(true);
        expect(yaml.states.find((s) => s.id === 'review')?.onEnter?.some((a) => a.kind === 'hitl.confirm')).toBe(true);
        expect(
            (yaml.states.find((s) => s.id === 'review')?.onEnter ?? []).some((a) =>
                String((a.options?.args as unknown[] | undefined)?.join(' ') ?? '').includes('verdict'),
            ),
        ).toBe(true);
        expect(
            (yaml.states.find((s) => s.id === 'done')?.onEnter ?? []).some((a) =>
                String((a.options?.args as unknown[] | undefined)?.join(' ') ?? '').includes('record'),
            ),
        ).toBe(true);
        expect(yaml.vars).toHaveProperty('wbs');
        expect(yaml.initialState).toBe('precheck');
        expect(yaml.terminalStates).toEqual(['done', 'failed']);
    });

    test('R1: precheck→implement is guarded by `task check --precheck`, with fail-closed fall-through', () => {
        const toImpl = yaml.transitions.find((t) => t.from === 'precheck' && t.to === 'implement');
        expect(toImpl?.guard?.kind).toBe('shell');
        // 1002 R4: one guard command — `task check --precheck` carries the size and
        // evidence-channel gates inline (no status files). Whether literal `spur` or
        // `$spurBin` (ADR-026 PATH-independent spur invocation).
        const passCmd = String(toImpl?.guard?.options?.command ?? '');
        expect(passCmd).toMatch(/task check/);
        expect(passCmd).toMatch(/--precheck/);
        expect(passCmd).not.toMatch(/precheck-doctor\.status/);
        // Declaration order: PASS first, then fail-closed `always` fall-through (soft probe
        // pattern — precheck FAIL lands on `failed` without inverted shell guards that race
        // set -e). `always` is safe only AFTER the PASS guard.
        const idxPass = yaml.transitions.findIndex((t) => t.from === 'precheck' && t.to === 'implement');
        const idxFail = yaml.transitions.findIndex((t) => t.from === 'precheck' && t.to === 'failed');
        expect(idxFail).toBeGreaterThan(idxPass);
        expect(yaml.transitions[idxFail]?.guard?.kind).toBe('always');
    });

    test('R2: record writes via `spur task record` + post-record feature sync (task 0328)', () => {
        // D65 1239 / ADR-140 item 7: the `record` state is gone; its deterministic close is
        // `done`'s onEnter. The behaviour this test owns is unchanged — record from the diff,
        // sync feature status, and never record a tree the review did not certify.
        expect(stateIds).not.toContain('record');
        const doneSteps = yaml.states.find((s) => s.id === 'done')?.onEnter ?? [];
        const cmds = doneSteps.filter((a) => a.kind === 'shell').map((a) => String(a.options?.command ?? ''));
        // Certification is still FIRST in the run, now structurally: `review` derives and
        // writes `.spur/run/<wbs>-verdict.json` (`spur task verdict --from-answer`) and its
        // done-guard demands the certified review status. Record therefore only ever reads a
        // verdict the review produced over the tree it reviewed.
        const reviewArgs = JSON.stringify(yaml.states.find((s) => s.id === 'review')?.onEnter ?? []);
        expect(reviewArgs).toContain('"verdict"');
        expect(reviewArgs).toContain('--from-answer');
        expect(reviewArgs).toContain('-verdict.json');
        // 0823: the record write is a `command.gate` action (classified transient retry);
        // assert the verb shape on the gate's args.
        const recordGate = doneSteps.find((a) => a.kind === 'command.gate');
        const gateArgs = JSON.stringify(recordGate?.options ?? {});
        expect(gateArgs).toContain('"task"');
        expect(gateArgs).toContain('"record"');
        expect(gateArgs).toContain('--solution-from-diff');
        expect(gateArgs).toContain('"--transition"');
        expect(gateArgs).toContain('"testing"');
        // The post-record hop must still sync feature status, but the mechanism is free: 0411's
        // retry suppression moved into the feature sync service (1004 R3/R4), so the shell is a
        // bare `feature sync`. Assert the intent (a feature-sync hop exists), not one spelling.
        expect(cmds.some((c) => c.includes('feature sync'))).toBe(true);
        // ...and it still runs AFTER the record write: the sync reads the post-record task
        // file, so a reordering would sync a stale feature state.
        const recordIdx = doneSteps.findIndex((a) => a.kind === 'command.gate');
        const syncIdx = doneSteps.findIndex((a) => String(a.options?.command ?? '').includes('feature sync'));
        expect(syncIdx).toBeGreaterThan(recordIdx);
        // The completion contract is re-asserted after the residual sweep, on the verdict
        // artifact (the review's own evidence) instead of the retired proof digest.
        expect(cmds.some((c) => c.includes('jq -e') && c.includes('-verdict.json') && c.includes('PASS'))).toBe(true);
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
        // 0823: transitions may live in `command.gate` args (JSON array) instead of shell
        // commands — the verb shape is the invariant, not the transport.
        const gateText = JSON.stringify(
            yaml.states
                .flatMap((s) => s.onEnter ?? [])
                .filter((a) => a.kind === 'command.gate')
                .map((a) => a.options?.args ?? []),
        );
        const wbsJson = '"(?:\\$\\{vars\\.wbs\\}|\\$wbs)"';
        expect(
            allCmds.some((c) => new RegExp(`task update ${wbsArg} wip`).test(c)) ||
                new RegExp(`"task","update",${wbsJson},"wip"`).test(gateText),
        ).toBe(true);
        // The testing transition is now inside `task record --transition testing` (a single verb),
        // not a separate shell step. Record owns the transition; the gate guard still verifies.
        expect(
            allCmds.some((c) => new RegExp(`task record ${wbsArg}`).test(c) && c.includes('--transition testing')) ||
                (new RegExp(`"task","record",${wbsJson}`).test(gateText) && gateText.includes('"testing"')),
        ).toBe(true);
        expect(
            allCmds.some((c) => new RegExp(`task update ${wbsArg} done`).test(c)) ||
                new RegExp(`"task","update",${wbsJson},"done"`).test(gateText),
        ).toBe(true);
    });

    test('R4: approve is a HITL gate (hitl.confirm)', () => {
        // D65 1239 R1/R5 (ADR-140 item 5): the standalone `approve` state became a decision
        // point at the END of `review`, after certification. Same confirmation, same three
        // outcomes (accept / deny / cancel) routed by the review guards.
        expect(stateIds).not.toContain('approve');
        const reviewSteps = yaml.states.find((s) => s.id === 'review')?.onEnter ?? [];
        const hitl = reviewSteps.find((a) => a.kind === 'hitl.confirm');
        expect(hitl).toBeDefined();
        // It runs AFTER the certification fold: asking before the verdict/residual check would
        // approve a task the review had not yet certified. The only action that follows it is
        // the answer's fold into the approval token (it reads what the decision point captured).
        const hitlIdx = reviewSteps.indexOf(hitl as { kind: string });
        const certifyIdx = reviewSteps.findIndex((a) => String(a.options?.command ?? '').includes('-review.status'));
        expect(certifyIdx).toBeGreaterThanOrEqual(0);
        expect(hitlIdx).toBeGreaterThan(certifyIdx);
        expect(reviewSteps.slice(hitlIdx + 1).map((a) => a.kind)).toEqual(['shell']);
        expect(String(hitl?.options?.prompt ?? '')).toContain(tpl('wbs'));
        // 1236: answered through the decision-point responder, not a `pause: true` state.
        expect(String(JSON.stringify(hitl?.options?.decision ?? {}))).toContain('"mode":"evidence"');
        // The three outcomes still exist as recorded routes out of review.
        const outs = yaml.transitions.filter((t) => t.from === 'review').map((t) => t.to);
        expect(outs).toContain('done');
        expect(outs).toContain('failed');
        const cancelled = yaml.transitions.find((t) => t.from === 'review' && t.to === 'failed');
        expect(String(cancelled?.guard?.options?.command ?? '')).toContain('DENIED');
    });

    test('uses the resolvable @gobing-ai/spur schema ref (not the dead engine ref)', () => {
        const text = require('node:fs').readFileSync(
            require('node:path').join(REPO_ROOT, 'config', 'workflows', 'task-pipeline.yaml'),
            'utf-8',
        ) as string;
        expect(text).toContain('@gobing-ai/spur/schemas/state-machine-workflow.schema.json');
        expect(text).not.toContain('@gobing-ai/ts-dual-workflow-engine/schemas');
    });

    test('R2 (task 0482 → retired by 1213): no `bun plugins/sp/scripts/...` steps remain; any that return must pass --spur-bin', () => {
        // Regression for 0471's double precheck FAIL (`could not fetch task 0471 via spur`):
        // the precheck shell could not resolve bare `spur`, so the workflow invoked a
        // bundled checker without `--spur-bin` / `SPUR_BIN` and the shell (`/bin/sh -c`, no
        // user PATH) failed the fetch. Sibling steps (doctor, feature-sync) pass `$spurBin`.
        // Guard: any shell step that shells spur through a bundled script must hand it the
        // resolved binary. 1213 retired the script machinery (hook-only script contract,
        // including the last step — 0960's script-resolution probe), so the pipeline must
        // carry NO bundled-script steps anymore (mirrors task-pipeline-resilience's
        // not-contains contract for the retired probes); the per-step guard stays for any
        // that might return.
        const allCmds = yaml.states
            .flatMap((s) => s.onEnter ?? [])
            .filter((a) => a.kind === 'shell')
            .map((a) => String(a.options?.command ?? ''));
        const spurShellingScripts = allCmds.filter(
            (c) =>
                // Literal form and 0931's resolver form (`S=plugins/sp/scripts/x.ts; … bun "$S"`)
                // both shell spur through a bundled script.
                // (Script-absorption PR-3: the gate, diffstat and residual sweep are `spur task` verbs
                // now — they take `$spurBin` as the command itself, not a `--spur-bin` flag.)
                c.includes('bun plugins/sp/scripts/') || c.includes('S=plugins/sp/scripts/'),
        );
        expect(spurShellingScripts).toEqual([]);
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

        // 1. The ONE gate hop extracts anchors into the digest file. 0823 (d): the extraction
        // moved into the gate; 1006 R1 moved the gate core into the app service and
        // script-absorption PR-3 made `spur task gate` its entry; D65 1239 R2 merged the two
        // gate states, so the mode is chosen per visit (run first, recheck after a remediation)
        // instead of by state. Assert the mode selection, the verb delegation and the app-owned
        // artifacts with the bounded cap (MAX_FINDINGS = 20).
        const gateCore = readFileSync(
            join(REPO_ROOT, 'packages', 'app', 'src', 'services', 'quality-gate.ts'),
            'utf-8',
        );
        const gateCmds = shellCmds('gate').join('\n');
        expect(gateCmds, 'gate hop must pick the mode per visit').toContain('M=run');
        expect(gateCmds, 'a later visit must recheck').toContain('M=recheck');
        expect(gateCmds, 'the gate hop must write the mode it selected').toContain('-gate-mode.txt');
        const gateArgs = JSON.stringify(
            (yaml.states.find((s) => s.id === 'gate')?.onEnter ?? []).find((a) => a.kind === 'command.gate')?.options
                ?.args ?? [],
        );
        expect(gateArgs, 'the gate hop must delegate to spur task gate').toContain('"task","gate"');
        expect(gateArgs, 'the selected mode rides the args').toContain(tpl('gateMode'));
        expect(yaml.vars, 'the mode var must be declared or the template throws at runtime').toHaveProperty('gateMode');
        expect(gateCore).toContain('-test-gate.log');
        expect(gateCore).toContain('-test-gate.findings');
        expect(gateCore).toContain('MAX_FINDINGS = 20');

        // 2. The repair hop projects the digest into a var (a vars template cannot shell out).
        // D65 1239: `test-fix` is `remediate`, serving both the red gate and a repairable review.
        const fixSteps = yaml.states.find((s) => s.id === 'remediate')?.onEnter ?? [];
        const readIdx = fixSteps.findIndex((a) => a.kind === 'file.read.into-var');
        expect(readIdx, 'remediate must read the findings digest into a var').toBeGreaterThanOrEqual(0);
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
