/**
 * Unit tests for token cascade + redaction helpers (tasks 0246 / 0248)
 * and in-process hook record paths (coverage without spawn).
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAgentHint, resolveModelHint } from '../../lib/agent-hint';
import {
    buildToolSummary,
    cappedByteLength,
    estimateTokens,
    mapToolType,
    REDACTION_CAP_BYTES,
    recordToolUseEvent,
    redactText,
    resolveTokenEstimate,
    SUMMARY_MAX_CHARS,
    scrubSecrets,
    truncateSummary,
} from '../../lib/context-post-tool';
import { recordSessionStart } from '../../lib/context-session-start';

describe('estimateTokens', () => {
    test('ceil bytes/4', () => {
        expect(estimateTokens('x'.repeat(400))).toBe(100);
        expect(estimateTokens('ab')).toBe(1);
    });
});

describe('redactText (task 0248)', () => {
    test('caps at REDACTION_CAP_BYTES and marks truncation', () => {
        const out = redactText('y'.repeat(REDACTION_CAP_BYTES + 500));
        expect(out.endsWith('…[truncated]')).toBe(true);
        expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(REDACTION_CAP_BYTES + 20);
    });

    test('scrubs password= and Bearer / Authorization tokens', () => {
        const out = redactText('export password=hunter2\nAuthorization: Bearer abc.def.ghi\n');
        expect(out).not.toContain('hunter2');
        expect(out).not.toContain('abc.def.ghi');
        expect(out).toMatch(/password=\*\*\*/i);
        expect(out).toMatch(/Authorization:\s*\*\*\*/i);
        // Standalone Bearer line
        expect(redactText('token line: Bearer sk-live-xyz')).toMatch(/Bearer \*\*\*/i);
    });

    test.each([
        // `sk-` keys are hyphen-segmented; matching one alphanumeric block stopped at
        // the first hyphen and let every Anthropic key through verbatim.
        ['sk-ant-api03-Zm9vYmFyYmF6cXV4-AA', 'sk-ant-api03'],
        ['sk-abcdefghijklmnop', 'abcdefghijklmnop'],
        // `_` is a word char, so a leading \b never matched a namespaced env var.
        ['ANTHROPIC_API_KEY=sk-ant-secretvalue', 'secretvalue'],
        ['export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz01', 'ghp_abcdefghijklmnop'],
        ['MY_SERVICE_SECRET=hunter2', 'hunter2'],
        ['ghp_abcdefghijklmnopqrstuvwxyz01', 'abcdefghijklmnop'],
        ['github_pat_11ABCDEFG0abcdefghijklmnop', 'ABCDEFG0abcdefghij'],
        ['-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKC\n-----END RSA PRIVATE KEY-----', 'MIIEowIBAAKC'],
    ])('scrubs %j so the secret material is gone', (input, secret) => {
        expect(scrubSecrets(input)).not.toContain(secret);
    });

    test('names the scrubbed variable so the ledger stays diagnosable', () => {
        expect(scrubSecrets('ANTHROPIC_API_KEY=sk-ant-xyz')).toBe('ANTHROPIC_API_KEY=***');
    });

    test.each([
        'claude --max-tokens=4096',
        'inputTokens=1200 outputTokens=340',
        'the build is broken: see log',
        'my_secret_sauce_recipe.md',
        'git commit -m "add token bucket rate limiter"',
    ])('leaves non-secret text untouched: %j', (input) => {
        // A redactor that eats ordinary output is its own defect — the ledger exists
        // to be read.
        expect(scrubSecrets(input)).toBe(input);
    });
});

describe('scrubSecrets — quoted JSON sensitive fields (task 1158)', () => {
    test.each([
        ['{"password":"hunter2"}', '{"password":"***"}'],
        ['{"token":"SYNTH-TOKEN-VALUE"}', '{"token":"***"}'],
        ['{"api_key":"SYNTH-KEY"}', '{"api_key":"***"}'],
        ['{"API_KEY":"SYNTH-KEY"}', '{"API_KEY":"***"}'],
        ['{ "password" : "hunter2" }', '{ "password" : "***" }'],
        ['{"TOKEN":"SYN-T"}', '{"TOKEN":"***"}'],
        ['{"authorization":"Bearer SYNTH-AUTH"}', '{"authorization":"***"}'],
        ['{"private_key":"SYN-PK"}', '{"private_key":"***"}'],
    ])('redacts the quoted value of a sensitive key, keeping the key: %j', (input, expected) => {
        // A closing quote after the key is what defeated the bare `key=` matcher.
        expect(scrubSecrets(input)).toBe(expected);
    });

    test.each([
        // (a) Shell-escaped `\"key\"` inside a double-quoted Bash argument — the real
        // `curl -d "{\"password\":\"…\"}"` form. A pass keyed on a literal unescaped
        // `"key"` never matched it, so the credential persisted verbatim into the ledger.
        ['curl -d "{\\"password\\":\\"SYN-PW\\"}" https://x', 'curl -d "{\\"password\\":"***"}" https://x'],
        // (b) Single-quoted JSON keys (`{'password':'…'}`).
        [`{'password':'SYN-SQ'}`, `{'password':"***"}`],
        // Single-quoted shell wrapping around plain JSON must keep redacting (no regression).
        [`curl -d '{"password":"SYN-PW-1234"}' https://x`, `curl -d '{"password":"***"}' https://x`],
        // (c) Sensitive key with an unquoted value (`{"password": 12345}`).
        [`{"password": 12345}`, `{"password": "***"}`],
    ])('redacts a sensitive value in any quoted / shell-escaped / unquoted form: %j', (input, expected) => {
        expect(scrubSecrets(input)).toBe(expected);
    });

    test('redacts the whole shell-escaped value when a JSON-level escaped quote is inside it', () => {
        // Raw Bash: the value holds a JSON-level escaped quote (`\"` -> raw `\\\"`),
        // which is content, not the escaped opener's terminator. A regex that stopped
        // at the first inner `\"` leaked the value's tail (`word`).
        const input =
            'curl -s -X POST https://api.example.com -d "{\\"username\\":\\"bob\\",\\"password\\":\\"p@ss\\\\\\"word\\"}"';
        const out = scrubSecrets(input);
        expect(out).not.toContain('p@ss');
        // (`password` itself contains the substring `word`, so the exact-value pin
        // below is the meaningful suffix check.)
        expect(out).toContain('"{\\"username\\":\\"bob\\",\\"password\\":"***"}"');
    });

    test('fails closed: an escaped opener with no clean terminator redacts through end-of-input', () => {
        // The value never gets a clean `\"` terminator (a bare `"` and ` u` follow).
        // Falling through to the unquoted alternative matched only the leading `\` and
        // leaked the whole value; the escaped alternative must redact to EOF instead.
        const input = 'curl -d "{\\"password\\":\\"SYN-REAL-PW" u';
        const out = scrubSecrets(input);
        expect(out).not.toContain('SYN-REAL-PW');
        expect(out).toBe('curl -d "{\\"password\\":"***"');
    });

    test('leaves an array value for a sensitive key redacted-as-readable, not mangled', () => {
        // Out of scope for the scalar leak fix; the bare-value match stops at `[`/`{`
        // so an object/array value is left intact rather than half-eaten.
        expect(scrubSecrets('{"password": [1,2,3]}')).toBe('{"password": [1,2,3]}');
    });

    test('redacts nested and repeated quoted fields', () => {
        const out = scrubSecrets('{"creds":{"token":"t1"},"token":"t2"}');
        expect(out).not.toContain('t1');
        expect(out).not.toContain('t2');
        expect(out).toContain('"token":"***"');
    });

    test('redacts an escaped-quote value whole (distinct prefix and suffix both gone)', () => {
        const cmd = 'curl -d {"password":"SYN-PRE\\"SYN-MID\\"SYN-POST"} https://example.test';
        const out = scrubSecrets(cmd);
        // A regex that stops at the first escaped quote would leak the suffix.
        for (const marker of ['SYN-PRE', 'SYN-MID', 'SYN-POST']) expect(out).not.toContain(marker);
        expect(out).toContain('"password":"***"');
        expect(out).toContain('https://example.test');
    });

    test('treats escaped backslashes and inner spaces as value content', () => {
        expect(scrubSecrets('{"secret":"has space and \\\\ backslash"}')).toBe('{"secret":"***"}');
    });

    test('redacts an empty quoted value', () => {
        expect(scrubSecrets('{"token":""}')).toBe('{"token":"***"}');
    });

    test('redacts an unterminated quoted value through end-of-input', () => {
        expect(scrubSecrets('{"secret":"abc')).toBe('{"secret":"***"');
        // Trailing lone backslash must not survive as a suffix.
        expect(scrubSecrets('{"secret":"abc\\')).toBe('{"secret":"***"');
    });

    test('redacts before the 200-char summary limit and 4096-byte cap', () => {
        const summarySecret = 'SYNTH-SUMMARY-SECRET';
        const farSecret = 'SYNTH-FAR-SECRET';
        // summarySecret sits inside the first 200 chars; farSecret only past the 4 KiB cap.
        const command = `${'a'.repeat(150)} {"password":"${summarySecret}"} ${'b'.repeat(4200)} {"api_key":"${farSecret}"}`;
        const summary = buildToolSummary('Bash', { command });
        expect(summary).toBeDefined();
        expect(summary).not.toContain(summarySecret);
        expect(summary).not.toContain(farSecret);
        expect(summary?.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
        expect(redactText(command)).not.toContain(farSecret);
        // The cascade sees the scrubbed length, so the estimate still caps at 4 KiB.
        expect(cappedByteLength(command)).toBe(REDACTION_CAP_BYTES);
    });

    test.each([
        '{"token_count":5}',
        '{"file":"my_secret_sauce_recipe.md"}',
        'git commit -m "add token bucket rate limiter"',
    ])('leaves harmless JSON keys and context readable: %j', (input) => {
        expect(scrubSecrets(input)).toBe(input);
    });
});

describe('buildToolSummary / mapToolType (task 0248)', () => {
    test('maps tools to ledger types', () => {
        expect(mapToolType('Bash')).toBe('bash');
        expect(mapToolType('Grep')).toBe('grep');
        expect(mapToolType('Glob')).toBe('glob');
        expect(mapToolType('Read')).toBe('read');
        expect(mapToolType('Edit')).toBe('write');
    });

    test('summarizes Bash command, Grep pattern, Glob pattern', () => {
        expect(buildToolSummary('Bash', { command: 'ls -la /tmp' })).toBe('ls -la /tmp');
        expect(buildToolSummary('Grep', { pattern: 'foo', path: 'src' })).toContain('foo');
        expect(buildToolSummary('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts');
        expect(buildToolSummary('Bash', { command: '' })).toBeUndefined();
    });

    test('truncateSummary redacts and shortens', () => {
        const long = `echo ${'a'.repeat(300)}`;
        const s = truncateSummary(long, 50);
        expect(s.length).toBeLessThanOrEqual(50);
        expect(s.endsWith('…')).toBe(true);
    });
});

describe('resolveTokenEstimate cascade', () => {
    test('prefers tool_response.content', () => {
        expect(
            resolveTokenEstimate('Write', { file_path: '/a.ts', content: 'short' }, { content: 'x'.repeat(400) }),
        ).toBe(100);
    });

    test('Write falls back to tool_input.content', () => {
        expect(resolveTokenEstimate('Write', { file_path: '/a.ts', content: 'y'.repeat(400) }, {})).toBe(100);
    });

    test('Edit falls back to old_string + new_string', () => {
        expect(
            resolveTokenEstimate(
                'Edit',
                { file_path: '/a.ts', old_string: 'a'.repeat(200), new_string: 'b'.repeat(200) },
                {},
            ),
        ).toBe(100);
    });

    test('Read falls back to file stat size', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-tok-'));
        try {
            const file = join(dir, 'f.ts');
            writeFileSync(file, 'z'.repeat(400));
            expect(resolveTokenEstimate('Read', { file_path: file }, {})).toBe(100);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('Bash uses capped response size', () => {
        expect(resolveTokenEstimate('Bash', { command: 'ls' }, { content: 'x'.repeat(400) })).toBe(100);
        expect(resolveTokenEstimate('Bash', { command: 'ls' }, { content: 'x'.repeat(20_000) })).toBe(
            Math.ceil(REDACTION_CAP_BYTES / 4),
        );
        expect(resolveTokenEstimate('Bash', { command: 'ls' }, {})).toBeUndefined();
        // stdout/stderr fields count toward estimate input (joined with \n)
        expect(
            resolveTokenEstimate('Bash', { command: 'ls' }, { stdout: 'x'.repeat(200), stderr: 'y'.repeat(200) }),
        ).toBe(Math.ceil((200 + 1 + 200) / 4));
    });

    test('Grep/Glob use result size or undefined', () => {
        expect(resolveTokenEstimate('Grep', { pattern: 'a' }, { content: 'hit\n' })).toBe(
            Math.ceil(new TextEncoder().encode('hit\n').length / 4),
        );
        expect(resolveTokenEstimate('Glob', { pattern: '*.ts' }, {})).toBeUndefined();
    });

    test('returns undefined when unknown', () => {
        expect(resolveTokenEstimate('Edit', { file_path: '/nope.ts' }, {})).toBeUndefined();
        expect(resolveTokenEstimate('Write', { file_path: '/a.ts' }, {})).toBeUndefined();
    });
});

describe('session start hints', () => {
    test('resolveAgentHint / resolveModelHint from env', () => {
        expect(resolveAgentHint({ SPUR_AGENT: 'omp' })).toBe('omp');
        expect(resolveModelHint({ ANTHROPIC_MODEL: 'claude-x' })).toBe('claude-x');
        expect(resolveAgentHint({})).toBeUndefined();
        expect(resolveModelHint({})).toBeUndefined();
        // Alternate env keys
        expect(resolveAgentHint({ CLAUDE_CODE_ENTRYPOINT: 'cli' })).toBe('cli');
        expect(resolveModelHint({ OPENAI_MODEL: 'gpt-x' })).toBe('gpt-x');
    });
});

describe('recordSessionStart (in-process)', () => {
    test('writes .session.json and session_start ledger line with agent/model', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-sess-'));
        const ctx = join(dir, '.spur', 'context');
        try {
            const fixed = new Date('2026-07-12T15:04:00.000Z');
            const id = recordSessionStart(ctx, { SPUR_AGENT: 'claude', SPUR_MODEL: 'opus' }, () => fixed);
            expect(id).toMatch(/^session-2026-07-12-1504\d{2}-[0-9a-f]{8}$/);
            if (id === null) throw new Error('recordSessionStart returned null for a valid context');
            const session = JSON.parse(readFileSync(join(ctx, '.session.json'), 'utf-8')) as {
                session: string;
                agent: string;
                model: string;
            };
            expect(session.session).toBe(id);
            expect(session.agent).toBe('claude');
            expect(session.model).toBe('opus');
            const ledger = readFileSync(join(ctx, 'token-ledger.jsonl'), 'utf-8');
            expect(ledger).toContain('session_start');
            expect(ledger).toContain('claude');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('returns null when mkdir or ledger write cannot complete', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-sess-fail-'));
        try {
            // mkdir fails when parent is a file
            const blocker = join(dir, 'not-a-dir');
            writeFileSync(blocker, 'x');
            expect(recordSessionStart(join(blocker, 'ctx'))).toBeNull();

            // ledger path is a directory → appendFileSync fails after session write
            const ctx = join(dir, 'ctx');
            mkdirSync(ctx, { recursive: true });
            mkdirSync(join(ctx, 'token-ledger.jsonl'));
            expect(recordSessionStart(ctx)).toBeNull();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('recordToolUseEvent (in-process)', () => {
    test('records Read and rejects unknown tools / missing session', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-rec-'));
        const ctx = join(dir, '.spur', 'context');
        mkdirSync(ctx, { recursive: true });
        try {
            expect(recordToolUseEvent(ctx, { tool_name: 'Read', tool_input: { file_path: '/a.ts' } })).toBeNull();

            writeFileSync(join(ctx, '.session.json'), JSON.stringify({ session: 's1', agent: 'a' }));
            expect(recordToolUseEvent(ctx, { tool_name: 'ToolX', tool_input: { command: 'x' } })).toBeNull();
            expect(recordToolUseEvent(ctx, { tool_name: 'Bash', tool_input: { command: '' } })).toBeNull();
            expect(recordToolUseEvent(ctx, { tool_name: 'Read', tool_input: {} })).toBeNull();

            const evt = recordToolUseEvent(
                ctx,
                {
                    session_id: 'plat-1',
                    tool_name: 'Read',
                    tool_input: { file_path: '/a.ts' },
                    tool_response: { content: 'hi' },
                },
                () => new Date('2026-07-12T12:00:00.000Z'),
            );
            expect(evt).toMatchObject({
                type: 'read',
                file: '/a.ts',
                session: 's1',
                sessionId: 'plat-1',
                agent: 'a',
            });
            expect(existsSync(join(ctx, 'token-ledger.jsonl'))).toBe(true);

            const bash = recordToolUseEvent(ctx, {
                tool_name: 'Bash',
                tool_input: { command: 'ls -la' },
                tool_response: { content: 'x'.repeat(20_000) },
            });
            expect(bash?.type).toBe('bash');
            expect(bash?.summary).toBe('ls -la');
            expect(bash?.tokens).toBe(Math.ceil(REDACTION_CAP_BYTES / 4));

            const write = recordToolUseEvent(ctx, {
                tool_name: 'Write',
                tool_input: { file_path: '/b.ts', content: 'body' },
                tool_response: {},
            });
            expect(write?.action).toBe('create');
            expect(write?.tokens).toBe(Math.ceil(new TextEncoder().encode('body').length / 4));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('ignores malformed session file and skips empty Grep pattern', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-rec2-'));
        const ctx = join(dir, '.spur', 'context');
        mkdirSync(ctx, { recursive: true });
        try {
            writeFileSync(join(ctx, '.session.json'), '{not json');
            expect(
                recordToolUseEvent(ctx, {
                    tool_name: 'Grep',
                    tool_input: { pattern: 'x' },
                }),
            ).toBeNull();

            writeFileSync(join(ctx, '.session.json'), JSON.stringify({ session: 's2' }));
            expect(recordToolUseEvent(ctx, { tool_name: 'Grep', tool_input: {} })).toBeNull();
            const g = recordToolUseEvent(ctx, {
                tool_name: 'Grep',
                tool_input: { pattern: 'TODO', path: 'src' },
                tool_response: { content: 'hit' },
            });
            expect(g?.type).toBe('grep');
            expect(String(g?.summary)).toContain('TODO');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('quoted JSON credentials are scrubbed from both the returned event and the ledger bytes (task 1158)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-rec-json-'));
        const ctx = join(dir, '.spur', 'context');
        mkdirSync(ctx, { recursive: true });
        try {
            writeFileSync(join(ctx, '.session.json'), JSON.stringify({ session: 's-json' }));
            // Synthetic values only — never persist a real credential.
            const markers = ['SYN-PRE', 'SYN-MID', 'SYN-POST', 'SYN-TOKEN-VALUE', 'SYN-KEY'];
            const command = `curl -s -X POST -d {"password":"SYN-PRE\\"SYN-MID\\"SYN-POST","token":"SYN-TOKEN-VALUE","api_key":"SYN-KEY"} https://example.test`;
            const event = recordToolUseEvent(ctx, {
                tool_name: 'Bash',
                tool_input: { command },
                tool_response: { content: 'ok' },
            });
            expect(event).not.toBeNull();
            const summary = String(event?.summary);
            for (const marker of markers) expect(summary).not.toContain(marker);
            expect(summary).toContain('"password":"***"');
            // Assert the raw appended bytes, not only the returned object.
            const ledgerBytes = readFileSync(join(ctx, 'token-ledger.jsonl'), 'utf-8');
            for (const marker of markers) expect(ledgerBytes).not.toContain(marker);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('scrubs shell-escaped JSON credentials from the persisted ledger bytes (task 1158)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-rec-escaped-json-'));
        const ctx = join(dir, '.spur', 'context');
        mkdirSync(ctx, { recursive: true });
        try {
            writeFileSync(join(ctx, '.session.json'), JSON.stringify({ session: 's-esc' }));
            // Synthetic values only. Real Bash form: JSON nested in a double-quoted arg,
            // so every JSON quote reaches the hook as `\"`.
            const markers = ['SYN-ESC-PW', 'SYN-ESC-TK'];
            const command = `curl -s -X POST -d "{\\"password\\":\\"${markers[0]}\\",\\"token\\":\\"${markers[1]}\\"}" https://example.test`;
            const event = recordToolUseEvent(ctx, {
                tool_name: 'Bash',
                tool_input: { command },
                tool_response: { content: 'ok' },
            });
            expect(event).not.toBeNull();
            const summary = String(event?.summary);
            for (const marker of markers) expect(summary).not.toContain(marker);
            expect(summary).toContain('\\"password\\":"***"');
            // Assert the raw appended bytes — JSON.stringify re-escapes the backslashes.
            const ledgerBytes = readFileSync(join(ctx, 'token-ledger.jsonl'), 'utf-8');
            for (const marker of markers) expect(ledgerBytes).not.toContain(marker);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
