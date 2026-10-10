// Task 1137 R3 / R5(f) / AC6 — static pin: exactly one writer may change a feature
// document's lifecycle `status` frontmatter (`PlanningWriteServiceImpl.transition`).
// This test fails when any non-test source under packages/, apps/, plugins/ or
// scripts/ calls `setFrontmatterField('status', …)` in a file that also references
// the 'feature' document domain — the raw-write fallback this task deleted from
// `feature check --fix` (packages/app/src/services/feature-check.ts) must not
// return under another name.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const SCAN_ROOTS = ['packages', 'apps', 'plugins', 'scripts'];
const RAW_STATUS_WRITE = /setFrontmatterField\(\s*['"]status['"]/;
const FEATURE_DOMAIN = /['"]feature['"]/;

test('AC6/R3: no non-test source writes feature status frontmatter outside the transition path', () => {
    const violations: string[] = [];
    for (const root of SCAN_ROOTS) {
        // Hand-written plugin glue is `.mjs`, so scan both source extensions — a
        // raw writer introduced outside TypeScript must not escape the pin (review P4).
        const glob = new Bun.Glob('**/*.{ts,mjs}');
        for (const rel of glob.scanSync({ cwd: join(REPO_ROOT, root), absolute: false })) {
            if (rel.includes('node_modules/')) continue;
            if (rel.includes('/tests/') || rel.endsWith('.test.ts')) continue;
            const abs = join(REPO_ROOT, root, rel);
            const content = readFileSync(abs, 'utf8');
            if (!RAW_STATUS_WRITE.test(content)) continue;
            if (!FEATURE_DOMAIN.test(content)) continue;
            const lines = content.split('\n');
            lines.forEach((line, i) => {
                if (RAW_STATUS_WRITE.test(line)) {
                    violations.push(`${root}/${rel}:${i + 1}`);
                }
            });
        }
    }
    expect(violations).toEqual([]);
});
