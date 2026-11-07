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

    // ── task 1313: literal read-only searches are data; execution still asks ─
    // Proven standalone rg/grep operands are data. Single quotes never recurse.
    // Double quotes and unquoted text recurse only into $(...) and backticks.
    { command: "rg 'rm -rf /' .", expected: 'allow' },
    { command: 'rg "git reset --hard HEAD~3" src', expected: 'allow' },
    { command: "rg 'DROP TABLE users' .", expected: 'allow' },
    { command: "grep -n 'git push --force' file.ts", expected: 'allow' },
    { command: "grep -e 'kubectl delete pod' ./docs", expected: 'allow' },
    { command: "rg 'TRUNCATE TABLE events' plugins", expected: 'allow' },
    { command: 'rg rm -rf /', expected: 'allow' },
    { command: "rg '$(rm -rf /)' .", expected: 'allow' },
    { command: 'rg "docker system prune" .', expected: 'allow' },
    { command: "rg -- 'git push --force' .", expected: 'allow' },
    { command: "rg 'rm\\ -rf /' .", expected: 'allow' },
    { command: "rg '`rm -rf /`' .", expected: 'allow' },
    { command: 'rg "\\$(rm -rf /)" .', expected: 'allow' },
    { command: 'rg "$(echo hello)" .', expected: 'allow' },
    { command: "env FOO=1 rg 'TRUNCATE TABLE events' .", expected: 'allow' },
    { command: "env -i rg 'rm -rf /' .", expected: 'allow' },
    { command: "command rg 'rm -rf node_modules /etc' .", expected: 'allow' },
    { command: "command -- rg 'DROP TABLE' .", expected: 'allow' },
    { command: "command env rg 'rm -rf /' .", expected: 'allow' },
    { command: 'sh -c \'rg "rm -rf /" .\'', expected: 'allow' },
    { command: 'bash -c "grep \'git reset --hard\' file"', expected: 'allow' },
    { command: 'zsh -c \'rg "git reset --hard" .\'', expected: 'allow' },
    { command: "rg 'foo' . && ls", expected: 'allow' },
    { command: "rg 'DROP TABLE' src | head", expected: 'allow' },
    { command: "rg 'foo' || true", expected: 'allow' },
    { command: "rg 'rm -rf /' > /tmp/out", expected: 'allow' },
    { command: 'sh -c', expected: 'allow' },
    { command: 'sh script.sh', expected: 'allow' },
    { command: '# rm -rf /', expected: 'allow' },
    { command: "rg 'safe' # rm -rf /", expected: 'allow' },
    { command: "git --exec-path /tmp/p reset --hard && rg 'rm -rf /' .", expected: 'allow' },
    { command: "env -- rg 'rm -rf /' .", expected: 'allow' },
    { command: "env -i -- rg 'rm -rf /' .", expected: 'allow' },
    { command: "env -u NAME rg 'rm -rf /' .", expected: 'allow' },
    { command: "env --unset=FOO rg 'DROP TABLE' .", expected: 'allow' },
    { command: "env -0 rg 'rm -rf /' .", expected: 'allow' },
    { command: "env --ignore-environment rg 'rm -rf /' .", expected: 'allow' },
    { command: 'rg "$(echo \' )\')" .', expected: 'allow' },
    { command: 'rg "rm\\\n-rf" .', expected: 'allow' },
    { command: 'rg rm\\\n -rf /', expected: 'allow' },
    { command: 'rg "rm\\ -rf" .', expected: 'allow' },
    { command: 'rg `echo \\$x` .', expected: 'allow' },
    { command: "rg 'rm -rf /' >> /tmp/out", expected: 'allow' },
    { command: "rg 'rm -rf /' >& /tmp/out", expected: 'allow' },
    // Escaped quote inside $(...), empty-word redirect, and a -c with no script
    // after a substitution on a long option (masks that span, then allows).
    { command: 'rg "$(echo "a\\"b")"', expected: 'allow' },
    { command: "rg 'rm -rf /' ''>> /tmp/out", expected: 'allow' },
    { command: 'sh --norc$(echo hi) -c', expected: 'allow' },
    { command: 'rg `echo \\`x` .', expected: 'allow' },

    // Search output piped into an executor is code, not data: no exemption.
    { command: "rg -o 'rm -rf /' notes.txt | sh", expected: 'ask' },
    { command: "rg -r 'rm -rf /' -o x . | bash", expected: 'ask' },
    { command: "grep 'git push --force' . | xargs -I{} sh -c '{}'", expected: 'ask' },
    { command: "rg 'git reset --hard' . | zsh", expected: 'ask' },
    { command: "grep 'rm -rf /' notes | env FOO=1 xargs rm", expected: 'ask' },
    { command: "rg -o 'rm -rf /' x | command eval", expected: 'ask' },
    { command: "rg -o 'rm -rf /' x | source /dev/stdin", expected: 'ask' },
    { command: "rg -o 'rm -rf /' x | . /dev/stdin", expected: 'ask' },
    { command: "rg -o 'rm -rf /' x | $(echo sh)", expected: 'ask' },
    { command: "rg -o 'rm -rf /' x |& bash", expected: 'ask' },
    // 1313 review: the consumer is matched on argv0 basename, so a path-qualified shell,
    // an unnamed interpreter, or a wrapper still executes the flow.
    { command: "rg -o 'rm -rf /' notes.txt | /bin/sh", expected: 'ask' },
    { command: "rg -o 'rm -rf /' notes.txt | /usr/bin/bash", expected: 'ask' },
    { command: "rg -o 'rm -rf /' notes.txt | nice sh", expected: 'ask' },
    { command: "rg -o 'rm -rf /' notes.txt | python -", expected: 'ask' },
    { command: "rg -o 'rm -rf /' notes.txt | perl -ne print", expected: 'ask' },
    // A plain text consumer keeps the data exemption.
    { command: "rg 'rm -rf /' . | tail -5", expected: 'allow' },
    // A leading assignment is a wrapper like `env`, not the command.
    { command: "FOO=1 rg 'rm -rf /' .", expected: 'allow' },
    // An executor in a different pipeline does not consume the search output.
    { command: "rg 'rm -rf /' . ; sh script.sh", expected: 'allow' },
    { command: "rg 'rm -rf /' . && bash build.sh", expected: 'allow' },
    { command: "rg 'rm -rf /' . || sh fallback.sh", expected: 'allow' },
    { command: "rg 'rm -rf /' . | env", expected: 'allow' },

    // Review P2: argv0 paths and wrappers must not hide escape-normalized -c code.
    ...[
        '/bin/sh',
        '/usr/bin/bash',
        '"/bin/zsh"',
        '/usr/bin/env sh',
        'env /bin/sh',
        'command /bin/sh',
        '/usr/bin/env -i command /bin/sh',
        'env --chdir=/tmp sh',
        'sudo sh',
        '/usr/bin/sudo -u root /bin/sh',
        'exec sh',
        'exec -a custom /bin/sh',
        'nice -n 5 sh',
        '/usr/bin/nice sh',
        'xargs -I{} sh',
        '/usr/bin/xargs -0 /bin/sh',
        'command env FOO=1 sudo nice sh',
    ].flatMap((prefix) => [
        { command: `${prefix} -c 'r\\m -rf /'`, expected: 'ask' as const },
        { command: `${prefix} -c 'git\\ push --force'`, expected: 'ask' as const },
        { command: `${prefix} -c 'sh -c "r\\m -rf /"'`, expected: 'ask' as const },
        { command: `${prefix} -c 'ls -la'`, expected: 'allow' as const },
    ]),
    ...['/bin/sh', '/usr/bin/bash', '/bin/zsh', '/usr/bin/env sh', 'env /bin/sh', 'command /bin/sh'].map((prefix) => ({
        command: `${prefix} -c 'rg "rm -rf /" .'`,
        expected: 'allow' as const,
    })),
    // Wrapper detection must not broaden the proven standalone search exemption.
    { command: "sudo rg 'rm -rf /' .", expected: 'ask' },
    { command: "exec rg 'rm -rf /' .", expected: 'ask' },
    { command: "nice rg 'rm -rf /' .", expected: 'ask' },
    { command: "xargs rg 'rm -rf /'", expected: 'ask' },
    { command: "env --chdir=/tmp rg 'rm -rf /' .", expected: 'ask' },
    { command: "unknown sh -c 'rm -rf /'", expected: 'ask' },

    // Destructive execution inside substitutions, nested shells, prefixes, and evasions.
    { command: 'rg "$(rm -rf /)" .', expected: 'ask' },
    { command: 'rg $(git push --force) .', expected: 'ask' },
    { command: 'rg `rm -rf /` .', expected: 'ask' },
    { command: "sh -c 'rm -rf /'", expected: 'ask' },
    { command: 'bash -c "git reset --hard"', expected: 'ask' },
    { command: "zsh -c 'rm -rf /tmp/important'", expected: 'ask' },
    { command: "bash -lc 'rm -rf /tmp/nope'", expected: 'ask' },
    { command: "bash --norc -c 'rm -rf /'", expected: 'ask' },
    { command: "sh -c 'rg foo; rm -rf /'", expected: 'ask' },
    { command: 'sh -c \'sh -c "rm -rf /"\'', expected: 'ask' },
    { command: "bash -c 'echo $(rm -rf /)'", expected: 'ask' },
    { command: 'env rm -rf /', expected: 'ask' },
    { command: 'command rm -rf /', expected: 'ask' },
    { command: 'env FOO=bar git push --force', expected: 'ask' },
    { command: 'command -p git reset --hard', expected: 'ask' },
    { command: 'rm \\-rf /', expected: 'ask' },
    { command: 'git\\ push --force', expected: 'ask' },
    { command: 'r\\m -rf /tmp/x', expected: 'ask' },
    { command: "rg 'safe'; rm -rf /", expected: 'ask' },
    { command: "rg 'foo' || rm -rf /", expected: 'ask' },
    { command: 'echo $(rm -rf /)', expected: 'ask' },
    { command: "rg --pre 'rm -rf /' pattern", expected: 'ask' },
    { command: "rg --pre=rm 'DROP TABLE' foo", expected: 'ask' },
    { command: "sudo rg 'rm -rf /' .", expected: 'ask' },
    { command: "myrg 'rm -rf /' .", expected: 'ask' },
    { command: "/usr/bin/rg 'rm -rf /' .", expected: 'ask' },
    { command: "env --chdir=/tmp rg 'rm -rf /' .", expected: 'ask' },
    { command: 'rg \'rm -rf /\' . && git -C "my repo" push --force', expected: 'ask' },
    { command: "rg 'safe'\nrm -rf /", expected: 'ask' },

    // Malformed or unsupported syntax keeps the whole-string scan (not an allow).
    { command: "rg 'rm -rf /", expected: 'ask' },
    { command: 'rg "DROP TABLE', expected: 'ask' },
    { command: 'rg "$(rm -rf /"', expected: 'ask' },
    { command: "rg $'rm -rf /' .", expected: 'ask' },
    { command: 'rg <(rm -rf /) .', expected: 'ask' },
    { command: "rg 'ok' <<EOF\nrm -rf /", expected: 'ask' },
    { command: 'rg "$(($(rm -rf /)))"', expected: 'ask' },
    { command: 'rg `rm -rf /', expected: 'ask' },
    { command: 'rg "$(echo "rm -rf /")" .', expected: 'ask' },
    { command: 'rg "$(echo \'rm -rf /)" .', expected: 'ask' },
    { command: '(rm -rf /)', expected: 'ask' },
    { command: 'rm -rf /\\', expected: 'ask' },
    { command: 'rm -rf /tmp/foo(bar)', expected: 'ask' },
    { command: "rg 'rm -rf /' )", expected: 'ask' },
    { command: '$($( $( $( $( $( $( $( $(rm -rf /)))))))))', expected: 'ask' },
    // Backtick inside double quotes, a short option that is not -c, and an
    // unclosed $( whose escaped paren does not balance.
    { command: 'rg "`rm -rf /`" .', expected: 'ask' },
    { command: "bash -l 'rm -rf /'", expected: 'ask' },
    { command: 'rg $(echo \\) rm -rf /', expected: 'ask' },

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

    test('a path-qualified or wrapped shell still has its -c payload classified (review P2)', () => {
        // Recognizing only the bare words sh/bash/zsh let `/bin/bash -c "rm -rf /"` through while
        // the identical bare command was blocked — a one-character bypass of the whole guard.
        for (const command of [
            '/bin/bash -c "rm -rf /tmp/x"',
            '/usr/bin/env bash -c "rm -rf /tmp/x"',
            '/bin/sh -c "git push --force"',
            '"/bin/zsh" -c "rm -rf ~/"',
        ]) {
            expect(classifyCommand(command), command).not.toBeNull();
        }
        // A harmless shell payload stays allowed: the exemption is for data, not for interpreters.
        expect(classifyCommand('/bin/bash -c "ls -la"')).toBeNull();
    });

    test('a redirect between a literal search and its executor does not hide the pipe (review P2)', () => {
        // `&` inside a redirection used to be read as a pipeline separator, so the search and its
        // `bash` consumer landed in different pipelines and the pipe-into-executor rule never fired.
        for (const command of [
            'rg "rm -rf /" docs 2>&1 | bash',
            'rg "rm -rf /" docs >/dev/null 2>&1 | bash',
            "grep 'git push --force' notes 2>&1 | sh",
        ]) {
            expect(classifyCommand(command), command).not.toBeNull();
        }
        // A redirection alone changes nothing: the same search is still exempt data.
        expect(classifyCommand('rg -n alpha docs 2>&1')).toBeNull();
    });

    test('shell options that take an operand do not end -c detection (review P3)', () => {
        for (const command of [
            'bash -O extglob -c "rm -rf /tmp/x"',
            'bash -o noglob -c "rm -rf /tmp/x"',
            'zsh --rcfile /tmp/x -c "git push --force"',
        ]) {
            expect(classifyCommand(command), command).not.toBeNull();
        }
        // A bare word ends the shell's option list: `-c` after it belongs to the script.
        expect(classifyCommand('bash script.sh -c ls')).toBeNull();
    });

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
