/**
 * The public Board contribution authoring contract (task 0988 R1).
 *
 * `src/modules/contribution.ts` is the ONE authoring source the published
 * `@gobing-ai/spur/board` declaration is generated from (see
 * `scripts/commands/emit-board-types.ts`), so its shape is pinned here rather than by a second copy.
 */
import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Authoring source text. */
async function authoringSource(): Promise<string> {
    return readFile(join(WEB_ROOT, 'src/modules/contribution.ts'), 'utf-8');
}

describe('BoardModuleContribution authoring contract (R1)', () => {
    test('declares the frozen contribution ABI verbatim', async () => {
        const source = await authoringSource();
        expect(source).toContain('export interface BoardModuleContribution {');
        expect(source).toContain('readonly apiVersion: 1;');
        expect(source).toContain('readonly component: ComponentType;');
        expect(source).toContain('readonly rightPanelComponent?: ComponentType;');
    });

    test('declares the required entry export name', async () => {
        const source = await authoringSource();
        expect(source).toContain('export declare const webModule: BoardModuleContribution;');
    });

    test('stays type-only: React types are imported with `import type`', async () => {
        const source = await authoringSource();
        expect(source).toContain("import type { ComponentType } from 'react';");
        expect(/^import\s+(?!type\b)/m.test(source)).toBeFalse();
        // No module metadata: id/name/icon/route live in project configuration, not in this ABI.
        expect(source).not.toMatch(/readonly (id|name|icon|route)\b/);
    });

    test('carries no runtime value export', async () => {
        // Comments explain the contract; only code lines are inspected here.
        const code = (await authoringSource())
            .split('\n')
            .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
            .join('\n');
        expect(code).not.toContain('createRoot');
        expect(/^export (?!interface|declare|type)/m.test(code)).toBeFalse();
        expect(/\buseState\b|\bcreateContext\b/.test(code)).toBeFalse();
    });
});
