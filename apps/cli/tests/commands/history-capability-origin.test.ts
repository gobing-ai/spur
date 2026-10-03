/**
 * `--capability-origin` flag parsing (E93 task 1029) — including the canonicalization
 * contract the live-replay verification surfaced: the importer matches origins against
 * the CANONICAL skill name (canonicalizeSkillName rewrites harness names `sp-demo` ->
 * `sp:demo`, mappers.ts HARNESS_SKILL_PACKAGES), and matchCapabilityOrigin compares the
 * origin's skillName verbatim (capability.ts:89). The flag must therefore canonicalize,
 * or a non-canonical value silently never classifies.
 */
import { describe, expect, test } from 'bun:test';
import { parseCapabilityOriginSpec } from '../../src/commands/history';

const DIGEST = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

describe('parseCapabilityOriginSpec', () => {
    test('valid five-part spec round-trips every field', () => {
        const origin = parseCapabilityOriginSpec(`claude:my-tool:${DIGEST}:command:ident-1`);
        expect(origin).toEqual({
            source: 'claude',
            skillName: 'my-tool',
            artifactDigest: DIGEST,
            capabilityKind: 'command',
            originIdentity: 'ident-1',
        });
    });

    test('harness skill names canonicalize like the importer (`sp-demo` -> `sp:demo`)', () => {
        expect(parseCapabilityOriginSpec(`claude:sp-demo:${DIGEST}:subagent:ident-2`).skillName).toBe('sp:demo');
        expect(parseCapabilityOriginSpec(`claude:$sp-demo:${DIGEST}:subagent:ident-2`).skillName).toBe('sp:demo');
        expect(parseCapabilityOriginSpec(`claude:/skill:sp-demo:${DIGEST}:subagent:ident-2`).skillName).toBe('sp:demo');
    });

    test('non-harness names stay verbatim (exact structural match contract)', () => {
        expect(parseCapabilityOriginSpec(`codex:code-review:${DIGEST}:skill:ident-3`).skillName).toBe('code-review');
        expect(parseCapabilityOriginSpec(`claude:sp:demo:${DIGEST}:command:ident-4`).skillName).toBe('sp:demo');
    });

    test('malformed specs are usage errors, never silent skips', () => {
        expect(() => parseCapabilityOriginSpec('claude:sp-demo:not-a-digest:command:ident')).toThrow();
        expect(() => parseCapabilityOriginSpec(`claude:sp-demo:${DIGEST}:bogus-kind:ident`)).toThrow();
        expect(() => parseCapabilityOriginSpec(`claude::${DIGEST}:command:ident`)).toThrow();
        expect(() => parseCapabilityOriginSpec(`claude:sp-demo:${DIGEST.toUpperCase()}:command:ident`)).toThrow();
    });

    test('wrong part count names the expected shape', () => {
        expect(() => parseCapabilityOriginSpec('claude:sp-demo:command:ident')).toThrow(
            /source:skillName:artifactDigest:capabilityKind:originIdentity.*got 4 parts/,
        );
    });
});
