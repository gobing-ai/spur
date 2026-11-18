import { describe, expect, test } from 'bun:test';
import { MCP_BUILTIN_TOOL_NAMES } from '../../src/services/mcp-builtin-tools';

// The app-layer copy of the built-in names, read by `workflow validate` (task 1381 R4).
// Parity with the server's advertised descriptors is asserted server-side, which owns them.
describe('MCP_BUILTIN_TOOL_NAMES', () => {
    test('every built-in name is in the sp namespace and unique', () => {
        // Five read tools (1379) + five guarded corpus write tools (1392).
        expect(MCP_BUILTIN_TOOL_NAMES.length).toBe(10);
        for (const name of MCP_BUILTIN_TOOL_NAMES) expect(name.startsWith('sp_')).toBe(true);
        expect(new Set(MCP_BUILTIN_TOOL_NAMES).size).toBe(MCP_BUILTIN_TOOL_NAMES.length);
    });
});
