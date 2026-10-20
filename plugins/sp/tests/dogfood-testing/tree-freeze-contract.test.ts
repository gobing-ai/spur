import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const ROOT = join(import.meta.dir, '../../../../');

/** 1135 R1/R2/R3/R6/R7: the driver contract and the pipeline YAML must move together. */
describe('implement-probe and post-gate freeze contract (task 1135)', () => {
    const skill = readFileSync(join(ROOT, 'plugins/sp/skills/code-implementation/SKILL.md'), 'utf8');
    const pipeline = readFileSync(join(ROOT, 'config', 'workflows', 'task-pipeline.yaml'), 'utf8');
    const parsed = parse(pipeline) as {
        states: Array<{ id: string; onEnter?: Array<{ kind: string; options?: Record<string, unknown> }> }>;
        transitions: Array<{
            from: string;
            to: string;
            guard?: { kind: string; options?: Record<string, unknown> };
        }>;
        vars?: Record<string, string>;
    };

    const stateOf = (id: string) => {
        const state = parsed.states.find((s) => s.id === id);
        if (state === undefined) throw new Error(`state ${id} not found`);
        return state;
    };
    const fingerprints = (id: string) => (stateOf(id).onEnter ?? []).filter((a) => a.kind === 'proof.fingerprint');
    const shells = (id: string) => (stateOf(id).onEnter ?? []).filter((a) => a.kind === 'shell');

    test('R4: review joins the evidence bracket in the YAML, and the header comment says so', () => {
        // D65 1239 / ADR-140: the `proof.fingerprint` bracket is deleted. The bracket's INTENT —
        // review never certifies a tree the quality gate did not measure — survives as two
        // graph-level guarantees plus a tree-keyed receipt, and those are what this asserts.
        expect(fingerprints('review')).toHaveLength(0);
        // (1) review is only reachable from a green gate: the transition carries BOTH the typed
        // command.gate outcome and the gate's own full-tier PASS token, so a stale review can
        // never ride a blocked/red gate into certification.
        const intoReview = parsed.transitions.filter((t) => t.to === 'review');
        expect(intoReview.length).toBeGreaterThan(0);
        for (const t of intoReview) {
            expect(t.from).toBe('gate');
            const cmd = String((t.guard?.options as Record<string, unknown> | undefined)?.command ?? '');
            expect(cmd).toContain('-gate.status');
            expect(cmd).toContain('-test-gate.status');
        }
        // (2) nothing runs between gate and review that could move the tree: the reviewer
        // dispatches first, so the tree it reads is the tree the receipt is keyed to.
        const onEnter = stateOf('review').onEnter ?? [];
        expect(onEnter[0]?.kind).toBe('agent.run');
        // (3) the evidence identity the run reports is the receipt's tree hash (the retired
        // proof actions are gone from the graph, not merely renamed).
        expect(pipeline).toContain('-check-receipt.json');
        expect(pipeline).toContain('inputDigest');
        const retiredKinds = parsed.states.flatMap((s) => (s.onEnter ?? []).map((a) => a.kind));
        expect(retiredKinds).not.toContain('proof.fingerprint');
        expect(retiredKinds).not.toContain('run.artifact');
        // (4) the header comment names the evidence model it now implements.
        expect(pipeline).toContain('the tree-hash gate receipt');
        expect(pipeline).toContain('keyed by the git tree the gate captures itself');
    });

    test('R5: the gate keys its receipt to the tree it captures, and one gate state serves run and recheck', () => {
        // D65 1239 R2/R11: the -gate-paths.txt snapshot and the fingerprint compare that
        // reported "drifted paths" are gone. The freeze is enforced by identity instead: the
        // ONE gate state delegates to `spur task gate`, which captures the git tree itself,
        // keys `<wbs>-check-receipt.json` by it, and reuses or invalidates on that hash.
        expect(parsed.states.filter((s) => s.id === 'gate' || s.id === 'test' || s.id === 'test-recheck')).toHaveLength(
            1,
        );
        const gate = stateOf('gate');
        const onEnter = gate.onEnter ?? [];
        expect(onEnter.findIndex((a) => a.kind === 'command.gate')).toBeGreaterThanOrEqual(0);
        const gateVerb = JSON.stringify(onEnter.find((a) => a.kind === 'command.gate')?.options?.args ?? []);
        expect(gateVerb).toContain('"task","gate"');
        // The mode is per visit (run on the first, recheck after remediation) so the same state
        // cannot hold two capture points that disagree about the certified tree.
        const gateShells = shells('gate').map((a) => String(a.options?.command ?? ''));
        expect(gateShells.join('\n')).toContain('M=run');
        expect(gateShells.join('\n')).toContain('M=recheck');
        // The capture + reuse lives in the app core the verb calls.
        const gateCore = readFileSync(join(ROOT, 'packages/app/src/services/quality-gate.ts'), 'utf8');
        expect(gateCore).toContain('-check-receipt.json');
        expect(gateCore).toContain('inputDigest: tree.tree');
        expect(gateCore).toContain('resolveReceiptReuse');
    });

    test('R5: the untracked-file behaviour is documented beside the exclusion globs', () => {
        const fingerprintSource = readFileSync(
            join(ROOT, 'packages/app/src/workflow/proof-input-fingerprint.ts'),
            'utf8',
        );
        expect(fingerprintSource).toContain('export const DEFAULT_EXCLUDE_GLOBS');
        expect(fingerprintSource).toContain('Untracked-file behavior (task 1135 R5)');
        expect(fingerprintSource).toContain('is therefore part of the certified proof set');
    });

    test('R7: the owning docs ship with the change (skill, YAML header, fingerprint comment)', () => {
        expect(skill).toContain('Changed-path static self-check');
        expect(fingerprintSourceHasReceiptContract()).toBe(true);
        function fingerprintSourceHasReceiptContract(): boolean {
            return readFileSync(join(ROOT, 'packages/app/src/workflow/proof-input-fingerprint.ts'), 'utf8').includes(
                'DEFAULT_EXCLUDE_GLOBS',
            );
        }
    });
});

/** 1142 R3: workers iterate on the changed-path matrix, then the light tier; the full gate stays at the gate state. */
describe('worker iteration order (task 1142 R3)', () => {
    const docs = {
        skill: readFileSync(join(ROOT, 'plugins/sp/skills/code-implementation/SKILL.md'), 'utf8'),
    };

    for (const [name, doc] of Object.entries(docs)) {
        test(`${name}: the matrix precedes the light tier, and the full gate is named only for the gate state`, () => {
            const order = doc.indexOf('task 1142 R3');
            const matrix = doc.indexOf('1. ', order);
            const light = doc.indexOf('2. `spur task gate <wbs> light`', order);
            expect(order).toBeGreaterThanOrEqual(0);
            expect(doc.slice(matrix, light)).toContain('changed-path matrix');
            expect(light).toBeGreaterThan(matrix);
            expect(doc.slice(light)).toMatch(/full gate[^.]*`gate` state \(first visit and rechecks\)/);
            expect(doc.slice(light)).toContain('Neither step takes the');
        });
    }
});
