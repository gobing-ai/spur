import { describe, expect, test } from 'bun:test';
import React from 'react';
import {
    Badge,
    Card,
    CardBody,
    Checkbox,
    Input,
    Join,
    JoinItem,
    Loading,
    Modal,
    Select,
    Textarea,
    Toggle,
} from '../../src/ui';

describe('ui.ts barrel exports', () => {
    test('all new wrappers are exported as named function components', () => {
        for (const [name, fn] of [
            ['Badge', Badge],
            ['Card', Card],
            ['CardBody', CardBody],
            ['Checkbox', Checkbox],
            ['Input', Input],
            ['Join', Join],
            ['JoinItem', JoinItem],
            ['Loading', Loading],
            ['Modal', Modal],
            ['Select', Select],
            ['Textarea', Textarea],
            ['Toggle', Toggle],
        ] as const) {
            expect(fn).toBeFunction();
            expect(fn.name).toBe(name);
        }
    });
});

describe('Badge', () => {
    test('renders a span with badge base class', () => {
        const result = Badge({ children: 'New' });
        expect(result.type).toBe('span');
        expect(result.props.className).toContain('badge');
    });

    test('applies variant class', () => {
        expect(Badge({ variant: 'primary', children: 'P' }).props.className).toContain('badge-primary');
        expect(Badge({ variant: 'success', children: 'S' }).props.className).toContain('badge-success');
        expect(Badge({ variant: 'error', children: 'E' }).props.className).toContain('badge-error');
        expect(Badge({ variant: 'outline', children: 'O' }).props.className).toContain('badge-outline');
    });

    test('applies size class', () => {
        expect(Badge({ size: 'xs', children: 'X' }).props.className).toContain('badge-xs');
        expect(Badge({ size: 'sm', children: 'S' }).props.className).toContain('badge-sm');
        expect(Badge({ size: 'lg', children: 'L' }).props.className).toContain('badge-lg');
    });

    test('no variant or size adds only base badge class', () => {
        expect(Badge({ children: 'Base' }).props.className).toBe('badge');
    });

    test('combines variant, size, and className', () => {
        const cls = Badge({ variant: 'warning', size: 'xs', className: 'ml-1', children: 'X' }).props.className;
        expect(cls).toContain('badge');
        expect(cls).toContain('badge-warning');
        expect(cls).toContain('badge-xs');
        expect(cls).toContain('ml-1');
    });

    test('passes through extra HTML attributes', () => {
        const onClick = () => {};
        const result = Badge({ onClick, 'aria-label': 'status', children: 'X' });
        expect(result.props.onClick).toBe(onClick);
        expect(result.props['aria-label']).toBe('status');
    });
});

describe('Card', () => {
    test('renders a div with card base class', () => {
        const result = Card({ children: 'content' });
        expect(result.type).toBe('div');
        expect(result.props.className).toContain('card');
    });

    test('applies variant class', () => {
        expect(Card({ variant: 'bordered', children: 'X' }).props.className).toContain('card-bordered');
        expect(Card({ variant: 'compact', children: 'X' }).props.className).toContain('card-compact');
        expect(Card({ variant: 'side', children: 'X' }).props.className).toContain('card-side');
    });

    test('no variant adds only base card class', () => {
        expect(Card({ children: 'Base' }).props.className).toBe('card');
    });

    test('combines variant and className', () => {
        const cls = Card({ variant: 'compact', className: 'shadow-lg', children: 'X' }).props.className;
        expect(cls).toContain('card');
        expect(cls).toContain('card-compact');
        expect(cls).toContain('shadow-lg');
    });

    test('asChild merges classes onto child element', () => {
        const link = React.createElement('a', { href: '/detail', className: 'existing' }, 'Link');
        const result = Card({ asChild: true, variant: 'compact', children: link });
        expect(result.type).toBe('a');
        expect(result.props.className).toContain('card');
        expect(result.props.className).toContain('card-compact');
        expect(result.props.className).toContain('existing');
        expect(result.props.href).toBe('/detail');
    });

    test('asChild with non-element children falls back to div', () => {
        const result = Card({ asChild: true, children: 'just text' });
        expect(result.type).toBe('div');
        expect(result.props.className).toContain('card');
    });

    test('CardBody renders card-body class', () => {
        const result = CardBody({ children: 'body' });
        expect(result.type).toBe('div');
        expect(result.props.className).toContain('card-body');
    });

    test('CardBody passes through className', () => {
        const cls = CardBody({ className: 'p-4', children: 'X' }).props.className;
        expect(cls).toContain('card-body');
        expect(cls).toContain('p-4');
    });
});

describe('Checkbox', () => {
    test('renders an input with checkbox base class and type=checkbox', () => {
        const result = Checkbox({});
        expect(result.type).toBe('input');
        expect(result.props.type).toBe('checkbox');
        expect(result.props.className).toContain('checkbox');
    });

    test('applies variant class', () => {
        expect(Checkbox({ variant: 'primary' }).props.className).toContain('checkbox-primary');
        expect(Checkbox({ variant: 'success' }).props.className).toContain('checkbox-success');
        expect(Checkbox({ variant: 'error' }).props.className).toContain('checkbox-error');
    });

    test('applies size class', () => {
        expect(Checkbox({ size: 'xs' }).props.className).toContain('checkbox-xs');
        expect(Checkbox({ size: 'lg' }).props.className).toContain('checkbox-lg');
    });

    test('no variant or size adds only base checkbox class', () => {
        expect(Checkbox({}).props.className).toBe('checkbox');
    });

    test('passes through HTML attributes', () => {
        const result = Checkbox({ checked: true, onChange: () => {}, 'aria-label': 'agree' });
        expect(result.props.checked).toBe(true);
        expect(result.props['aria-label']).toBe('agree');
    });
});

describe('Input', () => {
    test('renders an input with input base class', () => {
        const result = Input({});
        expect(result.type).toBe('input');
        expect(result.props.className).toContain('input');
    });

    test('applies variant class', () => {
        expect(Input({ variant: 'bordered' }).props.className).toContain('input-bordered');
        expect(Input({ variant: 'ghost' }).props.className).toContain('input-ghost');
        expect(Input({ variant: 'error' }).props.className).toContain('input-error');
    });

    test('applies size class', () => {
        expect(Input({ size: 'xs' }).props.className).toContain('input-xs');
        expect(Input({ size: 'xl' }).props.className).toContain('input-xl');
    });

    test('error prop adds input-error class', () => {
        const cls = Input({ variant: 'primary', error: true }).props.className;
        expect(cls).toContain('input-error');
        expect(cls).toContain('input-primary');
    });

    test('no variant adds only base input class', () => {
        expect(Input({}).props.className).toBe('input');
    });

    test('passes through HTML attributes', () => {
        const result = Input({ placeholder: 'Enter', type: 'email', disabled: true });
        expect(result.props.placeholder).toBe('Enter');
        expect(result.props.type).toBe('email');
        expect(result.props.disabled).toBe(true);
    });
});

describe('Join', () => {
    test('renders a div with join base class and horizontal orientation by default', () => {
        const result = Join({ children: 'items' });
        expect(result.type).toBe('div');
        expect(result.props.className).toContain('join');
        expect(result.props.className).toContain('join-horizontal');
    });

    test('applies vertical orientation', () => {
        expect(Join({ orientation: 'vertical', children: 'X' }).props.className).toContain('join-vertical');
    });

    test('applies variant class', () => {
        expect(Join({ variant: 'primary', children: 'X' }).props.className).toContain('join-item-primary');
        expect(Join({ variant: 'success', children: 'X' }).props.className).toContain('join-item-success');
    });

    test('combines variant, orientation, and className', () => {
        const cls = Join({ variant: 'accent', orientation: 'vertical', className: 'w-full', children: 'X' }).props
            .className;
        expect(cls).toContain('join');
        expect(cls).toContain('join-item-accent');
        expect(cls).toContain('join-vertical');
        expect(cls).toContain('w-full');
    });
});

describe('JoinItem', () => {
    test('renders a span with join-item base class', () => {
        const result = JoinItem({ children: 'item' });
        expect(result.type).toBe('span');
        expect(result.props.className).toContain('join-item');
    });

    test('passes through className', () => {
        const cls = JoinItem({ className: 'btn', children: 'X' }).props.className;
        expect(cls).toContain('join-item');
        expect(cls).toContain('btn');
    });

    test('asChild merges classes onto child element', () => {
        const btn = React.createElement('button', { type: 'button', className: 'btn-primary' }, 'Click');
        const result = JoinItem({ asChild: true, children: btn });
        expect(result.type).toBe('button');
        expect(result.props.className).toContain('join-item');
        expect(result.props.className).toContain('btn-primary');
    });

    test('asChild with non-element children falls back to span', () => {
        const result = JoinItem({ asChild: true, children: 'text' });
        expect(result.type).toBe('span');
        expect(result.props.className).toContain('join-item');
    });
});

describe('Loading', () => {
    test('renders a span with loading base class and spinner variant by default', () => {
        const result = Loading({});
        expect(result.type).toBe('span');
        expect(result.props.className).toContain('loading');
        expect(result.props.className).toContain('loading-spinner');
    });

    test('applies variant class', () => {
        expect(Loading({ variant: 'dots' }).props.className).toContain('loading-dots');
        expect(Loading({ variant: 'ring' }).props.className).toContain('loading-ring');
        expect(Loading({ variant: 'bars' }).props.className).toContain('loading-bars');
        expect(Loading({ variant: 'infinity' }).props.className).toContain('loading-infinity');
    });

    test('applies size class', () => {
        expect(Loading({ size: 'xs' }).props.className).toContain('loading-xs');
        expect(Loading({ size: 'xl' }).props.className).toContain('loading-xl');
    });

    test('explicit variant overrides default spinner', () => {
        const cls = Loading({ variant: 'ball' }).props.className;
        expect(cls).toContain('loading-ball');
        expect(cls).not.toContain('loading-spinner');
    });

    test('combines variant, size, and className', () => {
        const cls = Loading({ variant: 'dots', size: 'lg', className: 'mr-2' }).props.className;
        expect(cls).toContain('loading');
        expect(cls).toContain('loading-dots');
        expect(cls).toContain('loading-lg');
        expect(cls).toContain('mr-2');
    });
});

describe('Modal', () => {
    test('renders nothing when open is false', () => {
        const result = Modal({ open: false, children: 'content' });
        expect(result).toBeNull();
    });

    test('renders modal structure when open is true', () => {
        const result = Modal({ open: true, children: 'content' }) as React.ReactElement;
        expect(result.type).toBe('div');
        const props = result.props as Record<string, unknown>;
        const className = props.className as string;
        expect(className).toContain('modal');
        expect(className).toContain('modal-open');
        expect(props.role).toBe('dialog');
        expect(props['aria-modal']).toBe('true');
    });

    test('applies variant class to modal-box', () => {
        const result = Modal({ open: true, variant: 'primary', children: 'X' }) as React.ReactElement;
        const box = (result.props as Record<string, unknown>).children as React.ReactElement;
        const boxProps = box.props as Record<string, unknown>;
        const className = boxProps.className as string;
        expect(className).toContain('modal-box');
        expect(className).toContain('modal-primary');
    });

    test('onClose is called on backdrop click', () => {
        let closed = false;
        const result = Modal({
            open: true,
            onClose: () => {
                closed = true;
            },
            children: 'X',
        }) as React.ReactElement;
        const props = result.props as Record<string, unknown>;
        const onClick = props.onClick as (e: React.MouseEvent) => void;
        onClick({} as React.MouseEvent);
        expect(closed).toBe(true);
    });

    test('onClose is called on Escape key', () => {
        let closed = false;
        const result = Modal({
            open: true,
            onClose: () => {
                closed = true;
            },
            children: 'X',
        }) as React.ReactElement;
        const props = result.props as Record<string, unknown>;
        const onKeyDown = props.onKeyDown as (e: React.KeyboardEvent) => void;
        onKeyDown({ key: 'Escape' } as React.KeyboardEvent);
        expect(closed).toBe(true);
    });

    test('backdrop click closes the modal when the backdrop itself is the click target', () => {
        let closed = false;
        const result = Modal({
            open: true,
            onClose: () => {
                closed = true;
            },
            children: 'X',
        }) as React.ReactElement;
        const props = result.props as Record<string, unknown>;
        const onClick = props.onClick as (e: { target: unknown; currentTarget: unknown }) => void;
        const backdrop = {};
        onClick({ target: backdrop, currentTarget: backdrop });
        expect(closed).toBe(true);
    });

    test('click bubbled from modal-box content does not close the modal', () => {
        let closed = false;
        const result = Modal({
            open: true,
            onClose: () => {
                closed = true;
            },
            children: 'X',
        }) as React.ReactElement;
        const props = result.props as Record<string, unknown>;
        const onClick = props.onClick as (e: { target: unknown; currentTarget: unknown }) => void;
        // Different target vs currentTarget = click bubbled up from inside the box.
        onClick({ target: {}, currentTarget: {} });
        expect(closed).toBe(false);
    });

    test('modal-box carries no event handlers (backdrop uses target-check, not stopPropagation)', () => {
        const result = Modal({ open: true, onClose: () => {}, children: 'X' }) as React.ReactElement;
        const box = (result.props as Record<string, unknown>).children as React.ReactElement;
        const boxProps = box.props as Record<string, unknown>;
        expect(boxProps.onClick).toBeUndefined();
        expect(boxProps.onKeyDown).toBeUndefined();
    });
});

describe('Select', () => {
    test('renders a select with select base class', () => {
        const result = Select({ children: [<option key="1">A</option>] });
        expect(result.type).toBe('select');
        expect(result.props.className).toContain('select');
    });

    test('applies variant class', () => {
        expect(Select({ variant: 'bordered', children: 'X' }).props.className).toContain('select-bordered');
        expect(Select({ variant: 'ghost', children: 'X' }).props.className).toContain('select-ghost');
        expect(Select({ variant: 'error', children: 'X' }).props.className).toContain('select-error');
    });

    test('applies size class', () => {
        expect(Select({ size: 'xs', children: 'X' }).props.className).toContain('select-xs');
        expect(Select({ size: 'lg', children: 'X' }).props.className).toContain('select-lg');
    });

    test('no variant adds only base select class', () => {
        expect(Select({ children: 'X' }).props.className).toBe('select');
    });

    test('passes through HTML attributes', () => {
        const result = Select({ value: 'a', onChange: () => {}, 'aria-label': 'pick', children: 'X' });
        expect(result.props.value).toBe('a');
        expect(result.props['aria-label']).toBe('pick');
    });
});

describe('Textarea', () => {
    test('renders a textarea with textarea base class', () => {
        const result = Textarea({});
        expect(result.type).toBe('textarea');
        expect(result.props.className).toContain('textarea');
    });

    test('applies variant class', () => {
        expect(Textarea({ variant: 'bordered' }).props.className).toContain('textarea-bordered');
        expect(Textarea({ variant: 'ghost' }).props.className).toContain('textarea-ghost');
        expect(Textarea({ variant: 'error' }).props.className).toContain('textarea-error');
    });

    test('applies size class', () => {
        expect(Textarea({ size: 'xs' }).props.className).toContain('textarea-xs');
        expect(Textarea({ size: 'xl' }).props.className).toContain('textarea-xl');
    });

    test('error prop adds textarea-error class', () => {
        const cls = Textarea({ variant: 'primary', error: true }).props.className;
        expect(cls).toContain('textarea-error');
        expect(cls).toContain('textarea-primary');
    });

    test('no variant adds only base textarea class', () => {
        expect(Textarea({}).props.className).toBe('textarea');
    });

    test('passes through HTML attributes', () => {
        const result = Textarea({ placeholder: 'Enter', rows: 4, disabled: true });
        expect(result.props.placeholder).toBe('Enter');
        expect(result.props.rows).toBe(4);
        expect(result.props.disabled).toBe(true);
    });
});

describe('Toggle', () => {
    test('renders an input with toggle base class, type=checkbox, role=switch', () => {
        const result = Toggle({});
        expect(result.type).toBe('input');
        expect(result.props.type).toBe('checkbox');
        expect(result.props.role).toBe('switch');
        expect(result.props.className).toContain('toggle');
    });

    test('applies variant class', () => {
        expect(Toggle({ variant: 'primary' }).props.className).toContain('toggle-primary');
        expect(Toggle({ variant: 'success' }).props.className).toContain('toggle-success');
        expect(Toggle({ variant: 'error' }).props.className).toContain('toggle-error');
    });

    test('applies size class', () => {
        expect(Toggle({ size: 'xs' }).props.className).toContain('toggle-xs');
        expect(Toggle({ size: 'lg' }).props.className).toContain('toggle-lg');
    });

    test('checked sets aria-checked', () => {
        expect(Toggle({ checked: true }).props['aria-checked']).toBe(true);
        expect(Toggle({ checked: false }).props['aria-checked']).toBe(false);
    });

    test('no variant adds only base toggle class', () => {
        expect(Toggle({}).props.className).toBe('toggle');
    });

    test('passes through HTML attributes', () => {
        const onChange = () => {};
        const result = Toggle({ checked: true, onChange, disabled: true });
        expect(result.props.checked).toBe(true);
        expect(result.props.onChange).toBe(onChange);
        expect(result.props.disabled).toBe(true);
    });
});
