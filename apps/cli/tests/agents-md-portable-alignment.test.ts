/**
 * Portable AGENTS.md harness alignment (task 0242 R1).
 *
 * Fails when root AGENTS.md and the bundled AGENTS seed (spur init template)
 * diverge on shared structure (H2 headings, routing Need keys, platform/long-tail anchors).
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    PORTABLE_AGENTS_ANCHORS,
    PORTABLE_AGENTS_H2,
    PORTABLE_ROUTING_NEED_KEYS,
} from './fixtures/agents-md-portable-contract';

/** Repo root: apps/cli/tests → apps/cli → repo. */
const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

/** Build-time bundled AGENTS seed path (split segments avoid sp-runtime-path literal). */
const BUNDLED_AGENTS_SEED = join(REPO_ROOT, 'config', 'templates', 'AGENTS.md');

function readAgents(label: string, absPath: string): string {
    expect(existsSync(absPath), `missing ${label} at ${absPath}`).toBe(true);
    return readFileSync(absPath, 'utf-8');
}

/** Collect H2 headings (`## …`) from markdown. */
function extractH2(content: string): string[] {
    return content
        .split('\n')
        .map((line) => line.trimEnd())
        .filter((line) => /^## [^#]/.test(line));
}

/**
 * Extract the first column of the markdown table under `### Harness tool routing`
 * until the next heading.
 */
function extractRoutingNeedKeys(content: string): string[] {
    const lines = content.split('\n');
    const start = lines.findIndex((line) => line.trim() === '### Harness tool routing');
    expect(start, 'missing ### Harness tool routing heading').toBeGreaterThanOrEqual(0);

    const keys: string[] = [];
    let inTable = false;
    for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (/^#{1,3} /.test(line)) break;
        // Accept padded column headers (`| Need   | Route to   |`) used in root AGENTS.md.
        if (/^\|\s*Need\s*\|/.test(line)) {
            inTable = true;
            continue;
        }
        if (!inTable) continue;
        if (/^\|[-:| ]+\|$/.test(line.trim())) continue; // separator row
        if (!line.startsWith('|')) {
            if (keys.length > 0) break;
            continue;
        }
        const cells = line
            .split('|')
            .slice(1, -1)
            .map((c) => c.trim());
        const need = cells[0];
        if (need && need !== 'Need') keys.push(need);
    }
    return keys;
}

describe('AGENTS portable harness sections stay aligned with init template', () => {
    const rootLabel = 'root AGENTS.md';
    const seedLabel = 'bundled AGENTS seed';
    const root = readAgents(rootLabel, join(REPO_ROOT, 'AGENTS.md'));
    const template = readAgents(seedLabel, BUNDLED_AGENTS_SEED);

    test('both files contain required portable H2 headings', () => {
        for (const [label, content] of [
            [rootLabel, root],
            [seedLabel, template],
        ] as const) {
            const headings = new Set(extractH2(content));
            for (const required of PORTABLE_AGENTS_H2) {
                expect(
                    headings.has(required),
                    `${label} missing heading ${JSON.stringify(required)}; found: ${[...headings].join(', ')}`,
                ).toBe(true);
            }
        }
    });

    test('Harness tool routing Need keys match between root and template', () => {
        const rootKeys = extractRoutingNeedKeys(root);
        const templateKeys = extractRoutingNeedKeys(template);
        const expected = [...PORTABLE_ROUTING_NEED_KEYS];

        for (const [label, keys] of [
            [rootLabel, rootKeys],
            [seedLabel, templateKeys],
        ] as const) {
            const set = new Set(keys);
            for (const need of expected) {
                expect(
                    set.has(need),
                    `${label} missing Need key ${JSON.stringify(need)}; found: ${keys.map((k) => JSON.stringify(k)).join(', ')}`,
                ).toBe(true);
            }
        }

        // Order-independent equality of the portable key sets (extra rows only if in both).
        const rootPortable = rootKeys.filter((k) => expected.includes(k as (typeof expected)[number]));
        const templatePortable = templateKeys.filter((k) => expected.includes(k as (typeof expected)[number]));
        expect(new Set(rootPortable)).toEqual(new Set(expected));
        expect(new Set(templatePortable)).toEqual(new Set(expected));
        expect(new Set(rootKeys)).toEqual(new Set(templateKeys));
    });

    test('both files carry the stable portable prose anchors', () => {
        for (const [label, content] of [
            [rootLabel, root],
            [seedLabel, template],
        ] as const) {
            for (const anchor of PORTABLE_AGENTS_ANCHORS) {
                expect(content.includes(anchor), `${label} missing anchor ${JSON.stringify(anchor)}`).toBe(true);
            }
        }
    });

    test('root keeps constitution doc map and CLI-gated corpus rule (R5)', () => {
        expect(root).toContain('docs/00_ADR.md');
        expect(root).toContain('docs/99_PROJECT_CONSTITUTION.md');
        expect(root).toContain('CLI-gated corpus writes');
        // No full CLI flag dump: a crude guard — avoid multi-flag option lists like `--foo <x> [--bar]`
        expect(root).not.toMatch(/spur task\s+create\s+<title>\s+\[--feature/);
    });
});
