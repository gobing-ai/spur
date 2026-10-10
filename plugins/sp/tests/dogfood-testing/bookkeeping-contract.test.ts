import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function findBookkeepingSuppression(snippet: string, filename = 'snippet.md'): string[] {
    const violations: string[] = [];
    const forbiddenPatterns = [
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

    test('AC2/R2: a snippet redirecting inline-run-setup to /dev/null is rejected naming file and line', () => {
        const snippet = 'bun plugins/sp/scripts/inline-run-setup.ts --action --run-id 123 --node test >/dev/null 2>&1';
        const violations = findBookkeepingSuppression(snippet, 'test-doc.md');
        expect(violations).toEqual([
            'test-doc.md:1: bun plugins/sp/scripts/inline-run-setup.ts --action --run-id 123 --node test >/dev/null 2>&1',
        ]);
    });

    test('R6: driver reference states that scratch lives under .spur/run/<run-id>/', () => {
        const driverRef = readFileSync(
            join(__dirname, '../../skills/spur-dev/references/inline-pipeline-driver.md'),
            'utf8',
        );
        expect(driverRef).toContain('.spur/run/<run-id>/');
    });

    test('R6/AC6: driver reference requires a non-empty declared var before its shell action runs, and allows empty optional vars', () => {
        const driverRef = readFileSync(
            join(__dirname, '../../skills/spur-dev/references/inline-pipeline-driver.md'),
            'utf8',
        );
        expect(driverRef).toContain('Declared vars are checked before a shell action runs');
        expect(driverRef).toContain('requires $qualityGateCmd but it is empty/unset');
        expect(driverRef).toContain('legitimately empty optional vars');
    });

    test('R2: the driver reference states the no-suppression rule for bookkeeping calls', () => {
        const driverRef = readFileSync(
            join(__dirname, '../../skills/spur-dev/references/inline-pipeline-driver.md'),
            'utf8',
        );
        expect(driverRef).toContain('never `/tmp` or `$TMPDIR`');
        const traceRef = readFileSync(
            join(__dirname, '../../skills/spur-dev/references/structured-trace-emission.md'),
            'utf8',
        );
        expect(traceRef).toContain('Never suppress this output');
        expect(traceRef).toContain('redirecting `inline-run-setup`');
    });
});
