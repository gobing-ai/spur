import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateJsonSchema } from '@gobing-ai/ts-runtime';

// The schema shipped to IDEs and resolved by loadStructuredConfig at runtime.
const SCHEMA_PATH = join(import.meta.dir, '../../schemas/spur-config.schema.json');
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as Parameters<typeof validateJsonSchema>[1];

/** Wrap a `bootstrap.scheduler.jobs` array in an otherwise-minimal config document. */
function withJobs(jobs: unknown): Record<string, unknown> {
    return { name: 'spur-new', bootstrap: { scheduler: { enabled: true, jobs } } };
}

describe('bootstrap.scheduler.jobs schema (task 0734 R3/R5)', () => {
    test('accepts interval and cron entries side by side', () => {
        const violations = validateJsonSchema(
            withJobs([
                { name: 'hourly-analyze', command: 'spur history analyze', intervalMinutes: 60 },
                { name: 'nightly-import', command: 'bun run load-history', cron: '30 2 * * *' },
            ]),
            schema,
        );
        expect(violations).toEqual([]);
    });

    test('accepts an absent jobs array (built-in registrations only)', () => {
        expect(validateJsonSchema({ bootstrap: { scheduler: { enabled: false } } }, schema)).toEqual([]);
    });

    test('rejects an entry carrying both intervalMinutes and cron', () => {
        // The XOR is structural: both oneOf branches match, and matching two is a failure.
        const violations = validateJsonSchema(
            withJobs([{ name: 'both', command: 'echo hi', intervalMinutes: 5, cron: '* * * * *' }]),
            schema,
        );
        expect(violations.length).toBeGreaterThan(0);
    });

    test('rejects an entry carrying neither intervalMinutes nor cron', () => {
        const violations = validateJsonSchema(withJobs([{ name: 'neither', command: 'echo hi' }]), schema);
        expect(violations.length).toBeGreaterThan(0);
    });

    test('rejects an entry missing the required command', () => {
        const violations = validateJsonSchema(withJobs([{ name: 'no-command', cron: '* * * * *' }]), schema);
        expect(violations.length).toBeGreaterThan(0);
    });

    test('rejects a non-object job entry', () => {
        expect(validateJsonSchema(withJobs(['echo hi']), schema).length).toBeGreaterThan(0);
    });
});

describe('scheduler config surface stays single and upstream-owned (task 0734 R3)', () => {
    test('the schema declares no top-level scheduler block', () => {
        const properties = (schema as { properties: Record<string, unknown> }).properties;
        expect('scheduler' in properties).toBe(false);
        expect('jobs' in (properties.bootstrap as { properties: Record<string, unknown> }).properties).toBe(false);
    });

    test('packages/config takes no runtime dependency on ts-infra', () => {
        // Scheduler jobs are resolved by the upstream runtime, not by the Spur config
        // loader — a ts-infra dependency here would mean a second validation surface.
        const manifest = JSON.parse(
            readFileSync(join(import.meta.dir, '../../../../packages/config/package.json'), 'utf8'),
        ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        expect(Object.keys(manifest.dependencies ?? {})).not.toContain('@gobing-ai/ts-infra');
        expect(Object.keys(manifest.devDependencies ?? {})).not.toContain('@gobing-ai/ts-infra');
    });
});
