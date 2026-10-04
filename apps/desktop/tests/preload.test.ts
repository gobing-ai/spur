import { expect, test } from 'bun:test';
import { DESKTOP_EXTERNAL_CHANNEL, DESKTOP_WINDOW_CHANNEL } from '../src/ipc';
import { exposed, ipcMessages } from './fixtures/electron';

test('preload handles an unavailable document root and exposes only window actions', async () => {
    const originalFrame = Object.getOwnPropertyDescriptor(process, 'isMainFrame');
    Object.defineProperty(process, 'isMainFrame', { configurable: true, value: true });
    const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
    let ready: (() => void) | undefined;
    const document = {
        documentElement: undefined as { dataset: Record<string, string> } | undefined,
        addEventListener: (event: string, handler: () => void) => {
            if (event === 'DOMContentLoaded') ready = handler;
        },
    };
    Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
    try {
        const { initializePreload } = await import('../src/preload');
        document.documentElement = { dataset: {} };
        ready?.();
        expect(document.documentElement.dataset.spurDesktop).toBe('1');
        const api = exposed.spurDesktop as {
            platform: string;
            minimize(): void;
            toggleMaximize(): void;
            close(): void;
        };
        expect(api.platform).toBe(process.platform);
        api.minimize();
        api.toggleMaximize();
        api.close();
        expect(ipcMessages).toEqual([
            [DESKTOP_WINDOW_CHANNEL, 'minimize'],
            [DESKTOP_WINDOW_CHANNEL, 'toggle-maximize'],
            [DESKTOP_WINDOW_CHANNEL, 'close'],
        ]);
        Reflect.deleteProperty(exposed, 'spurDesktop');
        document.documentElement.dataset = {};
        ready = undefined;
        Object.defineProperty(process, 'isMainFrame', { configurable: true, value: false });
        initializePreload();
        expect(exposed.spurDesktop).toBeUndefined();
        expect(document.documentElement.dataset).toEqual({});
        expect(ready).toBeUndefined();
    } finally {
        if (originalFrame) Object.defineProperty(process, 'isMainFrame', originalFrame);
        else Reflect.deleteProperty(process, 'isMainFrame');
        if (original) Object.defineProperty(globalThis, 'document', original);
        else Reflect.deleteProperty(globalThis, 'document');
    }
});

test('external browser handoff requires a trusted main-frame link click', async () => {
    const names = ['document', 'Element', 'HTMLAnchorElement', 'location'] as const;
    const saved = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    const frame = Object.getOwnPropertyDescriptor(process, 'isMainFrame');
    let click: ((event: MouseEvent) => void) | undefined;
    class FakeElement {
        closest(_selector: string): FakeElement | null {
            return this;
        }
    }
    class FakeAnchor extends FakeElement {
        constructor(
            public href: string,
            public target = '',
        ) {
            super();
        }
    }
    const values = [
        {
            documentElement: { dataset: {} },
            addEventListener(name: string, listener: (event: MouseEvent) => void) {
                if (name === 'click') click = listener;
            },
        },
        FakeElement,
        FakeAnchor,
        { href: 'http://127.0.0.1:1234/board', origin: 'http://127.0.0.1:1234' },
    ];
    names.forEach((name, i) => {
        Object.defineProperty(globalThis, name, { configurable: true, value: values[i] });
    });
    Object.defineProperty(process, 'isMainFrame', { configurable: true, value: true });
    try {
        const { initializePreload } = await import('../src/preload');
        initializePreload();
        const before = ipcMessages.length;
        let prevented = 0;
        const send = (target: unknown, extra: Record<string, unknown> = {}) =>
            click?.({
                isTrusted: true,
                button: 0,
                defaultPrevented: false,
                target,
                preventDefault() {
                    prevented++;
                },
                ...extra,
            } as unknown as MouseEvent);
        send(new FakeAnchor('https://example.com'), { isTrusted: false });
        send(new FakeAnchor('https://example.com'), { button: 1 });
        send(new FakeAnchor('https://example.com'), { defaultPrevented: true });
        send({});
        send(new FakeElement());
        send(new FakeAnchor('file:///tmp/a'));
        send(new FakeAnchor('https://user:pass@example.com'));
        send(new FakeAnchor('http://127.0.0.1:1234/board/tasks'));
        expect(ipcMessages.length).toBe(before);
        send(new FakeAnchor('https://example.com/page'));
        send(new FakeAnchor('http://127.0.0.1:1234/board/tasks', '_blank'));
        send(new FakeAnchor('http://127.0.0.1:1234/board/tasks'), { ctrlKey: true });
        expect(prevented).toBe(3);
        expect(ipcMessages.slice(before)).toEqual([
            [DESKTOP_EXTERNAL_CHANNEL, 'https://example.com/page'],
            [DESKTOP_EXTERNAL_CHANNEL, 'http://127.0.0.1:1234/board/tasks'],
            [DESKTOP_EXTERNAL_CHANNEL, 'http://127.0.0.1:1234/board/tasks'],
        ]);
    } finally {
        names.forEach((name, i) => {
            const descriptor = saved[i];
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        });
        if (frame) Object.defineProperty(process, 'isMainFrame', frame);
        else Reflect.deleteProperty(process, 'isMainFrame');
    }
});
