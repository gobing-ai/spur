/**
 * Task 1445 R7 — the shared plumbing the domain modules reuse. The dispatcher tests exercise it
 * end to end (`tests/modules/mcp-module.test.ts`); this file pins the pure validators' own
 * contract: which argument shapes pass, and the message a refusal carries.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { projectFile, toolErrorCode, validateToolArguments } from '../../../src/modules/mcp/tools-shared';

const TOOL = {
    name: 'sp_probe',
    description: 'probe',
    inputSchema: {
        type: 'object',
        properties: {
            wbs: { type: 'string' },
            op: { type: 'string', enum: ['list', 'add'] },
            values: { type: 'array', items: { type: 'string' } },
        },
        required: ['wbs'],
        additionalProperties: false,
    },
} as const;

describe('mcp tools-shared', () => {
    test('an undeclared argument is refused with the accepted set', () => {
        expect(validateToolArguments(TOOL, { wbs: '1', bogus: true })).toBe(
            'unknown argument "bogus"; accepted: wbs, op, values',
        );
    });

    test('a missing required argument, a bad enum value and a wrong type each name the key', () => {
        expect(validateToolArguments(TOOL, {})).toBe('wbs is required');
        expect(validateToolArguments(TOOL, { wbs: '1', op: 'nope' })).toBe('op must be one of list, add');
        expect(validateToolArguments(TOOL, { wbs: '1', values: 'x' })).toBe('values must be an array');
    });

    test('a schema-valid call passes and an unknown tool name stays unknown_tool', () => {
        expect(validateToolArguments(TOOL, { wbs: '1', op: 'add', values: ['2'] })).toBeNull();
        expect(toolErrorCode(new Error('unknown tool "x"'))).toBe('unknown_tool');
        expect(toolErrorCode(new Error('boom'))).toBe('tool_error');
    });

    test('projectFile confines a rule path to the project root', () => {
        const root = join('/', 'tmp', 'probe-root');
        expect(projectFile(root, 'rules/local.yaml')).toBe(join(root, 'rules', 'local.yaml'));
        expect(() => projectFile(root, '../escape.yaml')).toThrow('must be inside the project');
    });
});
