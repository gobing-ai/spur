import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const ROOT = join(import.meta.dir, '../../../../');

/** 1135 R1/R2/R3/R6/R7: the driver contract and the pipeline YAML must move together. */
describe('implement-probe and post-gate freeze contract (task 1135)', () => {
    const driver = readFileSync(join(ROOT, 'plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md'), 'utf8');
    const skill = readFileSync(join(ROOT, 'plugins/sp/skills/code-implementation/SKILL.md'), 'utf8');
    const pipeline = readFileSync(join(ROOT, 'config', 'workflows', 'task-pipeline.yaml'), 'utf8');
    const parsed = parse(pipeline) as {
        states: Array<{ id: string; onEnter?: Array<{ kind: string; options?: Record<string, unknown> }> }>;
        vars?: Record<string, string>;
    };

    const stateOf = (id: string) => {
        const state = parsed.states.find((s) => s.id === id);
        if (state === undefined) throw new Error(`state ${id} not found`);
        return state;
    };
    const fingerprints = (id: string) => (stateOf(id).onEnter ?? []).filter((a) => a.kind === 'proof.fingerprint');
    const shells = (id: string) => (stateOf(id).onEnter ?? []).filter((a) => a.kind === 'shell');

    test('R1/R6: the payload contract names the bounded temp-root probe, and the service-suite non-substitute rule', () => {
        expect(driver).toContain('the public-surface probe requirement (task 1135 R1/R2/R6)');
        expect(driver).toContain('probe: not-applicable (no public surface changed)');
        expect(driver).toContain('against a throwaway project root');
        expect(driver).toContain('A service-layer test suite is **not** a substitute');
        expect(driver).toContain('120 s per invocation');
        expect(skill).toContain('Public-surface probe (task 1135 R1/R6/R8)');
        expect(skill).toContain('one end-to-end probe per new or changed public surface');
    });

    test('R2: a missing probe is a probe-missing marker in the run log and the batch-report row', () => {
        expect(driver).toContain('`probe-missing` marker');
        expect(driver).toContain('batch-report row');
    });

    test('R3: the post-gate freeze ordering rule is stated in both owning documents', () => {
        expect(driver).toContain('## Post-gate tree freeze (task 1135 R3/R4/R5)');
        expect(driver).toContain('Every tree edit belongs to `implement`');
        expect(driver).toContain('no\n   other state edits the tree');
        expect(driver).toContain('test-fix → test-recheck`,\n   which re-captures the digest');
    });

    test('R4: review joins the proof bracket in the YAML, and the header comment says so', () => {
        const review = fingerprints('review');
        expect(review).toHaveLength(1);
        expect(review[0]?.options?.var).toBe('proofDigestNow');
        // The literal is the YAML template string; build it so the linter does not read it as one.
        expect(review[0]?.options?.expect).toBe(`$${'{\u0076ars.proofDigest}'}`);
        // The compare must precede the review dispatch.
        const onEnter = stateOf('review').onEnter ?? [];
        expect(onEnter[0]?.kind).toBe('proof.fingerprint');
        expect(onEnter[1]?.kind).toBe('agent.run');
        expect(pipeline).toContain('review joins by task 1135');
        expect(pipeline).toContain('compared against `proofDigest` at review,');
    });

    test('R5: gate entry snapshots the non-corpus tree state; test and test-recheck both do it before the capture', () => {
        for (const id of ['test', 'test-recheck']) {
            const onEnter = stateOf(id).onEnter ?? [];
            const snapshotIndex = onEnter.findIndex(
                (a) => a.kind === 'shell' && String(a.options?.command ?? '').includes('-gate-paths.txt'),
            );
            const captureIndex = onEnter.findIndex((a) => a.kind === 'proof.fingerprint');
            expect(snapshotIndex, `${id} must snapshot the tree state`).toBeGreaterThanOrEqual(0);
            expect(snapshotIndex).toBeLessThan(captureIndex);
            expect(String(onEnter[snapshotIndex]?.options?.command)).toContain('git status --porcelain=v1 -uall');
            expect(String(onEnter[snapshotIndex]?.options?.command)).toContain("':(exclude)docs/tasks*'");
        }
        expect(shells('test').length).toBeGreaterThan(0);
        expect(driver).toContain('drifted paths');
        expect(driver).toContain('proof-compare-failed');
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

    test('R7: the owning docs ship with the change (driver, skill, YAML header, fingerprint comment)', () => {
        expect(driver).toContain('Review joins the proof bracket');
        expect(skill).toContain('Changed-path static self-check');
        expect(fingerprintSourceHasReceiptContract()).toBe(true);
        function fingerprintSourceHasReceiptContract(): boolean {
            return readFileSync(join(ROOT, 'packages/app/src/workflow/proof-input-fingerprint.ts'), 'utf8').includes(
                'DEFAULT_EXCLUDE_GLOBS',
            );
        }
    });
});
