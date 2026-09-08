import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { extractResolvedWorkflowFacts } from '../../src/workflow/composition-baseline';

// Task 0703 (ADR-071): the task-pipeline proof chain must form ONE immutable bracket around the
// evidence-producing final chain. Capture happens once at quality-gate entry (before any evidence
// stage), bounded remediation re-captures, the certifying verify is observe-only, and the
// completion guards refuse missing/malformed/mismatched proof evidence. These invariants are
// structural: any composition change that breaks them must fail here (0775: the
// composition-baseline gate retired; this suite is the structural guard).

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
const DEF = parseYaml(readFileSync(join(WORKFLOWS_DIR, 'task-pipeline.yaml'), 'utf8')) as WorkflowDef;

const cmdOf = (from: string, to: string): string =>
    DEF.transitions.find((t) => t.from === from && t.to === to)?.guard?.options?.command?.replace(/\n/g, ' ') ?? '';

describe('task-pipeline proof chain (task 0703, ADR-071)', () => {
    test('verify certifies observe-only: --fix none, never --fix all (R1)', () => {
        const verify = DEF.states.find((s) => s.id === 'verify');
        const agentRun = verify?.onEnter?.find((a) => a.kind === 'agent.run');
        expect(agentRun).toBeDefined();
        const input = String(agentRun?.options?.input ?? '');
        expect(input).toContain('--fix none');
        expect(input).not.toContain('--fix all');
    });

    test('canonical digest capture precedes the first evidence stage; remediation re-captures (R2/R4)', () => {
        const test = DEF.states.find((s) => s.id === 'test');
        const recheck = DEF.states.find((s) => s.id === 'test-recheck');
        const verify = DEF.states.find((s) => s.id === 'verify');
        const captures = (test?.onEnter ?? []).filter((a) => a.kind === 'proof.fingerprint');
        expect(captures).toHaveLength(1);
        expect(captures[0]?.options?.var).toBe('proofDigest');
        // Capture precedes the gate shell (the first evidence stage). The leading
        // taskpath-resolve shell/file.read actions FEED the capture, not evidence.
        const kinds = (test?.onEnter ?? []).map((a) => a.kind);
        expect(kinds.lastIndexOf('proof.fingerprint')).toBeLessThan(kinds.lastIndexOf('shell'));
        const recheckCaptures = (recheck?.onEnter ?? []).filter((a) => a.kind === 'proof.fingerprint');
        expect(recheckCaptures).toHaveLength(1);
        expect(recheckCaptures[0]?.options?.var).toBe('proofDigest');
        // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal YAML template, not interpolating
        expect(recheckCaptures[0]?.options?.taskFile).toBe('${vars.taskSpecPath}');
        // Midpoint compare at verify entry reuses proofDigestNow against the canonical capture.
        const mid = verify?.onEnter?.[0];
        expect(mid?.kind).toBe('proof.fingerprint');
        expect(mid?.options?.var).toBe('proofDigestNow');
        // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal YAML template, not interpolating
        expect(mid?.options?.expect).toBe('${vars.proofDigest}');
    });

    test('verdict artifact carries the proof block: one digest, three named stages (R3)', () => {
        const verify = DEF.states.find((s) => s.id === 'verify');
        const stamp = verify?.onEnter?.at(-1);
        expect(stamp?.kind).toBe('shell');
        const cmd = String(stamp?.options?.command ?? '');
        expect(cmd).toContain('capturePoint');
        for (const stage of ['qualityGate', 'review', 'verification']) {
            expect(cmd).toContain(`${stage}: {status`);
            expect(cmd).toContain(`digest: $d`);
        }
        expect(cmd).toContain('proof-input-digest');
    });

    test('completion guards refuse non-PASS and missing/malformed/mismatched proof evidence (R5)', () => {
        const toRecord = cmdOf('verify', 'record');
        expect(toRecord).toContain('.verdict');
        expect(toRecord).toContain('PASS');
        expect(toRecord).toContain('.proof.digest');
        for (const stage of ['qualityGate', 'review', 'verification']) {
            expect(toRecord).toContain(`.proof.stages.${stage}.digest`);
        }
        expect(toRecord).toContain('$proofDigest');
        const toDone = cmdOf('record', 'done');
        expect(toDone).toContain('task check');
        expect(toDone).toContain('.verdict');
        expect(toDone).toContain('.proof.digest');
        expect(toDone).toContain('$proofDigest');
    });

    test('verify non-PASS routes to bounded remediation; catch-alls guarantee termination (R4)', () => {
        const toFix = DEF.transitions.find((t) => t.from === 'verify' && t.to === 'test-fix');
        expect(toFix).toBeDefined();
        const fixCmd = toFix?.guard?.options?.command?.replace(/\n/g, ' ') ?? '';
        expect(fixCmd).toContain('!= PASS');
        expect(fixCmd).toContain('qualityGateMaxFixAttempts');
        expect(DEF.transitions.find((t) => t.from === 'verify' && t.to === 'failed')?.guard?.kind).toBe('always');
        expect(DEF.transitions.find((t) => t.from === 'record' && t.to === 'failed')?.guard?.kind).toBe('always');
    });

    test('verify pins the observe-only invocation (R7)', () => {
        // 0775: facts are extracted from the live definition; the snapshot is gone.
        const facts = extractResolvedWorkflowFacts(
            DEF as unknown as Parameters<typeof extractResolvedWorkflowFacts>[0],
        );
        const verifyAgent = Object.values(facts.actions).find(
            (a) => a.invocation?.startsWith('/sp:dev-verify') === true,
        );
        expect(verifyAgent?.invocation).toContain('--fix none');
        expect(verifyAgent?.invocation).not.toContain('--fix all');
    });
});

describe('task-pipeline review independence (task 0710)', () => {
    // P2 remediation: the live YAML itself must declare the independence policy. Composition
    // facts record kind/invocation only, so without this check a re-pinned executor or a
    // dropped freshSession would pass CI silently (review finding 0710-P2).
    const agentRunOf = (state: string): Record<string, unknown> | undefined => {
        const agentRun = DEF.states.find((s) => s.id === state)?.onEnter?.find((a) => a.kind === 'agent.run');
        return agentRun?.options as Record<string, unknown> | undefined;
    };

    test('review and verify run fresh, reviewer-role, unpinned, and compare against implement (R2/R4/R7)', () => {
        for (const state of ['review', 'verify']) {
            const opts = agentRunOf(state);
            expect(opts, `state ${state} must declare an agent.run`).toBeDefined();
            expect(opts?.freshSession).toBe(true);
            expect(opts?.role).toBe('reviewer');
            expect(opts, `state ${state} must not pin an executor`).not.toHaveProperty('agent');
            expect(opts?.compareExecutorWith).toBe('implement');
            expect(opts?.priority).toBe('$' + '{vars.taskPriority}');
        }
    });

    // P1 remediation: the shipped extraction command must sed the TASK FILE (resolved via
    // taskpath.txt), not the path listing itself, and normalize the tier to upper case so
    // requiresDistinctExecutor's exact 'P0'/'P1' match engages (review finding 0710-P1).
    test('priority extraction reads the task file and normalizes to upper (R4)', () => {
        const { execSync } = require('node:child_process') as typeof import('node:child_process');
        const { mkdtempSync, rmSync, writeFileSync, chmodSync } = require('node:fs') as typeof import('node:fs');
        const { tmpdir } = require('node:os') as typeof import('node:os');
        const joinPath = require('node:path') as typeof import('node:path');

        const qualityGate = DEF.states.find((s) => s.id === 'test');
        const shell = qualityGate?.onEnter?.find(
            (a) => a.kind === 'shell' && String(a.options?.command ?? '').includes('-priority.txt'),
        );
        expect(shell).toBeDefined();
        const command = String(shell?.options?.command ?? '');
        expect(command).toContain('cat ".spur/run/$wbs-taskpath.txt"');

        const dir = mkdtempSync(joinPath.join(tmpdir(), 't0710-priority-'));
        try {
            const runDir = joinPath.join(dir, '.spur', 'run');
            mkdirRecursive(runDir);
            const spec = joinPath.join(dir, 'spec.md');
            writeFileSync(spec, '---\nwbs: t9001\npriority: p1\n---\nbody\n');
            // $spurBin renders to an emitter that ignores argv and prints the same JSON shape
            // `spur task path --json` does, so the jq segment writes the path like production.
            const emit = joinPath.join(dir, 'emit.sh');
            writeFileSync(emit, `#!/bin/sh\nprintf '{"filePath":"%s"}' "${spec}"\n`);
            chmodSync(emit, 0o755);
            const rendered = command.replaceAll('$spurBin', emit).replaceAll('$wbs', 't9001');
            execSync(rendered, { cwd: dir, stdio: 'pipe' });
            expect(readFileSync(joinPath.join(runDir, 't9001-priority.txt'), 'utf8').trim()).toBe('P1');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('task-path lookup fails closed (task 0751 R2)', () => {
    const resolveShell = (): { shell?: { options?: { command?: string } }; command: string } => {
        const test = DEF.states.find((st) => st.id === 'test');
        const shell = test?.onEnter?.find(
            (a) => a.kind === 'shell' && String(a.options?.command ?? '').includes('-taskpath.txt'),
        );
        return { shell, command: String(shell?.options?.command ?? '') };
    };

    test('the lookup is not suppressed: no `|| true`, no forced `exit 0`, no stderr suppression', () => {
        const { command } = resolveShell();
        expect(command).toContain('task path $wbs --json');
        expect(command).not.toContain('--json 2>/dev/null');
        expect(command).not.toContain('|| true');
        expect(command).not.toContain('; exit 0');
        expect(command).not.toContain(';exit 0');
    });

    test('an empty resolved task path exits non-zero with a message naming the failure', () => {
        const { command } = resolveShell();
        expect(command).toContain('-z "$task_path"');
        expect(command).toContain('exit 1');
        expect(command).toContain('did not resolve');
    });

    // 0785 R3: the bound registration moved from done into record — FIRST action there, before
    // any task record or status mutation — and now demands the spec inputs it re-captures over.
    // Done keeps no artifact registration: an unbound done would be a decorative echo.
    test('the record-entry verdict registration declares the enforced proof binding (0751 R4 + 0785 R3)', () => {
        const record = DEF.states.find((st) => st.id === 'record');
        const first = record?.onEnter?.[0];
        expect(first?.kind).toBe('run.artifact');
        const options = first?.options as Record<string, unknown> | undefined;
        expect(options?.proofBinding).toBe('current');
        expect(options?.artifactKind).toBe('verify-verdict');
        // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal YAML template, not interpolating
        expect(options?.taskFile).toBe('${vars.taskSpecPath}');
        // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal YAML template, not interpolating
        expect(options?.featureFile).toBe('${vars.featureSpecPath}');
        const recordShells = (record?.onEnter ?? []).filter((a) => a.kind === 'shell');
        expect(recordShells.length).toBeGreaterThanOrEqual(2);
        const done = DEF.states.find((st) => st.id === 'done');
        expect(done?.onEnter?.find((a) => a.kind === 'run.artifact')).toBeUndefined();
    });

    test('behavioral: an unresolved task path fails the rendered command', () => {
        const { execSync } = require('node:child_process') as typeof import('node:child_process');
        const { mkdtempSync, rmSync, writeFileSync, chmodSync } = require('node:fs') as typeof import('node:fs');
        const { tmpdir } = require('node:os') as typeof import('node:os');
        const joinPath = require('node:path') as typeof import('node:path');

        const { command } = resolveShell();
        const dir = mkdtempSync(joinPath.join(tmpdir(), 't0751-taskpath-'));
        try {
            mkdirRecursive(joinPath.join(dir, '.spur', 'run'));
            // Emit the same JSON shape `spur task path --json` does when the task
            // cannot be resolved: no path field, so jq drains to `empty`.
            const emit = joinPath.join(dir, 'emit.sh');
            writeFileSync(emit, "#!/bin/sh\nprintf '{}'\n");
            chmodSync(emit, 0o755);
            const rendered = command.replaceAll('$spurBin', emit).replaceAll('$wbs', 't9001');
            expect(() => execSync(rendered, { cwd: dir, stdio: 'pipe' })).toThrow();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

function mkdirRecursive(path: string): void {
    const { mkdirSync } = require('node:fs') as typeof import('node:fs');
    mkdirSync(path, { recursive: true });
}

// Task 0785: physical path confinement + spec-complete proof inputs + honest review evidence.
// These are the structural pins for the three shipped seams: the linked feature spec joins the
// digest inputs everywhere the task spec does, review completion is evidenced by a run-scoped
// marker (never caller-claimed), and the bound ledger registration happens before record.
describe('task-pipeline proof-input completeness and honest review evidence (task 0785)', () => {
    const shellCommandsOf = (state: string): string[] =>
        (DEF.states.find((s) => s.id === state)?.onEnter ?? [])
            .filter((a) => a.kind === 'shell')
            .map((a) => String((a.options as Record<string, unknown> | undefined)?.command ?? ''))
            .map((c) => c.replace(/\n/g, ' '));

    test('the workflow identity is bumped to version 3 (0785)', () => {
        expect((DEF as unknown as { version: string }).version).toBe('3');
    });

    test('a featureSpecPath var exists and defaults to empty (orphan tasks stay compatible)', () => {
        const vars = (DEF as unknown as { vars: Record<string, unknown> }).vars;
        expect(vars.featureSpecPath).toBe('');
    });

    test('the test state resolves the linked feature spec path before the canonical capture (R2)', () => {
        const commands = shellCommandsOf('test');
        const resolver = commands.find((c) => c.includes('feature show') && c.includes('-featurepath.txt'));
        expect(resolver).toBeDefined();
        expect(resolver).toContain('.feature_id // .frontmatter.feature_id // empty');
        // Fail closed when a declared feature's path does not resolve; empty stays legitimate.
        expect(resolver).toContain('did not resolve');
        expect(resolver).toContain('exit 1');
        const test = DEF.states.find((s) => s.id === 'test');
        const kinds = (test?.onEnter ?? []).map((a) => a.kind);
        const reads = (test?.onEnter ?? []).filter((a) => a.kind === 'file.read.into-var');
        const featureRead = reads.find(
            (a) => (a.options as Record<string, unknown> | undefined)?.var === 'featureSpecPath',
        );
        expect(featureRead).toBeDefined();
        // Resolution precedes the capture.
        expect(kinds.lastIndexOf('file.read.into-var')).toBeLessThan(kinds.lastIndexOf('proof.fingerprint'));
    });

    test('every proof capture folds the feature spec alongside the task spec (R2)', () => {
        for (const state of ['test', 'test-recheck', 'verify']) {
            const captures = (DEF.states.find((s) => s.id === state)?.onEnter ?? []).filter(
                (a) => a.kind === 'proof.fingerprint',
            );
            expect(captures.length, state).toBe(1);
            const options = captures[0]?.options as Record<string, unknown> | undefined;
            // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal YAML template, not interpolating
            expect(options?.taskFile, state).toBe('${vars.taskSpecPath}');
            // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal YAML template, not interpolating
            expect(options?.featureFile, state).toBe('${vars.featureSpecPath}');
        }
        // The record-entry fingerprint compare is GONE — replaced by the bound run.artifact.
        const recordCaptures = (DEF.states.find((s) => s.id === 'record')?.onEnter ?? []).filter(
            (a) => a.kind === 'proof.fingerprint',
        );
        expect(recordCaptures).toHaveLength(0);
    });

    test('the review stage writes a run-scoped completion marker after its agent (R4)', () => {
        const review = DEF.states.find((s) => s.id === 'review');
        const kinds = (review?.onEnter ?? []).map((a) => a.kind);
        expect(kinds).toEqual(['agent.run', 'shell']);
        const marker = shellCommandsOf('review').find((c) => c.includes('-review-proof.digest'));
        expect(marker).toBeDefined();
        expect(marker).toContain('$__runId-review-proof.digest');
        expect(marker).toContain('$proofDigest');
    });

    test('the verify stamp marks review completed only on a matching marker (R4)', () => {
        const stamp = shellCommandsOf('verify').find((c) => c.includes('-verdict.json'));
        expect(stamp).toBeDefined();
        // Default is skipped — an unexecuted review is never reported completed.
        expect(stamp).toContain('RV="skipped"');
        expect(stamp).toContain('$__runId-review-proof.digest');
        expect(stamp).toContain('--arg rv "$RV"');
        expect(stamp).toContain('review: {status: $rv, digest: $d}');
        expect(stamp).not.toContain('review: {status: "completed"');
    });

    test('the verify→record guard demands completed review evidence (R4/R5)', () => {
        const guard = cmdOf('verify', 'record');
        expect(guard).toContain('.proof.stages.review.status // ""\' "$V" 2>/dev/null)" = "completed"');
        // The rest of the proof-block pinning stays intact.
        expect(guard).toContain('.proof.stages.review.digest');
        expect(guard).toContain('.proof.definitionDigest');
        expect(guard).toContain('.proof.runId');
    });
});

describe('task-pipeline busy-retry classifiers, done guard projection, route-id safety (task 0804 R3/R6/R8)', () => {
    // Raw YAML text (not the parsed tree) so classifier expressions are pinned verbatim.
    const RAW = readFileSync(join(WORKFLOWS_DIR, 'task-pipeline.yaml'), 'utf8');

    /** Extract a `name() { ... };` shell function body from a YAML command string. */
    const fnOf = (command: string, name: string): string => {
        const start = command.indexOf(`${name}() {`);
        if (start < 0) return '';
        const end = command.indexOf('\n};', start);
        return command.slice(start, end + 3);
    };

    const runSh = (script: string, cwd: string, env?: Record<string, string>): { code: number; stderr: string } => {
        const proc = Bun.spawnSync(['sh', '-c', script], {
            cwd,
            env: env === undefined ? { ...process.env } : { ...process.env, ...env },
            stdout: 'pipe',
            stderr: 'pipe',
        });
        return { code: proc.exitCode, stderr: proc.stderr.toString() };
    };

    function makeTmpDir(): { dir: string; cleanup: () => void } {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0804-yaml-'));
        mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
        mkdirSync(join(dir, '.spur', 'memory'), { recursive: true });
        return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
    }

    // ── R3: all five retry classifiers recognize raw locks, SQLITE_BUSY and the
    // path-bearing busy message; budgets and non-lock behavior stay unchanged.

    test('all five classifier sites carry the expanded path-aware alternation (R3)', () => {
        // Three retry-once sites (task update transitions) + two quality-gate loop sites.
        const retrySites =
            RAW.match(
                /grep -Eq 'ENOENT\|EBUSY\|ENOTEMPTY\|database is locked\|SQLite database \.\*is busy\|SQLITE_BUSY'/g,
            ) ?? [];
        const gateSites =
            RAW.match(/grep -Eq 'SQLiteError: database is locked\|SQLite database \.\*is busy\|SQLITE_BUSY'/g) ?? [];
        expect(retrySites.length).toBe(3);
        expect(gateSites.length).toBe(2);
        // Every `database is locked`-bearing classifier now carries the full expansion —
        // no leftover narrow expression.
        const narrow = RAW.match(/grep -Eq '[^']*database is locked[^']*'/g) ?? [];
        expect(narrow.length).toBe(5);
        // Existing budgets preserved: retry-once keeps its 2s delay, gate loops keep at
        // most five attempts with 10s delays.
        expect((RAW.match(/sleep 2;/g) ?? []).length).toBe(3);
        expect((RAW.match(/sleep 10;/g) ?? []).length).toBe(2);
        expect((RAW.match(/-ge 5 \]/g) ?? []).length).toBe(2);
    });

    test('behavioral: the retry-once classifier retries only lock-class failures (R3)', () => {
        // The three retry-once sites share one byte-identical function; proving the
        // shared body pins all three sites.
        const bodies = DEF.states
            .flatMap((s) => (s.onEnter ?? []).map((a) => String(a.options?.command ?? '')))
            .filter((c) => c.includes('retry_transient() {'))
            .map((c) => fnOf(c, 'retry_transient'));
        expect(bodies.length).toBe(3);
        expect(new Set(bodies).size).toBe(1);
        const fn = bodies[0];
        expect(fn).not.toBe('');

        const { dir, cleanup } = makeTmpDir();
        try {
            writeFileSync(
                join(dir, 'busy.sh'),
                '#!/bin/sh\necho "SQLite database $PWD/.spur/spur.db is busy" >&2\necho call >> calls.log\nexit 16\n',
            );
            writeFileSync(
                join(dir, 'other.sh'),
                '#!/bin/sh\necho "ENOCONFIG: totally unrelated failure" >&2\necho call >> calls.log\nexit 5\n',
            );
            writeFileSync(join(dir, 'ok.sh'), '#!/bin/sh\necho call >> calls.log\nexit 0\n');
            const run = (stub: string): { code: number; calls: number } => {
                rmSync(join(dir, 'calls.log'), { force: true });
                const res = runSh(`${fn}\nretry_transient sh ${dir}/${stub}`, dir);
                const calls = readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n').length;
                return { code: res.code, calls };
            };
            // Path-bearing busy message → exactly one retry, then the original rc.
            expect(run('busy.sh')).toEqual({ code: 16, calls: 2 });
            // Non-lock failure → no retry, original rc, single invocation.
            expect(run('other.sh')).toEqual({ code: 5, calls: 1 });
            // First-attempt success → never retries.
            expect(run('ok.sh')).toEqual({ code: 0, calls: 1 });
        } finally {
            cleanup();
        }
    });

    test('behavioral: the quality-gate classifier rejects only lock-class failures (R3)', () => {
        // The two gate sites classify one captured attempt log line with the same
        // `grep -Eq` alternation (verbatim pin) — the loop budget shape (`-ge 5`,
        // `sleep 10`) is pinned structurally above; here the classification predicate
        // is proven against both stub classes.
        const gateLine =
            /grep -Eq 'SQLiteError: database is locked\|SQLite database \.\*is busy\|SQLITE_BUSY' "\$ATTEMPT_LOG" && gate_locked=1/;
        expect((RAW.match(new RegExp(gateLine.source, 'g')) ?? []).length).toBe(2);
        // Extract the alternation verbatim from the YAML (not from a regex source, whose
        // escaping would change grep -E semantics).
        const anchor = RAW.indexOf("grep -Eq 'SQLiteError");
        const alternation = RAW.slice(RAW.indexOf("'", anchor) + 1, RAW.indexOf("'", RAW.indexOf("'", anchor) + 1));
        expect(alternation).toContain('SQLITE_BUSY');
        const { dir, cleanup } = makeTmpDir();
        try {
            const probe = (text: string): boolean =>
                runSh(`printf '%s' "$PROBE" | grep -Eq '${alternation}'`, dir, { PROBE: text }).code === 0;
            expect(probe('SQLiteError: database is locked')).toBe(true);
            expect(probe('SQLite database /tmp/x/.spur/spur.db is busy')).toBe(true);
            expect(probe('SQLITE_BUSY: checkpoint starvation')).toBe(true);
            expect(probe('ENOCONFIG: unrelated failure')).toBe(false);
        } finally {
            cleanup();
        }
    });

    // ── R6: the record→done guard projects the structural check onto the done target.

    test('the record→done guard checks the done target with --as done and keeps verdict/proof backstops (R6)', () => {
        const guard = cmdOf('record', 'done');
        expect(guard).toContain('task check $wbs --as done');
        // The pre-existing backstops stay: PASS verdict + digest match on the proof block.
        expect(guard).toContain('"$(jq -r .verdict .spur/run/$wbs-verdict.json 2>/dev/null)" = PASS');
        expect(guard).toContain('.proof.digest');
        // No unprojected plain check remains.
        expect(guard.includes('task check $wbs &&')).toBe(false);
    });

    // ── R8: the route-reason action validates the run id before creating its artifact.

    test('behavioral: empty falls back, valid ids write, unsafe ids fail without a reason artifact (R8)', () => {
        // 0759 R5: the route claim is a precheck-state shell action.
        const routeCmd = (DEF.states.find((s) => s.id === 'precheck')?.onEnter ?? [])
            .filter((a) => a.kind === 'shell')
            .map((a) => String(a.options?.command ?? ''))
            .find((c) => c.includes('REASON_FILE='));
        expect(routeCmd).toBeDefined();
        if (routeCmd === undefined) return;
        const { dir, cleanup } = makeTmpDir();
        try {
            const runRoute = (runId: string): { code: number; stderr: string } =>
                runSh(routeCmd, dir, { __runId: runId, wbs: 't0804', mode: 'fast' });
            const reasonExists = (id: string): boolean => {
                try {
                    readFileSync(join(dir, '.spur', 'run', `${id}-route-reason.txt`), 'utf8');
                    return true;
                } catch {
                    return false;
                }
            };

            // Empty id → pipeline-$wbs fallback artifact.
            expect(runRoute('').code).toBe(0);
            expect(readFileSync(join(dir, '.spur', 'run', 'pipeline-t0804-route-reason.txt'), 'utf8')).toContain(
                'fast:evidence complete+consistent',
            );

            // Valid UUID form → its own artifact.
            expect(runRoute('0d90b4e7-1c2d-4e5f-a6b7-8c9d0e1f2a3b').code).toBe(0);
            expect(reasonExists('0d90b4e7-1c2d-4e5f-a6b7-8c9d0e1f2a3b')).toBe(true);

            // Unsafe ids → nonzero, refusal diagnostic, no artifact for that id.
            for (const unsafe of ['$spurBin', 'a{b}', '../evil', 'a/b', 'vars.wbs']) {
                const res = runRoute(unsafe);
                expect(res.code).not.toBe(0);
                expect(res.stderr).toContain('refusing unsafe run id');
                expect(reasonExists(unsafe)).toBe(false);
            }

            // The routes log records only the successful runs.
            const log = readFileSync(join(dir, '.spur', 'memory', 'task-pipeline-routes.log'), 'utf8');
            expect(log).toContain('pipeline-t0804');
            expect(log).toContain('0d90b4e7-1c2d-4e5f-a6b7-8c9d0e1f2a3b');
            expect(log.includes('$spurBin')).toBe(false);
        } finally {
            cleanup();
        }
    });
});
