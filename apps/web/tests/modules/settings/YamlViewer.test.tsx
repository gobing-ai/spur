registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/react';
import YamlViewer, {
    highlightScalar,
    highlightYamlLine,
    splitInlineComment,
} from '../../../src/modules/settings/YamlViewer';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

afterAll(teardownHappyDom);
afterEach(() => cleanup());

describe('splitInlineComment', () => {
    test('extracts comment after whitespace', () => {
        const res = splitInlineComment('foo: bar # my comment');
        expect(res.content).toBe('foo: bar ');
        expect(res.comment).toBe('# my comment');
    });

    test('ignores # inside quotes', () => {
        const single = splitInlineComment("foo: 'bar # not a comment'");
        expect(single.content).toBe("foo: 'bar # not a comment'");
        expect(single.comment).toBeUndefined();

        const double = splitInlineComment('foo: "bar # not a comment"');
        expect(double.content).toBe('foo: "bar # not a comment"');
        expect(double.comment).toBeUndefined();
    });

    test('returns whole string when no comment exists', () => {
        const res = splitInlineComment('name: spur-new');
        expect(res.content).toBe('name: spur-new');
        expect(res.comment).toBeUndefined();
    });
});

describe('highlightScalar', () => {
    test('highlights quoted string and numbers', () => {
        const { container } = render(<div>{highlightScalar('"hello"', 'test')}</div>);
        expect(container.querySelector('.text-emerald-400')?.textContent).toBe('"hello"');
    });

    test('returns null for empty string', () => {
        expect(highlightScalar('', 'test')).toBeNull();
    });
});

describe('highlightYamlLine', () => {
    test('highlights full-line comment', () => {
        const { container } = render(<div>{highlightYamlLine('# A comment', 0)}</div>);
        expect(container.textContent).toBe('# A comment');
        const span = container.querySelector('.italic');
        expect(span).not.toBeNull();
        expect(span?.textContent).toBe('# A comment');
    });

    test('highlights key-value pair and string value', () => {
        const { container } = render(<div>{highlightYamlLine('name: "spur-new"', 0)}</div>);
        expect(container.textContent).toBe('name: "spur-new"');
        const keySpan = container.querySelector('.text-sky-400');
        expect(keySpan?.textContent).toBe('name');
        const valSpan = container.querySelector('.text-emerald-400');
        expect(valSpan?.textContent).toBe('"spur-new"');
    });

    test('highlights boolean, number, and null values', () => {
        const boolRes = render(<div>{highlightYamlLine('enabled: true', 0)}</div>);
        expect(boolRes.container.querySelector('.text-purple-400')?.textContent).toBe('true');

        const numRes = render(<div>{highlightYamlLine('port: 3000', 1)}</div>);
        expect(numRes.container.querySelector('.text-amber-400')?.textContent).toBe('3000');

        const nullRes = render(<div>{highlightYamlLine('teamId: null', 2)}</div>);
        expect(nullRes.container.querySelector('.text-purple-400')?.textContent).toBe('null');
    });

    test('highlights list item with bullet', () => {
        const { container } = render(<div>{highlightYamlLine('  - name: coder', 0)}</div>);
        const bullet = container.querySelector('.text-rose-400');
        expect(bullet?.textContent).toBe('- ');
        const key = container.querySelector('.text-sky-400');
        expect(key?.textContent).toBe('name');
    });

    test('handles document directive ---', () => {
        const { container } = render(<div>{highlightYamlLine('---', 0)}</div>);
        expect(container.textContent).toBe('---');
    });
});

describe('YamlViewer component', () => {
    const SAMPLE_YAML = `# Sample Config
version: "1.2"
name: spur-test
agent:
  executors:
    - name: alpha
      tier: standard
      disabled: false
`;

    test('renders line numbers and code lines matching input', () => {
        const { container } = render(<YamlViewer code={SAMPLE_YAML} filePath=".spur/config.yaml" />);
        const viewer = container.querySelector('[data-yaml-viewer]');
        expect(viewer).not.toBeNull();
        expect(container.textContent).toContain('.spur/config.yaml');
        expect(container.textContent).toContain('9 lines');

        const codeLines = container.querySelectorAll('[data-code-line]');
        expect(codeLines.length).toBe(9);
    });

    test('copies code to clipboard on copy button click', async () => {
        let copiedText = '';
        Object.defineProperty(navigator, 'clipboard', {
            value: {
                writeText: (text: string) => {
                    copiedText = text;
                    return Promise.resolve();
                },
            },
            configurable: true,
            writable: true,
        });

        const { container } = render(<YamlViewer code="test: true" />);
        const button = container.querySelector('[data-copy-button]') as HTMLButtonElement;
        expect(button).not.toBeNull();

        fireEvent.click(button);
        expect(copiedText).toBe('test: true');
    });
});
