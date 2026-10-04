import { expect, test } from 'bun:test';
import { app } from './electron-fixture';

test('a second desktop process quits before spawning a server or opening a window', async () => {
    let quit = false;
    let ready = false;
    app.requestSingleInstanceLock = () => false;
    app.quit = () => {
        quit = true;
    };
    app.whenReady = () => {
        ready = true;
        return Promise.resolve();
    };
    await import('../src/main');
    expect(quit).toBe(true);
    expect(ready).toBe(false);
});
