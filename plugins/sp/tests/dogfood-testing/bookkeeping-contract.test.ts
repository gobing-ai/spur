import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function findBookkeepingSuppression(snippet: string, filename = 'snippet.md'): string[] {
    const violations: string[] = [];
    const forbiddenPatterns = [
        // Script-absorption PR-4 kept these as CLI ops; task 1242 flattened the inline group, so the
        // WT-4 landing verbs are the live spelling and their output must stay visible too.
        /spur workflow (?:persist-out|persist-check|commit-guard)\b[^\n]*?(?:>[^&]*\/dev\/null|2>\s*\/dev\/null|&>\s*\/dev\/null)/,
        /(?:bun|node|\$SETUP_SCRIPT|\$RS|\$CHECK_SCRIPT)\s+(?:"?\$[A-Za-z0-9_]+"|\S*inline-run-setup|\S*quality-gate|\S*persist-out)[^\n]*?(?:>[^&]*\/dev\/null|2>\s*\/dev\/null|&>\s*\/dev\/null)/,
        /(?<!superskill script path [^\n]*)(?:inline-run-setup|quality-gate|persist-out)\.(?:ts|mjs)[^\n]*?(?:>[^&]*\/dev\/null|2>\s*\/dev\/null|&>\s*\/dev\/null)/,
    ];
    const lines = snippet.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (line.includes('superskill script path')) continue;
        for (const pattern of forbiddenPatterns) {
            if (pattern.test(line)) {
                violations.push(`${filename}:${i + 1}: ${line.trim()}`);
                break;
            }
        }
    }
    return violations;
}

describe('bookkeeping suppression and scratch pin (task 1136 R2/R6)', () => {
    test('AC2/R2: driver and execution-batch reference snippets must not redirect inline-run-setup, quality-gate, or persist-out to /dev/null', () => {
        const refDir = join(__dirname, '../../skills/spur-dev/references');
        const files = readdirSync(refDir).filter((f) => f.endsWith('.md'));
        expect(files.length).toBeGreaterThan(0);

        const violations: string[] = [];
        for (const file of files) {
            const content = readFileSync(join(refDir, file), 'utf8');
            violations.push(...findBookkeepingSuppression(content, file));
        }
        expect(violations).toEqual([]);
    });

    test('AC2/R2: a snippet redirecting the WT-4 landing verbs to /dev/null is rejected naming file and line', () => {
        const cli = 'spur workflow persist-out --from "$WT_PATH" >/dev/null 2>&1';
        expect(findBookkeepingSuppression(cli, 'test-doc.md')).toEqual([`test-doc.md:1: ${cli}`]);
        expect(findBookkeepingSuppression('spur workflow persist-check --from x 2>/dev/null')).toHaveLength(1);
    });

    test('AC2/R2: a snippet redirecting the retired inline-run-setup script is still rejected', () => {
        const snippet = 'bun plugins/sp/scripts/inline-run-setup.ts --action --run-id 123 --node test >/dev/null 2>&1';
        const violations = findBookkeepingSuppression(snippet, 'test-doc.md');
        expect(violations).toEqual([
            'test-doc.md:1: bun plugins/sp/scripts/inline-run-setup.ts --action --run-id 123 --node test >/dev/null 2>&1',
        ]);
    });
});
