import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
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
    terminalReason?: string;
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

// The repo's scanner sources — behavioral guard tests resolve the review-gate through the same
// source-repo pair the record step uses (task 1122).
const SCRIPTS_DIR = join(import.meta.dir, '../../../../plugins/sp/scripts');

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
        expect(recordShells.length).toBeGreaterThanOrEqual(1);
        // 0823: the record write itself is a `command.gate` action (classified transient retry,
        // governance §1.1 (c)); assert the verb survived the owner move.
        const recordGate = (record?.onEnter ?? []).find((a) => a.kind === 'command.gate');
        expect(recordGate).toBeDefined();
        const gateArgs = JSON.stringify(recordGate?.options ?? {});
        expect(gateArgs).toContain('task');
        expect(gateArgs).toContain('record');
        expect(gateArgs).toContain('--solution-from-diff');
        expect(gateArgs).toContain('--transition');
        expect(gateArgs).toContain('testing');
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

    test('the workflow identity carries the current contract version (v5: onError-continue on the verify verdict action + test-fix review-lane evidence projection)', () => {
        expect((DEF as unknown as { version: string }).version).toBe('5');
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
        // Located by `capturePoint`: since the session finding after 1088 the verify state has a
        // second shell that also writes `.spur/run/<wbs>-verdict.json` (the confidence check row),
        // and only the stamp carries the proof block.
        const stamp = shellCommandsOf('verify').find((c) => c.includes('capturePoint'));
        expect(stamp).toBeDefined();
        // Default is skipped — an unexecuted review is never reported completed. 0823 moved the
        // marker compare into the jq program itself (`--arg rp` + inline if), same semantics.
        expect(stamp).toContain('$__runId-review-proof.digest');
        expect(stamp).toContain('--arg rp "$(cat .spur/run/$__runId-review-proof.digest');
        expect(stamp).toContain('review: {status: (if $rp == $d then "completed" else "skipped" end)');
        expect(stamp).not.toContain('review: {status: "completed"');
    });

    test('the verify→record guard demands completed review evidence (R4/R5)', () => {
        const guard = cmdOf('verify', 'record');
        // 0823: one `jq -e` predicate over the verdict file (same proof fields as the former
        // 9-command test chain).
        expect(guard).toContain('jq -e');
        expect(guard).toContain('(.proof.stages.review.status // "") == "completed"');
        // The rest of the proof-block pinning stays intact.
        expect(guard).toContain('.proof.stages.review.digest');
        expect(guard).toContain('.proof.definitionDigest');
        expect(guard).toContain('.proof.runId');
    });
});

describe('task-pipeline busy-retry classifiers, done guard projection, route-id safety (task 0804 R3/R6/R8)', () => {
    const runSh = (script: string, cwd: string, env?: Record<string, string>): { code: number; stderr: string } => {
        const proc = Bun.spawnSync(['sh', '-c', script], {
            cwd,
            env: env === undefined ? { ...getEnvVars() } : { ...getEnvVars(), ...env },
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

    // ── R3 (0823): the three lifecycle transitions and the quality-gate loop moved to owners
    // (governance §1.1 (c)/(d)). The classified transient retry lives in the command.gate retry
    // options; the gate lock-classifier behavior is behavioral-tested in
    // plugins/sp/tests/quality-gate.test.ts against plugins/sp/scripts/quality-gate.ts.

    test('the three lifecycle transitions are command.gate actions with classified transient retry (R3)', () => {
        const gates = DEF.states
            .flatMap((s) => (s.onEnter ?? []).map((a) => ({ state: s.id, action: a })))
            .filter(({ action }) => action.kind === 'command.gate');
        expect(gates.map((g) => g.state).sort()).toEqual(['done', 'implement', 'record']);
        for (const { action } of gates) {
            const options = action.options as Record<string, unknown>;
            const retry = options.retry as Record<string, unknown>;
            expect(retry.maxAttempts).toBe(2);
            expect(retry.delayMs).toBe(2000);
            for (const cls of ['sqlite-busy', 'ENOENT', 'EBUSY', 'ENOTEMPTY']) {
                expect(retry.on).toContain(cls);
            }
            expect(options.softFail).toBe(false);
            expect(String(options.resultFile)).toMatch(/^\.spur\/run\/\$\{vars\.__runId\}-.*\.status$/);
        }
        // Verb shapes preserved: wip update, record with transition, done update.
        const argsOf = (state: string): string =>
            JSON.stringify(
                DEF.states.find((s) => s.id === state)?.onEnter?.find((a) => a.kind === 'command.gate')?.options ?? {},
            );
        expect(argsOf('implement')).toContain('--no-lifecycle');
        expect(argsOf('implement')).toContain('"wip"');
        expect(argsOf('record')).toContain('--solution-from-diff');
        expect(argsOf('record')).toContain('"testing"');
        // 0980: the record stage's transition must not spawn a nested task-lifecycle
        // run — the pipeline run is the lifecycle record; a nested run outlives the
        // pipeline as a `running` orphan (task_run_links empty, zero child rows).
        expect(argsOf('record')).toContain('--no-lifecycle');
        expect(argsOf('done')).toContain('--no-lifecycle');
    });

    // ── R6: the record→done guard projects the structural check onto the done target.

    test('the record→done guard checks the done target with --as done and keeps verdict/proof backstops (R6)', () => {
        const guard = cmdOf('record', 'done');
        expect(guard).toContain('task check $wbs --as done');
        // The backstops stay: PASS verdict + digest match on the proof block + the confidence rule
        // (session finding after 1088). 0874's named reads became ONE `jq -e` predicate, which is
        // also what the ADR-115 guard budget asks for — same semantics, fewer logical commands.
        expect(guard).toContain('jq -e --arg p "$proofDigest"');
        expect(guard).toContain('.verdict == "PASS"');
        expect(guard).toContain('((.proof.digest // "") == $p)');
        expect(guard).toContain('(.confidence // "LOW") != "LOW" or $ack == "true"');
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

// Session finding after 1088 (task 1068 follow-up): the verify answer's `Confidence:` line was
// captured, linted and recorded, and then ignored — a PASS at LOW confidence certified exactly
// like HIGH. These pin the gate that now reads it, and the operator acknowledgement that is the
// only way to certify a verdict the verifier would not stand behind.
describe('task-pipeline confidence gate (session finding after 1088)', () => {
    const runSh = (script: string, cwd: string, env?: Record<string, string>): { code: number } => {
        const proc = Bun.spawnSync(['sh', '-c', script], {
            cwd,
            env: env === undefined ? { ...getEnvVars() } : { ...getEnvVars(), ...env },
            stdout: 'pipe',
            stderr: 'pipe',
        });
        return { code: proc.exitCode };
    };

    /** Render the verify → record guard with the run's vars substituted for literals. */
    const renderVerifyGuard = (cwd: string, ack: string): string =>
        cmdOf('verify', 'record')
            .replaceAll('$proofDigest', 'sha256:test-digest')
            .replaceAll('$__runId', 'run-t-confidence')
            .replaceAll('$__definitionDigest', 'sha256:def-digest')
            .replaceAll('$ackLowConfidence', ack)
            .replaceAll('$wbs', 't9002')
            .replaceAll('../..', cwd);

    function makeFixture(dir: string, confidence: string | undefined): void {
        mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
        const digest = 'sha256:test-digest';
        const artifact = {
            wbs: 't9002',
            verdict: 'PASS',
            ...(confidence === undefined ? {} : { confidence }),
            requirements: [],
            acceptanceCriteria: [],
            checks: [],
            proof: {
                digest,
                runId: 'run-t-confidence',
                definitionDigest: 'sha256:def-digest',
                capturePoint: 'quality-gate-entry',
                stages: {
                    qualityGate: { status: 'PASS', digest },
                    review: { status: 'completed', digest },
                    verification: { status: 'PASS', digest },
                },
            },
        };
        writeFileSync(join(dir, '.spur', 'run', 't9002-verdict.json'), JSON.stringify(artifact));
    }

    test('the acknowledgement var exists and defaults empty (HIGH/MEDIUM need no ack)', () => {
        const vars = (DEF as unknown as { vars: Record<string, unknown> }).vars;
        expect(vars.ackLowConfidence).toBe('');
    });

    test('both completion guards read the confidence level (R: verify → record, record → done)', () => {
        for (const [from, to] of [
            ['verify', 'record'],
            ['record', 'done'],
        ] as const) {
            const guard = cmdOf(from, to);
            expect(guard, `${from}→${to}`).toContain('--arg ack "$ackLowConfidence"');
            // LOW (and an ABSENT level — fail closed) clears only with the operator's ack.
            expect(guard, `${from}→${to}`).toContain('(.confidence // "LOW") != "LOW" or $ack == "true"');
        }
    });

    test('the verify state records a confidence check row before its proof-binding stamp', () => {
        const verify = DEF.states.find((s) => s.id === 'verify');
        const actions = verify?.onEnter ?? [];
        const confidenceAction = actions.findIndex((a) => String(a.options?.command ?? '').includes('"confidence"'));
        const stampIndex = actions.findIndex((a) => String(a.options?.command ?? '').includes('capturePoint'));
        expect(confidenceAction).toBeGreaterThan(-1);
        expect(actions[confidenceAction]?.kind).toBe('shell');
        expect(String(actions[confidenceAction]?.options?.command)).toContain('map(select(.name != "confidence"))');
        // The stamp stays last: the proof-chain bracket assertion depends on it.
        expect(stampIndex).toBe(actions.length - 1);
    });

    test('behavioral: LOW is refused without the ack and admitted with it', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-conf-gate-'));
        try {
            makeFixture(dir, 'LOW');
            expect(runSh(renderVerifyGuard(dir, ''), dir).code).not.toBe(0);
            expect(runSh(renderVerifyGuard(dir, 'true'), dir).code).toBe(0);
            // HIGH and MEDIUM certify without an acknowledgement.
            makeFixture(dir, 'HIGH');
            expect(runSh(renderVerifyGuard(dir, ''), dir).code).toBe(0);
            makeFixture(dir, 'MEDIUM');
            expect(runSh(renderVerifyGuard(dir, ''), dir).code).toBe(0);
            // An absent level is fail-closed: a pre-1068 artifact is not silently trusted.
            makeFixture(dir, undefined);
            expect(runSh(renderVerifyGuard(dir, ''), dir).code).not.toBe(0);
            expect(runSh(renderVerifyGuard(dir, 'true'), dir).code).toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

// Session finding after 1088: a FAIL review had no outgoing edge at all, so remediating one meant
// driving the graph by hand. The router below is the review-side twin of 0943's failure-class router.
describe('task-pipeline review-failure routing (session finding after 1088)', () => {
    const runSh = (script: string, cwd: string): { code: number } => {
        const proc = Bun.spawnSync(['sh', '-c', script], { cwd, stdout: 'pipe', stderr: 'pipe' });
        return { code: proc.exitCode };
    };

    test('the router state classifies the failure like the quality-gate twin', () => {
        const state = DEF.states.find((s) => s.id === 'review-fail-triage');
        expect(state).toBeDefined();
        const decide = state?.onEnter?.find((a) => a.kind === 'decide');
        const options = decide?.options as Record<string, unknown> | undefined;
        expect(options?.id).toBe('review-failure-class');
        expect(options?.choices).toEqual(['fix', 'stop']);
        // Bounded by the SAME counter the quality-gate loop uses: no extra attempts.
        // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal YAML template, not interpolating
        expect(String(options?.resultFile)).toBe('.spur/run/${vars.wbs}-review-failure-class.decision');
    });

    test('the router is bounded and fail-closed: stop, cap, fix, then a catch-all', () => {
        const edges = DEF.transitions.filter((t) => t.from === 'review-fail-triage');
        expect(edges.map((e) => `${e.to}:${e.terminalReason ?? e.guard?.kind}`)).toEqual([
            'failed:failed-check',
            'failed:retry-exhausted',
            'test-fix:shell',
            'failed:failed-check',
        ]);
        const cap = edges.find((e) => e.terminalReason === 'retry-exhausted');
        expect(String(cap?.guard?.options?.command)).toContain('$wbs-test-fix-attempt');
        expect(String(cap?.guard?.options?.command)).toContain('qualityGateMaxFixAttempts');
        // The last edge is `always` — a missing/corrupt decision can never fall through to a fix.
        expect(edges.at(-1)?.guard?.kind).toBe('always');
    });

    test('a FAIL or missing review answer cannot reach verify (fail-closed PASS edges)', () => {
        const autoSkip = cmdOf('review', 'verify');
        const interactive = cmdOf('review', 'approve');
        for (const guard of [autoSkip, interactive]) {
            expect(guard).toContain('Verdict:');
            expect(guard).toContain('PASS');
        }
        expect(autoSkip).toContain('test "$profile" = auto');
        // The PASS edges are declared before the catch-all, so a PASS still takes them.
        const order = DEF.transitions.filter((t) => t.from === 'review').map((t) => t.to);
        expect(order).toEqual(['verify', 'approve', 'review-fail-triage']);
    });

    test('behavioral: the PASS edge accepts PASS (plain or bold) and refuses FAIL/absent', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-review-gate-'));
        try {
            mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
            // Since 1122 the PASS edge continues into the review-gate residual check, so a passing
            // case must satisfy the whole chain: seed the scanner resolution and a stub spur that
            // serves a clean review (P4-only row).
            const stub = join(dir, 'stub-spur.sh');
            const cleanReview = JSON.stringify({
                content:
                    '### Review\n\n| Priority | Finding | Location | Disposition |\n| --- | --- | --- | --- |\n| P4 (advisory) | Note | src/d.ts:1 | ACCEPTED |\n',
            }).replaceAll("'", "'\\''");
            writeFileSync(stub, `#!/bin/sh\ncase "$2" in\n  show) printf '%s' '${cleanReview}' ;;\nesac\n`);
            chmodSync(stub, 0o755);
            writeFileSync(
                join(dir, '.spur', 'run', 'run-t-review-script-root.json'),
                `${JSON.stringify({ mode: 'source-repo', dir: SCRIPTS_DIR })}\n`,
            );
            const answer = join(dir, '.spur', 'run', 'run-t-review-review-answer.txt');
            const guard = cmdOf('review', 'verify')
                .replaceAll('$profile', 'auto')
                .replaceAll('$__runId', 'run-t-review')
                .replaceAll('../..', dir)
                .replaceAll('$spurBin', stub)
                .replaceAll('$wbs', '1122');
            for (const [body, expected] of [
                ['Verdict: PASS\n', 0],
                ['**Verdict: PASS**\n', 0],
                ['Verdict: FAIL\n', 1],
                ['PASS without the token\n', 1],
            ] as const) {
                writeFileSync(answer, body);
                expect(runSh(guard, dir).code, body).toBe(expected);
            }
            const missing = cmdOf('review', 'verify')
                .replaceAll('$profile', 'auto')
                .replaceAll('$__runId', 'run-t-absent')
                .replaceAll('../..', dir);
            expect(runSh(missing, dir).code).not.toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

// Task 1122: the record sweep's "no open P1-P3 review finding" rule moved forward to the review
// PASS edges — a PASS with an open finding enters the bounded repair lane BEFORE verify spends the
// cycle (record would terminally fail it after a full verify + record). Same classifier, same
// deferrals, resolved like the record step's scanner, fail-closed into review-fail-triage.
describe('task-pipeline review PASS-edge review-gate (task 1122)', () => {
    const TABLE_HEAD = '### Review\n\n| Priority | Finding | Location | Disposition |\n| --- | --- | --- | --- |\n';
    const runSh = (script: string, cwd: string, spurBin: string): { code: number } =>
        Bun.spawnSync(['sh', '-c', script], {
            cwd,
            env: { ...process.env, wbs: '1122', spurBin },
            stdout: 'pipe',
            stderr: 'pipe',
        }).exitCode ?? -1;

    test('both PASS edges chain review-gate into the Verdict check (R3, AC2/AC3)', () => {
        for (const guard of [cmdOf('review', 'verify'), cmdOf('review', 'approve')]) {
            expect(guard).toContain('review-gate');
            expect(guard).toContain('script-root.json');
            expect(guard).toContain('residual-scan.ts');
            expect(guard).toContain('residual-scan.mjs');
            expect(guard).toContain('$wbs');
            expect(guard).toContain('$spurBin');
            // One AND-list: the gate runs only after the Verdict grep, so a missing scanner or an
            // open P1-P3 finding fails the edge closed into the review-fail-triage catch-all.
            expect(guard).toContain('review-answer.txt" && eval "$(jq');
            expect(guard).not.toContain(';');
        }
        // The test-fix hop's existing hand-off appends exactly the artifact review-gate writes.
        const fixShells = (DEF.states.find((s) => s.id === 'test-fix')?.onEnter ?? [])
            .filter((a) => a.kind === 'shell')
            .map((a) => String(a.options?.command ?? ''));
        expect(fixShells.some((c) => c.includes('cat ".spur/run/$wbs-residuals.json"'))).toBe(true);
    });

    test('behavioral: PASS with an open P2 falls through to triage; clean PASS advances; missing scanner fails closed', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-1122-gate-'));
        try {
            mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
            const runId = 'run-t-1122';
            writeFileSync(join(dir, '.spur', 'run', `${runId}-review-answer.txt`), 'Verdict: PASS\n');
            writeFileSync(
                join(dir, '.spur', 'run', `${runId}-script-root.json`),
                `${JSON.stringify({ mode: 'source-repo', dir: SCRIPTS_DIR })}\n`,
            );
            const spurStub = join(dir, 'stub-spur.sh');
            const serve = (review: string): void => {
                const payload = JSON.stringify({ content: review }).replaceAll("'", "'\\''");
                writeFileSync(spurStub, `#!/bin/sh\ncase "$2" in\n  show) printf '%s' '${payload}' ;;\nesac\n`);
                chmodSync(spurStub, 0o755);
            };
            const verifyGuard = cmdOf('review', 'verify').replaceAll('$profile', 'auto').replaceAll('$__runId', runId);
            const approveGuard = cmdOf('review', 'approve').replaceAll('$__runId', runId);

            // AC2: PASS + open P2 → neither PASS edge passes → review-fail-triage; the artifact
            // the fix hop consumes is staged with the blocking finding.
            serve(`${TABLE_HEAD}| P2 (major) | Missing validation | src/c.ts:8 | OPEN |\n`);
            expect(runSh(verifyGuard, dir, spurStub)).not.toBe(0);
            expect(runSh(approveGuard, dir, spurStub)).not.toBe(0);
            const artifact = JSON.parse(readFileSync(join(dir, '.spur', 'run', '1122-residuals.json'), 'utf8')) as {
                items: Array<{ category: string; class: string; location: string }>;
            };
            expect(artifact.items.map((i) => i.category)).toEqual(['review-finding']);
            expect(artifact.items.some((i) => i.class === 'blocking' && i.location === 'src/c.ts:8')).toBe(true);

            // AC3: clean PASS (P4 + RESOLVED rows only) still advances, auto and interactive.
            serve(
                `${TABLE_HEAD}| P4 (advisory) | Note | src/d.ts:1 | ACCEPTED |\n| P3 (minor) | Fixed | src/e.ts:2 | RESOLVED — in pass |\n`,
            );
            expect(runSh(verifyGuard, dir, spurStub)).toBe(0);
            expect(runSh(approveGuard, dir, spurStub)).toBe(0);

            // Missing scanner resolution fails closed into the catch-all (triage), never verify.
            rmSync(join(dir, '.spur', 'run', `${runId}-script-root.json`));
            serve(`${TABLE_HEAD}| P4 (advisory) | Note | src/d.ts:1 | ACCEPTED |\n`);
            expect(runSh(verifyGuard, dir, spurStub)).not.toBe(0);
            expect(runSh(approveGuard, dir, spurStub)).not.toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 30000);

    test('the cost is stated where the driver decides (R4, AC4)', () => {
        const reviewDesc = String(DEF.states.find((s) => s.id === 'review')?.description ?? '');
        const triageDesc = String(DEF.states.find((s) => s.id === 'review-fail-triage')?.description ?? '');
        for (const desc of [reviewDesc, triageDesc]) {
            expect(desc).toContain('P1-P3');
            expect(desc).toContain('DEFER');
            expect(desc).toContain('quality → review → verify');
            expect(desc).toContain('wrap residual');
        }
    });
});
