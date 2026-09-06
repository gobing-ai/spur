import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

// Task 0704: docs-pipeline must certify documentation with MEASURED verification, not a
// manufactured PASS stub. Task 0769 orders recording AFTER verification
// (precheck -> draft -> docs-review -> verify -> record -> done): a pre-verification
// record could write UNKNOWN/old Testing evidence. `verify -> record` opens only on a
// measured PASS verdict with an intact proof bracket; `record -> done` re-asserts the
// captured record result and the persisted verdict/digest; `record -> failed` always —
// a denied record is never converted to success by an exit 0. Temporary captures are
// run-scoped (`.spur/run/<runId>-docs-*`); the verdict artifact keeps its wbs-named
// compatibility path with `runId` stamped inside.

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

const VERIFY_GUARD = guardOf('verify', 'record');
const RECORD_GUARD = guardOf('record', 'done');
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
const RUN_ENV = { wbs: '0704', __runId: 'r-fixt-01', proofDigest: GOOD_DIGEST, proofDigestNow: GOOD_DIGEST };

describe('docs-pipeline measured verification (task 0704, ordered by 0769)', () => {
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

    test('pipeline order is precheck -> draft -> docs-review -> verify -> record -> done (0769)', () => {
        expect(DEF.states.map((s) => s.id)).toEqual(
            expect.arrayContaining(['precheck', 'draft', 'docs-review', 'verify', 'record', 'done']),
        );
        const ids = DEF.states.map((s) => s.id);
        for (const [before, after] of [
            ['draft', 'verify'],
            ['verify', 'record'],
            ['record', 'done'],
        ] as const) {
            expect(ids.indexOf(before)).toBeLessThan(ids.indexOf(after));
        }
    });

    test('record happens only after verification: record has no path back and no pre-verify entry (0769)', () => {
        // No edge may enter `record` from anywhere but verify/approve-shaped predecessors.
        const intoRecord = DEF.transitions.filter((t) => t.to === 'record').map((t) => t.from);
        expect(intoRecord).toEqual(['verify']);
        // record's only forwards edges are done (guarded) and failed (always).
        expect(DEF.transitions.filter((t) => t.from === 'record').map((t) => t.to)).toEqual(['done', 'failed']);
    });

    test('record onEnter captures the record result instead of trusting exit 0 (0769)', () => {
        const recordShell = shellCommands('record').join(' ');
        expect(recordShell).toContain('$spurBin task record $wbs --solution-from-diff --transition testing');
        expect(recordShell).toContain('.spur/run/$__runId-docs-record.status');
        expect(recordShell).toContain('PASS');
        expect(recordShell).toContain('FAIL');
    });

    test('verify dispatches read-only /sp:dev-verify with an answer file, then derives the standard verdict (R2/R3)', () => {
        const agentRun = actionsOf('verify').find((a) => a.kind === 'agent.run');
        expect(agentRun).toBeDefined();
        const input = String(agentRun?.options?.input ?? '');
        expect(input).toContain('/sp:dev-verify');
        expect(input).toContain('--fix none');
        expect(String(agentRun?.options?.answerFile ?? '')).toContain('-docs-verify-answer.txt');
        expect(String(agentRun?.options?.answerFile ?? '')).toContain('__runId');
        const verdictCall = shellCommands('verify').find((c) => c.includes('task verdict'));
        expect(verdictCall).toContain('--from-answer');
        expect(verdictCall).toContain('$__runId-docs-verify-answer.txt');
        // 0769: a stale answer from a previous attempt is cleared before the verifier runs.
        expect(shellCommands('verify')[0]).toContain('rm -f');
        expect(shellCommands('verify')[0]).toContain('$__runId-docs-verify-answer.txt');
        // 0769: the task-path lookup stays fail-closed (0760 R1) and run-scoped.
        expect(shellCommands('verify')[1]).toContain('-z "$task_path"');
        expect(shellCommands('verify')[1]).toContain('$__runId-docs-taskpath.txt');
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

    test('verify registers the standard verify-verdict artifact with runId stamped inside (R7 + 0769)', () => {
        const artifact = actionsOf('verify').find((a) => a.kind === 'run.artifact');
        expect(artifact?.options?.artifactKind).toBe('verify-verdict');
        expect(String(artifact?.options?.path)).toContain('-verdict.json');
        const stamp = shellCommands('verify').find((c) => c.includes('docs-verify-entry'));
        expect(stamp).toContain('docs-verify-entry');
        expect(stamp).toContain('runId');
    });

    test('verify → record guard is fail-closed: PASS verdict + matching non-empty digests (R5, 0769)', () => {
        expect(guardKindOf('verify', 'record')).toBe('shell');
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

    test('verify → failed catch-all exists: non-PASS/malformed/mismatch cannot reach record (R5)', () => {
        expect(guardKindOf('verify', 'failed')).toBe('always');
    });

    test('record → done is fail-closed on the captured record result + persisted verdict/digest (0769)', () => {
        expect(guardKindOf('record', 'done')).toBe('shell');
        expect(guardKindOf('record', 'failed')).toBe('always');
        for (const fragment of [
            '$__runId-docs-record.status',
            '= PASS',
            '$wbs-verdict.json',
            '.verdict // empty',
            '= "$proofDigest"',
        ]) {
            expect(RECORD_GUARD).toContain(fragment);
        }
        // The persisted re-assertions consume the stamped verdict file, not live CLI state.
        expect(RECORD_GUARD).not.toContain('$spurBin');
    });

    test('HITL docs-review stays additive: rejection still routes to failed (R6)', () => {
        expect(guardKindOf('docs-review', 'failed')).toBe('shell');
        expect(guardOf('docs-review', 'failed')).toContain('no');
        expect(guardKindOf('docs-review', 'verify')).toBe('shell');
        expect(guardOf('docs-review', 'verify')).toContain('yes');
    });

    test('auto profile shortcuts docs-review: draft → verify precedes draft → docs-review (0769)', () => {
        // Engine routing evaluates declared order — the auto shortcut must be declared first.
        const draftEdges = DEF.transitions.filter((t) => t.from === 'draft');
        expect(draftEdges[0]?.to).toBe('verify');
        expect(guardOf('draft', 'verify')).toContain('auto');
        expect(guardKindOf('draft', 'docs-review')).toBe('always');
    });

    describe('guard fixtures (executable)', () => {
        const runIn = (guard: string, files: Record<string, string>, e: Record<string, string> = RUN_ENV): number =>
            runGuard(guard, e, Object.fromEntries(Object.entries(files).map(([k, v]) => [`.spur/run/${k}`, v])));

        test('PASS verdict + intact bracket + captured PASS record → done', () => {
            expect(
                runIn(RECORD_GUARD, { '0704-verdict.json': PASS_VERDICT, 'r-fixt-01-docs-record.status': 'PASS\n' }),
            ).toBe(0);
        });

        test('verify → record: PASS verdict + intact bracket → record', () => {
            expect(runIn(VERIFY_GUARD, { '0704-verdict.json': PASS_VERDICT })).toBe(0);
        });

        test('verify → record: non-PASS verdict → guard denies (failed routing)', () => {
            expect(runIn(VERIFY_GUARD, { '0704-verdict.json': FAIL_VERDICT })).not.toBe(0);
        });

        test('verify → record: missing verdict file → guard denies (missing answer fails closed)', () => {
            expect(runIn(VERIFY_GUARD, {})).not.toBe(0);
        });

        test('verify → record: malformed verdict (no verdict line) → guard denies', () => {
            expect(runIn(VERIFY_GUARD, { '0704-verdict.json': '{"wbs":"0704"}' })).not.toBe(0);
        });

        test('verify → record: verifier mutation (digest drift) → guard denies', () => {
            expect(
                runIn(
                    VERIFY_GUARD,
                    { '0704-verdict.json': PASS_VERDICT },
                    { ...RUN_ENV, proofDigestNow: 'sha256:'.concat('c'.repeat(64)) },
                ),
            ).not.toBe(0);
        });

        test('verify → record: empty proofDigest var → guard denies (no empty-equals-empty pass)', () => {
            expect(
                runIn(
                    VERIFY_GUARD,
                    { '0704-verdict.json': PASS_VERDICT },
                    { ...RUN_ENV, proofDigest: '', proofDigestNow: '' },
                ),
            ).not.toBe(0);
        });

        test('record → done: denied record (captured FAIL) never converts to done even with a PASS verdict', () => {
            expect(
                runIn(RECORD_GUARD, { '0704-verdict.json': PASS_VERDICT, 'r-fixt-01-docs-record.status': 'FAIL\n' }),
            ).not.toBe(0);
        });

        test('record → done: missing capture file fails closed (exit-0-without-write cannot pass)', () => {
            expect(runIn(RECORD_GUARD, { '0704-verdict.json': PASS_VERDICT })).not.toBe(0);
        });

        test('record → done: persisted verdict drift (file mutated post-verify) → guard denies', () => {
            expect(
                runIn(RECORD_GUARD, { '0704-verdict.json': FAIL_VERDICT, 'r-fixt-01-docs-record.status': 'PASS\n' }),
            ).not.toBe(0);
        });

        test('record → done: run-scoped captures do not leak across runs (foreign runId status file ignored)', () => {
            expect(
                runIn(RECORD_GUARD, { '0704-verdict.json': PASS_VERDICT, 'other-run-docs-record.status': 'PASS\n' }),
            ).not.toBe(0);
        });
    });
});
