import { describe, expect, test } from 'bun:test';
import type { AgentExecutorConfig } from '@gobing-ai/spur-config';
import {
    capabilityDiagnostic,
    capabilityEvidence,
    evaluateCapabilities,
    executorAttestation,
    parseRequiresCapabilities,
    satisfiesRequirement,
    UNATTESTED_CAPABILITY,
} from '../../src/services/capability-attestation';
import { CAPABILITY_BLOCK_PREFIX } from '../../src/workflow/tripwire';

// Task 0706: shared executor-capability comparison. Table-driven monotonic
// satisfaction + fail-closed unknown handling are the core claims (R2/R5).

describe('satisfiesRequirement (0706 monotonic rule)', () => {
    const matrix: Array<[required: 'available' | 'enforced', state: string, satisfied: boolean]> = [
        ['available', 'enforced', true],
        ['available', 'available', true],
        ['available', 'unavailable', false],
        ['available', 'unknown', false],
        ['enforced', 'enforced', true],
        ['enforced', 'available', false],
        ['enforced', 'unavailable', false],
        ['enforced', 'unknown', false],
    ];
    for (const [required, state, satisfied] of matrix) {
        test(`required=${required} state=${state} -> ${satisfied}`, () => {
            expect(satisfiesRequirement(required, state as never)).toBe(satisfied);
        });
    }
});

describe('executorAttestation (0706 R2 missing-data rule)', () => {
    test('absent executor entry attests unknown/unattested on every axis', () => {
        const attestation = executorAttestation(undefined);
        expect(attestation.fsRead).toEqual(UNATTESTED_CAPABILITY);
        expect(attestation.externalMutationApproval).toEqual(UNATTESTED_CAPABILITY);
    });

    test('partial declaration fills only undeclared axes with unknown', () => {
        const executor = {
            name: 'e1',
            agent: 'pi',
            executionCapabilities: {
                version: 1,
                axes: { fsWrite: { state: 'enforced', provenance: 'operator-configured' } },
            },
        } as unknown as AgentExecutorConfig;
        const attestation = executorAttestation(executor);
        expect(attestation.fsWrite).toEqual({ state: 'enforced', provenance: 'operator-configured' });
        expect(attestation.fsRead).toEqual(UNATTESTED_CAPABILITY);
        expect(attestation.networkEgress).toEqual(UNATTESTED_CAPABILITY);
    });
});

describe('evaluateCapabilities (0706 R5 compare-before-spawn input)', () => {
    test('unattested executor fails a requirement closed with provenance evidence', () => {
        const evaluation = evaluateCapabilities({ fsWrite: 'available' }, undefined);
        expect(evaluation.ok).toBe(false);
        const entry = evaluation.entries.find((e) => e.axis === 'fsWrite');
        expect(entry).toMatchObject({
            required: 'available',
            state: 'unknown',
            provenance: 'unattested',
            satisfied: false,
        });
    });

    test('enforced attestation satisfies both requirement levels', () => {
        const executor = {
            name: 'e1',
            agent: 'pi',
            executionCapabilities: {
                version: 1,
                axes: {
                    fsWrite: { state: 'enforced', provenance: 'native-known' },
                    processSpawn: { state: 'available', provenance: 'operator-configured' },
                },
            },
        } as unknown as AgentExecutorConfig;
        const enforced = evaluateCapabilities({ fsWrite: 'enforced' }, executor);
        expect(enforced.ok).toBe(true);
        const availableOnly = evaluateCapabilities({ processSpawn: 'available' }, executor);
        expect(availableOnly.ok).toBe(true);
        // available does NOT satisfy an enforcement requirement (monotonicity).
        const escalated = evaluateCapabilities({ processSpawn: 'enforced' }, executor);
        expect(escalated.ok).toBe(false);
    });

    test('entries iterate the closed axis vocabulary in declaration order', () => {
        const evaluation = evaluateCapabilities({}, undefined);
        expect(evaluation.ok).toBe(true);
        expect(evaluation.entries.map((e) => e.axis)).toEqual([
            'fsRead',
            'fsWrite',
            'networkEgress',
            'processSpawn',
            'externalMutationApproval',
        ]);
    });
});

describe('capabilityDiagnostic (0706 R5 axis-by-axis failure text)', () => {
    test('names executor, required state, actual state, and provenance per failing axis', () => {
        const executor = {
            name: 'unattested-exec',
            agent: 'pi',
        } as unknown as AgentExecutorConfig;
        const evaluation = evaluateCapabilities(
            { externalMutationApproval: 'enforced', fsWrite: 'available' },
            executor,
        );
        const diagnostic = capabilityDiagnostic('unattested-exec', evaluation);
        expect(diagnostic).toContain('unattested-exec');
        expect(diagnostic).toContain(
            'externalMutationApproval: required=enforced actual=unknown provenance=unattested',
        );
        expect(diagnostic).toContain('fsWrite: required=available actual=unknown provenance=unattested');
        expect(diagnostic).not.toContain('fsRead:');
    });
});

describe('capabilityEvidence (0706 R7 bounded redacted payload)', () => {
    test('carries identifiers/states only — no config blobs', () => {
        const executor = {
            name: 'e1',
            agent: 'pi',
            model: 'secret-model-name',
            executionCapabilities: {
                version: 1,
                axes: { fsWrite: { state: 'enforced', provenance: 'operator-configured' } },
            },
        } as unknown as AgentExecutorConfig;
        const evidence = capabilityEvidence(evaluateCapabilities({ fsWrite: 'available' }, executor));
        const serialized = JSON.stringify(evidence);
        expect(serialized).not.toContain('secret-model-name');
        expect(evidence).toEqual([
            { axis: 'fsRead', state: 'unknown', provenance: 'unattested', satisfied: true },
            {
                axis: 'fsWrite',
                required: 'available',
                state: 'enforced',
                provenance: 'operator-configured',
                satisfied: true,
            },
            { axis: 'networkEgress', state: 'unknown', provenance: 'unattested', satisfied: true },
            { axis: 'processSpawn', state: 'unknown', provenance: 'unattested', satisfied: true },
            { axis: 'externalMutationApproval', state: 'unknown', provenance: 'unattested', satisfied: true },
        ]);
    });
});

describe('parseRequiresCapabilities (0706 R4/R8 closed vocabulary)', () => {
    test('undefined → empty requirements (backward compatibility)', () => {
        expect(parseRequiresCapabilities(undefined)).toEqual({ ok: true, requires: {} });
    });

    test('valid axis/level map parses', () => {
        expect(parseRequiresCapabilities({ fsWrite: 'available', processSpawn: 'enforced' })).toEqual({
            ok: true,
            requires: { fsWrite: 'available', processSpawn: 'enforced' },
        });
    });

    test('unknown axis is rejected by name', () => {
        const parsed = parseRequiresCapabilities({ sandbox: 'available' });
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) expect(parsed.error).toContain('sandbox');
    });

    test('invalid level is rejected', () => {
        const parsed = parseRequiresCapabilities({ fsWrite: 'unknown' });
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) expect(parsed.error).toContain('fsWrite');
    });
});

describe('capabilityDiagnostic trip-wire seam guard (0708 R8)', () => {
    // agent-run detects capability denials via CAPABILITY_BLOCK_PREFIX against
    // this diagnostic's lead — a reworded lead would silently stop the wire.
    test('diagnostic lead stays in lockstep with CAPABILITY_BLOCK_PREFIX', () => {
        const evaluation = evaluateCapabilities({ fsWrite: 'available' }, undefined);
        const diagnostic = capabilityDiagnostic('claude/spec', evaluation);
        expect(diagnostic.startsWith(CAPABILITY_BLOCK_PREFIX)).toBe(true);
    });
});
