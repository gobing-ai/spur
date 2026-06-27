/**
 * Shared happy-dom lifecycle for React component tests.
 *
 * React 19's scheduler defers work onto a macrotask (`MessageChannel` →
 * `performWorkUntilDeadline`). If a suite's `afterAll` calls
 * `GlobalRegistrator.unregister()` while any scheduled render is still queued, that
 * callback later fires with no `globalThis.window` and throws
 * `ReferenceError: window is not defined` — surfacing as bun's "Unhandled error
 * between tests". It is timing-dependent: a fast dev box drains the queue before
 * teardown; a loaded CI runner does not.
 *
 * `teardownHappyDom` closes that race: it unmounts everything (`cleanup`), then yields
 * macrotasks so the scheduler drains *while `window` still exists*, and only then
 * unregisters. Use it as the `afterAll` body in every web React test.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { cleanup } from '@testing-library/react';

/** Yield a macrotask, letting the React scheduler's posted message run to completion. */
function flushMacrotask(): Promise<void> {
    return new Promise((res) => setTimeout(res, 0));
}

/**
 * Drain pending React scheduler work, then unregister happy-dom. Call from `afterAll`.
 *
 * Two macrotask yields cover the common case (one to run the scheduled render, one to
 * run any follow-up it posts) before the DOM globals are removed.
 */
export async function teardownHappyDom(): Promise<void> {
    cleanup();
    await flushMacrotask();
    await flushMacrotask();
    await GlobalRegistrator.unregister();
}
