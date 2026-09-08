import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DbAdapter } from '@gobing-ai/spur-domain';
import { CommandError, errorMessage, SQLITE_BUSY_MESSAGE_CONSTANTS } from '../src/errors';
import { main } from '../src/index';
import type { CommandOutput } from '../src/output';

describe('errors', () => {
    describe('CommandError', () => {
        test('has name and exit code', () => {
            const err = new CommandError('test error', 2);
            expect(err.message).toBe('test error');
            expect(err.name).toBe('CommandError');
            expect(err.exitCode).toBe(2);
        });

        test('default exit code is 1', () => {
            const err = new CommandError('default');
            expect(err.exitCode).toBe(1);
        });

        test('is instance of Error', () => {
            const err = new CommandError('test');
            expect(err).toBeInstanceOf(Error);
        });

        test('is instance of CommandError', () => {
            const err = new CommandError('test');
            expect(err).toBeInstanceOf(CommandError);
        });

        test('preserves custom exit code 0', () => {
            const err = new CommandError('ok', 0);
            expect(err.exitCode).toBe(0);
        });
    });

    describe('errorMessage', () => {
        test('extracts message from Error', () => {
            expect(errorMessage(new Error('boom'))).toBe('boom');
        });

        test('formats SQLITE_BUSY errors as a one-line retry suggestion', () => {
            const err = new Error('SQLITE_BUSY: database is locked') as Error & { code: string };
            err.code = 'SQLITE_BUSY';

            const message = errorMessage(err);
            expect(message).toContain(SQLITE_BUSY_MESSAGE_CONSTANTS.dbPath);
            expect(message).toContain(SQLITE_BUSY_MESSAGE_CONSTANTS.remediation);
            // One sentence — no extra prose beyond path + remediation.
            expect(message.split('\n')).toHaveLength(1);
        });

        test('formats string SQLITE_BUSY errors with path + remediation', () => {
            const message = errorMessage('SQLITE_BUSY: database is locked');
            expect(message).toContain(SQLITE_BUSY_MESSAGE_CONSTANTS.dbPath);
            expect(message).toContain(SQLITE_BUSY_MESSAGE_CONSTANTS.remediation);
        });

        test('SQLITE_BUSY error with code field surfaces both dbPath and remediation', () => {
            const err = new Error('database is locked') as Error & { code: string };
            err.code = 'SQLITE_BUSY';
            const message = errorMessage(err);
            expect(message).toContain(SQLITE_BUSY_MESSAGE_CONSTANTS.dbPath);
            expect(message).toContain('lsof .spur/spur.db');
            expect(message).toContain('spur serve');
        });

        test('handles non-Error values', () => {
            expect(errorMessage('string error')).toBe('string error');
            expect(errorMessage(42)).toBe('42');
        });

        test('handles null', () => {
            expect(errorMessage(null)).toBe('null');
        });

        test('handles undefined', () => {
            expect(errorMessage(undefined)).toBe('undefined');
        });

        test('handles object', () => {
            expect(errorMessage({ key: 'val' })).toBe('[object Object]');
        });
    });

    describe('SQLITE_BUSY_MESSAGE_CONSTANTS', () => {
        test('dbPath is the canonical Spur project database path', () => {
            expect(SQLITE_BUSY_MESSAGE_CONSTANTS.dbPath).toBe('.spur/spur.db');
        });

        test('remediation names the holder-identification command', () => {
            expect(SQLITE_BUSY_MESSAGE_CONSTANTS.remediation).toContain('lsof .spur/spur.db');
        });

        test('remediation names both recovery paths (stale process and spur serve)', () => {
            expect(SQLITE_BUSY_MESSAGE_CONSTANTS.remediation).toContain('stale Spur process');
            expect(SQLITE_BUSY_MESSAGE_CONSTANTS.remediation).toContain('spur serve');
        });
    });
});

describe('SQLITE_BUSY exit-code propagation through CLI dispatch', () => {
    /**
     * Build a stub `DbAdapter` whose every call throws a SQLITE_BUSY-coded
     * error, mirroring the runtime error shape the Bun SQLite adapter emits
     * when a writer holds the lock and busy_timeout is exceeded. Used to
     * drive `errorMessage()` through real CLI dispatch: the rule-run verb
     * loads the rule file from disk (independent of the db), then calls
     * `context.getDb()` inside the un-guarded action — which throws and
     * escapes to runCommandDispatch's catch, where errorMessage() formats
     * the user-facing message and the exit code is set to 1.
     */
    function busyDbStub(): DbAdapter {
        const makeBusyError = (): Error => {
            const err = new Error('SQLITE_BUSY: database is locked') as Error & { code: string };
            err.code = 'SQLITE_BUSY';
            return err;
        };
        return {
            db: {} as never,
            queryFirst: (async () => {
                throw makeBusyError();
            }) as DbAdapter['queryFirst'],
            queryAll: (async () => {
                throw makeBusyError();
            }) as DbAdapter['queryAll'],
            exec: (async () => {
                throw makeBusyError();
            }) as DbAdapter['exec'],
            run: (async () => {
                throw makeBusyError();
            }) as DbAdapter['run'],
            batch: (async () => {
                throw makeBusyError();
            }) as DbAdapter['batch'],
            close: () => {},
        };
    }

    function capturingOutput(): CommandOutput & { messages: string[]; errors: string[] } {
        const captured = { messages: [] as string[], errors: [] as string[] };
        return {
            ...captured,
            write: (m: string) => captured.messages.push(m),
            error: (m: string) => captured.errors.push(m),
        };
    }

    test('rule run verb with a SQLITE_BUSY-throwing db exits non-zero with path + remediation', async () => {
        // Use an absolute rule-file path so loadRuleFile resolves against the
        // test fixture, not the test runner's process cwd. The action's
        // getDb() call then throws SQLITE_BUSY, escaping the un-guarded run
        // action and reaching runCommandDispatch's catch where errorMessage()
        // formats the user-facing message.
        const cwd = mkdtempSync(join(tmpdir(), 'spur-busy-'));
        const file = join(cwd, 'rules.yaml');
        writeFileSync(
            file,
            [
                'rules:',
                '  - id: sample-rule',
                '    description: Sample rule',
                '    evaluator:',
                '      type: path',
                '      config:',
                '        paths:',
                '          - package.json',
            ].join('\n'),
            'utf8',
        );

        const output = capturingOutput();
        const exitCode = await main(['rule', 'run', '--file', file], {
            cwd,
            output,
            db: busyDbStub(),
        });

        expect(exitCode).not.toBe(0);
        const stderr = output.errors.join('\n');
        expect(stderr).toContain(SQLITE_BUSY_MESSAGE_CONSTANTS.dbPath);
        expect(stderr).toContain(SQLITE_BUSY_MESSAGE_CONSTANTS.remediation);
    });
});
