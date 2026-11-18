import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { resolveExposedWorkflowTools, workflowToolName } from '../../src/services/mcp-workflow-tools';

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
});
