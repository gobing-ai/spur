/**
 * One-shot capture of the retired PR-6 plugin scripts' golden output (run from a checkout of
 * origin/main extracted to <pluginRoot>/..). Not a test; kept for provenance of the fixture.
 *   bun apps/cli/tests/script-absorption-pr7/capture.ts <legacy-plugin-root> <legacy-fixtures-dir>
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PR6_CASES } from './cases';
import { type Observation, runSide } from './harness';

const [pluginRoot, fixtures] = process.argv.slice(2);
if (!pluginRoot || !fixtures) throw new Error('usage: capture.ts <legacy-plugin-root> <legacy-fixtures-dir>');
const cases: Record<string, Observation> = {};
for (const c of PR6_CASES) cases[c.name] = runSide(c, 'legacy', { pluginRoot, fixtures });
writeFileSync(
    join(import.meta.dir, '..', 'fixtures', 'script-absorption-pr6-golden.json'),
    `${JSON.stringify({ source: 'origin/main @ f6bcda129 (PR-5 + PR-4 + PR-3 stack base) plugins/sp/scripts', cases }, null, 4)}\n`,
);
