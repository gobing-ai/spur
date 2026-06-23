import { describe, expect, test } from 'bun:test';
import React from 'react';
import { Button } from '../../src/ui';

describe('Button', () => {
    // AC scenario 7 (task 0101): the ui.ts barrel is the sole public import surface.
    test('is exported from the ui.ts barrel as a named function component', () => {
        expect(Button).toBeFunction();
        expect(Button.name).toBe('Button');
    });

    test('renders a button with btn base class', () => {
        const result = Button({ children: 'Click' });
        expect(result.type).toBe('button');
        expect(result.props.className).toContain('btn');
        const childrenArr = result.props.children as React.ReactNode[];
        expect(childrenArr.some((c) => c === 'Click')).toBe(true);
    });

    test('applies variant class', () => {
        expect(Button({ variant: 'primary', children: 'P' }).props.className).toContain('btn-primary');
        expect(Button({ variant: 'ghost', children: 'G' }).props.className).toContain('btn-ghost');
        expect(Button({ variant: 'error', children: 'E' }).props.className).toContain('btn-error');
        expect(Button({ variant: 'outline', children: 'O' }).props.className).toContain('btn-outline');
        expect(Button({ variant: 'accent', children: 'A' }).props.className).toContain('btn-accent');
    });

    test('applies size class', () => {
        expect(Button({ size: 'xs', children: 'XS' }).props.className).toContain('btn-xs');
        expect(Button({ size: 'sm', children: 'SM' }).props.className).toContain('btn-sm');
        expect(Button({ size: 'lg', children: 'LG' }).props.className).toContain('btn-lg');
    });

    test('no variant or size adds only base btn class', () => {
        expect(Button({ children: 'Base' }).props.className).toBe('btn');
    });

    test('combines variant, size, and className', () => {
        const cls = Button({ variant: 'primary', size: 'sm', className: 'ml-2 w-full', children: 'X' }).props.className;
        expect(cls).toContain('btn');
        expect(cls).toContain('btn-primary');
        expect(cls).toContain('btn-sm');
        expect(cls).toContain('ml-2');
        expect(cls).toContain('w-full');
    });

    test('loading adds spinner and disables button', () => {
        const result = Button({ loading: true, children: 'Loading' });
        expect(result.props.disabled).toBe(true);
        const children = result.props.children as React.ReactNode[];
        const spinner = children.find((c) => React.isValidElement(c) && c.type === 'span');
        expect(spinner).toBeDefined();
        expect((spinner as React.ReactElement<{ className: string }>).props.className).toBe('loading loading-spinner');
    });

    test('loading overrides explicit disabled', () => {
        expect(Button({ loading: true, disabled: false, children: 'X' }).props.disabled).toBe(true);
    });

    test('disabled prop passes through', () => {
        expect(Button({ disabled: true, children: 'X' }).props.disabled).toBe(true);
    });

    test('passes through extra HTML attributes', () => {
        const onClick = () => {};
        const result = Button({ onClick, 'aria-label': 'Close', type: 'submit', children: 'Submit' });
        expect(result.props.onClick).toBe(onClick);
        expect(result.props['aria-label']).toBe('Close');
        expect(result.props.type).toBe('submit');
    });

    test('asChild wraps a single React element', () => {
        const link = React.createElement('a', { href: '/home', className: 'existing' }, 'Home');
        const result = Button({ asChild: true, variant: 'primary', children: link });
        expect(result.type).toBe('a');
        expect(result.props.className).toContain('btn');
        expect(result.props.className).toContain('btn-primary');
        expect(result.props.className).toContain('existing');
        expect(result.props.href).toBe('/home');
    });

    test('asChild with non-element children falls back to button', () => {
        const result = Button({ asChild: true, children: 'Just text' });
        expect(result.type).toBe('button');
        expect(result.props.className).toContain('btn');
    });
});
