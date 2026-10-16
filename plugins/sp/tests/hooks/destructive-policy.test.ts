/**
 * destructive-policy — one matrix, asserted against the policy AND against every
 * platform adapter that is supposed to use it.
 *
 * The adapter-parity block is the point of this file. A policy test alone would
 * still have passed while the retired Pi extension carried its own regexes and
 * diverged from the Claude matrix on 7 of 10 cases. Every host — Pi included,
 * through superskill's native Pi adapter — now runs the same
 * `scripts/hooks/careful-guard.ts` entry, so driving that entry end-to-end with
 * the table is the parity proof for all of them.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { classifyCommand } from '../../lib/destructive-policy';

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

    // ── destructive behind git global options (task 1214 R1/R2; widened by 1216) ─
    // `git` global options sit between the executable and the subcommand; without a
    // lexical strip the subcommand patterns never see the destructive verb. The pass
    // strips a whole option RUN, not a four-form whitelist: value-less flags of any
    // spelling, glued long values, and value-taking options in separated form. Each
    // value-taking form below was verified against git 2.55.0 (it consumes the next
    // word, so `git --git-dir rev-parse …` reports `unknown option:` on the leftover).
    { command: 'git -C . push --force', expected: 'ask' },
    { command: 'git -c core.hooksPath=/tmp/hooks push -f', expected: 'ask' },
    { command: 'git --git-dir=/tmp/repo push --force', expected: 'ask' },
    { command: 'git --work-tree=. push --force', expected: 'ask' },
    { command: 'git -C "my repo" push --force', expected: 'ask' },
    { command: 'git -C /some/repo reset --hard HEAD~1', expected: 'ask' },
    { command: 'git -c core.hooksPath=/tmp/hooks restore .', expected: 'ask' },
    { command: 'git --git-dir /tmp/repo clean -fd', expected: 'ask' },
    { command: 'git -C . checkout .', expected: 'ask' },
    { command: 'git -C . push origin +main', expected: 'ask' },
    // 1216: value-less global options — the sibling forms of the same defect class.
    { command: 'git --no-pager push --force', expected: 'ask' },
    { command: 'git -p push -f', expected: 'ask' },
    { command: 'git --bare push --force', expected: 'ask' },
    { command: 'git --no-replace-objects push --force', expected: 'ask' },
    { command: 'git --paginate reset --hard', expected: 'ask' },
    { command: 'git --literal-pathspecs clean -fd', expected: 'ask' },
    { command: 'git --glob-pathspecs checkout .', expected: 'ask' },
    { command: 'git --no-optional-locks restore .', expected: 'ask' },
    { command: 'git --icase-pathspecs push origin +main', expected: 'ask' },
    // 1216: value-taking long options in separated form consume their value.
    { command: 'git --namespace=x reset --hard', expected: 'ask' },
    { command: 'git --namespace main push --force', expected: 'ask' },
    { command: 'git --config-env a=b push -f', expected: 'ask' },
    { command: 'git --attr-source HEAD clean -fd', expected: 'ask' },
    // Glued optional-value form: observed executing the reset on git 2.55.0.
    { command: 'git --exec-path=/tmp/p reset --hard', expected: 'ask' },
    // 1216: several options, and an option run that must not cross a boundary.
    { command: 'git --no-pager -C . -c core.pager=cat push --force', expected: 'ask' },
    { command: 'echo done && git --no-pager push --force', expected: 'ask' },
    { command: 'git status; git -p push -f', expected: 'ask' },

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

    // ── safe controls: global options must not turn routine git into a prompt ─
    { command: 'git -C . push origin main', expected: 'allow' },
    { command: 'git -C . status', expected: 'allow' },
    { command: 'git -c core.hooksPath=/tmp/hooks push --force-with-lease', expected: 'allow' },
    { command: 'git --git-dir=/tmp/repo status --short', expected: 'allow' },
    // 1216: the same controls behind the newly covered option forms.
    { command: 'git --no-pager status', expected: 'allow' },
    { command: 'git -p push origin main', expected: 'allow' },
    { command: 'git --bare diff --stat', expected: 'allow' },
    { command: 'git --no-pager push --force-with-lease', expected: 'allow' },
    { command: 'git --no-optional-locks log --oneline -3', expected: 'allow' },
    { command: 'git -C . --no-pager push origin main', expected: 'allow' },
    { command: 'gt push --force', expected: 'allow' }, // not the git executable
    // `--exec-path` is optional-value: bare/separated it prints and exits, so git never
    // reaches the subcommand (verified on 2.55.0 — exit 0, exec path printed).
    { command: 'git --exec-path /tmp/p reset --hard', expected: 'allow' },
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

// ─── Adapter parity ───────────────────────────────────────────────────────

/** Run the Claude Code hook end-to-end and read back its permission decision. */
function claudeDecision(command: string): Expected {
    const res = spawnSync('bun', [join(import.meta.dir, '../../scripts/hooks', 'careful-guard.ts')], {
        input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
        encoding: 'utf-8',
        timeout: 30_000,
    });
    // Allow is silence (superskill ADR-039); anything printed must be the `ask` decision.
    if (res.stdout === '') return 'allow';
    const parsed = JSON.parse(res.stdout) as {
        hookSpecificOutput?: { permissionDecision?: string };
    };
    if (parsed.hookSpecificOutput?.permissionDecision !== 'ask') throw new Error(`unexpected output: ${res.stdout}`);
    return 'ask';
}

describe('destructive-policy — Claude Code adapter parity', () => {
    for (const { command, expected } of MATRIX) {
        test(`careful-guard ${expected}: ${command}`, () => {
            expect(claudeDecision(command)).toBe(expected);
        });
    }
});
