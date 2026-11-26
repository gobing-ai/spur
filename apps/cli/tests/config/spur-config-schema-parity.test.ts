import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spurConfigSchema } from '@gobing-ai/spur-config';
import { z } from 'zod';

// The hand-written JSON Schema mirrors the Zod SSOT (docs/design/configuration-contracts.md) and the
// CLI enforces it at load, so a key added to Zod but not here goes silently missing from IDE completion
// and from the runtime check. This walks every property path Zod accepts and requires it here too.
const SCHEMA_PATH = join(import.meta.dir, '../../schemas/spur-config.schema.json');

type JsonNode = Record<string, unknown>;

function propertyPaths(root: JsonNode): Set<string> {
    const out = new Set<string>();
    const deref = (node: unknown): JsonNode | undefined => {
        const n = node as JsonNode | undefined;
        if (typeof n?.$ref !== 'string') return n;
        return deref(
            n.$ref
                .split('/')
                .slice(1)
                .reduce<unknown>((o, k) => (o as JsonNode)[k], root),
        );
    };
    const walk = (node: unknown, path: string, depth: number): void => {
        const n = deref(node);
        if (n === undefined || depth > 10) return;
        for (const key of ['anyOf', 'oneOf', 'allOf']) {
            for (const branch of (n[key] as unknown[] | undefined) ?? []) walk(branch, path, depth + 1);
        }
        for (const [k, v] of Object.entries((n.properties as JsonNode | undefined) ?? {})) {
            out.add(`${path}.${k}`);
            walk(v, `${path}.${k}`, depth + 1);
        }
        if (n.items !== undefined) walk(n.items, `${path}[]`, depth + 1);
        if (typeof n.additionalProperties === 'object') walk(n.additionalProperties, `${path}.*`, depth + 1);
    };
    walk(root, '', 0);
    return out;
}

describe('spur-config.schema.json mirrors the Zod config schema', () => {
    test('every property path Zod accepts is declared in the JSON Schema', () => {
        const zodPaths = propertyPaths(
            z.toJSONSchema(spurConfigSchema, { io: 'input', unrepresentable: 'any' }) as JsonNode,
        );
        const handPaths = propertyPaths(JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as JsonNode);
        expect([...zodPaths].filter((p) => !handPaths.has(p))).toEqual([]);
    });
});
