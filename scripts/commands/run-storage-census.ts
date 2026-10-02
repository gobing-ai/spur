/** Read-only equality check for the reviewed E71 ownership census; no storage mutation. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Census {
    pattern: string;
    scopes: string[];
    excludes: string[];
    families: Record<string, { lifetime: string; disposition: string; regression: string }>;
    files: Array<{ path: string; families: string[]; candidates: Array<[number, string]> }>;
}

const root = resolve(import.meta.dir, '../..');
const census = JSON.parse(
    readFileSync(resolve(root, process.argv[2] ?? 'docs/reports/2026-10-01-E71-run-storage-census.json'), 'utf8'),
) as Census;
const result = Bun.spawnSync(
    [
        'rg',
        '--json',
        census.pattern,
        ...census.scopes,
        '-g',
        '*.ts',
        '-g',
        '*.tsx',
        '-g',
        '*.yaml',
        '-g',
        '*.md',
        ...census.excludes.flatMap((path) => ['-g', `!${path}`]),
    ],
    { cwd: root },
);
assert.ok(result.exitCode === 0 || result.exitCode === 1, result.stderr.toString());
const candidates: string[] = [];
for (const line of result.stdout.toString().trim().split('\n').filter(Boolean)) {
    const entry = JSON.parse(line) as {
        type: string;
        data: { path: { text: string }; line_number: number; lines: { text: string } };
    };
    if (entry.type !== 'match') continue;
    const digest = createHash('sha256').update(entry.data.lines.text.trim()).digest('hex');
    candidates.push(`${entry.data.path.text}:${entry.data.line_number}:${digest}`);
}
const classified = census.files.flatMap((file) => {
    assert.ok(file.families.length > 0, `unclassified owner: ${file.path}`);
    for (const family of file.families) assert.ok(census.families[family], `unknown family ${family}: ${file.path}`);
    return file.candidates.map(([line, digest]) => `${file.path}:${line}:${digest}`);
});
assert.equal(new Set(classified).size, classified.length, 'duplicate classified location');
assert.deepEqual(
    candidates.sort(),
    classified.sort(),
    'candidate/classified location drift; review changed owners before updating the census',
);
process.stdout.write(
    `${JSON.stringify({ pass: true, candidateLocations: candidates.length, classifiedLocations: classified.length, owners: census.files.length, unclassified: 0 })}\n`,
);
