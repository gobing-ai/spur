// Task 1137 R2/R4 / R5(d) — fail-first tests for `transitionFeatureGuarded`, the
// in-process feature-transition gate the server routes through: undeclared edges,
// onEnter targets (today: `verifying`) and failing shell-guard edges are refused
// with GuardDeniedError and write nothing; `always` edges (the verifying → active
// reopen) pass with their History line; a missing graph is a loud refusal (R4);
// the project-tier YAML wins over the bundled tier (failure-inventory).
//
// P2 remediation (attempt 2): the shell-guard edge execution must mirror the CLI
// wiring — `--strict` from the YAML guard command plus `runDir` + the run-store
// port, so the D63 digest-chained completion receipt fires over HTTP too.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { GuardDeniedError } from '../../src/errors';
import { FeatureCheckService } from '../../src/services/feature-check';
import { FeatureService } from '../../src/services/feature-service';
import { transitionFeatureGuarded } from '../../src/services/feature-transition';
import { PlanningWriteService } from '../../src/services/planning-write-service';
import {
    captureFeatureReceiptDigest,
    completeFeatureVerificationReceipt,
    DEFAULT_FEATURE_VERIFICATION_CMD,
    startFeatureVerificationReceipt,
} from '../../src/workflow/feature-verification-receipt';
import { resolveWorkflowDefinition } from '../../src/workflow/workflow-resolver';

const featureFile = (
    id: string,
    status: string,
    sections: string[] = ['Goal', 'Scope', 'Acceptance Criteria', 'Tasks'],
): string =>
    [
        '---',
        'schema_version: 1',
        `id: ${id}`,
        `name: Feature ${id}`,
        `status: ${status}`,
        'created_at: 2026-10-01T00:00:00Z',
        'updated_at: 2026-10-01T00:00:00Z',
        '---',
        `# ${id} Feature ${id}`,
        ...sections.flatMap((s) => [`## ${s}`, `${s.toLowerCase()} body`]),
        '',
    ].join('\n');

function setup(status: string, sections?: string[], content?: string) {
    const root = mkdtempSync(join(tmpdir(), 'spur-1137-guard-'));
    const featuresDir = join(root, 'features');
    const tasksDir = join(root, 'tasks');
    mkdirSync(featuresDir, { recursive: true });
    mkdirSync(tasksDir, { recursive: true });
    const featFile = join(featuresDir, 'F9_probe.md');
    writeFileSync(featFile, content ?? featureFile('F9', status, sections));
    const fs = createNodeFileSystem(root);
    const features = new FeatureService({
        fs,
        featuresDir,
        tasksDir,
        writeService: new PlanningWriteService({ fs }),
    });
    const deps = {
        features,
        check: new FeatureCheckService(fs),
        cwd: root,
        featuresDir,
        tasksDirs: [tasksDir],
        runDir: join(root, '.spur', 'run'),
    };
    return { root, featFile, deps, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * Strict-clean feature fixture: every static lifecycle check passes, so only the
 * D63 completion receipt can deny the verifying → done hop.
 */
const strictCleanFeature = (id: string, status: string): string =>
    [
        '---',
        'schema_version: 1',
        `id: ${id}`,
        `name: Feature ${id}`,
        `status: ${status}`,
        'created_at: 2026-10-01T00:00:00Z',
        'updated_at: 2026-10-01T00:00:00Z',
        '---',
        `# ${id} Feature ${id}`,
        '## Goal',
        'goal body',
        '## Scope',
        'In: guarded transitions',
        'Out: everything else',
        '## Acceptance Criteria',
        '- [ ] a strict-clean checklist item',
        '## Tasks',
        '',
    ].join('\n');

/**
 * Record a current PASS receipt exactly as the production verification pass
 * would (D63 task 0915). The guard's in-process check captures its digest
 * against the PROCESS cwd (`FeatureCheckService.checkFeatureVerificationReceipt`),
 * so the fixture mirrors that even though the receipt itself is confined to the
 * temp project's run dir.
 */
async function recordValidReceipt(
    fs: FileSystem,
    featFile: string,
    featureId: string,
    runDir: string,
    workdir: string,
): Promise<void> {
    const raw = readFileSync(featFile, 'utf8');
    let learnings: string | undefined;
    try {
        learnings = readFileSync(join(process.cwd(), '.spur', 'context', 'learnings.md'), 'utf8');
    } catch {
        learnings = undefined;
    }
    const inputDigest = await captureFeatureReceiptDigest(process.cwd(), raw, learnings);
    const selected = await resolveWorkflowDefinition(process.cwd(), 'feature-verification');
    const vars = selected.workflow.vars as { verificationCmd?: unknown } | undefined;
    const verificationCmd =
        typeof vars?.verificationCmd === 'string' && vars.verificationCmd.length > 0
            ? vars.verificationCmd
            : DEFAULT_FEATURE_VERIFICATION_CMD;
    const runId = `run-${featureId.toLowerCase()}`;
    const running = await startFeatureVerificationReceipt(fs, runDir, {
        featureId,
        runId,
        workdir,
        verifier: {
            name: 'feature-verification',
            sourcePath: selected.path,
            layer: selected.layer,
            definitionDigest: selected.digest,
        },
        verificationCmd,
        inputDigest,
    });
    await completeFeatureVerificationReceipt(fs, runDir, running, { status: 'PASS', inputDigest });
}

describe('1137 R2 — transitionFeatureGuarded', () => {
    test('R5(d): an undeclared edge (backlog → done) is denied and writes nothing', async () => {
        const { featFile, deps, cleanup } = setup('backlog');
        try {
            const before = readFileSync(featFile, 'utf8');
            await expect(transitionFeatureGuarded(deps, { id: 'F9', to: 'done' })).rejects.toThrow(GuardDeniedError);
            await expect(transitionFeatureGuarded(deps, { id: 'F9', to: 'done' })).rejects.toThrow(
                /undeclared edge backlog → done/,
            );
            expect(readFileSync(featFile, 'utf8')).toBe(before);
        } finally {
            cleanup();
        }
    });

    test('AC4: a target state with onEnter actions (verifying) is refused with the CLI recovery', async () => {
        const { featFile, deps, cleanup } = setup('active');
        try {
            const before = readFileSync(featFile, 'utf8');
            await expect(transitionFeatureGuarded(deps, { id: 'F9', to: 'verifying' })).rejects.toThrow(
                GuardDeniedError,
            );
            await expect(transitionFeatureGuarded(deps, { id: 'F9', to: 'verifying' })).rejects.toThrow(
                'entering `verifying` runs feature verification; use `spur feature update F9 verifying` from the CLI',
            );
            expect(readFileSync(featFile, 'utf8')).toBe(before);
        } finally {
            cleanup();
        }
    });

    test('AC3 (app layer): a shell-guard edge whose check has error findings is denied (verifying → done)', async () => {
        // `done` requires Goal/Scope/Acceptance Criteria/Tasks (gate:true) — a fixture without
        // the Tasks section fails `feature check --as done` with L2 error findings.
        const { featFile, deps, cleanup } = setup('verifying', ['Goal', 'Scope', 'Acceptance Criteria']);
        try {
            const before = readFileSync(featFile, 'utf8');
            await expect(transitionFeatureGuarded(deps, { id: 'F9', to: 'done' })).rejects.toThrow(GuardDeniedError);
            await expect(transitionFeatureGuarded(deps, { id: 'F9', to: 'done' })).rejects.toThrow(/--as done/);
            expect(readFileSync(featFile, 'utf8')).toBe(before);
        } finally {
            cleanup();
        }
    });

    test('AC2/AC5 (app layer): the verifying → active reopen is an always edge and keeps its History line', async () => {
        const { featFile, deps, cleanup } = setup('verifying');
        try {
            const result = await transitionFeatureGuarded(deps, { id: 'F9', to: 'active' });
            expect(result.fromStatus).toBe('verifying');
            expect(result.toStatus).toBe('active');
            const after = readFileSync(featFile, 'utf8');
            expect(after).toContain('status: active');
            expect(after.split('\n').filter((l) => /verifying → active/.test(l))).toHaveLength(1);
        } finally {
            cleanup();
        }
    });

    test('AC7/R4: a missing feature-lifecycle graph is a loud GuardDeniedError naming profile and roots', async () => {
        const { featFile, deps, cleanup } = setup('active');
        try {
            const before = readFileSync(featFile, 'utf8');
            const probed = ['/nowhere/feature-lifecycle.yaml', '/bundled/workflows/feature-lifecycle.yaml'];
            const noGraph = {
                ...deps,
                resolveFile: () => ({ path: null, probed: probed as [string, string | null] }),
            };
            await expect(transitionFeatureGuarded(noGraph, { id: 'F9', to: 'active' })).rejects.toThrow(
                GuardDeniedError,
            );
            await expect(transitionFeatureGuarded(noGraph, { id: 'F9', to: 'active' })).rejects.toThrow(
                /feature-lifecycle/,
            );
            await expect(transitionFeatureGuarded(noGraph, { id: 'F9', to: 'active' })).rejects.toThrow(
                /\/nowhere\/feature-lifecycle\.yaml/,
            );
            expect(readFileSync(featFile, 'utf8')).toBe(before);
        } finally {
            cleanup();
        }
    });

    test('P2 remediation: the verifying → done shell edge forwards strict + runDir + receiptRunPort', async () => {
        // The YAML guard for this edge is `feature check $featureId --strict --as done`.
        // Mirroring the CLI wiring means the in-process check must see `strict: true`
        // and the run/verdict seams the D63 receipt gate reads.
        const { deps, cleanup } = setup('verifying', undefined, strictCleanFeature('F9', 'verifying'));
        try {
            const seen: Array<Record<string, unknown>> = [];
            const stubCheck = {
                check: async (_filePath: string, _featureId: string, options: Record<string, unknown>) => {
                    seen.push(options);
                    return { id: 'F9', status: 'verifying', pass: true, findings: [] };
                },
            } as unknown as FeatureCheckService;
            const receiptRunPort = { readRunRow: async () => undefined };
            const result = await transitionFeatureGuarded(
                { ...deps, check: stubCheck, receiptRunPort },
                { id: 'F9', to: 'done' },
            );
            expect(result.toStatus).toBe('done');
            expect(seen).toHaveLength(1);
            expect(seen[0]?.strict).toBe(true);
            expect(seen[0]?.asStatus).toBe('done');
            expect(seen[0]?.runDir).toBe(deps.runDir);
            expect(seen[0]?.receiptRunPort).toBe(receiptRunPort);
        } finally {
            cleanup();
        }
    });

    test('P2 remediation: a strict-clean verifying feature is denied at done without the D63 receipt', async () => {
        const { featFile, deps, cleanup } = setup('verifying', undefined, strictCleanFeature('F9', 'verifying'));
        try {
            const before = readFileSync(featFile, 'utf8');
            await expect(transitionFeatureGuarded(deps, { id: 'F9', to: 'done' })).rejects.toThrow(GuardDeniedError);
            await expect(transitionFeatureGuarded(deps, { id: 'F9', to: 'done' })).rejects.toThrow(
                /completion evidence rejected \(missing\)/,
            );
            expect(readFileSync(featFile, 'utf8')).toBe(before);
        } finally {
            cleanup();
        }
    });

    test('P2 remediation: a current PASS receipt lets the verifying → done hop through', async () => {
        const { root, featFile, deps, cleanup } = setup('verifying', undefined, strictCleanFeature('F9', 'verifying'));
        try {
            await recordValidReceipt(createNodeFileSystem(), featFile, 'F9', deps.runDir, root);
            const result = await transitionFeatureGuarded(deps, { id: 'F9', to: 'done' });
            expect(result.toStatus).toBe('done');
            expect(readFileSync(featFile, 'utf8')).toContain('status: done');
        } finally {
            cleanup();
        }
    });

    test('failure inventory: a project-tier feature-lifecycle.yaml wins over the bundled tier', async () => {
        const { root, featFile, deps, cleanup } = setup('backlog');
        try {
            // Project-tier override declaring the edge the bundled graph refuses.
            const projectWfDir = join(root, '.spur', 'workflows');
            mkdirSync(projectWfDir, { recursive: true });
            writeFileSync(
                join(projectWfDir, 'feature-lifecycle.yaml'),
                [
                    'kind: state-machine',
                    'name: feature-lifecycle',
                    'version: "1"',
                    'initialState: backlog',
                    'states:',
                    '  - id: backlog',
                    '  - id: done',
                    'transitions:',
                    '  - from: backlog',
                    '    to: done',
                    '    guard:',
                    '      kind: always',
                    '',
                ].join('\n'),
            );
            const result = await transitionFeatureGuarded(deps, { id: 'F9', to: 'done' });
            expect(result.toStatus).toBe('done');
            expect(readFileSync(featFile, 'utf8')).toContain('status: done');
        } finally {
            cleanup();
        }
    });
});
