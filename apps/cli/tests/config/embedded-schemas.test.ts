import { describe, expect, test } from 'bun:test';
import { EMBEDDED_SPUR_SCHEMAS } from '../../src/config/embedded-schemas';

describe('EMBEDDED_SPUR_SCHEMAS', () => {
    test('registers the spur-config and section-matrix schemas by their package subpath', () => {
        // The loader keys embedded schemas by `schemas/<name>.schema.json` — the subpath
        // under the package root that a `@gobing-ai/spur/schemas/...` $schema ref resolves to.
        expect(EMBEDDED_SPUR_SCHEMAS.has('schemas/spur-config.schema.json')).toBe(true);
        expect(EMBEDDED_SPUR_SCHEMAS.has('schemas/section-matrix.schema.json')).toBe(true);
    });

    test('each entry is valid JSON Schema text the loader can re-parse', () => {
        // The loader serves these as raw text to ts-runtime, which JSON.parses them.
        // A malformed entry would crash schema validation at runtime, not at import — so
        // assert every registered value round-trips through JSON.parse to a schema object.
        for (const [subpath, text] of EMBEDDED_SPUR_SCHEMAS) {
            const parsed = JSON.parse(text) as Record<string, unknown>;
            expect(typeof parsed).toBe('object');
            expect(parsed).not.toBeNull();
            // A JSON Schema document declares a type or composition keyword at its root.
            const hasSchemaShape =
                'type' in parsed || '$schema' in parsed || 'properties' in parsed || 'allOf' in parsed;
            expect(hasSchemaShape, `${subpath} does not look like a JSON Schema`).toBe(true);
        }
    });
});
