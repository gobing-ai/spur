import { describe, expect, test } from 'bun:test';
import { renderTemplate } from '../src/template-renderer';

describe('renderTemplate', () => {
    test('replaces placeholder tokens', () => {
        const result = renderTemplate('Hello {{ NAME }}!', { NAME: 'World' });
        expect(result).toBe('Hello World!');
    });

    test('leaves unmatched placeholders unchanged', () => {
        const result = renderTemplate('{{ FOO }} {{ BAR }}', { FOO: 'foo' });
        expect(result).toBe('foo {{ BAR }}');
    });

    test('handles multi-line templates', () => {
        const tmpl = '# {{ TITLE }}\n\n{{ BODY }}\n';
        const result = renderTemplate(tmpl, { TITLE: 'Hello', BODY: 'World' });
        expect(result).toBe('# Hello\n\nWorld\n');
    });
});
