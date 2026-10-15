/** pi-event — Pi tool event → Claude ToolPayload normalization (ported from guard-extension). */

import { describe, expect, test } from 'bun:test';
import { normalizePiToolEvent } from '../../src/hooks/pi-event';

describe('normalizePiToolEvent', () => {
    test('maps each Pi tool onto the Claude payload the ledger core records', () => {
        expect(normalizePiToolEvent('read', { path: 'a.ts' }, 'body')).toEqual({
            tool_name: 'Read',
            tool_input: { file_path: 'a.ts' },
            tool_response: { content: 'body' },
        });
        expect(normalizePiToolEvent('write', { file_path: 'b.ts', content: 'x' })).toEqual({
            tool_name: 'Write',
            tool_input: { file_path: 'b.ts', content: 'x' },
            tool_response: undefined,
        });
        expect(
            normalizePiToolEvent('edit', { path: 'c.ts', edits: [{ oldText: 'a', newText: 'b' }, { oldText: 'c' }] }),
        ).toMatchObject({ tool_name: 'Edit', tool_input: { file_path: 'c.ts', old_string: 'ac', new_string: 'b' } });
        expect(normalizePiToolEvent('edit', { path: 'c.ts' })?.tool_input).toMatchObject({ old_string: '' });
        expect(normalizePiToolEvent('grep', { pattern: 'p', path: 'src', glob: '*.ts' })?.tool_input).toEqual({
            pattern: 'p',
            path: 'src',
            glob: '*.ts',
        });
        expect(normalizePiToolEvent('grep', { pattern: 'p' })?.tool_input).toEqual({ pattern: 'p' });
        expect(normalizePiToolEvent('find', { pattern: '*.md', path: 'docs' })?.tool_input).toEqual({
            pattern: '*.md',
            path: 'docs',
        });
        expect(normalizePiToolEvent('find', { pattern: '*.md' })?.tool_input).toEqual({ pattern: '*.md' });
        expect(normalizePiToolEvent('bash', undefined, [{ text: 'l1' }, { text: 'l2' }, { other: 1 }, null])).toEqual({
            tool_name: 'Bash',
            tool_input: { command: '' },
            tool_response: { content: 'l1\nl2' },
        });
        expect(normalizePiToolEvent('bash', { command: 'ls' }, 42)?.tool_response).toBeUndefined();
    });

    test('an unmapped tool returns null so nothing is recorded', () => {
        expect(normalizePiToolEvent('web_search', {})).toBeNull();
    });
});
