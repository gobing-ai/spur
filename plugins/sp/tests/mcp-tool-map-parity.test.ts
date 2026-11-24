import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Task 1394 R4 — the MCP tool map in `references/mcp-tools.md` must name exactly the tools the
 * server advertises. The server modules are read as TEXT (never imported): the plugin ships
 * standalone (ADR-065), so a value import of `apps/server` would break installation. Since task
 * 1445 the descriptors live one file per domain; `index.ts` only composes them.
 */
const PLUGIN_ROOT = join(import.meta.dir, '..');
const MAP_PATH = join(PLUGIN_ROOT, 'skills', 'spur-cli', 'references', 'mcp-tools.md');
const SERVER_DIR = join(PLUGIN_ROOT, '..', '..', 'apps', 'server', 'src', 'modules', 'mcp');

/** Tool names the server advertises, in descriptor order across the per-domain modules. */
function serverToolNames(): string[] {
    const sources = readdirSync(SERVER_DIR)
        .filter((name) => name === 'index.ts' || /^tools-[a-z-]+\.ts$/.test(name))
        .sort();
    const names: string[] = [];
    for (const file of sources) {
        const source = readFileSync(join(SERVER_DIR, file), 'utf8');
        for (const match of source.matchAll(/name:\s*'(sp_[a-z_]+)'/g)) {
            const name = match[1];
            if (name !== undefined && !names.includes(name)) names.push(name);
        }
    }
    return names;
}

/** Tool names the map documents — the first column of each table row. */
function mapToolNames(): string[] {
    const markdown = readFileSync(MAP_PATH, 'utf8');
    const names: string[] = [];
    for (const line of markdown.split('\n')) {
        const row = /^\|\s*`(sp_[a-z_]+)`\s*\|/.exec(line);
        const name = row?.[1];
        if (name !== undefined && !names.includes(name)) names.push(name);
    }
    return names;
}

describe('mcp-tools map parity (task 1394 R4)', () => {
    test('the map names every advertised tool and nothing else', () => {
        const server = serverToolNames();
        expect(server.length).toBeGreaterThanOrEqual(10);
        expect([...mapToolNames()].sort()).toEqual([...server].sort());
    });

    test('every mapped tool names a CLI verb, and the CLI-only operations are listed', () => {
        const markdown = readFileSync(MAP_PATH, 'utf8');
        // Each row's second cell carries the CLI fallback (`spur ...`), so no tool is MCP-only.
        for (const line of markdown.split('\n')) {
            const row = /^\|\s*`(sp_[a-z_]+)`\s*\|([^|]*)\|/.exec(line);
            if (row === null) continue;
            expect(row[2], row[1]).toContain('`spur ');
        }
        // The gaps between MCP and the CLI must be written down, not implied.
        const cliOnly = markdown.slice(markdown.indexOf('## CLI-only'));
        for (const needle of ['force-done', 'rule files', 'auto-fix', 'ready-prep', 'batch-create']) {
            expect(cliOnly.toLowerCase(), needle).toContain(needle);
        }
    });

    test('the rule is stated in both skills and in the AGENTS template', () => {
        const cliSkill = readFileSync(join(PLUGIN_ROOT, 'skills', 'spur-cli', 'SKILL.md'), 'utf8');
        const crossCutting = readFileSync(
            join(PLUGIN_ROOT, 'skills', 'spur-dev', 'references', 'cross-cutting.md'),
            'utf8',
        );
        const agents = readFileSync(join(PLUGIN_ROOT, '..', '..', 'AGENTS.md'), 'utf8');
        const template = readFileSync(join(PLUGIN_ROOT, '..', '..', 'config', 'templates', 'AGENTS.md'), 'utf8');
        for (const [label, text] of [
            ['spur-cli SKILL.md', cliSkill],
            ['cross-cutting.md', crossCutting],
            ['AGENTS.md', agents],
            ['the AGENTS template', template],
        ] as const) {
            expect(text, label).toContain('mcp-tools.md');
        }
    });
});
