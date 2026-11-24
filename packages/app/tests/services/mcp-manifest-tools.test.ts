import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createNodeFileSystem, parseYamlObject } from '@gobing-ai/ts-runtime';
import {
    buildManifestArgv,
    ManifestInvalidArgumentsError,
    type ManifestTool,
    manifestSchema,
    manifestToolDescriptor,
    resolveManifestTools,
} from '../../src/services/mcp-manifest-tools';

let root: string;

function writeManifest(namespace: string, body: string): string {
    const dir = join(root, 'plugins', namespace);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'mcp-tools.yaml');
    writeFileSync(file, body);
    return file;
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'spur-mcp-manifest-'));
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('manifestSchema & resolveManifestTools (R1, R2)', () => {
    test('missing manifest returns empty tools and no issues', async () => {
        const result = await resolveManifestTools({
            namespace: 'zz',
            projectRoot: root,
            fs: createNodeFileSystem(),
        });
        expect(result.tools).toEqual([]);
        expect(result.issues).toEqual([]);
    });

    test('AC1: valid manifest tool resolves with typed schema and annotations', async () => {
        writeManifest(
            'zz',
            `schema_version: 1
tools:
  - name: echo
    description: Echo a message.
    annotations:
      readOnlyHint: true
      destructiveHint: false
      idempotentHint: true
    params:
      msg:
        type: string
        description: Message text
        required: true
      loud:
        type: boolean
        description: Shout flag
    command: [printf, "%s"]
    args:
      msg: ["{value}"]
      loud: ["--loud"]
    output: text
    timeoutMs: 15000
`,
        );

        const result = await resolveManifestTools({
            namespace: 'zz',
            projectRoot: root,
            fs: createNodeFileSystem(),
        });
        expect(result.issues).toEqual([]);
        expect(result.tools).toHaveLength(1);
        const [tool] = result.tools;
        if (tool === undefined) throw new Error('expected resolved tool');
        expect(tool.tool).toBe('zz_echo');
        const desc = manifestToolDescriptor(tool);
        expect(desc.name).toBe('zz_echo');
        expect(desc.description).toBe('Echo a message.');
        expect(desc.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
        expect(desc.inputSchema).toEqual({
            type: 'object',
            properties: {
                msg: { type: 'string', description: 'Message text' },
                loud: { type: 'boolean', description: 'Shout flag' },
            },
            required: ['msg'],
            additionalProperties: false,
        });
    });

    test('AC2(a): unknown top-level key refuses the whole file with invalid-manifest', async () => {
        writeManifest(
            'zz',
            `schema_version: 1
extra_top_key: nope
tools:
  - name: ok_tool
    description: Should not load
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    command: [echo, hi]
`,
        );

        const result = await resolveManifestTools({
            namespace: 'zz',
            projectRoot: root,
            fs: createNodeFileSystem(),
        });
        expect(result.tools).toEqual([]);
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0]?.reason).toBe('invalid-manifest');
    });

    test('AC2(b): refuses builtin-collision, workflow duplicate, internal duplicate, and missing args fragment', async () => {
        writeManifest(
            'sp',
            `schema_version: 1
tools:
  - name: task_show
    description: Collides with built-in sp_task_show
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    command: [echo, hi]
  - name: daily_report
    description: Collides with exposed workflow sp_daily_report
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    command: [echo, hi]
  - name: dup_one
    description: First duplicate
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    command: [echo, one]
  - name: dup_one
    description: Second duplicate
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    command: [echo, two]
  - name: bad_args
    description: Missing args fragment for param
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    params:
      target: { type: string }
    command: [echo, hi]
  - name: clean_tool
    description: Valid tool in same manifest
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    command: [echo, ok]
`,
        );

        const result = await resolveManifestTools({
            namespace: 'sp',
            projectRoot: root,
            fs: createNodeFileSystem(),
            reserved: ['sp_task_show'],
            workflowTools: ['sp_daily_report'],
        });

        expect(result.tools.map((t) => t.tool)).toEqual(['sp_clean_tool']);
        const byTool = new Map<string, string[]>();
        for (const issue of result.issues) {
            const list = byTool.get(issue.tool) ?? [];
            list.push(issue.reason);
            byTool.set(issue.tool, list);
        }
        expect(byTool.get('sp_task_show')).toEqual(['builtin-collision']);
        expect(byTool.get('sp_daily_report')).toEqual(['duplicate']);
        expect(byTool.get('sp_dup_one')).toEqual(['duplicate', 'duplicate']);
        expect(byTool.get('sp_bad_args')).toEqual(['invalid-manifest']);
    });

    test('rejects placeholders in command, interpolated {value}, and boolean fragments with {value}', async () => {
        writeManifest(
            'zz',
            `schema_version: 1
tools:
  - name: cmd_placeholder
    description: Bad command
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    command: [echo, "{value}"]
  - name: interp_arg
    description: Bad interpolated arg
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    params:
      x: { type: string }
    command: [echo]
    args:
      x: ["--x={value}"]
  - name: bool_placeholder
    description: Bad boolean arg
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    params:
      flag: { type: boolean }
    command: [echo]
    args:
      flag: ["--flag", "{value}"]
`,
        );

        const result = await resolveManifestTools({
            namespace: 'zz',
            projectRoot: root,
            fs: createNodeFileSystem(),
        });
        expect(result.tools).toEqual([]);
        expect(result.issues).toHaveLength(3);
        expect(result.issues.every((i) => i.reason === 'invalid-manifest')).toBe(true);
    });

    test('handles YAML syntax errors and invalid tool entry schemas without throwing', async () => {
        writeManifest('zz', 'schema_version: 1\ntools: [\n');
        const syntaxResult = await resolveManifestTools({
            namespace: 'zz',
            projectRoot: root,
            fs: createNodeFileSystem(),
        });
        expect(syntaxResult.tools).toEqual([]);
        expect(syntaxResult.issues[0]?.reason).toBe('invalid-manifest');

        writeManifest(
            'zz',
            `schema_version: 1
tools:
  - name: BAD-NAME
    description: Invalid name and missing annotations
    command: [echo, hi]
`,
        );
        const entryResult = await resolveManifestTools({
            namespace: 'zz',
            projectRoot: root,
            fs: createNodeFileSystem(),
        });
        expect(entryResult.tools).toEqual([]);
        expect(entryResult.issues[0]?.reason).toBe('invalid-manifest');
    });
});

describe('buildManifestArgv (R3, AC3)', () => {
    const echoTool: ManifestTool = {
        tool: 'zz_echo',
        name: 'echo',
        file: '/tmp/mcp-tools.yaml',
        description: 'Echo',
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        params: {
            msg: { type: 'string', required: true },
            loud: { type: 'boolean' },
            mode: { type: 'string', enum: ['--fast', 'normal'], default: 'normal' },
            count: { type: 'number' },
        },
        command: ['printf', '%s'],
        args: {
            msg: ['{value}'],
            loud: ['--loud'],
            mode: ['--mode', '{value}'],
            count: ['--count', '{value}'],
        },
        output: 'text',
        timeoutMs: 30000,
    };

    test('AC3: binds shell metacharacters as one literal argv element and omits false booleans', () => {
        const argv = buildManifestArgv(echoTool, { msg: 'a; rm -rf ~ $(id)', loud: false });
        expect(argv).toEqual(['printf', '%s', 'a; rm -rf ~ $(id)', '--mode', 'normal']);
    });

    test('appends boolean fragment when true, supports number and enum starting with -', () => {
        const argv = buildManifestArgv(echoTool, { msg: 'hello', loud: true, mode: '--fast', count: 3 });
        expect(argv).toEqual(['printf', '%s', 'hello', '--loud', '--mode', '--fast', '--count', '3']);
    });

    test('AC3: refuses leading dash on non-enum string, unknown key, wrong type, missing required, >1024 chars', () => {
        expect(() => buildManifestArgv(echoTool, { msg: '--evil' })).toThrow(ManifestInvalidArgumentsError);
        expect(() => buildManifestArgv(echoTool, { msg: 'ok', extra: 'nope' })).toThrow(ManifestInvalidArgumentsError);
        expect(() => buildManifestArgv(echoTool, { msg: 'ok', loud: 'yes' })).toThrow(ManifestInvalidArgumentsError);
        expect(() => buildManifestArgv(echoTool, {})).toThrow(ManifestInvalidArgumentsError);
        expect(() => buildManifestArgv(echoTool, { msg: 'a'.repeat(1025) })).toThrow(ManifestInvalidArgumentsError);
        expect(() => buildManifestArgv(echoTool, { msg: 'ok', mode: 'invalid' })).toThrow(
            ManifestInvalidArgumentsError,
        );
    });
});

describe('R6 dogfood manifest & JSON Schema parity', () => {
    test('plugins/sp/mcp-tools.yaml validates against manifestSchema and apps/cli/schemas/mcp-tools.schema.json exists with matching constraints', () => {
        const repoRoot = resolve(import.meta.dir, '../../../..');
        const manifestRaw = readFileSync(join(repoRoot, 'plugins/sp/mcp-tools.yaml'), 'utf8');
        const parsed = manifestSchema.safeParse(parseYamlObject(manifestRaw));
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.tools.map((t) => t.name)).toContain('plugin_smoke');
        }

        const schemaJson = JSON.parse(
            readFileSync(join(repoRoot, 'apps/cli/schemas/mcp-tools.schema.json'), 'utf8'),
        ) as {
            required?: string[];
            additionalProperties?: boolean;
            properties?: {
                schema_version?: { const?: number };
                tools?: { items?: { required?: string[]; additionalProperties?: boolean } };
            };
        };
        expect(schemaJson.required).toEqual(['schema_version', 'tools']);
        expect(schemaJson.additionalProperties).toBe(false);
        expect(schemaJson.properties?.schema_version?.const).toBe(1);
        expect(schemaJson.properties?.tools?.items?.required).toEqual([
            'name',
            'description',
            'annotations',
            'command',
        ]);
        expect(schemaJson.properties?.tools?.items?.additionalProperties).toBe(false);
    });
});
