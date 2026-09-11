/**
 * Shared-catalog parity (task 0819 R5/R9): every shipped workflow definition
 * carries a non-empty top-level description, because `workflow list --json`
 * surfaces it as the catalog's intent text (`description` — null when absent).
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundledConfigRoot } from '@gobing-ai/spur-config/loader';
import { parse } from 'yaml';

describe('workflow catalog parity (task 0819 R5/R9)', () => {
    test('every shipped shared workflow definition has a non-empty top-level description', () => {
        // Resolve the shared root through the same accessor runtime code uses (ADR-015).
        const sharedRoot = bundledConfigRoot();
        if (sharedRoot === null)
            throw new Error('shared config root not resolved (run from repo or installed package)');
        const sharedDir = join(sharedRoot, 'workflows');
        const files = readdirSync(sharedDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
        expect(files.length).toBeGreaterThan(0);

        const missing: string[] = [];
        for (const file of files) {
            const doc = parse(readFileSync(join(sharedDir, file), 'utf8')) as { description?: unknown } | null;
            if (typeof doc?.description !== 'string' || doc.description.trim() === '') missing.push(file);
        }
        expect(missing).toEqual([]);
    });
});
