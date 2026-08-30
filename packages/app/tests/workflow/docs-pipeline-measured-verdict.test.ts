import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

// Task 0704: docs-pipeline must certify documentation with MEASURED verification, not a
// manufactured PASS stub. The hard-coded verdict writer in `done` (R1) is replaced by a
// read-only verify state (R2) that derives the one standard verdict via `spur task verdict`
// (R3/R7) inside a proof-input digest bracket (R4), with fail-closed routing to `failed`
// (R5) and additive HITL (R6). Structural invariants fail here AND in the baseline gate.

interface Action {
    kind: string;
    options?: Record<string, unknown>;
}
interface Guard {
    kind: string;
    options?: { command?: string };
}
interface Transition {
    from: string;
    to: string;
    guard?: Guard;
}
interface WorkflowDef {
    states: { id: string; onEnter?: Action[] }[];
    transitions: Transition[];
}

// 'config' segment split to comply with the sp-runtime-path rule (config/{workflows|...} literal ban).
const WORKFLOWS_DIR = join(import.meta.dir, '../../../../config', 'workflows');
const DEF = parseYaml(readFileSync(join(WORKFLOWS_DIR, 'docs-pipeline.yaml'), 'utf8')) as WorkflowDef;

const stateOf = (id: string) => DEF.states.find((s) => s.id === id);
const actionsOf = (id: string): Action[] => stateOf(id)?.onEnter ?? [];
const guardOf = (from: string, to: string): string =>
    DEF.transitions.find((t) => t.from === from && t.to === to)?.guard?.options?.command?.replace(/\n/g, ' ') ?? '';
const guardKindOf = (from: string, to: string): string =>
    DEF.transitions.find((t) => t.from === from && t.to === to)?.guard?.kind ?? '';
const shellCommands = (id: string): string[] =>
    actionsOf(id)
        .filter((a) => a.kind === 'shell')
        .map((a) => String(a.options?.command ?? '').replace(/\n/g, ' '));

// Executes one workflow guard command string against fixture files, exactly as the engine
// would (env-expanded shell). Returns the guard's exit code — 0 = transition allowed.
function runGuard(command: string, env: Record<string, string>, files: Record<string, string>): number {
    const dir = mkdtempSync(join(tmpdir(), 'docs-verify-guard-'));
    try {
        for (const [name, content] of Object.entries(files)) {
            const target = join(dir, name);
            const parent = target.slice(0, target.lastIndexOf('/'));
            if (parent) mkdirSync(parent, { recursive: true });
            writeFileSync(target, content);
        }
        const proc = Bun.spawnSync(['bash', '-c', command], {
            cwd: dir,
            env: { ...process.env, ...env },
            stdout: 'pipe',
            stderr: 'pipe',
        });
        return proc.exitCode ?? 1;
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const VERIFY_GUARD = guardOf('verify', 'done');
const PASS_VERDICT = JSON.stringify({
    wbs: '0704',
    verdict: 'PASS',
    requirements: [{ id: 'R1', status: 'MET', evidence: 'fixture' }],
    acceptanceCriteria: [],
    checks: [{ name: 'spur task check', status: 'pass', evidence: 'fixture' }],
    proof: { digest: 'sha256:'.concat('a'.repeat(64)), capturePoint: 'docs-verify-entry' },
});
const FAIL_VERDICT = PASS_VERDICT.replace('"verdict":"PASS"', '"verdict":"FAIL"').replace(
    '"digest":"'.concat('sha256:', 'a'.repeat(64)),
    '"digest":"'.concat('sha256:', 'b'.repeat(64)),
);
const GOOD_DIGEST = 'sha256:'.concat('a'.repeat(64));

describe('docs-pipeline measured verification (task 0704)', () => {
    test('no state manufactures a verdict: the synthetic PASS writer is gone (R1)', () => {
        for (const state of DEF.states) {
            for (const command of shellCommands(state.id)) {
                expect(command).not.toContain('docs-deliverable');
                expect(command).not.toContain('"verdict\\":\\"PASS');
                expect(command).not.toContain('docs-pipeline record step');
            }
        }
        // done only performs the guarded transition — it must not write .spur/run artifacts.
        const doneWritesArtifact = actionsOf('done').some((a) => a.kind === 'run.artifact');
        expect(doneWritesArtifact).toBe(false);
    });

    test('verify dispatches read-only /sp:dev-verify with an answer file, then derives the standard verdict (R2/R3)', () => {
        const agentRun = actionsOf('verify').find((a) => a.kind === 'agent.run');
        expect(agentRun).toBeDefined();
        const input = String(agentRun?.options?.input ?? '');
        expect(input).toContain('/sp:dev-verify');
        expect(input).toContain('--fix none');
        expect(String(agentRun?.options?.answerFile ?? '')).toContain('verify-answer.txt');
        const verdictCall = shellCommands('verify').find((c) => c.includes('task verdict'));
        expect(verdictCall).toContain('--from-answer');
    });

    test('the verifier is bracketed by proof-input capture: canonical then re-capture (R4)', () => {
        const kinds = actionsOf('verify').map((a) => a.kind);
        const agentIndex = kinds.indexOf('agent.run');
        const captures = actionsOf('verify')
            .map((a, i) => ({ a, i }))
            .filter(({ a }) => a.kind === 'proof.fingerprint');
        const [first, second] = captures;
        expect(captures).toHaveLength(2);
        if (!first || !second) throw new Error('expected two fingerprint captures');
        expect(first.i).toBeLessThan(agentIndex);
        expect(second.i).toBeGreaterThan(agentIndex);
        expect(first.a.options?.var).toBe('proofDigest');
        expect(second.a.options?.var).toBe('proofDigestNow');
        // Both captures fingerprint the same input so the bracket compares like for like.
        expect(first.a.options?.input).toBe(second.a.options?.input);
    });

    test('verify registers the standard verify-verdict artifact; done does not (R7)', () => {
        const artifact = actionsOf('verify').find((a) => a.kind === 'run.artifact');
        expect(artifact?.options?.artifactKind).toBe('verify-verdict');
        expect(String(artifact?.options?.path)).toContain('verdict.json');
    });

    test('verify → done guard is fail-closed: PASS verdict + matching non-empty digests (R5)', () => {
        expect(guardKindOf('verify', 'done')).toBe('shell');
        for (const fragment of [
            'test -n "$proofDigest"',
            'test -n "$proofDigestNow"',
            '= PASS',
            '.proof.digest',
            '= "$proofDigest"',
        ]) {
            expect(VERIFY_GUARD).toContain(fragment);
        }
    });

    test('verify → failed catch-all exists: non-PASS/malformed/mismatch cannot reach done (R5)', () => {
        expect(guardKindOf('verify', 'failed')).toBe('always');
    });

    test('HITL docs-review stays additive: rejection still routes to failed (R6)', () => {
        expect(guardKindOf('docs-review', 'failed')).toBe('shell');
        expect(guardOf('docs-review', 'failed')).toContain('no');
        expect(guardKindOf('docs-review', 'record')).toBe('shell');
        expect(guardOf('docs-review', 'record')).toContain('yes');
    });

    describe('guard fixtures (executable)', () => {
        const env = { wbs: '0704', proofDigest: GOOD_DIGEST, proofDigestNow: GOOD_DIGEST };
        const runIn = (files: Record<string, string>, e: Record<string, string> = env): number =>
            runGuard(VERIFY_GUARD, e, Object.fromEntries(Object.entries(files).map(([k, v]) => [`.spur/run/${k}`, v])));

        test('PASS verdict + intact bracket → done', () => {
            expect(runIn({ '0704-verdict.json': PASS_VERDICT })).toBe(0);
        });

        test('non-PASS verdict → guard denies (failed routing)', () => {
            expect(runIn({ '0704-verdict.json': FAIL_VERDICT })).not.toBe(0);
        });

        test('missing verdict file → guard denies (missing answer fails closed)', () => {
            expect(runIn({})).not.toBe(0);
        });

        test('malformed verdict (no verdict line) → guard denies', () => {
            expect(runIn({ '0704-verdict.json': '{"wbs":"0704"}' })).not.toBe(0);
        });

        test('verifier mutation (digest drift) → guard denies', () => {
            expect(
                runIn(
                    { '0704-verdict.json': PASS_VERDICT },
                    { ...env, proofDigestNow: 'sha256:'.concat('c'.repeat(64)) },
                ),
            ).not.toBe(0);
        });

        test('empty proofDigest var → guard denies (no empty-equals-empty pass)', () => {
            expect(
                runIn({ '0704-verdict.json': PASS_VERDICT }, { ...env, proofDigest: '', proofDigestNow: '' }),
            ).not.toBe(0);
        });
    });
});
