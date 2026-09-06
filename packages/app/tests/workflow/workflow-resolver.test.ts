import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpurConfig } from '@gobing-ai/spur-config';
import { createMigratedDb, RunDao } from '@gobing-ai/spur-domain';
import { resolveWorkflowDefinition, resolveWorkflowFile, WorkflowAppService } from '../../src';
import type { AgentService } from '../../src/services/agent-service';
import type { RuleService } from '../../src/services/rule-service';

const PAUSING_WORKFLOW_YAML = `name: pause-flow
kind: state-machine
initialState: start
states:
  - id: start
    onEnter:
      - kind: note
        options:
          message: go
  - id: gate
    pause: true
  - id: done
transitions:
  - from: start
    to: gate
    guard: { kind: always }
  - from: gate
    to: done
    guard: { kind: always }
terminalStates:
  - done
`;

const INVALID_SCHEMA_WORKFLOW_YAML = `name: invalid-flow
kind: state-machine
initialState: start
invalidRootProperty: not-allowed-by-schema
states:
  - id: start
  - id: done
transitions:
  - from: start
    to: done
terminalStates:
  - done
`;

function makeTestContext(
    cwd: string,
    opts: {
        spurConfig?: SpurConfig;
        hitlAnswer?: 'yes' | 'no';
    } = {},
) {
    let db: ReturnType<typeof createMigratedDb> | undefined;
    return {
        cwd,
        ...(opts.spurConfig !== undefined ? { spurConfig: opts.spurConfig } : {}),
        getDb: async () => {
            db ??= createMigratedDb({ url: ':memory:' });
            return db;
        },
        agentService: () => ({ run: async () => 0 }) as unknown as AgentService,
        ruleService: () => ({ evaluate: async () => ({ exitCode: 0, findings: [] }) }) as unknown as RuleService,
        hitlResponder: () => ({
            respond: async () => ({ value: opts.hitlAnswer ?? 'yes' }),
        }),
    };
}

describe('Task 0752: S0b workflow load/resolve/preflight seam and exact definition binding', () => {
    test('R1: run, continue, and validate agree on one definition and schema validation posture', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-r1-seam-'));
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });

        const wfFile = join(wfDir, 'pauser.yaml');
        await writeFile(wfFile, PAUSING_WORKFLOW_YAML);

        try {
            const ctx = makeTestContext(dir);
            const svc = new WorkflowAppService(ctx);

            // 1. validate resolves and preflights under schema validation
            const validateResult = await svc.validate('pause-flow');
            expect(validateResult.valid).toBe(true);
            if (validateResult.valid) {
                expect(validateResult.digest).toBeDefined();
            }

            // 2. run resolves the same definition and records the digest
            const runResult = await svc.run('pause-flow', { runId: 'run-r1' });
            expect(runResult.status).toBe('paused');

            const db = await ctx.getDb();
            const row = await new RunDao(db).traceRowById('run-r1');
            expect(row).toBeDefined();
            const meta = JSON.parse(row?.metadata_json ?? '{}');
            expect(meta.definitionDigest).toBe(validateResult.valid ? validateResult.digest : undefined);

            // 3. continue resolves the exact same definition and matches digest
            const continueResult = await svc.continuePaused('run-r1', { hitlAnswer: 'yes' });
            expect(continueResult.status).toBe('done');

            // 4. All surfaces enforce schema validation posture
            const invalidFile = join(wfDir, 'broken.yaml');
            await writeFile(invalidFile, INVALID_SCHEMA_WORKFLOW_YAML);

            const validateInvalid = await svc.validate('invalid-flow');
            expect(validateInvalid.valid).toBe(false);

            await expect(svc.run('invalid-flow')).rejects.toThrow();
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('R2: workflow run resolves default agent from spurConfig matching non-CLI and CLI paths', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-r2-config-'));
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });
        await writeFile(
            join(wfDir, 'agent-test.yaml'),
            `name: agent-test
kind: state-machine
initialState: check
vars:
  agent: "auto"
  implementAgent: "auto"
states:
  - id: check
  - id: done
transitions:
  - from: check
    to: done
terminalStates:
  - done
`,
        );

        try {
            const configWithAgent = {
                agent: {
                    default: 'coder',
                },
            } as SpurConfig;

            const ctx = makeTestContext(dir, { spurConfig: configWithAgent });
            const svc = new WorkflowAppService(ctx);
            const result = await svc.run('agent-test', { runId: 'agent-run-1', dryRun: true });
            expect(result.status).toBe('done');

            // Verify that the run resolved vars.agent from config
            const db = await ctx.getDb();
            const row = await new RunDao(db).traceRowById('agent-run-1');
            expect(row).toBeDefined();
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('R3: a resumed run is bound to the exact definition and refuses on unconfirmed drift', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-r3-drift-'));
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });
        const wfFile = join(wfDir, 'pauser.yaml');
        await writeFile(wfFile, PAUSING_WORKFLOW_YAML);

        try {
            // Refuse confirmation by default
            const ctxNo = makeTestContext(dir, { hitlAnswer: 'no' });
            const svcNo = new WorkflowAppService(ctxNo);

            const runResult = await svcNo.run('pause-flow', { runId: 'r3-drift-run' });
            expect(runResult.status).toBe('paused');

            const db = await ctxNo.getDb();
            const rowBefore = await new RunDao(db).traceRowById('r3-drift-run');
            const metaBefore = JSON.parse(rowBefore?.metadata_json ?? '{}');
            const originalDigest = metaBefore.definitionDigest;
            expect(originalDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

            // Edit definition file after pause (adding a description changes digest)
            await writeFile(
                wfFile,
                PAUSING_WORKFLOW_YAML.replace(
                    'name: pause-flow',
                    'name: pause-flow\ndescription: "drifted after pause"',
                ),
            );

            // Resuming with hitlAnswer='no' MUST be refused naming both digests
            await expect(svcNo.continuePaused('r3-drift-run', { hitlAnswer: 'yes' })).rejects.toThrow(
                new RegExp(`drift detected.*${originalDigest}`),
            );

            // Resuming with explicit force: true bypasses the refusal
            const forcedResult = await svcNo.continuePaused('r3-drift-run', { hitlAnswer: 'yes', force: true });
            expect(forcedResult.status).toBe('done');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('R4: project definition wins on every surface over bundled copy', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-r4-precedence-'));
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });

        // basic.yaml exists in bundled layer with name: basic
        const projectBasic = join(wfDir, 'basic.yaml');
        await writeFile(
            projectBasic,
            `name: basic
kind: state-machine
description: "project copy"
initialState: start
states:
  - id: start
  - id: done
transitions:
  - from: start
    to: done
terminalStates:
  - done
`,
        );

        try {
            // resolveWorkflowFile selects project
            const fileRes = resolveWorkflowFile(dir, 'basic');
            expect(fileRes.path).toBe(projectBasic);
            if (fileRes.path !== null) {
                expect(fileRes.source).toBe('project');
            }

            // resolveWorkflowDefinition selects project
            const defRes = await resolveWorkflowDefinition(dir, 'basic');
            expect(defRes.path).toBe(projectBasic);
            expect(defRes.layer).toBe('project');
            expect(defRes.workflow.description).toBe('project copy');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('R5: a stale checkpoint does not silently resume and reports the staleness', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-r5-checkpoint-'));
        const wfDir = join(dir, '.spur', 'workflows');
        const sessionsDir = join(dir, '.spur', 'memory', 'sessions');
        await mkdir(wfDir, { recursive: true });
        await mkdir(sessionsDir, { recursive: true });

        const wfFile = join(wfDir, 'pauser.yaml');
        await writeFile(wfFile, PAUSING_WORKFLOW_YAML);

        try {
            const ctx = makeTestContext(dir);
            const svc = new WorkflowAppService(ctx);

            const runResult = await svc.run('pause-flow', { runId: 'r5-stale-run' });
            expect(runResult.status).toBe('paused');

            // Write a stale checkpoint (terminal status "done" while run is paused)
            const checkpointPath = join(sessionsDir, 'test-checkpoint.md');
            await writeFile(
                checkpointPath,
                `---
schema_version: 1
session_id: 2026-09-03-test
workflow: pause-flow
run_id: r5-stale-run
task_wbs: "0752"
feature_id: ""
phase: done
status: done
last_gate: record
source_commit: abcdef123456
digest: sha256:fake
generated_at: 2026-09-03T00:00:00Z
updated_at: 2026-09-03T00:00:00Z
next_action: none
artifacts: []
---
Stale session notes
`,
            );

            // Attempting to continue must read the checkpoint, detect staleness, and refuse
            await expect(svc.continuePaused('r5-stale-run', { hitlAnswer: 'yes' })).rejects.toThrow(
                /checkpoint is stale/,
            );

            // Now update the checkpoint to a nonterminal projection ("running" — 0784
            // consumer-local mapping; the engine persists no paused checkpoint status)
            await writeFile(
                checkpointPath,
                `---
schema_version: 1
session_id: 2026-09-03-test
workflow: pause-flow
run_id: r5-stale-run
task_wbs: "0752"
feature_id: ""
phase: gate
status: running
last_gate: gate
source_commit: ""
digest: sha256:fake
generated_at: 2026-09-03T00:00:00Z
updated_at: 2026-09-03T00:00:00Z
next_action: resume
artifacts: []
---
Fresh session notes
`,
            );

            const resumedResult = await svc.continuePaused('r5-stale-run', { hitlAnswer: 'yes' });
            expect(resumedResult.status).toBe('done');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});

describe('Task 0756: optional behavior-neutral workflow version', () => {
    /**
     * R1 regression. The dialect JSON schemas were given `minLength: 1`, but the load path
     * validates against the engine's Zod schema, which has no minimum — so an empty literal
     * validated and then got reported as `unversioned`, indistinguishable from an absent field.
     */
    const VERSIONED = (version: string) => `name: versioned-flow
kind: state-machine
version: ${version}
initialState: start
states:
  - id: start
  - id: done
transitions:
  - from: start
    to: done
terminalStates:
  - done
`;

    test('R1: an empty root version is rejected with a diagnostic naming the empty value', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-0756-'));
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });
        await writeFile(join(wfDir, 'versioned-flow.yaml'), VERSIONED('""'));

        await expect(resolveWorkflowDefinition(dir, 'versioned-flow')).rejects.toThrow(/"version" is an empty string/);

        await rm(dir, { recursive: true, force: true });
    });

    test('R1/R2: a non-empty literal resolves and is carried through opaquely', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-0756-'));
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });
        await writeFile(join(wfDir, 'versioned-flow.yaml'), VERSIONED('"not-a-semver"'));

        const resolved = await resolveWorkflowDefinition(dir, 'versioned-flow');
        expect(resolved.workflow.version).toBe('not-a-semver');

        // R3: the version participates in the digest and nothing else — an otherwise identical
        // unversioned copy resolves to a different digest with the same states/transitions.
        await writeFile(join(wfDir, 'unversioned-flow.yaml'), VERSIONED('"x"').replace('version: "x"\n', ''));
        const plain = await resolveWorkflowDefinition(dir, 'unversioned-flow');
        expect(plain.workflow.version).toBeUndefined();
        expect(plain.digest).not.toBe(resolved.digest);

        await rm(dir, { recursive: true, force: true });
    });
});
