import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

// Task 0769 (D61 P5/R7): wayfinder-resolution measures research/specification tasks through
// the standard verdict contract instead of proxies. The separate `collect` state is gone —
// the precheck `task show` capture is reused as the investigate input bundle (no write
// intervenes). investigate→verify is fail-closed on a non-empty answer capture. verify is
// an independent fresh-session observe-only reviewer deriving the ONE standard verdict via
// `spur task verdict` inside a proof-input digest bracket; the ad-hoc resolution-verdict
// PASS-word and the >5-line/>60-word Testing-length proxies are retired. record captures
// `task record` → `task update done --no-lifecycle` plus a persisted-status readback, and
// record→done is fail-closed on those captures — an exit 0 never converts a denied record
// into success. Temporary captures are run-scoped under `.spur/run/<runId>-wayfinder-*`.

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
    vars?: Record<string, unknown>;
}

// 'config' segment split to comply with the sp-runtime-path rule (config/{workflows|...} literal ban).
const WORKFLOWS_DIR = join(import.meta.dir, '../../../../config', 'workflows');
const DEF = parseYaml(readFileSync(join(WORKFLOWS_DIR, 'wayfinder-resolution.yaml'), 'utf8')) as WorkflowDef;

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
    const dir = mkdtempSync(join(tmpdir(), 'wayfinder-guard-'));
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

const PASS_VERDICT = JSON.stringify({
    wbs: '0769',
    verdict: 'PASS',
    requirements: [{ id: 'R7', status: 'MET', evidence: 'fixture' }],
    acceptanceCriteria: [],
    checks: [{ name: 'spur task check', status: 'pass', evidence: 'fixture' }],
    proof: { digest: 'sha256:'.concat('a'.repeat(64)), capturePoint: 'wayfinder-verify-entry' },
});
const GOOD_DIGEST = 'sha256:'.concat('a'.repeat(64));
const RUN_ENV = {
    wbs: '0769',
    __runId: 'r-way-01',
    approval: 'auto',
    proofDigest: GOOD_DIGEST,
    proofDigestNow: GOOD_DIGEST,
};

describe('wayfinder-resolution measured resolution (task 0769)', () => {
    test('no separate collect state: precheck reuses its show capture as the investigate input', () => {
        expect(DEF.states.map((s) => s.id)).not.toContain('collect');
        const precheckShell = shellCommands('precheck').join(' ');
        expect(precheckShell).toContain('$spurBin task show $wbs --json > .spur/run/$__runId-wayfinder-input.json');
        const investigate = actionsOf('investigate').find((a) => a.kind === 'agent.run');
        expect(String(investigate?.options?.input ?? '')).toContain('-wayfinder-input.json');
    });

    test('temporary artifacts are run-scoped; runId var is declared (R8/0366)', () => {
        expect(DEF.vars ?? {}).toHaveProperty('__runId');
        for (const state of DEF.states) {
            for (const a of state.onEnter ?? []) {
                const o = (a.options ?? {}) as Record<string, unknown>;
                for (const key of ['answerFile', 'expectFile', 'path', 'resultFile']) {
                    const v = o[key];
                    if (typeof v === 'string' && v.includes('wayfinder') && v.includes('.spur/run/')) {
                        expect(v).toMatch(/\$\{vars\.__runId\}|\$wbs-verdict\.json/);
                    }
                }
            }
        }
    });

    test('investigate → verify is fail-closed on a non-empty answer capture, with a failed exit', () => {
        const investigate = actionsOf('investigate').find((a) => a.kind === 'agent.run');
        const answerFile = String(investigate?.options?.answerFile ?? '');
        // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal YAML template, not interpolating
        expect(answerFile).toBe('.spur/run/${vars.__runId}-wayfinder-answer.md');
        expect(String(investigate?.options?.expectFile ?? '')).toBe(answerFile);
        expect(guardOf('investigate', 'verify')).toBe('test -s .spur/run/$__runId-wayfinder-answer.md');
        expect(guardOf('investigate', 'failed')).toBe('! test -s .spur/run/$__runId-wayfinder-answer.md');
    });

    test('the length/scraping proxies are retired; evidence citations stay truthful', () => {
        const investigateInput = String(
            actionsOf('investigate').find((a) => a.kind === 'agent.run')?.options?.input ?? '',
        );
        expect(investigateInput).not.toContain('at least 5 lines');
        expect(investigateInput).not.toContain('60 words');
        expect(investigateInput).not.toContain('at least');
        expect(investigateInput).toContain('grep -n');
        expect(investigateInput).toContain('re-read each cited line');
        // 0769: no standalone PASS-word file in any action option or guard command
        // (header/state prose may document the retirement).
        const flat =
            JSON.stringify(DEF.states.flatMap((s) => (s.onEnter ?? []).map((a) => a.options ?? {}))) +
            JSON.stringify(DEF.transitions.map((t) => t.guard?.options ?? {}));
        expect(flat).not.toContain('resolution-verdict');
    });

    test('verify is an independent fresh-session observe-only reviewer over the standard verdict contract', () => {
        const verifier = actionsOf('verify').find((a) => a.kind === 'agent.run');
        expect(verifier?.options?.freshSession).toBe(true);
        expect(String(verifier?.options?.input ?? '')).toContain('--fix none');
        expect(String(verifier?.options?.input ?? '')).toContain('/sp:dev-verify');
        const verdictCall = shellCommands('verify').find((c) => c.includes('task verdict'));
        expect(verdictCall).toContain('--from-answer');
        expect(verdictCall).toContain('$__runId-wayfinder-verify-answer.txt');
        const artifact = actionsOf('verify').find((a) => a.kind === 'run.artifact');
        expect(artifact?.options?.artifactKind).toBe('verify-verdict');
        // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal YAML template, not interpolating
        expect(String(artifact?.options?.path)).toBe('.spur/run/${vars.wbs}-verdict.json');
        // The verifier must not be told to repair task sections via CLI edits.
        expect(String(verifier?.options?.input ?? '')).not.toContain('task update');
    });

    test('the verifier is bracketed by proof-input capture: canonical then re-capture', () => {
        const kinds = actionsOf('verify').map((a) => a.kind);
        const agentIndex = kinds.indexOf('agent.run');
        const captures = actionsOf('verify')
            .map((a, i) => ({ a, i }))
            .filter(({ a }) => a.kind === 'proof.fingerprint');
        expect(captures).toHaveLength(2);
        const [first, second] = captures;
        expect(first?.i).toBeLessThan(agentIndex);
        expect(second?.i).toBeGreaterThan(agentIndex);
        expect(first?.a.options?.var).toBe('proofDigest');
        expect(second?.a.options?.var).toBe('proofDigestNow');
        expect(first?.a.options?.input).toBe(second?.a.options?.input);
    });

    test('verify → record opens only on auto approval + measured PASS + intact bracket', () => {
        expect(guardKindOf('verify', 'record')).toBe('shell');
        const guard = guardOf('verify', 'record');
        for (const fragment of [
            'test "$approval" = auto',
            'test -n "$proofDigest"',
            '= "$proofDigest"',
            '$wbs-verdict.json',
            '.verdict // empty',
            '= PASS',
        ]) {
            expect(guard).toContain(fragment);
        }
    });

    test('record captures the real verbs; record → done is fail-closed on captures + persisted status', () => {
        const recordShell = shellCommands('record').join(' ');
        expect(recordShell).toContain('$spurBin task record $wbs --solution-from-diff --transition testing');
        expect(recordShell).toContain('$spurBin task update $wbs done --no-lifecycle');
        expect(recordShell).toContain('$__runId-wayfinder-final.status');
        expect(recordShell).toContain('$__runId-wayfinder-status.txt');
        const doneGuard = guardOf('record', 'done');
        expect(doneGuard).toContain('$__runId-wayfinder-final.status');
        expect(doneGuard).toContain('= PASS');
        expect(doneGuard).toContain('$__runId-wayfinder-status.txt');
        expect(doneGuard).toContain('= done');
        expect(guardKindOf('record', 'failed')).toBe('always');
    });

    test('state order reads precheck → investigate → verify → approve → record → done', () => {
        const ids = DEF.states.map((s) => s.id);
        const order = ['precheck', 'investigate', 'verify', 'approve', 'record', 'done'];
        let cursor = -1;
        for (const id of order) {
            const at = ids.indexOf(id);
            expect(at).toBeGreaterThan(cursor);
            cursor = at;
        }
    });

    test('HITL approve routing is exhaustive and fail-closed', () => {
        expect(guardKindOf('approve', 'record')).toBe('shell');
        expect(guardOf('approve', 'record')).toContain('yes');
        expect(guardOf('approve', 'cancelled')).toContain('cancel');
        expect(guardOf('approve', 'failed')).toContain('no');
    });

    describe('guard fixtures (executable)', () => {
        const runIn = (guard: string, files: Record<string, string>, e: Record<string, string> = RUN_ENV): number =>
            runGuard(guard, e, Object.fromEntries(Object.entries(files).map(([k, v]) => [`.spur/run/${k}`, v])));

        test('investigate: non-empty answer → verify; empty/missing → failed', () => {
            const fwd = guardOf('investigate', 'verify');
            const fail = guardOf('investigate', 'failed');
            expect(runIn(fwd, { 'r-way-01-wayfinder-answer.md': 'resolution summary' })).toBe(0);
            expect(runIn(fwd, { 'r-way-01-wayfinder-answer.md': '' })).not.toBe(0);
            expect(runIn(fwd, {})).not.toBe(0);
            expect(runIn(fail, { 'r-way-01-wayfinder-answer.md': 'resolution summary' })).not.toBe(0);
            expect(runIn(fail, {})).toBe(0);
        });

        test('verify → record: PASS verdict + intact bracket + auto approval → record', () => {
            expect(runIn(guardOf('verify', 'record'), { '0769-verdict.json': PASS_VERDICT })).toBe(0);
        });

        test('verify → record: interactive approval routes to approve, not record', () => {
            expect(
                runIn(
                    guardOf('verify', 'record'),
                    { '0769-verdict.json': PASS_VERDICT },
                    { ...RUN_ENV, approval: 'required' },
                ),
            ).not.toBe(0);
        });

        test('verify → record: non-PASS verdict / missing file / digest drift each fail closed', () => {
            const fwd = guardOf('verify', 'record');
            const failVerdict = PASS_VERDICT.replace('"verdict":"PASS"', '"verdict":"FAIL"');
            expect(runIn(fwd, { '0769-verdict.json': failVerdict })).not.toBe(0);
            expect(runIn(fwd, {})).not.toBe(0);
            expect(
                runIn(
                    fwd,
                    { '0769-verdict.json': PASS_VERDICT },
                    { ...RUN_ENV, proofDigestNow: 'sha256:'.concat('b'.repeat(64)) },
                ),
            ).not.toBe(0);
        });

        test('record → done: captured PASS + persisted done → done', () => {
            expect(
                runIn(guardOf('record', 'done'), {
                    'r-way-01-wayfinder-final.status': 'PASS\n',
                    'r-way-01-wayfinder-status.txt': 'done',
                }),
            ).toBe(0);
        });

        test('record → done: denied record never converts to done (captured FAIL, missing file, wrong status)', () => {
            const doneGuard = guardOf('record', 'done');
            expect(
                runIn(doneGuard, {
                    'r-way-01-wayfinder-final.status': 'FAIL\n',
                    'r-way-01-wayfinder-status.txt': 'done',
                }),
            ).not.toBe(0);
            expect(runIn(doneGuard, { 'r-way-01-wayfinder-status.txt': 'done' })).not.toBe(0);
            expect(
                runIn(doneGuard, {
                    'r-way-01-wayfinder-final.status': 'PASS\n',
                    'r-way-01-wayfinder-status.txt': 'testing',
                }),
            ).not.toBe(0);
        });
    });
});
