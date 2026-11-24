import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    resolveExposedWorkflowTools,
    resolveProjectMcpTools,
    workflowToolDescriptor,
    workflowToolName,
} from '../../src/services/mcp-workflow-tools';

// Task 1381 R2/R4: one resolver derives exposed workflow tools, so `workflow validate`
// and the MCP `tools/list` can never disagree about a name.

let root: string;
let shared: string;

const EXPOSED = (name: string, extra = '') => `name: ${name}
description: ${name} tool
kind: state-machine
metadata:
  mcp:
    expose: true
vars:
  target: default-target
${extra}initialState: start
states:
  - id: start
  - id: done
transitions:
  - from: start
    to: done
    guard: { kind: always }
terminalStates:
  - done
`;

const HIDDEN = `name: hidden-flow
kind: state-machine
initialState: start
states:
  - id: start
terminalStates:
  - start
`;

function writeWorkflow(dir: string, file: string, body: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), body);
}

function resolve(namespace: string | null, reserved: readonly string[] = []) {
    return resolveExposedWorkflowTools({
        namespace,
        reserved,
        roots: [join(root, '.spur', 'workflows'), shared],
        fs: createNodeFileSystem(),
    });
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'spur-mcp-wf-tools-'));
    shared = join(root, 'shared', 'workflows');
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('workflowToolName', () => {
    test('derives <namespace>_<name> with - mapped to _ and lowercase', () => {
        expect(workflowToolName('cc', 'daily-report')).toBe('cc_daily_report');
        expect(workflowToolName('kk', 'Daily_Report')).toBe('kk_daily_report');
    });
});

describe('resolveExposedWorkflowTools', () => {
    test('R2: lists an opted-in workflow with description and declared var defaults', async () => {
        writeWorkflow(join(root, '.spur', 'workflows'), 'daily.yaml', EXPOSED('daily-report'));
        writeWorkflow(join(root, '.spur', 'workflows'), 'hidden.yaml', HIDDEN);
        const { tools, issues } = await resolve('cc');
        expect(issues).toEqual([]);
        expect(tools.map((tool) => tool.tool)).toEqual(['cc_daily_report']);
        const [tool] = tools;
        expect(tool?.workflow).toBe('daily-report');
        expect(tool?.description).toBe('daily-report tool');
        expect(tool?.vars).toEqual({ target: 'default-target' });
        expect(tool?.file.endsWith('daily.yaml')).toBe(true);
    });

    test('R2: a workflow without metadata.mcp.expose is never listed', async () => {
        writeWorkflow(join(root, '.spur', 'workflows'), 'hidden.yaml', HIDDEN);
        const { tools, issues } = await resolve('cc');
        expect(tools).toEqual([]);
        expect(issues).toEqual([]);
    });

    test('R4(a): an exposed workflow in a project without a namespace is an issue, not a tool', async () => {
        writeWorkflow(join(root, '.spur', 'workflows'), 'daily.yaml', EXPOSED('daily-report'));
        const { tools, issues } = await resolve(null);
        expect(tools).toEqual([]);
        expect(issues).toHaveLength(1);
        expect(issues[0]?.reason).toBe('no-namespace');
        expect(issues[0]?.remedy).toContain('SPUR_MCP_NAMESPACE');
    });

    test('R4(a): a shared-layer opt-in without a namespace is skipped silently; a project one is still refused', async () => {
        writeWorkflow(shared, 'anatomy.yaml', EXPOSED('history-anatomy'));
        writeWorkflow(join(root, '.spur', 'workflows'), 'daily.yaml', EXPOSED('daily-report'));
        const { tools, issues } = await resolveExposedWorkflowTools({
            namespace: null,
            reserved: [],
            roots: [join(root, '.spur', 'workflows'), shared],
            sharedRoots: [shared],
            fs: createNodeFileSystem(),
        });
        expect(tools).toEqual([]);
        expect(issues).toHaveLength(1);
        expect(issues[0]?.file.endsWith('daily.yaml')).toBe(true);
        expect(issues[0]?.reason).toBe('no-namespace');
    });

    test('R4(b): a tool name equal to a built-in is refused with the reason and both names', async () => {
        writeWorkflow(join(root, '.spur', 'workflows'), 'task-show.yaml', EXPOSED('task-show'));
        const { tools, issues } = await resolve('cc', ['cc_task_show', 'sp_task_show']);
        expect(tools).toEqual([]);
        expect(issues[0]?.reason).toBe('builtin-collision');
        expect(issues[0]?.tool).toBe('cc_task_show');
    });

    test('R4(c): two workflows deriving the same tool name are both refused', async () => {
        writeWorkflow(join(root, '.spur', 'workflows'), 'a-b.yaml', EXPOSED('a-b'));
        writeWorkflow(shared, 'a_b.yaml', EXPOSED('a_b'));
        const { tools, issues } = await resolve('cc');
        expect(tools).toEqual([]);
        expect(issues.map((issue) => issue.reason)).toEqual(['duplicate', 'duplicate']);
        expect(new Set(issues.map((issue) => issue.tool))).toEqual(new Set(['cc_a_b']));
    });

    test('R2: workflows are discovered across every configured root', async () => {
        writeWorkflow(join(root, '.spur', 'workflows'), 'one.yaml', EXPOSED('one'));
        writeWorkflow(shared, 'two.yaml', EXPOSED('two'));
        const { tools } = await resolve('cc');
        expect(tools.map((tool) => tool.tool)).toEqual(['cc_one', 'cc_two']);
    });

    test('an unparseable workflow file is skipped, not fatal', async () => {
        writeWorkflow(join(root, '.spur', 'workflows'), 'broken.yaml', 'name: broken\nstates: [\n');
        writeWorkflow(join(root, '.spur', 'workflows'), 'daily.yaml', EXPOSED('daily-report'));
        const { tools, issues } = await resolve('cc');
        expect(tools.map((tool) => tool.tool)).toEqual(['cc_daily_report']);
        expect(issues).toEqual([]);
    });

    test('AC5: typed metadata.mcp.params builds allowlisted typed descriptor while legacy opt-in stays unchanged', async () => {
        const typedYaml = `name: typed-flow
description: Typed report
kind: state-machine
metadata:
  mcp:
    expose: true
    params:
      mode:
        type: string
        enum: [daily, ad-hoc]
        required: true
        description: Report mode
      recompute:
        type: boolean
vars:
  mode: daily
  recompute: "false"
  spurBin: spur
  output: ""
initialState: start
states:
  - id: start
terminalStates:
  - start
`;
        writeWorkflow(join(root, '.spur', 'workflows'), 'typed.yaml', typedYaml);
        writeWorkflow(join(root, '.spur', 'workflows'), 'legacy.yaml', EXPOSED('legacy-flow'));

        const { tools, issues } = await resolve('cc');
        expect(issues).toEqual([]);
        const typed = tools.find((t) => t.tool === 'cc_typed_flow');
        const legacy = tools.find((t) => t.tool === 'cc_legacy_flow');
        if (typed === undefined || legacy === undefined) throw new Error('expected typed and legacy tools');

        const typedDesc = workflowToolDescriptor(typed);
        expect(typedDesc.inputSchema).toEqual({
            type: 'object',
            properties: {
                mode: { type: 'string', enum: ['daily', 'ad-hoc'], description: 'Report mode' },
                recompute: { type: 'boolean' },
            },
            required: ['mode'],
            additionalProperties: false,
        });
        expect(typedDesc.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });

        const legacyDesc = workflowToolDescriptor(legacy);
        expect(legacyDesc.inputSchema).toEqual({
            type: 'object',
            properties: { target: { type: 'string', default: 'default-target' } },
            additionalProperties: false,
        });
        expect(legacyDesc.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    });

    test('AC5: metadata.mcp.params key absent from vars refuses workflow with invalid-params', async () => {
        const badParamsYaml = `name: bad-params
kind: state-machine
metadata:
  mcp:
    expose: true
    params:
      ghost:
        type: string
vars:
  real: "1"
initialState: start
states:
  - id: start
terminalStates:
  - start
`;
        writeWorkflow(join(root, '.spur', 'workflows'), 'bad-params.yaml', badParamsYaml);
        const { tools, issues } = await resolve('cc');
        expect(tools).toEqual([]);
        expect(issues).toHaveLength(1);
        expect(issues[0]?.reason).toBe('invalid-params');
        expect(issues[0]?.tool).toBe('cc_bad_params');
    });

    test('R5: resolveProjectMcpTools combines workflow and manifest tools with workflow winning collisions', async () => {
        writeWorkflow(join(root, '.spur', 'workflows'), 'shared.yaml', EXPOSED('shared'));
        mkdirSync(join(root, 'plugins', 'cc'), { recursive: true });
        writeFileSync(
            join(root, 'plugins', 'cc', 'mcp-tools.yaml'),
            `schema_version: 1
tools:
  - name: shared
    description: Clashes with workflow
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    command: [echo, clash]
  - name: ping
    description: Manifest ping
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    command: [echo, pong]
`,
        );
        const combined = await resolveProjectMcpTools({
            cwd: root,
            config: null,
            namespace: 'cc',
            fs: createNodeFileSystem(),
        });
        expect(combined.workflowTools.map((t) => t.tool)).toContain('cc_shared');
        expect(combined.manifestTools.map((t) => t.tool)).toEqual(['cc_ping']);
        expect(combined.issues).toHaveLength(1);
        expect(combined.issues[0]?.tool).toBe('cc_shared');
        expect(combined.issues[0]?.reason).toBe('duplicate');
    });
});
