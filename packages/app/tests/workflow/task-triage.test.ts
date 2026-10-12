/**
 * task-triage — the sensitive-path safety floor (task 1176 ownership move).
 *
 * The policy decides the triage lane before any model negotiation: a changed path under the frozen
 * sensitive list forces the safety lane. It lives with the workflow/task owner; the diffstat adapter
 * keeps its own end-to-end contract tests (`plugins/sp/tests/task-diffstat.test.ts`).
 */

import { describe, expect, test } from 'bun:test';
import { SENSITIVE_GLOBS, SENSITIVE_PREFIXES, sensitiveReasonForPath } from '../../src/workflow/task-triage';

describe('task-triage — sensitive-path policy (0943 R2c)', () => {
    test('every frozen prefix class is sensitive', () => {
        for (const path of [
            'drizzle/0001_init.sql',
            'packages/config/src/app.ts',
            '.github/workflows/ci.yml',
            'plugins/sp/hooks/task-write-guard.ts',
        ]) {
            expect(sensitiveReasonForPath(path)).not.toBeNull();
        }
    });

    test('every frozen glob class is sensitive', () => {
        for (const path of [
            // `auth*` is a basename glob anywhere under the server src tree.
            'apps/server/src/modules/auth.ts',
            'apps/server/src/auth.ts',
            'packages/app/src/secret-store.ts',
            'apps/server/src/migrations/0001.sql',
        ]) {
            expect(sensitiveReasonForPath(path)).not.toBeNull();
        }
    });

    test('an ordinary path is not sensitive', () => {
        expect(sensitiveReasonForPath('packages/app/src/workflow/plan-projection.ts')).toBeNull();
        expect(sensitiveReasonForPath('docs/tasks5/1176_x.md')).toBeNull();
        // `*secret*` is a basename glob: it matches a basename containing `secret`, but the
        // directory name alone does not make the file sensitive.
        expect(sensitiveReasonForPath('apps/web/src/secretary.ts')).not.toBeNull();
        expect(sensitiveReasonForPath('apps/web/src/secret/helper.ts')).toBeNull();
    });

    test('the reason names the matching pattern, and prefixes win by declaration order', () => {
        expect(sensitiveReasonForPath('drizzle/0001_init.sql')).toBe('matches sensitive pattern drizzle/');
        expect(sensitiveReasonForPath('packages/config/x.ts')).toBe('matches sensitive pattern packages/config/');
    });

    test('`**/*.sql` matches through newline-bearing directories (dotAll glob semantics)', () => {
        // The `s` flag is load-bearing: a git path can carry a newline, and a `.*` without dotAll
        // would fail to span it (task 1160 R4).
        expect(sensitiveReasonForPath('apps/server/src/odd\ndir/0001.sql')).toBe('matches sensitive pattern **/*.sql');
    });

    test('the exported pattern lists stay data, so the frozen classes are auditable', () => {
        expect(SENSITIVE_PREFIXES).toContain('plugins/sp/hooks/');
        expect(SENSITIVE_GLOBS).toContain('**/*.sql');
        expect(SENSITIVE_GLOBS).toContain('**/*secret*');
    });
});
