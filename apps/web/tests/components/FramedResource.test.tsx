import { afterAll, describe, expect, it } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import { FramedResource } from '../../src/components/FramedResource';
import { registerHappyDom, teardownHappyDom } from '../happy-dom';

/**
 * The Board-owned frame adapter (task 0991 R2–R5).
 *
 * These assertions are deliberately about what the adapter does NOT do: it must not infer
 * readiness from a frame load, must not impose a sandbox promise, and must not rewrite the
 * configured URL. Those absences are the requirement, so they are asserted directly rather
 * than left to review.
 *
 * The configured URL is a `data:` document on purpose. happy-dom NAVIGATES a frame on any
 * http(s) `src`, so a realistic URL would make the unit suite issue a real network request
 * (ECONNREFUSED) or, with page loading disabled, reject with NotSupportedError — either way an
 * unhandled rejection that exits the test script non-zero while every assertion still passes.
 * A `data:` URL exercises the same contract (the adapter must pass whatever URL it is
 * configured with through verbatim, to both the frame and the escape hatch) with no navigation.
 * Real frame policy behaviour is covered over CDP in `board-frames-browser.test.ts`.
 */

registerHappyDom();

afterAll(teardownHappyDom);

const URL = 'data:text/html,<p>framed resource</p>';
const TITLE = 'Design Docs';

function mount() {
    cleanup();
    return render(<FramedResource moduleId="frame" url={URL} title={TITLE} />);
}

describe('FramedResource (task 0991 R2-R5)', () => {
    it('frames the configured URL verbatim and names it accessibly', () => {
        const view = mount();
        const frame = view.getByTestId('framed-resource-frame') as HTMLIFrameElement;

        expect(frame.tagName).toBe('IFRAME');
        // R4: the configured URL is used as-is — no proxy, no rewritten origin.
        expect(frame.getAttribute('src')).toBe(URL);
        // R3: an accessible name for the frame, taken from the configured module name.
        expect(frame.getAttribute('title')).toBe(TITLE);
        expect(view.getByTestId('framed-resource').getAttribute('data-module-id')).toBe('frame');
    });

    it('never derives readiness from a frame load event', () => {
        const view = mount();
        const frame = view.getByTestId('framed-resource-frame') as HTMLIFrameElement;
        const shell = view.getByTestId('framed-resource');

        // The requirement is the ABSENCE of a readiness claim: no load handler is attached...
        expect(frame.onload).toBeNull();
        // ...and no readiness surface exists to be observed.
        expect(shell.getAttribute('data-ready')).toBeNull();
        expect(shell.getAttribute('data-loading')).toBeNull();
        expect(frame.getAttribute('aria-busy')).toBeNull();
    });

    it('imposes no sandbox promise and no automatic permissions', () => {
        const view = mount();
        const frame = view.getByTestId('framed-resource-frame') as HTMLIFrameElement;

        // R5: restricting a configured application is the project's policy decision, not
        // something this adapter silently asserts.
        expect(frame.getAttribute('sandbox')).toBeNull();
        expect(frame.getAttribute('allow')).toBeNull();
        expect(frame.getAttribute('csp')).toBeNull();
    });

    it('always offers an external open that is safe and same-target-free', () => {
        const view = mount();
        const link = view.getByTestId('framed-resource-external') as HTMLAnchorElement;

        expect(link.getAttribute('href')).toBe(URL);
        // R3: the escape hatch is always present, opens in a new tab and cannot reach back
        // through window.opener.
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toBe('noopener noreferrer');
        expect(link.textContent).toContain('Open externally');
    });

    it('fills the workspace on a flex/min-height/min-width layout so the child owns scrolling', () => {
        const view = mount();
        const shell = view.getByTestId('framed-resource') as HTMLDivElement;
        const frame = view.getByTestId('framed-resource-frame') as HTMLIFrameElement;

        expect(shell.style.display).toBe('flex');
        expect(shell.style.flexDirection).toBe('column');
        // happy-dom normalizes `0px` to `0`, so assert the resolved value rather than the literal.
        expect(parseFloat(shell.style.minHeight)).toBe(0);
        expect(parseFloat(shell.style.minWidth)).toBe(0);

        // The frame grows into the remaining space; the framed document scrolls itself.
        expect(shell.style.minHeight).not.toBe('');
        expect(frame.style.flexGrow).toBe('1');
        expect(parseFloat(frame.style.minHeight)).toBe(0);
    });
});
