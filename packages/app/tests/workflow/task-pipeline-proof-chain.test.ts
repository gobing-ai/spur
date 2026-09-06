import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
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
