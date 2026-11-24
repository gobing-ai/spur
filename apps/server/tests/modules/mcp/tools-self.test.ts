/**
 * Task 1445 R7 — the `tools-self` module's own contract: every descriptor it exports has a handler
 * in its dispatch map, and no handler is unreachable. What each handler does is asserted where the
 * dispatcher is (tests/modules/mcp-module.test.ts), so this file stays a composition check.
 */
import { describe, expect, test } from 'bun:test';
import { descriptors, dispatch } from '../../../src/modules/mcp/tools-self';

describe('mcp tools-self', () => {
    test('descriptors and dispatch name the same tools', () => {
        expect(descriptors.length).toBeGreaterThan(0);
        expect(descriptors.map((tool) => tool.name).sort()).toEqual(Object.keys(dispatch).sort());
    });
});
