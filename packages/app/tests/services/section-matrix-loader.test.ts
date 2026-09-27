import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSectionMatrix } from '../../src/services/section-matrix-loader';

const SCHEMA_SUBPATH = 'schemas/section-matrix.schema.json';

/** A minimal section-matrix schema: `variants` is the only required field. */
const EMBEDDED_SCHEMAS = new Map<string, string>([
    [
        SCHEMA_SUBPATH,
        JSON.stringify({
            $schema: 'http://json-schema.org/draft-07/schema#',
            type: 'object',
            required: ['variants'],
            properties: { variants: { type: 'object' } },
        }),
    ],
]);

const SCHEMA_DECLARATION = '$schema: "@gobing-ai/spur/schemas/section-matrix.schema.json"';

function seedProject(yaml?: string): { root: string; cleanup(): void } {
    const root = mkdtempSync(join(tmpdir(), 'spur-matrix-test-'));
    if (yaml !== undefined) {
        mkdirSync(join(root, '.spur', 'tasks'), { recursive: true });
        writeFileSync(join(root, '.spur', 'tasks', 'section-matrix.yaml'), yaml);
    }
    return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe('loadSectionMatrix', () => {
    test('project-local `.spur/tasks/section-matrix.yaml` wins over the bundled asset', async () => {
        const { root, cleanup } = seedProject(
            `${SCHEMA_DECLARATION}\nvariants:\n  local-only:\n    todo:\n      required: [Background]\n`,
        );
        const matrix = await loadSectionMatrix(root);
        expect(Object.keys(matrix.variants)).toContain('local-only');
        cleanup();
    });

    test('falls back to the bundled canonical matrix when no project-local asset exists', async () => {
        const { root, cleanup } = seedProject();
        const matrix = await loadSectionMatrix(root);
        // The canonical matrix is a full variant tree, not the local-only stub.
        expect(Object.keys(matrix.variants)).toContain('standard');
        expect(Object.keys(matrix.variants)).not.toContain('local-only');
        cleanup();
    });

    test('caches per (root, validation mode) — two calls share one promise', async () => {
        const { root, cleanup } = seedProject();
        const a = loadSectionMatrix(root);
        const b = loadSectionMatrix(root);
        expect(a === b).toBe(true);
        const validated = loadSectionMatrix(root, { embeddedSchemas: EMBEDDED_SCHEMAS });
        expect(validated === a).toBe(false);
        cleanup();
    });

    test('validates the document when `embeddedSchemas` is given', async () => {
        const { root, cleanup } = seedProject(`${SCHEMA_DECLARATION}\nvariants:\n  standard: {}\n`);
        const matrix = await loadSectionMatrix(root, { embeddedSchemas: EMBEDDED_SCHEMAS });
        expect(Object.keys(matrix.variants)).toEqual(['standard']);
        cleanup();
    });

    test('rejects a document that violates the schema when `embeddedSchemas` is given', async () => {
        // No `variants` key → the schema requires it.
        const { root, cleanup } = seedProject(`${SCHEMA_DECLARATION}\nother: true\n`);
        await expect(loadSectionMatrix(root, { embeddedSchemas: EMBEDDED_SCHEMAS })).rejects.toThrow();
        cleanup();
    });

    test('keeps the unvalidated load when no `embeddedSchemas` is given (server policy)', async () => {
        const { root, cleanup } = seedProject(`${SCHEMA_DECLARATION}\nother: true\n`);
        // The same document that failed validation above loads raw — the caller's
        // existing policy is preserved, not upgraded behind its back.
        const matrix = await loadSectionMatrix(root);
        expect(matrix).toBeDefined();
        cleanup();
    });

    test('fails loudly naming the paths tried when no bundled tree exists (compile layout)', async () => {
        const { root, cleanup } = seedProject();
        const promise = loadSectionMatrix(root, { bundledRoot: () => null });
        await expect(promise).rejects.toThrow(/no canonical section-matrix found for task section authority/);
        // The message must name the local path the loader actually probed.
        await expect(promise).rejects.toThrow(join(root, '.spur', 'tasks', 'section-matrix.yaml'));
        cleanup();
    });
});
