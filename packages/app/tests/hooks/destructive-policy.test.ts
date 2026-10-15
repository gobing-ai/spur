/**
 * Ported from `plugins/sp/tests/hooks/destructive-policy.test.ts` for the `@gobing-ai/spur-app` hook adapters
 * (script-absorption plan PR-2a). Spawned plugin-hook entrypoints are replaced by in-process
 * `runSpurHook` calls, so the same cases exercise the code `spur self hook` runs.
 */

/**
 * destructive-policy — one matrix, asserted against the policy AND against every
 * platform adapter that is supposed to use it.
 *
 * The adapter-parity blocks are the point of this file. A policy test alone would
 * still have passed while `pi/guard-extension.ts` carried its own regexes and
 * diverged from the Claude matrix on 7 of 10 cases. Driving each adapter's real
 * entry point with the same table is what makes a re-implementation fail here
 * instead of in production on one platform only.
 */
import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { classifyCommand } from '../../src/hooks/destructive-policy';
import { runSpurHook } from '../../src/hooks/run-hook';

type Expected = 'ask' | 'allow';

/**
 * The canonical decision matrix. Rows marked `divergedOnPi` are the cases the Pi
 * copy got wrong before the policy was shared — they are regression pins, not
 * decoration.
 */
const MATRIX: Array<{ command: string; expected: Expected; divergedOnPi?: true }> = [
    // ── destructive: must prompt ──────────────────────────────────────────
    { command: 'rm -rf /', expected: 'ask' },
    { command: 'rm -rf ~/important', expected: 'ask' },
    { command: 'sudo rm -fr /var/data', expected: 'ask' },
    { command: 'rm -r -f ./src', expected: 'ask' },
    { command: 'rm -Rf /important', expected: 'ask' },
    { command: 'rm -R -f /important', expected: 'ask' },
    { command: 'rm -fR ~/data', expected: 'ask' },
    { command: 'DROP TABLE users;', expected: 'ask' },
    { command: 'drop database analytics', expected: 'ask' },
    { command: 'TRUNCATE TABLE events', expected: 'ask' },
    { command: 'git push --force origin main', expected: 'ask' },
    { command: 'git reset --hard HEAD~3', expected: 'ask' },
    { command: 'git checkout .', expected: 'ask' },
    { command: 'git restore .', expected: 'ask' },
    { command: 'kubectl delete pod web-0', expected: 'ask' },
    { command: 'docker system prune -a', expected: 'ask' },
    // One safe cache target must not whitelist the other targets in the command.
    { command: 'rm -rf node_modules /etc/nginx', expected: 'ask', divergedOnPi: true },
    { command: 'rm -R --force /var/data', expected: 'ask', divergedOnPi: true },
    { command: 'git push -f', expected: 'ask', divergedOnPi: true },
    { command: 'git push origin +main', expected: 'ask', divergedOnPi: true },
    { command: 'git push origin +refs/heads/main', expected: 'ask', divergedOnPi: true },
    // Cache *name* as a path prefix is not a cache directory.
    { command: 'rm -rf /important/build-backup', expected: 'ask', divergedOnPi: true },

    // ── recursive deletes that leave the project ─────────────────────────
    // A cache *basename* outside the project is not a project cache.
    { command: 'rm -rf /Users/me/dist', expected: 'ask' },
    { command: 'rm -rf ../../../node_modules', expected: 'ask' },
    { command: 'rm -rf ~/dist', expected: 'ask' },
    // `rm -r` without --force still deletes every writable file in the tree.
    { command: 'rm -r /Users/me/photos', expected: 'ask' },
    { command: 'rm -r ../sibling-project', expected: 'ask' },
    { command: 'rm --recursive /var/data', expected: 'ask' },
    { command: 'rm -rf "$HOME"/projects', expected: 'ask' },

    // ── git clean: destroys untracked files (unrecoverable) ──────────────
    { command: 'git clean -fdx', expected: 'ask' },
    { command: 'git clean -f', expected: 'ask' },
    { command: 'git clean --force -d', expected: 'ask' },
    { command: 'git clean -n', expected: 'allow' }, // dry run lists only
    { command: 'git clean --dry-run', expected: 'allow' },

    // ── routine: must not prompt ──────────────────────────────────────────
    { command: 'rm -rf node_modules', expected: 'allow' },
    { command: 'rm -rf dist', expected: 'allow' },
    { command: 'rm -rf ./coverage .next', expected: 'allow' },
    { command: 'rm -rf build/', expected: 'allow' },
    { command: 'rm -rf packages/app/dist', expected: 'allow' },
    { command: 'rm -R ./tmpdir', expected: 'allow' }, // recursive without --force is in-scope-allowed
    { command: 'git checkout my-branch', expected: 'allow' },
    { command: 'git commit -m "wip"', expected: 'allow' },
    { command: 'git commit -m "a + b"', expected: 'allow' },
    { command: 'git push origin main', expected: 'allow' },
    { command: 'ls -la && echo done', expected: 'allow' },
    { command: 'git push --force-with-lease', expected: 'allow', divergedOnPi: true },
    { command: 'rm -f config.json', expected: 'allow', divergedOnPi: true },
];

describe('destructive-policy — classification', () => {
    for (const { command, expected } of MATRIX) {
        test(`${expected}: ${command}`, () => {
            expect(classifyCommand(command) === null ? 'allow' : 'ask').toBe(expected);
        });
    }

    test('a destructive classification always carries an operator-readable label', () => {
        for (const { command, expected } of MATRIX) {
            if (expected !== 'ask') continue;
            expect(classifyCommand(command)?.length ?? 0).toBeGreaterThan(0);
        }
    });
});

// ─── Adapter parity (runSpurHook, both host shapes) ───────────────────────

function hookDecision(host: 'claude' | 'pi', command: string): Expected {
    const stdin =
        host === 'pi'
            ? JSON.stringify({ toolName: 'bash', input: { command } })
            : JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
    const out = JSON.parse(runSpurHook('careful-guard', { host, stdin, env: {}, cwd: tmpdir() }).stdout) as {
        action?: string;
        hookSpecificOutput?: { permissionDecision?: string };
    };
    const decision = host === 'pi' ? out.action : out.hookSpecificOutput?.permissionDecision;
    return decision === 'ask' ? 'ask' : 'allow';
}

describe('destructive-policy — spur self hook adapter parity', () => {
    for (const { command, expected } of MATRIX) {
        test(`claude ${expected}: ${command}`, () => {
            expect(hookDecision('claude', command)).toBe(expected);
        });
        test(`pi ${expected}: ${command}`, () => {
            expect(hookDecision('pi', command)).toBe(expected);
        });
    }
});
