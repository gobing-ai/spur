import { describe, expect, test } from 'bun:test';
import { formatWorkflowVersion } from '../../src/commands/workflow';

// Task 0756 R2 / R6: the workflow version literal is opaque — not parsed,
// ordered, or compared for compatibility. The reporting contract is:
// absent / empty / non-string → `unversioned`; present non-empty literal →
// `explicit(<literal>)`. The literal is wrapped in parentheses verbatim so
// non-semver strings surface unchanged (no parsing happens anywhere in the
// code path).

describe('formatWorkflowVersion (0756 R2)', () => {
    test('absent version reports as unversioned', () => {
        expect(formatWorkflowVersion(undefined)).toBe('unversioned');
    });

    test('null reports as unversioned (defensive — schema rejects null at the boundary)', () => {
        expect(formatWorkflowVersion(null)).toBe('unversioned');
    });

    test('empty string reports as unversioned (defensive — schema rejects "" at the boundary)', () => {
        expect(formatWorkflowVersion('')).toBe('unversioned');
    });

    test('non-string reports as unversioned (defensive — schema rejects at the boundary)', () => {
        expect(formatWorkflowVersion(42)).toBe('unversioned');
        expect(formatWorkflowVersion({})).toBe('unversioned');
        expect(formatWorkflowVersion(true)).toBe('unversioned');
    });

    test('non-empty literal reports verbatim as explicit(<literal>)', () => {
        expect(formatWorkflowVersion('1.0.0')).toBe('explicit(1.0.0)');
        expect(formatWorkflowVersion('2024-09-03')).toBe('explicit(2024-09-03)');
        expect(formatWorkflowVersion('v0')).toBe('explicit(v0)');
    });

    test('non-semver strings are accepted and surfaced verbatim (no parsing)', () => {
        // The literal is opaque. A nonsense string still surfaces unchanged.
        expect(formatWorkflowVersion('not-a-semver')).toBe('explicit(not-a-semver)');
        expect(formatWorkflowVersion('arbitrary tag with spaces')).toBe('explicit(arbitrary tag with spaces)');
    });
});
