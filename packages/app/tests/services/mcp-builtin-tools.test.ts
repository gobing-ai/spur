import { describe, expect, test } from 'bun:test';
import { MCP_BUILTIN_TOOL_NAMES } from '../../src/services/mcp-builtin-tools';

// The app-layer copy of the built-in names, read by `workflow validate` (task 1381 R4).
// Parity with the server's advertised descriptors is asserted server-side, which owns them.
describe('MCP_BUILTIN_TOOL_NAMES', () => {
    test('every built-in name is in the sp namespace and unique', () => {
        // The count is not asserted here: the descriptors own it, and the server-side parity test
        // compares this list against them.
        for (const name of MCP_BUILTIN_TOOL_NAMES) expect(name.startsWith('sp_')).toBe(true);
        expect(new Set(MCP_BUILTIN_TOOL_NAMES).size).toBe(MCP_BUILTIN_TOOL_NAMES.length);
    });
});
